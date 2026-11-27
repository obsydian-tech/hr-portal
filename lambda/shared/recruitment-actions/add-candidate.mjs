/**
 * REC-15 step B: POST /v1/candidates on the new body. The handler has run the role check, requireTenant and
 * requireModule. ctx = { tenantId, personId, event }.
 */
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { ulid } from 'ulid';
import { json } from '../hr-group.mjs';
import { ownsRow, stampTenant, tenantKey } from '../tenant.mjs';
import { activeVersions } from '../recruitment-settings.mjs';
import { stageClock, thresholdsOf } from './stage-clock.mjs';

const db = new DynamoDBClient({});
const eb = new EventBridgeClient({});
const ROLES = () => process.env.ROLES_TABLE_NAME ?? 'talent-flow-roles';
const STATE = () => process.env.STATE_TABLE_NAME;
const IDEM = () => process.env.IDEMPOTENCY_TABLE_NAME;
const BUS = () => process.env.EVENTBRIDGE_BUS_NAME;
const ALLOWED = new Set(['first_name', 'last_name', 'email', 'role_id', 'phone', 'source', 'idempotencyKey']);
const bad = (code, field) => json(400, { error: 'Bad request', code, ...(field ? { field } : {}) });
const text = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function addCandidate(ctx, { body, headerKey }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('INVALID_BODY');
  const clientKey = typeof headerKey === 'string' && headerKey.trim() ? headerKey : typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim() ? body.idempotencyKey : null;
  if (!clientKey) return bad('IDEMPOTENCY_KEY_REQUIRED');
  for (const k of Object.keys(body)) if (!ALLOWED.has(k)) return bad('INVALID_FIELD', k);
  if (!text(body.first_name, 1, 80)) return bad('INVALID_FIELD', 'first_name');
  if (!text(body.last_name, 1, 80)) return bad('INVALID_FIELD', 'last_name');
  if (typeof body.email !== 'string' || body.email.trim().length > 254 || !EMAIL.test(body.email.trim())) return bad('INVALID_FIELD', 'email');
  if (body.phone !== undefined && !(typeof body.phone === 'string' && body.phone.length >= 1 && body.phone.length <= 30 && /^[0-9 +\-()]+$/.test(body.phone))) return bad('INVALID_FIELD', 'phone');
  if (body.source !== undefined && !text(body.source, 1, 80)) return bad('INVALID_FIELD', 'source');
  if (typeof body.role_id !== 'string' || !body.role_id) return bad('ROLE_REQUIRED');

  const key = tenantKey(ctx.tenantId, clientKey);
  const seen = await db.send(new GetItemCommand({ TableName: IDEM(), Key: marshall({ idempotencyKey: key }) }));
  const prior = seen.Item ? unmarshall(seen.Item) : null;
  if (prior?.status === 'COMPLETED' && prior.answer) return json(200, JSON.parse(prior.answer));
  if (prior && prior.status !== 'FAILED') return json(409, { error: 'Conflict', code: 'IN_PROGRESS' });

  const got = await db.send(new GetItemCommand({ TableName: ROLES(), Key: marshall({ pk: `TENANT#${ctx.tenantId}`, sk: `ROLE#${body.role_id}` }) }));
  const role = got.Item ? unmarshall(got.Item) : null;
  if (!role || !ownsRow(role, ctx.tenantId) || role.role_id !== body.role_id) return json(404, { error: 'Not found' });
  if (role.status !== 'OPEN') return json(409, { error: 'Conflict', code: 'ROLE_CLOSED' });

  const [versions, thresholds] = await Promise.all([activeVersions(ctx.tenantId), thresholdsOf(ctx.tenantId)]);
  const now = new Date().toISOString();
  const candidateId = `CAND-${ulid()}`;
  const row = stampTenant({
    PK: `CANDIDATE#${candidateId}`, SK: 'SAGA', GSI1PK: tenantKey(ctx.tenantId), GSI1SK: `SAGA#${now}`, candidateId,
    firstName: body.first_name.trim(), lastName: body.last_name.trim(), email: body.email.trim().toLowerCase(),
    ...(body.phone !== undefined ? { phone: body.phone } : {}), ...(body.source !== undefined ? { source: body.source.trim() } : {}),
    role_id: role.role_id, positionTitle: role.job_title, positionLevel: role.level,
    ...(role.department_id ? { department_id: role.department_id } : {}), ...(role.department ? { department: role.department } : {}),
    hiringManagerId: role.hiring_manager_id, criteria: role.criteria ?? [], added_by: ctx.personId,
    appliedDate: now, createdAt: now, currentStage: 'APPLIED', stageEnteredAt: now, status: 'ACTIVE', slaStatus: 'ON_TRACK',
    ...(Object.keys(versions).length ? { settingVersions: versions } : {}), updatedBy: ctx.personId,
  }, ctx.tenantId);

  await db.send(new PutItemCommand({ TableName: IDEM(), Item: marshall({ idempotencyKey: key, status: 'IN_PROGRESS', ttl: Math.floor(Date.now() / 1000) + 172800, createdAt: now }), ConditionExpression: 'attribute_not_exists(idempotencyKey) OR #s = :failed', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: marshall({ ':failed': 'FAILED' }) }));
  try {
    await db.send(new PutItemCommand({ TableName: STATE(), Item: marshall(row, { removeUndefinedValues: true }), ConditionExpression: 'attribute_not_exists(PK)' }));
  } catch (e) {
    // No candidate stored: free the key (PutItem only; the role has no UpdateItem or DeleteItem), then fail.
    try { await db.send(new PutItemCommand({ TableName: IDEM(), Item: marshall({ idempotencyKey: key, status: 'FAILED', ttl: Math.floor(Date.now() / 1000) + 172800, createdAt: now }) })); }
    catch (e2) { console.error('key not freed', { error: e2?.name ?? 'Error' }); }
    throw e;
  }
  try {
    await eb.send(new PutEventsCommand({ Entries: [{ EventBusName: BUS(), Source: 'talent-flow.candidates', DetailType: 'CandidateCreated',
      Detail: JSON.stringify({ candidateId, tenant_id: ctx.tenantId, positionLevel: row.positionLevel, positionTitle: row.positionTitle, email: row.email }) }] }));
  } catch (e) { console.error('CandidateCreated not sent', { error: e?.name ?? 'Error' }); }

  const { due_at, sla_status } = stageClock(row, thresholds, Date.now());
  const candidate = {
    id: candidateId, name: `${row.firstName} ${row.lastName}`, stage: 'APPLIED', stage_entered_at: now, due_at, sla_status, role_id: role.role_id,
    role_title: role.job_title, level: role.level ?? null, ...(row.source !== undefined ? { source: row.source } : {}), applied_at: now,
    hiring_manager_id: role.hiring_manager_id ?? null, mine: true, not_hired_pending: null,
  };
  const answer = { candidateId, candidate };
  try {
    await db.send(new PutItemCommand({ TableName: IDEM(), Item: marshall({ idempotencyKey: key, status: 'COMPLETED', candidateId, answer: JSON.stringify(answer), ttl: Math.floor(Date.now() / 1000) + 172800, createdAt: now }) }));
  } catch (e) { console.error('key not marked finished', { error: e?.name ?? 'Error' }); }
  return json(201, answer);
}
