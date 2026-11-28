/**
 * REC-15 rule 1: the one stage clock. A candidate's due date and status are worked out from the time in its stage and the company's
 * active SLA_THRESHOLDS, read the way monitorTalentFlowSLAs reads them (old stage names count by their new stage; the longest wins).
 */
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { normaliseStage } from '../recruitment-stages.mjs';

const db = new DynamoDBClient({});
const CONFIG = () => process.env.CONFIG_TABLE_NAME ?? 'talent-flow-config';
const OPEN = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
const HOUR = 3_600_000;

/** Hours per stage code from the stored setting (the monitor's rule). */
export function hoursByStage(stored) {
  const out = {};
  for (const [key, hours] of Object.entries(stored ?? {})) {
    const code = normaliseStage(key);
    if (code && typeof hours === 'number') out[code] = Math.max(out[code] ?? 0, hours);
  }
  return out;
}

/**
 * When the candidate entered the stage it is in now. A Not hired row reads from the moment it was recorded (not_hired_at; the row keeps
 * the stage time of its last open stage). A reopened row reads from the reopen, which does not reset stageEnteredAt. A later move
 * writes a newer stageEnteredAt, which wins. Falls back to createdAt. Returns a time text, or null when no stored time is readable.
 */
export function enteredAt(row, stage = normaliseStage(row) ?? 'APPLIED') {
  const times = stage === 'NOT_HIRED' && row.not_hired_at ? [row.not_hired_at] : [row.stageEnteredAt ?? row.createdAt, row.reopened_at];
  const ms = times.map((t) => (typeof t === 'string' ? Date.parse(t) : NaN)).filter(Number.isFinite);
  return ms.length ? new Date(Math.max(...ms)).toISOString() : null;
}

/** { due_at, sla_status } of a stored candidate row. `thresholds` is the stored SLA_THRESHOLDS data (or null). */
export function stageClock(row, thresholds, now = Date.now()) {
  const stage = normaliseStage(row) ?? 'APPLIED';
  if (!OPEN.includes(stage)) return { due_at: null, sla_status: null };
  const hours = hoursByStage(thresholds)[stage];
  const from = Date.parse(enteredAt(row, stage));
  if (typeof hours !== 'number' || !Number.isFinite(from)) return { due_at: null, sla_status: 'ON_TRACK' };
  const used = ((now - from) / (hours * HOUR)) * 100;
  return { due_at: new Date(from + hours * HOUR).toISOString(), sla_status: used >= 100 ? 'OVERDUE' : used >= 75 ? 'DUE_SOON' : 'ON_TRACK' };
}

/** The company's active SLA_THRESHOLDS data, or null when it has none. A failed read throws. */
export async function thresholdsOf(tenantId) {
  const r = await db.send(new QueryCommand({
    TableName: CONFIG(), IndexName: 'GSI1-active-configs', KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
    ExpressionAttributeValues: marshall({ ':pk': `TENANT#${tenantId}#ACTIVE`, ':sk': 'CONFIG#SLA_THRESHOLDS' }), Limit: 1,
  }));
  const item = r.Items?.[0];
  return item ? (unmarshall(item).data ?? null) : null;
}
