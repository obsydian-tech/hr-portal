/**
 * REC-15 step A: the one candidate list (GET /v1/candidates, with or without role_id). The handler has run the role check, requireTenant
 * and requireModule. ctx = { tenantId, personId, event }.
 */
import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { json } from '../hr-group.mjs';
import { ownsRow, tenantFilter, tenantKey } from '../tenant.mjs';
import { isRecruiter } from '../recruitment-access.mjs';
import { normaliseStage } from '../recruitment-stages.mjs';
import { enteredAt, stageClock, thresholdsOf } from './stage-clock.mjs';

const db = new DynamoDBClient({});
const ROLES = () => process.env.ROLES_TABLE_NAME ?? 'talent-flow-roles';
const STATE = () => process.env.STATE_TABLE_NAME ?? 'talent-flow-state';
const STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'NOT_HIRED'];
const SLA = ['ON_TRACK', 'DUE_SOON', 'OVERDUE'];
const MAX_ROWS = 5000;
const EMPTY = () => ({ candidates: [], counts: { all: 0, mine: 0, overdue: 0, due_soon: 0, not_hired: 0 } });
const badField = (field) => json(400, { error: 'Bad request', code: 'INVALID_FIELD', field });

/** Every candidate row of the company that carries this role id (every page of the index). */
export async function rowsOfRole(tenantId, roleId) {
  const f = tenantFilter(tenantId);
  const out = [];
  let start;
  do {
    const page = await db.send(new QueryCommand({
      TableName: STATE(), IndexName: 'role-id-index', KeyConditionExpression: '#role = :role',
      FilterExpression: f.FilterExpression, ExpressionAttributeNames: { '#role': 'role_id', ...f.ExpressionAttributeNames },
      ExpressionAttributeValues: marshall({ ':role': roleId, ...f.ExpressionAttributeValues }), ExclusiveStartKey: start,
    }));
    for (const item of page.Items ?? []) {
      const row = unmarshall(item);
      if (row.SK === 'SAGA' && ownsRow(row, tenantId)) out.push(row);
    }
    start = page.LastEvaluatedKey;
  } while (start);
  return out;
}

async function rowsOfCompany(tenantId) {
  const out = [];
  let start;
  do {
    const page = await db.send(new QueryCommand({
      TableName: STATE(), IndexName: 'GSI1', KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :saga)',
      ExpressionAttributeValues: marshall({ ':pk': tenantKey(tenantId), ':saga': 'SAGA#' }), ExclusiveStartKey: start,
    }));
    for (const item of page.Items ?? []) {
      const row = unmarshall(item);
      if (row.SK === 'SAGA' && ownsRow(row, tenantId)) out.push(row);
    }
    start = page.LastEvaluatedKey;
  } while (start);
  return out;
}

async function roleOf(tenantId, roleId) {
  const got = await db.send(new GetItemCommand({ TableName: ROLES(), Key: marshall({ pk: `TENANT#${tenantId}`, sk: `ROLE#${roleId}` }) }));
  const row = got.Item ? unmarshall(got.Item) : null;
  return row && ownsRow(row, tenantId) && row.role_id === roleId ? row : null;
}

function readToken(text) {
  try {
    const t = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    if (!t || typeof t !== 'object' || Array.isArray(t) || t.v !== 1 || ![0, 1, 2].includes(t.g) || typeof t.s !== 'number' || !Number.isFinite(t.s) || typeof t.i !== 'string' || !t.i) return null;
    return t;
  } catch { return null; }
}
const writeToken = (p) => Buffer.from(JSON.stringify({ v: 1, g: p[0], s: p[1], i: p[2] })).toString('base64url');
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);

/** Checks the query (rule 3). Answers a 400 or the read values. */
function readQuery(q) {
  const out = {};
  if (q.stage !== undefined) { if (!STAGES.includes(q.stage)) return { bad: badField('stage') }; out.stage = q.stage; }
  if (q.sla_status !== undefined) { if (!SLA.includes(q.sla_status)) return { bad: badField('sla_status') }; out.sla = q.sla_status; }
  if (q.search !== undefined) { const s = String(q.search).trim(); if (s.length < 1 || s.length > 100) return { bad: badField('search') }; out.search = s.toLowerCase(); }
  out.limit = 100;
  if (q.limit !== undefined) { if (!/^\d+$/.test(q.limit) || +q.limit < 1 || +q.limit > 100) return { bad: badField('limit') }; out.limit = +q.limit; }
  if (q.nextToken !== undefined) { const t = readToken(q.nextToken); if (!t) return { bad: badField('nextToken') }; out.after = [t.g, t.s, t.i]; }
  if (q.mine !== undefined && q.mine !== 'true') return { bad: badField('mine') };
  out.mine = q.mine === 'true';
  out.roleId = typeof q.role_id === 'string' && q.role_id !== '' ? q.role_id : undefined;
  return out;
}

/** REC-UI-01.6 rule 1: who a waiting Not hired decision waits on, and nothing else of it (never by, reason_code, at or note). */
function pendingOf(p) {
  if (p === undefined || p === null) return null;
  const a = p && typeof p === 'object' ? p.awaiting : undefined;
  if (a && typeof a === 'object' && a.kind === 'HIRING_MANAGER' && typeof a.personId === 'string' && a.personId) return { awaiting: { kind: 'HIRING_MANAGER', personId: a.personId } };
  return { awaiting: { kind: 'HR' } };
}

/** GET /v1/candidates */
export async function listCandidates(ctx, query = {}) {
  const q = readQuery(query);
  if (q.bad) return q.bad;
  let rows;
  if (q.roleId) {
    const r = await roleOf(ctx.tenantId, q.roleId);
    if (!r) return json(200, EMPTY());
    rows = await rowsOfRole(ctx.tenantId, q.roleId);
  } else rows = await rowsOfCompany(ctx.tenantId);
  if (rows.length > MAX_ROWS) {
    console.warn('candidate list too large', { rows: rows.length });
    return json(500, { error: 'Something went wrong', code: 'LIST_TOO_LARGE' });
  }
  if (!isRecruiter(ctx.event)) rows = rows.filter((r) => r.hiringManagerId === ctx.personId);
  const thresholds = await thresholdsOf(ctx.tenantId);
  const titles = new Map();
  await Promise.all([...new Set(rows.map((r) => r.role_id).filter((x) => typeof x === 'string' && x))].map(async (id) => titles.set(id, (await roleOf(ctx.tenantId, id))?.job_title)));
  const now = Date.now();
  const shaped = rows.map((r) => {
    const { due_at, sla_status } = stageClock(r, thresholds, now);
    const stage = normaliseStage(r) ?? 'APPLIED';
    const c = {
      id: r.candidateId, name: [r.firstName, r.lastName].filter(Boolean).join(' '), stage,
      stage_entered_at: enteredAt(r, stage), due_at, sla_status, role_id: r.role_id ?? null,
      role_title: (r.role_id && titles.get(r.role_id)) || r.positionTitle || null, level: r.positionLevel ?? null, ...(r.source !== undefined ? { source: r.source } : {}),
      applied_at: r.appliedDate ?? r.createdAt ?? null, hiring_manager_id: r.hiringManagerId ?? null, mine: r.hiringManagerId === ctx.personId || r.added_by === ctx.personId,
      not_hired_pending: pendingOf(r.not_hired_pending),
    };
    const pos = sla_status === null ? [2, -(Date.parse(c.stage_entered_at) || 0), c.id] : due_at === null ? [1, 0, c.id] : [0, Date.parse(due_at), c.id];
    return { c, pos, email: String(r.email ?? '').toLowerCase() };
  });
  const live = shaped.filter((x) => x.c.stage !== 'NOT_HIRED');
  const counts = {
    all: live.length, mine: live.filter((x) => x.c.mine).length, overdue: live.filter((x) => x.c.sla_status === 'OVERDUE').length,
    due_soon: live.filter((x) => x.c.sla_status === 'DUE_SOON').length, not_hired: shaped.length - live.length,
  };
  let set = q.stage === 'NOT_HIRED' ? shaped.filter((x) => x.c.stage === 'NOT_HIRED') : live;
  if (q.stage && q.stage !== 'NOT_HIRED') set = set.filter((x) => x.c.stage === q.stage);
  if (q.sla) set = set.filter((x) => x.c.sla_status === q.sla);
  if (q.mine) set = set.filter((x) => x.c.mine);
  if (q.search) set = set.filter((x) => x.c.name.toLowerCase().includes(q.search) || x.email.includes(q.search) || String(x.c.role_title ?? '').toLowerCase().includes(q.search));
  set.sort((a, b) => cmp(a.pos, b.pos));
  if (q.after) set = set.filter((x) => cmp(x.pos, q.after) > 0);
  const page = set.slice(0, q.limit);
  const body = { candidates: page.map((x) => x.c), counts };
  if (set.length > q.limit) body.nextToken = writeToken(page[page.length - 1].pos);
  return json(200, body);
}
