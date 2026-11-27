import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { attributes, blocks, stripComments } from './support/infra-harness';
import { HANDLER, LAMBDA, REPO, runJob, type Call, type Run } from './support/chat-15/lambda-harness';
import {
  A, AUDIT, B, CHATS, MINUTE, POOL_ID, SETTINGS, USERS, ADMIN_SUB,
  again, auditRows, batchKeys, chatQueries, chatRows, chatsOf, cognitoCalls, email, exceptTables, family, given, go, isCleared, logLines, others, pk, plain, pool, queriedPk,
  rowCount, rowsOf, same, sorted, staff, sub, userOf, userRow, world, writesOf, ago, awsCalls, type Person,
} from './support/chat-15/world';
import {
  BASELINE, FUNCTION_NAME, RULE_NAME, ROLE_ARN, ROLE_NAME, STACKS, TF, addresses, allAddresses, dirHashes, kmsLists, lambdaBlock, lambdaBlocks, lambdaLabel, linesOfRole, policyResourcesOf,
  read, resolve, resourceHash, roleBlock, roleBlocks, roleLabel, settings, sha, squash, unquote, valueOf,
} from './support/chat-15/terraform';
import { resourcesOf, filesOf, settingsOf } from './support/mod-01/iam';
import { isRec05Resource } from './support/rec-05.1/grants'; // child lock rec-05.1
import { MANAGE_OFFERS_ARN, MONITOR_SLAS_ARN, withoutOnce } from './support/ten-02.12/kms'; // child lock ten-02.12

/**
 * CHAT-15 · A leaver's Ask Batsi chats are deleted by an hourly job (red).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/ask-batsi-chat/CHAT-15-delete-leavers-chats.md (19 Nov 2026). AC-1 to AC-13 are the card's; AC-14 and AC-15 pin the rest of its text
 * (settings that stop the job at start, and that nothing in the call decides whose chats go). The decisions P-1 to P-14 are in cards/chat-15.md.
 *
 * The Lambda tests run the real handler (lambda/deleteLeaverChats/index.mjs) in a fresh Node process each, against a fake AWS
 * (support/chat-15/fake-aws, copied from CHAT-02's with code added only). Nothing here calls AWS, Bedrock or any AI service; Playwright is not used for
 * a page. The Terraform checks read both stacks as text. Everything runs once (desktop-1280); nothing here has a screen width.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};

const isoOk = (s: unknown) => typeof s === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(s) && !Number.isNaN(Date.parse(s));
const WHAT = (r: Run) => (r.error ? `crashed: ${r.error.name}: ${r.error.message.slice(0, 160)}` : 'finished');
const mine = (n: number, company = A) => [pk(company, staff(n)), pk(company, sub(n))];
/** Seeds `count` chats of 2 messages under both of person n's keys: the staff id and the sign-in id. */
const bothKeys = (n: number, company = A, o: { messages?: number; count?: number } = {}) => [
  ...chatRows(company, staff(n), o.count ?? 2, { messages: o.messages ?? 2, tag: `S${n}${company === B ? 'b' : ''}` }),
  ...chatRows(company, sub(n), 1, { messages: o.messages ?? 2, tag: `U${n}${company === B ? 'b' : ''}`, first: 50 }),
];
const KEYS_LEFT = (t: Run['tables'], n: number, company = A) => mine(n, company).flatMap((k) => rowsOf(t, CHATS).filter((r) => (r['pk'] as any)?.S === k));
const inStaffAndSub = (t: Run['tables'], n: number, company = A) => KEYS_LEFT(t, n, company).length;
const FORBIDDEN_WORDS = (n: number) => [email(n), given(n), family(n), 'TITLE-MARK', 'TEXT-MARK'];
const blob = (r: Run) => [...logLines(r.calls), r.error?.message ?? '', r.error?.stack ?? '', JSON.stringify(r.response ?? null)].join('\n');

test.describe('CHAT-15 · An hourly job deletes a leaver\'s Ask Batsi chats', () => {
  test.beforeEach(({}, testInfo) => once(testInfo.project.name));

  // ---------------------------------------------------------------- AC-1

  test('AC-1 A leaver\'s chats are deleted: every row under both keys, the person is marked, and one audit row is written', () => {
    test.setTimeout(120_000);
    expect(existsSync(HANDLER), 'lambda/deleteLeaverChats/index.mjs exists').toBe(true);
    const p: Person = { n: 1, minutes: 70 };
    // 3 chats of 6 messages under the staff id (21 rows: the fake pages 4 at a time) and 2 chats under the sign-in id.
    const chats = [...chatRows(A, staff(1), 3, { messages: 6, tag: 'S1' }), ...chatRows(A, sub(1), 2, { messages: 2, tag: 'U1', first: 50 })];
    const t0 = Date.now();
    const r = go([p], chats);
    expect(r.error, `the run finishes (${WHAT(r)})`).toBeUndefined();
    expect(chatsOf(r.before, A, staff(1)).length + chatsOf(r.before, A, sub(1)).length, 'before: 21 rows under the staff id and 6 under the sign-in id').toBe(27);
    expect(chatsOf(r.tables, A, staff(1)), 'no row is left under the staff id key').toEqual([]);
    expect(chatsOf(r.tables, A, sub(1)), 'no row is left under the sign-in id key').toEqual([]);
    expect(isCleared(r.tables, 1), 'the person\'s row carries chats_deleted_at').toBe(true);
    const when = userOf(r.tables, 1)['chats_deleted_at'];
    expect(isoOk(when), `chats_deleted_at is a time (${when})`).toBe(true);
    expect(Date.parse(when), 'and it is the time of this run').toBeGreaterThanOrEqual(t0 - 5_000);
    expect(Date.parse(when)).toBeLessThanOrEqual(Date.now() + 5_000);
    expect(auditRows(r.tables), 'exactly one LEAVER_CHATS_DELETED row').toHaveLength(1);
    // Cognito is asked about the person by the address on the row, in the pool the settings name.
    const asked = cognitoCalls(r.calls).filter((c) => c.op === 'AdminGetUser');
    expect(asked.map((c) => c.input?.Username), 'AdminGetUser by the row\'s email').toEqual([email(1)]);
    expect(asked.every((c) => c.input?.UserPoolId === POOL_ID), 'in the pool of COGNITO_POOL_ID').toBe(true);
    // The audit row is written first, then the person is marked.
    const w = writesOf(r.calls);
    const put = w.findIndex((c) => c.op === 'PutItem' && c.table === AUDIT);
    const upd = w.findIndex((c) => c.op === 'UpdateItem' && c.table === USERS);
    expect([put >= 0, upd >= 0, put < upd], 'the audit row is put, then the person is marked, in that order').toEqual([true, true, true]);
    // Nothing is deleted before Cognito says the sign-in is disabled.
    const firstDelete = r.calls.findIndex((c) => c.service === 'dynamodb' && c.op === 'BatchWriteItem');
    const firstCognito = r.calls.findIndex((c) => c.service === 'cognito');
    expect(firstCognito, 'Cognito is asked before any delete').toBeLessThan(firstDelete);
    // The run is finished with nothing to do the second time.
    const second = again(r, [p]);
    expect(second.error, `a second run finishes (${WHAT(second)})`).toBeUndefined();
    expect(writesOf(second.calls), 'and writes nothing').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-2

  for (const side of [A, B] as const) {
    test(`AC-2 Nothing else changes: a leaver of company ${side === A ? 'A' : 'B'} takes only their own two partitions with them`, () => {
      test.setTimeout(120_000);
      const other = side === A ? B : A;
      const leaver: Person = { n: 1, company: side };
      // A colleague of the same company, a twin of the other company with the SAME staff id, one whose staff id only starts the same way,
      // and an active person of the other company who has chats under the leaver's SAME staff id and sign-in id.
      const colleague: Person = { n: 2, company: side, status: 'ACTIVE', minutes: null };
      const twin: Person = { n: 3, company: other, status: 'ACTIVE', minutes: null, staffId: staff(1) };
      const prefix: Person = { n: 10, company: side, status: 'ACTIVE', minutes: null };
      const chats = [
        ...bothKeys(1, side), ...bothKeys(2, side), ...chatRows(other, staff(1), 2, { tag: 'TWIN' }), ...chatRows(other, sub(3), 1, { tag: 'TWIN-SUB', first: 50 }),
        ...chatRows(side, staff(10), 2, { tag: 'PREFIX' }), ...chatRows(side, `${staff(1)}X`, 1, { tag: 'LONGER' }), ...chatRows(side, sub(1).slice(0, 35), 1, { tag: 'SHORTER' }),
      ];
      const r = go([leaver, colleague, twin, prefix], chats, { env: { LEGACY_TENANT_ID: A } });
      expect(r.error, `the run finishes (${WHAT(r)})`).toBeUndefined();
      expect(inStaffAndSub(r.tables, 1, side), `company ${side}'s leaver has no chat left`).toBe(0);
      // Every other chat row is as it was.
      const key = (t: Run['tables']) => sorted(rowsOf(t, CHATS).filter((x) => !mine(1, side).includes((x['pk'] as any).S)));
      expect(same(key(r.before), key(r.tables)), 'every chat row outside the leaver\'s two partitions is the same').toBe(true);
      expect(sorted(rowsOf(r.tables, CHATS).filter((x) => (x['pk'] as any).S === pk(other, staff(1)))).length, 'the other company\'s twin keeps their chats under the same staff id').toBe(rowCount(2));
      // Every other table, and every other row of the people, audit and chat tables.
      expect(same(exceptTables(r.before, CHATS, USERS, AUDIT), exceptTables(r.tables, CHATS, USERS, AUDIT)), 'every row of every other table is the same').toBe(true);
      const users = (t: Run['tables']) => rowsOf(t, USERS).map(plain);
      const before = users(r.before);
      const after = users(r.tables);
      expect(after.length, 'no person row is added or removed').toBe(before.length);
      for (const b of before) {
        const a = after.find((x) => x['PK'] === b['PK'])!;
        if (b['userId'] === sub(1)) expect({ ...a }, 'the leaver\'s row is the same but for chats_deleted_at').toEqual({ ...b, chats_deleted_at: a['chats_deleted_at'] });
        else expect(a, `row ${b['PK']} is the same`).toEqual(b);
      }
      expect(after.find((x) => x['userId'] === sub(1))!['chats_deleted_at'], 'and the leaver is marked').toBeDefined();
      const auditNow = rowsOf(r.tables, AUDIT).map(plain);
      expect(auditNow.filter((x) => x['action'] !== 'LEAVER_CHATS_DELETED'), 'the audit rows that were there are the same').toEqual(rowsOf(r.before, AUDIT).map(plain));
      expect(auditNow.filter((x) => x['action'] === 'LEAVER_CHATS_DELETED'), 'plus exactly one new row').toHaveLength(1);
      // The only writes: deletes on the leaver's keys, one audit row, one update of the leaver's row.
      const w = writesOf(r.calls);
      expect(w.filter((c) => c.op !== 'BatchWriteItem').map((c) => `${c.op} ${c.table}`).sort(), 'one PutItem on the audit table and one UpdateItem on the people table, nothing else').toEqual([`PutItem ${AUDIT}`, `UpdateItem ${USERS}`]);
      const upd = w.find((c) => c.op === 'UpdateItem')!;
      expect(upd.input?.Key?.PK?.S, 'the update is on the leaver\'s row').toBe(`USER#${sub(1)}`);
      for (const c of w.filter((x) => x.op === 'BatchWriteItem')) {
        for (const k of batchKeys(c)) expect([k.table, k.kind, mine(1, side).includes(k.pk ?? '')], 'a batch only deletes, only in the chats table, only under the leaver\'s keys').toEqual([CHATS, 'Delete', true]);
      }
      // Reads: only the leaver's two partitions of the chats table are ever asked for, never another person's or another company's.
      expect(chatQueries(r.calls).map(queriedPk).every((k) => mine(1, side).includes(k)), 'every Query of the chats table is for one of the leaver\'s two keys').toBe(true);
      expect(r.calls.filter((c) => c.service === 'dynamodb' && c.table === CHATS && c.op === 'Scan'), 'the chats table is never scanned').toEqual([]);
    });
  }

  // ---------------------------------------------------------------- AC-3

  test('AC-3 It waits out the sign-in hour: at 30 and 64 minutes nothing is deleted, at 66 minutes it is, whatever updatedAt says', () => {
    test.setTimeout(120_000);
    const young: Person = { n: 1, minutes: 30, updated: 600 }; // deactivated 30 minutes ago, row last touched 10 hours ago
    const edge: Person = { n: 2, minutes: 64, updated: 600 };
    const ready: Person = { n: 3, minutes: 66, updated: 1 }; // deactivated 66 minutes ago, row touched a minute ago
    const people = [young, edge, ready];
    const chats = [...bothKeys(1), ...bothKeys(2), ...bothKeys(3)];
    const r = go(people, chats);
    expect(r.error, `the run finishes (${WHAT(r)})`).toBeUndefined();
    expect(inStaffAndSub(r.tables, 1), '30 minutes: all of their chats are still there').toBe(inStaffAndSub(r.before, 1));
    expect(inStaffAndSub(r.tables, 2), '64 minutes: all of their chats are still there').toBe(inStaffAndSub(r.before, 2));
    expect([isCleared(r.tables, 1), isCleared(r.tables, 2)], 'and neither is marked').toEqual([false, false]);
    expect(inStaffAndSub(r.tables, 3), '66 minutes: their chats are gone').toBe(0);
    expect(isCleared(r.tables, 3), 'and they are marked').toBe(true);
    expect(auditRows(r.tables).map((x) => x['user_id']), 'one audit row, for the one person').toEqual([sub(3)]);
    // The same two people an hour later are deleted (their deactivation time is what counts, not the row's last change).
    const later = go([{ n: 1, minutes: 95, updated: 1 }, { n: 2, minutes: 66, updated: 1 }], [...bothKeys(1), ...bothKeys(2)]);
    expect([inStaffAndSub(later.tables, 1), inStaffAndSub(later.tables, 2), isCleared(later.tables, 1), isCleared(later.tables, 2)], 'later both are deleted and marked').toEqual([0, 0, true, true]);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Only real leavers: an active row, a still-enabled sign-in, a marked row and a row with no deactivation time are left alone', () => {
    test.setTimeout(120_000);
    const people: Person[] = [
      { n: 1, status: 'ACTIVE', minutes: 300 }, // ACTIVE with an old deactivatedAt (re-activated by hand in the table)
      { n: 2, minutes: 70, enabled: true }, // INACTIVE, but Cognito says the sign-in is enabled
      { n: 3, minutes: 70, cleared: true }, // already done
      { n: 4, minutes: null }, // INACTIVE with no deactivatedAt
      { n: 5, minutes: 70 }, // a real leaver (the control)
    ];
    const chats = [1, 2, 3, 4, 5].flatMap((n) => bothKeys(n));
    const r = go(people, chats);
    for (const n of [1, 2, 3, 4]) expect(inStaffAndSub(r.tables, n), `person ${n}: every chat is still there`).toBe(inStaffAndSub(r.before, n));
    expect(inStaffAndSub(r.tables, 5), 'the control leaver is deleted (the run works)').toBe(0);
    expect([1, 2, 4].map((n) => isCleared(r.tables, n)), 'the first, second and fourth are not marked').toEqual([false, false, false]);
    expect(userOf(r.tables, 3)['chats_deleted_at'], 'the third keeps the time it already had').toBe(userOf(r.before, 3)['chats_deleted_at']);
    expect(auditRows(r.tables).map((x) => x['user_id']), 'one audit row, for the control leaver').toEqual([sub(5)]);
    // Who Cognito was asked about: the still-enabled one and the control only. The marked row costs no Cognito call and no chats Query.
    expect(cognitoCalls(r.calls).map((c) => c.input?.Username).sort(), 'AdminGetUser for persons 2 and 5 only').toEqual([email(2), email(5)]);
    const queried = new Set(chatQueries(r.calls).map(queriedPk));
    for (const k of [...mine(3), ...mine(1), ...mine(4)]) expect(queried.has(k), `no chats Query for ${k.slice(0, 20)}...`).toBe(false);
    expect(logLines(r.calls).some((l) => l.includes('LeaverStillEnabled')), 'a log line names LeaverStillEnabled').toBe(true);
    expect(writesOf(r.calls).filter((c) => c.op === 'UpdateItem').length, 'one person is marked').toBe(1);
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 Never half-done, and safe to repeat: a delete that cannot finish fails the run, marks no one and writes no record; the next run finishes it; a third writes nothing', () => {
    test.setTimeout(240_000);
    const p: Person = { n: 1 };
    const chats = [...chatRows(A, staff(1), 2, { messages: 6, tag: 'S1' }), ...chatRows(A, sub(1), 2, { messages: 3, tag: 'U1', first: 50 })];

    // DynamoDB hands back the rows under the sign-in id key unprocessed on every retry.
    const r1 = go([p], chats, { stuck: [pk(A, sub(1))] });
    expect(r1.error, 'the run fails (so the Lambda error alarm fires)').toBeDefined();
    expect(isCleared(r1.tables, 1), 'the person is not marked').toBe(false);
    expect(auditRows(r1.tables), 'no LEAVER_CHATS_DELETED row').toEqual([]);
    expect(logLines(r1.calls).some((l) => l.includes('ChatNotDeleted')), 'the log names the error: ChatNotDeleted').toBe(true);
    expect(chatsOf(r1.tables, A, sub(1)).length, 'the rows DynamoDB left are still there').toBe(chatsOf(r1.before, A, sub(1)).length);
    const r2 = again(r1, [p]);
    expect(r2.error, `the next run, with no fault, finishes (${WHAT(r2)})`).toBeUndefined();
    expect(inStaffAndSub(r2.tables, 1), 'and deletes what was left').toBe(0);
    expect([isCleared(r2.tables, 1), auditRows(r2.tables).length], 'marks the person and writes one record').toEqual([true, 1]);
    expect(typeof auditRows(r2.tables)[0]!['rows_deleted'], 'whose rows_deleted is a number').toBe('number');
    const r3 = again(r2, [p]);
    expect(r3.error, 'a third run finishes').toBeUndefined();
    expect([writesOf(r3.calls), cognitoCalls(r3.calls)], 'and writes nothing and asks Cognito nothing').toEqual([[], []]);

    // A delete that is answered as done but leaves the rows: the check afterwards finds them.
    const s1 = go([p], chats, { silentKeep: [pk(A, staff(1))] });
    expect(s1.error, 'rows still there after the delete: the run fails').toBeDefined();
    expect([isCleared(s1.tables, 1), auditRows(s1.tables).length], 'the person is not marked and no record is written').toEqual([false, 0]);
    const s2 = again(s1, [p]);
    expect([s2.error, inStaffAndSub(s2.tables, 1), isCleared(s2.tables, 1)], 'the next run, with no fault, finishes the job').toEqual([undefined, 0, true]);

    // The record is written before the person is marked: if the record cannot be written, the person is not marked; if the mark cannot be written, the record is there and the next run marks.
    const f1 = go([p], chats, { fail: { service: 'dynamodb', ops: ['PutItem'], message: 'MARK-FAIL', name: 'ThrottlingException' } });
    expect(f1.error, 'record not written: the run fails').toBeDefined();
    expect(f1.calls.filter((c) => c.service === 'dynamodb' && c.op === 'UpdateItem'), 'and the person is not even marked (no UpdateItem tried)').toEqual([]);
    expect([isCleared(f1.tables, 1), auditRows(f1.tables).length], 'nothing written').toEqual([false, 0]);
    const f2 = again(f1, [p]);
    expect([f2.error, isCleared(f2.tables, 1), auditRows(f2.tables).length], 'the next run marks the person and writes the record').toEqual([undefined, true, 1]);
    const m1 = go([p], chats, { fail: { service: 'dynamodb', ops: ['UpdateItem'], message: 'MARK-FAIL', name: 'ThrottlingException' } });
    expect(m1.error, 'mark not written: the run fails').toBeDefined();
    expect([isCleared(m1.tables, 1), auditRows(m1.tables).length], 'the person is not marked (the record is there)').toEqual([false, 1]);
    const m2 = again(m1, [p]);
    expect([m2.error, isCleared(m2.tables, 1), inStaffAndSub(m2.tables, 1)], 'the next run marks the person').toEqual([undefined, true, 0]);
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 One person\'s failure does not stop the others: the run ends in error, and everyone else is deleted and marked', () => {
    test.setTimeout(240_000);
    const one: Person = { n: 1 };
    const two: Person = { n: 2 };
    const chats = [...bothKeys(1), ...bothKeys(2)];
    for (const [name, order] of [['the first in the table fails', [one, two]], ['the second in the table fails', [two, one]]] as const) {
      const r = go([...order], chats, { stuck: [pk(A, sub(1))] }); // person 1 always fails; only the order of the rows changes
      expect(r.error, `${name}: the run ends in error`).toBeDefined();
      expect([isCleared(r.tables, 1), auditRows(r.tables).filter((x) => x['user_id'] === sub(1)).length], `${name}: the failed person is not marked and has no record`).toEqual([false, 0]);
      expect([inStaffAndSub(r.tables, 2), isCleared(r.tables, 2), auditRows(r.tables).filter((x) => x['user_id'] === sub(2)).length], `${name}: the other person is deleted, marked and recorded`).toEqual([0, true, 1]);
    }
    // The same when it is Cognito that fails for one person.
    for (const order of [[one, two], [two, one]]) {
      const r = go(order, chats, { failUsers: { AdminGetUser: [email(1)] }, failUsersMessage: 'COGNITO-MARK' });
      expect(r.error, 'Cognito fails for person 1: the run ends in error').toBeDefined();
      expect([inStaffAndSub(r.tables, 1) === inStaffAndSub(r.before, 1), isCleared(r.tables, 1)], 'person 1 is untouched').toEqual([true, false]);
      expect([inStaffAndSub(r.tables, 2), isCleared(r.tables, 2)], 'person 2 is done').toEqual([0, true]);
    }
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 The company comes from the stored row only: a row with no tenant_id belongs to the founding company, and with none set it is skipped', () => {
    test.setTimeout(240_000);
    // (a) the founding company is A.
    const old: Person = { n: 1, company: null }; // no tenant_id on the row
    const inB: Person = { n: 2, company: B };
    const inA: Person = { n: 3, company: A };
    const chats = [
      ...bothKeys(1), ...bothKeys(2, B), ...chatRows(A, staff(2), 1, { tag: 'A-TWIN-OF-2' }), ...bothKeys(3), ...chatRows(B, staff(3), 1, { tag: 'B-TWIN-OF-3' }),
    ];
    const a = go([old, inB, inA], chats, { env: { LEGACY_TENANT_ID: A } });
    expect(a.error, `the run finishes (${WHAT(a)})`).toBeUndefined();
    expect(inStaffAndSub(a.tables, 1, A), 'the row with no tenant_id: its chats are deleted under the founding company').toBe(0);
    expect(inStaffAndSub(a.tables, 2, B), 'a row of company B: deleted under company B').toBe(0);
    expect(chatsOf(a.tables, A, staff(2)).length, 'company A\'s chats under the same staff id are not touched').toBe(rowCount(1));
    expect(inStaffAndSub(a.tables, 3, A), 'a row of company A: deleted under company A').toBe(0);
    expect(chatsOf(a.tables, B, staff(3)).length, 'company B\'s chats under the same staff id are not touched').toBe(rowCount(1));
    const rows = auditRows(a.tables);
    expect(rows.map((x) => [x['user_id'], x['tenant_id']]).sort(), 'each record names the company the job used').toEqual([[sub(1), A], [sub(2), B], [sub(3), A]].sort());
    expect(rows.every((x) => String(x['pk']).startsWith(`T#${x['tenant_id']}#S#`)), 'and its key starts with that company').toBe(true);

    // (b) no founding company set (the value Terraform gives when the variable is empty, or no value at all).
    for (const legacy of ['', undefined]) {
      const b = go([old, inB], [...bothKeys(1), ...bothKeys(2, B)], { env: { LEGACY_TENANT_ID: legacy } });
      expect(b.error, `LEGACY_TENANT_ID ${legacy === undefined ? 'unset' : 'empty'}: a skipped person is not a failure (${WHAT(b)})`).toBeUndefined();
      expect(inStaffAndSub(b.tables, 1, A), 'a row with no tenant_id: nothing is deleted').toBe(inStaffAndSub(b.before, 1, A));
      expect(isCleared(b.tables, 1), 'and it is not marked').toBe(false);
      expect(logLines(b.calls).some((l) => l.includes('LeaverCompanyUnknown')), 'a log line names LeaverCompanyUnknown').toBe(true);
      const queried = new Set(chatQueries(b.calls).map(queriedPk));
      expect(mine(1).some((k) => queried.has(k)), 'no chats Query for it').toBe(false);
      expect([inStaffAndSub(b.tables, 2, B), isCleared(b.tables, 2)], 'a row that names its company is still done').toEqual([0, true]);
    }
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Staff id not known: Cognito has no such person, so the row\'s userId alone is the key, and the record says so', () => {
    test.setTimeout(240_000);
    const gone: Person = { n: 1, inPool: false };
    const noStaff: Person = { n: 2, staffId: false }; // in the pool, with no staff id
    const normal: Person = { n: 3 };
    const chats = [...bothKeys(1), ...bothKeys(2), ...bothKeys(3)];
    const r = go([gone, noStaff, normal], chats);
    expect(r.error, `UserNotFound is not a failure (${WHAT(r)})`).toBeUndefined();
    expect(chatsOf(r.tables, A, sub(1)), 'no pool user: the chats under the row\'s userId are deleted').toEqual([]);
    expect(isCleared(r.tables, 1), 'and the person is marked').toBe(true);
    expect(chatsOf(r.tables, A, staff(1)).length, 'a staff id nobody told the job of is not guessed').toBe(chatsOf(r.before, A, staff(1)).length);
    const rec = (n: number) => auditRows(r.tables).find((x) => x['user_id'] === sub(n))!;
    expect([rec(1)['staff_id_unknown'], [...rec(1)['staff_keys']].sort()], 'record 1: staff_id_unknown true, only the sign-in id cleared').toEqual([true, ['sub']]);
    expect(chatsOf(r.tables, A, sub(2)), 'a pool user with no staff id: the sign-in id key is deleted').toEqual([]);
    expect([rec(2)['staff_id_unknown'], [...rec(2)['staff_keys']].sort()], 'record 2: staff_id_unknown false (Cognito knew the person), only the sign-in id cleared').toEqual([false, ['sub']]);
    expect(inStaffAndSub(r.tables, 3), 'the normal person: both keys are deleted').toBe(0);
    expect([rec(3)['staff_id_unknown'], [...rec(3)['staff_keys']].sort()], 'record 3: both cleared').toEqual([false, ['staff_id', 'sub']]);
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 The audit row holds exactly the listed fields and never a title, message, name or email; a leaver with no chats still gets one with rows_deleted 0', () => {
    test.setTimeout(240_000);
    const withChats: Person = { n: 1 };
    const empty: Person = { n: 2 };
    const inB: Person = { n: 3, company: B };
    const chats = [...chatRows(A, staff(1), 3, { messages: 2, tag: 'S1' }), ...chatRows(A, sub(1), 1, { messages: 2, tag: 'U1', first: 50 }), ...chatRows(B, staff(3), 1, { messages: 2, tag: 'S3b' })];
    const t0 = Date.now();
    const r = go([withChats, empty, inB], chats);
    expect(r.error, `the run finishes (${WHAT(r)})`).toBeUndefined();
    const FIELDS = ['action', 'deactivated_at', 'deactivated_by', 'expiresAt', 'pk', 'rows_deleted', 'sk', 'staff_id_unknown', 'staff_keys', 'tenant_id', 'user_id'];
    const row = (n: number) => auditRows(r.tables).find((x) => x['user_id'] === sub(n))!;
    for (const n of [1, 2, 3]) {
      const x = row(n);
      expect(Object.keys(x).sort(), `person ${n}: exactly the listed fields`).toEqual(FIELDS);
      expect(x['action'], 'action').toBe('LEAVER_CHATS_DELETED');
      expect(x['pk'], 'pk is T#<company>#S#<sub>').toBe(pk(n === 3 ? B : A, sub(n)));
      expect([x['tenant_id'], x['user_id'], x['deactivated_by']], 'tenant_id, user_id and deactivated_by').toEqual([n === 3 ? B : A, sub(n), ADMIN_SUB]);
      expect(x['deactivated_at'], 'deactivated_at is the row\'s own deactivatedAt').toBe(userOf(r.before, n)['deactivatedAt']);
      expect(isoOk(x['sk']), `sk is a time (${x['sk']})`).toBe(true);
      expect(Date.parse(x['sk']), 'the time of this run').toBeGreaterThanOrEqual(t0 - 5_000);
      expect(Date.parse(x['sk'])).toBeLessThanOrEqual(Date.now() + 5_000);
      expect(typeof x['expiresAt'], 'expiresAt is a number (seconds, as the other audit rows)').toBe('number');
      expect(Math.abs(x['expiresAt'] - (Math.floor(Date.now() / 1000) + 90 * 24 * 3600)), 'and it is 90 days from now (Q-2)').toBeLessThan(3600);
      expect(typeof x['staff_id_unknown'], 'staff_id_unknown is a boolean').toBe('boolean');
      const text = JSON.stringify(x);
      for (const w of FORBIDDEN_WORDS(n)) expect(text, `the record holds no "${w}"`).not.toContain(w);
    }
    expect(row(1)['rows_deleted'], 'rows_deleted counts every row removed: 3 chats of 2 messages under the staff id and 1 under the sign-in id').toBe(rowCount(3) + rowCount(1));
    expect(row(2)['rows_deleted'], 'a leaver with no chats: rows_deleted 0 is written too').toBe(0);
    expect(row(3)['rows_deleted'], 'company B\'s leaver: its own rows').toBe(rowCount(1));
    expect(auditRows(r.tables), 'three records for three people').toHaveLength(3);
    // The other audit rows were already there and stay.
    expect(rowsOf(r.tables, AUDIT).filter((x) => (x['action'] as any).S === 'CHAT_DELETED'), 'an earlier delete record is as it was').toHaveLength(1);
  });

  // ---------------------------------------------------------------- AC-10

  test('AC-10 Logs hold counts and error names only: whatever AWS call fails, no log line, error or answer carries the AWS words, an email, a staff id or a sign-in id', () => {
    test.setTimeout(240_000);
    const p: Person = { n: 1 };
    const chats = [...chatRows(A, staff(1), 2, { messages: 6, tag: 'S1' }), ...chatRows(A, sub(1), 1, { messages: 2, tag: 'U1', first: 50 })];
    const MARK = 'AWSWORDS-MARK-7731';
    const hidden = (r: Run, where: string) => {
      const text = blob(r);
      for (const w of [MARK, email(1), staff(1), sub(1), given(1), family(1), 'TITLE-MARK', 'TEXT-MARK', ...mine(1)]) expect(text, `${where}: nothing carries "${w}"`).not.toContain(w);
    };
    const ok = go([p], chats);
    expect(ok.error, `a run with no fault finishes (${WHAT(ok)})`).toBeUndefined();
    hidden(ok, 'a run with no fault');
    const FAULTS: [string, Parameters<typeof go>[2]][] = [
      ['Scan of the people table', { fail: { service: 'dynamodb', ops: ['Scan'], message: MARK, name: 'ThrottlingException' } }],
      ['AdminGetUser', { fail: { service: 'cognito', ops: ['AdminGetUser'], message: MARK, name: 'TooManyRequestsException' } }],
      ['Query of the chats table', { fail: { service: 'dynamodb', ops: ['Query'], message: MARK, name: 'ProvisionedThroughputExceededException' } }],
      ['BatchWriteItem', { fail: { service: 'dynamodb', ops: ['BatchWriteItem'], message: MARK, name: 'InternalServerError' } }],
      ['PutItem of the audit row', { fail: { service: 'dynamodb', ops: ['PutItem'], message: MARK, name: 'ValidationException' } }],
      ['UpdateItem of the person', { fail: { service: 'dynamodb', ops: ['UpdateItem'], message: MARK, name: 'ThrottlingException' } }],
    ];
    for (const [what, o] of FAULTS) {
      const r = go([p], chats, o);
      expect(r.error, `${what} fails: the run ends in error`).toBeDefined();
      hidden(r, what);
      expect(logLines(r.calls).some((l) => l.includes((o as any).fail.name)), `${what}: the log names the error (${(o as any).fail.name})`).toBe(true);
    }
    // A person Cognito fails for, with the AWS words in the error, and one more person who works.
    const two = go([p, { n: 2 }], [...chats, ...bothKeys(2)], { failUsers: { AdminGetUser: [email(1)] }, failUsersMessage: MARK });
    hidden(two, 'a failed person next to a good one');
    expect(isCleared(two.tables, 2), 'the good one is done').toBe(true);
  });

  // ---------------------------------------------------------------- AC-11

  test('AC-11 Limits: 250 leavers waiting are done 200 a run, the rest the next run', () => {
    test.setTimeout(300_000);
    const people: Person[] = Array.from({ length: 250 }, (_v, i) => ({ n: 100 + i }));
    const chats = people.flatMap((p) => chatRows(A, staff(p.n), 1, { messages: 2, tag: `P${p.n}` }));
    const r1 = go(people, chats);
    expect(r1.error, `the first run finishes (${WHAT(r1)})`).toBeUndefined();
    const done = (t: Run['tables']) => people.filter((p) => isCleared(t, p.n)).map((p) => p.n);
    expect(done(r1.tables), 'exactly 200 people are marked in the first run').toHaveLength(200);
    expect(auditRows(r1.tables), 'with 200 records').toHaveLength(200);
    for (const p of people) {
      const left = chatsOf(r1.tables, A, staff(p.n)).length;
      expect(left, `person ${p.n}: marked means deleted, unmarked means untouched`).toBe(isCleared(r1.tables, p.n) ? 0 : rowCount(1));
    }
    const r2 = again(r1, people);
    expect(r2.error, `the second run finishes (${WHAT(r2)})`).toBeUndefined();
    expect(done(r2.tables), 'the second run does the other 50').toHaveLength(250);
    expect(auditRows(r2.tables), '250 records in all, none twice').toHaveLength(250);
    expect(new Set(auditRows(r2.tables).map((x) => x['user_id'])).size).toBe(250);
    expect(cognitoCalls(r2.calls), 'and asks Cognito only about the 50 that were left').toHaveLength(50);
  });

  test('AC-11 Limits: a person who is skipped (sign-in still enabled, company unknown) does not use one of the 200 places', () => {
    test.setTimeout(300_000);
    const enabled: Person[] = Array.from({ length: 70 }, (_v, i) => ({ n: 100 + i, enabled: true }));
    const unknown: Person[] = Array.from({ length: 50 }, (_v, i) => ({ n: 200 + i, company: null }));
    const real: Person[] = Array.from({ length: 210 }, (_v, i) => ({ n: 300 + i }));
    const people = [...enabled, ...unknown, ...real];
    const chats = people.flatMap((p) => chatRows(A, staff(p.n), 1, { messages: 2, tag: `P${p.n}` }));
    const r1 = go(people, chats, { env: { LEGACY_TENANT_ID: '' } });
    expect(r1.error, `the first run finishes, skipping is not a failure (${WHAT(r1)})`).toBeUndefined();
    const done = (t: Run['tables'], list: Person[]) => list.filter((p) => isCleared(t, p.n)).map((p) => p.n);
    expect(done(r1.tables, real), 'exactly 200 of the 210 real leavers are done: the 120 skipped people used no place').toHaveLength(200);
    expect(done(r1.tables, [...enabled, ...unknown]), 'no skipped person is marked').toHaveLength(0);
    expect(auditRows(r1.tables), 'with 200 records').toHaveLength(200);
    for (const p of [...enabled, ...unknown]) expect(chatsOf(r1.tables, A, staff(p.n)).length, `skipped person ${p.n} keeps every chat`).toBe(rowCount(1));
  });

  test('AC-11 Time: with less than 30 seconds left the run starts no new person, with 30 seconds it does', () => {
    test.setTimeout(240_000);
    const people: Person[] = [{ n: 1 }, { n: 2 }, { n: 3 }];
    const chats = people.flatMap((p) => bothKeys(p.n));
    const count = (r: Run) => people.filter((p) => isCleared(r.tables, p.n)).length;
    const none = go(people, chats, { remaining: [29_999] });
    expect(none.error, `29,999 ms left: not an error, the rest wait (${WHAT(none)})`).toBeUndefined();
    expect([count(none), writesOf(none.calls)], '29,999 ms left: no person is started, nothing is written').toEqual([0, []]);
    const all = go(people, chats, { remaining: [30_000] });
    expect([all.error, count(all)], '30,000 ms left: everyone is done').toEqual([undefined, 3]);
    const part = go(people, chats, { remaining: [200_000, 29_999] });
    expect(part.error, `time runs low after the first person (${WHAT(part)})`).toBeUndefined();
    expect(count(part), 'exactly one person is done, then the run stops').toBe(1);
    expect(auditRows(part.tables), 'with one record').toHaveLength(1);
    const next = again(part, people);
    expect(count(next), 'the next run does the rest').toBe(3);
  });

  // ---------------------------------------------------------------- AC-12 Terraform

  test('AC-12 The new role holds exactly the listed actions on exactly the listed resources, and nothing is a wildcard but X-Ray', () => {
    expect(roleBlocks().map((r) => r.stack), `one role named ${ROLE_NAME}, in talent-flow-infra`).toEqual([TF]);
    const role = roleBlock();
    const a = attributes(role.body);
    expect([unquote(a.get('path')), a.get('assume_role_policy')], 'path /talent-flow/ and the same assume-role policy as every TalentFlow role').toEqual(['/talent-flow/', 'local.tf_lambda_assume_role_policy']);
    const fn = lambdaLabel();
    const lambdaName = FUNCTION_NAME;
    const expected = [
      `Allow logs:CreateLogGroup arn:aws:logs:af-south-1:000000000000:log-group:/aws/lambda/${lambdaName}:* null`,
      `Allow logs:CreateLogStream arn:aws:logs:af-south-1:000000000000:log-group:/aws/lambda/${lambdaName}:* null`,
      `Allow logs:PutLogEvents arn:aws:logs:af-south-1:000000000000:log-group:/aws/lambda/${lambdaName}:* null`,
      'Allow xray:PutTraceSegments * null',
      'Allow xray:PutTelemetryRecords * null',
      'Allow dynamodb:Scan arn:aws:dynamodb:af-south-1:000000000000:table/talent-flow-users null',
      'Allow dynamodb:UpdateItem arn:aws:dynamodb:af-south-1:000000000000:table/talent-flow-users null',
      'Allow cognito-idp:AdminGetUser arn:aws:cognito-idp:af-south-1:000000000000:userpool/<POOL> null',
      'Allow dynamodb:Query arn:aws:dynamodb:af-south-1:000000000000:table/ask-batsi-chats null',
      'Allow dynamodb:BatchWriteItem arn:aws:dynamodb:af-south-1:000000000000:table/ask-batsi-chats null',
      'Allow dynamodb:PutItem arn:aws:dynamodb:af-south-1:000000000000:table/naleko-agent-audit null',
      ...['kms:Decrypt', 'kms:GenerateDataKey', 'kms:GenerateDataKeyWithoutPlaintext', 'kms:DescribeKey'].map((k) => `Allow ${k} aws_kms_key.talent_flow_state.arn null`),
    ].sort();
    const got = linesOfRole(roleLabel());
    expect(got.filter((l) => !expected.includes(l)), 'no line beyond the listed ones').toEqual([]);
    expect(expected.filter((l) => !got.includes(l)), 'every listed line is there').toEqual([]);
    expect(got.filter((l) => l.split(' ')[2] === '*').every((l) => l.includes('xray:')), 'a * resource only for X-Ray').toBe(true);
    expect(got.filter((l) => /:\*(\s|$)|\*$/.test(l.split(' ')[1]!)), 'no action ends in *').toEqual([]);
    expect(got.every((l) => l.startsWith('Allow ')), 'only Allow statements').toBe(true);
    // The role has its policy and nothing else: no attached managed policy, no second policy resource that names a table.
    const attached = policyResourcesOf(roleLabel());
    expect(attached.every((x) => x.type === 'aws_iam_role_policy'), `only inline policy resources name the role (${JSON.stringify(attached)})`).toBe(true);
    // The KMS statement is the same as adminDeactivateUser's on the same key.
    const mineKms = got.filter((l) => l.includes('talent_flow_state'));
    const theirs = linesOfRole('admin_deactivate_user').filter((l) => l.includes('talent_flow_state'));
    expect(mineKms, 'the TalentFlow state key actions are the ones adminDeactivateUser has on it').toEqual(theirs);
    expect(fn.length, 'the function exists').toBeGreaterThan(0);
  });

  test('AC-12 The function: Node 22, index.handler, timeout 300, no reserved concurrency, its five settings, its own role, only in talent-flow-infra', () => {
    expect(lambdaBlocks().length, `one function named ${FUNCTION_NAME}`).toBe(1);
    expect(STACKS.flatMap((s) => resourcesOf(s, 'aws_lambda_function').filter((b) => valueOf(s, attributes(b.body).get('function_name')) === FUNCTION_NAME).map(() => s)), 'in talent-flow-infra').toEqual([TF]);
    const fn = lambdaBlock();
    const a = attributes(fn.body);
    expect([unquote(a.get('runtime')), unquote(a.get('handler')), a.get('timeout')], 'nodejs22.x, index.handler, timeout 300').toEqual(['nodejs22.x', 'index.handler', '300']);
    expect(a.get('role'), 'it runs as the new role').toBe(`aws_iam_role.${roleLabel()}.arn`);
    expect(a.has('reserved_concurrent_executions'), 'no reserved concurrency (the dev account allows 10 in all)').toBe(false);
    const s = settings();
    expect([...s.keys()].filter((k) => k !== 'ENVIRONMENT').sort(), 'the five settings of the card').toEqual(['AGENT_AUDIT_TABLE', 'CHATS_TABLE', 'COGNITO_POOL_ID', 'LEGACY_TENANT_ID', 'USERS_TABLE_NAME']);
    expect(resolve(valueOf(TF, s.get('USERS_TABLE_NAME'))), 'USERS_TABLE_NAME is the people table').toBe('talent-flow-users');
    expect(valueOf(TF, s.get('CHATS_TABLE')), 'CHATS_TABLE is ask-batsi-chats').toBe('ask-batsi-chats');
    expect(valueOf(TF, s.get('AGENT_AUDIT_TABLE')), 'AGENT_AUDIT_TABLE is naleko-agent-audit').toBe('naleko-agent-audit');
    expect(s.get('COGNITO_POOL_ID'), 'COGNITO_POOL_ID is the same pool as adminDeactivateUser uses').toBe(settingsOf(resourcesOf(TF, 'aws_lambda_function').find((b) => b.labels[1] === 'admin_deactivate_user')!).get('COGNITO_POOL_ID'));
    expect(s.get('LEGACY_TENANT_ID'), 'LEGACY_TENANT_ID is the variable the stack already has').toBe('var.legacy_tenant_id');
    expect(squash(fn.raw), 'the Lambda is not given a URL or another trigger in this block').not.toContain('function_url');
    expect(blocks(STACKS.flatMap((x) => filesOf(x)), 'resource').filter((b) => b.labels[0] === 'aws_lambda_function_url' && b.raw.includes(lambdaLabel())), 'and no function URL anywhere').toEqual([]);
  });

  test('AC-12 The rule runs every hour on the default bus, its state comes from a variable, with one target and one permission for events.amazonaws.com', () => {
    const rules = resourcesOf(TF, 'aws_cloudwatch_event_rule').filter((b) => valueOf(TF, attributes(b.body).get('name')) === RULE_NAME);
    expect(rules, `one rule named ${RULE_NAME}`).toHaveLength(1);
    const rule = rules[0]!;
    const ra = attributes(rule.body);
    expect(unquote(ra.get('schedule_expression')), 'rate(1 hour)').toBe('rate(1hour)');
    expect(ra.has('event_bus_name'), 'on the default bus (a schedule cannot use another)').toBe(false);
    const state = /^var\.(\w+)\?"ENABLED":"DISABLED"$/.exec(ra.get('state') ?? '');
    expect(state, `state comes from a variable (${ra.get('state')})`).not.toBeNull();
    const variable = blocks(filesOf(TF), 'variable').filter((b) => b.labels[0] === state![1]);
    expect(variable, `the variable ${state![1]} is declared in talent-flow-infra`).toHaveLength(1);
    const va = attributes(variable[0]!.body);
    expect([va.get('type'), va.get('default')], 'a bool that defaults to false').toEqual(['bool', 'false']);
    const tfvars = (f: string) => new RegExp(`^\\s*${state![1]}\\s*=\\s*([^\\s#]+)`, 'm').exec(stripComments(readFileSync(join(REPO, 'talent-flow-infra', 'env', f), 'utf8')))?.[1];
    expect(tfvars('dev.tfvars'), 'dev switches it on').toBe('true');
    for (const f of readdirSync(join(REPO, 'talent-flow-infra', 'env')).filter((x) => x.endsWith('.tfvars') && x !== 'dev.tfvars')) expect(tfvars(f), `${f} leaves it off`).not.toBe('true');
    const targets = resourcesOf(TF, 'aws_cloudwatch_event_target').filter((b) => new RegExp(`^aws_cloudwatch_event_rule\\.${rule.labels[1]}\\.(name|id)$`).test(attributes(b.body).get('rule') ?? ''));
    expect(targets, 'one target on the rule').toHaveLength(1);
    expect(attributes(targets[0]!.body).get('arn'), 'it is the function').toBe(`aws_lambda_function.${lambdaLabel()}.arn`);
    const perms = resourcesOf(TF, 'aws_lambda_permission').filter((b) => b.raw.includes(`aws_lambda_function.${lambdaLabel()}.`));
    expect(perms, 'one permission for the function').toHaveLength(1);
    const pa = attributes(perms[0]!.body);
    expect([unquote(pa.get('principal')), unquote(pa.get('action')), pa.get('source_arn')], 'events.amazonaws.com may invoke it, from this rule only').toEqual(['events.amazonaws.com', 'lambda:InvokeFunction', `aws_cloudwatch_event_rule.${rule.labels[1]}.arn`]);
  });

  test('AC-12 The role is added once to the PII key\'s read list and not to its encrypt list; nothing else in either list moves', () => {
    const base = JSON.parse(readFileSync(join(BASELINE, 'kms-lists.ccc2beb-419.json'), 'utf8')) as { allowed: string[]; readers: string[] };
    const now = kmsLists();
    const arn = squash(`"${ROLE_ARN}"`);
    expect(now.readers.filter((e) => e === arn), 'the role\'s ARN is in dynamodb_read_role_arns once').toHaveLength(1);
    expect(now.allowed.filter((e) => e.includes('deleteLeaverChats')), 'and not in allowed_role_arns').toEqual([]);
    // Child lock chat-15.3 (REC-02): the recordNotHired role (TalentFlow stack) may also be on the read list, at most once. Nothing else may be added.
    const rec02 = squash('"arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-recordNotHired"');
    expect(now.readers.filter((e) => e === rec02).length, 'the REC-02 role is on the read list at most once').toBeLessThanOrEqual(1);
    // Child lock rec-04.1 (REC-04): the manageRoles role likewise, at most once (it is added one merge after the role exists).
    const rec04 = squash('"arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-manageRoles"');
    expect(now.readers.filter((e) => e === rec04).length, 'the REC-04 role is on the read list at most once').toBeLessThanOrEqual(1);
    // Child lock rec-14.1 (REC-14): the manageDepartments role likewise, at most once (rec-14.spec.ts AC-3 pins it exactly once).
    const rec14 = squash('aws_iam_role.manage_departments.arn');
    expect(now.readers.filter((e) => e === rec14).length, 'the REC-14 role is on the read list at most once').toBeLessThanOrEqual(1);
    // Child lock ten-02.12 (REC-05 key follow-up): manageOffers and the hourly offer expiry (monitorTalentFlowSLAs) may each be on the read list at most once,
    // and manageOffers on the encrypt list at most once (it signs uploads into the bucket this key encrypts). rec-05-kms.spec.ts pins them exactly.
    const rec05 = [squash(MANAGE_OFFERS_ARN), squash(MONITOR_SLAS_ARN)];
    for (const r of rec05) expect(now.readers.filter((e) => e === r).length, `${r} is on the read list at most once`).toBeLessThanOrEqual(1);
    expect(now.allowed.filter((e) => e === rec05[0]).length, 'the manageOffers role is on the encrypt list at most once').toBeLessThanOrEqual(1);
    expect([...now.readers].filter((e) => e !== rec02 && e !== rec04 && e !== rec14 && !rec05.includes(e)).sort(), 'every other entry of the read list is as on develop').toEqual([...base.readers, arn].sort());
    expect(withoutOnce(now.allowed, rec05[0]!), 'the encrypt list is as on develop').toEqual(base.allowed);
    expect(squash(read('infra/kms.tf')).split(arn).length - 1, 'the ARN appears once in kms.tf').toBe(1);
  });

  test('AC-12 Add only: no resource removed or renamed, only the new ones added, no moved or removed block, no table data, adminDeactivateUser untouched byte for byte', () => {
    const base = JSON.parse(readFileSync(join(BASELINE, 'terraform.ccc2beb-419.json'), 'utf8')) as { resources: string[]; moved: string[]; adminDeactivateUser: { role: string; policy: string; lambda: string; files: Record<string, string> } };
    const now = allAddresses();
    // Child lock chat-15.5 (NH-282, PR 529): the old interview booking rule, its target and its permission were removed from
    // talent-flow-infra on purpose (Iggie approved the deletes; applied on pepla-dev 26 Nov). Exactly these three may be gone. Any other missing resource still fails.
    const REMOVED_NH282 = [
      'talent-flow-infra/aws_cloudwatch_event_rule.interview_scheduled',
      'talent-flow-infra/aws_cloudwatch_event_target.interview_scheduled',
      'talent-flow-infra/aws_lambda_permission.schedule_interview_eventbridge',
    ];
    expect(base.resources.filter((x) => !now.includes(x) && !REMOVED_NH282.includes(x)), 'every resource of develop is still there under its own name').toEqual([]);
    // REC-02 (re-lock rec-02.1): the Not hired Lambda and its role, routes and permission are added later under the name record_not_hired*;
    // rec-02.spec.ts AC-11 judges them, so they are left out here.
    // REC-04 (re-lock rec-04.1): the roles Lambda (manage_roles*) and the roles table (talent_flow_roles) likewise, judged in rec-04.spec.ts AC-8.
    const added = now.filter((x) => !base.resources.includes(x) && !/\.record_not_hired(_[a-z_]+)?$/.test(x) && !/\.manage_roles(_[a-z_]+)?$/.test(x) && !/\/aws_dynamodb_table\.talent_flow_roles$/.test(x)
      // REC-14 (child lock rec-14.1): the departments Lambda (manage_departments*) and its three routes, judged in rec-14.spec.ts AC-3.
      && !/\.(manage_departments(_[a-z_]+)?|list_departments|add_department|change_department)$/.test(x)
      // REC-07 (child lock rec-07.2): the four scoring routes: talent-flow-infra only, routes only, only these names; judged in rec-07.spec.ts.
      // REC-UI-03 step 3 (child lock chat-15.6): one more route on the same Lambda, get_interview; judged in rec-ui-03-read.spec.ts AC-3.6.
      && !/^talent-flow-infra\/aws_apigatewayv2_route\.(get_candidate_scores|get_scoring_link|post_interview_votes|post_scoring_link|get_interview)$/.test(x)
      // REC-05 (child lock rec-05.1): manageOffers and its role, policy, log group, integration, routes and permission (manage_offers*), judged in rec-05.spec.ts AC-10 and AC-15.
      && !isRec05Resource(x)
      // REC-16 (child lock chat-15.4): the hiring manager IT email Lambda and its role, policy, log group, rule, target and permission, all
      // labelled notify_hiring_manager_on_hire in infra/; judged in rec-16.spec.ts AC-10 and AC-8. Any other new resource still fails here.
      && !/^infra\/(aws_lambda_function|aws_iam_role|aws_iam_role_policy|aws_cloudwatch_log_group|aws_cloudwatch_event_rule|aws_cloudwatch_event_target|aws_lambda_permission)\.notify_hiring_manager_on_hire$/.test(x));
    expect(added.filter((x) => x.startsWith(`${TF}/aws_lambda_function.`)).length, 'the job\'s function is added (a branch that adds nothing is not add-only, it is missing)').toBe(1);
    expect(added.filter((x) => x.startsWith(`${TF}/aws_iam_role.`)).length, 'the job\'s role is added').toBe(1);
    const ALLOWED = ['aws_lambda_function', 'aws_iam_role', 'aws_iam_role_policy', 'aws_cloudwatch_event_rule', 'aws_cloudwatch_event_target', 'aws_lambda_permission', 'aws_cloudwatch_log_group'];
    expect(added.filter((x) => !ALLOWED.includes(x.split('/')[1]!.split('.')[0]!)), `only a function, its role and policy, its rule, target and permission are added (added: ${added.join(', ')})`).toEqual([]);
    expect(added.every((x) => x.startsWith(`${TF}/`)), 'all of them in talent-flow-infra').toBe(true);
    const moves = STACKS.flatMap((s) => ['moved', 'removed'].flatMap((k) => blocks(filesOf(s), k).map((b) => `${s}/${k}:${sha(squash(b.raw))}`))).sort();
    expect(moves, 'no moved or removed block is added, changed or dropped (the ones develop has stay as they are)').toEqual(base.moved);
    for (const stack of STACKS) expect(resourcesOf(stack, 'aws_dynamodb_table_item'), `${stack}: no table data in Terraform (LESSONS 16 Nov)`).toEqual([]);
    expect(resourceHash(TF, 'aws_iam_role', 'admin_deactivate_user'), 'adminDeactivateUser\'s role is as on develop').toBe(base.adminDeactivateUser.role);
    expect(resourceHash(TF, 'aws_iam_role_policy', 'admin_deactivate_user'), 'its policy is as on develop').toBe(base.adminDeactivateUser.policy);
    expect(resourceHash(TF, 'aws_lambda_function', 'admin_deactivate_user'), 'its function block is as on develop').toBe(base.adminDeactivateUser.lambda);
    expect(dirHashes('lambda/adminDeactivateUser'), 'every file of lambda/adminDeactivateUser is byte for byte as on develop').toEqual(base.adminDeactivateUser.files);
  });

  test('AC-12 A run with any failure ends in a Lambda error, and the function is on the existing Lambda error alarm (P-9)', () => {
    const m = blocks([join(REPO, 'infra', 'alarms.tf')], 'module')[0]!;
    const names = [...(/lambda_names\s*=\s*\[([\s\S]*?)\]/.exec(m.body)?.[1] ?? '').matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(names, 'alarms.tf lists deleteLeaverChats in lambda_names (as ONB-21 listed sendDocumentReminders)').toContain(FUNCTION_NAME);
    const before = JSON.parse(readFileSync(join(BASELINE, 'alarm-lambda-names.ccc2beb-419.json'), 'utf8')) as string[];
    // REC-14 (child lock rec-14.1): manageDepartments joins the same list; rec-14.spec.ts AC-3 judges it.
    // REC-16 (child lock chat-15.4): notifyHiringManagerOnHire may join the same list (REC-16 L-5); nothing else may.
    expect(names.filter((n) => !before.includes(n!) && n !== 'manageDepartments' && n !== 'notifyHiringManagerOnHire'), 'it is the only name added').toEqual([FUNCTION_NAME]);
    expect(before.filter((n) => !names.includes(n)), 'and none is dropped').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-13

  test('AC-13 No AI: the job imports no model client, and calls nothing but the people, chats and audit tables and Cognito; the AI guardrail file is unchanged', () => {
    test.setTimeout(120_000);
    const AI = /bedrock|textract|anthropic|openai|comprehend|rekognition|sagemaker/i;
    expect(existsSync(HANDLER), 'the Lambda exists').toBe(true);
    // Every file the handler reaches by a relative import, and every package it names.
    const seen = new Set<string>();
    const queue = [HANDLER];
    const packages = new Set<string>();
    while (queue.length) {
      const f = queue.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
        const spec = m[1]!;
        if (spec.startsWith('.')) {
          const target = join(f, '..', spec);
          if (existsSync(target)) queue.push(target);
        } else packages.add(spec);
      }
    }
    expect([...packages].filter((p) => AI.test(p)), 'no package with a model client in its name').toEqual([]);
    expect([...seen].filter((f) => AI.test(f.replace(REPO, ''))), 'and no file of that kind is reached').toEqual([]);
    for (const f of seen) expect(readFileSync(f, 'utf8'), `${f.replace(REPO, '')} has no model client`).not.toMatch(/InvokeModel|BedrockRuntime|bedrock-runtime|textract/i);
    const pkg = join(LAMBDA, 'deleteLeaverChats', 'package.json');
    if (existsSync(pkg)) expect(Object.keys({ ...(JSON.parse(readFileSync(pkg, 'utf8')).dependencies ?? {}) }).filter((d) => AI.test(d)), 'package.json names no model client').toEqual([]);
    const r = go([{ n: 1 }], bothKeys(1));
    expect(r.error, `a run finishes (${WHAT(r)})`).toBeUndefined();
    const services = new Set(r.calls.map((c: Call) => c.service));
    expect([...services].filter((s) => !['dynamodb', 'cognito', 'log'].includes(s)), 'it calls DynamoDB and Cognito and nothing else').toEqual([]);
    expect(new Set(r.calls.filter((c) => c.service === 'dynamodb').map((c: any) => c.table)), 'and only these three tables').toEqual(new Set([USERS, CHATS, AUDIT]));
    expect(read('infra/ai_guardrail.tf'), 'infra/ai_guardrail.tf is byte for byte the file on develop (ccc2beb-419)').toBe(readFileSync(join(BASELINE, 'ai_guardrail.ccc2beb-419.tf.txt'), 'utf8'));
  });

  // ---------------------------------------------------------------- AC-14

  test('AC-14 A missing setting stops the job at start with one clear line, before any AWS call (BE-15); an empty LEGACY_TENANT_ID is a valid setting', () => {
    test.setTimeout(240_000);
    const people: Person[] = [{ n: 1 }];
    for (const name of ['USERS_TABLE_NAME', 'COGNITO_POOL_ID', 'CHATS_TABLE', 'AGENT_AUDIT_TABLE']) {
      for (const value of [undefined, ''] as const) {
        const r = go(people, bothKeys(1), { env: { [name]: value } });
        expect(r.error?.message ?? 'it did not stop', `${name} ${value === undefined ? 'unset' : 'empty'}: stops with "Missing setting ${name}"`).toContain(`Missing setting ${name}`);
        expect(awsCalls(r.calls), `${name}: no AWS call was made`).toEqual([]);
        expect(rowsOf(r.tables, CHATS).length, 'and nothing was deleted').toBe(rowsOf(r.before, CHATS).length);
      }
    }
    const ok = go(people, bothKeys(1), { env: { LEGACY_TENANT_ID: '' } });
    expect(ok.error, `an empty LEGACY_TENANT_ID: the run works (${WHAT(ok)})`).toBeUndefined();
  });

  // ---------------------------------------------------------------- AC-15

  test('AC-15 Nothing in the call decides whose chats go: an event naming another company, person or key changes nothing, and an empty event works', () => {
    test.setTimeout(240_000);
    const leaver: Person = { n: 1 };
    const colleague: Person = { n: 2, status: 'ACTIVE', minutes: null };
    const twin: Person = { n: 3, company: B, status: 'ACTIVE', minutes: null, staffId: staff(1) };
    const chats = [...bothKeys(1), ...bothKeys(2), ...chatRows(B, staff(1), 2, { tag: 'TWIN' })];
    const FORGED = {
      version: '0', 'detail-type': 'Scheduled Event', source: 'aws.events', resources: [],
      tenant_id: B, tenantId: B, company: B, userId: sub(2), staffId: staff(2), staff_id: staff(2), pk: pk(A, staff(2)), headers: { 'x-tenant-id': B },
      queryStringParameters: { tenant_id: B, userId: sub(2) }, body: JSON.stringify({ tenant_id: B, userId: sub(2) }),
      requestContext: { authorizer: { jwt: { claims: { tenant_id: B, sub: sub(2) } } } }, detail: { tenant_id: B, userId: sub(2), staff_id: staff(2) },
    };
    for (const [name, event] of [['an event that names company B and person 2', FORGED], ['an empty event', {}]] as const) {
      const r = go([leaver, colleague, twin], chats, { event });
      expect(r.error, `${name}: the run finishes (${WHAT(r)})`).toBeUndefined();
      expect(inStaffAndSub(r.tables, 1), `${name}: the leaver is deleted`).toBe(0);
      expect(inStaffAndSub(r.tables, 2), `${name}: the colleague named in the event keeps every chat`).toBe(inStaffAndSub(r.before, 2));
      expect(chatsOf(r.tables, B, staff(1)).length, `${name}: company B's twin keeps theirs`).toBe(rowCount(2));
      expect(auditRows(r.tables).map((x) => [x['user_id'], x['tenant_id']]), `${name}: one record, for the leaver, in company A`).toEqual([[sub(1), A]]);
    }
  });
});
