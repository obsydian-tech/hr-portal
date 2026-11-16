// ONB-05 (from ../../onb-04/fake-aws, ONB-04 lock): the fake world, read from the file named by ONB05_WORLD:
// the tables row by row, as DynamoDB stores them. Every call any fake answers is recorded in `calls`;
// run.mjs hands the tables back after the handler, so the next run sees its writes.
// ONB-05 adds the employee_consents table (hash key employee_id, range key notice_version).
import { readFileSync } from 'node:fs';
export const world = JSON.parse(readFileSync(process.env.ONB05_WORLD, 'utf8'));
world.tables ??= {};
export const calls = [];
export const KEYS = {
  employees: ['employee_id'],
  employee_consents: ['employee_id', 'notice_version'],
  documents: ['employee_id', 'document_id'],
};
/** Secondary indexes: table -> index name -> its key attribute. */
export const INDEXES = {
  employees: { 'email-index': 'email', 'created_by-index': 'created_by' },
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
