/**
 * REC-14 rule 7: the company's department list, the one reader every Lambda uses.
 *
 * One row per company in the tenants table: pk TENANT#<id>, sk DEPARTMENTS, { tenant_id, version, departments: [{ id, name,
 * status }], updated_at, updated_by }. Nothing else reads or writes that row. A company with no row has version 0 and no
 * departments. A department id is dep_<ulid> and never changes; a name is 1 to 80 characters after trimming and joining inner
 * spaces, unique in the company ignoring case (archived ones too); status is ACTIVE or ARCHIVED. At most 200 per company.
 */
import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { randomBytes } from 'node:crypto';

export const LIST_SK = 'DEPARTMENTS';
export const AUDIT_PREFIX = 'DEPARTMENTS#';
export const MAX_DEPARTMENTS = 200;
export const MAX_NAME = 80;
export const STATUSES = ['ACTIVE', 'ARCHIVED'];
export const DEPARTMENT_ID = /^dep_[0-9A-HJKMNP-TV-Z]{26}$/;

let shared;
const clientOf = (client) => client ?? (shared ??= new DynamoDBClient({}));

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function ulid(now = Date.now()) {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) { time = CROCKFORD[t % 32] + time; t = Math.floor(t / 32); }
  const bytes = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += CROCKFORD[bytes[i] % 32];
  return time + rand;
}
export const newDepartmentId = () => `dep_${ulid()}`;

/** The key of a company's list row. */
export const listKey = (tenantId) => ({ pk: { S: `TENANT#${tenantId}` }, sk: { S: LIST_SK } });

/** The name as stored and compared: trimmed, every run of spaces one space. null when it is not text. */
export function normaliseName(name) {
  if (typeof name !== 'string') return null;
  return name.trim().replace(/\s+/g, ' ');
}
/** The normalised name when it is a good one (1 to 80 characters), else null. */
export function validName(name) {
  const n = normaliseName(name);
  return n && n.length <= MAX_NAME ? n : null;
}
export const sameName = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/** A stored row read back: { exists, version, departments }. */
export function listOfItem(item) {
  if (!item) return { exists: false, version: 0, departments: [] };
  const deps = (item.departments?.L ?? []).map((d) => ({ id: d.M?.id?.S, name: d.M?.name?.S, status: d.M?.status?.S }))
    .filter((d) => typeof d.id === 'string' && typeof d.name === 'string' && STATUSES.includes(d.status));
  return { exists: true, version: Number(item.version?.N ?? 0), departments: deps };
}

/** The company's list, read with one consistent GetItem. */
export async function departmentsOf(tenantId, { client, table = process.env.TENANTS_TABLE } = {}) {
  const res = await clientOf(client).send(new GetItemCommand({ TableName: table, Key: listKey(tenantId), ConsistentRead: true }));
  return listOfItem(res.Item);
}

/** One active department of the company by id, or null (archived, another company's or made up). */
export async function activeDepartment(tenantId, id, options = {}) {
  if (typeof id !== 'string' || !DEPARTMENT_ID.test(id)) return null;
  const { departments } = await departmentsOf(tenantId, options);
  return departments.find((d) => d.id === id && d.status === 'ACTIVE') ?? null;
}

/** Sorted by name, ignoring case. */
export const byName = (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());
export const shape = (d) => ({ id: d.id, name: d.name, status: d.status });

/** The list row as DynamoDB stores it. */
export function listItem(tenantId, version, departments, at, by) {
  return {
    ...listKey(tenantId),
    tenant_id: { S: tenantId },
    version: { N: String(version) },
    departments: { L: departments.map((d) => ({ M: { id: { S: d.id }, name: { S: d.name }, status: { S: d.status } } })) },
    updated_at: { S: at },
    updated_by: { S: by },
  };
}
