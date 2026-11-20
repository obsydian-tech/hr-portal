// The fake world, read from the file named by ONB14_WORLD (copied from ../../onb-15/fake-aws): the tables (row by row, as
// DynamoDB stores them), how the bus and the key behave (`bus`, `key`), and the S3 objects. Every call any fake answers is
// recorded in `calls`, in the order it happened; run.mjs hands the tables back after the handler, so the next run sees its writes.
import { readFileSync } from 'node:fs';
export const world = JSON.parse(readFileSync(process.env.ONB14_WORLD, 'utf8'));
world.tables ??= {};
world.bus ??= 'ok';
world.key ??= 'ok';
export const calls = [];
export const KEYS = {
  employees: ['employee_id'],
  documents: ['employee_id', 'document_id'],
  'document-verification': ['verificationId'],
  'onboarding-events': ['eventId', 'timestamp'],
  'naleko-idempotency': ['idempotencyKey'],
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
