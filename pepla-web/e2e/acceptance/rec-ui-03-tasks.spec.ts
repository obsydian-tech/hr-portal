import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO } from './support/rec-14/lambda-harness';
import { answerSchema, checker, operation, readDoc, type Doc } from './support/rec-14/schema';
import { attributes, blocks } from './support/infra-harness';
import { filesOf, policyLines } from './support/rec-02/iam';
import { candidateRow } from './support/rec-15/world';
import { withNewVersion } from './support/rec-15c/world';
import { withFeedbackHours } from './support/rec-15d/world';
import { R } from './support/rec-04/roles';
import {
  H, K as K01, NEVER, P, REC_U, ROUTE, SUB, TABLE, W, act, av, awsOf, bodyOf, book, describe, guestVote, hashOf, interviewRow, ivOf, logsOf, oldVoteRow,
  call, read, secondOf, statusOf, token, vote, voteBody, voteRow, withIv, withRows, type Caller, type IvSpec, type Req, type Run, type Tables,
} from './support/int-01/world';
import { fires, withHooks } from './support/int-01f/world';
import {
  A, B, INDEX_NAMES, K, NOW, ROUTE_DUE, ROW_FIELDS, BACKFILL, DEV_IDS_FILE, devIdsAll, due, dueOf, duePk, dueRow, dueRows, dueSk, dueStates, dueWrites, listPks, namesIn,
  plain, rowsOf, runBackfill, world, type DevIds, type PyRun,
} from './support/rec-ui-03-tasks/world';

/**
 * REC-UI-03 server · The list of feedback a person owes (G-10b), GET /v1/feedback-due (red). Jira NH-293. Spec:
 * /mnt/project-files/onboarding-cards/specs/REC-UI-03-feedback-due.md (rules 1 to 7, AC-1 to AC-14, D-293.1 to 12), checked in two rounds
 * (REC-UI-03-feedback-due-spec-check.md and -round2.md, notes N-1 to N-4). Review page:
 * /mnt/project-files/onboarding-cards/specs/REC-UI-03-tasks-tests-for-review.md (the bar). Card notes: cards/rec-ui-03-tasks.md.
 *
 * The Lambda tests run the real handlers (scheduleInterview for the booking and the four actions and the interviews read; submitVote for
 * the vote and the new list; submitVoteByToken for the guest vote) in a fresh Node process each call, against REC-14's fake AWS, over
 * INT-01's world (support/int-01/world.ts, unchanged) at INT-01's fixed time NOW, with INT-01's race preload and INT-01.F's hooks where a
 * test needs two requests at once or a row changed between a read and a write. The backfill script runs against an in-memory DynamoDB
 * (support/rec-ui-03-tasks/fake-boto3). Terraform, the API file and the seed are read as text. Nothing calls AWS or any AI. Nothing here
 * has a screen width: each no-backend test runs once, at 1280. AC-13 runs on pepla-dev only, after merge.
 *
 * Pinned by the test writer where the spec is silent (each is in cards/rec-ui-03-tasks.md):
 *  - D-T-1 updated_at is the request's own time (Date.now() of the run, ISO); OPEN rows carry no done_reason.
 *  - D-T-2 "In the same transaction" means: every feedback-due write of a request is an item of the one TransactWriteItems call that
 *    also writes the interview row (booking, the four actions) or the VOTE# row (the vote); no other call writes a feedback-due row.
 *  - D-T-3 A refused request (any 4xx, or a transaction that is cancelled) leaves every feedback-due row exactly as it was.
 *  - D-T-4 The read's answer for a caller with no person id in the sign-in is requireTenant's and requireModule's checks first, then
 *    403 {"error":"Forbidden"} with no read of the state table.
 *  - D-T-5 The backfill's command line: `python3 scripts/tenancy/backfill-feedback-due.py --table <name> [--profile <name>]
 *    [--region <name>] [--apply]`. With no --table it exits non-zero and makes no AWS call. It writes with put_item only, using string
 *    expressions (client or Table resource), never update_item, delete_item, a batch or a transaction.
 *  - D-T-6 A company B request that follows a forged row to company A's interview reads exactly one item of company A (the interview
 *    row by key) and nothing else of A's candidate (spec check round 2, N-3).
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const iv = (n: number) => `1a7e3000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PAST = H(-2);
const FUT = H(24);
const FORBIDDEN = { error: 'Forbidden' };
const ITEM_KEYS = ['at', 'candidate_first', 'candidate_last', 'due_at', 'interview_id', 'kind', 'role_title', 'type'];
const sorted = <T>(a: Iterable<T>) => [...a].sort();
/** An ISO time with the +02:00 offset (Africa/Johannesburg) for the UTC time `iso`. */
const zoned = (iso: string) => new Date(Date.parse(iso) + 2 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, '+02:00');
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const bookBody = (o: Record<string, unknown> = {}) => clean({ type: 'TECHNICAL', at: zoned(H(48)), length_minutes: 60, where: 'IN_PERSON', place: NEVER.place, panel: [P.p1, P.p2], ...o });
const RES = (o: Record<string, unknown> = {}) => ({ action: 'reschedule', ...o });
const CANCEL = () => ({ action: 'cancel', reason: 'CANDIDATE_ASKED' });
const DNH = () => ({ action: 'did_not_happen', reason: 'CANDIDATE_DID_NOT_COME' });
const DONE = () => ({ action: 'complete', reason: 'FEEDBACK_GIVEN_ANOTHER_WAY' });
const addDays = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();
/** World with these interviews added. */
const w = (...ivs: IvSpec[]) => ivs.reduce<Tables>((t, x) => withIv(t, x), world());
/** The OPEN rows a booking would have written for `panel`. */
const openRows = (cand: string, id: string, panel: string[], company = A) => panel.map((p) => dueRow(company, p, cand, id));
const pB = { ...W.p1, name: 'p1\'s person id signed in with company B', company: 'B' as const };
/** A company named in headers, a query string and a body (never to be used: the company comes from the sign-in only). */
const namingCompany = (c: string) => ({
  headers: { 'x-tenant-id': c, 'X-Tenant-Id': c, 'x-company-id': c, 'tenant-id': c, tenant_id: c },
  query: { tenant_id: c, tenantId: c, company_id: c, companyId: c },
});
/** No feedback-due row of `t` is under company `c`'s key or names company `c`. */
const noneUnder = (t: Tables, c: string, label: string) =>
  expect.soft(dueRows(t).filter((x) => String(x['PK']).startsWith(`FEEDBACK_DUE#${c}#`) || x['tenant_id'] === c).map((x) => `${x['PK']} ${x['SK']}`), `${label}: no feedback-due row under company ${c}`).toEqual([]);

let docCache: Doc | undefined;
const doc = () => (docCache ??= readDoc());

/** No feedback-due row in `t` carries an attribute that is the key of an index of the state table (rule 1, AC-1). */
function noIndexNames(t: Tables, label: string) {
  const bad = dueRows(t).flatMap((r) => INDEX_NAMES.filter((n) => n in r).map((n) => `${r['PK']} ${r['SK']} has ${n}`));
  expect.soft(bad, `${label}: no feedback-due row carries interviewId, candidateId, role_id or a GSI key`).toEqual([]);
}
/** The feedback-due rows of `after` are exactly those of `before` (D-T-3), and the run wrote none. */
function untouched(before: Tables, r: Run, label: string) {
  const key = (t: Tables) => dueRows(t).map((x) => JSON.stringify(x)).sort();
  expect.soft(key(r.tables), `${label}: no feedback-due row is added or changed`).toEqual(key(before));
  expect.soft(dueWrites(r).map((x) => `${x.op} ${x.kind}`), `${label}: no feedback-due write was even sent`).toEqual([]);
}
/** A whole feedback-due row as rule 1 shapes it. */
function wholeRow(t: Tables, company: string, person: string, cand: string, id: string, state: string, reason: string | undefined, at: string, label: string) {
  const r = dueOf(t, company, person, cand, id);
  expect.soft(Boolean(r), `${label}: ${person}'s row exists`).toBe(true);
  if (!r) return;
  const want: Record<string, unknown> = { PK: duePk(company, person), SK: dueSk(cand, id), tenant_id: company, person_id: person, interview_id: id, candidate_id: cand, state, updated_at: at };
  if (reason) want['done_reason'] = reason;
  expect.soft(r, `${label}: ${person}'s row is exactly rule 1's fields`).toEqual(want);
}
/** Every feedback-due write of `r` is an item of the one TransactWriteItems call that also writes the row whose SK is `ownSk`. */
function oneTransaction(r: Run, ownSk: string, label: string, expected: number) {
  const ws = dueWrites(r);
  expect.soft(ws.length, `${label}: ${expected} feedback-due writes`).toBe(expected);
  expect.soft(ws.filter((x) => x.op !== 'TransactWriteItems').map((x) => x.op), `${label}: no feedback-due write outside a transaction`).toEqual([]);
  const txs = new Set(ws.map((x) => x.call));
  expect.soft(txs.size, `${label}: all in one TransactWriteItems call`).toBe(expected ? 1 : 0);
  for (const tx of txs) {
    const sks = (tx.input?.TransactItems ?? []).map((it: any) => { const k = Object.keys(it)[0]!; return it[k]?.Item?.SK?.S ?? it[k]?.Key?.SK?.S; });
    expect.soft(sks.some((s: string) => s === ownSk || s?.startsWith(ownSk)), `${label}: that transaction also writes ${ownSk}`).toBe(true);
  }
}
/** Every feedback-due Update of `r` names neither PK nor SK in its expression, and carries no attribute_exists condition (rule 2). */
function updatesFree(r: Run, label: string) {
  for (const x of dueWrites(r).filter((y) => y.kind === 'Update')) {
    const names = namesIn(x.input.UpdateExpression, x.input.ExpressionAttributeNames ?? {});
    expect.soft(names.filter((n) => n === 'PK' || n === 'SK'), `${label}: the Update of ${x.input.Key?.PK?.S} names no key attribute (the key goes only in Key)`).toEqual([]);
    expect.soft(/attribute_exists\s*\(/.test(String(x.input.ConditionExpression ?? '')), `${label}: the Update carries no attribute_exists condition`).toBe(false);
  }
}
/** A 200 answer of the list, checked against rule 5's keys and the API file; returns the body. */
function listed(label: string, r: Run): { items: any[]; more: boolean } {
  expect(statusOf(r), `${label}: 200 (${describe(r)})`).toBe(200);
  const b = bodyOf(r) ?? {};
  expect.soft(sorted(Object.keys(b)), `${label}: the answer is { items, more }`).toEqual(['items', 'more']);
  for (const it of b.items ?? []) {
    expect.soft(sorted(Object.keys(it)), `${label}: each item has exactly rule 5's keys`).toEqual(ITEM_KEYS);
    expect.soft(it.kind, `${label}: kind is INTERVIEW_FEEDBACK`).toBe('INTERVIEW_FEEDBACK');
  }
  const problems = checker(doc()).check(answerSchema(doc(), ROUTE_DUE, 200), b);
  expect.soft(problems, `${label}: the answer passes api/openapi.yaml for ${ROUTE_DUE} 200`).toEqual([]);
  expect.soft(String(r.response?.headers?.['Content-Type'] ?? r.response?.headers?.['content-type'] ?? ''), `${label}: JSON`).toContain('application/json');
  return { items: b.items ?? [], more: b.more };
}
const ids = (b: { items: any[] }) => b.items.map((i) => i.interview_id);
/** The interviews tab's due_at for `person` on interview `id` (GET /v1/candidates/{id}/interviews, as HR reads it). */
function tabDue(cand: string, id: string, person: string, t: Tables, o = {}): string | null | undefined {
  const r = read(W.recruiter, cand, t, o);
  expect(statusOf(r), `the interviews tab of ${cand} (${describe(r)})`).toBe(200);
  const ivs = (bodyOf(r)?.interviews ?? []) as any[];
  return ivs.find((x) => (x.id ?? x.interviewId) === id)?.panel?.find((e: any) => e.person_id === person)?.due_at;
}
/** Every key and every string or number value of a value, at every depth. */
function walk(v: unknown, keys: string[] = [], values: string[] = []): { keys: string[]; values: string[] } {
  if (Array.isArray(v)) v.forEach((x) => walk(x, keys, values));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x, keys, values); }
  else if (typeof v === 'string' || typeof v === 'number') values.push(String(v));
  return { keys, values };
}
const dbWritesOf = (r: Run) => awsOf(r).filter((c: any) => c.service === 'dynamodb' && /^(PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems|ExecuteStatement|BatchExecuteStatement)$/.test(c.op));
const isModulesRead = (c: any) => c.service === 'dynamodb' && c.op === 'GetItem' && /tenants$/.test(String(c.table ?? '')) && JSON.stringify(c.input?.Key ?? {}).includes('PROFILE');
const guard = (cand: string, id: string, person: string, company = A) => av({ PK: `CANDIDATE#${cand}`, SK: `VOTED#${id}#${person}`, tenant_id: company, createdAt: H(-1) });

test.describe('REC-UI-03 server The list of feedback a person owes (GET /v1/feedback-due)', () => {
  // ---------------------------------------------------------------- AC-1

  test('AC-1 Booking writes one OPEN row per panel person, in the booking\'s own transaction, with no index key; a refused booking writes none', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const t = world();
    const r = book(W.recruiter, K.book, bookBody({ panel: [P.p1, P.p2, P.p3] }), t);
    expect(statusOf(r), `the booking (${describe(r)})`).toBe(201);
    const id = String(bodyOf(r)?.interview_id);
    expect.soft(dueStates(r.tables, id), 'three OPEN rows, one per panel person').toEqual({ [P.p1]: 'OPEN', [P.p2]: 'OPEN', [P.p3]: 'OPEN' });
    for (const p of [P.p1, P.p2, P.p3]) wholeRow(r.tables, A, p, K.book, id, 'OPEN', undefined, NOW, 'booking');
    expect.soft(dueRows(r.tables).length, 'no other feedback-due row').toBe(3);
    oneTransaction(r, `INTERVIEW#${id}`, 'booking', 3);
    expect.soft(dueWrites(r).map((x) => x.kind), 'each is a Put').toEqual(['Put', 'Put', 'Put']);
    noIndexNames(r.tables, 'booking');
    // The vote route finds interviews through the interview-id index: only the interview row may carry this interview's id there.
    expect.soft(sorted(rowsOf(r.tables, TABLE.state).filter((x) => x['interviewId'] === id).map((x) => String(x['SK']))), 'the index lookup finds only what it found before (the interview row and its type guard)').toEqual(sorted([`INTERVIEW#${id}`, 'IVTYPE#TECHNICAL']));

    // A booking that names company B in its headers and query string: the rows go only under the sign-in's company (A).
    const nb = call({ route: ROUTE.book, who: W.recruiter, path: { id: K.book }, ...namingCompany(B), body: bookBody({ panel: [P.p1, P.p2] }) }, t);
    expect(statusOf(nb), `a booking naming company B in headers and query (${describe(nb)})`).toBe(201);
    const nbId = String(bodyOf(nb)?.interview_id);
    expect.soft(dueRows(nb.tables).map((x) => `${x['PK']} ${x['SK']} ${x['tenant_id']}`).sort(), 'naming B: the two rows are under company A')
      .toEqual([P.p1, P.p2].map((p) => `${duePk(A, p)} ${dueSk(K.book, nbId)} ${A}`).sort());
    noneUnder(nb.tables, B, 'a booking naming B');
    // The same with the company in the body too: refused, or rows only under A.
    const nbb = book(W.recruiter, K.book, { ...bookBody({ panel: [P.p1, P.p2] }), tenant_id: B, tenantId: B, company_id: B }, t);
    expect.soft([201, 400], `a booking body naming company B (${describe(nbb)})`).toContain(statusOf(nbb));
    noneUnder(nbb.tables, B, 'a booking body naming B');
    if (statusOf(nbb) !== 201) untouched(t, nbb, 'a refused booking body naming B');

    // A booking whose transaction is refused (another booking of the same type lands first) leaves no row for its own interview.
    for (const when of ['before', 'after'] as const) {
      const other: Req = { route: ROUTE.book, who: W.recU, path: { id: K.book }, body: bookBody({ at: zoned(H(50)), panel: [P.p2, P.p3] }) };
      const x = book(W.recruiter, K.book, bookBody({ panel: [P.p1, P.p2] }), t, { race: { when, match: '"TECHNICAL"', table: TABLE.state, second: other } });
      const y = secondOf(x);
      expect.soft(sorted([statusOf(x), statusOf(y)]), `${when}: one 201 and one 409 (${describe(x)} / ${describe(y)})`).toEqual([201, 409]);
      const winner = statusOf(x) === 201 ? x : y;
      const wid = String(bodyOf(winner)?.interview_id);
      const panel = winner === x ? [P.p1, P.p2] : [P.p2, P.p3];
      expect.soft(dueRows(x.tables).map((d) => `${d['PK']} ${d['SK']} ${d['state']}`).sort(), `${when}: only the winner's rows, OPEN`)
        .toEqual(panel.map((p) => `${duePk(A, p)} ${dueSk(K.book, wid)} OPEN`).sort());
      noIndexNames(x.tables, `race ${when}`);
    }

    // Bookings refused before the write leave every feedback-due row as it was.
    const booked = w({ id: iv(1), cand: K.book, at: FUT });
    const refusals: [string, Caller, string, unknown, Tables][] = [
      ['an empty panel', W.recruiter, K.book, bookBody({ panel: [] }), t],
      ['a time in the past', W.recruiter, K.book, bookBody({ at: zoned(H(-1)) }), t],
      ['a person of company B on the panel', W.recruiter, K.book, bookBody({ panel: [P.p1, P.pB] }), t],
      ['a candidate in Screening', W.recruiter, K.screening, bookBody(), t],
      ['the type already booked', W.recruiter, K.book, bookBody(), booked],
      ['company B\'s Recruiter on A\'s candidate', W.recruiterB, K.book, bookBody(), t],
      ['an Employee', W.employee, K.book, bookBody(), t],
    ];
    for (const [what, who, cand, body, tt] of refusals) {
      const x = book(who, cand, body, tt);
      expect.soft([400, 403, 404, 409], `${what}: refused (${describe(x)})`).toContain(statusOf(x));
      untouched(tt, x, what);
    }
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 Reschedule: a panel change opens the new people and closes the removed ones in the same transaction; a time-only or refused reschedule changes no row', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const b = book(W.recruiter, K.book, bookBody({ panel: [P.p1, P.p2] }), world());
    expect(statusOf(b), `the booking (${describe(b)})`).toBe(201);
    const id = String(bodyOf(b)?.interview_id);
    const r = act(W.recruiter, K.book, id, RES({ panel: [P.p2, P.p3] }), b.tables, { now: H(1) });
    expect(statusOf(r), `the reschedule (${describe(r)})`).toBe(200);
    expect.soft(dueStates(r.tables, id), 'p1 DONE/REMOVED, p2 still OPEN, p3 OPEN').toEqual({ [P.p1]: 'DONE/REMOVED', [P.p2]: 'OPEN', [P.p3]: 'OPEN' });
    wholeRow(r.tables, A, P.p1, K.book, id, 'DONE', 'REMOVED', H(1), 'reschedule');
    wholeRow(r.tables, A, P.p3, K.book, id, 'OPEN', undefined, H(1), 'reschedule');
    expect.soft(dueWrites(r).filter((x) => x.kind === 'Update').map((x) => x.input.Key?.PK?.S), 'the removed person is closed with an Update').toEqual([duePk(A, P.p1)]);
    const ws = dueWrites(r);
    oneTransaction(r, `INTERVIEW#${id}`, 'reschedule', ws.length || 2);
    updatesFree(r, 'reschedule');
    noIndexNames(r.tables, 'reschedule');

    // A reschedule of the time only changes no row.
    const t2 = act(W.recruiter, K.book, id, RES({ at: zoned(H(72)) }), b.tables);
    expect(statusOf(t2), `time only (${describe(t2)})`).toBe(200);
    untouched(b.tables, t2, 'a time-only reschedule');
    // Neither does a change of place or length.
    const t3 = act(W.recruiter, K.book, id, RES({ length_minutes: 45 }), b.tables);
    expect(statusOf(t3), `length only (${describe(t3)})`).toBe(200);
    untouched(b.tables, t3, 'a length-only reschedule');

    // Refused by its condition: another reschedule (length only) lands between this one's read and its write, so the sequence moved.
    const other: Req = { route: ROUTE.act, who: W.recU, path: { id: K.book, interviewId: id }, body: RES({ length_minutes: 45 }) };
    const x = act(W.recruiter, K.book, id, RES({ panel: [P.p2, P.p3] }), b.tables, { race: { when: 'before', match: `INTERVIEW#${id}`, table: TABLE.state, second: other } });
    expect.soft([statusOf(x), statusOf(secondOf(x))], `the panel change is refused, the other lands (${describe(x)})`).toEqual([409, 200]);
    expect.soft(dueStates(x.tables, id), 'the rows are as booked').toEqual({ [P.p1]: 'OPEN', [P.p2]: 'OPEN' });
    // Refused before any write: HAS_FEEDBACK (a vote exists), company B, an Employee.
    const voted = withRows(w({ id: iv(2), cand: K.book, at: PAST, panel: [P.p1, P.p2] }), [...openRows(K.book, iv(2), [P.p2]), voteRow(K.book, iv(2), P.p1), dueRow(A, P.p1, K.book, iv(2), 'DONE')]);
    for (const [what, who, cand, idx, tt] of [
      ['a reschedule after a vote', W.recruiter, K.book, iv(2), voted], ['company B\'s Recruiter', W.recruiterB, K.book, id, b.tables], ['an Employee', W.employee, K.book, id, b.tables],
    ] as [string, Caller, string, string, Tables][]) {
      const y = act(who, cand, idx, RES({ panel: [P.p3], at: zoned(H(30)) }), tt);
      expect.soft([400, 403, 404, 409], `${what}: refused (${describe(y)})`).toContain(statusOf(y));
      untouched(tt, y, what);
    }
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 Cancel, Did not happen and Mark as done close every panel person\'s row in the same transaction, also on an interview booked before this card; a refused action changes no row', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(420_000);
    const b = book(W.recruiter, K.book, bookBody({ panel: [P.p1, P.p2] }), world());
    expect(statusOf(b), `the booking (${describe(b)})`).toBe(201);
    const id = String(bodyOf(b)?.interview_id);
    // A cancel naming company B in headers and query: the rows closed are company A's, none under B.
    const nc = call({ route: ROUTE.act, who: W.recruiter, path: { id: K.book, interviewId: id }, ...namingCompany(B), body: CANCEL() }, b.tables, { now: H(1) });
    expect(statusOf(nc), `a cancel naming company B (${describe(nc)})`).toBe(200);
    expect.soft(dueStates(nc.tables, id), 'naming B: A\'s rows closed').toEqual({ [P.p1]: 'DONE/CANCELLED', [P.p2]: 'DONE/CANCELLED' });
    noneUnder(nc.tables, B, 'a cancel naming B');
    const cases: [string, unknown, string, string][] = [['cancel', CANCEL(), H(1), 'CANCELLED'], ['did_not_happen', DNH(), H(50), 'DID_NOT_HAPPEN'], ['complete', DONE(), H(50), 'COMPLETED']];
    for (const [name, body, at, reason] of cases) {
      const r = act(W.recruiter, K.book, id, body, b.tables, { now: at });
      expect(statusOf(r), `${name} (${describe(r)})`).toBe(200);
      expect.soft(dueStates(r.tables, id), `${name}: every panel person DONE/${reason}`).toEqual({ [P.p1]: `DONE/${reason}`, [P.p2]: `DONE/${reason}` });
      for (const p of [P.p1, P.p2]) wholeRow(r.tables, A, p, K.book, id, 'DONE', reason, at, name);
      oneTransaction(r, `INTERVIEW#${id}`, name, 2);
      expect.soft(dueWrites(r).map((x) => x.kind), `${name}: Updates`).toEqual(['Update', 'Update']);
      updatesFree(r, name);
      noIndexNames(r.tables, name);
    }
    // Booked before this card: no feedback-due row, no sequence. Each action still succeeds and leaves complete DONE rows.
    const old: [string, unknown, string, string, string][] = [['cancel', CANCEL(), FUT, NOW, 'CANCELLED'], ['did_not_happen', DNH(), PAST, NOW, 'DID_NOT_HAPPEN'], ['complete', DONE(), PAST, NOW, 'COMPLETED']];
    for (const [name, body, at, now, reason] of old) {
      const t = w({ id: iv(10), cand: K.fresh, at, sequence: null, panel: [P.p1, P.p2, P.p3] });
      expect.soft(dueRows(t).length, 'no row before').toBe(0);
      const r = act(W.recruiter, K.fresh, iv(10), body, t, { now });
      expect(statusOf(r), `old-way ${name} (${describe(r)})`).toBe(200);
      for (const p of [P.p1, P.p2, P.p3]) wholeRow(r.tables, A, p, K.fresh, iv(10), 'DONE', reason, now, `old-way ${name}`);
      expect.soft(ivOf(r.tables, K.fresh, iv(10))?.['status'], `old-way ${name}: the interview is closed`).toBe(reason);
      updatesFree(r, `old-way ${name}`);
      noIndexNames(r.tables, `old-way ${name}`);
    }
    // Refused actions change no row.
    const started = withRows(w({ id: iv(11), cand: K.fresh, at: PAST, panel: [P.p1, P.p2] }), openRows(K.fresh, iv(11), [P.p1, P.p2]));
    const closed = withRows(w({ id: iv(12), cand: K.fresh, at: PAST, status: 'CANCELLED', panel: [P.p1, P.p2] }), openRows(K.fresh, iv(12), [P.p1, P.p2]));
    const refusals: [string, Caller, string, string, unknown, Tables][] = [
      ['cancel after the start', W.recruiter, K.fresh, iv(11), CANCEL(), started],
      ['did not happen before the start', W.recruiter, K.book, id, DNH(), b.tables],
      ['mark as done on a cancelled interview', W.recruiter, K.fresh, iv(12), DONE(), closed],
      ['company B\'s Recruiter cancels A\'s', W.recruiterB, K.book, id, CANCEL(), b.tables],
      ['an Employee marks as done', W.employee, K.fresh, iv(11), DONE(), started],
      ['a reason that is not on the list', W.recruiter, K.fresh, iv(11), { action: 'complete', reason: 'NOPE' }, started],
    ];
    for (const [what, who, cand, idx, body, tt] of refusals) {
      const r = act(who, cand, idx, body, tt);
      expect.soft([400, 403, 404, 409], `${what}: refused (${describe(r)})`).toContain(statusOf(r));
      untouched(tt, r, what);
    }
    // Refused by its transaction: a vote lands between Mark as done's read and its write (votesSubmitted moved).
    const voteReq: Req = { route: ROUTE.vote, who: W.p1, path: { id: iv(11) }, body: voteBody() };
    const raced = act(W.recruiter, K.fresh, iv(11), DONE(), started, { race: { when: 'before', match: `INTERVIEW#${iv(11)}`, table: TABLE.state, second: voteReq } });
    if (statusOf(raced) === 409) {
      expect.soft(dueStates(raced.tables, iv(11)), 'mark as done refused: only the vote\'s own change (p1 VOTED), p2 still OPEN').toEqual({ [P.p1]: 'DONE/VOTED', [P.p2]: 'OPEN' });
    } else {
      expect.soft(statusOf(raced), `mark as done after the vote (${describe(raced)})`).toBe(200);
      expect.soft(dueStates(raced.tables, iv(11)), 'mark as done landed: both closed').toEqual({ [P.p1]: 'DONE/COMPLETED', [P.p2]: 'DONE/COMPLETED' });
    }
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Vote: the voter\'s own row (or the person HR enters it for) closes in the vote transaction, also on the one retry; a refused or guest vote changes no row', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(420_000);
    const t = withRows(w({ id: iv(20), cand: K.book, at: PAST, panel: [P.p1, P.p2, P.p3] }), openRows(K.book, iv(20), [P.p1, P.p2, P.p3]));
    const r = vote(W.p1, iv(20), voteBody(), t);
    expect(statusOf(r), `p1 votes (${describe(r)})`).toBe(201);
    expect.soft(dueStates(r.tables, iv(20)), 'p1 DONE/VOTED, the others OPEN').toEqual({ [P.p1]: 'DONE/VOTED', [P.p2]: 'OPEN', [P.p3]: 'OPEN' });
    wholeRow(r.tables, A, P.p1, K.book, iv(20), 'DONE', 'VOTED', NOW, 'own vote');
    oneTransaction(r, `VOTE#${P.p1}#`, 'own vote', 1);
    expect.soft(dueWrites(r).map((x) => x.kind), 'an Update').toEqual(['Update']);
    updatesFree(r, 'own vote');
    // A vote naming company B in headers and query closes p1's company A row and writes nothing under B.
    const nv = call({ route: ROUTE.vote, who: W.p1, path: { id: iv(20) }, ...namingCompany(B), body: voteBody() }, t);
    expect(statusOf(nv), `a vote naming company B (${describe(nv)})`).toBe(201);
    expect.soft(dueStates(nv.tables, iv(20)), 'naming B: p1\'s A row closed').toEqual({ [P.p1]: 'DONE/VOTED', [P.p2]: 'OPEN', [P.p3]: 'OPEN' });
    noneUnder(nv.tables, B, 'a vote naming B');
    // HR enters p2's vote: p2's row closes, never HR's.
    const h = vote(W.recruiter, iv(20), voteBody({ on_behalf_of: P.p2 }), r.tables);
    expect(statusOf(h), `HR enters p2's vote (${describe(h)})`).toBe(201);
    expect.soft(dueStates(h.tables, iv(20)), 'p2 DONE/VOTED; p1 as it was; p3 OPEN').toEqual({ [P.p1]: 'DONE/VOTED', [P.p2]: 'DONE/VOTED', [P.p3]: 'OPEN' });
    expect.soft(dueRows(h.tables).filter((x) => String(x['PK']).includes(SUB.recA)).length, 'no row for the HR person who entered it').toBe(0);
    oneTransaction(h, `VOTE#${P.p2}#`, 'on behalf', 1);
    updatesFree(h, 'on behalf');
    noIndexNames(h.tables, 'votes');
    // Booked before this card (no row): the vote still lands and leaves a complete DONE row.
    const old = w({ id: iv(21), cand: K.fresh, at: PAST, sequence: null, panel: [P.p1, P.p2] });
    const o = vote(W.p1, iv(21), voteBody(), old);
    expect(statusOf(o), `vote on an old-way interview with no row (${describe(o)})`).toBe(201);
    wholeRow(o.tables, A, P.p1, K.fresh, iv(21), 'DONE', 'VOTED', NOW, 'old-way vote');
    expect.soft(dueOf(o.tables, A, P.p2, K.fresh, iv(21)), 'no row for p2, who did not vote').toBeUndefined();

    // Refused votes change no row.
    const fut = withRows(w({ id: iv(22), cand: K.book, at: FUT, panel: [P.p1] }), openRows(K.book, iv(22), [P.p1]));
    const refusals: [string, Caller, string, unknown, Tables][] = [
      ['not started', W.p1, iv(22), voteBody(), fut],
      ['already scored', W.p1, iv(20), voteBody(), r.tables],
      ['not on the panel (an Employee)', W.employee, iv(20), voteBody(), t],
      ['p1\'s id signed in with company B', pB, iv(20), voteBody(), t],
      ['company B\'s Recruiter entering for p2', W.recruiterB, iv(20), voteBody({ on_behalf_of: P.p2 }), t],
      ['HR entering for someone not on the panel', W.recruiter, iv(20), voteBody({ on_behalf_of: REC_U }), t],
      ['scores that do not fit', W.p1, iv(20), { scores: { nope: 3 }, rating: 'YES' }, t],
    ];
    for (const [what, who, idx, body, tt] of refusals) {
      const x = vote(who, idx, body, tt);
      expect.soft([400, 403, 404, 409], `${what}: refused (${describe(x)})`).toContain(statusOf(x));
      untouched(tt, x, what);
    }
    // The one retry (INT-01.F rule 2.4): the interview's sequence moves between the read and the first write, so the first transaction is
    // cancelled and the vote is judged again and sent again. Both tries carry p1's Update; one row, DONE/VOTED, one vote.
    const bump = { raw: { table: TABLE.state, key: { PK: `CANDIDATE#${K.book}`, SK: `INTERVIEW#${iv(20)}` }, set: { sequence: 2 } } };
    const rt = vote(W.p1, iv(20), voteBody(), t, withHooks([{ when: 'before', match: `VOTE#${P.p1}`, times: 1, runs: [bump] }]));
    expect(statusOf(rt), `the vote after one retry (${describe(rt)})`).toBe(201);
    expect.soft(fires(rt).length, 'the hook fired once').toBe(1);
    const tries = awsOf(rt).filter((c: any) => c.op === 'TransactWriteItems' && JSON.stringify(c.input).includes(`VOTE#${P.p1}#`));
    expect.soft(tries.length, 'two vote transactions were sent').toBe(2);
    for (const [i, c] of tries.entries()) {
      const mine = (c.input.TransactItems as any[]).filter((it) => JSON.stringify(it).includes('FEEDBACK_DUE#'));
      expect.soft(mine.map((it) => `${Object.keys(it)[0]} ${it.Update?.Key?.PK?.S ?? it.Put?.Item?.PK?.S}`), `try ${i + 1} carries exactly p1's Update`).toEqual([`Update ${duePk(A, P.p1)}`]);
    }
    expect.soft(dueStates(rt.tables, iv(20)), 'after the retry: p1 DONE/VOTED once').toEqual({ [P.p1]: 'DONE/VOTED', [P.p2]: 'OPEN', [P.p3]: 'OPEN' });
    expect.soft(rowsOf(rt.tables, TABLE.state).filter((x) => String(x['SK']).startsWith(`VOTE#${P.p1}#`) && x['interviewId'] === iv(20)).length, 'one vote').toBe(1);
    // A guest's vote writes no feedback-due row.
    const G = token(301);
    const gt = withRows(w({ id: iv(23), cand: K.book, at: PAST, guest: G, panel: [P.p1] }), openRows(K.book, iv(23), [P.p1]));
    const g = guestVote(G, voteBody(), gt);
    expect.soft([200, 201], `the guest votes (${describe(g)})`).toContain(statusOf(g));
    untouched(gt, g, 'a guest vote');
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 The list holds only started SCHEDULED interviews the caller is on and has not scored (new, old 0 to 10, or guard row), with rule 5\'s keys and the Interviews tab\'s due_at', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    let t = withFeedbackHours(world(), 30);
    const C = (n: number) => iv(500 + n);
    const specs: IvSpec[] = [
      { id: C(1), cand: K.book, at: PAST, type: 'TECHNICAL', panel: [P.p1, P.p2] },
      { id: C(2), cand: K.book, at: PAST, type: 'BEHAVIORAL', panel: [P.p1, P.p2] },
      { id: C(3), cand: K.book, at: FUT, type: 'FINAL', panel: [P.p1, P.p2] },
      { id: C(4), cand: K.book, at: PAST, type: 'PHONE_SCREEN', status: 'CANCELLED', panel: [P.p1, P.p2] },
      { id: C(5), cand: K.book, at: PAST, type: 'PHONE_SCREEN', status: 'COMPLETED', panel: [P.p1, P.p2] },
      { id: C(6), cand: K.book, at: PAST, type: 'PHONE_SCREEN', panel: [P.p2, P.p3] },
      { id: C(7), cand: K.book, at: PAST, type: 'PHONE_SCREEN', panel: [P.p1, P.p2] },
      { id: C(8), cand: K.book, at: PAST, type: 'PHONE_SCREEN', panel: [P.p1, P.p2] },
    ];
    for (const s of specs) t = withIv(t, s);
    t = withRows(t, [
      ...specs.map((s) => dueRow(A, P.p1, K.book, s.id)),
      voteRow(K.book, C(2), P.p1),
      oldVoteRow(K.book, C(7), P.p1),
      guard(K.book, C(8), P.p1),
    ]);
    const b = listed('p1', due(W.p1, t));
    expect.soft(ids(b), 'only (a): started, SCHEDULED, on the panel, no vote of theirs').toEqual([C(1)]);
    expect.soft(b.more, 'more: false').toBe(false);
    const saga = rowsOf(t, TABLE.state).find((x) => x['PK'] === `CANDIDATE#${K.book}` && x['SK'] === 'SAGA')!;
    const it = b.items[0] ?? {};
    expect.soft([it.candidate_first, it.candidate_last, it.role_title, it.type, it.at], 'who and when, from the saga and the interview')
      .toEqual([saga['firstName'], saga['lastName'], saga['positionTitle'] ?? null, 'TECHNICAL', PAST]);
    expect.soft(it.due_at, 'due_at: the start plus the company\'s 30 hours').toBe(addDays(PAST, 30));
    expect.soft(it.due_at, 'due_at: the same as the Interviews tab gives p1').toBe(tabDue(K.book, C(1), P.p1, t));
    // p2 is on (a) to (h) except none: p2 owes (a), (b), (f), (g), (h) (p2 has no vote anywhere); (c) not started, (d)/(e) closed.
    expect.soft(sorted(ids(listed('p2 with no rows', due(W.p2, t)))), 'p2 has no rows of their own: nothing listed (the row is the way in)').toEqual([]);
    const t2 = withRows(t, specs.map((s) => dueRow(A, P.p2, K.book, s.id)));
    expect.soft(sorted(ids(listed('p2', due(W.p2, t2)))), 'p2 owes (a), (b), (f), (g) and (h)').toEqual(sorted([C(1), C(2), C(6), C(7), C(8)]));
    // A missing job title is null.
    const noTitle = withRows(t, []);
    noTitle[TABLE.state] = noTitle[TABLE.state]!.map((r) => { const p = plain(r); if (p['PK'] === `CANDIDATE#${K.book}` && p['SK'] === 'SAGA') { const { positionTitle: _x, ...rest } = p; return av(rest); } return r; });
    expect.soft(listed('no job title', due(W.p1, noTitle)).items[0]?.role_title, 'no job title: null').toBeNull();

    // End to end: book (the real write), then read before and after the start.
    const bk = book(W.recruiter, K.fresh, bookBody({ panel: [P.p1, P.p3], at: zoned(H(48)) }), world());
    expect(statusOf(bk), `the booking (${describe(bk)})`).toBe(201);
    const id = String(bodyOf(bk)?.interview_id);
    expect.soft(ids(listed('p1 before the start', due(W.p1, bk.tables))), 'not started: not listed').not.toContain(id);
    const after = listed('p1 after the start', due(W.p1, bk.tables, {}, { now: H(49) }));
    expect.soft(ids(after), 'started: listed').toContain(id);
    const mine = after.items.find((x) => x.interview_id === id) ?? {};
    expect.soft([mine.at, mine.type], 'at and type').toEqual([H(48), 'TECHNICAL']);
    expect.soft(typeof mine.due_at === 'string' && Date.parse(mine.due_at) > Date.parse(H(48)), 'due_at is a time after the start').toBe(true);
    expect.soft(mine.due_at, 'the same due_at as the Interviews tab').toBe(tabDue(K.fresh, id, P.p1, bk.tables, { now: H(49) }));
    // p1 votes (on the booked interview's own criteria): gone from p1's list, still on p3's.
    const booked = rowsOf(bk.tables, TABLE.state).find((x) => x['SK'] === `INTERVIEW#${id}`) ?? {};
    const crit = Object.fromEntries(((booked['criteria_snapshot'] ?? []) as any[]).map((c) => [c.key, 4]));
    const v = vote(W.p1, id, voteBody({ scores: crit }), bk.tables, { now: H(49) });
    expect(statusOf(v), `p1 votes (${describe(v)})`).toBe(201);
    expect.soft(ids(listed('p1 after voting', due(W.p1, v.tables, {}, { now: H(49) }))), 'p1 voted: gone').not.toContain(id);
    expect.soft(ids(listed('p3', due(W.p3, v.tables, {}, { now: H(49) }))), 'p3 has not voted: still listed').toContain(id);
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 The list judges the live rows: forged or stale OPEN rows (voted, closed, off the panel, no interview, no candidate) are left out; a DONE row is not a way in', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const C = (n: number) => iv(600 + n);
    let t = w(
      { id: C(1), cand: K.book, at: PAST, panel: [P.p1] },
      { id: C(2), cand: K.book, at: PAST, panel: [P.p1, P.p2] },
      { id: C(3), cand: K.book, at: PAST, status: 'DID_NOT_HAPPEN', panel: [P.p1] },
      { id: C(4), cand: K.book, at: PAST, panel: [P.p2] },
      { id: C(6), cand: K.ghost, at: PAST, panel: [P.p1] },
      { id: C(7), cand: K.fresh, at: PAST, panel: [P.p1] },
      { id: C(8), cand: K.fresh, at: PAST, panel: [P.p1] },
    );
    t = withRows(t, [
      dueRow(A, P.p1, K.book, C(1)),
      dueRow(A, P.p1, K.book, C(2)), voteRow(K.book, C(2), P.p1),
      dueRow(A, P.p1, K.book, C(3)),
      dueRow(A, P.p1, K.book, C(4)),
      dueRow(A, P.p1, K.book, C(5)),
      dueRow(A, P.p1, K.ghost, C(6)),
      dueRow(A, P.p1, K.fresh, C(7), 'DONE'),
      // A row pointing at a real owed interview under the wrong candidate in its key.
      dueRow(A, P.p1, K.fresh, C(1)),
    ]);
    // Rule 4.4: an interview row stamped company A under company B's candidate (Bee's SAGA is B's), p1 on the panel, an OPEN A row.
    t = withIv(t, { id: C(9), cand: K.bee, company: A, at: PAST, panel: [P.p1] });
    t = withRows(t, [dueRow(A, P.p1, K.bee, C(9))]);
    const r = due(W.p1, t);
    const b = listed('p1', r);
    expect.soft(ids(b), 'only the one owed interview with an OPEN row (not the one whose candidate is company B\'s)').toEqual([C(1)]);
    expect.soft(['Bee', 'Bcompany'].filter((x) => JSON.stringify(bodyOf(r)).includes(x)), 'nothing of company B\'s candidate in the answer').toEqual([]);
    expect.soft(dbWritesOf(r).length, 'the read writes nothing (it does not tidy stale rows)').toBe(0);
    expect.soft(logsOf(r).filter((l) => [C(2), C(3), C(4), C(5), C(6), C(7), C(8), K.ghost].some((x) => l.includes(x))), 'nothing left out is named in a log line').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 Company walk: company B\'s caller with the same person id gets only B\'s own; a B row pointing at A\'s interview is dropped after one read of A; a company named in the request is never used; no company or Recruitment off is refused first', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const ivA = iv(700);
    const ivB = iv(701);
    let t = withIv(world(), { id: ivA, cand: K.book, at: PAST, panel: [P.p1] });
    t = withIv(t, { id: ivB, cand: K.bee, company: B, at: PAST, panel: [P.p1, P.pB] });
    t = withRows(t, [
      dueRow(A, P.p1, K.book, ivA),
      dueRow(B, P.p1, K.bee, ivB),
      dueRow(B, P.pB, K.bee, ivB),
      // Forged: under company B's key, pointing at company A's interview.
      dueRow(B, P.p1, K.book, ivA),
      // Forged: under company A's key, pointing at company B's interview.
      dueRow(A, P.p1, K.bee, ivB),
    ]);
    expect.soft(ids(listed('p1 in company A', due(W.p1, t))), 'company A: only A\'s').toEqual([ivA]);
    const rb = due(pB, t);
    expect.soft(ids(listed('p1\'s id in company B', rb)), 'company B, same person id: only B\'s').toEqual([ivB]);
    // Whose list was read: every list Query of each request asks for the sign-in's own company and person, never another.
    const pkCheck = (r: Run, want: string, label: string) => {
      const pks = listPks(r);
      expect.soft(pks.length, `${label}: the list was read`).toBeGreaterThan(0);
      expect.soft([...new Set(pks)], `${label}: every list Query is on ${want}`).toEqual([want]);
    };
    pkCheck(rb, duePk(B, P.p1), 'p1\'s id in company B');
    const inA = awsOf(rb).filter((c: any) => !JSON.stringify(c.input ?? {}).includes('FEEDBACK_DUE#') && JSON.stringify(c.input ?? {}).includes(`CANDIDATE#${K.book}`));
    expect.soft(inA.map((c: any) => `${c.op} ${c.input?.Key?.SK?.S ?? JSON.stringify(c.input?.ExpressionAttributeValues ?? {}).slice(0, 80)}`), 'company B\'s request reads one item of A: the interview row, by key, and nothing else of A\'s candidate')
      .toEqual([`GetItem INTERVIEW#${ivA}`]);
    expect.soft(ids(listed('pB', due({ name: 'pB', groups: ['employee'], sub: P.pB, company: 'B' }, t))), 'B\'s own person').toEqual([ivB]);
    // A company named in headers, query and body is never used.
    const naming = (c: string) => ({
      headers: { 'x-tenant-id': c, 'X-Tenant-Id': c, 'x-company-id': c, 'tenant-id': c, tenant_id: c },
      query: { tenant_id: c, tenantId: c, company_id: c, companyId: c },
      body: { tenant_id: c, tenantId: c, company_id: c },
    });
    const bA = due(pB, t, naming(A));
    expect.soft(ids(listed('B naming A', bA)), 'company B naming A everywhere: still only B\'s').toEqual([ivB]);
    pkCheck(bA, duePk(B, P.p1), 'B naming A');
    const aB = due(W.p1, t, naming(B));
    expect.soft(ids(listed('A naming B', aB)), 'company A naming B everywhere: still only A\'s').toEqual([ivA]);
    pkCheck(aB, duePk(A, P.p1), 'A naming B');
    for (const who of [W.recruiterB, W.managerB]) expect.soft(ids(listed(`${who.name} naming A`, due(who, t, naming(A)))), `${who.name}: none of A\'s`).not.toContain(ivA);
    // No company: requireTenant's 403, no AWS call. Recruitment off: requireModule's 403, only the module read.
    const none = due({ ...W.p1, name: 'p1 with no company', company: null as any }, t);
    expect.soft([statusOf(none), bodyOf(none), awsOf(none).length], 'no company: 403 before any AWS call').toEqual([403, FORBIDDEN, 0]);
    const off = due({ ...W.p1, name: 'p1 in company D (Recruitment off)', company: 'D' as any }, t);
    expect.soft([statusOf(off), bodyOf(off)], 'Recruitment off: 403').toEqual([403, FORBIDDEN]);
    expect.soft(awsOf(off).filter((c: any) => !isModulesRead(c)).map((c: any) => `${c.service} ${c.op} ${c.table ?? ''}`), 'Recruitment off: only the module read').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Only the caller\'s own: an Employee, an HR person and a hiring manager on panels each get theirs; HR does not get what they booked for others; the request cannot name another person', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const [ivE, ivH, ivM] = [iv(800), iv(801), iv(802)];
    let t = withIv(world(), { id: ivE, cand: K.book, at: PAST, panel: [P.p1] });
    t = withIv(t, { id: ivH, cand: K.fresh, at: PAST, type: 'BEHAVIORAL', panel: [REC_U] });
    t = withIv(t, { id: ivM, cand: K.fresh, at: PAST, type: 'FINAL', panel: [SUB.hmA] });
    t = withRows(t, [dueRow(A, P.p1, K.book, ivE), dueRow(A, REC_U, K.fresh, ivH), dueRow(A, SUB.hmA, K.fresh, ivM)]);
    // HR (recU) books another interview for p1 and p2.
    const bk = book(W.recU, K.book, bookBody({ type: 'PHONE_SCREEN', at: zoned(H(1)), panel: [P.p1, P.p2] }), t);
    expect(statusOf(bk), `recU books (${describe(bk)})`).toBe(201);
    const booked = String(bodyOf(bk)?.interview_id);
    const later = { now: H(2) };
    expect.soft(sorted(ids(listed('p1 (Employee)', due(W.p1, bk.tables, {}, later)))), 'the Employee: their two').toEqual(sorted([ivE, booked]));
    expect.soft(ids(listed('recU (HR)', due(W.recU, bk.tables, {}, later))), 'HR: only the one they sit on, not the one they booked').toEqual([ivH]);
    expect.soft(ids(listed('the hiring manager', due(W.hm, bk.tables, {}, later))), 'the hiring manager: only theirs').toEqual([ivM]);
    expect.soft(ids(listed('the Recruiter on no panel', due(W.recruiter, bk.tables, {}, later))), 'a Recruiter on no panel: nothing').toEqual([]);
    // The request cannot name another person.
    const plainP2 = bodyOf(due(W.p2, bk.tables, {}, later));
    for (const [what, extra] of [
      ['a query string naming p1 and company B', { query: { person: P.p1, person_id: P.p1, tenant_id: B, user_id: P.p1 } }],
      ['headers naming p1', { headers: { 'x-user-id': P.p1, 'x-person-id': P.p1, 'x-sub': P.p1, sub: P.p1 } }],
      ['a body naming p1', { body: { person_id: P.p1, user_id: P.p1, sub: P.p1 } }],
    ] as [string, any][]) expect.soft(bodyOf(due(W.p2, bk.tables, extra, later)), `p2 with ${what}: the same answer as plain`).toEqual(plainP2);
    expect.soft(ids(plainP2 ?? { items: [] }), 'p2: the booked one only').toEqual([booked]);
    // The caller is the sign-in's person id (RA.callerId: a moved person's user_id claim, else sub).
    const moved: Caller = { name: 'p1 after the move to one sign-in pool', groups: ['employee'], sub: 'zz-moved-sub-p1', claims: { user_id: P.p1 } } as Caller;
    expect.soft(sorted(ids(listed('p1 moved', due(moved, bk.tables, {}, later)))), 'the moved person\'s list is p1\'s').toEqual(sorted([ivE, booked]));
    // No person id in the sign-in: 403 before any read of the state table.
    const noId = due(W.p1, bk.tables, { claims: { sub: '' } }, later);
    expect.soft([statusOf(noId), bodyOf(noId)], 'no person id: 403 Forbidden').toEqual([403, FORBIDDEN]);
    expect.soft(awsOf(noId).filter((c: any) => c.table === TABLE.state).length, 'no person id: no read of the state table').toBe(0);
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 Order and limit: by due_at (each candidate\'s own locked settings), then at, then interview_id; at most 200 items with more true', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(420_000);
    // A's settings: version 1 says 48 hours, version 2 (now active) says 24. K.other is locked to version 1; K.book is not locked.
    const v = withNewVersion(withFeedbackHours(world(), 48), A, 'SLA_THRESHOLDS', (d) => ({ ...d, feedbackDueHours: 24 }));
    let t = withRows(v.t, [candidateRow(K.other, { first: 'Other', last: 'Person', company: A, stage: 'INTERVIEW', role: R.fleet, hm: SUB.hmA, entered: 20, extra: { configVersion: '1', settingVersions: { SLA_THRESHOLDS: v.version - 1 } } })]);
    const X1 = iv(901);
    const [Ya, Yb, Y1, Y4] = [iv(1002), iv(1003), iv(904), iv(905)];
    const specs: IvSpec[] = [
      { id: Y4, cand: K.book, at: H(-1), panel: [P.p1] },
      { id: Yb, cand: K.book, at: H(-10), panel: [P.p1] },
      { id: X1, cand: K.other, at: H(-30), panel: [P.p1] },
      { id: Y1, cand: K.book, at: H(-6), panel: [P.p1] },
      { id: Ya, cand: K.book, at: H(-10), panel: [P.p1] },
    ];
    for (const s of specs) t = withIv(t, s);
    t = withRows(t, [dueRow(A, P.p1, K.book, Y4), dueRow(A, P.p1, K.other, X1), dueRow(A, P.p1, K.book, Yb), dueRow(A, P.p1, K.book, Y1), dueRow(A, P.p1, K.book, Ya)]);
    const b = listed('p1', due(W.p1, t));
    expect.soft(b.items.map((i) => [i.interview_id, i.due_at]), 'earliest due first; a tie on due_at by at; a tie on both by interview_id')
      .toEqual([[Ya, H(14)], [Yb, H(14)], [X1, H(18)], [Y1, H(18)], [Y4, H(23)]]);
    expect.soft(b.more, 'five: more false').toBe(false);
    expect.soft(b.items.find((i) => i.interview_id === X1)?.due_at, 'K.other\'s due_at uses its locked 48 hours').toBe(tabDue(K.other, X1, P.p1, t));

    // 205 owed rows: at most 200 items, more true, each a real owed interview, none twice.
    let big = world();
    const many = Array.from({ length: 205 }, (_x, i) => iv(3000 + i));
    big = withRows(big, many.flatMap((id, i) => [interviewRow({ id, cand: K.fresh, at: H(-3 - (i % 7)), panel: [P.p1], type: 'TECHNICAL' }), dueRow(A, P.p1, K.fresh, id)]));
    const r = due(W.p1, big);
    const m = listed('205 rows', r);
    expect.soft(m.items.length, 'at most 200 items').toBeLessThanOrEqual(200);
    expect.soft(m.items.length, 'and not cut short far below 200').toBeGreaterThanOrEqual(195);
    expect.soft(m.more, 'more: true').toBe(true);
    expect.soft(new Set(ids(m)).size, 'no interview twice').toBe(m.items.length);
    expect.soft(ids(m).filter((x) => !many.includes(x)), 'every item is one of the owed interviews').toEqual([]);
    const dues = m.items.map((i) => i.due_at);
    expect.soft(dues, 'sorted by due_at').toEqual([...dues].sort());
    // Exactly 200: all of them, more false (the limit is not off by one).
    const exact = withRows(world(), many.slice(0, 200).flatMap((id) => [interviewRow({ id, cand: K.fresh, at: H(-3), panel: [P.p1] }), dueRow(A, P.p1, K.fresh, id)]));
    const e = listed('200 rows', due(W.p1, exact));
    expect.soft([e.items.length, e.more], '200 owed: 200 items, more false').toEqual([200, false]);
    // 3 rows: more false.
    const three = withRows(world(), many.slice(0, 3).flatMap((id) => [interviewRow({ id, cand: K.fresh, at: H(-3), panel: [P.p1] }), dueRow(A, P.p1, K.fresh, id)]));
    expect.soft(listed('3 rows', due(W.p1, three)).more, 'three: more false').toBe(false);

    // Paging (DynamoDB answers a Query in pages; the filter runs after a page is cut, and finished rows are never deleted, D-293.3).
    // The fake answers 50 key matches a page here, in the order the rows were added. Finished (DONE) rows never count toward the 200.
    const PAGE = { queryPageSize: 50 };
    const doneFirst = (n: number) => Array.from({ length: n }, (_x, i) => dueRow(A, P.p1, K.fresh, iv(6000 + i), 'DONE'));
    // 250 DONE rows ahead of 3 owed OPEN rows: the 3 are listed, more false.
    const owed3 = many.slice(0, 3);
    const deep = withRows(withRows(world(), doneFirst(250)), owed3.flatMap((id) => [interviewRow({ id, cand: K.fresh, at: H(-3), panel: [P.p1] }), dueRow(A, P.p1, K.fresh, id)]));
    const dr = due(W.p1, deep, {}, PAGE);
    const d = listed('250 DONE rows, then 3 owed (paged)', dr);
    expect.soft([sorted(ids(d)), d.more], '250 DONE rows first: the 3 owed are listed, more false').toEqual([sorted(owed3), false]);
    expect.soft(awsOf(dr).filter((c: any) => c.op === 'Query' && listPks({ calls: [c] } as any).length).length, 'the list Query is followed page after page (six pages)').toBeGreaterThanOrEqual(6);
    // 100 DONE rows, then 205 owed, paged: at most 200 and at least 195, more true.
    const big2 = withRows(withRows(world(), doneFirst(100)), many.flatMap((id, i) => [interviewRow({ id, cand: K.fresh, at: H(-3 - (i % 7)), panel: [P.p1], type: 'TECHNICAL' }), dueRow(A, P.p1, K.fresh, id)]));
    const m2 = listed('100 DONE, then 205 owed (paged)', due(W.p1, big2, {}, PAGE));
    expect.soft([m2.items.length <= 200, m2.items.length >= 195, m2.more], 'paged 205 owed: at most 200 (at least 195), more true').toEqual([true, true, true]);
    // 100 DONE rows, then exactly 200 owed, then 100 more DONE rows, paged: all 200, more false.
    const exact2 = withRows(withRows(withRows(world(), doneFirst(100)), many.slice(0, 200).flatMap((id) => [interviewRow({ id, cand: K.fresh, at: H(-3), panel: [P.p1] }), dueRow(A, P.p1, K.fresh, id)])),
      Array.from({ length: 100 }, (_x, i) => dueRow(A, P.p1, K.fresh, iv(7000 + i), 'DONE')));
    const e2 = listed('exactly 200 owed among DONE rows (paged)', due(W.p1, exact2, {}, PAGE));
    expect.soft([e2.items.length, e2.more], 'paged, exactly 200 owed: 200 items, more false').toEqual([200, false]);
  });

  // ---------------------------------------------------------------- AC-10

  test('AC-10 Nothing leaks: no key outside rule 5, no id, email, token, note, place or link in any answer; no person id, candidate id, name, token or email in a log; the read never writes; a failing read is 500 with the error name only', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const G = token(401);
    const ivL = iv(1100);
    const ivO = iv(1101);
    let t = withIv(world(), { id: ivL, cand: K.book, at: PAST, panel: [P.p1, P.p2, P.p3], guest: G, note: NEVER.note });
    t = withIv(t, { id: ivO, cand: K.fresh, at: PAST, panel: [P.p1, P.p2], where: 'ONLINE' });
    t = withRows(t, [
      ...openRows(K.book, ivL, [P.p1, P.p2, P.p3]), ...openRows(K.fresh, ivO, [P.p1, P.p2]),
      voteRow(K.book, ivL, P.p2, { scores: { technical: 5, communication: 5 } }), voteRow(K.fresh, ivO, P.p2),
    ]);
    const before = structuredClone(t);
    const runs: [string, Run][] = [['p1', due(W.p1, t)], ['p3', due(W.p3, t)], ['p2', due(W.p2, t)], ['recU', due(W.recU, t)], ['B', due(pB, t)], ['D', due({ ...W.p1, company: 'D' as any }, t)]];
    expect.soft(sorted(ids(listed('p1', runs[0]![1]))), 'control: p1 owes both').toEqual(sorted([ivL, ivO]));
    const saga = rowsOf(t, TABLE.state).find((x) => x['PK'] === `CANDIDATE#${K.book}` && x['SK'] === 'SAGA')!;
    const forbidden = [
      K.book, K.fresh, P.p1, P.p2, P.p3, SUB.recA, REC_U, A, B, G, hashOf(G), NEVER.guestEmail, NEVER.note, NEVER.place, NEVER.link, NEVER.comment,
      String(saga['email'] ?? 'zz-none'), String(saga['phone'] ?? 'zz-none'), String(saga['idNumber'] ?? 'zz-none'), 'STRONG_YES', 'scores', 'panel',
    ].filter((x) => x && x !== 'zz-none');
    const names = [String(saga['firstName']), String(saga['lastName']), 'Fresh', 'Thandi', 'Mokoena', 'Sizwe', 'Ndlovu', 'Lindiwe'];
    const allowed = new Set(['items', 'more', ...ITEM_KEYS]);
    for (const [who, r] of runs) {
      const { keys, values } = walk(bodyOf(r));
      expect.soft(keys.filter((k) => !allowed.has(k) && !(statusOf(r) !== 200 && k === 'error')), `${who}: no key outside rule 5`).toEqual([]);
      const text = JSON.stringify(bodyOf(r) ?? '');
      expect.soft(forbidden.filter((x) => text.includes(x)), `${who}: no id, company, token, email, note, place, link, vote or panel in the answer`).toEqual([]);
      expect.soft(values.filter((v) => /@/.test(v)), `${who}: no email address`).toEqual([]);
      const logs = logsOf(r).join('\n');
      expect.soft([...forbidden, ...names].filter((x) => logs.includes(x)), `${who}: no person id, candidate id, name, token or email in a log line`).toEqual([]);
      expect.soft(dbWritesOf(r).map((c: any) => c.op), `${who}: the read makes no write call`).toEqual([]);
      expect.soft(awsOf(r).filter((c: any) => /^(events|sqs|ses|lambda|sfn)$/i.test(c.service)).length, `${who}: no event, message or email`).toBe(0);
      expect.soft(JSON.stringify(r.tables), `${who}: no table changes`).toBe(JSON.stringify(before));
    }
    // A failing read: 500 {"error":"Internal error"}, and the log line names the error only.
    for (const [ops, nth] of [[['Query'], 1], [['Query'], 2], [['GetItem'], 2], [['GetItem'], 3]] as [string[], number][]) {
      const f = due(W.p1, t, {}, { fail: { service: 'dynamodb', ops, nth, message: `boom for ${K.book} ${ivL} ${P.p1}`, name: 'ProvisionedThroughputExceededException' } });
      expect.soft([statusOf(f), bodyOf(f)], `${ops[0]} #${nth} fails: 500 Internal error (${describe(f)})`).toEqual([500, { error: 'Internal error' }]);
      const logs = logsOf(f).join('\n');
      expect.soft(logs, `${ops[0]} #${nth} fails: the error name is logged`).toContain('ProvisionedThroughputExceededException');
      expect.soft([K.book, ivL, P.p1, 'boom', ...names].filter((x) => logs.includes(x)), `${ops[0]} #${nth} fails: no id, name or error message in the logs`).toEqual([]);
      expect.soft(dbWritesOf(f).length, `${ops[0]} #${nth} fails: nothing is written`).toBe(0);
    }
  });

  // ---------------------------------------------------------------- AC-11

  test('AC-11 Nothing else moves: one new route on submit_vote with JWT; no IAM, Lambda or state table change; no table item in Terraform', async ({}, testInfo) => {
    once(testInfo.project.name);
    const base = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-ui-03-tasks', 'iam-83e606c.json'), 'utf8')) as { roles: Record<string, string>; integration: string; stateTable: string; policies: Record<string, string[]> };
    const all = blocks(filesOf('talent-flow-infra'), 'resource');
    const squash = (v: string | undefined) => (v ?? '').replace(/["\s]/g, '');
    const hash = (s: string) => createHash('sha256').update(s.replace(/\s+/g, ' ').trim()).digest('hex');
    const routes = all.filter((b) => b.labels[0] === 'aws_apigatewayv2_route');
    const mine = routes.filter((b) => squash(attributes(b.body).get('route_key')) === squash(ROUTE_DUE));
    expect(mine.map((b) => b.labels[1]), 'the route is declared once, named get_feedback_due').toEqual(['get_feedback_due']);
    const a = attributes(mine[0]!.body);
    expect.soft(/integrations\/\$\{aws_apigatewayv2_integration\.submit_vote\.id\}/.test(a.get('target') ?? ''), 'on submit_vote\'s integration').toBe(true);
    expect.soft(squash(a.get('authorization_type')), 'JWT').toBe('JWT');
    expect.soft(a.get('authorizer_id') ?? '', 'the TalentFlow API\'s Cognito authorizer').toMatch(/aws_apigatewayv2_authorizer\.talent_flow_api_cognito\.id/);
    expect.soft(a.get('api_id') ?? '', 'on the TalentFlow API').toMatch(/aws_apigatewayv2_api\.talent_flow_api\.id/);
    const integ = all.filter((b) => b.labels[0] === 'aws_apigatewayv2_integration' && b.labels[1] === 'submit_vote');
    expect.soft(integ.map((b) => hash(b.body)), 'submit_vote\'s integration is as on develop').toEqual([base.integration]);
    for (const [fn, role] of Object.entries(base.roles)) {
      const f = all.find((b) => b.labels[0] === 'aws_lambda_function' && b.labels[1] === fn);
      expect.soft((attributes(f?.body ?? '').get('role') ?? '').trim(), `${fn} keeps its role`).toBe(role);
    }
    const lines = policyLines();
    const now = Object.fromEntries(Object.keys(base.policies).map((k) => [k, lines[k]?.pairs ?? [`(unreadable or gone) ${lines[k]?.squash ?? ''}`]]));
    expect.soft(now, 'submitVote\'s, scheduleInterview\'s and submitVoteByToken\'s policies are as on develop (no new grant)').toEqual(base.policies);
    const extra = Object.entries(lines).filter(([k, p]) => !(k in base.policies) && (/^(submit_vote|schedule_interview)/.test(p.role) || /scheduleInterview|submitVote/.test(p.role))).map(([k]) => k);
    expect.soft(extra, 'no new policy on those roles').toEqual([]);
    const state = all.filter((b) => b.labels[0] === 'aws_dynamodb_table' && b.labels[1] === 'talent_flow_state');
    expect.soft(state.map((b) => hash(b.body)), 'the state table is as on develop (no new index, no TTL)').toEqual([base.stateTable]);
    for (const stack of ['infra', 'talent-flow-infra']) {
      const items = blocks(filesOf(stack), 'resource').filter((b) => b.labels[0] === 'aws_dynamodb_table_item').map((b) => b.labels[1]);
      expect.soft(items, `${stack}: no aws_dynamodb_table_item (Terraform never manages table data)`).toEqual([]);
    }
  });

  test('AC-11b Paperwork: the API file describes the route like GET /v1/interviews/{id} and documents 403; routes-match-openapi passes; the company walk has a list row; openapi.d.ts is regenerated', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(120_000);
    let out = '';
    let code = 0;
    try { out = execFileSync('node', [join(REPO, 'scripts', 'ci', 'routes-match-openapi.mjs')], { cwd: REPO, encoding: 'utf8' }); } catch (e: any) { code = e.status ?? 1; out = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
    expect.soft([code, out.slice(-400)], 'routes-match-openapi.mjs passes').toEqual([0, out.slice(-400)]);
    const op = operation(doc(), ROUTE_DUE);
    expect(Boolean(op), `api/openapi.yaml describes ${ROUTE_DUE}`).toBe(true);
    const sib = operation(doc(), 'GET /v1/interviews/{id}');
    expect.soft(op.security, 'security as GET /v1/interviews/{id}').toEqual(sib.security);
    expect.soft(op['x-tenant'], 'x-tenant: token').toBe('token');
    expect.soft(sorted(op['x-roles'] ?? []), 'x-roles as GET /v1/interviews/{id}').toEqual(sorted(sib['x-roles'] ?? []));
    expect.soft(Boolean(op.responses?.['403']), 'documents 403').toBe(true);
    const s200 = answerSchema(doc(), ROUTE_DUE, 200) as any;
    expect.soft(sorted(Object.keys(s200?.properties ?? {})), 'the 200 answer: items and more').toEqual(['items', 'more']);
    const itemSchema = s200?.properties?.items?.items;
    expect.soft(sorted(Object.keys(itemSchema?.properties ?? itemSchema?.$ref ?? {})), 'an item lists exactly rule 5\'s keys').toEqual(ITEM_KEYS);
    // A wrong answer fails the schema (the schema is not open-ended).
    const wrong = { items: [{ kind: 'INTERVIEW_FEEDBACK', interview_id: 'x', candidate_first: 'a', candidate_last: 'b', role_title: null, type: 'TECHNICAL', at: NOW, due_at: NOW, candidate_id: 'CAND-X' }], more: false };
    expect.soft(checker(doc()).check(s200, wrong).length, 'an item with a candidate_id does not pass the schema').toBeGreaterThan(0);
    const rows = JSON.parse(readFileSync(join(REPO, 'scripts', 'tenancy', 'ten-04-rows.json'), 'utf8')) as Record<string, any>;
    expect.soft(rows[ROUTE_DUE], 'ten-04-rows.json: a list row').toEqual({ kind: 'list' });
    const types = readFileSync(join(REPO, 'pepla-web', 'src', 'app', 'core', 'api', 'openapi.d.ts'), 'utf8');
    expect.soft(types.includes('"/v1/feedback-due"'), 'openapi.d.ts holds the route (regenerated)').toBe(true);
  });

  // ---------------------------------------------------------------- AC-12

  test('AC-12 Backfill: dry run by default; with --apply only OPEN rows for SCHEDULED interviews\' panel people who have not scored, never over an existing row; counts only; safe to run twice', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    expect(existsSync(BACKFILL), 'scripts/tenancy/backfill-feedback-due.py exists').toBe(true);
    const text = readFileSync(BACKFILL, 'utf8');
    expect.soft(/modules/i.test(text), 'the file does not contain the word "modules" (mod-01 AC-7)').toBe(false);
    const S = (v: string) => ({ S: v });
    const L = (xs: string[]) => ({ L: xs.map(S) });
    const ivItem = (cand: string, id: string, panel: string[], status = 'SCHEDULED', company: string | null = A, extra: Record<string, any> = {}) => ({
      PK: S(`CANDIDATE#${cand}`), SK: S(`INTERVIEW#${id}`), interviewId: S(id), candidateId: S(cand), status: S(status), scheduledAt: S(PAST),
      panelMemberIds: L(panel), ...(company ? { tenant_id: S(company) } : {}), ...extra,
    });
    const vote = (cand: string, sk: string, id: string, company = A) => ({ PK: S(`CANDIDATE#${cand}`), SK: S(sk), interviewId: S(id), tenant_id: S(company) });
    const [i1, i2, i3, i4, i5, i6, i7] = [iv(1201), iv(1202), iv(1203), iv(1204), iv(1205), iv(1206), iv(1207)];
    const guestHash = hashOf(token(402));
    const existing = { PK: S(duePk(A, P.p1)), SK: S(dueSk(K.fresh, i6)), tenant_id: S(A), person_id: S(P.p1), interview_id: S(i6), candidate_id: S(K.fresh), state: S('DONE'), done_reason: S('VOTED'), updated_at: S('2026-11-20T08:00:00.000Z') };
    const rows = [
      { PK: S(`CANDIDATE#${K.book}`), SK: S('SAGA'), tenant_id: S(A), firstName: S('Booked'), lastName: S('Person'), email: S('booked.person@example.test') },
      // i1: p1 owes; p2 voted (new); p3 voted the old way (VOTE#p3#<time> with this interviewId); a guest link.
      ivItem(K.book, i1, [P.p1, P.p2, P.p3], 'SCHEDULED', A, { guest_link_hash: S(guestHash) }),
      vote(K.book, `VOTE#${P.p2}#${i1}`, i1), vote(K.book, `VOTE#${P.p3}#2026-11-20T10:00:00.000Z`, i1), vote(K.book, `VOTE#GUEST#${guestHash.slice(0, 16)}#${H(-1)}#${i1}`, i1),
      // p1's old vote on another interview does not count for i1.
      vote(K.book, `VOTE#${P.p1}#2026-11-19T10:00:00.000Z`, i7),
      // i2: only a VOTED# guard row for p1.
      ivItem(K.book, i2, [P.p1, P.p2]), { PK: S(`CANDIDATE#${K.book}`), SK: S(`VOTED#${i2}#${P.p1}`), tenant_id: S(A) },
      // i3 COMPLETED, i4 CANCELLED: nothing. i5: no tenant_id: nothing.
      ivItem(K.book, i3, [P.p1], 'COMPLETED'), ivItem(K.book, i4, [P.p1], 'CANCELLED'), ivItem(K.fresh, i5, [P.p1], 'SCHEDULED', null),
      // i6: p1 already has a DONE row: never touched; p2 gets one.
      ivItem(K.fresh, i6, [P.p1, P.p2]), existing,
      // Company B's interview: its own company's row.
      ivItem(K.bee, i7, [P.pB], 'SCHEDULED', B),
      { PK: S('SCORING_LINK#' + guestHash), SK: S('META'), guest_email: S(NEVER.guestEmail), tenant_id: S(A), interview_id: S(i1) },
    ];
    const tables = { 'talent-flow-state': rows };
    const want = [
      [duePk(A, P.p1), dueSk(K.book, i1)], [duePk(A, P.p2), dueSk(K.book, i2)], [duePk(A, P.p2), dueSk(K.fresh, i6)], [duePk(B, P.pB), dueSk(K.bee, i7)],
    ].map((x) => x.join(' ')).sort();
    const dueOfRun = (r: PyRun) => (r.tables['talent-flow-state'] ?? []).map((x: any) => plain(x)).filter((x) => String(x['PK']).startsWith('FEEDBACK_DUE#'));
    const secrets = [K.book, K.fresh, K.bee, i1, i2, i3, i4, i5, i6, i7, P.p1, P.p2, P.p3, P.pB, A, B, 'Booked', 'booked.person@example.test', NEVER.guestEmail, guestHash.slice(0, 16)];
    const leaks = (r: PyRun) => secrets.filter((x) => `${r.stdout}\n${r.stderr}`.includes(x));
    const writes = (r: PyRun) => r.calls.filter((c) => /^(PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems)$/.test(c.op));

    // No --table: refuses, no AWS call.
    const noTable = runBackfill(tables, ['--apply']);
    expect.soft(noTable.code, `no --table: exits non-zero (${noTable.stderr.slice(-300)})`).not.toBe(0);
    expect.soft(noTable.calls.length, 'no --table: no AWS call').toBe(0);
    // Dry run (the default): reads, writes nothing, prints counts only.
    const dry = runBackfill(tables, ['--table', 'talent-flow-state']);
    expect.soft(dry.code, `dry run exits 0 (${dry.stderr.slice(-400)})`).toBe(0);
    expect.soft(writes(dry).map((c) => c.op), 'dry run: no write call').toEqual([]);
    expect.soft(dueOfRun(dry).length, 'dry run: no new row').toBe(1);
    expect.soft(/\d/.test(dry.stdout), 'dry run prints counts').toBe(true);
    expect.soft(leaks(dry), 'dry run: no id, name or email in its output').toEqual([]);
    expect.soft(dry.calls.filter((c) => c.op === 'Scan').length, 'it reads the table with Scan (following pages)').toBeGreaterThan(1);
    // --apply (no --profile: the dev workflow has none).
    const run = runBackfill(tables, ['--table', 'talent-flow-state', '--apply']);
    expect.soft(run.code, `--apply exits 0 (${run.stderr.slice(-400)})`).toBe(0);
    const got = dueOfRun(run);
    expect.soft(got.filter((x) => x['state'] === 'OPEN').map((x) => `${x['PK']} ${x['SK']}`).sort(), 'OPEN rows exactly for the unscored panel people of SCHEDULED interviews with a company').toEqual(want);
    for (const x of got.filter((y) => y['state'] === 'OPEN')) {
      const [, company, person] = String(x['PK']).split('#');
      const [, cand, , id] = String(x['SK']).split('#');
      expect.soft({ ...x, updated_at: typeof x['updated_at'] === 'string' && Number.isFinite(Date.parse(String(x['updated_at']))) ? 'ISO' : x['updated_at'] }, `${x['PK']}: rule 1's fields`)
        .toEqual({ PK: x['PK'], SK: x['SK'], tenant_id: company, person_id: person, interview_id: id, candidate_id: cand, state: 'OPEN', updated_at: 'ISO' });
      expect.soft(INDEX_NAMES.filter((n) => n in x), `${x['PK']}: no index key`).toEqual([]);
    }
    expect.soft(got.find((x) => x['PK'] === duePk(A, P.p1) && x['SK'] === dueSk(K.fresh, i6)), 'the existing DONE row is untouched').toEqual(plain(existing as any));
    expect.soft(got.filter((x) => String(x['PK']).includes('GUEST')).length, 'no row for a guest').toBe(0);
    const ops = writes(run);
    expect.soft([...new Set(ops.map((c) => c.op))], 'it writes with put_item only').toEqual(['PutItem']);
    expect.soft(ops.every((c) => /attribute_not_exists\s*\(\s*PK\s*\)/.test(String(c.params['ConditionExpression'] ?? ''))), 'every put is conditional on attribute_not_exists(PK)').toBe(true);
    expect.soft(leaks(run), '--apply: no id, name or email in its output').toEqual([]);
    // Again: nothing more.
    const again = runBackfill(run.tables, ['--table', 'talent-flow-state', '--apply']);
    expect.soft(again.code, `the second run exits 0 (${again.stderr.slice(-400)})`).toBe(0);
    expect.soft(JSON.stringify(dueOfRun(again)), 'the second run writes nothing').toBe(JSON.stringify(got));
    expect.soft(leaks(again), 'the second run: no id in its output').toEqual([]);
    // A named profile and region are taken too.
    const prof = runBackfill(tables, ['--table', 'talent-flow-state', '--profile', 'pepla-dev', '--region', 'af-south-1']);
    expect.soft(prof.code, `--profile and --region are accepted (${prof.stderr.slice(-300)})`).toBe(0);
    expect.soft(writes(prof).length, 'and without --apply it still writes nothing').toBe(0);
  });

  // ---------------------------------------------------------------- AC-14

  test('AC-14 pepla-dev seed (text check): seed-dev.py puts back each width\'s feedback-due set and the not-started one every run, seeds nothing for company B and no guest, and runs the backfill', async ({}, testInfo) => {
    once(testInfo.project.name);
    const seed = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    const all = devIdsAll();
    expect.soft(sorted(Object.keys(all)), 'dev-ids.json: one set per width and the not-started one').toEqual(['desktop-1280', 'future', 'phone-390']);
    for (const d of Object.values(all) as DevIds[]) expect.soft(sorted(Object.keys(d)), 'each set names candidate, names and interview').toEqual(['candidate', 'firstName', 'interview', 'lastName']);
    const fns = [...seed.matchAll(/^def (\w+)\([\s\S]*?(?=^def |^if __name__)/gm)].map((m) => ({ name: m[1]!, body: m[0] }));
    const fn = fns.find((f) => f.name === 'seed_feedback_due');
    expect(fn, 'seed-dev.py has seed_feedback_due').toBeTruthy();
    const body = fn!.body;
    expect.soft(/rec-ui-03-tasks["'\s/,]*dev-ids\.json/.test(body), 'it reads support/rec-ui-03-tasks/dev-ids.json').toBe(true);
    for (const p of ['"VOTE#"', '"VOTED#"']) expect.soft(body.includes(p), `it removes the ${p} rows`).toBe(true);
    expect.soft(/delete_item\(/.test(body) && /begins_with\(SK/.test(body), 'it deletes them by prefix').toBe(true);
    // Put back every run: a dev run's vote leaves the rows DONE, so a put "only if missing" would keep them DONE and AC-13 would go red
    // on every later run. The seed writes them plainly: no condition, and no read first to decide whether to write.
    expect.soft(/(?<!Key)ConditionExpression/.test(body), 'its puts carry no condition (the rows go back to OPEN every run)').toBe(false);
    expect.soft(/get_item\(/.test(body), 'it does not read a row first to decide whether to put it back').toBe(false);
    for (const f of ['"SCHEDULED"', 'votesSubmitted', 'PANEL_FEEDBACK_PENDING_COUNT', 'criteria_snapshot', 'panelMemberIds', 'tenant_id', 'FEEDBACK_DUE#', '"OPEN"', 'interview_id', 'candidate_id', 'person_id'])
      expect.soft(body.includes(f), `it writes ${f}`).toBe(true);
    expect.soft(/SECOND_TENANT_ID|WALK_TENANT|guest_email|guest_link_hash|SCORING_LINK/.test(body), 'it seeds nothing for company B and no guest').toBe(false);
    expect.soft(/\binterviewId\b(?=["']\s*:\s*\{"S":\s*f?"FEEDBACK)|"interviewId":\s*\{[^}]*\}\s*,\s*"person_id"/.test(body), 'no feedback-due row carries interviewId').toBe(false);
    const main = seed.slice(seed.indexOf('def main('));
    expect.soft(/\bseed_feedback_due\(\s*ddb\s*,/.test(main), 'main() calls seed_feedback_due').toBe(true);
    // In the code itself, not only in a docstring or a comment.
    const code = seed.replace(/"""[\s\S]*?"""/g, '').replace(/^\s*#.*$/gm, '').replace(/\s{2}# .*$/gm, '');
    expect.soft(/backfill-feedback-due\.py/.test(code), 'seed-dev.py runs scripts/tenancy/backfill-feedback-due.py (named in its code)').toBe(true);
    const card = readFileSync(join(__dirname, 'cards', 'rec-ui-03-tasks.md'), 'utf8');
    expect.soft(card, 'the card notes name the dev seed contract').toContain('REC-UI-03 tasks dev seed');
    expect.soft(existsSync(DEV_IDS_FILE), 'dev-ids.json exists').toBe(true);
  });

  // ---------------------------------------------------------------- AC-13 (pepla-dev)

  test('AC-13 The test logins on pepla-dev: the panel login\'s list holds this width\'s started interview and not the later one; after its vote it is gone from that list and still on HR\'s @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1 to AC-10.');
    test.setTimeout(3 * 60_000);
    const all = devIdsAll();
    const mineIds = all[testInfo.project.name as 'desktop-1280' | 'phone-390'];
    expect(mineIds, `dev-ids.json has a set for ${testInfo.project.name}`).toBeTruthy();
    const api = await devApi(page, ['E2E_EMP', 'E2E_HR']);
    const list = async (who: string) => {
      const r = await api(who, 'GET', '/v1/feedback-due');
      expect(r.status, `${who} reads the list (${r.text.slice(0, 200)})`).toBe(200);
      return ((r.json?.items ?? []) as any[]).map((i) => i.interview_id as string);
    };
    const before = await list('E2E_EMP');
    expect.soft(before, 'the panel login\'s list contains this width\'s started interview').toContain(mineIds.interview);
    expect.soft(before, 'and not the one that starts in 7 days').not.toContain(all.future.interview);
    // Vote through the real route with the interview's own criteria.
    const one = await api('E2E_EMP', 'GET', `/v1/interviews/${encodeURIComponent(mineIds.interview)}`);
    expect(one.status, `the panel login reads the interview (${one.text.slice(0, 200)})`).toBe(200);
    const keys = ((one.json?.criteria ?? []) as any[]).map((c) => c.key as string);
    expect(keys.length, 'it has criteria').toBeGreaterThan(0);
    const v = await api('E2E_EMP', 'POST', `/v1/interviews/${encodeURIComponent(mineIds.interview)}/votes`, { scores: Object.fromEntries(keys.map((k) => [k, 4])), rating: 'YES' });
    expect(v.status, `the vote is saved on real AWS (${v.text.slice(0, 300)})`).toBe(201);
    expect.soft(await list('E2E_EMP'), 'after the vote: gone from the panel login\'s list').not.toContain(mineIds.interview);
    expect.soft(await list('E2E_HR'), 'still on HR\'s list (HR is on the panel and has not voted)').toContain(mineIds.interview);
  });

  test('AC-13 The company B walk on pepla-dev: company B\'s login gets a list without any company A interview @pepla-dev', async ({ page }, testInfo) => {
    // The dev workflow runs titles with "company B walk on pepla-dev" in its "Company walk (TEN-04)" step (E2E_HR_B is the walk company
    // with Recruitment on there); the main run leaves them out.
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-7.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(2 * 60_000);
    const all = devIdsAll();
    const api = await devApi(page, ['E2E_HR_B']);
    const r = await api('E2E_HR_B', 'GET', '/v1/feedback-due');
    expect(r.status, `company B's login reads its list (${r.text.slice(0, 200)})`).toBe(200);
    const got = ((r.json?.items ?? []) as any[]).map((i) => i.interview_id as string);
    for (const d of Object.values(all) as DevIds[]) expect.soft(got, `no company A interview (${d.interview})`).not.toContain(d.interview);
    expect.soft(r.text.includes(all['desktop-1280'].candidate) || r.text.includes(all['phone-390'].candidate), 'no company A candidate id').toBe(false);
  });
});

/** Signs the named dev logins in at Cognito and returns a caller of pepla-dev's TalentFlow API (as INT-01 AC-18 and REC-UI-03 AC-3.8 do). */
async function devApi(page: any, prefixes: string[]) {
  const env = (k: string) => process.env[k] ?? '';
  const logins = prefixes.map((p) => ({ p, email: env(`${p}_EMAIL`), password: env(`${p}_PASSWORD`) }));
  for (const l of logins) expect(l.email && l.password, `the ${l.p} test login is set`).toBeTruthy();
  const { devEnv } = await import('./support/ten-02/dev');
  const { region, clientId } = devEnv();
  const appEnv = readFileSync(join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts'), 'utf8');
  const tfApi = (/talentFlowApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(appEnv)?.[1] ?? '').replace(/\/+$/, '').replace(/\/v1$/, '');
  expect(tfApi, 'pepla-web\'s talentFlowApiUrl points at pepla-dev\'s TalentFlow API').toMatch(/^https:\/\/[^/]+\.execute-api\./);
  const tokens: Record<string, string> = {};
  for (const l of logins) {
    const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
      data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: l.email, PASSWORD: l.password } }),
    });
    expect(r.status(), `${l.p} signs in at Cognito`).toBe(200);
    tokens[l.p] = ((await r.json()) as any).AuthenticationResult.IdToken as string;
  }
  return async (who: string, method: string, path: string, body?: unknown) => {
    const r = await page.request.fetch(`${tfApi}${path}`, { method, headers: { Authorization: `Bearer ${tokens[who]}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { data: JSON.stringify(body) } : {}) });
    const text = await r.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: r.status() as number, text, json };
  };
}

void K01;
