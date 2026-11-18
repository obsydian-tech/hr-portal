// ONB-21: copied from ../../ten-02/fake-aws (TEN-02 lock) and cut down; the world file is named by ONB21_WORLD.
// The fake world: the tables (row by row, as DynamoDB stores them, AttributeValue form), the clock, the Postmark
// failures. Every call any fake answers is recorded in `calls`; run.mjs hands the tables back after the handler.
import { readFileSync } from 'node:fs';
export const world = JSON.parse(readFileSync(process.env.ONB21_WORLD, 'utf8'));
world.tables ??= {};
export const calls = [];
export const KEYS = {
  employees: ['employee_id'],
  documents: ['employee_id', 'document_id'],
  // TEN-01: the company list (pk TENANT#<id> or USER#<sub> or MIGRATE#<email>, sk PROFILE or TENANT#<id>).
  'naleko-people-dev-tenants': ['pk', 'sk'],
  // ONB-21: the claims table (infra/reminders.tf): one hash key.
  'naleko-people-dev-reminders': ['pk'],
};
/** The tables that have a tenant-index in Terraform (infra/dynamodb.tf). The tenants and reminders tables have none. */
export const TENANT_INDEX_TABLES = ['employees', 'documents'];
export const INDEXES = { 'tenant-index': ['tenant_id'], 'email-index': ['email'] };

export function table(name) {
  const t = world.tables[name];
  if (!t) throw new Error(`fake DynamoDB: no table ${name}`);
  return { rows: t, keys: KEYS[name] ?? (() => { throw new Error(`fake DynamoDB: no key for table ${name}`); })() };
}
export function awsError(name, message) {
  const e = new Error(message ?? name);
  e.name = name;
  e.$fault = 'client';
  e.$metadata = { httpStatusCode: 400 };
  return e;
}
/**
 * world.failFor = { table, ops?: [...], company?: "<id>" } makes a matching DynamoDB call throw (after it is recorded).
 * With `company`, only a call whose expression values hold that company id fails, so one company's read can fail alone.
 */
export function failIfAsked(op, tableName, input = {}) {
  const f = world.failFor;
  if (!f || f.table !== tableName) return;
  if (Array.isArray(f.ops) && !f.ops.includes(op)) return;
  if (f.company && !Object.values(input.ExpressionAttributeValues ?? {}).some((v) => v && v.S === f.company)) return;
  const e = new Error('The service is unavailable');
  e.name = 'ServiceUnavailable';
  e.$fault = 'server';
  e.$metadata = { httpStatusCode: 503 };
  throw e;
}
