import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import {
  HANDLER, HR_GROUP_FILE, ID_TOKEN_FILE, OLD_HANDLER, eventFor, fnRule, logText, plain, row, runHandler, writes,
  type Caller, type OldHandlerName, type RawCaller, type Run, type Tables,
} from './support/be-19/lambda-harness';

/**
 * BE-19 · Backend access gap fixes (Jira NH-211, epic NH-150). Red. One test per acceptance criterion,
 * written from the card before any code. Spec: onboarding-cards/specs/BE-19.md.
 *
 * Nothing here opens the app. Every test runs the real handlers, each call in its own Node process, against a
 * fake AWS (support/be-19/fake-aws, copied from BE-18's with code added only). The old admin, IT and
 * provisioning handlers are CommonJS: fake-aws/cjs-hook.cjs sends their require() of the AWS SDK to the same
 * fakes. Every DynamoDB, S3, KMS, EventBridge, CloudWatch, Bedrock, Secrets Manager, Cognito and outbound
 * HTTP call is recorded, and Bedrock, Secrets Manager, Cognito and HTTP calls fail. AC-6 is the existing
 * locked specs and Lambda unit tests: no new test.
 *
 * Nothing calls AWS or any AI service. Locked once accepted: see ./README.md.
 */

const lambdaOnce = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambdas against a fake AWS.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: no screen width.');
};

// ---------------------------------------------------------------- words

const WORDS = {
  // W-1 in the spec: the old app's existing sentence for a 403 from these action routes (flagged for Iggie).
  noPermission: 'You do not have permission to perform this action.',
  selfApproval: 'Self-approval is not permitted', // talentFlowApproveAction, today
  actionNotFound: 'Action not found', // talentFlowApproveAction, today
  ownList: 'Forbidden', // ONB-12
  employeeNotFound: 'Employee not found', // getEmployeeDocumentVerifications, today
} as const;

// ---------------------------------------------------------------- the stored rows

const A = 'EMP-1901';
const B = 'EMP-1902';
const NOBODY = 'EMP-1999';
const A_EMAIL = 'naledi.dlamini@kestrel-foods.co.za';
const B_EMAIL = 'pieter.vanwyk@kestrel-foods.co.za';
const DOC_A = 'doc_1763620000101';
const ACTION = 'act-1901';
const REQUESTER = 'staff-requester';
const APPROVER = 'staff-approver';

const emp = (id: string, first: string, email: string) => row({
  employee_id: id, first_name: first, last_name: 'Test', email, department: 'Finance', job_title: 'Bookkeeper', planned_start_date: '2026-12-01',
  stage: 'INVITED', step: 'DOCUMENTS', created_at: '2026-11-10T08:00:00.000Z', created_by: 'E2EHR01',
});

const doc = (documentId: string, fileName: string | null) => row({
  employee_id: A, document_id: documentId, document_type: 'BANK_CONFIRMATION', ...(fileName === null ? {} : { file_name: fileName }),
  content_type: 'application/pdf', s3_key: `uploads/${A}/BANK_CONFIRMATION/${documentId}_x.pdf`, ocr_status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-14T08:00:00Z',
});

const action = (status = 'PENDING_APPROVAL') => row({
  tenant_id: 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa', actionId: ACTION, toolName: 'schedule_interview', toolArgs: '{"candidateId":"c-42"}', staffId: REQUESTER, status, createdAt: '2026-11-16T10:00:00.000Z',
});

function world(extra: Partial<Tables> = {}): Tables {
  return {
    employees: [emp(A, 'Naledi', A_EMAIL), emp(B, 'Pieter', B_EMAIL)],
    documents: [doc(DOC_A, 'naledi-bank-letter.pdf')],
    'document-verification': [],
    'talent-flow-pending-actions': [action()],
    ...extra,
  };
}

// ---------------------------------------------------------------- callers

const HR_EMAIL = 'pepla-e2e-hr@blackhole.postmarkapp.com';
const hr = (o: { staffId?: string; tokenUse?: string | null; groups?: string[] } = {}): Caller => ({
  kind: 'jwt', email: HR_EMAIL, groups: o.groups ?? ['hr_staff'], emailVerified: 'true',
  ...('staffId' in o ? (o.staffId === undefined ? {} : { staffId: o.staffId }) : { staffId: APPROVER }),
  ...(o.tokenUse === undefined ? {} : { tokenUse: o.tokenUse }),
});
const EMPLOYEE_A: Caller = { kind: 'jwt', email: A_EMAIL, groups: ['employee'], sub: 'sub-naledi', emailVerified: 'true' };

// ---------------------------------------------------------------- shared checks

const awsOnly = (r: Run) => r.calls.filter((c) => c.service !== 'log').map((c) => `${c.service} ${c.op}${'table' in c && c.table ? ' ' + c.table : ''}`);
const events = (r: Run) => r.calls.filter((c) => c.service === 'events') as Array<{ detail: any }>;
const updates = (r: Run) => r.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem') as Array<{ input: any }>;

function noThrow(r: Run, how: string) {
  expect(r.error, `${how}: the handler does not throw\n${r.error?.stack ?? ''}`).toBeUndefined();
}
function answer(r: Run, how: string, status: number, body?: unknown) {
  noThrow(r, how);
  expect(r.status, `${how}: ${status}\n${r.raw.slice(0, 500)}`).toBe(status);
  if (body !== undefined) expect(r.body, `${how}: exactly ${JSON.stringify(body)}`).toEqual(body);
}

/** JavaScript source without comments (line and block), strings left alone. */
function jsCode(file: string): string {
  const src = readFileSync(file, 'utf8');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const two = src.slice(i, i + 2);
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (two === '//') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

// ---------------------------------------------------------------- the routes

const approveEvent = (caller: Caller | RawCaller, verb: 'approve' | 'reject', body: Record<string, unknown> = {}) => eventFor({
  method: 'POST', route: `/agent/v1/actions/{actionId}/${verb}`, path: `/agent/v1/actions/${ACTION}/${verb}`, pathParameters: { actionId: ACTION }, caller, body,
});
const approve = (t: Tables, caller: Caller | RawCaller, body: Record<string, unknown> = {}) => runHandler(HANDLER.pending, t, approveEvent(caller, 'approve', body));
const reject = (t: Tables, caller: Caller | RawCaller, body: Record<string, unknown> = {}) => runHandler(HANDLER.pending, t, approveEvent(caller, 'reject', body));

const fileUrl = (t: Tables, documentId: string, caller: Caller = hr()) => runHandler(HANDLER.fileUrl, t, eventFor({
  method: 'GET', route: '/v1/documents/{id}/url', path: `/v1/documents/${documentId}/url`, pathParameters: { id: documentId }, caller,
}));
const ownList = (t: Tables, id: string, caller: Caller) => runHandler(HANDLER.ownList, t, eventFor({
  method: 'GET', route: '/v1/employees/{id}/verifications', path: `/v1/employees/${id}/verifications`, pathParameters: { id }, caller,
}));

/** Every key of an UpdateItem's ExpressionAttributeValues starts with ":" and is used, as DynamoDB requires. */
function validUpdate(r: Run, how: string) {
  for (const u of updates(r)) {
    const exprs = [u.input.UpdateExpression, u.input.ConditionExpression].filter(Boolean).join(' ');
    for (const k of Object.keys(u.input.ExpressionAttributeValues ?? {})) {
      expect(k, `${how}: ExpressionAttributeValues key "${k}" starts with ":" (DynamoDB refuses anything else)`).toMatch(/^:/);
      expect(exprs, `${how}: ExpressionAttributeValues key "${k}" is used in the expressions (DynamoDB refuses unused values)`).toContain(k);
    }
  }
}
const storedAction = (r: Run) => plain(r.tables['talent-flow-pending-actions']?.find((x) => x['actionId']?.['S'] === ACTION));

// =====================================================================================================

test.describe('BE-19 · backend access gap fixes', () => {
  test('AC-1 The approver comes from the ID token, never the body', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);

    // An HR ID token approves; the body names the requester, and is ignored.
    const ok = approve(world(), hr(), { staffId: REQUESTER });
    answer(ok, 'approve, HR ID token staff-approver, body staffId staff-requester', 200);
    validUpdate(ok, 'approve');
    expect(storedAction(ok)?.['status'], 'approve: the action is APPROVED').toBe('APPROVED');
    expect(storedAction(ok)?.['approvedBy'], 'approve: approvedBy stored is the token\'s staff id').toBe(APPROVER);
    expect(events(ok).map((e) => e.detail.approvedBy), 'approve: one ActionApproved event, approvedBy from the token').toEqual([APPROVER]);
    const approvedLog = ok.calls.filter((c) => c.service === 'log' && /action_approved/.test(c.message)).map((c) => JSON.parse((c as { message: string }).message));
    expect(approvedLog.map((l) => l.approvedBy), 'approve: the action_approved log names the token\'s staff id').toEqual([APPROVER]);

    // Naleko's Talent Flow HR group approves like hr_staff.
    const tfHr = approve(world(), hr({ groups: ['naleko-talentflow-hr'] }), { staffId: REQUESTER });
    answer(tfHr, 'approve, naleko-talentflow-hr ID token', 200);
    expect(storedAction(tfHr)?.['approvedBy'], 'approve, naleko-talentflow-hr: approvedBy from the token').toBe(APPROVER);

    // Self-approval is judged on the token, whatever the body says.
    const self = approve(world(), hr({ staffId: REQUESTER }), { staffId: APPROVER });
    answer(self, 'approve, HR ID token staff-requester, body staffId staff-approver', 403, { error: WORDS.selfApproval });
    expect(writes(self), 'self-approval: nothing written').toEqual([]);
    expect(events(self), 'self-approval: no event').toEqual([]);

    // Everyone without an HR ID token that names a staff id is refused, whatever the body or a Lambda authorizer says.
    const refusedCallers: Array<[string, Caller | RawCaller]> = [
      ['the agent key only, body staffId staff-approver', { kind: 'agent' }],
      ['a Lambda authorizer naming staff-approver, no JWT', { kind: 'lambdaStaff', staffId: APPROVER }],
      ['an ID token not in an HR group', { kind: 'jwt', email: A_EMAIL, groups: ['employee'], staffId: APPROVER, emailVerified: 'true' }],
      ['an HR access token', hr({ tokenUse: 'access' })],
      ['an HR token with token_use "ID"', hr({ tokenUse: 'ID' })],
      ['an HR ID token with no custom:staff_id', hr({ staffId: undefined })],
      ['an HR ID token with an empty custom:staff_id', hr({ staffId: '' })],
      // Near-miss groups: only hr_staff and naleko-talentflow-hr, exactly as written, are HR.
      ['an ID token in naleko-talentflow-admin', hr({ groups: ['naleko-talentflow-admin'] })],
      ['an ID token in hr_staff_readonly', hr({ groups: ['hr_staff_readonly'] })],
      ['an ID token in HR_STAFF', hr({ groups: ['HR_STAFF'] })],
      ['an ID token in TalentFlowAdmin', hr({ groups: ['TalentFlowAdmin'] })],
      ['no authorizer at all', { kind: 'none' }],
    ];
    for (const [who, caller] of refusedCallers) {
      for (const [verb, run] of [['approve', approve], ['reject', reject]] as const) {
        const r = run(world(), caller, { staffId: APPROVER, reason: 'Not needed' });
        const how = `${verb}, ${who}`;
        answer(r, how, 403, { error: WORDS.noPermission });
        expect(writes(r), `${how}: nothing written`).toEqual([]);
        expect(events(r), `${how}: no event`).toEqual([]);
        expect(storedAction(r)?.['status'], `${how}: still pending`).toBe('PENDING_APPROVAL');
      }
    }

    // Reject keeps the rejecter from the token.
    const rej = reject(world(), hr(), { staffId: REQUESTER, reason: 'Not needed' });
    answer(rej, 'reject, HR ID token staff-approver, body staffId staff-requester', 200);
    validUpdate(rej, 'reject');
    expect(storedAction(rej)?.['status'], 'reject: the action is REJECTED').toBe('REJECTED');
    expect(storedAction(rej)?.['rejectedBy'], 'reject: rejectedBy stored is the token\'s staff id').toBe(APPROVER);
    expect(events(rej), 'reject: no event').toEqual([]);
    const rejectedLog = rej.calls.filter((c) => c.service === 'log' && /action_rejected/.test(c.message)).map((c) => JSON.parse((c as { message: string }).message));
    expect(rejectedLog.map((l) => l.rejectedBy), 'reject: the action_rejected log names the token\'s staff id').toEqual([APPROVER]);

    // What stays as it is: one action by id, the pending list, 404 and 409.
    const getOne = runHandler(HANDLER.pending, world(), eventFor({
      method: 'GET', route: '/agent/v1/actions/{actionId}', path: `/agent/v1/actions/${ACTION}`, pathParameters: { actionId: ACTION }, caller: { kind: 'agent' },
    }));
    answer(getOne, 'GET one action, agent key', 200);
    expect(getOne.body?.actionId, 'GET one action: that action').toBe(ACTION);
    const pending = runHandler(HANDLER.pending, world(), eventFor({ method: 'GET', route: '/agent/v1/actions/pending', path: '/agent/v1/actions/pending', caller: hr() }));
    answer(pending, 'pending list, HR ID token', 200);
    expect(pending.body?.count, 'pending list: the one pending action').toBe(1);
    const missing = approve(world({ 'talent-flow-pending-actions': [] }), hr());
    answer(missing, 'approve, HR, no such action', 404, { error: WORDS.actionNotFound });
    const done = approve(world({ 'talent-flow-pending-actions': [action('APPROVED')] }), hr());
    answer(done, 'approve, HR, already approved', 409);
    expect(writes(done), 'approve, already approved: nothing written').toEqual([]);
  });

  test('AC-2 The file link sends a safe Content-Disposition', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const LONE = '\uD800';
    const names: Array<[string, string | null, string]> = [
      // [label, stored name, the name the header must give back]
      ['plain', 'naledi-bank-letter.pdf', 'naledi-bank-letter.pdf'],
      ['a quote', 'a"b.pdf', 'a"b.pdf'],
      ['a second filename', 'x.pdf"; filename="evil.html', 'x.pdf"; filename="evil.html'],
      ['CR and LF', 'line\r\nSet-Cookie: x=1.pdf', 'line\r\nSet-Cookie: x=1.pdf'],
      ['a backslash', 'back\\slash.pdf', 'back\\slash.pdf'],
      ['accents and a space', 'Résumé Naledi.pdf', 'Résumé Naledi.pdf'],
      ['an en dash', 'Ndlovu – ID.pdf', 'Ndlovu – ID.pdf'],
      ['an apostrophe and brackets', "O'Brien (copy)*.pdf", "O'Brien (copy)*.pdf"],
      ['a TAB', 'tab\there.pdf', 'tab\there.pdf'],
      ['a DEL', 'del\x7Fhere.pdf', 'del\x7Fhere.pdf'],
      ['a lone surrogate', `bad${LONE}name.pdf`, 'document'],
      ['empty', '', 'document'],
    ];
    const tables = world({ documents: names.map(([, name], i) => doc(`doc_17636200002${String(i).padStart(2, '0')}`, name)) });
    const SHAPE = /^inline; filename="([\x20\x21\x23-\x5B\x5D-\x7E]*)"; filename\*=UTF-8''([A-Za-z0-9!#$&+.^_`|~%-]*)$/;
    names.forEach(([label, stored, expected], i) => {
      const how = `file link, ${label}`;
      const r = fileUrl(tables, `doc_17636200002${String(i).padStart(2, '0')}`);
      answer(r, how, 200);
      expect(r.body?.file_name, `${how}: file_name in the answer is the stored name, as today`).toBe(stored === '' ? 'document' : stored);
      expect(r.body?.content_type, `${how}: content_type as today`).toBe(/\.pdf$/i.test(stored ?? '') ? 'application/pdf' : 'application/octet-stream');
      const presign = r.calls.find((c) => c.service === 's3' && /GetObject/.test(c.op)) as { disposition?: string } | undefined;
      const disposition = String(presign?.disposition ?? '');
      expect(disposition, `${how}: no CR or LF anywhere`).not.toMatch(/[\r\n]/);
      const m = SHAPE.exec(disposition);
      expect(m, `${how}: inline; filename="<printable ASCII, no quote or backslash>"; filename*=UTF-8''<encoded>, got ${JSON.stringify(disposition)}`).not.toBeNull();
      const ascii = [...expected].map((ch) => (/^[\x20-\x7E]$/.test(ch) && ch !== '"' && ch !== '\\' ? ch : '_')).join('');
      expect(m?.[1], `${how}: the quoted name is the name with anything else turned into _`).toBe(ascii);
      let decoded = '';
      try { decoded = decodeURIComponent(m?.[2] ?? ''); } catch { decoded = '<does not decode>'; }
      expect(decoded, `${how}: filename* gives back the name`).toBe(expected);
    });
    const plainRun = fileUrl(tables, 'doc_1763620000200');
    const plainDisposition = (plainRun.calls.find((c) => c.service === 's3') as { disposition?: string } | undefined)?.disposition;
    expect(plainDisposition, 'file link, plain name: exactly this header').toBe(`inline; filename="naledi-bank-letter.pdf"; filename*=UTF-8''naledi-bank-letter.pdf`);
  });

  test('AC-3 No file name or S3 key in the upload logs', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const MARKER = 'zq19marker';
    const fileName = `Naledi-Dlamini-ID-${MARKER}.pdf`;
    const up = runHandler(HANDLER.uploadUrl, world(), eventFor({
      method: 'POST', route: '/v1/employees/{employee_id}/documents/upload-url', path: `/v1/employees/${A}/documents/upload-url`,
      pathParameters: { employee_id: A }, caller: hr(), body: { documentType: 'ID_DOCUMENT', fileName, contentType: 'application/pdf' },
    }));
    answer(up, 'upload link, HR, a file name with a marker', 200);
    const s3Key = String(up.body?.s3_key ?? '');
    expect(s3Key, 'upload: s3_key is still in the answer, as today').toContain(fileName);
    const logs = logText(up);
    expect(logs, 'upload: no log line holds the file name').not.toContain(MARKER);
    expect(logs, 'upload: no log line holds the S3 key').not.toContain(s3Key.toLowerCase());
    const created = up.calls.filter((c) => c.service === 'log' && /document record created/i.test(c.message));
    expect(created.length, 'upload: one "Document record created" line').toBe(1);
    expect(JSON.stringify(created[0]), 'upload: "Document record created" carries the document id').toContain(String(up.body?.document_id));

    // The file link for that document logs no file name either.
    const link = fileUrl(up.tables, String(up.body?.document_id));
    answer(link, 'file link for the uploaded document', 200);
    expect(logText(link), 'file link: no log line holds the file name').not.toContain(MARKER);
  });

  test('AC-4 The old admin, IT and provisioning routes take ID tokens only', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);

    // The shared CommonJS rule gives the same answers as BE-18's.
    const cases = [[{}], [{ token_use: 'id' }], [{ token_use: 'access' }], [{ token_use: '' }], [{ token_use: 'ID' }], [{ token_use: 'refresh' }], [{ token_use: 'id ' }], [{ token_use: 'Id' }], [{ token_use: null }], [{ token_use: 0 }]];
    const want = [true, true, false, false, false, false, false, false, false, false];
    expect(fnRule(HR_GROUP_FILE, 'isIdToken', cases), 'hr-group.mjs isIdToken (BE-18)').toEqual(want);
    let cjs: unknown[] = [];
    try { cjs = fnRule(ID_TOKEN_FILE, 'isIdToken', cases); } catch (e) { cjs = [`lambda/shared/id-token.js could not be loaded: ${String(e).slice(0, 300)}`]; }
    expect(cjs, 'lambda/shared/id-token.js isIdToken: same answers').toEqual(want);

    // Claims that pass every one of these handlers today.
    const strong = (tokenUse: string | null): Record<string, unknown> => ({
      sub: 'sub-it-admin-1901', email: 'it.admin@kestrel-foods.co.za', email_verified: 'true',
      'cognito:groups': '[TalentFlowAdmin ITAdmin ITSpecialist HiringManager naleko-talentflow-admin hr_staff]',
      'custom:isAdmin': 'true', 'custom:roles': '["ADMIN"]', 'custom:staff_id': 'IT-1901',
      ...(tokenUse === null ? {} : { token_use: tokenUse }),
    });
    const methodsFor = (name: OldHandlerName): Array<'GET' | 'POST' | 'PUT'> => (name === 'manageTalentFlowConfig' ? ['GET', 'POST', 'PUT'] : ['GET']);
    const run = (name: OldHandlerName, method: 'GET' | 'POST' | 'PUT', tokenUse: string | null) => runHandler(OLD_HANDLER[name].file, {}, eventFor({
      method, route: `/${name}`, path: `/${name}`, caller: { kind: 'claims', claims: strong(tokenUse) },
      pathParameters: { taskId: 'task-1901', bundleId: 'bundle-1901', userId: 'user-1901', id: 'x-1901' },
      query: { configType: 'scoring', tenantId: 'DEFAULT' },
      body: { configType: 'scoring', data: {}, name: 'BE-19', employeeId: A },
    }));

    for (const name of Object.keys(OLD_HANDLER) as OldHandlerName[]) {
      const { status, body, file } = OLD_HANDLER[name];
      const code = jsCode(file);
      expect(code, `${name}: requires ../shared/id-token`).toMatch(/require\(\s*['"]\.\.\/shared\/id-token(\.js)?['"]\s*\)/);
      for (const method of methodsFor(name)) {
        for (const t of ['access', '', 'ID']) {
          const how = `${name} ${method}, token_use "${t}"`;
          const r = run(name, method, t);
          answer(r, how, status, body);
          expect(awsOnly(r), `${how}: refused before any AWS call`).toEqual([]);
        }
        for (const t of ['id', null]) {
          const how = `${name} ${method}, ${t === null ? 'no token_use' : 'token_use "id"'}`;
          const r = run(name, method, t);
          const sameAsRefusal = r.status === status && JSON.stringify(r.body) === JSON.stringify(body);
          expect(!sameAsRefusal || awsOnly(r).length > 0, `${how}: gets past the token check (an AWS call, or another answer than the refusal)\n${r.raw.slice(0, 300)}`).toBe(true);
          expect(awsOnly(r).length > 0 || (r.status !== 401 && r.status !== 403), `${how}: not refused with a 401 or 403 before any AWS call\n${r.raw.slice(0, 300)}`).toBe(true);
        }
      }
    }
  });

  test('AC-5 The own list does not tell an employee whether a record exists', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const t = world();
    const nobody = ownList(t, NOBODY, EMPLOYEE_A);
    answer(nobody, 'own list, employee A, an id with no record', 403, { error: WORDS.ownList });
    expect(awsOnly(nobody).filter((c) => !/^dynamodb (GetItem|Query) employees$/.test(c)), 'own list, missing id: nothing but the read of the employee row').toEqual([]);
    const other = ownList(t, B, EMPLOYEE_A);
    answer(other, 'own list, employee A, record B', 403, { error: WORDS.ownList });
    expect(nobody.raw, 'own list: a missing id and someone else\'s record get the same answer').toBe(other.raw);
    expect(nobody.status, 'own list: the same status for both').toBe(other.status);

    const hrMissing = ownList(t, NOBODY, hr());
    answer(hrMissing, 'own list, HR, an id with no record', 404, { error: WORDS.employeeNotFound });
    // An HR access token is not HR (ID tokens only, BE-18), so it gets the employee answer.
    const hrAccess = ownList(t, NOBODY, hr({ tokenUse: 'access' }));
    answer(hrAccess, 'own list, HR access token, an id with no record', 403, { error: WORDS.ownList });
    const own = ownList(t, A, EMPLOYEE_A);
    answer(own, 'own list, employee A, record A', 200);
    expect(own.raw, 'own list, employee A: A\'s list').toContain(DOC_A);
    const hrB = ownList(t, B, hr());
    answer(hrB, 'own list, HR, record B', 200);
  });
});
