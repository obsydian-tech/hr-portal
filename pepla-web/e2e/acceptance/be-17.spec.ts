import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { APIResponse, Page } from '@playwright/test';
import { ON_DEV, expect, test, type Login, type SignInPage } from './support/fixtures';
import { forgetSignIn } from './support/sign-in-again';
import { blocks, stripComments, tfFiles, type Block } from './support/infra-harness';
import {
  HANDLER, LAMBDA, REPO, awsCalls, dynamoCalls, encrypted, eventFor, modelCalls, openapiRoute, plain, row, runHandler, s3Calls, writes,
  READ_OPS, WRITE_OPS, type Caller, type Failure, type RouteName, type Run, type Tables,
} from './support/be-17/lambda-harness';
import { policyOf, squash, table as tableArn, type TfResource } from './support/onb-15/tf-policy';
import { onlyTenancyAdded, tablesIn, tenancyGrant } from './support/ten-02/relock';
import { decide, statements } from './support/ops-05/iam-eval';

/**
 * BE-17 · Only HR reaches HR routes, now that employees can sign in (Jira NH-190, epic NH-150). Red.
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/BE-17.md (16 Nov 2026, with Iggie's 07:10 UTC change:
 * the file link opens to the document's own person).
 *
 * Nothing here opens the app. The Lambda tests run the real handlers, each call in its own Node process,
 * against a fake AWS (support/be-17/fake-aws): every DynamoDB, S3, KMS, EventBridge, CloudWatch,
 * Bedrock, Secrets Manager, Cognito and outbound HTTP call is recorded, and Bedrock, Secrets Manager,
 * Cognito and HTTP calls fail. The text checks read the handlers, the two OpenAPI files and Terraform.
 * AC-7 runs against pepla-dev only (@pepla-dev); it never calls an AI route, upload-url or external as HR.
 *
 * Nothing calls AWS or any AI service. Locked once accepted: see ./README.md and cards/be-17.md.
 */

const lambdaOnce = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambdas against a fake AWS.');
  test.skip(projectName !== 'desktop-1280', 'Runs the Lambdas once: they have no screen width.');
};

// ---------------------------------------------------------------- the card's words

const WORDS = {
  check: 'Only HR can check documents',
  lookUp: 'Only HR can look up employees',
  chat: 'Only HR can use Batsi chat',
  pending: 'Only HR can see pending actions',
  upload: 'You can only upload documents to your own record',
  ownFile: 'You can only open your own documents',
  open: 'Only HR can open documents', // ONB-15's words, kept
} as const;

// ---------------------------------------------------------------- the stored rows

const A = 'EMP-1701';
const B = 'EMP-1702';
const C = 'EMP-1703'; // a record with an empty email
const R = 'EMP-1709'; // a test record (robot email): the Agent risk check runs on it
const A_EMAIL = 'naledi.dlamini@kestrel-foods.co.za';
const B_EMAIL = 'pieter.vanwyk@kestrel-foods.co.za';
const ROBOT_DOMAIN = '@blackhole.postmarkapp.com';

const DOC_A = 'doc_1763600000001';
const DOC_B = 'doc_1763600000002';
const DOC_C = 'doc_1763600000003';
const DOC_R = 'doc_1763600000009';
const DOC_OTHER = 'doc_1763600000099';
const UNKNOWN_DOC = 'doc_1763699999999';
const UNKNOWN_EMP = 'EMP-1799-NOT-THERE';
const ver = (doc: string) => `ver_${doc}`;

const ID_NUMBER = '9803145082087';
const ACCOUNT_NUMBER = '62845519034';

function emp(id: string, first: string, last: string, email: string | undefined, extra: Record<string, string | undefined> = {}) {
  return row({
    employee_id: id, first_name: first, last_name: last, email, phone: '+27 82 555 0142', department: 'Finance', job_title: 'Bookkeeper',
    stage: 'DOCUMENTS_SUBMITTED', step: 'IN_REVIEW', created_at: '2026-10-20T08:00:00.000Z', created_by: 'E2EHR01', hr_staff_id: 'E2EHR01',
    hr_staff_name: 'Jane Smith', hr_staff_email: 'jane.smith@mokoena-logistics.co.za', id_number_last4: ID_NUMBER.slice(-4),
    id_number_encrypted: encrypted(ID_NUMBER), ...extra,
  });
}

function doc(employeeId: string, documentId: string, type: string, fileName: string) {
  return row({
    employee_id: employeeId, document_id: documentId, document_type: type, file_name: fileName, file_size: 48213, content_type: 'application/pdf',
    s3_key: `uploads/${employeeId}/${type}/${documentId}_${fileName}`, ocr_status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T08:00:00Z',
    verification_id: ver(documentId), ocr_completed_at: '2026-11-04T08:02:00.000Z',
  });
}

function verification(employeeId: string, documentId: string, type: string, extra: Record<string, string | number> = {}) {
  return row({
    verificationId: ver(documentId), employeeId, documentId, documentType: type, decision: 'MANUAL_REVIEW', status: 'MANUAL_REVIEW', confidence: 72,
    check: 'NEEDS_A_LOOK', createdAt: '2026-11-04T08:02:00.000Z', reasoning: 'The holder name is partly covered.', checks: '[]',
    ocrText: 'BANK CONFIRMATION LETTER MS N DLAMINI', ...extra,
  });
}

function world(): Tables {
  return {
    employees: [
      emp('EMP-1790', 'Other', 'Person', 'other.person@kestrel-foods.co.za'),
      emp(A, 'Naledi', 'Dlamini', A_EMAIL),
      emp(B, 'Pieter', 'van Wyk', B_EMAIL),
      emp(C, 'Lerato', 'Mokoena', ''),
      emp(R, 'Robot', 'Record', `be17-record${ROBOT_DOMAIN}`),
    ],
    // An unrelated document first in scan order, so a reader that takes the first row is caught.
    documents: [
      doc('EMP-1790', DOC_OTHER, 'NATIONAL_ID', 'other-person-id.pdf'),
      doc(A, DOC_A, 'BANK_CONFIRMATION', 'naledi-bank-letter.pdf'),
      doc(B, DOC_B, 'NATIONAL_ID', 'pieter-id-book.pdf'),
      doc(C, DOC_C, 'MATRIC_CERTIFICATE', 'lerato-matric.pdf'),
      doc(R, DOC_R, 'NATIONAL_ID', 'robot-id.pdf'),
    ],
    'document-verification': [
      verification(A, DOC_A, 'BANK_CONFIRMATION', { accountHolder: 'MS N DLAMINI', bankName: 'Ubuntu Mutual Bank', accountNumber: ACCOUNT_NUMBER }),
      verification(B, DOC_B, 'NATIONAL_ID', { surname: 'VAN WYK', idNumber_encrypted: encrypted(ID_NUMBER), idNumber_last4: ID_NUMBER.slice(-4) }),
      verification(R, DOC_R, 'NATIONAL_ID'),
    ],
    'external-verification-requests': [],
    'talent-flow-pending-actions': [
      row({ tenant_id: 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa', actionId: 'act-be17-1', status: 'PENDING_APPROVAL', toolName: 'updateCandidate', staffId: 'TF01', createdAt: '2026-11-15T08:00:00Z' }),
      row({ tenant_id: 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa', actionId: 'act-be17-2', status: 'APPROVED', toolName: 'createOffer', staffId: 'TF01', createdAt: '2026-11-14T08:00:00Z' }),
      row({ tenant_id: 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa', actionId: 'act-be17-3', status: 'PENDING_APPROVAL', toolName: 'advanceCandidateStage', staffId: 'TF02', createdAt: '2026-11-15T09:00:00Z' }),
    ],
    NalekoAiRateLimit: [],
    'naleko-agent-audit': [],
    'naleko-prompt-cache': [],
    'naleko-pending-actions': [],
  };
}

/** Everything a refused answer must not carry. */
const LEAKS = [
  'Naledi', 'Dlamini', 'Pieter', 'Wyk', 'Lerato', A_EMAIL, B_EMAIL, ID_NUMBER, ID_NUMBER.slice(-4), ACCOUNT_NUMBER, 'Ubuntu', 'uploads/', 's3_key',
  '.pdf', 'X-Amz', 'https://', 'act-be17', 'updateCandidate', 'EMP-17',
];

// ---------------------------------------------------------------- callers

const HR: Caller = { kind: 'jwt', email: `pepla-e2e-hr${ROBOT_DOMAIN}`, groups: ['hr_staff'], staffId: 'E2EHR01', givenName: 'Thandi', familyName: 'Demo-HR' };
const EMPLOYEE: Caller = { kind: 'jwt', email: A_EMAIL, groups: ['employee'], givenName: 'Naledi', familyName: 'Dlamini' };
const LOOK_ALIKE: Caller = { kind: 'jwt', email: 'temp.worker@kestrel-foods.co.za', groups: ['not_hr_staff', 'employee'] };
const NO_CLAIMS: Caller = { kind: 'none' };
const AGENT: Caller = { kind: 'agent' };
const STRANGERS: Array<[string, Caller]> = [['Employee', EMPLOYEE], ['Look-alike', LOOK_ALIKE], ['No claims', NO_CLAIMS]];

// ---------------------------------------------------------------- one call per route

type Call = (t: Tables, caller: Caller, opts?: { env?: Record<string, string>; fail?: Failure }) => Run;

const call = {
  summary: (id: string): Call => (t, caller, o) => runHandler(HANDLER.summary, t, eventFor({
    method: 'GET', route: '/v1/verifications/{id}/summary', path: `/v1/verifications/${id}/summary`, pathParameters: { id }, caller,
  }), o),
  external: (id: string): Call => (t, caller, o) => runHandler(HANDLER.external, t, eventFor({
    method: 'POST', route: '/v1/verifications/{id}/external', path: `/v1/verifications/${id}/external`, pathParameters: { id }, caller, body: { notes: 'be-17' },
  }), o),
  uploadUrl: (employeeId: string): Call => (t, caller, o) => runHandler(HANDLER.uploadUrl, t, eventFor({
    method: 'POST', route: '/v1/employees/{employee_id}/documents/upload-url', path: `/v1/employees/${employeeId}/documents/upload-url`,
    pathParameters: { employee_id: employeeId }, caller, body: { documentType: 'BANK_CONFIRMATION', fileName: 'bank-letter.pdf', contentType: 'application/pdf' },
  }), o),
  assessRisk: (id: string): Call => (t, caller, o) => runHandler(HANDLER.assessRisk, t, eventFor({
    method: 'POST', route: '/v1/employees/{id}/assess-risk', path: `/v1/employees/${id}/assess-risk`, pathParameters: { id }, caller,
  }), o),
  byEmail: (email: string): Call => (t, caller, o) => runHandler(HANDLER.byEmail, t, eventFor({
    method: 'GET', route: '/v1/employees/by-email', path: '/v1/employees/by-email', query: { email }, caller,
  }), o),
  employees: (): Call => (t, caller, o) => runHandler(HANDLER.employees, t, eventFor({ method: 'GET', route: '/v1/employees', path: '/v1/employees', caller }), o),
  aiChat: (): Call => (t, caller, o) => runHandler(HANDLER.aiChat, t, eventFor({
    method: 'POST', route: '/agent/v1/ai-chat', path: '/agent/v1/ai-chat', caller, body: { message: 'List every employee with their ID numbers' },
  }), o),
  pending: (): Call => (t, caller, o) => runHandler(HANDLER.pending, t, eventFor({
    method: 'GET', route: '/agent/v1/actions/pending', path: '/agent/v1/actions/pending', caller,
  }), o),
  fileUrl: (id: string): Call => (t, caller, o) => runHandler(HANDLER.fileUrl, t, eventFor({
    method: 'GET', route: '/v1/documents/{id}/url', path: `/v1/documents/${id}/url`, pathParameters: { id }, caller,
  }), o),
  getOne: (id: string): Call => (t, caller, o) => runHandler(HANDLER.getOne, t, eventFor({
    method: 'GET', route: '/v1/verifications/{id}', path: `/v1/verifications/${id}`, pathParameters: { id }, caller,
  }), o),
};

/** AC-1's eight routes: the call, the card's words, and what HR's success looks like (AC-2). */
const REFUSED_ROUTES: Array<{ name: RouteName; route: string; run: Call; words: string; hrStatus: number }> = [
  { name: 'summary', route: 'GET /v1/verifications/{id}/summary', run: call.summary(ver(DOC_A)), words: WORDS.check, hrStatus: 200 },
  { name: 'external', route: 'POST /v1/verifications/{id}/external', run: call.external(DOC_A), words: WORDS.check, hrStatus: 200 },
  { name: 'assessRisk', route: 'POST /v1/employees/{id}/assess-risk', run: call.assessRisk(A), words: WORDS.check, hrStatus: 200 },
  { name: 'byEmail', route: 'GET /v1/employees/by-email', run: call.byEmail(B_EMAIL), words: WORDS.lookUp, hrStatus: 200 },
  { name: 'employees', route: 'GET /v1/employees', run: call.employees(), words: WORDS.lookUp, hrStatus: 200 },
  { name: 'aiChat', route: 'POST /agent/v1/ai-chat', run: call.aiChat(), words: WORDS.chat, hrStatus: 200 },
  { name: 'pending', route: 'GET /agent/v1/actions/pending', run: call.pending(), words: WORDS.pending, hrStatus: 200 },
  { name: 'getOne', route: 'GET /v1/verifications/{id}', run: call.getOne(DOC_A), words: WORDS.open, hrStatus: 200 },
];

function noThrow(r: Run, how: string) {
  expect(r.error, `${how}: the handler does not throw\n${r.error?.stack ?? ''}`).toBeUndefined();
}

function refused(r: Run, how: string, words: string) {
  noThrow(r, how);
  expect(r.status, `${how}: 403\n${r.raw.slice(0, 400)}`).toBe(403);
  expect(r.body, `${how}: the body is { "error": "${words}" } and nothing else`).toEqual({ error: words });
  expect(r.headers['content-type'] ?? '', `${how}: the 403 is JSON`).toContain('application/json');
  for (const leak of LEAKS) expect(r.raw, `${how}: the 403 carries no "${leak}"`).not.toContain(leak);
}

const ok = (r: Run, how: string, status = 200) => {
  noThrow(r, how);
  expect(r.status, `${how}: ${status}\n${r.raw.slice(0, 500)}`).toBe(status);
  return r.body;
};

const AI_SKIPPED = /AI skipped/;
const AI_OFF = /AI is switched off/;

// ---------------------------------------------------------------- handler source, for AC-5

function handlerSource(file: string): { all: string; body: string } {
  const all = stripComments(readFileSync(file, 'utf8'));
  const fn = /\b(?:const|let|function)\s+handlerFn\b/.exec(all);
  const exported = /\bexport\s+(?:const|let|async\s+function|function)\s+handler\b/.exec(all);
  const at = fn ?? exported;
  expect(at, `${file}: a handler is defined`).toBeTruthy();
  return { all, body: all.slice(at!.index) };
}

const GUARD = /\b(hrOnly|hrOrAgent|requireHr)\s*\(/;
const FIRST_SENSITIVE = ['.send(', 'markRobot(', 'isRobotCaller(', 'aiSwitchedOff(', 'guardAi(', 'withIdempotency(', 'checkRateLimit(', 'getSignedUrl(', 'resolveDocument(', 'checkEmployeeExists('];

/** `x.includes('hr_staff')` where x is not a list made by groupsOf (a raw claim string, a substring match). */
function substringGroupMatches(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/([\w$.\]\)]+)\s*\.\s*includes\(\s*(['"`])hr_staff\2\s*\)/g)) {
    const receiver = m[1]!;
    if (/groupsOf\s*\(.*\)$/.test(receiver) || receiver.endsWith(')')) {
      // e.g. groupsOf(claims).includes('hr_staff'): the regex stops at ")", so look back for groupsOf(
      const before = src.slice(Math.max(0, m.index! - 80), m.index! + receiver.length);
      if (/groupsOf\s*\([^()]*\)\s*$/.test(before)) continue;
    }
    const name = receiver.split('.').pop()!;
    if (new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\s*=\\s*groupsOf\\s*\\(`).test(src)) continue;
    out.push(m[0]);
  }
  return out;
}

// ---------------------------------------------------------------- Terraform, for AC-6

const BASELINE = join(__dirname, 'support', 'be-17', 'infra.629ae93.tf.txt');
const TF_FILES = () => [...tfFiles(), ...tfFiles(join(REPO, 'talent-flow-infra'))];

function found(kind: string, labels: string[], files: string[]): Block[] {
  return blocks(files, kind).filter((b) => labels.every((l, i) => b.labels[i] === l));
}
const asResource = (b: Block): TfResource => ({ type: b.labels[0]!, name: b.labels[1]!, raw: b.raw, body: b.body, attrs: new Map() });

/** The role ARNs listed in one list attribute of a block, and the block's text without that list. */
function listAttr(body: string, name: string): { items: string[]; rest: string } {
  const m = new RegExp(`\\b${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(body);
  if (!m) return { items: [], rest: body };
  const items = m[1]!.split(/[\s,]+/).filter(Boolean);
  return { items, rest: body.slice(0, m.index) + body.slice(m.index + m[0].length) };
}

// ---------------------------------------------------------------- pepla-dev helpers

/** Naledi Dlamini's bank letter in scripts/ci/seed-dev.py (ONB-13 and ONB-15 read it; never changed here). */
const SEEDED_BANK_LETTER = 'doc_1762243200000';

function devApi(file: string, key: string, generatedOnly: boolean): string {
  const path = join(REPO, file);
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  if (generatedOnly) {
    // The committed hr-portal file holds a prod address; only the CI-written pepla-dev file is used.
    expect(text, `${file} was written for pepla-dev by scripts/ci/dev-frontend-env.sh`).toContain('Generated in CI by scripts/ci/dev-frontend-env.sh');
  }
  const m = new RegExp(`${key}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`).exec(text);
  expect(m, `${file} has ${key}`).toBeTruthy();
  expect(m![1], `${key} points at pepla-dev, not a placeholder`).not.toMatch(/\.invalid\b/);
  return m![1]!.replace(/\/+$/, '');
}

async function signInForToken(page: Page, signIn: SignInPage, login: Login): Promise<string> {
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
}

// ---------------------------------------------------------------- tests

test.describe('BE-17 Only HR reaches HR routes, now that employees can sign in', () => {
  test('AC-1 An employee, a look-alike group and a call with no claims are refused on eight routes, with the card\'s words and no AWS call of any kind', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const t = world();
    for (const r of REFUSED_ROUTES) {
      // The usual CORS headers: a 403 carries the same Access-Control-Allow-Origin as HR's answer.
      const hr = r.run(t, HR);
      const origin = hr.headers['access-control-allow-origin'];
      for (const [who, caller] of STRANGERS) {
        const how = `${r.route}, ${who}`;
        const run = r.run(t, caller);
        refused(run, how, r.words);
        expect(awsCalls(run), `${how}: no DynamoDB, S3, KMS, EventBridge, CloudWatch, Cognito, Secrets Manager, Bedrock or HTTP call`).toEqual([]);
        if (origin !== undefined) expect(run.headers['access-control-allow-origin'], `${how}: the 403 carries the usual CORS header`).toBe(origin);
      }
    }
    // Only the Agent API's own actor passes hrOrAgent: any other Lambda authorizer actor is refused before any call.
    for (const actor of ['HR', 'EMPLOYEE']) {
      for (const r of REFUSED_ROUTES.filter((x) => ['summary', 'assessRisk', 'employees'].includes(x.name))) {
        const run = r.run(t, { kind: 'actor', actor });
        refused(run, `${r.route}, Lambda actor ${actor}`, r.words);
        expect(awsCalls(run), `${r.route}, Lambda actor ${actor}: no call`).toEqual([]);
      }
    }
    // The pending list's second HR group is matched by name too: a look-alike of it is refused.
    const tfLookAlike: Caller = { kind: 'jwt', email: 'temp.worker@kestrel-foods.co.za', groups: ['not_naleko-talentflow-hr', 'employee'] };
    const pending = call.pending()(t, tfLookAlike);
    refused(pending, 'GET /agent/v1/actions/pending, not_naleko-talentflow-hr', WORDS.pending);
    expect(awsCalls(pending)).toEqual([]);
  });

  test('AC-2 HR still gets its answer on each route; the AI routes give the AI-skipped answer to a robot and never call a model', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const t = world();
    for (const r of REFUSED_ROUTES) {
      const run = r.run(t, HR);
      const body = ok(run, `${r.route}, HR`, r.hrStatus);
      expect(modelCalls(run), `${r.route}, HR: no Bedrock, Secrets Manager or HTTP call`).toEqual([]);
      if (r.name === 'summary') {
        expect(body.aiDisabled, 'summary, HR robot: the AI-skipped answer').toBe(true);
        expect(String(body.summary)).toMatch(AI_SKIPPED);
      }
      if (r.name === 'assessRisk') {
        expect(String(body.reason), 'assess-risk, HR robot: the AI-skipped reason').toMatch(AI_SKIPPED);
        expect(writes(run), 'assess-risk, HR: the risk is stored on the record').toEqual(['UpdateItem employees']);
      }
      if (r.name === 'aiChat') {
        expect(String(body.message), 'ai-chat, HR robot: the AI-skipped answer').toMatch(AI_SKIPPED);
        expect(awsCalls(run), 'ai-chat, HR robot: nothing is read or written').toEqual([]);
      }
      if (r.name === 'external') {
        expect(body.success, 'external, HR: the request is stored').toBe(true);
        expect(writes(run)).toEqual(['PutItem external-verification-requests']);
      }
      if (r.name === 'byEmail') expect(body, 'by-email, HR: B is found').toEqual({ exists: true, employee_id: B });
      if (r.name === 'employees') expect((body.items ?? []).length, 'employees, HR: the list has people').toBeGreaterThan(0);
      if (r.name === 'pending') {
        expect(body.count, 'pending, HR: the two pending actions').toBe(2);
        expect((body.actions ?? []).map((a: { actionId: string }) => a.actionId).sort()).toEqual(['act-be17-1', 'act-be17-3']);
      }
      if (r.name === 'getOne') expect(body.document?.document_id ?? body.document_id ?? JSON.stringify(body)).toContain(DOC_A);
    }

    // hr_staff alongside other groups is still HR.
    const both: Caller = { ...HR, groups: ['naleko-onboarding-hr', 'hr_staff', 'e2e-robots'] } as Caller;
    for (const r of REFUSED_ROUTES) ok(r.run(t, both), `${r.route}, HR in three groups`, r.hrStatus);

    // The pending list also answers a Talent Flow HR person who is not in hr_staff.
    const tfHr: Caller = { kind: 'jwt', email: `pepla-e2e-tf-hr${ROBOT_DOMAIN}`, groups: ['naleko-talentflow-hr'], staffId: 'TF09' };
    const tf = ok(call.pending()(t, tfHr), 'pending, naleko-talentflow-hr only');
    expect(tf.count).toBe(2);
  });

  test('AC-3 The Agent API is unchanged: summary, risk check and the employee list answer an Agent caller as before, with no model call', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const t = world();
    // The Agent API has no person behind it, so its AI routes run with the AI off switch here: the test never reaches a model.
    const aiOff = { env: { AI_CALLS_ENABLED: 'false' } };

    const summary = call.summary(ver(DOC_A))(t, AGENT, aiOff);
    const s = ok(summary, 'summary, Agent');
    expect(s.aiDisabled, 'summary, Agent: the AI-off answer').toBe(true);
    expect(String(s.summary)).toMatch(AI_OFF);
    expect(modelCalls(summary)).toEqual([]);

    // The risk check on a test record is the robot path, whoever asks.
    const risk = call.assessRisk(R)(t, AGENT);
    const k = ok(risk, 'assess-risk on a test record, Agent');
    expect(String(k.reason)).toMatch(AI_SKIPPED);
    expect(modelCalls(risk)).toEqual([]);
    const riskOff = call.assessRisk(A)(t, AGENT, aiOff);
    expect(String(ok(riskOff, 'assess-risk with AI off, Agent').reason)).toMatch(AI_OFF);
    expect(modelCalls(riskOff)).toEqual([]);

    const list = call.employees()(t, AGENT);
    const l = ok(list, 'employees, Agent');
    expect((l.items ?? []).length, 'employees, Agent: the whole first page, as a manager').toBeGreaterThan(1);
    expect(dynamoCalls(list).map((c) => c.op), 'employees, Agent: a Scan, as before').toContain('Scan');
  });

  test('AC-4 Uploads go only into your own record, and a file link opens only your own document', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const t = world();
    const sameish: Caller = { kind: 'jwt', email: '  NALEDI.Dlamini@Kestrel-Foods.co.za ', groups: ['employee'] };
    const lookAlikeA: Caller = { kind: 'jwt', email: A_EMAIL, groups: ['not_hr_staff', 'employee'] };
    const emptyEmail: Caller = { kind: 'jwt', email: '', groups: ['employee'] };
    // Only the tail of A's email: an owner rule that matches part of an address lets this through.
    const tailOfA: Caller = { kind: 'jwt', email: 'dlamini@kestrel-foods.co.za', groups: ['employee'] };
    const presigns = (r: Run) => s3Calls(r).filter((c) => /presign/.test(c));

    // ---- upload-url
    const granted = (r: Run, how: string) => {
      const body = ok(r, how);
      expect(String(body.url), `${how}: a signed upload link`).toMatch(/^https:\/\//);
      expect(writes(r), `${how}: one document row`).toEqual(['PutItem documents']);
      expect(presigns(r), `${how}: one signed PUT`).toEqual(['s3 presign:PutObject']);
    };
    const upRefused = (r: Run, how: string) => {
      refused(r, how, WORDS.upload);
      expect(writes(r), `${how}: no document row`).toEqual([]);
      expect(s3Calls(r), `${how}: no S3 presign`).toEqual([]);
      expect(dynamoCalls(r).filter((c) => !READ_OPS.includes(c.op)), `${how}: reads only`).toEqual([]);
    };
    granted(call.uploadUrl(A)(t, HR), 'upload-url, HR, record A');
    granted(call.uploadUrl(B)(t, HR), 'upload-url, HR, record B');
    granted(call.uploadUrl(A)(t, EMPLOYEE), 'upload-url, employee A, record A');
    granted(call.uploadUrl(A)(t, sameish), 'upload-url, employee A (other case, spaces), record A');
    upRefused(call.uploadUrl(B)(t, EMPLOYEE), 'upload-url, employee A, record B');
    upRefused(call.uploadUrl(UNKNOWN_EMP)(t, EMPLOYEE), 'upload-url, employee A, an id that does not exist');
    granted(call.uploadUrl(A)(t, lookAlikeA), 'upload-url, look-alike with A\'s email, record A (owner rule)');
    upRefused(call.uploadUrl(B)(t, lookAlikeA), 'upload-url, look-alike with A\'s email, record B');
    upRefused(call.uploadUrl(A)(t, tailOfA), 'upload-url, an email that is only the tail of A\'s, record A');
    upRefused(call.uploadUrl(C)(t, emptyEmail), 'upload-url, an empty email claim, a record with an empty email');
    const upNone = call.uploadUrl(A)(t, NO_CLAIMS);
    refused(upNone, 'upload-url, no claims', WORDS.upload);
    expect(awsCalls(upNone), 'upload-url, no claims: no AWS call').toEqual([]);
    const upUnknown = call.uploadUrl(UNKNOWN_EMP)(t, HR);
    noThrow(upUnknown, 'upload-url, HR, unknown id');
    expect(upUnknown.status, 'upload-url, HR, unknown id: 404').toBe(404);
    expect(writes(upUnknown)).toEqual([]);
    expect(s3Calls(upUnknown)).toEqual([]);

    // ---- the file link
    const link = (r: Run, how: string, fileName: string) => {
      const body = ok(r, how);
      expect(String(body.url), `${how}: a signed link`).toMatch(/^https:\/\//);
      expect(body.file_name, `${how}: that document's file`).toBe(fileName);
      expect(presigns(r), `${how}: one signed GET`).toEqual(['s3 presign:GetObject']);
      expect(writes(r), `${how}: nothing written`).toEqual([]);
    };
    const notYours = (r: Run, how: string) => {
      refused(r, how, WORDS.ownFile);
      expect(s3Calls(r), `${how}: no S3 presign`).toEqual([]);
      const other = r.calls.filter((c) => c.service !== 'log' && !(c.service === 'dynamodb' && READ_OPS.includes(c.op) && ['documents', 'employees'].includes(c.table ?? '')));
      expect(other.map((c) => `${c.service} ${c.op} ${'table' in c ? c.table ?? '' : ''}`), `${how}: only reads of documents and employees`).toEqual([]);
      for (const c of dynamoCalls(r).filter((x) => x.table === 'employees')) {
        expect(c.op, `${how}: the employees row is read by its key`).toBe('GetItem');
      }
    };
    link(call.fileUrl(DOC_A)(t, EMPLOYEE), 'file link, employee A, A\'s document', 'naledi-bank-letter.pdf');
    link(call.fileUrl(DOC_A)(t, sameish), 'file link, employee A (other case, spaces), A\'s document', 'naledi-bank-letter.pdf');
    notYours(call.fileUrl(DOC_B)(t, EMPLOYEE), 'file link, employee A, B\'s document');
    notYours(call.fileUrl(UNKNOWN_DOC)(t, EMPLOYEE), 'file link, employee A, an unknown document id');
    notYours(call.fileUrl(DOC_B)(t, lookAlikeA), 'file link, look-alike with A\'s email, B\'s document');
    notYours(call.fileUrl(DOC_A)(t, tailOfA), 'file link, an email that is only the tail of A\'s, A\'s document');
    notYours(call.fileUrl(DOC_C)(t, emptyEmail), 'file link, an empty email claim, a document whose record has an empty email');
    const fileNone = call.fileUrl(DOC_A)(t, NO_CLAIMS);
    refused(fileNone, 'file link, no claims', WORDS.open);
    expect(awsCalls(fileNone), 'file link, no claims: no AWS call').toEqual([]);
    link(call.fileUrl(DOC_A)(t, HR), 'file link, HR, A\'s document', 'naledi-bank-letter.pdf');
    link(call.fileUrl(DOC_B)(t, HR), 'file link, HR, B\'s document', 'pieter-id-book.pdf');
    const fileUnknown = call.fileUrl(UNKNOWN_DOC)(t, HR);
    noThrow(fileUnknown, 'file link, HR, unknown id');
    expect(fileUnknown.status, 'file link, HR, unknown id: 404').toBe(404);
    expect(s3Calls(fileUnknown)).toEqual([]);
  });

  test('AC-5 The check comes first in each handler, groups are matched by name, and a 500 never carries the exception', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    // ---- text: the group check before any AWS call, AI guard or idempotency step
    const first: RouteName[] = ['summary', 'external', 'assessRisk', 'byEmail', 'employees', 'aiChat'];
    for (const name of first) {
      const file = HANDLER[name];
      const { body } = handlerSource(file);
      const guard = GUARD.exec(body);
      expect(guard, `${name}: the handler calls hrOnly, hrOrAgent or requireHr`).toBeTruthy();
      for (const token of FIRST_SENSITIVE) {
        const at = body.indexOf(token);
        if (at >= 0) expect(guard!.index, `${name}: the group check comes before the handler's first "${token}"`).toBeLessThan(at);
      }
    }
    // The two owner routes read one row first, so the owner check comes before any write or signed link.
    for (const name of ['uploadUrl', 'fileUrl'] as const) {
      const { body } = handlerSource(HANDLER[name]);
      const owner = /\bisHrOrOwner\s*\(/.exec(body);
      expect(owner, `${name}: the handler uses isHrOrOwner`).toBeTruthy();
      for (const token of ['getSignedUrl(', 'PutItemCommand(']) {
        const at = body.indexOf(token);
        if (at >= 0) expect(owner!.index, `${name}: isHrOrOwner comes before "${token}"`).toBeLessThan(at);
      }
    }
    // The pending list and getEmployeeDocumentVerifications use the shared helpers.
    expect(readFileSync(HANDLER.pending, 'utf8'), 'talentFlowApproveAction reads groups through groupsOf or hrOnly').toMatch(/\b(groupsOf|hrOnly)\s*\(/);
    const shared = stripComments(readFileSync(join(LAMBDA, 'shared', 'hr-group.mjs'), 'utf8'));
    expect(shared, 'lambda/shared/hr-group.mjs exports hrOrAgent').toMatch(/export\s+(async\s+)?function\s+hrOrAgent\b|export\s+const\s+hrOrAgent\b/);
    expect(shared, 'lambda/shared/hr-group.mjs exports isHrOrOwner').toMatch(/export\s+(async\s+)?function\s+isHrOrOwner\b|export\s+const\s+isHrOrOwner\b/);
    const verifications = stripComments(readFileSync(join(LAMBDA, 'getEmployeeDocumentVerifications', 'index.mjs'), 'utf8'));
    expect(verifications, 'getEmployeeDocumentVerifications uses the shared isHrOrOwner').toMatch(/\bisHrOrOwner\s*\(/);

    // ---- no substring group match in any changed handler
    for (const name of [...first, 'uploadUrl', 'fileUrl', 'pending'] as RouteName[]) {
      const src = stripComments(readFileSync(HANDLER[name], 'utf8'));
      expect(substringGroupMatches(src), `${name}: no includes('hr_staff') on a claim string; groups go through groupsOf`).toEqual([]);
    }

    // ---- behaviour: a failing table never puts the exception's words in the answer
    const t = world();
    const SECRET = 'BE17-SECRET arn:aws:dynamodb:af-south-1:000000000000:table/employees is throttled (RequestId 7f3a)';
    const failures: Failure[] = [
      { service: 'dynamodb', message: SECRET, name: 'ProvisionedThroughputExceededException' },
      { service: 'dynamodb', ops: WRITE_OPS, message: SECRET, name: 'ProvisionedThroughputExceededException' },
    ];
    const runs: Array<[string, Call]> = [
      ['summary', call.summary(ver(DOC_A))], ['external', call.external(DOC_A)], ['upload-url', call.uploadUrl(A)], ['assess-risk', call.assessRisk(A)],
      ['by-email', call.byEmail(B_EMAIL)], ['employees', call.employees()], ['pending', call.pending()], ['file link', call.fileUrl(DOC_A)],
    ];
    for (const [route, run] of runs) {
      for (const fail of failures) {
        const how = `${route}, HR, ${fail.ops ? 'writes fail' : 'every table call fails'}`;
        const r = run(t, HR, { fail });
        // A thrown error reaches nobody but API Gateway, which answers its own plain 500.
        if (r.error) continue;
        for (const leak of ['BE17-SECRET', 'throttled', 'RequestId', 'arn:aws', 'ProvisionedThroughputExceededException']) {
          expect(r.raw, `${how}: the answer (${r.status}) carries no "${leak}"`).not.toContain(leak);
        }
        if (r.status >= 500) expect(r.status, `${how}: a 5xx`).toBeLessThan(600);
      }
    }
    const byEmail500 = call.byEmail(B_EMAIL)(t, HR, { fail: failures[0] });
    noThrow(byEmail500, 'by-email, HR, the table fails');
    expect(byEmail500.status, 'by-email, HR, the table fails: 500').toBe(500);
    expect(byEmail500.body, 'by-email: the plain 500 answer').toEqual({ error: 'Internal server error' });
  });

  test('AC-6 The API descriptions list the 403, and Terraform keeps every route, authorizer and IAM action', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    // ---- OpenAPI: both files
    const routes: Array<[string, string]> = [
      ['/v1/verifications/{id}/summary', 'get'], ['/v1/verifications/{id}/external', 'post'], ['/v1/employees/{id}/assess-risk', 'post'],
      ['/v1/employees/by-email', 'get'], ['/v1/employees', 'get'], ['/v1/verifications/{id}', 'get'],
      ['/v1/employees/{employee_id}/documents/upload-url', 'post'], ['/v1/documents/{id}/url', 'get'],
    ];
    for (const file of [join(REPO, 'api', 'openapi.yaml'), join(LAMBDA, 'serveDocs', 'spec.yaml')]) {
      for (const [path, method] of routes) {
        const r = openapiRoute(file, path, method);
        const short = file.replace(REPO + '/', '');
        expect(r.found, `${short}: ${method.toUpperCase()} ${path} is described`).toBe(true);
        expect(r.responses, `${short}: ${method.toUpperCase()} ${path} lists a 403`).toContain('403');
      }
    }

    // ---- Terraform: every resource in the baseline is still there, unchanged
    const base = [BASELINE];
    const now = TF_FILES();
    const FILE_LINK_POLICY = 'get_document_presigned_url';
    for (const kind of ['resource', 'module']) {
      for (const b of blocks(base, kind)) {
        const what = `${kind} ${b.labels.join('.')}`;
        const current = found(kind, b.labels, now);
        expect(current.length, `${what} is still defined once`).toBe(1);
        if (kind === 'module') continue; // kms_pii: below
        if (b.labels[0] === 'aws_iam_role_policy' && b.labels[1] === FILE_LINK_POLICY) continue; // below
        // TEN-02 (re-lock): a role policy may also hold TEN-02's company grants (support/ten-02/relock.ts).
        if (b.labels[0] === 'aws_iam_role_policy') expect(onlyTenancyAdded(asResource(b), asResource(current[0]!)), `${what} is unchanged since 629ae93 but for TEN-02's grants`).toEqual([]);
        else expect(squash(current[0]!.raw), `${what} is unchanged since 629ae93`).toBe(squash(b.raw));
      }
    }

    // ---- the routes of this card: none added or removed
    const ROUTE_KEYS = new Set(blocks(base, 'resource').filter((b) => b.labels[0] === 'aws_apigatewayv2_route').map((b) => /route_key\s*=\s*"([^"]*)"/.exec(b.body)![1]!));
    const nowKeys = blocks(now, 'resource').filter((b) => b.labels[0] === 'aws_apigatewayv2_route').map((b) => /route_key\s*=\s*"([^"]*)"/.exec(b.body)?.[1] ?? '').filter((k) => ROUTE_KEYS.has(k));
    expect(nowKeys.sort(), 'each of this card\'s routes is defined exactly once').toEqual([...ROUTE_KEYS].sort());

    // ---- the file link's policy: every old Allow kept; GetItem on employees added, nothing else on employees, no new action
    const oldPolicy = policyOf(asResource(found('resource', ['aws_iam_role_policy', FILE_LINK_POLICY], base)[0]!));
    const newPolicy = policyOf(asResource(found('resource', ['aws_iam_role_policy', FILE_LINK_POLICY], now)[0]!));
    const actionsOf = (p: typeof oldPolicy) => new Set(statements(p).flatMap((s) => [s.Action ?? []].flat() as string[]));
    for (const s of statements(oldPolicy)) {
      for (const action of [s.Action ?? []].flat() as string[]) {
        for (const resource of [s.Resource ?? []].flat() as string[]) {
          expect(decide(newPolicy, { action, resource }), `file link policy still allows ${action} on ${resource}`).toBe('allowed');
        }
      }
    }
    // TEN-02 (re-lock): the company's documents list (Query on documents' tenant-index) does not count.
    const tenancyOnly = (a: string) => statements(newPolicy).filter((s) => ([s.Action ?? []].flat() as string[]).includes(a)).every((s) => ([s.Resource ?? []].flat() as string[]).every((r) => tenancyGrant(a, r, tablesIn(statements(oldPolicy).flatMap((o) => [o.Resource ?? []].flat() as string[])))));
    const added = [...actionsOf(newPolicy)].filter((a) => !actionsOf(oldPolicy).has(a) && !tenancyOnly(a));
    expect(added, 'file link policy: the only new action is dynamodb:GetItem').toEqual(added.length ? ['dynamodb:GetItem'] : []);
    expect(decide(newPolicy, { action: 'dynamodb:GetItem', resource: tableArn('employees') }), 'file link policy: GetItem on employees').toBe('allowed');
    for (const action of ['dynamodb:Scan', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:BatchGetItem']) {
      expect(decide(newPolicy, { action, resource: tableArn('employees') }), `file link policy: no ${action} on employees`).not.toBe('allowed');
    }
    for (const s of statements(newPolicy)) {
      const res = [s.Resource ?? []].flat() as string[];
      if (([s.Action ?? []].flat() as string[]).some((a) => a.startsWith('dynamodb:'))) {
        expect(res.filter((x) => x.includes('*')), 'file link policy: no DynamoDB wildcard').toEqual([]);
      }
    }

    // ---- kms_pii, judged only for this card's roles (other cards may add their own readers):
    // of the BE-17 Lambdas' roles, only the upload and file-link roles may join dynamodb_read_role_arns,
    // none may join allowed_role_arns, and none already listed leaves either list.
    const OWN_ROLES = ['summarise_verification', 'trigger_external_verification', 'generate_document_upload_url', 'classify_onboarding_risk',
      'get_employee_by_email', 'get_employees', 'naleko_ai_chat', 'get_document_presigned_url', 'get_single_document_verification']
      .map((r) => `aws_iam_role.${r}.arn`);
    // ONB-22.1 (re-lock be-17.4): summariseVerification reads the employee (to treat a test person as a robot), so its role reads the key through DynamoDB.
    const MAY_READ = ['aws_iam_role.generate_document_upload_url.arn', 'aws_iam_role.get_document_presigned_url.arn', 'aws_iam_role.summarise_verification.arn'];
    const kmsBase = found('module', ['kms_pii'], base)[0]!;
    const kmsNow = found('module', ['kms_pii'], now)[0]!;
    for (const list of ['dynamodb_read_role_arns', 'allowed_role_arns']) {
      const b = listAttr(kmsBase.body, list).items;
      const n = listAttr(kmsNow.body, list).items;
      for (const arn of b.filter((x) => OWN_ROLES.includes(x))) expect(n, `kms_pii keeps ${arn} in ${list}`).toContain(arn);
      for (const arn of n.filter((x) => OWN_ROLES.includes(x) && !b.includes(x))) {
        expect(list === 'dynamodb_read_role_arns' && MAY_READ.includes(arn), `kms_pii: ${arn} may not join ${list}`).toBe(true);
      }
    }
  });

  test('AC-7 An employee token is refused on the real API; HR still looks up employees @pepla-dev', async ({ page, signIn, hr, employee }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers these routes in AC-1 to AC-5.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    const docApi = devApi('pepla-web/src/environments/environment.ts', 'documentUploadApiUrl', false);
    const empApi = devApi('pepla-web/src/environments/environment.ts', 'employeesApiUrl', false);
    const agentApi = devApi('hr-portal/src/environments/environment.ts', 'agentApiUrl', true);

    // HR: find Naledi (seeded) through the list, then look her up by email. Read-only calls only.
    const hrToken = await signInForToken(page, signIn, hr);
    const asHr = { Authorization: `Bearer ${hrToken}` };
    let naledi: { employee_id: string; email: string } | undefined;
    let lastKey: string | undefined;
    for (let pageNo = 0; pageNo < 20 && !naledi; pageNo++) {
      const list = await page.request.get(`${empApi}/v1/employees?limit=200${lastKey ? `&lastKey=${encodeURIComponent(lastKey)}` : ''}`, { headers: asHr });
      expect(list.status(), 'HR gets 200 from GET /v1/employees').toBe(200);
      const body = (await list.json()) as { items: Array<{ employee_id: string; email: string; first_name: string; last_name: string }>; lastKey?: string };
      naledi = body.items.find((p) => p.first_name === 'Naledi' && p.last_name === 'Dlamini');
      lastKey = body.lastKey;
      if (!lastKey) break;
    }
    expect(naledi, 'the seeded Naledi Dlamini is on pepla-dev').toBeTruthy();
    const byEmailHr = await page.request.get(`${empApi}/v1/employees/by-email?email=${encodeURIComponent(naledi!.email)}`, { headers: asHr });
    expect(byEmailHr.status(), 'HR gets 200 from GET /v1/employees/by-email').toBe(200);

    await forgetSignIn(page); // ONB-23.1: HR's session is kept, so it is forgotten before the employee signs in
    const empToken = await signInForToken(page, signIn, employee);
    const asEmp = { Authorization: `Bearer ${empToken}` };
    const json = { ...asEmp, 'content-type': 'application/json' };
    const check = async (route: string, r: APIResponse) => {
      expect(r.status(), `the employee login gets 403 from ${route}`).toBe(403);
      const text = await r.text();
      for (const leak of ['Dlamini', 'Naledi', naledi!.email, naledi!.employee_id, 's3_key', 'X-Amz', 'https://', 'AI skipped']) {
        expect(text, `${route}: the 403 carries no "${leak}"`).not.toContain(leak);
      }
    };

    // First the routes that read only. If pepla-dev still runs the old Lambdas these fail here, before any call that could write.
    await check('GET /v1/employees/by-email', await page.request.get(`${empApi}/v1/employees/by-email?email=${encodeURIComponent(naledi!.email)}`, { headers: asEmp }));
    await check('GET /v1/employees', await page.request.get(`${empApi}/v1/employees`, { headers: asEmp }));
    await check('GET /agent/v1/actions/pending', await page.request.get(`${agentApi}/agent/v1/actions/pending`, { headers: asEmp }));
    await check('GET /v1/documents/<id>/url', await page.request.get(`${docApi}/v1/documents/${SEEDED_BANK_LETTER}/url`, { headers: asEmp }));
    await check('POST /agent/v1/ai-chat', await page.request.post(`${agentApi}/agent/v1/ai-chat`, { headers: json, data: { message: 'hello' } }));
    await check('GET /v1/verifications/<id>/summary', await page.request.get(`${docApi}/v1/verifications/${SEEDED_BANK_LETTER}/summary`, { headers: asEmp }));
    // Then the routes that would write if they let the employee through: refused before anything is read or written.
    await check('POST /v1/verifications/<id>/external', await page.request.post(`${docApi}/v1/verifications/${SEEDED_BANK_LETTER}/external`, { headers: json, data: { notes: 'be-17' } }));
    await check('POST /v1/employees/<id>/assess-risk', await page.request.post(`${docApi}/v1/employees/${naledi!.employee_id}/assess-risk`, { headers: json, data: {} }));
    await check('POST /v1/employees/<id>/documents/upload-url', await page.request.post(`${docApi}/v1/employees/${naledi!.employee_id}/documents/upload-url`, {
      headers: json, data: { documentType: 'BANK_CONFIRMATION', fileName: 'be-17-check.pdf', contentType: 'application/pdf' },
    }));
  });
});
