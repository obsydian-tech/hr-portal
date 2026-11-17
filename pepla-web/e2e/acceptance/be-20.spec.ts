import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { blocks, stripComments, tfFiles } from './support/infra-harness';
import {
  HANDLER, IDEM_COPIES, IDEM_HANDLER, REPO, cognitoEvent, encrypted, eventFor, fnRule, logText, ownerRule, plain, row, runCli, runHandler, runScript, writes,
  type Caller, type Failure, type Run, type Tables,
} from './support/be-20/lambda-harness';

/**
 * BE-20 · Lock in BE-18's 18 leftover checks and the idempotency log rule (Jira NH-212, epic NH-150). Amber.
 * Spec: onboarding-cards/specs/BE-20.md. Written from BE-18's lock check 6 (onboarding-cards/specs/BE-18-lock-check-6.md):
 * its 18 leftover survivors (V1, V6, V10, V11, V12, V14, V15, V17, V18, V27, V28, V30, V32, V33, V37, V39, V41, V43)
 * and its build finding O-1 (the idempotency wrapper logged DynamoDB error text; BE-18 fixed it in 6a189d2).
 * BE-18 already ships all of this, so these tests pass on develop; they guard it from here on.
 *
 * Nothing here opens the app. The tests run the real handlers, scripts and Terraform text, each call in its own
 * Node process, against a fake AWS (support/be-20/fake-aws, copied from BE-18's with code added only). Every AWS
 * call and log line is recorded; Bedrock, Secrets Manager and outbound HTTP are refused. The words, rows and
 * callers below are BE-18's, copied unchanged.
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

// =====================================================================================================

const MARKER = 'be20-marker-7f3a';
const LEAKED = 'leaked.person@elsewhere.example';
const THANDI = 'Thandi.Mokoena@Example.co.za';
const THANDI_LOWER = 'thandi.mokoena@example.co.za';
const SCRIPT = join(REPO, 'scripts', 'onboarding', 'lowercase-emails.mjs');
const CONSENT_FILE = join(REPO, 'lambda', 'shared', 'consent.mjs');
const fail = (name: string, tables?: string[], ops?: string[], skip?: number): Failure => ({
  service: 'dynamodb', ...(ops ? { ops } : {}), ...(tables ? { tables } : {}), ...(skip === undefined ? {} : { skip }), name, message: `${MARKER}: ${LEAKED}`,
});
const checkOf = (t: Tables, caller: Caller, email: string) => runHandler(HANDLER.emailCheck, t, eventFor({
  method: 'GET', route: '/v1/employees/email-check', path: '/v1/employees/email-check', query: { email }, caller,
}));
const IDEM_ENV = { IDEMPOTENCY_TABLE: 'idempotency_keys' };
const IDEM_KEY = 'be20-key-1';
const reviewWithKey = (t: Tables, key: string | undefined, o: { fail?: Failure } = {}) => {
  const ev = eventFor({
    method: 'PATCH', route: '/v1/verifications/{id}/review', path: `/v1/verifications/${DOC_A}/review`, pathParameters: { id: DOC_A }, caller: HR(), body: { decision: 'PASSED' },
  }) as { headers: Record<string, string> };
  if (key) ev.headers['idempotency-key'] = key;
  return runHandler(HANDLER.review, t, ev, { env: IDEM_ENV, ...o });
};
const stubRoute = (copy: string, t: Tables, o: { fail?: Failure } = {}) =>
  runHandler(IDEM_HANDLER, t, { headers: { 'idempotency-key': IDEM_KEY } }, { env: { ...IDEM_ENV, BE20_IDEM_FILE: copy }, ...o });
/** The answer with its *_at times left out (two runs decide at different moments). */
const withoutTimes = (b: unknown) => JSON.parse(JSON.stringify(b), (k, v) => (/_at$/.test(k) ? undefined : v));
const RESERVE = /\[idempotency\] dynamodb reserve failed, proceeding without dedup/;
const CACHE = /\[idempotency\] dynamodb cache write failed/;
function noErrorText(r: Run, how: string) {
  expect(logText(r), `${how}: no error text in the log`).not.toContain(MARKER);
  expect(logText(r), `${how}: no address in the log`).not.toContain(LEAKED);
  expect(r.raw, `${how}: no error text in the answer`).not.toContain(MARKER);
}

test.describe('BE-20 · BE-18 leftovers and the idempotency log rule', () => {
  test('AC-1 Who gets in: only an employee, only an owner with a real address, one record per address, the exact Agent API actor, an exact email_verified (V6 V10 V11 V12 V41 V43 V18)', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);

    // V6: another group is refused by the start page and consent, even with the employee's verified email.
    const t = world();
    ok(call.myStart(t, EMPLOYEE_A()), 'control: the employee is let in');
    for (const who of [{ ...HR(), email: A_EMAIL }, { ...TF_HR(), email: A_EMAIL }, { ...EMPLOYEE_A(), groups: ['employees'] }, { ...EMPLOYEE_A(), groups: ['hr_staff', 'admin'] }] as Caller[]) {
      const g = (who as { groups: string[] }).groups.join('+');
      refused(call.myStart(t, who), `start page, groups ${g}`, WORDS.newEmployeesOnly);
      refused(call.consent(t, who), `consent, groups ${g}`, WORDS.newEmployeesOnly);
    }

    // V10: an empty address owns nothing.
    const claims = (email: unknown) => ({ email, email_verified: 'true', 'cognito:groups': '[employee]', token_use: 'id', sub: 'sub-x' });
    expect(ownerRule([
      { claims: claims(''), employee: { email: '' } },
      { claims: claims(''), employee: {} },
      { claims: claims('   '), employee: { email: '  ' } },
      { claims: claims(undefined), employee: { email: '' } },
      { claims: claims(A_EMAIL), employee: { email: A_EMAIL } },
    ]), 'owner rule: only a real, equal address owns the row').toEqual([false, false, false, false, true]);

    // V11 V12: two rows with one address are no single record.
    const two = world({ employees: [emp(A, 'Naledi', A_EMAIL), emp('EMP-1895', 'Naledi Two', A_EMAIL), emp(B, 'Pieter', B_EMAIL)] });
    for (const [how, r] of [['start page, two rows', call.myStart(two, EMPLOYEE_A())], ['consent, two rows', call.consent(two, EMPLOYEE_A())]] as const) {
      noThrow(r, how);
      expect(r.status, `${how}: 404\n${r.raw.slice(0, 300)}`).toBe(404);
      expect(r.body, `${how}: the not-found words and nothing else`).toEqual({ error: WORDS.notFound });
      expect(r.raw, `${how}: no first name`).not.toContain('Naledi');
      expect(writes(r), `${how}: nothing written`).toEqual([]);
    }

    // V41: only the actor AGENT, exactly, is the Agent API.
    for (const actor of ['agent', 'HUMAN', 'AGENT ', 'SYSTEM']) {
      refused(call.employees(world(), { kind: 'actor', actor } as Caller), `getEmployees, actor "${actor}"`, WORDS.lookUpEmployees);
    }
    const agent = ok(call.employees(world(), { kind: 'actor', actor: 'AGENT' } as Caller), 'control: the Agent API looks up employees') as { items: unknown; count: unknown };
    expect(Array.isArray(agent.items), 'control: the Agent API gets the employee list').toBe(true);
    expect(typeof agent.count, 'control: with its count').toBe('number');

    // V43: email_verified is exact. Only the boolean true and the string "true" count.
    const verified = (v: unknown) => [{ email: A_EMAIL, email_verified: v }];
    expect(fnRule(CONSENT_FILE, 'emailIsVerified', [true, 'true', 'TRUE', 'True', '1', 'yes', 'false', false, 1, null].map(verified).concat([[{ email: A_EMAIL }]])),
      'emailIsVerified: true and "true" only').toEqual([true, true, false, false, false, false, false, false, false, false, false]);

    // V18 (and V43 on the routes): an unverified email is the not-found answer, never the new-employees refusal, and nothing is read.
    for (const flag of ['false', 'False', '', 'no', 'TRUE', 'True', '1', 'yes']) {
      const who = { ...EMPLOYEE_A(), emailVerified: flag } as unknown as Caller;
      for (const [how, r] of [['start page', call.myStart(t, who)], ['consent', call.consent(t, who)]] as const) {
        noThrow(r, how);
        expect(r.status, `${how}, email_verified ${JSON.stringify(flag)}: 404\n${r.raw.slice(0, 300)}`).toBe(404);
        expect(r.body, `${how}, email_verified ${JSON.stringify(flag)}: the not-found words`).toEqual({ error: WORDS.notFound });
        expect(awsOnly(r), `${how}, email_verified ${JSON.stringify(flag)}: nothing is read`).toEqual([]);
      }
    }
  });

  test('AC-2 No address, invite token or error text in logs or printed output, and a request in progress gets 409 (V17 V39 V33 O-1)', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);

    // V17: the link is refused because the sign-in is already in use; the log holds no address.
    const hash = createHash('sha256').update(INVITE_TOKEN, 'utf8').digest('hex');
    const inv = world({ employee_invites: [row({ token_hash: hash, employee_id: A, created_at: '2026-11-14T08:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z' })] });
    const red = runHandler(HANDLER.inviteRedeem, inv, eventFor({
      method: 'POST', route: '/v1/invites/redeem', path: '/v1/invites/redeem', caller: { kind: 'none' }, body: { token: INVITE_TOKEN, password: 'Sunbird-Bakery-2026!' },
    }), { cognito: { adminGetUser: { user: { Enabled: true, UserStatus: 'CONFIRMED' } } } });
    noThrow(red, 'redeem, sign-in in use');
    expect(red.status, `redeem, sign-in in use: 410\n${red.raw.slice(0, 300)}`).toBe(410);
    expect(red.body, 'redeem, sign-in in use: the answer').toEqual({ status: 'used' });
    expect(logText(red), 'redeem: the refusal is logged').toMatch(/invite redeem refused/);
    expect(logText(red), 'redeem: no address in the log').not.toContain(A_EMAIL);
    expect(logText(red), 'redeem: no address in the log (any case)').not.toMatch(/@kestrel-foods/);

    // V39: the invite lookup fails; the log holds no invite token, no error text, no address.
    const look = invite.lookup(world(), { fail: fail('InternalServerError', ['employee_invites']) });
    noThrow(look, 'lookup');
    expect(look.status, 'lookup with DynamoDB failing: 500').toBe(500);
    expect(logText(look), 'lookup: the failure is logged').toMatch(/invite lookup failed/);
    expect(logText(look), 'lookup: no invite token in the log').not.toContain(INVITE_TOKEN.toLowerCase());
    noErrorText(look, 'lookup');

    // V33: the address script run as a program prints the error name only.
    const cli = runCli(SCRIPT, ['--plan'], world(), { fail: fail('ProvisionedThroughputExceededException', ['employees'], ['Scan']) });
    expect(cli.status, 'script as a program: exit code 1').toBe(1);
    expect(cli.stderr, 'script as a program: the error name is printed').toContain('Failed: ProvisionedThroughputExceededException');
    expect(cli.stderr + cli.stdout, 'script as a program: no error text').not.toContain(MARKER);
    expect(cli.stderr + cli.stdout, 'script as a program: no address').not.toContain(LEAKED);

    // O-1 (a): the decide-a-document route with an Idempotency-Key, its idempotency table failing on the reserve, then on the cache write.
    const plainReview = reviewWithKey(world({ idempotency_keys: [] }), undefined);
    noThrow(plainReview, 'review, no key');
    for (const [how, f, warning] of [
      ['review, reserve fails', fail('InternalServerError', ['idempotency_keys'], ['PutItem']), RESERVE],
      ['review, cache write fails', fail('InternalServerError', ['idempotency_keys'], ['PutItem'], 1), CACHE],
    ] as const) {
      const r = reviewWithKey(world({ idempotency_keys: [] }), IDEM_KEY, { fail: f });
      noThrow(r, how);
      expect(r.calls.some((c) => c.service === 'dynamodb' && c.op === 'PutItem' && (c as { table?: string }).table === 'idempotency_keys'), `${how}: the idempotency table was tried`).toBe(true);
      expect(r.status, `${how}: the route answers as it does with no key`).toBe(plainReview.status);
      expect(withoutTimes(r.body), `${how}: the same answer (times aside)`).toEqual(withoutTimes(plainReview.body));
      expect(logText(r), `${how}: the warning is logged`).toMatch(warning);
      expect(logText(r), `${how}: with the error name`).toContain('internalservererror');
      noErrorText(r, how);
    }

    // O-1 (b) and (c): each copy of withIdempotency, through a stub route.
    for (const copy of IDEM_COPIES) {
      const name = copy.slice(REPO.length + 1);
      for (const [how, f, warning] of [
        ['reserve fails', fail('ProvisionedThroughputExceededException', ['idempotency_keys'], ['PutItem']), RESERVE],
        ['cache write fails', fail('ProvisionedThroughputExceededException', ['idempotency_keys'], ['PutItem'], 1), CACHE],
      ] as const) {
        const r = stubRoute(copy, world({ idempotency_keys: [] }), { fail: f });
        noThrow(r, `${name}, ${how}`);
        expect(r.status, `${name}, ${how}: the route still answers`).toBe(200);
        expect(r.body, `${name}, ${how}: its own answer`).toEqual({ ok: true });
        expect(logText(r), `${name}, ${how}: the warning is logged`).toMatch(warning);
        expect(logText(r), `${name}, ${how}: with the error name`).toContain('provisionedthroughputexceededexception');
        noErrorText(r, `${name}, ${how}`);
      }
      const first = stubRoute(copy, world({ idempotency_keys: [] }));
      noThrow(first, `${name}, first call`);
      expect(logText(first), `${name}, first call: the stub runs`).toContain('be20 stub ran');
      const again = stubRoute(copy, first.tables);
      noThrow(again, `${name}, same key again`);
      expect(again.body, `${name}, same key again: the cached answer`).toEqual(first.body);
      expect(logText(again), `${name}, same key again: the stub does not run twice`).not.toContain('be20 stub ran');
      // A request already in progress (its reserve clashes with a live IN_FLIGHT row) gets 409, and the route does not run.
      const busy = stubRoute(copy, world({ idempotency_keys: [row({ idempotencyKey: IDEM_KEY, status: 'IN_FLIGHT', expiresAt: '9999999999' })] }));
      noThrow(busy, `${name}, request in progress`);
      expect(busy.status, `${name}, request in progress: 409`).toBe(409);
      expect(logText(busy), `${name}, request in progress: the route did not run`).not.toContain('be20 stub ran');
    }
  });

  test('AC-3 Neither the consent nor the start-page role gets a KMS right through a policy document, directly or through an aws_iam_policy, and those documents list their actions literally (V1)', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const files = tfFiles();
    const res = blocks(files, 'resource');
    const docs = new Map(blocks(files, 'data').filter((b) => b.labels[0] === 'aws_iam_policy_document').map((b) => [b.labels[1]!, stripComments(b.body)]));
    const managed = new Map(res.filter((b) => b.labels[0] === 'aws_iam_policy').map((b) => [b.labels[1]!, stripComments(b.body)]));
    for (const role of ['record_consent', 'get_my_start']) {
      const bodies = res.filter((x) => new RegExp(`aws_iam_role\\.${role}\\b`).test(stripComments(x.body))).map((b) => stripComments(b.body));
      // Follow an attached aws_iam_policy to the document it is built from.
      for (const b of [...bodies]) for (const m of b.matchAll(/aws_iam_policy\.([A-Za-z0-9_]+)\.arn/g)) bodies.push(managed.get(m[1]!) ?? '');
      for (const b of bodies) {
        for (const m of b.matchAll(/data\.aws_iam_policy_document\.([A-Za-z0-9_]+)\.json/g)) {
          const d = docs.get(m[1]!) ?? '';
          expect(d, `data.aws_iam_policy_document.${m[1]} (reaches ${role}) has no kms: action`).not.toMatch(/["']kms:/);
          // An action list held in a local or variable would hide a kms: action from the check above.
          for (const a of d.matchAll(/\b(not_)?actions\s*=\s*(\S)/g)) expect(a[2], `data.aws_iam_policy_document.${m[1]} (reaches ${role}) lists its actions literally`).toBe('[');
        }
      }
    }
    for (const [name, body] of docs) {
      if (!/["']kms:/.test(body)) continue;
      const users = res.filter((x) => stripComments(x.body).includes(`data.aws_iam_policy_document.${name}.json`) && /aws_iam_role\.(record_consent|get_my_start)\b/.test(stripComments(x.body)));
      expect(users.map((u) => u.labels.join('.')), `the kms: document ${name} is not used by either role`).toEqual([]);
    }
  });

  test('AC-4 The email check answers { inUse } or { error } only, and finds a row by the typed or lower-case form (V14 V15 V27 V28)', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const t = world();
    expect(ok(checkOf(t, HR(), THANDI_LOWER), 'free address'), 'free address: only inUse').toEqual({ inUse: false });
    expect(ok(checkOf(t, HR(), A_EMAIL), 'used address'), 'used address: only inUse').toEqual({ inUse: true });
    const bad = checkOf(t, HR(), 'not-an-address');
    noThrow(bad, 'bad address');
    expect(bad.status, 'bad address: 400').toBe(400);
    expect(bad.body, 'bad address: only the error').toEqual({ error: 'Check the email address' });

    // The check looks up the address as typed and its lower-case form (BE-18 AC-5). A legacy row stored with capitals
    // is found when HR types it the same way; the address script lower-cases the stored rows.
    const legacy = world({ employees: [emp('EMP-1895', 'Thandi', THANDI)] });
    expect(ok(checkOf(legacy, HR(), THANDI), 'stored with capitals, typed with capitals'), 'stored with capitals, typed with capitals: in use').toEqual({ inUse: true });
    const lower = world({ employees: [emp('EMP-1896', 'Thandi', THANDI_LOWER)] });
    expect(ok(checkOf(lower, HR(), THANDI), 'stored in lower case, typed with capitals'), 'stored in lower case, typed with capitals: in use').toEqual({ inUse: true });
    expect(ok(checkOf(lower, HR(), THANDI_LOWER), 'stored in lower case, typed in lower case'), 'stored in lower case, typed in lower case: in use').toEqual({ inUse: true });
  });

  test('AC-5 Data jobs: the stage bump keeps a stage someone else set, and the address script stops on a real write failure (V30 V32)', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const post = runHandler(HANDLER.postAuth, world(), cognitoEvent(A_EMAIL), { changeBeforeUpdate: { table: 'employees', key: { employee_id: A }, set: { stage: 'VERIFIED' } } });
    noThrow(post, 'post sign-in');
    expect(plain(post.tables['employees']!.find((x) => x['employee_id']!['S'] === A))?.['stage'], 'post sign-in: the stage someone else set is kept').toBe('VERIFIED');

    const r = runScript(SCRIPT, ['--apply'], world({ employees: [emp('EMP-1895', 'Thandi', THANDI), emp(A, 'Naledi', A_EMAIL)] }), {
      fail: fail('ProvisionedThroughputExceededException', ['employees'], ['UpdateItem']),
    });
    expect(r.error?.name, 'script: main stops with the DynamoDB error').toBe('ProvisionedThroughputExceededException');
    expect(r.out, 'script: the count line is still printed').toMatch(/Lower-cased: 0\./);
    expect(r.out, 'script: nothing is called skipped').toMatch(/Skipped \(changed since the scan\): 0\./);
    expect(r.out, 'script: no address, no error text').not.toContain(LEAKED);
    expect(r.out, 'script: no error text').not.toContain(MARKER);
  });

  test('AC-6 HR asking the own list for a missing employee gets the words it always has (V37)', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const r = call.ownList(world({ employees: [emp(B, 'Pieter', B_EMAIL)] }), HR());
    noThrow(r, 'own list, HR, no such employee');
    expect(r.status, `own list, HR, no such employee: 404\n${r.raw.slice(0, 300)}`).toBe(404);
    expect(r.body, 'own list, HR, no such employee: the words and nothing else').toEqual({ error: 'Employee not found' });
  });
});
