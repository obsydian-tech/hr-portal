import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { DocumentsFake, storedEmployee, type FakePerson } from './support/documents-fake';
import { ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { blocks } from './support/infra-harness';
import { forgetSignIn } from './support/sign-in-again';
import { policyLines, resourcesOf, squash } from './support/mod-01/iam';
import {
  CLASSIFY, COMPANY_A, COMPANY_B, FLOW_SOURCE, FOUNDING, GET_EMPLOYEE, OCR, PERSON, REPO, aiAttempts, assessEvent, agentEmployeeEvent, dynamoCalls,
  flowEvent, httpCalls, logText, modelCalls, personEvent, personOf, plain, promptOf, published, row, runHandler, s3Event, sfnCalls, writesTo,
  type Caller, type Row, type Run, type World,
} from './support/onb-11/lambda-harness';

/**
 * ONB-11 · Risk check on the full set (Jira NH-181, epic NH-150). Red.
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-11.md (18 Nov 2026)
 *
 * Lambda tests (AC-1 to AC-5, AC-7) run once, in desktop-1280: the real classifyOnboardingRisk, processDocumentOCR,
 * getEmployeeDocumentVerifications and getEmployee handlers, each in a fresh Node process, against support/onb-11/fake-aws
 * (copied from ONB-09's). DynamoDB honours ConditionExpression; the Query on the verification index answers in pages;
 * EventBridge and Step Functions record what they are asked (Step Functions refuses a task token already spent); Textract
 * and Bedrock are recording fakes that fail nothing but are asked to answer nothing real, and every outside HTTP call is
 * recorded and refused. Nothing reaches AWS or any AI service. Static tests (AC-4's code check, AC-6, AC-10) read files.
 * Screen tests (AC-8, AC-9) run with no backend: the browser answers the one verifications route with
 * support/documents-fake.ts, which now answers the three risk keys when a test gives them. AC-11 runs on pepla-dev
 * (desktop, once, with a test address, so no AI).
 *
 * Words: AC-8 pins the structure of the risk block, that each result reads differently and that the stored reason shows
 * as written. The exact heading and result words are Question Q1 of the spec (Iggie's). RISK_WORDS below stays null
 * until he gives them; the lock waits for them (see cards/onb-11.md).
 *
 * These files are locked once accepted: see ./README.md and cards/onb-11.md.
 */

const ID = 'NATIONAL_ID';
const BANK = 'BANK_CONFIRMATION';
const MATRIC = 'MATRIC_CERTIFICATE';
const TERT = 'TERTIARY_QUALIFICATION';

/** The two sentences the guard stores (lambda/shared/ai-guard.mjs; Q2 of the spec keeps them as they are). */
const AI_SKIPPED_LABEL = 'AI skipped: this is test data (cost guardrail). Nothing was sent to an AI service.';
const AI_OFF_LABEL = 'AI is switched off here (cost guardrail). Nothing was sent to an AI service.';
const UNPARSEABLE = 'Model returned unparseable response';

/**
 * Q1 (Iggie's words): the heading of the risk block, the four results and the line before any check has run.
 * null until he gives them. When set, AC-8 pins each exactly.
 */
const RISK_WORDS: null | { heading: string; LOW: string; MEDIUM: string; HIGH: string; UNKNOWN: string; none: string } = null;

function lambdaOnce(testInfo: TestInfo): void {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambdas against a fake AWS.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Runs the Lambdas once: they have no screen width.');
}
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs made-up people.');
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- callers

const HR_A: Caller = { kind: 'jwt', email: 'thandi.demo-hr@kestrel-foods.co.za', groups: ['hr_staff'], tenant: COMPANY_A };
const HR_B: Caller = { kind: 'jwt', email: 'jane.other-hr@mokoena-logistics.co.za', groups: ['hr_staff'], tenant: COMPANY_B };
const AGENT_A: Caller = { kind: 'agent', tenant: COMPANY_A };
const STAFF_A: Caller = { kind: 'jwt', email: 'sipho.staff@kestrel-foods.co.za', groups: ['employee'], tenant: COMPANY_A };
const ROBOT_HR_A: Caller = { kind: 'jwt', email: 'e2e.hr@blackhole.postmarkapp.com', groups: ['hr_staff', 'e2e-robots'], tenant: COMPANY_A };

// ---------------------------------------------------------------- the people and their rows

/** What must never reach the model: every personal value of the person and of their documents. */
const PERSONAL = {
  first: 'Lindiwe',
  last: 'Zulu-Mkhize',
  email: 'lindiwe.zulu-mkhize@kestrel-foods.co.za',
  idNumber: '8001015009087',
  last4: '9087',
  accountHolder: 'LN ZULUMKHIZE',
  accountNumber: '62145879301',
  bank: 'Capitec Business',
  branch: '470010',
  file: 'lindiwe_id_scan_front.pdf',
};
const P = { id: 'EMP-1100001', email: PERSONAL.email };
const robotEmail = 'thabo.test-person@blackhole.postmarkapp.com';
const encrypted = (plainText: string) => Buffer.from(`kms:${plainText}`).toString('base64');

type PersonOpts = { id?: string; email?: string; tenant?: string | null; step?: string; stage?: string; token?: string; userSub?: string; risk?: { band: string; reason: string; at: string; source?: string } | null };

function personRow(o: PersonOpts = {}): Row {
  return row({
    employee_id: o.id ?? P.id,
    first_name: PERSONAL.first,
    last_name: PERSONAL.last,
    email: o.email ?? P.email,
    phone: '+27 82 555 0142',
    department: 'Finance',
    job_title: 'Bookkeeper',
    stage: o.stage ?? 'DOCUMENTS_SUBMITTED',
    step: o.step ?? 'IN_REVIEW',
    planned_start_date: '2026-12-01',
    created_at: '2026-11-01T08:00:00.000Z',
    updated_at: '2026-11-17T09:00:00.000Z',
    created_by: 'sub-hr',
    hr_staff_name: 'Jane Smith',
    hr_staff_email: 'jane.smith@kestrel-foods.co.za',
    id_number_last4: PERSONAL.last4,
    user_sub: o.userSub,
    sfn_task_token: o.token,
    tenant_id: o.tenant === null ? undefined : o.tenant ?? COMPANY_A,
    riskBand: o.risk?.band,
    riskReason: o.risk?.reason,
    riskAssessedAt: o.risk?.at,
    riskSource: o.risk?.source,
  });
}

type Ver = { vid: string; type: string; at: string; decision?: string; check?: string | null; conf?: number; tenant?: string | null; emp?: string };

/** A document-verification row as processDocumentOCR stores it (ONB-07: decision MANUAL_REVIEW, a check). */
function verRow(v: Ver): Row {
  const emp = v.emp ?? P.id;
  const common = {
    verificationId: v.vid,
    employeeId: emp,
    documentId: `doc_${v.vid.replace(/\D/g, '')}`,
    documentType: v.type,
    fileName: `uploads/${emp}/${v.type}/doc_${v.vid.replace(/\D/g, '')}_${PERSONAL.file}`,
    checks: '{}',
    confidence: v.conf ?? 90,
    decision: v.decision ?? 'MANUAL_REVIEW',
    check: v.check === null ? undefined : v.check ?? 'MATCHES',
    reasoning: 'Sample data.',
    createdAt: v.at,
    tenant_id: v.tenant === null ? undefined : v.tenant ?? COMPANY_A,
  };
  if (v.type === ID) {
    return row({ ...common, idNumber_encrypted: encrypted(PERSONAL.idNumber), idNumber_last4: PERSONAL.last4, name: PERSONAL.first, surname: PERSONAL.last, dateOfBirth: '1980-01-01', gender: 'F', citizenship: 'ZA' });
  }
  if (v.type === BANK) {
    return row({ ...common, accountHolder: PERSONAL.accountHolder, bankName: PERSONAL.bank, accountNumber: PERSONAL.accountNumber, branchCode: PERSONAL.branch, accountType: 'Cheque' });
  }
  return row(common);
}

const MODEL = { risk: 'MEDIUM', reason: 'The bank letter is still waiting for HR to look at it.' };

/** One person (company A, not a test login) with their ID and bank rows, the model answering MEDIUM. */
function worldOf(opts: PersonOpts = {}, vers: Ver[] = [
  { vid: 'ver_1763100000001', type: ID, at: '2026-11-12T09:00:00.000Z', check: 'MATCHES', conf: 96 },
  { vid: 'ver_1763100000002', type: BANK, at: '2026-11-12T09:10:00.000Z', check: 'NEEDS_A_LOOK', conf: 72 },
], extra: Partial<World> = {}): World {
  return {
    tables: { employees: [personRow(opts)], documents: [], 'document-verification': vers.map(verRow) },
    model: MODEL,
    ...extra,
  };
}

// ---------------------------------------------------------------- running

/** Nothing automated reaches an outside host, or an AI service beyond the recording fakes. */
function ran(run: Run, what: string): Run {
  expect(httpCalls(run), `${what}: no outside HTTP call`).toEqual([]);
  expect(aiAttempts(run).filter((c) => c.service === 'textract'), `${what}: Textract is not asked to read anything`).toEqual([]);
  return run;
}

/** classifyOnboardingRisk with exactly what Step Functions sends. */
function flow(world: World, id: string = P.id, env: Record<string, string | undefined> = {}): Run {
  return ran(runHandler(CLASSIFY, world, flowEvent(id), env), 'the flow call');
}

/** classifyOnboardingRisk through API Gateway. */
function web(world: World, id: string, caller: Caller, opts: Parameters<typeof assessEvent>[2] = {}, env: Record<string, string | undefined> = {}): Run {
  return ran(runHandler(CLASSIFY, world, assessEvent(id, caller, opts), env), 'the web call');
}

const employeeWrites = (run: Run) => writesTo(run, 'employees');
const rowsOf = (world: World, table: keyof World['tables']) => world.tables[table].map((r) => plain(r));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function expectNothingWritten(run: Run, what: string): void {
  for (const table of ['employees', 'documents', 'document-verification']) expect(writesTo(run, table), `${what}: nothing is written to ${table}`).toEqual([]);
  expect(modelCalls(run), `${what}: the model is not called`).toEqual([]);
}

/** The summary the model was given: the list of entries inside the prompt. */
function summaryIn(prompt: string): Array<Record<string, unknown>> {
  const start = prompt.indexOf('[{');
  expect(start, 'the prompt holds a list of document entries').toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = start; i < prompt.length; i++) {
    const c = prompt[i];
    if (c === '"') { i++; while (i < prompt.length && prompt[i] !== '"') i += prompt[i] === '\\' ? 2 : 1; continue; }
    if (c === '[') depth++;
    if (c === ']') { depth--; if (depth === 0) return JSON.parse(prompt.slice(start, i + 1)) as Array<Record<string, unknown>>; }
  }
  throw new Error('the list of entries in the prompt does not close');
}

// ================================================================ tests

const test = base.extend<{ docs: DocumentsFake | null }>({
  docs: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new DocumentsFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
});

test.describe('ONB-11 Risk check on the full set', () => {
  test('AC-1 The flow call works: what Step Functions sends is answered as a plain object, stored once, under the row\'s own company', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const world = worldOf();
    const other: PersonOpts = { id: 'EMP-1100002', tenant: COMPANY_B };
    world.tables.employees.push(personRow(other));
    const before = structuredClone(world.tables);
    const run = flow(world);
    expect(run.error, `the flow call does not throw (${run.error?.message ?? ''})`).toBeUndefined();

    // A plain object for the next state: never an HTTP shape.
    const r = run.response as Record<string, unknown>;
    expect(r && typeof r === 'object', 'it answers an object').toBe(true);
    expect('statusCode' in r, 'no statusCode').toBe(false);
    expect('body' in r, 'no body text').toBe(false);
    expect(Object.keys(r).sort(), 'exactly employeeId, tenantId, riskBand, riskReason and riskAssessedAt').toEqual(['employeeId', 'riskAssessedAt', 'riskBand', 'riskReason', 'tenantId']);
    expect(r['employeeId']).toBe(P.id);
    expect(r['tenantId'], "the row's company").toBe(COMPANY_A);
    expect(r['riskBand']).toBe('MEDIUM');
    expect(r['riskReason']).toBe(MODEL.reason);
    expect(new Date(String(r['riskAssessedAt'])).toISOString(), 'riskAssessedAt is an ISO time').toBe(r['riskAssessedAt']);

    // Stored on that row only, with the source, under the company condition.
    const stored = personOf(run.world, P.id)!;
    expect(stored['riskBand']).toBe('MEDIUM');
    expect(stored['riskReason']).toBe(MODEL.reason);
    expect(stored['riskAssessedAt']).toBe(r['riskAssessedAt']);
    expect(stored['riskSource'], 'the source is FLOW').toBe('FLOW');
    const writes = employeeWrites(run);
    expect(writes.length, 'one write to employees').toBe(1);
    expect(writes[0]!.op).toBe('UpdateItem');
    expect(writes[0]!.input.Key, 'on this person').toEqual({ employee_id: { S: P.id } });
    expect(String(writes[0]!.input.ConditionExpression), 'under a company condition').toContain('tenant_id');
    expect(JSON.stringify(writes[0]!.input.ExpressionAttributeValues), "with the row's company").toContain(COMPANY_A);
    expect(rowsOf({ ...run.world }, 'employees').filter((x) => x?.['employee_id'] !== P.id), "nobody else's row changes").toEqual(before.employees.filter((x) => (x['employee_id'] as { S: string }).S !== P.id).map((x) => plain(x)));
    expect(same(run.world.tables.documents, before.documents) && same(run.world.tables['document-verification'], before['document-verification']), 'no other table changes').toBe(true);
    expect(modelCalls(run).length, 'the model is called once').toBe(1);

    // The company is the row's, never the event's: a call that also carries another company's id is answered and stored under the row's.
    const spoof = ran(runHandler(CLASSIFY, worldOf(), flowEvent(P.id, { tenantId: COMPANY_B, tenant_id: COMPANY_B, company: COMPANY_B }), {}), 'the flow call with a spoofed company');
    expect(spoof.error, 'a spoofed company in the event changes nothing').toBeUndefined();
    expect((spoof.response as Record<string, unknown>)['tenantId'], "the answer still carries the row's company").toBe(COMPANY_A);
    expect(JSON.stringify(employeeWrites(spoof)[0]!.input.ExpressionAttributeValues), "and the write is under the row's company").toContain(COMPANY_A);
    expect(JSON.stringify(employeeWrites(spoof)[0]!.input.ExpressionAttributeValues), 'and never the event\'s').not.toContain(COMPANY_B);

    // No company on the row and the legacy rule off: refused. An unknown person: refused. Nothing written, no model.
    const noCompany = flow(worldOf({ tenant: null }, [
      { vid: 'ver_1', type: ID, at: '2026-11-12T09:00:00.000Z', tenant: null }, { vid: 'ver_2', type: BANK, at: '2026-11-12T09:10:00.000Z', tenant: null },
    ]));
    expect(noCompany.error?.name, 'a row with no company and no legacy rule throws a named error').toMatch(/^[A-Za-z]+$/);
    expect(noCompany.error?.name).not.toBe('Error');
    expectNothingWritten(noCompany, 'a person with no company');
    const unknown = flow(worldOf(), 'EMP-9999999');
    expect(unknown.error?.name, 'an unknown person throws a named error').toMatch(/^[A-Za-z]+$/);
    expect(unknown.error?.name).not.toBe('Error');
    expectNothingWritten(unknown, 'an unknown person');

    // Failed reads and writes throw, with no AWS message text in the logs (BE-18).
    for (const fail of [{ op: 'GetItem', table: 'employees' }, { op: 'Query', table: 'document-verification' }, { op: 'UpdateItem', table: 'employees' }]) {
      const failed = flow({ ...worldOf(), fail: [fail] });
      expect(failed.error?.name, `a failed ${fail.op} on ${fail.table} throws, so Step Functions can retry or catch it`).toMatch(/^[A-Za-z]+$/);
      expect(failed.response, `${fail.op}: no answer is made up`).toBeUndefined();
      expect(logText(failed), `${fail.op}: logs carry the error name, not the service's message`).not.toMatch(/unavailable|fake DynamoDB/i);
      expect(failed.error?.message ?? '', `${fail.op}: the thrown message is not the service's text`).not.toMatch(/unavailable|fake DynamoDB/i);
    }

    // Company B's rows under a company-A person are never in the summary (no company on a row counts as not ours).
    const mixed = flow(worldOf({}, [
      { vid: 'ver_1', type: ID, at: '2026-11-12T09:00:00.000Z' },
      { vid: 'ver_2', type: BANK, at: '2026-11-12T09:10:00.000Z' },
      { vid: 'ver_3', type: TERT, at: '2026-11-12T09:20:00.000Z', tenant: COMPANY_B },
      { vid: 'ver_4', type: MATRIC, at: '2026-11-12T09:30:00.000Z', tenant: null },
    ]));
    expect(mixed.error).toBeUndefined();
    const entries = summaryIn(promptOf(modelCalls(mixed)[0]!));
    expect(entries.map((e) => e['documentType']).sort(), "only company A's own rows are summarised").toEqual([BANK, ID]);

    // The founding company: a row with no company, the legacy rule on.
    const founding = flow(worldOf({ tenant: null }, [
      { vid: 'ver_1', type: ID, at: '2026-11-12T09:00:00.000Z', tenant: null }, { vid: 'ver_2', type: BANK, at: '2026-11-12T09:10:00.000Z', tenant: null },
    ]), P.id, { LEGACY_TENANT_ID: FOUNDING });
    expect(founding.error, `the founding company's person works (${founding.error?.message ?? ''})`).toBeUndefined();
    expect((founding.response as Record<string, unknown>)['tenantId'], 'its company is the founding one').toBe(FOUNDING);
    expect(personOf(founding.world, P.id)!['riskSource']).toBe('FLOW');
    expect(modelCalls(founding).length).toBe(1);

    // Once: a second flow call answers the stored result and pays for nothing.
    const again = flow(run.world);
    expect(again.error).toBeUndefined();
    expect(modelCalls(again), 'a repeat makes no model call').toEqual([]);
    const a = again.response as Record<string, unknown>;
    expect([a['riskBand'], a['riskReason'], a['riskAssessedAt']], 'and answers what is stored').toEqual([stored['riskBand'], stored['riskReason'], stored['riskAssessedAt']]);
    expect(personOf(again.world, P.id)!['riskAssessedAt'], 'the stored time is not moved').toBe(stored['riskAssessedAt']);

    // A result HR's button wrote does not stop the flow's own check.
    const hrDone = worldOf({ risk: { band: 'LOW', reason: 'HR asked earlier.', at: '2026-11-17T08:00:00.000Z', source: 'HR' } });
    const second = flow(hrDone);
    expect(second.error).toBeUndefined();
    expect(modelCalls(second).length, "HR's earlier result does not stop the flow's check").toBe(1);
    expect(personOf(second.world, P.id)!['riskSource']).toBe('FLOW');
  });

  test('AC-2 The web route is unchanged and cannot be turned into a flow call', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    // HR of company A, and the Agent API of company A: 200 {employeeId, risk, reason} as today, stored as HR's.
    for (const [who, caller] of [['HR of company A', HR_A], ['the Agent API of company A', AGENT_A]] as const) {
      const run = web(worldOf(), P.id, caller);
      expect(run.error, `${who}: no throw`).toBeUndefined();
      expect(run.status, `${who}: 200 (${run.raw.slice(0, 200)})`).toBe(200);
      expect(run.body, `${who}: the same three keys as today`).toEqual({ employeeId: P.id, risk: 'MEDIUM', reason: MODEL.reason });
      const stored = personOf(run.world, P.id)!;
      expect(stored['riskSource'], `${who}: stored as HR's`).toBe('HR');
      expect([stored['riskBand'], stored['riskReason']], `${who}: band and reason stored`).toEqual(['MEDIUM', MODEL.reason]);
      expect(typeof stored['riskAssessedAt']).toBe('string');
      expect(modelCalls(run).length, `${who}: one model call`).toBe(1);
    }

    // A non-HR caller: 403. HR of company B on this person: 404 and the model is never asked. No verifications: 404.
    const nonHr = web(worldOf(), P.id, STAFF_A);
    expect(nonHr.status, 'a non-HR caller gets 403').toBe(403);
    expectNothingWritten(nonHr, 'a non-HR caller');
    const otherCompany = web(worldOf(), P.id, HR_B);
    expect(otherCompany.status, "HR of company B on company A's person gets 404").toBe(404);
    expect(JSON.stringify(otherCompany.body), 'and learns nothing of the risk').not.toMatch(/risk/i);
    expectNothingWritten(otherCompany, "company B's HR");
    const noVerifications = web(worldOf({}, []), P.id, HR_A);
    expect(noVerifications.status, 'a person with no verifications gets 404').toBe(404);
    expectNothingWritten(noVerifications, 'no verifications');
    for (const fail of [{ op: 'GetItem', table: 'employees' }, { op: 'Query', table: 'document-verification' }, { op: 'UpdateItem', table: 'employees' }]) {
      const failed = web({ ...worldOf(), fail: [fail] }, P.id, HR_A);
      expect(failed.status, `a failed ${fail.op} on ${fail.table} is a 500 as today`).toBe(500);
    }

    // A request that has a requestContext is never a flow call, whatever it carries.
    const marker = { source: FLOW_SOURCE, employeeId: P.id };
    const attempts: Array<[string, Caller | null, Parameters<typeof assessEvent>[2]]> = [
      ['the marker in the body', STAFF_A, { body: marker }],
      ['the marker in the query', STAFF_A, { query: { source: FLOW_SOURCE, employeeId: P.id } }],
      ['the marker in a header', STAFF_A, { headers: { source: FLOW_SOURCE, employeeid: P.id } }],
      ['the marker on the event itself', STAFF_A, { extra: marker }],
      ['the marker on the event itself with no sign-in', null, { extra: marker }],
    ];
    for (const [what, caller, opts] of attempts) {
      const event = caller ? assessEvent('EMP-0000000', caller, opts) : (() => { const e = assessEvent('EMP-0000000', STAFF_A, opts); delete e['requestContext'].authorizer; return e; })();
      const run = ran(runHandler(CLASSIFY, worldOf(), event), what);
      const answer = run.response as Record<string, unknown> | undefined;
      expect(run.status, `${what}: the group check refuses it (403)`).toBe(403);
      expect(answer && 'riskBand' in answer, `${what}: never the flow answer`).toBeFalsy();
      expectNothingWritten(run, what);
    }
    // HR carrying the marker goes the web way: the web answer, stored as HR's, not as the flow's.
    const hrWithMarker = web(worldOf(), P.id, HR_A, { body: marker, extra: marker });
    expect(hrWithMarker.status, 'HR with the marker in the body is an ordinary web call').toBe(200);
    expect(hrWithMarker.body).toEqual({ employeeId: P.id, risk: 'MEDIUM', reason: MODEL.reason });
    expect(personOf(hrWithMarker.world, P.id)!['riskSource'], 'stored as HR\'s').toBe('HR');

    // No requestContext and no (or the wrong) source, or no employee id: refused, nothing written.
    const refusedEvents: Array<[string, unknown]> = [
      ['what the old definition sent ({employeeId} only)', { employeeId: P.id }],
      ['the wrong source', { source: 'naleko.something-else', employeeId: P.id }],
      ['a source with different case', { source: FLOW_SOURCE.toUpperCase(), employeeId: P.id }],
      ['no employee id', { source: FLOW_SOURCE }],
      ['an employee id that is not text', { source: FLOW_SOURCE, employeeId: 12 }],
      ['an employee id that is an object', { source: FLOW_SOURCE, employeeId: { S: P.id } }],
      ['an empty event', {}],
    ];
    for (const [what, event] of refusedEvents) {
      const run = ran(runHandler(CLASSIFY, worldOf(), event), what);
      const answer = run.response as Record<string, unknown> | undefined;
      expect(Boolean(run.error) || (Number.isFinite(run.status) && run.status >= 400), `${what}: refused (thrown, or a 4xx answer)`).toBe(true);
      expect(answer && 'riskBand' in answer, `${what}: no flow answer`).toBeFalsy();
      expectNothingWritten(run, what);
    }
  });

  test('AC-3 The model gets the full set, newest copy of each type, nothing personal, and a prompt that says nothing is passed until HR decides', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    // Eight rows, read in pages of three, the newest copies last. ID: an old copy and a newer one. Bank: two rows at the
    // same time (the larger verificationId wins). Matric: one row with no check stored.
    const rows: Ver[] = [
      { vid: 'ver_1763100000001', type: ID, at: '2026-11-10T09:00:00.000Z', decision: 'FAILED', check: 'DOESNT_MATCH', conf: 20 },
      { vid: 'ver_1763100000002', type: ID, at: '2026-11-04T09:00:00.000Z', decision: 'FAILED', check: 'DOESNT_MATCH', conf: 21 },
      { vid: 'ver_1763100000003', type: BANK, at: '2026-11-03T09:00:00.000Z', decision: 'FAILED', check: 'DOESNT_MATCH', conf: 22 },
      { vid: 'ver_1763100000004', type: MATRIC, at: '2026-11-11T09:00:00.000Z', decision: 'PASSED', check: null, conf: 88 },
      { vid: 'ver_1763100000031', type: BANK, at: '2026-11-11T09:00:00.000Z', check: 'MATCHES', conf: 95 },
      { vid: 'ver_1763100000030', type: BANK, at: '2026-11-11T09:00:00.000Z', check: 'NEEDS_A_LOOK', conf: 60 },
      { vid: 'ver_1763100000005', type: TERT, at: '2026-11-02T09:00:00.000Z', decision: 'FAILED', check: 'DOESNT_MATCH', conf: 23, tenant: COMPANY_B },
      { vid: 'ver_1763100000006', type: ID, at: '2026-11-12T09:00:00.000Z', check: 'MATCHES', conf: 97 },
    ];
    const world = worldOf({}, rows, { pageSize: 3 });
    for (const [what, run] of [['the flow call', flow(world)], ['the web call', web(world, P.id, HR_A)]] as const) {
      expect(run.error, `${what}: no throw`).toBeUndefined();
      const queries = dynamoCalls(run).filter((c) => c.op === 'Query' && c.table === 'document-verification');
      expect(queries.length, `${what}: every page of the verifications is read (8 rows, 3 to a page)`).toBeGreaterThanOrEqual(3);
      expect(queries.slice(1).every((q) => q.input.ExclusiveStartKey), `${what}: each later page continues from the last key`).toBe(true);
      const calls = modelCalls(run);
      expect(calls.length, `${what}: one model call`).toBe(1);
      const prompt = promptOf(calls[0]!);
      const entries = summaryIn(prompt);
      const byType = (t: string) => entries.filter((e) => e['documentType'] === t);
      expect(entries.length, `${what}: one entry for each type read, the old copies and company B's row dropped`).toBe(3);
      expect(byType(ID).length).toBe(1);
      expect([byType(ID)[0]!['decision'], byType(ID)[0]!['check'], byType(ID)[0]!['ocrConfidence']], `${what}: the newest ID copy, with its decision and Batsi's check`).toEqual(['MANUAL_REVIEW', 'MATCHES', 97]);
      expect([byType(BANK)[0]!['decision'], byType(BANK)[0]!['check']], `${what}: at the same time, the larger verificationId is the bank entry`).toEqual(['MANUAL_REVIEW', 'MATCHES']);
      expect([byType(MATRIC)[0]!['decision'], byType(MATRIC)[0]!['check']], `${what}: a row with no check is Needs a look`).toEqual(['PASSED', 'NEEDS_A_LOOK']);
      expect(byType(TERT), `${what}: the other company's row is not there`).toEqual([]);
      for (const e of entries) {
        expect(e['decision'], `${what}: no entry is missing here`).not.toBe('MISSING');
        expect(Object.keys(e).sort(), `${what}: an entry holds only these facts`).toEqual(['check', 'decision', 'documentType', 'hasExtractedData', 'ocrConfidence']);
      }
      for (const word of ['DOESNT_MATCH', '"FAILED"']) expect(prompt.slice(prompt.indexOf('[{')), `${what}: nothing of an old copy (${word}) is in the list`).not.toContain(word);
    }

    // A person with only an ID: the bank letter is missing, and the entry says so.
    const onlyId = flow(worldOf({}, [{ vid: 'ver_1', type: ID, at: '2026-11-12T09:00:00.000Z' }]));
    expect(onlyId.error).toBeUndefined();
    const idEntries = summaryIn(promptOf(modelCalls(onlyId)[0]!));
    expect(idEntries.find((e) => e['documentType'] === BANK), 'the missing bank letter is listed as MISSING').toEqual({ documentType: BANK, decision: 'MISSING' });
    expect(idEntries.filter((e) => e['documentType'] === ID).length).toBe(1);
    // Both required types in: nothing is listed as missing.
    const both = summaryIn(promptOf(modelCalls(flow(worldOf()))[0]!));
    expect(both.filter((e) => e['decision'] === 'MISSING'), 'nothing is missing when both required types are in').toEqual([]);

    // Nothing personal reaches the prompt: none of the person's or the documents' values, no id, no company.
    const prompt = promptOf(modelCalls(flow(world))[0]!);
    const lower = prompt.toLowerCase();
    const secrets: Array<[string, string]> = [
      ['first name', PERSONAL.first], ['last name', PERSONAL.last], ['email', PERSONAL.email], ['email name', 'lindiwe.zulu'], ['the full ID number', PERSONAL.idNumber],
      ['the last four digits of the ID', PERSONAL.last4], ['account holder', PERSONAL.accountHolder], ['account number', PERSONAL.accountNumber], ['bank name', PERSONAL.bank],
      ['branch code', PERSONAL.branch], ['file name', PERSONAL.file], ['employee id', P.id], ['company id', COMPANY_A], ['a company id fragment', 'ten_a'], ['a date of birth', '1980-01-01'],
    ];
    for (const [what, value] of secrets) expect(lower, `the prompt holds no ${what}`).not.toContain(value.toLowerCase());

    // The words: nothing counts as passed until HR decides, and a missing document is a risk.
    const sentences = prompt.split(/(?<=[.!?])\s+|\n+/).map(clean);
    expect(sentences.some((s) => /\b(nothing|nobody|no document|not)\b/i.test(s) && /pass/i.test(s) && /until HR decid/i.test(s)), 'the prompt says nothing is passed until HR decides').toBe(true);
    expect(sentences.some((s) => /MISSING/.test(s) && /\brisk/i.test(s)), 'the prompt says MISSING is a risk').toBe(true);
    expect(prompt, 'the old "all documents passed" rule is gone').not.toMatch(/all documents passed/i);
    expect(prompt, 'the answer is still asked for as JSON with risk and reason').toMatch(/"risk"\s*:/);
  });

  test('AC-4 No test and no robot reaches an AI service: robots, "AI off", an unparseable answer and a failing model all store UNKNOWN', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    // A robot (a test address) through the flow entry and through the web entry.
    const robotWorld = () => worldOf({ email: robotEmail });
    const robotFlow = flow(robotWorld());
    expect(robotFlow.error).toBeUndefined();
    expect(modelCalls(robotFlow), 'a robot employee: no model call (flow)').toEqual([]);
    const rf = robotFlow.response as Record<string, unknown>;
    expect([rf['riskBand'], rf['riskReason']], 'flow: UNKNOWN with the guard label').toEqual(['UNKNOWN', AI_SKIPPED_LABEL]);
    expect([personOf(robotFlow.world, P.id)!['riskBand'], personOf(robotFlow.world, P.id)!['riskReason']], 'and stored').toEqual(['UNKNOWN', AI_SKIPPED_LABEL]);
    const robotWeb = web(robotWorld(), P.id, HR_A);
    expect(robotWeb.status).toBe(200);
    expect(modelCalls(robotWeb), 'a robot employee: no model call (web)').toEqual([]);
    expect(robotWeb.body, 'web: UNKNOWN with the guard label').toEqual({ employeeId: P.id, risk: 'UNKNOWN', reason: AI_SKIPPED_LABEL });
    expect(personOf(robotWeb.world, P.id)!['riskBand'], 'and stored').toBe('UNKNOWN');
    const robotCaller = web(worldOf(), P.id, ROBOT_HR_A);
    expect(modelCalls(robotCaller), 'a robot caller (test login) on a real person: no model call').toEqual([]);
    expect((robotCaller.body as Record<string, unknown>)['risk']).toBe('UNKNOWN');

    // AI_CALLS_ENABLED "false": the same, with the off label.
    const off = { AI_CALLS_ENABLED: 'false' };
    const offFlow = flow(worldOf(), P.id, off);
    expect(modelCalls(offFlow), 'AI off: no model call (flow)').toEqual([]);
    const of = offFlow.response as Record<string, unknown>;
    expect([of['riskBand'], of['riskReason']]).toEqual(['UNKNOWN', AI_OFF_LABEL]);
    expect(personOf(offFlow.world, P.id)!['riskReason']).toBe(AI_OFF_LABEL);
    const offWeb = web(worldOf(), P.id, HR_A, {}, off);
    expect(modelCalls(offWeb), 'AI off: no model call (web)').toEqual([]);
    expect(offWeb.body).toEqual({ employeeId: P.id, risk: 'UNKNOWN', reason: AI_OFF_LABEL });

    // A real person, AI on: an answer that cannot be read, and a model that fails, store UNKNOWN. The flow does not throw.
    for (const [what, extra] of [
      ['an unparseable answer', { model: 'this is not json at all' }],
      ['an answer with a band that does not exist', { model: { risk: 'SEVERE', reason: 'Not one of the bands.' } }],
      ['a model that fails', { modelFails: 'ResourceNotFoundException' }],
    ] as const) {
      const f = flow({ ...worldOf(), ...extra });
      expect(f.error, `${what}: the flow call does not throw`).toBeUndefined();
      const fr = f.response as Record<string, unknown>;
      expect([fr['riskBand'], fr['riskReason']], `${what}: UNKNOWN and the reason as today`).toEqual(['UNKNOWN', UNPARSEABLE]);
      expect([personOf(f.world, P.id)!['riskBand'], personOf(f.world, P.id)!['riskReason']], `${what}: stored`).toEqual(['UNKNOWN', UNPARSEABLE]);
      expect(personOf(f.world, P.id)!['riskSource'], `${what}: stored as the flow's`).toBe('FLOW');
      expect(logText(f), `${what}: the log holds no service message text (BE-18)`).not.toMatch(/secret service text/);
      const w = web({ ...worldOf(), ...extra }, P.id, HR_A);
      expect(w.status, `${what}: the web call answers 200`).toBe(200);
      expect(w.body, `${what}: UNKNOWN`).toEqual({ employeeId: P.id, risk: 'UNKNOWN', reason: UNPARSEABLE });
    }

    // The code side: the repo's own AI guard check passes, and the card adds no AI client outside lambda/ or without the guard.
    const guard = (() => {
      try {
        return { ok: true, out: execFileSync('python3', [join(REPO, 'scripts', 'ci', 'check-ai-guard.py')], { cwd: REPO, encoding: 'utf8', stdio: 'pipe' }) };
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string };
        return { ok: false, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
      }
    })();
    expect(guard.ok, `scripts/ci/check-ai-guard.py passes:\n${guard.out}`).toBe(true);
    const tracked = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);
    const AI_CLIENT = /new\s+\w*(?:Bedrock|Textract|Comprehend|Rekognition|SageMaker)\w*Client\s*\(|boto3\.client\(\s*['"](?:bedrock|textract|comprehend|rekognition)|client-bedrock-runtime['"]|client-textract['"]/;
    const outside = tracked.filter((f) => {
      if (!/\.(m?js|cjs|ts|py|sh|ya?ml)$/.test(f)) return false;
      if (f.startsWith('lambda/') || f.includes('/fake-aws/') || f.startsWith('node_modules/') || f === 'scripts/ci/check-ai-guard.py') return false;
      if (/^pepla-web\/e2e\/acceptance\/[^/]+\.spec\.ts$/.test(f)) return false; // specs name the clients as text only
      return existsSync(join(REPO, f)) && AI_CLIENT.test(readFileSync(join(REPO, f), 'utf8'));
    });
    expect(outside, 'no script, workflow, test or app file outside lambda/ makes an AI client').toEqual([]);
    const shared = join(REPO, 'lambda', 'shared', 'risk-summary.mjs');
    if (existsSync(shared)) expect(readFileSync(shared, 'utf8'), 'the shared summary module holds no AI client').not.toMatch(AI_CLIENT);
  });

  test('AC-5 The check starts when the last required document is in: one signal, from the read that moves the person to In review', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const T = 'TOKEN-ONB11-EMP-1100010';
    const E = 'EMP-1100010';
    const ms = (n: number) => 1763100000000 + n * 60_000;
    const docId = (n: number) => `doc_${ms(n)}`;
    type Doc = { n: number; type: string; status: string; hr?: boolean };
    const docRow = (emp: string, d: Doc, tenant: string | null = COMPANY_A): Row => row({
      employee_id: emp, document_id: docId(d.n), document_type: d.type, file_name: `${d.type.toLowerCase()}.pdf`, s3_key: keyOf(emp, d),
      upload_timestamp: new Date(ms(d.n)).toISOString(), ocr_status: d.status,
      ocr_completed_at: d.status === 'PENDING' ? undefined : new Date(ms(d.n) + 30_000).toISOString(),
      hr_reviewed_at: d.hr ? '2026-11-13T09:00:00.000Z' : undefined, tenant_id: tenant === null ? undefined : tenant,
    });
    const keyOf = (emp: string, d: Doc) => `uploads/${emp}/${d.type}/${docId(d.n)}_${d.type.toLowerCase()}.pdf`;
    const waiting = (type: string, n: number): Doc => ({ n, type, status: 'MANUAL_REVIEW' });
    const pending = (type: string, n: number): Doc => ({ n, type, status: 'PENDING' });
    const PDF_B64 = Buffer.from('%PDF-1.4\n% ONB-11 made-up file\n%%EOF\n').toString('base64');

    function worldFor(opts: { emp?: string; email?: string; step?: string; stage?: string; token?: string | null; tenant?: string | null; docs: Doc[]; docTenant?: string | null }, extra: Partial<World> = {}): World {
      const emp = opts.emp ?? E;
      return {
        tables: {
          employees: [personRow({ id: emp, email: opts.email ?? robotEmail, step: opts.step ?? 'DOCUMENTS', stage: opts.stage ?? 'ACTIVE', token: opts.token === null ? undefined : opts.token ?? T, tenant: opts.tenant })],
          documents: opts.docs.map((d) => docRow(emp, d, opts.docTenant)),
          'document-verification': [],
        },
        ...extra,
      };
    }
    /** processDocumentOCR on the upload of `doc` (its row is added as the upload link wrote it, PENDING, unless there). */
    function read(world: World, doc: Doc, emp = E, docTenant: string | null = COMPANY_A): Run {
      const w = structuredClone(world);
      if (!w.tables.documents.some((r) => (r['employee_id'] as { S: string }).S === emp && (r['document_id'] as { S: string }).S === docId(doc.n))) w.tables.documents.push(docRow(emp, pending(doc.type, doc.n), docTenant));
      w.s3 = { ...(w.s3 ?? {}), [`document-ocr-verification-uploads-onb11/${keyOf(emp, doc)}`]: PDF_B64 };
      return runHandler(OCR, w, s3Event(keyOf(emp, doc)));
    }
    const signals = (run: Run) => sfnCalls(run).filter((c) => c.op === 'SendTaskSuccess');
    const step = (run: Run, emp = E) => personOf(run.world, emp)?.['step'];
    function readOk(world: World, doc: Doc, what: string, emp = E): Run {
      const run = read(world, doc, emp);
      expect(run.error, `${what}: processDocumentOCR finishes without throwing (${run.error?.message ?? ''})`).toBeUndefined();
      expect(run.response?.statusCode, `${what}: 200`).toBe(200);
      return run;
    }

    // ID then bank: no signal at the ID, exactly one at the bank, carrying the token and the employee id.
    let w = worldFor({ docs: [] });
    const idRead = readOk(w, pending(ID, 1), 'the ID');
    expect(signals(idRead), 'ID alone: no signal').toEqual([]);
    expect(step(idRead), 'ID alone: still Documents').toBe('DOCUMENTS');
    const bankRead = readOk(idRead.world, pending(BANK, 2), 'the bank letter');
    expect(step(bankRead), 'the second required document moves the person to In review').toBe('IN_REVIEW');
    expect(signals(bankRead).length, 'the second required document: exactly one signal').toBe(1);
    expect(signals(bankRead)[0]!.token, 'carrying the task token').toBe(T);
    expect((signals(bankRead)[0]!.output as Record<string, unknown>)['employeeId'], 'and the employee id').toBe(E);
    // The other order.
    const bankFirst = readOk(w, pending(BANK, 1), 'the bank letter first');
    expect(signals(bankFirst), 'bank alone: no signal').toEqual([]);
    const thenId = readOk(bankFirst.world, pending(ID, 2), 'then the ID');
    expect(signals(thenId).length, 'bank then ID: exactly one signal').toBe(1);
    expect(signals(thenId)[0]!.token).toBe(T);

    // Matric and tertiary alone never start it. A bank row still PENDING does not count.
    const m = readOk(w, pending(MATRIC, 1), 'matric');
    expect(signals(m), 'matric alone: no signal').toEqual([]);
    const t = readOk(m.world, pending(TERT, 2), 'tertiary');
    expect(signals(t), 'matric and tertiary: no signal').toEqual([]);
    expect(step(t), 'matric and tertiary leave the step at Documents').toBe('DOCUMENTS');
    const notRead = readOk(worldFor({ docs: [pending(BANK, 1)] }), pending(ID, 2), 'the ID with the bank letter only PENDING');
    expect(signals(notRead), 'a PENDING bank row does not count').toEqual([]);

    // An unreadable bank file counts as in, and signals once. (A real person: Textract is a recording fake that fails.)
    const unreadable = read(worldFor({ email: 'sizwe.ndaba@kestrel-foods.co.za', docs: [waiting(ID, 1)] }, { textract: { error: 'UnsupportedDocumentException' } }), pending(BANK, 2));
    expect(unreadable.error, 'an unreadable file does not throw').toBeUndefined();
    expect(unreadable.response?.statusCode).toBe(200);
    expect(unreadable.response?.body?.ocrStatus, 'it waits for HR').toBe('MANUAL_REVIEW');
    expect(step(unreadable), 'an unreadable second document still counts as in').toBe('IN_REVIEW');
    expect(signals(unreadable).length, 'and signals once').toBe(1);

    // After In review, one more document signals nothing (the token is still on the row, so a signal would show).
    const inReview = worldFor({ step: 'IN_REVIEW', stage: 'DOCUMENTS_SUBMITTED', docs: [waiting(ID, 1), waiting(BANK, 2)] });
    const after = readOk(inReview, pending(MATRIC, 3), 'one more document after In review');
    expect(signals(after), 'a read after In review: no signal').toEqual([]);
    const newBank = readOk(inReview, pending(BANK, 4), 'a newer bank copy while still In review');
    expect(signals(newBank), 'a read that finds the person already In review: no signal').toEqual([]);

    // HR sent the bank letter back; a new copy arrives. The signal is attempted, the spent token is refused, the read stands.
    const sentBackWorld = (extra: Partial<World>, token: string | null = T) => worldFor({ token, docs: [waiting(ID, 1), { n: 2, type: BANK, status: 'FAILED', hr: true }] }, extra);
    const refused = readOk(sentBackWorld({ spentTokens: [T] }), pending(BANK, 3), 'a new bank copy after a send-back (spent token)');
    const noToken = readOk(sentBackWorld({}, null), pending(BANK, 3), 'a new bank copy after a send-back (no token)');
    expect(signals(refused).length, 'the signal is attempted once').toBe(1);
    expect(signals(refused)[0]!.token).toBe(T);
    expect(step(refused), 'the step still moves to In review').toBe('IN_REVIEW');
    expect(refused.response?.statusCode, 'the read still answers 200').toBe(200);
    expect(published(refused).map((e) => e.detailType).sort(), 'the same events as a read with no token').toEqual(published(noToken).map((e) => e.detailType).sort());
    const { verificationId: _v1, ...answerRefused } = refused.response?.body ?? {};
    const { verificationId: _v2, ...answerNoToken } = noToken.response?.body ?? {};
    expect(answerRefused, 'the same answer as a read with no token').toEqual(answerNoToken);
    const warns = (run: Run) => run.calls.filter((c) => c.service === 'log' && (c as { level: string }).level === 'warn').length;
    expect(warns(refused), 'the refusal is logged as a warning').toBeGreaterThan(warns(noToken));
    const { sfn_task_token: _a, documents_started_at: _t1, ...personRefused } = personOf(refused.world, E)!;
    const { sfn_task_token: _b, documents_started_at: _t2, ...personNoToken } = personOf(noToken.world, E)!;
    expect(personRefused, 'nothing else on the person changes').toEqual(personNoToken);

    // A repeat of the S3 event: no signal at all. No token: none. A token on another company's row: none.
    const repeat = runHandler(OCR, bankRead.world, s3Event(keyOf(E, pending(BANK, 2))));
    expect(repeat.error).toBeUndefined();
    expect(sfnCalls(repeat), 'a repeat S3 event: no Step Functions call').toEqual([]);
    const none = readOk(worldFor({ token: null, docs: [waiting(ID, 1)] }), pending(BANK, 2), 'the second document of a person with no token');
    expect(step(none), 'no token: the step still moves').toBe('IN_REVIEW');
    expect(sfnCalls(none), 'no token: no Step Functions call').toEqual([]);
    const foreign = readOk(worldFor({ tenant: COMPANY_B, docs: [waiting(ID, 1)] }), pending(BANK, 2), "a token on another company's row");
    expect(signals(foreign), "a token on another company's row: no signal").toEqual([]);

    // A signal that cannot be sent changes nothing else (the same read, with and without the refusal).
    const stable = (w: World) => rowsOf(w, 'documents').map((r) => Object.fromEntries(Object.entries(r ?? {}).filter(([k]) => !/_at$|verification_id/.test(k))));
    expect(stable(refused.world), 'the documents are the same with and without the refused signal').toEqual(stable(noToken.world));
  });

  test('AC-6 The state machine file matches the Lambda: no heartbeat, 30 days, the keys it reads exist, no "completed", a Catch on every task', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const file = join(REPO, 'infra', 'step-functions', 'naleko-onboarding-flow.asl.json');
    const asl = JSON.parse(readFileSync(file, 'utf8')) as { StartAt: string; States: Record<string, any> };
    const states = asl.States;
    const walk = (node: unknown, visit: (key: string, value: unknown) => void): void => {
      if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
      else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) { visit(k, v); walk(v, visit); }
    };

    const keys: string[] = [];
    walk(asl, (k) => keys.push(k));
    expect(keys, 'no HeartbeatSeconds anywhere').not.toContain('HeartbeatSeconds');
    expect(states['WaitForDocumentUpload']?.TimeoutSeconds, 'WaitForDocumentUpload waits at least 30 days').toBeGreaterThanOrEqual(2592000);
    expect(states['WaitForDocumentUpload']?.Catch?.length, 'and keeps its Catch').toBeGreaterThan(0);
    for (const c of states['WaitForDocumentUpload'].Catch) expect(c.Next).toBe('OnboardingFailed');

    // Every state reads only keys the real flow answer has.
    const answer = Object.keys(flow(worldOf()).response as Record<string, unknown>);
    expect(answer.length, 'the flow answer has keys').toBeGreaterThan(0);
    const reads = new Set<string>();
    walk(asl, (_k, v) => {
      if (typeof v === 'string') for (const m of v.matchAll(/\$\.riskResult\.Payload\.([A-Za-z0-9_]+)/g)) reads.add(m[1]!);
    });
    expect(reads.size, 'a state reads the check result').toBeGreaterThan(0);
    for (const k of reads) expect(answer, `the state machine reads $.riskResult.Payload.${k}: the Lambda's flow answer has it`).toContain(k);

    // AssessRisk: exactly the marker and the employee id; Retry and Catch kept.
    const assess = states['AssessRisk'];
    expect(assess, 'AssessRisk exists').toBeTruthy();
    expect(assess.Parameters.Payload, 'the payload is exactly source and employeeId, nothing personal').toEqual({ source: FLOW_SOURCE, 'employeeId.$': '$.employeeId' });
    expect(assess.Retry?.length, 'AssessRisk keeps its Retry').toBeGreaterThan(0);
    expect(assess.Retry.flatMap((r: { ErrorEquals: string[] }) => r.ErrorEquals), 'for the transient Lambda errors').toContain('Lambda.ServiceException');
    expect(assess.Catch?.some((c: { Next: string }) => c.Next === 'OnboardingFailed'), 'and its Catch to OnboardingFailed').toBe(true);

    // The success state: onboarding.risk_assessed with its four keys, from the answer, with a Catch.
    const detailTypes: Array<[string, any]> = Object.entries(states).flatMap(([name, s]) => (s.Parameters?.Entries ?? []).map((e: any) => [name, e] as [string, any]));
    expect(detailTypes.filter(([, e]) => e.DetailType === 'onboarding.completed'), 'no state publishes onboarding.completed').toEqual([]);
    const ok = detailTypes.filter(([, e]) => e.DetailType === 'onboarding.risk_assessed');
    expect(ok.length, 'one state publishes onboarding.risk_assessed').toBe(1);
    const [okName, okEntry] = ok[0]!;
    expect(okEntry.EventBusName, 'to the onboarding bus').toBe('naleko-onboarding');
    expect(states[okName].Resource, 'with the events:putEvents integration').toBe('arn:aws:states:::events:putEvents');
    expect(Object.keys(okEntry.Detail).sort(), 'with employee_id, tenant_id, risk_band and risk_reason').toEqual(['employee_id.$', 'risk_band.$', 'risk_reason.$', 'tenant_id.$']);
    expect(okEntry.Detail['employee_id.$']).toBe('$.employeeId');
    for (const k of ['tenant_id.$', 'risk_band.$', 'risk_reason.$']) expect(okEntry.Detail[k], `${k} comes from the Lambda's answer`).toMatch(/^\$\.riskResult\.Payload\./);
    expect(states[okName].Catch?.some((c: { Next: string }) => c.Next === 'OnboardingFailed'), 'the success state has a Catch to OnboardingFailed').toBe(true);
    expect(states['OnboardingFailed'], 'OnboardingFailed is kept').toBeTruthy();
    expect(detailTypes.some(([n, e]) => n === 'OnboardingFailed' && e.DetailType === 'onboarding.failed'), 'and still publishes onboarding.failed').toBe(true);

    // Every step leads somewhere that exists, and everything is reachable.
    expect(states[asl.StartAt], 'StartAt is a state').toBeTruthy();
    const reachable = new Set<string>();
    const go = (name: string) => {
      if (reachable.has(name)) return;
      expect(states[name], `a state named ${name} exists`).toBeTruthy();
      reachable.add(name);
      const s = states[name];
      if (s.Next) go(s.Next);
      for (const c of s.Catch ?? []) go(c.Next);
      for (const c of s.Choices ?? []) go(c.Next);
      if (s.Default) go(s.Default);
    };
    go(asl.StartAt);
    expect([...reachable].sort(), 'every state can be reached').toEqual(Object.keys(states).sort());
    expect(states[okName].End === true || Boolean(states[okName].Next), 'the success state ends or continues').toBe(true);
  });

  test('AC-7 HR can read the result; the employee cannot', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const risk = { band: 'HIGH', reason: 'The bank letter does not match the account holder.', at: '2026-11-18T08:30:00.000Z', source: 'FLOW' };
    const OWNER_SUB = 'sub-lindiwe-owner';
    const owner: Caller = { kind: 'jwt', email: P.email, groups: ['employee'], tenant: COMPANY_A, sub: OWNER_SUB };
    const stranger: Caller = { kind: 'jwt', email: 'someone.else@kestrel-foods.co.za', groups: ['employee'], tenant: COMPANY_A, sub: 'sub-someone-else' };
    const withRisk = () => worldOf({ userSub: OWNER_SUB, risk });
    const noRisk = () => worldOf({ userSub: OWNER_SUB });
    const EMPLOYEE_KEYS = ['department', 'email', 'employee_id', 'first_name', 'hr_staff_email', 'hr_staff_id', 'hr_staff_name', 'job_title', 'last_name', 'phone', 'planned_start_date', 'stage', 'step'];
    const RISK_KEYS = ['risk_assessed_at', 'risk_band', 'risk_reason'];
    const ask = (world: World, caller: Caller) => ran(runHandler(PERSON, world, personEvent(P.id, caller)), 'getEmployeeDocumentVerifications');

    const hr = ask(withRisk(), HR_A);
    expect(hr.status, `HR: 200 (${hr.raw.slice(0, 200)})`).toBe(200);
    const emp = hr.body.employee as Record<string, unknown>;
    expect([emp['risk_band'], emp['risk_reason'], emp['risk_assessed_at']], 'HR gets the stored band, reason and time').toEqual([risk.band, risk.reason, risk.at]);
    expect(Object.keys(emp).sort(), "HR's employee holds today's keys and the three risk keys").toEqual([...EMPLOYEE_KEYS, ...RISK_KEYS].sort());
    expect(Object.keys(hr.body).sort(), 'the answer has the same four parts as today').toEqual(['documents', 'employee', 'required_documents', 'summary']);

    const none = ask(noRisk(), HR_A);
    expect(none.status).toBe(200);
    const nEmp = none.body.employee as Record<string, unknown>;
    for (const k of RISK_KEYS) {
      expect(k in nEmp, `HR, no check yet: ${k} is in the answer`).toBe(true);
      expect(nEmp[k], `HR, no check yet: ${k} is null`).toBeNull();
    }

    // The person themselves: the three keys are not there at all, nowhere in the answer.
    const own = ask(withRisk(), owner);
    expect(own.status, `the employee reads their own page's answer (${own.raw.slice(0, 200)})`).toBe(200);
    expect(Object.keys(own.body.employee).sort(), "the employee's employee holds today's keys only").toEqual(EMPLOYEE_KEYS);
    expect(own.raw, 'no risk key anywhere in the employee\'s answer').not.toMatch(/risk/i);
    expect(own.raw, "nor the band or the reason's words").not.toContain(risk.reason);
    expect(Object.keys(own.body).sort(), 'the same four parts').toEqual(['documents', 'employee', 'required_documents', 'summary']);

    // Strangers and other companies are refused as before, and learn nothing.
    const refused = ask(withRisk(), stranger);
    expect(refused.status, 'a stranger gets 403').toBe(403);
    expect(refused.raw).not.toMatch(/risk|HIGH/i);
    const other = ask(withRisk(), HR_B);
    expect(other.status, "another company's HR gets 404").toBe(404);
    expect(other.raw).not.toMatch(/risk|HIGH/i);

    // getEmployee (the agent's route) reads the stored fields, with the same keys as today.
    const agent = ran(runHandler(GET_EMPLOYEE, withRisk(), agentEmployeeEvent(P.id, AGENT_A)), 'getEmployee');
    expect(agent.status, `getEmployee answers 200 (${agent.raw.slice(0, 200)})`).toBe(200);
    const a = agent.body.employee as Record<string, unknown>;
    expect([a['risk_band'], a['risk_reason']], 'getEmployee answers the stored band and reason').toEqual([risk.band, risk.reason]);
    expect(Object.keys(a).sort(), 'getEmployee keeps its keys').toEqual(['created_at', 'department', 'email', 'employee_id', 'first_name', 'last_name', 'risk_band', 'risk_reason', 'stage', 'updated_at'].sort());
    const agentOther = ran(runHandler(GET_EMPLOYEE, withRisk(), agentEmployeeEvent(P.id, { kind: 'agent', tenant: COMPANY_B })), 'getEmployee');
    expect(agentOther.status, "another company's agent gets 404").toBe(404);
  });

  // ---------------------------------------------------------------- the page

  /** A person whose documents the page reads, with the three risk keys the test gives (or none, as for the employee's own view). */
  function riskPerson(risk: { band: string | null; reason: string | null; at: string | null } | undefined, extra: Partial<FakePerson['employee']> = {}): FakePerson {
    const e = storedEmployee({ first_name: 'Kagiso', last_name: 'Molefe', job_title: 'Bookkeeper', department: 'Finance', stage: 'DOCUMENTS_SUBMITTED', ...extra });
    const employee = { ...e, step: 'IN_REVIEW', ...(risk ? { risk_band: risk.band, risk_reason: risk.reason, risk_assessed_at: risk.at } : {}) };
    return { employee, documents: [] };
  }
  const REASON = 'The bank letter shows a different account holder from the ID.';
  const nameOf = (p: FakePerson) => `${p.employee.first_name} ${p.employee.last_name}`;
  const personPath = (id: string) => `/hr/employees/${encodeURIComponent(id)}`;
  async function openPerson(page: Page, signIn: SignInPage, hr: Login, id: string): Promise<void> {
    await page.goto(personPath(id));
    await expect(signIn.email).toBeVisible();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(new RegExp(`${esc(personPath(id))}$`));
  }
  const heading1 = (page: Page): Locator => page.getByRole('heading', { level: 1 });
  const messages = (page: Page): Locator => page.locator('pp-section-message, pp-inline-message');
  const mainText = async (page: Page) => clean(await page.locator('main').innerText());

  async function noSidewaysScroll(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const out: string[] = [];
      if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
      for (const el of document.querySelectorAll('main *')) {
        const s = getComputedStyle(el);
        if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()}.${el.className} ${el.scrollWidth} > ${el.clientWidth}`);
      }
      return out;
    });
  }

  /** Every heading, link and button in main that a person can see: inside the width, below the top bar, and reached by a tap. */
  async function hiddenOrCovered(page: Page): Promise<string[]> {
    return page.evaluate(async () => {
      const out: string[] = [];
      const bar = document.querySelector('.pp-top-navigation, [role="banner"]');
      const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
      const els = [...document.querySelectorAll('main :is(h1,h2,h3,h4,h5,h6,[role="heading"],a[href],button,pp-lozenge)')].filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null;
      });
      const name = (el: Element) => `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${(el as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
      window.scrollTo(0, 0);
      document.querySelector('main')?.scrollTo?.(0, 0);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.top < barBottom - 1) out.push(`${name(el)} starts under the top bar (${Math.round(r.top)} < ${Math.round(barBottom)})`);
        if (r.left < -1 || r.right > window.innerWidth + 1) out.push(`${name(el)} is outside the screen's width`);
      }
      for (const el of els) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2)), r.top + r.height / 2);
        if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) out.push(`${name(el)} is covered by ${hit ? hit.tagName.toLowerCase() + '.' + hit.className : 'nothing'}`);
      }
      window.scrollTo(0, 0);
      return out;
    });
  }

  test('AC-8 The employee page shows the risk to HR: each result reads differently with the stored reason as written; nothing for the employee\'s view; no extra call', async ({ page, signIn, hr, docs, baseURL }) => {
    noBackendOnly();
    const seen: Array<{ method: string; url: URL }> = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') seen.push({ method: r.method(), url });
    });
    const at = '2026-11-18T08:30:00.000Z';
    const shown: Record<string, string> = {};
    let first = true;
    for (const band of ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'] as const) {
      const p = riskPerson({ band, reason: REASON, at });
      docs!.add(p);
      if (first) await openPerson(page, signIn, hr, p.employee.employee_id);
      else await page.goto(personPath(p.employee.employee_id));
      first = false;
      await expect(heading1(page)).toHaveText(nameOf(p));
      const block = messages(page).filter({ hasText: REASON });
      await expect(block, `${band}: one risk block with the reason`).toHaveCount(1);
      await expect(block, `${band}: the block is visible`).toBeVisible();
      const text = clean(await block.innerText());
      expect(text, `${band}: the stored reason shows as written`).toContain(REASON);
      shown[band] = clean(text.replace(REASON, ''));
      expect(shown[band], `${band}: the block says something besides the reason (heading and result)`).not.toBe('');
      if (RISK_WORDS) {
        expect(text, `${band}: the block's heading is Iggie's`).toContain(RISK_WORDS.heading);
        expect(text, `${band}: the result words are Iggie's`).toContain(RISK_WORDS[band]);
      }
    }
    expect(new Set(Object.values(shown)).size, 'LOW, MEDIUM, HIGH and UNKNOWN each read differently').toBe(4);

    // No check yet: the three keys are there and null. The page says so (some words besides the employee's view).
    const pending = riskPerson({ band: null, reason: null, at: null });
    docs!.add(pending);
    await page.goto(personPath(pending.employee.employee_id));
    await expect(heading1(page)).toHaveText(nameOf(pending));
    // The employee's view: the three keys are not in the answer at all.
    const employeeView = riskPerson(undefined);
    docs!.add(employeeView);
    await page.goto(personPath(employeeView.employee.employee_id));
    await expect(heading1(page)).toHaveText(nameOf(employeeView));
    await expect(messages(page), 'no risk block when the answer has no risk keys').toHaveCount(0);
    const viewText = (await mainText(page)).replace(nameOf(employeeView), '').replace(employeeView.employee.employee_id, '');
    await page.goto(personPath(pending.employee.employee_id));
    await expect(heading1(page)).toHaveText(nameOf(pending));
    const pendingText = (await mainText(page)).replace(nameOf(pending), '').replace(pending.employee.employee_id, '');
    expect(pendingText.length, 'before any check has run the page says so (more than the employee\'s view shows)').toBeGreaterThan(viewText.length);
    if (RISK_WORDS) {
      expect(pendingText, 'the "no check yet" line is Iggie\'s').toContain(RISK_WORDS.none);
      expect(pendingText, 'with the block heading').toContain(RISK_WORDS.heading);
    }

    // One heading level one; axe finds nothing serious; no "Ask Batsi" or risk-check button in the page content; only the one answer is read.
    await expect(heading1(page), 'one level-one heading').toHaveCount(1);
    const high = riskPerson({ band: 'HIGH', reason: REASON, at });
    docs!.add(high);
    await page.goto(personPath(high.employee.employee_id));
    await expect(messages(page).filter({ hasText: REASON })).toHaveCount(1);
    const bad = (await new AxeBuilder({ page }).analyze()).violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help} :: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    expect(bad, 'axe on the employee page with a risk block').toEqual([]);
    await expect(heading1(page), 'one level-one heading with the block').toHaveCount(1);
    // Child lock onb-11.3: the page content, not the HR top bar. CHAT-01 puts "Ask Batsi" in the top bar of every HR page;
    // ONB-11 means there is no button in the page itself that runs the check. Same words, looked for inside <main> only.
    await expect(page.locator('main'), 'the page content is one <main>, so the button check below cannot pass by looking at nothing').toHaveCount(1);
    await expect(page.locator('main').getByRole('button', { name: /Ask Batsi|assess risk/i }), 'no button to run the check in the page content').toHaveCount(0);
    // Outside <main> the only change CHAT-01 needs is its one Ask Batsi button; a risk-check button is still wrong anywhere.
    await expect(page.getByRole('button', { name: /assess risk/i }), 'no button to run the check anywhere on the page').toHaveCount(0);
    expect(await page.getByRole('button', { name: /Ask Batsi/i }).count(), 'at most the top bar\'s one Ask Batsi button').toBeLessThanOrEqual(1);

    await page.waitForLoadState('networkidle');
    const app = new URL(baseURL!).origin;
    const cognito = /^cognito-idp\.[a-z0-9-]+\.amazonaws\.com$/;
    const fonts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
    const outside = seen.filter((s) => !(s.method === 'GET' && /\/v1\/company\/modules$/.test(s.url.pathname)) && s.url.origin !== app && !cognito.test(s.url.hostname) && !fonts.has(s.url.hostname));
    expect(outside.filter((s) => !/\/v1\/employees\/[^/]+\/verifications$/.test(s.url.pathname)).map((s) => `${s.method} ${s.url.href}`), "no call beyond ONB-12's one answer").toEqual([]);
    expect(outside.filter((s) => s.method !== 'GET' && s.method !== 'OPTIONS').map((s) => `${s.method} ${s.url.pathname}`), 'only GET').toEqual([]);
    const ai = /\/agent\/|\/ai\/|\/chat|batsi|\/summary|assess-risk|risk-report|bedrock|textract|anthropic|openai/i;
    expect(seen.filter((s) => ai.test(s.url.href)).map((s) => s.url.href), 'no AI route is called').toEqual([]);

    // Only pp-* components: the repo's design check.
    execFileSync('node', ['scripts/verify-design.mjs'], { cwd: join(REPO, 'pepla-web'), encoding: 'utf8', stdio: 'pipe' });
  });

  test('AC-9 Phone: the risk block, every heading and button on the employee page are visible and clear of the top bar, and nothing scrolls sideways', async ({ page, signIn, hr, docs }, testInfo) => {
    noBackendOnly();
    test.skip(testInfo.project.name !== 'phone-390', 'The phone criterion: 390 wide.');
    const long = `${REASON} ${'The name on the letter, the date on it and the account type all need a second look before anyone accepts it. '.repeat(2)}`.trim();
    let first = true;
    for (const [band, reason] of [['HIGH', long], ['UNKNOWN', AI_SKIPPED_LABEL], ['LOW', null]] as const) {
      const p = riskPerson({ band: reason === null ? null : band, reason, at: reason === null ? null : '2026-11-18T08:30:00.000Z' }, { first_name: 'Nokuthula-Precious', last_name: 'Mahlangu-Vilakazi', job_title: 'Senior Payroll and Benefits Administrator' });
      docs!.add(p);
      if (first) await openPerson(page, signIn, hr, p.employee.employee_id);
      else await page.goto(personPath(p.employee.employee_id));
      first = false;
      await expect(heading1(page)).toHaveText(nameOf(p));
      if (reason !== null) {
        const block = messages(page).filter({ hasText: reason.slice(0, 40) });
        await expect(block, `${band}: the risk block is visible at 390`).toBeVisible();
        const box = (await block.boundingBox())!;
        expect(box.x >= 0 && box.x + box.width <= 391, `${band}: the risk block is inside the 390 width`).toBe(true);
      }
      expect(await noSidewaysScroll(page), `${band}: nothing scrolls sideways`).toEqual([]);
      expect(await hiddenOrCovered(page), `${band}: every heading, link and button is visible and not under the top bar`).toEqual([]);
    }
  });

  // ---------------------------------------------------------------- the API spec and the permissions

  test('AC-10 The API spec gives the risk keys and what the flow does; no role gains a permission, and no table or route changes', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const field = (path: string, method: string, status: string, f: string) =>
      JSON.parse(execFileSync('python3', [join(__dirname, 'support', 'onb-11', 'openapi_field.py'), join(REPO, 'api', 'openapi.yaml'), path, method, status, f], { encoding: 'utf8' })) as { found: boolean; type?: unknown; nullable?: boolean; description?: string };
    const route = '/v1/employees/{id}/verifications';
    for (const [k, type] of [['risk_band', 'string'], ['risk_reason', 'string'], ['risk_assessed_at', 'string']] as const) {
      const f = field(route, 'get', '200', `employee.${k}`);
      expect(f.found, `GET ${route} 200 lists employee.${k}`).toBe(true);
      expect(f.type === type || (Array.isArray(f.type) && (f.type as unknown[]).includes(type)), `employee.${k} is a ${type}`).toBe(true);
      expect(f.nullable, `employee.${k} may be null`).toBe(true);
      expect(f.description ?? '', `employee.${k} says HR only`).toMatch(/HR only/i);
    }
    const band = field(route, 'get', '200', 'employee.risk_band');
    for (const v of ['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN']) expect(band.description ?? '', `employee.risk_band's description gives the meaning of ${v}`).toContain(v);
    const spec = readFileSync(join(REPO, 'api', 'openapi.yaml'), 'utf8');
    const assess = /\n {2}\/v1\/employees\/\{id\}\/assess-risk:[\s\S]*?(?=\n {2}\/)/.exec(spec)?.[0] ?? '';
    expect(assess, 'the assess-risk route is still described').not.toBe('');
    expect(`${band.description} ${assess}`, 'the spec says the flow runs when every required document is in').toMatch(/every required document|all required documents|both required documents/i);
    expect(`${band.description} ${assess}`, 'and what UNKNOWN means').toContain('UNKNOWN');

    // Terraform: the three policies, the three roles, the five onboarding tables and the risk and verification routes are as on develop at 542797c.
    const base = JSON.parse(readFileSync(join(__dirname, 'support', 'onb-11', 'iam-542797c', 'baseline.json'), 'utf8')) as {
      policies: Record<string, { role: string; pairs: string[] }>; roles: Record<string, string>; tables: Record<string, string>; routes: string[];
    };
    const now = policyLines();
    for (const [key, was] of Object.entries(base.policies)) {
      expect(now[key], `${key} is still declared`).toBeTruthy();
      expect(now[key]!.pairs, `${key} grants exactly what it did (no role gains a permission, none loses one)`).toEqual(was.pairs);
    }
    for (const [name, was] of Object.entries(base.roles)) {
      const b = resourcesOf('infra', 'aws_iam_role').filter((x) => x.labels[1] === name);
      expect(b.length, `aws_iam_role.${name} is declared once`).toBe(1);
      expect(squash(b[0]!.raw), `aws_iam_role.${name} is unchanged`).toBe(was);
    }
    for (const [name, was] of Object.entries(base.tables)) {
      const b = resourcesOf('infra', 'aws_dynamodb_table').filter((x) => x.labels[1] === name);
      expect(b.length, `aws_dynamodb_table.${name} is declared once`).toBe(1);
      expect(squash(b[0]!.raw), `aws_dynamodb_table.${name} is unchanged`).toBe(was);
    }
    const routes = new Set<string>();
    for (const file of ['apigateway.tf', 'agent_api.tf']) {
      for (const b of blocks([join(REPO, 'infra', file)], 'resource').filter((x) => x.labels[0] === 'aws_apigatewayv2_route')) {
        const m = /route_key\s*=\s*"([^"]+)"/.exec(b.body);
        if (m && /risk|verifications/.test(m[1]!)) routes.add(m[1]!);
      }
    }
    // ONB-14 (re-lock onb-11.N): the one new verification route is the recorded Show.
    expect([...routes].filter((r) => r !== 'POST /v1/verifications/{id}/reveal').sort(), 'the risk and verification routes are unchanged').toEqual(base.routes);
    const stepFn = readFileSync(join(REPO, 'infra', 'stepfunctions.tf'), 'utf8');
    expect(stepFn, 'stepfunctions.tf still reads the definition from the file').toMatch(/file\(\s*"\$\{path\.module\}\/step-functions\/naleko-onboarding-flow\.asl\.json"\s*\)|naleko-onboarding-flow\.asl\.json/);
  });

  // ---------------------------------------------------------------- pepla-dev

  test('AC-11 pepla-dev: the flow runs for a test person and leaves the stand-in result, and the employee sees none of it @pepla-dev', async ({ page, signIn, hr }, testInfo) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only: AC-1 to AC-7 hold the Lambdas to this in the no-backend run.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once, at one width.');
    test.setTimeout(420_000);
    const envText = existsSync(join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts')) ? readFileSync(join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts'), 'utf8') : '';
    const apiOf = (key: string) => {
      const m = new RegExp(`${key}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`).exec(envText);
      expect(m, `pepla-web/src/environments/environment.ts has ${key}`).toBeTruthy();
      expect(m![1], `${key} points at pepla-dev, not the placeholder`).not.toMatch(/\.invalid\b/);
      return m![1]!.replace(/\/+$/, '');
    };
    const employeesApi = apiOf('employeesApiUrl');
    const documentsApi = apiOf('documentUploadApiUrl');
    const PDF = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    );
    const signInForToken = async (login: Login): Promise<string> => {
      let token = '';
      const listen = async (r: import('@playwright/test').Response) => {
        if (!/cognito-idp\.[a-z0-9-]+\.amazonaws\.com/.test(r.url()) || r.request().method() !== 'POST') return;
        try {
          const body = (await r.json()) as { AuthenticationResult?: { IdToken?: string } };
          if (body.AuthenticationResult?.IdToken) token = body.AuthenticationResult.IdToken;
        } catch {
          /* not JSON */
        }
      };
      page.on('response', listen);
      await signIn.open();
      await signIn.signInAs(login);
      await expect.poll(() => token, { message: `Cognito hands ${login.email} an ID token`, timeout: 30_000 }).not.toBe('');
      page.off('response', listen);
      return token;
    };

    // HR registers a test address through the real call (this starts a real execution) and takes the invite link.
    const hrToken = await signInForToken(hr);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const email = `e2e.run-${stamp}@blackhole.postmarkapp.com`;
    const res = await page.request.post(`${employeesApi}/v1/employees`, {
      headers: { Authorization: `Bearer ${hrToken}`, 'content-type': 'application/json', 'Idempotency-Key': randomUUID() },
      data: { first_name: 'Zanele', last_name: `Risk${Math.floor(Math.random() * 1e4)}`, email, phone: '081 234 5678', department: 'Operations', job_title: 'Test starter', planned_start_date: '2026-12-01' },
    });
    expect(res.status(), `register ${email}: ${await res.text()}`).toBe(201);
    const created = (await res.json()) as { employee?: { employee_id?: string }; invite?: { link?: string } };
    const employeeId = String(created.employee?.employee_id ?? '');
    expect(employeeId, 'the answer names the new person').not.toBe('');
    const invited = created.invite?.link ?? '';
    expect(invited, 'the answer carries invite.link for a test login and a test address').toMatch(/\/set-password#token=[\w-]{43}$/);
    const path = new URL(invited);

    // The person sets a password, signs in, and uploads an ID and a bank letter.
    await forgetSignIn(page);
    await page.goto(`${path.pathname}${path.hash}`);
    await expect(page.getByRole('heading', { name: 'Set your password', exact: true })).toBeVisible({ timeout: 30_000 });
    const password = `Dev-${randomBytes(6).toString('base64url')}-7!aA`;
    await page.getByLabel('New password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Set password and continue', exact: true }).click();
    await expect(page).toHaveURL(/\/start$/, { timeout: 60_000 });
    await forgetSignIn(page);
    const personToken = await signInForToken({ email, password, givenName: 'Zanele' });
    const upload = async (type: string, fileName: string) => {
      const link = await page.request.post(`${documentsApi}/v1/employees/${encodeURIComponent(employeeId)}/documents/upload-url`, {
        headers: { Authorization: `Bearer ${personToken}`, 'Content-Type': 'application/json' },
        data: { documentType: type, fileName, contentType: 'application/pdf' },
      });
      expect(link.status(), `the person gets an upload link for ${type}: ${await link.text()}`).toBe(200);
      const { url } = (await link.json()) as { url: string };
      const put = await page.request.put(url, { headers: { 'Content-Type': 'application/pdf' }, data: PDF });
      expect(put.ok(), `the test PDF uploads (${put.status()})`).toBe(true);
    };
    const asHr = { Authorization: `Bearer ${hrToken}` };
    const asPerson = { Authorization: `Bearer ${personToken}` };
    const verifications = (headers: Record<string, string>) => page.request.get(`${documentsApi}/v1/employees/${encodeURIComponent(employeeId)}/verifications`, { headers });

    await upload('NATIONAL_ID', 'onb11-id.pdf');
    // After the first upload alone, no check has run: HR sees null.
    await expect
      .poll(async () => {
        const r = await verifications(asHr);
        if (r.status() !== 200) return `HTTP ${r.status()}`;
        const docs = ((await r.json()) as { documents?: Array<{ ocr_status: string }> }).documents ?? [];
        return docs.some((d) => d.ocr_status !== 'PENDING') ? 'read' : 'waiting';
      }, { message: 'within 90 seconds the first upload is read', timeout: 90_000, intervals: [3_000] })
      .toBe('read');
    const early = (await (await verifications(asHr)).json()) as { employee: Record<string, unknown> };
    expect(early.employee['risk_assessed_at'], 'after the first upload alone no check has run').toBeNull();

    await upload('BANK_CONFIRMATION', 'onb11-bank.pdf');
    let last: Record<string, unknown> = {};
    await expect
      .poll(async () => {
        const r = await verifications(asHr);
        if (r.status() !== 200) return `HTTP ${r.status()}`;
        last = ((await r.json()) as { employee: Record<string, unknown> }).employee;
        return last['risk_assessed_at'] ? 'assessed' : `step ${String(last['step'])}, no check yet`;
      }, { message: 'within 180 seconds of the second upload the check has run', timeout: 180_000, intervals: [5_000] })
      .toBe('assessed');
    expect(last['step'], 'the person is In review').toBe('IN_REVIEW');
    expect(last['risk_band'], 'a test address gets the stand-in band').toBe('UNKNOWN');
    expect(last['risk_reason'], "and the guard's test-data label").toBe(AI_SKIPPED_LABEL);

    // The person sees none of it.
    const own = await verifications(asPerson);
    expect(own.status(), 'the employee reads their own page\'s answer').toBe(200);
    const text = await own.text();
    expect(Object.keys((JSON.parse(text) as { employee: Record<string, unknown> }).employee).filter((k) => /^risk_/.test(k)), 'the employee has none of the three keys').toEqual([]);
    expect(text, 'and no risk anywhere in the answer').not.toMatch(/risk/i);
    // The person is left in place (HR's own cleanup is not part of this card).
  });
});
