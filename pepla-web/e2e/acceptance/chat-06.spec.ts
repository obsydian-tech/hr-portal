import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { DocumentsFake } from './support/documents-fake';
import { EmployeesFake } from './support/employees-fake';
import { ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { grants, lambdaNamed, list, roleOf, settingsOf } from './support/ten-01/tf';
import { Chat06Fake, type Proposal } from './support/chat-06/chat-fake';
import {
  A, AUDIT, B, CHATS, CHAT_AUDIT, CREATE_NAME, EMPLOYEES, HR, LAMBDA, PENDING, REPO, ROUTE,
  acceptRow, ask, av, call, callTogether, decide, describe, draftTool, employeeRow, eventOf, exists, invokesOf, listActions, logLines, mailsOf,
  modelCalls, nameOf, openChat, pendingRow, pendingRows, plain, proposalRow, publishedOf, readAction, readsOf, rowsOf, sfnCalls, tables, withRows,
  writesOf, writesTo, type Out, type Row, type Tables,
} from './support/chat-06/harness';

/**
 * CHAT-06 · Proposal cards: Batsi suggests registering a new employee, and only the person who asked approves, edits or declines (red).
 * One test (or a few) per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/ask-batsi-chat/CHAT-06-proposal-cards.md (19 Nov 2026), decisions in /mnt/project-files/ask-batsi-chat/DECISIONS.md
 * (19 Nov 14:30 rows). Card notes, what is pinned beyond the text, and the locked tests a correct build moves: cards/chat-06.md.
 *
 * The Lambda tests run the real Lambdas (nalekoAiChat, approveAgentAction, askBatsiChats) in a fresh Node process each, against a fake AWS
 * (support/chat-06/fake-aws). Approving invokes the REAL createEmployee in the same fake world, with the fake Cognito, Step Functions and
 * Postmark, so the employee row, the invite and the welcome email are the register page's own. The model answers only from a script the test
 * wrote and records every prompt; Bedrock, Textract and every AI host are refused, so nothing here reaches a paid AI service.
 * The Lambda and text tests run once (desktop-1280). The screen tests (AC-12, AC-13) run at 1280 and 390 with a fake Agent API in the browser.
 */

// ================================================================ words (spec "Words")

const W = {
  question: (first: string, last: string) => `Register ${first} ${last}?`, // C6-1
  declinedBy: (name: string) => `Declined by ${name}.`, // C6-2
  unknown: (first: string, last: string) => `This may not have finished. Look for ${first} ${last} in People before you register them again.`, // C6-3
  failed: 'It did not go through. Nothing was changed.',
  approvedBy: (name: string) => `Approved by ${name}.`,
  approvedWithChanges: (name: string) => `Approved with changes by ${name}.`,
  suggested: 'Suggested by Batsi',
  waiting: 'Waiting for you',
  declined: 'Declined',
  approved: 'Approved',
  didNotGoThrough: 'Did not go through',
  nothingDone: 'Batsi did nothing.',
  why: 'Why are you declining?',
  kept: 'It is kept with the decision.',
  learns: 'Batsi uses this to suggest better next time.',
  declineProposal: 'Decline proposal',
  back: 'Back',
  viewEmployee: 'View employee',
  audit: 'View in audit trail',
  added: (name: string) => `${name} has been added.`,
  sent: (email: string) => `A welcome email was sent to ${email}.`,
  notSent: (first: string) => `The welcome email was not sent. ${first} can still be sent a new one later.`,
  required: 'This is required',
  checkFields: 'Check the highlighted fields',
  onlyHr: 'Only HR can answer a proposal',
  p09: 'I could not answer that. Try again in a few minutes.',
  labels: ['First name', 'Last name', 'Email address', 'Phone number', 'Department', 'Job title'],
  oldFixedText: 'Please review the employee details above and confirm to proceed with onboarding.',
};
const SIX = ['first_name', 'last_name', 'email', 'phone', 'department', 'job_title'];

// ================================================================ shared helpers

const lambdaOnly = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};

let numberRule: ((text: string) => boolean) | undefined;
/** The shared rule (lambda/shared/pii-redact.mjs) for "this text still holds a run of six or more digits". */
async function hasNumberRun(text: string): Promise<boolean> {
  numberRule ??= (await import(pathToFileURL(join(LAMBDA, 'shared', 'pii-redact.mjs')).href)).hasNumberRun;
  return numberRule!(text);
}
/**
 * A stored thing as text with its clock values and ids taken out first: ISO dates and times ("2026-11-19T10:12:00.000Z"), epoch numbers
 * under a time key (expiresAt, ttl, timestamp...) and UUIDs (a random UUID can start with six digits). They are not personal numbers.
 */
function withoutTimes(thing: unknown): string {
  return JSON.stringify(thing)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\d{4}-\d\d-\d\d(T\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)?)?/g, '<time>')
    .replace(/"(expiresAt|expires_at|ttl|timestamp|createdAt|updatedAt|at|latency_ms|latencyMs|[a-z_]*_ms|[a-z_]*tokens?[a-z_]*|N)":\s*"?\d+(\.\d+)?"?/gi, '"$1":0');
}
const text = (rel: string) => readFileSync(join(REPO, rel), 'utf8');
const sha256 = (rel: string) => createHash('sha256').update(readFileSync(join(REPO, rel))).digest('hex');
const sorted = (a: string[]) => [...a].sort();
const NOW_S = () => Math.floor(Date.now() / 1000);
const isIso = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d\d-\d\dT/.test(v);
/** Words that must never reach an answer, a row or a log line (the fakes put them in exceptions). */
const SECRET = /secret detail|999988887777|Task timed out|forced answer|boom|disk on fire/i;

const KAGISO = { firstName: 'Kagiso', lastName: 'Molefe', email: 'kagiso.molefe@mail-a.example', department: 'Finance', role: 'Payroll Clerk', phoneNumber: '082 555 0199' };
const ASKED = 'Please register Kagiso Molefe as a Payroll Clerk in Finance. His email is kagiso.molefe@mail-a.example and his phone is 082 555 0199.';
const DRAFT_TEXT = 'Email address: kagiso.molefe@mail-a.example\nDepartment: Finance\nJob title: Payroll Clerk';
const DETAILS = { first_name: 'Kagiso', last_name: 'Molefe', email: 'kagiso.molefe@mail-a.example', phone: '082 555 0199', department: 'Finance', job_title: 'Payroll Clerk' };
const ID = 'act-chatsix-first';
const withProposal = (over: Parameters<typeof proposalRow>[0] = { id: ID }, base = tables()) => withRows(base, PENDING, [proposalRow(over)]);
/** The six details as stored on the row (empty ones may be left out). */
const detailsOf = (r: Record<string, any> | undefined) => (r?.['toolArgs'] ?? {}) as Record<string, string>;
const blank = (v: unknown) => v === undefined || v === null || v === '';

/** Nothing happened: no invoke, no write anywhere, no event, no email, no read of the employees table. */
function nothingRan(o: Out, label: string) {
  expect.soft(invokesOf(o.run).map((c) => c.functionName), `${label}: nothing invoked`).toEqual([]);
  expect.soft(writesOf(o.run), `${label}: nothing written`).toEqual([]);
  expect.soft(publishedOf(o.run).map((c) => c.detailType), `${label}: nothing published`).toEqual([]);
  expect.soft(mailsOf(o.run).length, `${label}: no email`).toBe(0);
  expect.soft(readsOf(o.run, EMPLOYEES).length, `${label}: the employees table was not read`).toBe(0);
}

// ================================================================ fixtures (the screen tests use the fakes; Lambda tests ignore them)

type Fixtures = { chat: Chat06Fake | null; docs: DocumentsFake | null; list: EmployeesFake | null };
const test = base.extend<Fixtures>({
  chat: [
    async ({ context, baseURL }, use) => {
      if (ON_DEV) return use(null);
      const fake = new Chat06Fake(new URL(baseURL!).origin);
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
  docs: [
    async ({ context, baseURL }, use) => {
      if (ON_DEV) return use(null);
      const fake = new DocumentsFake(new URL(baseURL!).origin);
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
  list: [
    async ({ context, baseURL }, use) => {
      if (ON_DEV) return use(null);
      const fake = new EmployeesFake(new URL(baseURL!).origin);
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
});

// ================================================================ the Lambdas

test.describe('CHAT-06 · the proposal row, who answers it, and what each answer does (Lambda)', () => {
  test.beforeEach(({}, testInfo) => lambdaOnly(testInfo.project.name));

  // ---------------------------------------------------------------- AC-1

  test('AC-1 Batsi\'s draft becomes one waiting proposal for the person who asked, and nothing else happens', async () => {
    test.setTimeout(240_000);
    const q = ask('hrA', ASKED, draftTool(KAGISO));
    expect(q.status, `the answer is 200 (${describe(q)})`).toBe(200);
    expect(q.json?.message, 'Batsi\'s question is the message (C6-1), not the old fixed text').toBe(W.question('Kagiso', 'Molefe'));
    const props = q.json?.proposals as any[];
    expect(Array.isArray(props) && props.length, 'one proposal in the answer').toBe(1);
    const p = props[0];
    expect.soft(p.type, 'its type').toBe('CREATE_EMPLOYEE');
    expect.soft(p.title, 'its title is the same sentence').toBe(W.question('Kagiso', 'Molefe'));
    expect.soft(p.canApprove, 'the asker may approve it').toBe(true);
    expect.soft(p.draft, 'the quote: email address, department and job title, one per line, and no phone').toBe(DRAFT_TEXT);
    expect.soft(p.fields, 'the six details for Edit').toEqual(DETAILS);

    const rows = pendingRows(q.run.tables);
    expect(rows.length, 'exactly one row in naleko-pending-actions').toBe(1);
    const r = rows[0]!;
    expect.soft(r['actionId'], 'the row is the proposal in the answer').toBe(p.actionId);
    expect.soft([r['type'], r['toolName'], r['status']], 'type, tool and status').toEqual(['CREATE_EMPLOYEE', 'onboard_new_employee', 'PENDING_APPROVAL']);
    expect.soft([r['proposed_by_kind'], r['proposed_by_id']], 'made by Batsi').toEqual(['BATSI', 'nalekoAiChat']);
    expect.soft([r['requested_by'], r['requested_by_name']], 'for the person who asked (staff id and name from the sign-in)').toEqual([HR.a.staff, nameOf(HR.a)]);
    expect.soft(r['tenant_id'], 'in the asker\'s company').toBe(A);
    expect.soft(r['employee_name'], 'named').toBe('Kagiso Molefe');
    expect.soft(r['chat_id'], 'and tied to the chat it came from').toBe(q.json?.chatId);
    expect.soft(detailsOf(r), 'the details are the six, as drafted').toEqual(DETAILS);
    expect.soft(isIso(r['createdAt']), 'createdAt is an ISO time').toBe(true);
    expect.soft(Math.abs(Number(r['expiresAt']) - (NOW_S() + 7 * 24 * 3600)) < 300, `it expires in 7 days, in epoch seconds (${r['expiresAt']})`).toBe(true);
    const put = writesTo(q.run, PENDING);
    expect.soft(put.map((c) => c.op), 'one write: a PutItem').toEqual(['PutItem']);
    expect.soft(String(put[0]?.input?.ConditionExpression ?? ''), 'that never overwrites a row').toMatch(/attribute_not_exists\(\s*#?actionId\s*\)/);

    // The chat keeps the proposal's id with Batsi's answer (CHAT-02's proposalIds).
    const msgs = rowsOf(q.run.tables, CHATS).filter((m) => String(m['sk']).startsWith('MSG#')).sort((x, y) => String(x['sk']).localeCompare(String(y['sk'])));
    const batsi = msgs.filter((m) => m['role'] === 'batsi').pop();
    expect.soft(batsi?.['text'], 'the stored answer is Batsi\'s question').toBe(W.question('Kagiso', 'Molefe'));
    expect.soft(batsi?.['proposal_ids'], 'and holds the proposal\'s id').toEqual([p.actionId]);

    // Nothing else happened: no employee, invite, email, onboarding flow or decision.
    expect.soft(rowsOf(q.run.tables, EMPLOYEES), 'no employee').toEqual([]);
    expect.soft(rowsOf(q.run.tables, 'employee_invites'), 'no invite').toEqual([]);
    expect.soft(mailsOf(q.run).length, 'no email').toBe(0);
    expect.soft(sfnCalls(q.run).length, 'no onboarding flow').toBe(0);
    expect.soft(invokesOf(q.run).length, 'nothing invoked').toBe(0);
    expect.soft(publishedOf(q.run).map((c) => c.detailType), 'no event').toEqual([]);
    expect.soft(q.run.calls.filter((c) => c.service === 'cognito').length, 'no sign-in made').toBe(0);
    expect.soft(modelCalls(q.run).filter((c) => c.kind === 'answer').length, 'no second model call to make the card').toBe(1);

    // A turn without the tool writes no row.
    const plainTurn = ask('hrA', 'Who started this week?', { intent: 'TOOL_REQUIRED', answers: [{ text: 'Nobody started this week.' }] });
    expect(plainTurn.status, describe(plainTurn)).toBe(200);
    expect.soft(writesTo(plainTurn.run, PENDING), 'no row').toEqual([]);
    expect.soft('proposals' in (plainTurn.json ?? {}) && plainTurn.json.proposals?.length, 'and no proposal in the answer').toBeFalsy();

    // An HR sign-in without custom:staff_id: the chat uses the sub, and so does the row (the same rule).
    const noStaff = ask('hrA_noStaffId', ASKED, draftTool(KAGISO));
    expect(noStaff.status, describe(noStaff)).toBe(200);
    expect.soft(pendingRows(noStaff.run.tables)[0]?.['requested_by'], 'requested_by falls back to the sub, as the chat does').toBe(HR.a.sub);
  });

  test('AC-1 If the row cannot be written, the answer is the could-not-answer line with no card, and no proposal is stored', async () => {
    test.setTimeout(120_000);
    const q = ask('hrA', ASKED, draftTool(KAGISO), { fail: { service: 'dynamodb', ops: ['PutItem'], message: 'disk on fire 999988887777', name: 'InternalServerError' } });
    expect(q.run.error, `the Lambda does not throw (${describe(q)})`).toBeUndefined();
    expect.soft(q.json?.proposals ?? [], 'no card').toEqual([]);
    const ok = (q.status ?? 0) >= 200 && (q.status ?? 0) < 300;
    if (ok) expect.soft(q.json?.message, 'a 2xx answer says the could-not-answer line (P09)').toBe(W.p09);
    expect.soft(pendingRows(q.run.tables), 'no row').toEqual([]);
    const ids = rowsOf(q.run.tables, CHATS).flatMap((m) => (m['proposal_ids'] as string[] | undefined) ?? []);
    expect.soft(ids, 'no proposal id stored with the chat').toEqual([]);
    expect.soft(`${q.text}\n${logLines(q.run).join('\n')}`, 'only an error name is logged, never the error\'s words').not.toMatch(SECRET);
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 The draft is cleaned: six keys only, the sign-in\'s company, names cut to 100, no number in the title or quote, no made-up email or phone', async () => {
    test.setTimeout(240_000);
    const tool = { firstName: 'Kagiso 9001015009087', lastName: 'Molefe', email: 'never.typed@mail-a.example', department: 'D'.repeat(300), role: 'Payroll Clerk', phoneNumber: '083 444 1234', tenant_id: B, tenantId: B, company: B, isAdmin: true, groups: 'admin' };
    const q = ask('hrA', 'Register Kagiso Molefe in Finance please', draftTool(tool));
    expect(q.status, describe(q)).toBe(200);
    const r = pendingRows(q.run.tables)[0];
    expect(r, 'a row is written').toBeDefined();
    const d = detailsOf(r);
    expect.soft(Object.keys(d).filter((k) => !SIX.includes(k)), 'no key outside the six is stored').toEqual([]);
    expect.soft(JSON.stringify(r), 'nothing named like a company or a group is kept from the draft').not.toMatch(/tenantId|"company"|isAdmin|"groups"|ten_bbbb/);
    expect.soft(r!['tenant_id'], 'the company is the sign-in\'s').toBe(A);
    expect.soft(String(d['department'] ?? '').length, 'the department is cut to 100 characters').toBe(100);
    expect.soft(String(d['first_name'] ?? '').length <= 100, 'names at most 100').toBe(true);
    expect.soft(blank(d['email']), `an email the person never typed is stored empty (${d['email']})`).toBe(true);
    expect.soft(blank(d['phone']), `a phone number that is not in the question is stored empty (${d['phone']})`).toBe(true);
    const p = q.json?.proposals?.[0] ?? {};
    expect.soft(await hasNumberRun(String(p.title ?? '')), `the title holds no run of six or more digits: ${p.title}`).toBe(false);
    expect.soft(await hasNumberRun(String(p.draft ?? '')), `the quote holds none: ${p.draft}`).toBe(false);
    expect.soft(await hasNumberRun(String(q.json?.message ?? '')), 'nor Batsi\'s question').toBe(false);
    expect.soft(blank(p.fields?.email) && blank(p.fields?.phone), 'Edit opens with the email and phone empty').toBe(true);
    expect.soft(String(p.draft ?? ''), 'the quote leaves out a missing email').not.toMatch(/never\.typed|Email address:/);

    // The same email typed in an EARLIER question of this chat is kept; a phone typed only earlier is not (stored questions are masked).
    const first = ask('hrA', 'Lerato Dube starts soon. Her email is lerato.dube@mail-a.example and her phone is 082 555 0177.', { intent: 'TOOL_REQUIRED', answers: [{ text: 'Noted.' }] });
    expect(first.status, describe(first)).toBe(200);
    const chatId = first.json?.chatId;
    expect(typeof chatId, 'the first question started a stored chat').toBe('string');
    const second = ask('hrA', 'Register her in Finance as a Payroll Clerk', draftTool({ firstName: 'Lerato', lastName: 'Dube', email: 'lerato.dube@mail-a.example', department: 'Finance', role: 'Payroll Clerk', phoneNumber: '082 555 0177' }), { chatId, tables: first.run.tables });
    expect(second.status, describe(second)).toBe(200);
    const r2 = pendingRows(second.run.tables)[0];
    expect.soft(detailsOf(r2)['email'], 'the email typed earlier in this chat is kept').toBe('lerato.dube@mail-a.example');
    expect.soft(blank(detailsOf(r2)['phone']), 'the phone typed only in an earlier question is not').toBe(true);
    expect.soft(second.json?.proposals?.[0]?.draft, 'the quote shows the kept email').toBe('Email address: lerato.dube@mail-a.example\nDepartment: Finance\nJob title: Payroll Clerk');
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 Only the person who asked can approve or decline: everyone else is refused before anything is read from employees, invoked, written or published', async () => {
    test.setTimeout(300_000);
    const t = withProposal();
    const before = pendingRow(t, ID);
    for (const verb of ['approve', 'reject'] as const) {
      for (const who of ['hrA2', 'hrReadonlyA', 'employeeA', 'agentA', 'accessTokenA', 'hrNoEmailA'] as const) {
        const o = decide(verb, who, ID, t, verb === 'reject' ? { reason: 'not mine' } : undefined);
        expect.soft(o.status, `${who} ${verb}: 403 (${describe(o)})`).toBe(403);
        nothingRan(o, `${who} ${verb}`);
        expect.soft(pendingRow(o.run.tables, ID), `${who} ${verb}: the row is unchanged`).toEqual(before);
      }
      const other = decide(verb, 'hrA2', ID, t);
      expect.soft(other.json, `another HR person of the same company gets ONB-22's fixed words (${verb})`).toEqual({ error: W.onlyHr });
      const b = decide(verb, 'hrB', ID, t);
      expect.soft(b.status, `HR of B ${verb}: 404, as ONB-22 answers another company (${describe(b)})`).toBe(404);
      nothingRan(b, `HR of B ${verb}`);
      // A body that names the asker changes nothing for someone else.
      const named = decide(verb, 'hrA2', ID, t, { requested_by: HR.a.staff, approved_by: HR.a.email, staffId: HR.a.staff });
      expect.soft(named.status, `a body naming the asker does not let another person ${verb}`).toBe(403);
      nothingRan(named, `hrA2 ${verb} with a body naming the asker`);
    }
    // The asker's own approve with a body naming someone else: refused outright (400) or the approver is still the token's person.
    const forged = decide('approve', 'hrA', ID, t, { approved_by: HR.a2.email, approved_by_name: nameOf(HR.a2), requested_by: HR.a2.staff });
    const stored = pendingRow(forged.run.tables, ID);
    if (forged.status === 400) nothingRan(forged, 'a body naming another approver');
    else {
      expect.soft(forged.status, describe(forged)).toBe(200);
      expect.soft([stored?.['approved_by'], stored?.['approved_by_name']], 'the approver is the token\'s person').toEqual([HR.a.email, nameOf(HR.a)]);
    }
    expect.soft(JSON.stringify(stored) + JSON.stringify(publishedOf(forged.run)), 'the other person is named nowhere').not.toMatch(/pieter|Van Wyk|HRA002/i);
  });

  test('AC-3 HR\'s list shows a Batsi proposal to the person who asked only; the agent key cannot read it; an agent\'s proposal is listed as before', async () => {
    test.setTimeout(180_000);
    const t = withRows(withProposal(), PENDING, [acceptRow('act-onb22-keep')]);
    const listKeys = ['action_id', 'type', 'status', 'run_status', 'error_code', 'document_id', 'employee_id', 'employee_name', 'document_type', 'check', 'proposed_by', 'created_at', 'expires_at', 'approved_by_name', 'approved_at', 'rejected_by_name', 'rejected_at'];
    const mine = listActions('hrA', t);
    expect(mine.status, describe(mine)).toBe(200);
    const ids = (o: Out) => ((o.json?.items ?? []) as any[]).map((i) => i.action_id).sort();
    expect.soft(ids(mine), 'the asker sees their own Batsi proposal and the agent\'s').toEqual(['act-chatsix-first', 'act-onb22-keep']);
    const theirs = listActions('hrA2', t);
    expect.soft(ids(theirs), 'another HR person of the company sees only the agent\'s').toEqual(['act-onb22-keep']);
    const b = listActions('hrB', t);
    expect.soft(ids(b), 'HR of B sees none of A\'s').toEqual([]);
    const items = (mine.json?.items ?? []) as any[];
    expect.soft(items.flatMap((i) => Object.keys(i).filter((k) => !listKeys.includes(k)).map((k) => `${i.action_id}.${k}`)), 'the list item keeps ONB-22\'s keys and nothing else').toEqual([]);
    expect.soft(JSON.stringify(mine.json), 'no draft email or phone in the list').not.toMatch(/kagiso\.molefe@|082 555 0199/);
    const agent = readAction('agentA', ID, t);
    expect.soft(agent.status, `the agent key's read of a Batsi proposal is 404 (${describe(agent)})`).toBe(404);
    const agentOwn = readAction('agentA', 'act-onb22-keep', t);
    expect.soft(agentOwn.status, 'its own proposal still reads as before').toBe(200);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Approve registers the employee once, through the real createEmployee, as the person who approved', async () => {
    test.setTimeout(300_000);
    const t = withProposal();
    const created = String(pendingRow(t, ID)?.['createdAt']);
    const o = decide('approve', 'hrA', ID, t);
    expect(o.status, `200 (${describe(o)})`).toBe(200);
    const j = o.json ?? {};
    expect.soft([j.status, j.action_id, j.run_status], 'approved and run').toEqual(['APPROVED', ID, 'RAN']);
    expect.soft(j.approved_by_name, 'the approver\'s name, from the sign-in').toBe(nameOf(HR.a));
    expect.soft(isIso(j.approved_at), 'and when').toBe(true);

    const inv = invokesOf(o.run);
    expect(inv.length, 'createEmployee was invoked once').toBe(1);
    expect.soft(String(inv[0]!.functionName).split(':').pop(), 'by the name in its setting').toBe(CREATE_NAME);
    expect.soft(inv[0]!.invocationType, 'and waited for').toBe('RequestResponse');
    const payload = inv[0]!.payload ?? {};
    const claims = payload.requestContext?.authorizer?.jwt?.claims ?? {};
    expect.soft([claims.sub, claims['custom:staff_id'], claims.email, claims.tenant_id], 'with the approver\'s own sign-in claims').toEqual([HR.a.sub, HR.a.staff, HR.a.email, A]);
    const headers = Object.fromEntries(Object.entries(payload.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    expect.soft(headers['idempotency-key'], 'Idempotency-Key is the action id').toBe(ID);
    const sent = JSON.parse(String(payload.body ?? '{}'));
    expect.soft(Object.keys(sent).filter((k) => !SIX.includes(k)), 'the body holds the details and nothing else').toEqual([]);

    const emps = rowsOf(o.run.tables, EMPLOYEES);
    expect(emps.length, 'one employee').toBe(1);
    const e = emps[0]!;
    expect.soft([e['first_name'], e['last_name'], e['email'], e['phone'], e['department'], e['job_title']], 'with the drafted details').toEqual(['Kagiso', 'Molefe', 'kagiso.molefe@mail-a.example', '082 555 0199', 'Finance', 'Payroll Clerk']);
    expect.soft([e['tenant_id'], e['created_by']], 'in company A, made by the approver').toEqual([A, HR.a.staff]);
    expect.soft(publishedOf(o.run, 'employee.invited').length, 'employee.invited published').toBe(1);
    expect.soft(rowsOf(o.run.tables, 'employee_invites').length, 'an invite').toBe(1);
    expect.soft(sfnCalls(o.run).length, 'the onboarding flow started').toBe(1);
    const mails = mailsOf(o.run);
    expect.soft(mails.map((m) => m.message?.To), 'one welcome email, to the new person').toEqual(['kagiso.molefe@mail-a.example']);
    expect.soft(j.result, 'the answer says what was made').toEqual({ employee_id: e['employee_id'], name: 'Kagiso Molefe', email: 'kagiso.molefe@mail-a.example', email_sent: true });

    const r = pendingRow(o.run.tables, ID)!;
    expect.soft([r['status'], r['run_status'], r['created_employee_id']], 'the row: approved, ran, and which employee').toEqual(['APPROVED', 'RAN', e['employee_id']]);
    expect.soft([r['approved_by'], r['approved_by_name']], 'who approved').toEqual([HR.a.email, nameOf(HR.a)]);
    expect.soft(blank(detailsOf(r)['phone']), 'the phone is taken out of the stored draft').toBe(true);
    const ev = publishedOf(o.run, 'proposal.approved');
    expect(ev.length, 'proposal.approved published once').toBe(1);
    const d = ev[0]!.detail;
    expect.soft(d.proposed_by, 'Batsi proposed').toEqual({ kind: 'BATSI', id: 'nalekoAiChat' });
    expect.soft([d.approved_by, d.approved_by_name, d.requested_by, d.proposed_at, d.created_employee_id, d.run_status, d.tenant_id], 'the approver approved what the asker asked for, when Batsi proposed it').toEqual([HR.a.email, nameOf(HR.a), HR.a.staff, created, e['employee_id'], 'RAN', A]);

    // A second approve is 409 and runs nothing.
    const again = decide('approve', 'hrA', ID, o.run.tables);
    expect.soft(again.status, `a second approve is 409 (${describe(again)})`).toBe(409);
    expect.soft(invokesOf(again.run).length, 'and runs nothing').toBe(0);
    expect.soft(rowsOf(again.run.tables, EMPLOYEES).length, 'still one employee').toBe(1);

    // Two at once run once.
    const ev1 = eventOf('hrA', ROUTE.approve, { path: { actionId: ID } });
    const both = callTogether('approveAgentAction', [ev1, ev1], { tables: t });
    expect.soft(both.outs.map((x) => x.status).sort(), 'one wins, one is 409').toEqual([200, 409]);
    expect.soft(invokesOf(both.run).length, 'createEmployee ran once').toBe(1);
    expect.soft(rowsOf(both.run.tables, EMPLOYEES).length, 'one employee').toBe(1);
    expect.soft(mailsOf(both.run).length, 'one email').toBe(1);

    // A test address gets no email (createEmployee's own rule).
    const robot = decide('approve', 'hrA', 'act-chat06-robot', withProposal({ id: 'act-chat06-robot', details: { email: 'kagiso.molefe@blackhole.postmarkapp.com' } }));
    expect.soft(robot.json?.run_status, describe(robot)).toBe('RAN');
    expect.soft(mailsOf(robot.run).length, 'no email to a test address').toBe(0);
    expect.soft(robot.json?.result?.email_sent, 'and the answer says so').toBe(false);
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 Missing or wrong details never burn the proposal; changes fill them and are recorded by name only', async () => {
    test.setTimeout(240_000);
    const t = withProposal({ id: ID, details: { phone: '' } });
    const before = pendingRow(t, ID);
    const o = decide('approve', 'hrA', ID, t);
    expect(o.status, `a missing phone is 400 (${describe(o)})`).toBe(400);
    expect.soft(o.json, 'with createEmployee\'s own words and the field').toEqual({ error: W.checkFields, fields: { phone: W.required } });
    expect.soft(pendingRow(o.run.tables, ID), 'the row is still waiting, untouched').toEqual(before);
    expect.soft(invokesOf(o.run).length, 'nothing invoked').toBe(0);
    expect.soft(publishedOf(o.run).length, 'nothing published').toBe(0);
    expect.soft(writesTo(o.run, PENDING), 'nothing claimed').toEqual([]);

    const bad = decide('approve', 'hrA', ID, t, { changes: { phone: '082 555 0199', email: 'not an address' } });
    expect.soft([bad.status, bad.json?.fields?.email], 'a wrong email in the changes is 400 with its field').toEqual([400, 'Check the email address']);
    expect.soft(writesTo(bad.run, PENDING), 'nothing claimed').toEqual([]);

    for (const body of [{ changes: { phone: '082 555 0199', tenant_id: B } }, { changes: { phone: '082 555 0199' }, note: 'x' }, { changes: 'phone=0825550199' }, { changes: { phone: '082 555 0199', hr_staff_id: 'HRA002' } }]) {
      const r = decide('approve', 'hrA', ID, t, body);
      expect.soft(r.status, `${JSON.stringify(body)} is 400 (${describe(r)})`).toBe(400);
      expect.soft(invokesOf(r.run).length + writesTo(r.run, PENDING).length, `${JSON.stringify(body)}: nothing claimed or run`).toBe(0);
    }

    const fixed = decide('approve', 'hrA', ID, t, { changes: { phone: '082 555 0199' } });
    expect(fixed.status, describe(fixed)).toBe(200);
    expect.soft(fixed.json?.run_status, 'it registers').toBe('RAN');
    expect.soft(rowsOf(fixed.run.tables, EMPLOYEES)[0]?.['phone'], 'with the phone the approver typed').toBe('082 555 0199');
    const r = pendingRow(fixed.run.tables, ID)!;
    expect.soft(r['approved_with_changes'], 'the row says it was approved with changes').toBe(true);
    expect.soft(blank(detailsOf(r)['phone']), 'and keeps no phone').toBe(true);
    const ev = publishedOf(fixed.run, 'proposal.approved')[0]?.detail ?? {};
    expect.soft(ev.changed_fields, 'the event names the changed field').toEqual(['phone']);
    expect.soft(ev.approved_with_changes, 'and says it was approved with changes').toBe(true);
    expect.soft(JSON.stringify(ev), 'never its value').not.toMatch(/082 555 0199|0825550199/);
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 A refused or unknown run says so truthfully, with a code and never an exception\'s words', async () => {
    test.setTimeout(400_000);
    const run = (label: string, t: Tables, invokeFail?: string) => {
      const o = decide('approve', 'hrA', ID, t, undefined, invokeFail ? { invokeFail } : {});
      expect.soft(o.status, `${label}: still 200 (${describe(o)})`).toBe(200);
      const all = `${o.text}\n${JSON.stringify(pendingRows(o.run.tables))}\n${logLines(o.run).join('\n')}\n${JSON.stringify(publishedOf(o.run))}`;
      expect.soft(all, `${label}: no exception words in the answer, row, log or event`).not.toMatch(SECRET);
      return o;
    };
    const dupA = withProposal({ id: ID }, withRows(tables(), EMPLOYEES, [employeeRow(A, 'emp-a-0001', 'Kagiso', 'Molefe', 'kagiso.molefe@mail-a.example')]));
    const dup = run('same email in company A', dupA);
    expect.soft([dup.json?.run_status, dup.json?.error_code], 'an email already in company A: REFUSED ALREADY_EXISTS').toEqual(['REFUSED', 'ALREADY_EXISTS']);
    expect.soft(rowsOf(dup.run.tables, EMPLOYEES).length, 'no second employee').toBe(1);
    expect.soft(mailsOf(dup.run).length, 'no email').toBe(0);
    expect.soft([pendingRow(dup.run.tables, ID)?.['run_status'], pendingRow(dup.run.tables, ID)?.['error_code']], 'the row says so').toEqual(['REFUSED', 'ALREADY_EXISTS']);

    const dupB = withProposal({ id: ID }, withRows(tables(), EMPLOYEES, [employeeRow(B, 'emp-b-0001', 'Kagiso', 'Molefe', 'kagiso.molefe@mail-a.example')]));
    const other = run('same email in company B only', dupB);
    expect.soft(other.json?.run_status, 'each company has its own people: the run goes ahead').toBe('RAN');
    expect.soft(rowsOf(other.run.tables, EMPLOYEES).filter((e) => e['tenant_id'] === A).length, 'one employee in A').toBe(1);

    const lost = run('the first invoke finished but its reply was lost', withProposal(), 'throw-after-run');
    expect.soft(lost.json?.run_status, 'the one repeat finds it finished: RAN').toBe('RAN');
    expect.soft(invokesOf(lost.run).length, 'exactly one repeat').toBe(2);
    expect.soft(invokesOf(lost.run).map((c) => c.payload?.headers?.['idempotency-key']), 'both with the same Idempotency-Key').toEqual([ID, ID]);
    expect.soft(rowsOf(lost.run.tables, EMPLOYEES).length, 'one employee').toBe(1);
    expect.soft(mailsOf(lost.run).length, 'one email').toBe(1);

    for (const [mode, label] of [['throw-after-run-always', 'nothing settles after the first'], ['throw', 'every invoke times out'], ['function-error', 'the function fails']] as const) {
      const o = run(label, withProposal(), mode);
      expect.soft([o.json?.run_status, o.json?.error_code], `${label}: FAILED RUN_UNKNOWN`).toEqual(['FAILED', 'RUN_UNKNOWN']);
      expect.soft(invokesOf(o.run).length, `${label}: one repeat and no more`).toBe(2);
      expect.soft([pendingRow(o.run.tables, ID)?.['run_status'], pendingRow(o.run.tables, ID)?.['error_code']], `${label}: the row says so`).toEqual(['FAILED', 'RUN_UNKNOWN']);
    }
    for (const [mode, code] of [['status400', 'DETAILS_REFUSED'], ['status403', 'NOT_ALLOWED'], ['status404', 'NOT_FOUND']] as const) {
      const o = run(`createEmployee answers ${mode}`, withProposal(), mode);
      expect.soft([o.json?.run_status, o.json?.error_code], `${mode}: REFUSED ${code}`).toEqual(['REFUSED', code]);
      expect.soft(invokesOf(o.run).length, `${mode}: no repeat`).toBe(1);
    }
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 Decline records who, when and why (numbers removed) and does nothing else; a declined or expired proposal cannot be approved', async () => {
    test.setTimeout(300_000);
    const t = withProposal();
    const reason = 'Wrong person. Call 082 555 0199 or check ID 9001015009087 first. PLUMTREE';
    const o = decide('reject', 'hrA', ID, t, { reason });
    expect(o.status, describe(o)).toBe(200);
    expect.soft([o.json?.status, o.json?.action_id, o.json?.rejected_by_name], 'declined, by whom').toEqual(['REJECTED', ID, nameOf(HR.a)]);
    expect.soft(isIso(o.json?.rejected_at), 'and when').toBe(true);
    const r = pendingRow(o.run.tables, ID)!;
    expect.soft([r['status'], r['rejected_by'], r['rejected_by_name']], 'the row: declined, by whom').toEqual(['REJECTED', HR.a.email, nameOf(HR.a)]);
    expect.soft(isIso(r['rejected_at']), 'when').toBe(true);
    expect.soft(String(r['reason'] ?? ''), 'the reason is kept').toContain('PLUMTREE');
    expect.soft(String(r['reason'] ?? ''), 'in the person\'s words').toContain('Wrong person.');
    expect.soft(await hasNumberRun(String(r['reason'] ?? '')), `with the phone and ID numbers removed: ${r['reason']}`).toBe(false);
    expect.soft(blank(detailsOf(r)['phone']), 'the phone is taken out of the stored draft').toBe(true);
    const ev = publishedOf(o.run, 'proposal.rejected');
    expect.soft(ev.length, 'proposal.rejected published').toBe(1);
    expect.soft(String(ev[0]?.detail?.reason ?? ''), 'with the reason').toContain('PLUMTREE');
    expect.soft(await hasNumberRun(withoutTimes(ev[0]?.detail ?? {})), `masked: ${withoutTimes(ev[0]?.detail ?? {})}`).toBe(false);
    expect.soft([ev[0]?.detail?.rejected_by, ev[0]?.detail?.requested_by], 'who declined, and who asked').toEqual([HR.a.email, HR.a.staff]);
    expect.soft(invokesOf(o.run).length + mailsOf(o.run).length + rowsOf(o.run.tables, EMPLOYEES).length + rowsOf(o.run.tables, 'employee_invites').length, 'no invoke, email, employee or invite').toBe(0);

    const long = decide('reject', 'hrA', ID, t, { reason: 'x'.repeat(800) });
    expect.soft(String(pendingRow(long.run.tables, ID)?.['reason'] ?? '').length, 'a long reason is cut to 500 characters').toBeLessThanOrEqual(500);
    const none = decide('reject', 'hrA', ID, t, {});
    expect.soft([none.status, pendingRow(none.run.tables, ID)?.['status']], 'the reason is optional').toEqual([200, 'REJECTED']);

    const after = decide('approve', 'hrA', ID, o.run.tables);
    expect.soft(after.status, 'a declined proposal cannot be approved').toBe(409);
    expect.soft(invokesOf(after.run).length, 'nothing runs').toBe(0);
    const old = withProposal({ id: ID, expiresAt: NOW_S() - 60 });
    for (const verb of ['approve', 'reject'] as const) {
      const x = decide(verb, 'hrA', ID, old);
      expect.soft(x.status, `an expired proposal: ${verb} is 409`).toBe(409);
      expect.soft(invokesOf(x.run).length + writesTo(x.run, PENDING).length, `${verb}: nothing runs or is written`).toBe(0);
    }

    // The model never receives the reason: decline in a chat, then ask on in the same chat.
    const q = ask('hrA', ASKED, draftTool(KAGISO));
    const id = q.json?.proposals?.[0]?.actionId;
    expect(typeof id, describe(q)).toBe('string');
    const d = decide('reject', 'hrA', id, q.run.tables, { reason: 'PLUMTREE is not our name for him' });
    expect(d.status, describe(d)).toBe(200);
    const next = ask('hrA', 'What did I just decline?', { intent: 'TOOL_REQUIRED', answers: [{ text: 'A draft.' }] }, { chatId: q.json?.chatId, tables: d.run.tables });
    expect(next.status, describe(next)).toBe(200);
    expect.soft(modelCalls(next.run).length, 'the model was asked').toBeGreaterThan(0);
    expect.soft(JSON.stringify(modelCalls(next.run).map((c) => c.body)), 'and never saw the reason').not.toContain('PLUMTREE');
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Batsi never acts on its own: no path from the chat to approve, decline or createEmployee; "yes, approve it" changes nothing; Accept document is as ONB-22 locked it', async () => {
    test.setTimeout(240_000);
    const dir = join(LAMBDA, 'nalekoAiChat');
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(mjs|js)$/.test(f) && !/(^|\/)(tests?|node_modules)\//.test(f) && !/\.test\.mjs$/.test(f));
    // Comments are left out: only code counts. The old app's pendingAction (confirmEndpoint '/v1/employees') stays until OPS-04 (spec step 3).
    const src = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    expect(src.length, 'the chat\'s code was read').toBeGreaterThan(1000);
    for (const bad of [/\/actions\/[^'"`\s]*\/(approve|reject)/, /approveAgentAction/, /createEmployee/, /@aws-sdk\/client-lambda/, /InvokeCommand/, /CREATE_EMPLOYEE_FUNCTION_NAME/]) {
      expect.soft(src, `the chat's code does not contain ${bad}`).not.toMatch(bad);
    }
    const chatRole = roleOf(lambdaNamed('nalekoAiChat'));
    const chatActions = grants(chatRole).statements.flatMap((s) => list(s.Action));
    expect.soft(chatActions.filter((a) => /^lambda:/i.test(a) || a === '*'), 'the chat role may invoke no Lambda').toEqual([]);

    const q = ask('hrA', ASKED, draftTool(KAGISO));
    const id = q.json?.proposals?.[0]?.actionId;
    expect(typeof id, describe(q)).toBe('string');
    for (const words of ['yes', 'approve it', 'Yes, approve it and register him now']) {
      const y = ask('hrA', words, { intent: 'TOOL_REQUIRED', answers: [{ text: 'Use Approve on the card.' }] }, { chatId: q.json?.chatId, tables: q.run.tables });
      expect(y.status, describe(y)).toBe(200);
      expect.soft(pendingRow(y.run.tables, id)?.['status'], `"${words}": the proposal still waits`).toBe('PENDING_APPROVAL');
      expect.soft(pendingRows(y.run.tables).length, `"${words}": no new row`).toBe(1);
      expect.soft(invokesOf(y.run).length + rowsOf(y.run.tables, EMPLOYEES).length + mailsOf(y.run).length, `"${words}": nothing run, no employee, no email`).toBe(0);
    }

    // Accept document (the agent's proposal) is answered by any HR person of the company, as before, and its decline ignores the reason.
    const t = withRows(tables(), PENDING, [acceptRow('act-onb22-accept')]);
    const ap = decide('approve', 'hrA2', 'act-onb22-accept', t);
    expect.soft(ap.status, `an agent's Accept document is approved by any HR person (${describe(ap)})`).toBe(200);
    expect.soft(invokesOf(ap.run).map((c) => String(c.functionName)).filter((n) => n.includes(CREATE_NAME)), 'and never runs createEmployee').toEqual([]);
    const rj = decide('reject', 'hrA2', 'act-onb22-accept', t, { reason: 'PLUMTREE' });
    expect.soft(rj.status, describe(rj)).toBe(200);
    expect.soft(JSON.stringify(pendingRow(rj.run.tables, 'act-onb22-accept')) + JSON.stringify(publishedOf(rj.run)), 'its reason is still ignored').not.toContain('PLUMTREE');
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 Every proposal event and audit row has no ID, phone or bank number, and no email or phone of the draft', async () => {
    test.setTimeout(300_000);
    const planted = { firstName: 'Kagiso', lastName: 'Molefe', email: 'kagiso.molefe@mail-a.example', department: 'Finance 9001015009087', role: 'Clerk 62845512345', phoneNumber: '082 555 0199' };
    const q = ask('hrA', ASKED, draftTool(planted));
    expect(q.status, describe(q)).toBe(200);
    const id1 = q.json?.proposals?.[0]?.actionId;
    const ok = decide('approve', 'hrA', id1, q.run.tables, { changes: { job_title: 'Clerk acct 62845512345' } });
    expect(ok.status, describe(ok)).toBe(200);
    const q2 = ask('hrA', ASKED, draftTool(planted), { tables: ok.run.tables });
    const id2 = q2.json?.proposals?.[0]?.actionId;
    const no = decide('reject', 'hrA', id2, q2.run.tables, { reason: 'Bank 62845512345, ID 9001015009087, phone 082 555 0199' });
    expect(no.status, describe(no)).toBe(200);

    const events = [...publishedOf(ok.run), ...publishedOf(no.run)].filter((c) => String(c.detailType).startsWith('proposal.'));
    expect(events.map((e) => e.detailType).sort(), 'the approval and the decline were published').toEqual(['proposal.approved', 'proposal.rejected']);
    const audit = rowsOf(no.run.tables, AUDIT).filter((r) => /^proposal\./.test(String(r['detailType'] ?? r['eventType'] ?? '')));
    expect(audit.length, 'and reached the audit log').toBe(2);
    for (const [label, thing] of [...events.map((e) => [`event ${e.detailType}`, e.detail] as const), ...audit.map((a) => [`audit row ${a['detailType'] ?? a['eventType']}`, a] as const)]) {
      const s = JSON.stringify(thing);
      expect.soft(await hasNumberRun(withoutTimes(thing)), `${label}: no run of six or more digits: ${withoutTimes(thing)}`).toBe(false);
      expect.soft(s, `${label}: no email of the draft`).not.toContain('kagiso.molefe@mail-a.example');
      expect.soft(s, `${label}: no phone of the draft`).not.toMatch(/082 555 0199|0825550199/);
    }
    // The chat's own audit record of the proposing turn (CHAT-02's) holds no number either.
    const chatAudit = rowsOf(q.run.tables, CHAT_AUDIT);
    expect(chatAudit.length, 'the proposing turn was audited').toBeGreaterThan(0);
    for (const a of chatAudit) expect.soft(await hasNumberRun(withoutTimes(a)), `the chat audit row holds no number: ${withoutTimes(a)}`).toBe(false);
    // Title, quote and the stored answer.
    for (const v of [q.json?.proposals?.[0]?.title, q.json?.proposals?.[0]?.draft, q.json?.message]) expect.soft(await hasNumberRun(String(v)), `no number in "${v}"`).toBe(false);
  });

  // ---------------------------------------------------------------- AC-10

  test('AC-10 Company B, end to end: B proposes and approves its own; A can neither see nor answer it; the company is always the sign-in\'s', async () => {
    test.setTimeout(300_000);
    // Until CHAT-04 lands the chat serves the one company in AGENT_TENANT_ID; here that is B.
    const forB = { AGENT_TENANT_ID: B };
    const q = ask('hrB', 'Register Kagiso Molefe in Finance as a Payroll Clerk. Email kagiso.molefe@mail-a.example, phone 082 555 0199.', draftTool({ ...KAGISO, tenant_id: A, company: A }), { env: forB });
    expect(q.status, describe(q)).toBe(200);
    const id = q.json?.proposals?.[0]?.actionId;
    const r = pendingRow(q.run.tables, id);
    expect.soft([r?.['tenant_id'], r?.['requested_by']], 'the row is B\'s, for HR of B').toEqual([B, HR.b.staff]);
    const seen = listActions('hrA', q.run.tables);
    expect.soft(((seen.json?.items ?? []) as any[]).map((i) => i.action_id), 'HR of A does not see it').not.toContain(id);
    const before = pendingRow(q.run.tables, id);
    for (const verb of ['approve', 'reject'] as const) {
      const x = decide(verb, 'hrA', id, q.run.tables);
      expect.soft(x.status, `HR of A ${verb}: 404 (${describe(x)})`).toBe(404);
      nothingRan(x, `HR of A ${verb}`);
      expect.soft(pendingRow(x.run.tables, id), `HR of A ${verb}: B's row unchanged`).toEqual(before);
    }
    const ok = decide('approve', 'hrB', id, q.run.tables);
    expect(ok.json?.run_status, describe(ok)).toBe('RAN');
    const emps = rowsOf(ok.run.tables, EMPLOYEES);
    expect.soft(emps.map((e) => e['tenant_id']), 'the employee is in company B, though the draft named A').toEqual([B]);

    // HR of B answering A's proposal: 404, nothing run, A's row unchanged.
    const ta = withProposal();
    const a0 = pendingRow(ta, ID);
    for (const verb of ['approve', 'reject'] as const) {
      const x = decide(verb, 'hrB', ID, ta);
      expect.soft(x.status, `HR of B ${verb} on A's: 404`).toBe(404);
      nothingRan(x, `HR of B ${verb} on A's`);
      expect.soft(pendingRow(x.run.tables, ID), 'A\'s row unchanged').toEqual(a0);
    }
  });

  // ---------------------------------------------------------------- AC-11

  test('AC-11 A reopened chat shows each card as it now stands: waiting, approved, declined, expired; others\' and deleted ones are left out', async () => {
    test.setTimeout(400_000);
    // Four proposals in one chat, made by the real chat Lambda.
    let t = tables();
    let chatId: string | undefined;
    const ids: string[] = [];
    for (const first of ['Kagiso', 'Lerato', 'Sipho', 'Ayanda']) {
      const q = ask('hrA', `Register ${first} Molefe in Finance as a Payroll Clerk, email ${first.toLowerCase()}.molefe@mail-a.example, phone 082 555 0199.`,
        draftTool({ ...KAGISO, firstName: first, email: `${first.toLowerCase()}.molefe@mail-a.example` }), { tables: t, ...(chatId ? { chatId } : {}) });
      expect(q.status, describe(q)).toBe(200);
      chatId ??= q.json?.chatId;
      ids.push(q.json?.proposals?.[0]?.actionId);
      t = q.run.tables;
    }
    const [waitingId, approvedId, declinedId, expiredId] = ids as [string, string, string, string];
    const ap = decide('approve', 'hrA', approvedId, t);
    expect(ap.json?.run_status, describe(ap)).toBe('RAN');
    const de = decide('reject', 'hrA', declinedId, ap.run.tables, { reason: 'Already registered, ref 62845512345' });
    expect(de.status, describe(de)).toBe(200);
    t = de.run.tables;
    // The expired one: its clock ran out. A planted canApprove on the waiting row is not trusted.
    t = { ...t, [PENDING]: t[PENDING]!.map((r) => {
      const p = plain(r);
      if (p['actionId'] === expiredId) return { ...r, expiresAt: { N: String(NOW_S() - 60) } };
      if (p['actionId'] === waitingId) return { ...r, canApprove: { BOOL: false } };
      return r;
    }) };
    // Another person's and another company's proposal ids planted in this chat's last answer, and one whose row is gone.
    const foreign = [proposalRow({ id: 'act-chat06-other-person', staff: HR.a2.staff, staffName: nameOf(HR.a2) }), proposalRow({ id: 'act-chat06-other-company', c: B, staff: HR.a.staff })];
    t = withRows(t, PENDING, foreign);
    const gone = 'act-chat06-gone';
    const msgs = t[CHATS]!;
    const lastBatsi = [...msgs].filter((m) => plain(m)['role'] === 'batsi').sort((x, y) => String(plain(x)['sk']).localeCompare(String(plain(y)['sk']))).pop()!;
    const extra = ['act-chat06-other-person', 'act-chat06-other-company', gone];
    const ids0 = (lastBatsi['proposal_ids'] as any);
    if (ids0?.L) ids0.L.push(...extra.map((S) => ({ S })));
    else if (ids0?.SS) ids0.SS.push(...extra);
    else lastBatsi['proposal_ids'] = av({ x: [...((plain(lastBatsi)['proposal_ids'] as string[]) ?? []), ...extra] })['x']!;

    const o = openChat('hrA', chatId!, t);
    expect(o.status, describe(o)).toBe(200);
    const messages = (o.json?.messages ?? []) as any[];
    const cards = messages.flatMap((m) => (m.proposals ?? []) as any[]);
    const byId = Object.fromEntries(cards.map((c) => [c.actionId, c]));
    expect.soft(sorted(Object.keys(byId)), 'exactly this person\'s four proposals are drawn').toEqual(sorted(ids));
    expect.soft(Object.keys(byId), 'another person\'s, another company\'s and a deleted one are left out').not.toEqual(expect.arrayContaining(['act-chat06-other-person']));
    expect.soft(messages.filter((m) => m.role === 'batsi').map((m) => m.text), 'every question still shows').toEqual(['Kagiso', 'Lerato', 'Sipho', 'Ayanda'].map((f) => W.question(f, 'Molefe')));
    expect.soft(messages.find((m) => (m.proposalIds ?? []).includes(gone))?.proposals?.some((c: any) => c.actionId === gone) ?? false, 'a row deleted by its clock is left out, the message stays').toBe(false);

    const w = byId[waitingId] ?? {};
    expect.soft([w.type, w.title, w.state, w.canApprove], 'the waiting card can be approved by the person who asked, whatever the row says').toEqual(['CREATE_EMPLOYEE', W.question('Kagiso', 'Molefe'), 'waiting', true]);
    expect.soft(w.draft, 'with its quote').toBe('Email address: kagiso.molefe@mail-a.example\nDepartment: Finance\nJob title: Payroll Clerk');
    expect.soft(w.fields?.first_name, 'and its details for Edit').toBe('Kagiso');
    const a = byId[approvedId] ?? {};
    expect.soft(a.state, 'approved').toBe('approved');
    expect.soft(a.fields, 'no details on a decided card').toBeUndefined();
    expect.soft(JSON.stringify(a.outcome ?? {}), 'who approved').toContain(nameOf(HR.a));
    expect.soft(JSON.stringify(a.outcome ?? {}), 'and the employee made').toContain(String(rowsOf(t, EMPLOYEES)[0]?.['employee_id']));
    expect.soft(String(JSON.stringify(a.outcome ?? {})).match(/\d{4}-\d\d-\d\dT[\d:.]+Z/) !== null, 'and when').toBe(true);
    const d = byId[declinedId] ?? {};
    expect.soft(d.state, 'declined').toBe('declined');
    expect.soft(d.fields, 'no details on a decided card').toBeUndefined();
    expect.soft(JSON.stringify(d.outcome ?? {}), 'who declined').toContain(nameOf(HR.a));
    expect.soft(String(JSON.stringify(d.outcome ?? {})).match(/\d{4}-\d\d-\d\dT[\d:.]+Z/) !== null, 'and when').toBe(true);
    expect.soft(JSON.stringify(d.outcome ?? {}), 'the reason').toContain('Already registered');
    expect.soft(await hasNumberRun(withoutTimes(d.outcome ?? {})), `masked: ${withoutTimes(d.outcome ?? {})}`).toBe(false);
    const x = byId[expiredId] ?? {};
    expect.soft([x.state, x.canApprove], 'expired, and cannot be approved').toEqual(['expired', false]);
    expect.soft(x.fields, 'no details on an expired card').toBeUndefined();

    // Another person opening this chat gets nothing (CHAT-02), and so no card.
    const other = openChat('hrA2', chatId!, t);
    expect.soft(other.status, 'another person cannot open it').toBe(404);
  });

  // ---------------------------------------------------------------- Terraform and code that must stay put

  test('AC-4 Terraform: approveAgentAction may invoke createEmployee (and the review) and nothing else, named by a setting; askBatsiChats may read the proposals (text)', async () => {
    const approve = lambdaNamed('approveAgentAction');
    const env = settingsOf(approve);
    expect(env.get('CREATE_EMPLOYEE_FUNCTION_NAME') ?? '', 'approveAgentAction has CREATE_EMPLOYEE_FUNCTION_NAME, naming createEmployee').toMatch(/aws_lambda_function\.create_employee\.function_name|"createEmployee"/);
    const st = grants(roleOf(approve)).statements;
    const invoke = st.filter((s) => list(s.Action).some((a) => /^lambda:/i.test(a)));
    const targets = invoke.flatMap((s) => list(s.Resource));
    expect(targets.some((r) => /aws_lambda_function\.create_employee\.arn$/.test(r)), `it may invoke createEmployee (${targets.join(', ')})`).toBe(true);
    expect.soft(targets.filter((r) => !/aws_lambda_function\.(create_employee|review_document_verification)\.arn$/.test(r)), 'and only createEmployee and the review').toEqual([]);
    expect.soft(invoke.flatMap((s) => list(s.Action)).filter((a) => a !== 'lambda:InvokeFunction'), 'only InvokeFunction').toEqual([]);
    const chats = grants(roleOf(lambdaNamed('askBatsiChats'))).statements;
    const onPending = chats.filter((s) => list(s.Resource).some((r) => /aws_dynamodb_table\.pending_actions\.arn/.test(r)));
    expect(onPending.flatMap((s) => list(s.Action)).sort(), 'askBatsiChats reads a proposal by key, and nothing more').toEqual(['dynamodb:GetItem']);
    const kms = text('infra/kms.tf').replace(/^\s*(#|\/\/).*$/gm, '');
    const reads = /dynamodb_read_role_arns\s*=\s*\[([\s\S]*?)\n\s*\]/.exec(kms)?.[1] ?? '';
    expect.soft(reads, 'askBatsiChats opens encrypted rows through DynamoDB').toContain(`aws_iam_role.${roleOf(lambdaNamed('askBatsiChats'))}.arn`);
    expect.soft(sha256('infra/ai_guardrail.tf'), 'the AI guardrail is not touched').toBe('01302184a5d8590329935761860419f95a43c2604c31ffa7232ea8f4e5c2663b');
  });

  test('AC-14 Nothing else moves: createEmployee, the review, createProposal and the tool table are not edited; validateEmployee is imported; no Lambda imports another; the AI guard check passes (text)', async () => {
    const hashes: Record<string, string> = {
      // develop 3f23586 (and ONB-22's branch 34984ee): run by the new code, never edited.
      'lambda/createEmployee/index.mjs': '0e588a5b13346b43082e53838c46b6739a28f6f8a19b7c1ca0487b6a80c94ec1',
      'lambda/reviewDocumentVerification/index.mjs': 'c51474b9bd1b94e2aab1085c2507ef4e535fcb2d7ebc4781741d690ce49d4205',
      'lambda/talentFlowApproveAction/index.mjs': 'cf7a6ad7de251a757f60b293596441ab95a31a41e6cbcc5a3ce2644fef8b124e',
      // ONB-22 (PR 422 at 34984ee): the agent's own proposal route, which refuses this type on purpose.
      'lambda/createProposal/index.mjs': 'c986915171d882629f6f6adc3b7decac27adda674d208885e15680741ac9ea17',
    };
    for (const [file, sha] of Object.entries(hashes)) {
      expect.soft(existsSync(join(REPO, file)) ? sha256(file) : 'missing', `${file} is not edited`).toBe(sha);
    }
    const resolver = text('lambda/nalekoAiChat/tool-resolver.mjs');
    const table = /export const TOOL_MAP = \{([\s\S]*?)\n\};/.exec(resolver)?.[1] ?? '';
    expect.soft([...table.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]), 'TOOL_MAP has the same tools: no proposal writer').toEqual(['list_employees', 'get_employee', 'assess_employee_risk', 'list_verifications', 'get_verification_summary', 'query_audit_log', 'get_high_risk_report', 'onboard_new_employee']);
    const onboard = /\n {2}onboard_new_employee: \(args, _context\) => \(\{[\s\S]*?\n {2}\}\),/.exec(resolver)?.[0] ?? '';
    expect.soft(onboard.replace(/\s+/g, ''), 'onboard_new_employee still only drafts').toBe("onboard_new_employee:(args,_context)=>({hitl:true,draft:{first_name:args.firstName,last_name:args.lastName,email:args.email,department:args.department,job_title:args.role??'',phone:args.phoneNumber??'',},message:'Pleasereviewtheemployeedetailsaboveandconfirmtoproceedwithonboarding.',}),");
    const approve = text('lambda/approveAgentAction/index.mjs');
    expect.soft(approve, 'approveAgentAction imports validateEmployee from the shared file').toMatch(/import\s*\{[^}]*\bvalidateEmployee\b[^}]*\}\s*from\s*['"]\.\.\/shared\/employee-input\.mjs['"]/);
    expect.soft(approve, 'and does not copy it').not.toMatch(/function\s+validateEmployee|const\s+validateEmployee\s*=/);
    expect.soft(approve, 'nor imports an AI client').not.toMatch(/bedrock|anthropic|textract|openai/i);
    for (const fn of ['approveAgentAction', 'nalekoAiChat', 'askBatsiChats']) {
      const dir = join(LAMBDA, fn);
      const srcs = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.(mjs|js)$/.test(f) && !/node_modules|(^|\/)tests?\//.test(f) && !/\.test\.mjs$/.test(f));
      for (const f of srcs) {
        const s = readFileSync(join(dir, f), 'utf8');
        const across = [...s.matchAll(/from\s*['"]\.\.\/([\w-]+)\//g)].map((m) => m[1]).filter((d) => d !== 'shared');
        expect.soft(across, `${fn}/${f} imports nothing from another Lambda's folder`).toEqual([]);
      }
    }
    const guard = spawnSync('python3', ['scripts/ci/check-ai-guard.py'], { cwd: REPO, encoding: 'utf8', timeout: 120_000 });
    expect.soft(guard.status, `scripts/ci/check-ai-guard.py passes:\n${(guard.stdout + guard.stderr).slice(-1200)}`).toBe(0);
    for (const spec of ['chat-01', 'chat-02', 'chat-05', 'onb-22', 'onb-03', 'onb-04', 'onb-04.2', 'be-18', 'ten-02', 'ten-04', 'ops-05']) {
      expect.soft(existsSync(join(__dirname, `${spec}.spec.ts`)), `${spec}.spec.ts is in the folder, and the builder runs it before the PR`).toBe(true);
    }
    expect(exists('approveAgentAction') && exists('askBatsiChats') && exists('nalekoAiChat'), 'the three Lambdas are there').toBe(true);
  });
});

// ================================================================ the screen (AC-12, AC-13)


const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake Agent API.');
const panel = (page: Page): Locator => page.getByRole('dialog', { name: 'Batsi', exact: true });
const log = (page: Page): Locator => page.getByRole('log', { name: 'Conversation with Batsi' });
const composer = (page: Page): Locator => page.getByRole('textbox', { name: 'Message Batsi' });
const card = (page: Page): Locator => log(page).getByRole('article', { name: W.question('Kagiso', 'Molefe') });
const drawer = (page: Page): Locator => page.getByRole('dialog', { name: W.question('Kagiso', 'Molefe') });
const button = (scope: Locator, name: string) => scope.getByRole('button', { name, exact: true });
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

const EMP_ID = '6b1f8d2e-0c6a-4c39-9a7e-chat06000001';
const SERVER_NAME = 'Thandi Mokoena'; // the approver as the SERVER names them; the signed-in fake person is someone else
const CARD: Proposal = { actionId: 'act-chat06-screen', type: 'CREATE_EMPLOYEE', title: W.question('Kagiso', 'Molefe'), draft: DRAFT_TEXT, fields: DETAILS, canApprove: true };
const approved = (id: string, extra: Record<string, unknown> = {}) => ({ status: 200, json: { status: 'APPROVED', action_id: id, run_status: 'RAN', approved_by_name: SERVER_NAME, approved_at: '2026-11-19T10:12:00.000Z', result: { employee_id: EMP_ID, name: 'Kagiso Molefe', email: 'kagiso.molefe@mail-a.example', email_sent: true }, ...extra } });

async function toCard(page: Page, signIn: SignInPage, hr: Login, chat: Chat06Fake): Promise<Locator> {
  await signIn.open();
  await signIn.signInAs(hr);
  await expect(page).toHaveURL(/\/hr$/);
  await page.getByRole('button', { name: /^Ask Batsi/ }).click();
  await expect(panel(page)).toBeVisible();
  chat.reply = () => ({ message: W.question('Kagiso', 'Molefe'), proposals: [CARD] });
  await composer(page).fill(ASKED);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const c = card(page);
  await expect(c, 'the card is drawn').toBeVisible();
  return c;
}
async function valueOf(l: Locator): Promise<string> {
  return l.evaluate((el) => ('value' in el ? String((el as HTMLInputElement).value) : String(el.textContent ?? '')).trim());
}

test.describe('AC-12 The card on the screen', () => {
  test('AC-12 Batsi\'s question, then the card: Suggested by Batsi, the title, the quote with no phone, Waiting for you, Approve, Edit, Decline', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    const c = await toCard(page, signIn, hr, chat!);
    const said = log(page).getByText(W.question('Kagiso', 'Molefe'), { exact: true });
    expect(await said.count(), 'the sentence is said twice: Batsi\'s message and the card\'s title').toBeGreaterThanOrEqual(2);
    const asMessage = await said.evaluateAll((els) => els.filter((e) => !e.closest('[role="article"]')).length);
    expect(asMessage, 'Batsi\'s question is its own message, outside the card').toBeGreaterThanOrEqual(1);
    const msgBox = await said.evaluateAll((els) => { const e = els.find((x) => !x.closest('[role="article"]'))!; const r = e.getBoundingClientRect(); return r.top; });
    expect(msgBox, 'above the card').toBeLessThan((await c.boundingBox())!.y);
    await expect(c.getByText(W.suggested, { exact: true })).toBeVisible();
    await expect(c.getByText(W.waiting, { exact: true })).toBeVisible();
    const body = clean(await c.innerText());
    for (const line of DRAFT_TEXT.split('\n')) expect(body, `the quote shows "${line}"`).toContain(line);
    expect(body, 'no phone number on the card').not.toMatch(/082|555|0199/);
    for (const name of ['Approve', 'Edit', 'Decline']) await expect(button(c, name), name).toBeVisible();
    expect(chat!.decisions('approve').length + chat!.decisions('reject').length, 'nothing decided yet').toBe(0);
  });

  test('AC-12 Approve: Approved by the server\'s name, the time, View employee to the new person, then the added and welcome email lines', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    const c = await toCard(page, signIn, hr, chat!);
    chat!.approve = (_b, id) => approved(id);
    await button(c, 'Approve').click();
    await expect(c.getByText(W.approved, { exact: true }).first()).toBeVisible();
    await expect(c.getByText(W.approvedBy(SERVER_NAME), { exact: true }), 'the name comes from the server\'s answer').toBeVisible();
    await expect(c.locator('time'), 'with the time').toBeVisible();
    const link = c.getByRole('link', { name: W.viewEmployee, exact: true });
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href'), 'to the new person\'s page').toMatch(new RegExp(`/hr/employees/${EMP_ID}$`));
    await expect(c.getByRole('link', { name: W.audit }), 'not the audit trail (there is no audit page)').toHaveCount(0);
    await expect(log(page).getByText(W.added('Kagiso Molefe'), { exact: true })).toBeVisible();
    await expect(log(page).getByText(W.sent('kagiso.molefe@mail-a.example'), { exact: true })).toBeVisible();
    await expect(button(c, 'Approve'), 'no second approve').toHaveCount(0);
    const calls = chat!.decisions('approve');
    expect(calls.length, 'one approval').toBe(1);
    expect(calls[0]!.path).toMatch(/\/agent\/v1\/actions\/act-chat06-screen\/approve$/);
    expect(calls[0]!.authorization, 'as the signed-in person').toMatch(/^Bearer eyJ/);
    expect(JSON.stringify(calls[0]!.body ?? {}), 'an empty body: nothing changed').toBe('{}');
  });

  test('AC-12 Approve when the welcome email was not sent says so in the register page\'s words', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    const c = await toCard(page, signIn, hr, chat!);
    chat!.approve = (_b, id) => approved(id, { result: { employee_id: EMP_ID, name: 'Kagiso Molefe', email: 'kagiso.molefe@mail-a.example', email_sent: false } });
    await button(c, 'Approve').click();
    await expect(c.getByText(W.approvedBy(SERVER_NAME), { exact: true })).toBeVisible();
    await expect(log(page).getByText(W.notSent('Kagiso'), { exact: true })).toBeVisible();
    await expect(log(page).getByText(W.sent('kagiso.molefe@mail-a.example'), { exact: true })).toHaveCount(0);
  });

  test('AC-12 Edit opens a drawer with the six details; Back sends nothing; Approve in it sends only the changes and says "Approved with changes by"', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    const c = await toCard(page, signIn, hr, chat!);
    await button(c, 'Edit').click();
    const d = drawer(page);
    await expect(d, 'a drawer headed with the card\'s title').toBeVisible();
    const want: Record<string, string> = { 'First name': 'Kagiso', 'Last name': 'Molefe', 'Email address': 'kagiso.molefe@mail-a.example', 'Phone number': '082 555 0199', Department: 'Finance', 'Job title': 'Payroll Clerk' };
    for (const label of W.labels) {
      const f = d.getByLabel(label, { exact: true });
      await expect(f, `${label} is there`).toBeVisible();
      expect(await valueOf(f), `${label} is filled from the draft`).toBe(want[label]);
    }
    await expect(button(d, 'Approve')).toBeVisible();
    await button(d, 'Back').click();
    await expect(d, 'Back closes it').toBeHidden();
    expect(chat!.decisions('approve').length, 'Back sends nothing').toBe(0);
    await expect(c.getByText(W.waiting, { exact: true }), 'the card still waits').toBeVisible();

    chat!.approve = (_b, id) => approved(id);
    await button(c, 'Edit').click();
    await expect(d).toBeVisible();
    await d.getByLabel('Phone number', { exact: true }).fill('082 555 0123');
    await button(d, 'Approve').click();
    await expect(d).toBeHidden();
    await expect(c.getByText(W.approvedWithChanges(SERVER_NAME), { exact: true })).toBeVisible();
    const calls = chat!.decisions('approve');
    expect(calls.length, 'one approval').toBe(1);
    expect(Object.keys(calls[0]!.body ?? {}), 'the body is { changes } only').toEqual(['changes']);
    const ch = calls[0]!.body.changes ?? {};
    expect(Object.keys(ch).filter((k) => !SIX.includes(k)), 'with the six details and nothing else').toEqual([]);
    expect(ch.phone, 'and the phone the person typed').toBe('082 555 0123');
  });

  test('AC-12 A 400 with fields opens the drawer with the server\'s message under that field, and the card still waits', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    const c = await toCard(page, signIn, hr, chat!);
    chat!.approve = () => ({ status: 400, json: { error: W.checkFields, fields: { phone: W.required } } });
    await button(c, 'Approve').click();
    const d = drawer(page);
    await expect(d, 'the drawer opens').toBeVisible();
    const phone = d.getByLabel('Phone number', { exact: true });
    await expect(phone).toBeVisible();
    await expect(d.getByText(W.required, { exact: true }), 'the server\'s message is shown').toBeVisible();
    const described = await phone.evaluate((el) => {
      const ids = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      return ids.map((i) => document.getElementById(i)?.textContent ?? '').join(' ') + ' ' + (el.closest('.pp-field, [class*="field"]')?.textContent ?? '');
    });
    expect(described, 'under the phone field').toContain(W.required);
    await expect(c.getByText(W.waiting, { exact: true }), 'the card still waits').toBeVisible();
    await expect(c.getByText(W.failed), 'and does not say it did not go through').toHaveCount(0);
  });

  test('AC-12 Decline: the reason step without the untrue help line, then Declined, Declined by the server\'s name, the time, the reason and Batsi did nothing', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    const c = await toCard(page, signIn, hr, chat!);
    chat!.reject = (_b, id) => ({ status: 200, json: { status: 'REJECTED', action_id: id, rejected_by_name: SERVER_NAME, rejected_at: '2026-11-19T10:15:00.000Z' } });
    await button(c, 'Decline').click();
    await expect(c.getByText(W.why, { exact: false })).toBeVisible();
    await expect(c.getByText(W.kept, { exact: false }), 'the help line keeps its true half').toBeVisible();
    await expect(page.getByText(W.learns, { exact: false }), 'and drops "Batsi uses this to suggest better next time."').toHaveCount(0);
    await c.getByRole('textbox').fill('He is already on the payroll');
    await button(c, W.declineProposal).click();
    await expect(c.getByText(W.declined, { exact: true }).first()).toBeVisible();
    await expect(c.getByText(W.declinedBy(SERVER_NAME), { exact: true })).toBeVisible();
    await expect(c.locator('time'), 'with the time').toBeVisible();
    await expect(c.getByText('He is already on the payroll', { exact: false }), 'the reason').toBeVisible();
    await expect(c.getByText(W.nothingDone, { exact: true })).toBeVisible();
    const calls = chat!.decisions('reject');
    expect(calls.length).toBe(1);
    expect(calls[0]!.body, 'the reason is sent').toEqual({ reason: 'He is already on the payroll' });
    expect(chat!.decisions('approve').length).toBe(0);
  });

  test('AC-12 A refused run or a refusal says it did not go through and nothing was changed; an unknown outcome never says so', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    const c = await toCard(page, signIn, hr, chat!);
    chat!.approve = (_b, id) => ({ status: 200, json: { status: 'APPROVED', action_id: id, run_status: 'REFUSED', error_code: 'ALREADY_EXISTS', approved_by_name: SERVER_NAME, approved_at: '2026-11-19T10:12:00.000Z' } });
    await button(c, 'Approve').click();
    await expect(c.getByText(W.didNotGoThrough, { exact: true }).first(), 'a 200 that says REFUSED is not shown as done').toBeVisible();
    await expect(c.getByText(W.failed, { exact: true })).toBeVisible();
    await expect(c.getByText(W.approvedBy(SERVER_NAME), { exact: true }), 'never "Approved by"').toHaveCount(0);
    await expect(c.getByRole('link', { name: W.viewEmployee }), 'and no link to an employee').toHaveCount(0);
  });

  test('AC-12 An unknown outcome shows C6-3, not "Nothing was changed"; a 409 shows that nothing was changed', async ({ page, signIn, hr, chat }) => {
    noBackendOnly();
    const c = await toCard(page, signIn, hr, chat!);
    chat!.approve = (_b, id) => ({ status: 200, json: { status: 'APPROVED', action_id: id, run_status: 'FAILED', error_code: 'RUN_UNKNOWN', approved_by_name: SERVER_NAME, approved_at: '2026-11-19T10:12:00.000Z' } });
    await button(c, 'Approve').click();
    await expect(c.getByText(W.unknown('Kagiso', 'Molefe'), { exact: true })).toBeVisible();
    await expect(c.getByText(W.failed), 'it may have finished, so it never says nothing was changed').toHaveCount(0);
    await expect(c.getByText(W.approvedBy(SERVER_NAME), { exact: true })).toHaveCount(0);

    // A second card, refused outright by the server (409).
    const second: Proposal = { ...CARD, actionId: 'act-chat06-screen-2', title: W.question('Lerato', 'Dube'), draft: 'Email address: lerato.dube@mail-a.example\nDepartment: Finance\nJob title: Payroll Clerk', fields: { ...DETAILS, first_name: 'Lerato', last_name: 'Dube', email: 'lerato.dube@mail-a.example' } };
    chat!.reply = () => ({ message: second.title, proposals: [second] });
    chat!.approve = () => ({ status: 409, json: { error: 'This proposal is already EXPIRED', status: 'EXPIRED' } });
    await composer(page).fill('Register Lerato Dube too');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const c2 = log(page).getByRole('article', { name: second.title });
    await expect(c2).toBeVisible();
    await button(c2, 'Approve').click();
    await expect(c2.getByText(W.failed, { exact: true })).toBeVisible();
    await expect(c2.getByText(W.unknown('Lerato', 'Dube'))).toHaveCount(0);
  });
});

/** True when the middle of this box is covered by the top bar (it would sit under it). */
async function underTopBar(page: Page, box: { x: number; y: number; width: number; height: number }): Promise<boolean> {
  return page.evaluate(([x, y]) => { const e = document.elementFromPoint(x!, y!); return !!e?.closest('.pp-top-navigation'); }, [box.x + box.width / 2, box.y + box.height / 2]);
}

test.describe('AC-13 The card and the drawer on a phone', () => {
  test('AC-13 At 390 wide: Approve, Edit, Decline in that order and on screen; the drawer\'s fields and buttons are visible, not under the top bar, with no sideways scroll', async ({ page, signIn, hr, chat }, info) => {
    noBackendOnly();
    test.skip(info.project.name !== 'phone-390', 'Phone only.');
    const c = await toCard(page, signIn, hr, chat!);
    const vp = page.viewportSize()!;
    const names = await c.getByRole('button').evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()).filter((t) => ['Approve', 'Edit', 'Decline'].includes(t)));
    expect(names, 'the buttons read Approve, Edit, Decline').toEqual(['Approve', 'Edit', 'Decline']);
    for (const name of ['Approve', 'Edit', 'Decline']) {
      const b = button(c, name);
      await b.scrollIntoViewIfNeeded();
      await expect(b).toBeVisible();
      const box = (await b.boundingBox())!;
      expect(box.x >= -0.5 && box.x + box.width <= vp.width + 0.5, `${name} is inside the screen`).toBe(true);
      expect(await underTopBar(page, box), `${name} is not under the top bar`).toBe(false);
    }
    await button(c, 'Edit').click();
    const d = drawer(page);
    await expect(d).toBeVisible();
    const top = await page.locator('.pp-top-navigation').boundingBox();
    for (const label of W.labels) {
      const f = d.getByLabel(label, { exact: true });
      await f.scrollIntoViewIfNeeded();
      await expect(f, `${label} visible`).toBeVisible();
      const box = (await f.boundingBox())!;
      expect(box.x >= -0.5 && box.x + box.width <= vp.width + 0.5, `${label} inside the screen`).toBe(true);
      if (top && top.height > 0) expect(await underTopBar(page, box), `${label} is not under the top bar`).toBe(false);
    }
    for (const name of ['Approve', 'Back']) {
      const b = button(d, name);
      await b.scrollIntoViewIfNeeded();
      await expect(b, name).toBeVisible();
      const box = (await b.boundingBox())!;
      expect(box.y + box.height <= vp.height + 0.5 && box.x + box.width <= vp.width + 0.5, `${name} on screen`).toBe(true);
      expect(await underTopBar(page, box), `the drawer's ${name} is not under the top bar`).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll').toBe(true);
    await d.getByLabel('Phone number', { exact: true }).fill('082 555 0123');
    await expect(d.getByLabel('Phone number', { exact: true }), 'the phone field takes typing').toHaveValue('082 555 0123');
  });
});
