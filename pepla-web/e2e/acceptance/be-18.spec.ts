import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { blocks, stripComments, tfFiles, type Block } from './support/infra-harness';
import {
  HANDLER, HR_GROUP_FILE, REPO, cognitoEvent, dynamoCalls, encrypted, eventFor, fnRule, logText, plain, row, runHandler, runScript, s3Calls, writes,
  type Caller, type Failure, type Run, type Tables,
} from './support/be-18/lambda-harness';

/**
 * BE-18 · Sign-in identity hardening, Part A (Jira NH-210, epic NH-150). Red. One test per acceptance
 * criterion of Part A, written from the card before any code. Spec: onboarding-cards/specs/BE-18.md.
 *
 * Nothing here opens the app. AC-2 to AC-5 run the real handlers, each call in its own Node process,
 * against a fake AWS (support/be-18/fake-aws, copied from BE-17.1's with code added only): every
 * DynamoDB, S3, KMS, EventBridge, CloudWatch, Bedrock, Secrets Manager, Cognito and outbound HTTP call is
 * recorded, and Bedrock, Secrets Manager, Cognito and HTTP calls fail. AC-1 reads infra/*.tf as text
 * against the snapshots in support/be-18. AC-6 is ONB-05's existing AC-11 on pepla-dev: no new test.
 *
 * Nothing calls AWS or any AI service. Locked once accepted: see ./README.md.
 */

const lambdaOnce = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambdas against a fake AWS.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: no screen width.');
};

// ---------------------------------------------------------------- the words each route already answers (unchanged here)

const WORDS = {
  newEmployeesOnly: 'This page is for new employees', // ONB-05
  notFound: "We can't find your record. Ask your HR team.", // ONB-05
  somethingWrong: 'Something went wrong',
  upload: 'You can only upload documents to your own record', // BE-17
  ownFile: 'You can only open your own documents', // BE-17
  ownList: 'Forbidden', // ONB-12
  lookUpEmployees: 'Only HR can look up employees', // BE-17, hrOrAgent
  checkDocuments: 'Only HR can check documents', // BE-17, hrOrAgent
  emailCheckFailed: 'The email could not be checked', // ONB-03
} as const;

const NOTICE_VERSION = /CURRENT_NOTICE_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(readFileSync(join(REPO, 'lambda', 'shared', 'privacy-notice.mjs'), 'utf8'))?.[1] ?? '';

// ---------------------------------------------------------------- the stored rows

const A = 'EMP-1801';
const B = 'EMP-1802';
const A_EMAIL = 'naledi.dlamini@kestrel-foods.co.za';
const B_EMAIL = 'pieter.vanwyk@kestrel-foods.co.za';
const DOC_A = 'doc_1763620000001';
const ID_NUMBER = '9803145082087';
const ACCEPTED_AT = '2026-11-15T07:30:00.000Z';

function emp(id: string, first: string, email: string, extra: Record<string, string> = {}) {
  return row({
    employee_id: id, first_name: first, last_name: 'Test', email, department: 'Finance', job_title: 'Bookkeeper', planned_start_date: '2026-12-01',
    stage: 'INVITED', step: 'DOCUMENTS', created_at: '2026-11-10T08:00:00.000Z', created_by: 'E2EHR01', hr_staff_id: 'E2EHR01',
    hr_staff_name: 'Jane Smith', id_number_last4: ID_NUMBER.slice(-4), id_number_encrypted: encrypted(ID_NUMBER), ...extra,
  });
}

function world(extra: Partial<Tables> = {}): Tables {
  return {
    employees: [emp('EMP-1890', 'Other', 'other.person@kestrel-foods.co.za'), emp(A, 'Naledi', A_EMAIL), emp(B, 'Pieter', B_EMAIL)],
    documents: [
      row({
        employee_id: A, document_id: DOC_A, document_type: 'BANK_CONFIRMATION', file_name: 'naledi-bank-letter.pdf', file_size: 48213,
        content_type: 'application/pdf', s3_key: `uploads/${A}/BANK_CONFIRMATION/${DOC_A}_naledi-bank-letter.pdf`, ocr_status: 'MANUAL_REVIEW',
        upload_timestamp: '2026-11-14T08:00:00Z', verification_id: `ver_${DOC_A}`,
      }),
    ],
    'document-verification': [
      row({ verificationId: `ver_${DOC_A}`, employeeId: A, documentId: DOC_A, documentType: 'BANK_CONFIRMATION', decision: 'MANUAL_REVIEW', status: 'MANUAL_REVIEW', confidence: 72, createdAt: '2026-11-14T08:02:00.000Z', checks: '[]' }),
    ],
    employee_consents: [],
    employee_invites: [],
    'talent-flow-users': [],
    ...extra,
  };
}

const consentRow = (employeeId: string) => row({
  employee_id: employeeId, notice_version: NOTICE_VERSION, accepted_at: ACCEPTED_AT, cognito_sub: 'sub-naledi', notice_sha256: 'a'.repeat(64), source: 'web',
});

// ---------------------------------------------------------------- callers

const ROBOT_DOMAIN = '@blackhole.postmarkapp.com';
const HR_EMAIL = `pepla-e2e-hr${ROBOT_DOMAIN}`;
type TokenUse = string | null | undefined;
const EMPLOYEE_A = (tokenUse?: TokenUse): Caller => ({ kind: 'jwt', email: A_EMAIL, groups: ['employee'], sub: 'sub-naledi', emailVerified: 'true', ...(tokenUse === undefined ? {} : { tokenUse }) });
const HR = (tokenUse?: TokenUse): Caller => ({ kind: 'jwt', email: HR_EMAIL, groups: ['hr_staff'], staffId: 'E2EHR01', emailVerified: 'true', ...(tokenUse === undefined ? {} : { tokenUse }) });
/** token_use values that are not an ID token. A real access token, an empty claim, and look-alikes. */
const NOT_ID = ['access', '', 'ID', 'refresh', 'id ', 'Id'];
const label = (v: TokenUse) => (v === null ? 'no token_use' : v === undefined ? 'token_use "id"' : `token_use "${v}"`);

// ---------------------------------------------------------------- the routes

type Route = (t: Tables, caller: Caller, o?: { fail?: Failure; stale?: string[] }) => Run;
const call: Record<string, Route> = {
  myStart: (t, caller, o) => runHandler(HANDLER.myStart, t, eventFor({ method: 'GET', route: '/v1/me', path: '/v1/me', caller }), o),
  consent: (t, caller, o) => runHandler(HANDLER.consent, t, eventFor({ method: 'POST', route: '/v1/me/consent', path: '/v1/me/consent', caller, body: { version: NOTICE_VERSION } }), o),
  uploadUrl: (t, caller, o) => runHandler(HANDLER.uploadUrl, t, eventFor({
    method: 'POST', route: '/v1/employees/{employee_id}/documents/upload-url', path: `/v1/employees/${A}/documents/upload-url`,
    pathParameters: { employee_id: A }, caller, body: { documentType: 'BANK_CONFIRMATION', fileName: 'bank-letter.pdf', contentType: 'application/pdf' },
  }), o),
  fileUrl: (t, caller, o) => runHandler(HANDLER.fileUrl, t, eventFor({ method: 'GET', route: '/v1/documents/{id}/url', path: `/v1/documents/${DOC_A}/url`, pathParameters: { id: DOC_A }, caller }), o),
  ownList: (t, caller, o) => runHandler(HANDLER.ownList, t, eventFor({ method: 'GET', route: '/v1/employees/{id}/verifications', path: `/v1/employees/${A}/verifications`, pathParameters: { id: A }, caller }), o),
  employees: (t, caller, o) => runHandler(HANDLER.employees, t, eventFor({ method: 'GET', route: '/v1/employees', path: '/v1/employees', caller }), o),
  summary: (t, caller, o) => runHandler(HANDLER.summary, t, eventFor({
    method: 'GET', route: '/v1/verifications/{id}/summary', path: `/v1/verifications/ver_${DOC_A}/summary`, pathParameters: { id: `ver_${DOC_A}` }, caller,
  }), o),
  emailCheck: (t, caller, o) => runHandler(HANDLER.emailCheck, t, eventFor({
    method: 'GET', route: '/v1/employees/email-check', path: '/v1/employees/email-check', query: { email: 'thandi.mokoena@example.co.za' }, caller,
  }), o),
};
/** The public invite routes take no caller; the body carries a well-formed token. */
const INVITE_TOKEN = 'Q2hlY2tCRTE4SW52aXRlVG9rZW5XZWxsRm9ybWVkMTIz'.slice(0, 43);
const invite = {
  lookup: (t: Tables, o?: { fail?: Failure }) => runHandler(HANDLER.inviteLookup, t, eventFor({ method: 'POST', route: '/v1/invites/lookup', path: '/v1/invites/lookup', caller: { kind: 'none' }, body: { token: INVITE_TOKEN } }), o),
  redeem: (t: Tables, o?: { fail?: Failure }) => runHandler(HANDLER.inviteRedeem, t, eventFor({
    method: 'POST', route: '/v1/invites/redeem', path: '/v1/invites/redeem', caller: { kind: 'none' }, body: { token: INVITE_TOKEN, password: 'Sunbird-Bakery-2026!' },
  }), o),
};

function noThrow(r: Run, how: string) {
  expect(r.error, `${how}: the handler does not throw\n${r.error?.stack ?? ''}`).toBeUndefined();
}
const awsOnly = (r: Run) => r.calls.filter((c) => c.service !== 'log').map((c) => `${c.service} ${c.op}${'table' in c && c.table ? ' ' + c.table : ''}`);

function refused(r: Run, how: string, words: string) {
  noThrow(r, how);
  expect(r.status, `${how}: 403\n${r.raw.slice(0, 400)}`).toBe(403);
  expect(r.body, `${how}: { "error": "${words}" } and nothing else`).toEqual({ error: words });
  expect(awsOnly(r), `${how}: refused before any AWS call`).toEqual([]);
  for (const leak of ['Naledi', A_EMAIL, A, DOC_A, ID_NUMBER, 'uploads/', 'https://']) expect(r.raw, `${how}: the 403 carries no "${leak}"`).not.toContain(leak);
}

const ok = (r: Run, how: string, status = 200) => {
  noThrow(r, how);
  expect(r.status, `${how}: ${status}\n${r.raw.slice(0, 500)}`).toBe(status);
  return r.body;
};

// ---------------------------------------------------------------- Terraform helpers (AC-1)

const SNAP = join(__dirname, 'support', 'be-18');
const KMS_BASE = join(SNAP, 'kms.e96ac2d.tf.txt');
const KMS_MODULE_SNAPSHOTS: Array<[string, string]> = [
  [join(REPO, 'infra', 'modules', 'kms', 'main.tf'), join(SNAP, 'kms-module-main.e96ac2d.tf.txt')],
  [join(REPO, 'infra', 'modules', 'kms', 'variables.tf'), join(SNAP, 'kms-module-variables.e96ac2d.tf.txt')],
];

function found(kind: string, labels: string[], files: string[]): Block[] {
  return blocks(files, kind).filter((b) => labels.every((l, i) => b.labels[i] === l));
}
function listAttr(body: string, name: string): string[] {
  const m = new RegExp(`\\b${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(body);
  return m ? m[1]!.split(/[\s,]+/).filter(Boolean) : [];
}
const squash = (s: string) => stripComments(s).replace(/\s+/g, '');

// =====================================================================================================

test.describe('BE-18 Part A · sign-in identity hardening', () => {
  test('AC-1 recordConsent uses the PII key only through DynamoDB (Terraform text)', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const ROLE = 'aws_iam_role.record_consent.arn';
    const kmsNow = found('module', ['kms_pii'], tfFiles())[0];
    const kmsBase = found('module', ['kms_pii'], [KMS_BASE])[0];
    expect(kmsNow, 'module kms_pii').toBeTruthy();
    expect(kmsBase, 'module kms_pii in the snapshot').toBeTruthy();

    const allowedNow = listAttr(kmsNow!.body, 'allowed_role_arns');
    const readNow = listAttr(kmsNow!.body, 'dynamodb_read_role_arns');
    expect(allowedNow, 'recordConsent is not in allowed_role_arns (no Encrypt, GenerateDataKey or direct Decrypt)').not.toContain(ROLE);
    expect(readNow, 'recordConsent stays in dynamodb_read_role_arns (Decrypt only, only through DynamoDB)').toContain(ROLE);

    // Nothing else leaves either list (other cards may add their own roles).
    for (const list of ['allowed_role_arns', 'dynamodb_read_role_arns', 'cognito_sender_decrypt_role_arns']) {
      const before = listAttr(kmsBase!.body, list).filter((r) => !(list === 'allowed_role_arns' && r === ROLE));
      const now = listAttr(kmsNow!.body, list);
      for (const r of before) expect(now, `kms_pii keeps ${r} in ${list}`).toContain(r);
    }
    // The key policy and its variables are byte for byte as they were (ONB-24's lock judges them too).
    for (const [file, snap] of KMS_MODULE_SNAPSHOTS) {
      expect(squash(readFileSync(file, 'utf8')), `${file.replace(REPO + '/', '')} is unchanged`).toBe(squash(readFileSync(snap, 'utf8')));
    }
    // The role holds no KMS right of its own.
    const policy = found('resource', ['aws_iam_role_policy', 'record_consent'], tfFiles())[0];
    expect(policy, 'aws_iam_role_policy.record_consent').toBeTruthy();
    expect(stripComments(policy!.body), 'the recordConsent role policy has no kms: action').not.toMatch(/["']kms:/);
    expect(found('resource', ['aws_iam_role_policy_attachment'], tfFiles()).filter((b) => /record_consent/.test(b.body)), 'no managed policy on the recordConsent role').toEqual([]);
  });

  test('AC-2 Consent reads are strongly consistent', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    expect(NOTICE_VERSION, 'the current notice version is read from privacy-notice.mjs').not.toBe('');
    const STALE = { stale: ['employee_consents'] };

    // A has accepted; a replica that has not caught up would say they have not.
    const accepted = world({ employee_consents: [consentRow(A)] });
    const start = call.myStart(accepted, EMPLOYEE_A(), STALE);
    const body = ok(start, 'start page after accepting');
    expect(body.consent, 'the start page shows the stored acceptance').toEqual({ version: NOTICE_VERSION, acceptedAt: ACCEPTED_AT });

    // A second accept (a double click, or two tabs) finds the row, reads it back and answers 200, never 500.
    const again = call.consent(accepted, EMPLOYEE_A(), STALE);
    const againBody = ok(again, 'accepting again');
    expect(againBody, 'the first acceptance time is kept').toEqual({ version: NOTICE_VERSION, acceptedAt: ACCEPTED_AT });
    expect(writes(again).filter((w) => w !== 'PutItem employee_consents'), 'nothing written but the refused conditional put').toEqual([]);
    expect(again.tables['employee_consents']!.map(plain), 'the stored row is unchanged').toEqual([plain(consentRow(A))]);

    // Fresh: 201 then, on the tables it left, 200 with the same time.
    const first = call.consent(world(), EMPLOYEE_A());
    const firstBody = ok(first, 'first accept', 201);
    const second = call.consent(first.tables, EMPLOYEE_A(), STALE);
    expect(ok(second, 'second accept'), 'the same acceptance time').toEqual({ version: NOTICE_VERSION, acceptedAt: firstBody.acceptedAt });

    // Every consent GetItem is consistent; no index query asks for it (DynamoDB refuses that).
    for (const r of [start, again, first, second]) {
      const gets = dynamoCalls(r).filter((c) => c.op === 'GetItem' && c.table === 'employee_consents');
      for (const g of gets) expect(g.input.ConsistentRead, 'GetItem on employee_consents carries ConsistentRead: true').toBe(true);
      for (const q of dynamoCalls(r).filter((c) => c.op === 'Query' && c.input.IndexName)) expect(q.input.ConsistentRead, `Query on ${q.input.IndexName} does not ask for a consistent read`).not.toBe(true);
    }
    expect(dynamoCalls(start).some((c) => c.op === 'GetItem' && c.table === 'employee_consents'), 'the start page reads the consent').toBe(true);
  });

  test('AC-3 Only ID tokens are accepted where the person is worked out from the token', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const t = world({ employee_consents: [consentRow(A)] });

    // The shared rule.
    const cases: unknown[][] = [[{}], [{ token_use: 'id' }], ...NOT_ID.map((v) => [{ token_use: v }])];
    const got = fnRule(HR_GROUP_FILE, 'isIdToken', cases);
    expect(got, 'isIdToken: missing → true, "id" → true, anything else → false').toEqual([true, true, ...NOT_ID.map(() => false)]);

    // Refused, with each route's existing words and before any AWS call. The access-token claims here
    // even carry the email, so the refusal is on token_use alone.
    for (const v of NOT_ID) {
      refused(call.myStart(t, EMPLOYEE_A(v)), `start page, ${label(v)}`, WORDS.newEmployeesOnly);
      refused(call.consent(t, EMPLOYEE_A(v)), `consent, ${label(v)}`, WORDS.newEmployeesOnly);
    }
    for (const v of ['access', '']) {
      const up = call.uploadUrl(t, EMPLOYEE_A(v));
      expect(up.status, `upload, owner with ${label(v)}: 403`).toBe(403);
      expect(up.body, 'with BE-17\'s words').toEqual({ error: WORDS.upload });
      expect(writes(up), 'no document row').toEqual([]);
      expect(s3Calls(up), 'no S3 presign').toEqual([]);
      const file = call.fileUrl(t, EMPLOYEE_A(v));
      expect(file.status, `file link, owner with ${label(v)}: 403`).toBe(403);
      expect(file.body).toEqual({ error: WORDS.ownFile });
      expect(s3Calls(file), 'no S3 presign').toEqual([]);
      const list = call.ownList(t, EMPLOYEE_A(v));
      expect(list.status, `own list, owner with ${label(v)}: 403`).toBe(403);
      expect(list.body).toEqual({ error: WORDS.ownList });
      expect(awsOnly(list).filter((c) => !/^dynamodb (GetItem|Query) employees$/.test(c)), 'own list: nothing but the read of the employee row').toEqual([]);

      refused(call.employees(t, HR(v)), `getEmployees (hrOrAgent), HR with ${label(v)}`, WORDS.lookUpEmployees);
      refused(call.summary(t, HR(v)), `summariseVerification (hrOrAgent), HR with ${label(v)}`, WORDS.checkDocuments);
      refused(call.emailCheck(t, HR(v)), `checkEmployeeEmail (hrOnly), HR with ${label(v)}`, 'Only HR can check an email');
    }

    // ID tokens, and claims with no token_use at all, work as today.
    for (const v of [undefined, null] as TokenUse[]) {
      const start = ok(call.myStart(t, EMPLOYEE_A(v)), `start page, ${label(v)}`);
      expect(start.firstName, 'the start page is A\'s').toBe('Naledi');
      ok(call.fileUrl(t, EMPLOYEE_A(v)), `file link, owner with ${label(v)}`);
      ok(call.ownList(t, EMPLOYEE_A(v)), `own list, owner with ${label(v)}`);
      ok(call.uploadUrl(t, EMPLOYEE_A(v)), `upload, owner with ${label(v)}`);
      ok(call.employees(t, HR(v)), `getEmployees, HR with ${label(v)}`);
      ok(call.emailCheck(t, HR(v)), `email check, HR with ${label(v)}`);
    }
  });

  test('AC-4 The sign-in routes log the error name, never its text', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const fail = (ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), name: 'InternalServerError', message: `${MARKER}: item {"email":"${LEAKED}"} could not be read` });
    const clean = (r: { calls: Run['calls'] }, how: string) => {
      const logs = logText(r);
      expect(logs, `${how}: the error text is not logged`).not.toContain(MARKER);
      expect(logs, `${how}: the address inside the error text is not logged`).not.toContain(LEAKED);
      expect(logs, `${how}: the error name is logged as errorName`).toMatch(/"errorname":"internalservererror"/);
      expect(logs, `${how}: no stack is logged`).not.toMatch(/"stack"/);
    };
    const t = world({ employee_consents: [consentRow(A)] });

    const cases: Array<[string, Run, number, unknown]> = [
      ['getMyStart', call.myStart(t, EMPLOYEE_A(), { fail: fail() }), 500, { error: WORDS.somethingWrong }],
      ['recordConsent', call.consent(world(), EMPLOYEE_A(), { fail: fail() }), 500, { error: WORDS.somethingWrong }],
      ['lookupInvite', invite.lookup(t, { fail: fail() }), 500, { error: WORDS.somethingWrong }],
      ['redeemInvite', invite.redeem(t, { fail: fail() }), 500, { error: WORDS.somethingWrong }],
      ['checkEmployeeEmail', call.emailCheck(t, HR(), { fail: fail() }), 500, { error: WORDS.emailCheckFailed }],
      ['getEmployeeDocumentVerifications', call.ownList(t, HR(), { fail: fail() }), 500, { error: WORDS.somethingWrong }],
    ];
    for (const [name, r, status, body] of cases) {
      noThrow(r, name);
      expect(r.status, `${name}: ${status}\n${r.raw.slice(0, 300)}`).toBe(status);
      expect(r.body, `${name}: the fixed answer and nothing else`).toEqual(body);
      expect(r.raw, `${name}: the answer carries no error text`).not.toContain(MARKER);
      clean(r, name);
    }

    // The post sign-in trigger: every DynamoDB call fails; sign-in still goes through.
    const ev = cognitoEvent(A_EMAIL);
    const post = runHandler(HANDLER.postAuth, t, ev, { fail: fail() });
    noThrow(post, 'cognitoPostAuth (it never throws, so sign-in goes through)');
    clean(post, 'cognitoPostAuth');
  });

  test('AC-5 Email lookups match whatever the case', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const MIXED = 'Thandi.Mokoena@Example.co.za';
    const LOWER = MIXED.toLowerCase();
    const T = 'EMP-1810';
    const stageOf = (tables: Tables) => plain(tables['employees']!.find((r) => r['employee_id']?.['S'] === T))?.['stage'];
    const emailQueries = (r: Run) => dynamoCalls(r).filter((c) => c.op === 'Query' && c.table === 'employees' && c.input.IndexName === 'email-index');

    // Cognito holds capitals, the row is lower case (every row createEmployee writes since ONB-03).
    const t1 = world({ employees: [emp(T, 'Thandi', LOWER)] });
    const r1 = runHandler(HANDLER.postAuth, t1, cognitoEvent(MIXED));
    noThrow(r1, 'post sign-in, lower-case row');
    expect(stageOf(r1.tables), 'the lower-case row is bumped to ACTIVE').toBe('ACTIVE');
    expect(emailQueries(r1).length, 'at most two email-index queries').toBeLessThanOrEqual(2);
    expect(emailQueries(r1)[0]?.input.ExpressionAttributeValues?.[':email']?.S, 'the first query is the lower-case address').toBe(LOWER);

    // An old row stored with the same capitals as Cognito still matches.
    const t2 = world({ employees: [emp(T, 'Thandi', MIXED)] });
    const r2 = runHandler(HANDLER.postAuth, t2, cognitoEvent(MIXED));
    noThrow(r2, 'post sign-in, legacy row');
    expect(stageOf(r2.tables), 'the legacy row is bumped to ACTIVE').toBe('ACTIVE');
    expect(emailQueries(r2).length, 'at most two email-index queries').toBeLessThanOrEqual(2);

    // No row at all: nothing is bumped, and no more than two lookups.
    const r3 = runHandler(HANDLER.postAuth, world(), cognitoEvent(MIXED));
    noThrow(r3, 'post sign-in, no row');
    expect(writes(r3).filter((w) => w.endsWith(' employees')), 'nothing written to employees').toEqual([]);
    expect(emailQueries(r3).length, 'at most two email-index queries').toBeLessThanOrEqual(2);

    // The one-off script: plan changes nothing; apply lowercases only rows with capitals.
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const rows = [
      emp('EMP-1821', 'One', 'one.person@kestrel-foods.co.za'),
      emp('EMP-1822', 'Two', 'Two.Person@Kestrel-Foods.co.za'),
      emp('EMP-1823', 'Three', 'three.person@kestrel-foods.co.za'),
      emp('EMP-1824', 'Four', 'FOUR.PERSON@KESTREL-FOODS.CO.ZA'),
      emp('EMP-1825', 'Five', 'five.person@kestrel-foods.co.za'),
      emp('EMP-1826', 'Six', 'Six.Person@kestrel-foods.co.za'), // past the first scan page (pages of 4)
    ];
    const tables = world({ employees: rows });
    const emails = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));

    const plan = runScript(SCRIPT, ['--plan'], tables);
    expect(plan.error, `--plan runs\n${plan.error?.stack ?? ''}`).toBeUndefined();
    expect(plan.calls.filter((c) => c.service === 'dynamodb' && !['Scan', 'Query', 'GetItem'].includes(c.op)), '--plan writes nothing').toEqual([]);
    expect(emails(plan.tables), '--plan leaves every email as it was').toEqual(emails(tables));
    expect(plan.out, '--plan prints the count of rows to change (3)').toMatch(/\b3\b/);
    for (const r of rows) expect(plan.out, '--plan prints no email address').not.toContain(r['email']!['S']!);

    const apply = runScript(SCRIPT, ['--apply'], tables);
    expect(apply.error, `--apply runs\n${apply.error?.stack ?? ''}`).toBeUndefined();
    const after = emails(apply.tables);
    expect(after, 'every email is lower case after --apply').toEqual(Object.fromEntries(Object.entries(emails(tables)).map(([k, v]) => [k, String(v).toLowerCase()])));
    const updates = apply.calls.filter((c): c is Extract<Run['calls'][number], { service: 'dynamodb' }> => c.service === 'dynamodb' && c.op === 'UpdateItem');
    expect(updates.length, 'one update per row with capitals').toBe(3);
    for (const u of updates) {
      expect(u.input.ConditionExpression ?? '', 'each update holds only if the row still has the old email').toMatch(/email|#e/);
      const values = JSON.stringify(u.input.ExpressionAttributeValues ?? {});
      const old = rows.find((r) => r['employee_id']!['S'] === u.input.Key?.employee_id?.S)?.['email']?.['S'] ?? '';
      expect(values, 'the condition names the old email').toContain(old);
    }
    expect(apply.calls.filter((c) => c.service === 'dynamodb' && ['PutItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'].includes(c.op)), 'no put or delete').toEqual([]);

    // Two rows that would end up with the same address: nothing is written at all.
    const clash = world({ employees: [emp('EMP-1831', 'Dup', 'dup.person@kestrel-foods.co.za'), emp('EMP-1832', 'Dup', 'Dup.Person@kestrel-foods.co.za'), emp('EMP-1833', 'Other', 'Other.Person@kestrel-foods.co.za')] });
    const refusedRun = runScript(SCRIPT, ['--apply'], clash);
    expect(refusedRun.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem'), 'a clash writes nothing').toEqual([]);
    expect(emails(refusedRun.tables), 'every email is as it was').toEqual(emails(clash));
    expect(refusedRun.error !== undefined || Number(refusedRun.result?.exitCode ?? 0) !== 0, 'a clash ends with an error or a non-zero exit code').toBe(true);
  });
});
