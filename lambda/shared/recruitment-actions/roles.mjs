/**
 * REC-04: a role record, and the candidates of a role.
 *
 * The handler (lambda/manageRoles) has already run the REC-01 role check, requireTenant and requireModule. This file does the work:
 *   listRoles          GET  /v1/roles             a Recruiter: every role of the company; a manager: the roles they hire for
 *   getRole            GET  /v1/roles/{id}        one role, with its counts
 *   openRole           POST /v1/roles             a Recruiter opens a role (an Idempotency-Key is required)
 *   closeRole          POST /v1/roles/{id}/close  a Recruiter closes a role once no candidate is open
 *   candidatesOfRole   GET  /v1/candidates?role_id=  (called by getCandidates) the role's candidates in the board's shape
 *
 * ctx = { tenantId, personId, event }. The company and the person come from the sign-in, never from a request value.
 * Another company's role answers 404, the same as one that does not exist. Nothing here calls a model.
 */
import { randomUUID } from 'node:crypto';
import { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { json } from '../hr-group.mjs';
import { ownsRow, stampTenant, tenantFilter, tenantKey } from '../tenant.mjs';
import { isRecruiter } from '../recruitment-access.mjs';
import { DEFAULTS, activeSettings } from '../recruitment-settings.mjs';
import { normaliseStage } from '../recruitment-stages.mjs';

const db = new DynamoDBClient({});
const ROLES = () => process.env.ROLES_TABLE_NAME ?? 'talent-flow-roles';
const STATE = () => process.env.STATE_TABLE_NAME ?? 'talent-flow-state';
const IDEMPOTENCY = () => process.env.IDEMPOTENCY_TABLE_NAME ?? 'talent-flow-idempotency-keys';
const INDEX = 'role-id-index';
const KEY_TTL_SECONDS = 48 * 60 * 60;

const OPEN_STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
const SLA_WORDS = { ON_TRACK: 'ON_TRACK', AT_RISK: 'DUE_SOON', BREACHED: 'OVERDUE' };
const LIMITS = { title: 120, department: 80, criteria: 10, label: 60, panelMin: 1, panelMax: 12 };

const notFound = () => json(404, { error: 'Not found' });
const bad = (code, field) => json(400, { error: 'Bad request', code, ...(field ? { field } : {}) });
const badField = (field) => bad('INVALID_FIELD', field);

const roleKey = (tenantId, roleId) => ({ pk: `TENANT#${tenantId}`, sk: `ROLE#${roleId}` });
const isText = (v) => typeof v === 'string';
const filled = (v) => isText(v) && v.trim() !== '';

/** The stage code a stored candidate reads as (an old outcome is Not hired). */
const stageOf = (row) => normaliseStage(row) ?? 'APPLIED';
const slaOf = (row) => SLA_WORDS[row.slaStatus] ?? 'ON_TRACK';

/** Every candidate row of the company that carries this role id (every page of the index). */
async function rowsOfRole(tenantId, roleId) {
  const f = tenantFilter(tenantId);
  const out = [];
  let start;
  do {
    const page = await db.send(new QueryCommand({
      TableName: STATE(), IndexName: INDEX, KeyConditionExpression: '#role = :role',
      FilterExpression: f.FilterExpression,
      ExpressionAttributeNames: { '#role': 'role_id', ...f.ExpressionAttributeNames },
      ExpressionAttributeValues: marshall({ ':role': roleId, ...f.ExpressionAttributeValues }),
      ExclusiveStartKey: start,
    }));
    for (const item of page.Items ?? []) {
      const row = unmarshall(item);
      if (row.SK === 'SAGA' && ownsRow(row, tenantId)) out.push(row);
    }
    start = page.LastEvaluatedKey;
  } while (start);
  return out;
}

function countsOf(rows) {
  const open = rows.filter((r) => OPEN_STAGES.includes(stageOf(r)));
  return {
    candidate_count: open.length,
    overdue_count: open.filter((r) => slaOf(r) === 'OVERDUE').length,
    due_soon_count: open.filter((r) => slaOf(r) === 'DUE_SOON').length,
  };
}

const shapeRole = (row) => ({
  role_id: row.role_id, job_title: row.job_title, department: row.department, level: row.level, hiring_manager_id: row.hiring_manager_id,
  criteria: row.criteria ?? [], panel_size: row.panel_size, status: row.status, opened_at: row.opened_at, opened_by: row.opened_by,
  ...(row.closed_at ? { closed_at: row.closed_at, closed_by: row.closed_by } : {}), legacy: row.legacy === true,
});

/** A role the caller may see: the company's, and (for a manager who is not a Recruiter) one they are the hiring manager of. */
async function loadRole(ctx, roleId) {
  if (!filled(roleId)) return null;
  const got = await db.send(new GetItemCommand({ TableName: ROLES(), Key: marshall(roleKey(ctx.tenantId, roleId)), ConsistentRead: true }));
  const row = got.Item ? unmarshall(got.Item) : null;
  if (!row || !ownsRow(row, ctx.tenantId) || row.role_id !== roleId) return null;
  if (!isRecruiter(ctx.event) && row.hiring_manager_id !== ctx.personId) return null;
  return row;
}

/** GET /v1/roles */
export async function listRoles(ctx, query = {}) {
  const status = query.status;
  if (status !== undefined && status !== 'OPEN' && status !== 'CLOSED') return badField('status');
  const rows = [];
  let start;
  do {
    const page = await db.send(new QueryCommand({
      TableName: ROLES(), KeyConditionExpression: 'pk = :pk AND begins_with(sk, :role)',
      ExpressionAttributeValues: marshall({ ':pk': `TENANT#${ctx.tenantId}`, ':role': 'ROLE#' }), ExclusiveStartKey: start,
    }));
    for (const item of page.Items ?? []) {
      const row = unmarshall(item);
      if (ownsRow(row, ctx.tenantId)) rows.push(row);
    }
    start = page.LastEvaluatedKey;
  } while (start);
  const mine = isRecruiter(ctx.event) ? rows : rows.filter((r) => r.hiring_manager_id === ctx.personId);
  const shown = mine.filter((r) => !status || r.status === status).sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at)));
  const roles = [];
  for (const r of shown) roles.push({ ...shapeRole(r), ...countsOf(await rowsOfRole(ctx.tenantId, r.role_id)) });
  return json(200, { roles });
}

/** GET /v1/roles/{id} */
export async function getRole(ctx, roleId) {
  const row = await loadRole(ctx, roleId);
  if (!row) return notFound();
  return json(200, { ...shapeRole(row), ...countsOf(await rowsOfRole(ctx.tenantId, row.role_id)) });
}

// ---------------------------------------------------------------- open

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'criterion';

/** Criteria as sent (a list of { key, label } or of text) -> [{ key, label }], or null when not valid. */
function criteriaOf(value, defaults) {
  if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.criteria) return null;
  const out = [];
  for (const c of value) {
    let item;
    if (isText(c)) {
      const d = defaults.find((x) => x.key === c);
      item = d ? { key: d.key, label: d.label } : { key: slug(c), label: c.trim() };
      if (!d) { let k = item.key; let n = 2; while (out.some((x) => x.key === k)) k = `${item.key}-${n++}`; item.key = k; }
    } else if (c && typeof c === 'object' && !Array.isArray(c) && filled(c.key) && isText(c.label)) {
      item = { key: c.key, label: c.label.trim() };
    } else return null;
    if (!filled(item.label) || item.label.length > LIMITS.label) return null;
    if (out.some((x) => x.key === item.key)) return null;
    out.push(item);
  }
  return out;
}

/** True when this person is one the hiring manager picker lists for the company (D-REC-4.1): getHiringManagers' rule. */
async function isCompanyHiringManager(tenantId, personId) {
  if (!filled(personId)) return false;
  const [{ CognitoIdentityProviderClient, ListUsersInGroupCommand }, { HIRING_MANAGER_GROUPS }, { companyOfSignIn }] = await Promise.all([
    import('@aws-sdk/client-cognito-identity-provider'), import('../roles.mjs'), import('../membership.mjs'),
  ]);
  const cognito = new CognitoIdentityProviderClient({});
  const pool = process.env.HM_COGNITO_POOL_ID;
  if (!pool) throw new Error('Missing setting HM_COGNITO_POOL_ID');
  const groups = [...new Set([...(process.env.HM_GROUP_NAME ? [process.env.HM_GROUP_NAME] : []), ...HIRING_MANAGER_GROUPS])];
  let found = null;
  for (const group of groups) {
    let next;
    try {
      do {
        const page = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: pool, GroupName: group, NextToken: next }));
        for (const u of page.Users ?? []) {
          const sub = (u.Attributes ?? []).find((a) => a.Name === 'sub')?.Value;
          if (sub === personId) found = u;
        }
        next = page.NextToken;
      } while (next && !found);
    } catch (e) {
      if (e?.name !== 'ResourceNotFoundException') throw e;
    }
    if (found) break;
  }
  if (!found || found.UserStatus !== 'CONFIRMED' || found.Enabled === false) return false;
  return (await companyOfSignIn(personId)) === tenantId;
}

const keyOf = (ctx, clientKey) => tenantKey(ctx.tenantId, 'OPEN_ROLE', String(clientKey));
async function replayOf(key) {
  const got = await db.send(new GetItemCommand({ TableName: IDEMPOTENCY(), Key: marshall({ idempotencyKey: key }) }));
  const stored = got.Item ? unmarshall(got.Item) : null;
  return stored?.response ? JSON.parse(stored.response) : null;
}
async function remember(key, response) {
  await db.send(new PutItemCommand({
    TableName: IDEMPOTENCY(),
    Item: marshall({ idempotencyKey: key, response: JSON.stringify(response), expiresAt: Math.floor(Date.now() / 1000) + KEY_TTL_SECONDS }),
  }));
}

/** POST /v1/roles. body is the parsed body, or undefined when it was not JSON. */
export async function openRole(ctx, { body, idempotencyKey }) {
  if (!filled(idempotencyKey)) return bad('IDEMPOTENCY_KEY_REQUIRED');
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('INVALID_BODY');
  const key = keyOf(ctx, idempotencyKey);
  const replay = await replayOf(key);
  if (replay) return replay;

  const settings = await activeSettings(ctx.tenantId);
  const levels = (settings.SENIORITY_PROFILES?.levels ?? DEFAULTS.SENIORITY_PROFILES.levels).map((l) => l.key);
  const defaults = (settings.SCORING_WEIGHTS?.defaultCriteria ?? DEFAULTS.SCORING_WEIGHTS.defaultCriteria).map((c) => ({ key: c.key, label: c.label }));
  const panelOf = settings.PANEL_CONFIG?.panelSize ?? DEFAULTS.PANEL_CONFIG.panelSize;

  const { job_title: title, department, level, criteria, panel_size: panel, hiring_manager_id: hm } = body;
  if (!filled(title) || title.trim().length > LIMITS.title) return badField('job_title');
  if (!filled(department) || department.trim().length > LIMITS.department) return badField('department');
  if (!isText(level) || !levels.includes(level)) return badField('level');
  const crit = criteria === undefined ? defaults : criteriaOf(criteria, defaults);
  if (!crit) return badField('criteria');
  if (panel !== undefined && !(Number.isInteger(panel) && panel >= LIMITS.panelMin && panel <= LIMITS.panelMax)) return badField('panel_size');
  if (!isText(hm) || !(await isCompanyHiringManager(ctx.tenantId, hm))) return bad('INVALID_HIRING_MANAGER');

  const roleId = `role-${randomUUID()}`;
  const row = stampTenant({
    ...roleKey(ctx.tenantId, roleId), role_id: roleId, job_title: title.trim(), department: department.trim(), level, hiring_manager_id: hm,
    criteria: crit, panel_size: panel ?? panelOf[level] ?? DEFAULTS.PANEL_CONFIG.panelSize[level], status: 'OPEN',
    opened_at: new Date().toISOString(), opened_by: ctx.personId, legacy: false,
  }, ctx.tenantId);
  await db.send(new PutItemCommand({ TableName: ROLES(), Item: marshall(row), ConditionExpression: 'attribute_not_exists(pk)' }));
  const answer = json(201, { ...shapeRole(row), candidate_count: 0, overdue_count: 0, due_soon_count: 0 });
  await remember(key, answer);
  return answer;
}

/** POST /v1/roles/{id}/close */
export async function closeRole(ctx, roleId) {
  const row = await loadRole(ctx, roleId);
  if (!row) return notFound();
  if (row.status === 'CLOSED') return json(200, shapeRole(row));
  const open = countsOf(await rowsOfRole(ctx.tenantId, row.role_id)).candidate_count;
  if (open > 0) return json(409, { error: 'Conflict', code: 'OPEN_CANDIDATES', open_candidates: open });
  const at = new Date().toISOString();
  try {
    await db.send(new UpdateItemCommand({
      TableName: ROLES(), Key: marshall(roleKey(ctx.tenantId, row.role_id)),
      UpdateExpression: 'SET #s = :closed, closed_at = :at, closed_by = :by',
      ConditionExpression: 'tenant_id = :t AND #s = :open',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: marshall({ ':closed': 'CLOSED', ':open': 'OPEN', ':at': at, ':by': ctx.personId, ':t': ctx.tenantId }),
    }));
  } catch (e) {
    if (e.name !== 'ConditionalCheckFailedException') throw e;
    const now = await loadRole(ctx, roleId);
    return now ? json(200, shapeRole(now)) : notFound();
  }
  return json(200, shapeRole({ ...row, status: 'CLOSED', closed_at: at, closed_by: ctx.personId }));
}

// ---------------------------------------------------------------- the candidates of a role

const EMPTY = () => ({ candidates: [], counts: { all: 0, mine: 0, overdue: 0, due_soon: 0, not_hired: 0 } });

/** GET /v1/candidates?role_id= (D-T-9). A role that is not the company's is the same empty answer as no role at all. */
export async function candidatesOfRole(ctx, query = {}) {
  const roleId = query.role_id;
  const got = filled(roleId) ? await db.send(new GetItemCommand({ TableName: ROLES(), Key: marshall(roleKey(ctx.tenantId, roleId)) })) : {};
  const role = got.Item ? unmarshall(got.Item) : null;
  if (!role || !ownsRow(role, ctx.tenantId)) return json(200, EMPTY());
  let rows = await rowsOfRole(ctx.tenantId, roleId);
  if (!isRecruiter(ctx.event)) rows = rows.filter((r) => r.hiringManagerId === ctx.personId);
  const isMine = (r) => r.hiringManagerId === ctx.personId || r.recruiterId === ctx.personId;
  const shaped = rows.map((r) => ({
    row: r,
    c: {
      id: r.candidateId, name: [r.firstName, r.lastName].filter(Boolean).join(' '), stage: stageOf(r), role_id: r.role_id, level: r.positionLevel,
      sla_status: slaOf(r), stage_entered_at: r.stageEnteredAt ?? r.createdAt, hiring_manager_id: r.hiringManagerId,
    },
  }));
  const live = shaped.filter((x) => x.c.stage !== 'NOT_HIRED');
  const counts = {
    all: live.length, mine: live.filter((x) => isMine(x.row)).length,
    overdue: live.filter((x) => x.c.sla_status === 'OVERDUE').length, due_soon: live.filter((x) => x.c.sla_status === 'DUE_SOON').length,
    not_hired: shaped.length - live.length,
  };
  let list = query.stage === 'NOT_HIRED' ? shaped.filter((x) => x.c.stage === 'NOT_HIRED') : live;
  if (query.stage && query.stage !== 'NOT_HIRED') list = list.filter((x) => x.c.stage === query.stage);
  if (query.sla_status) list = list.filter((x) => x.c.sla_status === query.sla_status);
  if (filled(query.search)) { const s = query.search.trim().toLowerCase(); list = list.filter((x) => x.c.name.toLowerCase().includes(s)); }
  if (query.mine === 'true') list = list.filter((x) => isMine(x.row));
  const limit = Math.min(Math.max(parseInt(query.limit ?? '100', 10) || 100, 1), 100);
  const candidates = list.map((x) => x.c).sort((a, b) => String(a.stage_entered_at).localeCompare(String(b.stage_entered_at))).slice(0, limit);
  return json(200, { candidates, counts });
}
