// The fake tables, read from the file named by ONB13_WORLD, and the record of every call.
// world.pageSize caps how many rows one Scan page holds, as DynamoDB's 1 MB page does.
import { readFileSync } from 'node:fs';
export const world = JSON.parse(readFileSync(process.env.ONB13_WORLD, 'utf8'));
export const calls = [];
export const KEYS = { employees: ['employee_id'], documents: ['employee_id', 'document_id'], 'document-verification': ['verificationId'] };
export function table(name) {
  const t = world.tables[name];
  if (!t) throw new Error(`fake DynamoDB: no table ${name}`);
  return { rows: t, keys: KEYS[name] };
}
