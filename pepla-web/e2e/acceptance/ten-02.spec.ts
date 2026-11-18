import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { INFRA, attributes, blocks, stripComments } from './support/infra-harness';
import { LAMBDA, REPO, awsCalls, conditionsHold, httpEvent, logLines, row, runHandler, type Call, type Run, type Tables } from './support/ten-02/lambda-harness';
import { XRAY, all, grants, lambdaNamed, list, resources, roleOf, settingsOf, squash } from './support/ten-01/tf';
import {
  A, AGENT_SECRET, B, authorizerOf, DOC, EMP, MAIL, POOL, STAFF, SUB, TENANTS, VER, ask, bodyOf, handlerOf, plain, pool, settings, tables, type Ask, type Caller,
} from './support/ten-02/world';
import { devEnv } from './support/ten-02/dev';
import { onlyTenancyAdded } from './support/ten-02/relock';
import { resourcesNamed, squash as tfSquash } from './support/onb-15/tf-policy';

/**
 * TEN-02 · Onboarding records carry their company, and every onboarding route checks it (Jira NH-194, epic NH-192).
 * Red. One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/TEN-02.md (16 Nov 2026). Notes: TEN-02-tests-for-review.md.
 *
 * The Lambda tests run the real handlers, each call in its own Node process (a cold Lambda), against a fake AWS
 * (support/ten-02/fake-aws, copied from TEN-01's with code added only): DynamoDB over rows as DynamoDB stores them,
 * a Cognito pool, S3, KMS, EventBridge, Postmark and Step Functions that record every call. Any AI client fails.
 * Company A is also the legacy company (LEGACY_TENANT_ID = A while the legacy rule is on); B is a second company.
 * AC-4 and AC-13 read code and Terraform as text. AC-14 and AC-15 run on pepla-dev only. AC-11 (step 2) is in the
 * second test commit (acceptance-lock/ten-02.1).
 *
 * Pinned by the verifier (written down in the notes):
 *  - P1 Order: CORS OPTIONS, the group check, the company check (403 {"error":"Forbidden"} without tenant_id), then the rest.
 *  - P2 Another company's record is answered exactly as a record that does not exist, for that caller: HR and the
 *    agent get 404 {"error":"Not found"}; a non-HR caller gets the route's existing refusal (403), as for an unknown id.
 *    The employee's own document list keeps its own words for an unknown employee, {"error":"Employee not found"}
 *    (locked by BE-19 AC-5 and BE-20 AC-6), so that route answers another company's employee with those words.
 *  - P3 Lists of a company that is not the legacy company Query `tenant-index` (never a Scan). While the legacy rule is
 *    on, the legacy company's lists may still read the old way with the company filter, because rows written before
 *    the backfill are not in the index; step 2 removes that branch.
 *  - P4 Idempotency keys are stored as TENANT#<id>#<client key>.
 *  - P5 Index ranges: employees `employee_id`, documents `employee_id`, document-verification `employeeId`, tenants `pk`.
 *  - P6 The owner of a record is matched on the token's sub against the row's user_sub.
 *  - P7 createEmployee's partner check uses the Member rows: an HR partner of another company is the existing
 *    unknown-partner 400 (a partner with no Member row belongs to the legacy company only while the legacy rule is on).
 *  - P8 The backfill: node scripts/tenancy/backfill.mjs --env dev|prod --tenant <id> --pool <pool id> [--profile x]
 *    [--apply | --check]. Dry run by default. Counts only on output.
 *  - P9 The backfill writes the founding company's row (TENANT#<id>/PROFILE) when it is missing.
 *  - P11 The backfill takes a row's owner only from a sign-in whose email is verified.
 * Nothing here calls AWS or any AI. Locked once accepted: see cards/ten-02.md.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};

const NOT_FOUND = { error: 'Not found' };
/** P2: what HR gets from a route for an id that does not exist (the own document list has its own, older words). */
const notFoundOf = (routeName: string) => (routeName === 'GET /v1/employees/{id}/verifications' ? { error: 'Employee not found' } : NOT_FOUND);
const FORBIDDEN = { error: 'Forbidden' };
const SIX = ['employees', 'documents', 'employee_invites', 'document-verification', 'external-verification-requests', 'naleko-idempotency-keys'];

/** Calls that act on something after a read: S3, AI, KMS Encrypt, Cognito, EventBridge, email, and any DynamoDB write. */
function sideEffects(calls: Call[]): string[] {
  return awsCalls(calls).filter((c) =>
    /^s3 |^bedrock|^ai|^textract|^kms Encrypt|^cognito |^events |^postmark |^sfn |^http /.test(c) ||
    /^dynamodb (PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems)/.test(c));
}
const statusOf = (r: Run) => r.response?.statusCode;
const describe = (r: Run) => `${statusOf(r)} ${JSON.stringify(bodyOf(r)).slice(0, 300)}${r.error ? ` (threw ${r.error.name}: ${r.error.message.slice(0, 200)})` : ''}`;
const scans = (r: Run) => r.calls.filter((c) => c.service === 'dynamodb' && 'op' in c && c.op === 'Scan').map((c) => ('table' in c ? c.table : ''));
const rowOf = (t: Tables, table: string, match: Record<string, string>) =>
  (t[table] ?? []).find((r) => Object.entries(match).every(([k, v]) => (r[k] as any)?.S === v));
const writesTo = (r: Run, table: string) =>
  r.calls.filter((c: any) => c.service === 'dynamodb' && /PutItem|UpdateItem/.test(c.op) && c.table === table).map((c: any) => c.input);
const eventsOf = (r: Run) => r.calls.filter((c: any) => c.service === 'events').map((c: any) => c.detail);

/** The routes that read one record by id. `of` names whose record the id is. */
type ByIdRoute = { name: string; handler: string; ask: (who: 'a' | 'b') => Ask; agent?: boolean };
const BY_ID: ByIdRoute[] = [
  { name: 'GET /v1/employees/{id}', handler: 'getEmployee', ask: (w) => ({ path: { id: w === 'a' ? EMP.a1 : EMP.b1 } }), agent: true },
  { name: 'GET /v1/employees/{id}/invite', handler: 'getInvite', ask: (w) => ({ path: { id: w === 'a' ? EMP.a1 : EMP.b1 } }) },
  { name: 'POST /v1/employees/{id}/invite', handler: 'resendInvite', ask: (w) => ({ method: 'POST', path: { id: w === 'a' ? EMP.a1 : EMP.b1 } }) },
  { name: 'GET /v1/documents/{id}/url', handler: 'getDocumentPresignedUrl', ask: (w) => ({ path: { id: w === 'a' ? DOC.a1 : DOC.b1 } }) },
  {
    name: 'POST /v1/employees/{employee_id}/documents/upload-url', handler: 'generateDocumentUploadUrl',
    ask: (w) => ({ method: 'POST', path: { employee_id: w === 'a' ? EMP.a1 : EMP.b1 }, body: { documentType: 'BANK_CONFIRMATION', fileName: 'bank.pdf', contentType: 'application/pdf' } }),
  },
  { name: 'GET /v1/verifications/{id}', handler: 'getSingleDocumentVerification', ask: (w) => ({ path: { id: w === 'a' ? DOC.a1 : DOC.b1 }, query: { employee_id: w === 'a' ? EMP.a1 : EMP.b1 } }) },
  { name: 'GET /v1/employees/{id}/verifications', handler: 'getEmployeeDocumentVerifications', ask: (w) => ({ path: { id: w === 'a' ? EMP.a1 : EMP.b1 } }) },
  {
    name: 'PATCH /v1/verifications/{id}/review', handler: 'reviewDocumentVerification',
    ask: (w) => ({ method: 'PATCH', path: { id: w === 'a' ? DOC.a1 : DOC.b1 }, body: { decision: 'PASSED', employee_id: w === 'a' ? EMP.a1 : EMP.b1, notes: 'Looks right.' } }),
  },
  { name: 'POST /v1/verifications/{id}/external', handler: 'triggerExternalVerification', ask: (w) => ({ method: 'POST', path: { id: w === 'a' ? DOC.a1 : DOC.b1 }, body: {} }) },
  { name: 'GET /v1/verifications/{id}/summary', handler: 'summariseVerification', ask: (w) => ({ path: { id: w === 'a' ? VER.a1 : VER.b1 } }), agent: true },
  { name: 'POST /v1/employees/{id}/assess-risk', handler: 'classifyOnboardingRisk', ask: (w) => ({ method: 'POST', path: { id: w === 'a' ? EMP.a1 : EMP.b1 } }), agent: true },
  {
    name: 'GET /agent/v1/actions/{actionId}', handler: 'approveAgentAction', agent: true,
    ask: (w) => ({ path: { actionId: w === 'a' ? 'act-a-0001' : 'act-b-0001' }, rawPath: `/agent/v1/actions/${w === 'a' ? 'act-a-0001' : 'act-b-0001'}` } as Ask),
  },
];

/** approveAgentAction reads its id from the raw path. */
function askRoute(route: ByIdRoute, caller: Caller, who: 'a' | 'b', opts: Parameters<typeof ask>[3] = {}): Run {
  const a = route.ask(who) as Ask & { rawPath?: string };
  if (!a.rawPath) return ask(route.handler, caller, a, opts);
  return runRaw(route.handler, caller, a, a.rawPath, opts);
}
function runRaw(handler: string, caller: Caller, a: Ask, rawPath: string, opts: Parameters<typeof ask>[3] = {}): Run {
  // Same as ask(), with the raw path set (the HITL Lambda matches its path itself).
  const event = httpEvent({ authorizer: authorizerOf(caller), path: a.path, query: a.query, body: a.body });
  event.rawPath = rawPath;
  event.requestContext.http.method = a.method ?? 'GET';
  event.requestContext.http.path = rawPath;
  return runHandler(handlerOf(handler), event, {
    tables: opts?.tables ?? tables(), cognito: opts?.cognito ?? pool(),
    secrets: { [AGENT_SECRET]: { AWSCURRENT: 'ten02-agent-key' } }, env: settings({ legacy: opts?.legacy, extra: opts?.env }),
  });
}

/** The ids of the employees a list answer holds, whatever its shape. */
function idsIn(body: any): string[] {
  const items: any[] = body?.items ?? body?.employees ?? body?.data ?? (Array.isArray(body) ? body : []);
  return items.map((i) => i.employee_id ?? i.employeeId ?? i.id).filter(Boolean).sort();
}

test.describe('TEN-02 Onboarding records carry their company', () => {
  test('AC-1 Company B never sees company A', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    // Every record route: HR of B asking for A's record by id gets 404 Not found, and nothing happens after the read.
    for (const route of BY_ID) {
      const r = askRoute(route, 'hrB', 'a');
      expect.soft(statusOf(r), `${route.name} as HR of B for A's record: 404 (got ${describe(r)})`).toBe(404);
      expect.soft(bodyOf(r), `${route.name}: ${JSON.stringify(notFoundOf(route.name))}`).toEqual(notFoundOf(route.name));
      expect.soft(sideEffects(r.calls), `${route.name}: no S3, AI, KMS Encrypt, Cognito, EventBridge, email or write after the read`).toEqual([]);
      expect.soft(JSON.stringify(r.response ?? {}), `${route.name}: nothing of A's record in the answer`).not.toMatch(/John|Doe|company-a\.example|uploads\/emp-a/);
    }

    // Approve and reject of A's pending action, as HR of B: 404, the action untouched, nothing run.
    for (const verb of ['approve', 'reject']) {
      const r = runRaw('approveAgentAction', 'hrB', { method: 'POST', path: { actionId: 'act-a-0001' } }, `/agent/v1/actions/act-a-0001/${verb}`);
      expect.soft(statusOf(r), `POST /agent/v1/actions/{A's action}/${verb} as HR of B: 404 (got ${describe(r)})`).toBe(404);
      expect.soft(bodyOf(r), `${verb}: {"error":"Not found"}`).toEqual(NOT_FOUND);
      expect.soft(sideEffects(r.calls), `${verb}: nothing is run or written`).toEqual([]);
      expect.soft(rowOf(r.tables, 'naleko-pending-actions', { actionId: 'act-a-0001' }), `${verb}: A's action row is unchanged`).toEqual(rowOf(tables(), 'naleko-pending-actions', { actionId: 'act-a-0001' }));
    }

    // The batch risk report and the audit log as HR of B hold nothing of A's (audit rows of A, legacy and B seeded).
    const audited = tables();
    audited['onboarding-events'] = [
      row({ pk: `EMPLOYEE#${EMP.a1}`, sk: '2026-11-12T08:00:00.000Z#1', employeeId: EMP.a1, timestamp: '2026-11-12T08:00:00.000Z', eventType: 'document_reviewed', detail: 'John Doe bank letter', tenant_id: A }),
      row({ pk: `EMPLOYEE#${EMP.legacy}`, sk: '2026-11-01T08:00:00.000Z#1', employeeId: EMP.legacy, timestamp: '2026-11-01T08:00:00.000Z', eventType: 'document_reviewed', detail: 'Lee Mokoena bank letter' }),
      row({ pk: `EMPLOYEE#${EMP.b1}`, sk: '2026-11-12T09:00:00.000Z#1', employeeId: EMP.b1, timestamp: '2026-11-12T09:00:00.000Z', eventType: 'document_reviewed', detail: 'Bea Ndlovu bank letter', tenant_id: B }),
    ];
    const auditA = ask('queryAuditLog', 'hrA', {}, { tables: audited });
    expect.soft(JSON.stringify(bodyOf(auditA) ?? {}), `the audit log as HR of A shows A's rows, as before (got ${describe(auditA)})`).toContain(EMP.a1);
    const auditB = ask('queryAuditLog', 'hrB', {}, { tables: audited });
    expect.soft(JSON.stringify(bodyOf(auditB) ?? {}), 'the audit log as HR of B shows B\'s rows').toContain(EMP.b1);
    expect.soft(JSON.stringify(bodyOf(auditB) ?? {}), 'and nothing of A\'s or the legacy rows').not.toMatch(new RegExp([EMP.a1, EMP.legacy, 'John', 'Mokoena'].join('|')));
    const auditByEmp = ask('queryAuditLog', 'hrB', { query: { employeeId: EMP.a1 } }, { tables: audited });
    expect.soft(JSON.stringify(bodyOf(auditByEmp) ?? {}), 'the audit log of A\'s employee asked for by HR of B: nothing of A\'s').not.toContain('John Doe bank letter');
    const partnersB = JSON.stringify(bodyOf(ask('getHrPartners', 'hrB')));
    expect.soft(partnersB, 'HR partners as HR of B: B\'s HR').toContain(STAFF.hrB);
    expect.soft(partnersB, 'and never A\'s').not.toContain(STAFF.hrA);
    for (const h of ['getBatchRiskReport', 'queryAuditLog']) {
      const r = ask(h, 'hrB');
      expect.soft(statusOf(r), `${h} as HR of B answers (got ${describe(r)})`).toBeLessThan(500);
      expect.soft(JSON.stringify(bodyOf(r) ?? {}), `${h} as HR of B: nothing of A's or the legacy rows`).not.toMatch(new RegExp([EMP.a1, EMP.a2, EMP.legacy, DOC.a1, DOC.legacy, 'John', 'Mokoena', 'company-a\\.example'].join('|')));
    }

    // ONB-05's consent routes find the person by the token's email within the token's company only: an employee of B
    // whose address is on a row of A only is not found, and nothing is recorded.
    const onlyInA = tables();
    onlyInA['employees'] = onlyInA['employees']!.filter((r) => (r['employee_id'] as any).S !== EMP.b1).concat([
      row({ employee_id: 'emp-a-0003-bea', first_name: 'Bea', last_name: 'Ndlovu', email: MAIL.b1, stage: 'DOCUMENTS', tenant_id: A, user_sub: SUB.b1 }),
    ]);
    const start = ask('getMyStart', 'empB', {}, { tables: onlyInA });
    const startHere = ask('getMyStart', 'empB');
    expect.soft(statusOf(startHere), `GET /v1/me as B's employee with a row in B answers (got ${describe(startHere)})`).toBe(200);
    expect.soft(statusOf(start), `GET /v1/me as B's employee whose address is only on A's row: not found (got ${describe(start)})`).not.toBe(200);
    expect.soft(JSON.stringify(bodyOf(start) ?? {}), 'and nothing of A\'s row').not.toContain('emp-a-0003-bea');
    const noticeVersion = String((bodyOf(ask('getMyStart', 'empA')) as any)?.notice?.version ?? '');
    expect.soft(noticeVersion, 'GET /v1/me as A\'s employee serves the notice version, as today').not.toBe('');
    const consent = ask('recordConsent', 'empB', { method: 'POST', body: { version: noticeVersion } }, { tables: onlyInA });
    expect.soft(statusOf(consent), `POST /v1/me/consent as B's employee whose address is only on A's row: the existing not-found 404 (got ${describe(consent)})`).toBe(404);
    expect.soft(consent.calls.filter((c: any) => c.service === 'dynamodb' && /Put|Update/.test(c.op)), 'and nothing is recorded').toEqual([]);

    // A legacy record (no tenant_id) is A's while the legacy rule is on: B never gets it either.
    const legacyEmp = ask('getEmployee', 'hrB', { path: { id: EMP.legacy } });
    expect.soft(statusOf(legacyEmp), `GET /v1/employees/<legacy id> as HR of B: 404 (got ${describe(legacyEmp)})`).toBe(404);
    const legacyDoc = ask('getDocumentPresignedUrl', 'hrB', { path: { id: DOC.legacy } });
    expect.soft(statusOf(legacyDoc), `GET /v1/documents/<legacy doc>/url as HR of B: 404 (got ${describe(legacyDoc)})`).toBe(404);
    expect.soft(sideEffects(legacyDoc.calls), 'no presign for the legacy document').toEqual([]);

    // Lists: HR of B sees only B's employee, never A's or a legacy row, and never by a Scan.
    const list = ask('getEmployees', 'hrB');
    expect.soft(statusOf(list), `GET /v1/employees as HR of B: 200 (got ${describe(list)})`).toBe(200);
    expect.soft(idsIn(bodyOf(list)), 'HR of B lists only B\'s employee').toEqual([EMP.b1]);
    expect.soft(scans(list), 'GET /v1/employees as HR of B: no Scan').toEqual([]);
    const vlist = ask('getDocumentVerifications', 'hrB');
    expect.soft(statusOf(vlist), `GET /v1/verifications as HR of B: 200 (got ${describe(vlist)})`).toBe(200);
    expect.soft(idsIn(bodyOf(vlist)), 'HR of B lists only B\'s verification').toEqual([EMP.b1]);
    expect.soft(scans(vlist), 'GET /v1/verifications as HR of B: no Scan').toEqual([]);
    const waiting = ask('getDocumentVerifications', 'hrB', { query: { waiting: 'true' } });
    expect.soft(idsIn(bodyOf(waiting)), 'HR of B\'s waiting documents are only B\'s').toEqual([EMP.b1]);
    expect.soft(scans(waiting), 'the waiting list as HR of B: no Scan').toEqual([]);
    const byEmail = ask('getEmployeeByEmail', 'hrB', { query: { email: MAIL.a1 } });
    expect.soft(bodyOf(byEmail)?.employee_id, 'GET /v1/employees/by-email as HR of B never names A\'s employee').toBeUndefined();
    expect.soft(JSON.stringify(bodyOf(byEmail)), 'by-email as HR of B: A\'s person is not found').not.toContain(EMP.a1);

    // Lists by the same caller with the legacy rule off: still only B's.
    const listOff = ask('getEmployees', 'hrB', {}, { legacy: false });
    expect.soft(idsIn(bodyOf(listOff)), 'legacy rule off: HR of B lists only B\'s employee').toEqual([EMP.b1]);

    // And the other way: the legacy company's lists (the old read path) never take in B's rows.
    for (const [caller, h, want] of [['hrA', 'getEmployees', [EMP.a1, EMP.a2, EMP.legacy]], ['hrA', 'getDocumentVerifications', [EMP.a1, EMP.legacy]], ['agentA', 'getEmployees', [EMP.a1, EMP.a2, EMP.legacy]]] as const) {
      const r = ask(h, caller);
      expect.soft(idsIn(bodyOf(r)), `${h} as ${caller}: A's and the legacy rows only, never B's`).toEqual([...want].sort());
    }
  });

  test('AC-2 Company A sees what it saw before', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    // HR of A on A's own records: the same status and the same record as before this card.
    const expected: Record<string, number> = {
      getEmployee: 200, getInvite: 200, resendInvite: 409, getDocumentPresignedUrl: 200, generateDocumentUploadUrl: 200,
      getSingleDocumentVerification: 200, getEmployeeDocumentVerifications: 200, reviewDocumentVerification: 200,
      triggerExternalVerification: 200, summariseVerification: 200, classifyOnboardingRisk: 200, approveAgentAction: 200,
    };
    for (const route of BY_ID) {
      const caller: Caller = route.handler === 'approveAgentAction' ? 'agentA' : 'hrA';
      const r = askRoute(route, caller, 'a');
      expect.soft(statusOf(r), `${route.name} as ${caller} for A's own record: ${expected[route.handler]} (got ${describe(r)})`).toBe(expected[route.handler]);
    }
    // The same for any company on its own records: HR of B on B's, and HR of A with the legacy rule off. A wrong
    // company check must not lock HR out of its own records.
    for (const route of BY_ID) {
      const caller: Caller = route.handler === 'approveAgentAction' ? 'agentA' : 'hrA';
      const off = askRoute(route, caller, 'a', { legacy: false });
      expect.soft(statusOf(off), `${route.name} as ${caller} for A's own record, legacy rule off: ${expected[route.handler]} (got ${describe(off)})`).toBe(expected[route.handler]);
      if (route.handler === 'approveAgentAction') continue; // the agent key is A's only
      const b = askRoute(route, 'hrB', 'b');
      expect.soft(statusOf(b), `${route.name} as HR of B for B's own record: ${expected[route.handler]} (got ${describe(b)})`).toBe(expected[route.handler]);
    }
    const empB = bodyOf(ask('getEmployee', 'hrB', { path: { id: EMP.b1 } }));
    expect.soft(empB?.employee?.employee_id ?? empB?.employee_id, 'GET /v1/employees/{id} as HR of B: B\'s employee').toBe(EMP.b1);
    const emp = bodyOf(ask('getEmployee', 'hrA', { path: { id: EMP.a1 } }));
    expect.soft(emp?.employee?.employee_id ?? emp?.employee_id, 'GET /v1/employees/{id}: A\'s employee').toBe(EMP.a1);
    expect.soft(JSON.stringify(emp), 'the answer carries no tenant_id').not.toContain('tenant_id');
    // Lists: A's rows and the legacy rows (the legacy rule is on).
    const list = ask('getEmployees', 'hrA');
    expect.soft(statusOf(list), `GET /v1/employees as HR of A: 200 (got ${describe(list)})`).toBe(200);
    expect.soft(idsIn(bodyOf(list)), 'HR of A still lists A\'s employees and the legacy one').toEqual(expect.arrayContaining([EMP.a1, EMP.a2, EMP.legacy]));
    const vlist = ask('getDocumentVerifications', 'hrA');
    expect.soft(idsIn(bodyOf(vlist)), 'HR of A still lists A\'s and the legacy verification').toEqual(expect.arrayContaining([EMP.a1, EMP.legacy]));
    const legacy = ask('getEmployee', 'hrA', { path: { id: EMP.legacy } });
    expect.soft(statusOf(legacy), `the legacy employee is still A's: 200 (got ${describe(legacy)})`).toBe(200);
    const legacyDoc = ask('getDocumentPresignedUrl', 'hrA', { path: { id: DOC.legacy } });
    expect.soft(statusOf(legacyDoc), `the legacy document still opens for A: 200 (got ${describe(legacyDoc)})`).toBe(200);
    // Email lookups as today.
    expect.soft(bodyOf(ask('checkEmployeeEmail', 'hrA', { query: { email: MAIL.a1 } })), 'email-check of A\'s address as HR of A: in use').toEqual({ inUse: true });
    expect.soft(bodyOf(ask('getEmployeeByEmail', 'hrA', { query: { email: MAIL.a1 } }))?.employee_id, 'by-email as HR of A finds A\'s person').toBe(EMP.a1);
    // The agent of A on the agent routes.
    const agentEmp = ask('getEmployee', 'agentA', { path: { id: EMP.a1 } });
    expect.soft(statusOf(agentEmp), `GET /agent/v1/employees/{id} as the agent of A: 200 (got ${describe(agentEmp)})`).toBe(200);
    const agentList = ask('getEmployees', 'agentA');
    expect.soft(idsIn(bodyOf(agentList)), 'the agent of A still lists A\'s and the legacy employees').toEqual(expect.arrayContaining([EMP.a1, EMP.a2, EMP.legacy]));
    const agentVer = ask('getDocumentVerifications', 'agentA');
    expect.soft(statusOf(agentVer), `GET /agent/v1/verifications as the agent of A: 200 (got ${describe(agentVer)})`).toBe(200);
  });

  test('AC-3 Writes carry and keep the company', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    // createEmployee stamps the new row and its event.
    const created = ask('createEmployee', 'hrA', {
      method: 'POST', headers: { 'idempotency-key': 'ten02-ac3-create' },
      body: { first_name: 'Sam', last_name: 'Doe', email: 'sam.doe@company-a.example', phone: '000 000 0000', department: 'Operations', job_title: 'Junior baker', hr_staff_id: STAFF.hrA },
    });
    expect(statusOf(created), `POST /v1/employees as HR of A: 201 (got ${describe(created)})`).toBe(201);
    const newRow = (created.tables['employees'] ?? []).find((r) => (r['email'] as any)?.S === 'sam.doe@company-a.example');
    expect(plain(newRow)['tenant_id'], 'the new employee row carries tenant_id = A').toBe(A);
    expect(eventsOf(created).length, 'createEmployee publishes its event').toBeGreaterThan(0);
    for (const d of eventsOf(created)) expect.soft(d?.tenant_id, `createEmployee's event ${JSON.stringify(d).slice(0, 80)} carries tenant_id = A`).toBe(A);
    expect.soft(JSON.stringify(bodyOf(created)), 'the answer carries no tenant_id').not.toContain('tenant_id');

    // generateDocumentUploadUrl stamps the document row.
    const up = askRoute(BY_ID.find((r) => r.handler === 'generateDocumentUploadUrl')!, 'hrA', 'a');
    expect(statusOf(up), `upload-url as HR of A: 200 (got ${describe(up)})`).toBe(200);
    const docs = writesTo(up, 'documents');
    expect(docs.length, 'upload-url writes a document row').toBeGreaterThan(0);
    for (const w of docs) expect.soft(w.Item?.tenant_id?.S ?? w.ExpressionAttributeValues?.[':tenant_id']?.S, 'the document row carries tenant_id = A').toBe(A);

    // triggerExternalVerification stamps the request row.
    const ext = askRoute(BY_ID.find((r) => r.handler === 'triggerExternalVerification')!, 'hrA', 'a');
    expect(statusOf(ext), `external as HR of A: 200 (got ${describe(ext)})`).toBe(200);
    const extRows = writesTo(ext, 'external-verification-requests');
    expect(extRows.length, 'external writes a request row').toBeGreaterThan(0);
    for (const w of extRows) expect.soft(w.Item?.tenant_id?.S, 'the request row carries tenant_id = A').toBe(A);

    // reviewDocumentVerification: every update carries the company condition, and every event the company.
    const review = askRoute(BY_ID.find((r) => r.handler === 'reviewDocumentVerification')!, 'hrA', 'a');
    expect(statusOf(review), `review as HR of A: 200 (got ${describe(review)})`).toBe(200);
    const updates = review.calls.filter((c: any) => c.service === 'dynamodb' && c.op === 'UpdateItem').map((c: any) => c.input);
    expect(updates.length, 'review updates rows').toBeGreaterThan(0);
    for (const u of updates) {
      // The condition compares the row's tenant_id with the caller's company (the legacy company may also match a row
      // with no tenant_id while the legacy rule is on). attribute_exists(tenant_id) alone is not a company check.
      const cond = String(u.ConditionExpression ?? '');
      const names: Record<string, string> = u.ExpressionAttributeNames ?? {};
      const eq = [...cond.matchAll(/(#?[\w]+)\s*=\s*(:[\w]+)/g)].filter(([, n]) => (names[n!] ?? n) === 'tenant_id');
      expect.soft(eq.length, `UpdateItem on ${u.TableName}: the condition has tenant_id = :value (got ${cond})`).toBeGreaterThan(0);
      for (const [, , v] of eq) expect.soft(u.ExpressionAttributeValues?.[v!]?.S, `UpdateItem on ${u.TableName}: ${v} is company A`).toBe(A);
    }
    // Every update any record route makes on the six tables, for A's record, carries the same company condition.
    for (const route of BY_ID) {
      const caller: Caller = route.handler === 'approveAgentAction' ? 'agentA' : 'hrA';
      const r = askRoute(route, caller, 'a');
      for (const c of r.calls.filter((x: any) => x.service === 'dynamodb' && x.op === 'UpdateItem' && SIX.includes(x.table)) as any[]) {
        const u = c.input;
        const cond = String(u.ConditionExpression ?? '');
        const names: Record<string, string> = u.ExpressionAttributeNames ?? {};
        const eq = [...cond.matchAll(/(#?[\w]+)\s*=\s*(:[\w]+)/g)].filter(([, n]) => (names[n!] ?? n) === 'tenant_id');
        expect.soft(eq.length, `${route.name}: UpdateItem on ${u.TableName} has tenant_id = :value (got ${cond})`).toBeGreaterThan(0);
        for (const [, , v] of eq) expect.soft(u.ExpressionAttributeValues?.[v!]?.S, `${route.name}: UpdateItem on ${u.TableName} names company A`).toBe(A);
      }
    }
    // Each update's condition, read as DynamoDB reads it, holds on A's row and fails on the same row made B's: it
    // keeps the company even when no read came first (rule A.4).
    for (const route of BY_ID) {
      const caller: Caller = route.handler === 'approveAgentAction' ? 'agentA' : 'hrA';
      const r = askRoute(route, caller, 'a');
      for (const c of r.calls.filter((x: any) => x.service === 'dynamodb' && x.op === 'UpdateItem' && SIX.includes(x.table)) as any[]) {
        const u = c.input;
        const before = (tables()[u.TableName] ?? []).find((row) => Object.entries(u.Key ?? {}).every(([k, v]) => JSON.stringify(row[k]) === JSON.stringify(v)));
        if (!before || !u.ConditionExpression) continue; // a missing condition is caught just above
        const [ownRow, otherRow] = conditionsHold([
          { expr: u.ConditionExpression, names: u.ExpressionAttributeNames, values: u.ExpressionAttributeValues, row: before },
          { expr: u.ConditionExpression, names: u.ExpressionAttributeNames, values: u.ExpressionAttributeValues, row: { ...before, tenant_id: { S: B } } },
        ]);
        expect.soft(ownRow, `${route.name}: the UpdateItem condition on ${u.TableName} holds for A's row`).toBe(true);
        expect.soft(otherRow, `${route.name}: and fails when the row is B's`).toBe(false);
      }
    }
    // A row that became B's between the read and the write: the update fails its condition and answers 404.
    const flipped = ask('reviewDocumentVerification', 'hrA', { method: 'PATCH', path: { id: DOC.a1 }, body: { decision: 'PASSED', employee_id: EMP.a1, notes: 'Looks right.' } },
      { flipOnUpdate: { table: 'documents', set: { tenant_id: { S: B } } } });
    expect.soft(statusOf(flipped), `review when A's document became B's before the write: 404 (got ${describe(flipped)})`).toBe(404);
    expect.soft(bodyOf(flipped), '{"error":"Not found"}').toEqual(NOT_FOUND);
    expect.soft(eventsOf(flipped), 'and no event').toEqual([]);
    expect.soft(plain(rowOf(flipped.tables, 'documents', { document_id: DOC.a1 }))['hr_reviewed_at'], 'and the row is not decided').toBeUndefined();

    // The same writes from company B's side carry B (never the legacy company).
    const upB = askRoute(BY_ID.find((r) => r.handler === 'generateDocumentUploadUrl')!, 'hrB', 'b');
    const docsB = writesTo(upB, 'documents');
    expect.soft(docsB.length, `upload-url as HR of B writes a document row (got ${describe(upB)})`).toBeGreaterThan(0);
    for (const w of docsB) expect.soft(w.Item?.tenant_id?.S ?? w.ExpressionAttributeValues?.[':tenant_id']?.S, 'B\'s document row carries tenant_id = B').toBe(B);
    const extB = askRoute(BY_ID.find((r) => r.handler === 'triggerExternalVerification')!, 'hrB', 'b');
    const extRowsB = writesTo(extB, 'external-verification-requests');
    expect.soft(extRowsB.length, `external as HR of B writes a request row (got ${describe(extB)})`).toBeGreaterThan(0);
    for (const w of extRowsB) expect.soft(w.Item?.tenant_id?.S, 'B\'s request row carries tenant_id = B').toBe(B);
    const reviewB = askRoute(BY_ID.find((r) => r.handler === 'reviewDocumentVerification')!, 'hrB', 'b');
    expect.soft(statusOf(reviewB), `review of B's document as HR of B: 200 (got ${describe(reviewB)})`).toBe(200);
    expect.soft(eventsOf(reviewB).length, 'and its event is published').toBeGreaterThan(0);
    for (const d of eventsOf(reviewB)) expect.soft(d?.tenant_id, 'B\'s review event carries tenant_id = B').toBe(B);
    const auditB = runHandler(handlerOf('auditLogConsumer'), {
      version: '0', id: 'ten02-evt-b', 'detail-type': 'document_reviewed', source: 'naleko.onboarding', time: '2026-11-17T08:00:00Z',
      detail: { employee_id: EMP.b1, document_id: DOC.b1, decision: 'APPROVED', tenant_id: B },
    }, { tables: tables(), env: settings() });
    const auditRowsB = writesTo(auditB, 'onboarding-events');
    expect.soft(auditRowsB.length, `the audit consumer writes B's row (got ${describe(auditB)})`).toBeGreaterThan(0);
    for (const w of auditRowsB) expect.soft(w.Item?.tenant_id?.S, 'B\'s audit row carries tenant_id = B').toBe(B);
    // Each update made from B's side: its condition holds on B's row, and fails on A's row and on a legacy row
    // (a row with no company), so B can never update a row it did not read.
    for (const route of BY_ID.filter((r) => r.handler !== 'approveAgentAction')) {
      const r = askRoute(route, 'hrB', 'b');
      for (const c of r.calls.filter((x: any) => x.service === 'dynamodb' && x.op === 'UpdateItem' && SIX.includes(x.table)) as any[]) {
        const u = c.input;
        const before = (tables()[u.TableName] ?? []).find((row) => Object.entries(u.Key ?? {}).every(([k, v]) => JSON.stringify(row[k]) === JSON.stringify(v)));
        if (!before) continue;
        expect.soft(u.ConditionExpression, `${route.name} as HR of B: UpdateItem on ${u.TableName} has a condition`).toBeTruthy();
        if (!u.ConditionExpression) continue;
        const { tenant_id: _t, ...noCompany } = before;
        const [own, ofA, legacyRow] = conditionsHold([
          { expr: u.ConditionExpression, names: u.ExpressionAttributeNames, values: u.ExpressionAttributeValues, row: before },
          { expr: u.ConditionExpression, names: u.ExpressionAttributeNames, values: u.ExpressionAttributeValues, row: { ...before, tenant_id: { S: A } } },
          { expr: u.ConditionExpression, names: u.ExpressionAttributeNames, values: u.ExpressionAttributeValues, row: noCompany },
        ]);
        expect.soft(own, `${route.name} as HR of B: the condition on ${u.TableName} holds for B's row`).toBe(true);
        expect.soft(ofA, `${route.name} as HR of B: and fails on A's row`).toBe(false);
        expect.soft(legacyRow, `${route.name} as HR of B: and fails on a row with no company`).toBe(false);
      }
    }

    // recordConsent stamps the consent row with the caller's company.
    const version = String((bodyOf(ask('getMyStart', 'empA')) as any)?.notice?.version ?? '');
    const consented = ask('recordConsent', 'empA', { method: 'POST', body: { version } });
    expect.soft(statusOf(consented), `POST /v1/me/consent as A's employee: 201 (got ${describe(consented)})`).toBe(201);
    const consentRows = writesTo(consented, 'employee_consents');
    expect.soft(consentRows.length, 'one consent row').toBe(1);
    for (const w of consentRows) expect.soft(w.Item?.tenant_id?.S, 'the consent row carries tenant_id = A').toBe(A);
    const consentedB = ask('recordConsent', 'empB', { method: 'POST', body: { version } });
    expect.soft(statusOf(consentedB), `POST /v1/me/consent as B's employee: 201 (got ${describe(consentedB)})`).toBe(201);
    for (const w of writesTo(consentedB, 'employee_consents')) expect.soft(w.Item?.tenant_id?.S, 'B\'s consent row carries tenant_id = B').toBe(B);
    const reviewEvents = eventsOf(review);
    expect(reviewEvents.length, 'review publishes its event').toBeGreaterThan(0);
    for (const d of reviewEvents) expect.soft(d?.tenant_id, 'the review event carries tenant_id = A').toBe(A);

    // An update aimed at B's row by A fails and answers 404, with the row unchanged.
    const before = rowOf(tables(), 'documents', { document_id: DOC.b1 });
    const cross = askRoute(BY_ID.find((r) => r.handler === 'reviewDocumentVerification')!, 'hrA', 'b');
    expect(statusOf(cross), `review of B's document as HR of A: 404 (got ${describe(cross)})`).toBe(404);
    expect(rowOf(cross.tables, 'documents', { document_id: DOC.b1 }), 'B\'s document row is unchanged').toEqual(before);

    // The audit consumer copies the event's company onto the audit row.
    const audit = runHandler(handlerOf('auditLogConsumer'), {
      version: '0', id: 'ten02-evt-1', 'detail-type': 'document_reviewed', source: 'naleko.onboarding', time: '2026-11-17T08:00:00Z',
      detail: { employee_id: EMP.a1, document_id: DOC.a1, decision: 'APPROVED', tenant_id: A },
    }, { tables: tables(), env: settings() });
    const auditRows = writesTo(audit, 'onboarding-events');
    expect(auditRows.length, `the audit consumer writes a row (got ${describe(audit)})`).toBeGreaterThan(0);
    for (const w of auditRows) expect.soft(w.Item?.tenant_id?.S, 'the audit row carries tenant_id = A').toBe(A);

    // nalekoAiChat's pending action rows carry the company (text: tool-resolver stamps them).
    // Text only: today no Batsi tool is a write tool, so no pending row can be made to happen. The row takes the
    // company from the chat's context, and the chat puts the caller's company (from requireTenant) in that context.
    const resolver = readFileSync(join(LAMBDA, 'nalekoAiChat', 'tool-resolver.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const chat = readFileSync(join(LAMBDA, 'nalekoAiChat', 'index.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    const ctxKey = /PutItemCommand\([\s\S]{0,700}?tenant_id:\s*context\.(\w+)/.exec(resolver)?.[1];
    expect(ctxKey, 'the pending action row sets tenant_id from the chat context').toBeTruthy();
    // The chat's own audit rows carry the company too (text: the robot path writes none).
    const auditPut = /naleko-agent-audit|AUDIT_TABLE|agent-audit/.test(chat + resolver);
    expect(auditPut, 'Batsi writes agent audit rows').toBe(true);
    for (const [file, code] of [['index.mjs', chat], ['tool-resolver.mjs', resolver]] as const) {
      for (const m of code.matchAll(/PutItemCommand\(\{\s*TableName:\s*([^,\n]+)/g)) {
        if (!/AUDIT|audit/.test(m[1]!)) continue;
        // The row is built in the same function, before the write.
        const fnStart = Math.max(code.lastIndexOf('\nasync function', m.index!), code.lastIndexOf('\nfunction', m.index!), code.lastIndexOf('\nexport async function', m.index!), 0);
        expect.soft(code.slice(fnStart, m.index! + 600), `nalekoAiChat/${file}: the agent audit row carries tenant_id`).toMatch(/tenant_id\s*:/);
      }
    }
    expect(chat, `the chat context carries ${ctxKey} from the caller's company`).toMatch(new RegExp(`const\\s+\\{\\s*tenantId[^}]*\\}\\s*=\\s*requireTenant\\(event\\)[\\s\\S]*context\\s*=\\s*\\{[^}]*\\b${ctxKey === 'tenantId' ? 'tenantId' : `${ctxKey}\\s*:\\s*tenantId`}\\b`));
  });

  test('AC-4 Lists use the company index', async ({}, testInfo) => {
    once(testInfo.project.name);
    const RULE_AC = ['checkEmployeeEmail', 'classifyOnboardingRisk', 'createEmployee', 'generateDocumentUploadUrl', 'getBatchRiskReport', 'getDocumentPresignedUrl',
      'getDocumentVerifications', 'getEmployee', 'getEmployeeByEmail', 'getEmployeeDocumentVerifications', 'getEmployees', 'getHrPartners',
      'getSingleDocumentVerification', 'nalekoAiChat', 'reviewDocumentVerification', 'summariseVerification', 'triggerExternalVerification', 'queryAuditLog',
      'approveAgentAction', 'resendInvite', 'getInvite', 'cognitoPostAuth', 'processDocumentOCR', 'sendNotificationEmail', 'auditLogConsumer'];
    // P3: no rule A or C handler scans the six tables itself, however the Scan is written (inline input, a
    // variable, a paginator). The one legacy read lives in lambda/shared, behind the legacy rule.
    const filesUnder = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === 'node_modules' || e.name === 'coverage' ? [] : filesUnder(join(dir, e.name))) : (e.name.endsWith('.mjs') || e.name.endsWith('.js')) && !/\.test\.m?js$/.test(e.name) ? [join(dir, e.name)] : []);
    const OTHER_TABLES = /^\s*['"](naleko-agent-audit|naleko-pending-actions|onboarding-events|talent-flow-users|employee_consents)['"]/;
    for (const name of RULE_AC) {
      const dir = join(LAMBDA, name);
      if (!existsSync(dir)) continue;
      for (const f of filesUnder(dir)) {
        const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        const rel = f.slice(LAMBDA.length + 1);
        for (const m of code.matchAll(/(?:new\s+)?(?:\.\s*)?ScanCommand\s*\)?\s*\(|paginateScan\s*\(|\.scan\s*\(/g)) {
          // Allowed only when the Scan's input is written inline and names a table outside the six.
          const after = code.slice(m.index!, m.index! + 400);
          let tableName = (/^new\s+ScanCommand\s*\(\s*\{[^}]*?TableName:\s*([^,\n}]+)/.exec(after)?.[1] ?? '').trim();
          // A constant declared in the same file, naming its table: const AUDIT_TABLE = process.env.X ?? 'onboarding-events'.
          const decl = /^[A-Z_][A-Z0-9_]*$/.test(tableName) ? new RegExp(`const\\s+${tableName}\\s*=\\s*([^;\\n]+)`).exec(code)?.[1] ?? '' : '';
          if (decl) tableName = /['"]([\w.-]+)['"]/.exec(decl)?.[0] ?? '';
          expect.soft(OTHER_TABLES.test(tableName), `${rel} scans (${after.slice(0, 60).replace(/\s+/g, ' ')}...): a handler never scans the six tables; lists Query tenant-index`).toBe(true);
        }
      }
    }
    // No handler renames the Scan command or reaches the low-level scan call another way.
    for (const name of RULE_AC) {
      const dir = join(LAMBDA, name);
      if (!existsSync(dir)) continue;
      for (const f of filesUnder(dir)) {
        const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
        expect.soft(code, `${f.slice(LAMBDA.length + 1)}: ScanCommand is never imported under another name`).not.toMatch(/ScanCommand\s+as\s+\w+|\[\s*['"]ScanCommand['"]\s*\]|ScanCommand\s*[,}][^;]*=\s*await\s+import/);
      }
    }
    // The legacy read, if kept, sits in lambda/shared, and every Scan there comes after a readsLegacyRows check in
    // the same function.
    for (const f of filesUnder(join(LAMBDA, 'shared'))) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const m of code.matchAll(/new\s+ScanCommand\s*\(|paginateScan\s*\(/g)) {
        const fnStart = Math.max(code.lastIndexOf('\nexport async function', m.index!), code.lastIndexOf('\nasync function', m.index!), code.lastIndexOf('\nfunction', m.index!), code.lastIndexOf('\nexport function', m.index!));
        expect.soft(code.slice(Math.max(fnStart, 0), m.index!), `${f.slice(LAMBDA.length + 1)}: the Scan sits behind readsLegacyRows in its function`).toMatch(/readsLegacyRows\(/);
      }
    }
    // Lists Query tenant-index for a company that is not the legacy one (behaviour, all list routes).
    for (const [h, a] of [['getEmployees', {}], ['getDocumentVerifications', {}], ['getDocumentVerifications', { query: { waiting: 'true' } }]] as const) {
      const r = ask(h, 'hrB', a as Ask);
      const queries = r.calls.filter((c: any) => c.service === 'dynamodb' && c.op === 'Query' && c.input?.IndexName === 'tenant-index');
      expect.soft(queries.length, `${h} ${JSON.stringify(a)} as HR of B Queries tenant-index`).toBeGreaterThan(0);
      for (const q of queries) expect.soft(Object.values(q.input.ExpressionAttributeValues ?? {}).some((v: any) => v?.S === B), `${h}: the tenant-index Query names company B`).toBe(true);
    }
    const risk = ask('getBatchRiskReport', 'hrB');
    expect.soft(scans(risk), `the batch risk report as HR of B: no Scan (got ${describe(risk)})`).toEqual([]);
    // Terraform: the new indexes, with the keys pinned (P5).
    const tableNamed = (name: string) => resources('aws_dynamodb_table').find((b) => attributes(b.body).get('name') === name);
    const indexOf = (body: string) => {
      const out: Record<string, string>[] = [];
      for (const m of body.matchAll(/global_secondary_index\s*\{([\s\S]*?)\n\s*\}/g)) out.push(Object.fromEntries(attributes(m[1]!).entries()));
      return out.find((g) => g['name'] === '"tenant-index"');
    };
    for (const [name, range] of [['"employees"', 'employee_id'], ['"documents"', 'employee_id'], ['"document-verification"', 'employeeId'], ['"naleko-people-${var.environment}-tenants"', 'pk']] as const) {
      const t = tableNamed(name);
      expect.soft(t, `infra: aws_dynamodb_table ${name}`).toBeTruthy();
      if (!t) continue;
      const gsi = indexOf(t.body);
      expect.soft(gsi, `${name} has a tenant-index`).toBeTruthy();
      expect.soft(gsi?.['hash_key'], `${name} tenant-index hash key tenant_id`).toBe('"tenant_id"');
      expect.soft(gsi?.['range_key'], `${name} tenant-index range key ${range}`).toBe(`"${range}"`);
      expect.soft(gsi?.['projection_type'], `${name} tenant-index projection ALL`).toBe('"ALL"');
      expect.soft(squash(t.body), `${name} defines the tenant_id attribute as a string`).toMatch(/attribute\{name="tenant_id"type="S"\}/);
    }
  });

  test('AC-5 Public and background paths use the stored company', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    const token = 'TEN02aInviteTokenForCompanyAOnly0000000000A'; // 43 characters, the shape of a real token
    const hash = createHash('sha256').update(token).digest('hex');
    const withInvite = (empTenant: string) => {
      const t = tables();
      t['employee_invites'] = [row({ token_hash: hash, employee_id: EMP.a1, created_at: '2026-11-16T08:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z', sent_by: 'HR', tenant_id: A })];
      t['employees'] = t['employees']!.map((r) => ((r['employee_id'] as any).S === EMP.a1 ? { ...r, tenant_id: { S: empTenant }, stage: { S: 'INVITED' } } : r));
      return t;
    };
    const poolInvited = () => {
      const p = pool();
      p.users = p.users.map((u) => (u.username === MAIL.a1 ? { ...u, status: 'FORCE_CHANGE_PASSWORD' } : u));
      return p;
    };
    const publicEvent = (body: unknown) => {
          const e = httpEvent({ body });
      e.requestContext.http.method = 'POST';
      return e;
    };
    const run = (h: string, body: unknown, t: Tables) =>
      runHandler(handlerOf(h), publicEvent(body), { tables: t, cognito: poolInvited(), env: settings() });

    const look = run('lookupInvite', { token }, withInvite(A));
    expect.soft(statusOf(look), `lookup of an A invite works as today (got ${describe(look)})`).toBe(200);
    expect.soft(JSON.stringify(bodyOf(look)), 'no company field in the answer').not.toContain('tenant');
    const redeem = run('redeemInvite', { token, password: 'Ten02-Strong-Password!' }, withInvite(A));
    expect.soft([200, 201, 204], `redeem of an A invite works as today (got ${describe(redeem)})`).toContain(statusOf(redeem));
    // An invite of B works the same way for B's person (the company comes from the invite row, not the legacy rule).
    const tokenB = 'TEN02bInviteTokenForCompanyBOnly0000000000B';
    const tB = tables();
    tB['employee_invites'] = [row({ token_hash: createHash('sha256').update(tokenB).digest('hex'), employee_id: EMP.b1, created_at: '2026-11-16T08:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z', sent_by: 'HR', tenant_id: B })];
    tB['employees'] = tB['employees']!.map((r) => ((r['employee_id'] as any).S === EMP.b1 ? { ...r, stage: { S: 'INVITED' } } : r));
    const pB = pool();
    pB.users = pB.users.map((u) => (u.username === MAIL.b1 ? { ...u, status: 'FORCE_CHANGE_PASSWORD' } : u));
    const lookB = runHandler(handlerOf('lookupInvite'), publicEvent({ token: tokenB }), { tables: tB, cognito: pB, env: settings() });
    expect.soft(statusOf(lookB), `lookup of a B invite works (got ${describe(lookB)})`).toBe(200);
    const redeemB = runHandler(handlerOf('redeemInvite'), publicEvent({ token: tokenB, password: 'Ten02-Strong-Password!' }), { tables: tB, cognito: pB, env: settings() });
    expect.soft([200, 201, 204], `redeem of a B invite works (got ${describe(redeemB)})`).toContain(statusOf(redeemB));
    expect.soft(redeemB.calls.filter((c: any) => c.service === 'cognito' && c.op === 'AdminSetUserPassword').length, 'and B\'s person sets their password').toBe(1);
    const moved = run('redeemInvite', { token, password: 'Ten02-Strong-Password!' }, withInvite(B));
    expect.soft(statusOf(moved), `redeem when the employee row is now B's: 410 (got ${describe(moved)})`).toBe(410);
    expect.soft(bodyOf(moved), 'the existing "used" answer').toEqual({ status: 'used' });
    expect.soft(moved.calls.filter((c: any) => c.service === 'cognito' && c.op === 'AdminSetUserPassword'), 'no password is set').toEqual([]);
    expect.soft(plain(rowOf(moved.tables, 'employee_invites', { token_hash: hash }))['used_at'], 'the link is used up, as its "used" answer says').toBeTruthy();
    expect.soft(writesTo(moved, 'employees'), 'and the person is not changed').toEqual([]);

    // cognitoPostAuth: only the row with that email in the person's company.
    const postAuth = (sub: string, email: string, t: Tables, legacy = true) => runHandler(handlerOf('cognitoPostAuth'), {
      version: '1', triggerSource: 'PostAuthentication_Authentication', region: 'af-south-1', userPoolId: POOL, userName: sub,
      request: { userAttributes: { sub, email, email_verified: 'true' } }, response: {},
    }, { tables: t, env: settings({ legacy }) });
    const twin = tables();
    // Same address in both companies, both INVITED.
    twin['employees'] = [
      ...twin['employees']!.map((r) => ((r['employee_id'] as any).S === EMP.a1 ? { ...r, stage: { S: 'INVITED' } } : r)),
      row({ employee_id: 'emp-b-0002-twin', first_name: 'John', last_name: 'Doe', email: MAIL.a1, stage: 'INVITED', tenant_id: B, created_by: STAFF.hrB }),
    ];
    const pa = postAuth(SUB.a1, MAIL.a1, twin);
    expect.soft(pa.response, 'cognitoPostAuth returns the event').toBeTruthy();
    expect.soft(plain(rowOf(pa.tables, 'employees', { employee_id: EMP.a1 }))['stage'], 'A\'s row moves to ACTIVE').toBe('ACTIVE');
    expect.soft(plain(rowOf(pa.tables, 'employees', { employee_id: 'emp-b-0002-twin' }))['stage'], 'B\'s row with the same address is untouched').toBe('INVITED');
    // A person of B whose address is also on a row of A: only B's row moves (the company comes from the Member row,
    // not from the legacy rule).
    const twinB = tables();
    twinB['employees'] = [
      ...twinB['employees']!.map((r) => ((r['employee_id'] as any).S === EMP.b1 ? { ...r, stage: { S: 'INVITED' } } : r)),
      row({ employee_id: 'emp-a-0004-twin', first_name: 'Bea', last_name: 'Ndlovu', email: MAIL.b1, stage: 'INVITED', tenant_id: A, created_by: STAFF.hrA }),
    ];
    const paB = postAuth(SUB.b1, MAIL.b1, twinB);
    expect.soft(plain(rowOf(paB.tables, 'employees', { employee_id: EMP.b1 }))['stage'], 'a person of B: B\'s row moves to ACTIVE').toBe('ACTIVE');
    expect.soft(plain(rowOf(paB.tables, 'employees', { employee_id: 'emp-a-0004-twin' }))['stage'], 'and A\'s row with the same address is untouched').toBe('INVITED');
    // A member of A with the legacy rule off still moves to ACTIVE.
    const aOff = tables();
    aOff['employees'] = aOff['employees']!.map((r) => ((r['employee_id'] as any).S === EMP.a1 ? { ...r, stage: { S: 'INVITED' } } : r));
    const paOff = postAuth(SUB.a1, MAIL.a1, aOff, false);
    expect.soft(plain(rowOf(paOff.tables, 'employees', { employee_id: EMP.a1 }))['stage'], 'a member of A, legacy rule off: A\'s row moves to ACTIVE').toBe('ACTIVE');
    const noMember = tables();
    noMember[TENANTS] = noMember[TENANTS]!.filter((r) => (r['pk'] as any).S !== `USER#${SUB.a1}`);
    noMember['employees'] = noMember['employees']!.map((r) => ((r['employee_id'] as any).S === EMP.a1 ? { ...r, stage: { S: 'INVITED' } } : r));
    const off = postAuth(SUB.a1, MAIL.a1, noMember, false);
    expect.soft(off.response?.userName, 'no Member row, legacy off: the event comes back').toBe(SUB.a1);
    expect.soft(writesTo(off, 'employees'), 'and nothing is updated').toEqual([]);
    const skipped = logLines(off.calls).filter((l) => /Post sign-in skipped/.test(l));
    expect.soft(skipped.length, 'it logs "Post sign-in skipped"').toBeGreaterThan(0);
    expect.soft(skipped.join('\n'), 'the log holds the sub and a reason, never the address').not.toContain(MAIL.a1);
    expect.soft(skipped.join('\n'), 'the log holds the sub').toContain(SUB.a1);

    // sendNotificationEmail: a mismatched detail.tenant_id sends nothing.
    const notify = (tenant: string) => runHandler(handlerOf('sendNotificationEmail'), {
      version: '0', id: 'ten02-evt-2', 'detail-type': 'document.reviewed', source: 'naleko.onboarding', time: '2026-11-17T08:00:00Z',
      detail: { employee_id: EMP.a1, document_id: DOC.a1, document_type: 'BANK_CONFIRMATION', decision: 'FAILED', notes: 'Please upload again.', tenant_id: tenant },
    }, { tables: tables(), env: settings({ extra: { HR_EMAIL: 'hr@ten02.example' } }) });
    const right = notify(A);
    expect.soft(right.calls.filter((c: any) => c.service === 'postmark').length, `the same event saying company A sends the email, as today (got ${describe(right)})`).toBeGreaterThan(0);
    const forB = runHandler(handlerOf('sendNotificationEmail'), {
      version: '0', id: 'ten02-evt-3', 'detail-type': 'document.reviewed', source: 'naleko.onboarding', time: '2026-11-17T08:00:00Z',
      detail: { employee_id: EMP.b1, document_id: DOC.b1, document_type: 'BANK_CONFIRMATION', decision: 'FAILED', notes: 'Please upload again.', tenant_id: B },
    }, { tables: tables(), env: settings({ extra: { HR_EMAIL: 'hr@ten02.example' } }) });
    expect.soft(forB.calls.filter((c: any) => c.service === 'postmark').length, `B's event for B's employee sends the email (got ${describe(forB)})`).toBeGreaterThan(0);
    const wrong = notify(B);
    expect.soft(wrong.calls.filter((c: any) => c.service === 'postmark'), `a document.reviewed event saying company B for A's employee sends nothing (got ${describe(wrong)})`).toEqual([]);

    // processDocumentOCR stamps the verification with the document's company, read from the document row (the S3
    // event carries no company). A new document of B's employee, with AI calls switched off (no AI in tests).
    const OCR_DOC = 'doc_1763337600000';
    const ocrTables = tables();
    ocrTables['documents']!.push(row({
      employee_id: EMP.b1, document_id: OCR_DOC, document_type: 'BANK_CONFIRMATION', s3_key: `uploads/${EMP.b1}/BANK_CONFIRMATION/${OCR_DOC}_bank.pdf`,
      s3_bucket: 'ten02-uploads', ocr_status: 'PENDING', upload_timestamp: '2026-11-17T08:00:00.000Z', file_name: 'bank.pdf', tenant_id: B,
    }));
    const ocr = runHandler(handlerOf('processDocumentOCR'), {
      Records: [{ eventSource: 'aws:s3', eventName: 'ObjectCreated:Put', s3: { bucket: { name: 'ten02-uploads' }, object: { key: `uploads/${EMP.b1}/BANK_CONFIRMATION/${OCR_DOC}_bank.pdf` } } }],
    }, { tables: ocrTables, env: settings({ extra: { AI_CALLS_ENABLED: 'false' } }) });
    expect.soft(ocr.error, `processDocumentOCR finishes (got ${describe(ocr)})`).toBeUndefined();
    const vers = writesTo(ocr, 'document-verification').filter((w) => w.Item);
    expect.soft(vers.length, `processDocumentOCR writes the verification row (got ${describe(ocr)})`).toBeGreaterThan(0);
    for (const w of vers) expect.soft(w.Item.tenant_id?.S, 'the verification row carries the document\'s company, B').toBe(B);
    const ocrEvents = eventsOf(ocr);
    expect.soft(ocrEvents.length, 'processDocumentOCR publishes its events').toBeGreaterThan(0);
    for (const d of ocrEvents) expect.soft(d?.tenant_id, `the event ${JSON.stringify(d).slice(0, 60)} carries company B`).toBe(B);
    for (const u of ocr.calls.filter((c: any) => c.service === 'dynamodb' && c.op === 'UpdateItem' && c.table === 'employees').map((c: any) => c.input)) {
      expect.soft(Object.values(u.ExpressionAttributeValues ?? {}).some((v: any) => v?.S === B), 'an update of the employee row names company B').toBe(true);
    }
  });

  test('AC-6 Invites write the membership', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const create = (email: string, p = pool()) => ask('createEmployee', 'hrA', {
      method: 'POST', headers: { 'idempotency-key': `ten02-ac6-${email}` },
      body: { first_name: 'Sam', last_name: 'Doe', email, phone: '000 000 0000', department: 'Operations', job_title: 'Junior baker', hr_staff_id: STAFF.hrA },
    }, { cognito: p });
    const fresh = create('sam.doe@company-a.example');
    expect(statusOf(fresh), `a new person invited by HR of A: 201 (got ${describe(fresh)})`).toBe(201);
    const made = (fresh as any).cognito?.users?.find((u: any) => u.username === 'sam.doe@company-a.example');
    expect(made, 'the sign-in is created').toBeTruthy();
    const members = (fresh.tables[TENANTS] ?? []).filter((r) => (r['pk'] as any).S === `USER#${made.sub}`);
    expect(members.map((r) => (r['sk'] as any).S), 'one Member row for A').toEqual([`TENANT#${A}`]);
    const inviteRows = (fresh.tables['employee_invites'] ?? []).filter((r) => !tables()['employee_invites']!.some((o) => (o['token_hash'] as any).S === (r['token_hash'] as any).S));
    expect(inviteRows.length, 'one new invite row').toBe(1);
    expect(plain(inviteRows[0])['tenant_id'], 'the invite row carries A').toBe(A);
    const newEmp = (fresh.tables['employees'] ?? []).find((r) => (r['email'] as any)?.S === 'sam.doe@company-a.example');
    expect(plain(newEmp)['user_sub'], 'the employee row stores the sign-in id (AC-16)').toBe(made.sub);

    // An address whose sign-in belongs to company B: InviteRefused, nothing done.
    const p = pool();
    p.users.push({ username: 'kim.b@company-b.example', sub: 'sub-kim-b', status: 'FORCE_CHANGE_PASSWORD', attributes: { email: 'kim.b@company-b.example' }, groups: ['employee'] });
    const t = tables();
    t[TENANTS]!.push(row({ pk: 'USER#sub-kim-b', sk: `TENANT#${B}`, tenant_id: B }));
    const refused = ask('createEmployee', 'hrA', {
      method: 'POST', headers: { 'idempotency-key': 'ten02-ac6-kim' },
      body: { first_name: 'Kim', last_name: 'B', email: 'kim.b@company-b.example', phone: '000 000 0000', department: 'Operations', job_title: 'Junior baker', hr_staff_id: STAFF.hrA },
    }, { cognito: p, tables: t });
    expect(statusOf(refused), `an address of company B: 201 (got ${describe(refused)})`).toBe(201);
    expect.soft(JSON.stringify(bodyOf(refused)), 'the invite is not sent').toMatch(/"userCreated":false|InviteRefused|"sent":false/);
    expect.soft(refused.calls.filter((c: any) => c.service === 'postmark'), 'no email').toEqual([]);
    // ONB-04.2 tries AdminCreateUser first and reads the existing sign-in when the address is taken; that is fine.
    expect.soft(refused.calls.filter((c: any) => c.service === 'cognito' && /AdminAddUserToGroup|AdminRemoveUserFromGroup|AdminSetUserPassword|AdminUpdateUserAttributes|AdminDeleteUser/.test(c.op)), 'no group or sign-in change').toEqual([]);
    expect.soft(JSON.stringify((refused as any).cognito?.users), 'the pool is unchanged').toBe(JSON.stringify(p.users));
    expect.soft((refused.tables['employee_invites'] ?? []).length, 'no link').toBe(tables()['employee_invites']!.length);

    // HR of B invites a new person: the Member row and the invite row are B's, never the legacy company's.
    const byB = ask('createEmployee', 'hrB', {
      method: 'POST', headers: { 'idempotency-key': 'ten02-ac6-by-b' },
      body: { first_name: 'Sipho', last_name: 'B', email: 'sipho.b@company-b.example', phone: '000 000 0000', department: 'Operations', job_title: 'Junior baker', hr_staff_id: STAFF.hrB },
    });
    expect(statusOf(byB), `a new person invited by HR of B: 201 (got ${describe(byB)})`).toBe(201);
    const sipho = (byB as any).cognito?.users?.find((u: any) => u.username === 'sipho.b@company-b.example');
    expect(sipho, 'the sign-in is created').toBeTruthy();
    expect.soft((byB.tables[TENANTS] ?? []).filter((r) => (r['pk'] as any).S === `USER#${sipho.sub}`).map((r) => (r['sk'] as any).S), 'one Member row, for B').toEqual([`TENANT#${B}`]);
    const invB = (byB.tables['employee_invites'] ?? []).filter((r) => !tables()['employee_invites']!.some((o) => (o['token_hash'] as any).S === (r['token_hash'] as any).S));
    expect.soft(invB.map((r) => plain(r)['tenant_id']), 'one new invite row, carrying B').toEqual([B]);
    // HR of B never takes over a sign-in with no Member row while the legacy rule makes it A's.
    const pl = pool();
    pl.users = pl.users.map((u) => (u.username === MAIL.legacy ? { ...u, status: 'FORCE_CHANGE_PASSWORD' } : u));
    const takeover = ask('createEmployee', 'hrB', {
      method: 'POST', headers: { 'idempotency-key': 'ten02-ac6-takeover' },
      body: { first_name: 'Lee', last_name: 'Mokoena', email: MAIL.legacy, phone: '000 000 0000', department: 'Operations', job_title: 'Junior baker', hr_staff_id: STAFF.hrB },
    }, { cognito: pl });
    expect.soft(JSON.stringify(bodyOf(takeover)), `HR of B inviting the legacy person's unused sign-in: refused, not sent (got ${describe(takeover)})`).toMatch(/"userCreated":false|InviteRefused|"sent":false/);
    expect.soft((takeover.tables[TENANTS] ?? []).filter((r) => (r['pk'] as any).S === `USER#${SUB.legacy}`), 'and no Member row is written for it').toEqual(tables()[TENANTS]!.filter((r) => (r['pk'] as any).S === `USER#${SUB.legacy}`));
    expect.soft(takeover.calls.filter((c: any) => c.service === 'cognito' && /AdminAddUserToGroup|AdminSetUserPassword|AdminUpdateUserAttributes/.test(c.op)), 'and no group or sign-in change').toEqual([]);

    // Resend to an A person works.
    const t2 = tables();
    t2['employees'] = t2['employees']!.map((r) => ((r['employee_id'] as any).S === EMP.a1 ? { ...r, stage: { S: 'INVITED' } } : r));
    const p2 = pool();
    p2.users = p2.users.map((u) => (u.username === MAIL.a1 ? { ...u, status: 'FORCE_CHANGE_PASSWORD' } : u));
    const resend = ask('resendInvite', 'hrA', { method: 'POST', path: { id: EMP.a1 } }, { tables: t2, cognito: p2 });
    expect([200, 201], `resend to an A person works (got ${describe(resend)})`).toContain(statusOf(resend));
    expect.soft((bodyOf(resend) as any)?.status, 'resend answers ok').toBe('ok');
    // HR test logins are robots, so the email is skipped as a test send (ONB-18); a real send or that skip both count.
    expect.soft(JSON.stringify((bodyOf(resend) as any)?.email), 'the email is sent (or skipped as a test send)').toMatch(/"sent":true|"skipped":"test"/);
    const resent = (resend.tables['employee_invites'] ?? []).filter((r) => !t2['employee_invites']!.some((o) => (o['token_hash'] as any).S === (r['token_hash'] as any).S));
    expect.soft(resent.map((r) => plain(r)['tenant_id']), 'one new invite row, carrying A').toEqual([A]);
  });

  test('AC-7 Email checks are per company', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect(bodyOf(ask('checkEmployeeEmail', 'hrA', { query: { email: MAIL.b1 } })), 'an address used only in B is free in A').toEqual({ inUse: false });
    expect(bodyOf(ask('checkEmployeeEmail', 'hrA', { query: { email: MAIL.a2 } })), 'an address used in A is taken in A').toEqual({ inUse: true });
    expect(bodyOf(ask('checkEmployeeEmail', 'hrB', { query: { email: MAIL.a2 } })), 'and free in B').toEqual({ inUse: false });
    expect(bodyOf(ask('checkEmployeeEmail', 'hrB', { query: { email: MAIL.b1 } })), 'B\'s own address is taken in B').toEqual({ inUse: true });
    const dupB = ask('createEmployee', 'hrB', {
      method: 'POST', headers: { 'idempotency-key': 'ten02-ac7-b-dup' },
      body: { first_name: 'Bea', last_name: 'Ndlovu', email: MAIL.b1, phone: '000 000 0000', department: 'Operations', job_title: 'Junior baker', hr_staff_id: STAFF.hrB },
    });
    expect.soft(statusOf(dupB), `createEmployee in B with B's own address: the existing 409 (got ${describe(dupB)})`).toBe(409);
    const partners = ask('getHrPartners', 'hrA');
    expect(statusOf(partners), `GET /v1/hr-partners as HR of A: 200 (got ${describe(partners)})`).toBe(200);
    const ids = JSON.stringify(bodyOf(partners));
    expect(ids, 'A\'s HR is listed').toContain(STAFF.hrA);
    expect(ids, 'B\'s HR is not').not.toContain(STAFF.hrB);
    const withB = ask('createEmployee', 'hrA', {
      method: 'POST', headers: { 'idempotency-key': 'ten02-ac7-partner' },
      body: { first_name: 'Sam', last_name: 'Doe', email: 'sam.doe@company-a.example', phone: '000 000 0000', department: 'Operations', job_title: 'Junior baker', hr_staff_id: STAFF.hrB },
    });
    expect(statusOf(withB), `createEmployee with B's HR as partner: the unknown-partner 400 (got ${describe(withB)})`).toBe(400);
    const unknown = ask('createEmployee', 'hrA', {
      method: 'POST', headers: { 'idempotency-key': 'ten02-ac7-unknown' },
      body: { first_name: 'Sam', last_name: 'Doe', email: 'sam.doe@company-a.example', phone: '000 000 0000', department: 'Operations', job_title: 'Junior baker', hr_staff_id: 'NOSUCH01' },
    });
    expect(bodyOf(withB), 'the same answer as for a partner that does not exist').toEqual(bodyOf(unknown));
    expect(withB.tables['employees']!.length, 'no employee row is written').toBe(tables()['employees']!.length);
    // createEmployee's own duplicate check is per company too.
    const add = (email: string, key: string) => ask('createEmployee', 'hrA', {
      method: 'POST', headers: { 'idempotency-key': key },
      body: { first_name: 'Sam', last_name: 'Doe', email, phone: '000 000 0000', department: 'Operations', job_title: 'Junior baker', hr_staff_id: STAFF.hrA },
    });
    const freeInA = add(MAIL.b1, 'ten02-ac7-b-address');
    expect.soft(statusOf(freeInA), `createEmployee in A with an address used only in B: 201 (got ${describe(freeInA)})`).toBe(201);
    expect.soft(JSON.stringify(bodyOf(freeInA)), 'and the answer names nothing of B\'s').not.toContain(EMP.b1);
    const takenInA = add(MAIL.a2, 'ten02-ac7-a-address');
    expect.soft(statusOf(takenInA), `createEmployee in A with an address used in A: the existing 409 (got ${describe(takenInA)})`).toBe(409);
  });

  test('AC-8 Idempotency is per company', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const body = (email: string, staff: string) => ({ first_name: 'Sam', last_name: 'Doe', email, phone: '000 000 0000', department: 'Operations', job_title: 'Junior baker', hr_staff_id: staff });
    const key = { 'idempotency-key': 'ten02-same-key-0001' };
    const t0 = tables();
    t0['naleko-idempotency-keys'] = [];
    const fromA = ask('createEmployee', 'hrA', { method: 'POST', headers: key, body: body('sam.a@company-a.example', STAFF.hrA) }, { tables: t0 });
    expect(statusOf(fromA), `A: 201 (got ${describe(fromA)})`).toBe(201);
    const fromB = ask('createEmployee', 'hrB', { method: 'POST', headers: key, body: body('sam.b@company-b.example', STAFF.hrB) }, { tables: fromA.tables, cognito: (fromA as any).cognito });
    expect(statusOf(fromB), `B with the same key: 201, a new employee (got ${describe(fromB)})`).toBe(201);
    const emails = fromB.tables['employees']!.map((r) => plain(r)).filter((r) => /^sam\.[ab]@/.test(String(r['email'])));
    expect(emails.map((r) => `${r['email']} ${r['tenant_id']}`).sort(), 'two employees, one in each company').toEqual([`sam.a@company-a.example ${A}`, `sam.b@company-b.example ${B}`]);
    const keys = (fromB.tables['naleko-idempotency-keys'] ?? []).map((r) => plain(r)['idempotencyKey']);
    expect(keys.sort(), 'P4: the stored keys are TENANT#<id>#<client key>').toEqual([`TENANT#${A}#ten02-same-key-0001`, `TENANT#${B}#ten02-same-key-0001`]);
    const replay = ask('createEmployee', 'hrA', { method: 'POST', headers: key, body: body('sam.a@company-a.example', STAFF.hrA) }, { tables: fromB.tables, cognito: (fromB as any).cognito });
    expect(bodyOf(replay), 'a replay from A returns A\'s first answer').toEqual(bodyOf(fromA));
    expect(JSON.stringify(bodyOf(replay)), 'never B\'s').not.toContain('sam.b@');
    const replayB = ask('createEmployee', 'hrB', { method: 'POST', headers: key, body: body('sam.b@company-b.example', STAFF.hrB) }, { tables: fromB.tables, cognito: (fromB as any).cognito });
    expect(bodyOf(replayB), 'a replay from B returns B\'s first answer').toEqual(bodyOf(fromB));
    expect(JSON.stringify(bodyOf(replayB)), 'never A\'s').not.toContain('sam.a@');
  });

  test('AC-9 Batsi chat only for the agent key\'s company', async ({}, testInfo) => {
    once(testInfo.project.name);
    const chat = (caller: Caller) => ask('nalekoAiChat', caller, { method: 'POST', body: { message: 'Who is starting this week?', conversationId: 'ten02-conv' } });
    const b = chat('hrB');
    expect(statusOf(b), `HR of B: 403 (got ${describe(b)})`).toBe(403);
    expect(bodyOf(b), '{"error":"Forbidden"}').toEqual(FORBIDDEN);
    expect(awsCalls(b.calls).filter((c) => !/^log/.test(c)), 'no AI guard read, no Bedrock, no Agent API call: nothing at all').toEqual([]);
    const a = chat('hrA');
    expect(statusOf(a), `HR of A: unchanged, 200 on the AI-skipped robot path (got ${describe(a)})`).toBe(200);
    expect(a.calls.filter((c: any) => /bedrock|ai/.test(c.service)), 'no AI call for a robot').toEqual([]);
  });

  test('AC-10 The backfill is safe', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const SCRIPT = join(REPO, 'scripts', 'tenancy', 'backfill.mjs');
    expect(existsSync(SCRIPT), 'scripts/tenancy/backfill.mjs exists').toBe(true);
    // World: pool users (one without a Member row), rows of every kind, some already stamped.
    const t = tables();
    t['external-verification-requests'] = [row({ request_id: 'req-l-1', document_id: DOC.legacy }), row({ request_id: 'req-a-1', document_id: DOC.a1, tenant_id: A })];
    t['naleko-agent-audit'] = [row({ pk: 'AUDIT#1', sk: '2026-11-01', action: 'read' })];
    t['naleko-pending-actions']!.push(row({ actionId: 'act-l-1', status: 'PENDING_APPROVAL' }));
    const p = pool();
    const run = (args: string[], world: { tables: Tables; cognito: any }) => {
      const out = runBackfill(SCRIPT, args, world);
      return out;
    };
    const base = ['--env', 'dev', '--tenant', A, '--pool', POOL];
    const dry = run(base, { tables: t, cognito: p });
    expect(dry.code, `the dry run exits 0 (output: ${dry.stdout.slice(-400)}${dry.stderr.slice(-400)})`).toBe(0);
    expect(dry.writes, 'the dry run writes nothing').toEqual([]);
    for (const secret of [...Object.values(MAIL), ...Object.values(EMP), ...Object.values(SUB), DOC.a1, DOC.legacy, 'Lee', 'Mokoena', 'John']) {
      expect.soft(dry.stdout + dry.stderr, `the dry run prints no ${secret}`).not.toContain(secret);
    }
    expect.soft(dry.stdout, 'counts only: no number longer than the counts (no id or phone)').not.toMatch(/\d{5,}/);
    const before = run([...base, '--check'], { tables: t, cognito: p });
    expect(before.code, 'check before apply exits 1').toBe(1);
    const applied = run([...base, '--apply'], { tables: t, cognito: p });
    expect(applied.code, `apply exits 0 (${applied.stderr.slice(-300)})`).toBe(0);
    for (const [table, rows] of Object.entries(applied.tables)) {
      if (!['employees', 'documents', 'employee_invites', 'document-verification', 'external-verification-requests', 'naleko-agent-audit', 'naleko-pending-actions'].includes(table)) continue;
      for (const r of rows) expect.soft(plain(r)['tenant_id'], `${table}: every row carries a company after apply`).toBeTruthy();
    }
    const stampedBefore = (table: string) => (t[table] ?? []).filter((r) => r['tenant_id']);
    // An already-stamped row is left exactly as it was (only an employee's empty user_sub may be filled), in every table.
    const sameRow = (x: Record<string, unknown>) => JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'user_sub').sort(([a], [b]) => a.localeCompare(b))));
    for (const table of ['employees', 'documents', 'employee_invites', 'document-verification', 'external-verification-requests', 'naleko-agent-audit', 'naleko-pending-actions']) {
      for (const r of stampedBefore(table)) {
        expect.soft((applied.tables[table] ?? []).some((x) => sameRow(x) === sameRow(r)), `${table}: an already-stamped row keeps its company and stays as it was`).toBe(true);
      }
    }
    // Every sign-in ends with a company: one that had a Member row keeps exactly its rows (HR of B is never made a
    // member of A), and one that had none gets exactly one, for the founding company.
    const memberSks = (tt: Tables, sub: string) => (tt[TENANTS] ?? []).filter((r) => (r['pk'] as any).S === `USER#${sub}`).map((r) => (r['sk'] as any).S).sort();
    for (const u of p.users) {
      const had = memberSks(t, u.sub);
      expect.soft(memberSks(applied.tables, u.sub), `pool user ${u.sub}: ${had.length ? 'keeps exactly its Member rows' : 'one Member row, for A'}`).toEqual(had.length ? had : [`TENANT#${A}`]);
    }
    expect.soft(memberSks(applied.tables, SUB.hrB), 'HR of B stays a member of B only').toEqual([`TENANT#${B}`]);

    expect.soft(plain(rowOf(applied.tables, 'employees', { employee_id: EMP.b1 }))['tenant_id'], 'B\'s row is untouched').toBe(B);
    expect.soft(plain(rowOf(applied.tables, 'employees', { employee_id: EMP.legacy }))['user_sub'], 'the legacy employee gets user_sub from the pool (AC-16)').toBe(SUB.legacy);
    const again = run([...base, '--apply'], { tables: applied.tables, cognito: applied.cognito });
    expect(again.writes, 'a second apply changes nothing').toEqual([]);
    const after = run([...base, '--check'], { tables: applied.tables, cognito: applied.cognito });
    expect(after.code, `check after apply exits 0 (${after.stdout.slice(-300)})`).toBe(0);
    // Check fails on each gap by itself: one row without a company, or one sign-in without a Member row.
    const oneUnstamped = structuredClone(applied.tables);
    delete oneUnstamped['documents']!.find((r) => (r['document_id'] as any).S === DOC.a1)!['tenant_id'];
    expect.soft(run([...base, '--check'], { tables: oneUnstamped, cognito: applied.cognito }).code, 'check exits 1 when one document row has no company').toBe(1);
    const oneNoMember = { ...applied.tables, [TENANTS]: applied.tables[TENANTS]!.filter((r) => (r['pk'] as any).S !== `USER#${SUB.a1}`) };
    expect.soft(run([...base, '--check'], { tables: oneNoMember, cognito: applied.cognito }).code, 'check exits 1 when one sign-in has no Member row').toBe(1);
    const oneNoOwner = structuredClone(applied.tables);
    delete oneNoOwner['employees']!.find((r) => (r['employee_id'] as any).S === EMP.legacy)!['user_sub'];
    expect.soft(run([...base, '--check'], { tables: oneNoOwner, cognito: applied.cognito }).code, 'check exits 1 when one employee with a sign-in has no user_sub').toBe(1);
    // P11: a sign-in whose email is not verified never becomes a row's owner (an unverified address may be someone
    // else's). The row still has a sign-in without user_sub, so check keeps failing until it is settled by hand.
    const unv = structuredClone(applied.tables);
    unv['employees']!.push(row({ employee_id: 'emp-a-0009-una', first_name: 'Una', last_name: 'Khumalo', email: 'una.unverified@company-a.example', stage: 'INVITED', tenant_id: A }));
    const pUnv = structuredClone(applied.cognito);
    pUnv.users.push({ username: 'una.unverified@company-a.example', sub: 'sub-una', status: 'CONFIRMED', attributes: { email: 'una.unverified@company-a.example', email_verified: 'false' }, groups: ['employee'] });
    unv[TENANTS]!.push(row({ pk: 'USER#sub-una', sk: `TENANT#${A}`, tenant_id: A }));
    const unvApplied = run([...base, '--apply'], { tables: unv, cognito: pUnv });
    expect.soft(plain(rowOf(unvApplied.tables, 'employees', { employee_id: 'emp-a-0009-una' }))['user_sub'], 'an unverified sign-in never becomes a row\'s owner').toBeUndefined();
    expect.soft(run([...base, '--check'], { tables: unvApplied.tables, cognito: unvApplied.cognito }).code, 'and check still exits 1 for that row').toBe(1);
    // Misses are counted: an employee row whose email has no sign-in changes the counts the dry run prints.
    const withMiss = structuredClone(t);
    withMiss['employees']!.push(row({ employee_id: 'emp-l-0003-nosignin', first_name: 'Pat', last_name: 'Nkosi', email: 'pat.nosignin@company-a.example', stage: 'NEW', tenant_id: A }));
    const countsOf = (out: string) => (out.match(/\d+/g) ?? []).map(Number).reduce((a, b) => a + b, 0);
    const dryMiss = run(base, { tables: withMiss, cognito: p });
    expect.soft(dryMiss.stdout, 'the dry run names no address of a row without a sign-in').not.toContain('pat.nosignin');
    expect.soft(countsOf(dryMiss.stdout), 'a row without a sign-in is counted (the counts change)').toBeGreaterThan(countsOf(dry.stdout));

    // P9: prod has no company row yet (TEN-01 left it to this backfill). Apply writes the founding company's row
    // with the same fields as the dev seed, once; check fails without it; another company's row is never touched.
    const bare = applied.tables;
    const noProfile = { ...bare, [TENANTS]: bare[TENANTS]!.filter((r) => !((r['pk'] as any).S === `TENANT#${A}` && (r['sk'] as any).S === 'PROFILE')) };
    const missing = run([...base, '--check'], { tables: noProfile, cognito: applied.cognito });
    expect.soft(missing.code, 'check exits 1 while the founding company has no row').toBe(1);
    const made = run([...base, '--apply'], { tables: noProfile, cognito: applied.cognito });
    const prof = rowOf(made.tables, TENANTS, { pk: `TENANT#${A}`, sk: 'PROFILE' });
    const pr = plain(prof);
    expect.soft([pr['tenant_id'], pr['name'], pr['status'], pr['country'], pr['founding']], 'apply writes TENANT#<id>/PROFILE: Founding client, ACTIVE, ZA, founding').toEqual([A, 'Founding client', 'ACTIVE', 'ZA', true]);
    expect.soft(made.writes.filter((w) => w.endsWith(TENANTS)).length, 'one write to the tenants table').toBe(1);
    expect.soft(JSON.stringify(rowOf(made.tables, TENANTS, { pk: `TENANT#${B}`, sk: 'PROFILE' })), 'B\'s company row is untouched').toBe(JSON.stringify(rowOf(noProfile, TENANTS, { pk: `TENANT#${B}`, sk: 'PROFILE' })));
    const madeAgain = run([...base, '--apply'], { tables: made.tables, cognito: made.cognito });
    expect.soft(madeAgain.writes, 'and a second apply writes nothing').toEqual([]);
  });

  test('AC-12 The retrofit list is empty for onboarding', async ({}, testInfo) => {
    once(testInfo.project.name);
    const list: string[] = JSON.parse(readFileSync(join(LAMBDA, 'shared', 'tenant-retrofit.json'), 'utf8'));
    const RULE_ABC = ['checkEmployeeEmail', 'classifyOnboardingRisk', 'createEmployee', 'generateDocumentUploadUrl', 'getBatchRiskReport', 'getDocumentPresignedUrl',
      'getDocumentVerifications', 'getEmployee', 'getEmployeeByEmail', 'getEmployeeDocumentVerifications', 'getEmployees', 'getHrPartners', 'getSingleDocumentVerification',
      'nalekoAiChat', 'reviewDocumentVerification', 'summariseVerification', 'triggerExternalVerification', 'queryAuditLog', 'approveAgentAction', 'resendInvite', 'getInvite',
      'recordConsent', 'getMyStart', 'lookupInvite', 'redeemInvite', 'cognitoPostAuth', 'processDocumentOCR', 'sendNotificationEmail', 'auditLogConsumer', 'uploadDocumentToS3'];
    expect(list.filter((n) => RULE_ABC.includes(n)), 'tenant-retrofit.json holds none of the rule A, B or C Lambdas').toEqual([]);
    // P12: only lookupEmployeeEmail may stay. It is the old portal's public look-up before sign-in (no token, so no
    // company); TEN-08 stopped using it, and removing it is a later card's.
    expect(list.filter((n) => n !== 'lookupEmployeeEmail'), 'tenant-retrofit.json holds nothing but lookupEmployeeEmail').toEqual([]);
    const out = execFileSync('npm', ['test', '--silent'], { cwd: join(LAMBDA, 'shared'), encoding: 'utf8', env: { ...process.env, CI: '1' } });
    expect(out, 'lambda/shared npm test (TEN-01\'s CI check) passes').not.toMatch(/not ok|failing|✖/);
  });

  test('AC-13 Roles hold exactly this', async ({}, testInfo) => {
    once(testInfo.project.name);
    const kmsRead = attributes(blocks(all(), 'module').find((b) => b.labels[0] === 'kms_pii')!.body).get('dynamodb_read_role_arns') ?? '';
    const tableLabel = (name: string) => resources('aws_dynamodb_table').find((b) => attributes(b.body).get('name') === `"${name}"`)?.labels[1] ?? '';
    const TENANTS_LABEL = 'tenants';
    const isTenants = (r: string) => r.includes(`aws_dynamodb_table.${TENANTS_LABEL}.`) || /-tenants(\/|"|$)/.test(r);
    const indexOf = (r: string) => /\/index\/([\w-]+)/.exec(r)?.[1];
    const MEMBER_WRITERS = ['createEmployee', 'resendInvite'];

    // What the handlers actually ask for on the fake (as HR of B, so the company index is used): handler -> tables
    // Queried on tenant-index, and handlers that Query the tenants table.
    const used = new Map<string, Set<string>>();
    const note = (h: string, r: Run) => {
      for (const c of r.calls as any[]) {
        if (c.service !== 'dynamodb' || c.op !== 'Query') continue;
        const key = c.table === TENANTS ? 'tenants' : c.input?.IndexName === 'tenant-index' ? c.table : '';
        if (!key) continue;
        if (!used.has(h)) used.set(h, new Set());
        used.get(h)!.add(key);
      }
    };
    for (const route of BY_ID) note(route.handler, askRoute(route, 'hrB', 'b'));
    for (const h of ['getEmployees', 'getDocumentVerifications', 'getBatchRiskReport', 'getHrPartners']) note(h, ask(h, 'hrB'));
    note('createEmployee', ask('createEmployee', 'hrA', { method: 'POST', headers: { 'idempotency-key': 'ten02-ac13-create' }, body: { first_name: 'Sam', last_name: 'Doe', email: 'sam.doe@company-a.example', phone: '000 000 0000', department: 'Operations', job_title: 'Junior baker', hr_staff_id: STAFF.hrA } }));
    note('getHrPartners', ask('getHrPartners', 'hrA'));
    expect(used.size, 'the handlers read the company index or the tenants table at all').toBeGreaterThan(0);

    for (const [h, tables] of used) {
      const role = roleOf(lambdaNamed(h));
      const { statements } = grants(role);
      for (const t of tables) {
        const wanted = t === 'tenants' ? (r: string) => isTenants(r) && !indexOf(r) : (r: string) => r.includes(`aws_dynamodb_table.${tableLabel(t)}.`) || r.includes(`table/${t}/`) ;
        const ok = statements.some((s) => s.Effect === 'Allow' && list(s.Action).includes('dynamodb:Query') && list(s.Resource).some((r) => wanted(r) && (t === 'tenants' || indexOf(r) === 'tenant-index')));
        expect.soft(ok, `${h} (role ${role}) may Query ${t === 'tenants' ? 'the tenants table' : `${t}/index/tenant-index`}, which it does`).toBe(true);
      }
    }

    // Every role that touches the tenants table: only Query (PutItem for the two that write Member rows), only on the
    // table and its tenant-index, and it can read the PII key through dynamodb_read_role_arns (or already could).
    const roles = new Set(resources('aws_iam_role').map((b) => b.labels[1]!));
    const MOD01_READERS = ['get_company_modules', 'get_candidate_events', 'get_hiring_managers'];
    let touching = 0;
    for (const role of roles) {
      if (role === 'tenant_pre_token') continue; // TEN-01, locked there.
      const policies = resources('aws_iam_role_policy').filter((b) => new RegExp(`^aws_iam_role\\.${role}\\.(name|id)$`).test(attributes(b.body).get('role') ?? ''));
      if (!policies.some((b) => /aws_dynamodb_table\.tenants\.|-tenants\b/.test(stripComments(b.body)))) continue;
      const { statements } = grants(role);
      const mine = statements.filter((s) => list(s.Resource).some(isTenants));
      if (!mine.length) continue;
      touching++;
      const fn = resources('aws_lambda_function').find((b) => (attributes(b.body).get('role') ?? '') === `aws_iam_role.${role}.arn`);
      const fnName = (fn ? attributes(fn.body).get('function_name') ?? '' : '').replace(/"/g, '');
      for (const s of mine) {
        // MOD-01 rule 8 (re-locked by acceptance-lock/mod-01): the modules read adds GetItem for the Recruitment Lambdas of this stack.
        const allowed = [...(MEMBER_WRITERS.includes(fnName) ? ['dynamodb:Query', 'dynamodb:PutItem'] : ['dynamodb:Query']), ...(MOD01_READERS.includes(role) ? ['dynamodb:GetItem'] : [])];
        expect.soft(list(s.Action).filter((a) => !allowed.includes(a)), `${role}: on the tenants table only ${allowed.join(' and ')}`).toEqual([]);
        expect.soft(list(s.Resource).filter((r) => !(isTenants(r) && (!indexOf(r) || indexOf(r) === 'tenant-index'))), `${role}: tenants statement names only the table and its tenant-index`).toEqual([]);
        expect.soft(s.Condition, `${role}: tenants statement has no condition to widen it`).toBeUndefined();
        if (list(s.Action).includes('dynamodb:PutItem')) expect.soft(list(s.Resource).filter((r) => indexOf(r)), `${role}: PutItem names the table, never an index`).toEqual([]);
        if (list(s.Action).includes('dynamodb:GetItem')) expect.soft(list(s.Resource).filter((r) => indexOf(r)), `${role}: GetItem names the table, never an index`).toEqual([]);
      }
      // New KMS access goes through the read list only. These roles already held the PII key themselves at develop
      // 48fe4c6 (infra/iam_per_lambda.tf), before this card; that grant is not new.
      const KMS_BEFORE = ['archive_audit_log', 'audit_log_consumer', 'classify_onboarding_risk', 'create_employee', 'generate_document_upload_url', 'get_batch_risk_report',
        'get_document_presigned_url', 'get_document_verifications', 'get_employee', 'get_employee_by_email', 'get_employee_document_verifications', 'get_employees',
        'get_single_document_verification', 'lookup_employee_email', 'process_document_ocr', 'review_document_verification', 'send_notification_email',
        'summarise_verification', 'trigger_external_verification', 'upload_document_to_s3'];
      expect.soft(kmsRead.includes(`aws_iam_role.${role}.arn`) || KMS_BEFORE.includes(role), `${role} reads the PII-encrypted tenants table: through kms_pii dynamodb_read_role_arns (or held the key before this card)`).toBe(true);
      for (const s of statements) {
        expect.soft(list(s.Action).filter((a) => /\*/.test(a)), `${role}: no wildcard action`).toEqual([]);
        if (list(s.Resource).includes('*')) expect.soft(list(s.Action).every((a) => XRAY.has(a)), `${role}: Resource "*" only for X-Ray`).toBe(true);
      }
    }
    expect(touching, 'some roles now read the tenants table').toBeGreaterThan(0);
    // Every role policy as it was on develop 48fe4c6 (support/ten-02/iam-48fe4c6, copies of infra/*.tf then): each one
    // still holds what it held, and anything new is a TEN-02 grant (section E). A dropped Scan is fine only where the
    // role gained the company index Query on that table.
    const baseDir = join(__dirname, 'support', 'ten-02', 'iam-48fe4c6');
    const baseFiles = readdirSync(baseDir).map((f) => join(baseDir, f));
    const names = [...new Set(baseFiles.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/resource\s+"aws_iam_role_policy"\s+"(\w+)"/g)].map((m) => m[1]!)))];
    expect(names.length, 'the develop baseline holds the role policies').toBeGreaterThan(20);
    for (const name of names) {
      if (name === 'tenant_pre_token') continue; // TEN-01, locked there.
      const before = resourcesNamed('aws_iam_role_policy', name, baseFiles);
      const now = resourcesNamed('aws_iam_role_policy', name);
      expect.soft(now.length, `role policy ${name} is still there, once`).toBe(1);
      if (before.length !== 1 || now.length !== 1) continue;
      let wrong: string[];
      try {
        wrong = onlyTenancyAdded(before[0]!, now[0]!);
      } catch {
        // A policy the reader cannot parse (ai_brake_budgets uses a conditional): it must be unchanged.
        wrong = tfSquash(before[0]!.body) === tfSquash(now[0]!.body) ? [] : ['changed, and the policy reader cannot read it'];
      }
      expect.soft(wrong, `role policy ${name}: only TEN-02's grants added`).toEqual([]);
    }
    // The PII key's role lists stay lists of roles (nothing else joins them).
    // Re-locked by TEN-03: the TalentFlow pre-token trigger's role lives in the other Terraform stack (talent-flow-infra), so it
    // cannot be written as aws_iam_role.<name>.arn. It may appear as one quoted role ARN naming talentFlowPreTokenTrigger, nothing else quoted.
    // Re-locked by MOD-01 (rule 8): the TalentFlow Lambdas that read the modules join as quoted role ARNs with the role path, named one by one.
    const MOD01_TF = 'getCandidate|updateCandidate|advanceCandidateStage|scheduleInterview|submitVote|captureSentiment|generateScoringLink|getOffer|createOffer|advanceOfferState|dismissTile|snoozeTile|acknowledgeTile|getCandidates|createCandidate|getIntelligenceTiles|manageTalentFlowConfig|getUserNotifications|markNotificationRead|getPanelMembers|talentFlowApproveAction|talentFlowAiChat|submitVoteByToken|evaluateIntelligenceRules|sendTalentFlowNotification|orchestrateTalentFlowWorkflow';
    expect(squash(kmsRead), 'dynamodb_read_role_arns is a list of aws_iam_role.<name>.arn (and, since TEN-03, one quoted ARN of the TalentFlow pre-token trigger role; since MOD-01, the quoted ARNs of the TalentFlow Lambdas that read the modules)').toMatch(new RegExp(`^\\[(?:(?:aws_iam_role\\.\\w+\\.arn|"arn:aws:iam::[^":,\\]]*:role\\/[^":,\\]]*talentFlowPreTokenTrigger[^":,\\]]*"|"arn:aws:iam::\\$\\{var\\.aws_account_id\\}:role\\/talent-flow\\/talent-flow-role-(?:${MOD01_TF})"),?)+\\]$`));
  });

  test('AC-16 The owner is matched on the sign-in id', async ({}, testInfo) => {
    once(testInfo.project.name);
    const own = ask('getEmployeeDocumentVerifications', 'empA', { path: { id: EMP.a1 } });
    expect.soft(statusOf(own), `an employee with user_sub = their sub sees their own documents (got ${describe(own)})`).toBe(200);
    // Same email, another sub: refused.
    const impostor = tables();
    impostor['employees'] = impostor['employees']!.map((r) => ((r['employee_id'] as any).S === EMP.a1 ? { ...r, user_sub: { S: 'sub-someone-else' } } : r));
    const r1 = ask('getEmployeeDocumentVerifications', 'empA', { path: { id: EMP.a1 } }, { tables: impostor });
    expect.soft(statusOf(r1), `token email = row email but another sub: the owner refusal (got ${describe(r1)})`).toBe(403);
    const noSub = tables();
    noSub['employees'] = noSub['employees']!.map((r) => {
      if ((r['employee_id'] as any).S !== EMP.a1) return r;
      const { user_sub, ...rest } = r;
      void user_sub;
      return rest;
    });
    const r2 = ask('getEmployeeDocumentVerifications', 'empA', { path: { id: EMP.a1 } }, { tables: noSub });
    expect.soft(statusOf(r2), `a row without user_sub refuses every non-HR caller (got ${describe(r2)})`).toBe(403);
    const r3 = ask('getEmployeeDocumentVerifications', 'empA', { path: { id: 'emp-x-does-not-exist' } });
    expect.soft(statusOf(r3), `a non-HR caller and an unknown id: 403 (got ${describe(r3)})`).toBe(403);
    expect.soft(bodyOf(r3), '{"error":"Forbidden"}').toEqual(FORBIDDEN);
    // P2: another company's record looks exactly like an unknown one to a non-HR caller.
    const r4 = ask('getEmployeeDocumentVerifications', 'empA', { path: { id: EMP.b1 } });
    expect.soft(`${statusOf(r4)} ${JSON.stringify(bodyOf(r4))}`, 'B\'s record answers as an unknown id').toBe(`${statusOf(r3)} ${JSON.stringify(bodyOf(r3))}`);
    // The employee's own document link works on the sub, and a stranger's sub gets nothing.
    const doc = ask('getDocumentPresignedUrl', 'empA', { path: { id: DOC.a1 } });
    expect.soft(statusOf(doc), `the owner opens their own document (got ${describe(doc)})`).toBe(200);
    const docImpostor = ask('getDocumentPresignedUrl', 'empA', { path: { id: DOC.a1 } }, { tables: impostor });
    expect.soft(statusOf(docImpostor), `another sub cannot (got ${describe(docImpostor)})`).toBe(403);
    expect.soft(sideEffects(docImpostor.calls), 'and nothing is presigned').toEqual([]);
    // createEmployee for an address that already has a sign-in (no company yet): the new row stores that sign-in's sub.
    const p = pool();
    p.users.push({ username: 'kim.a@company-a.example', sub: 'sub-kim-a', status: 'FORCE_CHANGE_PASSWORD', attributes: { email: 'kim.a@company-a.example', email_verified: 'true' }, groups: [] });
    const existing = ask('createEmployee', 'hrA', {
      method: 'POST', headers: { 'idempotency-key': 'ten02-ac16-existing' },
      body: { first_name: 'Kim', last_name: 'A', email: 'kim.a@company-a.example', phone: '000 000 0000', department: 'Operations', job_title: 'Junior baker', hr_staff_id: STAFF.hrA },
    }, { cognito: p });
    expect.soft(statusOf(existing), `createEmployee for an address with a sign-in: 201 (got ${describe(existing)})`).toBe(201);
    const kim = (existing.tables['employees'] ?? []).find((r) => (r['email'] as any)?.S === 'kim.a@company-a.example');
    expect.soft(plain(kim)['user_sub'], 'the existing-user invite path writes the sign-in\'s sub as user_sub').toBe('sub-kim-a');
  });

  test('AC-14 A second company sees nothing @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    const env = (k: string) => process.env[k] ?? '';
    const hrB = { email: env('E2E_HR_B_EMAIL'), password: env('E2E_HR_B_PASSWORD') };
    const hrA = { email: env('E2E_HR_EMAIL'), password: env('E2E_HR_PASSWORD') };
    expect(hrB.email, 'the seed made a company B HR login (E2E_HR_B_EMAIL)').toBeTruthy();
    const { api, docApi, clientId, region } = devEnv();
    const signIn = async (login: { email: string; password: string }) => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: login.email, PASSWORD: login.password } }),
      });
      expect(r.status(), 'signs in at Cognito').toBe(200);
      return ((await r.json()) as any).AuthenticationResult.IdToken as string;
    };
    const tokB = await signIn(hrB);
    const tokA = await signIn(hrA);
    const get = (path: string, tok: string, base = api) => page.request.get(`${base}${path}`, { headers: { Authorization: `Bearer ${tok}` } });
    const seeded = JSON.parse(readFileSync(join(__dirname, 'support', 'ten-02', 'dev-ids.json'), 'utf8')) as { naledi: string; naledi_bank_doc: string };
    const listB = await get('/v1/employees', tokB);
    expect(listB.status(), 'GET /v1/employees as HR of B: 200').toBe(200);
    const bodyB = JSON.stringify(await listB.json());
    expect(bodyB, 'B never sees Naledi (company A)').not.toContain(seeded.naledi);
    const listA = await get('/v1/employees', tokA);
    expect(listA.status(), 'GET /v1/employees as HR of A: 200 as before').toBe(200);
    const idsA = idsIn(await listA.json());
    expect(idsA, 'HR of A still lists Naledi').toContain(seeded.naledi);
    // B's list is empty or B's own: none of the people HR of A lists.
    for (const id of idsA) expect.soft(bodyB, `B's list holds none of A's people (${id})`).not.toContain(id);
    expect((await get(`/v1/employees/${seeded.naledi}/verifications`, tokB, docApi)).status(), 'GET /v1/employees/<Naledi>/verifications as HR of B: 404').toBe(404);
    expect((await get(`/v1/documents/${seeded.naledi_bank_doc}/url`, tokB, docApi)).status(), 'GET /v1/documents/<Naledi\'s bank doc>/url as HR of B: 404').toBe(404);
    expect((await get(`/v1/employees/${seeded.naledi}/verifications`, tokA, docApi)).status(), 'GET /v1/employees/<Naledi>/verifications as HR of A: 200 as before').toBe(200);
    expect((await get(`/v1/documents/${seeded.naledi_bank_doc}/url`, tokA, docApi)).status(), 'as HR of A: 200 as before').toBe(200);
  });

  test('AC-15 Everything carries a company @pepla-dev', async ({}, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    // Outside the locked test folder, so recording it needs no re-lock.
    const counts = join(REPO, 'scripts', 'tenancy', 'dev-backfill-check.json');
    test.skip(!existsSync(counts), 'The merger records the dev backfill --check counts in scripts/tenancy/dev-backfill-check.json after the dev backfill; not recorded yet.');
    const c = JSON.parse(readFileSync(counts, 'utf8')) as { exit: number; missing: Record<string, number> };
    expect(c.exit, 'backfill.mjs --env dev --check exited 0').toBe(0);
    expect(Object.values(c.missing).every((n) => n === 0), 'nothing is missing a company').toBe(true);
  });
});

// ---------------------------------------------------------------- the backfill runner (fake AWS, fresh process)

/** Runs scripts/tenancy/backfill.mjs against the fake AWS. Returns its exit code, output, the writes it made and the world after. */
function runBackfill(script: string, args: string[], world: { tables: Tables; cognito: any }) {
  const dir = mkdtempSync(join(tmpdir(), 'ten-02-backfill-'));
  const worldFile = join(dir, 'world.json');
  writeFileSync(worldFile, JSON.stringify({ tables: structuredClone(world.tables), cognito: structuredClone(world.cognito), pageSize: 3 }));
  const fake = join(__dirname, 'support', 'ten-02', 'fake-aws');
  let code = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync(process.execPath, ['--no-warnings', '--import', join(fake, 'register.mjs'), join(fake, 'script-run.mjs'), script, ...args], {
      cwd: dir, encoding: 'utf8', timeout: 60_000,
      env: { PATH: process.env['PATH'] ?? '', TEN02_WORLD: worldFile, TEN02_WORLD_OUT: join(dir, 'after.json'), AWS_REGION: 'af-south-1', AWS_ACCESS_KEY_ID: 'ten02-fake', AWS_SECRET_ACCESS_KEY: 'ten02-fake', COGNITO_POOL_ID: POOL },
    });
  } catch (e: any) {
    code = e.status ?? 1;
    stdout = String(e.stdout ?? '');
    stderr = String(e.stderr ?? '');
  }
  const after = existsSync(join(dir, 'after.json')) ? JSON.parse(readFileSync(join(dir, 'after.json'), 'utf8')) : { tables: world.tables, cognito: world.cognito, calls: [] };
  const writes = (after.calls ?? []).filter((c: any) => c.service === 'dynamodb' && /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems/.test(c.op)).map((c: any) => `${c.op} ${c.table}`);
  return { code, stdout: stdout.replace(/@@TEN02@@.*$/m, ''), stderr, tables: after.tables as Tables, cognito: after.cognito, writes };
}

// ---------------------------------------------------------------- more from company B's side (lock check 5)

type Who = 'a' | 'b' | 'l';
const idOf = (w: Who, x: { a1: string; b1: string; legacy: string }) => (w === 'a' ? x.a1 : w === 'b' ? x.b1 : x.legacy);
const actOf = (w: Who) => (w === 'a' ? 'act-a-0001' : w === 'b' ? 'act-b-0001' : 'act-l-0001');
type Rt = { name: string; handler: string; ask: (w: Who) => Ask & { rawPath?: string }; agent?: boolean };
/** Every record route, for A's, B's or the legacy record (the legacy pending action is seeded below). */
const EVERY_RECORD: Rt[] = [
  { name: 'GET /v1/employees/{id}', handler: 'getEmployee', ask: (w) => ({ path: { id: idOf(w, EMP) } }), agent: true },
  { name: 'GET /v1/employees/{id}/invite', handler: 'getInvite', ask: (w) => ({ path: { id: idOf(w, EMP) } }) },
  { name: 'POST /v1/employees/{id}/invite', handler: 'resendInvite', ask: (w) => ({ method: 'POST', path: { id: idOf(w, EMP) } }) },
  { name: 'GET /v1/documents/{id}/url', handler: 'getDocumentPresignedUrl', ask: (w) => ({ path: { id: idOf(w, DOC) } }) },
  { name: 'POST upload-url', handler: 'generateDocumentUploadUrl', ask: (w) => ({ method: 'POST', path: { employee_id: idOf(w, EMP) }, body: { documentType: 'BANK_CONFIRMATION', fileName: 'bank.pdf', contentType: 'application/pdf' } }) },
  { name: 'GET /v1/verifications/{id}', handler: 'getSingleDocumentVerification', ask: (w) => ({ path: { id: idOf(w, DOC) }, query: { employee_id: idOf(w, EMP) } }) },
  { name: 'GET /v1/employees/{id}/verifications', handler: 'getEmployeeDocumentVerifications', ask: (w) => ({ path: { id: idOf(w, EMP) } }) },
  { name: 'PATCH review', handler: 'reviewDocumentVerification', ask: (w) => ({ method: 'PATCH', path: { id: idOf(w, DOC) }, body: { decision: 'PASSED', employee_id: idOf(w, EMP), notes: 'Looks right.' } }) },
  { name: 'POST external', handler: 'triggerExternalVerification', ask: (w) => ({ method: 'POST', path: { id: idOf(w, DOC) }, body: {} }) },
  { name: 'GET summary', handler: 'summariseVerification', ask: (w) => ({ path: { id: idOf(w, VER) } }), agent: true },
  { name: 'POST assess-risk', handler: 'classifyOnboardingRisk', ask: (w) => ({ method: 'POST', path: { id: idOf(w, EMP) } }), agent: true },
  { name: 'GET action', handler: 'approveAgentAction', agent: true, ask: (w) => ({ path: { actionId: actOf(w) }, rawPath: `/agent/v1/actions/${actOf(w)}` }) },
];
const withLegacyAction = () => {
  const t = tables();
  t['naleko-pending-actions']!.push(row({ actionId: 'act-l-0001', toolName: 'resend_invite', toolArgs: '{}', staffId: STAFF.hrA, status: 'PENDING_APPROVAL', createdAt: '2026-11-01T08:00:00.000Z' }));
  return t;
};
function onRecord(r: Rt, caller: Caller, w: Who, legacy = true): Run {
  const a = r.ask(w);
  if (!a.rawPath) return ask(r.handler, caller, a, { tables: withLegacyAction(), legacy });
  const event = httpEvent({ authorizer: authorizerOf(caller), path: a.path, query: a.query, body: a.body });
  event.rawPath = a.rawPath;
  event.requestContext.http.method = a.method ?? 'GET';
  event.requestContext.http.path = a.rawPath;
  return runHandler(handlerOf(r.handler), event, { tables: withLegacyAction(), cognito: pool(), secrets: { [AGENT_SECRET]: { AWSCURRENT: 'ten02-agent-key' } }, env: settings({ legacy }) });
}

test.describe('TEN-02 Records seen from company B\'s side', () => {
  test('AC-1 A record written before TEN-02 is never B\'s, and nobody\'s once the legacy rule is off', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    for (const r of EVERY_RECORD) {
      const b = onRecord(r, 'hrB', 'l');
      expect.soft(`${statusOf(b)} ${JSON.stringify(bodyOf(b))}`, `${r.name}: HR of B, the legacy record (rule on): 404, as for an unknown id (got ${describe(b)})`).toBe(`404 ${JSON.stringify(notFoundOf(r.name))}`);
      expect.soft(sideEffects(b.calls), `${r.name}: HR of B, the legacy record: nothing after the read`).toEqual([]);
      const off = onRecord(r, r.handler === 'approveAgentAction' ? 'agentA' : 'hrA', 'l', false);
      expect.soft(`${statusOf(off)} ${JSON.stringify(bodyOf(off))}`, `${r.name}: A, the legacy record, rule off: 404, as for an unknown id (got ${describe(off)})`).toBe(`404 ${JSON.stringify(notFoundOf(r.name))}`);
      expect.soft(sideEffects(off.calls), `${r.name}: A, the legacy record, rule off: nothing after the read`).toEqual([]);
    }
  });

  test('AC-1 The agent key of A never reaches B\'s records', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    for (const r of EVERY_RECORD.filter((x) => x.agent)) {
      const g = onRecord(r, 'agentA', 'b');
      expect.soft(`${statusOf(g)} ${JSON.stringify(bodyOf(g))}`, `${r.name}: the agent of A, B's record: 404 (got ${describe(g)})`).toBe(`404 ${JSON.stringify(NOT_FOUND)}`);
      expect.soft(sideEffects(g.calls), `${r.name}: the agent of A, B's record: nothing after the read`).toEqual([]);
    }
  });

  test('AC-2 A company that is not the legacy company still finds its own people', async ({}, testInfo) => {
    once(testInfo.project.name);
    expect.soft((bodyOf(ask('getEmployeeByEmail', 'hrB', { query: { email: MAIL.b1 } })) as any)?.employee_id, 'by email, as HR of B: B\'s person').toBe(EMP.b1);
    expect.soft((bodyOf(ask('getEmployeeByEmail', 'hrA', { query: { email: MAIL.a1 } }, { legacy: false })) as any)?.employee_id, 'by email, as HR of A with the legacy rule off: A\'s person').toBe(EMP.a1);
    // The risk report reads employeeId (the attribute it has always read); the rows carry it here.
    const withIds = () => { const t = tables(); t['employees'] = t['employees']!.map((r) => ({ ...r, employeeId: r['employee_id']! })); return t; };
    const ids = (r: Run) => ['high', 'medium', 'low', 'no_data'].flatMap((k) => (((bodyOf(r) as any)?.[k] ?? []) as any[]).map((e) => e.employeeId)).sort();
    const rb = ask('getBatchRiskReport', 'hrB', {}, { tables: withIds() });
    const ra = ask('getBatchRiskReport', 'hrA', {}, { tables: withIds(), legacy: false });
    const r0 = ask('getBatchRiskReport', 'hrA', {}, { tables: withIds() });
    expect.soft(ids(rb), `risk report as HR of B: B's employee only (got ${describe(rb)})`).toEqual([EMP.b1]);
    expect.soft(ids(ra), `risk report as HR of A, legacy rule off: A's employees (got ${describe(ra)})`).toEqual([EMP.a1, EMP.a2].sort());
    expect.soft(ids(r0), `risk report as HR of A, legacy rule on: A's and the legacy employee, never B's (got ${describe(r0)})`).toEqual([EMP.a1, EMP.a2, EMP.legacy].sort());
  });

  test('AC-3 B\'s new employee event and B\'s resent invite carry B', async ({}, testInfo) => {
    once(testInfo.project.name);
    const c = ask('createEmployee', 'hrB', { method: 'POST', headers: { 'idempotency-key': 'ten02-b-create' }, body: { first_name: 'Sipho', last_name: 'Doe', email: 'sipho.doe@company-b.example', phone: '000 000 0000', department: 'Operations', job_title: 'Junior baker', hr_staff_id: STAFF.hrB } });
    const events = (c.calls as any[]).filter((x) => x.service === 'events').map((x) => x.detail);
    expect.soft(events.length, `createEmployee as HR of B publishes its event (got ${describe(c)})`).toBeGreaterThan(0);
    for (const d of events) expect.soft(d?.tenant_id, 'B\'s createEmployee event carries B').toBe(B);
    const t2 = tables();
    t2['employees'] = t2['employees']!.map((r) => ((r['employee_id'] as any).S === EMP.b1 ? { ...r, stage: { S: 'INVITED' } } : r));
    const p2 = pool();
    p2.users = p2.users.map((u) => (u.username === MAIL.b1 ? { ...u, status: 'FORCE_CHANGE_PASSWORD' } : u));
    const res = ask('resendInvite', 'hrB', { method: 'POST', path: { id: EMP.b1 } }, { tables: t2, cognito: p2 });
    expect.soft([200, 201], `resend to B's person works (got ${describe(res)})`).toContain(statusOf(res));
    const fresh = (res.tables['employee_invites'] ?? []).filter((r) => !t2['employee_invites']!.some((o) => (o['token_hash'] as any).S === (r['token_hash'] as any).S));
    expect.soft(fresh.map((r) => plain(r)['tenant_id']), 'one new invite row, carrying B').toEqual([B]);
  });

  test('AC-7 HR of B naming A\'s HR partner gets the answer for an unknown partner', async ({}, testInfo) => {
    once(testInfo.project.name);
    const body = (staff: string) => ({ first_name: 'Sam', last_name: 'Doe', email: 'sam.doe@company-b.example', phone: '000 000 0000', department: 'Operations', job_title: 'Junior baker', hr_staff_id: staff });
    const withA = ask('createEmployee', 'hrB', { method: 'POST', headers: { 'idempotency-key': 'ten02-b-partner-a' }, body: body(STAFF.hrA) });
    const unknown = ask('createEmployee', 'hrB', { method: 'POST', headers: { 'idempotency-key': 'ten02-b-partner-x' }, body: body('NOSUCH01') });
    expect.soft(statusOf(withA), `HR of B with A's partner: 400 (got ${describe(withA)})`).toBe(400);
    expect.soft(bodyOf(withA), 'the same answer as for an unknown partner').toEqual(bodyOf(unknown));
    expect.soft(sideEffects(withA.calls), 'and it does the same calls as for an unknown partner (no employee, invite or event)').toEqual(sideEffects(unknown.calls));
  });

  test('AC-1 P2: an employee of A asking for B\'s records gets the answer for an unknown id', async ({}, testInfo) => {
    once(testInfo.project.name);
    const up = (emp: string) => ask('generateDocumentUploadUrl', 'empA', { method: 'POST', path: { employee_id: emp }, body: { documentType: 'BANK_CONFIRMATION', fileName: 'bank.pdf', contentType: 'application/pdf' } });
    const u1 = up(EMP.b1);
    const u0 = up('EMP-9999999');
    expect.soft(`${statusOf(u1)} ${JSON.stringify(bodyOf(u1))}`, 'upload link for B\'s employee, as A\'s employee: as for an unknown id').toBe(`${statusOf(u0)} ${JSON.stringify(bodyOf(u0))}`);
    expect.soft(sideEffects(u1.calls), 'upload link for B\'s employee: nothing signed or written').toEqual([]);
    const d1 = ask('getDocumentPresignedUrl', 'empA', { path: { id: DOC.b1 } });
    const d0 = ask('getDocumentPresignedUrl', 'empA', { path: { id: 'doc-9999999' } });
    expect.soft(`${statusOf(d1)} ${JSON.stringify(bodyOf(d1))}`, 'file link for B\'s document, as A\'s employee: as for an unknown id').toBe(`${statusOf(d0)} ${JSON.stringify(bodyOf(d0))}`);
    expect.soft(sideEffects(d1.calls), 'file link for B\'s document: nothing signed').toEqual([]);
  });

  test('AC-13 The PII key\'s other role lists are as they were', async ({}, testInfo) => {
    once(testInfo.project.name);
    const mod = (txt: string) => attributes(/module\s+"kms_pii"\s*\{([\s\S]*?)\n\}/.exec(stripComments(txt))![1]!);
    const rolesIn = (v: string | undefined) => (v ?? '').match(/aws_iam_role\.\w+\.arn/g) ?? [];
    const before = mod(readFileSync(join(__dirname, 'support', 'ten-02', 'iam-48fe4c6', 'kms.tf.txt'), 'utf8'));
    const now = mod(readFileSync(join(INFRA, 'kms.tf'), 'utf8'));
    for (const k of ['allowed_role_arns', 'cognito_sender_decrypt_role_arns']) {
      expect.soft(rolesIn(now.get(k)).sort(), `kms_pii ${k} unchanged since develop 48fe4c6`).toEqual(rolesIn(before.get(k)).sort());
    }
    expect.soft(rolesIn(before.get('allowed_role_arns')).length, 'the baseline holds the list').toBeGreaterThan(0);
  });
});

