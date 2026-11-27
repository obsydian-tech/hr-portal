import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO } from './support/rec-14/lambda-harness';
import { answerSchema, checker, operation, readDoc, type Doc } from './support/rec-14/schema';
import { attributes, blocks } from './support/infra-harness';
import { filesOf, policyLines } from './support/rec-02/iam';
import {
  awsOf, bodyOf, changed, describe, isModulesRead, linkVote, logsOf, makeLink, sha256B64u, sha256Hex, statusOf, vote, votesOf, writesOf,
} from './support/rec-07/world';
import { A, ADMIN, B, C, DAY, I2_CRITERIA, K, NOW, R7_CRITERIA, SECRET, SUB, SUB_ADMIN, TABLE, av, oldStyleVote, plain, readIv, withInterview, withRows, withSaga, world, type Caller, type Run, type Tables } from './support/rec-ui-03-read/world';

/**
 * REC-UI-03 step 3 (G-10a) · Server: read one interview for its panel member, GET /v1/interviews/{id}, on the existing submitVote
 * Lambda (red, part of NH-229). Spec: /mnt/project-files/onboarding-cards/specs/REC-UI-03-next-slices.md, step 3 (rules 1 to 7,
 * AC-3.1 to AC-3.8) and its notes; review page onboarding-cards/specs/REC-UI-03-step-3-tests-for-review.md (the bar). Card notes:
 * cards/rec-ui-03.md, "Step 3".
 *
 * The Lambda tests run the real submitVote handler in a fresh Node process each call, against REC-14's fake AWS, over REC-07's world
 * (support/rec-07/world.ts, unchanged) plus this step's rows (support/rec-ui-03-read/world.ts), at REC-07's fixed time NOW. Terraform
 * and the API file are read as text. Nothing calls AWS or any AI. Nothing here has a screen width: each no-backend test runs once, at
 * 1280. AC-3.8 runs on pepla-dev only (the read at both widths; company B's walk once, in the dev workflow's company walk step).
 *
 * Pinned by the test writer where the spec is silent (each is in cards/rec-ui-03.md, "Step 3"):
 *  - D-T-3.1 The refusal is notFound()'s whole answer: 404, Content-Type application/json, body {"error":"Not found"}, the same bytes
 *    for every reason. No company: requireTenant's 403 before any AWS call; Recruitment off: requireModule's 403, only the module read.
 *  - D-T-3.2 "Has a vote" is REC-07's test: a VOTE#<caller># row on the candidate with this interviewId, old 0 to 10 votes too. An
 *    old vote's overall is worked out the same way (the mean of its scores for the keys of `criteria`, one decimal).
 *  - D-T-3.3 `why` is a key only when can.capture_feedback is false.
 *  - D-T-3.4 The answer passes the 200 schema the API file gives the route, and lists exactly rule 3's keys (and `why`).
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const ROUTE = 'GET /v1/interviews/{id}';
const NOT_FOUND_BODY = JSON.stringify({ error: 'Not found' });
/** notFound()'s whole answer (status, headers, body), as the handler gives it for an id that does not exist; every refusal must equal it. */
let notFoundAnswer: unknown;
function isNotFound(label: string, r: Run) {
  expect.soft([statusOf(r), r.response?.body], `${label}: 404 {"error":"Not found"}`).toEqual([404, NOT_FOUND_BODY]);
  if (notFoundAnswer === undefined) notFoundAnswer = raw(readIv(C.m1, 'iv-rui03-nobody-has-this', world()));
  expect.soft(raw(r), `${label}: the same answer to the byte (headers too) as an id that does not exist`).toEqual(notFoundAnswer);
}
const FORBIDDEN = { error: 'Forbidden' };
const KEYS = ['at', 'can', 'candidate_first', 'candidate_last', 'criteria', 'id', 'my_feedback', 'my_vote', 'role_title', 'status', 'type'];
const answer = (r: Run) => [statusOf(r), bodyOf(r)];
const saved = (r: Run) => [200, 201].includes(statusOf(r) ?? 0);
/** The whole response as the caller gets it (status, headers, body bytes). */
const raw = (r: Run) => ({ statusCode: r.response?.statusCode, headers: r.response?.headers, body: r.response?.body });
let docCache: Doc | undefined;
const doc = () => (docCache ??= readDoc());

/** A 200 answer, checked against rule 3's keys and the API file; returns the body. */
function ok(label: string, r: Run): any {
  expect(statusOf(r), `${label}: 200 (${describe(r)})`).toBe(200);
  const b = bodyOf(r) ?? {};
  const keys = Object.keys(b).filter((k) => k !== 'why').sort();
  expect.soft(keys, `${label}: exactly rule 3's keys`).toEqual(KEYS);
  expect.soft('why' in b, `${label}: why is there exactly when capture_feedback is false`).toBe(b.can?.capture_feedback === false);
  expect.soft(Object.keys(b.can ?? {}), `${label}: can holds capture_feedback only`).toEqual(['capture_feedback']);
  if (b.my_vote !== null) expect.soft(Object.keys(b.my_vote ?? {}).sort(), `${label}: my_vote has exactly rating and overall`).toEqual(['overall', 'rating']);
  for (const c of b.criteria ?? []) expect.soft(Object.keys(c).sort(), `${label}: each criterion is only key and label`).toEqual(['key', 'label']);
  const problems = checker(doc()).check(answerSchema(doc(), ROUTE, 200), b);
  expect.soft(problems, `${label}: the answer passes api/openapi.yaml for ${ROUTE} 200`).toEqual([]);
  return b;
}
/** A vote body with `v` for each key. */
const scoresFor = (keys: string[], v: number[] | number, rating = 'YES') => ({ scores: Object.fromEntries(keys.map((k, i) => [k, Array.isArray(v) ? v[i] : v])), rating });
const R7 = R7_CRITERIA.map((c) => c.key);
const I2 = I2_CRITERIA.map((c) => c.key);
/** Runs votes one after another; fails the test on the first that is not saved. */
function votes(t: Tables, list: [Caller, string, unknown][]): Tables {
  let cur = t;
  for (const [who, iv, body] of list) {
    const r = vote(who, iv, body, cur);
    expect(saved(r), `${who.name} scores ${iv} (${describe(r)})`).toBe(true);
    cur = r.tables;
  }
  return cur;
}
/** Every key and every string or number value of a value, at every depth. */
function walk(v: unknown, keys: string[] = [], values: string[] = []): { keys: string[]; values: string[] } {
  if (Array.isArray(v)) v.forEach((x) => walk(x, keys, values));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x, keys, values); }
  else if (typeof v === 'string' || typeof v === 'number') values.push(String(v));
  return { keys, values };
}
/** The role R7 with other criteria (a later change of the role must not move an interview's list). */
function withRoleCriteria(t: Tables, criteria: { key: string; label: string }[]): Tables {
  const out = structuredClone(t);
  out[TABLE.roles] = (out[TABLE.roles] ?? []).map((r) => (plain(r)['role_id'] === K.r7 && plain(r)['tenant_id'] === A ? { ...r, ...av({ criteria }) } : r));
  return out;
}

test.describe('REC-UI-03 step 3 Read one interview for its panel member (GET /v1/interviews/{id})', () => {
  // ---------------------------------------------------------------- AC-3.1

  test('AC-3.1 A panel member reads the interview: exactly the listed keys, the snapshot\'s criteria, their own feedback and vote only, overall to one decimal', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    // The role's criteria change after booking: the read keeps the interview's own list.
    const t0 = withRoleCriteria(world(), [{ key: 'grit', label: 'Grit' }]);
    const b = ok('m1 reads I2', readIv(C.m1, K.i2, t0));
    expect.soft([b.id, b.candidate_first, b.candidate_last, b.role_title, b.type, b.at, b.status], 'who and when, from the interview and the candidate')
      .toEqual([K.i2, 'Thandi', 'Nkosi', 'Sales consultant', 'BEHAVIORAL', '2026-11-23T13:00:00.000Z', 'SCHEDULED']);
    expect.soft(b.criteria, 'criteria: I2\'s snapshot, in order, not the role\'s current list').toEqual(I2_CRITERIA);
    expect.soft([b.my_feedback, b.my_vote, b.can], 'no vote yet: WAITING, no vote, may give feedback').toEqual(['WAITING', null, { capture_feedback: true }]);
    expect.soft(ok('m1 reads I1', readIv(C.m1, K.i1, t0)).criteria, 'I1: R7\'s three criteria as booked, not the role\'s current list').toEqual(R7_CRITERIA);
    // Only key and label of each snapshot entry come back.
    const extra = withInterview(t0, K.v, K.i2, { criteria_snapshot: I2_CRITERIA.map((c) => ({ ...c, weight: 2, hint: 'kept for HR' })) });
    expect.soft(ok('a snapshot with more fields', readIv(C.m1, K.i2, extra)).criteria, 'each entry is only key and label').toEqual(I2_CRITERIA);

    // Overall: the mean of the caller's own scores, one decimal. {4, 3, 4} on three criteria is 3.7; {4, 3} is 3.5; {4, 4} is 4.
    const t1 = votes(t0, [[C.m1, K.i1, scoresFor(R7, [4, 3, 4])], [C.m1, K.i2, scoresFor(I2, [4, 3], 'STRONG_YES')], [C.m2, K.i2, scoresFor(I2, [4, 4], 'NO')]]);
    const m1i1 = ok('m1 reads I1 after voting', readIv(C.m1, K.i1, t1));
    expect.soft([m1i1.my_feedback, m1i1.my_vote], 'I1 {4, 3, 4}: GIVEN, YES, 3.7').toEqual(['GIVEN', { rating: 'YES', overall: 3.7 }]);
    const m1i2 = ok('m1 reads I2 after voting', readIv(C.m1, K.i2, t1));
    expect.soft(m1i2.my_vote, 'I2 {4, 3}: STRONG_YES, 3.5 (only m1\'s own vote, though m2 has voted too)').toEqual({ rating: 'STRONG_YES', overall: 3.5 });
    const m2i2 = ok('m2 reads I2', readIv(C.m2, K.i2, t1));
    expect.soft(m2i2.my_vote, 'I2 {4, 4}: NO, 4').toEqual({ rating: 'NO', overall: 4 });
    // Any of the four roles may sit on a panel: an HR person (the Recruiter) and an admin on I1's panel read their own line.
    const hrPanel = withInterview(t0, K.v, K.i1, { panelMemberIds: [SUB.m1, SUB.recA, SUB_ADMIN] });
    for (const who of [C.recruiter, ADMIN]) {
      const b = ok(`${who.name} on I1's panel`, readIv(who, K.i1, hrPanel));
      expect.soft([b.id, b.my_feedback, b.my_vote, b.can], `${who.name} on the panel: their own WAITING line`).toEqual([K.i1, 'WAITING', null, { capture_feedback: true }]);
    }
    // m3 has not voted on I2: WAITING, whatever m1 and m2 gave.
    const m3i2 = ok('m3 reads I2', readIv(C.m3, K.i2, t1));
    expect.soft([m3i2.my_feedback, m3i2.my_vote, m3i2.can.capture_feedback], 'm3 has no vote: WAITING, none, may give feedback').toEqual(['WAITING', null, true]);
  });

  test('AC-3.1b No snapshot (missing or empty): criteria are the company\'s default criteria, the list POST votes accepts; an old 0 to 10 vote is the caller\'s own vote, its overall over the listed keys only; role_title is the job title, role or not', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const t0 = world();
    // Company A's default criteria, as the vote route itself would take them (REC-07: SCORING_WEIGHTS.defaultCriteria).
    const DEFAULT = ['technical', 'communication', 'culturalFit', 'problemSolving'];
    for (const iv of [K.iN, K.iE]) {
      const b = ok(`m1 reads ${iv}`, readIv(C.m1, iv, t0));
      expect.soft(b.criteria.map((c: any) => c.key), `${iv}: the company's default criteria, in order`).toEqual(DEFAULT);
      expect.soft(b.criteria.every((c: any) => typeof c.label === 'string' && c.label.trim().length > 0), `${iv}: each has a label`).toBe(true);
      // The list the vote is judged against: the role's current keys are refused, the read's keys are saved.
      const wrong = vote(C.m1, iv, scoresFor(R7, 4), t0);
      expect.soft(answer(wrong), `${iv}: a vote with the role's keys is refused`).toEqual([400, { error: 'Bad request', code: 'INVALID_SCORES' }]);
      const right = vote(C.m1, iv, scoresFor(b.criteria.map((c: any) => c.key), [4, 3, 4, 4]), t0);
      expect.soft(statusOf(right), `${iv}: a vote with exactly the read's keys is saved (${describe(right)})`).toBe(201);
      if (saved(right)) {
        const after = ok(`m1 reads ${iv} after voting`, readIv(C.m1, iv, right.tables));
        expect.soft([after.my_feedback, after.my_vote, after.why], `${iv}: GIVEN, {4, 3, 4, 4} is 3.8`).toEqual(['GIVEN', { rating: 'YES', overall: 3.8 }, 'GIVEN']);
      }
    }
    // role_title is the saga's positionTitle, with or without a role (Y has "Junior baker" and no role); no title is null.
    expect.soft(ok('m1 reads IN (no role)', readIv(C.m1, K.iN, t0)).role_title, 'Y has a job title and no role: role_title is the job title').toBe('Junior baker');
    const noTitle = withSaga(t0, K.y, (r) => { const c = { ...r }; delete c['positionTitle']; return c; });
    expect.soft(ok('m1 reads IN, no job title', readIv(C.m1, K.iN, noTitle)).role_title, 'no job title: role_title is null').toBeNull();
    // Note 1: overall counts only the scores whose keys are in criteria; none fits: null, still GIVEN.
    const old = withRows(t0, [
      oldStyleVote(K.y, K.iN, SUB.m1, '2026-11-20T10:00:00.000Z', { technical: 8, oldKey: 2 }),
      oldStyleVote(K.y, K.iE, SUB.m1, '2026-11-20T10:05:00.000Z', { oldA: 3, oldB: 4 }),
    ]);
    const partly = ok('m1 reads IN with an old vote partly outside criteria', readIv(C.m1, K.iN, old));
    expect.soft([partly.my_feedback, partly.why, partly.my_vote], 'only the listed key counts: 8, not 5').toEqual(['GIVEN', 'GIVEN', { rating: 'YES', overall: 8 }]);
    const none = ok('m1 reads IE with an old vote wholly outside criteria', readIv(C.m1, K.iE, old));
    expect.soft([none.my_feedback, none.why, none.my_vote], 'no listed key: overall null, still GIVEN').toEqual(['GIVEN', 'GIVEN', { rating: 'YES', overall: null }]);
    // I0: booked before REC-07 (no snapshot), done, with m1's old 0 to 10 vote {9, 8, 7, 9}: it is m1's own vote (D-T-3.2).
    const i0 = ok('m1 reads I0', readIv(C.m1, K.i0, t0));
    expect.soft([i0.my_feedback, i0.why, i0.can.capture_feedback, i0.my_vote], 'I0: GIVEN (never CLOSED), STRONG_YES, 8.3').toEqual(['GIVEN', 'GIVEN', false, { rating: 'STRONG_YES', overall: 8.3 }]);
  });

  // ---------------------------------------------------------------- AC-3.2

  test('AC-3.2 Everyone else gets the same 404: unknown or malformed id, another company (both ways), not on the panel, a Recruiter, the hiring manager, a person just taken off the panel', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const t0 = world();
    ok('control: m1 reads I1', readIv(C.m1, K.i1, t0));
    const offPanel = withInterview(t0, K.v, K.i1, { panelMemberIds: [SUB.m2, SUB.m3] });
    const cases: [string, Caller, string, Tables][] = [
      ['an id that does not exist', C.m1, 'iv-rui03-nobody-has-this', t0],
      ['a malformed id (path signs)', C.m1, '../iv-rec07-a-1', t0],
      ['a malformed id (a percent sign)', C.m1, '%', t0],
      ['a malformed id (spaces)', C.m1, '   ', t0],
      ['a malformed id (600 characters)', C.m1, 'x'.repeat(600), t0],
      ['a malformed id (A\'s id in capitals)', C.m1, K.i1.toUpperCase(), t0],
      ['company B\'s panel member with A\'s id', C.mB, K.i1, t0],
      ['company B\'s Recruiter with A\'s id', C.recruiterB, K.i1, t0],
      ['company A\'s panel member with B\'s id', C.m1, K.ib, t0],
      ['m1 (on A\'s panel) signed in with company B', { ...C.m1, name: 'm1 as company B', company: 'B' }, K.i1, t0],
      ['a person of A on no panel', C.outsider, K.i1, t0],
      ['a Recruiter of A not on the panel', C.recruiter, K.i1, t0],
      ['the candidate\'s hiring manager, not on the panel', C.hm, K.i1, t0],
      ['another role\'s manager', C.otherHm, K.i1, t0],
      ['m1, just taken off I1\'s panel', C.m1, K.i1, offPanel],
    ];
    for (const [what, who, iv, t] of cases) {
      const r = readIv(who, iv, t);
      isNotFound(what, r);
      expect.soft(writesOf(r).length, `${what}: nothing is written`).toBe(0);
    }
  });

  // ---------------------------------------------------------------- AC-3.3

  test('AC-3.3 Nothing extra: with other votes (one entered for a member), a guest link and its vote, notes and the candidate\'s private fields, the answer holds only the caller\'s own lines', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const t0 = world();
    const before = ok('m1 reads I1 before anyone votes', readIv(C.m1, K.i1, t0));
    // m2 votes, the Recruiter enters m3's vote, a guest link is made for I1 and the guest votes.
    const t1 = votes(t0, [
      [C.m2, K.i1, { ...scoresFor(R7, [5, 5, 5], 'STRONG_YES'), comment: 'Second member comment, private' }],
      [C.recruiter, K.i1, { ...scoresFor(R7, [1, 2, 1], 'STRONG_NO'), comment: 'Entered for the third member, private', on_behalf_of: SUB.m3 }],
    ]);
    const guestEmail = 'naledi.guest.rui03@example.test';
    const link = makeLink(C.recruiter, K.v, { interview_id: K.i1, guest_email: guestEmail }, t1);
    expect(statusOf(link), `the Recruiter makes a guest link for I1 (${describe(link)})`).toBe(201);
    const token = String(bodyOf(link)?.token ?? '');
    const g = linkVote(token, { ...scoresFor(R7, [2, 2, 2], 'NO'), comment: 'Guest comment, private' }, link.tables);
    expect(saved(g), `the guest votes (${describe(g)})`).toBe(true);
    const t2 = g.tables;
    expect.soft(votesOf(t2, K.v).filter((v) => v['interviewId'] === K.i1).length, 'three votes on I1 now').toBe(3);

    const mid = ok('m1 reads I1 after the others voted', readIv(C.m1, K.i1, t2));
    expect.soft(mid, 'm1\'s answer does not change when other people vote (no number worked out from their votes)').toEqual(before);
    const t3 = votes(t2, [[C.m1, K.i1, { ...scoresFor(R7, [4, 3, 4]), comment: 'm1 own comment' }]]);
    const own = ok('m1 reads I1 after their own vote', readIv(C.m1, K.i1, t3));
    expect.soft(own.my_vote, 'm1 sees only their own rating and overall').toEqual({ rating: 'YES', overall: 3.7 });

    const hashes = new Set(Object.values(t3).flat().map((r) => plain(r)).flatMap((r) => [r['guest_link_hash'], r['token_hash']]).filter((x): x is string => typeof x === 'string'));
    const forbidden = [
      SUB.m2, SUB.m3, SUB.recA, SUB.hmA, 'Second member comment', 'Entered for the third member', 'Guest comment', 'm1 own comment', guestEmail, 'naledi.guest',
      token, sha256Hex(token), sha256B64u(token), ...hashes, SECRET.note, SECRET.closedNote, SECRET.email, SECRET.phone, SECRET.cv, SECRET.salary, 'offer-rui03', K.v, A, B,
      'STRONG_NO', 'STRONG_YES', 'INTERVIEW', 'Interview',
    ].filter(Boolean);
    const allowed = new Set([...KEYS, 'why', 'key', 'label', 'capture_feedback', 'rating', 'overall']);
    for (const [what, body] of [['before', before], ['after the others', mid], ['after m1', own]] as const) {
      const { keys, values } = walk(body);
      expect.soft(keys.filter((k) => !allowed.has(k)), `${what}: no key outside rule 3`).toEqual([]);
      const text = JSON.stringify(body);
      expect.soft(forbidden.filter((x) => text.includes(x)), `${what}: no other person, vote, comment, guest, link, note, private field, stage or company id`).toEqual([]);
      expect.soft(values.filter((v) => /@/.test(v)), `${what}: no email address`).toEqual([]);
    }
  });

  // ---------------------------------------------------------------- AC-3.4

  test('AC-3.4 can and why: not started, open, own vote (also on a closed or one-person interview, and when HR entered it), closed without them; each agrees with POST votes', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(420_000);
    const t0 = world();
    const line = (b: any) => [b.can?.capture_feedback, b.why, b.my_feedback, b.my_vote === null ? null : 'filled'];
    /** The read, then what POST votes answers at that same moment on the same tables. */
    const both = (label: string, who: Caller, cand: string, iv: string, t: Tables, keys: string[]) => {
      const b = ok(label, readIv(who, iv, t));
      const v = vote(who, iv, scoresFor(keys, 4), t);
      expect.soft(b.can?.capture_feedback === true ? saved(v) : statusOf(v) === 409, `${label}: POST votes agrees (can ${b.can?.capture_feedback}, the vote: ${describe(v)})`).toBe(true);
      void cand;
      return b;
    };

    // Before the start.
    const nf = both('IF before its start', C.m1, K.z, K.iF, t0, R7);
    expect.soft(line(nf), 'before the start: false, NOT_STARTED, WAITING, no vote').toEqual([false, 'NOT_STARTED', 'WAITING', null]);
    // Started, no own vote.
    const open = both('I1 started, no vote', C.m1, K.v, K.i1, t0, R7);
    expect.soft(line(open), 'started, no own vote: true, no why, WAITING').toEqual([true, undefined, 'WAITING', null]);
    // Own vote on a SCHEDULED interview (others still to vote).
    const t1 = votes(t0, [[C.m1, K.i1, scoresFor(R7, 4)]]);
    const given = both('I1 after m1 voted', C.m1, K.v, K.i1, t1, R7);
    expect.soft([...line(given), given.status], 'own vote, still SCHEDULED: false, GIVEN, GIVEN, filled').toEqual([false, 'GIVEN', 'GIVEN', 'filled', 'SCHEDULED']);
    // One-person panel: the person's own vote makes it COMPLETED; they still get their own line, never CLOSED.
    const t2 = votes(t0, [[C.m1, K.iS, scoresFor(R7, [5, 4, 4], 'STRONG_YES')]]);
    const solo = both('IS after its only member voted', C.m1, K.z, K.iS, t2, R7);
    expect.soft([...line(solo), solo.status], 'one-person panel, own vote closed it: false, GIVEN, GIVEN, filled, COMPLETED').toEqual([false, 'GIVEN', 'GIVEN', 'filled', 'COMPLETED']);
    expect.soft(solo.my_vote, 'and the vote is theirs: STRONG_YES, 4.3').toEqual({ rating: 'STRONG_YES', overall: 4.3 });
    // The same when HR entered the vote for the only member.
    const t3 = votes(t0, [[C.recruiter, K.iH, { ...scoresFor(R7, [3, 3, 4], 'NO'), on_behalf_of: SUB.m2 }]]);
    const solohr = both('IH after HR entered its only member\'s vote', C.m2, K.z, K.iH, t3, R7);
    expect.soft([...line(solohr), solohr.status], 'HR entered it, now COMPLETED: false, GIVEN, GIVEN, filled').toEqual([false, 'GIVEN', 'GIVEN', 'filled', 'COMPLETED']);
    expect.soft(solohr.my_vote, 'only rating and overall, no name of who entered it').toEqual({ rating: 'NO', overall: 3.3 });
    // An own vote wins over a later cancel too (first match wins).
    const t4 = withInterview(t1, K.v, K.i1, { status: 'CANCELLED' });
    expect.soft(line(ok('I1 cancelled after m1 voted', readIv(C.m1, K.i1, t4))), 'own vote, then cancelled: still GIVEN').toEqual([false, 'GIVEN', 'GIVEN', 'filled']);
    // Closed without them.
    for (const status of ['COMPLETED', 'CANCELLED', 'DID_NOT_HAPPEN']) {
      const t = withInterview(t0, K.z, K.iX, { status });
      const b = both(`IX ${status}, no vote`, C.m1, K.z, K.iX, t, R7);
      expect.soft(line(b), `${status} without their vote: false, CLOSED, WAITING, no vote`).toEqual([false, 'CLOSED', 'WAITING', null]);
    }
    // A closed interview that has not started (cancelled before the start) is CLOSED, not NOT_STARTED, as POST votes judges it.
    const cancelledEarly = withInterview(t0, K.z, K.iF, { status: 'CANCELLED' });
    expect.soft(line(both('IF cancelled before its start', C.m1, K.z, K.iF, cancelledEarly, R7)), 'cancelled before the start: CLOSED').toEqual([false, 'CLOSED', 'WAITING', null]);
    // No answer says when or why it was closed.
    const closedWhy = withInterview(t0, K.z, K.iX, { status: 'CANCELLED', closed_reason: 'PANEL_NOT_AVAILABLE', closed_at: NOW, closed_by: SUB.recA });
    const cw = JSON.stringify(ok('IX cancelled with a reason', readIv(C.m1, K.iX, closedWhy)));
    expect.soft(['PANEL_NOT_AVAILABLE', NOW, SUB.recA, 'closed'].filter((x) => cw.includes(x)), 'no closed reason, time or person').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-3.5

  test('AC-3.5 Module and company: no company or Recruitment off is refused before anything else; a company named in the headers, query or body is never used', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const t0 = world();
    const plainRead = readIv(C.m1, K.i1, t0);
    ok('control: m1 reads I1', plainRead);
    const none = readIv(C.noCompany, K.i1, t0);
    expect.soft([...answer(none), awsOf(none).length], 'a caller with no company: 403 before any AWS call').toEqual([403, FORBIDDEN, 0]);
    const d = readIv(C.recruiterD, K.i1, t0);
    expect.soft(answer(d), 'a company with Recruitment off: 403').toEqual([403, FORBIDDEN]);
    expect.soft(awsOf(d).filter((c: any) => !isModulesRead(c)).map((c: any) => `${c.service} ${c.op} ${c.table ?? ''}`), 'Recruitment off: only the module read happens').toEqual([]);
    const naming = (c: string) => ({
      headers: { 'x-tenant-id': c, 'X-Tenant-Id': c, 'x-company-id': c, 'tenant-id': c, tenant_id: c },
      query: { tenant_id: c, tenantId: c, company_id: c, companyId: c },
      body: { tenant_id: c, tenantId: c, company_id: c },
    });
    // m1 (company A) naming B everywhere: the same answer as plain.
    expect.soft(answer(readIv(C.m1, K.i1, t0, naming(B))), 'm1 naming company B in headers, query and body: the same answer').toEqual(answer(plainRead));
    // Company B's people naming A everywhere: still the same 404.
    for (const who of [C.mB, C.recruiterB]) isNotFound(`${who.name} naming company A in headers, query and body`, readIv(who, K.i1, t0, naming(A)));
    // The caller is the sign-in only: naming a panel member's person id in headers, query or body lets nobody in, and naming
    // someone else does not shut the panel member out.
    const asPerson = (sub: string) => ({
      headers: { 'x-user-id': sub, 'x-person-id': sub, 'x-sub': sub, sub, 'x-amzn-oidc-identity': sub },
      query: { user_id: sub, sub, person_id: sub, userId: sub },
      body: { user_id: sub, sub, person_id: sub, voter_id: sub, me: sub },
    });
    for (const who of [C.outsider, C.mB, C.recruiter]) isNotFound(`${who.name} naming panel member m1's person id in headers, query and body`, readIv(who, K.i1, t0, asPerson(SUB.m1)));
    expect.soft(answer(readIv(C.m1, K.i1, t0, asPerson(SUB.outsider))), 'm1 naming another person\'s id: the same answer as plain').toEqual(answer(plainRead));
    // B's own interview, read by B's panel member, still works (the route is not simply closed to B).
    const bOwn = readIv(C.mB, K.ib, t0, naming(A));
    expect.soft([statusOf(bOwn), bodyOf(bOwn)?.id, bodyOf(bOwn)?.candidate_first], 'B\'s panel member reads B\'s interview, whatever company the request names').toEqual([200, K.ib, 'Bongi']);
  });

  // ---------------------------------------------------------------- AC-3.6

  test('AC-3.6 No new grant, one new route: GET /v1/interviews/{id} on submit_vote\'s integration, JWT; submitVote\'s role and policy as on develop', async ({}, testInfo) => {
    once(testInfo.project.name);
    const all = blocks(filesOf('talent-flow-infra'), 'resource');
    const plainKey = (v: string | undefined) => (v ?? '').replace(/["\s]/g, '');
    const routes = all.filter((b) => b.labels[0] === 'aws_apigatewayv2_route');
    const mine = routes.filter((b) => plainKey(attributes(b.body).get('route_key')) === plainKey(ROUTE));
    expect(mine.map((b) => b.labels[1]), 'the route is declared once, named get_interview (the name chat-15 AC-12 allows)').toEqual(['get_interview']);
    const a = attributes(mine[0]!.body);
    expect.soft(/integrations\/\$\{aws_apigatewayv2_integration\.submit_vote\.id\}/.test(a.get('target') ?? ''), 'it goes to submit_vote\'s integration').toBe(true);
    expect.soft((a.get('authorization_type') ?? '').replace(/"/g, ''), 'JWT').toBe('JWT');
    expect.soft(a.get('authorizer_id') ?? '', 'the Cognito authorizer of the TalentFlow API').toMatch(/aws_apigatewayv2_authorizer\.talent_flow_api_cognito\.id/);
    expect.soft(a.get('api_id') ?? '', 'on the TalentFlow API').toMatch(/aws_apigatewayv2_api\.talent_flow_api\.id/);
    // submit_vote's integration and Lambda: one each, as on develop.
    const base = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-ui-03-read', 'iam-25bd0e1.json'), 'utf8')) as { role: string; policies: Record<string, string[]>; integration: string };
    const integ = all.filter((b) => b.labels[0] === 'aws_apigatewayv2_integration' && b.labels[1] === 'submit_vote');
    expect.soft(integ.map((b) => createHash('sha256').update(b.body.replace(/\s+/g, ' ').trim()).digest('hex')), 'submit_vote\'s integration is as on develop').toEqual([base.integration]);
    const fn = all.find((b) => b.labels[0] === 'aws_lambda_function' && b.labels[1] === 'submit_vote');
    expect.soft((attributes(fn?.body ?? '').get('role') ?? '').trim(), 'submitVote keeps its role').toBe(base.role);
    const role = /^aws_iam_role\.([\w-]+)\.arn$/.exec(base.role)?.[1];
    const now = Object.fromEntries(Object.entries(policyLines()).filter(([, p]) => p.role === role).map(([k, p]) => [k, p.pairs ?? [`(unreadable) ${p.squash}`]]));
    expect.soft(now, 'submitVote\'s role has the same policy lines as on develop (no new grant)').toEqual(base.policies);
  });

  test('AC-3.6b Paperwork: routes-match-openapi passes; the API file describes the route with CognitoJWT, x-tenant token and the four roles; the company walk has its byId row', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(120_000);
    let out = '';
    let code = 0;
    try { out = execFileSync('node', [join(REPO, 'scripts', 'ci', 'routes-match-openapi.mjs')], { cwd: REPO, encoding: 'utf8' }); } catch (e: any) { code = e.status ?? 1; out = `${e.stdout ?? ''}${e.stderr ?? ''}`; }
    expect.soft([code, out.slice(-400)], 'routes-match-openapi.mjs passes').toEqual([0, out.slice(-400)]);
    const op = operation(doc(), ROUTE);
    expect(Boolean(op), `api/openapi.yaml describes ${ROUTE}`).toBe(true);
    expect.soft(op.security, 'security: CognitoJWT').toEqual([{ CognitoJWT: [] }]);
    expect.soft(op['x-tenant'], 'x-tenant: token').toBe('token');
    expect.soft([...(op['x-roles'] ?? [])].sort(), 'x-roles: exactly admin, hr_staff, manager, employee').toEqual(['admin', 'employee', 'hr_staff', 'manager']);
    const s200 = answerSchema(doc(), ROUTE, 200) as any;
    expect.soft(Object.keys(s200?.properties ?? {}).sort(), 'the 200 answer lists exactly rule 3\'s keys and why').toEqual([...KEYS, 'why'].sort());
    expect.soft(Boolean(op.responses?.['404']), 'and names its 404').toBe(true);
    const rows = JSON.parse(readFileSync(join(REPO, 'scripts', 'tenancy', 'ten-04-rows.json'), 'utf8')) as Record<string, any>;
    expect.soft(rows[ROUTE], 'ten-04-rows.json: a byId row on the seeded interview').toEqual({ kind: 'byId', ids: { id: 'interview' } });
    expect.soft(rows[ROUTE]?.ids?.id, 'the same seeded company A interview the votes row uses').toBe(rows['POST /v1/interviews/{id}/votes']?.ids?.id);
  });

  // ---------------------------------------------------------------- AC-3.7

  test('AC-3.7 Read only: no write, no event, no table change for any caller; logs carry error names only', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const t0 = votes(world(), [[C.m2, K.i1, scoresFor(R7, 4)]]);
    const done = withInterview(t0, K.z, K.iX, { status: 'COMPLETED' });
    const runs: [string, Run, Tables][] = [];
    for (const [who, iv, t] of [
      [C.m1, K.i1, t0], [C.m2, K.i1, t0], [C.m1, K.iF, t0], [C.m1, K.iX, done], [C.m1, K.i0, t0], [C.m1, K.iN, t0],
      [C.outsider, K.i1, t0], [C.recruiter, K.i1, t0], [C.hm, K.i1, t0], [C.mB, K.i1, t0], [C.m1, 'iv-rui03-nobody-has-this', t0], [C.recruiterD, K.i1, t0],
    ] as [Caller, string, Tables][]) runs.push([`${who.name} on ${iv}`, readIv(who, iv, t), t]);
    expect(statusOf(runs[0]![1]), `control: m1 reads I1 (${describe(runs[0]![1])})`).toBe(200);
    for (const [what, r, t] of runs) {
      expect.soft(writesOf(r).map((c: any) => `${c.service} ${c.op}`), `${what}: no Put, Update, Delete, Transact or event`).toEqual([]);
      expect.soft(changed(t, r.tables), `${what}: no table changes`).toEqual([]);
      const logs = logsOf(r).join('\n');
      expect.soft([K.i1, K.iF, K.iX, K.i0, K.iN].filter((x) => logs.includes(x)), `${what}: no interview id in the logs`).toEqual([]);
    }
    // A failing read: 500, and the log line names the error only.
    // GetItem: the 2nd one (the 1st is the module read, which has its own answer).
    for (const [ops, nth] of [[['Query'], 1], [['GetItem'], 2]] as [string[], number][]) {
      const f = readIv(C.m1, K.i1, t0, {}, { fail: { service: 'dynamodb', ops, nth, message: `boom for ${K.i1} and ${SUB.m1}`, name: 'ProvisionedThroughputExceededException' } });
      expect.soft(statusOf(f), `${ops[0]} fails: 500 (${describe(f)})`).toBe(500);
      const logs = logsOf(f).join('\n');
      expect.soft(logs, `${ops[0]} fails: the error name is logged`).toContain('ProvisionedThroughputExceededException');
      expect.soft([K.i1, SUB.m1, 'boom'].filter((x) => logs.includes(x)), `${ops[0]} fails: no interview id, caller id or error message in the logs`).toEqual([]);
      expect.soft(writesOf(f).length, `${ops[0]} fails: nothing is written`).toBe(0);
    }
  });

  // ---------------------------------------------------------------- AC-3.8 (pepla-dev)

  test('AC-3.8 pepla-dev seed: seed-dev.py puts "REC-UI-03.3 read" back every run, deleting both VOTE# and VOTED# rows, under the ids in support/rec-ui-03-read/dev-ids.json (text check)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const seed = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-ui-03-read', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    expect.soft(Object.keys(ids).sort(), 'dev-ids.json names the candidate and the interview').toEqual(['candidate', 'interview']);
    const fns = [...seed.matchAll(/^def (\w+)\([\s\S]*?(?=^def |^if __name__)/gm)].map((m) => ({ name: m[1]!, body: m[0] }));
    const fn = fns.find((f) => /rec-ui-03-read["'\s/,]*dev-ids\.json/.test(f.body) || (f.body.includes(ids['candidate']!) && f.body.includes(ids['interview']!)));
    expect(fn, 'a seed function reads support/rec-ui-03-read/dev-ids.json (or writes its ids)').toBeTruthy();
    const body = fn!.body;
    for (const p of ['"VOTE#"', '"VOTED#"']) expect.soft(body.includes(p), `${fn!.name} removes the ${p} rows`).toBe(true);
    expect.soft(/delete_item\(/.test(body) && /begins_with\(SK/.test(body), `${fn!.name} deletes them by prefix`).toBe(true);
    for (const f of ['"SCHEDULED"', 'votesSubmitted', 'PANEL_FEEDBACK_PENDING_COUNT', 'criteria_snapshot', 'panelMemberIds', 'tenant_id']) expect.soft(body.includes(f), `${fn!.name} writes ${f}`).toBe(true);
    expect.soft(/SECOND_TENANT_ID|guest_email|guest_link_hash/.test(body), `${fn!.name} seeds nothing for company B and no guest`).toBe(false);
    const main = seed.slice(seed.indexOf('def main('));
    expect.soft(new RegExp(`\\b${fn!.name}\\(\\s*ddb\\s*,`).test(main), `main() calls ${fn!.name}`).toBe(true);
    const card = readFileSync(join(__dirname, 'cards', 'rec-ui-03.md'), 'utf8');
    expect.soft(card, 'the card notes name the step 3 dev seed contract').toContain('REC-UI-03 step 3 dev seed');
  });

  test('AC-3.8 The test logins on pepla-dev: the panel login reads "REC-UI-03.3 read" (WAITING, may give feedback); the HR and IT logins, not on its panel, get 404 @pepla-dev', async ({ page }) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-3.1 to AC-3.7.');
    test.setTimeout(3 * 60_000);
    const api = await devApi(page, ['E2E_EMP', 'E2E_HR', 'E2E_IT']);
    const ids = devIds();
    const path = `/v1/interviews/${encodeURIComponent(ids['interview']!)}`;
    const mine = await api('E2E_EMP', 'GET', path);
    expect(mine.status, `the panel login reads it (${mine.text.slice(0, 200)})`).toBe(200);
    expect.soft([mine.json?.id, mine.json?.my_feedback, mine.json?.my_vote, mine.json?.can], 'WAITING, no vote, may give feedback').toEqual([ids['interview'], 'WAITING', null, { capture_feedback: true }]);
    expect.soft((mine.json?.criteria ?? []).length, 'it carries its criteria').toBeGreaterThan(0);
    for (const who of ['E2E_HR', 'E2E_IT']) {
      const r = await api(who, 'GET', path);
      expect.soft([r.status, r.text], `${who}, not on the panel: 404 Not found`).toEqual([404, JSON.stringify({ error: 'Not found' })]);
    }
  });

  test('AC-3.8 The company B walk on pepla-dev: company B\'s HR login gets 404 on A\'s interview @pepla-dev', async ({ page }, testInfo) => {
    // The dev workflow runs titles with "company B walk on pepla-dev" in its "Company walk (TEN-04)" step, where E2E_HR_B is the walk
    // company with Recruitment on; the main run leaves them out.
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-3.2 and AC-3.5.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(2 * 60_000);
    const api = await devApi(page, ['E2E_HR_B']);
    const r = await api('E2E_HR_B', 'GET', `/v1/interviews/${encodeURIComponent(devIds()['interview']!)}`);
    expect([r.status, r.text], 'company B\'s HR login with A\'s interview id: 404 Not found').toEqual([404, JSON.stringify({ error: 'Not found' })]);
  });
});

const devIds = () => JSON.parse(readFileSync(join(__dirname, 'support', 'rec-ui-03-read', 'dev-ids.json'), 'utf8')) as Record<string, string>;

/** Signs the named dev logins in at Cognito and returns a caller of pepla-dev's TalentFlow API (as INT-01 AC-18 does). */
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
  return async (who: string, method: string, path: string) => {
    const r = await page.request.fetch(`${tfApi}${path}`, { method, headers: { Authorization: `Bearer ${tokens[who]}` } });
    const text = await r.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: r.status() as number, text, json };
  };
}

void DAY;
