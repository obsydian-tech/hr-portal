import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO } from './support/rec-14/lambda-harness';
import { answerSchema, checker, operation, readDoc, type Doc } from './support/rec-14/schema';
import { blocks, attributes } from './support/infra-harness';
import { filesOf, policyLines, resourcesOf, STACKS } from './support/rec-02/iam';
import {
  A, B, C, DAY, DEFAULT_KEYS, I2_CRITERIA, K, NOW, R7_CRITERIA, ROLES_TABLE, SCHEDULED_AT, SUB, TABLE, allText, av, bodyOf, changed, describe, evaluate,
  interviewOf, interviewRow, interviews, linkVote, logsOf, makeLink, oldVoteRow, plain, readLink, rowsOf, sagaOf, schedule, sha256B64u, sha256Hex, sheet,
  statusOf, vote, votesOf, withSetting, world, writesOf, awsOf, isModulesRead, forged as withForgedCompany, personalLogLines, seen, type Caller, type Run, type Tables,
} from './support/rec-07/world';
import { isRec15bGrant } from './support/rec-15b.1/grants';
import { isRec15cGrant } from './support/rec-15c.1/grants'; // child lock rec-15c.1
import { isRec05Grant, REC05_ROLE_KEY } from './support/rec-05.1/grants'; // child lock rec-05.1

/**
 * REC-07 · Scoring per role: 1 to 5 per criterion, plain averages, one guest link (amber). Spec:
 * /mnt/project-files/onboarding-cards/specs/REC-07.md (rules 1 to 9, AC-1 to AC-10). Notes: cards/rec-07.md. Review page:
 * onboarding-cards/specs/REC-07-tests-for-review.md (the bar). The routes and answers follow REC-UI-03's contract table (the screen card
 * that reads them).
 *
 * The Lambda tests run the real handlers (lambda/submitVote, submitVoteByToken, generateScoringLink, scheduleInterview,
 * completeEvaluation) in a fresh Node process each call, against REC-14's fake AWS, over REC-02's companies with the real Standard pack
 * for company A and this card's rows (support/rec-07/world.ts), at one fixed time (NOW, REC-15's clock). Terraform is read as text.
 * Nothing calls AWS or any AI. Nothing here has a screen width: each test runs once, at 1280. AC-10 runs on pepla-dev only.
 *
 * Pinned by the verifier where the spec is silent (each is in cards/rec-07.md for the BA to confirm):
 *  - D-T-7.1 Routes and handlers. POST /v1/interviews/{id}/votes and GET /v1/candidates/{id}/scores are submitVote's;
 *    GET and POST /v1/scoring-links/{token} are submitVoteByToken's (the existing NONE route group); POST
 *    /v1/candidates/{id}/scoring-links stays generateScoringLink's; GET /v1/candidates/{id}/interviews stays scheduleInterview's. The old
 *    routes (POST /v1/candidates/{id}/votes, POST /v1/scoring/{token}/votes) are not deleted (a Terraform delete waits for Iggie); these
 *    tests do not judge them.
 *  - D-T-7.2 Answers. 404 { error: 'Not found' } for an interview or candidate that is not the caller's company's (or does not exist);
 *    403 { error: 'Forbidden' } for a person of the company who may not do it; 400 { error: 'Bad request', code: 'INVALID_SCORES' };
 *    400 { error: 'Bad request', code: 'INVALID_FIELD', field } for rating, comment, on_behalf_of, interview_id and guest_email;
 *    409 { error: 'Conflict', code: 'ALREADY_SCORED' }. Who is asked before what: 404, then 403, then 400, then 409. A saved vote is
 *    200 or 201.
 *  - D-T-7.3 The interview's criteria: scheduleInterview copies the role's criteria (`[{ key, label }]`, in order) onto the interview row
 *    as `criteria_snapshot`. A candidate with no role gets the company's SCORING_WEIGHTS defaultCriteria at that moment.
 *  - D-T-7.4 Scores: an object holding exactly the snapshot's keys, each a whole number (a JSON number) from 1 to 5. Anything else,
 *    scores missing or not an object included, is INVALID_SCORES. rating one of the four. comment optional, a string up to 2000
 *    characters.
 *  - D-T-7.5 The stored vote: on the candidate (PK CANDIDATE#<id>, SK starting VOTE#<voter>#), voterId = the panel member (the caller,
 *    or on_behalf_of), interviewId, scores, rating, comment, tenant_id. A Recruiter's entry also has entered_by = the Recruiter and
 *    on_behalf = true; a member's own vote is not on_behalf.
 *  - D-T-7.6 The interview row holds PANEL_FEEDBACK_PENDING_COUNT (panel members with no vote yet; written when scheduled and on every
 *    vote), PANEL_SPLIT_FLAG and, once every panel member has voted, PANEL_CONSENSUS, unrounded. Names as the spec writes them (REC-09
 *    reads them).
 *  - D-T-7.7 The sheet answer: { final_score, interviews: [{ interview_id, criteria: [{ key, label, mean }], overall, vote_count,
 *    pending_count, split, consensus, votes? }] }. Means to one decimal; an interview with no new vote has overall null and is left out
 *    of final_score; consensus is null until every panel member has voted. votes (each with voter_id, scores, rating, comment) only for
 *    a Recruiter and the decider. A guest's vote counts in its interview's means and vote_count, not in pending_count.
 *  - D-T-7.8 Who sees what is judged by difference: a panel member's answer does not change when another member's vote changes; a
 *    hiring manager who is not the decider gets the same answer when the same scores are given by different members with different
 *    comments. A person with no relation to the candidate gets 404. GET /v1/candidates/{id}/interviews follows the same rule for votes,
 *    and carries each interview's criteria_snapshot.
 *  - D-T-7.9 The final score is kept unrounded on the candidate row in the field completeEvaluation writes today (finalScore). It gets
 *    there the way it does today: when a vote leaves an interview with nobody pending, submitVote publishes VotingCompleted, and its
 *    averageScore is rule 5's final score over all the candidate's interviews, worked out from the stored votes (unrounded);
 *    completeEvaluation stores that number. evaluation_result is not judged here (the spec does not say its values).
 *  - D-T-7.10 Legacy votes (today's shape, no 1 to 5 scale) are returned in their interview's votes with legacy: true and
 *    scale { min: 0, max: 10 }, scores unchanged, never in a mean, a vote_count or final_score.
 *  - D-T-7.11 The guest link: POST /v1/candidates/{id}/scoring-links takes { interview_id, guest_email } and answers 201 with the raw
 *    `token` (shown this once) and `expires_at` (NOW + 7 days). The token is at least 128 bits of URL-safe text. At rest only its
 *    SHA-256 (hex or base64url) is kept, in a row holding tenant_id, interview_id, candidate_id, guest_email, expires_at and used_at
 *    (null until used). The GET answer is exactly { candidate_first, candidate_last, role_title (the candidate's positionTitle),
 *    interview_type, interview_at, criteria, expires_at }. The single refusal is today's expired answer, the whole response object:
 *    410, Content-Type application/json, body {"error":"Scoring link has expired"}.
 *  - D-T-7.12 The Idempotency-Key header the screen sends (REC-UI-03) gives no other caller a saved answer: a member who re-sends
 *    another member's key gets their own vote stored as themselves.
 *  - D-T-7.13 Terraform: the four new route keys; the two public ones authorization NONE on submitVoteByToken's integration, with a
 *    route-level throttle of at most 10 a second, burst at most 20; no new IAM role; the five handlers' policies gain only dynamodb
 *    GetItem or Query lines on the TalentFlow state or roles table (or an index of them), and no new line holds a wildcard.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const NOT_FOUND = { error: 'Not found' };
const FORBIDDEN = { error: 'Forbidden' };
const BAD_SCORES = { error: 'Bad request', code: 'INVALID_SCORES' };
const invalid = (field: string) => ({ error: 'Bad request', code: 'INVALID_FIELD', field });
const ALREADY = { error: 'Conflict', code: 'ALREADY_SCORED' };
/** Today's expired-link answer (lambda/submitVoteByToken on develop bc0fada), the whole response object. */
const EXPIRED = { statusCode: 410, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Scoring link has expired' }) };
const answer = (r: Run) => [statusOf(r), bodyOf(r)];
const saved = (r: Run) => [200, 201].includes(statusOf(r) ?? 0);
const r1 = (x: number) => Math.round(x * 10) / 10;
const close = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 1e-9;
/** The rows a run added or changed, in full. */
const newRows = (before: Tables, after: Tables) => Object.entries(after).flatMap(([name, rows]) => {
  const was = new Set((before[name] ?? []).map((r) => JSON.stringify(r)));
  return rows.filter((r) => !was.has(JSON.stringify(r))).map((r) => `${name} ${JSON.stringify(plain(r))}`);
}).sort();
/** REC-00: the company comes only from the sign-in. The same call with company B named in headers and the query gives the same answer and writes. */
function sameWithForgedCompany(what: string, before: Tables, call: () => Run) {
  const plainRun = call();
  const forgedRun = withForgedCompany(call);
  expect.soft(answer(forgedRun), `${what}, company B named in headers and the query string: the same answer`).toEqual(answer(plainRun));
  expect.soft(newRows(before, forgedRun.tables), `${what}, company B named in headers and the query string: the same rows written`).toEqual(newRows(before, plainRun.tables));
}

/** A vote body on I1 (R7's criteria). */
const onI1 = (s: [number, number, number], rating: string, comment?: string, extra: Record<string, unknown> = {}) =>
  ({ scores: { sales: s[0], comms: s[1], product: s[2] }, rating, ...(comment === undefined ? {} : { comment }), ...extra });
/** A vote body on I2 (lead, comms). */
const onI2 = (s: [number, number], rating: string, comment?: string, extra: Record<string, unknown> = {}) =>
  ({ scores: { lead: s[0], comms: s[1] }, rating, ...(comment === undefined ? {} : { comment }), ...extra });

/** Runs votes one after another, each on the tables the last left; fails the test with the first refusal. */
function votes(t: Tables, list: [Caller, string, unknown][]): Tables {
  let cur = t;
  for (const [who, iv, body] of list) {
    const r = vote(who, iv, body, cur);
    expect(saved(r), `${who.name} scores ${iv} (${describe(r)})`).toBe(true);
    cur = r.tables;
  }
  return cur;
}
/** The same, also returning every VotingCompleted that the votes published, in order. */
function votesAndEvents(t: Tables, list: [Caller, string, unknown][]): { tables: Tables; events: any[] } {
  let cur = t;
  const events: any[] = [];
  for (const [who, iv, body] of list) {
    const r = vote(who, iv, body, cur);
    expect(saved(r), `${who.name} scores ${iv} (${describe(r)})`).toBe(true);
    events.push(...r.calls.filter((c: any) => c.service === 'events' && c.detailType === 'VotingCompleted').map((c: any) => c.detail));
    cur = r.tables;
  }
  return { tables: cur, events };
}
/** The fixture of AC-4: I1 scored by all three, I2 by two (one positive, one negative). */
const I1_VOTES: [Caller, string, unknown][] = [
  [C.m1, K.i1, onI1([4, 5, 4], 'YES', 'Knows the product range well.')],
  [C.m2, K.i1, onI1([4, 4, 5], 'YES', 'Good on objections.')],
  [C.m3, K.i1, onI1([5, 5, 4], 'STRONG_YES', 'Best of the week.')],
];
const I2_VOTES: [Caller, string, unknown][] = [
  [C.m1, K.i2, onI2([3, 4], 'NO', 'Unsure about leading a team.')],
  [C.m2, K.i2, onI2([5, 5], 'YES', 'Led the case study.')],
];
// Expected values (rule 5): I1 sales 13/3, comms 14/3, product 13/3, overall 40/9; I2 lead 4, comms 4.5, overall 4.25; final (40/9 + 4.25) / 2.
const I1_OVERALL = 40 / 9;
const I2_OVERALL = 4.25;
const FINAL = (I1_OVERALL + I2_OVERALL) / 2;

const ivOf = (r: Run, iv: string) => ((bodyOf(r)?.interviews ?? []) as any[]).find((x) => x?.interview_id === iv);
const stageFields = (t: Tables, cand: string) => { const s = sagaOf(t, cand); return [s['currentStage'], s['status'], s['stageEnteredAt'], s['not_hired_reason'] ?? null, s['not_hired_pending'] ?? null]; };

let docCache: Doc | undefined;
const doc = () => (docCache ??= readDoc());
/** The answer passes api/openapi.yaml for its route and status. */
function fits(label: string, route: string, r: Run) {
  const s = statusOf(r);
  const problems = s === undefined ? [`no answer (${describe(r)})`] : checker(doc()).check(answerSchema(doc(), route, s), bodyOf(r));
  expect.soft(problems, `${label}: the answer passes api/openapi.yaml for ${route} ${s}`).toEqual([]);
}

test.describe('REC-07 Scoring per role: 1 to 5 per criterion, plain averages, one guest link', () => {
  // ---------------------------------------------------------------- AC-1

  test('AC-1 Criteria and scale: the interview keeps the role\'s criteria from scheduling; a later role change does not move it; scores outside the snapshot or 1 to 5 are INVALID_SCORES', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const t0 = world();

    // Scheduling copies R7's criteria, in order, and counts the whole panel as pending.
    const body = { interviewId: 'iv-rec07-a-x1', interviewType: 'TECHNICAL', scheduledAt: '2026-11-30T09:00:00.000Z', panelMemberIds: [SUB.m1, SUB.m2] };
    const s = schedule(C.recruiter, K.x, body, t0);
    expect(saved(s), `a Recruiter schedules an interview for a candidate of R7 (${describe(s)})`).toBe(true);
    const row = interviewOf(s.tables, K.x, 'iv-rec07-a-x1') ?? {};
    expect.soft(row['criteria_snapshot'], 'the interview holds R7\'s criteria, keys and labels in order').toEqual(R7_CRITERIA);
    expect.soft(row['PANEL_FEEDBACK_PENDING_COUNT'], 'and both panel members are pending').toBe(2);
    expect.soft(row['tenant_id'], 'the row is company A\'s').toBe(A);

    // The role changes afterwards: the interview keeps what it was scheduled with, and scores follow the interview, not the role.
    const changedRole = structuredClone(s.tables);
    changedRole[ROLES_TABLE] = (changedRole[ROLES_TABLE] ?? []).map((r) => (plain(r)['role_id'] === K.r7 ? { ...r, criteria: av({ c: [{ key: 'closing', label: 'Closing' }, { key: 'sales', label: 'Sales' }] })['c']! } : r));
    const newKeys = vote(C.m1, 'iv-rec07-a-x1', { scores: { closing: 4, sales: 4 }, rating: 'YES' }, changedRole);
    expect.soft(answer(newKeys), 'scores on the role\'s new criteria are refused for the old interview').toEqual([400, BAD_SCORES]);
    expect.soft(writesOf(newKeys).length, 'and nothing is written').toBe(0);
    const oldKeys = vote(C.m1, 'iv-rec07-a-x1', onI1([4, 4, 4], 'YES'), changedRole);
    expect.soft(saved(oldKeys), `scores on the interview's own criteria are saved (${describe(oldKeys)})`).toBe(true);
    expect.soft(interviewOf(oldKeys.tables, K.x, 'iv-rec07-a-x1')?.['criteria_snapshot'], 'the interview\'s criteria did not move').toEqual(R7_CRITERIA);

    // A candidate with no role: the company's default criteria at that moment (the Standard pack's, then a company change).
    const w = schedule(C.recruiter, K.w, { ...body, interviewId: 'iv-rec07-a-w1' }, t0);
    expect(saved(w), `a Recruiter schedules for a candidate with no role (${describe(w)})`).toBe(true);
    expect.soft(((interviewOf(w.tables, K.w, 'iv-rec07-a-w1')?.['criteria_snapshot'] ?? []) as any[]).map((c) => c.key), 'it takes the Standard pack\'s default criteria').toEqual(DEFAULT_KEYS);
    const own = [{ key: 'baking', label: 'Baking' }, { key: 'hygiene', label: 'Hygiene' }];
    const tw = withSetting(t0, 'SCORING_WEIGHTS', (d) => ({ ...d, defaultCriteria: own }));
    const w2 = schedule(C.recruiter, K.w, { ...body, interviewId: 'iv-rec07-a-w2' }, tw);
    expect.soft(interviewOf(w2.tables, K.w, 'iv-rec07-a-w2')?.['criteria_snapshot'], 'or the company\'s own default criteria').toEqual(own);

    // Scores must be exactly I1's keys, whole numbers from 1 to 5.
    const bad: [string, unknown][] = [
      ['a criterion missing', { sales: 4, comms: 4 }], ['an extra criterion', { sales: 4, comms: 4, product: 4, lead: 4 }], ['0', { sales: 0, comms: 4, product: 4 }],
      ['6', { sales: 6, comms: 4, product: 4 }], ['3.5', { sales: 3.5, comms: 4, product: 4 }], ['"4" as text', { sales: '4', comms: 4, product: 4 }],
      ['null', { sales: null, comms: 4, product: 4 }], ['-1', { sales: -1, comms: 4, product: 4 }], ['10 (the old scale)', { sales: 10, comms: 8, product: 9 }],
      ['the old four criteria', { technical: 4, communication: 4, culturalFit: 4, problemSolving: 4 }], ['a list', [4, 4, 4]], ['a number', 4], ['nothing', undefined],
    ];
    for (const [what, scores] of bad) {
      const r = vote(C.m1, K.i1, { scores, rating: 'YES' }, t0);
      expect.soft(answer(r), `scores with ${what}: 400 INVALID_SCORES`).toEqual([400, BAD_SCORES]);
      expect.soft(writesOf(r).length, `scores with ${what}: nothing is written`).toBe(0);
    }
    for (const [what, body2, field] of [
      ['rating MAYBE', onI1([4, 4, 4], 'MAYBE'), 'rating'], ['no rating', { scores: { sales: 4, comms: 4, product: 4 } }, 'rating'],
      ['a comment of 2001 characters', onI1([4, 4, 4], 'YES', 'x'.repeat(2001)), 'comment'], ['a comment that is a number', onI1([4, 4, 4], 'YES', 42 as any), 'comment'],
    ] as [string, unknown, string][]) {
      const r = vote(C.m1, K.i1, body2, t0);
      expect.soft(answer(r), `${what}: 400 INVALID_FIELD ${field}`).toEqual([400, invalid(field)]);
      expect.soft(writesOf(r).length, `${what}: nothing is written`).toBe(0);
    }
    // The edges are allowed: 1 and 5, and a comment of exactly 2000 characters.
    const edge = vote(C.m1, K.i1, onI1([1, 5, 1], 'STRONG_NO', 'y'.repeat(2000)), t0);
    expect.soft(saved(edge), `1, 5 and a 2000-character comment are saved (${describe(edge)})`).toBe(true);
    const stored = votesOf(edge.tables, K.v).filter((v) => v['interviewId'] === K.i1);
    expect.soft(stored.map((v) => [v['scores'], v['rating'], String(v['comment'] ?? '').length]), 'stored as given').toEqual([[{ sales: 1, comms: 5, product: 1 }, 'STRONG_NO', 2000]]);
    fits('a saved vote', 'POST /v1/interviews/{id}/votes', edge);
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 One vote each: the voter is the caller whatever the body says; a second is 409 ALREADY_SCORED; not on the panel is 403; another company is 404; no company or Recruitment off is 403 before any other AWS call', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const fromRun = seen.length;
    const t0 = world();
    const forged = vote(C.m1, K.i1, onI1([4, 4, 4], 'YES', undefined, { voterId: SUB.m2, voter_id: SUB.m2, staffId: 'STAFF-x', tenantId: B, tenant_id: B, entered_by: SUB.recA, on_behalf: true, candidateId: K.vb }), t0);
    expect(saved(forged), `panel member 1 scores I1 (${describe(forged)})`).toBe(true);
    const mine = votesOf(forged.tables, K.v).filter((v) => v['interviewId'] === K.i1);
    expect.soft(mine.length, 'exactly one vote is written').toBe(1);
    expect.soft([mine[0]?.['voterId'], String(mine[0]?.['SK'] ?? '').startsWith(`VOTE#${SUB.m1}#`), mine[0]?.['tenant_id']], 'stored under the caller and the caller\'s company, not the body\'s').toEqual([SUB.m1, true, A]);
    expect.soft([mine[0]?.['on_behalf'] === true, mine[0]?.['entered_by'] ?? null], 'a member\'s own vote is not marked as entered for them').toEqual([false, null]);
    expect.soft(votesOf(forged.tables, K.vb).length, 'nothing lands on B\'s candidate').toBe(0);

    const again = vote(C.m1, K.i1, onI1([5, 5, 5], 'STRONG_YES'), forged.tables);
    expect.soft(answer(again), 'a second vote by the same member on the same interview: 409 ALREADY_SCORED').toEqual([409, ALREADY]);
    expect.soft(writesOf(again).length, 'and nothing is written').toBe(0);
    const other = vote(C.m1, K.i2, onI2([4, 4], 'YES'), forged.tables);
    expect.soft(saved(other), `the same member may score another interview (${describe(other)})`).toBe(true);

    for (const who of [C.outsider, C.hm, C.otherHm, C.recruiter]) {
      const r = vote(who, K.i1, onI1([4, 4, 4], 'YES', undefined, { voterId: SUB.m2 }), t0);
      expect.soft(answer(r), `${who.name} is not on I1's panel: 403 Forbidden`).toEqual([403, FORBIDDEN]);
      expect.soft(writesOf(r).length, `${who.name}: nothing is written`).toBe(0);
    }
    for (const [who, iv, what] of [[C.mB, K.i1, 'B\'s panel member on A\'s interview'], [C.recruiterB, K.i1, 'B\'s Recruiter on A\'s interview'], [C.m1, K.ib, 'A\'s member on B\'s interview'], [C.m1, 'iv-rec07-ghost', 'an interview that does not exist']] as [Caller, string, string][]) {
      const r = vote(who, iv, onI1([4, 4, 4], 'YES'), t0);
      expect.soft(answer(r), `${what}: 404 Not found`).toEqual([404, NOT_FOUND]);
      expect.soft(writesOf(r).length, `${what}: nothing is written`).toBe(0);
    }
    // REC-00 rule 1: company, then module, before any other AWS call. A caller with no company: 403 and no AWS call. A Recruiter of a
    // company with Recruitment off (D): MOD-01's 403, and only the module read happens. Every person route of this card.
    const personRoutes: [string, (who: Caller) => Run][] = [
      ['POST /v1/interviews/{id}/votes', (who) => vote(who, K.i1, onI1([4, 4, 4], 'YES'), t0)],
      ['GET /v1/candidates/{id}/scores', (who) => sheet(who, K.v, t0)],
      ['GET /v1/candidates/{id}/interviews', (who) => interviews(who, K.v, t0)],
      ['POST /v1/candidates/{id}/scoring-links', (who) => makeLink(who, K.v, { interview_id: K.i2, guest_email: 'guest@example.test' }, t0)],
    ];
    for (const [route, run] of personRoutes) {
      const none = run(C.noCompany);
      expect.soft([...answer(none), awsOf(none).length], `${route}, a caller with no company: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
      const d = run(C.recruiterD);
      expect.soft(answer(d), `${route}, a Recruiter of a company with Recruitment off: 403`).toEqual([403, FORBIDDEN]);
      expect.soft(awsOf(d).filter((c: any) => !isModulesRead(c)).map((c: any) => `${c.service} ${c.op} ${c.table ?? ''}`), `${route}, Recruitment off: only the module read happens`).toEqual([]);
    }

    // Who before what: a member not on the panel with bad scores is 403, another company's with bad scores is 404.
    expect.soft(statusOf(vote(C.outsider, K.i1, { scores: { sales: 9 }, rating: 'YES' }, t0)), 'not on the panel and bad scores: 403').toBe(403);
    expect.soft(statusOf(vote(C.mB, K.i1, { scores: { sales: 9 }, rating: 'YES' }, t0)), 'another company and bad scores: 404').toBe(404);

    // The Idempotency-Key the screen sends: panel member 2 re-sending member 1's key gets no saved answer of theirs.
    const key = { 'Idempotency-Key': 'rec07-key-of-member-1' };
    const k1 = vote(C.m1, K.i1, onI1([2, 2, 2], 'NO'), t0, key);
    expect(saved(k1), `member 1 scores with a key (${describe(k1)})`).toBe(true);
    const k2 = vote(C.m2, K.i1, onI1([5, 5, 5], 'STRONG_YES'), k1.tables, key);
    expect.soft(saved(k2), `member 2 re-sends member 1's key: their own vote is saved (${describe(k2)})`).toBe(true);
    const byVoter = Object.fromEntries(votesOf(k2.tables, K.v).filter((v) => v['interviewId'] === K.i1).map((v) => [v['voterId'], v['rating']]));
    expect.soft(byVoter, 'each vote is stored under its own member').toEqual({ [SUB.m1]: 'NO', [SUB.m2]: 'STRONG_YES' });

    // The company only from the sign-in: company B named in headers and the query string changes nothing, on every person route.
    sameWithForgedCompany('a panel member\'s vote', t0, () => vote(C.m1, K.i1, onI1([4, 3, 4], 'YES', 'Clear on pricing questions.'), t0));
    sameWithForgedCompany('a Recruiter entering for member 2', t0, () => vote(C.recruiter, K.i1, onI1([3, 3, 4], 'YES', 'From the paper sheet.', { on_behalf_of: SUB.m2 }), t0));
    const scored = votes(t0, [[C.m1, K.i1, onI1([4, 5, 4], 'YES', 'Knows the product range well.')]]);
    for (const who of [C.recruiter, C.hm, C.m1, C.m3]) {
      sameWithForgedCompany(`${who.name}: the sheet`, scored, () => sheet(who, K.v, scored));
      sameWithForgedCompany(`${who.name}: the interview list`, scored, () => interviews(who, K.v, scored));
    }
    sameWithForgedCompany('B\'s panel member on A\'s interview', t0, () => vote(C.mB, K.i1, onI1([4, 4, 4], 'YES'), t0));
    sameWithForgedCompany('B\'s Recruiter reading A\'s sheet', scored, () => sheet(C.recruiterB, K.v, scored));

    // Logs carry error names only: no comment, scores or candidate name in any log line of this test.
    expect.soft(personalLogLines(fromRun), 'no log line holds a vote comment, a vote\'s scores or the candidate\'s name').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 On behalf: only a Recruiter, only for a panel member with no vote, marked entered_by and on_behalf; the member is then refused', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const fromRun = seen.length;
    const t0 = world();
    const hr = vote(C.recruiter, K.i1, onI1([3, 4, 3], 'YES', 'Entered from the paper sheet.', { on_behalf_of: SUB.m2 }), t0);
    expect(saved(hr), `a Recruiter enters panel member 2's scores (${describe(hr)})`).toBe(true);
    const got = votesOf(hr.tables, K.v).filter((v) => v['interviewId'] === K.i1);
    expect.soft(got.map((v) => [v['voterId'], v['entered_by'], v['on_behalf'], v['scores']]), 'stored as member 2\'s, entered by the Recruiter, marked on behalf').toEqual([[SUB.m2, SUB.recA, true, { sales: 3, comms: 4, product: 3 }]]);
    const member = vote(C.m2, K.i1, onI1([5, 5, 5], 'STRONG_YES'), hr.tables);
    expect.soft(answer(member), 'member 2 can no longer score I1: 409 ALREADY_SCORED').toEqual([409, ALREADY]);
    expect.soft(writesOf(member).length, 'and nothing is written').toBe(0);

    const m1 = votes(t0, [[C.m1, K.i1, onI1([4, 4, 4], 'YES')]]);
    const late = vote(C.recruiter, K.i1, onI1([1, 1, 1], 'STRONG_NO', undefined, { on_behalf_of: SUB.m1 }), m1);
    expect.soft(answer(late), 'a Recruiter entering for a member who already scored: 409 ALREADY_SCORED').toEqual([409, ALREADY]);
    expect.soft(writesOf(late).length, 'and nothing is written').toBe(0);
    const twice = vote(C.recruiter, K.i1, onI1([1, 1, 1], 'STRONG_NO', undefined, { on_behalf_of: SUB.m2 }), hr.tables);
    expect.soft(answer(twice), 'entering for the same member twice: 409 ALREADY_SCORED').toEqual([409, ALREADY]);

    for (const [who, what] of [[SUB.outsider, 'a person not on the panel'], [SUB.m1 + 'x', 'an unknown person'], [SUB.mB, 'B\'s panel member']] as [string, string][]) {
      const r = vote(C.recruiter, K.i1, onI1([4, 4, 4], 'YES', undefined, { on_behalf_of: who }), t0);
      expect.soft(answer(r), `on behalf of ${what}: 400 INVALID_FIELD on_behalf_of`).toEqual([400, invalid('on_behalf_of')]);
      expect.soft(writesOf(r).length, `on behalf of ${what}: nothing is written`).toBe(0);
    }
    for (const who of [C.m3, C.hm, C.outsider]) {
      const r = vote(who, K.i1, onI1([4, 4, 4], 'YES', undefined, { on_behalf_of: SUB.m2 }), t0);
      expect.soft(answer(r), `${who.name} enters for member 2: 403 Forbidden`).toEqual([403, FORBIDDEN]);
      expect.soft(writesOf(r).length, `${who.name}: nothing is written`).toBe(0);
    }
    const b = vote(C.recruiterB, K.i1, onI1([4, 4, 4], 'YES', undefined, { on_behalf_of: SUB.m2 }), t0);
    expect.soft(answer(b), 'B\'s Recruiter entering on A\'s interview: 404').toEqual([404, NOT_FOUND]);
    const off = withSetting(t0, 'PANEL_CONFIG', (d) => ({ ...d, hrMayEnterForMember: false }));
    const refused = vote(C.recruiter, K.i1, onI1([4, 4, 4], 'YES', undefined, { on_behalf_of: SUB.m2 }), off);
    expect.soft(answer(refused), 'when the company does not allow HR to enter for a member: 403 Forbidden').toEqual([403, FORBIDDEN]);
    expect.soft(writesOf(refused).length, 'and nothing is written').toBe(0);
    expect.soft(personalLogLines(fromRun), 'no log line holds a vote comment, a vote\'s scores or the candidate\'s name').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Maths: per criterion means, overall as the mean of the criterion means, final score as the mean of the interviews, one decimal out, unrounded kept, equal weights', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const t = votes(world(), [...I1_VOTES, ...I2_VOTES]);
    const r = sheet(C.recruiter, K.v, t);
    expect(statusOf(r), `the Recruiter reads the sheet (${describe(r)})`).toBe(200);
    fits('the sheet', 'GET /v1/candidates/{id}/scores', r);
    const i1 = ivOf(r, K.i1);
    const i2 = ivOf(r, K.i2);
    expect.soft((i1?.criteria ?? []).map((c: any) => [c.key, c.label, c.mean]), 'I1: one mean per criterion of its snapshot, to one decimal').toEqual([['sales', 'Sales experience', 4.3], ['comms', 'Communication', 4.7], ['product', 'Product knowledge', 4.3]]);
    expect.soft([i1?.overall, i1?.vote_count, i1?.pending_count], 'I1: overall 4.4 (40/9), three votes, none pending').toEqual([r1(I1_OVERALL), 3, 0]);
    expect.soft((i2?.criteria ?? []).map((c: any) => [c.key, c.mean]), 'I2: its own criteria').toEqual([['lead', 4], ['comms', 4.5]]);
    expect.soft([i2?.overall, i2?.vote_count, i2?.pending_count], 'I2: overall 4.3 (4.25 half up), two votes, one pending').toEqual([4.3, 2, 1]);
    expect.soft(bodyOf(r)?.final_score, 'final score: the plain mean of the two interviews, 4.3').toBe(r1(FINAL));
    const i0 = ivOf(r, K.i0);
    expect.soft([i0?.overall ?? null, i0?.vote_count ?? 0], 'I0 (only an old vote): no overall, no vote counted').toEqual([null, 0]);

    // The pending count on the interview rows, for REC-09.
    expect.soft([interviewOf(t, K.v, K.i1)?.['PANEL_FEEDBACK_PENDING_COUNT'], interviewOf(t, K.v, K.i2)?.['PANEL_FEEDBACK_PENDING_COUNT']], 'the interview rows hold 0 and 1 pending').toEqual([0, 1]);

    // Unrounded on the candidate row: I2's two votes first, then I1's three; m3's vote leaves I1 with nobody pending, so it publishes
    // VotingCompleted carrying the final score worked out from the votes, and completeEvaluation keeps that number.
    const ev = votesAndEvents(world(), [...I2_VOTES, ...I1_VOTES]);
    const done = ev.events.filter((d) => d?.candidateId === K.v);
    expect.soft(done.length, 'exactly one VotingCompleted, after the last vote on I1').toBe(1);
    const avg = done[done.length - 1]?.averageScore;
    expect.soft(close(avg, FINAL), `its averageScore is the final score ${FINAL}, unrounded, from the votes (got ${avg})`).toBe(true);
    expect.soft(done[done.length - 1]?.tenant_id, 'for company A').toBe(A);
    const e = evaluate(K.v, ev.tables, typeof avg === 'number' ? avg : null);
    expect(e.error, `completeEvaluation runs (${e.error?.message})`).toBeUndefined();
    expect.soft(close(sagaOf(e.tables, K.v)['finalScore'], FINAL), `finalScore on the candidate is ${FINAL}, unrounded (got ${sagaOf(e.tables, K.v)['finalScore']})`).toBe(true);
    expect.soft(stageFields(e.tables, K.v), 'completeEvaluation moves nothing').toEqual(stageFields(ev.tables, K.v));

    // Equal weights: a company that holds weights gets the same numbers.
    const weighted = withSetting(world(), 'SCORING_WEIGHTS', (d) => ({ ...d, weights: { sales: 80, comms: 10, product: 10, lead: 90 } }));
    const rw = sheet(C.recruiter, K.v, votes(weighted, [...I1_VOTES, ...I2_VOTES]));
    expect.soft([ivOf(rw, K.i1)?.overall, ivOf(rw, K.i2)?.overall, bodyOf(rw)?.final_score], 'weights are not read: the same means').toEqual([r1(I1_OVERALL), 4.3, r1(FINAL)]);

    // An interview with no vote yet is left out of the final score; one vote alone counts.
    const single = sheet(C.recruiter, K.v, votes(world(), [[C.m2, K.i2, onI2([2, 3], 'NO')]]));
    expect.soft([ivOf(single, K.i1)?.overall ?? null, ivOf(single, K.i2)?.overall, bodyOf(single)?.final_score], 'one vote on I2 only: I1 none, I2 2.5, final 2.5').toEqual([null, 2.5, 2.5]);
    const none = sheet(C.recruiter, K.v, world());
    expect.soft(bodyOf(none)?.final_score ?? null, 'no new vote: final score null').toBeNull();
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 Flags: split is a positive and a negative on one interview; consensus is the share of the most common rating once all have voted; a Strong No writes REC-02\'s flag; nothing moves the candidate', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const t0 = world();
    const before = stageFields(t0, K.v);
    const t = votes(t0, [...I1_VOTES, ...I2_VOTES]);
    const iv1 = interviewOf(t, K.v, K.i1) ?? {};
    const iv2 = interviewOf(t, K.v, K.i2) ?? {};
    expect.soft([iv1['PANEL_SPLIT_FLAG'], close(iv1['PANEL_CONSENSUS'], 2 / 3)], 'I1 (Yes, Yes, Strong yes): no split, consensus 2/3 unrounded').toEqual([false, true]);
    expect.soft([iv2['PANEL_SPLIT_FLAG'], iv2['PANEL_CONSENSUS'] ?? null], 'I2 (No, Yes, one pending): split, no consensus yet').toEqual([true, null]);
    const s = sheet(C.recruiter, K.v, t);
    expect.soft([ivOf(s, K.i1)?.split, ivOf(s, K.i2)?.split, ivOf(s, K.i2)?.consensus ?? null], 'the sheet says the same').toEqual([false, true, null]);
    expect.soft(Math.abs((ivOf(s, K.i1)?.consensus ?? -1) - 2 / 3) < 0.01, `the sheet's consensus for I1 is 2/3 (got ${ivOf(s, K.i1)?.consensus})`).toBe(true);
    const t3 = votes(t, [[C.m3, K.i2, onI2([4, 4], 'YES')]]);
    expect.soft([interviewOf(t3, K.v, K.i2)?.['PANEL_SPLIT_FLAG'], close(interviewOf(t3, K.v, K.i2)?.['PANEL_CONSENSUS'], 2 / 3)], 'I2 after the third (Yes): still split, consensus 2/3').toEqual([true, true]);

    // More fixtures for the two rules.
    const cases: [string, string[], boolean, number][] = [
      ['Yes, Yes, Yes', ['YES', 'YES', 'YES'], false, 1],
      ['Strong yes, Yes, Strong yes', ['STRONG_YES', 'YES', 'STRONG_YES'], false, 2 / 3],
      ['No, Strong no, No', ['NO', 'STRONG_NO', 'NO'], false, 2 / 3],
      ['Strong yes, Strong no, No', ['STRONG_YES', 'STRONG_NO', 'NO'], true, 1 / 3],
      ['Yes, No, Strong no', ['YES', 'NO', 'STRONG_NO'], true, 1 / 3],
    ];
    for (const [what, ratings, split, consensus] of cases) {
      const tc = votes(world(), ratings.map((rating, i) => [[C.m1, C.m2, C.m3][i]!, K.i1, onI1([3, 3, 3], rating)] as [Caller, string, unknown]));
      const row = interviewOf(tc, K.v, K.i1) ?? {};
      expect.soft([row['PANEL_SPLIT_FLAG'], close(row['PANEL_CONSENSUS'], consensus)], `${what}: split ${split}, consensus ${consensus.toFixed(3)}`).toEqual([split, true]);
      expect.soft(row['PANEL_FEEDBACK_PENDING_COUNT'], `${what}: none pending`).toBe(0);
    }

    // A Strong No adds one to REC-02's strong_no_count (the Standard pack flags Strong No) and moves nothing.
    const sn = vote(C.m1, K.i1, onI1([1, 1, 1], 'STRONG_NO', 'Did not prepare.'), t0);
    expect(saved(sn), `a Strong No is saved (${describe(sn)})`).toBe(true);
    expect.soft(sagaOf(sn.tables, K.v)['strong_no_count'], 'strong_no_count is 1').toBe(1);
    for (const [label, tables] of [['after the Strong No', sn.tables], ['after five votes', t], ['after six votes', t3]] as [string, Tables][]) {
      expect.soft(stageFields(tables, K.v), `${label}: the candidate's stage, status and Not hired fields are as before`).toEqual(before);
    }
    const events = [...sn.calls, ...vote(C.m3, K.i1, onI1([5, 5, 5], 'YES'), t).calls].filter((c: any) => /events|eventbridge/i.test(c.service));
    expect.soft(JSON.stringify(events), 'no event names a stage move, an outcome or Not hired').not.toMatch(/StageAdvanced|CandidateRejected|NotHired|NOT_HIRED|REJECTED|VetoTriggered/);
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 What each person sees: a panel member only their own vote; a hiring manager who is not the decider only means and flags; the Recruiter and the decider every vote; others 404', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(420_000);
    const t = votes(world(), [...I1_VOTES, ...I2_VOTES]);
    // The Recruiter and the decider (the Standard pack lets the hiring manager decide MID) see every vote.
    for (const who of [C.recruiter, C.hm]) {
      const r = sheet(who, K.v, t);
      expect(statusOf(r), `${who.name} reads the sheet (${describe(r)})`).toBe(200);
      const v = ((ivOf(r, K.i1)?.votes ?? []) as any[]).filter((x) => !x?.legacy);
      expect.soft(v.map((x) => [x.voter_id, x.rating, x.scores, x.comment]).sort(), `${who.name}: every vote on I1 with scores, rating and comment`).toEqual(
        [[SUB.m1, 'YES', { sales: 4, comms: 5, product: 4 }, 'Knows the product range well.'], [SUB.m2, 'YES', { sales: 4, comms: 4, product: 5 }, 'Good on objections.'], [SUB.m3, 'STRONG_YES', { sales: 5, comms: 5, product: 4 }, 'Best of the week.']].sort(),
      );
    }

    // A hiring manager who is not the decider (the company says HR only for MID): the same scores given by other members with other
    // comments and the same ratings give the hiring manager the same answer, with the means in it.
    const hrOnly = (x: Tables) => withSetting(x, 'REJECTION_RULES', (d) => ({ ...d, decider: { ...d.decider, MID: 'HR_ONLY' } }));
    const swapped: [Caller, string, unknown][] = [
      [C.m2, K.i1, onI1([4, 5, 4], 'YES', 'A different note.')], [C.m3, K.i1, onI1([4, 4, 5], 'YES', 'Another note.')], [C.m1, K.i1, onI1([5, 5, 4], 'STRONG_YES', 'Third note.')],
      [C.m2, K.i2, onI2([3, 4], 'NO', 'Changed.')], [C.m1, K.i2, onI2([5, 5], 'YES', 'Also changed.')],
    ];
    const ta = hrOnly(t);
    const tb = hrOnly(votes(world(), swapped));
    const ha = sheet(C.hm, K.v, ta);
    const hb = sheet(C.hm, K.v, tb);
    expect(statusOf(ha), `the hiring manager who is not the decider reads the sheet (${describe(ha)})`).toBe(200);
    expect.soft(bodyOf(ha)?.final_score, 'with the means').toBe(r1(FINAL));
    expect.soft(JSON.stringify(bodyOf(hb)), 'and nothing that tells who gave which score or comment (the same answer when other members gave them)').toBe(JSON.stringify(bodyOf(ha)));
    const text = JSON.stringify(bodyOf(ha));
    for (const x of ['Knows the product', 'objections', 'Best of the week', 'Unsure about leading']) expect.soft(text, `the non-deciding hiring manager's answer does not hold "${x}"`).not.toContain(x);
    const ia = interviews(C.hm, K.v, ta);
    const ib = interviews(C.hm, K.v, tb);
    expect(statusOf(ia), `the non-deciding hiring manager reads the interviews (${describe(ia)})`).toBe(200);
    expect.soft(JSON.stringify(bodyOf(ib)), 'the interview list gives them no vote either').toBe(JSON.stringify(bodyOf(ia)));
    expect.soft(JSON.stringify(bodyOf(ia)), 'the interview list does not hold a member\'s comment').not.toContain('Knows the product');

    // A panel member: their own vote, and nothing that moves when another member's vote changes.
    const otherWay: [Caller, string, unknown][] = [
      [C.m1, K.i1, onI1([1, 2, 1], 'STRONG_NO', 'Changed my mind.')], [C.m2, K.i1, onI1([2, 1, 2], 'NO', 'Weak.')], [C.m3, K.i1, onI1([5, 5, 4], 'STRONG_YES', 'Best of the week.')],
      [C.m1, K.i2, onI2([1, 1], 'STRONG_NO', 'No.')], [C.m2, K.i2, onI2([2, 2], 'NO', 'No again.')],
    ];
    const tc = votes(world(), otherWay);
    for (const [label, read] of [['the sheet', sheet], ['the interview list', interviews]] as [string, typeof sheet][]) {
      const pa = read(C.m3, K.v, t);
      const pc = read(C.m3, K.v, tc);
      expect(statusOf(pa), `panel member 3 reads ${label} (${describe(pa)})`).toBe(200);
      expect.soft(JSON.stringify(bodyOf(pa)), `panel member 3 sees their own vote in ${label}`).toContain('Best of the week.');
      expect.soft(JSON.stringify(bodyOf(pc)), `${label}: panel member 3's answer does not change when the other members' votes change`).toBe(JSON.stringify(bodyOf(pa)));
      for (const x of ['Knows the product', 'objections', 'Unsure about leading']) expect.soft(JSON.stringify(bodyOf(pa)), `${label}: panel member 3 does not see "${x}"`).not.toContain(x);
    }

    // Everyone else: 404 as for a candidate that does not exist, and nothing read beyond the company check.
    const ghost = sheet(C.recruiter, 'CAND-REC07GHOSTGHOSTGHOSTGH1', t);
    expect.soft(answer(ghost), 'a candidate that does not exist: 404').toEqual([404, NOT_FOUND]);
    for (const who of [C.outsider, C.otherHm, C.recruiterB, C.mB]) {
      const r = sheet(who, K.v, t);
      expect.soft(answer(r), `${who.name}: 404 Not found`).toEqual([404, NOT_FOUND]);
      expect.soft(writesOf(r).length, `${who.name}: nothing is written`).toBe(0);
    }
    const own = sheet(C.recruiterB, K.vb, t);
    expect.soft(statusOf(own), `B's Recruiter reads B's own candidate (${describe(own)})`).toBe(200);
    expect.soft(JSON.stringify(bodyOf(own)), 'and sees nothing of A').not.toMatch(/Knows the product|iv-rec07-a/);
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 Guest link: stored hashed, never logged; the page reads exactly the listed fields; one vote; expired, used, unknown, malformed and another company\'s all give today\'s expired answer', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(420_000);
    const fromRun = seen.length;
    const t0 = world();
    const runs: Run[] = [];
    const keep = (r: Run) => { runs.push(r); return r; };
    const email = 'naledi.guest@example.test';

    // Only a Recruiter of the candidate's company makes a link, for an interview of that candidate.
    for (const who of [C.hm, C.m1, C.outsider]) expect.soft(answer(keep(makeLink(who, K.v, { interview_id: K.i2, guest_email: email }, t0))), `${who.name} makes a link: 403`).toEqual([403, FORBIDDEN]);
    expect.soft(answer(keep(makeLink(C.recruiterB, K.v, { interview_id: K.i2, guest_email: email }, t0))), 'B\'s Recruiter on A\'s candidate: 404').toEqual([404, NOT_FOUND]);
    expect.soft(answer(keep(makeLink(C.recruiter, K.x, { interview_id: K.i2, guest_email: email }, t0))), 'an interview of another candidate: 404').toEqual([404, NOT_FOUND]);
    expect.soft(answer(keep(makeLink(C.recruiter, K.v, { interview_id: K.ib, guest_email: email }, t0))), 'B\'s interview: 404').toEqual([404, NOT_FOUND]);
    expect.soft(answer(keep(makeLink(C.recruiter, K.v, { interview_id: K.i2 }, t0))), 'no guest email: 400 INVALID_FIELD guest_email').toEqual([400, invalid('guest_email')]);

    const made = keep(makeLink(C.recruiter, K.v, { interview_id: K.i2, guest_email: email, tenant_id: B, candidateId: K.vb }, t0));
    expect(statusOf(made), `the Recruiter makes a link for I2 (${describe(made)})`).toBe(201);
    const token = String(bodyOf(made)?.token ?? '');
    expect.soft(Date.parse(bodyOf(made)?.expires_at), 'it expires 7 days from now').toBe(Date.parse(NOW) + 7 * DAY);
    const bits = /^[0-9a-f]+$/i.test(token) ? token.length * 4 : /^[A-Za-z0-9_-]+$/.test(token) ? token.length * 6 : 0;
    expect.soft(bits, `the token is URL-safe text of at least 128 bits (got ${token.length} characters)`).toBeGreaterThanOrEqual(128);
    const second = keep(makeLink(C.recruiter, K.v, { interview_id: K.i2, guest_email: email }, made.tables));
    expect.soft(String(bodyOf(second)?.token ?? ''), 'a second link is a new token').not.toBe(token);

    // At rest: only the hash, in a row of company A with the fields of rule 4.
    expect.soft(allText(made.tables).includes(token), 'the raw token is in no stored row').toBe(false);
    const hashes = [sha256Hex(token), sha256B64u(token)];
    const linkRows = Object.values(made.tables).flat().map(plain).filter((x) => hashes.some((h) => JSON.stringify(x).includes(h)));
    expect.soft(linkRows.length, 'a stored row holds the token\'s SHA-256').toBeGreaterThanOrEqual(1);
    const lr = linkRows.find((x) => x['guest_email'] === email) ?? linkRows[0] ?? {};
    expect.soft([lr['tenant_id'], lr['interview_id'], lr['candidate_id'], lr['guest_email'], Date.parse(lr['expires_at']), lr['used_at'] ?? null], 'the link row: company A, I2, the candidate, the guest, the expiry, not used').toEqual([A, K.i2, K.v, email, Date.parse(NOW) + 7 * DAY, null]);

    // The page's read: exactly the listed fields.
    const read = keep(readLink(token, made.tables));
    expect(statusOf(read), `the guest page reads the link (${describe(read)})`).toBe(200);
    const g = bodyOf(read) ?? {};
    expect.soft(Object.keys(g).sort(), 'exactly the listed fields').toEqual(['candidate_first', 'candidate_last', 'criteria', 'expires_at', 'interview_at', 'interview_type', 'role_title']);
    expect.soft([g.candidate_first, g.candidate_last, g.role_title, g.interview_type, Date.parse(g.interview_at), g.criteria, Date.parse(g.expires_at)], 'the values').toEqual(['Thandi', 'Nkosi', 'Sales consultant', 'BEHAVIORAL', Date.parse(SCHEDULED_AT.i2), I2_CRITERIA, Date.parse(NOW) + 7 * DAY]);
    expect.soft(JSON.stringify(g), 'no email, company id or candidate id').not.toMatch(new RegExp(`@|ten_|${K.v}`));
    expect.soft(writesOf(read).length, 'reading writes nothing').toBe(0);
    fits('the guest page read', 'GET /v1/scoring-links/{token}', read);

    // Bad scores do not use the link up; a good vote is saved once under no body-named person.
    const badScores = keep(linkVote(token, { scores: { lead: 9, comms: 4 }, rating: 'YES' }, made.tables));
    expect.soft(answer(badScores), 'bad scores by link: 400 INVALID_SCORES').toEqual([400, BAD_SCORES]);
    const ok = keep(linkVote(token, { scores: { lead: 4, comms: 5 }, rating: 'YES', comment: 'Strong answers.', voterId: SUB.m1, voter_id: SUB.m1, tenant_id: B }, badScores.tables));
    expect(saved(ok), `the guest scores once (${describe(ok)})`).toBe(true);
    const gv = votesOf(ok.tables, K.v).filter((v) => v['interviewId'] === K.i2);
    expect.soft(gv.length, 'one vote on I2').toBe(1);
    expect.soft([gv[0]?.['voterId'] === SUB.m1, gv[0]?.['tenant_id'], gv[0]?.['scores']], 'not stored as a body-named member; company A; the scores').toEqual([false, A, { lead: 4, comms: 5 }]);
    const used = Object.values(ok.tables).flat().map(plain).find((x) => hashes.some((h) => JSON.stringify(x).includes(h)) && x['guest_email'] === email) ?? {};
    expect.soft(Date.parse(used['used_at']), 'used_at is set to now').toBe(Date.parse(NOW));
    const counted = sheet(C.recruiter, K.v, ok.tables);
    expect.soft([ivOf(counted, K.i2)?.vote_count, ivOf(counted, K.i2)?.pending_count], 'the guest\'s vote counts in I2, and the panel is still pending').toEqual([1, 3]);

    // One answer for every link that cannot be used, and nothing written.
    const wrong: [string, string, Tables][] = [
      ['the used link (read)', token, ok.tables], ['an unknown token', 'Zx8Kq2Wm5Rt9Yp3Lc7Vb1Nd6Fh4Gj0Ts2Ae8Ui5Oo1', t0], ['a link made before this card, expired', K.oldExpiredToken, t0],
      ['a row naming company A for B\'s interview', K.forgedToken, t0], ['malformed: one letter', 'x', t0], ['malformed: 300 letters', 'a'.repeat(300), t0],
      ['malformed: a path', '..%2F..%2Fetc', t0], ['malformed: a NUL', 'abc%00def', t0], ['the raw hash of a good token', sha256Hex(token), made.tables],
    ];
    for (const [what, tok, tables] of wrong) {
      const rr = keep(readLink(tok, tables));
      expect.soft(rr.response, `${what}: read gives today's expired answer`).toEqual(EXPIRED);
      const rv = keep(linkVote(tok, { scores: { lead: 4, comms: 4 }, rating: 'YES' }, tables));
      expect.soft(rv.response, `${what}: vote gives today's expired answer`).toEqual(EXPIRED);
      expect.soft(changed(tables, rv.tables), `${what}: nothing is written`).toEqual([]);
    }
    const again = keep(linkVote(token, { scores: { lead: 4, comms: 4 }, rating: 'YES' }, ok.tables));
    expect.soft(again.response, 'the used link (vote again): today\'s expired answer').toEqual(EXPIRED);
    expect.soft(votesOf(again.tables, K.v).length, 'and no second vote').toBe(votesOf(ok.tables, K.v).length);

    // A link made before this card (raw token in the key) keeps working until it expires, once.
    const oldRead = keep(readLink(K.oldToken, t0));
    expect.soft([statusOf(oldRead), bodyOf(oldRead)?.interview_type, bodyOf(oldRead)?.criteria], 'an unexpired link from before this card still reads I1').toEqual([200, 'TECHNICAL', R7_CRITERIA]);
    const oldVote = keep(linkVote(K.oldToken, onI1([4, 4, 4], 'YES'), t0));
    expect.soft(saved(oldVote), `and scores once (${describe(oldVote)})`).toBe(true);
    expect.soft(keep(linkVote(K.oldToken, onI1([4, 4, 4], 'YES'), oldVote.tables)).response, 'then gives the expired answer').toEqual(EXPIRED);

    // The raw token is in no log line of any run.
    for (const tok of [token, String(bodyOf(second)?.token ?? 'none'), K.oldToken, K.forgedToken]) {
      const lines = runs.flatMap(logsOf).filter((l) => l.includes(tok));
      expect.soft(lines.slice(0, 3), `no log line holds the token ${tok.slice(0, 6)}...`).toEqual([]);
    }

    // The company only from the sign-in or the link row: company B named in headers and the query string changes nothing.
    const forgedMake = withForgedCompany(() => makeLink(C.recruiter, K.v, { interview_id: K.i2, guest_email: email }, t0));
    const fToken = String(bodyOf(forgedMake)?.token ?? '');
    const fRow = Object.values(forgedMake.tables).flat().map(plain).find((x) => [sha256Hex(fToken), sha256B64u(fToken)].some((h) => JSON.stringify(x).includes(h))) ?? {};
    expect.soft([statusOf(forgedMake), fRow['tenant_id'], fRow['interview_id'], fRow['candidate_id']], 'the link maker with company B in headers and query: a link of company A for I2, as without').toEqual([201, A, K.i2, K.v]);
    sameWithForgedCompany('the guest page\'s read', made.tables, () => readLink(token, made.tables));
    sameWithForgedCompany('the guest\'s vote', made.tables, () => linkVote(token, { scores: { lead: 3, comms: 4 }, rating: 'YES', comment: 'Good examples from past work.' }, made.tables));
    sameWithForgedCompany('a row naming company A for B\'s interview', t0, () => readLink(K.forgedToken, t0));

    // Logs carry error names only: no guest email, comment, scores or candidate name in any log line of this test.
    expect.soft(personalLogLines(fromRun), 'no log line holds the guest email, a comment, scores or the candidate\'s name').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Legacy: old 0 to 10 votes are returned marked legacy with their own scale, unchanged, and are in no mean, count or final score', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    // An old vote on I1 itself, next to new ones, and the old vote on I0.
    const t0 = world();
    t0[TABLE.state] = [...t0[TABLE.state]!, oldVoteRow(K.v, K.i1, A, 'sub-rec07-oldvoter')];
    const plainWorld = votes(world(), [...I1_VOTES, ...I2_VOTES]);
    const t = votes(t0, [...I1_VOTES, ...I2_VOTES]);
    const r = sheet(C.recruiter, K.v, t);
    expect(statusOf(r), `the Recruiter reads the sheet (${describe(r)})`).toBe(200);
    const clean = sheet(C.recruiter, K.v, plainWorld);
    for (const iv of [K.i1, K.i2]) {
      const a = ivOf(r, iv);
      const b = ivOf(clean, iv);
      expect.soft([a?.criteria, a?.overall, a?.vote_count, a?.pending_count], `${iv}: the means and counts are those without the old vote`).toEqual([b?.criteria, b?.overall, b?.vote_count, b?.pending_count]);
    }
    expect.soft(bodyOf(r)?.final_score, 'the final score is the one without old votes').toBe(bodyOf(clean)?.final_score);
    const old1 = ((ivOf(r, K.i1)?.votes ?? []) as any[]).filter((x) => x?.legacy === true);
    const old0 = ((ivOf(r, K.i0)?.votes ?? []) as any[]).filter((x) => x?.legacy === true);
    expect.soft(old1.map((x) => [x.voter_id, x.scale, x.scores]), 'I1\'s old vote is returned, marked legacy, scale 0 to 10, scores as stored').toEqual([['sub-rec07-oldvoter', { min: 0, max: 10 }, { technical: 9, communication: 8, culturalFit: 7, problemSolving: 9 }]]);
    expect.soft(old0.map((x) => [x.voter_id, x.scale]), 'I0\'s old vote too').toEqual([[SUB.m1, { min: 0, max: 10 }]]);
    const newOnes = ((ivOf(r, K.i1)?.votes ?? []) as any[]).filter((x) => x?.legacy !== true);
    expect.soft(newOnes.length, 'the three new votes are not marked legacy').toBe(3);
    const ev = votesAndEvents(t0, [...I2_VOTES, ...I1_VOTES]);
    const avg = ev.events.filter((d) => d?.candidateId === K.v).pop()?.averageScore;
    expect.soft(close(avg, FINAL), `the VotingCompleted score leaves the old votes out (${FINAL}, got ${avg})`).toBe(true);
    const e = evaluate(K.v, ev.tables, typeof avg === 'number' ? avg : null);
    expect.soft(close(sagaOf(e.tables, K.v)['finalScore'], FINAL), 'and so does finalScore on the candidate').toBe(true);
    const oldRows = votesOf(e.tables, K.v).filter((v) => v['voterId'] === 'sub-rec07-oldvoter' || (v['voterId'] === SUB.m1 && v['interviewId'] === K.i0));
    expect.soft(oldRows.map((v) => [v['scores'], v['weightedScore']]), 'the old rows are not converted').toEqual([[{ technical: 9, communication: 8, culturalFit: 7, problemSolving: 9 }, 8.4], [{ technical: 9, communication: 8, culturalFit: 7, problemSolving: 9 }, 8.4]]);
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 Terraform: the four routes, the public two unauthenticated and throttled; no new role, no new wildcard, only reads added', async ({}, testInfo) => {
    once(testInfo.project.name);
    const routes = blocks(filesOf('talent-flow-infra'), 'resource').filter((b) => b.labels[0] === 'aws_apigatewayv2_route');
    const plainKey = (v: string | undefined) => (v ?? '').replace(/["\s]/g, '');
    const byKey = (key: string) => routes.filter((b) => plainKey(attributes(b.body).get('route_key')) === plainKey(key));
    const integrationOf = (b: any) => /integrations\/\$\{aws_apigatewayv2_integration\.([\w-]+)\.id\}/.exec(attributes(b.body).get('target') ?? '')?.[1];
    const fnOf = (integration: string | undefined) => {
      const i = blocks(filesOf('talent-flow-infra'), 'resource').find((b) => b.labels[0] === 'aws_apigatewayv2_integration' && b.labels[1] === integration);
      return /aws_lambda_function\.([\w-]+)\.invoke_arn/.exec(attributes(i?.body ?? '').get('integration_uri') ?? '')?.[1];
    };
    for (const [key, fn, auth] of [
      ['POST /v1/interviews/{id}/votes', 'submit_vote', 'JWT'], ['GET /v1/candidates/{id}/scores', 'submit_vote', 'JWT'],
      ['GET /v1/scoring-links/{token}', 'submit_vote_by_token', 'NONE'], ['POST /v1/scoring-links/{token}', 'submit_vote_by_token', 'NONE'],
    ] as const) {
      const found = byKey(key);
      expect.soft(found.length, `${key} is declared once`).toBe(1);
      const b = found[0];
      if (!b) continue;
      expect.soft(fnOf(integrationOf(b)), `${key} goes to ${fn}`).toBe(fn);
      expect.soft((attributes(b.body).get('authorization_type') ?? '').replace(/"/g, ''), `${key} is ${auth}`).toBe(auth);
    }
    // The throttle on the two public routes (D-REC-7.3), on the stage, per route.
    const stage = blocks(filesOf('talent-flow-infra'), 'resource').find((b) => b.labels[0] === 'aws_apigatewayv2_stage' && /talent_flow_api/.test(b.body));
    // Each route_settings block of the stage, read line by line (a route key holds braces).
    const settings = (stage?.body ?? '').split(/\broute_settings\s*\{/).slice(1).map((chunk) => {
      const get = (name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, 'm').exec(chunk.split(/\n\s*\}\s*\n/)[0] ?? '')?.[1];
      return { key: get('route_key'), rate: get('throttling_rate_limit'), burst: get('throttling_burst_limit') };
    });
    for (const key of ['GET /v1/scoring-links/{token}', 'POST /v1/scoring-links/{token}']) {
      const route = byKey(key)[0]?.labels[1] ?? '@@none';
      const s = settings.find((x) => plainKey(x.key) === plainKey(key) || (x.key ?? '').includes(`aws_apigatewayv2_route.${route}.route_key`));
      const rate = Number(s?.rate);
      const burst = Number(s?.burst);
      expect.soft(rate > 0 && rate <= 10, `${key}: a rate limit above 0 and at most 10 a second (got ${s?.rate})`).toBe(true);
      expect.soft(burst > 0 && burst <= 20, `${key}: a burst above 0 and at most 20 (got ${s?.burst})`).toBe(true);
    }
    // No new IAM role; the five handlers' policies only gain reads on the TalentFlow state or roles table; no new wildcard anywhere.
    const baseDir = join(__dirname, 'support', 'rec-07', 'iam-bc0fada');
    const oldRoles = JSON.parse(readFileSync(join(baseDir, 'roles.json'), 'utf8')) as string[];
    const nowRoles = STACKS.flatMap((s) => resourcesOf(s, 'aws_iam_role').map((b) => `${s}/${b.labels[1]}`)).sort();
    // Child lock rec-05.1: REC-05's manageOffers has its own role, judged in rec-05.spec.ts AC-10.
    expect.soft(nowRoles.filter((x) => !oldRoles.includes(x) && x !== REC05_ROLE_KEY), 'no new IAM role').toEqual([]);
    const oldPolicies = JSON.parse(readFileSync(join(baseDir, 'policies.json'), 'utf8')) as Record<string, { pairs?: string[]; squash?: string }>;
    const nowPolicies = policyLines() as Record<string, { pairs?: string[]; squash?: string }>;
    const FIVE = /(submit_vote|submit_vote_by_token|generate_scoring_link|schedule_interview|complete_evaluation)$/;
    const READ = /^Allow dynamodb:(GetItem|Query) (\S*(tf_table_state|tf_table_roles|talent_flow_state|talent_flow_roles|talent-flow-state|talent-flow-roles)\S*) /;
    const added: string[] = [];
    for (const [k, p] of Object.entries(nowPolicies)) {
      const was = new Set(oldPolicies[k]?.pairs ?? []);
      const lines = p.pairs ?? (p.squash && p.squash !== oldPolicies[k]?.squash ? [`(unreadable policy) ${p.squash.slice(0, 80)}`] : []);
      for (const l of lines) if (!was.has(l)) added.push(`${k}: ${l}`);
    }
    for (const a of added) {
      const [k, line] = [a.slice(0, a.indexOf(': ')), a.slice(a.indexOf(': ') + 2)];
      const ok = (FIVE.test(k) && READ.test(line) && !/\*/.test(line.replace(/\/index\/[\w-]+/, ''))) || isRec15bGrant(line, k) || isRec05Grant(line, k) || isRec15cGrant(line, k); // child locks rec-15b.1, rec-05.1 and rec-15c.1
      expect.soft(ok, `a new policy line is a read of the state or roles table by one of the five handlers, with no wildcard: ${a.slice(0, 200)}`).toBe(true);
    }
    expect.soft(Object.keys(nowPolicies).filter((k) => !(k in oldPolicies) && k !== REC05_ROLE_KEY), 'no new policy').toEqual([]); // && REC05_ROLE_KEY: child lock rec-05.1
    // Table rows are never written from Terraform (standing line 12).
    expect.soft(STACKS.flatMap((s) => resourcesOf(s, 'aws_dynamodb_table_item').map((b) => b.labels[1])), 'no table rows in Terraform').toEqual([]);
    // The API file describes the four routes and their refusals.
    for (const [route, statuses] of [
      ['POST /v1/interviews/{id}/votes', [400, 403, 404, 409]], ['GET /v1/candidates/{id}/scores', [200, 404]], ['GET /v1/scoring-links/{token}', [200, 410]], ['POST /v1/scoring-links/{token}', [400, 410]],
    ] as [string, number[]][]) {
      const op = operation(doc(), route);
      expect.soft(Boolean(op), `api/openapi.yaml describes ${route}`).toBe(true);
      for (const s of statuses) expect.soft(Boolean(op?.responses?.[String(s)]), `${route} names its ${s} answer`).toBe(true);
    }
  });

  // ---------------------------------------------------------------- AC-10 (pepla-dev)

  test('AC-10 pepla-dev: the seed is put back each run (text check)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const src = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    expect.soft(src, 'seed-dev.py has seed_rec07').toMatch(/def seed_rec07\(/);
    const main = src.slice(src.indexOf('def main('));
    expect.soft(main, 'main() calls seed_rec07').toMatch(/seed_rec07\(\s*ddb\s*,/);
    const card = readFileSync(join(__dirname, 'cards', 'rec-07.md'), 'utf8');
    expect.soft(card, 'the card notes name the dev seed contract').toContain('REC-07 dev seed');
  });

  test('AC-10 The test logins on pepla-dev: two panel logins score the seeded interview, the sheet shows the means, a third login is refused, a seeded guest link scores once, a link for B\'s interview gives the same expired answer @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1 to AC-9.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(6 * 60_000);
    const env = (k: string) => process.env[k] ?? '';
    const login = (p: string) => ({ email: env(`${p}_EMAIL`), password: env(`${p}_PASSWORD`) });
    const logins = { hr: login('E2E_HR'), manager: login('E2E_MANAGER'), panel1: login('E2E_EMP'), panel2: login('E2E_IT'), outsider: login('E2E_GUEST') };
    for (const [who, l] of Object.entries(logins)) expect(l.email && l.password, `the ${who} test login is set`).toBeTruthy();
    const { devEnv } = await import('./support/ten-02/dev');
    const { region, clientId } = devEnv();
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
    const api = async (token: string | undefined, method: string, path: string, body?: unknown) =>
      page.request.fetch(`${tfApi}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { data: JSON.stringify(body) }) });
    const [hr, manager, panel1, panel2, outsider] = await Promise.all([signIn(logins.hr), signIn(logins.manager), signIn(logins.panel1), signIn(logins.panel2), signIn(logins.outsider)]);
    // The seed's ids (cards/rec-07.md, "REC-07 dev seed"): put back by seed-dev.py on every run.
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-07', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const iv = await api(panel1, 'GET', `/v1/candidates/${encodeURIComponent(ids['candidate']!)}/interviews`);
    expect(iv.status(), 'panel login 1 reads the seeded interview').toBe(200);
    const row = ((((await iv.json()) as any).interviews ?? []) as any[]).find((x) => x.interviewId === ids['interview'] || x.interview_id === ids['interview']);
    const keys = ((row?.criteria_snapshot ?? []) as any[]).map((c) => c.key) as string[];
    expect(keys.length, 'it carries its criteria').toBeGreaterThan(0);
    const scores = (v: number) => Object.fromEntries(keys.map((k) => [k, v]));
    const v1 = await api(panel1, 'POST', `/v1/interviews/${encodeURIComponent(ids['interview']!)}/votes`, { scores: scores(4), rating: 'YES', comment: 'REC-07 dev check' });
    expect([200, 201], `panel login 1 scores (${v1.status()} ${await v1.text()})`).toContain(v1.status());
    const v2 = await api(panel2, 'POST', `/v1/interviews/${encodeURIComponent(ids['interview']!)}/votes`, { scores: scores(5), rating: 'YES' });
    expect([200, 201], `panel login 2 scores (${v2.status()} ${await v2.text()})`).toContain(v2.status());
    const v3 = await api(outsider, 'POST', `/v1/interviews/${encodeURIComponent(ids['interview']!)}/votes`, { scores: scores(3), rating: 'NO' });
    expect([403, 404], 'a login not on the panel is refused').toContain(v3.status());
    const s = await api(hr, 'GET', `/v1/candidates/${encodeURIComponent(ids['candidate']!)}/scores`);
    expect(s.status(), 'HR reads the sheet').toBe(200);
    const sheetIv = ((((await s.json()) as any).interviews ?? []) as any[]).find((x) => x.interview_id === ids['interview']);
    expect([sheetIv?.overall, sheetIv?.vote_count], 'the sheet shows the means of the two votes').toEqual([4.5, 2]);
    // The hiring manager (the decider for this level in the Standard pack) reads the sheet; the means-only case is the no-backend AC-6.
    expect((await api(manager, 'GET', `/v1/candidates/${encodeURIComponent(ids['candidate']!)}/scores`)).status(), 'the hiring manager reads the sheet').toBe(200);
    // The guest link seeded for the interview: scores once, then the expired answer; B's link gives the same answer.
    const g1 = await api(undefined, 'POST', `/v1/scoring-links/${encodeURIComponent(ids['guestToken']!)}`, { scores: scores(3), rating: 'NO' });
    expect([200, 201], `the seeded guest link scores (${g1.status()})`).toContain(g1.status());
    const g2 = await api(undefined, 'POST', `/v1/scoring-links/${encodeURIComponent(ids['guestToken']!)}`, { scores: scores(3), rating: 'NO' });
    const gb = await api(undefined, 'GET', `/v1/scoring-links/${encodeURIComponent(ids['crossCompanyToken']!)}`);
    expect([g2.status(), await g2.text()], 'the second attempt is the expired answer').toEqual([410, JSON.stringify({ error: 'Scoring link has expired' })]);
    expect([gb.status(), await gb.text()], 'a link row naming company A for B\'s interview gives the same expired answer').toEqual([410, JSON.stringify({ error: 'Scoring link has expired' })]);
    void [B, ROLES_TABLE, rowsOf, interviewRow];
  });
});
