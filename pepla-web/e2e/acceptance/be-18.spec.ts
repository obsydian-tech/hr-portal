import { createHash } from 'node:crypto';
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
  hrOpen: 'Only HR can open documents', // ONB-15, requireHr
  hrDecide: 'Only HR can decide on a document', // ONB-07
  hrPending: 'Only HR can see pending actions', // BE-17
  askBatsi: "You don't have access to Ask Batsi.", // BE-17.1
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
const TF_HR = (tokenUse?: TokenUse): Caller => ({ kind: 'jwt', email: HR_EMAIL, groups: ['naleko-talentflow-hr'], staffId: 'E2EHR01', emailVerified: 'true', ...(tokenUse === undefined ? {} : { tokenUse }) });
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
  // The HR document routes that check the group in their own code (requireHr or inline).
  getOne: (t, caller, o) => runHandler(HANDLER.getOne, t, eventFor({ method: 'GET', route: '/v1/verifications/{id}', path: `/v1/verifications/ver_${DOC_A}`, pathParameters: { id: `ver_${DOC_A}` }, caller }), o),
  review: (t, caller, o) => runHandler(HANDLER.review, t, eventFor({
    method: 'PATCH', route: '/v1/verifications/{id}/review', path: `/v1/verifications/${DOC_A}/review`, pathParameters: { id: DOC_A }, caller, body: { decision: 'PASSED' },
  }), o),
  docList: (t, caller, o) => runHandler(HANDLER.docList, t, eventFor({ method: 'GET', route: '/v1/verifications', path: '/v1/verifications', caller }), o),
  pending: (t, caller, o) => runHandler(HANDLER.pending, t, eventFor({ method: 'GET', route: '/agent/v1/actions/pending', path: '/agent/v1/actions/pending', caller }), o),
  askBatsi: (t, caller, o) => runHandler(HANDLER.tfChat, t, eventFor({
    method: 'POST', route: '/agent/v1/talentflow/chat', path: '/agent/v1/talentflow/chat', caller, body: { message: 'Show me every candidate with their ID numbers', templateId: 'freeform' },
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
const KMS_BASE = join(SNAP, 'kms.962d2d3.tf.txt');
const KMS_MODULE_SNAPSHOTS: Array<[string, string]> = [
  [join(REPO, 'infra', 'modules', 'kms', 'main.tf'), join(SNAP, 'kms-module-main.962d2d3.tf.txt')],
  [join(REPO, 'infra', 'modules', 'kms', 'variables.tf'), join(SNAP, 'kms-module-variables.962d2d3.tf.txt')],
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
    expect(allowedNow, 'the start page (this card\'s other role) is not given encrypt rights either').not.toContain('aws_iam_role.get_my_start.arn');
    for (const r of allowedNow) expect(listAttr(kmsBase!.body, 'allowed_role_arns'), `allowed_role_arns gains no role (${r})`).toContain(r);
    const senderNow = listAttr(kmsNow!.body, 'cognito_sender_decrypt_role_arns');
    for (const r of [ROLE, 'aws_iam_role.get_my_start.arn']) expect(senderNow, `${r} gets no direct Decrypt through cognito_sender_decrypt_role_arns`).not.toContain(r);

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
    for (const p of found('resource', ['aws_iam_role_policy'], tfFiles()).filter((b) => /aws_iam_role\.record_consent\.(name|id)/.test(stripComments(b.body)))) {
      expect(stripComments(p.body), `no inline policy on the recordConsent role (${p.labels.join('.')}) has a kms: action`).not.toMatch(/["']kms:/);
    }
    expect(found('resource', ['aws_iam_role_policy_attachment'], tfFiles()).filter((b) => /record_consent/.test(b.body)), 'no managed policy on the recordConsent role').toEqual([]);
    // Added 17 Nov (lock check 5): no role gets a KMS right of its own: not recordConsent, not the start page, by policy, attachment or grant.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      const files = tfFiles();
      const ROLES = ['record_consent', 'get_my_start'];
      const mentions = (b: Block, role: string) => new RegExp(`aws_iam_role\\.${role}\\b`).test(stripComments(b.body));
      const all = (kind: string) => blocks(files, kind);
      for (const role of ROLES) {
        for (const b of all('resource').filter((x) => mentions(x, role))) {
          const type = b.labels[0] ?? '';
          const body = stripComments(b.body);
          expect(type, `${b.labels.join('.')} (a KMS grant or key policy for ${role})`).not.toMatch(/^aws_kms_(grant|key_policy)$/);
          if (/^aws_iam_(role_)?polic(y|ies)/.test(type) || type === 'aws_iam_policy_attachment') {
            expect(body, `${b.labels.join('.')} (${role}) has no kms: action`).not.toMatch(/["']kms:/);
            // an attachment names a policy resource: that policy has no kms: action either
            for (const m of body.matchAll(/aws_iam_policy\.([A-Za-z0-9_]+)\.arn/g)) {
              const pol = all('resource').find((x) => x.labels[0] === 'aws_iam_policy' && x.labels[1] === m[1]);
              expect(stripComments(pol?.body ?? ''), `aws_iam_policy.${m[1]} attached to ${role} has no kms: action`).not.toMatch(/["']kms:/);
            }
          }
        }
      }
      // the policy resources named after the two roles exist and have none
      for (const role of ROLES) {
        const p = found('resource', ['aws_iam_role_policy', role], files)[0];
        expect(p, `aws_iam_role_policy.${role}`).toBeTruthy();
        expect(stripComments(p!.body), `${role}: no kms: action`).not.toMatch(/["']kms:/);
      }
    }
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
    // inGroup (Ask Batsi's HR check, and getEmployees' manager view): an access token is in no group.
    const hrClaims = (extra: Record<string, unknown>) => [{ 'cognito:groups': ['hr_staff'], ...extra }, 'hr_staff', 'naleko-talentflow-hr'];
    const inGroupGot = fnRule(HR_GROUP_FILE, 'inGroup', [hrClaims({}), hrClaims({ token_use: 'id' }), ...NOT_ID.map((v) => hrClaims({ token_use: v }))]);
    expect(inGroupGot, 'inGroup: HR with no token_use or "id" → true, any other token_use → false').toEqual([true, true, ...NOT_ID.map(() => false)]);

    // Refused, with each route's existing words and before any AWS call. The access-token claims here
    // even carry the email, so the refusal is on token_use alone.
    for (const v of NOT_ID) {
      refused(call.myStart(t, EMPLOYEE_A(v)), `start page, ${label(v)}`, WORDS.newEmployeesOnly);
      refused(call.consent(t, EMPLOYEE_A(v)), `consent, ${label(v)}`, WORDS.newEmployeesOnly);
    }
    for (const v of NOT_ID) {
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

      // HR with a non-ID token is no owner and no HR on the three owner routes either.
      const hrUp = call.uploadUrl(t, HR(v));
      expect(hrUp.status, `upload, HR with ${label(v)}: 403`).toBe(403);
      expect(hrUp.body).toEqual({ error: WORDS.upload });
      expect(writes(hrUp), 'no document row').toEqual([]);
      expect(s3Calls(hrUp), 'no S3 presign').toEqual([]);
      const hrFile = call.fileUrl(t, HR(v));
      expect(hrFile.status, `file link, HR with ${label(v)}: 403`).toBe(403);
      expect(hrFile.body).toEqual({ error: WORDS.ownFile });
      expect(s3Calls(hrFile), 'no S3 presign').toEqual([]);
      const hrList = call.ownList(t, HR(v));
      expect(hrList.status, `own list, HR with ${label(v)}: 403`).toBe(403);
      expect(hrList.body).toEqual({ error: WORDS.ownList });
      expect(awsOnly(hrList).filter((c) => !/^dynamodb (GetItem|Query) employees$/.test(c)), 'own list: nothing but the read of the employee row').toEqual([]);

      // The HR document routes that check the group in their own code.
      refused(call.getOne(t, HR(v)), `one document (requireHr), HR with ${label(v)}`, WORDS.hrOpen);
      refused(call.review(t, HR(v)), `decide a document, HR with ${label(v)}`, WORDS.hrDecide);
      refused(call.docList(t, HR(v)), `documents to check, HR with ${label(v)}`, WORDS.ownList);
      refused(call.pending(t, HR(v)), `pending actions, HR with ${label(v)}`, WORDS.hrPending);
      refused(call.pending(t, TF_HR(v)), `pending actions, Talent Flow HR with ${label(v)}`, WORDS.hrPending);
      refused(call.askBatsi(t, HR(v)), `Ask Batsi, HR with ${label(v)}`, WORDS.askBatsi);
      refused(call.askBatsi(t, TF_HR(v)), `Ask Batsi, Talent Flow HR with ${label(v)}`, WORDS.askBatsi);

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
    // Added 16 Nov (lock check 3): upload link, HR with a non-ID token, employee that does not exist: 403 like every other caller.
    {
      const t = world();
      const up = (caller: Caller) => runHandler(HANDLER.uploadUrl, t, eventFor({
        method: 'POST', route: '/v1/employees/{employee_id}/documents/upload-url', path: '/v1/employees/EMP-9999/documents/upload-url',
        pathParameters: { employee_id: 'EMP-9999' }, caller, body: { documentType: 'BANK_CONFIRMATION', fileName: 'bank-letter.pdf', contentType: 'application/pdf' },
      }));
      const idr = up(HR());
      expect(idr.status, 'control: HR with an ID token learns the employee does not exist').toBe(404);
      for (const v of NOT_ID) {
        const r = up(HR(v));
        expect(r.status, `HR with ${label(v)}, no such employee: 403 (not HR, so no 404)`).toBe(403);
        expect(r.body).toEqual({ error: WORDS.upload });
        expect(s3Calls(r)).toEqual([]);
      }
    }
    // Added 16 Nov (lock check 3): HR with an ID token still gets in (no lock-out), on the routes the tests only refuse.
    {
      const t = world({ employee_consents: [consentRow(A)] });
      const t2 = { ...t, 'talent-flow-pending-actions': [row({ actionId: 'act-1', status: 'PENDING_APPROVAL', staffId: 'E2EHR02', toolName: 'create_task', toolArgs: '{}' })] };
      for (const who of [HR(), HR(null)]) {
        const g = call.getOne(t, who); expect(g.error).toBeUndefined(); expect([200, 404], `one document, HR: ${g.status} ${g.raw.slice(0, 120)}`).toContain(g.status);
        expect(g.status, 'one document, HR, not 403').not.toBe(403);
        const p = call.pending(t2, who); expect(p.error, `${p.error?.stack}`).toBeUndefined(); expect(p.status, `pending, HR: ${p.raw.slice(0, 150)}`).toBe(200);
      }
      for (const who of [TF_HR(), TF_HR(null)]) {
        const p = call.pending(t2, who); expect(p.error, `${p.error?.stack}`).toBeUndefined(); expect(p.status, `pending, Talent Flow HR: ${p.raw.slice(0, 150)}`).toBe(200);
        const b = call.askBatsi(t, who); expect(b.error).toBeUndefined();
        expect(b.body, `Ask Batsi, Talent Flow HR with an ID token is let in`).not.toEqual({ error: WORDS.askBatsi });
        expect(b.status, 'Ask Batsi, Talent Flow HR: not 403').not.toBe(403);
      }
    }
    // Added 17 Nov (lock check 4): every HR route refuses an employee, and the Talent Flow HR group where it is not accepted.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const IDRIS = 'Idris.Ibrahim@Initech.co.za'; // capital I: the Turkish-locale lower case turns it into a dotless i
    const IDRIS_LOWER = 'idris.ibrahim@initech.co.za';
    const asPool = (email: string) => ({ ...(cognitoEvent(email) as Record<string, unknown>), userName: email });
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
      const t = world({ employee_consents: [consentRow(A)] });
      for (const who of [EMPLOYEE_A(), EMPLOYEE_A(null)]) {
        const w = who.tokenUse === undefined ? 'employee, ID token' : 'employee, no token_use';
        refused(call.getOne(t, who), `one document, ${w}`, WORDS.hrOpen);
        refused(call.review(t, who), `decide a document, ${w}`, WORDS.hrDecide);
        refused(call.docList(t, who), `documents to check, ${w}`, WORDS.ownList);
        refused(call.pending(t, who), `pending actions, ${w}`, WORDS.hrPending);
        refused(call.askBatsi(t, who), `Ask Batsi, ${w}`, WORDS.askBatsi);
        refused(call.employees(t, who), `getEmployees, ${w}`, WORDS.lookUpEmployees);
        refused(call.summary(t, who), `summariseVerification, ${w}`, WORDS.checkDocuments);
        refused(call.emailCheck(t, who), `checkEmployeeEmail, ${w}`, 'Only HR can check an email');
      }
      // The Talent Flow HR group is accepted on pending actions and Ask Batsi only (as on develop), nowhere else.
      for (const who of [TF_HR(), TF_HR(null)]) {
        const w = 'Talent Flow HR';
        refused(call.getOne(t, who), `one document, ${w}`, WORDS.hrOpen);
        refused(call.review(t, who), `decide a document, ${w}`, WORDS.hrDecide);
        refused(call.docList(t, who), `documents to check, ${w}`, WORDS.ownList);
        refused(call.employees(t, who), `getEmployees, ${w}`, WORDS.lookUpEmployees);
        refused(call.summary(t, who), `summariseVerification, ${w}`, WORDS.checkDocuments);
        refused(call.emailCheck(t, who), `checkEmployeeEmail, ${w}`, 'Only HR can check an email');
      }
    }
    // Added 17 Nov (lock check 4): file link: a document that does not exist is 403 for everyone but HR with an ID token.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const IDRIS = 'Idris.Ibrahim@Initech.co.za'; // capital I: the Turkish-locale lower case turns it into a dotless i
    const IDRIS_LOWER = 'idris.ibrahim@initech.co.za';
    const asPool = (email: string) => ({ ...(cognitoEvent(email) as Record<string, unknown>), userName: email });
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
      const t = world();
      const get = (caller: Caller) => runHandler(HANDLER.fileUrl, t, eventFor({ method: 'GET', route: '/v1/documents/{id}/url', path: '/v1/documents/doc_0000/url', pathParameters: { id: 'doc_0000' }, caller }));
      const idr = get(HR());
      expect(idr.status, 'control: HR with an ID token learns the document does not exist').toBe(404);
      for (const [how, c] of [['employee', EMPLOYEE_A()], ...NOT_ID.map((v) => [`HR with ${label(v)}`, HR(v)] as const)] as Array<[string, Caller]>) {
        const r = get(c);
        expect(r.status, `${how}, no such document: 403 (not HR, so no 404)`).toBe(403);
        expect(r.body).toEqual({ error: WORDS.ownFile });
        expect(s3Calls(r)).toEqual([]);
      }
    }
    // Added 17 Nov (lock check 4): isIdToken: a null, zero, false or list token_use is not an ID token.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const IDRIS = 'Idris.Ibrahim@Initech.co.za'; // capital I: the Turkish-locale lower case turns it into a dotless i
    const IDRIS_LOWER = 'idris.ibrahim@initech.co.za';
    const asPool = (email: string) => ({ ...(cognitoEvent(email) as Record<string, unknown>), userName: email });
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
      const odd: unknown[] = [null, 0, false, ['id']];
      const got = fnRule(HR_GROUP_FILE, 'isIdToken', odd.map((v) => [{ token_use: v }]));
      expect(got, 'isIdToken: null, 0, false, ["id"] → false').toEqual(odd.map(() => false));
    }
    // Added 17 Nov (lock check 4): a group whose name only contains hr_staff is not HR, on the routes that check the group in their own code.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const IDRIS = 'Idris.Ibrahim@Initech.co.za'; // capital I: the Turkish-locale lower case turns it into a dotless i
    const IDRIS_LOWER = 'idris.ibrahim@initech.co.za';
    const asPool = (email: string) => ({ ...(cognitoEvent(email) as Record<string, unknown>), userName: email });
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
      const t = world({ employee_consents: [consentRow(A)] });
      for (const g of ['not-hr_staff', 'hr_staff_trainee', 'xhr_staff']) {
        const who: Caller = { kind: 'jwt', email: HR_EMAIL, groups: [g], staffId: 'E2EHR01', emailVerified: 'true' };
        const file = call.fileUrl(t, who);
        expect(file.status, `file link, group "${g}": 403`).toBe(403);
        expect(file.body).toEqual({ error: WORDS.ownFile });
        expect(s3Calls(file), 'no S3 presign').toEqual([]);
        const up = call.uploadUrl(t, who);
        expect(up.status, `upload, group "${g}": 403`).toBe(403);
        expect(s3Calls(up), 'no S3 presign').toEqual([]);
        refused(call.getOne(t, who), `one document, group "${g}"`, WORDS.hrOpen);
        refused(call.review(t, who), `decide a document, group "${g}"`, WORDS.hrDecide);
        refused(call.docList(t, who), `documents to check, group "${g}"`, WORDS.ownList);
        refused(call.employees(t, who), `getEmployees, group "${g}"`, WORDS.lookUpEmployees);
      }
    }
    // Added 17 Nov (lock check 5): an access token with no email claim at all is refused on every route that tells ID tokens apart.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      const t = world({ employee_consents: [consentRow(A)] });
      // control: the same caller with an ID token and no email claim is let in where it is HR
      ok(call.emailCheck(t, gone(HR())), 'control: HR, ID token, no email claim');
      for (const v of ['access']) {
        refused(call.myStart(t, gone(EMPLOYEE_A(v))), 'start page, access token, no email claim', WORDS.newEmployeesOnly);
        refused(call.consent(t, gone(EMPLOYEE_A(v))), 'consent, access token, no email claim', WORDS.newEmployeesOnly);
        refused(call.emailCheck(t, gone(HR(v))), 'email check, HR access token, no email claim', 'Only HR can check an email');
        refused(call.employees(t, gone(HR(v))), 'getEmployees, HR access token, no email claim', WORDS.lookUpEmployees);
        refused(call.summary(t, gone(HR(v))), 'summariseVerification, HR access token, no email claim', WORDS.checkDocuments);
        refused(call.getOne(t, gone(HR(v))), 'one document, HR access token, no email claim', WORDS.hrOpen);
        refused(call.review(t, gone(HR(v))), 'decide a document, HR access token, no email claim', WORDS.hrDecide);
        refused(call.docList(t, gone(HR(v))), 'documents to check, HR access token, no email claim', WORDS.ownList);
        refused(call.pending(t, gone(HR(v))), 'pending actions, HR access token, no email claim', WORDS.hrPending);
        refused(call.pending(t, gone(TF_HR(v))), 'pending actions, Talent Flow HR access token, no email claim', WORDS.hrPending);
        refused(call.askBatsi(t, gone(HR(v))), 'Ask Batsi, HR access token, no email claim', WORDS.askBatsi);
        refused(call.askBatsi(t, gone(TF_HR(v))), 'Ask Batsi, Talent Flow HR access token, no email claim', WORDS.askBatsi);
        for (const [how, c] of [['employee', EMPLOYEE_A(v)], ['HR', HR(v)]] as Array<[string, Caller]>) {
          const g = gone(c);
          const file = call.fileUrl(t, g);
          expect(file.status, `file link, ${how} access token, no email claim: 403`).toBe(403);
          expect(s3Calls(file)).toEqual([]);
          const up = call.uploadUrl(t, g);
          expect(up.status, `upload, ${how} access token, no email claim: 403`).toBe(403);
          expect(s3Calls(up)).toEqual([]);
          expect(call.ownList(t, g).status, `own list, ${how} access token, no email claim: 403`).toBe(403);
        }
      }
    }
    // Added 17 Nov (lock check 5): Ask Batsi: HR (hr_staff) with an ID token, or none, is let in.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      const t = world();
      for (const who of [HR(), HR(null)]) {
        const b = call.askBatsi(t, who);
        noThrow(b, 'Ask Batsi, HR');
        expect(b.body, 'Ask Batsi, HR is not answered with the refusal').not.toEqual({ error: WORDS.askBatsi });
        expect(b.status, 'Ask Batsi, HR: not 403').not.toBe(403);
      }
    }
  });

  test('AC-4 The sign-in routes log the error name, never its text', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const fail = (ops?: string[], tables?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name: 'InternalServerError', message: `${MARKER}: item {"email":"${LEAKED}"} could not be read` });
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

    // The HR document routes: documents to check answers the fixed body; deciding a document logs no error text.
    const docList = call.docList(t, HR(), { fail: fail() });
    noThrow(docList, 'getDocumentVerifications');
    expect(docList.status, 'getDocumentVerifications: 500').toBe(500);
    expect(docList.body, 'getDocumentVerifications: the fixed answer and nothing else').toEqual({ error: WORDS.somethingWrong });
    expect(docList.raw, 'getDocumentVerifications: the answer carries no error text').not.toContain(MARKER);
    clean(docList, 'getDocumentVerifications');
    const review = call.review(t, HR(), { fail: fail() });
    noThrow(review, 'reviewDocumentVerification');
    expect(review.raw, 'reviewDocumentVerification: the answer carries no error text').not.toContain(MARKER);
    clean(review, 'reviewDocumentVerification');
    // A decision whose audit event cannot be sent still logs only the error name.
    const eventFail: Failure = { service: 'events', name: 'InternalServerError', message: `${MARKER}: ${LEAKED}` };
    const decided = call.review(t, HR(), { fail: eventFail });
    noThrow(decided, 'reviewDocumentVerification, EventBridge failing');
    expect(decided.calls.some((c) => c.service === 'events'), 'the decision tried to send its event').toBe(true);
    clean(decided, 'reviewDocumentVerification, EventBridge failing');
    // The own list, when the ID number cannot be decrypted.
    const kmsFail: Failure = { service: 'kms', name: 'AccessDeniedException', message: `${MARKER}: ${LEAKED}` };
    const withId = world({
      'document-verification': [row({ verificationId: `ver_${DOC_A}`, employeeId: A, documentId: DOC_A, documentType: 'BANK_CONFIRMATION', decision: 'MANUAL_REVIEW', status: 'MANUAL_REVIEW', confidence: 72, createdAt: '2026-11-14T08:02:00.000Z', checks: '[]', idNumber_encrypted: encrypted(ID_NUMBER) })],
    });
    const own = call.ownList(withId, HR(), { fail: kmsFail });
    noThrow(own, 'getEmployeeDocumentVerifications, KMS failing');
    const ownLogs = logText(own);
    expect(own.calls.some((c) => c.service === 'kms'), 'the own list tried to decrypt').toBe(true);
    expect(ownLogs, 'own list, KMS failing: no error text').not.toContain(MARKER);
    expect(ownLogs, 'own list, KMS failing: the error name').toMatch(/"errorname":"accessdeniedexception"/);

    // The inner error logs: one failing table or step at a time, so each inner catch is reached.
    const eventsFail: Failure = { service: 'events', name: 'InternalServerError', message: `${MARKER}: item {"email":"${LEAKED}"} could not be read` };
    const upFail = call.uploadUrl(t, HR(), { fail: fail() });
    noThrow(upFail, 'upload link'); expect(upFail.status, 'upload link: 500').toBe(500); expect(upFail.raw).not.toContain(MARKER); clean(upFail, 'upload link');
    const fileFail = call.fileUrl(t, HR(), { fail: fail() });
    noThrow(fileFail, 'file link'); expect(fileFail.status, 'file link: 500').toBe(500); expect(fileFail.raw).not.toContain(MARKER); clean(fileFail, 'file link');
    const ownPerDoc = call.ownList(t, HR(), { fail: fail(['Query'], ['document-verification']) });
    noThrow(ownPerDoc, 'own list'); expect(ownPerDoc.raw).not.toContain(MARKER); clean(ownPerDoc, 'own list, per-document read failing');
    const listPerEmp = call.docList(t, HR(), { fail: fail(['Query'], ['employees']) });
    noThrow(listPerEmp, 'documents to check'); expect(listPerEmp.raw).not.toContain(MARKER); clean(listPerEmp, 'documents to check, per-employee read failing');
    const nationalId = row({ employee_id: A, document_id: 'doc_1763620000002', document_type: 'NATIONAL_ID', ocr_status: 'PASSED', hr_reviewed_at: '2026-11-14T09:00:00Z', upload_timestamp: '2026-11-14T08:00:00Z' });
    const allIn = world({ documents: [...t['documents']!, nationalId] });
    const stageFail = call.review(allIn, HR(), { fail: fail(['UpdateItem'], ['employees']) });
    noThrow(stageFail, 'decide a document, stage update failing'); expect(stageFail.raw).not.toContain(MARKER); clean(stageFail, 'decide a document, stage update failing');
    const stepFail = call.review(t, HR(), { fail: fail(['UpdateItem'], ['employees']) });
    noThrow(stepFail, 'decide a document, step update failing'); expect(stepFail.raw).not.toContain(MARKER); clean(stepFail, 'decide a document, step update failing');
    const action = row({ actionId: 'act-1', status: 'PENDING_APPROVAL', staffId: 'E2EHR02', toolName: 'create_task', toolArgs: '{}' });
    const approve = runHandler(HANDLER.pending, { ...t, 'talent-flow-pending-actions': [action] }, eventFor({
      method: 'POST', route: '/agent/v1/actions/{id}/approve', path: '/agent/v1/actions/act-1/approve', caller: { kind: 'agent' }, body: { staffId: 'E2EHR01' },
    }), { fail: eventsFail });
    noThrow(approve, 'Talent Flow approve, EventBridge failing');
    expect(approve.status, 'the approval still answers 200').toBe(200);
    expect(approve.calls.some((c) => c.service === 'events'), 'the approval tried to send its event').toBe(true);
    clean(approve, 'Talent Flow approve, EventBridge failing');

    // The post sign-in trigger: every DynamoDB call fails; sign-in still goes through.
    const ev = cognitoEvent(A_EMAIL);
    const post = runHandler(HANDLER.postAuth, t, ev, { fail: fail() });
    noThrow(post, 'cognitoPostAuth (it never throws, so sign-in goes through)');
    clean(post, 'cognitoPostAuth');

    // Each of its error logs: only the Talent Flow users table fails, on both paths that read it.
    const TF_EMAIL = 'tf.only@kestrel-foods.co.za';
    const tfUser = (email: string, id: string) => row({ PK: `USER#${id}`, SK: 'PROFILE', GSI1PK: `EMAIL#${email}`, userId: id, email });
    const tfOnly = runHandler(HANDLER.postAuth, world({ 'talent-flow-users': [tfUser(TF_EMAIL, 'tf-1')] }), cognitoEvent(TF_EMAIL), { fail: fail(undefined, ['talent-flow-users']) });
    noThrow(tfOnly, 'cognitoPostAuth, Talent Flow only, its table failing');
    clean(tfOnly, 'cognitoPostAuth, Talent Flow only');
    expect(dynamoCalls(tfOnly).some((c) => c.table === 'talent-flow-users'), 'the Talent Flow users table was reached').toBe(true);
    const both = runHandler(HANDLER.postAuth, world({ 'talent-flow-users': [tfUser(A_EMAIL, 'tf-2')] }), cognitoEvent(A_EMAIL), { fail: fail(undefined, ['talent-flow-users']) });
    noThrow(both, 'cognitoPostAuth, employee and Talent Flow user, its table failing');
    clean(both, 'cognitoPostAuth, after the stage update');
    expect(plain(both.tables['employees']!.find((r) => r['employee_id']?.['S'] === A))?.['stage'], 'the employee is still bumped').toBe('ACTIVE');

    // The trigger logs no address at all, on any path (the sign-in name is the address in this pool).
    const okRuns = [
      runHandler(HANDLER.postAuth, world(), cognitoEvent(A_EMAIL)),
      runHandler(HANDLER.postAuth, world({ 'talent-flow-users': [tfUser(TF_EMAIL, 'tf-1')] }), cognitoEvent(TF_EMAIL)),
      runHandler(HANDLER.postAuth, world(), cognitoEvent('nobody.here@kestrel-foods.co.za')),
      post, tfOnly, both,
    ];
    for (const r of okRuns) {
      noThrow(r, 'cognitoPostAuth');
      for (const e of [A_EMAIL, TF_EMAIL, 'nobody.here@kestrel-foods.co.za']) expect(logText(r), 'cognitoPostAuth logs no email address').not.toContain(e);
    }
    // In this pool the sign-in name is the address, so the event carries it there too. A repeat sign-in (the usual
    // case), two rows with one address, and a first sign-in all log no address.
    const MIXED_A = 'Naledi.Dlamini@Kestrel-Foods.co.za';
    const asPool = (email: string) => ({ ...(cognitoEvent(email) as Record<string, unknown>), userName: email });
    const poolRuns: Array<[string, Run]> = [
      ['repeat sign-in', runHandler(HANDLER.postAuth, world({ employees: [emp(A, 'Naledi', A_EMAIL, { stage: 'ACTIVE' })] }), asPool(MIXED_A))],
      ['two rows', runHandler(HANDLER.postAuth, world({ employees: [emp(A, 'Naledi', A_EMAIL), emp('EMP-1899', 'Naledi', A_EMAIL)] }), asPool(MIXED_A))],
      ['first sign-in', runHandler(HANDLER.postAuth, world({ employees: [emp(A, 'Naledi', A_EMAIL)] }), asPool(MIXED_A))],
    ];
    for (const [how, r] of poolRuns) {
      noThrow(r, `cognitoPostAuth, ${how}`);
      expect(logText(r), `cognitoPostAuth, ${how}: no address in the logs`).not.toContain(A_EMAIL);
    }
    expect(writes(poolRuns[0]![1]).filter((w) => w.endsWith(' employees')), 'a repeat sign-in writes nothing to employees').toEqual([]);
    // Added 16 Nov (lock check 3): post sign-in: the success line with an employee and a Talent Flow user logs no address.
    {
      const MIXED = 'Naledi.Dlamini@Kestrel-Foods.co.za';
      const tfUser = row({ PK: 'USER#tf-2', SK: 'PROFILE', GSI1PK: `EMAIL#${A_EMAIL}`, userId: 'tf-2', email: A_EMAIL });
      const ev = { ...(cognitoEvent(MIXED) as Record<string, unknown>), userName: MIXED };
      const r = runHandler(HANDLER.postAuth, world({ 'talent-flow-users': [tfUser] }), ev);
      noThrow(r, 'post');
      expect(writes(r).some((w) => w.endsWith(' talent-flow-users')), 'the Talent Flow login was tracked').toBe(true);
      expect(logText(r), 'no address').not.toContain(A_EMAIL);
      expect(logText(r), 'no address').not.toContain(MIXED.toLowerCase());
    }
    // Added 16 Nov (lock check 3): post sign-in: a conditional-check failure logs the name only.
    {
      const f: Failure = { service: 'dynamodb', ops: ['UpdateItem'], tables: ['employees'], name: 'ConditionalCheckFailedException', message: `${MARKER}: ${LEAKED}` };
      const r = runHandler(HANDLER.postAuth, world({ employees: [emp('EMP-1810', 'Thandi', 'thandi.mokoena@example.co.za')] }), cognitoEvent('thandi.mokoena@example.co.za'), { fail: f });
      noThrow(r, 'post');
      expect(dynamoCalls(r).some((c) => c.op === 'UpdateItem'), 'the update was tried').toBe(true);
      expect(logText(r)).not.toContain(MARKER); expect(logText(r)).not.toContain(LEAKED);
    }
    // Added 16 Nov (lock check 3): own list: a KMS failure still answers with the list (id number null), no error text.
    {
      const withId = world({
        'document-verification': [row({ verificationId: `ver_${DOC_A}`, employeeId: A, documentId: DOC_A, documentType: 'BANK_CONFIRMATION', decision: 'MANUAL_REVIEW', status: 'MANUAL_REVIEW', confidence: 72, createdAt: '2026-11-14T08:02:00.000Z', checks: '[]', idNumber_encrypted: encrypted(ID_NUMBER) })],
      });
      const r = call.ownList(withId, HR(), { fail: { service: 'kms', name: 'AccessDeniedException', message: `${MARKER}: ${LEAKED}` } });
      expect(r.status, `${r.raw.slice(0, 200)}`).toBe(200);
      expect(r.raw).not.toContain(ID_NUMBER);
      expect(logText(r)).toMatch(/"errorname":"accessdeniedexception"/);
      expect(logText(r)).not.toContain(MARKER);
    }
    // Added 17 Nov (lock check 4): post sign-in: no address and no error text on any error path, with the sign-in name set to the address.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const IDRIS = 'Idris.Ibrahim@Initech.co.za'; // capital I: the Turkish-locale lower case turns it into a dotless i
    const IDRIS_LOWER = 'idris.ibrahim@initech.co.za';
    const asPool = (email: string) => ({ ...(cognitoEvent(email) as Record<string, unknown>), userName: email });
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
      const tfRow = row({ PK: 'USER#tf-9', SK: 'PROFILE', GSI1PK: `EMAIL#${THANDI_LOWER}`, userId: 'tf-9', email: THANDI_LOWER });
      const withRow = (extra: Partial<Tables> = {}) => world({ employees: [emp('EMP-1810', 'Thandi', THANDI_LOWER)], ...extra });
      const runs: Array<[string, Run]> = [
        ['every call failing', runHandler(HANDLER.postAuth, withRow(), asPool(THANDI), { fail: fail('InternalServerError') })],
        ['the stage update refused by its condition', runHandler(HANDLER.postAuth, withRow(), asPool(THANDI), { fail: fail('ConditionalCheckFailedException', ['employees'], ['UpdateItem']) })],
        ['the stage update failing otherwise', runHandler(HANDLER.postAuth, withRow(), asPool(THANDI), { fail: fail('InternalServerError', ['employees'], ['UpdateItem']) })],
        ['Talent Flow table failing after the bump', runHandler(HANDLER.postAuth, withRow({ 'talent-flow-users': [tfRow] }), asPool(THANDI), { fail: fail('InternalServerError', ['talent-flow-users']) })],
        ['Talent Flow only, its table failing', runHandler(HANDLER.postAuth, world({ 'talent-flow-users': [tfRow] }), asPool(THANDI), { fail: fail('InternalServerError', ['talent-flow-users']) })],
      ];
      for (const [how, r] of runs) {
        noThrow(r, `cognitoPostAuth, ${how}`);
        expect(logText(r), `${how}: no address`).not.toContain(THANDI_LOWER);
        expect(logText(r), `${how}: no error text`).not.toContain(MARKER);
        expect(logText(r), `${how}: no address inside the error text`).not.toContain(LEAKED);
      }
      expect(dynamoCalls(runs[1]![1]).some((c) => c.op === 'UpdateItem' && c.table === 'employees'), 'the conditional update was tried').toBe(true);
      expect(logText(runs[0]![1]), 'the error name is logged').toMatch(/"errorname":"internalservererror"/);
    }
    // Added 17 Nov (lock check 4): refusals and not-found answers on the start, consent and own-list routes log no address.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const IDRIS = 'Idris.Ibrahim@Initech.co.za'; // capital I: the Turkish-locale lower case turns it into a dotless i
    const IDRIS_LOWER = 'idris.ibrahim@initech.co.za';
    const asPool = (email: string) => ({ ...(cognitoEvent(email) as Record<string, unknown>), userName: email });
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
      const t = world();
      const NOBODY = 'Nobody.Here@Kestrel-Foods.co.za';
      const runs: Array<[string, Run, string]> = [
        ['start page, unverified address', call.myStart(t, { ...EMPLOYEE_A(), emailVerified: 'false' }), A_EMAIL],
        ['start page, no record', call.myStart(t, { ...EMPLOYEE_A(), email: NOBODY }), NOBODY.toLowerCase()],
        ['consent, unverified address', call.consent(t, { ...EMPLOYEE_A(), emailVerified: 'false' }), A_EMAIL],
        ['consent, no record', call.consent(t, { ...EMPLOYEE_A(), email: NOBODY }), NOBODY.toLowerCase()],
        ['own list, someone else', call.ownList(t, { ...EMPLOYEE_A(), email: B_EMAIL }), B_EMAIL],
      ];
      for (const [how, r, addr] of runs) {
        noThrow(r, how);
        expect([403, 404], `${how}: refused (${r.status})`).toContain(r.status);
        expect(logText(r), `${how}: no address in the logs`).not.toContain(addr);
      }
    }
    // Added 17 Nov (lock check 5): invite redeem: when setting the password fails the log holds the error name only.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      const hash = createHash('sha256').update(INVITE_TOKEN, 'utf8').digest('hex');
      const t = world({ employee_invites: [row({ token_hash: hash, employee_id: A, created_at: '2026-11-14T08:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z' })] });
      const r = invite.redeem(t);
      noThrow(r, 'redeem');
      expect(r.status, `redeem with Cognito refusing: 502\n${r.raw.slice(0, 300)}`).toBe(502);
      expect(r.body).toEqual({ error: 'Could not set the password. Try again.' });
      expect(r.calls.some((c) => c.service === 'cognito'), 'the Cognito call was tried').toBe(true);
      expect(logText(r), 'the Cognito error text is not logged').not.toContain('harness');
      expect(logText(r), 'no address').not.toContain(A_EMAIL);
      expect(logText(r), 'the error name is logged').toMatch(/setting the password failed/);
      expect(updates(r).some((c) => JSON.stringify((c as any).input).includes('REMOVE used_at')), 'the link is given back').toBe(true);
    }
    // Added 17 Nov (lock check 5): a failed consent write or read is a 500 and stores nothing, not a success.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      const put = call.consent(world(), EMPLOYEE_A(), { fail: fail('InternalServerError', ['employee_consents'], ['PutItem']) });
      noThrow(put, 'recordConsent, the put failing');
      expect(put.status, `the put failing: 500\n${put.raw.slice(0, 300)}`).toBe(500);
      expect(put.body).toEqual({ error: WORDS.somethingWrong });
      expect(put.tables['employee_consents']!.length, 'nothing stored').toBe(0);
      expect(logText(put)).not.toContain(MARKER);
      const get = call.myStart(world({ employee_consents: [consentRow(A)] }), EMPLOYEE_A(), { fail: fail('InternalServerError', ['employee_consents'], ['GetItem']) });
      noThrow(get, 'getMyStart, the consent read failing');
      expect(get.status, `the consent read failing: 500\n${get.raw.slice(0, 300)}`).toBe(500);
      expect(get.body).toEqual({ error: WORDS.somethingWrong });
      expect(logText(get)).not.toContain(MARKER);
    }
    // Added 17 Nov (lock check 5): a decision whose audit event cannot be sent still answers and keeps the decision.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      const t = world();
      const eventsFail: Failure = { service: 'events', name: 'InternalServerError', message: `${MARKER}: ${LEAKED}` };
      const ok1 = call.review(t, HR());
      const r = call.review(t, HR(), { fail: eventsFail });
      noThrow(r, 'decide a document, EventBridge failing');
      expect(r.status, `with EventBridge failing the answer is the one it is with EventBridge working (${ok1.status})\n${r.raw.slice(0, 300)}`).toBe(ok1.status);
      expect(r.calls.some((c) => c.service === 'events'), 'the event was tried').toBe(true);
      const doc = (tt: Tables) => Object.fromEntries(Object.entries(plain(tt['documents']!.find((x) => x['document_id']?.['S'] === DOC_A)) ?? {}).map(([k, v]) => [k, /^\d{4}-\d\d-\d\dT/.test(String(v)) ? 'time' : v]));
      expect(doc(ok1.tables), 'control: the decision changes the document').not.toEqual(doc(t));
      expect(doc(r.tables), 'the decision is stored, as it is with EventBridge working').toEqual(doc(ok1.tables));
    }
    // Added 17 Nov (lock check 5): error paths log no address and no id (caller, queried or employee).
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      const t = world({ employee_consents: [consentRow(A)] });
      const runs: Array<[string, Run, string[]]> = [
        ['start page, DynamoDB failing', call.myStart(t, EMPLOYEE_A(), { fail: fail('InternalServerError') }), [A_EMAIL]],
        ['consent, DynamoDB failing', call.consent(t, EMPLOYEE_A(), { fail: fail('InternalServerError') }), [A_EMAIL]],
        ['email check, DynamoDB failing', call.emailCheck(t, HR(), { fail: fail('InternalServerError') }), ['thandi.mokoena@example.co.za', HR_EMAIL]],
        ['file link, DynamoDB failing', call.fileUrl(t, EMPLOYEE_A(), { fail: fail('InternalServerError') }), [A_EMAIL, HR_EMAIL]],
        ['file link, HR, DynamoDB failing', call.fileUrl(t, HR(), { fail: fail('InternalServerError') }), [A_EMAIL, HR_EMAIL]],
        ['upload link, DynamoDB failing', call.uploadUrl(t, EMPLOYEE_A(), { fail: fail('InternalServerError') }), [A_EMAIL, HR_EMAIL]],
        ['upload link, HR, DynamoDB failing', call.uploadUrl(t, HR(), { fail: fail('InternalServerError') }), [A_EMAIL, HR_EMAIL]],
        ['own list, DynamoDB failing', call.ownList(t, EMPLOYEE_A(), { fail: fail('InternalServerError') }), [A_EMAIL]],
      ];
      for (const [how, r, addrs] of runs) {
        noThrow(r, how);
        expect(r.status, `${how}: 500\n${r.raw.slice(0, 200)}`).toBe(500);
        for (const a of addrs) expect(logText(r), `${how}: no address (${a.slice(0, 6)}…) in the logs`).not.toContain(a.toLowerCase());
        expect(logText(r), `${how}: no error text`).not.toContain(MARKER);
      }
    }
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

    // Two rows hold the same address: the trigger changes neither.
    const t4 = world({ employees: [emp(T, 'Thandi', LOWER), emp('EMP-1811', 'Thandi', LOWER)] });
    const r4 = runHandler(HANDLER.postAuth, t4, cognitoEvent(MIXED));
    noThrow(r4, 'post sign-in, two rows');
    expect(writes(r4).filter((w) => w.endsWith(' employees')), 'two rows with the address: neither is bumped').toEqual([]);
    const t5 = world({ employees: [emp(T, 'Thandi', LOWER), emp('EMP-1811', 'Thandi', MIXED)] });
    const r5 = runHandler(HANDLER.postAuth, t5, cognitoEvent(MIXED));
    noThrow(r5, 'post sign-in, one lower-case row and one stored with capitals');
    expect(writes(r5).filter((w) => w.endsWith(' employees')), 'one row per form of the address: neither is bumped').toEqual([]);
    expect(emailQueries(r5).length, 'at most two email-index queries').toBeLessThanOrEqual(2);

    // The start page finds the row with one lower-case lookup, whatever the case of the signed-in address.
    const mixedCaller: Caller = { kind: 'jwt', email: MIXED, groups: ['employee'], sub: 'sub-thandi', emailVerified: 'true' };
    const s1 = call.myStart(t1, mixedCaller);
    expect(ok(s1, 'start page, address with capitals').firstName, 'the start page is Thandi\'s').toBe('Thandi');
    expect(emailQueries(s1).map((q) => q.input.ExpressionAttributeValues?.[':e']?.S ?? q.input.ExpressionAttributeValues?.[':email']?.S), 'one email-index query, lower case').toEqual([LOWER]);
    // ...and when it finds nothing, still one query (no fall-back to the typed form).
    const s2 = call.myStart(world(), { ...mixedCaller, email: 'Nobody.Here@Example.co.za' });
    noThrow(s2, 'start page, address with capitals, no row');
    expect(s2.status, 'no row: 404').toBe(404);
    expect(emailQueries(s2).length, 'no row: still one email-index query').toBe(1);

    // The one-off script: plan changes nothing; apply lowercases only rows with capitals.
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const rows = [
      emp('EMP-1821', 'One', 'one.person@kestrel-foods.co.za'),
      emp('EMP-1822', 'Two', 'Two.Person@Kestrel-Foods.co.za'),
      emp('EMP-1823', 'Three', 'three.person@kestrel-foods.co.za'),
      emp('EMP-1824', 'Four', 'FOUR.PERSON@KESTREL-FOODS.CO.ZA'),
      emp('EMP-1825', 'Five', 'five.person@kestrel-foods.co.za'),
      emp('EMP-1826', 'Six', 'Six.Person@kestrel-foods.co.za'), // past the first scan page (pages of 4)
      emp('EMP-1827', 'Seven', '   '), // only spaces: left alone, never written as an empty key
    ];
    const tables = world({ employees: rows });
    const emails = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));

    const plan = runScript(SCRIPT, ['--plan'], tables);
    expect(plan.error, `--plan runs\n${plan.error?.stack ?? ''}`).toBeUndefined();
    expect(plan.calls.filter((c) => c.service === 'dynamodb' && !['Scan', 'Query', 'GetItem'].includes(c.op)), '--plan writes nothing').toEqual([]);
    expect(emails(plan.tables), '--plan leaves every email as it was').toEqual(emails(tables));
    expect(plan.out, '--plan prints the count of rows to change (3)').toMatch(/\b3\b/);
    for (const r of rows.filter((x) => x['email']!['S']!.trim())) expect(plan.out, '--plan prints no email address').not.toContain(r['email']!['S']!);

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
    for (const r of rows.filter((x) => x['email']!['S']!.trim())) {
      expect(apply.out, '--apply prints no email address').not.toContain(r['email']!['S']!);
      expect(apply.out, '--apply prints no email address').not.toContain(r['email']!['S']!.toLowerCase());
    }

    // A row changed by someone else between the scan and its update is skipped and counted; the rest go on.
    const CHANGED = 'two.person.new@kestrel-foods.co.za';
    const raced = runScript(SCRIPT, ['--apply'], tables, { changeBeforeUpdate: { table: 'employees', key: { employee_id: 'EMP-1822' }, set: { email: CHANGED } } });
    expect(raced.error, `--apply with a changed row runs to the end\n${raced.error?.stack ?? ''}`).toBeUndefined();
    expect(Number(raced.result?.exitCode ?? 0), '--apply with a changed row exits 0').toBe(0);
    const racedAfter = emails(raced.tables);
    expect(racedAfter['EMP-1822'], 'the changed row keeps what the other writer put there').toBe(CHANGED);
    expect([racedAfter['EMP-1824'], racedAfter['EMP-1826']], 'the other rows with capitals are still lower-cased').toEqual(['four.person@kestrel-foods.co.za', 'six.person@kestrel-foods.co.za']);
    expect(raced.out, 'the skip is counted').toMatch(/skipped[^0-9]*1\b/i);

    // Two rows that would end up with the same address: nothing is written at all.
    const clash = world({ employees: [emp('EMP-1831', 'Dup', 'dup.person@kestrel-foods.co.za'), emp('EMP-1832', 'Dup', 'Dup.Person@kestrel-foods.co.za'), emp('EMP-1833', 'Other', 'Other.Person@kestrel-foods.co.za')] });
    const refusedRun = runScript(SCRIPT, ['--apply'], clash);
    expect(refusedRun.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem'), 'a clash writes nothing').toEqual([]);
    expect(emails(refusedRun.tables), 'every email is as it was').toEqual(emails(clash));
    expect(refusedRun.error !== undefined || Number(refusedRun.result?.exitCode ?? 0) !== 0, 'a clash ends with an error or a non-zero exit code').toBe(true);
    for (const e of ['dup.person@kestrel-foods.co.za', 'Dup.Person@kestrel-foods.co.za', 'Other.Person@kestrel-foods.co.za']) expect(refusedRun.out, 'a clash prints no email address').not.toContain(e);
    // Added 16 Nov (lock check 3): post sign-in: an address with spaces round it is trimmed before the lookup.
    {
      const r = runHandler(HANDLER.postAuth, world({ employees: [emp('EMP-1810', 'Thandi', 'thandi.mokoena@example.co.za')] }), cognitoEvent('  Thandi.Mokoena@Example.co.za '));
      noThrow(r, 'post');
      const q = dynamoCalls(r).filter((c) => c.op === 'Query' && c.table === 'employees');
      expect(q[0]?.input.ExpressionAttributeValues?.[':email']?.S, 'first query is trimmed lower case').toBe('thandi.mokoena@example.co.za');
      expect(plain(r.tables['employees']!.find((x) => x['employee_id']?.['S'] === 'EMP-1810'))?.['stage'], 'bumped').toBe('ACTIVE');
    }
    // Added 16 Nov (lock check 3): script: two rows that end up equal once trimmed are a clash.
    {
      const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
      const clash = world({ employees: [emp('EMP-1831', 'Dup', 'dup.person@kestrel-foods.co.za'), emp('EMP-1832', 'Dup', 'Dup.Person@kestrel-foods.co.za ')] });
      const r = runScript(SCRIPT, ['--apply'], clash);
      expect(r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem'), 'a clash writes nothing').toEqual([]);
      expect(Number(r.result?.exitCode ?? 0), 'non-zero').not.toBe(0);
    }
    // Added 17 Nov (lock check 4): post sign-in: lower case is plain lower case (a capital I stays an i).
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const IDRIS = 'Idris.Ibrahim@Initech.co.za'; // capital I: the Turkish-locale lower case turns it into a dotless i
    const IDRIS_LOWER = 'idris.ibrahim@initech.co.za';
    const asPool = (email: string) => ({ ...(cognitoEvent(email) as Record<string, unknown>), userName: email });
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
      const r = runHandler(HANDLER.postAuth, world({ employees: [emp('EMP-1811', 'Idris', IDRIS_LOWER)] }), cognitoEvent(IDRIS));
      noThrow(r, 'post');
      const q = dynamoCalls(r).filter((c) => c.op === 'Query' && c.table === 'employees');
      expect(q[0]?.input.ExpressionAttributeValues?.[':email']?.S, 'first query is plain lower case').toBe(IDRIS_LOWER);
      expect(plain(r.tables['employees']!.find((x) => x['employee_id']?.['S'] === 'EMP-1811'))?.['stage'], 'bumped').toBe('ACTIVE');
    }
    // Added 17 Nov (lock check 4): start page and consent: the token address is trimmed and lower-cased, plain lower case.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const IDRIS = 'Idris.Ibrahim@Initech.co.za'; // capital I: the Turkish-locale lower case turns it into a dotless i
    const IDRIS_LOWER = 'idris.ibrahim@initech.co.za';
    const asPool = (email: string) => ({ ...(cognitoEvent(email) as Record<string, unknown>), userName: email });
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
      const t = world({ employees: [emp('EMP-1811', 'Idris', IDRIS_LOWER), emp(A, 'Naledi', A_EMAIL)] });
      const who = (email: string): Caller => ({ kind: 'jwt', email, groups: ['employee'], sub: 'sub-x', emailVerified: 'true' });
      const queries = (r: Run) => dynamoCalls(r).filter((c) => c.op === 'Query' && c.table === 'employees').map((c) => c.input.ExpressionAttributeValues?.[':e']?.S);
      const s1 = call.myStart(t, who(IDRIS));
      expect(ok(s1, 'start page, capital I').firstName).toBe('Idris');
      expect(queries(s1), 'one plain lower-case query').toEqual([IDRIS_LOWER]);
      const s2 = call.myStart(t, who(`  ${A_EMAIL.toUpperCase()} `));
      expect(ok(s2, 'start page, spaces round the address').firstName).toBe('Naledi');
      expect(queries(s2), 'one trimmed lower-case query').toEqual([A_EMAIL]);
      const c1 = call.consent(t, who(IDRIS));
      ok(c1, 'consent, capital I', 201);
      expect(queries(c1)).toEqual([IDRIS_LOWER]);
      const c2 = call.consent(t, who(` Naledi.Dlamini@Kestrel-Foods.co.za `));
      ok(c2, 'consent, spaces round the address', 201);
      expect(queries(c2)).toEqual([A_EMAIL]);
    }
    // Added 17 Nov (lock check 4): own list: the owner is found whatever the case and spaces, on either side.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const IDRIS = 'Idris.Ibrahim@Initech.co.za'; // capital I: the Turkish-locale lower case turns it into a dotless i
    const IDRIS_LOWER = 'idris.ibrahim@initech.co.za';
    const asPool = (email: string) => ({ ...(cognitoEvent(email) as Record<string, unknown>), userName: email });
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
      const t = world();
      const r1 = call.ownList(t, { ...EMPLOYEE_A(), email: ` ${A_EMAIL.toUpperCase()} ` });
      ok(r1, 'own list, spaces and capitals in the token address');
      const padded = world({ employees: [emp(A, 'Naledi', ` ${A_EMAIL.toUpperCase()}  `), emp(B, 'Pieter', B_EMAIL)] });
      ok(call.ownList(padded, EMPLOYEE_A()), 'own list, spaces and capitals in the stored address');
      // The other employee still gets nothing.
      expect(call.ownList(padded, { ...EMPLOYEE_A(), email: B_EMAIL }).status, 'someone else: 403').toBe(403);
    }
    // Added 17 Nov (lock check 4): script: the address written is trimmed and plain lower case.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const IDRIS = 'Idris.Ibrahim@Initech.co.za'; // capital I: the Turkish-locale lower case turns it into a dotless i
    const IDRIS_LOWER = 'idris.ibrahim@initech.co.za';
    const asPool = (email: string) => ({ ...(cognitoEvent(email) as Record<string, unknown>), userName: email });
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
      const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
      const rows = [emp('EMP-1841', 'One', `${THANDI} `), emp('EMP-1843', 'Idris', IDRIS), emp('EMP-1844', 'Four', 'four.person@kestrel-foods.co.za')];
      const r = runScript(SCRIPT, ['--apply'], world({ employees: rows }));
      expect(r.error, `${r.error?.stack ?? ''}`).toBeUndefined();
      const after = emailsOf(r.tables);
      expect(after['EMP-1841'], 'capitals and a trailing space: written trimmed and lower case').toBe(THANDI_LOWER);
      expect(after['EMP-1843'], 'capital I: plain lower case').toBe(IDRIS_LOWER);
      expect(after['EMP-1844'], 'a lower-case row is left alone').toBe('four.person@kestrel-foods.co.za');
    }
    // Added 17 Nov (lock check 4): script: a row whose only fault is spaces round the address is trimmed too (judgement call, see the report).
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const IDRIS = 'Idris.Ibrahim@Initech.co.za'; // capital I: the Turkish-locale lower case turns it into a dotless i
    const IDRIS_LOWER = 'idris.ibrahim@initech.co.za';
    const asPool = (email: string) => ({ ...(cognitoEvent(email) as Record<string, unknown>), userName: email });
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
      const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
      const r = runScript(SCRIPT, ['--apply'], world({ employees: [emp('EMP-1845', 'Five', 'five.person@kestrel-foods.co.za ')] }));
      expect(r.error, `${r.error?.stack ?? ''}`).toBeUndefined();
      expect(emailsOf(r.tables)['EMP-1845'], 'the row is trimmed').toBe('five.person@kestrel-foods.co.za');
    }
    // Added 17 Nov (lock check 5): script: two rows that both hold capitals and end up equal are a clash (nothing written).
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      const rows = [emp('EMP-1851', 'Dup', 'Dup.Person@Kestrel-Foods.co.za'), emp('EMP-1852', 'Dup', 'DUP.PERSON@KESTREL-FOODS.CO.ZA')];
      const r = runScript(SCRIPT, ['--apply'], world({ employees: rows }));
      expect(r.error, `${r.error?.stack ?? ''}`).toBeUndefined();
      expect(updates(r), 'a clash of two changed rows writes nothing').toEqual([]);
      expect(Number(r.result?.exitCode ?? 0), 'non-zero exit').not.toBe(0);
      expect(emailsOf(r.tables), 'every email is as it was').toEqual({ 'EMP-1851': 'Dup.Person@Kestrel-Foods.co.za', 'EMP-1852': 'DUP.PERSON@KESTREL-FOODS.CO.ZA' });
    }
    // Added 17 Nov (lock check 5): script: no flag, or an unknown flag, writes nothing (only --apply writes).
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      const rows = [emp('EMP-1853', 'Caps', 'Caps.Person@Kestrel-Foods.co.za')];
      for (const args of [[], ['--dry-run'], ['--apply-later'], ['apply']]) {
        const r = runScript(SCRIPT, args, world({ employees: rows }));
        expect(r.error, `${r.error?.stack ?? ''}`).toBeUndefined();
        expect(updates(r), `args [${args.join(' ')}]: nothing written`).toEqual([]);
        expect(emailsOf(r.tables)['EMP-1853'], `args [${args.join(' ')}]: the row is as it was`).toBe('Caps.Person@Kestrel-Foods.co.za');
        expect(Number(r.result?.exitCode ?? 0), `args [${args.join(' ')}]: non-zero exit`).not.toBe(0);
      }
    }
    // Added 17 Nov (lock check 5): script: --apply changes the email and nothing else on the row.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      const rows = [emp('EMP-1854', 'Caps', 'Caps.Person@Kestrel-Foods.co.za'), emp('EMP-1855', 'Pad', 'pad.person@kestrel-foods.co.za ')];
      const tables = world({ employees: rows });
      const r = runScript(SCRIPT, ['--apply'], tables);
      expect(r.error, `${r.error?.stack ?? ''}`).toBeUndefined();
      expect(updates(r).length, 'both rows were updated').toBe(2);
      const strip = (x: Tables[string][number] | undefined) => { const p = { ...(plain(x) ?? {}) }; delete p['email']; return p; };
      for (const id of ['EMP-1854', 'EMP-1855']) {
        const before = tables['employees']!.find((x) => x['employee_id']?.['S'] === id);
        const after = r.tables['employees']!.find((x) => x['employee_id']?.['S'] === id);
        expect(strip(after), `${id}: every other attribute is as it was`).toEqual(strip(before));
      }
      expect(r.tables['employees']!.length, 'no row added or removed').toBe(tables['employees']!.length);
    }
    // Added 17 Nov (lock check 5): script: any kind of white space round an address is trimmed (a CSV import leaves a carriage return).
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      const rows = [
        emp('EMP-1856', 'Cr', 'cr.person@kestrel-foods.co.za\r'), emp('EMP-1857', 'Tab', '\tTab.Person@kestrel-foods.co.za'),
        emp('EMP-1858', 'Nb', ' nb.person@kestrel-foods.co.za '), emp('EMP-1859', 'Nl', 'nl.person@kestrel-foods.co.za\n'),
      ];
      const r = runScript(SCRIPT, ['--apply'], world({ employees: rows }));
      expect(r.error, `${r.error?.stack ?? ''}`).toBeUndefined();
      const after = emailsOf(r.tables);
      expect([after['EMP-1856'], after['EMP-1857'], after['EMP-1858'], after['EMP-1859']]).toEqual([
        'cr.person@kestrel-foods.co.za', 'tab.person@kestrel-foods.co.za', 'nb.person@kestrel-foods.co.za', 'nl.person@kestrel-foods.co.za',
      ]);
    }
    // Added 17 Nov (lock check 5): own list: a stored address with a carriage return or a tab round it still finds its owner.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      for (const pad of ['\r', '\t', ' ', '\n']) {
        const t = world({ employees: [emp(A, 'Naledi', `${pad}${A_EMAIL}${pad}`), emp(B, 'Pieter', B_EMAIL)] });
        ok(call.ownList(t, EMPLOYEE_A()), `own list, stored address with ${JSON.stringify(pad)} round it`);
        expect(call.ownList(t, { ...EMPLOYEE_A(), email: B_EMAIL }).status, 'someone else: 403').toBe(403);
      }
    }
    // Added 17 Nov (lock check 5): a capital that is not plain ASCII is lower-cased too, by the trigger, the start page and the script.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      const ELODIE = 'Élodie.Dupont@Initech.co.za';
      const ELODIE_LOWER = 'élodie.dupont@initech.co.za';
      const post = runHandler(HANDLER.postAuth, world({ employees: [emp('EMP-1860', 'Elodie', ELODIE_LOWER)] }), cognitoEvent(ELODIE));
      noThrow(post, 'post sign-in');
      const q = dynamoCalls(post).filter((c) => c.op === 'Query' && c.table === 'employees');
      expect(q[0]?.input.ExpressionAttributeValues?.[':email']?.S, 'first query is the lower-case address').toBe(ELODIE_LOWER);
      expect(plain(post.tables['employees']!.find((x) => x['employee_id']?.['S'] === 'EMP-1860'))?.['stage'], 'bumped').toBe('ACTIVE');
      const who: Caller = { kind: 'jwt', email: ELODIE, groups: ['employee'], sub: 'sub-e', emailVerified: 'true' };
      expect(ok(call.myStart(world({ employees: [emp('EMP-1860', 'Elodie', ELODIE_LOWER)] }), who), 'start page').firstName).toBe('Elodie');
      const s = runScript(SCRIPT, ['--apply'], world({ employees: [emp('EMP-1861', 'Elodie', ELODIE)] }));
      expect(s.error, `${s.error?.stack ?? ''}`).toBeUndefined();
      expect(emailsOf(s.tables)['EMP-1861'], 'script writes the lower-case address').toBe(ELODIE_LOWER);
    }
    // Added 17 Nov (lock check 5): post sign-in: a Talent Flow-only user is found whatever the case of the address.
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      const TF = 'Tf.Only@Kestrel-Foods.co.za';
      const tf = row({ PK: 'USER#tf-7', SK: 'PROFILE', GSI1PK: `EMAIL#${TF.toLowerCase()}`, userId: 'tf-7', email: TF.toLowerCase() });
      const r = runHandler(HANDLER.postAuth, world({ 'talent-flow-users': [tf] }), cognitoEvent(TF));
      noThrow(r, 'post sign-in, Talent Flow only');
      expect(writes(r).some((w) => w.endsWith(' talent-flow-users')), 'the Talent Flow login was tracked').toBe(true);
      const tfq = dynamoCalls(r).filter((c) => c.op === 'Query' && c.table === 'talent-flow-users');
      expect(tfq[0]?.input.ExpressionAttributeValues?.[':emailKey']?.S, 'looked up in lower case').toBe(`EMAIL#${TF.toLowerCase()}`);
    }
    // Added 17 Nov (lock check 5): post sign-in: two legacy rows stored exactly as Cognito holds the address are two rows (neither bumped).
    {
    const MARKER = 'be18-marker-7f3a';
    const LEAKED = 'leaked.person@elsewhere.example';
    const THANDI = 'Thandi.Mokoena@Example.co.za';
    const THANDI_LOWER = 'thandi.mokoena@example.co.za';
    const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
    const fail = (name: string, tables?: string[], ops?: string[]): Failure => ({ service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), name, message: `${MARKER}: ${LEAKED}` });
    const emailsOf = (tt: Tables) => Object.fromEntries(tt['employees']!.map((r) => [r['employee_id']!['S'], r['email']!['S']]));
    const gone = (c: Caller): Caller => ({ ...c, email: undefined as unknown as string, sub: 'sub-x' }) as Caller; // a real access token has no email claim at all
    const updates = (r: { calls: Run['calls'] }) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem');
      const t = world({ employees: [emp('EMP-1810', 'Thandi', THANDI), emp('EMP-1811', 'Thandi', THANDI)] });
      const r = runHandler(HANDLER.postAuth, t, cognitoEvent(THANDI));
      noThrow(r, 'post sign-in, two legacy rows');
      expect(writes(r).filter((w) => w.endsWith(' employees')), 'neither row is bumped').toEqual([]);
    }
  });
});
