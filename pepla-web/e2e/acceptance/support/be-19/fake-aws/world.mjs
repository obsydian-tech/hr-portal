// BE-19: copied from ../../be-18/fake-aws (BE-18 lock), unchanged.
// BE-18: copied from ../../be-17.1/fake-aws (BE-17.1 lock), with code added only (see BE-18 notes in this file).
// BE-17.1: copied from ../../be-17/fake-aws (BE-17 lock); Talent Flow chat's tables added to KEYS.
// BE-17: copied from ../../onb-15/fake-aws (ONB-15 lock); the world file is named by BE17_WORLD.
// The fake world, read from the file named by BE17_WORLD (copied from ../../onb-07/fake-aws): the tables (row by row, as
// DynamoDB stores them) and the S3 objects. Every call any fake answers is
// recorded in `calls`; run.mjs hands the tables back after the handler, so the next run sees its writes.
import { readFileSync } from 'node:fs';
export const world = JSON.parse(readFileSync(process.env.BE17_WORLD, 'utf8'));
world.tables ??= {};
export const calls = [];
export const KEYS = {
  // MOD-01 (re-locked by acceptance-lock/mod-01): the company list, read by the module check.
  'naleko-people-dev-tenants': ['pk', 'sk'],
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
  // BE-17.1: Talent Flow chat's tables (the rate limit, the audit and the prompt cache).
  'talent-flow-ai-rate-limit': ['pk'],
  'talent-flow-agent-audit': ['pk', 'sk'],
  'talent-flow-prompt-cache': ['pk'],
  // BE-18: ONB-05's consents, ONB-04's invites, and the Talent Flow users table cognitoPostAuth reads.
  employee_consents: ['employee_id', 'notice_version'],
  employee_invites: ['token_hash'],
  'talent-flow-users': ['PK', 'SK'],
};

/**
 * BE-17: global secondary indexes the routes query (index name -> its key attributes). A Query on an
 * index matches its KeyConditionExpression against every row of the table, as DynamoDB does.
 */
export const INDEXES = {
  'employeeId-index': ['employeeId'],
  'email-index': ['email'],
  'created_by-index': ['created_by'],
  // BE-18: cognitoPostAuth's Talent Flow users lookup.
  EmailIndex: ['GSI1PK'],
};

/**
 * BE-18: world.stale = [table names]. A GetItem on one of these tables WITHOUT ConsistentRead answers as a
 * replica that has not caught up yet: no item, even when the row is there. With ConsistentRead: true it
 * answers from the table. Used to show that consent reads must be strongly consistent.
 */
export function staleFor(tableName, input) {
  return Array.isArray(world.stale) && world.stale.includes(tableName) && input.ConsistentRead !== true;
}

/**
 * BE-17: world.fail = { service, ops?, message } makes every matching call throw an Error with that
 * message (after it is recorded), so a test can see whether an exception's words reach the answer.
 * BE-18: `tables` (optional) limits the failure to calls on those tables.
 */
export function failIfAsked(service, op, tableName) {
  const f = world.fail;
  if (!f || f.service !== service) return;
  if (Array.isArray(f.ops) && !f.ops.includes(op)) return;
  if (Array.isArray(f.tables) && !f.tables.includes(tableName)) return;
  const e = new Error(f.message);
  e.name = f.name ?? 'InternalServerError';
  e.$fault = 'server';
  e.$metadata = { httpStatusCode: 500 };
  throw e;
}
/**
 * BE-18: world.changeBeforeUpdate = { table, key: { attr: value }, set: { attr: value } }. The first UpdateItem on
 * that row finds it already changed by someone else (between a script's scan and its update), as can happen
 * in a live table. Strings only.
 */
export function changeBeforeUpdate(op, input) {
  const c = world.changeBeforeUpdate;
  if (!c || c.done || op !== 'UpdateItem' || input.TableName !== c.table) return;
  if (!Object.entries(c.key).every(([k, v]) => input.Key?.[k]?.S === v)) return;
  const rows = world.tables[c.table] ?? [];
  const r = rows.find((row) => Object.entries(c.key).every(([k, v]) => row[k]?.S === v));
  if (r) for (const [k, v] of Object.entries(c.set)) r[k] = { S: v };
  c.done = true;
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
