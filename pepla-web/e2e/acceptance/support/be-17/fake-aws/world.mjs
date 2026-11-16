// BE-17: copied from ../../onb-15/fake-aws (ONB-15 lock); the world file is named by BE17_WORLD.
// The fake world, read from the file named by BE17_WORLD (copied from ../../onb-07/fake-aws): the tables (row by row, as
// DynamoDB stores them) and the S3 objects. Every call any fake answers is
// recorded in `calls`; run.mjs hands the tables back after the handler, so the next run sees its writes.
import { readFileSync } from 'node:fs';
export const world = JSON.parse(readFileSync(process.env.BE17_WORLD, 'utf8'));
world.tables ??= {};
export const calls = [];
export const KEYS = {
  employees: ['employee_id'],
  documents: ['employee_id', 'document_id'],
  'document-verification': ['verificationId'],
  // BE-17: the other tables the nine routes touch.
  'external-verification-requests': ['request_id'],
  'talent-flow-pending-actions': ['actionId'],
  NalekoAiRateLimit: ['pk'],
  'naleko-agent-audit': ['pk', 'sk'],
  'naleko-prompt-cache': ['pk'],
  'naleko-pending-actions': ['actionId'],
};

/**
 * BE-17: global secondary indexes the routes query (index name -> its key attributes). A Query on an
 * index matches its KeyConditionExpression against every row of the table, as DynamoDB does.
 */
export const INDEXES = {
  'employeeId-index': ['employeeId'],
  'email-index': ['email'],
  'created_by-index': ['created_by'],
};

/**
 * BE-17: world.fail = { service, ops?, message } makes every matching call throw an Error with that
 * message (after it is recorded), so a test can see whether an exception's words reach the answer.
 */
export function failIfAsked(service, op) {
  const f = world.fail;
  if (!f || f.service !== service) return;
  if (Array.isArray(f.ops) && !f.ops.includes(op)) return;
  const e = new Error(f.message);
  e.name = f.name ?? 'InternalServerError';
  e.$fault = 'server';
  e.$metadata = { httpStatusCode: 500 };
  throw e;
}
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
