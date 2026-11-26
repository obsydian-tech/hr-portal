import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestInfo } from '@playwright/test';
import { ON_DEV, expect, test, type Login, type SignInPage } from './support/fixtures';
import { blocks } from './support/infra-harness';
import { COMPANY_A as OB11_A, COMPANY_B as OB11_B, CLASSIFY, ENV as OB11_ENV, aiReached, flowEvent, modelCalls, personOf, row as ob11Row, runHandler, writesTo, type Run as FlowRun, type World as FlowWorld } from './support/onb-11/lambda-harness';
import {
  RESEND_ENV, STATE_MACHINE_ARN, existingUser, resendOnce, type Run62, type SfnMode, type Who, type World62,
} from './support/rec-06.2/lambda-harness';
import { runSeed } from './support/rec-06.2/seed';
import {
  A, B, EMPLOYEE_A, HR_A, HR_B, IDS, PEOPLE, ROBOT_HR_A, handAdded, person, recruitmentHire, worldWith, type Person,
} from './support/rec-06.2/world';
import { baseCommit, baseInfra, changedFiles, envOf, nowInfra, resource, resourceKeys, squash, statementKey, statementsOf, textAt, textNow, withoutEnv } from './support/rec-06.2/terraform';

/**
 * REC-06.2 · Start the onboarding workflow for recruitment hires (red). Jira NH-285. Follows REC-06 (NH-240) and REC-16 (NH-283).
 * Spec: /mnt/project-files/onboarding-cards/specs/REC-06.2.md (rules 1 to 16, AC-1 to AC-11; spec check round 2 passed 26 Nov 2026).
 * Notes and the choices the spec leaves open: cards/rec-06.2.md.
 *
 * Lambda tests (AC-1 to AC-7, AC-10) run the real lambda/resendInvite (and, for AC-10, the real classifyOnboardingRisk) in a fresh Node process each
 * (a cold Lambda), against support/rec-06.2/fake-aws (ONB-18's fake AWS; only Step Functions is changed: it records every StartExecution with its input
 * and can answer success, ExecutionAlreadyExists, AccessDeniedException, a throttle, or never). The clock is fixed; timers are real, so the 3-second limit
 * of AC-4 (c) really takes 3 seconds. AC-8 and AC-9 read infra/ and the Lambda folder as text and judge THIS CHANGE (the pull request's own diff against
 * its base, support/rec-06.2/terraform.ts), never a fixed commit, so another card merging first cannot turn them red. AC-11 has three parts: the seed's own
 * function run against an in-memory DynamoDB (support/rec-06.2/fake-boto3), and one test on pepla-dev (judged after merge, red until then).
 * Everything runs once, at 1280: nothing here has a screen. Nothing calls AWS, Postmark or any AI service.
 */

// ---------------------------------------------------------------- set-up

function once(testInfo: TestInfo): void {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambdas against a fake AWS or reads the repository as text.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
}

const hire = person('hireA', IDS.hireA);
const hand = person('handA', IDS.handA);
const hireB = person('hireB', IDS.hireB);
const robot = person('robot', IDS.hireA);

const sfnCalls = (r: Run62) => r.calls.filter((c) => c.service === 'sfn') as Array<{ service: 'sfn'; op: string; input?: any; abortSignal?: boolean }>;
const starts = (r: Run62) => sfnCalls(r).filter((c) => c.op === 'StartExecution');
const indexOfCall = (r: Run62, pred: (c: any) => boolean) => r.calls.map((c, i) => (pred(c) ? i : -1)).filter((i) => i >= 0);
type Line = { service: 'log'; level: string; message: string; extra?: unknown };
const logs = (r: Run62): Line[] => r.calls.filter((c) => c.service === 'log') as Line[];
const lineKey = (l: Line) => JSON.stringify([l.level, l.message, l.extra ?? null]);
/** The log lines this run wrote that the same call on a hand-added person (today's code, no workflow) did not: what this card adds. */
function newLines(run: Run62, today: Run62): Line[] {
  const seen = new Map<string, number>();
  for (const l of logs(today)) seen.set(lineKey(l), (seen.get(lineKey(l)) ?? 0) + 1);
  return logs(run).filter((l) => {
    const k = lineKey(l);
    const n = seen.get(k) ?? 0;
    if (n > 0) { seen.set(k, n - 1); return false; }
    return true;
  });
}
/** Every string and number a log line carries beyond its message: the leaves of its extra fields. */
function leaves(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.flatMap(leaves);
  if (typeof v === 'object') return Object.values(v as object).flatMap(leaves);
  return [String(v)];
}
const lineText = (l: Line) => `${l.message} ${leaves(l.extra).join(' ')}`;

const TOKEN43 = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;
const HASH64 = /\b[0-9a-f]{64}\b/g;
/** Text with the random parts (a link token, its hash) replaced, so two runs of the same call can be compared. */
const norm = (v: unknown) => JSON.stringify(v ?? null).replace(TOKEN43, '<token>').replace(HASH64, '<hash>').replace(/00000000-0000-4000-8000-0000000000\d\d/g, '<sub>');
const WRITE_OPS = ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'];
const dyn = (r: Run62) => r.calls.filter((c) => c.service === 'dynamodb') as Array<{ service: 'dynamodb'; op: string; table?: string; input: any }>;
const writes = (r: Run62) => dyn(r).filter((c) => WRITE_OPS.includes(c.op)).map((c) => `${c.op} ${c.table}`);
/** Everything the run did except Step Functions and log lines: the invite, the sign-in, the email, the reads and writes. */
const rest = (r: Run62) => norm(r.calls.filter((c) => c.service !== 'sfn' && c.service !== 'log'));
const mailTo = (r: Run62) => r.calls.filter((c) => c.service === 'postmark').map((c: any) => String(c.message?.To));

function ok(r: Run62, status: number, what: string): void {
  expect(r.hung, `${what}: the handler answered (${r.hung})`).toBeUndefined();
  expect(r.error, `${what}: the handler did not throw (${r.error?.message})`).toBeUndefined();
  expect(r.status, `${what}: HTTP ${status} (got ${r.status}, ${r.raw.slice(0, 300)})`).toBe(status);
}
const sorted = (o: unknown) => Object.keys((o ?? {}) as object).sort();

/** One call of resendInvite, as HR of A unless said otherwise. */
type Variant = { who?: Who; id?: string; sfn?: SfnMode; env?: Record<string, string | undefined>; fail?: Partial<World62>; person?: Person; rows?: Array<ReturnType<typeof recruitmentHire>> };
function recruit(v: Variant = {}): { run: Run62; world: World62 } {
  const p = v.person ?? hire;
  const world: World62 = { ...worldWith(v.rows ?? [recruitmentHire(p, A)], v.fail ?? {}), ...(v.sfn ? { sfn: { mode: v.sfn } } : {}) };
  return { run: resendOnce(world, v.who ?? HR_A, v.id ?? p.id, { env: v.env }), world };
}
/** Today's answer: the same call on a hand-added person (no from_recruitment), where no workflow is ever started from here. */
function today(v: Variant = {}): Run62 {
  const p = v.person ?? hire;
  const rows = v.rows ? v.rows.map((r) => { const c = { ...r }; delete (c as Record<string, unknown>)['from_recruitment']; return c; }) : [handAdded(p, A)];
  const world: World62 = { ...worldWith(rows, v.fail ?? {}), ...(v.sfn ? { sfn: { mode: v.sfn } } : {}) };
  const r = resendOnce(world, v.who ?? HR_A, v.id ?? p.id, { env: v.env });
  expect(starts(r), 'today: a hand-added person starts nothing from resendInvite').toEqual([]);
  return r;
}
/** The answer matches today's: same status, same body (a link token aside). */
function sameAnswer(run: Run62, base: Run62, what: string): void {
  expect(run.status, `${what}: the same status as today`).toBe(base.status);
  expect(norm(run.body), `${what}: the same answer body as today`).toBe(norm(base.body));
}

// ---------------------------------------------------------------- the tests

test.describe('REC-06.2 Start the onboarding workflow for recruitment hires', () => {
  // -------------------------------------------------------------- AC-1
  test('AC-1 The start: HR of A sends the invite to a recruitment hire (INVITED, from_recruitment map): 200 as today, exactly one StartExecution with the ARN from the setting, the name onboarding-<employee_id> and an input of {"employeeId": ...} only, and nothing written beyond today\'s invite row', async ({}, testInfo) => {
    once(testInfo);
    const { run, world } = recruit();
    const base = today();
    ok(run, 200, 'HR of A sends the invite to the recruitment hire');
    expect(run.body.status, 'the answer says ok').toBe('ok');
    expect(sorted(run.body), 'the answer has exactly today\'s fields (written out, so a field added for everyone is caught too)').toEqual(['email', 'expiresAt', 'sentAt', 'sentTo', 'status']);
    expect(sorted(run.body.email), 'and the email part has exactly today\'s fields').toEqual(['sent']);
    expect(sorted(run.body), 'and the same fields as the hand-added person\'s').toEqual(sorted(base.body));
    expect(run.body.sentTo, 'sentTo is the person\'s address as today').toBe(hire.email);
    sameAnswer(run, base, 'AC-1');
    const s = starts(run);
    expect(s, 'exactly one StartExecution').toHaveLength(1);
    const call = s[0]!.input as Record<string, unknown>;
    expect(sorted(call), 'the call has only stateMachineArn, name and input').toEqual(['input', 'name', 'stateMachineArn']);
    expect(call['stateMachineArn'], 'the state machine is the one in the SFN_STATE_MACHINE_ARN setting').toBe(STATE_MACHINE_ARN);
    expect(call['name'], 'the name is onboarding-<employee_id>').toBe(`onboarding-${hire.id}`);
    expect(String(call['name']).length, 'a 36-character id makes a 47-character name').toBe(47);
    expect(typeof call['input'], 'the input is JSON text').toBe('string');
    expect(JSON.parse(String(call['input'])), 'the input is {"employeeId": <employee_id>} and nothing else').toEqual({ employeeId: hire.id });
    expect(String(call['input']), 'no email, name, phone, stage or company in the input').not.toMatch(/@|naledi|dlamini|082|INVITED|ten_|tenant|stage/i);
    // Nothing written beyond what resendInvite writes today: the same writes as for a hand-added person, none on employees.
    expect(writes(run), 'the same writes as today (the invite row, the company member row)').toEqual(writes(base));
    expect(writes(run).filter((w) => /\bemployees$/.test(w)), 'no write to employees').toEqual([]);
    expect(norm(run.world.tables['employees']), 'the employees table is exactly as it was').toBe(norm(world.tables['employees']));
    expect(sfnCalls(run).filter((c) => c.op !== 'StartExecution'), 'no other Step Functions call').toEqual([]);
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 Only recruitment hires: a person added by hand (no from_recruitment, or a NULL one) gets no Step Functions call at all, and the answer is as today', async ({}, testInfo) => {
    once(testInfo);
    const handRun = resendOnce(worldWith([handAdded(hand, A)]), HR_A, hand.id);
    ok(handRun, 200, 'HR of A sends the invite to a hand-added person');
    expect(sfnCalls(handRun), 'a hand-added person: no Step Functions call of any kind').toEqual([]);
    expect(handRun.body.status).toBe('ok');
    expect(handRun.body.sentTo).toBe(hand.email);
    expect(handRun.body.email, 'the email goes out as today').toEqual({ sent: true });
    expect(handRun.body.invite, 'no link in the answer for a real address').toBeUndefined();
    // A row whose from_recruitment is a NULL, an empty text or a plain text is not "a from_recruitment map".
    for (const [what, attr] of [['a NULL', { NULL: true }], ['an empty text', { S: '' }], ['a text', { S: 'yes' }]] as const) {
      const r = recruitmentHire(hand, A);
      r['from_recruitment'] = attr as never;
      const run = resendOnce(worldWith([r]), HR_A, hand.id);
      ok(run, 200, `from_recruitment is ${what}`);
      expect(sfnCalls(run), `from_recruitment as ${what}: no Step Functions call`).toEqual([]);
    }
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 Only after a good invite: no Step Functions call and today\'s answer for a non-HR caller (403), another company\'s row (404), an unknown id (404), a stage that is not INVITED (409 not-invited), a refused invite (409 refused) and a failed invite (502 failed); a failed or skipped email still starts one run, after the email attempt', async ({}, testInfo) => {
    once(testInfo);
    const cases: Array<[string, Variant, number, string | undefined]> = [
      ['a non-HR caller', { who: EMPLOYEE_A }, 403, undefined],
      ['another company\'s HR on this hire', { who: HR_B }, 404, undefined],
      ['an id nobody has', { id: '5f1c0a9e-0000-4c2a-9e1d-2b6f8a4c3eff' }, 404, undefined],
      ['a stage that is not INVITED', { rows: [recruitmentHire(hire, A, { stage: 'DOCUMENTS_SUBMITTED' })] }, 409, 'not-invited'],
      ['a stage that is ACTIVE', { rows: [recruitmentHire(hire, A, { stage: 'ACTIVE' })] }, 409, 'not-invited'],
      ['a refused invite (the address has a sign-in in use)', { fail: { cognito: { users: [existingUser(hire.email, 'CONFIRMED', ['employee'])] } } as never }, 409, 'refused'],
      ['a failed invite (Cognito is down)', { fail: { cognitoFail: ['AdminCreateUser'] } }, 502, 'failed'],
    ];
    for (const [what, v, status, word] of cases) {
      const run = recruit(v).run;
      ok(run, status, what);
      if (word) expect(run.body.status, `${what}: the answer says ${word}`).toBe(word);
      expect(sfnCalls(run), `${what}: no Step Functions call`).toEqual([]);
      sameAnswer(run, today(v), what);
    }

    // An email that fails: still one start, after the email attempt. An email skipped as a test send: still one start, after the invite row.
    const failed = recruit({ fail: { postmarkFail: true } }).run;
    ok(failed, 200, 'the email fails');
    expect(failed.body.email, 'the answer says the email was not sent, as today').toEqual({ sent: false });
    expect(starts(failed), 'a failed email: one start').toHaveLength(1);
    const attempts = indexOfCall(failed, (c) => c.service === 'postmark');
    expect(attempts.length, 'the email was tried').toBeGreaterThan(0);
    expect(indexOfCall(failed, (c) => c.service === 'sfn' && c.op === 'StartExecution')[0]!, 'the start comes after the email attempt').toBeGreaterThan(Math.max(...attempts));

    const test1 = recruit({ person: robot, who: ROBOT_HR_A, rows: [recruitmentHire(robot, A)] }).run;
    ok(test1, 200, 'a test address and a test login (the email is skipped)');
    expect(test1.body.email, 'the email is skipped as a test send, as today').toEqual({ sent: false, skipped: 'test' });
    expect(starts(test1), 'a test send: one start').toHaveLength(1);
    const inviteWrites = indexOfCall(test1, (c) => c.service === 'dynamodb' && c.op === 'PutItem' && c.table === 'employee_invites');
    expect(inviteWrites, 'the invite row was written').toHaveLength(1);
    expect(indexOfCall(test1, (c) => c.service === 'sfn' && c.op === 'StartExecution')[0]!, 'the start comes after the invite exists').toBeGreaterThan(inviteWrites[0]!);
    expect(test1.body.invite?.link, 'dev test link as today').toMatch(/\/set-password#token=/);

    const sent = recruit().run;
    const mail = indexOfCall(sent, (c) => c.service === 'postmark');
    expect(mail, 'the email is sent').toHaveLength(1);
    expect(indexOfCall(sent, (c) => c.service === 'sfn' && c.op === 'StartExecution')[0]!, 'the start comes after the email is sent').toBeGreaterThan(mail[0]!);
    const invitePut = indexOfCall(sent, (c) => c.service === 'dynamodb' && c.op === 'PutItem' && c.table === 'employee_invites');
    expect(indexOfCall(sent, (c) => c.service === 'sfn' && c.op === 'StartExecution')[0]!, 'and after the invite row').toBeGreaterThan(invitePut[0]!);
  });

  // -------------------------------------------------------------- AC-4
  test('AC-4 Repeats and failures never touch the answer: (a) a second send while the run waits, (b) ExecutionAlreadyExists, (c) AccessDeniedException, a throttle and a call that never returns (3-second limit), (d) no state machine setting', async ({}, testInfo) => {
    once(testInfo);
    const base = today();
    ok(base, 200, 'today\'s answer');

    // (a) A second send while the first run still waits: the same name and the same input, the fake answers success again.
    const first = recruit();
    ok(first.run, 200, '(a) the first send');
    const second = resendOnce(first.run.world, HR_A, hire.id);
    ok(second, 200, '(a) the second send');
    expect(sorted(second.body), '(a) the same answer fields').toEqual(sorted(base.body));
    sameAnswer(second, base, '(a) a second send');
    expect(starts(second), '(a) one more StartExecution').toHaveLength(1);
    expect(starts(second)[0]!.input, '(a) with the same name, the same input and the same state machine').toEqual(starts(first.run)[0]!.input);

    // (b) ExecutionAlreadyExists (the run is closed, or the input differs): 200, same answer, no warning or error, one info line.
    const exists = recruit({ sfn: 'exists' }).run;
    ok(exists, 200, '(b) ExecutionAlreadyExists');
    sameAnswer(exists, base, '(b)');
    expect(starts(exists), '(b) one call').toHaveLength(1);
    const bLines = newLines(exists, base);
    expect(bLines.filter((l) => l.level === 'warn' || l.level === 'error' || l.level.startsWith('console.warn') || l.level.startsWith('console.error')), '(b) no warning and no error line').toEqual([]);
    const info = bLines.filter((l) => l.level === 'info' || l.level.startsWith('console.info') || l.level.startsWith('console.log'));
    expect(info, '(b) exactly one new line, and it is an info line').toHaveLength(1);
    expect(bLines, '(b) and it is the only new line').toHaveLength(1);
    expect(info[0]!.message, '(b) with the fixed words "already started"').toMatch(/already started/i);
    expect(leaves(info[0]!.extra), '(b) and the employee id only').toEqual([hire.id]);

    // (c) AccessDeniedException, a throttle, and a call that never returns: 200, same answer, one call, one warning with the id and the error name.
    for (const [mode, names] of [['denied', ['AccessDeniedException']], ['throttle', ['ThrottlingException']], ['hang', ['AbortError', 'TimeoutError']]] as Array<[SfnMode, string[]]>) {
      const r = recruit({ sfn: mode }).run;
      ok(r, 200, `(c) ${mode}`);
      sameAnswer(r, base, `(c) ${mode}`);
      expect(starts(r), `(c) ${mode}: one call, no retry loop`).toHaveLength(1);
      expect(starts(r)[0]!.abortSignal, `(c) ${mode}: the call carries an abort signal (rule 5)`).toBe(true);
      const nl = newLines(r, base);
      expect(nl, `(c) ${mode}: exactly one new log line`).toHaveLength(1);
      expect(nl[0]!.level, `(c) ${mode}: a warning`).toMatch(/warn/);
      const l = leaves(nl[0]!.extra);
      expect(l, `(c) ${mode}: it holds the employee id`).toContain(hire.id);
      expect(l.filter((x) => x !== hire.id), `(c) ${mode}: and only the error name besides`).toHaveLength(1);
      expect(names, `(c) ${mode}: the error name is ${names.join(' or ')}`).toContain(l.find((x) => x !== hire.id));
      if (mode === 'hang') {
        expect(r.ms, '(c) a call that never returns ends at the 3-second limit, not before').toBeGreaterThanOrEqual(2800);
        expect(r.ms, '(c) and within 4.5 seconds: the limit is 3 seconds (rule 5), the rest is the process starting; a 5-second or 10-second limit is not the card').toBeLessThan(4500);
      }
    }

    // (d) The setting is empty or missing: no call, 200, same answer, one info line saying no workflow is set.
    for (const [what, value] of [['empty', ''], ['missing', undefined]] as const) {
      const r = recruit({ env: { SFN_STATE_MACHINE_ARN: value } }).run;
      ok(r, 200, `(d) the setting is ${what}`);
      sameAnswer(r, base, `(d) ${what}`);
      expect(sfnCalls(r), `(d) ${what}: no Step Functions call`).toEqual([]);
      const nl = newLines(r, base);
      expect(nl, `(d) ${what}: exactly one new log line`).toHaveLength(1);
      expect(nl[0]!.level, `(d) ${what}: an info line`).toMatch(/info|console\.(log|info)/);
      expect(lineText(nl[0]!), `(d) ${what}: it says no workflow is set`).toMatch(/workflow|SFN_STATE_MACHINE_ARN/i);
      expect(leaves(nl[0]!.extra).filter((x) => x !== hire.id), `(d) ${what}: and holds no id but the employee id`).toEqual([]);
    }
  });

  // -------------------------------------------------------------- AC-5
  test('AC-5 Company B: HR of B on A\'s hire is 404 with no Step Functions call and nothing written; HR of B on B\'s own recruitment hire starts one run, with no company in the input and a name that is not A\'s; nothing of A in B\'s answer', async ({}, testInfo) => {
    once(testInfo);
    const rows = [recruitmentHire(hire, A), recruitmentHire(hireB, B, { hr_staff_id: 'HRB001', created_by: 'HRB001' }, { candidate_id: 'CAND-REC062-B001', offer_id: 'offer-rec062-b001' })];
    const world = worldWith(rows);
    const cross = resendOnce(world, HR_B, hire.id);
    ok(cross, 404, 'HR of B on A\'s hire');
    expect(sfnCalls(cross), 'B on A\'s hire: no Step Functions call').toEqual([]);
    expect(writes(cross), 'B on A\'s hire: nothing written').toEqual([]);
    expect(cross.calls.filter((c) => c.service === 'cognito' || c.service === 'postmark'), 'B on A\'s hire: no sign-in made, no email').toEqual([]);
    expect(norm(cross.body), 'B on A\'s hire: the answer is the plain "not found"').toBe(norm({ error: 'Not found' }));

    const own = resendOnce(world, HR_B, hireB.id);
    ok(own, 200, 'HR of B on B\'s own recruitment hire');
    expect(starts(own), 'B on B\'s own hire: one start').toHaveLength(1);
    const call = starts(own)[0]!.input as Record<string, unknown>;
    expect(call['name'], 'the name is onboarding-<B\'s employee id>').toBe(`onboarding-${hireB.id}`);
    expect(call['name'], 'and not A\'s').not.toBe(`onboarding-${hire.id}`);
    expect(JSON.parse(String(call['input'])), 'the input is B\'s employee id only').toEqual({ employeeId: hireB.id });
    expect(JSON.stringify(call), 'no company in the call').not.toMatch(/ten_[0-9a-z]{26}|tenant/i);
    const seen = JSON.stringify([own.body, own.calls.filter((c) => c.service === 'postmark')]);
    for (const [what, value] of [['A\'s employee id', hire.id], ['A\'s address', hire.email], ['A\'s first name', 'Naledi'], ['A\'s last name', 'Dlamini'], ['A\'s company', A]] as const) {
      expect(seen, `nothing of A in B's answer or B's email: ${what}`).not.toContain(value);
    }
    expect(mailTo(own), 'the email goes to B\'s person only').toEqual([hireB.email]);
    expect(norm(own.world.tables['employees']), 'B\'s run writes nothing to employees').toBe(norm(world.tables['employees']));
    // The same call by A on A's hire still starts A's own run.
    const a = resendOnce(world, HR_A, hire.id);
    expect(starts(a).map((s) => s.input.name), 'A on A\'s hire: A\'s run').toEqual([`onboarding-${hire.id}`]);
  });

  // -------------------------------------------------------------- AC-6
  test('AC-6 Nothing else moves: for a recruitment hire the invite row, the sign-in calls, the email call and the answer equal what the same call makes for a hand-added person; no event, no extra email, no write to employees', async ({}, testInfo) => {
    once(testInfo);
    for (const [what, p, who] of [['a real address', hire, HR_A], ['a test address and a test login', robot, ROBOT_HR_A]] as Array<[string, Person, Who]>) {
      const run = recruit({ person: p, who, rows: [recruitmentHire(p, A)] }).run;
      const base = today({ person: p, who, rows: [handAdded(p, A) as never] });
      ok(run, 200, what);
      expect(rest(run), `${what}: every call except Step Functions and log lines equals the hand-added person's (invite row, sign-in, email, reads)`).toBe(rest(base));
      sameAnswer(run, base, what);
      expect(sorted(run.body), `${what}: exactly today's fields (written out)`).toEqual(p === robot ? ['email', 'expiresAt', 'invite', 'sentAt', 'sentTo', 'status'] : ['email', 'expiresAt', 'sentAt', 'sentTo', 'status']);
      expect(norm(run.world.tables['employee_invites']), `${what}: the invite row equals the hand-added person's`).toBe(norm(base.world.tables['employee_invites']));
      const signIn = (r: Run62) => norm(r.world.cognito.users.filter((u) => u.username.toLowerCase() === p.email.toLowerCase()));
      expect(signIn(run), `${what}: the sign-in made for the person equals the hand-added person's`).toBe(signIn(base));
      expect(signIn(run), `${what}: and it exists`).not.toBe('[]');
      expect(run.calls.filter((c) => c.service === 'events'), `${what}: no event is published`).toEqual([]);
      expect(mailTo(run).length, `${what}: no extra email`).toBe(mailTo(base).length);
      expect(writes(run).filter((w) => /\bemployees$/.test(w)), `${what}: no write to employees`).toEqual([]);
    }
  });

  // -------------------------------------------------------------- AC-7
  test('AC-7 Logs: every new log line holds only the employee id and an error name (or fixed words); no email, name, phone, invite link, token, company id or input, in any outcome', async ({}, testInfo) => {
    once(testInfo);
    const base = today();
    const base2 = today({ fail: { postmarkFail: true } });
    const FORBIDDEN: Array<[string, RegExp]> = [
      ['the address', /naledi\.dlamini|private-mail\.example|@/i],
      ['a name', /naledi|dlamini/i],
      ['the phone number', /082\s?555\s?0199|0825550199/],
      ['an invite link', /set-password|http/i],
      ['a token', /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/],
      ['the company id', /ten_[0-9a-z]{26}/],
      ['the input', /\{\\?"employeeId\\?"|stateMachineArn|"input"/],
    ];
    const outcomes: Array<[string, Run62, Run62]> = [
      ['started', recruit().run, base],
      ['already started', recruit({ sfn: 'exists' }).run, base],
      ['access denied', recruit({ sfn: 'denied' }).run, base],
      ['throttled', recruit({ sfn: 'throttle' }).run, base],
      ['never returns', recruit({ sfn: 'hang' }).run, base],
      ['no state machine set', recruit({ env: { SFN_STATE_MACHINE_ARN: '' } }).run, base],
      ['the email failed', recruit({ fail: { postmarkFail: true } }).run, base2],
    ];
    const allowed = new Set([hire.id, 'AccessDeniedException', 'ThrottlingException', 'AbortError', 'TimeoutError', 'ExecutionAlreadyExists']);
    for (const [what, run, baseline] of outcomes) {
      ok(run, 200, what);
      for (const l of newLines(run, baseline)) {
        const text = lineText(l);
        for (const [thing, re] of FORBIDDEN) expect(text, `${what}: the new log line holds no ${thing}: ${text}`).not.toMatch(re);
        const keys = ([] as unknown[]).concat(l.extra ?? []).flatMap((x) => (x && typeof x === 'object' ? Object.keys(x as object) : []));
        expect(keys.filter((k) => !['employeeId', 'error', 'errorName', 'name'].includes(k)), `${what}: the new log line has only the fields employeeId and error: ${text}`).toEqual([]);
        expect(leaves(l.extra).filter((x) => !allowed.has(x)), `${what}: the new log line carries only the employee id and an error name: ${text}`).toEqual([]);
      }
    }
  });

  // -------------------------------------------------------------- AC-8
  test('AC-8 Terraform and the package, as text, judged on this change: resend_invite\'s policy is today\'s plus exactly one statement (states:StartExecution on the onboarding state machine), its setting is today\'s plus SFN_STATE_MACHINE_ARN, timeout still 15, nothing else in infra/ changes, and the package lists the Step Functions client under devDependencies only', async ({}, testInfo) => {
    once(testInfo);
    const base = baseCommit();
    const before = baseInfra(base);
    const after = nowInfra();

    // Only the two files this card needs may change in infra/ (nothing else in Terraform: not apigateway.tf, kms.tf, stepfunctions.tf, any other role, Lambda, rule, table or key).
    const infraChanged = changedFiles(base).filter((f) => f.startsWith('infra/'));
    expect(infraChanged.filter((f) => f !== 'infra/iam_per_lambda.tf' && f !== 'infra/lambdas.tf'), 'infra/ changes only in iam_per_lambda.tf and lambdas.tf').toEqual([]);
    for (const f of ['infra/kms.tf', 'infra/stepfunctions.tf', 'infra/apigateway.tf', 'infra/step-functions/naleko-onboarding-flow.asl.json']) {
      expect(textNow(f), `${f} is exactly as at the base`).toBe(textAt(base, f));
    }
    expect(infraChanged.filter((f) => f.includes('step-functions')), 'the workflow definition is untouched').toEqual([]);

    // The role policy: today's statements plus exactly one.
    const policyBefore = resource(before, 'aws_iam_role_policy', 'resend_invite');
    const policyAfter = resource(after, 'aws_iam_role_policy', 'resend_invite');
    expect(policyBefore, 'resend_invite\'s policy exists at the base').toBeTruthy();
    expect(policyAfter, 'resend_invite\'s policy exists').toBeTruthy();
    const was = statementsOf(policyBefore!).map(statementKey);
    const now = statementsOf(policyAfter!);
    const gained = now.filter((s) => !was.includes(statementKey(s)));
    expect(was.filter((k) => !now.map(statementKey).includes(k)), 'no statement of today\'s is lost or changed').toEqual([]);
    expect(gained, 'exactly one statement is added').toHaveLength(1);
    const g = gained[0]!;
    expect(g.Effect, 'it allows').toBe('Allow');
    expect([].concat((g.Action ?? []) as never), 'the one action is states:StartExecution').toEqual(['states:StartExecution']);
    expect([].concat((g.Resource ?? []) as never), 'on the onboarding state machine: one ARN, no wildcard').toEqual(['aws_sfn_state_machine.onboarding.arn']);
    expect(g.Condition, 'no condition').toBeUndefined();
    expect(g.NotAction ?? g.NotResource, 'no NotAction or NotResource').toBeUndefined();
    expect(squash(resource(after, 'aws_iam_role', 'resend_invite')!.raw), 'the role itself is unchanged').toBe(squash(resource(before, 'aws_iam_role', 'resend_invite')!.raw));

    // Every other role policy and every role is as at the base; no new role, Lambda, rule, table or table item.
    const keysBefore = resourceKeys(before);
    const keysAfter = resourceKeys(after);
    expect(keysAfter.filter((k) => !keysBefore.includes(k)).filter((k) => /^(aws_iam_|aws_lambda_function\.|aws_cloudwatch_event_|aws_dynamodb_table)/.test(k)), 'no new aws_iam_* (role, role policy, attachment, policy), aws_lambda_function, aws_cloudwatch_event_*, aws_dynamodb_table* or aws_dynamodb_table_item').toEqual([]);
    expect(keysBefore.filter((k) => !keysAfter.includes(k)), 'no resource is removed').toEqual([]);
    for (const type of ['aws_iam_role_policy', 'aws_iam_role']) {
      for (const b of blocks(before, 'resource').filter((x) => x.labels[0] === type && x.labels[1] !== 'resend_invite')) {
        expect(squash(resource(after, type, b.labels[1]!)?.raw ?? ''), `${type}.${b.labels[1]} is unchanged`).toBe(squash(b.raw));
      }
    }

    // The function: its setting is today's plus one key; everything else about it, and every other function, is as it was.
    const fnBefore = resource(before, 'aws_lambda_function', 'resend_invite');
    const fnAfter = resource(after, 'aws_lambda_function', 'resend_invite');
    expect(fnAfter, 'the resend_invite function exists').toBeTruthy();
    const envBefore = envOf(fnBefore!);
    const envAfter = envOf(fnAfter!);
    expect(envBefore.size, 'the setting block can be read (today it has nine keys)').toBeGreaterThanOrEqual(9);
    expect(envAfter.get('SFN_STATE_MACHINE_ARN'), 'SFN_STATE_MACHINE_ARN is the onboarding state machine\'s ARN').toBe('aws_sfn_state_machine.onboarding.arn');
    expect([...envAfter.keys()].filter((k) => !envBefore.has(k)), 'exactly one key is added').toEqual(['SFN_STATE_MACHINE_ARN']);
    for (const [k, v] of envBefore) expect(envAfter.get(k), `the key ${k} is unchanged`).toBe(v);
    expect(fnAfter!.attrs.get('timeout'), 'the timeout is still 15').toBe('15');
    expect(withoutEnv(fnAfter!), 'nothing else about the function changes').toBe(withoutEnv(fnBefore!));
    for (const b of blocks(before, 'resource').filter((x) => x.labels[0] === 'aws_lambda_function' && x.labels[1] !== 'resend_invite')) {
      expect(squash(resource(after, 'aws_lambda_function', b.labels[1]!)?.raw ?? ''), `aws_lambda_function.${b.labels[1]} is unchanged`).toBe(squash(b.raw));
    }

    // The package: the client is a devDependency (the build runs npm ci --omit=dev and the runtime ships the SDK), and the lock file agrees.
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'lambda', 'resendInvite', 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect(pkg.devDependencies?.['@aws-sdk/client-sfn'], '@aws-sdk/client-sfn ^3.0.0 is under devDependencies, as createEmployee lists it').toBe('^3.0.0');
    expect(pkg.dependencies?.['@aws-sdk/client-sfn'], 'and not under dependencies').toBeUndefined();
    const lock = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'lambda', 'resendInvite', 'package-lock.json'), 'utf8')) as { packages: Record<string, { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; dev?: boolean }> };
    expect(lock.packages['']?.devDependencies, 'the lock file\'s root agrees with package.json devDependencies (npm ci needs this)').toEqual(pkg.devDependencies);
    expect(lock.packages['']?.dependencies, 'and with dependencies').toEqual(pkg.dependencies);
    expect(lock.packages['node_modules/@aws-sdk/client-sfn'], 'the lock file holds the client itself').toBeTruthy();
    expect(lock.packages['node_modules/@aws-sdk/client-sfn']?.dev, 'as a dev package').toBe(true);

    // The repository's own CI check of roles against code: resendInvite's role must allow what its code now calls.
    let out = '';
    let status = 0;
    try { out = execFileSync('python3', [join(__dirname, '..', '..', '..', 'scripts', 'ci', 'check-permissions.py')], { cwd: join(__dirname, '..', '..', '..'), encoding: 'utf8', stdio: 'pipe' }); } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      status = err.status ?? 1;
      out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    }
    expect(status, `scripts/ci/check-permissions.py passes:\n${out.slice(-1500)}`).toBe(0);
    expect(readFileSync(join(__dirname, '..', '..', '..', 'lambda', 'resendInvite', 'index.mjs'), 'utf8'), 'resendInvite starts the workflow (the grant is for something)').toMatch(/StartExecutionCommand/);
  });

  // -------------------------------------------------------------- AC-9
  test('AC-9 Pins and neighbours: this change touches none of offers.mjs, manageOffers/index.mjs, employee-row.mjs, tenant.mjs, ai-guard.mjs, hiring-managers.mjs and infra/kms.tf, and nothing under classifyOnboardingRisk or the workflow definition (judged on this change\'s diff, not against a fixed commit)', async ({}, testInfo) => {
    once(testInfo);
    const base = baseCommit();
    const changed = changedFiles(base);
    const PINNED = ['lambda/shared/offers.mjs', 'lambda/manageOffers/index.mjs', 'lambda/shared/employee-row.mjs', 'lambda/shared/tenant.mjs', 'lambda/shared/ai-guard.mjs', 'lambda/shared/hiring-managers.mjs', 'infra/kms.tf'];
    expect(changed.filter((f) => PINNED.includes(f)), 'none of the seven pinned files is changed by this card').toEqual([]);
    expect(changed.filter((f) => /^lambda\/classifyOnboardingRisk\//.test(f) || /^infra\/step-functions\//.test(f) || f === 'infra/stepfunctions.tf'), 'no file under lambda/classifyOnboardingRisk/ or infra/step-functions/ changes (AC-10)').toEqual([]);
    // resendInvite imports ai-guard.mjs but does not edit it; no other shared file or Lambda changes, either.
    expect(changed.filter((f) => /^lambda\//.test(f) && !/^lambda\/resendInvite\//.test(f)), 'the only Lambda code that changes is lambda/resendInvite/').toEqual([]);
    expect(changed.filter((f) => /^lambda\/resendInvite\//.test(f)).sort(), 'and there only index.mjs, package.json and package-lock.json').toEqual(['lambda/resendInvite/index.mjs', 'lambda/resendInvite/package-lock.json', 'lambda/resendInvite/package.json'].filter((f) => changed.includes(f)).sort());
    // REC-16's baseline file is read as it stands (and is not edited here).
    expect(changed.filter((f) => /support\/rec-16\//.test(f)), 'REC-16\'s support files are not edited by this card').toEqual([]);
  });

  // -------------------------------------------------------------- AC-10
  test('AC-10 The risk step is as it was: a recruitment-shaped row (a from_recruitment map, no sign-in, a test address) through classifyOnboardingRisk\'s flow entry takes its company from the row and gets the stand-in result with no model call; a row with no email is a robot; a repeat answers what is stored', async ({}, testInfo) => {
    once(testInfo);
    const AI_SKIPPED = 'AI skipped: this is test data (cost guardrail). Nothing was sent to an AI service.';
    const shaped = (tenant: string, email: string | undefined, id = IDS.hireA) => {
      const r = ob11Row({
        employee_id: id, first_name: 'Naledi', last_name: 'Dlamini', email, phone: '082 555 0199', department: 'Operations', job_title: 'Junior baker', stage: 'INVITED',
        planned_start_date: '2026-12-01', created_at: '2026-11-20T08:00:00.000Z', tenant_id: tenant,
      });
      r['from_recruitment'] = { M: { candidate_id: { S: 'CAND-REC062-0001' }, offer_id: { S: 'offer-rec062-0001' } } };
      return r;
    };
    const world = (r: ReturnType<typeof shaped>): FlowWorld => ({ tables: { employees: [r], documents: [], 'document-verification': [] }, model: { risk: 'MEDIUM', reason: 'A model answer that must never be asked for.' } });
    const flow = (w: FlowWorld, id = IDS.hireA, env: Record<string, string | undefined> = {}): FlowRun => runHandler(CLASSIFY, w, flowEvent(id), { ...OB11_ENV, ...env });
    const calm = (r: FlowRun, what: string) => {
      expect(r.error, `${what}: the flow call does not throw (${r.error?.message})`).toBeUndefined();
      expect(modelCalls(r), `${what}: no model call`).toEqual([]);
      expect(aiReached(r), `${what}: no AI service is reached`).toEqual([]);
    };
    for (const tenant of [OB11_A, OB11_B]) {
      const r = flow(world(shaped(tenant, PEOPLE.robot.email)));
      calm(r, `a test address of ${tenant === OB11_A ? 'A' : 'B'}`);
      expect(r.response, 'the stand-in result, the company from the row').toMatchObject({ employeeId: IDS.hireA, tenantId: tenant, riskBand: 'UNKNOWN', riskReason: AI_SKIPPED });
      const stored = personOf(r.world, IDS.hireA)!;
      expect([stored['riskBand'], stored['riskReason'], stored['riskSource'], stored['tenant_id']], 'stored as the flow\'s, still in the same company').toEqual(['UNKNOWN', AI_SKIPPED, 'FLOW', tenant]);
    }
    // The company is never taken from the event.
    const forged = runHandler(CLASSIFY, world(shaped(OB11_A, PEOPLE.robot.email)), flowEvent(IDS.hireA, { tenant_id: OB11_B, tenantId: OB11_B, company: OB11_B }), OB11_ENV);
    expect((forged.response as Record<string, unknown>)?.['tenantId'], 'a company in the event is ignored').toBe(OB11_A);
    // A row with no email is a robot: never reaches the model.
    const noMail = flow(world(shaped(OB11_A, undefined)));
    calm(noMail, 'a row with no email');
    expect(noMail.response, 'no email: the stand-in result').toMatchObject({ riskBand: 'UNKNOWN', riskReason: AI_SKIPPED });
    // A repeat answers what is stored, writes nothing and asks nothing.
    const first = flow(world(shaped(OB11_A, PEOPLE.robot.email)));
    const again = flow(first.world);
    calm(again, 'a repeat');
    expect(again.response, 'a repeat answers what is stored (same time, same result)').toEqual(first.response);
    expect(writesTo(again, 'employees'), 'a repeat writes nothing').toEqual([]);
    // AI off for everyone: the global switch still holds.
    const off = flow(world(shaped(OB11_A, 'real.person@private-mail.example')), IDS.hireA, { AI_CALLS_ENABLED: 'false' });
    calm(off, 'AI switched off (a real address)');
    expect((off.response as Record<string, unknown>)?.['riskBand'], 'AI off: UNKNOWN').toBe('UNKNOWN');
    // Nothing of the risk step or the workflow definition is edited by this card.
    expect(changedFiles().filter((f) => /^lambda\/classifyOnboardingRisk\//.test(f) || /^infra\/step-functions\//.test(f)), 'no file under lambda/classifyOnboardingRisk/ or infra/step-functions/ changes').toEqual([]);
  });

  // -------------------------------------------------------------- AC-11 (the seed and the dev test)
  const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-06.2', 'dev-ids.json'), 'utf8')) as Record<string, string>;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  test('AC-11 pepla-dev seed (text): seed_rec06_2 exists, main() calls it, it reads support/rec-06.2/dev-ids.json, uses the run id and the attempt, scans nothing, and the seeded address is a robot address with the cleanup marker', async ({}, testInfo) => {
    once(testInfo);
    expect(ids['email'], 'the seeded address is a robot address').toMatch(/@blackhole\.postmarkapp\.com$/);
    expect(ids['email'], 'with the marker the dev clean-up removes by (e2e.run-), so the person, the invite and the sign-in go at the end of the run').toMatch(/^e2e\.run-/);
    const src = readFileSync(join(__dirname, '..', '..', '..', 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    const start = src.indexOf('def seed_rec06_2(');
    expect(start, 'seed-dev.py has seed_rec06_2').toBeGreaterThan(-1);
    const end = src.indexOf('\ndef ', start + 10);
    const body = src.slice(start, end === -1 ? undefined : end);
    expect.soft(src.slice(src.indexOf('def main(')), 'main() calls seed_rec06_2(ddb, tenant)').toMatch(/seed_rec06_2\(\s*ddb\s*,/);
    expect.soft(body, 'it reads support/rec-06.2/dev-ids.json').toMatch(/rec-06\.2[\s\S]*dev-ids\.json/);
    expect.soft(body, 'the employee id depends on the workflow run id').toMatch(/GITHUB_RUN_ID/);
    expect.soft(body, 'and on the attempt (a re-run keeps the run id)').toMatch(/GITHUB_RUN_ATTEMPT/);
    expect.soft(/\bScan\b|scan\(|get_paginator\(\s*["']scan/.test(body), 'it scans nothing').toBe(false);
  });

  test('AC-11 pepla-dev seed, run for real against a fake DynamoDB: one INVITED recruitment hire of A with a new id on every attempt (also a re-run), the earlier runs\' rows of A gone, B\'s row and other people stay, no scan, deletes held to the company', async ({}, testInfo) => {
    once(testInfo);
    const mine = (t: Record<string, any[]>) => (t['employees'] ?? []).filter((r) => r['email']?.S === ids['email']);
    const plainRow = (r: Record<string, any>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, (v as any).S ?? (v as any).N ?? (v as any).M ?? null]));
    const old = (tenant: string, id: string) => ob11Row({ employee_id: id, email: ids['email'], tenant_id: tenant, first_name: 'Old', last_name: 'Run', stage: 'INVITED' });
    const unrelated = ob11Row({ employee_id: 'unrelated-0001', email: 'someone.else@blackhole.postmarkapp.com', tenant_id: A, stage: 'ACTIVE' });
    const start = (): Record<string, any[]> => ({ employees: [old(A, 'old-run-a-1'), old(A, 'old-run-a-2'), old(B, 'old-run-b-1'), unrelated] });
    const env = (run: string, attempt: string) => ({ GITHUB_RUN_ID: run, GITHUB_RUN_ATTEMPT: attempt });
    const checkCalls = (r: ReturnType<typeof runSeed>, what: string) => {
      expect(r.code, `${what}: the seed function ran (${r.stderr.slice(-500)})`).toBe(0);
      expect(r.calls.filter((c) => /^(Scan|BatchWriteItem|TransactWriteItems)$/.test(c.op)).map((c) => c.op), `${what}: no scan, batch or transaction`).toEqual([]);
      expect(r.calls.filter((c) => c.op === 'DeleteItem' && !/tenant_id/.test(String(c.params?.['ConditionExpression'] ?? ''))).length, `${what}: every delete is held to the company`).toBe(0);
    };

    const r1 = runSeed(start() as never, 'seed_rec06_2', [A], env('9001', '1'));
    checkCalls(r1, 'first attempt');
    const one = mine(r1.tables as never);
    const a1 = one.filter((r) => r['tenant_id']?.S === A);
    expect(a1, 'A has exactly one row with the seeded address (the earlier runs\' rows are gone)').toHaveLength(1);
    const p = plainRow(a1[0]!);
    expect(String(p['employee_id']), 'its id is a UUID (36 characters, so the run name is 47)').toMatch(UUID);
    expect(['old-run-a-1', 'old-run-a-2'], 'and it is not an old id').not.toContain(p['employee_id']);
    expect(p['stage'], 'the person is INVITED').toBe('INVITED');
    expect(p['department'], 'in Operations, as ONB-11\'s seed').toBe('Operations');
    expect(p['tenant_id'], 'in company A').toBe(A);
    expect(p['email'], 'with the robot address').toBe(ids['email']);
    const fr = (p['from_recruitment'] ?? {}) as Record<string, { S?: string }>;
    expect(Object.keys(fr).sort().filter((k) => k !== 'role_id'), 'a from_recruitment MAP with the candidate and the offer').toEqual(['candidate_id', 'offer_id']);
    expect(fr['candidate_id']?.S, 'the candidate id is the seeded one').toBe(ids['candidate']);
    expect(fr['offer_id']?.S, 'the offer id is the seeded one').toBe(ids['offer']);
    for (const k of ['user_sub', 'sfn_task_token', 'sfn_execution_arn']) expect(p[k], `no ${k} (the workflow writes its own)`).toBeUndefined();
    expect(one.filter((r) => r['tenant_id']?.S === B).map((r) => r['employee_id']?.S), 'B\'s row of the same address stays (a company\'s rows are never touched)').toEqual(['old-run-b-1']);
    expect((r1.tables['employees'] ?? []).some((r) => (r as any)['employee_id']?.S === 'unrelated-0001'), 'another person\'s row stays').toBe(true);

    // The same attempt again: the same single row (no duplicate).
    const r1b = runSeed(r1.tables as never, 'seed_rec06_2', [A], env('9001', '1'));
    checkCalls(r1b, 'the same attempt again');
    expect(mine(r1b.tables as never).filter((r) => r['tenant_id']?.S === A).map((r) => r['employee_id']?.S), 'the same attempt again leaves the same one row').toEqual([p['employee_id']]);
    // A re-run of the same workflow run (same run id, next attempt): a new id, and the old one is gone.
    const r2 = runSeed(r1.tables as never, 'seed_rec06_2', [A], env('9001', '2'));
    checkCalls(r2, 'a re-run (attempt 2)');
    const a2 = mine(r2.tables as never).filter((r) => r['tenant_id']?.S === A).map((r) => r['employee_id']?.S);
    expect(a2, 'a re-run leaves one row').toHaveLength(1);
    expect(a2[0], 'with an id that differs from attempt 1\'s: a closed run holds its name for 90 days').not.toBe(p['employee_id']);
    // The next workflow run: a new id again.
    const r3 = runSeed(r2.tables as never, 'seed_rec06_2', [A], env('9002', '1'));
    checkCalls(r3, 'the next workflow run');
    const a3 = mine(r3.tables as never).filter((r) => r['tenant_id']?.S === A).map((r) => r['employee_id']?.S);
    expect(a3, 'the next run leaves one row').toHaveLength(1);
    expect([p['employee_id'], a2[0]], 'with a third id').not.toContain(a3[0]);
    // Another company's tables: the seed for company B's id would not touch A's rows.
    const other = runSeed(start() as never, 'seed_rec06_2', [B], env('9001', '1'));
    checkCalls(other, 'run for company B');
    expect(mine(other.tables as never).filter((r) => r['tenant_id']?.S === A).map((r) => r['employee_id']?.S).sort(), 'A\'s old rows stay when the seed runs for B').toEqual(['old-run-a-1', 'old-run-a-2']);
  });

  test('AC-11 @pepla-dev The seeded recruitment hire: HR sends the invite (200, invite.link on dev), HR uploads the required documents with HR\'s own token, the person\'s record shows the stand-in risk result (the workflow started and finished its first step), a second send is 200, and company B does not list the person', async ({ page, signIn, hr }, testInfo) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only: AC-1 to AC-7 hold the Lambda to this in the no-backend run.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once, at one width.');
    test.setTimeout(480_000);
    const AI_SKIPPED_LABEL = 'AI skipped: this is test data (cost guardrail). Nothing was sent to an AI service.';
    const envText = existsSync(join(__dirname, '..', '..', 'src', 'environments', 'environment.ts')) ? readFileSync(join(__dirname, '..', '..', 'src', 'environments', 'environment.ts'), 'utf8') : '';
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
    const signInForToken = async (login: Login, s: SignInPage = signIn): Promise<string> => {
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
      await s.open();
      await s.signInAs(login);
      await expect.poll(() => token, { message: `Cognito hands ${login.email} an ID token`, timeout: 30_000 }).not.toBe('');
      page.off('response', listen);
      return token;
    };
    const asHr = { Authorization: `Bearer ${await signInForToken(hr)}` };
    const logB = { email: process.env['E2E_HR_B_EMAIL'] ?? '', password: process.env['E2E_HR_B_PASSWORD'] ?? '', givenName: 'Company B' };
    expect(logB.email && logB.password, 'the company B test login is set').toBeTruthy();

    /** Every employee of the caller's company, every page. */
    const everyone = async (headers: Record<string, string>) => {
      const out: any[] = [];
      let lastKey: string | undefined;
      for (let i = 0; i < 50; i++) {
        const r = await page.request.get(`${employeesApi}/v1/employees?limit=200${lastKey ? `&lastKey=${encodeURIComponent(lastKey)}` : ''}`, { headers });
        expect(r.status(), 'GET /v1/employees').toBe(200);
        const b = (await r.json()) as { items: any[]; lastKey?: string };
        out.push(...b.items);
        lastKey = b.lastKey;
        if (!lastKey) break;
      }
      return out;
    };
    // The test finds its person through the list, by the seeded address.
    const found = (await everyone(asHr)).filter((e) => e.email === ids['email']);
    expect(found.map((e) => [e.stage, e.employee_id.length]), 'A\'s list has the seeded recruitment hire once, INVITED, with a 36-character id').toEqual([['INVITED', 36]]);
    const employeeId = String(found[0]!.employee_id);

    // HR sends the invite: 200, the link is in the answer on dev (a test address and a test login).
    const sent = await page.request.post(`${employeesApi}/v1/employees/${encodeURIComponent(employeeId)}/invite`, { headers: asHr });
    const sentBody = (await sent.json()) as { status?: string; invite?: { link?: string } };
    expect(sent.status(), `HR sends the invite: ${JSON.stringify(sentBody)}`).toBe(200);
    expect(sentBody.status, 'ok').toBe('ok');
    expect(sentBody.invite?.link, 'invite.link is present on dev for a test address and a test login').toMatch(/\/set-password#token=[\w-]{43}$/);

    // HR uploads the person's required documents, as ONB-11 AC-11 does but with HR's own token (HR may act on anyone), and the check runs.
    const upload = async (type: string, fileName: string) => {
      const link = await page.request.post(`${documentsApi}/v1/employees/${encodeURIComponent(employeeId)}/documents/upload-url`, {
        headers: { ...asHr, 'Content-Type': 'application/json' },
        data: { documentType: type, fileName, contentType: 'application/pdf' },
      });
      expect(link.status(), `HR gets an upload link for ${type}: ${await link.text()}`).toBe(200);
      const { url } = (await link.json()) as { url: string };
      const put = await page.request.put(url, { headers: { 'Content-Type': 'application/pdf' }, data: PDF });
      expect(put.ok(), `the test PDF uploads (${put.status()})`).toBe(true);
    };
    const verifications = () => page.request.get(`${documentsApi}/v1/employees/${encodeURIComponent(employeeId)}/verifications`, { headers: asHr });
    await upload('NATIONAL_ID', 'rec062-id.pdf');
    await expect
      .poll(async () => {
        const r = await verifications();
        if (r.status() !== 200) return `HTTP ${r.status()}`;
        const docs = ((await r.json()) as { documents?: Array<{ ocr_status: string }> }).documents ?? [];
        return docs.some((d) => d.ocr_status !== 'PENDING') ? 'read' : 'waiting';
      }, { message: 'within 90 seconds the first upload is read', timeout: 90_000, intervals: [3_000] })
      .toBe('read');
    await upload('BANK_CONFIRMATION', 'rec062-bank.pdf');
    let last: Record<string, unknown> = {};
    await expect
      .poll(async () => {
        const r = await verifications();
        if (r.status() !== 200) return `HTTP ${r.status()}`;
        last = ((await r.json()) as { employee: Record<string, unknown> }).employee;
        return last['risk_assessed_at'] ? 'assessed' : `step ${String(last['step'])}, no check yet`;
      }, { message: 'within 180 seconds of the second upload the risk check has run: the workflow was started by the invite, took the task token, and was told by the read', timeout: 180_000, intervals: [5_000] })
      .toBe('assessed');
    expect(last['step'], 'the person is In review').toBe('IN_REVIEW');
    expect(last['risk_band'], 'a test address gets the stand-in band').toBe('UNKNOWN');
    expect(last['risk_reason'], 'and the guard\'s test-data label ("AI skipped")').toBe(AI_SKIPPED_LABEL);

    // A second send afterwards: 200 (the run is already waiting or finished; either way the invite works).
    const again = await page.request.post(`${employeesApi}/v1/employees/${encodeURIComponent(employeeId)}/invite`, { headers: asHr });
    expect([again.status(), ((await again.json()) as { status?: string }).status], 'a second send is 200 ok').toEqual([200, 'ok']);

    // Company B does not list the person, and cannot send their invite.
    await page.context().clearCookies();
    const bHeaders = { Authorization: `Bearer ${await signInForToken(logB)}` };
    expect((await everyone(bHeaders)).some((e) => e.employee_id === employeeId || e.email === ids['email']), 'B\'s list does not have the person').toBe(false);
    const cross = await page.request.post(`${employeesApi}/v1/employees/${encodeURIComponent(employeeId)}/invite`, { headers: bHeaders });
    expect(cross.status(), 'HR of B cannot send the invite: 404').toBe(404);
  });
});
