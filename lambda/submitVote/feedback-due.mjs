// REC-UI-03 server (NH-293): GET /v1/feedback-due, the interviews the caller owes feedback on. Reads only.
import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import * as T from '../shared/tenant.mjs';
import * as RA from '../shared/recruitment-access.mjs';
import { requireModule } from '../shared/modules.mjs';
import { settingsForRead } from '../shared/recruitment-settings.mjs';
import { voteRefusalOf } from '../shared/interview-lifecycle.mjs';
import { feedbackDueAt } from '../shared/feedback-due.mjs';
import { duePk } from '../shared/feedback-due-rows.mjs';
import * as S from '../shared/scoring.mjs';

const db = new DynamoDBClient({});
const STATE = () => process.env.STATE_TABLE_NAME;
const LIMIT = 200;
const AT_ONCE = 10;

async function get(Key, consistent = false) {
  const r = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall(Key), ...(consistent ? { ConsistentRead: true } : {}) }));
  return r.Item ? unmarshall(r.Item) : null;
}

async function voted(candidateId, interviewId, me) {
  let start;
  do {
    const r = await db.send(new QueryCommand({
      TableName: STATE(), KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${candidateId}`, ':sk': `VOTE#${me}#` }), ...(start ? { ExclusiveStartKey: start } : {}),
    }));
    if ((r.Items ?? []).map((i) => unmarshall(i)).some((v) => v.interviewId === interviewId)) return true;
    start = r.LastEvaluatedKey;
  } while (start);
  return Boolean(await get({ PK: `CANDIDATE#${candidateId}`, SK: `VOTED#${interviewId}#${me}` }));
}

export async function feedbackDue(event) {
  const t = T.requireTenant(event);
  if (t.refusal) return t.refusal;
  const off = await requireModule(event, 'recruitment');
  if (off) return off;
  const tenantId = t.tenantId;
  const me = RA.callerId(event);
  if (!me || typeof me !== 'string') return S.json(403, { error: 'Forbidden' });
  try {
    const rows = [];
    let more = false;
    let start;
    do {
      const r = await db.send(new QueryCommand({
        TableName: STATE(), KeyConditionExpression: 'PK = :pk', FilterExpression: '#s = :open',
        ExpressionAttributeNames: { '#s': 'state' }, ExpressionAttributeValues: marshall({ ':pk': duePk(tenantId, me), ':open': 'OPEN' }),
        ...(start ? { ExclusiveStartKey: start } : {}),
      }));
      for (const i of r.Items ?? []) {
        if (rows.length === LIMIT) { more = true; break; }
        rows.push(unmarshall(i));
      }
      start = r.LastEvaluatedKey;
      // Exactly 200 so far: more only if another OPEN row follows (pages of only DONE rows do not count).
      let next = rows.length === LIMIT && !more ? start : undefined;
      while (next) {
        const peek = await db.send(new QueryCommand({
          TableName: STATE(), KeyConditionExpression: 'PK = :pk', FilterExpression: '#s = :open',
          ExpressionAttributeNames: { '#s': 'state' }, ExpressionAttributeValues: marshall({ ':pk': duePk(tenantId, me), ':open': 'OPEN' }), ExclusiveStartKey: next,
        }));
        if ((peek.Items ?? []).length) { more = true; break; }
        next = peek.LastEvaluatedKey;
      }
    } while (start && rows.length < LIMIT);

    const nowMs = Date.now();
    const settingsBySaga = new Map();
    const one = async (row) => {
      const m = /^CANDIDATE#(.+)#INTERVIEW#(.+)$/.exec(String(row.SK));
      if (!m) return null;
      const [, candidateId, interviewId] = m;
      const iv = await get({ PK: `CANDIDATE#${candidateId}`, SK: `INTERVIEW#${interviewId}` }, true);
      if (!iv || !T.ownsRow(iv, tenantId)) return null;
      if (!RA.panelMemberOf(iv, me) || voteRefusalOf(iv, nowMs) !== null) return null;
      const saga = await get({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' });
      if (!saga || !T.ownsRow(saga, tenantId)) return null;
      if (await voted(candidateId, interviewId, me)) return null;
      if (!settingsBySaga.has(candidateId)) settingsBySaga.set(candidateId, settingsForRead(tenantId, saga));
      const { settings } = await settingsBySaga.get(candidateId);
      return {
        kind: 'INTERVIEW_FEEDBACK', interview_id: iv.interviewId ?? interviewId, candidate_first: saga.firstName ?? null, candidate_last: saga.lastName ?? null,
        role_title: saga.positionTitle ?? null, type: iv.interviewType ?? null, at: iv.scheduledAt ?? null, due_at: feedbackDueAt(iv.scheduledAt, settings.SLA_THRESHOLDS),
      };
    };
    const items = [];
    for (let i = 0; i < rows.length; i += AT_ONCE) items.push(...(await Promise.all(rows.slice(i, i + AT_ONCE).map(one))).filter(Boolean));
    const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    items.sort((a, b) => cmp(a.due_at ?? '', b.due_at ?? '') || cmp(a.at ?? '', b.at ?? '') || cmp(a.interview_id, b.interview_id));
    return S.json(200, { items, more });
  } catch (err) {
    console.error('submitVote: feedback-due read failed', { error: err.name });
    return S.json(500, { error: 'Internal error' });
  }
}
