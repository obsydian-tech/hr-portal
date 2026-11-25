/**
 * REC-02: Not hired is a person's action, always with a reason. Scores and votes never decide (see submitVote,
 * submitVoteByToken and completeEvaluation: they only record data and raise flags).
 *
 * The handler (lambda/recordNotHired) has already run the role check, requireTenant and requireModule. This file does the work:
 *   recordNotHired   POST /v1/candidates/{id}/not-hired          a person who may decide records a reason
 *   confirmNotHired  POST /v1/candidates/{id}/not-hired/confirm  a different person completes a pending decision
 *   cancelNotHired   POST /v1/candidates/{id}/not-hired/cancel   a person who may decide lets a pending decision go
 *   reopenCandidate  POST /v1/candidates/{id}/reopen             a person who may decide moves a Not hired candidate back
 *   oldSystemList    GET  /v1/candidates/old-system              the one-off list of what the old system rejected (Recruiter)
 *
 * ctx = { tenantId, personId, event }. The company and the person come from the sign-in, never from a request value.
 * Another company's candidate answers 404, the same as one that does not exist. Nothing here calls a model.
 */
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { json } from '../hr-group.mjs';
import { ownsRow, stampTenant, tenantKey } from '../tenant.mjs';
import { canDecide, isManager, isRecruiter, hiringManagerOf } from '../recruitment-access.mjs';
import { DEFAULTS, REASONS, getRecruitmentSettings } from '../recruitment-settings.mjs';
import { normaliseStage } from '../recruitment-stages.mjs';
import { decisionDeciderOf } from './candidate-progress.mjs';

const db = new DynamoDBClient({});
const bus = new EventBridgeClient({});
const STATE = () => process.env.STATE_TABLE_NAME ?? 'talent-flow-state';
const IDEMPOTENCY = () => process.env.IDEMPOTENCY_TABLE_NAME ?? 'talent-flow-idempotency-keys';
const BUS = () => process.env.EVENTBRIDGE_BUS_NAME ?? 'talent-flow-bus';

const KEY_TTL_SECONDS = 48 * 60 * 60;
const MAX_TEXT = 1000;

const OPEN_STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
const LIVE_OFFER_STATES = ['IN_APPROVAL', 'OFFER_SENT', 'WAITING_APPROVAL', 'APPROVED', 'SENT'];
const OLD_OUTCOMES = ['REJECTED', 'EVALUATION_FAILED'];

const notFound = () => json(404, { error: 'Not found' });
const forbidden = () => json(403, { error: 'Forbidden' });
const conflict = (code) => json(409, { error: 'Conflict', code });
const bad = (code) => json(400, { error: 'Bad request', code });

const isOldSystem = (row) => row.decided_by_kind === 'OLD_SYSTEM';
const present = (v) => v !== undefined && v !== null && v !== '';

/** The open stage a stored row is in, or null when it is not open (Hired, Not hired, or an old outcome). */
export function openStageOf(row) {
  if (OLD_OUTCOMES.includes(row.status)) return null;
  const stage = normaliseStage(row.currentStage);
  return OPEN_STAGES.includes(stage) ? stage : null;
}

async function loadCandidate(tenantId, candidateId) {
  if (typeof candidateId !== 'string' || candidateId === '') return null;
  const got = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }), ConsistentRead: true }));
  const row = got.Item ? unmarshall(got.Item) : null;
  return row && ownsRow(row, tenantId) ? row : null;
}

/** The candidate is the caller's to touch at all: a Recruiter, or the hiring manager of this candidate. Anyone else gets 404. */
const relatesTo = (ctx, row) => isRecruiter(ctx.event) || (isManager(ctx.event) && hiringManagerOf(row, ctx.personId));

/** The candidate's own REJECTION_RULES (the version locked to it): who decides, and whether a second person confirms. */
async function rulesFor(tenantId, row) {
  const settings = await getRecruitmentSettings(tenantId, row);
  const rules = settings.REJECTION_RULES ?? DEFAULTS.REJECTION_RULES;
  const level = row.positionLevel;
  return { decider: decisionDeciderOf(settings, row), second: rules.secondConfirmation?.[level] === true };
}

/** null when the caller may decide; the hiring manager who may not (HR_ONLY) is told 403, anyone else with no relation 404. */
function refusalFor(ctx, row, decider) {
  if (canDecide(ctx.event, row, decider)) return null;
  return relatesTo(ctx, row) ? forbidden() : notFound();
}

/** Load the candidate and check the caller may decide on it: { row, rules } or { refusal }. */
async function loadForDecision(ctx, candidateId) {
  const row = await loadCandidate(ctx.tenantId, candidateId);
  if (!row || !relatesTo(ctx, row)) return { refusal: notFound() };
  const rules = await rulesFor(ctx.tenantId, row);
  const refusal = refusalFor(ctx, row, rules.decider);
  return refusal ? { refusal } : { row, rules };
}

async function writeHistory(ctx, row, from, to, extra = {}) {
  const at = new Date().toISOString();
  const nonce = Math.random().toString(36).slice(2, 8);
  await db.send(new PutItemCommand({
    TableName: STATE(),
    Item: marshall(stampTenant({
      PK: row.PK, SK: `STAGE#${at}#${nonce}`, candidateId: row.candidateId, fromStage: from, toStage: to,
      actor: ctx.personId, timestamp: at, recordType: 'STAGE_HISTORY', createdAt: at, ...extra,
    }, ctx.tenantId), { removeUndefinedValues: true }),
  }));
}

/** The one place a candidate becomes Not hired: rule 3's writes, the history row and the event. */
async function complete(ctx, row, from, { reason, note, decidedBy, confirmedBy }) {
  const at = new Date().toISOString();
  const values = {
    ':nh': 'NOT_HIRED', ':from': from, ':at': at, ':rc': reason, ':by': decidedBy, ':kind': 'PERSON', ':t': ctx.tenantId, ':cur': row.currentStage,
  };
  let set = 'SET currentStage = :nh, stage_before_not_hired = :from, not_hired_at = :at, reason_code = :rc, decided_by = :by, decided_by_kind = :kind';
  if (note !== undefined) { set += ', reason_note = :note'; values[':note'] = note; }
  if (confirmedBy) { set += ', confirmed_by = :cb'; values[':cb'] = confirmedBy; }
  try {
    await db.send(new UpdateItemCommand({
      TableName: STATE(), Key: marshall({ PK: row.PK, SK: 'SAGA' }),
      UpdateExpression: `${set} REMOVE not_hired_pending`,
      ConditionExpression: 'tenant_id = :t AND currentStage = :cur',
      ExpressionAttributeValues: marshall(values),
    }));
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') return conflict('NOT_OPEN');
    throw e;
  }
  await writeHistory(ctx, row, from, 'NOT_HIRED', { reason_code: reason });
  // The event names no reason, no note and no person's name (D-REC-2.3).
  await bus.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS(), Source: 'talent-flow.workflow', DetailType: 'CandidateNotHired',
      Detail: JSON.stringify({ tenant_id: ctx.tenantId, candidate_id: row.candidateId, role_id: row.role_id ?? null, by: decidedBy, at }),
    }],
  }));
  return json(200, { candidateId: row.candidateId, stage: 'NOT_HIRED' });
}

/** An Idempotency-Key replays only to the person who sent it, in their own company. */
const keyOf = (ctx, clientKey) => (typeof clientKey === 'string' && clientKey !== '' ? tenantKey(ctx.tenantId, 'NOT_HIRED', ctx.personId, clientKey) : null);

async function replayOf(key) {
  if (!key) return null;
  const got = await db.send(new GetItemCommand({ TableName: IDEMPOTENCY(), Key: marshall({ idempotencyKey: key }) }));
  const stored = got.Item ? unmarshall(got.Item) : null;
  return stored?.response ? JSON.parse(stored.response) : null;
}
async function remember(key, response) {
  if (!key || response.statusCode !== 200) return;
  await db.send(new PutItemCommand({
    TableName: IDEMPOTENCY(),
    Item: marshall({ idempotencyKey: key, response: JSON.stringify(response), expiresAt: Math.floor(Date.now() / 1000) + KEY_TTL_SECONDS }),
  }));
}

/** POST /v1/candidates/{id}/not-hired */
export async function recordNotHired(ctx, { candidateId, reason, note, idempotencyKey }) {
  if (!present(reason)) return bad('REASON_REQUIRED');
  if (typeof reason !== 'string' || !REASONS.includes(reason)) return bad('INVALID_REASON');
  if (note !== undefined && (typeof note !== 'string' || note.length > MAX_TEXT)) return bad('NOTE_TOO_LONG');

  const key = keyOf(ctx, idempotencyKey);
  const replay = await replayOf(key);
  if (replay) return replay;

  const { row, rules, refusal } = await loadForDecision(ctx, candidateId);
  if (refusal) return refusal;
  const from = openStageOf(row);
  if (!from) return conflict('NOT_OPEN');
  const offer = await db.send(new GetItemCommand({ TableName: STATE(), Key: marshall({ PK: row.PK, SK: 'OFFER' }) }));
  const offerRow = offer.Item ? unmarshall(offer.Item) : null;
  if (offerRow && ownsRow(offerRow, ctx.tenantId) && LIVE_OFFER_STATES.includes(offerRow.state)) return conflict('OFFER_LIVE');

  let answer;
  if (rules.second) {
    // The other kind of person confirms: the role's hiring manager for an HR decision, else any HR with the tick (D-REC-2.2).
    const awaiting = isRecruiter(ctx.event) && present(row.hiringManagerId) ? { kind: 'HIRING_MANAGER', personId: row.hiringManagerId } : { kind: 'HR' };
    const pending = { by: ctx.personId, reason_code: reason, at: new Date().toISOString(), awaiting, ...(note !== undefined ? { note } : {}) };
    try {
      await db.send(new UpdateItemCommand({
        TableName: STATE(), Key: marshall({ PK: row.PK, SK: 'SAGA' }), UpdateExpression: 'SET not_hired_pending = :p',
        ConditionExpression: 'tenant_id = :t AND currentStage = :cur', ExpressionAttributeValues: marshall({ ':p': pending, ':t': ctx.tenantId, ':cur': row.currentStage }),
      }));
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') return conflict('NOT_OPEN');
      throw e;
    }
    answer = json(200, { candidateId: row.candidateId, pending: true, awaiting });
  } else {
    answer = await complete(ctx, row, from, { reason, note, decidedBy: ctx.personId });
  }
  await remember(key, answer);
  return answer;
}

/** POST /v1/candidates/{id}/not-hired/confirm */
export async function confirmNotHired(ctx, { candidateId }) {
  const { row, refusal } = await loadForDecision(ctx, candidateId);
  if (refusal) return refusal;
  const pending = row.not_hired_pending;
  if (!pending) return conflict('NOTHING_PENDING');
  if (pending.by === ctx.personId) return conflict('SAME_PERSON');
  const from = openStageOf(row);
  if (!from) return conflict('NOT_OPEN');
  return complete(ctx, row, from, { reason: pending.reason_code, note: pending.note, decidedBy: pending.by, confirmedBy: ctx.personId });
}

/** POST /v1/candidates/{id}/not-hired/cancel */
export async function cancelNotHired(ctx, { candidateId }) {
  const { row, refusal } = await loadForDecision(ctx, candidateId);
  if (refusal) return refusal;
  if (!row.not_hired_pending) return conflict('NOTHING_PENDING');
  try {
    await db.send(new UpdateItemCommand({
      TableName: STATE(), Key: marshall({ PK: row.PK, SK: 'SAGA' }), UpdateExpression: 'REMOVE not_hired_pending',
      ConditionExpression: 'tenant_id = :t', ExpressionAttributeValues: marshall({ ':t': ctx.tenantId }),
    }));
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') return notFound();
    throw e;
  }
  return json(200, { candidateId: row.candidateId, pending: false });
}

/** POST /v1/candidates/{id}/reopen */
export async function reopenCandidate(ctx, { candidateId, reason }) {
  if (!present(reason)) return bad('REASON_REQUIRED');
  if (typeof reason !== 'string' || reason.length > MAX_TEXT) return bad('REASON_TOO_LONG');
  const { row, refusal } = await loadForDecision(ctx, candidateId);
  if (refusal) return refusal;
  // A Not hired row, or an old-system row (REC-03's migration marks it and gives it stage_before_not_hired).
  const closed = row.currentStage === 'NOT_HIRED' || (isOldSystem(row) && OLD_OUTCOMES.includes(row.status));
  const to = row.stage_before_not_hired;
  if (!closed || !OPEN_STAGES.includes(to)) return conflict('NOT_OPEN');
  try {
    await db.send(new UpdateItemCommand({
      TableName: STATE(), Key: marshall({ PK: row.PK, SK: 'SAGA' }),
      UpdateExpression: 'SET currentStage = :to, #status = :active, reopened_by = :by, reopened_at = :at REMOVE not_hired_at, reason_code, reason_note, decided_by, decided_by_kind, confirmed_by, not_hired_pending',
      ConditionExpression: 'tenant_id = :t AND stage_before_not_hired = :to',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: marshall({ ':to': to, ':active': 'ACTIVE', ':by': ctx.personId, ':at': new Date().toISOString(), ':t': ctx.tenantId }),
    }));
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') return conflict('NOT_OPEN');
    throw e;
  }
  // The earlier decision stays in the history; this is one more row, with the reopen reason.
  await writeHistory(ctx, row, 'NOT_HIRED', to, { reason });
  return json(200, { candidateId: row.candidateId, stage: to });
}

/** GET /v1/candidates/old-system: Recruiter only; the company's rows the REC-03 migration marked; every page of the index is read. */
export async function oldSystemList(ctx) {
  const candidates = [];
  let start;
  do {
    const page = await db.send(new QueryCommand({
      TableName: STATE(), IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :saga)',
      FilterExpression: 'decided_by_kind = :kind AND tenant_id = :t',
      ExpressionAttributeValues: marshall({ ':pk': tenantKey(ctx.tenantId), ':saga': 'SAGA#', ':kind': 'OLD_SYSTEM', ':t': ctx.tenantId }),
      ...(start ? { ExclusiveStartKey: start } : {}),
    }));
    for (const item of page.Items ?? []) {
      const row = unmarshall(item);
      if (row.SK !== 'SAGA' || !ownsRow(row, ctx.tenantId) || !isOldSystem(row)) continue;
      candidates.push({
        candidate_id: row.candidateId,
        name: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim(),
        role_id: row.role_id ?? null,
        stage_before_not_hired: row.stage_before_not_hired ?? null,
        rejected_at: row.not_hired_at ?? null,
        evaluation_result: row.evaluationResult ?? row.evaluation_result ?? null,
      });
    }
    start = page.LastEvaluatedKey;
  } while (start);
  return json(200, { candidates });
}
