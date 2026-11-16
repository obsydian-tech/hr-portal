// ONB-18: copied from ../../onb-04.2/fake-aws unchanged, plus world.postmarkFail (postmark.mjs).
// Copied from ../../onb-03/fake-aws (ONB-03 lock). ONB-04 adds the employee_invites table (key token_hash, index
// employee-index on employee_id) and the idempotency table under its Terraform name. ONB-03 added: the talent-flow-users table, the two
// secondary indexes cognitoPostAuth reads (world.index can give an index a view of its own, older than the
// table, as a GSI can be), and world.fail: calls that fail as DynamoDB would when it is unavailable.
// The fake world, read from the file named by ONB04_WORLD: the tables (row by row, as DynamoDB stores
// them), the S3 objects, what Textract reads and what the model answers. Every call any fake answers is
// recorded in `calls`; run.mjs hands the tables back after the handler, so the next run sees its writes.
import { readFileSync } from 'node:fs';
export const world = JSON.parse(readFileSync(process.env.ONB04_WORLD, 'utf8'));
world.tables ??= {};
world.cognito ??= { users: [] };
export const calls = [];
export const KEYS = {
  employees: ['employee_id'],
  'idempotency-keys': ['idempotencyKey'],
  documents: ['employee_id', 'document_id'],
  'document-verification': ['verificationId'],
  'talent-flow-users': ['PK', 'SK'],
  employee_invites: ['token_hash'],
};
/** Secondary indexes: table -> index name -> its key attribute. */
export const INDEXES = {
  employees: { 'email-index': 'email', 'created_by-index': 'created_by' },
  'talent-flow-users': { EmailIndex: 'GSI1PK' },
  employee_invites: { 'employee-index': 'employee_id' },
};
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
