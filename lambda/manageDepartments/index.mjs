/**
 * REC-14 step A: the company's department list.
 *   GET   /v1/company/departments                HR staff, Admin, Recruiter. ?include=archived adds archived ones, for an Admin only.
 *   POST  /v1/admin/company/departments          Admin. { name }, Idempotency-Key.
 *   PATCH /v1/admin/company/departments/{id}     Admin. { name?, status?, expected_version }.
 *
 * Order: the role check (403, no AWS call), then requireTenant (403), then the work. No module check: departments belong to the
 * whole company. The company is the sign-in's; nothing in the body, query, path or headers names it, and fields the routes do
 * not take are ignored. Every write is one transaction: the list row (conditional on the version read, or on there being no
 * row yet), one audit row per change (sk DEPARTMENTS#<time>#<ulid>) and, on the POST, the Idempotency-Key row (sk
 * DEPARTMENTS#KEY#<hash>). The only keys this Lambda builds are its own company's DEPARTMENTS and DEPARTMENTS#... rows.
 * The POST reads again and tries once more on a version clash; the PATCH answers STALE_VERSION. A change that changes
 * nothing writes nothing. Errors log their name only.
 */
import { DynamoDBClient, GetItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { createHash } from 'node:crypto';
import { json } from '../shared/hr-group.mjs';
import { requireTenant } from '../shared/tenant.mjs';
import { isAdmin, isRecruiter } from '../shared/recruitment-access.mjs';
import { holds } from '../shared/roles.mjs';
import {
  AUDIT_PREFIX, DEPARTMENT_ID, MAX_DEPARTMENTS, STATUSES, byName, departmentsOf, listItem, newDepartmentId, sameName, shape, ulid, validName,
} from '../shared/departments.mjs';

const dynamo = new DynamoDBClient({});
const ROUTES = {
  list: 'GET /v1/company/departments',
  add: 'POST /v1/admin/company/departments',
  change: 'PATCH /v1/admin/company/departments/{id}',
};
const forbidden = () => json(403, { error: 'Forbidden' });
const badField = (field) => json(400, { error: 'Bad request', code: 'INVALID_FIELD', field });
const conflict = (code) => json(409, { error: 'Conflict', code });
const notFound = () => json(404, { error: 'Not found' });

class Clash extends Error { constructor() { super('Version clash'); this.name = 'Clash'; } }

const table = () => process.env.TENANTS_TABLE;
const subOf = (event) => String(event?.requestContext?.authorizer?.jwt?.claims?.sub ?? '');
const mayRead = (event) => holds(event, { roles: ['admin', 'hr_staff'] }) || isRecruiter(event);
const header = (event, name) => {
  const h = event?.headers ?? {};
  const k = Object.keys(h).find((x) => x.toLowerCase() === name);
  return k === undefined ? undefined : h[k];
};
function bodyOf(event) {
  let raw = event?.body ?? '';
  if (event?.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  try {
    const b = JSON.parse(raw);
    return b !== null && typeof b === 'object' && !Array.isArray(b) ? b : undefined;
  } catch {
    return undefined;
  }
}
const routeOf = (event) => event?.routeKey ?? `${event?.requestContext?.http?.method} ${event?.rawPath}`;

/** Writes the list and its audit rows in one transaction; a failed version condition is a Clash. */
async function save({ tenantId, read, departments, audits, by, extra = [] }) {
  const at = new Date();
  const iso = at.toISOString();
  const version = read.version + 1;
  const list = {
    Put: {
      TableName: table(),
      Item: listItem(tenantId, version, departments, iso, by),
      ...(read.exists
        ? { ConditionExpression: '#version = :read', ExpressionAttributeNames: { '#version': 'version' }, ExpressionAttributeValues: { ':read': { N: String(read.version) } } }
        : { ConditionExpression: 'attribute_not_exists(sk)' }),
    },
  };
  const rows = audits.map((a) => ({
    Put: {
      TableName: table(),
      Item: {
        pk: { S: `TENANT#${tenantId}` },
        sk: { S: `${AUDIT_PREFIX}${iso}#${ulid(at.getTime())}` },
        tenant_id: { S: tenantId },
        action: { S: a.action },
        department_id: { S: a.department_id },
        ...(a.from !== undefined ? { from: { S: a.from } } : {}),
        ...(a.to !== undefined ? { to: { S: a.to } } : {}),
        by: { S: by },
        at: { S: iso },
      },
      ConditionExpression: 'attribute_not_exists(sk)',
    },
  }));
  try {
    await dynamo.send(new TransactWriteItemsCommand({ TransactItems: [list, ...rows, ...extra.map((x) => x(iso))] }));
  } catch (err) {
    if (err?.name === 'TransactionCanceledException' && /ConditionalCheckFailed/.test(String(err?.message ?? ''))) throw new Clash();
    throw err;
  }
  return version;
}

async function list(event, tenantId) {
  const { version, departments } = await departmentsOf(tenantId, { client: dynamo, table: table() });
  const all = event?.queryStringParameters?.include === 'archived' && isAdmin(event);
  return json(200, { version, departments: departments.filter((d) => all || d.status === 'ACTIVE').map(shape).sort(byName) });
}

async function add(event, tenantId) {
  const body = bodyOf(event);
  if (!body) return json(400, { error: 'Bad request', code: 'INVALID_FIELD', field: 'name' });
  const name = validName(body.name);
  if (!name) return badField('name');
  const key = String(header(event, 'idempotency-key') ?? '').trim();
  if (!key) return json(400, { error: 'Bad request', code: 'IDEMPOTENCY_KEY_REQUIRED' });
  const keySk = `${AUDIT_PREFIX}KEY#${createHash('sha256').update(key).digest('hex')}`;
  const seen = await dynamo.send(new GetItemCommand({ TableName: table(), Key: { pk: { S: `TENANT#${tenantId}` }, sk: { S: keySk } }, ConsistentRead: true }));
  if (seen.Item?.status_code?.N && seen.Item?.answer?.S) return json(Number(seen.Item.status_code.N), JSON.parse(seen.Item.answer.S));

  const by = subOf(event);
  for (let attempt = 0; attempt < 2; attempt++) {
    const read = await departmentsOf(tenantId, { client: dynamo, table: table() });
    if (read.departments.some((d) => sameName(d.name, name))) return conflict('DUPLICATE_NAME');
    if (read.departments.length >= MAX_DEPARTMENTS) return conflict('TOO_MANY_DEPARTMENTS');
    const department = { id: newDepartmentId(), name, status: 'ACTIVE' };
    const answer = { version: read.version + 1, department };
    const keyRow = (iso) => ({
      Put: {
        TableName: table(),
        Item: { pk: { S: `TENANT#${tenantId}` }, sk: { S: keySk }, tenant_id: { S: tenantId }, status_code: { N: '201' }, answer: { S: JSON.stringify(answer) }, at: { S: iso } },
        ConditionExpression: 'attribute_not_exists(sk)',
      },
    });
    try {
      await save({ tenantId, read, departments: [...read.departments, department], audits: [{ action: 'ADD', department_id: department.id }], by, extra: [keyRow] });
      return json(201, answer);
    } catch (err) {
      if (!(err instanceof Clash)) throw err;
    }
  }
  return conflict('STALE_VERSION');
}

async function change(event, tenantId) {
  const id = event?.pathParameters?.id;
  const body = bodyOf(event);
  if (!body) return json(400, { error: 'Bad request', code: 'INVALID_FIELD', field: 'expected_version' });
  const expected = body.expected_version;
  if (typeof expected !== 'number' || !Number.isInteger(expected)) return badField('expected_version');
  let name;
  if (body.name !== undefined) {
    name = validName(body.name);
    if (!name) return badField('name');
  }
  const status = body.status;
  if (status !== undefined && !STATUSES.includes(status)) return badField('status');
  if (name === undefined && status === undefined) return badField('name');

  if (typeof id !== 'string' || !DEPARTMENT_ID.test(id)) return notFound();
  const read = await departmentsOf(tenantId, { client: dynamo, table: table() });
  const current = read.departments.find((d) => d.id === id);
  if (!current) return notFound();
  if (expected !== read.version) return conflict('STALE_VERSION');
  if (name !== undefined && read.departments.some((d) => d.id !== id && sameName(d.name, name))) return conflict('DUPLICATE_NAME');

  const next = { ...current, ...(name !== undefined ? { name } : {}), ...(status !== undefined ? { status } : {}) };
  const audits = [];
  if (next.name !== current.name) audits.push({ action: 'RENAME', department_id: id, from: current.name, to: next.name });
  if (next.status !== current.status) audits.push({ action: next.status === 'ARCHIVED' ? 'ARCHIVE' : 'RESTORE', department_id: id });
  if (audits.length === 0) return json(200, { version: read.version, department: shape(current) });
  try {
    const version = await save({ tenantId, read, departments: read.departments.map((d) => (d.id === id ? next : d)), audits, by: subOf(event) });
    return json(200, { version, department: shape(next) });
  } catch (err) {
    if (err instanceof Clash) return conflict('STALE_VERSION');
    throw err;
  }
}

export const handler = async (event) => {
  try {
    const route = routeOf(event);
    if (route === ROUTES.list) {
      if (!mayRead(event)) return forbidden();
      const { tenantId, refusal } = requireTenant(event);
      if (refusal) return refusal;
      return await list(event, tenantId);
    }
    if (route === ROUTES.add || route === ROUTES.change) {
      if (!isAdmin(event)) return forbidden();
      const { tenantId, refusal } = requireTenant(event);
      if (refusal) return refusal;
      return route === ROUTES.add ? await add(event, tenantId) : await change(event, tenantId);
    }
    return notFound();
  } catch (err) {
    console.error('Departments request failed', { error: err?.name ?? 'Error' });
    return json(500, { error: 'Something went wrong' });
  }
};
