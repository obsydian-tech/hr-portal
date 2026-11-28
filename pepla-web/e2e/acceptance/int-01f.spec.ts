import { readFileSync } from 'node:fs';
import { isRec062Grant, isRec09Policy } from './support/rec-09.1/grants'; // child lock rec-09.1 (REC-09), on top of int-01f.2 (REC-06.2)
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO } from './support/rec-14/lambda-harness';
import { answerSchema, checker, readDoc, type Doc } from './support/rec-14/schema';
import { lambdaNamed, policyLines } from './support/rec-04/iam';
import { C } from './support/rec-04/callers';
import {
  A, B, H, IDEM_TABLE, K, NEVER, NOW, P, REC_U, ROUTE, TABLE, W, act, book, bodyOf, busOf, changed, describe, guardsOf, guestRead, guestVote,
  guestVoter, hashOf, ivOf, ivsOf, linkOf, linkRow, linksOf, logsOf, newKey, plusDays, read, rowsOf, sqsOf, statusOf, token, vote, voteBody, voteRow,
  votesOf, withDecider, withIv, withRows, world, awsOf, type Caller, type IvSpec, type O, type Req, type Run, type Tables,
} from './support/int-01/world';
import { fireRun, fires, keyRows, withHooks, withKeyRows, type Hook } from './support/int-01f/world';

/**
 * INT-01.F · Interview server leftovers (red). Jira NH-281. Spec: /mnt/project-files/specs/interview-journey/cards/INT-01.F.md (rules 1
 * to 6, decisions INT-01F-D1 to D9), with its check INT-01.F-spec-check.md (round 1, every item applied). Review page:
 * /mnt/project-files/specs/interview-journey/cards/INT-01.F-tests-for-review.md (the bar). Notes for the builder: cards/int-01f.md.
 *
 * The tests run the real handlers (lambda/scheduleInterview, lambda/submitVote, lambda/submitVoteByToken) in a fresh Node process for each
 * call, against REC-14's fake AWS over INT-01's world (support/int-01/world.ts, unchanged), at INT-01's fixed time NOW (2026-11-23 12:00
 * UTC) or a time a test names. support/int-01f/hooks.mjs (test support only) runs a second request, or changes a row directly, at a chosen
 * DynamoDB call, on each of several matching calls, and can make one watched call fail. Terraform is read as text. Nothing calls AWS or
 * any AI. Nothing here has a screen width: each test runs once, at 1280. AC-9 runs on pepla-dev only, after merge.
 *
 * Expected red before merge: AC-1 to AC-7. Must stay green: AC-8 (and every older suite it names, run as a proof, not in this file).
 *
 * Pinned by the test writer where the spec is silent (each is in cards/int-01f.md for the BA to confirm):
 *  - F-T1 "The single expired answer" is 410 { error: 'Scoring link has expired' } exactly (REC-07's answer).
 *  - F-T2 A refusal's body is exactly the body the code has today: 403 { error: 'Forbidden' }; 400 { error, code: 'INVALID_FIELD', field };
 *    409 { error: 'Conflict', code }; a 404 is judged on its status only.
 *  - F-T3 "Applied once" is judged on the row (sequence raised once, one interview, one link row), as rule 3.7 says.
 *  - F-T4 "A request key stays RUNNING" is made by making finish()'s write fail (the write that stores answer_body): the request still
 *    answers as normal, and the key row is the RUNNING row reserve() wrote (started_at = the time of the run).
 *  - F-T5 "No answer, event or log line holds pending_interview_id": no answer, event or log line holds that key name; no log line and
 *    no take-over answer holds the id's value (the booking's own 201 answer carries the interview id, which is the same value).
 *  - F-T6 A take-over that finds the row taken over by someone else in between (both read it stale) is 409 KEY_IN_USE exactly.
 *  - F-T7 After a take-over, the row a late first request finds is the taker's: the first request's finish() changes nothing (the row
 *    keeps the taker's started_at and status).
 *  - F-T8 The 64-character name is still a plain field name and comes back in `field` (the pattern allows 1 + 63 characters).
 *  - F-T9 AC-4's done write is found by the text completed_by in its input (INT-01 AC-9 pins completed_by: 'SYSTEM').
 *  - F-T10 An interview booked the old way (no sequence) that loses its votes' copy to a raw write of `sequence` is not done either
 *    (rule 2.5: the attribute_not_exists form).
 *  - F-T11 On an old-way interview (no sequence), the guest vote's attribute_not_exists form is shown by the write count: a first
 *    sequence written in the gap makes the first vote write fail and the vote is retried once (two vote writes, one vote). A guest taken
 *    off always has the old link stopped in the same reschedule, so that case is refused by expires_at before the sequence clause counts.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const REASON: Record<number, string> = { 400: 'Bad request', 403: 'Forbidden', 404: 'Not found', 409: 'Conflict' };
const EXPIRED = { error: 'Scoring link has expired' };
const iv = (n: number) => `1a7e3000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PAST = H(-1);
const FUT = H(24);
const NOW_MS = Date.parse(NOW);
const at = (seconds: number) => new Date(NOW_MS + seconds * 1000).toISOString();
const P4 = REC_U;
const PB_CALLER: Caller = C.panelB;
const zoned = (iso: string) => new Date(Date.parse(iso) + 2 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, '+02:00');
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const sorted = <T>(a: Iterable<T>) => [...a].sort();
const REMOVED = ['removed_panel_ids', 'removed_guest_link_hash', 'removed_at_sequence'];

const bookBody = (o: Record<string, unknown> = {}) => clean({ type: 'TECHNICAL', at: zoned(H(48)), length_minutes: 60, where: 'IN_PERSON', place: NEVER.place, panel: [P.p1, P.p2], ...o });
const RES = (o: Record<string, unknown> = {}) => ({ action: 'reschedule', ...o });
const CANCEL = (o: Record<string, unknown> = {}) => ({ action: 'cancel', reason: 'CANDIDATE_ASKED', ...o });
const DNH = (o: Record<string, unknown> = {}) => ({ action: 'did_not_happen', reason: 'CANDIDATE_DID_NOT_COME', ...o });
const DONE = (o: Record<string, unknown> = {}) => ({ action: 'complete', reason: 'FEEDBACK_GIVEN_ANOTHER_WAY', ...o });
const w = (...ivs: (IvSpec | [IvSpec, { expires?: string; used?: string | null }])[]) => ivs.reduce<Tables>((t, x) => (Array.isArray(x) ? withIv(t, x[0], x[1]) : withIv(t, x)), world());
const actReq = (who: Caller, cand: string, id: string, body: unknown, key?: string): Req => ({ route: ROUTE.act, who, path: { id: cand, interviewId: id }, body, ...(key ? { headers: { 'Idempotency-Key': key } } : {}) });
const bookReq = (who: Caller, cand: string, body: unknown, key: string): Req => ({ route: ROUTE.book, who, path: { id: cand }, body, headers: { 'Idempotency-Key': key } });

// ---------------------------------------------------------------- reading answers

let docCache: Doc | undefined;
const doc = () => (docCache ??= readDoc());
const fits = (route: string, r: Run, label: string) => {
  const s = statusOf(r);
  const out = s === undefined ? [`no answer (${describe(r)})`] : [403, 404, 500].includes(s) ? [] : checker(doc()).check(answerSchema(doc(), route, s), bodyOf(r)).map((p) => `${route} ${s}: ${p}`);
  expect.soft(out, `${label}: the answer passes api/openapi.yaml`).toEqual([]);
  return r;
};
function refused(r: Run, status: number, code: string | undefined, field: string | undefined, label: string) {
  expect.soft(statusOf(r), `${label}: ${status} ${code ?? ''}${field ? ` ${field}` : ''} (got ${describe(r)})`).toBe(status);
  const want = status === 403 ? { error: 'Forbidden' } : { error: REASON[status], ...(code ? { code } : {}), ...(field ? { field } : {}) };
  expect.soft(bodyOf(r), `${label}: the body is exactly ${JSON.stringify(want)} (F-T2)`).toEqual(want);
}
const expired = (r: Run, label: string) => {
  expect.soft(statusOf(r), `${label}: the single expired answer, 410 (got ${describe(r)})`).toBe(410);
  expect.soft(bodyOf(r), `${label}: its body (F-T1)`).toEqual(EXPIRED);
};
const ok = (r: Run, status: number, label: string) => { expect(statusOf(r), `${label}: ${status} (got ${describe(r)})`).toBe(status); return bodyOf(r) as any; };
const ivEvents = (r: { calls: any[] }) => busOf(r).filter((e: any) => e.source === 'talent-flow.interviews');
const readOk = (who: Caller, cand: string, t: Tables, label: string) => { const r = fits(ROUTE.read, read(who, cand, t), label); return ok(r, 200, label); };
const ivIn = (b: any, id: string) => ((b?.interviews ?? []) as any[]).find((x) => x?.id === id);
const guests = (x: any) => ((x?.panel ?? []) as any[]).filter((e) => e?.kind === 'GUEST');
const blank = (v: unknown) => v === undefined || v === null;
/** The fields of the interview row this card adds (absent ones as undefined). */
const removedOf = (t: Tables, cand: string, id: string) => { const r = ivOf(t, cand, id); return { removed_panel_ids: r?.['removed_panel_ids'], removed_guest_link_hash: r?.['removed_guest_link_hash'], removed_at_sequence: r?.['removed_at_sequence'] }; };
const none = { removed_panel_ids: undefined, removed_guest_link_hash: undefined, removed_at_sequence: undefined };
/** Everything a request gave anyone: its answer, its bus events, its queue messages and its log lines, as one text. */
const outward = (r: Run) => [r.response?.body ?? '', JSON.stringify(busOf(r)), JSON.stringify(sqsOf(r)), logsOf(r).join('\n')].join('\n');
/** The vote's own leftovers on an interview: VOTE# and VOTED# rows of `voter`, votesSubmitted, status. */
const voteState = (t: Tables, cand: string, id: string, voter: string) => ({
  votes: votesOf(t, cand, id).filter((v) => v['voterId'] === voter).length, guards: guardsOf(t, cand).filter((g) => String(g['SK']).endsWith(`#${voter}`) && String(g['SK']).includes(id)).length,
  votesSubmitted: ivOf(t, cand, id)?.['votesSubmitted'], status: ivOf(t, cand, id)?.['status'],
});
/** The fire's answer was the one this test wanted (the hook really ran in between). */
const fired = (r: Run, i: number, status: number, label: string) => expect.soft(statusOf(fireRun(r, i)), `${label}: the request in between answered ${status} (${describe(fireRun(r, i))})`).toBe(status);
const doneEvents = (r: Run) => ivEvents(r).filter((e: any) => e.detailType === 'INTERVIEW_DONE');

// ---------------------------------------------------------------- request-key helpers

/** finish()'s write (the one that stores answer_body) fails, so the key row stays as reserve() wrote it (F-T4). */
const FAIL_FINISH: Hook = { when: 'before', match: 'answer_body', table: IDEM_TABLE, runs: [{ fail: true }] };
const stuck = (o: O = {}) => withHooks([FAIL_FINISH], o);
const keyRow = (t: Tables) => { const rows = keyRows(t); return rows.length === 1 ? rows[0] : { count: rows.length }; };

test.describe('INT-01.F · Interview server leftovers', () => {
  // ---------------------------------------------------------------- control

  test('Control: the hooks fire where asked (a second request between a read and a write, a raw row change, a failed write, a later clock) and are inert otherwise', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = w({ id: iv(1), cand: K.book, at: FUT });
    const plainRun = act(W.recruiter, K.book, iv(1), RES({ length_minutes: 45 }), t);
    expect(statusOf(plainRun), `a plain reschedule works on develop (${describe(plainRun)})`).toBe(200);
    const inert = act(W.recruiter, K.book, iv(1), RES({ length_minutes: 45 }), t, withHooks([]));
    expect.soft([statusOf(inert), fires(inert).length], 'no hook: the same answer and no fire').toEqual([200, 0]);
    const raw = act(W.recruiter, K.book, iv(1), RES({ length_minutes: 45 }), t, withHooks([{ when: 'before', match: `INTERVIEW#${iv(1)}`, table: TABLE.state, runs: [{ raw: { table: TABLE.state, key: { PK: `CANDIDATE#${K.book}`, SK: `INTERVIEW#${iv(1)}` }, set: { sequence: 9 } } }] }]));
    expect.soft([fires(raw).length, statusOf(raw), ivOf(raw.tables, K.book, iv(1))?.['sequence']], 'a raw write of sequence between the read and the write: the reschedule loses (409), the row keeps 9').toEqual([1, 409, 9]);
    const second = actReq(W.recU, K.book, iv(1), RES({ place: 'zz-int01f-control-room' }));
    const two = act(W.recruiter, K.book, iv(1), RES({ length_minutes: 45 }), t, withHooks([{ when: 'after', match: `INTERVIEW#${iv(1)}`, table: TABLE.state, times: 1, runs: [{ req: second, now: at(60) }] }]));
    expect.soft([statusOf(two), statusOf(fireRun(two, 0)), ivOf(two.tables, K.book, iv(1))?.['sequence']], 'a second request after the write, a minute later: both 200, sequence 3').toEqual([200, 200, 3]);
    const k = newKey();
    const s = book(W.recruiter, K.book, bookBody(), w(), stuck({ key: k }));
    expect.soft([statusOf(s), keyRow(s.tables)?.['status']], 'finish()\'s write fails: the answer is still 201 and the key stays RUNNING').toEqual([201, 'RUNNING']);
  });

  // ---------------------------------------------------------------- AC-1 Removed people recorded

  test('AC-1 A reschedule records the panel people and the guest it took off, for the latest reschedule only; a reorder records nobody; cancel, did not happen and mark as done leave the fields', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(101);
    const t = w({ id: iv(1), cand: K.fresh, at: PAST, guest: G });
    // p1, p2, p3 to p1, p4.
    const r1 = act(W.recruiter, K.fresh, iv(1), RES({ panel: [P.p1, P4] }), t);
    ok(r1, 200, 'p1, p2, p3 to p1, p4');
    expect.soft(ivOf(r1.tables, K.fresh, iv(1))?.['panelMemberIds'], 'the new panel').toEqual([P.p1, P4]);
    expect.soft(removedOf(r1.tables, K.fresh, iv(1)), 'removed_panel_ids = [p2, p3] in their old order, removed_at_sequence = the new sequence 2, no guest removed').toEqual({ removed_panel_ids: [P.p2, P.p3], removed_guest_link_hash: undefined, removed_at_sequence: 2 });
    // A place change only: every removed field goes (D2: the latest reschedule only).
    const r2 = act(W.recruiter, K.fresh, iv(1), RES({ place: 'zz-int01f-room-2' }), r1.tables);
    ok(r2, 200, 'a place change only');
    expect.soft(removedOf(r2.tables, K.fresh, iv(1)), 'a reschedule that removes nobody removes all three fields').toEqual(none);
    // The guest taken off.
    const r3 = act(W.recruiter, K.fresh, iv(1), RES({ guest_email: null }), r2.tables);
    ok(r3, 200, 'the guest taken off');
    expect.soft(removedOf(r3.tables, K.fresh, iv(1)), 'removed_guest_link_hash = the old link\'s hash, removed_at_sequence 4, no removed_panel_ids').toEqual({ removed_panel_ids: undefined, removed_guest_link_hash: hashOf(G), removed_at_sequence: 4 });
    const r4 = act(W.recruiter, K.fresh, iv(1), RES({ length_minutes: 45 }), r3.tables);
    ok(r4, 200, 'a length change after the guest was taken off');
    expect.soft(removedOf(r4.tables, K.fresh, iv(1)), 'the next reschedule that keeps everyone clears removed_guest_link_hash too (D2)').toEqual(none);
    // Guest A replaced by guest B.
    const G2 = token(102);
    const u = w({ id: iv(2), cand: K.fresh, at: PAST, guest: G2 });
    const rb = act(W.recruiter, K.fresh, iv(2), RES({ guest_email: NEVER.guestEmail2 }), u);
    ok(rb, 200, 'guest A replaced by guest B');
    expect.soft(removedOf(rb.tables, K.fresh, iv(2)), 'removed_guest_link_hash = A\'s hash, removed_at_sequence 2 (S-8)').toEqual({ removed_panel_ids: undefined, removed_guest_link_hash: hashOf(G2), removed_at_sequence: 2 });
    expect.soft(ivOf(rb.tables, K.fresh, iv(2))?.['guest_link_hash'], 'B has a new link').not.toBe(hashOf(G2));
    // Panel and guest at once.
    const both = act(W.recruiter, K.fresh, iv(2), RES({ panel: [P.p2], guest_email: null }), u);
    ok(both, 200, 'p1 and p3 and the guest taken off at once');
    expect.soft(removedOf(both.tables, K.fresh, iv(2)), 'both recorded, one removed_at_sequence').toEqual({ removed_panel_ids: [P.p1, P.p3], removed_guest_link_hash: hashOf(G2), removed_at_sequence: 2 });
    // A reorder of the same people records nobody, and clears what an earlier reschedule recorded.
    const ro = act(W.recruiter, K.fresh, iv(1), RES({ panel: [P4, P.p1] }), r1.tables);
    ok(ro, 200, 'a reorder of p1, p4');
    expect.soft(removedOf(ro.tables, K.fresh, iv(1)), 'a reorder records nobody (and clears the earlier record)').toEqual(none);
    const ro2 = act(W.recruiter, K.fresh, iv(3), RES({ panel: [P.p3, P.p2, P.p1] }), w({ id: iv(3), cand: K.fresh, at: PAST }));
    ok(ro2, 200, 'a reorder of p1, p2, p3');
    expect.soft(removedOf(ro2.tables, K.fresh, iv(3)), 'a reorder records nobody').toEqual(none);
    // An interview booked the old way: removed_at_sequence is the new sequence, 1.
    const old = act(W.recruiter, K.fresh, iv(4), RES({ panel: [P.p1, P.p2] }), w({ id: iv(4), cand: K.fresh, at: PAST, sequence: null }));
    ok(old, 200, 'an old-way interview loses p3');
    expect.soft(removedOf(old.tables, K.fresh, iv(4)), 'old-way row: [p3], removed_at_sequence 1').toEqual({ removed_panel_ids: [P.p3], removed_guest_link_hash: undefined, removed_at_sequence: 1 });
    // Rule 1.5: did not happen and mark as done (after the start) and cancel (before it) leave the fields as they are.
    for (const [label, body] of [['did not happen', DNH()], ['mark as done', DONE()]] as [string, unknown][]) {
      const x = act(W.recruiter, K.fresh, iv(1), body, r1.tables);
      ok(x, 200, label);
      expect.soft(removedOf(x.tables, K.fresh, iv(1)), `${label} leaves the removed fields`).toEqual({ removed_panel_ids: [P.p2, P.p3], removed_guest_link_hash: undefined, removed_at_sequence: 2 });
    }
    const fut = act(W.recruiter, K.fresh, iv(5), RES({ panel: [P.p1, P.p2] }), w({ id: iv(5), cand: K.fresh, at: FUT }));
    ok(fut, 200, 'a future interview loses p3');
    const cn = act(W.recruiter, K.fresh, iv(5), CANCEL(), fut.tables);
    ok(cn, 200, 'then it is cancelled');
    expect.soft(removedOf(cn.tables, K.fresh, iv(5)), 'cancel leaves the removed fields (removed_at_sequence stays 2 while sequence is 3)').toEqual({ removed_panel_ids: [P.p3], removed_guest_link_hash: undefined, removed_at_sequence: 2 });
  });

  test('AC-1 The removed fields stay on the row: not in the answer, the read, the bus event or any log line; a replay writes nothing more; company B\'s Recruiter gets 404 and nothing is written', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(103);
    const t = w({ id: iv(1), cand: K.fresh, at: PAST, guest: G });
    const key = newKey();
    const r = act(W.recruiter, K.fresh, iv(1), RES({ panel: [P.p1], guest_email: null }), t, { key });
    ok(r, 200, 'p2, p3 and the guest taken off');
    expect.soft(removedOf(r.tables, K.fresh, iv(1)).removed_panel_ids, 'the row has them').toEqual([P.p2, P.p3]);
    const text = outward(r);
    for (const [label, needle] of [['removed_', 'removed_'], ['p2\'s id', P.p2], ['p3\'s id', P.p3], ['the removed link\'s hash', hashOf(G)], ['the removed guest\'s email', NEVER.guestEmail]] as [string, string][]) {
      expect.soft(text.includes(needle), `${label}: not in the answer, the event, the queue or a log line`).toBe(false);
    }
    expect.soft(ivEvents(r).map((e: any) => sorted(Object.keys(e.detail ?? {}))), 'the event keeps R-23\'s exact keys').toEqual([['actor', 'candidateId', 'interviewId', 'interviewType', 'sequence', 'tenant_id']]);
    for (const [label, who] of [['the Recruiter', W.recruiter], ['the decider', W.hm], ['p1', W.p1]] as [string, Caller][]) {
      const b = readOk(who, K.fresh, r.tables, `${label}'s read`);
      const s = JSON.stringify(b);
      expect.soft([s.includes('removed_'), s.includes(P.p2), s.includes(P.p3), s.includes(hashOf(G))], `${label}'s read: no removed_ key, no removed id, no removed hash`).toEqual([false, false, false, false]);
    }
    // A replay with the same key: the first answer, nothing more written.
    const again = act(W.recruiter, K.fresh, iv(1), RES({ panel: [P.p1], guest_email: null }), r.tables, { key });
    expect.soft([statusOf(again), bodyOf(again)], 'the replay gives the first answer').toEqual([200, bodyOf(r)]);
    expect.soft(changed(r.tables, again.tables, true), 'the replay writes nothing (request keys included)').toEqual([]);
    expect.soft(busOf(again).length, 'the replay sends nothing').toBe(0);
    // Company B.
    const b = act(W.recruiterB, K.fresh, iv(1), RES({ panel: [P.p1] }), t);
    expect.soft(statusOf(b), `company B's Recruiter: 404 (got ${describe(b)})`).toBe(404);
    expect.soft(changed(t, b.tables, true), 'company B: nothing written, no request key either').toEqual([]);
    expect.soft(busOf(b).length, 'company B: nothing sent').toBe(0);
  });

  // ---------------------------------------------------------------- AC-2 A removed person's vote does not land

  test('AC-2 A panel person taken off between the vote\'s read and its write gets 403, and on their behalf 400 on_behalf_of; nothing of the vote is written and the interview is not done', async ({}, testInfo) => {
    once(testInfo.project.name);
    const base = w({ id: iv(1), cand: K.book, at: PAST });
    const offP3 = actReq(W.recU, K.book, iv(1), RES({ panel: [P.p1, P.p2] }));
    const hook = (voter: string): Hook[] => [{ when: 'before', match: `VOTE#${voter}`, runs: [{ req: offP3 }] }];
    const own = vote(W.p3, iv(1), voteBody(), base, withHooks(hook(P.p3)));
    fired(own, 0, 200, 'p3\'s own vote');
    refused(own, 403, undefined, undefined, 'p3 votes after being taken off');
    expect.soft(voteState(own.tables, K.book, iv(1), P.p3), 'no VOTE#, no VOTED#, votesSubmitted 0, still SCHEDULED').toEqual({ votes: 0, guards: 0, votesSubmitted: 0, status: 'SCHEDULED' });
    expect.soft(doneEvents(own).length, 'no INTERVIEW_DONE').toBe(0);
    const hr = vote(W.recruiter, iv(1), voteBody({ on_behalf_of: P.p3 }), base, withHooks(hook(P.p3)));
    fired(hr, 0, 200, 'HR on behalf of p3');
    refused(hr, 400, 'INVALID_FIELD', 'on_behalf_of', 'HR enters p3\'s vote after p3 was taken off');
    expect.soft(voteState(hr.tables, K.book, iv(1), P.p3), 'on behalf: nothing written').toEqual({ votes: 0, guards: 0, votesSubmitted: 0, status: 'SCHEDULED' });
    // The last vote that would have made it done: p1 and p2 have voted, p3 is taken off before p3's vote lands.
    const two = withRows(w({ id: iv(2), cand: K.fresh, at: PAST, votesSubmitted: 2 }), [voteRow(K.fresh, iv(2), P.p1), voteRow(K.fresh, iv(2), P.p2)]);
    // A reschedule is refused once anyone has voted (HAS_FEEDBACK), so p3 is taken off by a raw panel change, as no request can.
    const rawOff: Hook[] = [{ when: 'before', match: `VOTE#${P.p3}`, runs: [{ raw: { table: TABLE.state, key: { PK: `CANDIDATE#${K.fresh}`, SK: `INTERVIEW#${iv(2)}` }, set: { panelMemberIds: [P.p1, P.p2], sequence: 2 } } }] }];
    const last = vote(W.p3, iv(2), voteBody(), two, withHooks(rawOff));
    refused(last, 403, undefined, undefined, 'the would-be last vote after p3 was taken off');
    expect.soft(voteState(last.tables, K.fresh, iv(2), P.p3), 'nothing written, votesSubmitted still 2, not done').toEqual({ votes: 0, guards: 0, votesSubmitted: 2, status: 'SCHEDULED' });
    expect.soft(doneEvents(last).length, 'no INTERVIEW_DONE').toBe(0);
    // An interview booked the old way (no sequence): a reschedule that takes p3 off writes the first sequence, so only the
    // attribute_not_exists form of the clause (rule 2) can stop p3's vote. Done here by a raw write of what that reschedule leaves.
    const old = w({ id: iv(3), cand: K.book, type: 'PHONE_SCREEN', at: PAST, sequence: null });
    const oldOff: Hook[] = [{ when: 'before', match: `VOTE#${P.p3}`, runs: [{ raw: { table: TABLE.state, key: { PK: `CANDIDATE#${K.book}`, SK: `INTERVIEW#${iv(3)}` }, set: { panelMemberIds: [P.p1, P.p2], sequence: 1 } } }] }];
    for (const [label, who, body, want] of [['p3 on an old-way interview', W.p3, voteBody(), [403]], ['HR on behalf of p3 on an old-way interview', W.recruiter, voteBody({ on_behalf_of: P.p3 }), [400, 'INVALID_FIELD', 'on_behalf_of']]] as [string, Caller, unknown, [number, string?, string?]][]) {
      const o = vote(who, iv(3), body, old, withHooks(oldOff));
      expect.soft(fires(o).length, `${label}: the raw write ran`).toBe(1);
      refused(o, want[0], want[1], want[2], label);
      expect.soft(voteState(o.tables, K.book, iv(3), P.p3), `${label}: no VOTE#, no VOTED#, votesSubmitted 0, still SCHEDULED`).toEqual({ votes: 0, guards: 0, votesSubmitted: 0, status: 'SCHEDULED' });
      expect.soft(doneEvents(o).length, `${label}: no INTERVIEW_DONE`).toBe(0);
    }
  });

  test('AC-2 A guest taken off, or whose link stops, between the read and the write gets the single expired answer; nothing written and the link not used', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(104);
    const base = w({ id: iv(1), cand: K.book, at: PAST, guest: G });
    const offGuest = actReq(W.recU, K.book, iv(1), RES({ guest_email: null }));
    const g = guestVote(G, voteBody(), base, withHooks([{ when: 'before', match: guestVoter(G), runs: [{ req: offGuest }] }]));
    fired(g, 0, 200, 'the guest taken off');
    expired(g, 'the guest votes after being taken off');
    expect.soft(voteState(g.tables, K.book, iv(1), guestVoter(G)), 'no VOTE#, no VOTED#, votesSubmitted 0, SCHEDULED').toEqual({ votes: 0, guards: 0, votesSubmitted: 0, status: 'SCHEDULED' });
    expect.soft(blank(linkOf(g.tables, G)?.['used_at']), 'the link is not marked used').toBe(true);
    // Only the link's expires_at moves into the past (sequence unchanged): the expires_at > now clause alone stops it.
    const linkKey = { PK: `SCORING_LINK#${hashOf(G)}`, SK: 'META' };
    const e = guestVote(G, voteBody(), base, withHooks([{ when: 'before', match: guestVoter(G), runs: [{ raw: { table: TABLE.state, key: linkKey, set: { expires_at: H(-0.5) } } }] }]));
    expect.soft(fires(e).length, 'the raw write ran').toBe(1);
    expired(e, 'the link stopped between the read and the write');
    expect.soft(voteState(e.tables, K.book, iv(1), guestVoter(G)), 'nothing written').toEqual({ votes: 0, guards: 0, votesSubmitted: 0, status: 'SCHEDULED' });
    expect.soft([blank(linkOf(e.tables, G)?.['used_at']), ivOf(e.tables, K.book, iv(1))?.['sequence']], 'the link not used; sequence unchanged (1)').toEqual([true, 1]);
    expect.soft(doneEvents(e).length + doneEvents(g).length, 'no INTERVIEW_DONE').toBe(0);
    // An interview booked the old way (no sequence) gains its first sequence in the gap (a reschedule that keeps the guest, F-T11). Taking
    // the guest off always stops the old link too, so the expires_at clause refuses that first; what only the attribute_not_exists form
    // (rule 2) shows is that the first vote write is refused and judged again once on the strong copy: two vote writes, one vote stored.
    const OG = token(114);
    const old = w({ id: iv(3), cand: K.fresh, type: 'PHONE_SCREEN', at: PAST, guest: OG, sequence: null });
    const firstSeq = { raw: { table: TABLE.state, key: { PK: `CANDIDATE#${K.fresh}`, SK: `INTERVIEW#${iv(3)}` }, set: { sequence: 1 } } };
    const o = guestVote(OG, voteBody(), old, withHooks([{ when: 'before', match: guestVoter(OG), times: 2, runs: [firstSeq, firstSeq] }]));
    ok(o, 200, 'old-way: the guest is kept, so the vote lands after one retry');
    expect.soft(fires(o).length, 'old-way: two vote writes (the first refused by attribute_not_exists(sequence), retried once)').toBe(2);
    expect.soft(voteState(o.tables, K.fresh, iv(3), guestVoter(OG)), 'old-way: one VOTE#, one VOTED#, votesSubmitted 1').toEqual({ votes: 1, guards: 1, votesSubmitted: 1, status: 'SCHEDULED' });
  });

  test('AC-2 Company B: B\'s panel member on A\'s interview 404; a B link pointing at A\'s interview the expired answer; a strong copy that turns out to be another company\'s 404 (signed-in) or the expired answer (guest); nothing written', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(105);
    const GB = token(106);
    const base = withRows(w({ id: iv(1), cand: K.book, at: PAST, guest: G }), [linkRow(GB, K.book, iv(1), PAST, { company: B })]);
    const pb = vote(PB_CALLER, iv(1), voteBody(), base);
    expect.soft(statusOf(pb), `B's panel member: 404 (got ${describe(pb)})`).toBe(404);
    expect.soft(changed(base, pb.tables), 'nothing written').toEqual([]);
    const bl = guestVote(GB, voteBody(), base);
    expired(bl, 'a company B link pointing at A\'s interview');
    expect.soft(changed(base, bl.tables), 'nothing written').toEqual([]);
    const blr = guestRead(GB, base);
    expired(blr, 'the guest read with that link');
    expect.soft(JSON.stringify(bodyOf(blr)).includes(iv(1)), 'it never shows A\'s interview').toBe(false);
    // The interview row turns out to be company B's between the read and the write (a raw change; no request can do it).
    const toB: Hook[] = [{ when: 'before', match: 'votesSubmitted', table: TABLE.state, runs: [{ raw: { table: TABLE.state, key: { PK: `CANDIDATE#${K.book}`, SK: `INTERVIEW#${iv(1)}` }, set: { tenant_id: B, tenantId: B } } }] }];
    const p1 = vote(W.p1, iv(1), voteBody(), base, withHooks(toB));
    expect.soft(fires(p1).length, 'the raw write ran').toBe(1);
    expect.soft(statusOf(p1), `the retry's strong copy is another company's: 404 (got ${describe(p1)})`).toBe(404);
    expect.soft(voteState(p1.tables, K.book, iv(1), P.p1), 'nothing written').toEqual({ votes: 0, guards: 0, votesSubmitted: 0, status: 'SCHEDULED' });
    const gv = guestVote(G, voteBody(), base, withHooks(toB));
    expect.soft(fires(gv).length, 'the raw write ran (guest)').toBe(1);
    expired(gv, 'the guest whose interview turned out to be another company\'s');
    expect.soft([voteState(gv.tables, K.book, iv(1), guestVoter(G)).votes, blank(linkOf(gv.tables, G)?.['used_at'])], 'nothing written, link not used').toEqual([0, true]);
  });

  // ---------------------------------------------------------------- AC-3 A kept person's vote retries once

  test('AC-3 A reschedule that keeps the voter lands in between: the vote retries once and is stored once; one that moves the start into the future gives 409 NOT_STARTED; two in a row give 409 NOT_ALLOWED_NOW and the expired answer', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(107);
    const base = w({ id: iv(1), cand: K.book, at: PAST, guest: G });
    const place = (n: number) => actReq(W.recU, K.book, iv(1), RES({ place: `zz-int01f-room-${n}` }));
    const later = actReq(W.recU, K.book, iv(1), RES({ at: zoned(H(2)) }));
    const panelHook = (runs: Req[], times = 1): Hook[] => [{ when: 'before', match: `VOTE#${P.p1}`, times, runs: runs.map((req) => ({ req })) }];
    const guestHook = (runs: Req[], times = 1): Hook[] => [{ when: 'before', match: guestVoter(G), times, runs: runs.map((req) => ({ req })) }];
    // A place change in between.
    const p = vote(W.p1, iv(1), voteBody(), base, withHooks(panelHook([place(1)])));
    fired(p, 0, 200, 'the place change');
    fits(ROUTE.vote, p, 'the kept panel person');
    ok(p, 201, 'the kept panel person\'s vote');
    expect.soft(voteState(p.tables, K.book, iv(1), P.p1), 'stored once, counted once').toEqual({ votes: 1, guards: 1, votesSubmitted: 1, status: 'SCHEDULED' });
    expect.soft(ivOf(p.tables, K.book, iv(1))?.['sequence'], 'sequence 2 (the reschedule\'s)').toBe(2);
    const g = guestVote(G, voteBody(), base, withHooks(guestHook([place(2)])));
    fired(g, 0, 200, 'the place change (guest)');
    fits(ROUTE.guestVote, g, 'the kept guest');
    ok(g, 200, 'the kept guest\'s vote');
    expect.soft(voteState(g.tables, K.book, iv(1), guestVoter(G)), 'stored once, counted once').toEqual({ votes: 1, guards: 1, votesSubmitted: 1, status: 'SCHEDULED' });
    expect.soft(linkOf(g.tables, G)?.['used_at'], 'the link is used now').toBe(NOW);
    // The start moved into the future in between.
    const pl = vote(W.p1, iv(1), voteBody(), base, withHooks(panelHook([later])));
    fired(pl, 0, 200, 'the start moved');
    refused(pl, 409, 'NOT_STARTED', undefined, 'the panel person after the start moved into the future');
    expect.soft(voteState(pl.tables, K.book, iv(1), P.p1), 'nothing written').toEqual({ votes: 0, guards: 0, votesSubmitted: 0, status: 'SCHEDULED' });
    const gl = guestVote(G, voteBody(), base, withHooks(guestHook([later])));
    fired(gl, 0, 200, 'the start moved (guest)');
    refused(gl, 409, 'NOT_STARTED', undefined, 'the guest after the start moved into the future (S-2)');
    expect.soft([voteState(gl.tables, K.book, iv(1), guestVoter(G)).votes, blank(linkOf(gl.tables, G)?.['used_at'])], 'nothing written, the link not used').toEqual([0, true]);
    // Two reschedules that keep the voter, one before each try.
    const p2 = vote(W.p1, iv(1), voteBody(), base, withHooks(panelHook([place(3), place(4)], 2)));
    expect.soft(fires(p2).map((f) => f.response?.statusCode), 'both reschedules landed, one before each try (the retry sent the write again)').toEqual([200, 200]);
    refused(p2, 409, 'NOT_ALLOWED_NOW', undefined, 'the panel person after two reschedules');
    expect.soft(voteState(p2.tables, K.book, iv(1), P.p1), 'nothing written').toEqual({ votes: 0, guards: 0, votesSubmitted: 0, status: 'SCHEDULED' });
    expect.soft(ivOf(p2.tables, K.book, iv(1))?.['sequence'], 'sequence 3').toBe(3);
    const g2 = guestVote(G, voteBody(), base, withHooks(guestHook([place(5), place(6)], 2)));
    expect.soft(fires(g2).map((f) => f.response?.statusCode), 'both reschedules landed (guest)').toEqual([200, 200]);
    expired(g2, 'the guest after two reschedules');
    expect.soft([voteState(g2.tables, K.book, iv(1), guestVoter(G)).votes, voteState(g2.tables, K.book, iv(1), guestVoter(G)).guards, blank(linkOf(g2.tables, G)?.['used_at'])], 'nothing written, the link not used').toEqual([0, 0, true]);
  });

  // ---------------------------------------------------------------- AC-4 Done uses the same copy

  test('AC-4 Done by itself is judged on the copy the vote was written against: a sequence moved between the last vote and the done write leaves it SCHEDULED with no INTERVIEW_DONE (panel, guest, old-way row); without that, done as INT-01 AC-9 says', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(108);
    const ivKey = (cand: string, id: string) => ({ PK: `CANDIDATE#${cand}`, SK: `INTERVIEW#${id}` });
    const moveSeq = (cand: string, id: string, to: number): Hook[] => [{ when: 'before', match: 'completed_by', table: TABLE.state, runs: [{ raw: { table: TABLE.state, key: ivKey(cand, id), set: { sequence: to } } }] }];
    // The last panel vote.
    const t = withRows(w({ id: iv(1), cand: K.book, at: PAST, votesSubmitted: 2 }), [voteRow(K.book, iv(1), P.p1), voteRow(K.book, iv(1), P.p2)]);
    const ctl = vote(W.p3, iv(1), voteBody(), t);
    ok(ctl, 201, 'control: the last vote');
    expect.soft([ivOf(ctl.tables, K.book, iv(1))?.['status'], doneEvents(ctl).length], 'control: COMPLETED, one INTERVIEW_DONE').toEqual(['COMPLETED', 1]);
    const r = vote(W.p3, iv(1), voteBody(), t, withHooks(moveSeq(K.book, iv(1), 5)));
    ok(r, 201, 'the last vote, sequence moved before the done write');
    expect.soft(fires(r).length, 'the done write was tried and the raw write ran first (F-T9)').toBe(1);
    expect.soft([ivOf(r.tables, K.book, iv(1))?.['status'], ivOf(r.tables, K.book, iv(1))?.['votesSubmitted'], doneEvents(r).length], 'SCHEDULED, the vote counted, no INTERVIEW_DONE').toEqual(['SCHEDULED', 3, 0]);
    // The guest's last vote.
    const tg = withRows(w({ id: iv(2), cand: K.fresh, at: PAST, guest: G, votesSubmitted: 3 }), [voteRow(K.fresh, iv(2), P.p1), voteRow(K.fresh, iv(2), P.p2), voteRow(K.fresh, iv(2), P.p3)]);
    const gc = guestVote(G, voteBody(), tg);
    ok(gc, 200, 'control: the guest\'s last vote');
    expect.soft([ivOf(gc.tables, K.fresh, iv(2))?.['status'], doneEvents(gc).length], 'control: COMPLETED, one INTERVIEW_DONE').toEqual(['COMPLETED', 1]);
    const gr = guestVote(G, voteBody(), tg, withHooks(moveSeq(K.fresh, iv(2), 5)));
    ok(gr, 200, 'the guest\'s last vote, sequence moved before the done write');
    expect.soft([fires(gr).length, ivOf(gr.tables, K.fresh, iv(2))?.['status'], doneEvents(gr).length], 'SCHEDULED, no INTERVIEW_DONE').toEqual([1, 'SCHEDULED', 0]);
    // An interview booked the old way (no sequence): a sequence appearing before the done write stops it too (F-T10).
    const to = withRows(w({ id: iv(3), cand: K.book, type: 'PHONE_SCREEN', at: PAST, sequence: null, votesSubmitted: 2 }), [voteRow(K.book, iv(3), P.p1), voteRow(K.book, iv(3), P.p2)]);
    const oc = vote(W.p3, iv(3), voteBody(), to);
    ok(oc, 201, 'control: the last vote on an old-way row');
    expect.soft(ivOf(oc.tables, K.book, iv(3))?.['status'], 'control: COMPLETED').toBe('COMPLETED');
    const or = vote(W.p3, iv(3), voteBody(), to, withHooks(moveSeq(K.book, iv(3), 1)));
    ok(or, 201, 'the last vote on an old-way row, a sequence written before the done write');
    expect.soft([fires(or).length, ivOf(or.tables, K.book, iv(3))?.['status'], doneEvents(or).length], 'SCHEDULED, no INTERVIEW_DONE').toEqual([1, 'SCHEDULED', 0]);
  });

  // ---------------------------------------------------------------- AC-5 Stale request keys

  test('AC-5 A RUNNING key 121 seconds old with the same body is taken over and runs; 119 seconds is KEY_IN_USE; a different body KEY_REUSED; no started_at KEY_IN_USE; reserve() stores started_at and the booking id; every finished row keeps tenant_id', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const t = w();
    const k = newKey();
    const body = bookBody({ guest_email: NEVER.guestEmail });
    // The first run's finish() fails: the key stays as reserve() wrote it (F-T4).
    const first = book(W.recruiter, K.book, body, t, stuck({ key: k }));
    const fb = ok(first, 201, 'the first booking (its finish() write fails)');
    const row = keyRow(first.tables);
    expect.soft({ status: row?.['status'], started_at: row?.['started_at'], tenant_id: row?.['tenant_id'], pending_interview_id: row?.['pending_interview_id'] }, 'the RUNNING row: started_at = the run\'s time in ms, tenant_id A, pending_interview_id = the booked id').toEqual({ status: 'RUNNING', started_at: NOW_MS, tenant_id: A, pending_interview_id: fb?.interview_id });
    // A run whose action never happened (the same RUNNING row over a world without the booking): taken over at 121 s, it books with that id.
    const fresh = withKeyRows(t, keyRows(first.tables));
    const run = book(W.recruiter, K.book, body, fresh, { key: k, now: at(121) });
    const rb = ok(run, 201, 'taken over at 121 seconds: runs and answers as normal');
    expect.soft(rb?.interview_id, 'the take-over books with pending_interview_id').toBe(fb?.interview_id);
    expect.soft([ivsOf(run.tables, K.book).length, linksOf(run.tables).length, ivEvents(run).map((e: any) => e.detailType)], 'one interview, one link, one INTERVIEW_BOOKED').toEqual([1, 1, ['INTERVIEW_BOOKED']]);
    const done = keyRow(run.tables);
    expect.soft([done?.['status'], done?.['tenant_id']], 'the taken-over row is finished DONE and keeps tenant_id').toEqual(['DONE', A]);
    const replay = book(W.recruiter, K.book, body, run.tables, { key: k, now: at(130) });
    expect.soft([statusOf(replay), bodyOf(replay)], 'after the take-over the key replays its answer').toEqual([201, rb]);
    // 119 seconds: still in use.
    const young = book(W.recruiter, K.book, body, fresh, { key: k, now: at(119) });
    refused(young, 409, 'KEY_IN_USE', undefined, '119 seconds old');
    expect.soft(changed(fresh, young.tables, true), '119 seconds: nothing written, the key row unchanged').toEqual([]);
    // Stale with another body.
    const other = book(W.recruiter, K.book, bookBody({ guest_email: NEVER.guestEmail, length_minutes: 90 }), fresh, { key: k, now: at(121) });
    refused(other, 409, 'KEY_REUSED', undefined, 'stale with a different body');
    expect.soft(changed(fresh, other.tables, true), 'a different body: nothing written, the key row unchanged').toEqual([]);
    // No started_at (a row written before this card).
    const legacy = withKeyRows(t, keyRows(first.tables).map((x) => ({ ...x, started_at: undefined })));
    const lr = book(W.recruiter, K.book, body, legacy, { key: k, now: at(3600) });
    refused(lr, 409, 'KEY_IN_USE', undefined, 'a RUNNING row with no started_at, an hour later');
    expect.soft(changed(legacy, lr.tables, true), 'no started_at: nothing written').toEqual([]);
    // Every finished row keeps tenant_id: a plain 2xx (DONE), a refused request (RELEASED), an action.
    const plainRun = book(W.recruiter, K.fresh, bookBody(), t);
    ok(plainRun, 201, 'a plain booking');
    const refusedRun = book(W.recruiter, K.fresh, bookBody({ length_minutes: 10 }), t);
    const actRun = act(W.recruiter, K.book, iv(1), CANCEL(), w({ id: iv(1), cand: K.book, at: FUT }));
    for (const [label, r, status] of [['a 201', plainRun, 'DONE'], ['a 400', refusedRun, 'RELEASED'], ['a cancel', actRun, 'DONE']] as [string, Run, string][]) {
      const x = keyRow(r.tables);
      expect.soft([x?.['status'], x?.['tenant_id']], `${label}: the finished row keeps tenant_id`).toEqual([status, A]);
    }
    // pending_interview_id stays on the key row (F-T5).
    for (const [label, r] of [['the first booking', first], ['the take-over', run], ['119 seconds', young], ['another body', other]] as [string, Run][]) {
      expect.soft(outward(r).includes('pending_interview_id'), `${label}: no answer, event, queue message or log line names pending_interview_id`).toBe(false);
      expect.soft(logsOf(r).join('\n').includes(String(fb?.interview_id)), `${label}: no log line holds the id`).toBe(false);
    }
  });

  test('AC-5 Take-overs after the action ran: a booking (even after a cancel) is 409 TYPE_ALREADY_BOOKED with one interview and one link; a reschedule 400 action and a cancel 409 NOT_CANCELLABLE with sequence raised once', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const t = w();
    const k = newKey();
    const body = bookBody({ guest_email: NEVER.guestEmail });
    const first = book(W.recruiter, K.book, body, t, stuck({ key: k }));
    const id = String(ok(first, 201, 'the booking (key left RUNNING)')?.interview_id);
    const re = book(W.recruiter, K.book, body, first.tables, { key: k, now: at(121) });
    refused(re, 409, 'TYPE_ALREADY_BOOKED', undefined, 'the take-over 121 seconds later');
    expect.soft([ivsOf(re.tables, K.book).length, linksOf(re.tables).length, ivEvents(first).length + ivEvents(re).length], 'one interview, one link row, one INTERVIEW_BOOKED over both runs').toEqual([1, 1, 1]);
    expect.soft(outward(re).includes(id), 'the take-over\'s answer, events and logs do not hold the booked id (F-T5)').toBe(false);
    // Book, key left RUNNING, the interview cancelled, then the take-over.
    const cn = act(W.recruiter, K.book, id, CANCEL(), first.tables);
    ok(cn, 200, 'the booked interview is cancelled');
    const re2 = book(W.recruiter, K.book, body, cn.tables, { key: k, now: at(121) });
    refused(re2, 409, 'TYPE_ALREADY_BOOKED', undefined, 'the take-over after the cancel (D7)');
    expect.soft([ivsOf(re2.tables, K.book).length, ivOf(re2.tables, K.book, id)?.['status'], linksOf(re2.tables).length, ivEvents(re2).length], 'still one interview (CANCELLED), one link row, no event').toEqual([1, 'CANCELLED', 1, 0]);
    expect.soft(changed(cn.tables, re2.tables), 'the take-over wrote nothing to the state table').toEqual([]);
    // The taker dies too: a second take-over 121 seconds after the first one, after the cancel, while the first taker is still running
    // (it fires just before the first taker's booking write). The row the first taker wrote must still carry the booking id (D7).
    const second: Hook[] = [{ when: 'before', match: 'INTERVIEW#', table: TABLE.state, runs: [{ req: bookReq(W.recruiter, K.book, body, k), now: at(242) }] }];
    const re3 = book(W.recruiter, K.book, body, cn.tables, withHooks(second, { key: k, now: at(121) }));
    expect.soft(fires(re3).length, 'the second take-over ran while the first taker was running').toBe(1);
    refused(fireRun(re3, 0), 409, 'TYPE_ALREADY_BOOKED', undefined, 'the second take-over, 121 seconds after the first, after the cancel');
    refused(re3, 409, 'TYPE_ALREADY_BOOKED', undefined, 'the first taker');
    expect.soft([ivsOf(re3.tables, K.book).length, ivOf(re3.tables, K.book, id)?.['status'], linksOf(re3.tables).length, ivEvents(re3).length], 'second take-over: still one interview (CANCELLED), one link row, no event').toEqual([1, 'CANCELLED', 1, 0]);
    expect.soft(changed(cn.tables, re3.tables), 'neither taker wrote to the state table').toEqual([]);
    // A reschedule applied, its key left RUNNING, taken over.
    const u = w({ id: iv(1), cand: K.book, at: FUT });
    const k2 = newKey();
    const rs = act(W.recruiter, K.book, iv(1), RES({ length_minutes: 45 }), u, stuck({ key: k2 }));
    ok(rs, 200, 'the reschedule (key left RUNNING)');
    expect.soft(keyRow(rs.tables)?.['status'], 'its key is RUNNING').toBe('RUNNING');
    const rs2 = act(W.recruiter, K.book, iv(1), RES({ length_minutes: 45 }), rs.tables, { key: k2, now: at(121) });
    refused(rs2, 400, 'INVALID_FIELD', 'action', 'the reschedule taken over after it was applied');
    expect.soft([ivOf(rs2.tables, K.book, iv(1))?.['sequence'], ivEvents(rs2).length], 'sequence raised once (2), no second event').toEqual([2, 0]);
    // A cancel applied, its key left RUNNING, taken over.
    const k3 = newKey();
    const c1 = act(W.recruiter, K.book, iv(1), CANCEL(), u, stuck({ key: k3 }));
    ok(c1, 200, 'the cancel (key left RUNNING)');
    const c2 = act(W.recruiter, K.book, iv(1), CANCEL(), c1.tables, { key: k3, now: at(121) });
    refused(c2, 409, 'NOT_CANCELLABLE', undefined, 'the cancel taken over after it was applied');
    expect.soft([ivOf(c2.tables, K.book, iv(1))?.['sequence'], ivOf(c2.tables, K.book, iv(1))?.['status'], ivEvents(c2).length], 'sequence raised once (2), CANCELLED, no second event').toEqual([2, 'CANCELLED', 0]);
    for (const [label, r] of [['the booking take-over', re], ['after the cancel', re2], ['the reschedule take-over', rs2], ['the cancel take-over', c2]] as [string, Run][]) {
      expect.soft(keyRow(r.tables)?.['tenant_id'] ?? keyRows(r.tables).every((x) => x['tenant_id'] === A), `${label}: the key rows keep tenant_id`).toBeTruthy();
      expect.soft(keyRows(r.tables).filter((x) => x['tenant_id'] !== A).length, `${label}: every key row is A's`).toBe(0);
    }
  });

  test('AC-5 Two take-overs at once: exactly one runs, the other 409 KEY_IN_USE; a first request that finishes after a take-over does not overwrite the taker\'s row; company B with the same header never reads, takes over or replays A\'s row', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const t = w();
    const k = newKey();
    const body = bookBody();
    const first = book(W.recruiter, K.book, body, t, stuck({ key: k }));
    const fb = ok(first, 201, 'the booking whose key stays RUNNING');
    const fresh = withKeyRows(t, keyRows(first.tables));
    // Two take-overs: the second one reads the stale row after the first one did, and runs to its end in between.
    const same = bookReq(W.recruiter, K.book, body, k);
    const both = book(W.recruiter, K.book, body, fresh, withHooks([{ when: 'after', on: 'read', match: k, table: IDEM_TABLE, runs: [{ req: same, now: at(122) }] }], { key: k, now: at(121) }));
    const second = fireRun(both, 0);
    expect.soft(fires(both).length, 'the second take-over ran in between').toBe(1);
    expect.soft(sorted([statusOf(both), statusOf(second)]), `one runs (201), the other is refused (${describe(both)} / ${describe(second)})`).toEqual([201, 409]);
    refused(statusOf(both) === 409 ? both : second, 409, 'KEY_IN_USE', undefined, 'the loser of two take-overs (F-T6)');
    expect.soft([ivsOf(both.tables, K.book).length, ivEvents(both).length], 'one interview, one INTERVIEW_BOOKED').toEqual([1, 1]);
    // A first request that is still running when another takes its key over: its finish() leaves the taker's row (F-T7).
    const k2 = newKey();
    const late = book(W.recruiter, K.book, body, t, withHooks([{ when: 'before', match: 'answer_body', table: IDEM_TABLE, runs: [{ req: bookReq(W.recruiter, K.book, body, k2), now: at(121) }] }], { key: k2 }));
    const taker = fireRun(late, 0);
    expect.soft(fires(late).length, 'the take-over ran before the first request\'s finish()').toBe(1);
    expect.soft(statusOf(late), `the first request still answers 201 (${describe(late)})`).toBe(201);
    refused(taker, 409, 'TYPE_ALREADY_BOOKED', undefined, 'the take-over finds the first booking already written');
    const kr = keyRow(late.tables);
    expect.soft({ status: kr?.['status'], started_at: kr?.['started_at'], answer_body: kr?.['answer_body'], tenant_id: kr?.['tenant_id'] }, 'the row is the taker\'s (RELEASED after its 409, its started_at), not overwritten by the first request\'s DONE').toEqual({ status: 'RELEASED', started_at: NOW_MS + 121_000, answer_body: undefined, tenant_id: A });
    expect.soft(ivsOf(late.tables, K.book).length, 'one interview').toBe(1);
    // Company B with the same header value.
    const bRun = book(W.recruiterB, K.bee, bookBody({ panel: [P.pB] }), fresh, { key: k, now: at(121) });
    expect.soft(statusOf(bRun), `company B books its own candidate with the same header: 201 (${describe(bRun)})`).toBe(201);
    const aRow = keyRows(fresh).find((x) => x['tenant_id'] === A)!;
    expect.soft(keyRows(bRun.tables).find((x) => x['idempotencyKey'] === aRow['idempotencyKey']), 'A\'s row is unchanged').toEqual(aRow);
    expect.soft(keyRows(bRun.tables).filter((x) => x['tenant_id'] === B).length, 'B has its own key row').toBe(1);
    const touchedA = (r: Run) => awsOf(r).filter((c: any) => c.service === 'dynamodb' && String(c.table ?? '').includes(IDEM_TABLE) && JSON.stringify(c.input ?? {}).includes(`TENANT#${A}`)).length;
    expect.soft(touchedA(bRun), 'B never reads or writes a key of company A').toBe(0);
    const bOnA = book(W.recruiterB, K.book, body, fresh, { key: k, now: at(121) });
    expect.soft(statusOf(bOnA), `B on A's candidate with A's header: 404 (got ${describe(bOnA)})`).toBe(404);
    expect.soft([changed(fresh, bOnA.tables, true), touchedA(bOnA)], 'B on A\'s candidate: nothing written, A\'s key never touched').toEqual([[], 0]);
    expect.soft(String(bodyOf(bOnA) ? JSON.stringify(bodyOf(bOnA)) : '').includes(String(fb?.interview_id)), 'B never sees A\'s answer').toBe(false);
  });

  // ---------------------------------------------------------------- AC-6 The guest's score in the read

  test('AC-6 The guest entry carries vote { rating, overall, on_behalf_by_name: null } for a Recruiter and the decider; not for a hiring manager who does not decide; no guest entry for a panel member; none before the guest votes; company B 404', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(109);
    const before = w([{ id: iv(1), cand: K.book, at: PAST, guest: G, votesSubmitted: 1 }, {}]);
    const t = withRows(w([{ id: iv(1), cand: K.book, at: PAST, guest: G, votesSubmitted: 2 }, { used: H(-0.5) }]), [
      voteRow(K.book, iv(1), P.p1), voteRow(K.book, iv(1), guestVoter(G), { scores: { technical: 5, communication: 2 }, rating: 'NO' }),
    ]);
    const GV = { rating: 'NO', overall: 3.5, on_behalf_by_name: null };
    for (const [label, who] of [['the Recruiter', W.recruiter], ['the decider', W.hm]] as [string, Caller][]) {
      const x = ivIn(readOk(who, K.book, t, label), iv(1));
      const g = guests(x);
      expect.soft(g.length, `${label}: one guest entry`).toBe(1);
      expect.soft(g[0]?.vote, `${label}: the guest's vote, worked out as a panel person's (mean of 5 and 2 = 3.5)`).toEqual(GV);
      expect.soft(g[0]?.feedback, `${label}: GIVEN`).toBe('GIVEN');
    }
    const hrOnly = ivIn(readOk(W.hm, K.book, withDecider(t, 'HR_ONLY'), 'a hiring manager who does not decide'), iv(1));
    expect.soft(guests(hrOnly).map((e) => blank(e?.vote)), 'a hiring manager who does not decide: no guest vote').toEqual([true]);
    const p1 = ivIn(readOk(W.p1, K.book, t, 'p1'), iv(1));
    expect.soft(guests(p1).length, 'a panel member: no guest entry at all').toBe(0);
    const early = ivIn(readOk(W.recruiter, K.book, before, 'before the guest votes'), iv(1));
    expect.soft(guests(early).map((e) => [e?.feedback, 'vote' in (e ?? {}) ? e.vote : 'absent']), 'before the guest votes: WAITING and no vote').toEqual([['WAITING', 'absent']]);
    const b = read(W.recruiterB, K.book, t);
    expect.soft(statusOf(b), `company B's Recruiter reading A's candidate: 404 (got ${describe(b)})`).toBe(404);
    expect.soft(JSON.stringify(bodyOf(b) ?? '').includes(iv(1)), 'B sees nothing of it').toBe(false);
    // A company B link pointing at A's interview opens nothing of A's.
    const GB = token(110);
    const tb = withRows(t, [linkRow(GB, K.book, iv(1), PAST, { company: B })]);
    const gr = guestRead(GB, tb);
    expired(gr, 'the guest read with a company B link');
    expect.soft(JSON.stringify(bodyOf(gr)).includes('candidate_first'), 'nothing of A\'s interview').toBe(false);
  });

  // ---------------------------------------------------------------- AC-7 Extra field names

  test('AC-7 An extra key is still 400 INVALID_FIELD: a plain name comes back in field, anything else as field body, and the answer never holds the odd text; on POST and each PATCH action; the first extra key in body order is judged', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const t = w({ id: iv(1), cand: K.book, at: FUT }, { id: iv(2), cand: K.book, type: 'PHONE_SCREEN', at: PAST });
    const PLAIN = ['tenant_id', 'a'.repeat(64), '_x9', 'Status'];
    const ODD = ['a'.repeat(65), '<b>x</b>', 'a.b', 'a b', 'zz.odd@outside.test', '', '9abc', 'naïve', 'a-b', '$where'];
    const routes: [string, (body: Record<string, unknown>) => Run][] = [
      ['POST', (b) => book(W.recruiter, K.book, { ...bookBody(), ...b }, t)],
      ['reschedule', (b) => act(W.recruiter, K.book, iv(1), { ...RES({ length_minutes: 45 }), ...b }, t)],
      ['cancel', (b) => act(W.recruiter, K.book, iv(1), { ...CANCEL(), ...b }, t)],
      ['did not happen', (b) => act(W.recruiter, K.book, iv(2), { ...DNH(), ...b }, t)],
      ['mark as done', (b) => act(W.recruiter, K.book, iv(2), { ...DONE(), ...b }, t)],
    ];
    for (const [label, run] of routes) {
      for (const k of PLAIN) {
        const r = run({ [k]: 'x' });
        refused(r, 400, 'INVALID_FIELD', k, `${label}: extra key ${k.length > 20 ? `${k.length} characters` : k}`);
        expect.soft(changed(t, r.tables), `${label} ${k}: nothing written`).toEqual([]);
      }
      for (const k of ODD) {
        const r = run({ [k]: 'x' });
        refused(r, 400, 'INVALID_FIELD', 'body', `${label}: extra key ${JSON.stringify(k.length > 20 ? `${k.length} characters` : k)}`);
        if (k) expect.soft(String(r.response?.body ?? '').includes(JSON.stringify(k).slice(1, -1)) || String(r.response?.body ?? '').includes(k), `${label}: the answer never holds ${JSON.stringify(k.slice(0, 20))}`).toBe(false);
        expect.soft(changed(t, r.tables), `${label} ${JSON.stringify(k.slice(0, 20))}: nothing written`).toEqual([]);
      }
      // Body order: the first extra key is the one judged.
      refused(run({ 'a.b': 1, tenant_id: 1 }), 400, 'INVALID_FIELD', 'body', `${label}: an odd key first, then tenant_id`);
      refused(run({ tenant_id: 1, 'a.b': 1 }), 400, 'INVALID_FIELD', 'tenant_id', `${label}: tenant_id first, then an odd key`);
    }
  });

  // ---------------------------------------------------------------- AC-8 Nothing else moves

  test('AC-8 No IAM change on any policy (scheduleInterview, submitVote and submitVoteByToken included) against develop 9252f33; no table item; scheduleInterview\'s timeout is still at most 30 seconds', async ({}, testInfo) => {
    once(testInfo.project.name);
    const baseline = JSON.parse(readFileSync(join(__dirname, 'support', 'int-01f', 'iam-9252f33', 'policies.json'), 'utf8')) as Record<string, { role: string; stack: string; pairs?: string[]; squash?: string }>;
    const now = policyLines();
    for (const k of new Set([...Object.keys(baseline), ...Object.keys(now)])) {
      const was = new Set(baseline[k]?.pairs ?? [`squashed ${baseline[k]?.squash}`]);
      const is = new Set(now[k]?.pairs ?? (now[k] ? [`squashed ${now[k]?.squash}`] : []));
      expect.soft([...is].filter((l) => !was.has(l) && !isRec062Grant(l, k)), `${k}: no new grant`).toEqual([]);
    }
    expect.soft(Object.keys(now).filter((k) => !baseline[k] && !isRec09Policy(k, now[k]?.pairs)), 'no new policy').toEqual([]);
    const si = lambdaNamed('scheduleInterview')[0];
    expect(si, 'scheduleInterview is a Lambda in Terraform').toBeTruthy();
    const timeout = Number(/\btimeout\s*=\s*(\d+)/.exec(si!.block.body)?.[1] ?? 'NaN');
    expect.soft(timeout <= 30, `scheduleInterview's timeout is at most 30 seconds (got ${timeout}); a raise brings rule 3's 120 seconds back to the BA`).toBe(true);
  });

  test('AC-8 Logs: across removals, refused and retried votes, take-overs and failed key writes, no log line holds a removed person\'s id, a token, an email, a place, a link, a note or the pending booking id', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const G = token(111);
    const t = w({ id: iv(1), cand: K.book, at: PAST, guest: G });
    const off = actReq(W.recU, K.book, iv(1), RES({ panel: [P.p1, P.p2], guest_email: null }));
    const place = actReq(W.recU, K.book, iv(1), RES({ place: 'zz-int01f-room-logs' }));
    const k = newKey();
    const first = book(W.recruiter, K.fresh, bookBody({ guest_email: NEVER.guestEmail, candidate_note: NEVER.note }), t, stuck({ key: k }));
    const runs: Run[] = [
      act(W.recruiter, K.book, iv(1), RES({ panel: [P.p1, P.p2], guest_email: null, reason_note: NEVER.reasonNote }), t),
      vote(W.p3, iv(1), voteBody(), t, withHooks([{ when: 'before', match: `VOTE#${P.p3}`, runs: [{ req: off }] }])),
      vote(W.p1, iv(1), voteBody(), t, withHooks([{ when: 'before', match: `VOTE#${P.p1}`, times: 2, runs: [{ req: place }, { req: { ...place, body: RES({ place: 'zz-int01f-room-logs-2' }) } }] }])),
      guestVote(G, voteBody(), t, withHooks([{ when: 'before', match: guestVoter(G), runs: [{ req: off }] }])),
      first,
      book(W.recruiter, K.fresh, bookBody({ guest_email: NEVER.guestEmail, candidate_note: NEVER.note }), first.tables, { key: k, now: at(121) }),
      book(W.recruiter, K.fresh, bookBody({ guest_email: NEVER.guestEmail, candidate_note: NEVER.note }), first.tables, { key: k, now: at(60) }),
    ];
    const id = String(bodyOf(first)?.interview_id);
    const lines = runs.flatMap((r) => logsOf(r));
    for (const [label, needle] of [['p3\'s id', P.p3], ['the guest token', G], ['the link hash', hashOf(G)], ['an email', '@'], ['the place', NEVER.place], ['a new place', 'zz-int01f-room'], ['the video link', NEVER.link], ['a note', 'zz-int01-'], ['the pending booking id', id], ['pending_interview_id', 'pending_interview_id'], ['removed_', 'removed_']] as [string, string][]) {
      expect.soft(lines.filter((l) => l.includes(needle)), `no log line holds ${label}`).toEqual([]);
    }
    expect.soft(lines.filter((l) => l.includes('zz-int01f-store-fault-message')), 'a failed key write logs its error name only, never its message').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-9 on pepla-dev

  test('AC-9 on pepla-dev: HR books its own interview on the seeded candidate with two panel logins, reschedules it with one taken off (200), then cancels it; INT-01\'s seeded interviews are left as they were @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(4 * 60_000);
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'int-01', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const env = (x: string) => process.env[x] ?? '';
    const { devEnv } = await import('./support/ten-02/dev');
    const { region, clientId } = devEnv();
    const appEnv = readFileSync(join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts'), 'utf8');
    const tfApi = (/talentFlowApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(appEnv)?.[1] ?? '').replace(/\/+$/, '').replace(/\/v1$/, '');
    expect(tfApi, 'pepla-web\'s talentFlowApiUrl points at pepla-dev\'s TalentFlow API').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    expect(env('E2E_HR_EMAIL') && env('E2E_HR_PASSWORD'), 'the HR test login is set').toBeTruthy();
    const auth = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
      data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: env('E2E_HR_EMAIL'), PASSWORD: env('E2E_HR_PASSWORD') } }),
    });
    expect(auth.status(), 'HR signs in at Cognito').toBe(200);
    const token_ = ((await auth.json()) as any).AuthenticationResult.IdToken as string;
    const api = async (method: string, path: string, body?: unknown, key?: string) => {
      const r = await page.request.fetch(`${tfApi}${path}`, { method, headers: { Authorization: `Bearer ${token_}`, 'content-type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body === undefined ? {} : { data: JSON.stringify(body) }) });
      const text = await r.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = undefined; }
      return { status: r.status() as number, text, json };
    };
    const key = () => `int01f-dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cand = encodeURIComponent(ids['candidate']!);
    const first = await api('GET', `/v1/candidates/${cand}/interviews`);
    expect(first.status, `HR reads the seeded candidate (${first.text.slice(0, 200)})`).toBe(200);
    const seeded = (b: any) => ((b?.interviews ?? []) as any[]).filter((x) => x.id === ids['pastInterview'] || x.id === ids['futureInterview']).map((x) => JSON.stringify([x.id, x.status, x.at ?? x.scheduledAt, x.sequence]));
    const past = ((first.json?.interviews ?? []) as any[]).find((x) => x.id === ids['pastInterview']);
    const panel = ((past?.panel ?? []) as any[]).filter((e) => e.kind === 'PERSON').map((e) => e.person_id as string);
    expect(panel.length, 'the seeded past interview has two panel logins').toBe(2);
    const when = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    let booked: { status: number; text: string; json: any } | undefined;
    for (const type of ['CULTURE_FIT', 'BEHAVIORAL']) {
      booked = await api('POST', `/v1/candidates/${cand}/interviews`, { type, at: when(5), length_minutes: 60, where: 'ONLINE', video_link: 'https://meet.example.test/int-01f-dev', panel }, key());
      if (booked.status !== 409) break;
    }
    expect(booked?.status, `HR books its own interview with both panel logins (${booked?.text.slice(0, 200)})`).toBe(201);
    const id = encodeURIComponent(String(booked?.json?.interview_id));
    const rs = await api('PATCH', `/v1/candidates/${cand}/interviews/${id}`, { action: 'reschedule', panel: [panel[0]] }, key());
    expect(rs.status, `the reschedule taking one panel login off is accepted by the real table (${rs.text.slice(0, 200)})`).toBe(200);
    const cn = await api('PATCH', `/v1/candidates/${cand}/interviews/${id}`, { action: 'cancel', reason: 'PANEL_NOT_AVAILABLE' }, key());
    expect(cn.status, `then it is cancelled (${cn.text.slice(0, 200)})`).toBe(200);
    const end = await api('GET', `/v1/candidates/${cand}/interviews`);
    expect.soft(JSON.stringify(end.json ?? {}).includes('removed_'), 'the read carries no removed_ field').toBe(false);
    expect.soft(seeded(end.json), 'the seeded interviews INT-01 AC-18 and REC-07 AC-10 read are as they were').toEqual(seeded(first.json));
  });
});
