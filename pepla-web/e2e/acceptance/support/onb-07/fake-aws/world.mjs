// The fake world, read from the file named by ONB07_WORLD: the tables (row by row, as DynamoDB stores
// them), the S3 objects, what Textract reads and what the model answers. Every call any fake answers is
// recorded in `calls`; run.mjs hands the tables back after the handler, so the next run sees its writes.
import { readFileSync } from 'node:fs';
export const world = JSON.parse(readFileSync(process.env.ONB07_WORLD, 'utf8'));
world.tables ??= {};
export const calls = [];
export const KEYS = {
  employees: ['employee_id'],
  documents: ['employee_id', 'document_id'],
  'document-verification': ['verificationId'],
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
