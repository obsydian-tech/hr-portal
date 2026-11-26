import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { blocks } from './support/infra-harness';
import { STACKS, lambdaNamed, policyLines, resourcesOf, roleResourceOf } from './support/rec-02/iam';
import { av } from './support/rec-02/world';
import { REPO, runBackfill, runSeed } from './support/rec-06.1/lambda-harness';
import {
  A, B, C, KT, MIN, SHARED, SUB, TABLE, accept, at, hashOf, landed, lockKeyOf, lockRow, lockRows, plain, plusMs, sentOffer, trigger,
  withFollowups, withRow, withoutEmployee, world, type Row, type Run, type Tables,
} from './support/rec-06.1/world';
import {
  EMPLOYEES, EMPLOYEE_ID_NAMESPACE, K, answer, awsOf, bodyOf, changed, describe, employeeById, employeeIdOf, employeesOf, eventsOf,
  historyOf, keysDeep, logsOf, offerRow, ok, rowsOf, sagaOf, statusOf, writesOf,
} from './support/rec-06/world';

/**
 * REC-06.1 · Conversion Point leftovers: one employee per email, events once, old capitals (red). Jira NH-284.
 * Spec: /mnt/project-files/onboarding-cards/specs/REC-06.1.md (rules 1 to 13, AC-1 to AC-10), which passed its spec check after the
 * four fixes in REC-06.1-spec-check.md. Read REC-06's tests (rec-06.spec.ts) first: this file does not repeat them. Notes:
 * cards/rec-06.1.md. Review page: onboarding-cards/specs/REC-06.1-tests-for-review.md (the bar and the proofs).
 *
 * The Lambda tests run the real manageOffers handler (and cognitoPostAuth in AC-8) in a fresh Node process each call, against this
 * card's fake AWS (support/rec-06.1/fake-aws: REC-06's with code added only), over REC-06's world plus this card's candidates
 * (support/rec-06.1/world.ts), at fixed times. "At the same moment" is two runs where the second starts from the same rows as the
 * first and the first's finished writes land inside the second, at the point the test names (before its transaction, or before its
 * first update after it). The back-fill test runs the real Python script with a fake boto3 (support/rec-06.1/fake-boto3). Terraform
 * is read as text. Nothing calls AWS or any AI. Each test runs once, at 1280. AC-10's dev part runs on pepla-dev only.
 *
 * Pinned by the test writer where the spec leaves a choice (each is in cards/rec-06.1.md):
 *  - D-T-6.1.1 The lock row is the fifth item of the transaction (index 4), a Put on the state table. Its attributes are exactly PK, SK,
 *    employee_id, offer_id, locked_at, expires_at and tenant_id. locked_at is the accept's time; expires_at is that plus 15 minutes, as
 *    ISO text (toISOString). Both come from the server clock.
 *  - D-T-6.1.2 The claim is `followups_done.claimed_at` (ISO text, the call's own time); the marker stays `followups_done.hired_event`
 *    (D-T-6.4). A claim is stale when it is older than 5 minutes. An offer that already has the marker is answered without any write
 *    (REC-06 AC-2 already requires this of a repeat).
 *  - D-T-6.1.3 A cancelled accept answers EMAIL_IS_EMPLOYEE only when the fifth reason is ConditionalCheckFailed and the list has five
 *    reasons; every other cancel (another item, TransactionConflict, no list, a list of another length) is 409 STALE.
 *  - D-T-6.1.4 The back-fill script is `scripts/backfill/lowercase-employee-emails.py`, run with `python3`, the table `employees` by
 *    default; it uses boto3's DynamoDB client or resource with string expressions; it prints its report to standard output and ends
 *    with code 0 when the run itself worked (rows skipped or left alone are reported, not errors).
 *  - D-T-6.1.5 "No new Terraform resource" (AC-9) is judged as: the offers role file and the key file are byte for byte as on develop
 *    55efe0f, the talent-flow-state table block is unchanged (no TTL setting), no Terraform text names the lock or the claim, the
 *    manageOffers role's grants are exactly REC-06's, and no table rows. A whole-stack resource count would turn red when REC-16
 *    (which merges first and adds its own resources) lands, so it is not used.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const NOT_FOUND = { error: 'Not found' };
const conflict = (code: string) => ({ error: 'Conflict', code });
const IS_EMPLOYEE = conflict('EMAIL_IS_EMPLOYEE');
const STALE = conflict('STALE');
const BUS_DOWN = { service: 'events' as const, message: 'Lindiwe Sithole shared.twin@example.test the bus is down', name: 'InternalFailure' };
const FORGED_B = {
  headers: { 'x-tenant-id': B, 'X-Tenant-Id': B, 'x-company-id': B, 'tenant-id': B, tenant_id: B },
  query: { tenant_id: B, tenantId: B, company_id: B, companyId: B },
  body: { tenant_id: B, tenantId: B, email: 'forged.person@example.test' },
};
const LOCK_FIELDS = ['PK', 'SK', 'employee_id', 'expires_at', 'locked_at', 'offer_id', 'tenant_id'];

/** Every run made by the tests, for the log check (AC-7). */
const RUNS: { what: string; run: Run }[] = [];
const keep = (what: string, run: Run) => { RUNS.push({ what, run }); return run; };
function must(what: string, run: Run): Run {
  keep(what, run);
  expect(ok(run), `${what} (${describe(run)})`).toBe(true);
  return run;
}
/** Refused before any write: the answer, no row changes, no write, event, message or start. */
function refused(what: string, before: Tables, r: Run, status: number, body: unknown) {
  keep(what, r);
  expect.soft(answer(r), `${what}: ${status} ${JSON.stringify(body)}`).toEqual([status, body]);
  expect.soft(changed(before, r.tables), `${what}: no row changes`).toEqual([]);
  expect.soft(writesOf(r).map((c: any) => `${c.service} ${c.op}`), `${what}: nothing written, sent or started`).toEqual([]);
}
/** Refused after the one transaction was tried and cancelled: no row changes, nothing written outside it, no event. */
function cancelled(what: string, before: Tables, r: Run, status: number, body: unknown) {
  keep(what, r);
  expect.soft(answer(r), `${what}: ${status} ${JSON.stringify(body)} (${describe(r)})`).toEqual([status, body]);
  expect.soft(changed(before, r.tables), `${what}: no row changes`).toEqual([]);
  expect.soft(writesOf(r).filter((c: any) => c.op !== 'TransactWriteItems').map((c: any) => `${c.service} ${c.op}`), `${what}: nothing written or sent outside the cancelled transaction`).toEqual([]);
}
const newEmployees = (before: Tables, after: Tables) => employeesOf(after).filter((e) => !employeesOf(before).some((x) => x['employee_id'] === e['employee_id']));
const newHistory = (before: Tables, after: Tables, candidate: string) => historyOf(after, candidate).filter((h) => !historyOf(before, candidate).some((x) => x['SK'] === h['SK']));
const transactionOf = (r: Run) => awsOf(r).filter((c: any) => c.service === 'dynamodb' && c.op === 'TransactWriteItems').map((c: any) => c.input.TransactItems as any[]);
const followups = (t: Tables, offerId: string) => (offerRow(t, offerId)?.['followups_done'] ?? {}) as Record<string, unknown>;
const count = (runs: Run[], type: string) => runs.reduce((n, r) => n + eventsOf(r, type).length, 0);
/** The UpdateItem calls of a run whose expression (with #names put back) SETs or REMOVEs a path ending in `name`. */
function updatesOf(r: Run, kind: 'SET' | 'REMOVE', name: string) {
  return awsOf(r).filter((c: any) => {
    if (c.service !== 'dynamodb' || c.op !== 'UpdateItem') return false;
    const names = c.input.ExpressionAttributeNames ?? {};
    const text = String(c.input.UpdateExpression ?? '').replace(/#[A-Za-z0-9_]+/g, (m: string) => names[m] ?? m);
    const part = new RegExp(`\\b${kind}\\b([\\s\\S]*?)(?=\\b(?:SET|REMOVE|ADD|DELETE)\\b|$)`).exec(text)?.[1] ?? '';
    return part.split(',').some((p) => { const path = p.split('=')[0]!.trim(); return path === name || path.endsWith(`.${name}`); });
  });
}
/** No row in any table holds the address (any case) as, or inside, a key or index key. */
function noKeyHolds(t: Tables, email: string): string[] {
  const low = email.trim().toLowerCase();
  const hits: string[] = [];
  for (const [name, rows] of Object.entries(t)) {
    for (const r of rows) {
      const x = plain(r);
      for (const k of ['PK', 'SK', 'pk', 'sk', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'employee_id', 'idempotencyKey', 'token_hash']) {
        if (typeof x[k] === 'string' && (x[k] as string).toLowerCase().includes(low)) hits.push(`${name} ${k}`);
      }
    }
  }
  return hits;
}
/** Two SENT offers of A for a1 and a2 (one shared address), in one world. */
function twins(n0 = 0) {
  const s1 = sentOffer(world(), KT.a1, n0);
  const s2 = sentOffer(s1.t, KT.a2, n0 + 10);
  return { s1, s2, base: s2.t };
}

test.describe('REC-06.1 Conversion Point leftovers: one employee per email, events once, old capitals', () => {
  // ---------------------------------------------------------------- control

  test('Control: the world is sound (a1, a2 and b1 share one address; aCaps holds it with capitals; the empty-address candidates; both offers reach SENT)', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(120_000);
    const t = world();
    expect([sagaOf(t, KT.a1)['email'], sagaOf(t, KT.a2)['email'], sagaOf(t, KT.b1)['email']], 'a1, a2 (A) and b1 (B) share one lower-case address').toEqual([SHARED, SHARED, SHARED]);
    expect([sagaOf(t, KT.a1)['tenant_id'], sagaOf(t, KT.a2)['tenant_id'], sagaOf(t, KT.b1)['tenant_id']], 'their companies').toEqual([A, A, B]);
    expect(String(sagaOf(t, KT.aCaps)['email']).trim().toLowerCase(), 'aCaps holds the same address with capitals and spaces').toBe(SHARED);
    expect([sagaOf(t, KT.empty)['email'], sagaOf(t, KT.spaces)['email'], 'email' in sagaOf(t, KT.noEmail)], 'an empty address, only spaces, no address').toEqual(['', '   ', false]);
    expect(employeesOf(t).some((e) => String(e['email']).toLowerCase() === SHARED), 'no employee has the shared address yet').toBe(false);
    const { s1, s2, base } = twins();
    expect([offerRow(base, s1.id)?.['state'], offerRow(base, s2.id)?.['state']], 'both offers are SENT').toEqual(['SENT', 'SENT']);
    expect(hashOf('  Shared.Twin@Example.TEST '), 'the hash is of the trimmed lower-case address').toBe(hashOf(SHARED));
    expect(hashOf('abc'), 'the tests compute SHA-256 hex (FIPS 180-2 example)').toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(lockRows(base), 'no lock row yet').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-1

  test('AC-1 Two offers, one email, same moment: one 200 with an employee; the other 409 EMAIL_IS_EMPLOYEE with nothing of its own written; one employee; one lock row keyed by the SHA-256 of the address, holding no address', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const { s1, s2, base } = twins();
    const e1 = employeeIdOf(A, s1.id);
    const win = must('first of two at the same moment', accept(C.recA, s1, base, 20));
    expect.soft([statusOf(win), bodyOf(win)?.employee_id], 'the first: 200 with its employee').toEqual([200, e1]);
    // The second read "no employee" (both reads were before either write); the first's writes land just before its transaction.
    const lose = accept(C.rec2A, s2, base, 20, { extra: { landBeforeTransact: { tables: landed(win.tables) } } });
    cancelled('second of two at the same moment', win.tables, lose, 409, IS_EMPLOYEE);
    expect.soft([offerRow(lose.tables, s2.id)?.['state'], sagaOf(lose.tables, KT.a2)['currentStage'], newHistory(base, lose.tables, KT.a2).length, eventsOf(lose).length, employeeById(lose.tables, employeeIdOf(A, s2.id)).length],
      'the second: its offer still SENT, its candidate still OFFER, no history row, no event, no employee').toEqual(['SENT', 'OFFER', 0, 0, 0]);
    expect.soft(employeesOf(lose.tables).filter((e) => e['tenant_id'] === A && String(e['email']).toLowerCase() === SHARED).map((e) => e['employee_id']), 'A has exactly one employee with that address, the first\'s').toEqual([e1]);
    // The lock row.
    const locks = lockRows(lose.tables);
    expect.soft(locks.length, 'exactly one lock row').toBe(1);
    const lock = locks[0] ?? {};
    expect.soft([lock['PK'], lock['SK']], 'its key: EMAIL_LOCK#<A>#<sha256 of the trimmed lower-case address>, EMAIL_LOCK').toEqual([lockKeyOf(A, SHARED), 'EMAIL_LOCK']);
    expect.soft(Object.keys(lock).sort(), 'exactly these attributes (no status, state, recordType, index or name fields) (D-T-6.1.1)').toEqual(LOCK_FIELDS);
    expect.soft({ employee_id: lock['employee_id'], offer_id: lock['offer_id'], locked_at: lock['locked_at'], expires_at: lock['expires_at'], tenant_id: lock['tenant_id'] },
      'its values: the first\'s employee and offer, the accept time, 15 minutes on, company A').toEqual({ employee_id: e1, offer_id: s1.id, locked_at: at(20), expires_at: plusMs(at(20), 15 * MIN), tenant_id: A });
    expect.soft(JSON.stringify(lock).toLowerCase().includes(SHARED), 'the lock row holds no address').toBe(false);
    expect.soft(noKeyHolds(lose.tables, SHARED), 'no row in any table holds the address in a key').toEqual([]);
    // The transaction: five items, the fifth a conditional Put of the lock on the state table.
    const tx = transactionOf(win)[0] ?? [];
    expect.soft(tx.length, 'the accept is one transaction of five items').toBe(5);
    const fifth = tx[4]?.Put;
    expect.soft([fifth?.TableName, plain(fifth?.Item ?? {})['PK']], 'the fifth item is a Put of the lock row on the state table').toEqual([TABLE.state, lockKeyOf(A, SHARED)]);
    const names = fifth?.ExpressionAttributeNames ?? {};
    const cond = String(fifth?.ConditionExpression ?? '').replace(/#[A-Za-z0-9_]+/g, (m: string) => names[m] ?? m);
    expect.soft(/attribute_not_exists\(\s*PK\s*\)/.test(cond) && /expires_at\s*</.test(cond) && /offer_id\s*=/.test(cond), `its condition: attribute_not_exists(PK) OR expires_at < :at OR offer_id = :oid (got ${cond})`).toBe(true);

    // The real cause (N-1): the first is written, but email-index (a global index) has not caught up, so the rehire stop sees nobody.
    const lag = { staleIndex: { index: 'email-index', hide: [{ employee_id: { S: e1 } }] } };
    cancelled('the second after the first, email-index not caught up', win.tables, accept(C.rec2A, s2, win.tables, 25, { extra: lag }), 409, IS_EMPLOYEE);
    // An old candidate row holding the same address with capitals and spaces meets the same lock.
    const sc = sentOffer(win.tables, KT.aCaps, 30);
    cancelled('a candidate with the address in capitals, email-index not caught up', sc.t, accept(C.rec2A, sc, sc.t, 40, { extra: lag }), 409, IS_EMPLOYEE);

    // TransactionConflict on the lock item (two transactions on one lock key at the same instant): STALE, nothing of its own written;
    // its retry meets the committed lock (and, once the index has caught up, the rehire stop): EMAIL_IS_EMPLOYEE.
    const tc = accept(C.rec2A, s2, base, 20, { extra: { landBeforeTransact: { tables: landed(win.tables) }, cancelTransactItem: { index: 4, code: 'TransactionConflict' } } });
    cancelled('second of two, the lock item answers TransactionConflict', win.tables, tc, 409, STALE);
    cancelled('its retry, email-index not caught up', tc.tables, accept(C.rec2A, s2, tc.tables, 21, { extra: lag }), 409, IS_EMPLOYEE);
    refused('its retry, email-index caught up', tc.tables, accept(C.rec2A, s2, tc.tables, 22), 409, IS_EMPLOYEE);
    // Reasons that cannot be read by position: STALE, never a guess (D-T-6.1.3).
    for (const [what, extra] of [
      ['no reasons at all', { cancelUnreadable: {} }],
      ['four reasons for five items', { cancelUnreadable: { reasons: ['None', 'None', 'None', 'ConditionalCheckFailed'] } }],
      ['six reasons for five items', { cancelUnreadable: { reasons: ['None', 'None', 'None', 'None', 'None', 'ConditionalCheckFailed'] } }],
    ] as const) {
      cancelled(`second of two, ${what}`, win.tables, accept(C.rec2A, s2, base, 20, { extra: { landBeforeTransact: { tables: landed(win.tables) }, ...extra } }), 409, STALE);
    }
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 The lock is short and per company: (a) after 15 minutes, with the first employee gone, the second converts, but not inside the window; (b) with the employee there the rehire stop refuses whatever the lock; a fresh lock of the same offer lets it through, of another offer stops it', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const { s1, s2, base } = twins();
    const e1 = employeeIdOf(A, s1.id);
    const e2 = employeeIdOf(A, s2.id);
    const win = must('the first converts', accept(C.recA, s1, base, 20));
    // (a) HR removed the first employee. 14 minutes on the lock still stands (the side effect the spec names); 16 minutes on it is over.
    const gone = withoutEmployee(win.tables, e1);
    cancelled('the second, 14 minutes on, first employee removed', gone, accept(C.rec2A, s2, gone, 20 + 14 * 60), 409, IS_EMPLOYEE);
    // A refused accept inside the window must not move the lock either (refused already checks no row changes).
    const late = must('the second, 16 minutes on, first employee removed', accept(C.rec2A, s2, gone, 20 + 16 * 60));
    expect.soft([statusOf(late), bodyOf(late)?.employee_id, newEmployees(gone, late.tables).length], 'it converts: one new employee').toEqual([200, e2, 1]);
    const lk = lockRows(late.tables);
    expect.soft(lk.map((r) => [r['PK'], r['offer_id'], r['employee_id'], r['locked_at'], r['expires_at']]), 'the one lock row now holds the second offer, for 15 minutes from now').toEqual([[lockKeyOf(A, SHARED), s2.id, e2, at(20 + 16 * 60), plusMs(at(20 + 16 * 60), 15 * MIN)]]);
    // (b) The first employee still there, the lock long over: the rehire stop refuses, and nothing is written (not even the lock).
    refused('the second, 16 minutes on, first employee still there', win.tables, accept(C.rec2A, s2, win.tables, 20 + 16 * 60), 409, IS_EMPLOYEE);
    // A fresh lock that holds this same offer (a retry of the same offer) does not stop it; a fresh lock of another offer does.
    const own = withRow(base, lockRow(A, SHARED, s2.id, e2, at(30)));
    const ownRun = must('a fresh lock of this same offer', accept(C.rec2A, s2, own, 31));
    expect.soft([statusOf(ownRun), bodyOf(ownRun)?.employee_id, lockRows(ownRun.tables).length], 'it converts; still one lock row').toEqual([200, e2, 1]);
    const other = withRow(base, lockRow(A, SHARED, 'offer-0e6d2c1a-rec061-other-offer', '7d1f6d0e-0000-5000-8000-0000000000aa', at(30)));
    cancelled('a fresh lock of another offer', other, accept(C.rec2A, s2, other, 31), 409, IS_EMPLOYEE);
    // An expired lock of another offer does not stop it.
    const old = withRow(base, lockRow(A, SHARED, 'offer-0e6d2c1a-rec061-other-offer', '7d1f6d0e-0000-5000-8000-0000000000aa', at(30 - 16 * 60)));
    const oldRun = must('an expired lock of another offer', accept(C.rec2A, s2, old, 31));
    expect.soft(lockRows(oldRun.tables).map((r) => [r['offer_id'], r['employee_id']]), 'the lock row is taken over by this offer').toEqual([[s2.id, e2]]);
  });

  test('AC-2 (c) Company B at the same moment: both convert, one employee each, two lock rows with different keys; A naming B in headers, query and body still locks under A; nothing of A in B\'s answer or rows', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const sA = sentOffer(world(), KT.a1, 0);
    const sB = sentOffer(sA.t, KT.b1, 10);
    const base = sB.t;
    const eA = employeeIdOf(A, sA.id);
    const eB = employeeIdOf(B, sB.id);
    const rA = must('A accepts, naming B everywhere', accept(C.recA, sA, base, 20, { headers: FORGED_B.headers, query: FORGED_B.query, body: FORGED_B.body }));
    const rB = must('B accepts at the same moment', accept(C.recB, sB, base, 20, { extra: { landBeforeTransact: { tables: landed(rA.tables) } } }));
    expect.soft([bodyOf(rA)?.employee_id, bodyOf(rB)?.employee_id], 'both convert').toEqual([eA, eB]);
    expect.soft(employeesOf(rB.tables).filter((e) => String(e['email']).toLowerCase() === SHARED).map((e) => [e['tenant_id'], e['employee_id']]).sort(), 'one employee of A and one of B with that address').toEqual([[A, eA], [B, eB]].sort());
    const locks = lockRows(rB.tables);
    expect.soft(locks.map((r) => [r['PK'], r['tenant_id'], r['offer_id'], r['employee_id']]).sort(), 'two lock rows, one per company, keyed by that company').toEqual([[lockKeyOf(A, SHARED), A, sA.id, eA], [lockKeyOf(B, SHARED), B, sB.id, eB]].sort());
    expect.soft(lockKeyOf(A, SHARED) === lockKeyOf(B, SHARED), 'the two keys differ').toBe(false);
    const bText = JSON.stringify(bodyOf(rB)) + JSON.stringify(locks.filter((r) => r['tenant_id'] === B)) + JSON.stringify(employeeById(rB.tables, eB));
    expect.soft([bText.includes(A), bText.includes(eA), bText.includes(sA.id)], 'nothing of A in B\'s answer, lock row or employee').toEqual([false, false, false]);
    expect.soft(noKeyHolds(rB.tables, SHARED), 'no key holds the address').toEqual([]);
  });

  test('AC-2 (d) All or none with five items: a failure at items 1 to 4 answers STALE, a failed condition at the fifth (the lock) EMAIL_IS_EMPLOYEE; nothing is written and no event; a retry completes with one employee and one lock row', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    for (const index of [0, 1, 2, 3, 4]) {
      const s = sentOffer(world(), KT.a1, index * 20);
      const failed = keep(`accept failing at item ${index}`, accept(C.recA, s, s.t, 10 + index * 20, { extra: { failTransactItem: { index } } }));
      expect.soft(answer(failed), `item ${index} fails: ${index === 4 ? 'EMAIL_IS_EMPLOYEE' : 'STALE'}`).toEqual([409, index === 4 ? IS_EMPLOYEE : STALE]);
      expect.soft(changed(s.t, failed.tables), `item ${index} fails: no row changes`).toEqual([]);
      expect.soft(eventsOf(failed).length, `item ${index} fails: no event`).toBe(0);
      expect.soft(writesOf(failed).filter((w: any) => w.op !== 'TransactWriteItems').map((w: any) => `${w.service} ${w.op}`), `item ${index} fails: nothing else written or sent`).toEqual([]);
      expect.soft((transactionOf(failed)[0] ?? []).length, `item ${index}: the transaction tried had five items`).toBe(5);
      const retry = must(`retry after item ${index}`, accept(C.recA, s, failed.tables, 11 + index * 20));
      expect.soft([bodyOf(retry)?.employee_id, newEmployees(s.t, retry.tables).length, newHistory(s.t, retry.tables, KT.a1).length, sagaOf(retry.tables, KT.a1)['currentStage'], lockRows(retry.tables).length],
        `retry after item ${index}: one employee, one history row, HIRED, one lock row`).toEqual([employeeIdOf(A, s.id), 1, 1, 'HIRED', 1]);
    }
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 Events once on a race: two accepts of the same offer at the same moment send one CandidateHired and one OfferAnswered in all, whichever reaches the claim first; the marker is set', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const s = sentOffer(world(), KT.a1, 0);
    const eid = employeeIdOf(A, s.id);
    const c1 = must('the first accept', accept(C.recA, s, s.t, 10));
    // (i) The first has written and claimed but not yet marked; the second's transaction meets that, so it re-reads the offer.
    const claimed = withFollowups(c1.tables, s.id, { claimed_at: at(10) });
    const c2 = keep('the second, meeting the first\'s claim', accept(C.rec2A, s, s.t, 10, { extra: { landBeforeTransact: { tables: landed(claimed) } } }));
    expect.soft([statusOf(c2), bodyOf(c2)?.employee_id], 'the second answers 200 with the same employee').toEqual([200, eid]);
    expect.soft([count([c1, c2], 'CandidateHired'), count([c1, c2], 'OfferAnswered')], 'one CandidateHired and one OfferAnswered in all').toEqual([1, 1]);
    expect.soft(eventsOf(c2).length, 'the second sends nothing').toBe(0);
    // (ii) The first has written but not claimed; the second claims, sends and marks; then the first reaches its claim.
    const written = withFollowups(c1.tables, s.id, {});
    const d2 = keep('the second, before the first claims', accept(C.rec2A, s, s.t, 10, { extra: { landBeforeTransact: { tables: landed(written) } } }));
    expect.soft([statusOf(d2), bodyOf(d2)?.employee_id, eventsOf(d2).map((e: any) => e.detailType).sort()], 'the second answers 200 and sends both events').toEqual([200, eid, ['CandidateHired', 'OfferAnswered']]);
    const d1 = keep('the first, reaching its claim after the second finished', accept(C.recA, s, s.t, 10, { extra: { landBeforeOp: { op: 'UpdateItem', table: TABLE.state, tables: landed(d2.tables) } } }));
    expect.soft([statusOf(d1), bodyOf(d1)?.employee_id], 'the first answers 200 with the same employee').toEqual([200, eid]);
    expect.soft([count([d1, d2], 'CandidateHired'), count([d1, d2], 'OfferAnswered')], 'one CandidateHired and one OfferAnswered in all').toEqual([1, 1]);
    expect.soft(Boolean(followups(d1.tables, s.id)['hired_event']), 'the marker is set').toBe(true);
    expect.soft([employeeById(d1.tables, eid).length, newHistory(s.t, d1.tables, KT.a1).length], 'one employee and one history row').toEqual([1, 1]);
  });

  test('AC-3 Two repeat accepts at the same moment on a converted offer whose marker is missing: one of each event in all; a slow repeat after another call marked sends nothing, even over an old claim; B\'s Recruiter repeating on A\'s offer gets 404 and writes no claim', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const s = sentOffer(world(), KT.a2, 0);
    const down = keep('accept with the bus down', accept(C.recA, s, s.t, 10, { extra: { fail: BUS_DOWN } }));
    expect.soft([statusOf(down), followups(down.tables, s.id)['hired_event'] ?? null], 'converted, no marker').toEqual([200, null]);
    // (i) The first repeat finishes everything; the second reaches its claim after that.
    const r1 = must('repeat one', accept(C.recA, s, down.tables, 30));
    const r2 = keep('repeat two, reaching its claim after repeat one finished', accept(C.rec2A, s, down.tables, 30, { extra: { landBeforeOp: { op: 'UpdateItem', table: TABLE.state, tables: landed(r1.tables) } } }));
    expect.soft([statusOf(r2), count([r1, r2], 'CandidateHired'), count([r1, r2], 'OfferAnswered')], 'both 200; one of each event in all').toEqual([200, 1, 1]);
    // (ii) The first repeat holds the claim but has not marked yet when the second tries.
    const held = withFollowups(down.tables, s.id, { claimed_at: at(30) });
    const q1 = must('repeat one (claims, then sends)', accept(C.recA, s, down.tables, 30));
    const q2 = keep('repeat two, meeting repeat one\'s claim', accept(C.rec2A, s, down.tables, 30, { extra: { landBeforeOp: { op: 'UpdateItem', table: TABLE.state, tables: landed(held) } } }));
    expect.soft([statusOf(q2), eventsOf(q2).length, count([q1, q2], 'CandidateHired'), count([q1, q2], 'OfferAnswered')], 'the second: 200, sends nothing; one of each in all').toEqual([200, 0, 1, 1]);
    // (iii) A slow repeat: it read the offer before the marker, and reaches its claim after another call claimed (6 minutes ago, a slow
    // call), sent and marked. The old claim must not let it claim again: the marker alone stops it.
    const done = withFollowups(down.tables, s.id, { claimed_at: at(100 - 6 * 60), hired_event: at(95) });
    const p2 = keep('slow repeat, reaching its claim after a marked offer with a 6-minute-old claim', accept(C.rec2A, s, down.tables, 100, { extra: { landBeforeOp: { op: 'UpdateItem', table: TABLE.state, tables: landed(done) } } }));
    expect.soft([statusOf(p2), eventsOf(p2).length], 'the slow repeat: 200, sends nothing').toEqual([200, 0]);
    expect.soft(followups(p2.tables, s.id), 'the claim and the marker stay as they were').toEqual({ claimed_at: at(100 - 6 * 60), hired_event: at(95) });
    // B's Recruiter repeating on A's converted offer (marker missing): 404, nothing written (no claim), no event.
    refused('B\'s Recruiter repeats on A\'s converted offer', down.tables, accept(C.recB, s, down.tables, 40), 404, NOT_FOUND);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Events retry after a failure: bus down leaves no marker and no claim (released on condition of the company); a repeat sends once and marks; a third sends nothing; a claim 6 minutes old is taken over, one 1 minute old is not', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const s = sentOffer(world(), KT.a1, 0);
    const eid = employeeIdOf(A, s.id);
    const r1 = keep('accept with the bus down', accept(C.recA, s, s.t, 10, { extra: { fail: BUS_DOWN } }));
    expect.soft([statusOf(r1), bodyOf(r1)?.employee_id], 'the accept answers 200').toEqual([200, eid]);
    expect.soft([followups(r1.tables, s.id)['hired_event'] ?? null, followups(r1.tables, s.id)['claimed_at'] ?? null], 'no marker and no claim left behind').toEqual([null, null]);
    expect.soft(updatesOf(r1, 'SET', 'claimed_at').length, 'the claim was taken before the send').toBe(1);
    const condOf = (c: any) => String(c.input.ConditionExpression ?? '').replace(/#[A-Za-z0-9_]+/g, (m: string) => (c.input.ExpressionAttributeNames ?? {})[m] ?? m);
    expect.soft(updatesOf(r1, 'REMOVE', 'claimed_at').map(condOf), 'the claim is released once after the failed send, held to the company (condition on tenant_id)').toEqual([expect.stringMatching(/\btenant_id\b/)]);
    const r2 = must('repeat', accept(C.recA, s, r1.tables, 20));
    expect.soft(eventsOf(r2).map((e: any) => e.detailType).sort(), 'the repeat sends each once').toEqual(['CandidateHired', 'OfferAnswered']);
    expect.soft(Boolean(followups(r2.tables, s.id)['hired_event']), 'and sets the marker').toBe(true);
    const r3 = keep('third call', accept(C.recA, s, r2.tables, 30));
    expect.soft([statusOf(r3), eventsOf(r3).length, writesOf(r3).length], 'a third call: 200, no event, no write').toEqual([200, 0, 0]);
    // A claim left 6 minutes ago (its call crashed) and no marker: a repeat takes it over and sends once.
    const old = withFollowups(r1.tables, s.id, { claimed_at: at(100 - 6 * 60) });
    const o = must('repeat over a 6-minute-old claim', accept(C.recA, s, old, 100));
    expect.soft([eventsOf(o).map((e: any) => e.detailType).sort(), Boolean(followups(o.tables, s.id)['hired_event'])], 'sends each once and marks').toEqual([['CandidateHired', 'OfferAnswered'], true]);
    // A claim 1 minute old: another call is still working on it. A repeat sends nothing and leaves the claim as it is.
    const fresh = withFollowups(r1.tables, s.id, { claimed_at: at(100 - 60) });
    const f = keep('repeat over a 1-minute-old claim', accept(C.rec2A, s, fresh, 100));
    expect.soft([statusOf(f), bodyOf(f)?.employee_id, eventsOf(f).length], '200 with the employee, no event').toEqual([200, eid, 0]);
    expect.soft(followups(f.tables, s.id), 'the claim stays, no marker').toEqual({ claimed_at: at(100 - 60) });
  });

  test('AC-4 Marker and release failures: send good but both marker writes fail leaves the claim (no second send inside 5 minutes, one after); a first marker failure is retried once; a part-taken send and a failed release behave as rule 8 says', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    // Both marker writes fail: the claim stays, the marker is missing; two tries; a repeat within 5 minutes sends nothing, after 5 one.
    const s = sentOffer(world(), KT.a1, 0);
    const m = keep('accept, both marker writes failing', accept(C.recA, s, s.t, 10, { extra: { failUpdate: [{ sets: 'hired_event', times: 2 }] } }));
    expect.soft([statusOf(m), eventsOf(m).map((e: any) => e.detailType).sort()], '200, both events sent').toEqual([200, ['CandidateHired', 'OfferAnswered']]);
    expect.soft(updatesOf(m, 'SET', 'hired_event').length, 'the marker write is tried twice (once, then once more)').toBe(2);
    expect.soft(followups(m.tables, s.id), 'the claim stays, the marker is missing').toEqual({ claimed_at: at(10) });
    const within = keep('repeat 4 minutes later', accept(C.rec2A, s, m.tables, 10 + 4 * 60));
    expect.soft([statusOf(within), eventsOf(within).length], 'within 5 minutes: 200, no event').toEqual([200, 0]);
    const after = must('repeat 6 minutes later', accept(C.rec2A, s, within.tables, 10 + 6 * 60));
    expect.soft([eventsOf(after).map((e: any) => e.detailType).sort(), Boolean(followups(after.tables, s.id)['hired_event'])], 'after 5 minutes: each once, marked').toEqual([['CandidateHired', 'OfferAnswered'], true]);
    // The first marker write fails, the retry works: marked, events once.
    const s2 = sentOffer(world(), KT.a2, 20);
    const once1 = must('accept, first marker write failing', accept(C.recA, s2, s2.t, 30, { extra: { failUpdate: [{ sets: 'hired_event', times: 1 }] } }));
    expect.soft([updatesOf(once1, 'SET', 'hired_event').length, Boolean(followups(once1.tables, s2.id)['hired_event']), eventsOf(once1).length], 'two tries, marked, two events').toEqual([2, true, 2]);
    // PutEvents takes CandidateHired and fails OfferAnswered: the claim is released, no marker; the retry sends both again (rule 8).
    const s3 = sentOffer(world(), KT.aCaps, 40);
    const p = keep('accept, OfferAnswered not taken', accept(C.recA, s3, s3.t, 50, { extra: { eventsPartial: { failIndex: 1 } } }));
    expect.soft([statusOf(p), followups(p.tables, s3.id)['hired_event'] ?? null, followups(p.tables, s3.id)['claimed_at'] ?? null], '200, no marker, claim released').toEqual([200, null, null]);
    const pr = must('repeat after the part-taken send', accept(C.recA, s3, p.tables, 55));
    expect.soft([eventsOf(pr).map((e: any) => e.detailType).sort(), Boolean(followups(pr.tables, s3.id)['hired_event'])], 'the repeat sends both and marks').toEqual([['CandidateHired', 'OfferAnswered'], true]);
    // The bus is down and the release fails too: the claim stays; no repeat can send for 5 minutes; after that one can.
    const s4 = sentOffer(world(), KT.b1, 60);
    const rl = keep('accept, bus down and release failing', accept(C.recB, s4, s4.t, 70, { extra: { fail: BUS_DOWN, failUpdate: [{ removes: 'claimed_at' }] } }));
    expect.soft([statusOf(rl), followups(rl.tables, s4.id)], '200; the claim stays, no marker').toEqual([200, { claimed_at: at(70) }]);
    const rw = keep('repeat 1 minute later', accept(C.recB, s4, rl.tables, 130));
    expect.soft([statusOf(rw), eventsOf(rw).length], 'within 5 minutes: 200, no event').toEqual([200, 0]);
    const ra = must('repeat 6 minutes later', accept(C.recB, s4, rw.tables, 70 + 6 * 60));
    expect.soft([count([ra], 'CandidateHired'), count([ra], 'OfferAnswered'), Boolean(followups(ra.tables, s4.id)['hired_event'])], 'after 5 minutes: each once, marked').toEqual([1, 1, true]);
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 Nothing else changes: the events carry exactly REC-06\'s fields and nothing personal; no OfferAccepted, invite, sign-in, email or StartExecution; the rows that change are REC-06\'s four plus the lock row; hrOnly is no longer imported', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(180_000);
    const s = sentOffer(world(), KT.a1, 0);
    const r = must('accept', accept(C.recA, s, s.t, 10));
    const eid = employeeIdOf(A, s.id);
    const ev = eventsOf(r);
    expect.soft(ev.map((e: any) => [e.detailType, e.source, e.bus]).sort(), 'exactly CandidateHired and OfferAnswered on the talent-flow bus').toEqual([['CandidateHired', 'talent-flow.workflow', 'rec01-bus'], ['OfferAnswered', 'talent-flow.workflow', 'rec01-bus']]);
    expect.soft(ev.find((e: any) => e.detailType === 'CandidateHired')?.detail, 'CandidateHired as REC-06').toEqual({ tenant_id: A, candidate_id: KT.a1, role_id: K.ra, employee_id: eid, offer_id: s.id, at: at(10) });
    expect.soft(ev.find((e: any) => e.detailType === 'OfferAnswered')?.detail, 'OfferAnswered as REC-06').toEqual({ tenant_id: A, offer_id: s.id, candidate_id: KT.a1, answer: 'ACCEPTED' });
    const text = JSON.stringify(ev);
    for (const bad of ['Lindiwe', 'Sithole', SHARED, hashOf(SHARED), '555 0311', '412000']) expect.soft(text.includes(bad), `no event holds ${bad}`).toBe(false);
    expect.soft(keysDeep(ev.map((e: any) => e.detail)).filter((k) => /name|email|phone|salary/i.test(k)), 'no name, email, phone or salary field').toEqual([]);
    const outside = r.calls.filter((c: any) => /^(sqs|sns|ses|lambda|http|postmark|sfn|kms)$/.test(c.service) || (c.service === 'cognito' && !/^(List|AdminGet|AdminList)/.test(c.op ?? ''))).map((c: any) => `${c.service} ${c.op ?? ''}`);
    expect.soft(outside, 'nothing emailed, queued, invoked, started; no sign-in made').toEqual([]);
    const rows = changed(s.t, r.tables).map((x) => x.replace(eid, '<employee>').replace(s.id, '<offer>').replace(/STAGE#\S+/, 'STAGE#<at>').replace(lockKeyOf(A, SHARED), '<lock>').trim()).sort();
    expect.soft(rows, 'the rows that change: the offer, the candidate, one history row, the employee and the lock row').toEqual([
      `${EMPLOYEES} <employee>`, `${TABLE.state} <lock> EMAIL_LOCK`, `${TABLE.state} CANDIDATE#${KT.a1} SAGA`, `${TABLE.state} CANDIDATE#${KT.a1} STAGE#<at>`, `${TABLE.state} OFFER#<offer> OFFER`,
    ].sort());
    const e = employeeById(r.tables, eid)[0] ?? {};
    expect.soft(Object.keys(e).sort(), 'the employee row has REC-06\'s attributes (rule 4), nothing more').toEqual([
      'created_at', 'created_by', 'department', 'email', 'employee_id', 'first_name', 'from_recruitment', 'hr_staff_email', 'hr_staff_id', 'hr_staff_name', 'job_title',
      'last_name', 'middle_name', 'offer_accept_date', 'phone', 'planned_start_date', 'stage', 'tenant_id',
    ]);
    const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const offers = code(join(REPO, 'lambda', 'shared', 'recruitment-actions', 'offers.mjs'));
    expect.soft(offers, 'offers.mjs: no OfferAccepted, employee.invited, issueInvite, StartExecution, postmark or SES').not.toMatch(/OfferAccepted|employee\.invited|issueInvite|StartExecution|postmark|client-ses|client-sesv2|client-sns|client-sqs/);
    expect.soft(/import\s*\{[^}]*\bhrOnly\b[^}]*\}\s*from/.test(offers), 'offers.mjs no longer imports hrOnly (rule 12)').toBe(false);
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 Empty email: a candidate whose stored address is empty, only spaces or missing gets 409 NOT_OPEN, nothing written, no event, no 500', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    for (const [what, id, n] of [['an empty address', KT.empty, 0], ['only spaces', KT.spaces, 20], ['no address at all', KT.noEmail, 40]] as const) {
      const s = sentOffer(world(), id, n);
      const r = accept(C.recA, s, s.t, n + 10);
      expect.soft(r.error ?? null, `${what}: the handler does not throw`).toBeNull();
      refused(`accept with ${what}`, s.t, r, 409, conflict('NOT_OPEN'));
      expect.soft(eventsOf(r).length, `${what}: no event`).toBe(0);
    }
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 Logs: every log line of this card\'s paths holds only the offer id and an error name; no address in any case, no hash of an address, no name, no phone', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    // This test makes its own run of every path that logs, so it does not rest on runs the other tests happened to make.
    const own: [string, Run][] = [];
    const run = (what: string, r: Run) => { own.push([what, r]); return keep(what, r); };
    const { s1, s2, base } = twins();
    const win = run('first of two', accept(C.recA, s1, base, 20));
    run('second of two (lock refused)', accept(C.rec2A, s2, base, 20, { extra: { landBeforeTransact: { tables: landed(win.tables) } } }));
    run('second of two (TransactionConflict)', accept(C.rec2A, s2, base, 20, { extra: { landBeforeTransact: { tables: landed(win.tables) }, cancelTransactItem: { index: 4, code: 'TransactionConflict' } } }));
    run('second of two (no reasons)', accept(C.rec2A, s2, base, 20, { extra: { landBeforeTransact: { tables: landed(win.tables) }, cancelUnreadable: {} } }));
    run('failure at item 0', accept(C.rec2A, s2, base, 21, { extra: { failTransactItem: { index: 0 } } }));
    const down = run('bus down', accept(C.recA, s1, base, 22, { extra: { fail: BUS_DOWN } }));
    run('bus down, release failing', accept(C.recA, s1, base, 23, { extra: { fail: BUS_DOWN, failUpdate: [{ removes: 'claimed_at', name: 'ProvisionedThroughputExceededException' }] } }));
    run('marker writes failing', accept(C.recA, s1, base, 24, { extra: { failUpdate: [{ sets: 'hired_event', times: 2, name: 'ProvisionedThroughputExceededException' }] } }));
    run('part-taken send', accept(C.recA, s1, base, 25, { extra: { eventsPartial: { failIndex: 1 } } }));
    run('repeat over a fresh claim', accept(C.recA, s1, withFollowups(down.tables, s1.id, { claimed_at: at(30) }), 31));
    const se = sentOffer(world(), KT.empty, 40);
    run('empty address', accept(C.recA, se, se.t, 50));
    // The pattern: every person's name (whole word), address (any case) and its SHA-256 (whole or its first 12 characters), phone
    // (last 9 digits, spaces or dashes allowed), both companies, candidates and employees; and the bus error's own words.
    const t = world();
    const people = [
      ...rowsOf(t, TABLE.state).filter((r) => r['SK'] === 'SAGA').map((r) => [r['firstName'], r['lastName'], r['email'], r['phone']]),
      ...employeesOf(t).map((r) => [r['first_name'], r['last_name'], r['email'], r['phone']]),
    ];
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = new Set<string>(['the bus is down', 'forged\\.person']);
    for (const [, , email, phone] of people) {
      if (typeof email === 'string' && email.trim()) { parts.add(esc(email.trim().toLowerCase())); parts.add(hashOf(email).slice(0, 12)); }
      const digits = typeof phone === 'string' ? phone.replace(/\D/g, '').slice(-9) : '';
      if (digits.length === 9) parts.add(digits.split('').join('[\\s-]?'));
    }
    const leak = new RegExp([...parts].join('|'), 'i');
    const names = new RegExp([...people.flatMap(([f, l]) => [f, l])].filter((x): x is string => typeof x === 'string' && x.trim().length > 1).map((x) => `\\b${esc(x.trim())}\\b`).join('|'));
    for (const [what, r] of [...own, ...RUNS.filter((x) => !own.some(([, y]) => y === x.run)).map((x) => [x.what, x.run] as [string, Run])]) {
      const lines = logsOf(r);
      expect.soft(lines.filter((l) => leak.test(l) || names.test(l)), `${what}: no address, hash, name, phone or error text in the logs`).toEqual([]);
      // The fields of each structured log line of the offer code: only offer_id and error (the reasons list for createOffer's own line).
      for (const l of lines.filter((x) => /^offers:/.test(x))) {
        const fields = [...(/\{([\s\S]*)\}\s*$/.exec(l)?.[1] ?? '').matchAll(/(?:^|[,{]\s*)['"]?([A-Za-z_]+)['"]?\s*:/g)].map((m) => m[1]!);
        expect.soft(fields.filter((f) => !['offer_id', 'error', 'reasons', 'type'].includes(f)), `${what}: "${l.slice(0, 80)}" holds only the offer id and an error name`).toEqual([]);
      }
    }
    expect(own.flatMap(([, r]) => logsOf(r)).length, 'the paths above do log something (the check is not empty)').toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Back-fill script: capitals made lower case per company; a same-company duplicate skipped and reported; another company never counts; a row changed meanwhile left alone; dry run by default; a second run changes nothing; no address, name or phone in the output; sign-in then finds the person both ways; (rec-06.1.1) rows with no company skipped unless --legacy-tenant names their company; the AWS account printed first and --apply refused without the matching --account', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    expect(existsSync(join(REPO, 'scripts', 'backfill', 'lowercase-employee-emails.py')), 'scripts/backfill/lowercase-employee-emails.py exists (D-T-6.1.4)').toBe(true);
    const emp = (id: string, first: string, last: string, email: string, tenant: string | null, extra: Record<string, string> = {}) => av({
      employee_id: id, first_name: first, middle_name: '', last_name: last, email, phone: '+27 11 555 0' + id.slice(-3), department: 'Operations', job_title: 'Clerk',
      stage: 'VERIFIED', created_at: '2025-01-10T08:00:00.000Z', ...(tenant ? { tenant_id: tenant } : {}), ...extra,
    });
    const ID = {
      thandi: 'bf-a-001', johnCaps: 'bf-a-002', john: 'bf-a-003', mary: 'bf-a-004', raced: 'bf-a-005', plain: 'bf-a-006', moved: 'bf-a-007',
      sipho: 'bf-b-001', maryB: 'bf-b-002', legacy: 'bf-n-001', spaced: 'bf-n-002', legacyDup: 'bf-n-003',
    };
    // rec-06.1.1 (security review M-1, M-2): the account the fake credentials belong to, and the company the no-company rows belong to.
    const ACCT = '111122223333';
    const FOUNDING = A;
    const apply = ['--apply', '--account', ACCT];
    const noCompany = [ID.legacy, ID.spaced, ID.legacyDup];
    const rows = [
      emp(ID.thandi, 'Thandi', 'Mthembu', 'Thandi@X.co', A, { stage: 'INVITED' }),
      emp(ID.johnCaps, 'Johannes', 'Botha', 'John@Z.co', A), emp(ID.john, 'Jonathan', 'Bezuidenhout', 'john@z.co', A),
      emp(ID.mary, 'Mary', 'Phiri', 'mary@q.co', A), emp(ID.raced, 'Refilwe', 'Rossouw', 'Refilwe@R.co', A), emp(ID.plain, 'Palesa', 'Lekota', 'palesa@p.co', A),
      emp(ID.moved, 'Musa', 'Mabena', 'Musa@M.co', A),
      emp(ID.sipho, 'Sipho', 'Ngcobo', 'Sipho@Y.co', B), emp(ID.maryB, 'Maryanne', 'Pillay', 'Mary@Q.co', B),
      emp(ID.legacy, 'Lerato', 'Oosthuizen', 'Lerato@W.co', null), emp(ID.spaced, 'Sizwe', 'Vilakazi', ' Sizwe@V.co ', null),
      emp(ID.legacyDup, 'Kagiso', 'Dlamini', 'Palesa@P.co', null),
    ];
    const before: Tables = { [EMPLOYEES]: rows };
    const race = [{ employee_id: ID.raced, set: { email: { S: 'refilwe.again@r.co' } } }, { employee_id: ID.moved, set: { tenant_id: { S: B } } }];
    const byId = (t: Tables) => Object.fromEntries(employeesOf(t).map((r) => [r['employee_id'], r]));
    const writes = (r: { calls: any[] }) => r.calls.filter((c) => !/^(Scan|Query|GetItem|BatchGetItem|DescribeTable|GetCallerIdentity)$/.test(c.op));
    const sensitive = rows.flatMap((x) => { const p = plain(x); return [p['email'], p['first_name'], p['last_name'], p['phone']]; })
      .concat(['refilwe.again@r.co']).filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    const leaks = (out: string) => sensitive.filter((x) => out.toLowerCase().includes(x.trim().toLowerCase()) || out.includes(String(x).replace(/\D/g, '').slice(-7) || '\u0000'));

    // Dry run (no --apply): nothing written; the report names the rows it would change by id and counts per company.
    const dry = runBackfill(before, [], { race, account: ACCT });
    expect.soft(dry.code, `the dry run ends with code 0 (${dry.stderr.slice(-400)})`).toBe(0);
    expect.soft(writes(dry).map((c) => c.op), 'the dry run writes nothing').toEqual([]);
    expect.soft(dry.tables, 'the dry run changes no row').toEqual(before);
    const scans = dry.calls.filter((c) => c.op === 'Scan');
    expect.soft(scans.length > 0 && scans.every((c) => c.params.TableName === EMPLOYEES), 'it reads the employees table with Scan').toBe(true);
    const proj = (c: any) => String(c.params.ProjectionExpression ?? '').split(',').map((p) => p.trim()).map((p) => (p.startsWith('#') ? c.params.ExpressionAttributeNames?.[p] : p)).sort();
    expect.soft(scans.map(proj), 'every Scan reads only employee_id, email and tenant_id').toEqual(scans.map(() => ['email', 'employee_id', 'tenant_id']));
    expect.soft(scans.length, 'it reads every page (the fake answers 3 rows a page)').toBeGreaterThanOrEqual(4);
    expect.soft(dry.stdout.includes(ID.johnCaps), 'the dry run reports the skipped duplicate by id').toBe(true);
    expect.soft(noCompany.filter((id) => !dry.stdout.includes(id)), 'the dry run reports every row with no company by id (skipped)').toEqual([]);
    expect.soft(dry.calls.some((c) => c.op === 'GetCallerIdentity'), 'it asks AWS which account it is in').toBe(true);
    expect.soft(dry.stdout.split('\n').find((l) => l.trim() !== '') ?? '', 'the first line of the output names the account').toContain(ACCT);
    expect.soft([A, B].every((c) => dry.stdout.includes(c)), 'the dry run counts per company id').toBe(true);
    expect.soft(leaks(dry.stdout + dry.stderr), 'no address, name or phone in the dry run\'s output').toEqual([]);

    // --apply.
    const run1 = runBackfill(before, apply, { race, account: ACCT });
    expect.soft(run1.code, `--apply ends with code 0 (${run1.stderr.slice(-400)})`).toBe(0);
    const after = byId(run1.tables);
    const was = byId(before);
    const was0 = (id: string) => was[id]?.['email'];
    expect.soft([after[ID.thandi]?.['email'], after[ID.sipho]?.['email'], after[ID.maryB]?.['email']],
      'A\'s Thandi@X.co, B\'s Sipho@Y.co, B\'s Mary@Q.co (A\'s mary@q.co does not count) become lower case').toEqual(['thandi@x.co', 'sipho@y.co', 'mary@q.co']);
    expect.soft(noCompany.map((id) => after[id]?.['email']), 'without --legacy-tenant the rows with no company are left as they are').toEqual(noCompany.map((id) => was0(id)));
    expect.soft([after[ID.johnCaps]?.['email'], after[ID.john]?.['email']], 'A\'s John@Z.co beside A\'s john@z.co is skipped (never merged or deleted)').toEqual(['John@Z.co', 'john@z.co']);
    expect.soft([after[ID.raced]?.['email'], after[ID.moved]?.['email'], after[ID.moved]?.['tenant_id']], 'rows changed between read and write are left alone (another address; another company)').toEqual(['refilwe.again@r.co', 'Musa@M.co', B]);
    expect.soft(Object.keys(after).sort(), 'no row added or removed').toEqual(Object.keys(was).sort());
    for (const id of Object.keys(was)) {
      const a = { ...after[id] }; const w = { ...was[id] };
      delete a['email']; delete w['email'];
      if (id === ID.moved) { delete a['tenant_id']; delete w['tenant_id']; }
      expect.soft(a, `${id}: nothing but the address changes`).toEqual(w);
    }
    const ups = run1.calls.filter((c) => c.op === 'UpdateItem');
    expect.soft(run1.calls.filter((c) => !/^(Scan|Query|GetItem|UpdateItem|GetCallerIdentity)$/.test(c.op)).map((c) => c.op), 'only UpdateItem writes (no Put, Delete, batch or transaction)').toEqual([]);
    expect.soft(ups.map((c) => plain(c.params.Key ?? {})['employee_id'] ?? c.params.Key?.employee_id).sort(), 'one update per row that needs it (the raced ones tried once), none for a row with no company').toEqual([ID.thandi, ID.raced, ID.moved, ID.sipho, ID.maryB].sort());
    for (const id of [ID.johnCaps, ID.raced, ID.moved, ...noCompany]) expect.soft(run1.stdout.includes(id), `the report names ${id} (skipped or left alone)`).toBe(true);
    expect.soft([A, B].every((c) => run1.stdout.includes(c)), 'counts per company id').toBe(true);
    expect.soft(leaks(run1.stdout + run1.stderr), 'no address, name or phone in the output').toEqual([]);
    // Run again: after a clean --apply a second --apply finds nothing to change (the duplicate is reported again, never written).
    const clean1 = runBackfill(before, apply, { account: ACCT });
    const run2 = runBackfill(clean1.tables, apply, { account: ACCT });
    expect.soft([clean1.code, run2.code, run2.calls.filter((c) => c.op === 'UpdateItem').length], 'a second --apply: code 0, no update').toEqual([0, 0, 0]);
    expect.soft(run2.tables, 'nothing changes').toEqual(clean1.tables);
    expect.soft(run2.stdout.includes(ID.johnCaps), 'the duplicate is reported again').toBe(true);

    // rec-06.1.1 M-1: with --legacy-tenant the rows with no company count as that company's. They are made lower case unless a row of
    // that company already holds the lower-case form (Kagiso's Palesa@P.co beside A's palesa@p.co is skipped), and they get no company.
    const leg = runBackfill(before, [...apply, '--legacy-tenant', FOUNDING], { account: ACCT });
    const legAfter = byId(leg.tables);
    expect.soft(leg.code, `--legacy-tenant: code 0 (${leg.stderr.slice(-400)})`).toBe(0);
    expect.soft([legAfter[ID.legacy]?.['email'], legAfter[ID.spaced]?.['email'], legAfter[ID.legacyDup]?.['email']], 'with --legacy-tenant: Lerato and Sizwe lower case; Kagiso\'s address, which A already holds in lower case, left as it is').toEqual(['lerato@w.co', 'sizwe@v.co', 'Palesa@P.co']);
    expect.soft(noCompany.map((id) => legAfter[id]?.['tenant_id'] ?? null), 'the rows with no company are not given one').toEqual([null, null, null]);
    expect.soft(leg.stdout.includes(ID.legacyDup), 'the legacy duplicate is reported by id').toBe(true);
    const legUps = leg.calls.filter((c) => c.op === 'UpdateItem');
    const keyId = (c: any) => plain(c.params.Key ?? {})['employee_id'] ?? c.params.Key?.employee_id;
    const legIds = legUps.map(keyId);
    expect.soft(legIds.filter((id) => id === ID.legacyDup), 'no write for the legacy duplicate').toEqual([]);
    expect.soft(legUps.filter((c) => noCompany.includes(keyId(c))).every((c) => /tenant_id/.test(String(c.params.ConditionExpression ?? ''))), 'each write to a row with no company is conditional on its company field').toBe(true);
    const lowerByCompany = (t: Tables) => {
      const seen = new Map<string, string[]>();
      for (const r of employeesOf(t)) {
        const key = `${r['tenant_id'] ?? FOUNDING}|${String(r['email'] ?? '').trim().toLowerCase()}`;
        seen.set(key, [...(seen.get(key) ?? []), String(r['email'])]);
      }
      return [...seen.entries()].filter(([, v]) => v.filter((e) => e === e.trim().toLowerCase()).length > 1).map(([k]) => k);
    };
    expect.soft(lowerByCompany(leg.tables), 'no two rows of one company (no-company rows counted as the founding client) end with the same lower-case address').toEqual([]);
    expect.soft(leaks(leg.stdout + leg.stderr), '--legacy-tenant: no address, name or phone in the output').toEqual([]);

    // rec-06.1.1 M-2: --apply needs --account with the id of the account the credentials are in. Without it, or with another id, the run
    // refuses: it ends with a code other than 0, writes nothing and changes no row. It still names the account it found.
    for (const [what, args] of [['--apply with no --account', ['--apply']], ['--apply with another account', ['--apply', '--account', '999988887777']], ['--apply --legacy-tenant with another account', ['--apply', '--account', '999988887777', '--legacy-tenant', FOUNDING]]] as const) {
      const r = runBackfill(before, [...args], { account: ACCT });
      expect.soft(r.code, `${what}: refused (code not 0)`).not.toBe(0);
      expect.soft(writes(r).map((c) => c.op), `${what}: nothing written`).toEqual([]);
      expect.soft(r.tables, `${what}: no row changes`).toEqual(before);
      expect.soft((r.stdout + r.stderr).includes(ACCT), `${what}: the output names the account it found`).toBe(true);
    }
    const right = runBackfill(before, apply, { account: '222233334444' });
    expect.soft(right.code, 'the right --account but credentials in another account: refused (code not 0)').not.toBe(0);
    expect.soft([writes(right).map((c) => c.op), right.tables], 'credentials in another account: nothing written, no row changes').toEqual([[], before]);

    // After the run, sign-in (cognitoPostAuth, BE-18's path) finds Thandi whether she types her address with capitals or lower case.
    const w = world();
    const signedIn = { ...structuredClone(w), [EMPLOYEES]: run1.tables[EMPLOYEES]! };
    const postAuth = (typed: string) => trigger('cognitoPostAuth', {
      version: '1', triggerSource: 'PostAuthentication_Authentication', region: 'af-south-1', userPoolId: 'af-south-1_Rec061Fake', userName: typed,
      callerContext: { awsSdkVersion: 'x', clientId: 'x' }, request: { userAttributes: { sub: SUB.empA, email: typed } }, response: {},
    }, signedIn);
    for (const typed of ['Thandi@X.co', 'thandi@x.co']) {
      const r = keep(`sign-in as ${typed}`, postAuth(typed));
      expect.soft(r.error ?? null, `sign-in as ${typed}: no error`).toBeNull();
      expect.soft(employeesOf(r.tables).find((e) => e['employee_id'] === ID.thandi)?.['stage'], `sign-in typed as ${typed} finds her (INVITED becomes ACTIVE)`).toBe('ACTIVE');
    }
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 No IAM or key change: the offers role file and the key file as on develop 55efe0f; the state table block unchanged (no TTL); no Terraform names the lock or the claim; manageOffers grants exactly REC-06\'s; no table rows', async ({}, testInfo) => {
    once(testInfo.project.name);
    const base = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-06.1', 'baseline-55efe0f.json'), 'utf8')) as { files: Record<string, string>; blocks: Record<string, string> };
    const sha = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
    for (const [f, h] of Object.entries(base.files)) expect.soft(sha(readFileSync(join(REPO, f))), `${f} is byte for byte as on develop 55efe0f`).toBe(h);
    const state = blocks([join(REPO, 'talent-flow-infra', 'talent-flow-dynamodb.tf')], 'resource').find((b) => b.labels[0] === 'aws_dynamodb_table' && b.labels[1] === 'talent_flow_state');
    expect(state, 'the talent-flow-state table block is found').toBeTruthy();
    expect.soft(sha(state!.raw.replace(/\s+/g, ' ').trim()), 'the talent-flow-state table block is unchanged (no TTL, no new index)').toBe(base.blocks['talent-flow-infra/aws_dynamodb_table.talent_flow_state']);
    const tf = STACKS.flatMap((st) => readdirSync(join(REPO, st)).filter((f) => f.endsWith('.tf')).map((f) => [`${st}/${f}`, readFileSync(join(REPO, st, f), 'utf8')] as const));
    expect.soft(tf.filter(([, text]) => /EMAIL_LOCK|claimed_at|email_lock/i.test(text)).map(([f]) => f), 'no Terraform file names the lock or the claim').toEqual([]);
    expect.soft(STACKS.flatMap((st) => resourcesOf(st, 'aws_dynamodb_table_item').map((b) => b.labels[1])), 'no table rows in Terraform').toEqual([]);
    const fn = lambdaNamed('manageOffers');
    expect(fn.length, 'one aws_lambda_function named manageOffers').toBe(1);
    const role = roleResourceOf(fn[0]!.block);
    const lines = Object.values(policyLines()).filter((x) => x.stack === fn[0]!.stack && x.role === role).flatMap((x) => x.pairs ?? [`unreadable ${x.squash}`]);
    const REC06 = [
      ...JSON.parse(readFileSync(join(__dirname, 'support', 'rec-06', 'manage-offers-lines.20b1bab.json'), 'utf8')) as string[],
      'Allow dynamodb:PutItem arn:aws:dynamodb:af-south-1:000000000000:table/employees null',
      'Allow dynamodb:Query arn:aws:dynamodb:af-south-1:000000000000:table/employees/index/email-index null',
    ];
    expect.soft([...lines].sort(), 'manageOffers grants exactly what REC-06 left it').toEqual([...REC06].sort());
  });

  // ---------------------------------------------------------------- AC-10

  test('AC-10 pepla-dev: the seed puts both twin offers back, removes both possible employees, the lock rows and the history rows each run, with known keys only (text check)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-06.1', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    expect.soft(/@blackhole\.postmarkapp\.com$/.test(ids['email'] ?? ''), 'the shared seeded address is a robot address').toBe(true);
    expect.soft([ids['candidate1'], ids['candidate2']].every((c) => /^CAND-[0-9A-Z]{26}$/.test(c ?? '')) && [ids['offer1'], ids['offer2']].every((o) => /^offer-[0-9a-z-]{8,80}$/.test(o ?? '')), 'ids of the shapes the routes accept').toBe(true);
    const src = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    const fnOf = (name: string) => {
      const start = src.indexOf(`def ${name}(`);
      if (start < 0) return '';
      const end = src.indexOf('\ndef ', start + 10);
      return src.slice(start, end === -1 ? undefined : end);
    };
    /** A function's body plus the bodies of the seed's own functions it calls (one level), so a shared helper counts. */
    const withCallees = (name: string) => {
      const body = fnOf(name);
      const called = [...new Set([...body.matchAll(/\b([a-z_][a-z0-9_]*)\(/g)].map((m) => m[1]!))].filter((n) => n !== name && src.includes(`def ${n}(`));
      return [body, ...called.map(fnOf)].join('\n');
    };
    expect(fnOf('seed_rec06_1'), 'seed-dev.py has seed_rec06_1').not.toBe('');
    const f = withCallees('seed_rec06_1');
    expect.soft(src.slice(src.indexOf('def main(')), 'main() calls seed_rec06_1').toMatch(/seed_rec06_1\(\s*ddb\s*,/);
    expect.soft(f, 'it reads support/rec-06.1/dev-ids.json').toMatch(/rec-06\.1[\s\S]*dev-ids\.json/);
    expect.soft(f, 'it makes the employee ids with uuid5 and the namespace').toMatch(new RegExp(`uuid5[\\s\\S]*${EMPLOYEE_ID_NAMESPACE}|${EMPLOYEE_ID_NAMESPACE}[\\s\\S]*uuid5`));
    expect.soft(f, 'it names both offers (both possible employees)').toMatch(/offer1[\s\S]*offer2|offer2[\s\S]*offer1/);
    expect.soft(f, 'it deletes employee rows on condition of the company').toMatch(/delete_item\([\s\S]*employees[\s\S]*ConditionExpression[\s\S]*tenant_id/);
    expect.soft(f, 'it deletes the lock row of the shared address (EMAIL_LOCK, sha256)').toMatch(/EMAIL_LOCK[\s\S]*sha256|sha256[\s\S]*EMAIL_LOCK/);
    expect.soft(f, 'it removes the candidates\' history rows (begins_with STAGE#)').toMatch(/begins_with\([^)]*SK[\s\S]*STAGE#|STAGE#[\s\S]*begins_with/);
    expect.soft(f, 'it puts the offers back to SENT').toMatch(/"SENT"/);
    expect.soft(f, 'it puts the candidates back to OFFER').toMatch(/"OFFER"/);
    expect.soft(/\bScan\b|scan\(|get_paginator\(\s*["']scan/.test(f), 'it scans nothing (the keys are known)').toBe(false);
    const f06 = withCallees('seed_rec06');
    expect.soft(f06, 'seed_rec06 also removes its hire candidate\'s history rows').toMatch(/begins_with\([^)]*SK[\s\S]*STAGE#|STAGE#[\s\S]*begins_with/);
    expect.soft(f06, 'seed_rec06 also removes the lock row of its hire address').toMatch(/EMAIL_LOCK[\s\S]*sha256|sha256[\s\S]*EMAIL_LOCK/);
    expect.soft(/\bScan\b|scan\(|get_paginator\(\s*["']scan/.test(f06), 'seed_rec06 still scans nothing').toBe(false);
  });

  test('AC-10 pepla-dev seed, run for real against a fake DynamoDB: both possible employees, the lock row and both candidates\' history rows go; both offers back to SENT; rows of another company and other candidates stay; a second run ends the same; seed_rec06 clears its own lock and history too', async ({}, testInfo) => {
    once(testInfo.project.name);
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-06.1', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const ids06 = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-06', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const OTHER = 'CAND-REC061SEEDOTHER0000000001';
    const at0 = '2030-02-03T08:00:00.000Z';
    const stage = (tenant: string, cid: string, n: number) => av({ PK: `CANDIDATE#${cid}`, SK: `STAGE#${at0}#${n}`, tenant_id: tenant, stage: 'HIRED' });
    const lock = (tenant: string, email: string, offer: string) => lockRow(tenant, email, offer, employeeIdOf(A, offer), at0);
    const pair: [string, string][] = [[ids['candidate1']!, ids['offer1']!], [ids['candidate2']!, ids['offer2']!]];
    const converted = (tenant: string): Tables => ({
      [TABLE.state]: [
        ...pair.flatMap(([cid, oid]) => [
          av({ PK: `CANDIDATE#${cid}`, SK: 'SAGA', tenant_id: tenant, candidateId: cid, currentStage: 'HIRED', employee_id: employeeIdOf(A, oid), email: ids['email']! }),
          av({ PK: `OFFER#${oid}`, SK: 'OFFER', tenant_id: tenant, offer_id: oid, candidate_id: cid, state: 'ACCEPTED', employee_id: employeeIdOf(A, oid), version: 4 }),
          stage(tenant, cid, 1), stage(tenant, cid, 2),
        ]),
        lock(tenant, ids['email']!, ids['offer1']!),
        lock(B, ids['email']!, ids['offer1']!),
        stage(A, OTHER, 1),
        stage(tenant, ids06['candidate']!, 1),
        lock(tenant, ids06['email']!, ids06['offer']!),
      ],
      [EMPLOYEES]: pair.map(([, oid]) => av({ employee_id: employeeIdOf(A, oid), tenant_id: tenant, email: ids['email']!, first_name: 'Rec061', last_name: 'Seed' })),
    });
    const keyOf = (r: Row) => { const x = plain(r); return `${x['PK'] ?? x['employee_id']}|${x['SK'] ?? ''}`; };
    const keys = (t: Tables, table: string) => (t[table] ?? []).map(keyOf).sort();
    const stateRow = (t: Tables, pk: string, sk: string) => (t[TABLE.state] ?? []).map(plain).find((x) => x['PK'] === pk && x['SK'] === sk);
    const seedOk = (what: string, r: ReturnType<typeof runSeed>) => {
      expect(r.code, `${what}: the seed function ran (${r.stderr.slice(-400)})`).toBe(0);
      expect.soft(r.calls.filter((c) => /^(Scan|BatchWriteItem|TransactWriteItems)$/.test(c.op)).map((c) => c.op), `${what}: no Scan, batch or transaction`).toEqual([]);
      expect.soft(r.calls.filter((c) => c.op === 'DeleteItem' && !/tenant_id/.test(String(c.params?.ConditionExpression ?? ''))).length, `${what}: every delete is held to the company`).toBe(0);
    };

    const run1 = runSeed(converted(A), 'seed_rec06_1', [A]);
    seedOk('first run', run1);
    expect.soft((run1.tables[EMPLOYEES] ?? []).map((r) => plain(r)['employee_id']), 'both possible employees are gone').toEqual([]);
    expect.soft(stateRow(run1.tables, lockKeyOf(A, ids['email']!), 'EMAIL_LOCK'), 'A\'s lock row of the shared address is gone').toBeUndefined();
    expect.soft(stateRow(run1.tables, lockKeyOf(B, ids['email']!), 'EMAIL_LOCK'), 'B\'s lock row of the same address stays').toBeDefined();
    expect.soft(pair.flatMap(([cid]) => (run1.tables[TABLE.state] ?? []).map(plain).filter((x) => x['PK'] === `CANDIDATE#${cid}` && String(x['SK']).startsWith('STAGE#'))).length, 'both candidates\' history rows are gone').toBe(0);
    expect.soft(stateRow(run1.tables, `CANDIDATE#${OTHER}`, `STAGE#${at0}#1`), 'another candidate\'s history row stays').toBeDefined();
    expect.soft(pair.map(([cid, oid]) => [stateRow(run1.tables, `OFFER#${oid}`, 'OFFER')?.['state'], stateRow(run1.tables, `OFFER#${oid}`, 'OFFER')?.['employee_id'], stateRow(run1.tables, `CANDIDATE#${cid}`, 'SAGA')?.['currentStage'], stateRow(run1.tables, `TENANT#${A}#OFFER_LIVE#${cid}`, 'LOCK')?.['live_offer_id']]), 'both offers SENT with no employee, both candidates in OFFER, each live-offer lock naming its offer').toEqual(pair.map(([, oid]) => ['SENT', undefined, 'OFFER', oid]));
    expect.soft(pair.map(([, oid]) => stateRow(run1.tables, `OFFER#${oid}`, 'OFFER')?.['tenant_id']), 'the offers belong to the company').toEqual([A, A]);

    const run2 = runSeed(run1.tables, 'seed_rec06_1', [A]);
    seedOk('second run', run2);
    expect.soft([keys(run2.tables, TABLE.state), keys(run2.tables, EMPLOYEES)], 'a second run ends with the same rows').toEqual([keys(run1.tables, TABLE.state), keys(run1.tables, EMPLOYEES)]);

    const foreign = runSeed(converted(B), 'seed_rec06_1', [A]);
    seedOk('rows of another company under the same keys', foreign);
    const kept = converted(B);
    expect.soft(keys(foreign.tables, EMPLOYEES), 'employee rows of another company under the seed\'s keys stay').toEqual(keys(kept, EMPLOYEES));
    expect.soft(pair.flatMap(([cid]) => (foreign.tables[TABLE.state] ?? []).map(plain).filter((x) => x['PK'] === `CANDIDATE#${cid}` && String(x['SK']).startsWith('STAGE#'))).length, 'history rows of another company stay').toBe(4);

    const r06 = runSeed(converted(A), 'seed_rec06', [A]);
    seedOk('seed_rec06', r06);
    expect.soft(stateRow(r06.tables, lockKeyOf(A, ids06['email']!), 'EMAIL_LOCK'), 'seed_rec06 removes the lock row of its hire address').toBeUndefined();
    expect.soft(stateRow(r06.tables, `CANDIDATE#${ids06['candidate']}`, `STAGE#${at0}#1`), 'seed_rec06 removes its hire candidate\'s history rows').toBeUndefined();
  });

  test('AC-10 The test logins on pepla-dev: two seeded offers with one robot address accepted at the same moment give one 200 and one 409 (EMAIL_IS_EMPLOYEE or STALE); the loser\'s retry is EMAIL_IS_EMPLOYEE; A lists the person once; B does not @pepla-dev', async ({ page }, testInfo) => {
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
    const call2 = async (base: string, token: string, method: string, path: string, body?: unknown) =>
      page.request.fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { data: JSON.stringify(body) }) });
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-06.1', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const [hr, companyB] = await Promise.all([signIn(logins.hr), signIn(logins.companyB)]);
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
    const signedCopy = async (offerId: string) => {
      const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n% REC-06.1 dev test signed copy\n'), Buffer.alloc(2048, 32), Buffer.from('\n%%EOF\n')]);
      const up = await call2(tfApi, hr, 'POST', `/v1/offers/${offerId}/signed-upload`, { file_name: 'Signed offer.pdf', content_type: 'application/pdf', file_size: pdf.length });
      expect(up.status(), `an upload link for ${offerId} (${await up.text()})`).toBe(200);
      const { upload_url: url, signed_key: key } = (await up.json()) as { upload_url: string; signed_key: string };
      const put = await page.request.fetch(url, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, data: pdf });
      expect([200, 204], `the signed copy is stored (${put.status()})`).toContain(put.status());
      return key;
    };
    for (const o of [ids['offer1']!, ids['offer2']!]) {
      const b = (await (await call2(tfApi, hr, 'GET', `/v1/offers/${o}`)).json()) as any;
      expect(b.state, `the seeded offer ${o} is SENT (the seed puts it back each run)`).toBe('SENT');
    }
    const [k1, k2] = await Promise.all([signedCopy(ids['offer1']!), signedCopy(ids['offer2']!)]);
    const body = (k: string) => ({ answer: 'ACCEPTED', signed_key: k, confirmed_start_date: ids['startDate'] });
    // The same moment: both requests are sent together.
    const [r1, r2] = await Promise.all([call2(tfApi, hr, 'POST', `/v1/offers/${ids['offer1']}/answer`, body(k1)), call2(tfApi, hr, 'POST', `/v1/offers/${ids['offer2']}/answer`, body(k2))]);
    const res = [{ offer: ids['offer1']!, key: k1, status: r1.status(), body: (await r1.json()) as any }, { offer: ids['offer2']!, key: k2, status: r2.status(), body: (await r2.json()) as any }];
    expect(res.map((x) => x.status).sort(), `one 200 and one 409 (${JSON.stringify(res.map((x) => [x.status, x.body?.code ?? x.body?.state]))})`).toEqual([200, 409]);
    const winner = res.find((x) => x.status === 200)!;
    const loser = res.find((x) => x.status === 409)!;
    expect(['EMAIL_IS_EMPLOYEE', 'STALE'], `the loser's code (${loser.body?.code})`).toContain(loser.body?.code);
    expect(loser.body?.error, 'the loser\'s answer is a conflict').toBe('Conflict');
    const again = await call2(tfApi, hr, 'POST', `/v1/offers/${loser.offer}/answer`, body(loser.key));
    expect([again.status(), await again.json()], 'the loser\'s retry: 409 EMAIL_IS_EMPLOYEE').toEqual([409, { error: 'Conflict', code: 'EMAIL_IS_EMPLOYEE' }]);
    const mine = (await allEmployees(hr)).filter((e) => String(e.email ?? '').toLowerCase() === ids['email']);
    expect(mine.map((e) => e.employee_id), 'A\'s list has exactly one person with that address, the winner\'s').toEqual([winner.body.employee_id]);
    expect((await allEmployees(companyB)).some((e) => String(e.email ?? '').toLowerCase() === ids['email'] || e.employee_id === winner.body.employee_id), 'B\'s list does not have them').toBe(false);
  });
});
