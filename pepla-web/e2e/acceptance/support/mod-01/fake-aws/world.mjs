// TEN-03: copied from ../../ten-01/fake-aws (code added only); the world file is named by TEN03_WORLD.
// TEN-01: copied from ../../be-17/fake-aws (BE-17 tests, 7f1442c); the world file is named by TEN03_WORLD.
// BE-17: copied from ../../onb-15/fake-aws (ONB-15 lock); the world file is named by BE17_WORLD.
// The fake world, read from the file named by BE17_WORLD (copied from ../../onb-07/fake-aws): the tables (row by row, as
// DynamoDB stores them) and the S3 objects. Every call any fake answers is
// recorded in `calls`; run.mjs hands the tables back after the handler, so the next run sees its writes.
import { readFileSync } from 'node:fs';
export const world = JSON.parse(readFileSync(process.env.TEN03_WORLD, 'utf8'));
world.tables ??= {};
export const calls = [];
export const KEYS = {
  // TEN-03: the TalentFlow, IT and bundle tables (talent-flow-infra/*.tf, infra/it-provisioning.tf, provisioning-bundles.tf).
  'talent-flow-state': ['PK', 'SK'],
  'talent-flow-config': ['PK', 'SK'],
  'talent-flow-idempotency-keys': ['idempotencyKey'],
  'talent-flow-intelligence-dismissals': ['PK', 'SK'],
  'talent-flow-notifications': ['PK', 'SK'],
  'talent-flow-events': ['PK', 'SK'],
  'it-tasks': ['taskId'],
  'provisioning-bundles': ['bundleId'],
  // TEN-03: ONB-05's consent rows (infra/dynamodb.tf).
  employee_consents: ['employee_id', 'notice_version'],
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
  // TEN-01: the company list (pk USER#<sub> or TENANT#<id>, sk TENANT#<id> or PROFILE).
  'naleko-people-dev-tenants': ['pk', 'sk'],
  // MOD-01: the prod company list, for the module script's --env prod runs (only ever the fake here).
  'naleko-people-prod-tenants': ['pk', 'sk'],
  // TEN-03: the invite rows, the consent rows, the onboarding audit and TalentFlow's user rows.
  employee_invites: ['token_hash'],
  'onboarding-events': ['pk', 'sk'],
  'talent-flow-users': ['PK', 'SK'],
  'naleko-idempotency-keys': ['idempotencyKey'],
};

/**
 * BE-17: global secondary indexes the routes query (index name -> its key attributes). A Query on an
 * index matches its KeyConditionExpression against every row of the table, as DynamoDB does.
 */
/** TEN-03: the tables that have a tenant-index in Terraform (infra/dynamodb.tf, infra/tenancy.tf). A Query on any other table's tenant-index fails, as in AWS. */
export const TENANT_INDEX_TABLES = ['employees', 'documents', 'document-verification', 'naleko-people-dev-tenants'];

export const INDEXES = {
  // TEN-03: the indexes the TalentFlow, IT and bundle code uses today, plus any the harness read from Terraform (world.indexes).
  GSI1: ['GSI1PK'],
  GSI2: ['GSI2PK'],
  'GSI1-active-configs': ['GSI1PK'],
  byTenantStatus: ['tenantId', 'taskStatus'],
  byCandidateId: ['candidateId'],
  byHmId: ['hmUserId'],
  ...(world.indexes ?? {}),
  'employeeId-index': ['employeeId'],
  'email-index': ['email'],
  'created_by-index': ['created_by'],
  // TEN-03: the company index (sparse: only rows with tenant_id are in it) and the other indexes the routes use.
  'tenant-index': ['tenant_id'],
  'employee-index': ['employee_id'],
  'employeeId-timestamp-index': ['employeeId'],
  EmailIndex: ['GSI1PK'],
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
