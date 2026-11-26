import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isRec062Grant } from './support/rec-06.2.1/grants'; // child lock rec-06.2.1
import { isRec16Role } from './support/rec-16.1/grants'; // child lock rec-16.1
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { attributes, blocks } from './support/infra-harness';
import { LAMBDA, REPO, httpEvent, type Tables } from './support/rec-02/lambda-harness';
import { STACKS, filesOf, lambdaNamed, policyLines, resourcesOf, roleResourceOf, valueOf, type Stack } from './support/rec-02/iam';
import { A, B, ID, SUB, TABLE, ask, bodyOf, describe, isModulesRead, runEvent, statusOf } from './support/rec-02/world';
import { C } from './support/rec-02/callers';
import { isRec05Role } from './support/rec-05.1/grants'; // child lock rec-05.1
import { isRec15dGrant } from './support/rec-15d.1/grants'; // child lock rec-15d.1
import { isInt01Grant } from './support/int-01.1/grants'; // child lock int-01.1
import {
  CANDIDATE_ROUTES, CLOSED, HANDLER, LIVE_OFFER, OLD_OPEN, OLD_ROWS, OPEN, OTHER_VOTERS, PANEL5, R, REASONS, ROLE_ID, ROUTE, TOKENS,
  anyWrite, awsOf, byLevel, call, candidate, changedRows, eventsOf, historyOf, logsOf, notHired, offerRow, sagaOf, stateWrites, votesOf, withRules, world,
  type RouteKey,
} from './support/rec-02/decide';

/**
 * REC-02 · A person decides: no automatic Not hired, and a Not hired action with a reason (Jira NH-236, epic NH-234). Red.
 * One test per acceptance criterion, written from the card before any code. Spec: /mnt/project-files/onboarding-cards/specs/REC-02.md,
 * read with REC-00.md. Notes: cards/rec-02.md and onboarding-cards/specs/REC-02-tests-for-review.md (the bar: "What these tests must catch").
 *
 * The Lambda tests run the real handlers and the real shared files, each call in a fresh Node process, against a fake AWS
 * (support/rec-02/fake-aws, REC-12's copy with code added only: a NaN or Infinity number is refused, as the real SDK refuses it).
 * Companies A and B both hold the Standard pack (written by the real pack script); the card's rows are in support/rec-02/decide.ts.
 * AC-10 and AC-11 also read code and Terraform as text. AC-12 runs on pepla-dev only (@pepla-dev). Nothing calls AWS or any AI.
 *
 * Pinned by the verifier where the card is silent (each is in cards/rec-02.md for the BA to confirm, D-T-1 to D-T-12):
 *  - D-T-1 The five routes are served by one Lambda, lambda/recordNotHired, routed by the route key; its core is recordNotHired in
 *    lambda/shared/recruitment-actions/record-not-hired.mjs.
 *  - D-T-2 The stage lives where it lives today, `currentStage` on the candidate's row; Not hired writes 'NOT_HIRED' there ("stage" in rule 3).
 *  - D-T-3 Until REC-03 moves the rows, a stored old stage name counts as the open stage REC-03's table maps it to; `stage_before_not_hired`
 *    holds the new code, and reopen writes the new code back.
 *  - D-T-4 `strong_no_count` is a number: how many Strong No votes the candidate has (one more per Strong No). `score_under_review_level` is true.
 *  - D-T-5 The history row is today's shape (SK STAGE#<time>, fromStage, toStage, actor = the person id, tenant_id).
 *  - D-T-6 On a confirmed second decision both people are on the row: the one who recorded it and the one who confirmed it.
 *  - D-T-7 The old-system list answers its rows as `candidates` (or a bare list), following `nextToken` until it is absent.
 *  - D-T-8 A vote's stored weightedScore is a finite number or empty. Today the pack's SCORING_WEIGHTS (weights null) makes it NaN, which
 *    DynamoDB refuses: REC-07 rebuilds the maths; this card only needs votes to be recorded.
 *  - D-T-9 The Idempotency-Key replays only to the person who sent it.
 *  - D-T-10 A note over 1000 characters and a reopen reason over 1000 characters are 400 (code not pinned); a missing reopen reason is 400
 *    REASON_REQUIRED.
 *  - D-T-11 On pepla-dev the decision is read back through GET /v1/candidates/{id} (no route reads stage history until REC-03).
 *  - D-T-12 The vote candidate seeded on pepla-dev takes a new vote on every run (the seed resets it).
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const FORBIDDEN = { error: 'Forbidden' };
const NOT_FOUND = { error: 'Not found' };
const conflict = (code: string) => ({ error: 'Conflict', code });
const bad = (code: string) => ({ error: 'Bad request', code });
const LOW = { technical: 1, communication: 1, culturalFit: 1, problemSolving: 1 };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const gone = (v: unknown) => v === undefined || v === null;
const answer = (r: any) => [statusOf(r), bodyOf(r)];

// ---------------------------------------------------------------- small helpers

/** JavaScript with comments blanked out; strings kept. */
function stripJs(src: string): string {
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
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else { out += c; i++; }
  }
  return out;
}
const code = (path: string) => (existsSync(path) ? stripJs(readFileSync(path, 'utf8')) : '');
const VOTE_HANDLERS = ['submitVote', 'submitVoteByToken', 'completeEvaluation'];
const handlerFile = (name: string) => ['index.js', 'index.mjs'].map((f) => join(LAMBDA, name, f)).find(existsSync) ?? join(LAMBDA, name, 'index.js');
const CORE = join(LAMBDA, 'shared', 'recruitment-actions', 'record-not-hired.mjs');
/** The code files of the card's Lambda folder (tests and packages left out). */
const handlerFolderFiles = () => (existsSync(join(LAMBDA, HANDLER)) ? readdirSync(join(LAMBDA, HANDLER)).filter((f) => /\.(m?js|cjs)$/.test(f) && !/\.test\./.test(f)).map((f) => join(LAMBDA, HANDLER, f)) : []);

/** A panel member's vote on the vote candidate, through the person route. */
const vote = (who: any, rating: string, t: Tables, scores = LOW) => ask('submitVote', who, { method: 'POST', path: { id: R.v }, body: { candidateId: R.v, interviewId: R.iv, rating, scores } }, { tables: t });
/** A vote through a scoring link (the public route: the link is the credential). */
function voteByToken(token: string, rating: string, t: Tables, scores = LOW) {
  const event = httpEvent({ path: { token }, body: { rating, scores } });
  event.routeKey = 'POST /v1/scoring/{token}/votes';
  event.requestContext.routeKey = event.routeKey;
  event.requestContext.http.method = 'POST';
  event.rawPath = `/v1/scoring/${token}/votes`;
  delete event.requestContext.authorizer;
  return runEvent('submitVoteByToken', event, { tables: t });
}
const voting = (detail: Record<string, unknown>) => ({ version: '0', source: 'talent-flow.workflow', 'detail-type': 'VotingCompleted', detail });
const evaluate = (detail: Record<string, unknown>, t: Tables) => runEvent('completeEvaluation', voting({ tenant_id: A, ...detail }), { tables: t });

/** The saga writes that set a status, a stage or the old veto result (none of the three handlers may make one). */
const outcomeWrites = (r: { calls: any[] }) => stateWrites(r).filter((c) => JSON.stringify(c.input ?? {}).includes('"SAGA"')).filter((c) => {
  const i = c.input ?? {};
  const names = Object.values(i.ExpressionAttributeNames ?? {}) as string[];
  const expr = String(i.UpdateExpression ?? '');
  return /\b(status|currentStage|votingResult)\s*=/.test(expr) || names.some((n) => ['status', 'currentStage', 'votingResult'].includes(n));
});
/** Events that carry an automatic outcome. */
const outcomeEvents = (r: { calls: any[] }) => eventsOf(r).filter((e) => (e.detailType === 'EvaluationCompleted' && /FAIL/i.test(String(e.detail?.['outcome'] ?? e.detail?.['result'])))
  || (e.detailType === 'VotingCompleted' && /VETO/.test(String(e.detail?.['result']))) || /NotHired|Rejected/i.test(e.detailType));

/** Checks one candidate is still where it was: open, same stage, no Not hired fields. */
function stillOpen(label: string, t: Tables, id: string, stage: string) {
  const s = sagaOf(t, id);
  expect.soft(s?.['status'], `${label}: the candidate is still ACTIVE`).toBe('ACTIVE');
  expect.soft(s?.['currentStage'], `${label}: in the same stage`).toBe(stage);
  expect.soft(s?.['votingResult'], `${label}: no veto result is stored`).not.toBe('STRONG_NO_VETO');
  expect.soft(gone(s?.['decided_by']) && gone(s?.['not_hired_at']), `${label}: nobody is recorded as having decided`).toBe(true);
}

/** The full Not hired check of rule 3 on one successful run. */
function judgeNotHired(label: string, before: Tables, r: any, o: { id: string; caller: string; reason: string; note?: string; from: string; first?: string; last?: string; company?: string }) {
  const company = o.company ?? A;
  expect.soft(statusOf(r), `${label}: 200 (${describe(r)})`).toBe(200);
  const s = sagaOf(r.tables, o.id) ?? {};
  expect.soft(s['currentStage'], `${label}: the stage is NOT_HIRED`).toBe('NOT_HIRED');
  expect.soft(s['stage_before_not_hired'], `${label}: stage_before_not_hired is the open stage it left`).toBe(o.from);
  expect.soft(String(s['not_hired_at'] ?? ''), `${label}: not_hired_at is a time`).toMatch(ISO);
  expect.soft(s['reason_code'], `${label}: reason_code`).toBe(o.reason);
  if (o.note !== undefined) expect.soft(s['reason_note'], `${label}: reason_note`).toBe(o.note);
  expect.soft(s['decided_by'], `${label}: decided_by is the caller's person id`).toBe(o.caller);
  expect.soft(s['decided_by_kind'], `${label}: decided_by_kind PERSON`).toBe('PERSON');
  expect.soft(['REJECTED', 'EVALUATION_FAILED'], `${label}: no old outcome status is written`).not.toContain(s['status']);
  const hist = historyOf(r.tables, o.id).filter((h) => !historyOf(before, o.id).some((x) => x['SK'] === h['SK']));
  expect.soft(hist.length, `${label}: one new stage history row`).toBe(1);
  const h = hist[0] ?? {};
  expect.soft([h['fromStage'], h['toStage'], h['actor'], h['tenant_id']], `${label}: the history row says from, to, who and the company`).toEqual([o.from, 'NOT_HIRED', o.caller, company]);
  const ev = eventsOf(r).filter((e) => e.detailType === 'CandidateNotHired');
  expect.soft(ev.length, `${label}: one CandidateNotHired event`).toBe(1);
  expect.soft(eventsOf(r).length, `${label}: and no other event`).toBe(1);
  const d = ev[0]?.detail ?? {};
  expect.soft(Object.keys(d).sort(), `${label}: the event holds tenant_id, candidate_id, role_id, by and at only`).toEqual(['at', 'by', 'candidate_id', 'role_id', 'tenant_id']);
  expect.soft([d['tenant_id'], d['candidate_id'], d['role_id'], d['by']], `${label}: with this company, candidate, role and person`).toEqual([company, o.id, s['role_id'] ?? null, o.caller]);
  expect.soft(String(d['at'] ?? ''), `${label}: at is a time`).toMatch(ISO);
  const text = JSON.stringify(eventsOf(r));
  for (const secret of [o.reason, o.note, o.first ?? 'Thandi', o.last ?? 'Nkosi', s['email']].filter((x): x is string => !!x)) {
    expect.soft(text, `${label}: the event does not hold "${secret.slice(0, 30)}"`).not.toContain(secret);
  }
  if (o.note) expect.soft(logsOf(r).join('\n'), `${label}: the note is not written to the log`).not.toContain(o.note);
}
/**
 * REC-12's one-time lock of an older candidate to the settings versions active now (getRecruitmentSettings writes `settingVersions` on the
 * first read). It is not a decision, so a refusal may make it; nothing else.
 */
const isLockWrite = (c: any) => c.service === 'dynamodb' && c.op === 'UpdateItem' && /^SET settingVersions(\.#\w+)? = :\w+$/.test(String(c.input?.UpdateExpression ?? '').trim());
/** A refusal with no change at all. */
/** The Not hired fields of rule 3 and rule 4: no vote or evaluation may write any of them (lock check round 1, line 2). */
const DECISION_FIELDS = ['not_hired_pending', 'reason_code', 'reason_note', 'stage_before_not_hired', 'decided_by', 'decided_by_kind', 'not_hired_at', 'confirmed_by', 'status', 'currentStage', 'votingResult'];
/** The candidate's row after a vote or an evaluation: only the fields named may change (REC-12's one-time settingVersions lock is always allowed). */
const VOTE_MAY_CHANGE = ['strong_no_count', 'settingVersions', 'votesSubmitted', 'updatedAt'];
const EVALUATION_MAY_CHANGE = ['finalScore', 'evaluationCompletedAt', 'configVersionUsedForEval', 'score_under_review_level', 'settingVersions', 'evaluation_result', 'evaluationResult', 'updatedAt'];
function onlyFields(label: string, before: Tables, after: Tables, id: string, allowed: string[]) {
  const a = sagaOf(before, id) ?? {};
  const b = sagaOf(after, id) ?? {};
  const changed = Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
  expect.soft(changed.filter((k) => DECISION_FIELDS.includes(k)), `${label}: no Not hired field changes on the candidate`).toEqual([]);
  expect.soft(changed.filter((k) => !allowed.includes(k)), `${label}: only ${allowed.join(', ')} may change on the candidate`).toEqual([]);
}

function refused(label: string, r: any, want: [number, unknown] | number[]) {
  if (typeof want[0] === 'number' && want.length === 2 && typeof want[1] !== 'number') expect.soft(answer(r), `${label} (${describe(r)})`).toEqual(want);
  else expect.soft(want as number[], `${label} (${describe(r)})`).toContain(statusOf(r));
  expect.soft(anyWrite(r).filter((c: any) => !isLockWrite(c)).map((c: any) => `${c.service} ${c.op} ${c.table ?? ''}`), `${label}: nothing is written or sent`).toEqual([]);
}

test.describe('REC-02 · A person decides: no automatic Not hired, and a Not hired action with a reason', () => {
  // ---------------------------------------------------------------- control

  test('Control: the world is good: the candidates read, a passing evaluation is recorded, and B cannot read A', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const own = ask('getCandidate', C.recruiter, { path: { id: R.n1 } }, { tables: t });
    expect.soft(statusOf(own), `a Recruiter reads A's candidate (${describe(own)})`).toBe(200);
    const b = ask('getCandidate', C.recruiterB, { path: { id: R.n1 } }, { tables: t });
    expect.soft(answer(b), 'B\'s Recruiter gets 404 for it').toEqual([404, NOT_FOUND]);
    const bOwn = ask('getCandidate', C.recruiterB, { path: { id: R.b1 } }, { tables: t });
    expect.soft(statusOf(bOwn), `B's Recruiter reads B's own candidate (${describe(bOwn)})`).toBe(200);
    const pass = evaluate({ candidateId: R.v, result: 'COMPLETED', averageScore: 7.5 }, t);
    expect.soft(pass.error, `completeEvaluation runs (${pass.error?.message})`).toBeUndefined();
    expect.soft(stateWrites(pass).length, 'and records the evaluation').toBeGreaterThan(0);
    stillOpen('a passing evaluation', pass.tables, R.v, 'INTERVIEWING');
  });

  // ---------------------------------------------------------------- AC-1

  test('AC-1 No automatic outcome: five Strong No votes, scores of 1, quorum and a completed evaluation leave the candidate open', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    // A company whose stored PANEL_CONFIG still carries today's veto switch (the old code reads it; the new code must not act on it).
    const start = world({ oldVeto: true });
    const voters = [C.v1, C.v2, C.v3, C.v4, C.v5];
    const results: { label: string; t: Tables; detail?: Record<string, unknown> }[] = [];

    // submitVote: five Strong No votes with every score 1, one per panel member.
    let t = start;
    let quorum: Record<string, unknown> | undefined;
    for (const [i, who] of voters.entries()) {
      const r = vote(who, 'STRONG_NO', t);
      expect.soft(statusOf(r), `submitVote: Strong No ${i + 1} of 5 is recorded (${describe(r)})`).toBe(200);
      expect.soft(outcomeWrites(r).map((c) => c.input?.UpdateExpression), `submitVote: Strong No ${i + 1} writes no status, stage or veto result`).toEqual([]);
      expect.soft(outcomeEvents(r).map((e) => `${e.detailType} ${JSON.stringify(e.detail)}`), `submitVote: Strong No ${i + 1} publishes no outcome`).toEqual([]);
      onlyFields(`submitVote: Strong No ${i + 1}`, t, r.tables, R.v, VOTE_MAY_CHANGE);
      quorum ??= eventsOf(r).find((e) => e.detailType === 'VotingCompleted')?.detail;
      t = r.tables;
    }
    const votes = votesOf(t, R.v);
    expect.soft(votes.length, 'submitVote: all five votes are stored').toBe(5);
    for (const v of votes) expect.soft(v['weightedScore'] === null || v['weightedScore'] === undefined || Number.isFinite(v['weightedScore']), `submitVote: ${v['voterId']}'s stored score is a number or empty (D-T-8)`).toBe(true);
    stillOpen('submitVote after five Strong No votes', t, R.v, 'INTERVIEWING');
    expect.soft(quorum, 'submitVote: reaching three votes publishes VotingCompleted (the event completeEvaluation reads)').toBeTruthy();
    results.push({ label: 'the votes reaching quorum', t, detail: quorum });

    // submitVoteByToken: the same through five scoring links.
    let u = start;
    let quorumByToken: Record<string, unknown> | undefined;
    for (const [i, token] of TOKENS.entries()) {
      const r = voteByToken(token, 'STRONG_NO', u);
      expect.soft(statusOf(r), `submitVoteByToken: Strong No ${i + 1} of 5 is recorded (${describe(r)})`).toBe(200);
      expect.soft(outcomeWrites(r).map((c) => c.input?.UpdateExpression), `submitVoteByToken: Strong No ${i + 1} writes no status, stage or veto result`).toEqual([]);
      expect.soft(outcomeEvents(r).map((e) => `${e.detailType} ${JSON.stringify(e.detail)}`), `submitVoteByToken: Strong No ${i + 1} publishes no outcome`).toEqual([]);
      onlyFields(`submitVoteByToken: Strong No ${i + 1}`, u, r.tables, R.v, VOTE_MAY_CHANGE);
      quorumByToken ??= eventsOf(r).find((e) => e.detailType === 'VotingCompleted')?.detail;
      u = r.tables;
    }
    expect.soft(votesOf(u, R.v).length, 'submitVoteByToken: all five votes are stored').toBe(5);
    stillOpen('submitVoteByToken after five Strong No votes', u, R.v, 'INTERVIEWING');
    results.push({ label: 'the link votes reaching quorum', t: u, detail: quorumByToken });

    // completeEvaluation: the quorum events above, a score of 1, a score just under the old 6.0, and an old veto event still in flight.
    const cases: [string, Tables, Record<string, unknown>][] = [
      ...results.filter((x) => x.detail).map((x) => [x.label, x.t, x.detail!] as [string, Tables, Record<string, unknown>]),
      ['an average of 1', start, { candidateId: R.v, result: 'COMPLETED', averageScore: 1 }],
      ['an average of 5.9 (under the old 6.0)', start, { candidateId: R.v, result: 'COMPLETED', averageScore: 5.9 }],
      ['an old STRONG_NO_VETO event', start, { candidateId: R.v, result: 'STRONG_NO_VETO' }],
    ];
    for (const [label, tables, detail] of cases) {
      const r = evaluate(detail, tables);
      expect.soft(r.error, `completeEvaluation, ${label}: runs (${r.error?.message})`).toBeUndefined();
      expect.soft(outcomeWrites(r).map((c) => c.input?.UpdateExpression), `completeEvaluation, ${label}: writes no status, stage or veto result`).toEqual([]);
      expect.soft(outcomeEvents(r).map((e) => e.detailType), `completeEvaluation, ${label}: publishes no outcome`).toEqual([]);
      stillOpen(`completeEvaluation, ${label}`, r.tables, R.v, 'INTERVIEWING');
      onlyFields(`completeEvaluation, ${label}`, tables, r.tables, R.v, EVALUATION_MAY_CHANGE);
    }

    // Text check: none of the three handlers names the old outcomes.
    for (const name of VOTE_HANDLERS) {
      const src = code(handlerFile(name));
      expect.soft(src.length, `${name}: the handler file is read`).toBeGreaterThan(500);
      expect.soft(src.match(/\b(REJECTED|EVALUATION_FAILED)\b/g) ?? [], `${name}: no REJECTED or EVALUATION_FAILED in the code`).toEqual([]);
    }
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 Flags are data only: a Strong No sets strong_no_count, a final score under reviewBelowScore sets score_under_review_level, null settings write neither', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const keep = (label: string, t: Tables) => {
      stillOpen(label, t, R.v, 'INTERVIEWING');
      expect.soft(sagaOf(t, R.v)?.['score_under_review_level'], `${label}: no score flag`).not.toBe(true);
    };
    // Default REJECTION_RULES (the pack: reviewVoteLevel STRONG_NO, reviewBelowScore null).
    const t0 = world();
    const one = vote(C.v1, 'STRONG_NO', t0);
    expect.soft(statusOf(one), `a Strong No is recorded (${describe(one)})`).toBe(200);
    expect.soft(sagaOf(one.tables, R.v)?.['strong_no_count'], 'one Strong No: strong_no_count 1 (D-T-4)').toBe(1);
    keep('one Strong No', one.tables);
    onlyFields('one Strong No', t0, one.tables, R.v, VOTE_MAY_CHANGE);
    expect.soft(outcomeEvents(one).map((e) => e.detailType), 'one Strong No: no outcome event').toEqual([]);
    const two = vote(C.v2, 'STRONG_NO', one.tables);
    expect.soft(sagaOf(two.tables, R.v)?.['strong_no_count'], 'a second Strong No: 2').toBe(2);
    const yes = vote(C.v3, 'YES', two.tables, { technical: 4, communication: 4, culturalFit: 4, problemSolving: 4 });
    expect.soft(statusOf(yes), `a Yes vote is recorded (${describe(yes)})`).toBe(200);
    expect.soft(sagaOf(yes.tables, R.v)?.['strong_no_count'], 'a Yes vote does not count').toBe(2);
    keep('after a Yes', yes.tables);
    const yesFirst = vote(C.v3, 'NO', t0);
    expect.soft(gone(sagaOf(yesFirst.tables, R.v)?.['strong_no_count']), 'a No vote on its own writes no strong_no_count').toBe(true);
    const link = voteByToken(TOKENS[0]!, 'STRONG_NO', t0);
    expect.soft(statusOf(link), `a Strong No through a scoring link is recorded (${describe(link)})`).toBe(200);
    expect.soft(sagaOf(link.tables, R.v)?.['strong_no_count'], 'a Strong No through a scoring link: strong_no_count 1').toBe(1);
    keep('a link Strong No', link.tables);
    onlyFields('a link Strong No', t0, link.tables, R.v, VOTE_MAY_CHANGE);

    // reviewBelowScore 3: a final score of 2.5 raises the score flag; 3 and 3.5 do not.
    const t3 = withRules(world(), { reviewBelowScore: 3 });
    const under = evaluate({ candidateId: R.v, result: 'COMPLETED', averageScore: 2.5 }, t3);
    expect.soft(under.error, `completeEvaluation runs (${under.error?.message})`).toBeUndefined();
    expect.soft(sagaOf(under.tables, R.v)?.['score_under_review_level'], 'a final score of 2.5 under 3: score_under_review_level true').toBe(true);
    stillOpen('a score under the review level', under.tables, R.v, 'INTERVIEWING');
    onlyFields('a score under the review level', t3, under.tables, R.v, EVALUATION_MAY_CHANGE);
    expect.soft(gone(sagaOf(under.tables, R.v)?.['strong_no_count']), 'and no strong_no_count').toBe(true);
    for (const score of [3, 3.5]) {
      const r = evaluate({ candidateId: R.v, result: 'COMPLETED', averageScore: score }, t3);
      expect.soft(sagaOf(r.tables, R.v)?.['score_under_review_level'], `a final score of ${score}: no score flag`).not.toBe(true);
    }
    const defaults = evaluate({ candidateId: R.v, result: 'COMPLETED', averageScore: 1 }, world());
    expect.soft(gone(sagaOf(defaults.tables, R.v)?.['score_under_review_level']), 'the default reviewBelowScore null: a final score of 1 writes no score flag').toBe(true);

    // Null settings: neither flag is written.
    const tn = withRules(world(), { reviewVoteLevel: null, reviewBelowScore: null });
    const sn = vote(C.v1, 'STRONG_NO', tn);
    expect.soft(statusOf(sn), `with null settings a Strong No is still recorded (${describe(sn)})`).toBe(200);
    expect.soft(gone(sagaOf(sn.tables, R.v)?.['strong_no_count']), 'reviewVoteLevel null: no strong_no_count').toBe(true);
    const ln = voteByToken(TOKENS[1]!, 'STRONG_NO', tn);
    expect.soft(gone(sagaOf(ln.tables, R.v)?.['strong_no_count']), 'reviewVoteLevel null, through a link: no strong_no_count').toBe(true);
    const en = evaluate({ candidateId: R.v, result: 'COMPLETED', averageScore: 1 }, tn);
    expect.soft(gone(sagaOf(en.tables, R.v)?.['score_under_review_level']), 'reviewBelowScore null: no score flag').toBe(true);

    // The candidate's own locked version is read, not the company's active one (REC-12: settings never change a candidate afterwards).
    const locked = world();
    withRules(locked, { reviewVoteLevel: null });
    const cfg = locked[TABLE.config]!;
    const v1 = cfg.find((r) => (r as any).SK?.S === 'CONFIG#REJECTION_RULES#v1')!;
    const v2 = structuredClone(v1) as any;
    v2.SK = { S: 'CONFIG#REJECTION_RULES#v2' };
    v2.version = { N: '2' };
    v2.data.M.reviewVoteLevel = { S: 'STRONG_NO' };
    (v1 as any).isActive = { BOOL: false };
    delete (v1 as any).GSI1PK;
    delete (v1 as any).GSI1SK;
    cfg.push(v2);
    const st = locked[TABLE.state]!;
    const i = st.findIndex((r) => (r as any).PK?.S === `CANDIDATE#${R.v}` && (r as any).SK?.S === 'SAGA');
    (st[i] as any).settingVersions = { M: { REJECTION_RULES: { N: '1' } } };
    const lv = vote(C.v1, 'STRONG_NO', locked);
    expect.soft(statusOf(lv), `a vote on a candidate locked to version 1 (${describe(lv)})`).toBe(200);
    expect.soft(gone(sagaOf(lv.tables, R.v)?.['strong_no_count']), 'it reads the candidate\'s version 1 (reviewVoteLevel null), not the active version 2').toBe(true);
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 Not hired: each reason from each open stage, the reason checks, the row, history and event exactly as rule 3, decided_by from the sign-in', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    // Each of the eight reasons, each from a different open stage: the four codes and four of today's old names (D-T-3).
    const stages = [...OPEN, 'APPLICATION_REVIEW', 'INTERVIEWING', 'EVALUATION', 'OFFER_APPROVAL'];
    for (const [i, reason] of REASONS.entries()) {
      const stage = stages[i]!;
      const id = `CAND-02REC02STAGEAAAAAAAAA${i + 1}`;
      const t = world();
      t[TABLE.state]!.push(candidate(id, { stage, first: 'Thandi', last: 'Nkosi' }));
      const note = i === 0 ? 'Spoke to Thandi on the phone; she chose another bakery.' : undefined;
      const r = notHired(C.recruiter, id, { reason, ...(note ? { note } : {}) }, t);
      judgeNotHired(`${reason} from ${stage}`, t, r, { id, caller: SUB.recA, reason, note, from: OLD_OPEN[stage] ?? stage });
    }
    // The reason checks: missing and empty are REASON_REQUIRED; anything not one of the eight is INVALID_REASON. Nothing is written.
    const t = world();
    for (const [label, body] of [['no reason', {}], ['an empty reason', { reason: '' }], ['a note but no reason', { note: 'x' }], ['no body', undefined]] as const) {
      refused(`${label}: 400 REASON_REQUIRED`, notHired(C.recruiter, R.n1, body, t), [400, bad('REASON_REQUIRED')]);
    }
    for (const reason of ['BAD_FIT', 'withdrew', 'STAGE_LIST_CHANGE', 'REJECTED', ' OTHER', 7, ['OTHER']]) {
      refused(`reason ${JSON.stringify(reason)}: 400 INVALID_REASON`, notHired(C.recruiter, R.n1, { reason }, t), [400, bad('INVALID_REASON')]);
    }
    refused('a note of 1001 characters: 400', notHired(C.recruiter, R.n1, { reason: 'OTHER', note: 'n'.repeat(1001) }, t), [400]);
    const long = notHired(C.recruiter, R.n1, { reason: 'OTHER', note: 'n'.repeat(1000) }, t);
    expect.soft(statusOf(long), `a note of 1000 characters is kept (${describe(long)})`).toBe(200);
    expect.soft(sagaOf(long.tables, R.n1)?.['reason_note'], 'all of it').toBe('n'.repeat(1000));
    // decided_by is the sign-in: body values that name a person, a kind or a company are not read.
    const spoof = notHired(C.recruiter, R.n1, { reason: 'WITHDREW', decidedBy: 'sub-evil', decided_by: 'sub-evil', by: 'sub-evil', createdBy: 'sub-evil', decided_by_kind: 'OLD_SYSTEM', tenantId: B, tenant_id: B }, t);
    judgeNotHired('a body naming another person, kind and company', t, spoof, { id: R.n1, caller: SUB.recA, reason: 'WITHDREW', from: 'INTERVIEW' });
    expect.soft(JSON.stringify(spoof.tables[TABLE.state]), 'sub-evil is stored nowhere').not.toContain('sub-evil');
    // The person id is the user_id claim when the sign-in carries one (REC-00 rule 5: TEN-06 keeps the old TalentFlow id there).
    const legacy = notHired({ ...C.recruiter, claims: { user_id: 'tf-legacy-rec-a' } }, R.n1, { reason: 'CHOSE_ANOTHER' }, t);
    judgeNotHired('a Recruiter whose sign-in carries user_id', t, legacy, { id: R.n1, caller: 'tf-legacy-rec-a', reason: 'CHOSE_ANOTHER', from: 'INTERVIEW' });
    // The write names the company in its condition, so a row of another company is never changed (TEN-01 rule).
    const updates = stateWrites(spoof).filter((c) => c.op === 'UpdateItem' || c.op === 'TransactWriteItems');
    expect.soft(updates.length, 'the candidate is changed with an update').toBeGreaterThan(0);
    for (const u of updates) expect.soft(JSON.stringify(u.input), `${u.op}: carries the company in its condition`).toMatch(/tenant_id|tf_tenant/);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Who may decide: HR with the tick yes, the hiring manager only under HR_OR_HM, everyone else refused, B gets 404', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const body = { reason: 'NOT_RIGHT_SKILLS' };
    const t = world();
    for (const who of [C.recruiter, C.adminHr, C.recruiter2, C.oldHr]) {
      judgeNotHired(`${who.name}`, t, notHired(who, R.n1, body, t), { id: R.n1, caller: who.sub!, reason: 'NOT_RIGHT_SKILLS', from: 'INTERVIEW' });
    }
    // The hiring manager of the role: yes under HR_OR_HM (the pack's default), 403 under HR_ONLY. The decider is read for the candidate's level.
    judgeNotHired('the hiring manager under HR_OR_HM', t, notHired(C.hmC1, R.n1, body, t), { id: R.n1, caller: SUB.hmA, reason: 'NOT_RIGHT_SKILLS', from: 'INTERVIEW' });
    const hrOnlyMid = withRules(world(), { decider: byLevel('HR_OR_HM', { MID: 'HR_ONLY' }) });
    refused('the hiring manager under HR_ONLY: 403', notHired(C.hmC1, R.n1, body, hrOnlyMid), [403, FORBIDDEN]);
    const junior = notHired(C.hmC1, R.j1, body, hrOnlyMid);
    judgeNotHired('the same hiring manager on a JUNIOR candidate (HR_OR_HM for JUNIOR)', hrOnlyMid, junior, { id: R.j1, caller: SUB.hmA, reason: 'NOT_RIGHT_SKILLS', from: 'APPLIED', first: 'Jabu', last: 'Mthembu' });
    const hrOnlyAll = withRules(world(), { decider: byLevel('HR_ONLY') });
    judgeNotHired('a Recruiter under HR_ONLY', hrOnlyAll, notHired(C.recruiter, R.n1, body, hrOnlyAll), { id: R.n1, caller: SUB.recA, reason: 'NOT_RIGHT_SKILLS', from: 'INTERVIEW' });
    // Another manager (hiring manager of another role) is refused, under HR_OR_HM too.
    refused('another manager: refused', notHired(C.hmOther, R.n1, body, t), [403, 404]);
    refused('a manager of no candidate: refused', notHired({ ...C.hmOther, sub: 'sub-mgr-none-a' }, R.n1, body, t), [403, 404]);
    // Not a Recruiter and not a manager: 403 before any AWS call.
    for (const who of [C.panelA, C.adminOnly, C.employee, C.guest, C.hrNoTick, C.tickNoHr, C.approver, C.itOnly, C.noGroups, C.taClaim, C.oldAdmin, C.nearUpper]) {
      const r = notHired(who, R.n1, body, t);
      refused(`${who.name}: 403`, r, [403, FORBIDDEN]);
      expect.soft(awsOf(r).map((c: any) => `${c.service} ${c.op}`), `${who.name}: refused before any AWS call`).toEqual([]);
    }
    // B's Recruiter: 404, as if A's candidate did not exist.
    refused('B\'s Recruiter on A\'s candidate: 404', notHired(C.recruiterB, R.n1, body, t), [404, NOT_FOUND]);
    refused('B\'s manager on A\'s candidate: refused', notHired(C.managerB, R.n1, body, t), [403, 404]);
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 States: Hired, Not hired and a live offer are 409 with no write; the same Idempotency-Key returns the first answer and writes once', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const body = { reason: 'ROLE_CLOSED' };
    for (const stage of CLOSED) {
      const t = world();
      const id = 'CAND-02REC02CLOSEDAAAAAAAA1';
      t[TABLE.state]!.push(candidate(id, { stage }));
      refused(`from ${stage}: 409 NOT_OPEN`, notHired(C.recruiter, id, body, t), [409, conflict('NOT_OPEN')]);
    }
    const t = world();
    refused('an old-system row: 409 NOT_OPEN', notHired(C.recruiter, R.old[0]!, body, t), [409, conflict('NOT_OPEN')]);
    refused('a row a person already decided: 409 NOT_OPEN', notHired(C.recruiter, R.person, body, t), [409, conflict('NOT_OPEN')]);
    // A live offer (REC-05's states): 409 OFFER_LIVE. Today's draft offer is not live.
    for (const state of LIVE_OFFER) {
      const w = world();
      const id = 'CAND-02REC02OFFERAAAAAAAAA1';
      w[TABLE.state]!.push(candidate(id, { stage: 'OFFER' }), offerRow(id, state));
      refused(`in Offer with a ${state} offer: 409 OFFER_LIVE`, notHired(C.recruiter, id, body, w), [409, conflict('OFFER_LIVE')]);
    }
    const draft = world();
    draft[TABLE.state]!.push(candidate('CAND-02REC02OFFERAAAAAAAAA2', { stage: 'OFFER' }), offerRow('CAND-02REC02OFFERAAAAAAAAA2', 'OFFER_CREATED'));
    judgeNotHired('in Offer with a draft offer', draft, notHired(C.recruiter, 'CAND-02REC02OFFERAAAAAAAAA2', body, draft), { id: 'CAND-02REC02OFFERAAAAAAAAA2', caller: SUB.recA, reason: 'ROLE_CLOSED', from: 'OFFER' });
    // Another company's live offer row is not this candidate's.
    const bOffer = world();
    const bOfferRow = offerRow(R.n1, 'SENT', B);
    (bOfferRow as any).PK = { S: `CANDIDATE#${R.b1}` };
    bOffer[TABLE.state]!.push(bOfferRow);
    expect.soft(statusOf(notHired(C.recruiter, R.n1, body, bOffer)), 'a live offer on B\'s candidate does not stop A\'s').toBe(200);

    // The same Idempotency-Key: the first answer again, nothing written or sent the second time.
    const key = { 'idempotency-key': 'rec02-key-0001' };
    const first = notHired(C.recruiter, R.n1, body, t, key);
    judgeNotHired('with an Idempotency-Key', t, first, { id: R.n1, caller: SUB.recA, reason: 'ROLE_CLOSED', from: 'INTERVIEW' });
    const again = notHired(C.recruiter, R.n1, body, first.tables, key);
    expect.soft(answer(again), 'the same key again: the first answer').toEqual(answer(first));
    expect.soft(stateWrites(again).length, 'the same key again: no write to the candidate').toBe(0);
    expect.soft(eventsOf(again).length, 'the same key again: no event').toBe(0);
    expect.soft(historyOf(again.tables, R.n1).length, 'one history row in all').toBe(historyOf(first.tables, R.n1).length);
    // Without the key the second call is the real answer: it is Not hired already.
    refused('the second call without a key: 409 NOT_OPEN', notHired(C.recruiter, R.n1, body, first.tables), [409, conflict('NOT_OPEN')]);
    // A different person re-sending the key does not get the saved answer (D-T-9); B gets 404.
    refused('a second Recruiter re-sending the key: 409 NOT_OPEN, not the saved answer', notHired(C.recruiter2, R.n1, body, first.tables, key), [409, conflict('NOT_OPEN')]);
    refused('B\'s Recruiter re-sending the key: 404', notHired(C.recruiterB, R.n1, body, first.tables, key), [404, NOT_FOUND]);
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 Second confirmation: the first call leaves the stage, the same person is SAME_PERSON, a different decider completes it, cancel clears it', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const on = () => withRules(world(), { secondConfirmation: byLevel(true) });
    const body = { reason: 'NOT_RIGHT_EXPERIENCE' };
    const pendingOf = (t: Tables, id: string) => sagaOf(t, id)?.['not_hired_pending'];
    const notDone = (label: string, r: any, id: string, stage: string) => {
      const s = sagaOf(r.tables, id) ?? {};
      expect.soft(s['currentStage'], `${label}: the stage is unchanged`).toBe(stage);
      expect.soft(gone(s['not_hired_at']) && gone(s['decided_by']) && gone(s['reason_code']), `${label}: no decision is stored`).toBe(true);
      expect.soft(eventsOf(r).filter((e) => e.detailType === 'CandidateNotHired').length, `${label}: no CandidateNotHired event`).toBe(0);
    };

    // HR records it on a candidate with a hiring manager: the hiring manager must confirm.
    const t = on();
    const first = notHired(C.recruiter, R.n1, body, t);
    expect.soft(statusOf(first), `the first call is accepted (${describe(first)})`).toBeLessThan(300);
    notDone('HR records, second confirmation on', first, R.n1, 'INTERVIEW');
    const p = pendingOf(first.tables, R.n1) ?? {};
    expect.soft([p['by'], p['reason_code'], p['awaiting']], 'not_hired_pending names who, why and the hiring manager awaited').toEqual([SUB.recA, 'NOT_RIGHT_EXPERIENCE', { kind: 'HIRING_MANAGER', personId: SUB.hmA }]);
    expect.soft(String(p['at'] ?? ''), 'and when').toMatch(ISO);
    const self = call(ROUTE.confirm, C.recruiter, { id: R.n1, body: {} }, first.tables);
    refused('the same person confirming: 409 SAME_PERSON', self, [409, conflict('SAME_PERSON')]);
    refused('a panel member confirming: 403', call(ROUTE.confirm, C.panelA, { id: R.n1, body: {} }, first.tables), [403, FORBIDDEN]);
    refused('another manager confirming: refused', call(ROUTE.confirm, C.hmOther, { id: R.n1, body: {} }, first.tables), [403, 404]);
    refused('B\'s Recruiter confirming: 404', call(ROUTE.confirm, C.recruiterB, { id: R.n1, body: {} }, first.tables), [404, NOT_FOUND]);
    const done = call(ROUTE.confirm, C.hmC1, { id: R.n1, body: {} }, first.tables);
    expect.soft(statusOf(done), `the hiring manager confirms (${describe(done)})`).toBe(200);
    const s = sagaOf(done.tables, R.n1) ?? {};
    expect.soft([s['currentStage'], s['stage_before_not_hired'], s['reason_code'], s['decided_by_kind']], 'confirmed: the writes of rule 3').toEqual(['NOT_HIRED', 'INTERVIEW', 'NOT_RIGHT_EXPERIENCE', 'PERSON']);
    expect.soft(String(s['not_hired_at'] ?? ''), 'confirmed: not_hired_at').toMatch(ISO);
    expect.soft([SUB.recA, SUB.hmA], 'decided_by is one of the two people').toContain(s['decided_by']);
    const others = Object.entries(s).filter(([k]) => k !== 'decided_by' && k !== 'hiringManagerId').map(([, v]) => v);
    expect.soft(others, 'and the other one is on the row too (D-T-6)').toContain(s['decided_by'] === SUB.recA ? SUB.hmA : SUB.recA);
    expect.soft(gone(pendingOf(done.tables, R.n1)), 'the pending decision is gone').toBe(true);
    const ev = eventsOf(done).filter((e) => e.detailType === 'CandidateNotHired');
    expect.soft(ev.length, 'one CandidateNotHired event on confirm').toBe(1);
    expect.soft(Object.keys(ev[0]?.detail ?? {}).sort(), 'with only tenant_id, candidate_id, role_id, by and at').toEqual(['at', 'by', 'candidate_id', 'role_id', 'tenant_id']);
    const hist = historyOf(done.tables, R.n1);
    expect.soft(hist.map((h) => [h['fromStage'], h['toStage']]), 'one history row, written on confirm').toEqual([['INTERVIEW', 'NOT_HIRED']]);

    // The hiring manager records it: HR must confirm; the hiring manager confirming their own is SAME_PERSON; a Recruiter completes it.
    const byHm = notHired(C.hmC1, R.n1, body, on());
    notDone('the hiring manager records', byHm, R.n1, 'INTERVIEW');
    expect.soft(pendingOf(byHm.tables, R.n1)?.['awaiting'], 'awaiting HR').toEqual({ kind: 'HR' });
    refused('the hiring manager confirming their own: 409 SAME_PERSON', call(ROUTE.confirm, C.hmC1, { id: R.n1, body: {} }, byHm.tables), [409, conflict('SAME_PERSON')]);
    const hrDone = call(ROUTE.confirm, C.recruiter2, { id: R.n1, body: {} }, byHm.tables);
    expect.soft([statusOf(hrDone), sagaOf(hrDone.tables, R.n1)?.['currentStage']], `a Recruiter confirms (${describe(hrDone)})`).toEqual([200, 'NOT_HIRED']);

    // No hiring manager on the candidate: HR records, another HR confirms.
    const noHm = notHired(C.recruiter, R.n2, body, on());
    notDone('HR records on a candidate with no hiring manager', noHm, R.n2, 'SCREENING');
    expect.soft(pendingOf(noHm.tables, R.n2)?.['awaiting'], 'awaiting HR').toEqual({ kind: 'HR' });
    const hr2 = call(ROUTE.confirm, C.recruiter2, { id: R.n2, body: {} }, noHm.tables);
    expect.soft([statusOf(hr2), sagaOf(hr2.tables, R.n2)?.['currentStage'], sagaOf(hr2.tables, R.n2)?.['stage_before_not_hired']], `a second Recruiter confirms (${describe(hr2)})`).toEqual([200, 'NOT_HIRED', 'SCREENING']);

    // Confirming is deciding: under HR_ONLY the hiring manager may not confirm (403, nothing written); a second Recruiter may.
    const hrOnly = withRules(world(), { decider: byLevel('HR_ONLY'), secondConfirmation: byLevel(true) });
    // Lock check round 1, line 4: under HR_ONLY the hiring manager (and another manager) cannot start one either: 403 or 404, nothing stored.
    for (const who of [C.hmC1, C.hmOther]) {
      const r = notHired(who, R.n1, body, hrOnly);
      refused(`${who.name} recording under HR_ONLY with second confirmation on`, r, who === C.hmC1 ? [403, FORBIDDEN] : [403, 404]);
      expect.soft(gone(pendingOf(r.tables, R.n1)), `${who.name} under HR_ONLY: nothing is left pending`).toBe(true);
    }
    const pendingHrOnly = notHired(C.recruiter, R.n1, body, hrOnly);
    // Line 6: under HR_ONLY the hiring manager cannot cancel HR's pending decision either.
    const hmCancels = call(ROUTE.cancel, C.hmC1, { id: R.n1, body: {} }, pendingHrOnly.tables);
    refused('the hiring manager cancelling under HR_ONLY: 403', hmCancels, [403, FORBIDDEN]);
    expect.soft(pendingOf(hmCancels.tables, R.n1)?.['by'], 'and HR\'s pending decision stays').toBe(SUB.recA);
    notDone('HR records under HR_ONLY', pendingHrOnly, R.n1, 'INTERVIEW');
    const hmTries = call(ROUTE.confirm, C.hmC1, { id: R.n1, body: {} }, pendingHrOnly.tables);
    refused('the hiring manager confirming under HR_ONLY: 403', hmTries, [403, FORBIDDEN]);
    notDone('the hiring manager confirming under HR_ONLY', hmTries, R.n1, 'INTERVIEW');
    const hrOnlyDone = call(ROUTE.confirm, C.recruiter2, { id: R.n1, body: {} }, pendingHrOnly.tables);
    expect.soft([statusOf(hrOnlyDone), sagaOf(hrOnlyDone.tables, R.n1)?.['currentStage']], `under HR_ONLY a second Recruiter confirms (${describe(hrOnlyDone)})`).toEqual([200, 'NOT_HIRED']);

    // Cancel: the one who recorded it, or the one awaited, lets it go; nothing else changes.
    for (const who of [C.recruiter, C.hmC1]) {
      const pending = notHired(C.recruiter, R.n1, body, on());
      const cancel = call(ROUTE.cancel, who, { id: R.n1, body: {} }, pending.tables);
      expect.soft(statusOf(cancel), `${who.name} cancels (${describe(cancel)})`).toBe(200);
      expect.soft(gone(pendingOf(cancel.tables, R.n1)), `${who.name} cancels: the pending decision is gone`).toBe(true);
      notDone(`${who.name} cancels`, cancel, R.n1, 'INTERVIEW');
      const after = call(ROUTE.confirm, C.hmC1, { id: R.n1, body: {} }, cancel.tables);
      expect.soft(statusOf(after), 'confirming after a cancel is refused').toBeGreaterThanOrEqual(400);
      expect.soft(sagaOf(after.tables, R.n1)?.['currentStage'], 'and the candidate stays where it was').toBe('INTERVIEW');
    }
    const pending = notHired(C.recruiter, R.n1, body, on());
    // Line 6: a manager of another role, a panel member and B's manager cannot cancel it; it stays pending.
    for (const who of [C.hmOther, C.panelA, C.managerB]) {
      const r = call(ROUTE.cancel, who, { id: R.n1, body: {} }, pending.tables);
      refused(`${who.name} cancelling: refused`, r, [403, 404]);
      expect.soft(pendingOf(r.tables, R.n1)?.['by'], `${who.name} cancelling: the pending decision stays`).toBe(SUB.recA);
    }
    // Line 6: a Recruiter whose sign-in carries an old TalentFlow user_id (TEN-06) is that person: the pending names the user_id, and
    // confirming their own is still SAME_PERSON.
    const legacy = { ...C.recruiter, name: 'Recruiter with a user_id', claims: { ...((C.recruiter as any).claims ?? {}), user_id: 'tf-legacy-rec-a' } } as typeof C.recruiter;
    const legacyPending = notHired(legacy, R.n1, body, on());
    expect.soft(pendingOf(legacyPending.tables, R.n1)?.['by'], 'the pending names the sign-in\'s user_id').toBe('tf-legacy-rec-a');
    const ownConfirm = call(ROUTE.confirm, legacy, { id: R.n1, body: {} }, legacyPending.tables);
    refused('the same person (user_id sign-in) confirming their own: 409 SAME_PERSON', ownConfirm, [409, conflict('SAME_PERSON')]);
    expect.soft(sagaOf(ownConfirm.tables, R.n1)?.['currentStage'], 'and the candidate stays where it was').toBe('INTERVIEW');
    refused('an employee cancelling: 403', call(ROUTE.cancel, C.employee, { id: R.n1, body: {} }, pending.tables), [403, FORBIDDEN]);
    refused('B\'s Recruiter cancelling: 404', call(ROUTE.cancel, C.recruiterB, { id: R.n1, body: {} }, pending.tables), [404, NOT_FOUND]);

    // Off for the candidate's level (the pack's default): one call is enough.
    const off = withRules(world(), { secondConfirmation: byLevel(true, { MID: false }) });
    judgeNotHired('second confirmation off for MID', off, notHired(C.recruiter, R.n1, body, off), { id: R.n1, caller: SUB.recA, reason: 'NOT_RIGHT_EXPERIENCE', from: 'INTERVIEW' });
    expect.soft(gone(pendingOf(notHired(C.recruiter, R.n1, body, world()).tables, R.n1)), 'the pack default: nothing is left pending').toBe(true);
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 Reopen: needs a reason, restores the stage, clears the decision, keeps the history, works for an old-system row, refused from open stages', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const t = world();
    const closed = notHired(C.recruiter, R.n1, { reason: 'DID_NOT_ATTEND' }, t);
    expect.soft(statusOf(closed), `the candidate is Not hired first (${describe(closed)})`).toBe(200);
    const decision = historyOf(closed.tables, R.n1);
    for (const [label, body, want] of [
      ['no reason', {}, [400, bad('REASON_REQUIRED')]],
      ['an empty reason', { reason: '' }, [400, bad('REASON_REQUIRED')]],
      ['a reason of 1001 characters', { reason: 'r'.repeat(1001) }, [400]],
    ] as const) {
      refused(`reopen with ${label}`, call(ROUTE.reopen, C.recruiter, { id: R.n1, body }, closed.tables), want as any);
    }
    const why = 'She can make the second interview after all.';
    const open = call(ROUTE.reopen, C.recruiter2, { id: R.n1, body: { reason: why } }, closed.tables);
    expect.soft(statusOf(open), `a Recruiter reopens with a reason (${describe(open)})`).toBe(200);
    const s = sagaOf(open.tables, R.n1) ?? {};
    expect.soft(s['currentStage'], 'the stage before Not hired is back').toBe('INTERVIEW');
    expect.soft(gone(s['not_hired_at']) && gone(s['reason_code']), 'not_hired_at and reason_code are cleared').toBe(true);
    const hist = historyOf(open.tables, R.n1);
    for (const h of decision) expect.soft(hist, 'the earlier decision is still in the history, unchanged').toContainEqual(h);
    const added = hist.filter((h) => !decision.some((d) => d['SK'] === h['SK']));
    expect.soft(added.map((h) => [h['fromStage'], h['toStage'], h['actor'], h['tenant_id']]), 'one new history row: from NOT_HIRED back, by the reopener').toEqual([['NOT_HIRED', 'INTERVIEW', 'sub-rec2-a', A]]);
    expect.soft(JSON.stringify(changedRows(closed.tables, open.tables, R.n1)), 'the reason is stored with the reopen').toContain(why);
    expect.soft(JSON.stringify(eventsOf(open)), 'no event carries the reopen reason').not.toContain(why);
    const againClosed = notHired(C.recruiter, R.n1, { reason: 'WITHDREW' }, open.tables);
    expect.soft(statusOf(againClosed), `a reopened candidate can be Not hired again (${describe(againClosed)})`).toBe(200);

    // An old-system row (REC-03's migration shape): back to its stage_before_not_hired.
    for (const o of [OLD_ROWS[0]!, OLD_ROWS[1]!]) {
      const r = call(ROUTE.reopen, C.recruiter, { id: o.id, body: { reason: 'Looked again at the old decision.' } }, world());
      expect.soft(statusOf(r), `an old-system row (${o.status}) reopens (${describe(r)})`).toBe(200);
      expect.soft(sagaOf(r.tables, o.id)?.['currentStage'], `an old-system row (${o.status}) goes back to ${o.before}`).toBe(o.before);
      expect.soft(gone(sagaOf(r.tables, o.id)?.['not_hired_at']), 'its not_hired_at is cleared').toBe(true);
      expect.soft(['REJECTED', 'EVALUATION_FAILED'], 'and it no longer reads as an old outcome').not.toContain(sagaOf(r.tables, o.id)?.['status']);
    }
    // Refused from an open stage, and from Hired.
    refused('reopen from Interview: 409 NOT_OPEN', call(ROUTE.reopen, C.recruiter, { id: R.n1, body: { reason: why } }, t), [409, conflict('NOT_OPEN')]);
    refused('reopen from Screening: 409 NOT_OPEN', call(ROUTE.reopen, C.recruiter, { id: R.n2, body: { reason: why } }, t), [409, conflict('NOT_OPEN')]);
    const hired = world();
    hired[TABLE.state]!.push(candidate('CAND-02REC02HIREDAAAAAAAAA1', { stage: 'HIRED' }));
    refused('reopen from Hired: 409 NOT_OPEN', call(ROUTE.reopen, C.recruiter, { id: 'CAND-02REC02HIREDAAAAAAAAA1', body: { reason: why } }, hired), [409, conflict('NOT_OPEN')]);
    // Who: a decider. The hiring manager under HR_OR_HM yes, under HR_ONLY 403; an employee 403; B 404.
    const byHm = call(ROUTE.reopen, C.hmC1, { id: R.n1, body: { reason: why } }, closed.tables);
    expect.soft([statusOf(byHm), sagaOf(byHm.tables, R.n1)?.['currentStage']], `the hiring manager reopens under HR_OR_HM (${describe(byHm)})`).toEqual([200, 'INTERVIEW']);
    const hrOnly = withRules(structuredClone(closed.tables), { decider: byLevel('HR_ONLY') });
    refused('the hiring manager under HR_ONLY: 403', call(ROUTE.reopen, C.hmC1, { id: R.n1, body: { reason: why } }, hrOnly), [403, FORBIDDEN]);
    refused('an employee: 403', call(ROUTE.reopen, C.employee, { id: R.n1, body: { reason: why } }, closed.tables), [403, FORBIDDEN]);
    refused('B\'s Recruiter: 404', call(ROUTE.reopen, C.recruiterB, { id: R.n1, body: { reason: why } }, closed.tables), [404, NOT_FOUND]);
    // Lock check round 1, line 7: someone who may not decide on this candidate cannot reopen it, and nothing changes.
    for (const who of [C.hmOther, C.panelA, C.managerB]) {
      const r = call(ROUTE.reopen, who, { id: R.n1, body: { reason: why } }, closed.tables);
      refused(`${who.name} reopening: refused`, r, [403, 404]);
      expect.soft(sagaOf(r.tables, R.n1)?.['currentStage'], `${who.name} reopening: the candidate stays Not hired`).toBe('NOT_HIRED');
    }
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Old-system list: only the caller\'s company\'s old-system rows, the six fields and no one else\'s scores; a manager gets 403', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const list = (who: any, query?: Record<string, string>) => {
      const items: any[] = [];
      let last: any;
      let next: string | undefined;
      for (let page = 0; page < 20; page++) {
        // DynamoDB answers a Query in pages (1 MB each): the fake answers two key matches a page, so a list that reads one page misses rows.
        last = call(ROUTE.oldSystem, who, { query: { ...(query ?? {}), ...(next ? { nextToken: next } : {}) } }, t, { queryPageSize: 2 });
        if (statusOf(last) !== 200) break;
        const b = bodyOf(last);
        items.push(...(Array.isArray(b) ? b : (b?.candidates ?? [])));
        next = Array.isArray(b) ? undefined : b?.nextToken;
        if (!next) break;
      }
      return { last, items };
    };
    const a = list(C.recruiter);
    expect.soft(statusOf(a.last), `a Recruiter of A lists (${describe(a.last)})`).toBe(200);
    expect.soft(a.items.map((i) => i.candidate_id).sort(), 'exactly A\'s six old-system rows: not B\'s, not a person\'s decision, not a row the migration has not moved').toEqual([...R.old].sort());
    for (const o of OLD_ROWS) {
      const item = a.items.find((i) => i.candidate_id === o.id);
      expect.soft(item, `${o.id} is listed with exactly its six fields`).toEqual({
        candidate_id: o.id, name: `${o.first} ${o.last}`, role_id: o.role ?? null, stage_before_not_hired: o.before, rejected_at: o.at, evaluation_result: 'FAILED',
      });
    }
    const text = JSON.stringify(bodyOf(a.last));
    for (const v of OTHER_VOTERS) expect.soft(text, `no vote of ${v} is in the list`).not.toContain(v);
    expect.soft(text, 'no score field is in the list').not.toMatch(/weightedScore|finalScore|scores|votes|email/i);
    const b = list(C.recruiterB);
    expect.soft(statusOf(b.last), `B's Recruiter lists (${describe(b.last)})`).toBe(200);
    expect.soft(b.items.map((i) => i.candidate_id), 'B sees only B\'s own old-system row').toEqual([R.oldB]);
    const bAsks = list(C.recruiterB, { tenantId: A, tenant_id: A });
    expect.soft(bAsks.items.map((i) => i.candidate_id), 'B naming A in the query still sees only B\'s').toEqual([R.oldB]);
    for (const who of [C.hmC1, C.hmOther, C.adminOnly, C.employee, C.hrNoTick, C.guest, C.taClaim]) {
      const r = call(ROUTE.oldSystem, who, {}, t);
      refused(`${who.name}: 403`, r, [403, FORBIDDEN]);
      expect.soft(awsOf(r).length, `${who.name}: refused before any AWS call`).toBe(0);
    }
    // Until the migration runs nothing is listed: a company with only unmoved REJECTED rows gets an empty list.
    const before = world();
    before[TABLE.state] = before[TABLE.state]!.filter((r) => !/OLD/.test(String((r as any).PK?.S)));
    const empty = call(ROUTE.oldSystem, C.recruiter, {}, before);
    const e = bodyOf(empty);
    expect.soft([statusOf(empty), Array.isArray(e) ? e : e?.candidates], 'before the migration the list is empty (the unmoved REJECTED row is not on it)').toEqual([200, []]);
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 Company B: every route answers 404 for A\'s candidate, and no company is read from any input', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const base = world();
    const closed = notHired(C.recruiter, R.n1, { reason: 'OTHER' }, base).tables;
    const pendingT = notHired(C.recruiter, R.n2, { reason: 'OTHER' }, withRules(world(), { secondConfirmation: byLevel(true) })).tables;
    const cases: [RouteKey, string, unknown, Tables][] = [
      [ROUTE.notHired, R.n1, { reason: 'OTHER' }, base],
      [ROUTE.confirm, R.n2, {}, pendingT],
      [ROUTE.cancel, R.n2, {}, pendingT],
      [ROUTE.reopen, R.n1, { reason: 'Looked again.' }, closed],
    ];
    const spoofs: [string, Partial<{ body: Record<string, unknown>; query: Record<string, string>; headers: Record<string, string>; claims: Record<string, unknown> }>][] = [
      ['plainly', {}],
      ['naming A in the body', { body: { tenantId: A, tenant_id: A, companyId: A } }],
      ['naming A in the query', { query: { tenantId: A, tenant_id: A } }],
      ['naming A in headers', { headers: { 'x-tenant-id': A, 'x-company-id': A, tenant_id: A } }],
      ['with custom:tenant_id A', { claims: { 'custom:tenant_id': A } }],
    ];
    for (const [route, id, body, t] of cases) {
      for (const who of [C.recruiterB, C.managerB, C.adminB]) {
        for (const [how, s] of spoofs) {
          const r = call(route, who, { id, body: { ...(body as object), ...(s.body ?? {}) }, query: s.query, headers: s.headers, claims: s.claims }, t);
          if (who === C.recruiterB) refused(`${route} by ${who.name} ${how}: 404`, r, [404, NOT_FOUND]);
          else refused(`${route} by ${who.name} ${how}: refused`, r, [403, 404]);
        }
      }
      // The control: the same request works for A.
      const ok = call(route, route === ROUTE.confirm ? C.recruiter2 : C.recruiter, { id, body }, t);
      expect.soft(statusOf(ok), `${route}: the same request by A's Recruiter works (${describe(ok)})`).toBe(200);
    }
    // B on its own candidate works (B holds the pack), and A on B's candidate is 404.
    judgeNotHired('B\'s Recruiter on B\'s own candidate', base, notHired(C.recruiterB, R.b1, { reason: 'OTHER' }, base), { id: R.b1, caller: SUB.recB, reason: 'OTHER', from: 'INTERVIEW', first: 'Bongani', last: 'Bee', company: B });
    refused('A\'s Recruiter on B\'s candidate: 404', notHired(C.recruiter, R.b1, { reason: 'OTHER' }, base), [404, NOT_FOUND]);
    // Text check: the handler and the core never read a company from the body, query, path or headers.
    for (const f of [...handlerFolderFiles(), CORE]) {
      const src = code(f);
      expect.soft(src.length, `${f.replace(REPO, '')}: read`).toBeGreaterThan(100);
      expect.soft(src.match(/(body|query|queryStringParameters|pathParameters|headers|input)\??\.\??\[?['"]?(tenantId|tenant_id|x-tenant-id|companyId)/g) ?? [], `${f.replace(REPO, '')}: reads no company from a request`).toEqual([]);
    }
  });

  // ---------------------------------------------------------------- AC-10

  test('AC-10 No paid model: Bedrock is refused and no changed Lambda imports a model client', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const r = notHired(C.recruiter, R.n1, { reason: 'OTHER' }, t);
    expect.soft(statusOf(r), `a Not hired runs (${describe(r)})`).toBe(200);
    expect.soft(awsOf(r).filter((c: any) => /bedrock|anthropic|openai|textract/i.test(`${c.service} ${c.op}`)).length, 'it asks no model anything').toBe(0);
    const files = [...handlerFolderFiles(), CORE, ...VOTE_HANDLERS.map(handlerFile)];
    expect.soft(handlerFolderFiles().length, 'the recordNotHired Lambda exists').toBeGreaterThan(0);
    for (const f of files) {
      expect.soft(existsSync(f), `${f.replace(REPO, '')} exists`).toBe(true);
      expect.soft(code(f).match(/client-bedrock|bedrock-runtime|@anthropic-ai|anthropic|openai|ai-guard|BedrockRuntime|InvokeModel|Converse(Stream)?Command/gi) ?? [], `${f.replace(REPO, '')}: no model client`).toEqual([]);
    }
  });

  // ---------------------------------------------------------------- AC-11

  test('AC-11 Roles, routes, CORS and IAM: role then company then module before any AWS call; the routes, the idempotency-key header, and only the grants rule 8 names', async ({}, testInfo) => {
    once(testInfo.project.name);
    // Table rows are never written from Terraform (LESSONS #362): no table item in any stack.
    for (const stack of STACKS) expect.soft(resourcesOf(stack, 'aws_dynamodb_table_item').length, `${stack}: no aws_dynamodb_table_item`).toBe(0);
    test.setTimeout(4 * 60_000);
    const t = world();
    const routes: [RouteKey, string | undefined][] = [...CANDIDATE_ROUTES.map((r) => [r, R.n1] as [RouteKey, string]), [ROUTE.oldSystem, undefined]];
    for (const [route, id] of routes) {
      const body = route === ROUTE.notHired ? { reason: 'OTHER' } : route === ROUTE.reopen ? { reason: 'x' } : {};
      for (const who of [C.employee, C.guest, C.adminOnly]) {
        const r = call(route, who, { id, body }, t);
        expect.soft([...answer(r), awsOf(r).length], `${route}, ${who.name}: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
      }
      const none = call(route, C.recruiterNoCompany, { id, body }, t);
      expect.soft([...answer(none), awsOf(none).length], `${route}, a Recruiter with no company: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
      const d = call(route, C.recruiterD, { id, body }, t);
      expect.soft(answer(d), `${route}, a Recruiter of a company with Recruitment off: 403`).toEqual([403, FORBIDDEN]);
      expect.soft(awsOf(d).filter((c: any) => !isModulesRead(c)).map((c: any) => `${c.service} ${c.op} ${c.table ?? ''}`), `${route}, Recruitment off: only the module read happens`).toEqual([]);
    }
    // The core (REC-00 rule 4) and the checks the handler runs.
    const core = code(CORE);
    expect.soft(core, 'lambda/shared/recruitment-actions/record-not-hired.mjs exports recordNotHired (REC-00 rule 4)').toMatch(/export\s+(async\s+)?function\s+recordNotHired\b|export\s*\{[^}]*\brecordNotHired\b/);
    const handler = handlerFolderFiles().map(code).join('\n');
    expect.soft(handler, 'the handler calls the core').toMatch(/recruitment-actions\/record-not-hired\.mjs/);
    expect.soft(handler + core, 'the role check is the REC-01 helper').toMatch(/recruitment-access\.mjs/);
    expect.soft(handler + core, 'the module check is MOD-01\'s').toMatch(/requireModule\s*\(/);
    expect.soft(handler + core, 'canDecide decides who may decide').toMatch(/canDecide\s*\(/);

    // Terraform: the five routes, JWT, on the recordNotHired Lambda.
    const fn = lambdaNamed(HANDLER);
    expect(fn.length, 'one aws_lambda_function named recordNotHired').toBe(1);
    const { stack, block } = fn[0]!;
    const integrations = resourcesOf(stack, 'aws_apigatewayv2_integration').filter((b) => (attributes(b.body).get('integration_uri') ?? '').includes(`aws_lambda_function.${block.labels[1]}.invoke_arn`)).map((b) => b.labels[1]);
    expect.soft(integrations.length, 'an integration points at it').toBeGreaterThan(0);
    const routesTf = resourcesOf(stack, 'aws_apigatewayv2_route').map((b) => ({ key: valueOf(stack, attributes(b.body).get('route_key')), auth: valueOf(stack, attributes(b.body).get('authorization_type')), target: attributes(b.body).get('target') ?? '', api: attributes(b.body).get('api_id') ?? '' }));
    for (const route of Object.values(ROUTE)) {
      const r = routesTf.filter((x) => x.key === route.replace(/\s+/g, '')); // attributes() reads values without whitespace
      expect.soft(r.length, `${route}: one route`).toBe(1);
      expect.soft(r[0]?.auth, `${route}: signed-in (JWT)`).toBe('JWT');
      expect.soft(integrations.some((n) => r[0]?.target.includes(`aws_apigatewayv2_integration.${n}.id`)), `${route}: on recordNotHired`).toBe(true);
      expect.soft(r[0]?.api, `${route}: on the TalentFlow API`).toContain('aws_apigatewayv2_api.talent_flow_api');
    }
    // CORS: the header the app sends is allowed (LESSONS NH-187).
    const api = blocks(filesOf('talent-flow-infra'), 'resource').find((b) => b.labels[0] === 'aws_apigatewayv2_api' && b.labels[1] === 'talent_flow_api');
    expect.soft((/allow_headers\s*=\s*\[([^\]]*)\]/.exec(api?.body ?? '')?.[1] ?? '').toLowerCase(), 'the TalentFlow API allows the idempotency-key header').toMatch(/"idempotency-key"/);

    // IAM (rule 8): only what the family needs, no wildcard, writes only to the state and idempotency tables.
    const role = roleResourceOf(block);
    expect.soft(role, 'recordNotHired runs as its own role').toBeTruthy();
    const others = lambdaNamed('advanceCandidateStage').concat(lambdaNamed('submitVote'), lambdaNamed('createCandidate')).map((x) => roleResourceOf(x.block));
    expect.soft(others, 'its role is not another Lambda\'s').not.toContain(role);
    const all = policyLines();
    const mine = Object.entries(all).filter(([k, p]) => p.stack === stack && p.role === role).flatMap(([, p]) => p.pairs ?? [`unreadable ${p.squash}`]);
    const managed = blocks(filesOf(stack), 'resource').filter((b) => b.labels[0] === 'aws_iam_role_policy_attachment' && (attributes(b.body).get('role') ?? '').includes(`aws_iam_role.${role}.`));
    expect.soft(managed.map((b) => b.labels[1]), 'no managed policy is attached to it').toEqual([]);
    expect.soft(mine.length, 'its policy is read').toBeGreaterThan(3);
    const ALLOWED = /^Allow (dynamodb:(GetItem|UpdateItem|PutItem|Query|ConditionCheckItem|TransactWriteItems)|events:PutEvents|kms:(Decrypt|GenerateDataKey|GenerateDataKeyWithoutPlaintext|DescribeKey)|logs:(CreateLogGroup|CreateLogStream|PutLogEvents)|xray:(PutTraceSegments|PutTelemetryRecords)) /;
    for (const line of mine) {
      expect.soft(line, 'an action rule 8 names').toMatch(ALLOWED);
      if (/ logs:/.test(line)) expect.soft(line, `${line}: only its own log group`).toMatch(/log-group:\/aws\/lambda\/recordNotHired:\*/);
      else if (!/ xray:/.test(line)) expect.soft(line.split(' ')[2], `${line}: no wildcard resource`).not.toMatch(/^\*$|:\*$|table\/\*|index\/\*/);
      if (/dynamodb:(UpdateItem|PutItem|TransactWriteItems)/.test(line)) expect.soft(line, `${line}: writes only the state or idempotency table`).toMatch(/tf_table_state\}?(?:"|\s|$)|tf_table_idempotency|talent-flow-state |talent-flow-idempotency-keys|talent_flow_state\.arn |talent_flow_idempotency_keys\.arn /);
    }
    expect.soft(mine.some((l) => /^Allow kms:Decrypt .*talent_flow_state/.test(l)) && mine.some((l) => /^Allow kms:GenerateDataKey .*talent_flow_state/.test(l)), 'it can read and write the encrypted state table (the state key)').toBe(true);
    expect.soft(mine.some((l) => /^Allow events:PutEvents /.test(l)), 'it can put the CandidateNotHired event').toBe(true);
    // No other Lambda gains a write (against develop 9f2d571, REC-12 merged).
    const baseline = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-02', 'iam-9f2d571', 'policies.json'), 'utf8')) as Record<string, { role: string; stack: Stack; pairs?: string[]; squash?: string }>;
    const WRITE = /^Allow (dynamodb:(PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems|\*)|events:PutEvents|sqs:SendMessage|lambda:InvokeFunction|s3:PutObject|states:StartExecution|ses:Send\w*|cognito-idp:Admin\w*) /;
    const writesOf = (p: { pairs?: string[]; squash?: string } | undefined) => new Set((p?.pairs ?? []).filter((l) => WRITE.test(l)));
    for (const [key, cur] of Object.entries(all)) {
      if (cur.stack === stack && cur.role === role) continue;
      if (/manage_roles|manageRoles/.test(key) || /manage_roles|manageRoles/.test(cur.role)) continue; // REC-04 (re-lock rec-04.1): the roles Lambda's own role writes the roles table, judged in rec-04.spec.ts AC-8.
      if (/manage_departments|manageDepartments/.test(key) || /manage_departments|manageDepartments/.test(cur.role)) continue; // REC-14 (child lock rec-14.1): the department list's own role, judged in rec-14.spec.ts AC-3.
      if (isRec05Role(key, cur.role)) continue; // REC-05 (child lock rec-05.1): the offers Lambda's own role writes the state table, judged in rec-05.spec.ts AC-10.
      if (isRec16Role(key, cur.role)) continue; // REC-16 (child lock rec-16.1): its own role, judged in rec-16.spec.ts AC-10.
      const was = writesOf(baseline[key]);
      const gained = [...writesOf(cur)].filter((l) => !was.has(l) && !isRec15dGrant(l, key) && !isInt01Grant(l, key) && !isRec062Grant(l, key)); // && isInt01Grant: child lock int-01.1; // && isRec15dGrant: child lock rec-15d.1 (AdminGetUser is a read, matched by Admin\w*)
      expect.soft(gained, `${key}: no new write grant`).toEqual([]);
      if (cur.squash && cur.squash !== baseline[key]?.squash) expect.soft(cur.squash, `${key}: an unreadable policy did not change`).toBe(baseline[key]?.squash);
    }
    void STACKS;
  });

  // ---------------------------------------------------------------- AC-12

  test('AC-12 The test logins on pepla-dev: a Strong No leaves the candidate open, HR records Not hired with a reason and reopens, B gets 404, the hiring manager is refused under HR_ONLY @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1 to AC-11.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(8 * 60_000);
    const env = (k: string) => process.env[k] ?? '';
    const login = (p: string) => ({ email: env(`${p}_EMAIL`), password: env(`${p}_PASSWORD`) });
    const logins = { admin: login('E2E_TF'), hr: login('E2E_HR'), manager: login('E2E_MANAGER'), employee: login('E2E_EMP'), companyB: login('E2E_HR_B') };
    for (const [who, l] of Object.entries(logins)) expect(l.email && l.password, `the ${who} test login is set`).toBeTruthy();
    const { devEnv } = await import('./support/ten-02/dev');
    const { region, clientId } = devEnv();
    const oldEnv = join(REPO, 'hr-portal', 'src', 'environments', 'environment.ts');
    const tfApi = (/talentFlow\s*:\s*\{[^}]*?apiUrl\s*:\s*['"`]([^'"`]+)['"`]/s.exec(existsSync(oldEnv) ? readFileSync(oldEnv, 'utf8') : '')?.[1] ?? '').replace(/\/+$/, '').replace(/\/v1$/, '');
    expect(tfApi, 'the TalentFlow API address is written for pepla-dev (hr-portal environment.ts, talentFlow.apiUrl)').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const signIn = async (l: { email: string; password: string }) => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: l.email, PASSWORD: l.password } }),
      });
      expect(r.status(), 'signs in at Cognito').toBe(200);
      return ((await r.json()) as any).AuthenticationResult.IdToken as string;
    };
    const personOf = (token: string) => { const c = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')); return String(c.user_id ?? c.sub); };
    const call2 = async (token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      page.request.fetch(`${tfApi}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { data: JSON.stringify(body) }) });
    const read = async (token: string, id: string) => { const r = await call2(token, 'GET', `/v1/candidates/${id}`); expect(r.status(), `the candidate ${id} is read`).toBe(200); const b = (await r.json()) as any; return (b.candidate ?? b) as Record<string, any>; };

    const [hr, manager, employee, companyB, admin] = await Promise.all([signIn(logins.hr), signIn(logins.manager), signIn(logins.employee), signIn(logins.companyB), signIn(logins.admin)]);
    const hrId = personOf(hr);
    const managerId = personOf(manager);

    // A Strong No from the panel login on the seeded REC-02 candidate (the seed resets it each run, D-T-12): it stays open.
    const seeded = 'CAND-SEEDREC020000000000001';
    const before = await read(hr, seeded);
    const strongNo = await call2(employee, 'POST', `/v1/candidates/${seeded}/votes`, { interviewId: 'iv-seed-rec02-0001', rating: 'STRONG_NO', scores: { technical: 1, communication: 1, culturalFit: 1, problemSolving: 1 } });
    expect(strongNo.status(), `the employee login on the panel casts a Strong No (${await strongNo.text()})`).toBe(200);
    const after = await read(hr, seeded);
    expect([after['status'], after['currentStage']], 'the candidate is still active in the same stage').toEqual(['ACTIVE', before['currentStage']]);
    expect(Number(after['strong_no_count'] ?? 0), 'the Strong No is counted as a flag').toBeGreaterThanOrEqual(1);

    // The preflight a browser sends before a Not hired with an Idempotency-Key (LESSONS NH-187).
    const pre = await page.request.fetch(`${tfApi}/v1/candidates/${seeded}/not-hired`, { method: 'OPTIONS', headers: { Origin: 'http://localhost:4200', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key' } });
    expect((pre.headers()['access-control-allow-headers'] ?? '').toLowerCase(), 'the API allows the idempotency-key header').toContain('idempotency-key');

    // HR records Not hired with a reason on a new candidate of their own, then reopens it. B gets 404 throughout.
    // Child lock rec-02.3: since REC-15 step B (PR 506) a candidate is added to an open role in the new format (first_name,
    // last_name, email, role_id, phone, source, idempotencyKey); the level and the hiring manager come from the role. So HR
    // first opens a role of that level with the manager login as its hiring manager (as rec-04.spec.ts AC-14 does), and
    // the roles are closed again at the end.
    const devDepartmentId = String((JSON.parse(readFileSync(join(__dirname, 'support', 'ten-04', 'dev-ids.json'), 'utf8')) as Record<string, unknown>)['department']);
    const opened: string[] = [];
    const made: string[] = [];
    const make = async (level: string) => {
      const run = `${level}-${Date.now()}`;
      const role = await call2(hr, 'POST', '/v1/roles', { job_title: `REC-02 dev check ${run}`, department_id: devDepartmentId, level, hiring_manager_id: managerId }, { 'Idempotency-Key': `rec02-role-${run}` });
      expect(role.status(), `HR opens a ${level} role for the check (${await role.text()})`).toBe(201);
      const roleId = ((await role.json()) as any).role_id as string;
      opened.push(roleId);
      const r = await call2(hr, 'POST', '/v1/candidates', { first_name: 'Rec', last_name: 'Zero-Two', email: `rec02.${run.toLowerCase()}@example.com`, role_id: roleId, phone: '082 555 0102', source: 'Referral', idempotencyKey: `rec02-${run}` });
      expect(r.status(), `HR adds a ${level} candidate in the new format (${await r.text()})`).toBe(201);
      const id = ((await r.json()) as any).candidateId as string;
      made.push(id);
      return id;
    };
    try {
    const x = await make('MID');
    const nh = await call2(hr, 'POST', `/v1/candidates/${x}/not-hired`, { reason: 'WITHDREW', note: 'REC-02 dev check' }, { 'Idempotency-Key': `rec02-dev-${Date.now()}` });
    expect(nh.status(), `HR records Not hired with a reason (${await nh.text()})`).toBe(200);
    const xs = await read(hr, x);
    expect([xs['currentStage'], xs['reason_code'], xs['decided_by'], xs['decided_by_kind']], 'stage NOT_HIRED, the reason, HR\'s person id, PERSON').toEqual(['NOT_HIRED', 'WITHDREW', hrId, 'PERSON']);
    for (const [method, path, body] of [['GET', `/v1/candidates/${x}`, undefined], ['POST', `/v1/candidates/${x}/reopen`, { reason: 'B tries' }], ['POST', `/v1/candidates/${x}/not-hired`, { reason: 'OTHER' }]] as const) {
      const r = await call2(companyB, method, path, body);
      expect(r.status(), `the company B login: ${method} ${path.replace(x, '{id}')} is 404`).toBe(404);
    }
    const ro = await call2(hr, 'POST', `/v1/candidates/${x}/reopen`, { reason: 'REC-02 dev check: reopened' });
    expect(ro.status(), `HR reopens the candidate (${await ro.text()})`).toBe(200);
    expect((await read(hr, x))['currentStage'], 'it is back in the stage it left').toBe(xs['stage_before_not_hired']);

    // The hiring manager: allowed for a MID candidate under HR_OR_HM, refused for a JUNIOR candidate once the Admin sets JUNIOR to HR_ONLY.
    const byHm = await call2(manager, 'POST', `/v1/candidates/${x}/not-hired`, { reason: 'NOT_RIGHT_SKILLS' });
    expect(byHm.status(), `the hiring-manager login records Not hired under HR_OR_HM (${await byHm.text()})`).toBe(200);
    const rules = await call2(admin, 'GET', '/v1/config?configType=REJECTION_RULES&active=true');
    expect(rules.status(), 'the Admin reads REJECTION_RULES').toBe(200);
    const active = (await rules.json()) as { version: number; data: any };
    if (active.data?.decider?.JUNIOR !== 'HR_ONLY') {
      const data = { ...active.data, decider: { ...active.data.decider, JUNIOR: 'HR_ONLY' } };
      const saved = await call2(admin, 'PUT', '/v1/config/REJECTION_RULES', { configType: 'REJECTION_RULES', data, expected_version: active.version });
      expect(saved.status(), `the Admin sets JUNIOR to HR_ONLY (${await saved.text()})`).toBe(200);
    }
    const y = await make('JUNIOR');
    const refusedHm = await call2(manager, 'POST', `/v1/candidates/${y}/not-hired`, { reason: 'NOT_RIGHT_SKILLS' });
    expect([refusedHm.status(), await refusedHm.json()], 'the hiring-manager login is refused under HR_ONLY').toEqual([403, FORBIDDEN]);
    expect((await read(hr, y))['currentStage'], 'and the candidate is unchanged').not.toBe('NOT_HIRED');

    // The old-system list: HR 200, the manager 403.
    expect((await call2(hr, 'GET', '/v1/candidates/old-system')).status(), 'HR reads the old-system list').toBe(200);
    expect((await call2(manager, 'GET', '/v1/candidates/old-system')).status(), 'the manager is refused the old-system list').toBe(403);
    } finally {
      // Leave dev as it was: the check's candidates are Not hired and its roles closed (a role with open candidates cannot close).
      for (const id of made) {
        const now = await call2(hr, 'GET', `/v1/candidates/${id}`);
        const b = now.status() === 200 ? (await now.json()) as any : null;
        if (b && (b.candidate ?? b).currentStage !== 'NOT_HIRED') await call2(hr, 'POST', `/v1/candidates/${id}/not-hired`, { reason: 'WITHDREW', note: 'REC-02 dev check: tidy up' }, { 'Idempotency-Key': `rec02-tidy-${id}` });
      }
      for (const roleId of opened) await call2(hr, 'POST', `/v1/roles/${encodeURIComponent(roleId)}/close`, {});
    }
    void [ID, B];
  });
});
