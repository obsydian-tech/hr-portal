// Copied from ../../onb-07/fake-aws (ONB-07 lock). PII-01 adds: the talent-flow-users table, the two
// secondary indexes cognitoPostAuth reads (world.index can give an index a view of its own, older than the
// table, as a GSI can be), and world.fail: calls that fail as DynamoDB would when it is unavailable.
// The fake world, read from the file named by PII01_WORLD: the tables (row by row, as DynamoDB stores
// them), the S3 objects, what Textract reads and what the model answers. Every call any fake answers is
// recorded in `calls`; run.mjs hands the tables back after the handler, so the next run sees its writes.
import { readFileSync } from 'node:fs';
export const world = JSON.parse(readFileSync(process.env.PII01_WORLD, 'utf8'));
world.tables ??= {};
export const calls = [];
export const KEYS = {
  employees: ['employee_id'],
  documents: ['employee_id', 'document_id'],
  'document-verification': ['verificationId'],
  'talent-flow-users': ['PK', 'SK'],
};
/** Secondary indexes: table -> index name -> its key attribute. */
export const INDEXES = {
  employees: { 'email-index': 'email', 'created_by-index': 'created_by' },
  'talent-flow-users': { EmailIndex: 'GSI1PK' },
  // PII-01: the index classifyOnboardingRisk reads a person's verifications through.
  'document-verification': { 'employeeId-index': 'employeeId' },
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
