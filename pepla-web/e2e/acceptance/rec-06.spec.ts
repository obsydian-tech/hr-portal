import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { attributes, blocks } from './support/infra-harness';
import { STACKS, kmsList, lambdaNamed, policyLines, resourcesOf, roleResourceOf, settingsOf } from './support/rec-02/iam';
import { REPO } from './support/rec-06/lambda-harness';
import {
  A, B, C, CONFIRMED, EMAIL, EMP, EMPLOYEES, EMPLOYEE_ID_NAMESPACE, K, KC, OFFERS, P, PHONE, R, SALARY_TEXT, SUB, TABLE, UUID_SHAPE,
  accept, acceptBody, act, answer, at, awsOf, bodyOf, call, changed, describe, emailOf, employee, employeeById, employeeIdOf, employeesOf,
  eventsOf, fullName, getOffer, historyOf, keysDeep, listOffers, logsOf, offerRow, ok, plain, rowsOf, sagaOf, sentOffer, statusOf, uuidV5,
  world, writesOf, type Caller, type Run, type Sent, type Tables,
} from './support/rec-06/world';

/**
 * REC-06 · Conversion Point: an accepted offer makes the hire and the employee record (red). Jira NH-240.
 * Spec: /mnt/project-files/onboarding-cards/specs/REC-06.md (rules 1 to 10, AC-1 to AC-10, fixed 26 Nov), read with the spec check's
 * round 2 leftovers L-1 to L-5 (REC-06-spec-check.md), which bind these tests. Notes: cards/rec-06.md. Review page:
 * onboarding-cards/specs/REC-06-tests-for-review.md (the bar and the proofs).
 *
 * The Lambda tests run the real handlers (lambda/manageOffers for every offer route, lambda/createEmployee for the contract of AC-5,
 * lambda/createCandidate and lambda/advanceCandidateStage where a test needs them) in a fresh Node process each call, against this
 * card's fake AWS (support/rec-06/fake-aws: REC-05's with code added only), over REC-05's world plus this card's rows
 * (support/rec-06/world.ts), at fixed times (REC-15's clock). Every offer is taken to SENT through REC-05's own routes. Terraform is
 * read as text. Nothing calls AWS or any AI. Nothing here has a screen width: each test runs once, at 1280. AC-10's dev part runs on
 * pepla-dev only.
 *
 * Pinned by the test writer where the spec leaves a choice (each is in cards/rec-06.md):
 *  - D-T-6.1 employee_id is the version 5 UUID (RFC 4122, SHA-1) of the text "<tenant_id>:<offer_id>" in the namespace
 *    6b7dcfde-d603-4673-9949-d5d39ac59e17. lambda/shared/employee-row.mjs holds that constant; the tests compute the id themselves.
 *  - D-T-6.2 The employees table is named `employees` (the literal createEmployee uses). The runs also set EMPLOYEES_TABLE and
 *    EMPLOYEES_TABLE_NAME to it; if the code reads a setting, Terraform must set it on manageOffers (AC-9).
 *  - D-T-6.3 CandidateHired's `at` is the accept's time (the offer's answered_at), also when a later repeat call sends it (AC-8).
 *    Both events go on EVENTBRIDGE_BUS_NAME with the Source OfferAnswered uses today (talent-flow.workflow). Their order is free.
 *  - D-T-6.4 The marker is `followups_done.hired_event` on the offer row; any non-empty value means done.
 *  - D-T-6.5 A cancelled transaction that is not someone else's finished accept answers 409 { error: 'Conflict', code: 'STALE' }
 *    (rule 3), whichever item failed.
 *  - D-T-6.6 from_recruitment.role_id is the candidate's role_id, also when that role row is gone.
 *  - D-T-6.7 On pepla-dev the list route (GET /v1/employees) does not show from_recruitment (its answer is a fixed field list that
 *    REC-06 does not change), so the dev test judges the new person by employee_id, email, stage and planned start date, and
 *    from_recruitment is judged here in AC-1. The dev test gets its signed copy through the real upload link, so the seed needs to
 *    put no file in S3.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const NOT_FOUND = { error: 'Not found' };
const FORBIDDEN = { error: 'Forbidden' };
const conflict = (code: string) => ({ error: 'Conflict', code });
const invalid = (field: string) => ({ error: 'Bad request', code: 'INVALID_FIELD', field });
const BAD_KEY = { error: 'Bad request', code: 'INVALID_SIGNED_KEY' };
const ACCEPT_DAY = '2026-11-25';
const EVENT_SOURCE = 'talent-flow.workflow';
const BUS = 'rec01-bus';
const FORGED_B = {
  headers: { 'x-tenant-id': B, 'X-Tenant-Id': B, 'x-company-id': B, 'tenant-id': B, tenant_id: B },
  query: { tenant_id: B, tenantId: B, company_id: B, companyId: B },
};

/** Every run made by the tests, to look through all answers, events and log lines at once (AC-6, AC-8). */
const RUNS: { what: string; run: Run }[] = [];
const keep = (what: string, run: Run) => { RUNS.push({ what, run }); return run; };
function must(what: string, run: Run): Run {
  keep(what, run);
  expect(ok(run), `${what} (${describe(run)})`).toBe(true);
  return run;
}
/** Nothing changed: no row anywhere and no write, event, message, start or upload. */
function nothingDone(what: string, before: Tables, r: Run) {
  expect.soft(changed(before, r.tables), `${what}: no row changes`).toEqual([]);
  expect.soft(writesOf(r).map((c: any) => `${c.service} ${c.op}`), `${what}: nothing written, sent or started`).toEqual([]);
}
function refused(what: string, before: Tables, r: Run, status: number, body: unknown) {
  keep(what, r);
  expect.soft(answer(r), `${what}: ${status} ${JSON.stringify(body)}`).toEqual([status, body]);
  nothingDone(what, before, r);
}
/** Refused after the one transaction was tried and cancelled: no row changes, nothing else written, no event. */
function cancelled(what: string, before: Tables, r: Run, status: number, body: unknown) {
  keep(what, r);
  expect.soft(answer(r), `${what}: ${status} ${JSON.stringify(body)}`).toEqual([status, body]);
  expect.soft(changed(before, r.tables), `${what}: no row changes`).toEqual([]);
  expect.soft(writesOf(r).filter((c: any) => c.op !== 'TransactWriteItems').map((c: any) => `${c.service} ${c.op}`), `${what}: nothing written, sent or started outside the cancelled transaction`).toEqual([]);
}
/** The employee rows that are new against `before`. */
const newEmployees = (before: Tables, after: Tables) => employeesOf(after).filter((e) => !employeesOf(before).some((x) => x['employee_id'] === e['employee_id']));
const newHistory = (before: Tables, after: Tables, candidate: string) => historyOf(after, candidate).filter((h) => !historyOf(before, candidate).some((x) => x['SK'] === h['SK']));
/** Sets fields on a candidate's SAGA row (what another route or an old system would have left there). */
function withSaga(t: Tables, candidate: string, set: Record<string, unknown>): Tables {
  const out = structuredClone(t);
  out[TABLE.state] = (out[TABLE.state] ?? []).map((r) => {
    const x = plain(r);
    if (x['PK'] !== `CANDIDATE#${candidate}` || x['SK'] !== 'SAGA') return r;
    const next = { ...r } as any;
    for (const [k, v] of Object.entries(set)) next[k] = typeof v === 'boolean' ? { BOOL: v } : { S: String(v) };
    return next;
  });
  return out;
}
/** Sets plain fields on an offer row (a REC-05-era accepted offer, for L-5). */
function withOffer(t: Tables, offerId: string, set: Record<string, string>, drop: string[] = []): Tables {
  const out = structuredClone(t);
  out[TABLE.state] = (out[TABLE.state] ?? []).map((r) => {
    const x = plain(r);
    if (x['PK'] !== `OFFER#${offerId}` || x['SK'] !== 'OFFER') return r;
    const next = { ...r } as any;
    for (const [k, v] of Object.entries(set)) next[k] = { S: v };
    for (const k of drop) delete next[k];
    return next;
  });
  return out;
}
/** Every person's name, email and phone in the world (both companies, candidates and employees), the forged body person of AC-7, the
 *  salary and the fake bus error's words, as one pattern for the log checks (lock check MF-2). Names whole-word and case as stored. */
function leakPattern(): RegExp {
  const t = world();
  const people = [
    ...rowsOf(t, TABLE.state).filter((r) => r['SK'] === 'SAGA').map((r) => [r['firstName'], r['lastName'], r['email'], r['phone']]),
    ...employeesOf(t).map((r) => [r['first_name'], r['last_name'], r['email'], r['phone']]),
  ];
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = new Set<string>();
  for (const [first, last, email, phone] of people) {
    for (const n of [first, last]) if (typeof n === 'string' && n.trim().length > 1) parts.add(`\\b${esc(n.trim())}\\b`);
    if (typeof email === 'string' && email.trim()) parts.add(esc(email.trim()));
    const digits = typeof phone === 'string' ? phone.replace(/\D/g, '').slice(-9) : '';
    if (digits.length === 9) parts.add(digits.split('').join('[\\s-]?'));
  }
  for (const x of ['Forged', 'someone\\.else', 'the bus is down', ...SALARY_TEXT.map(esc)]) parts.add(x);
  return new RegExp([...parts].join('|'));
}
const marker = (t: Tables, offerId: string) => offerRow(t, offerId)?.['followups_done']?.['hired_event'];
/** The DynamoDB calls a run made on the employees table, as "op index". */
const employeeCalls = (r: Run) => awsOf(r).filter((c: any) => c.service === 'dynamodb' && (c.table === EMPLOYEES || JSON.stringify(c.input?.TransactItems ?? []).includes(`"TableName":"${EMPLOYEES}"`)));
const transactionOf = (r: Run) => awsOf(r).filter((c: any) => c.service === 'dynamodb' && c.op === 'TransactWriteItems').map((c: any) => c.input.TransactItems as any[]);

test.describe('REC-06 Conversion Point: an accepted offer makes the hire and the employee record', () => {
  // ---------------------------------------------------------------- control

  test('Control: the world is sound (candidates in Offer, employees of A and B, an offer reaches SENT through REC-05\'s routes, the id is a version 5 UUID)', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(120_000);
    const t = world();
    expect(sagaOf(t, KC.main)['currentStage'], 'the main candidate is in Offer').toBe('OFFER');
    expect(sagaOf(t, KC.oldStage)['currentStage'], 'one candidate is stored under the old name OFFER_DELIVERY').toBe('OFFER_DELIVERY');
    expect(employeesOf(t).map((e) => `${e['tenant_id'] === A ? 'A' : 'B'} ${e['email']}`).sort(), 'the employees of A and B').toEqual([`A ${EMAIL.oldHand}`, `A ${EMAIL.rehire}`, `B ${EMAIL.rehire}`, `B ${EMAIL.sharedB}`]);
    const s = sentOffer(t, KC.main, 0);
    expect(offerRow(s.t, s.id)?.['state'], 'the offer is SENT').toBe('SENT');
    expect(s.key.startsWith(`recruitment/${A}/offers/${s.id}/`), 'the signed copy is under this offer').toBe(true);
    // The id the tests expect: RFC 4122's own example (python uuid.uuid5(NAMESPACE_DNS, 'python.org')) checks the computation.
    expect(uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'python.org'), 'the tests compute a version 5 UUID correctly').toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d');
    expect(employeeIdOf(A, s.id), 'version 5, RFC 4122 variant').toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(employeeIdOf(A, s.id), 'the company is part of the id').not.toBe(employeeIdOf(B, s.id));
  });

  // ---------------------------------------------------------------- AC-1

  test('AC-1 Accept converts: 200 ACCEPTED with employee_id; the candidate is HIRED with one history row; exactly one employee of A with the rule 4 values; GET carries employee_id, the list row does not', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(180_000);
    const s = sentOffer(world(), KC.main, 0);
    const before = s.t;
    const r = must('accept (main)', accept(C.recA, s, before, 10));
    const eid = employeeIdOf(A, s.id);
    const b = bodyOf(r);
    expect.soft([statusOf(r), b?.state, b?.employee_id], '200, ACCEPTED, the version 5 id of A and this offer').toEqual([200, 'ACCEPTED', eid]);
    expect.soft([b?.answered_at, b?.salary, b?.salary_hidden], 'answered_at recorded; no salary in the answer').toEqual([at(10), null, true]);

    // The offer row: ACCEPTED, the signed copy and date, who answered, one version up, employee_id, the live lock kept.
    const o = offerRow(r.tables, s.id) ?? {};
    const was = offerRow(before, s.id) ?? {};
    expect.soft(
      { state: o['state'], employee_id: o['employee_id'], signed_key: o['signed_key'], confirmed_start_date: o['confirmed_start_date'], answered_by: o['answered_by'], answered_at: o['answered_at'], version: o['version'], tenant_id: o['tenant_id'] },
      'the offer row (rule 3b)',
    ).toEqual({ state: 'ACCEPTED', employee_id: eid, signed_key: s.key, confirmed_start_date: CONFIRMED, answered_by: SUB.recA, answered_at: at(10), version: (was['version'] as number) + 1, tenant_id: A });
    expect.soft((o['history'] as any[] ?? []).at(-1), 'one history entry SENT -> ACCEPTED by the caller').toMatchObject({ from: 'SENT', to: 'ACCEPTED', by: SUB.recA, at: at(10) });
    const lock = rowsOf(r.tables).find((x) => String(x['PK']).includes('OFFER_LIVE') && String(x['PK']).includes(KC.main));
    expect.soft(lock?.['live_offer_id'], 'the live-offer lock is kept, as REC-05 does for ACCEPTED').toBe(s.id);

    // The candidate: HIRED, hired_at, employee_id, offer_id, who; nothing else of the row changes.
    const sg = sagaOf(r.tables, KC.main);
    const sw = sagaOf(before, KC.main);
    expect.soft(
      { currentStage: sg['currentStage'], stageEnteredAt: sg['stageEnteredAt'], hired_at: sg['hired_at'], employee_id: sg['employee_id'], offer_id: sg['offer_id'], updatedBy: sg['updatedBy'] },
      'the candidate row (rule 3c)',
    ).toEqual({ currentStage: 'HIRED', stageEnteredAt: at(10), hired_at: at(10), employee_id: eid, offer_id: s.id, updatedBy: SUB.recA });
    const SET = ['currentStage', 'stageEnteredAt', 'hired_at', 'employee_id', 'offer_id', 'updatedBy'];
    const rest = (x: Record<string, any>) => Object.fromEntries(Object.entries(x).filter(([k]) => !SET.includes(k)));
    expect.soft(rest(sg), 'every other field of the candidate row is unchanged').toEqual(rest(sw));

    // One history row OFFER -> HIRED by the caller.
    const h = newHistory(before, r.tables, KC.main);
    expect.soft(h.length, 'exactly one new stage history row').toBe(1);
    expect.soft(
      { recordType: h[0]?.['recordType'], fromStage: h[0]?.['fromStage'], toStage: h[0]?.['toStage'], actor: h[0]?.['actor'], timestamp: h[0]?.['timestamp'], createdAt: h[0]?.['createdAt'], candidateId: h[0]?.['candidateId'], tenant_id: h[0]?.['tenant_id'] },
      'the history row (rule 3d)',
    ).toEqual({ recordType: 'STAGE_HISTORY', fromStage: 'OFFER', toStage: 'HIRED', actor: SUB.recA, timestamp: at(10), createdAt: at(10), candidateId: KC.main, tenant_id: A });
    expect.soft(String(h[0]?.['SK'] ?? '').startsWith(`STAGE#${at(10)}#`) && String(h[0]?.['SK']).length > `STAGE#${at(10)}#`.length, `its key is STAGE#<at>#<nonce> (got ${h[0]?.['SK']})`).toBe(true);

    // Exactly one new employee, of A, with exactly the rule 4 values (no other attribute).
    const e = newEmployees(before, r.tables);
    expect.soft(e.length, 'exactly one new employee row').toBe(1);
    expect.soft(e[0], 'the employee row (rule 4)').toEqual({
      employee_id: eid, first_name: 'Thandeka', middle_name: '', last_name: 'Mahlaba', email: EMAIL.main, phone: PHONE,
      department: 'Operations', job_title: 'Fleet controller', stage: 'INVITED', offer_accept_date: ACCEPT_DAY, planned_start_date: CONFIRMED,
      created_at: at(10), created_by: SUB.recA, hr_staff_id: SUB.recA, hr_staff_name: fullName(SUB.recA), hr_staff_email: emailOf(C.recA), tenant_id: A,
      from_recruitment: { candidate_id: KC.main, role_id: K.ra, offer_id: s.id },
    });
    expect.soft(employeesOf(before).every((x) => employeesOf(r.tables).some((y) => JSON.stringify(y) === JSON.stringify(x))), 'no existing employee row changes').toBe(true);
    // The id: computed here from A and the offer id (L-3), the same text shape as createEmployee's.
    expect.soft(eid, 'the id has the UUID text shape').toMatch(UUID_SHAPE);

    // GET carries employee_id; the list row does not (REC-05 AC-12 pins the row fields).
    const g = keep('get after accept', getOffer(C.recA, s.id, r.tables, { now: at(11) }));
    expect.soft([statusOf(g), bodyOf(g)?.state, bodyOf(g)?.employee_id], 'GET /v1/offers/{id}: ACCEPTED with the same employee_id').toEqual([200, 'ACCEPTED', eid]);
    const l = keep('list after accept', listOffers(C.recA, r.tables, { now: at(12) }));
    const row = ((bodyOf(l)?.offers ?? []) as any[]).find((x) => x.offer_id === s.id);
    expect.soft(row?.state, 'the list shows the offer ACCEPTED').toBe('ACCEPTED');
    expect.soft(Object.keys(row ?? {}).includes('employee_id'), 'the list row has no employee_id').toBe(false);
  });

  test('AC-1 Values when something is missing or old: no phone writes \'\'; a missing role falls back to the candidate; a role with department text only; a staff number; a candidate stored under an old Offer name converts (L-2)', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const t0 = world();
    const conv = (who: Caller, candidate: string, n: number) => {
      const s = sentOffer(t0, candidate, n);
      const r = must(`accept (${candidate})`, accept(who, s, s.t, n + 10));
      const e = newEmployees(s.t, r.tables);
      expect.soft(e.length, `${candidate}: exactly one new employee`).toBe(1);
      return { s, r, e: e[0] ?? {} };
    };
    // No phone on the candidate: '' (D-REC-6.9). The role's own title and current department name.
    const np = conv(C.recA, KC.noPhone, 0);
    expect.soft([np.e['phone'], np.e['job_title'], np.e['department']], 'no phone: \'\'; the role\'s title and department').toEqual(['', 'Fleet controller', 'Operations']);
    // The role row is gone: the candidate's own title and department; from_recruitment keeps the candidate's role_id (D-T-6.6).
    const nr = conv(C.recA, KC.noRole, 20);
    expect.soft([nr.e['job_title'], nr.e['department'], nr.e['from_recruitment']], 'no role row: the candidate\'s positionTitle and department').toEqual(['Night baker', 'Bakery floor', { candidate_id: KC.noRole, role_id: KC.roleGone, offer_id: nr.s.id }]);
    // A role with department text and no department id: the role's text and title.
    const rt = conv(C.recA, KC.roleText, 40);
    expect.soft([rt.e['job_title'], rt.e['department']], 'a role with only department text').toEqual(['Dispatch clerk', 'Dispatch']);
    // An HR Recruiter whose sign-in carries a staff number: created_by and hr_staff_id are the staff number; the person id is still the actor.
    const st = conv(P.staffA, KC.p[0]!, 60);
    expect.soft([st.e['created_by'], st.e['hr_staff_id'], st.e['hr_staff_name'], st.e['hr_staff_email']], 'created_by and hr_staff_* from the staff number and the sign-in').toEqual(['STAFF-0042', 'STAFF-0042', fullName(SUB.staffA), emailOf(P.staffA)]);
    expect.soft([offerRow(st.r.tables, st.s.id)?.['answered_by'], newHistory(st.s.t, st.r.tables, KC.p[0]!)[0]?.['actor']], 'answered_by and the history actor are the person id').toEqual([SUB.staffA, SUB.staffA]);
    // L-2: stored as OFFER_DELIVERY (reads as Offer, so REC-05 let it have an offer): it converts, never refused for ever.
    const os = conv(C.recA, KC.oldStage, 80);
    expect.soft([statusOf(os.r), sagaOf(os.r.tables, KC.oldStage)['currentStage'], sagaOf(os.r.tables, KC.oldStage)['employee_id']], 'an old Offer name: 200, HIRED').toEqual([200, 'HIRED', employeeIdOf(A, os.s.id)]);
    expect.soft(newHistory(os.s.t, os.r.tables, KC.oldStage).map((h) => h['toStage']), 'one history row to HIRED').toEqual(['HIRED']);
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 Exactly once: a repeat ACCEPTED answers 200 with the same employee_id and writes nothing; other answers stay NOT_SENT; two calls at once leave one employee and one history row', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const t0 = world();
    const s = sentOffer(t0, KC.p[1]!, 0);
    const first = must('accept', accept(C.recA, s, s.t, 10));
    const eid = employeeIdOf(A, s.id);
    for (const [who, n] of [[C.recA, 11], [C.rec2A, 12]] as const) {
      const again = keep(`repeat by ${who.name}`, accept(who, s, first.tables, n));
      expect.soft([statusOf(again), bodyOf(again)?.state, bodyOf(again)?.employee_id], `repeat by ${who.name}: 200 with the same employee_id`).toEqual([200, 'ACCEPTED', eid]);
      nothingDone(`repeat by ${who.name}`, first.tables, again);
      expect.soft(eventsOf(again).length, `repeat by ${who.name}: no event (the follow-ups were done)`).toBe(0);
      expect.soft(transactionOf(again).length, `repeat by ${who.name}: no transaction`).toBe(0);
    }
    // A repeat with a different signed key or date still answers the stored offer and changes nothing.
    const other = keep('repeat with another date', act(R.answer, C.recA, s.id, acceptBody(s, { confirmed_start_date: '2027-03-01' }), first.tables, { now: at(13), extra: { s3: s.s3 } }));
    expect.soft([statusOf(other), bodyOf(other)?.employee_id], 'a repeat with another date: 200, the same employee').toEqual([200, eid]);
    nothingDone('repeat with another date', first.tables, other);
    expect.soft(employeeById(other.tables, eid)[0]?.['planned_start_date'], 'the stored date stays').toBe(CONFIRMED);
    // Any other answer on the converted offer: 409 NOT_SENT, as REC-05 AC-5.
    for (const ans of ['DECLINED', 'WITHDRAWN'] as const) refused(`${ans} on the converted offer`, first.tables, act(R.answer, C.recA, s.id, { answer: ans }, first.tables, { now: at(14) }), 409, conflict('NOT_SENT'));

    // Two calls at once: both read the SENT offer; the second's transaction meets the first's finished write.
    const s2 = sentOffer(t0, KC.p[2]!, 20);
    const c1 = must('first of two at once', accept(C.recA, s2, s2.t, 30));
    const c2 = keep('second of two at once', accept(C.rec2A, s2, s2.t, 30, { extra: { landBeforeTransact: { tables: { [TABLE.state]: c1.tables[TABLE.state]!, [EMPLOYEES]: c1.tables[EMPLOYEES]! } } } }));
    const eid2 = employeeIdOf(A, s2.id);
    expect.soft([statusOf(c2), bodyOf(c2)?.employee_id], `the second call answers 200 with the same employee (${describe(c2)})`).toEqual([200, eid2]);
    expect.soft(employeeById(c2.tables, eid2).length, 'one employee for the offer').toBe(1);
    expect.soft(newEmployees(s2.t, c2.tables).length, 'one new employee in all').toBe(1);
    expect.soft(newHistory(s2.t, c2.tables, KC.p[2]!).length, 'one history row').toBe(1);
    expect.soft(employeeById(c2.tables, eid2)[0]?.['created_by'], 'the employee is the first caller\'s').toBe(SUB.recA);
    expect.soft(sagaOf(c2.tables, KC.p[2]!)['employee_id'], 'the candidate holds that employee').toBe(eid2);
  });

  test('AC-2 All or none: the write is one transaction of five items (an employee, the offer, the candidate, a history row, the email lock of REC-06.1); a failure at any item leaves nothing written and no event; a retry then completes with one employee', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    const t0 = world();
    // The shape of the one write, from a run that completes.
    const s = sentOffer(t0, KC.p[3]!, 0);
    const okRun = must('accept', accept(C.recA, s, s.t, 10));
    const tx = transactionOf(okRun);
    expect(tx.length, 'exactly one TransactWriteItems').toBe(1);
    const items = tx[0]!.map((i: any) => { const kind = Object.keys(i)[0]!; return { kind, table: i[kind].TableName, cond: i[kind].ConditionExpression ?? '' }; });
    expect.soft(items.length, 'five items (REC-06.1 adds the email lock)').toBe(5);
    expect.soft(items.filter((i) => i.table === EMPLOYEES).map((i) => [i.kind, /attribute_not_exists\(\s*employee_id\s*\)/.test(i.cond)]), 'one Put on employees with attribute_not_exists(employee_id)').toEqual([['Put', true]]);
    expect.soft(items.filter((i) => i.table === TABLE.state).length, 'four items on the state table (REC-06.1: the lock row is there too)').toBe(4);
    expect.soft(items.every((i) => i.cond !== ''), 'every item has a condition').toBe(true);
    expect.soft(awsOf(okRun).filter((c: any) => c.service === 'dynamodb' && /^(PutItem|UpdateItem|DeleteItem|BatchWriteItem)$/.test(c.op) && (c.table === EMPLOYEES || JSON.stringify(c.input?.Key ?? c.input?.Item ?? {}).includes('CANDIDATE#'))).map((c: any) => `${c.op} ${c.table}`), 'no employee, candidate or history write outside the transaction').toEqual([]);

    for (const index of [0, 1, 2, 3]) {
      const c = KC.p[4 + index]!;
      const si = sentOffer(t0, c, 20 + index * 20);
      const failed = keep(`accept failing at item ${index}`, accept(C.recA, si, si.t, 30 + index * 20, { extra: { failTransactItem: { index } } }));
      expect.soft(answer(failed), `item ${index} fails: 409 STALE (D-T-6.5)`).toEqual([409, conflict('STALE')]);
      expect.soft(changed(si.t, failed.tables), `item ${index} fails: no row changes`).toEqual([]);
      expect.soft(eventsOf(failed).length, `item ${index} fails: no event`).toBe(0);
      expect.soft(writesOf(failed).filter((w: any) => w.op !== 'TransactWriteItems').map((w: any) => `${w.service} ${w.op}`), `item ${index} fails: nothing else written or sent`).toEqual([]);
      const retry = must(`retry after item ${index}`, accept(C.recA, si, failed.tables, 31 + index * 20));
      expect.soft([bodyOf(retry)?.employee_id, newEmployees(si.t, retry.tables).length, newHistory(si.t, retry.tables, c).length, sagaOf(retry.tables, c)['currentStage']], `retry after item ${index}: one employee, one history row, HIRED`).toEqual([employeeIdOf(A, si.id), 1, 1, 'HIRED']);
    }
  });

  test('AC-2 Two guards: an employee row already at this offer\'s id stops the write; another request that changed the offer or moved the candidate since the read stops it too; nothing is written', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const t0 = world();
    // The employee condition: a row already holds this offer's id (another email, so the rehire check does not see it).
    const s = sentOffer(t0, KC.p[8]!, 0);
    const eid = employeeIdOf(A, s.id);
    const planted = structuredClone(s.t);
    planted[EMPLOYEES] = [...(planted[EMPLOYEES] ?? []), employee(eid, 'Left', 'Over', 'left.over@example.test', A)];
    cancelled('an employee row already at the id', planted, accept(C.recA, s, planted, 10), 409, conflict('STALE'));
    // The offer condition: between the read and the write the offer was withdrawn (version one up).
    const s2 = sentOffer(t0, KC.p[9]!, 20);
    const o = s2.t[TABLE.state]!.find((r) => plain(r)['PK'] === `OFFER#${s2.id}`)!;
    const withdrawn = { ...o, state: { S: 'WITHDRAWN' }, version: { N: String(Number((o as any).version.N) + 1) } };
    const raced = keep('offer withdrawn in between', accept(C.recA, s2, s2.t, 30, { extra: { raceBeforeWrite: { table: TABLE.state, match: { PK: { S: `OFFER#${s2.id}` }, SK: { S: 'OFFER' } }, replace: withdrawn } } }));
    expect.soft(answer(raced), 'the offer changed in between: 409 STALE').toEqual([409, conflict('STALE')]);
    expect.soft([employeeById(raced.tables, employeeIdOf(A, s2.id)).length, sagaOf(raced.tables, KC.p[9]!)['currentStage'], newHistory(s2.t, raced.tables, KC.p[9]!).length, eventsOf(raced).length], 'no employee, the candidate still in Offer, no history, no event').toEqual([0, 'OFFER', 0, 0]);
    // The candidate condition: between the read and the write the candidate became Not hired.
    const s3 = sentOffer(t0, KC.p[10]!, 40);
    const sg = s3.t[TABLE.state]!.find((r) => plain(r)['PK'] === `CANDIDATE#${KC.p[10]}` && plain(r)['SK'] === 'SAGA')!;
    const moved = keep('candidate moved in between', accept(C.recA, s3, s3.t, 50, { extra: { raceBeforeWrite: { table: TABLE.state, match: { PK: { S: `CANDIDATE#${KC.p[10]}` }, SK: { S: 'SAGA' } }, replace: { ...sg, currentStage: { S: 'NOT_HIRED' } } } } }));
    expect.soft(answer(moved), 'the candidate moved in between: 409 STALE').toEqual([409, conflict('STALE')]);
    expect.soft([employeeById(moved.tables, employeeIdOf(A, s3.id)).length, offerRow(moved.tables, s3.id)?.['state'], newHistory(s3.t, moved.tables, KC.p[10]!).length, eventsOf(moved).length], 'no employee, the offer still SENT, no history, no event').toEqual([0, 'SENT', 0, 0]);
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 Rehire stop: an employee of A with the candidate\'s email (stored lower case) is 409 EMAIL_IS_EMPLOYEE with nothing written; capitals and spaces still match and are written lower case; one email-index query with the company filter; B\'s employee never stops A', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const t0 = world();
    const s = sentOffer(t0, KC.rehire, 0);
    const r = keep('accept a rehire', accept(C.recA, s, s.t, 10));
    refused('accept a rehire', s.t, r, 409, conflict('EMAIL_IS_EMPLOYEE'));
    const q = employeeCalls(r);
    expect.soft(q.map((c: any) => `${c.op} ${c.input?.IndexName ?? ''}`), 'one Query on email-index, nothing else on employees').toEqual(['Query email-index']);
    const qv = JSON.stringify(q[0]?.input?.ExpressionAttributeValues ?? {});
    expect.soft(qv.includes(`"${EMAIL.rehire}"`) && qv.includes(A) && !qv.includes(B), 'it asks for the lower-case email with company A\'s filter').toBe(true);
    expect.soft(String(q[0]?.input?.FilterExpression ?? '') + JSON.stringify(q[0]?.input?.ExpressionAttributeNames ?? {}), 'the filter is on tenant_id (tenantFilter)').toMatch(/tenant_id/);
    expect.soft(JSON.stringify(bodyOf(r)).match(new RegExp(`${EMP.rehireA}|${EMP.rehireB}|${B}`)), 'the answer names no employee and no company').toBeNull();
    // A candidate row holding capitals and spaces (an old row) still matches A's lower-case employee.
    const sc = sentOffer(t0, KC.capsStored, 20);
    refused('accept a rehire stored with capitals and spaces', sc.t, accept(C.recA, sc, sc.t, 30), 409, conflict('EMAIL_IS_EMPLOYEE'));
    // The same candidate once A's employee is gone: converts, and the employee row holds the email trimmed and lower case.
    const noMatch = { ...sc.t, employees: (sc.t['employees'] ?? []).filter((x: any) => !(x.tenant_id?.S === A && x.email?.S === EMAIL.rehire)) } as Tables;
    const conv = must('accept the capitals candidate with no matching employee', accept(C.recA, sc, noMatch, 35));
    expect.soft(newEmployees(noMatch, conv.tables).map((x) => x['email']), 'the new employee\'s email is trimmed and lower case').toEqual([EMAIL.rehire]);
    // A candidate added through the real add-candidate route with capitals and spaces: stored lower case, so it matches.
    const add = must('add a candidate with capitals', call('createCandidate', 'POST /v1/candidates', C.recA, { body: { first_name: 'Rehire', last_name: 'Again', email: '  Rehire.Person@Example.Test ', role_id: K.ra } }, t0, { now: at(40), headers: { 'idempotency-key': 'rec06-add-caps-1' } }));
    const added = rowsOf(add.tables).find((x) => x['SK'] === 'SAGA' && x['lastName'] === 'Again');
    expect(added?.['email'], 'add-candidate stored the email trimmed and lower case').toBe(EMAIL.rehire);
    const inOffer = withSaga(add.tables, added!['candidateId'], { currentStage: 'OFFER' });
    const sa = sentOffer(inOffer, added!['candidateId'], 50);
    refused('accept a rehire added with capitals', sa.t, accept(C.recA, sa, sa.t, 60), 409, conflict('EMAIL_IS_EMPLOYEE'));
    // Only B has an employee with this email: A converts; B's rows are untouched and nowhere in A's answer or rows.
    const sb = sentOffer(t0, KC.sharedB, 70);
    const ab = must('accept with B\'s employee email', accept(C.recA, sb, sb.t, 80));
    const e = newEmployees(sb.t, ab.tables);
    expect.soft(e.map((x) => [x['tenant_id'], x['email']]), 'A converts: one employee of A').toEqual([[A, EMAIL.sharedB]]);
    expect.soft(employeesOf(ab.tables).filter((x) => x['tenant_id'] === B), 'B\'s employees unchanged').toEqual(employeesOf(sb.t).filter((x) => x['tenant_id'] === B));
    expect.soft(JSON.stringify(bodyOf(ab)).includes(EMP.sharedB) || JSON.stringify(e).includes(EMP.sharedB) || JSON.stringify(e).includes(B), 'nothing of B\'s row in A\'s answer or rows').toBe(false);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Refused callers: 403 before any AWS call for an old-HR-name Recruiter without hr_staff (also on a repeat), a hiring manager, an approver, an admin and others; decline by the old-HR-name Recruiter still works (L-1)', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const t0 = world();
    const s = sentOffer(t0, KC.p[11]!, 0);
    for (const who of [P.oldHr, P.oldHrDir, C.hmA, C.apprA, C.adminA, C.hrNoTickA, C.empA, C.guestA]) {
      const r = keep(`accept by ${who.name}`, accept(who, s, s.t, 10));
      expect.soft([...answer(r), awsOf(r).length], `${who.name} records ACCEPTED: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
      expect.soft(changed(s.t, r.tables), `${who.name}: nothing changes`).toEqual([]);
    }
    // The same request key a real HR caller used does not let the old-HR-name Recruiter through.
    const key = { headers: { 'idempotency-key': 'rec06-key-1' } };
    const done = must('accept with a request key', accept(C.recA, s, s.t, 20, key));
    for (const who of [P.oldHr, P.oldHrDir]) {
      const rep = keep(`repeat by ${who.name}`, accept(who, s, done.tables, 21, key));
      expect.soft([...answer(rep), awsOf(rep).length], `${who.name} repeats ACCEPTED on the converted offer (same key): 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
      const rep2 = keep(`repeat by ${who.name}, no key`, accept(who, s, done.tables, 22));
      expect.soft([...answer(rep2), awsOf(rep2).length, eventsOf(rep2).length], `${who.name} repeats without a key: 403, no AWS call, no event`).toEqual([403, FORBIDDEN, 0, 0]);
    }
    // Decline and withdraw keep REC-05's rule: the old-HR-name Recruiter may decline.
    const sd = sentOffer(t0, KC.p[12]!, 30);
    const dec = must('decline by the old-HR-name Recruiter', act(R.answer, P.oldHr, sd.id, { answer: 'DECLINED' }, sd.t, { now: at(40) }));
    expect.soft([bodyOf(dec)?.state, newEmployees(sd.t, dec.tables).length, sagaOf(dec.tables, KC.p[12]!)['currentStage']], 'DECLINED, no employee, the candidate stays in Offer').toEqual(['DECLINED', 0, 'OFFER']);
  });

  test('AC-4 Refused states and bodies: an offer not SENT (a REC-05-era accept without an employee too, L-5) is NOT_SENT; a candidate not in Offer or not of this company is NOT_OPEN; a bad signed key or date is 400; each with no write and no event; HIRED cannot be moved', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    let t = world();
    // Offers in DRAFT, WAITING_APPROVAL, APPROVED (through the routes), DECLINED and WITHDRAWN.
    const draft = must('draft', call(OFFERS, R.create, C.recA, { body: { candidate_id: KC.p[13], salary: 400000, start_date: '2027-01-04', expiry_date: '2026-12-10' } }, t, { now: at(0) }));
    const dId = bodyOf(draft).offer_id as string;
    t = draft.tables;
    const waitingMade = must('draft 2', call(OFFERS, R.create, C.recA, { body: { candidate_id: KC.p[14], salary: 400000, start_date: '2027-01-04', expiry_date: '2026-12-10' } }, t, { now: at(1) }));
    const wId = bodyOf(waitingMade).offer_id as string;
    const waiting = must('submit', act(R.submit, C.recA, wId, {}, waitingMade.tables, { now: at(2) }));
    const apMade = must('draft 3', call(OFFERS, R.create, C.recA, { body: { candidate_id: KC.p[15], salary: 400000, start_date: '2027-01-04', expiry_date: '2026-12-10' } }, waiting.tables, { now: at(3) }));
    const aId = bodyOf(apMade).offer_id as string;
    const sub = must('submit 3', act(R.submit, C.recA, aId, {}, apMade.tables, { now: at(4) }));
    const approved = must('approve 3', act(R.approve, C.apprA, aId, { version: bodyOf(sub).version }, sub.tables, { now: at(5) }));
    t = approved.tables;
    const sDec = sentOffer(t, KC.p[16]!, 10);
    const declined = must('decline', act(R.answer, C.recA, sDec.id, { answer: 'DECLINED' }, sDec.t, { now: at(20) }));
    const sWd = sentOffer(declined.tables, KC.p[17]!, 30);
    const withdrawn = must('withdraw', act(R.withdraw, C.recA, sWd.id, {}, sWd.t, { now: at(40) }));
    t = withdrawn.tables;
    const s3 = { ...sDec.s3, objects: { ...sDec.s3.objects, ...sWd.s3.objects } };
    for (const [what, id] of [['DRAFT', dId], ['WAITING_APPROVAL', wId], ['APPROVED', aId], ['DECLINED', sDec.id], ['WITHDRAWN', sWd.id]] as const) {
      const key = `recruitment/${A}/offers/${id}/01REC06NOTSENT000000000000`;
      refused(`ACCEPTED on ${what}`, t, act(R.answer, C.recA, id, { answer: 'ACCEPTED', signed_key: key, confirmed_start_date: CONFIRMED }, t, { now: at(50), extra: { s3: { ...s3, objects: { ...s3.objects, [key]: { size: 1000, contentType: 'application/pdf' } } } } }), 409, conflict('NOT_SENT'));
    }
    // L-5: an offer accepted under REC-05 (ACCEPTED, no employee_id): a repeat ACCEPTED stays NOT_SENT; no employee is made.
    const sOld = sentOffer(t0(), KC.p[18]!, 60);
    const oldAccepted = withOffer(sOld.t, sOld.id, { state: 'ACCEPTED', answered_at: at(65), answered_by: SUB.recA, signed_key: sOld.key, confirmed_start_date: CONFIRMED }, ['employee_id']);
    refused('ACCEPTED again on a REC-05-era accepted offer', oldAccepted, accept(C.recA, sOld, oldAccepted, 70), 409, conflict('NOT_SENT'));

    // Bodies (rule 5): on a SENT offer, each refused with no write.
    const sb = sentOffer(t0(), KC.p[19]!, 80);
    const bodies: [string, unknown, number, unknown][] = [
      ['no signed_key', { answer: 'ACCEPTED', confirmed_start_date: CONFIRMED }, 400, invalid('signed_key')],
      ['no confirmed_start_date', { answer: 'ACCEPTED', signed_key: sb.key }, 400, invalid('confirmed_start_date')],
      ['a date that is not a day', { answer: 'ACCEPTED', signed_key: sb.key, confirmed_start_date: '2027-13-01' }, 400, invalid('confirmed_start_date')],
      ['another offer\'s key', { answer: 'ACCEPTED', signed_key: `recruitment/${A}/offers/${sDec.id}/01REC06OTHER00000000000000`, confirmed_start_date: CONFIRMED }, 400, BAD_KEY],
      ['a key under company B', { answer: 'ACCEPTED', signed_key: `recruitment/${B}/offers/${sb.id}/01REC06OTHERB0000000000000`, confirmed_start_date: CONFIRMED }, 400, BAD_KEY],
    ];
    for (const [what, body, status, b] of bodies) {
      const objects = { ...sb.s3.objects, [`recruitment/${A}/offers/${sDec.id}/01REC06OTHER00000000000000`]: { size: 1000, contentType: 'application/pdf' }, [`recruitment/${B}/offers/${sb.id}/01REC06OTHERB0000000000000`]: { size: 1000, contentType: 'application/pdf' } };
      refused(`accept with ${what}`, sb.t, act(R.answer, C.recA, sb.id, body, sb.t, { now: at(90), extra: { s3: { ...sb.s3, objects } } }), status, b);
    }
    refused('accept with a key never uploaded', sb.t, act(R.answer, C.recA, sb.id, acceptBody(sb), sb.t, { now: at(91), extra: { s3: { ...sb.s3, objects: {} } } }), 400, BAD_KEY);

    // The candidate is not in Offer (Not hired; legacy-hired; Interview) or the row is not this company's: NOT_OPEN.
    const cases: [string, Record<string, unknown>][] = [
      ['Not hired', { currentStage: 'NOT_HIRED' }], ['legacy-hired (REC-03)', { currentStage: 'HIRED', legacy_hired: true }], ['Interview', { currentStage: 'INTERVIEW' }],
      ['an old outcome on the row (status REJECTED)', { status: 'REJECTED' }], ['another company\'s row', { tenant_id: B }],
    ];
    const sn = sentOffer(t0(), KC.main, 100);
    for (const [what, set] of cases) {
      const moved = withSaga(sn.t, KC.main, set);
      refused(`accept when the candidate is ${what}`, moved, accept(C.recA, sn, moved, 110), 409, conflict('NOT_OPEN'));
    }
    // Once HIRED the candidate cannot be moved (move-candidate.mjs: NOT_OPEN).
    const conv = must('accept', accept(C.recA, sn, sn.t, 120));
    refused('move the hired candidate back to Offer', conv.tables, call('advanceCandidateStage', 'PUT /v1/candidates/{id}/stage', C.recA, { id: KC.main, body: { to: 'OFFER', reason: 'Changed our mind.' } }, conv.tables, { now: at(130) }), 409, conflict('NOT_OPEN'));

    function t0() { return world(); }
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 Contract with createEmployee: the same attribute names and DynamoDB types as the row the locked createEmployee writes, but from_recruitment; both ids UUID-shaped; both INVITED; no salary, score, note or CV on REC-06\'s row', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(180_000);
    const t0 = world();
    t0['employee_invites'] = [];
    t0['naleko-idempotency-keys'] = t0['naleko-idempotency-keys'] ?? [];
    // createEmployee, as HR of A, for the same person.
    const ce = keep('createEmployee', call('createEmployee', 'POST /v1/employees', C.recA, {
      body: { first_name: 'Thandeka', last_name: 'Mahlaba', email: 'thandeka.contract@example.test', phone: PHONE, department: 'Operations', job_title: 'Fleet controller', offer_accept_date: ACCEPT_DAY, planned_start_date: CONFIRMED },
    }, t0, { now: at(0), env: { EVENT_BUS_NAME: 'naleko-onboarding', COGNITO_POOL_ID: 'af-south-1_Rec01Fake', LOGIN_URL: 'http://localhost:4300/sign-in', POSTMARK_SENDER_EMAIL: 'sender@example.test', COMPANY_NAME: 'Mokoena Bakeries', APP_URL: 'http://localhost:4300', POSTMARK_API_TOKEN: 'rec06-fake', KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/rec06-fake' } }));
    expect([200, 201], `createEmployee runs in this fake (${describe(ce)})`).toContain(statusOf(ce));
    const put = awsOf(ce).find((c: any) => c.service === 'dynamodb' && c.op === 'PutItem' && c.table === EMPLOYEES);
    expect(put, 'createEmployee puts one employee row').toBeTruthy();
    const theirs = put.input.Item as Record<string, Record<string, unknown>>;
    // REC-06, for the main candidate.
    const s = sentOffer(t0, KC.main, 10);
    const r = must('accept', accept(C.recA, s, s.t, 20));
    const tx = transactionOf(r)[0] ?? [];
    const mine = (tx.map((i: any) => i.Put).find((p: any) => p?.TableName === EMPLOYEES)?.Item ?? {}) as Record<string, Record<string, unknown>>;
    const types = (item: Record<string, Record<string, unknown>>, leave: RegExp) => Object.fromEntries(Object.entries(item).filter(([k]) => !leave.test(k)).map(([k, v]) => [k, Object.keys(v).join('')]).sort());
    expect.soft(types(mine, /^from_recruitment$/), 'the same attribute names and DynamoDB types as createEmployee\'s row').toEqual(types(theirs, /^id_number_/));
    expect.soft(Object.keys(mine.from_recruitment ?? {}), 'from_recruitment is a map').toEqual(['M']);
    expect.soft([mine.employee_id?.S, theirs.employee_id?.S].map((x) => UUID_SHAPE.test(String(x))), 'both ids have the UUID text shape').toEqual([true, true]);
    expect.soft([mine.stage?.S, theirs.stage?.S], 'both start at INVITED').toEqual(['INVITED', 'INVITED']);
    expect.soft(keysDeep(plain(mine as any)).filter((k) => /salary|score|note|cv/i.test(k)), 'no salary, score, note or CV attribute').toEqual([]);
    expect.soft(Object.keys(mine).filter((k) => /^(user_sub|sfn_task_token|id_number|interview|offer_details|benefits|currency)/.test(k)), 'none of the never-written attributes (rule 4)').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 Nothing sent: no sign-in made, no email, no queue or topic message, no state machine, no OfferAccepted or employee.invited, no IT bundle row; exactly CandidateHired and OfferAnswered with the rule 5 fields and no name, email, phone or salary', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(180_000);
    const s = sentOffer(world(), KC.main, 0);
    const r = must('accept', accept(C.recA, s, s.t, 10));
    const eid = employeeIdOf(A, s.id);
    const outside = r.calls.filter((c: any) => /^(sqs|sns|ses|lambda|http|postmark|sfn|kms)$/.test(c.service) || (c.service === 'cognito' && !/^(List|AdminGet|AdminList)/.test(c.op ?? ''))).map((c: any) => `${c.service} ${c.op ?? ''}`);
    expect.soft(outside, 'nothing is emailed, queued, invoked, started, and no sign-in is made').toEqual([]);
    const ev = eventsOf(r);
    expect.soft(ev.map((e: any) => e.detailType).sort(), 'exactly two events: CandidateHired and OfferAnswered').toEqual(['CandidateHired', 'OfferAnswered']);
    expect.soft(ev.map((e: any) => [e.detailType, e.source, e.bus]).sort(), 'both on the talent-flow bus with OfferAnswered\'s source').toEqual([['CandidateHired', EVENT_SOURCE, BUS], ['OfferAnswered', EVENT_SOURCE, BUS]]);
    expect.soft(ev.find((e: any) => e.detailType === 'CandidateHired')?.detail, 'CandidateHired { tenant_id, candidate_id, role_id, employee_id, offer_id, at }').toEqual({ tenant_id: A, candidate_id: KC.main, role_id: K.ra, employee_id: eid, offer_id: s.id, at: at(10) });
    expect.soft(ev.find((e: any) => e.detailType === 'OfferAnswered')?.detail, 'OfferAnswered { tenant_id, offer_id, candidate_id, answer }').toEqual({ tenant_id: A, offer_id: s.id, candidate_id: KC.main, answer: 'ACCEPTED' });
    const evText = JSON.stringify(ev.map((e: any) => e.detail));
    for (const bad of ['Thandeka', 'Mahlaba', EMAIL.main, PHONE, '555 0101', ...SALARY_TEXT]) expect.soft(evText.includes(bad), `no event holds ${bad}`).toBe(false);
    expect.soft(keysDeep(ev.map((e: any) => e.detail)).filter((k) => /name|email|phone|salary/i.test(k)), 'no name, email, phone or salary field').toEqual([]);
    // Only the state table and employees change: no IT task, bundle, notification, invite or audit row.
    const tables = [...new Set(changed(s.t, r.tables).map((x) => x.split(' ')[0]))].sort();
    expect.soft(tables, 'rows change only in the state table and employees').toEqual([EMPLOYEES, TABLE.state].sort());
    // In the code: no OfferAccepted, no employee.invited, no invite, no state machine, no email client (comments left out).
    const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const L = join(REPO, 'lambda');
    for (const f of [join(L, 'manageOffers', 'index.mjs'), join(L, 'shared', 'recruitment-actions', 'offers.mjs'), join(L, 'shared', 'employee-row.mjs')].filter(existsSync)) {
      expect.soft(code(f), `${f.slice(REPO.length + 1)}: no OfferAccepted, employee.invited, issueInvite, StartExecution, postmark or SES`).not.toMatch(/OfferAccepted|employee\.invited|issueInvite|StartExecution|postmark|client-ses|client-sesv2|client-sns|client-sqs/);
    }
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 Company B: B\'s Recruiter on A\'s offer gets 404 and nothing changes; the company and the person never come from headers, query or body; B converts its own offer into B; B\'s employee never stops A', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const t0 = world();
    const s = sentOffer(t0, KC.main, 0);
    refused('B\'s Recruiter accepts A\'s offer', s.t, accept(C.recB, s, s.t, 10), 404, NOT_FOUND);
    refused('B\'s Recruiter accepts A\'s offer naming A everywhere', s.t, act(R.answer, C.recB, s.id, acceptBody(s, { tenant_id: A, tenantId: A }), s.t, {
      now: at(11), headers: { 'x-tenant-id': A, 'X-Tenant-Id': A, 'x-company-id': A, 'tenant-id': A, tenant_id: A }, query: { tenant_id: A, tenantId: A }, extra: { s3: s.s3 },
    }), 404, NOT_FOUND);
    const doneA = must('A accepts', accept(C.recA, s, s.t, 12));
    refused('B\'s Recruiter repeats on A\'s converted offer', doneA.tables, act(R.answer, C.recB, s.id, acceptBody(s), doneA.tables, { now: at(13), extra: { s3: s.s3 } }), 404, NOT_FOUND);
    // A's Recruiter naming B everywhere converts A's offer into A, and B's employee with the same email does not stop it.
    const sb = sentOffer(t0, KC.sharedB, 20);
    // The body also names a person: the employee is still made from the saved candidate, never from the body.
    const fromBody = { email: 'someone.else@example.test', first_name: 'Forged', last_name: 'Person', phone: '+27 82 000 0000', department: 'Finance', job_title: 'Forged title', employee_id: EMP.rehireA, stage: 'VERIFIED' };
    const forged = must('A accepts naming B everywhere', act(R.answer, C.recA, sb.id, acceptBody(sb, { tenant_id: B, tenantId: B, ...fromBody }), sb.t, { now: at(30), ...FORGED_B, extra: { s3: sb.s3 } }));
    expect.soft(newEmployees(sb.t, forged.tables).map((e) => [e['tenant_id'], e['employee_id']]), 'one employee of A with A\'s id').toEqual([[A, employeeIdOf(A, sb.id)]]);
    const savedB = sagaOf(sb.t, KC.sharedB);
    const fe = newEmployees(sb.t, forged.tables)[0] ?? {};
    expect.soft([fe['email'], fe['first_name'], fe['last_name'], fe['stage']], 'the person comes from the saved candidate, not the body').toEqual([String(savedB['email']).trim().toLowerCase(), savedB['firstName'], savedB['lastName'], 'INVITED']);
    expect.soft(JSON.stringify(fe).match(/Forged|someone\.else|000 0000/), 'nothing from the body is in the employee row').toBeNull();
    const q = employeeCalls(forged).find((c: any) => c.op === 'Query');
    expect.soft(JSON.stringify(q?.input?.ExpressionAttributeValues ?? {}).includes(B), 'the rehire check filters on A, never B').toBe(false);
    // B's own offer: converts into B, with B's id; A's rows untouched.
    const bs = sentOffer(t0, KC.bMain, 40);
    const br = must('B accepts its own offer', accept(C.recB, bs, bs.t, 50));
    const be = newEmployees(bs.t, br.tables);
    expect.soft(be.map((e) => [e['tenant_id'], e['employee_id'], e['created_by']]), 'one employee of B, B\'s id, made by B\'s Recruiter').toEqual([[B, employeeIdOf(B, bs.id), SUB.recB]]);
    expect.soft(sagaOf(br.tables, KC.bMain)['currentStage'], 'B\'s candidate is HIRED').toBe('HIRED');
    expect.soft(changed(bs.t, br.tables).filter((x) => x.includes(A)), 'nothing of A changes').toEqual([]);
    // And A's Recruiter on B's offer: 404.
    refused('A\'s Recruiter accepts B\'s offer', bs.t, accept(C.recA, bs, bs.t, 60), 404, NOT_FOUND);
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Follow-ups finish: with the bus down the accept still answers 200 and leaves no marker; a repeat claims, sends CandidateHired and OfferAnswered once, then sets the marker; a third sends nothing; logs carry ids and error names only', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const s = sentOffer(world(), KC.p[3]!, 0);
    const eid = employeeIdOf(A, s.id);
    const r1 = keep('accept with the bus down', accept(C.recA, s, s.t, 10, { extra: { fail: { service: 'events', message: 'Thandeka Mahlaba thandeka.mahlaba@example.test the bus is down', name: 'InternalFailure' } } }));
    expect.soft([statusOf(r1), bodyOf(r1)?.state, bodyOf(r1)?.employee_id], `the accept answers 200 (${describe(r1)})`).toEqual([200, 'ACCEPTED', eid]);
    expect.soft([employeeById(r1.tables, eid).length, sagaOf(r1.tables, KC.p[3]!)['currentStage']], 'the employee and the hire are written').toEqual([1, 'HIRED']);
    expect.soft(marker(r1.tables, s.id) ?? null, 'no followups_done.hired_event marker').toBeNull();
    const r2 = keep('repeat after the bus came back', accept(C.recA, s, r1.tables, 20));
    expect.soft([statusOf(r2), bodyOf(r2)?.employee_id], 'the repeat answers 200 with the same employee').toEqual([200, eid]);
    expect.soft(eventsOf(r2).map((e: any) => e.detailType).sort(), 'the repeat sends CandidateHired and OfferAnswered, once each').toEqual(['CandidateHired', 'OfferAnswered']);
    expect.soft(eventsOf(r2, 'CandidateHired')[0]?.detail, 'CandidateHired carries the accept\'s time (D-T-6.3)').toEqual({ tenant_id: A, candidate_id: KC.p[3], role_id: K.ra, employee_id: eid, offer_id: s.id, at: at(10) });
    expect.soft(Boolean(marker(r2.tables, s.id)), 'the marker is set').toBe(true);
    expect.soft([employeeById(r2.tables, eid).length, newHistory(s.t, r2.tables, KC.p[3]!).length, transactionOf(r2).length], 'no second employee, history row or transaction').toEqual([1, 1, 0]);
    const markerWrite = writesOf(r2).filter((w: any) => w.service === 'dynamodb');
    expect.soft(markerWrite.map((w: any) => `${w.op} ${w.table}`), 'the only writes are the claim, then the marker, on the offer (REC-06.1 rule 6)').toEqual([`UpdateItem ${TABLE.state}`, `UpdateItem ${TABLE.state}`]);
    expect.soft(String(markerWrite[0]?.input?.ConditionExpression ?? ''), 'the claim write is held to the company (condition on tenant_id)').toMatch(/tenant_id/);
    expect.soft(String(markerWrite[1]?.input?.ConditionExpression ?? ''), 'the marker write is held to the company (condition on tenant_id)').toMatch(/tenant_id/);
    const r3 = keep('third call', accept(C.recA, s, r2.tables, 30));
    expect.soft([statusOf(r3), eventsOf(r3).length], 'a third call: 200 and no event').toEqual([200, 0]);
    nothingDone('third call', r2.tables, r3);
    // AC-8's own runs of the other paths that log: a rehire stop, a cancelled write, a refused caller (lock check MF-2: the log check
    // must not rest on runs other tests happened to make first).
    const sr = sentOffer(world(), KC.rehire, 40);
    const rRehire = keep('rehire stop', accept(C.recA, sr, sr.t, 45));
    expect.soft(statusOf(rRehire), 'rehire stop answers 409').toBe(409);
    const sx = sentOffer(world(), KC.p[4]!, 50);
    const rCancel = keep('write cancelled at the employee item', accept(C.recA, sx, sx.t, 55, { extra: { failTransactItem: { index: 0 } } }));
    expect.soft(statusOf(rCancel), 'a cancelled write answers 409').toBe(409);
    const rRefused = keep('old-HR-name Recruiter refused', accept(P.oldHr, sx, sx.t, 56));
    expect.soft(statusOf(rRefused), 'the old-HR-name Recruiter is refused').toBe(403);
    // Logs: the offer id and error names; never any person's name, email or phone from the world (both companies, candidates and
    // employees), nor the body's forged person (AC-7), the salary, or the error's own words.
    const leak = leakPattern();
    const own = [['accept with the bus down', r1], ['repeat after the bus came back', r2], ['third call', r3], ['rehire stop', rRehire], ['write cancelled at the employee item', rCancel], ['old-HR-name Recruiter refused', rRefused]] as [string, Run][];
    for (const [what, run] of [...own, ...RUNS.filter((x) => !own.some(([, r]) => r === x.run)).map((x) => [x.what, x.run] as [string, Run])]) {
      const leaks = logsOf(run).filter((l) => leak.test(l));
      expect.soft(leaks, `${what}: no name, email, phone, salary or error text in the logs`).toEqual([]);
    }
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 Roles and Terraform: manageOffers gains exactly PutItem on employees and Query on employees/index/email-index; nothing else moves; no wildcard, states:, ses:, delete or scan; the role is on the key\'s allowed_role_arns exactly once; no table rows; no packages', async ({}, testInfo) => {
    once(testInfo.project.name);
    const fn = lambdaNamed(OFFERS);
    expect(fn.length, 'one aws_lambda_function named manageOffers').toBe(1);
    const role = roleResourceOf(fn[0]!.block);
    expect(role, 'it runs as aws_iam_role.manage_offers').toBe('manage_offers');
    const lines = Object.values(policyLines()).filter((x) => x.stack === fn[0]!.stack && x.role === role).flatMap((x) => x.pairs ?? [`unreadable ${x.squash}`]);
    // policyLines() reads ${var.aws_account_id} as 000000000000: the Terraform text is arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/...
    const NEW = [
      'Allow dynamodb:PutItem arn:aws:dynamodb:af-south-1:000000000000:table/employees null',
      'Allow dynamodb:Query arn:aws:dynamodb:af-south-1:000000000000:table/employees/index/email-index null',
    ];
    const BASE = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-06', 'manage-offers-lines.20b1bab.json'), 'utf8')) as string[];
    for (const n of NEW) expect.soft(lines.filter((x) => x === n).length, `exactly once: ${n}`).toBe(1);
    expect.soft(lines.filter((x) => !NEW.includes(x)).sort(), 'every other line is as on develop 20b1bab (add only)').toEqual([...BASE].sort());
    expect.soft(lines.filter((x) => /employees/.test(x) && !NEW.includes(x)), 'no other grant names employees').toEqual([]);
    for (const line of lines) {
      const [, action, resource] = line.split(' ');
      expect.soft(/\*/.test(action ?? ''), `${line}: no wildcard action`).toBe(false);
      if (!/^(xray|logs|s3):/.test(action ?? '')) expect.soft(/\*/.test(resource ?? ''), `${line}: no wildcard resource`).toBe(false);
      expect.soft(/^(states|sfn|ses|sns|sqs):|^dynamodb:(DeleteItem|Scan|BatchWriteItem)$/.test(action ?? ''), `${line}: no state machine, email, message, delete or scan`).toBe(false);
    }
    // The key: manageOffers on allowed_role_arns exactly once (it is also on dynamodb_read_role_arns, which stays: L-4).
    const ARN = '"arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-manageOffers"';
    const listOf = (name: 'allowed_role_arns' | 'dynamodb_read_role_arns') => kmsList(name).replace(/^\[|\]$/g, '').split(',').filter(Boolean);
    expect.soft(listOf('allowed_role_arns').filter((x) => x === ARN).length, 'manageOffers is on allowed_role_arns exactly once').toBe(1);
    expect.soft(listOf('allowed_role_arns').filter((x) => /manageOffers/.test(x) && x !== ARN), 'no other spelling of it there').toEqual([]);
    expect.soft(listOf('dynamodb_read_role_arns').filter((x) => x === ARN).length, 'and still on dynamodb_read_role_arns once').toBe(1);
    expect.soft(STACKS.flatMap((st) => resourcesOf(st, 'aws_dynamodb_table_item').map((b) => b.labels[1])), 'no table rows in Terraform').toEqual([]);
    // A setting the code reads for the employees table is set on manageOffers (D-T-6.2).
    const L = join(REPO, 'lambda');
    const src = [join(L, 'manageOffers', 'index.mjs'), join(L, 'shared', 'recruitment-actions', 'offers.mjs'), join(L, 'shared', 'employee-row.mjs')].filter(existsSync).map((f) => readFileSync(f, 'utf8')).join('\n');
    const env = settingsOf(fn[0]!.block);
    for (const name of new Set([...src.matchAll(/process\.env\.(EMPLOYEES?_\w+)/g)].map((m) => m[1]!))) expect.soft(env.has(name), `manageOffers has the setting ${name} the code reads`).toBe(true);
    // L-3: manageOffers ships no packages; the employee row and its id need only Node's own modules.
    const pkg = JSON.parse(readFileSync(join(L, 'manageOffers', 'package.json'), 'utf8'));
    expect.soft(Object.keys(pkg.dependencies ?? {}), 'manageOffers/package.json has no dependencies').toEqual([]);
    expect(existsSync(join(L, 'shared', 'employee-row.mjs')), 'lambda/shared/employee-row.mjs exists (D-REC-6.1)').toBe(true);
    const row = readFileSync(join(L, 'shared', 'employee-row.mjs'), 'utf8');
    const imports = [...row.matchAll(/(?:import[^'"]*from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    expect.soft(imports.filter((x) => !/^node:|^\.\.?\//.test(x)), 'employee-row.mjs imports only node: modules and local files').toEqual([]);
    expect.soft(row.includes(EMPLOYEE_ID_NAMESPACE), 'employee-row.mjs holds the namespace constant (D-T-6.1)').toBe(true);
    expect.soft(/['"]uuid['"]/.test(src), 'no uuid package anywhere in the offer code').toBe(false);
    void [attributes, blocks, readdirSync];
  });

  // ---------------------------------------------------------------- AC-10

  test('AC-10 pepla-dev: the seed puts both offers back each run and removes the employees it made (text check)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-06', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    expect.soft([ids['email'], ids['rehireEmail']].every((e) => /@blackhole\.postmarkapp\.com$/.test(e ?? '')), 'both seeded emails are robot addresses').toBe(true);
    const src = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    const start = src.indexOf('def seed_rec06(');
    expect(start, 'seed-dev.py has seed_rec06').toBeGreaterThan(-1);
    const fnSrc = src.slice(start, src.indexOf('\ndef ', start + 10) === -1 ? undefined : src.indexOf('\ndef ', start + 10));
    expect.soft(src.slice(src.indexOf('def main(')), 'main() calls seed_rec06').toMatch(/seed_rec06\(\s*ddb\s*,/);
    expect.soft(fnSrc, 'it reads support/rec-06/dev-ids.json').toMatch(/rec-06[\s\S]*dev-ids\.json/);
    expect.soft(fnSrc, 'it makes the employee ids with uuid5 and the namespace').toMatch(new RegExp(`uuid5[\\s\\S]*${EMPLOYEE_ID_NAMESPACE}|${EMPLOYEE_ID_NAMESPACE}[\\s\\S]*uuid5`));
    expect.soft(fnSrc, 'it deletes those employee rows on condition of the company').toMatch(/delete_item\([\s\S]*employees[\s\S]*ConditionExpression[\s\S]*tenant_id/);
    expect.soft(fnSrc, 'it puts the offers back to SENT').toMatch(/"SENT"/);
    expect.soft(fnSrc, 'it puts the candidates back to OFFER').toMatch(/"OFFER"/);
    expect.soft(fnSrc, 'it writes the rehire employee with the robot address').toMatch(/rehireEmail|rehire_email/);
    expect.soft(fnSrc.includes('Scan') || /scan\(/.test(fnSrc), 'it scans nothing (the ids are known)').toBe(false);
  });

  test('AC-10 The test logins on pepla-dev: the Recruiter accepts the seeded offer with a real signed copy; the candidate reads HIRED; A\'s employee list has the person once; B does not; a repeat gives the same employee; the rehire offer is EMAIL_IS_EMPLOYEE @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1 to AC-9.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(6 * 60_000);
    const envOf = (k: string) => process.env[k] ?? '';
    const login = (p: string) => ({ email: envOf(`${p}_EMAIL`), password: envOf(`${p}_PASSWORD`) });
    const logins = { hr: login('E2E_HR'), companyB: login('E2E_HR_B') };
    for (const [who, l] of Object.entries(logins)) expect(l.email && l.password, `the ${who} test login is set`).toBeTruthy();
    const { devEnv } = await import('./support/ten-02/dev');
    const { region, clientId, api: empApi } = devEnv();
    const appEnv = readFileSync(join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts'), 'utf8');
    const tfApi = (/talentFlowApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(appEnv)?.[1] ?? '').replace(/\/+$/, '').replace(/\/v1$/, '');
    expect(tfApi, 'pepla-web\'s talentFlowApiUrl points at pepla-dev\'s TalentFlow API').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const signIn = async (l: { email: string; password: string }) => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: l.email, PASSWORD: l.password } }),
      });
      expect(r.status(), 'signs in at Cognito').toBe(200);
      return ((await r.json()) as any).AuthenticationResult.IdToken as string;
    };
    const claimsOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, any>;
    const call2 = async (base: string, token: string, method: string, path: string, body?: unknown) =>
      page.request.fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { data: JSON.stringify(body) }) });
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-06', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const [hr, companyB] = await Promise.all([signIn(logins.hr), signIn(logins.companyB)]);
    const tenant = claimsOf(hr)['tenant_id'] as string;
    expect(tenant, 'the HR login carries its company').toMatch(/^ten_[0-9a-z]{26}$/);
    /** Every employee of the caller's company, every page. */
    const allEmployees = async (token: string) => {
      const out: any[] = [];
      let lastKey: string | undefined;
      for (let i = 0; i < 50; i++) {
        const r = await call2(empApi, token, 'GET', `/v1/employees?limit=200${lastKey ? `&lastKey=${encodeURIComponent(lastKey)}` : ''}`);
        expect(r.status(), 'GET /v1/employees').toBe(200);
        const b = (await r.json()) as { items: any[]; lastKey?: string };
        out.push(...b.items);
        lastKey = b.lastKey;
        if (!lastKey) break;
      }
      return out;
    };
    /** Uploads a small PDF through the offer's own upload link and returns its signed_key. */
    const signedCopy = async (offerId: string) => {
      const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n% REC-06 dev test signed copy\n'), Buffer.alloc(2048, 32), Buffer.from('\n%%EOF\n')]);
      const up = await call2(tfApi, hr, 'POST', `/v1/offers/${offerId}/signed-upload`, { file_name: 'Signed offer.pdf', content_type: 'application/pdf', file_size: pdf.length });
      expect(up.status(), `an upload link for ${offerId} (${await up.text()})`).toBe(200);
      const { upload_url: url, signed_key: key } = (await up.json()) as { upload_url: string; signed_key: string };
      const put = await page.request.fetch(url, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, data: pdf });
      expect([200, 204], `the signed copy is stored (${put.status()})`).toContain(put.status());
      return key;
    };
    // The seeded offer is SENT again (the seed puts it back each run).
    const before = (await (await call2(tfApi, hr, 'GET', `/v1/offers/${ids['offer']}`)).json()) as any;
    expect(before.state, 'the seeded offer is SENT').toBe('SENT');
    const key = await signedCopy(ids['offer']!);
    const acc = await call2(tfApi, hr, 'POST', `/v1/offers/${ids['offer']}/answer`, { answer: 'ACCEPTED', signed_key: key, confirmed_start_date: ids['startDate'] });
    const accBody = (await acc.json()) as any;
    expect(acc.status(), `the Recruiter records the accept (${JSON.stringify(accBody)})`).toBe(200);
    const eid = employeeIdOf(tenant, ids['offer']!);
    expect([accBody.state, accBody.employee_id], 'ACCEPTED with the version 5 id of the company and the offer').toEqual(['ACCEPTED', eid]);
    const cand = (await (await call2(tfApi, hr, 'GET', `/v1/candidates/${ids['candidate']}`)).json()) as any;
    expect(cand.stage, 'the candidate reads HIRED').toBe('HIRED');
    const mine = (await allEmployees(hr)).filter((e) => e.employee_id === eid);
    expect(mine.map((e) => [e.email, e.stage, e.planned_start_date]), 'A\'s list has the person exactly once, INVITED, with the confirmed date (D-T-6.7)').toEqual([[ids['email'], 'INVITED', ids['startDate']]]);
    expect((await allEmployees(companyB)).some((e) => e.employee_id === eid || e.email === ids['email']), 'B\'s list does not have them').toBe(false);
    expect((await call2(empApi, companyB, 'GET', `/v1/employees/${eid}`)).status(), 'B reads the employee: 404').toBe(404);
    const again = await call2(tfApi, hr, 'POST', `/v1/offers/${ids['offer']}/answer`, { answer: 'ACCEPTED', signed_key: key, confirmed_start_date: ids['startDate'] });
    expect([again.status(), ((await again.json()) as any).employee_id], 'a second call: 200 with the same employee').toEqual([200, eid]);
    expect((await allEmployees(hr)).filter((e) => e.employee_id === eid || e.email === ids['email']).length, 'A\'s list still has them once').toBe(1);
    // The rehire offer: its candidate's email is a seeded employee's.
    const rkey = await signedCopy(ids['rehireOffer']!);
    const re = await call2(tfApi, hr, 'POST', `/v1/offers/${ids['rehireOffer']}/answer`, { answer: 'ACCEPTED', signed_key: rkey, confirmed_start_date: ids['startDate'] });
    expect([re.status(), await re.json()], 'the rehire offer: 409 EMAIL_IS_EMPLOYEE').toEqual([409, { error: 'Conflict', code: 'EMAIL_IS_EMPLOYEE' }]);
  });
});
