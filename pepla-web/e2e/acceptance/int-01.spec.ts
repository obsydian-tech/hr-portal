import { existsSync, readFileSync } from 'node:fs';
import { isRec062Grant, isRec09Policy } from './support/rec-09.1/grants'; // child lock rec-09.1 (REC-09), on top of rec-06.2.1
import { isRec16Role } from './support/rec-16.1/grants'; // child lock rec-16.1
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { PACK_SEED, REPO, runModule } from './support/rec-14/lambda-harness';
import { answerSchema, checker, looseObjects, readDoc, refName, type Doc } from './support/rec-14/schema';
import { lambdaNamed, policyLines, readTf, resourcesOf, settingsOf } from './support/rec-04/iam';
import {
  A, B, CRIT, H, HANDLER, IDEM_TABLE, K, M, NEVER, NOW, P, PANEL3, REC_U, REC_U_NAME, ROUTE, SCORES, SUB, TABLE, TENANTS, W, act, apiEvent, av, book,
  bodyOf, busOf, call, changed, describe, guardsOf, guestRead, guestVote, hashOf, interviewRow, invoke, ivOf, ivsOf, leakedTokens, linkOf, linkRow,
  linksOf, logsOf, makeLink, move, newKey, oldGuestVote, oldScores, oldVote, oldVoteRow, plain, plusDays, read, rowOf, rowsOf, scoresOf, secondOf,
  split, sqsOf, statusOf, token, vote, voteBody, voteRow, withChange, withDecider, withEmails, withIv, withPanelConfig, withRows, world, awsOf,
  guestVoter, votesOf, type Caller, type IvSpec, type O, type Req, type Run, type Tables,
} from './support/int-01/world';
// The store-fault preload (support/int-01/race.mjs) throws with this exact message; it is kept in step with that file.
const FAULT_MESSAGE = 'zz-int01-store-fault-message';

/**
 * INT-01 · Interview lifecycle on the server (red). Jira NH-269. Spec: /mnt/project-files/specs/interview-journey/cards/INT-01.md (rules 1
 * to 18, the Opus review changes R-1 to R-11, the spec check changes M-1 to M-6 and S-1 to S-11, decisions INT-01-D1 to D10), with its
 * check INT-01-spec-check.md (rounds 1 and 2). Notes for the builder: cards/int-01.md. Review page:
 * /mnt/project-files/specs/interview-journey/cards/INT-01-tests-for-review.md (the bar).
 *
 * The tests run the real handlers (lambda/scheduleInterview for the booking, the four actions and the interviews read; lambda/submitVote
 * for the panel vote and the scores read; lambda/submitVoteByToken for the guest read and vote; lambda/generateScoringLink;
 * lambda/advanceCandidateStage for the move to Offer) in a fresh Node process for each call, against REC-14's fake AWS over REC-15 step
 * D's world plus this card's candidates (support/int-01/world.ts), at a fixed time NOW (2026-11-23 12:00 UTC) or a time a test names.
 * support/int-01/race.mjs (test support only) runs a second request inside the same process at a chosen write (two requests at once), makes
 * a Query without ConsistentRead: true miss the newest vote (as DynamoDB may just after a write), or fails every call on one table.
 * Every answer of the INT-01 routes is checked against api/openapi.yaml. Terraform is read as text. Nothing calls AWS or any AI. Nothing
 * here has a screen width: each test runs once, at 1280. AC-18 runs on pepla-dev only, after merge.
 *
 * Expected red before merge: every test but the control and two guards that are green on develop and must stay green: AC-16 Logs
 * (develop's paths log no token, email, place, link or note today) and AC-27(d).
 *
 * Pinned by the test writer where the spec is silent (each is in cards/int-01.md for the BA to confirm):
 *  - D-T1 A time in the past (or now) is 400 { error: 'Bad request', code: 'AT_IN_PAST', field: 'at' }, judged after the other body checks.
 *  - D-T2 The booking answer is exactly { interview_id, status: 'SCHEDULED', sequence: 1 }. An action's 200 answer is checked against
 *    api/openapi.yaml only.
 *  - D-T3 Reschedule with guest_email: null removes the guest. The same address kept keeps the same link; another address is a new guest.
 *  - D-T4 AC-23 "same key on another route is refused" is read with R-22 (the key holds the route, the caller, the candidate and the
 *    interview): the first answer is never replayed there; the request is judged on its own.
 *  - D-T5 A panel entry's vote.overall is the mean of that vote's scores, rounded to one decimal; on_behalf_by_name is null for a vote the
 *    person gave themselves.
 *  - D-T6 no_feedback is true exactly for the panel people (and the guest) without a vote on an interview marked as done; on every other
 *    entry it is absent or false.
 *  - D-T7 closed_by_name is the closer's name from the pool (null when the pool has none). Mark as done stores closed_reason, closed_note,
 *    closed_by and closed_at like the other closing actions.
 *  - D-T8 A refused action on an interview that is not SCHEDULED is checked as 409 only, unless the spec names the code.
 *  - D-T9 can.capture_feedback is true exactly when POST /v1/interviews/{id}/votes accepts a vote from this caller now: for a Recruiter,
 *    on behalf of a panel person without a vote; for anyone else, their own. Every interview the caller sees carries can.
 *  - D-T10 The interview objects of InterviewList keep every rule 6 key in `required` (nullable where it can be empty), except
 *    candidate_note, closed_note, no_feedback, a GUEST entry's email and a panel entry's vote, which are left out when the caller may
 *    not see them. A visibility check accepts absent or null; it fails only on a value. The keys step D already left out of
 *    `required` (STEP_D_OPTIONAL, read at bd6d02c) stay as they are; every object stays closed.
 *  - D-T11 The sequence in an event equals the interview row's sequence after the action.
 *  - D-T12 Mark as done and Did not happen do not change `sequence` by rule; only reschedule and cancel are checked to raise it by one.
 *  - D-T13 A lost race that R-16/R-17 refuse (a vote landing between Mark as done's strong read and its write) may leave either outcome
 *    AC-27(b2) allows, or Mark as done refused 409 with the vote kept and the interview still SCHEDULED. A voter is never no_feedback.
 *  - D-T14 Company B's Recruiter with no Idempotency-Key header is 400 INVALID_FIELD Idempotency-Key (the header check is after the role
 *    and company checks and before any read; finding A's candidate is a read).
 *  - D-T15 A stray row under A's candidate carrying company B's tenant_id is 404 for A's Recruiter on every action.
 *  - D-T16 The scores read for a hiring manager who does not decide: their own votes in the panel shape when on a panel of this
 *    candidate, else 403 { error: 'Forbidden' }.
 *  - D-T17 The dev seed may read the ids from support/int-01/dev-ids.json, as seed_rec07 does.
 *  - D-T18 Another company's candidate is 404 before the request key is written: locked ten-03 AC-3 says a 404 on another company's
 *    record writes nothing, so the company read comes before the reserve (R-22 only orders the header check before any read).
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const REASON: Record<number, string> = { 400: 'Bad request', 403: 'Forbidden', 404: 'Not found', 409: 'Conflict' };
const EXPIRED = { error: 'Scoring link has expired' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EVENT_SOURCE = 'talent-flow.interviews';
const DETAIL_KEYS = ['actor', 'candidateId', 'interviewId', 'interviewType', 'sequence', 'tenant_id'];
const GUEST_READ_KEYS = ['candidate_first', 'candidate_last', 'criteria', 'expires_at', 'interview_at', 'interview_type', 'open', 'role_title'];
/** Keys step D (bd6d02c) already left out of `required` in InterviewList and PanelEntry; INT-01 does not change them (D-T10). */
const STEP_D_OPTIONAL = ['interviewId', 'candidateId', 'interviewType', 'scheduledAt', 'panelMemberIds', 'adhocPanelMembers', 'votesRequired', 'votesSubmitted',
  'completedAt', 'createdAt', 'criteria_snapshot', 'PANEL_SPLIT_FLAG', 'PANEL_CONSENSUS', 'name', 'role', 'person_id'];
const CAN_KEYS = ['cancel', 'capture_feedback', 'did_not_happen', 'mark_done', 'reschedule'];
const SQS_KEYS = ['candidateId', 'interviewId', 'interviewType', 'recipientId', 'scheduledAt', 'tenant_id', 'type'];
const sorted = <T>(a: Iterable<T>) => [...a].sort();
const iv = (n: number) => `1a7e2000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const B_IV = '1a7e2bbb-0000-4000-8000-000000000001';
const FUT = H(24);
const PAST = H(-1);
/** An ISO time with the +02:00 offset (Africa/Johannesburg) for the UTC time `iso`. */
const zoned = (iso: string) => new Date(Date.parse(iso) + 2 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, '+02:00');
const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// ---------------------------------------------------------------- bodies

const bookBody = (o: Record<string, unknown> = {}) => clean({ type: 'TECHNICAL', at: zoned(H(48)), length_minutes: 60, where: 'IN_PERSON', place: NEVER.place, panel: [P.p1, P.p2], ...o });
const RES = (o: Record<string, unknown> = {}) => ({ action: 'reschedule', ...o });
const CANCEL = (reason = 'CANDIDATE_ASKED', o: Record<string, unknown> = {}) => ({ action: 'cancel', reason, ...o });
const DNH = (reason = 'CANDIDATE_DID_NOT_COME', o: Record<string, unknown> = {}) => ({ action: 'did_not_happen', reason, ...o });
const DONE = (reason = 'FEEDBACK_GIVEN_ANOTHER_WAY', o: Record<string, unknown> = {}) => ({ action: 'complete', reason, ...o });
const CANCEL_REASONS = ['CANDIDATE_ASKED', 'PANEL_NOT_AVAILABLE', 'CANDIDATE_WITHDREW', 'OTHER'];
const DNH_REASONS = ['CANDIDATE_DID_NOT_COME', 'INTERVIEWER_DID_NOT_COME', 'OTHER'];
const DONE_REASONS = ['FEEDBACK_GIVEN_ANOTHER_WAY', 'PANEL_MEMBER_CANNOT_GIVE_FEEDBACK', 'OTHER'];
const withNote = (reason: string, note: string) => (reason === 'OTHER' ? { reason_note: note } : {});

/** World with these interviews added (each with its guest link when it has a guest). */
const w = (...ivs: (IvSpec | [IvSpec, { expires?: string; used?: string | null }])[]) => ivs.reduce<Tables>((t, x) => (Array.isArray(x) ? withIv(t, x[0], x[1]) : withIv(t, x)), world());

// ---------------------------------------------------------------- reading answers

let docCache: Doc | undefined;
const doc = () => (docCache ??= readDoc());
const CHECKED = new Set<string>([ROUTE.book, ROUTE.act, ROUTE.read, ROUTE.vote, ROUTE.scores, ROUTE.guestRead, ROUTE.guestVote]);
/** The answer against api/openapi.yaml (403, 404 and 500 are today's answers and are not judged here). */
const misfit = (route: string, r: Run): string[] => {
  const s = statusOf(r);
  if (s === undefined) return [`no answer (${describe(r)})`];
  if (!CHECKED.has(route) || [403, 404, 500].includes(s)) return [];
  return checker(doc()).check(answerSchema(doc(), route, s), bodyOf(r)).map((p) => `${route} ${s}: ${p}`);
};
const fits = (route: string, r: Run, label: string) => { expect.soft(misfit(route, r), `${label}: the answer passes api/openapi.yaml`).toEqual([]); return r; };
const ivEvents = (r: { calls: any[] }) => busOf(r).filter((e: any) => e.source === EVENT_SOURCE);
const oldEvents = (r: { calls: any[] }) => busOf(r).filter((e: any) => /^Interview(Scheduled|Completed)$/.test(e.detailType));

/** status, and the S-8 body exactly. */
function refused(r: Run, status: number, code: string, field: string | undefined, label: string) {
  expect.soft(statusOf(r), `${label}: ${status} ${code}${field ? ` ${field}` : ''} (got ${describe(r)})`).toBe(status);
  expect.soft(bodyOf(r), `${label}: the body is { error, code${field ? ', field' : ''} } exactly`).toEqual({ error: REASON[status], code, ...(field ? { field } : {}) });
}
/** Nothing in any table changed (the request-key table left out), nothing sent on the bus, nothing queued. */
function nothing(before: Tables, r: Run, label: string) {
  expect.soft(changed(before, r.tables), `${label}: nothing written`).toEqual([]);
  expect.soft(busOf(r).map((e: any) => e.detailType), `${label}: nothing sent on the bus`).toEqual([]);
  expect.soft(sqsOf(r).length, `${label}: nothing queued`).toBe(0);
}
const ok = (r: Run, status: number, label: string) => { expect(statusOf(r), `${label}: ${status} (got ${describe(r)})`).toBe(status); return bodyOf(r) as any; };
/** Exactly one interview event of `type` (and no old interview event), with exactly the detail keys of R-23 and these values. */
function oneEvent(r: Run, type: string, want: { cand: string; iv: string; ivType: string; actor: string; reason?: string; company?: string }, label: string) {
  const ev = ivEvents(r);
  expect.soft(ev.map((e: any) => e.detailType), `${label}: exactly one interview event, ${type}`).toEqual([type]);
  const row = ivOf(r.tables, want.cand, want.iv);
  expect.soft(ev[0]?.detail, `${label}: the event's detail is exactly these keys and values (R-23, D-T11)`).toEqual({
    candidateId: want.cand, tenant_id: want.company ?? A, interviewId: want.iv, interviewType: want.ivType, sequence: row?.['sequence'], actor: want.actor,
    ...(want.reason ? { reason_code: want.reason } : {}),
  });
  expect.soft(oldEvents(r).map((e: any) => e.detailType), `${label}: InterviewScheduled and InterviewCompleted are no longer sent (M-6)`).toEqual([]);
}
/** The interviews read as `who`, checked against api/openapi.yaml. */
function readOk(who: Caller, cand: string, t: Tables, label: string, o: O = {}) {
  const r = read(who, cand, t, o);
  fits(ROUTE.read, r, label);
  return ok(r, 200, label);
}
const ivIn = (b: any, id: string) => ((b?.interviews ?? []) as any[]).find((x) => x?.id === id);
const person = (x: any, id: string) => ((x?.panel ?? []) as any[]).find((e) => e?.kind === 'PERSON' && e?.person_id === id);
const guests = (x: any) => ((x?.panel ?? []) as any[]).filter((e) => e?.kind === 'GUEST');
const blank = (v: unknown) => v === undefined || v === null;

// ---------------------------------------------------------------- tests

/** Child lock int-01.2 (REC-06, NH-240): the two lines REC-06 gives manage_offers, matched exactly. */
const REC06_GRANTS: Record<string, RegExp[]> = {
  'talent-flow-infra/manage_offers': [
    /^Allow dynamodb:PutItem arn:aws:dynamodb:af-south-1:000000000000:table\/employees null$/,
    /^Allow dynamodb:Query arn:aws:dynamodb:af-south-1:000000000000:table\/employees\/index\/email-index null$/,
  ],
};

test.describe('INT-01 · Interview lifecycle on the server', () => {
  // ---------------------------------------------------------------- control

  test('Control: the world is as this file says (candidates, stages, A\'s guest switch on and B\'s off, recU a member of A), and a read works on develop', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const sagas = rowsOf(t, TABLE.state).filter((x) => x['SK'] === 'SAGA');
    const stage = (id: string) => sagas.find((x) => x['PK'] === `CANDIDATE#${id}`)?.['currentStage'] ?? sagas.find((x) => x['PK'] === `CANDIDATE#${id}`)?.['stage'];
    expect.soft([K.book, K.fresh, K.screening, K.notHired, K.bee].map((id) => !!stage(id)), 'the five candidates exist').toEqual([true, true, true, true, true]);
    const cfg = (c: string) => rowsOf(t, TABLE.config).find((x) => x['PK'] === `TENANT#${c}` && x['configType'] === 'PANEL_CONFIG' && x['isActive'] === true)?.['data'];
    expect.soft(cfg(A)?.interview_emails, 'A has the guest switch ON').toBe('ON');
    expect.soft(cfg(B)?.interview_emails ?? 'missing', 'B has it off').not.toBe('ON');
    expect.soft(rowsOf(t, TENANTS).some((x) => x['pk'] === `USER#${REC_U}` && x['tenant_id'] === A), 'recU is a member of A').toBe(true);
    const r = read(W.recruiter, K.book, t);
    expect(statusOf(r), `the interviews read answers on develop (${describe(r)})`).toBe(200);
    // The preload is inert unless asked: a read with the race, stale and fault settings off makes the same calls.
    const faulted = read(W.recruiter, K.book, t, { failTable: TABLE.state });
    expect.soft(statusOf(faulted), 'a store fault on the state table is an error answer').not.toBe(200);
  });

  // ---------------------------------------------------------------- AC-1 Booking body

  test('AC-1 A right booking: 201 { interview_id, status, sequence } exactly, a server-made id, the row in the stored names (S-3), one INTERVIEW_BOOKED event, nothing new queued', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const r = fits(ROUTE.book, book(W.recruiter, K.book, bookBody({ candidate_note: NEVER.note }), t), 'in person, with a note');
    const b = ok(r, 201, 'a right booking');
    expect.soft(sorted(Object.keys(b ?? {})), 'the answer has exactly interview_id, sequence, status (D-T2)').toEqual(['interview_id', 'sequence', 'status']);
    expect.soft([b?.status, b?.sequence], 'SCHEDULED, sequence 1').toEqual(['SCHEDULED', 1]);
    expect.soft(String(b?.interview_id), 'the id is a random UUID the server made').toMatch(UUID);
    const rows = ivsOf(r.tables, K.book);
    expect(rows.length, 'one interview row').toBe(1);
    const row = rows[0]!;
    expect.soft({
      interviewId: row['interviewId'], candidateId: row['candidateId'], tenant_id: row['tenant_id'], interviewType: row['interviewType'], scheduledAt: row['scheduledAt'],
      panelMemberIds: row['panelMemberIds'], length_minutes: row['length_minutes'], where: row['where'], place: row['place'], video_link: row['video_link'],
      candidate_note: row['candidate_note'], sequence: row['sequence'], booked_by: row['booked_by'], booked_at: row['booked_at'], status: row['status'], guest_link_hash: row['guest_link_hash'],
    }, 'the row, in the stored names, at UTC').toEqual({
      interviewId: b?.interview_id, candidateId: K.book, tenant_id: A, interviewType: 'TECHNICAL', scheduledAt: H(48), panelMemberIds: [P.p1, P.p2], length_minutes: 60,
      where: 'IN_PERSON', place: NEVER.place, video_link: undefined, candidate_note: NEVER.note, sequence: 1, booked_by: SUB.recA, booked_at: NOW, status: 'SCHEDULED', guest_link_hash: undefined,
    });
    expect.soft(linksOf(r.tables).length, 'no guest, no link row').toBe(0);
    oneEvent(r, 'INTERVIEW_BOOKED', { cand: K.book, iv: String(b?.interview_id), ivType: 'TECHNICAL', actor: SUB.recA }, 'booked');
    // Rule 16: nothing new is queued; the old INTERVIEW_SCHEDULED message may stay as it is, with today's keys only.
    for (const m of sqsOf(r)) {
      const body = typeof m.body === 'string' ? JSON.parse(m.body) : (m.body ?? {});
      expect.soft(body.type, 'only today\'s INTERVIEW_SCHEDULED message').toBe('INTERVIEW_SCHEDULED');
      expect.soft(Object.keys(body).filter((k) => !SQS_KEYS.includes(k)), 'with today\'s keys only').toEqual([]);
    }
    // Online, booked by the other Recruiter, with the time given in UTC.
    const on = fits(ROUTE.book, book(W.recU, K.fresh, bookBody({ where: 'ONLINE', place: undefined, video_link: NEVER.link, at: H(30), length_minutes: 15, panel: [P.p3] }), t), 'online');
    const ob = ok(on, 201, 'an online booking by recU');
    const orow = ivOf(on.tables, K.fresh, String(ob?.interview_id));
    expect.soft([orow?.['where'], orow?.['video_link'], orow?.['place'], orow?.['scheduledAt'], orow?.['length_minutes'], orow?.['booked_by']], 'online row').toEqual(['ONLINE', NEVER.link, undefined, H(30), 15, REC_U]);
    // Two bookings never share an id.
    const again = book(W.recruiter, K.book, bookBody({ type: 'PHONE_SCREEN' }), r.tables);
    const ab = ok(again, 201, 'a second type on the same candidate');
    expect.soft(ab?.interview_id, 'a new id').not.toBe(b?.interview_id);
    // The edges of length and time.
    for (const [label, body] of [['15 minutes', { length_minutes: 15 }], ['240 minutes', { length_minutes: 240 }], ['one minute from now', { at: zoned(M(1)) }]] as [string, Record<string, unknown>][]) {
      expect.soft(statusOf(book(W.recruiter, K.book, bookBody(body), t)), `${label} is accepted`).toBe(201);
    }
  });

  test('AC-1 Each wrong field gives 400 INVALID_FIELD with its name and writes nothing; extra keys and the old body are refused; a past time is AT_IN_PAST', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const t = world();
    const long = (n: number) => 'x'.repeat(n);
    const CASES: [string, Record<string, unknown>, string][] = [
      ['an unknown type', { type: 'NOPE' }, 'type'], ['no type', { type: undefined }, 'type'], ['a type that is not text', { type: 7 }, 'type'],
      ['a time with no zone', { at: '2026-12-01T10:00:00' }, 'at'], ['an impossible date', { at: '2026-02-30T10:00:00+02:00' }, 'at'], ['no time', { at: undefined }, 'at'],
      ['a time that is not a time', { at: 'tomorrow' }, 'at'],
      ['10 minutes', { length_minutes: 10 }, 'length_minutes'], ['250 minutes', { length_minutes: 250 }, 'length_minutes'], ['50 minutes', { length_minutes: 50 }, 'length_minutes'],
      ['60.5 minutes', { length_minutes: 60.5 }, 'length_minutes'], ['"60" as text', { length_minutes: '60' }, 'length_minutes'], ['no length', { length_minutes: undefined }, 'length_minutes'],
      ['0 minutes', { length_minutes: 0 }, 'length_minutes'],
      ['an unknown where', { where: 'PHONE' }, 'where'], ['no where', { where: undefined }, 'where'],
      ['an empty panel', { panel: [] }, 'panel'], ['a person twice', { panel: [P.p1, P.p1] }, 'panel'], ['four people (panel size 3)', { panel: [P.p1, P.p2, P.p3, REC_U] }, 'panel'],
      ['a company B person', { panel: [P.p1, P.pB] }, 'panel'], ['a person of no company', { panel: [P.stranger] }, 'panel'], ['a panel that is not a list', { panel: P.p1 }, 'panel'],
      ['no panel', { panel: undefined }, 'panel'],
      ['a guest email that is not an address', { guest_email: 'not-an-address' }, 'guest_email'], ['two guest addresses', { guest_email: `${NEVER.guestEmail},${NEVER.guestEmail2}` }, 'guest_email'],
      ['a 255-character guest email', { guest_email: `${long(244)}@outside.test` }, 'guest_email'],
      ['a 1001-character note', { candidate_note: long(1001) }, 'candidate_note'], ['a note that is not text', { candidate_note: 5 }, 'candidate_note'],
      ['tenant_id', { tenant_id: B }, 'tenant_id'], ['interviewId', { interviewId: iv(99) }, 'interviewId'], ['status', { status: 'COMPLETED' }, 'status'], ['sequence', { sequence: 5 }, 'sequence'],
      ['interview_id', { interview_id: iv(98) }, 'interview_id'], ['booked_by', { booked_by: REC_U }, 'booked_by'],
    ];
    for (const [label, change, field] of CASES) {
      const r = book(W.recruiter, K.book, bookBody(change), t);
      refused(r, 400, 'INVALID_FIELD', field, label);
      nothing(t, r, label);
      fits(ROUTE.book, r, label);
    }
    // The old body: refused, nothing written (the field named is one of its keys or a missing new one).
    const old = book(W.recruiter, K.book, { interviewId: iv(97), interviewType: 'TECHNICAL', scheduledAt: H(48), panelMemberIds: [P.p1] }, t);
    expect.soft([statusOf(old), bodyOf(old)?.code], `the old body is 400 INVALID_FIELD (got ${describe(old)})`).toEqual([400, 'INVALID_FIELD']);
    expect.soft(['interviewId', 'interviewType', 'scheduledAt', 'panelMemberIds', 'type', 'at', 'length_minutes', 'where', 'panel'], 'it names one of the fields').toContain(bodyOf(old)?.field);
    nothing(t, old, 'the old body');
    // A time now or before it (D-T1).
    for (const [label, at] of [['an hour ago', zoned(H(-1))], ['now', NOW]] as [string, string][]) {
      const r = book(W.recruiter, K.book, bookBody({ at }), t);
      refused(r, 400, 'AT_IN_PAST', 'at', `a time ${label}`);
      nothing(t, r, `a time ${label}`);
    }
  });

  // ---------------------------------------------------------------- AC-2 Where

  test('AC-2 Where: IN_PERSON needs place and refuses video_link; ONLINE needs an https link and refuses place; http, javascript: and 501 characters are refused', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const online = (o: Record<string, unknown>) => bookBody({ where: 'ONLINE', place: undefined, video_link: NEVER.link, ...o });
    const bad: [string, Record<string, unknown>, string][] = [
      ['in person with no place', bookBody({ place: undefined }), 'place'], ['in person with an empty place', bookBody({ place: '' }), 'place'],
      ['a 201-character place', bookBody({ place: 'p'.repeat(201) }), 'place'], ['in person with a video link', bookBody({ video_link: NEVER.link }), 'video_link'],
      ['online with no link', online({ video_link: undefined }), 'video_link'], ['online with a place', online({ place: NEVER.place }), 'place'],
      ['an http link', online({ video_link: 'http://meet.example.test/room' }), 'video_link'], ['a javascript: link', online({ video_link: 'javascript:alert(1)' }), 'video_link'],
      ['a 501-character link', online({ video_link: `https://meet.example.test/${'r'.repeat(475)}` }), 'video_link'], ['a link that is not a URL', online({ video_link: 'https://not a url' }), 'video_link'],
      ['a link that is not text', online({ video_link: 5 }), 'video_link'],
    ];
    expect(`https://meet.example.test/${'r'.repeat(475)}`.length, 'the long link is 501 characters').toBe(501);
    for (const [label, body, field] of bad) {
      const r = book(W.recruiter, K.book, body, t);
      refused(r, 400, 'INVALID_FIELD', field, label);
      nothing(t, r, label);
    }
    const good: [string, Record<string, unknown>][] = [
      ['a 500-character link', online({ video_link: `https://meet.example.test/${'r'.repeat(474)}` })], ['a 200-character place', bookBody({ place: 'p'.repeat(200) })], ['a 1-character place', bookBody({ place: 'p' })],
    ];
    for (const [label, body] of good) expect.soft(statusOf(book(W.recruiter, K.book, body, t)), `${label} is accepted`).toBe(201);
  });

  // ---------------------------------------------------------------- AC-3 One per type

  test('AC-3 One per type: a second TECHNICAL while one is SCHEDULED or COMPLETED is 409 TYPE_ALREADY_BOOKED; CANCELLED and DID_NOT_HAPPEN free it; two types at once; only in the Interview stage (S-6)', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const [status, want] of [['SCHEDULED', 409], ['COMPLETED', 409], ['CANCELLED', 201], ['DID_NOT_HAPPEN', 201]] as [string, number][]) {
      const t = w({ id: iv(1), cand: K.book, at: status === 'SCHEDULED' ? FUT : PAST, status });
      const r = book(W.recruiter, K.book, bookBody(), t);
      if (want === 409) { refused(r, 409, 'TYPE_ALREADY_BOOKED', undefined, `TECHNICAL ${status}`); nothing(t, r, `TECHNICAL ${status}`); }
      else expect.soft(statusOf(r), `TECHNICAL ${status} frees the type (got ${describe(r)})`).toBe(201);
    }
    // An interview booked the old way counts too.
    const oldWay = w({ id: iv(2), cand: K.book, at: FUT, sequence: null });
    refused(book(W.recruiter, K.book, bookBody(), oldWay), 409, 'TYPE_ALREADY_BOOKED', undefined, 'an old-way TECHNICAL SCHEDULED');
    // PHONE_SCREEN and TECHNICAL both SCHEDULED.
    const t = w({ id: iv(3), cand: K.book, at: FUT });
    const ps = book(W.recruiter, K.book, bookBody({ type: 'PHONE_SCREEN' }), t);
    expect.soft(statusOf(ps), `PHONE_SCREEN books while TECHNICAL is SCHEDULED (got ${describe(ps)})`).toBe(201);
    expect.soft(ivsOf(ps.tables, K.book).filter((x) => x['status'] === 'SCHEDULED').map((x) => x['interviewType']).sort(), 'two SCHEDULED').toEqual(['PHONE_SCREEN', 'TECHNICAL']);
    // Another candidate's TECHNICAL does not count.
    expect.soft(statusOf(book(W.recruiter, K.fresh, bookBody(), t)), 'another candidate books TECHNICAL').toBe(201);
    // S-6: only in the Interview stage.
    for (const cand of [K.screening, K.notHired]) {
      const t2 = world();
      const r = book(W.recruiter, cand, bookBody(), t2);
      refused(r, 409, 'NOT_ALLOWED_NOW', undefined, `booking a candidate in ${cand === K.screening ? 'Screening' : 'Not hired'}`);
      nothing(t2, r, 'outside the Interview stage');
    }
  });

  // ---------------------------------------------------------------- AC-4 Guest link

  test('AC-4 Guest link: one REC-07 link row tied to the interview, expires_at = at + 7 days, guest_link_hash on the row; no token in the answer, logs, events, queue or rows; a replay makes no second row', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const key = newKey();
    const r = fits(ROUTE.book, book(W.recruiter, K.book, bookBody({ guest_email: NEVER.guestEmail }), t, { key }), 'with a guest');
    const b = ok(r, 201, 'booking with a guest');
    const links = linksOf(r.tables);
    expect(links.length, 'one link row').toBe(1);
    const l = links[0]!;
    const row = ivOf(r.tables, K.book, String(b?.interview_id));
    expect.soft({ pk: l['PK'], sk: l['SK'], interview_id: l['interview_id'], candidate_id: l['candidate_id'], guest_email: l['guest_email'], expires_at: l['expires_at'], used_at: l['used_at'] ?? null, tenant_id: l['tenant_id'] },
      'the REC-07 link row').toEqual({ pk: `SCORING_LINK#${l['token_hash']}`, sk: 'META', interview_id: b?.interview_id, candidate_id: K.book, guest_email: NEVER.guestEmail, expires_at: plusDays(H(48), 7), used_at: null, tenant_id: A });
    expect.soft(String(l['token_hash']), 'token_hash is a sha256 hex').toMatch(/^[0-9a-f]{64}$/);
    expect.soft(Number(l['ttl']) >= Math.floor(Date.parse(plusDays(H(48), 7)) / 1000), 'its ttl is not before expires_at').toBe(true);
    expect.soft(row?.['guest_link_hash'], 'the interview row holds guest_link_hash = the link\'s token_hash (R-21)').toBe(l['token_hash']);
    const text = JSON.stringify({ answer: r.response, logs: logsOf(r), bus: busOf(r), sqs: sqsOf(r), rows: r.tables[TABLE.state] });
    expect.soft(leakedTokens(text, r.tables), 'no raw token in the answer, the logs, the bus, the queue or the stored rows').toEqual([]);
    expect.soft(logsOf(r).filter((x) => x.includes(NEVER.guestEmail)), 'no log line holds the guest email').toEqual([]);
    expect.soft(JSON.stringify(busOf(r)).includes(NEVER.guestEmail), 'no event holds the guest email').toBe(false);
    // The replay: the first answer's status and body, nothing written twice, nothing sent.
    const again = book(W.recruiter, K.book, bookBody({ guest_email: NEVER.guestEmail }), r.tables, { key });
    expect.soft([statusOf(again), bodyOf(again)], 'the replay gives the first answer (201 stays 201)').toEqual([201, b]);
    expect.soft([ivsOf(again.tables, K.book).length, linksOf(again.tables).length], 'one interview, one link').toEqual([1, 1]);
    expect.soft(changed(r.tables, again.tables), 'the replay writes nothing').toEqual([]);
    expect.soft(ivEvents(again).length, 'the replay sends nothing').toBe(0);
  });

  // ---------------------------------------------------------------- AC-5 Reschedule

  test('AC-5 Reschedule changes the fields, raises sequence, moves the kept guest\'s link, stops a removed guest\'s link at once, makes a new link for a new guest, and switches where cleanly', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(1);
    const base = w({ id: iv(1), cand: K.book, at: FUT, guest: G });
    // Time, length and note: same link, moved.
    const r = fits(ROUTE.act, act(W.recruiter, K.book, iv(1), RES({ at: zoned(H(72)), length_minutes: 90, reason_note: NEVER.reasonNote }), base), 'reschedule');
    ok(r, 200, 'reschedule');
    const row = ivOf(r.tables, K.book, iv(1));
    expect.soft([row?.['scheduledAt'], row?.['length_minutes'], row?.['sequence'], row?.['status'], row?.['guest_link_hash']], 'new time and length, sequence 2, the same guest').toEqual([H(72), 90, 2, 'SCHEDULED', hashOf(G)]);
    expect.soft([linkOf(r.tables, G)?.['expires_at'], linkOf(r.tables, G)?.['used_at'] ?? null], 'the kept guest\'s link moves to the new time + 7 days').toEqual([plusDays(H(72), 7), null]);
    expect.soft(linksOf(r.tables).length, 'no new link').toBe(1);
    const gr = guestRead(G, r.tables);
    expect.soft([statusOf(gr), bodyOf(gr)?.interview_at, bodyOf(gr)?.open], 'the same link still opens, on the new time, not yet open').toEqual([200, H(72), false]);
    oneEvent(r, 'INTERVIEW_RESCHEDULED', { cand: K.book, iv: iv(1), ivType: 'TECHNICAL', actor: SUB.recA }, 'rescheduled');
    expect.soft(JSON.stringify(busOf(r)).includes(NEVER.reasonNote), 'the reason note is not in the event').toBe(false);
    // The panel changes.
    const p = act(W.recruiter, K.book, iv(1), RES({ panel: [P.p1, P.p2] }), base);
    ok(p, 200, 'a panel change');
    expect.soft(ivOf(p.tables, K.book, iv(1))?.['panelMemberIds'], 'the new panel').toEqual([P.p1, P.p2]);
    // The guest removed (D-T3): the link stops at once (expires_at = now), used_at untouched; the read gives the expired answer.
    const rm = act(W.recruiter, K.book, iv(1), RES({ guest_email: null }), base);
    ok(rm, 200, 'removing the guest');
    expect.soft(blank(ivOf(rm.tables, K.book, iv(1))?.['guest_link_hash']), 'the row has no guest').toBe(true);
    expect.soft([linkOf(rm.tables, G)?.['expires_at'], linkOf(rm.tables, G)?.['used_at'] ?? null], 'the removed guest\'s link expires now, never "used" (S-4)').toEqual([NOW, null]);
    const dead = guestRead(G, rm.tables);
    expect.soft([statusOf(dead), bodyOf(dead)], 'the removed guest gets the single expired answer').toEqual([410, EXPIRED]);
    // Another guest: a new link, the old one stopped.
    const nw = act(W.recruiter, K.book, iv(1), RES({ guest_email: NEVER.guestEmail2 }), base);
    ok(nw, 200, 'a new guest');
    const newLink = linksOf(nw.tables).find((l) => l['guest_email'] === NEVER.guestEmail2);
    expect.soft([newLink?.['interview_id'], newLink?.['expires_at'], newLink?.['used_at'] ?? null], 'a new link for the new guest, at + 7 days').toEqual([iv(1), plusDays(FUT, 7), null]);
    expect.soft(ivOf(nw.tables, K.book, iv(1))?.['guest_link_hash'], 'the row names the new link').toBe(newLink?.['token_hash']);
    expect.soft(linkOf(nw.tables, G)?.['expires_at'], 'the old guest\'s link expires now').toBe(NOW);
    expect.soft(leakedTokens(JSON.stringify({ a: nw.response, l: logsOf(nw), e: busOf(nw), q: sqsOf(nw) }), nw.tables), 'the new token is not returned or logged').toEqual([]);
    // The same address sent again with a time change keeps the same link.
    const same = act(W.recruiter, K.book, iv(1), RES({ guest_email: NEVER.guestEmail, at: zoned(H(50)) }), base);
    ok(same, 200, 'the same guest');
    expect.soft([linksOf(same.tables).length, linkOf(same.tables, G)?.['expires_at']], 'the same link, moved').toEqual([1, plusDays(H(50), 7)]);
    // A guest added where there was none.
    const none = w({ id: iv(2), cand: K.book, at: FUT });
    const add = act(W.recruiter, K.book, iv(2), RES({ guest_email: NEVER.guestEmail }), none);
    ok(add, 200, 'adding a guest');
    const added = linksOf(add.tables);
    expect.soft([added.length, added[0]?.['interview_id'], ivOf(add.tables, K.book, iv(2))?.['guest_link_hash']], 'one new link, named on the row').toEqual([1, iv(2), added[0]?.['token_hash']]);
    // Where switched: the other field leaves the row.
    const sw = act(W.recruiter, K.book, iv(2), RES({ where: 'ONLINE', video_link: NEVER.link }), none);
    ok(sw, 200, 'in person to online');
    const swr = ivOf(sw.tables, K.book, iv(2));
    expect.soft([swr?.['where'], swr?.['video_link'], swr?.['place']], 'online, the place gone (S-10)').toEqual(['ONLINE', NEVER.link, undefined]);
  });

  test('AC-5 Reschedule refusals: a type change, nothing changed, a past time, a long note, both places, feedback from a panel person or the guest (409 HAS_FEEDBACK), Not hired (409 NOT_ALLOWED_NOW), a closed interview', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(2);
    const t = w({ id: iv(1), cand: K.book, at: FUT, guest: G });
    const bad: [string, Record<string, unknown>, number, string, string | undefined][] = [
      ['a type change', RES({ type: 'PHONE_SCREEN' }), 400, 'INVALID_FIELD', 'type'],
      ['nothing but the action', RES(), 400, 'INVALID_FIELD', 'action'],
      ['the values it already has', RES({ length_minutes: 60, where: 'IN_PERSON', place: NEVER.place }), 400, 'INVALID_FIELD', 'action'],
      ['a time in the past', RES({ at: zoned(H(-2)) }), 400, 'AT_IN_PAST', 'at'],
      ['a 501-character reason note', RES({ length_minutes: 45, reason_note: 'n'.repeat(501) }), 400, 'INVALID_FIELD', 'reason_note'],
      ['online with a place too', RES({ where: 'ONLINE', video_link: NEVER.link, place: NEVER.place }), 400, 'INVALID_FIELD', 'place'],
      ['a length that is not a step of 15', RES({ length_minutes: 50 }), 400, 'INVALID_FIELD', 'length_minutes'],
      ['a company B panel person', RES({ panel: [P.pB] }), 400, 'INVALID_FIELD', 'panel'],
    ];
    for (const [label, body, status, code, field] of bad) {
      const r = act(W.recruiter, K.book, iv(1), body, t);
      refused(r, status, code, field, label);
      nothing(t, r, label);
      fits(ROUTE.act, r, label);
    }
    // Feedback exists (M-1): a new-format vote of a panel person, or of this interview's guest.
    const started = w({ id: iv(2), cand: K.book, at: PAST, guest: G, votesSubmitted: 1 });
    for (const [label, voter] of [['a panel person', P.p1], ['the guest', guestVoter(G)]] as [string, string][]) {
      const t2 = withRows(started, [voteRow(K.book, iv(2), voter)]);
      const r = act(W.recruiter, K.book, iv(2), RES({ at: zoned(H(24)) }), t2);
      refused(r, 409, 'HAS_FEEDBACK', undefined, `feedback from ${label}`);
      nothing(t2, r, `feedback from ${label}`);
    }
    // Not hired (S-6): reschedule refused.
    const nh = w({ id: iv(3), cand: K.notHired, at: FUT });
    const r = act(W.recruiter, K.notHired, iv(3), RES({ length_minutes: 45 }), nh);
    refused(r, 409, 'NOT_ALLOWED_NOW', undefined, 'Not hired');
    nothing(nh, r, 'Not hired');
    // A closed interview (D-T8: 409).
    for (const status of ['CANCELLED', 'COMPLETED', 'DID_NOT_HAPPEN']) {
      const t3 = w({ id: iv(4), cand: K.book, at: FUT, status });
      const c = act(W.recruiter, K.book, iv(4), RES({ length_minutes: 45 }), t3);
      expect.soft(statusOf(c), `reschedule on ${status}: 409 (got ${describe(c)})`).toBe(409);
      nothing(t3, c, `reschedule on ${status}`);
    }
  });

  // ---------------------------------------------------------------- AC-6 Cancel

  test('AC-6 Cancel before the start with each approved reason: CANCELLED, closed fields, sequence + 1, guest link dead, votes refused, the type free again, the stage unchanged; OTHER needs a note; after the start is 409 NOT_CANCELLABLE', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(3);
    const t = w({ id: iv(1), cand: K.book, at: FUT, guest: G });
    for (const reason of CANCEL_REASONS) {
      const r = fits(ROUTE.act, act(W.recU, K.book, iv(1), CANCEL(reason, withNote(reason, NEVER.reasonNote)), t), `cancel ${reason}`);
      ok(r, 200, `cancel ${reason}`);
      const row = ivOf(r.tables, K.book, iv(1));
      expect.soft({ status: row?.['status'], closed_reason: row?.['closed_reason'], closed_note: row?.['closed_note'], closed_by: row?.['closed_by'], closed_at: row?.['closed_at'], sequence: row?.['sequence'] }, `${reason}: the row`).toEqual({
        status: 'CANCELLED', closed_reason: reason, closed_note: reason === 'OTHER' ? NEVER.reasonNote : undefined, closed_by: REC_U, closed_at: NOW, sequence: 2,
      });
      expect.soft([linkOf(r.tables, G)?.['expires_at'], linkOf(r.tables, G)?.['used_at'] ?? null], `${reason}: the guest link stops now, never "used"`).toEqual([NOW, null]);
      const gr = guestRead(G, r.tables);
      expect.soft([statusOf(gr), bodyOf(gr)], `${reason}: the guest read gives the single expired answer`).toEqual([410, EXPIRED]);
      oneEvent(r, 'INTERVIEW_CANCELLED', { cand: K.book, iv: iv(1), ivType: 'TECHNICAL', actor: REC_U, reason }, `cancel ${reason}`);
      expect.soft(rowOf(r.tables, `CANDIDATE#${K.book}`, 'SAGA'), `${reason}: the candidate does not move`).toEqual(rowOf(t, `CANDIDATE#${K.book}`, 'SAGA'));
      if (reason !== 'OTHER') continue;
      // After the cancel: votes refused once the time comes, the guest is expired, the type is free.
      const later = { now: H(25) };
      const pv = vote(W.p1, iv(1), voteBody(), r.tables, later);
      refused(pv, 409, 'NOT_ALLOWED_NOW', undefined, 'a panel vote on a cancelled interview');
      nothing(r.tables, pv, 'a panel vote on a cancelled interview');
      const gv = guestVote(G, voteBody(), r.tables, later);
      expect.soft([statusOf(gv), bodyOf(gv)], 'a guest vote on a cancelled interview: the expired answer').toEqual([410, EXPIRED]);
      nothing(r.tables, gv, 'a guest vote on a cancelled interview');
      expect.soft(statusOf(book(W.recruiter, K.book, bookBody(), r.tables)), 'TECHNICAL books again').toBe(201);
    }
    // A note may go with any reason.
    const n = act(W.recruiter, K.book, iv(1), CANCEL('CANDIDATE_ASKED', { reason_note: NEVER.reasonNote }), t);
    ok(n, 200, 'a note with CANDIDATE_ASKED');
    expect.soft(ivOf(n.tables, K.book, iv(1))?.['closed_note'], 'stored').toBe(NEVER.reasonNote);
    // Body refusals.
    for (const [label, body, field] of [
      ['OTHER with no note', CANCEL('OTHER'), 'reason_note'], ['OTHER with an empty note', CANCEL('OTHER', { reason_note: '' }), 'reason_note'],
      ['a 501-character note', CANCEL('OTHER', { reason_note: 'n'.repeat(501) }), 'reason_note'], ['an unknown reason', CANCEL('NOPE'), 'reason'],
      ['a did-not-happen reason', CANCEL('CANDIDATE_DID_NOT_COME'), 'reason'], ['no reason', { action: 'cancel' }, 'reason'],
    ] as [string, Record<string, unknown>, string][]) {
      const r = act(W.recruiter, K.book, iv(1), body, t);
      refused(r, 400, 'INVALID_FIELD', field, `cancel: ${label}`);
      nothing(t, r, `cancel: ${label}`);
    }
    // At or after the start, or not SCHEDULED: 409 NOT_CANCELLABLE.
    for (const [label, spec] of [['after the start', { at: PAST }], ['at the start', { at: NOW }], ['cancelled', { at: FUT, status: 'CANCELLED' }], ['completed', { at: PAST, status: 'COMPLETED' }]] as [string, Partial<IvSpec>][]) {
      const t2 = w({ id: iv(2), cand: K.book, at: FUT, ...spec });
      const r = act(W.recruiter, K.book, iv(2), CANCEL(), t2);
      refused(r, 409, 'NOT_CANCELLABLE', undefined, `cancel ${label}`);
      nothing(t2, r, `cancel ${label}`);
    }
    // S-6: a booked interview of a Not hired candidate can still be cancelled.
    const nh = w({ id: iv(3), cand: K.notHired, at: FUT });
    ok(act(W.recruiter, K.notHired, iv(3), CANCEL('CANDIDATE_WITHDREW'), nh), 200, 'cancel after Not hired');
  });

  // ---------------------------------------------------------------- AC-7 Did not happen

  test('AC-7 Did not happen: before the start 409; at or after it with no feedback works with each reason and stops the guest link; with any feedback 409 NOT_ALLOWED_NOW', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(4);
    const before = w({ id: iv(1), cand: K.book, at: FUT, guest: G });
    const r0 = act(W.recruiter, K.book, iv(1), DNH(), before);
    refused(r0, 409, 'NOT_ALLOWED_NOW', undefined, 'before the start');
    nothing(before, r0, 'before the start');
    const t = w({ id: iv(2), cand: K.book, at: PAST, guest: G });
    for (const reason of DNH_REASONS) {
      const r = fits(ROUTE.act, act(W.recruiter, K.book, iv(2), DNH(reason, withNote(reason, NEVER.reasonNote)), t), `did not happen ${reason}`);
      ok(r, 200, `did not happen ${reason}`);
      const row = ivOf(r.tables, K.book, iv(2));
      expect.soft([row?.['status'], row?.['closed_reason'], row?.['closed_note'], row?.['closed_by'], row?.['closed_at']], `${reason}: the row`).toEqual(['DID_NOT_HAPPEN', reason, reason === 'OTHER' ? NEVER.reasonNote : undefined, SUB.recA, NOW]);
      expect.soft([linkOf(r.tables, G)?.['expires_at'], linkOf(r.tables, G)?.['used_at'] ?? null], `${reason}: the guest link stops now`).toEqual([NOW, null]);
      expect.soft([statusOf(guestRead(G, r.tables)), statusOf(guestVote(G, voteBody(), r.tables))], `${reason}: the guest gets the expired answer`).toEqual([410, 410]);
      oneEvent(r, 'INTERVIEW_DID_NOT_HAPPEN', { cand: K.book, iv: iv(2), ivType: 'TECHNICAL', actor: SUB.recA, reason }, `did not happen ${reason}`);
      if (reason === 'OTHER') {
        refused(vote(W.p1, iv(2), voteBody(), r.tables), 409, 'NOT_ALLOWED_NOW', undefined, 'a panel vote after did not happen');
        expect.soft(statusOf(book(W.recruiter, K.book, bookBody(), r.tables)), 'TECHNICAL books again').toBe(201);
      }
    }
    ok(act(W.recruiter, K.book, iv(3), DNH(), w({ id: iv(3), cand: K.book, at: NOW })), 200, 'at the start exactly');
    for (const [label, voter] of [['a panel person', P.p1], ['the guest', guestVoter(G)]] as [string, string][]) {
      const t2 = withChange(withRows(t, [voteRow(K.book, iv(2), voter)]), `CANDIDATE#${K.book}`, `INTERVIEW#${iv(2)}`, { votesSubmitted: 1 });
      const r = act(W.recruiter, K.book, iv(2), DNH(), t2);
      refused(r, 409, 'NOT_ALLOWED_NOW', undefined, `feedback from ${label}`);
      nothing(t2, r, `feedback from ${label}`);
    }
    for (const [label, body, field] of [['OTHER with no note', DNH('OTHER'), 'reason_note'], ['a cancel reason', DNH('CANDIDATE_ASKED'), 'reason'], ['no reason', { action: 'did_not_happen' }, 'reason']] as [string, Record<string, unknown>, string][]) {
      const r = act(W.recruiter, K.book, iv(2), body, t);
      refused(r, 400, 'INVALID_FIELD', field, `did not happen: ${label}`);
      nothing(t, r, `did not happen: ${label}`);
    }
    ok(act(W.recruiter, K.notHired, iv(4), DNH(), w({ id: iv(4), cand: K.notHired, at: PAST })), 200, 'after Not hired (S-6)');
  });

  // ---------------------------------------------------------------- AC-8 Mark as done

  test('AC-8 Mark as done: before the start 409; after it each of the three reasons works (OTHER with a note); non-scorers are no_feedback, a scorer is not; an unscored guest\'s link stops; OTHER with no note and any other code are 400', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(5);
    const before = w({ id: iv(1), cand: K.book, at: FUT, guest: G });
    const r0 = act(W.recruiter, K.book, iv(1), DONE(), before);
    refused(r0, 409, 'NOT_ALLOWED_NOW', undefined, 'before the start');
    nothing(before, r0, 'before the start');
    const t = withRows(w({ id: iv(2), cand: K.book, at: PAST, guest: G, votesSubmitted: 1 }), [voteRow(K.book, iv(2), P.p1)]);
    for (const reason of DONE_REASONS) {
      const r = fits(ROUTE.act, act(W.recU, K.book, iv(2), DONE(reason, withNote(reason, NEVER.closedNote)), t), `mark as done ${reason}`);
      ok(r, 200, `mark as done ${reason}`);
      const row = ivOf(r.tables, K.book, iv(2));
      expect.soft([row?.['status'], row?.['closed_reason'], row?.['closed_note'], row?.['closed_by'], row?.['closed_at']], `${reason}: the row (D-T7)`).toEqual(['COMPLETED', reason, reason === 'OTHER' ? NEVER.closedNote : undefined, REC_U, NOW]);
      expect.soft(linkOf(r.tables, G)?.['expires_at'], `${reason}: the unscored guest's link stops now`).toBe(NOW);
      expect.soft(votesOf(r.tables, K.book, iv(2)).length, `${reason}: the vote stays`).toBe(1);
      oneEvent(r, 'INTERVIEW_MARKED_DONE', { cand: K.book, iv: iv(2), ivType: 'TECHNICAL', actor: REC_U, reason }, `mark as done ${reason}`);
      if (reason !== 'OTHER') continue;
      const x = ivIn(readOk(W.recruiter, K.book, r.tables, 'the read after mark as done'), iv(2));
      expect.soft([person(x, P.p1)?.no_feedback === true, person(x, P.p2)?.no_feedback, person(x, P.p3)?.no_feedback, guests(x)[0]?.no_feedback], 'p1 scored; p2, p3 and the guest are no_feedback (D-T6)').toEqual([false, true, true, true]);
      expect.soft([statusOf(guestRead(G, r.tables)), statusOf(guestVote(G, voteBody(), r.tables))], 'the guest gets the expired answer').toEqual([410, 410]);
      refused(vote(W.p2, iv(2), voteBody(), r.tables), 409, 'ALREADY_DONE', undefined, 'a vote after done');
    }
    // A guest who scored keeps their link as it is (used), and is not no_feedback.
    const scored = withRows(w([{ id: iv(3), cand: K.book, at: PAST, guest: G, votesSubmitted: 1 }, { used: H(-0.5) }]), [voteRow(K.book, iv(3), guestVoter(G))]);
    const s = act(W.recruiter, K.book, iv(3), DONE(), scored);
    ok(s, 200, 'mark as done with the guest scored');
    expect.soft(linkOf(s.tables, G), 'the scored guest\'s link is left as it was').toEqual(linkOf(scored, G));
    expect.soft(guests(ivIn(readOk(W.recruiter, K.book, s.tables, 'read'), iv(3)))[0]?.no_feedback === true, 'the scored guest is not no_feedback').toBe(false);
    for (const [label, body, field] of [
      ['OTHER with no note', DONE('OTHER'), 'reason_note'], ['PASS', DONE('PASS'), 'reason'], ['a cancel reason', DONE('CANDIDATE_ASKED'), 'reason'], ['no reason', { action: 'complete' }, 'reason'],
      ['today\'s outcome', DONE('FEEDBACK_GIVEN_ANOTHER_WAY', { outcome: 'PASS' }), 'outcome'],
    ] as [string, Record<string, unknown>, string][]) {
      const r = act(W.recruiter, K.book, iv(2), body, t);
      refused(r, 400, 'INVALID_FIELD', field, `mark as done: ${label}`);
      nothing(t, r, `mark as done: ${label}`);
    }
    for (const status of ['COMPLETED', 'CANCELLED', 'DID_NOT_HAPPEN']) {
      const t2 = w({ id: iv(4), cand: K.book, at: PAST, status });
      refused(act(W.recruiter, K.book, iv(4), DONE(), t2), 409, 'NOT_ALLOWED_NOW', undefined, `mark as done on ${status}`);
    }
    ok(act(W.recruiter, K.notHired, iv(5), DONE(), w({ id: iv(5), cand: K.notHired, at: PAST })), 200, 'after Not hired (S-6)');
  });

  // ---------------------------------------------------------------- AC-9 Done by itself

  test('AC-9 Done by itself: three panel votes leave it SCHEDULED while the guest is out; the guest vote sets COMPLETED by SYSTEM with one INTERVIEW_DONE; the count is a strong read; old-format votes do not count', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(6);
    const stale: O = { stale: true };
    let t = w({ id: iv(1), cand: K.book, at: PAST, guest: G });
    for (const p of [W.p1, W.p2, W.p3]) {
      const r = fits(ROUTE.vote, vote(p, iv(1), voteBody(), t, stale), `${p.name} votes`);
      ok(r, 201, `${p.name} votes`);
      expect.soft(ivOf(r.tables, K.book, iv(1))?.['status'], `after ${p.name}: still SCHEDULED (the guest has not scored)`).toBe('SCHEDULED');
      expect.soft(ivEvents(r).length, `after ${p.name}: no interview event`).toBe(0);
      t = r.tables;
    }
    expect.soft(ivOf(t, K.book, iv(1))?.['votesSubmitted'], 'votesSubmitted is 3, raised once per vote').toBe(3);
    const g = fits(ROUTE.guestVote, guestVote(G, voteBody(), t, stale), 'the guest votes');
    ok(g, 200, 'the guest votes last');
    const row = ivOf(g.tables, K.book, iv(1));
    expect.soft([row?.['status'], row?.['completed_by'], row?.['completed_at'], row?.['votesSubmitted']], 'COMPLETED by SYSTEM now, 4 votes').toEqual(['COMPLETED', 'SYSTEM', NOW, 4]);
    oneEvent(g, 'INTERVIEW_DONE', { cand: K.book, iv: iv(1), ivType: 'TECHNICAL', actor: 'SYSTEM' }, 'done by itself');
    const x = ivIn(readOk(W.recruiter, K.book, g.tables, 'the read after done'), iv(1));
    expect.soft(((x?.panel ?? []) as any[]).filter((e) => e?.no_feedback === true).length, 'nobody is no_feedback').toBe(0);
    // No guest: the third panel vote completes it.
    let u = w({ id: iv(2), cand: K.fresh, at: PAST });
    for (const p of [W.p1, W.p2]) { const r = vote(p, iv(2), voteBody(), u, stale); ok(r, 201, p.name); u = r.tables; }
    const last = vote(W.p3, iv(2), voteBody(), u, stale);
    ok(last, 201, 'the third panel vote');
    expect.soft(ivOf(last.tables, K.fresh, iv(2))?.['status'], 'no guest: the third vote completes it').toBe('COMPLETED');
    oneEvent(last, 'INTERVIEW_DONE', { cand: K.fresh, iv: iv(2), ivType: 'TECHNICAL', actor: 'SYSTEM' }, 'done by the third vote');
    // HR entering the last vote for a panel person completes it too.
    const hr = withRows(w({ id: iv(3), cand: K.book, at: PAST, votesSubmitted: 2 }), [voteRow(K.book, iv(3), P.p1), voteRow(K.book, iv(3), P.p2)]);
    const on = vote(W.recruiter, iv(3), voteBody({ on_behalf_of: P.p3 }), hr, stale);
    ok(on, 201, 'HR enters p3\'s vote');
    expect.soft(ivOf(on.tables, K.book, iv(3))?.['status'], 'HR on behalf: COMPLETED').toBe('COMPLETED');
    // An old-format vote of a panel person is not feedback: the guest vote does not complete it.
    const mixed = withRows(w({ id: iv(4), cand: K.book, at: PAST, guest: token(7), votesSubmitted: 3 }), [voteRow(K.book, iv(4), P.p1), voteRow(K.book, iv(4), P.p2), oldVoteRow(K.book, iv(4), P.p3)]);
    const gm = guestVote(token(7), voteBody(), mixed, stale);
    ok(gm, 200, 'the guest votes with p3\'s vote in the old format');
    expect.soft([ivOf(gm.tables, K.book, iv(4))?.['status'], ivEvents(gm).length], 'still SCHEDULED, no event').toEqual(['SCHEDULED', 0]);
  });

  test('AC-9 Two last votes sent at once (the panel person\'s and the guest\'s, either order around the write): COMPLETED once, exactly one INTERVIEW_DONE', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(8);
    const t = withRows(w({ id: iv(1), cand: K.book, at: PAST, guest: G, votesSubmitted: 2 }), [voteRow(K.book, iv(1), P.p1), voteRow(K.book, iv(1), P.p2)]);
    for (const when of ['before', 'after'] as const) {
      const r = vote(W.p3, iv(1), voteBody(), t, { stale: true, race: { when, match: `VOTE#${P.p3}`, second: { route: ROUTE.guestVote, path: { token: G }, body: voteBody() } } });
      const s = secondOf(r);
      expect.soft([statusOf(r), statusOf(s)], `${when}: both votes are accepted (${describe(r)} / ${describe(s)})`).toEqual([201, 200]);
      expect.soft([ivOf(r.tables, K.book, iv(1))?.['status'], ivOf(r.tables, K.book, iv(1))?.['votesSubmitted'], votesOf(r.tables, K.book, iv(1)).length], `${when}: COMPLETED, 4 votes`).toEqual(['COMPLETED', 4, 4]);
      expect.soft(ivEvents(r).map((e: any) => e.detailType), `${when}: exactly one INTERVIEW_DONE over both requests`).toEqual(['INTERVIEW_DONE']);
    }
  });

  // ---------------------------------------------------------------- AC-10 and AC-24 When votes are accepted

  test('AC-10 and AC-24 No early or late scores: a vote a minute early is 409 NOT_STARTED, at the start it is accepted; the guest read before the start is open: false; an early guest vote keeps the link; closed interviews refuse as rule 14 says', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(9);
    const t = w({ id: iv(1), cand: K.book, at: NOW, guest: G });
    const early = { now: M(-1) };
    for (const [label, who, body] of [['a panel person', W.p1, voteBody()], ['HR for a panel person', W.recruiter, voteBody({ on_behalf_of: P.p2 })]] as [string, Caller, unknown][]) {
      const r = vote(who, iv(1), body, t, early);
      refused(r, 409, 'NOT_STARTED', undefined, `${label} a minute early`);
      nothing(t, r, `${label} a minute early`);
      fits(ROUTE.vote, r, `${label} a minute early`);
      expect.soft(guardsOf(r.tables, K.book).length, `${label}: no guard row`).toBe(0);
    }
    ok(vote(W.p1, iv(1), voteBody(), t), 201, 'a panel person at the start');
    // The guest read: today's keys plus open (S-5).
    const gr = fits(ROUTE.guestRead, guestRead(G, t, early), 'the guest read early');
    const gb = ok(gr, 200, 'the guest read a minute early');
    expect.soft(sorted(Object.keys(gb ?? {})), 'today\'s keys plus open').toEqual(GUEST_READ_KEYS);
    expect.soft([gb?.open, gb?.interview_at], 'open: false, the start time').toEqual([false, NOW]);
    expect.soft(ok(guestRead(G, t), 200, 'the guest read at the start')?.open, 'open from the start').toBe(true);
    // AC-24: the early guest vote is 409 NOT_STARTED and sets no used_at; the link works from the start.
    const gv = fits(ROUTE.guestVote, guestVote(G, voteBody(), t, early), 'the guest vote early');
    refused(gv, 409, 'NOT_STARTED', undefined, 'a guest vote a minute early');
    nothing(t, gv, 'a guest vote a minute early');
    expect.soft(linkOf(gv.tables, G)?.['used_at'] ?? null, 'no used_at').toBeNull();
    expect.soft(ok(guestRead(G, gv.tables), 200, 'the link opens after the refused vote')?.open, 'open').toBe(true);
    const gv2 = guestVote(G, voteBody(), gv.tables);
    expect.soft([statusOf(gv2), bodyOf(gv2)], 'the guest scores from the start').toEqual([200, { saved: true }]);
    // Closed interviews.
    const closed: [string, string, number, string | null][] = [['COMPLETED', 'ALREADY_DONE', 410, null], ['CANCELLED', 'NOT_ALLOWED_NOW', 410, null], ['DID_NOT_HAPPEN', 'NOT_ALLOWED_NOW', 410, null]];
    for (const [status, code] of closed) {
      const t2 = w({ id: iv(2), cand: K.book, at: PAST, status, guest: token(10) });
      const pv = vote(W.p1, iv(2), voteBody(), t2);
      refused(pv, 409, code, undefined, `a panel vote on ${status}`);
      nothing(t2, pv, `a panel vote on ${status}`);
      const hv = vote(W.recruiter, iv(2), voteBody({ on_behalf_of: P.p1 }), t2);
      refused(hv, 409, code, undefined, `HR's vote on ${status}`);
      const g2 = guestVote(token(10), voteBody(), t2);
      expect.soft([statusOf(g2), bodyOf(g2)], `a guest vote on ${status}: the single expired answer`).toEqual([410, EXPIRED]);
      nothing(t2, g2, `a guest vote on ${status}`);
      expect.soft(linkOf(g2.tables, token(10))?.['used_at'] ?? null, `${status}: the link is not marked used`).toBeNull();
    }
    // Votes are judged on the interview, not the stage (S-6).
    ok(vote(W.p1, iv(3), voteBody(), w({ id: iv(3), cand: K.notHired, at: PAST })), 201, 'a vote on a Not hired candidate\'s started interview');
  });

  // ---------------------------------------------------------------- AC-11 Read

  test('AC-11 The read carries the rule 6 fields; closed fields and names; candidate_note and closed_note for a Recruiter only; required.done counts only COMPLETED required types; old-way rows show length and where as absent', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(11);
    let t = withRows(w(
      { id: iv(1), cand: K.book, at: PAST, guest: G, votesSubmitted: 1 },
      { id: iv(2), cand: K.book, type: 'PHONE_SCREEN', at: FUT, where: 'ONLINE', note: NEVER.note },
      { id: iv(3), cand: K.book, type: 'BEHAVIORAL', at: PAST, sequence: null },
    ), [voteRow(K.book, iv(1), P.p1)]);
    const md = act(W.recU, K.book, iv(1), DONE('OTHER', { reason_note: NEVER.closedNote }), t);
    ok(md, 200, 'mark TECHNICAL done');
    const cn = act(W.recU, K.book, iv(2), CANCEL('OTHER', { reason_note: NEVER.reasonNote }), md.tables);
    ok(cn, 200, 'cancel PHONE_SCREEN');
    t = cn.tables;
    const rb = readOk(W.recruiter, K.book, t, 'the Recruiter reads');
    const tech = ivIn(rb, iv(1));
    expect.soft({
      status: tech?.status, length_minutes: tech?.length_minutes, where: tech?.where, place: tech?.place, video_link: tech?.video_link ?? null, closed_reason: tech?.closed_reason,
      closed_note: tech?.closed_note, closed_by_name: tech?.closed_by_name, closed_at: tech?.closed_at, sequence: typeof tech?.sequence,
    }, 'TECHNICAL as the Recruiter sees it').toEqual({
      status: 'COMPLETED', length_minutes: 60, where: 'IN_PERSON', place: NEVER.place, video_link: null, closed_reason: 'OTHER', closed_note: NEVER.closedNote, closed_by_name: REC_U_NAME, closed_at: NOW, sequence: 'number',
    });
    expect.soft(sorted(Object.keys(tech?.can ?? {})), 'can has the five keys').toEqual(CAN_KEYS);
    expect.soft(Object.values(tech?.can ?? {}).every((v) => v === false), 'a COMPLETED interview: nothing may be done').toBe(true);
    const ph = ivIn(rb, iv(2));
    expect.soft([ph?.status, ph?.where, ph?.video_link, ph?.place ?? null, ph?.candidate_note, ph?.closed_reason, ph?.closed_note], 'PHONE_SCREEN cancelled, online, with its note').toEqual(['CANCELLED', 'ONLINE', NEVER.link, null, NEVER.note, 'OTHER', NEVER.reasonNote]);
    const beh = ivIn(rb, iv(3));
    expect.soft([beh?.length_minutes ?? null, beh?.where ?? null, beh?.sequence ?? null, beh?.status], 'an old-way row: length, where and sequence absent, never guessed').toEqual([null, null, null, 'SCHEDULED']);
    expect.soft(rb?.required, 'required.done counts only COMPLETED required types (TECHNICAL done, PHONE_SCREEN cancelled)').toEqual({ done: 1, total: 2 });
    // Who sees what.
    for (const who of [W.hm, W.p1]) {
      const b = readOk(who, K.book, t, `${who.name} reads`);
      for (const x of (b?.interviews ?? []) as any[]) {
        expect.soft(blank(x?.candidate_note), `${who.name}: no candidate_note on ${x?.id}`).toBe(true);
        expect.soft(blank(x?.closed_note), `${who.name}: no closed_note on ${x?.id}`).toBe(true);
        for (const e of guests(x)) expect.soft(blank(e?.email), `${who.name}: no guest email`).toBe(true);
      }
      expect.soft(ivIn(b, iv(1))?.closed_reason, `${who.name}: the reason code is shown (INT-01-D2)`).toBe('OTHER');
      expect.soft(JSON.stringify(b).includes(NEVER.note) || JSON.stringify(b).includes(NEVER.closedNote) || JSON.stringify(b).includes(NEVER.reasonNote) || JSON.stringify(b).includes(NEVER.guestEmail), `${who.name}: no note or guest email anywhere`).toBe(false);
    }
    const pb = readOk(W.p1, K.book, t, 'p1 reads');
    expect.soft([pb?.required ?? null, ((ivIn(pb, iv(1))?.panel ?? []) as any[]).map((e) => e?.person_id ?? e?.kind)], 'a panel person: required null, their own entry only (S-2)').toEqual([null, [P.p1]]);
    // DID_NOT_HAPPEN and SCHEDULED do not count; COMPLETED counts however it got there.
    const u = w({ id: iv(4), cand: K.fresh, at: PAST, status: 'DID_NOT_HAPPEN' }, { id: iv(5), cand: K.fresh, type: 'PHONE_SCREEN', at: PAST, status: 'COMPLETED' }, { id: iv(6), cand: K.fresh, type: 'TECHNICAL', at: FUT });
    expect.soft(readOk(W.recruiter, K.fresh, u, 'read')?.required, 'DID_NOT_HAPPEN and SCHEDULED TECHNICAL do not count').toEqual({ done: 1, total: 2 });
  });

  test('AC-11 can is exactly what the routes accept, for a Recruiter, the hiring manager and a panel person, at each state, on each side of the start, after Not hired and on an old-way row (rule 12, D-T9)', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(8 * 60_000);
    const STATES: [string, string, Tables][] = [
      ['SCHEDULED before the start', K.book, w({ id: iv(1), cand: K.book, at: FUT })],
      ['SCHEDULED at the start', K.book, w({ id: iv(1), cand: K.book, at: NOW })],
      ['SCHEDULED after the start, no feedback', K.book, w({ id: iv(1), cand: K.book, at: PAST })],
      ['SCHEDULED after the start, p1 voted', K.book, withRows(w({ id: iv(1), cand: K.book, at: PAST, votesSubmitted: 1 }), [voteRow(K.book, iv(1), P.p1)])],
      ['COMPLETED', K.book, w({ id: iv(1), cand: K.book, at: PAST, status: 'COMPLETED' })],
      ['CANCELLED', K.book, w({ id: iv(1), cand: K.book, at: FUT, status: 'CANCELLED' })],
      ['DID_NOT_HAPPEN', K.book, w({ id: iv(1), cand: K.book, at: PAST, status: 'DID_NOT_HAPPEN' })],
      ['old way, after the start', K.book, w({ id: iv(1), cand: K.book, at: PAST, sequence: null })],
      ['Not hired, before the start', K.notHired, w({ id: iv(1), cand: K.notHired, at: FUT })],
      ['Not hired, after the start', K.notHired, w({ id: iv(1), cand: K.notHired, at: PAST })],
    ];
    const accepted = (r: Run) => (statusOf(r) ?? 0) >= 200 && (statusOf(r) ?? 0) < 300;
    for (const [label, cand, t] of STATES) {
      const voted = new Set(votesOf(t, cand, iv(1)).map((v) => String(v['voterId'])));
      for (const who of [W.recruiter, W.hm, W.p1]) {
        const b = readOk(who, cand, t, `${label}, ${who.name} reads`);
        const x = ivIn(b, iv(1));
        expect.soft(x, `${label}: ${who.name} sees the interview`).toBeTruthy();
        const forOther = PANEL3().find((p) => !voted.has(p))!;
        const got = {
          reschedule: accepted(act(who, cand, iv(1), RES({ length_minutes: 45 }), t)),
          cancel: accepted(act(who, cand, iv(1), CANCEL(), t)),
          did_not_happen: accepted(act(who, cand, iv(1), DNH(), t)),
          mark_done: accepted(act(who, cand, iv(1), DONE(), t)),
          capture_feedback: accepted(vote(who, iv(1), who === W.recruiter ? voteBody({ on_behalf_of: forOther }) : voteBody(), t)),
        };
        expect.soft(x?.can, `${label}, ${who.name}: can matches what the routes accept`).toEqual(got);
      }
    }
  });

  test('AC-11 api/openapi.yaml: the interview carries the rule 6 keys, can is five booleans, status the four values, the new routes and their refusals are described, every object closed (D-T10)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const d = doc();
    expect.soft(refName(answerSchema(d, ROUTE.read, 200)), 'the read is still InterviewList').toBe('InterviewList');
    const list = d.components?.schemas?.['InterviewList'];
    const resolve = (s: any): any => (s?.$ref ? d.components?.schemas?.[String(s.$ref).split('/').pop()!] : s);
    const item = resolve(resolve(list?.properties?.interviews)?.items);
    const props = Object.keys(item?.properties ?? {});
    for (const k of ['status', 'length_minutes', 'where', 'place', 'video_link', 'sequence', 'closed_reason', 'closed_note', 'closed_by_name', 'closed_at', 'can', 'candidate_note']) expect.soft(props, `the interview has ${k}`).toContain(k);
    const can = resolve(item?.properties?.can);
    expect.soft([sorted(Object.keys(can?.properties ?? {})), sorted(can?.required ?? []), can?.additionalProperties], 'can: the five keys, all required, closed').toEqual([CAN_KEYS, CAN_KEYS, false]);
    expect.soft(CAN_KEYS.map((k) => resolve(can?.properties?.[k])?.type), 'each a boolean').toEqual(CAN_KEYS.map(() => 'boolean'));
    const st = resolve(item?.properties?.status);
    expect.soft(sorted((st?.enum ?? []).filter((x: unknown) => x !== null)), 'status: the four values').toEqual(['CANCELLED', 'COMPLETED', 'DID_NOT_HAPPEN', 'SCHEDULED']);
    const optional = ['candidate_note', 'closed_note', 'no_feedback', 'email', 'vote', ...STEP_D_OPTIONAL];
    expect.soft(looseObjects(d, { $ref: '#/components/schemas/InterviewList' }, 'InterviewList', new Set(), optional), 'every object of InterviewList closed, every other key required').toEqual([]);
    for (const [route, codes] of [[ROUTE.book, [201, 400, 409]], [ROUTE.act, [200, 400, 409]], [ROUTE.vote, [201, 409]], [ROUTE.guestRead, [200, 410]], [ROUTE.guestVote, [200, 409, 410]]] as [string, number[]][]) {
      for (const s of codes) expect.soft(!!answerSchema(d, route, s), `${route} ${s} is described`).toBe(true);
    }
    const params = (route: string) => {
      const [m, p] = route.split(' ') as [string, string];
      const op = d.paths?.[p]?.[m.toLowerCase()];
      return [...(op?.parameters ?? []), ...(d.paths?.[p]?.parameters ?? [])].map((x: any) => resolve(x)).filter((x: any) => x?.in === 'header').map((x: any) => String(x.name).toLowerCase());
    };
    for (const route of [ROUTE.book, ROUTE.act]) expect.soft(params(route), `${route} takes the Idempotency-Key header`).toContain('idempotency-key');
  });

  // ---------------------------------------------------------------- AC-12 Who

  test('AC-12 Who: the hiring manager, a panel person and an Employee get 403 on every action; company B\'s Recruiter 404; B\'s ids under A\'s path 404; nothing is taken from the body, query, path or headers', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const t = withRows(w({ id: iv(1), cand: K.book, at: FUT }, { id: iv(2), cand: K.book, type: 'PHONE_SCREEN', at: PAST }), [interviewRow({ id: B_IV, cand: K.bee, at: FUT, company: B, panel: [P.pB] })]);
    const actions: [string, string, unknown][] = [['reschedule', iv(1), RES({ length_minutes: 45 })], ['cancel', iv(1), CANCEL()], ['did_not_happen', iv(2), DNH()], ['complete', iv(2), DONE()]];
    for (const [who, want] of [[W.hm, 403], [W.p1, 403], [W.employee, 403], [W.recruiterB, 404]] as [Caller, number][]) {
      const b = book(who, K.book, bookBody(), t);
      expect.soft(statusOf(b), `${who.name} books on A's candidate: ${want} (got ${describe(b)})`).toBe(want);
      nothing(t, b, `${who.name} books`);
      for (const [name, id, body] of actions) {
        const r = act(who, K.book, id, body, t);
        expect.soft(statusOf(r), `${who.name} ${name}: ${want} (got ${describe(r)})`).toBe(want);
        nothing(t, r, `${who.name} ${name}`);
      }
    }
    // R-8: the role check comes first: the hiring manager on B's candidate is 403, not 404.
    expect.soft(statusOf(act(W.hm, K.bee, B_IV, CANCEL(), t)), 'the hiring manager on B\'s ids: 403 (role first)').toBe(403);
    // A's Recruiter on B's candidate, on B's interview under A's candidate, and on an id that does not exist.
    for (const [label, cand, id] of [['B\'s candidate and interview', K.bee, B_IV], ['B\'s interview under A\'s candidate', K.book, B_IV], ['an interview that does not exist', K.book, iv(99)]] as [string, string, string][]) {
      const r = act(W.recruiter, cand, id, CANCEL(), t);
      expect.soft(statusOf(r), `A's Recruiter on ${label}: 404 (got ${describe(r)})`).toBe(404);
      nothing(t, r, label);
    }
    // A stray row under A's candidate that carries company B (the REC-07 AC-7 shape): every row is checked, not only the candidate.
    const stray = withRows(t, [interviewRow({ id: iv(50), cand: K.book, type: 'FINAL', at: PAST, company: B, panel: [P.pB] })]);
    for (const [name, body] of [['cancel', CANCEL()], ['did_not_happen', DNH()], ['complete', DONE()], ['reschedule', RES({ length_minutes: 45 })]] as [string, unknown][]) {
      const r = act(W.recruiter, K.book, iv(50), body, stray);
      expect.soft(statusOf(r), `A's Recruiter, ${name} on a company B row under A's candidate: 404 (got ${describe(r)})`).toBe(404);
      nothing(stray, r, `stray row ${name}`);
    }
    const bb = book(W.recruiter, K.bee, bookBody(), t);
    expect.soft(statusOf(bb), 'A\'s Recruiter books on B\'s candidate: 404').toBe(404);
    nothing(t, bb, 'A books on B');
    // B's Recruiter naming A everywhere it could: still 404, nothing written.
    const forged = call({ route: ROUTE.act, who: W.recruiterB, path: { id: K.book, interviewId: iv(1) }, body: CANCEL(), headers: { 'x-tenant-id': A, 'X-Tenant-Id': A, tenant_id: A }, query: { tenant_id: A, tenantId: A } }, t);
    expect.soft(statusOf(forged), `B with A in the headers and query: 404 (got ${describe(forged)})`).toBe(404);
    nothing(t, forged, 'forged headers');
    const forgedBody = act(W.recruiterB, K.book, iv(1), { ...CANCEL(), tenant_id: A }, t);
    expect.soft([400, 404], `B with A in the body: refused (got ${describe(forgedBody)})`).toContain(statusOf(forgedBody));
    nothing(t, forgedBody, 'forged body');
    const forgedBook = call({ route: ROUTE.book, who: W.recruiterB, path: { id: K.book }, body: bookBody(), headers: { 'x-tenant-id': A } }, t);
    expect.soft(statusOf(forgedBook), 'B books on A with A in a header: 404').toBe(404);
    nothing(t, forgedBook, 'forged booking');
    // B's Recruiter does the actions on B's own interview (a company-B caller that is allowed), and A's ids never move.
    const own = act(W.recruiterB, K.bee, B_IV, CANCEL(), t);
    ok(own, 200, 'B cancels B\'s own interview');
    oneEvent(own, 'INTERVIEW_CANCELLED', { cand: K.bee, iv: B_IV, ivType: 'TECHNICAL', actor: SUB.recB, reason: 'CANDIDATE_ASKED', company: B }, 'B\'s cancel');
    expect.soft(changed(t, own.tables).every((l) => l.includes(K.bee)), 'only B\'s rows change').toBe(true);
    // Votes: B's Recruiter on A's interview, an Employee.
    const past = w({ id: iv(3), cand: K.book, at: PAST });
    for (const [who, want] of [[W.recruiterB, 404], [W.employee, 403]] as [Caller, number][]) {
      const r = vote(who, iv(3), voteBody(), past);
      expect.soft(statusOf(r), `${who.name} votes on A's interview: ${want}`).toBe(want);
      nothing(past, r, `${who.name} votes`);
    }
  });

  // ---------------------------------------------------------------- AC-13 History

  test('AC-13 History: each action sends exactly one event with its type, actor and reason code and no free text; a refused request sends none; when the bus fails twice the action stands and the log holds only the error name and event type', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = w({ id: iv(1), cand: K.book, at: FUT, guest: token(12) }, { id: iv(2), cand: K.book, type: 'PHONE_SCREEN', at: PAST });
    const runs: [string, Run, string, string, string?][] = [
      ['booked', book(W.recruiter, K.fresh, bookBody({ candidate_note: NEVER.note, guest_email: NEVER.guestEmail }), t), 'INTERVIEW_BOOKED', K.fresh],
      ['rescheduled', act(W.recruiter, K.book, iv(1), RES({ at: zoned(H(30)), reason_note: NEVER.reasonNote }), t), 'INTERVIEW_RESCHEDULED', K.book],
      ['cancelled', act(W.recruiter, K.book, iv(1), CANCEL('OTHER', { reason_note: NEVER.reasonNote }), t), 'INTERVIEW_CANCELLED', K.book, 'OTHER'],
      ['did not happen', act(W.recruiter, K.book, iv(2), DNH('INTERVIEWER_DID_NOT_COME'), t), 'INTERVIEW_DID_NOT_HAPPEN', K.book, 'INTERVIEWER_DID_NOT_COME'],
      ['marked done', act(W.recruiter, K.book, iv(2), DONE('OTHER', { reason_note: NEVER.closedNote }), t), 'INTERVIEW_MARKED_DONE', K.book, 'OTHER'],
    ];
    for (const [label, r, type, cand, reason] of runs) {
      expect.soft([200, 201], `${label}: accepted (${describe(r)})`).toContain(statusOf(r));
      const ev = ivEvents(r);
      expect.soft(ev.map((e: any) => e.detailType), `${label}: one ${type}`).toEqual([type]);
      expect.soft(sorted(Object.keys(ev[0]?.detail ?? {})), `${label}: exactly the R-23 keys`).toEqual(sorted([...DETAIL_KEYS, ...(reason ? ['reason_code'] : [])]));
      expect.soft([ev[0]?.detail?.candidateId, ev[0]?.detail?.actor, ev[0]?.detail?.reason_code], `${label}: candidate, actor, reason`).toEqual([cand, SUB.recA, reason]);
      const text = JSON.stringify(busOf(r));
      for (const v of Object.values(NEVER)) expect.soft(text.includes(v), `${label}: no ${v} in any event`).toBe(false);
      expect.soft(leakedTokens(text, r.tables), `${label}: no token in any event`).toEqual([]);
      expect.soft(oldEvents(r).length, `${label}: no old interview event`).toBe(0);
    }
    // A refused request sends nothing.
    expect.soft(busOf(act(W.recruiter, K.book, iv(1), DNH(), t)).length, 'a refused action sends nothing').toBe(0);
    // The bus fails twice: the action stands, the answer is normal, the log names only the error and the event type.
    const fail = { service: 'events', message: FAULT_MESSAGE } as any;
    for (const [label, r, type] of [
      ['booking', book(W.recruiter, K.fresh, bookBody(), t, { fail }), 'INTERVIEW_BOOKED'],
      ['cancel', act(W.recruiter, K.book, iv(1), CANCEL(), t, { fail }), 'INTERVIEW_CANCELLED'],
    ] as [string, Run, string][]) {
      expect.soft([200, 201], `${label} with the bus down: a normal answer (${describe(r)})`).toContain(statusOf(r));
      expect.soft(ivEvents(r).map((e: any) => e.detailType), `${label}: tried twice`).toEqual([type, type]);
      const logs = logsOf(r);
      expect.soft(logs.filter((l) => l.includes('INTERVIEW_EVENT_NOT_SENT') && l.includes(type)).length, `${label}: one log line names INTERVIEW_EVENT_NOT_SENT and ${type}`).toBe(1);
      expect.soft(logs.filter((l) => l.includes(FAULT_MESSAGE)), `${label}: the error's message is not logged`).toEqual([]);
    }
    const bf = book(W.recruiter, K.fresh, bookBody(), t, { fail });
    expect.soft(ivsOf(bf.tables, K.fresh).length, 'the booking is written though the bus is down').toBe(1);
  });

  // ---------------------------------------------------------------- AC-14 Move to Offer

  test('AC-14 Move to Offer: a required type CANCELLED or DID_NOT_HAPPEN and not booked again is INTERVIEWS_INCOMPLETE; once it is COMPLETED (marked or by itself, or an old-way row marked done) the candidate moves', async ({}, testInfo) => {
    once(testInfo.project.name);
    const ps = { id: iv(9), cand: K.book, type: 'PHONE_SCREEN', at: PAST, status: 'COMPLETED' };
    for (const status of ['CANCELLED', 'DID_NOT_HAPPEN']) {
      const t = w(ps, { id: iv(1), cand: K.book, at: PAST, status });
      const r = move(W.recruiter, K.book, 'OFFER', t);
      expect.soft([statusOf(r), bodyOf(r)?.code], `TECHNICAL ${status}: refused INTERVIEWS_INCOMPLETE`).toEqual([409, 'INTERVIEWS_INCOMPLETE']);
    }
    const marked = act(W.recruiter, K.book, iv(1), DONE(), w(ps, { id: iv(1), cand: K.book, at: PAST }));
    ok(marked, 200, 'mark TECHNICAL done');
    expect.soft(statusOf(move(W.recruiter, K.book, 'OFFER', marked.tables)), 'after mark as done: moves').toBe(200);
    let t = w(ps, { id: iv(1), cand: K.book, at: PAST });
    for (const p of [W.p1, W.p2, W.p3]) t = vote(p, iv(1), voteBody(), t).tables;
    expect.soft(ivOf(t, K.book, iv(1))?.['status'], 'done by itself').toBe('COMPLETED');
    expect.soft(statusOf(move(W.recruiter, K.book, 'OFFER', t)), 'after done by itself: moves').toBe(200);
    const oldWay = act(W.recruiter, K.book, iv(1), DONE(), w(ps, { id: iv(1), cand: K.book, at: PAST, sequence: null }));
    ok(oldWay, 200, 'mark an old-way TECHNICAL done');
    expect.soft(statusOf(move(W.recruiter, K.book, 'OFFER', oldWay.tables)), 'an old-way row marked done: moves').toBe(200);
  });

  // ---------------------------------------------------------------- AC-15 Settings

  test('AC-15 Settings: default_length_minutes is accepted on a type (15 to 240, a step of 15), refused otherwise; any other new key is still refused; the Standard pack sets none', async ({}, testInfo) => {
    once(testInfo.project.name);
    const defaults = runModule([{ get: 'DEFAULTS' }]).results[0]?.value;
    const base = structuredClone(defaults?.INTERVIEW_TYPES);
    expect(Array.isArray(base?.types), 'the defaults have INTERVIEW_TYPES').toBe(true);
    const withType = (extra: Record<string, unknown>) => { const d = structuredClone(base); d.types[1] = { ...d.types[1], ...extra }; return d; };
    const cases: [string, unknown, boolean][] = [
      ['no default (today)', base, true], ['45', withType({ default_length_minutes: 45 }), true], ['15', withType({ default_length_minutes: 15 }), true], ['240', withType({ default_length_minutes: 240 }), true],
      ['10', withType({ default_length_minutes: 10 }), false], ['250', withType({ default_length_minutes: 250 }), false], ['50', withType({ default_length_minutes: 50 }), false],
      ['45.5', withType({ default_length_minutes: 45.5 }), false], ['"45" as text', withType({ default_length_minutes: '45' }), false], ['null', withType({ default_length_minutes: null }), false],
      ['another new key', withType({ colour: 'blue' }), false], ['a default and another new key', withType({ default_length_minutes: 45, colour: 'blue' }), false],
    ];
    const got = runModule(cases.map(([, d]) => ({ fn: 'validate', args: ['INTERVIEW_TYPES', d] }))).results.map((x) => x.value);
    expect.soft(got, 'validate() per case').toEqual(cases.map(([, , want]) => want));
    expect.soft(readFileSync(PACK_SEED, 'utf8').includes('default_length_minutes'), 'the Standard pack adds no default length').toBe(false);
    expect.soft(JSON.stringify(defaults?.INTERVIEW_TYPES).includes('default_length_minutes'), 'the defaults add none').toBe(false);
  });

  // ---------------------------------------------------------------- AC-16 Logs, IAM, CORS

  test('AC-16 Logs: across booking, the four actions, votes, guest reads and votes, refusals and store faults, no log line of the four Lambdas holds a token, an email, a place, a link, a note or an error message', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const G = token(13);
    const t = withRows(w({ id: iv(1), cand: K.book, at: FUT, guest: G }, { id: iv(2), cand: K.book, type: 'PHONE_SCREEN', at: PAST, guest: token(14) }), []);
    const runs: Run[] = [];
    const add = (r: Run) => { runs.push(r); return r; };
    add(book(W.recruiter, K.fresh, bookBody({ where: 'ONLINE', place: undefined, video_link: NEVER.link, candidate_note: NEVER.note, guest_email: NEVER.guestEmail }), t));
    add(book(W.recruiter, K.fresh, bookBody({ guest_email: `${NEVER.guestEmail}x@` }), t));
    add(book(W.recruiter, K.fresh, bookBody({ panel: [P.pB], candidate_note: NEVER.note }), t));
    add(act(W.recruiter, K.book, iv(1), RES({ guest_email: NEVER.guestEmail2, reason_note: NEVER.reasonNote, place: NEVER.place + ' 2' }), t));
    add(act(W.recruiter, K.book, iv(1), CANCEL('OTHER', { reason_note: NEVER.reasonNote }), t));
    add(act(W.recruiter, K.book, iv(2), DNH('OTHER', { reason_note: NEVER.reasonNote }), t));
    const done = add(act(W.recruiter, K.book, iv(2), DONE('OTHER', { reason_note: NEVER.closedNote }), t));
    add(act(W.recruiter, K.book, iv(1), DONE('OTHER', { reason_note: NEVER.closedNote }), t));
    add(vote(W.p1, iv(2), voteBody(), t));
    add(vote(W.p1, iv(1), voteBody(), t));
    add(vote(W.p1, iv(2), voteBody(), done.tables));
    add(guestRead(G, t)); add(guestVote(G, voteBody(), t)); add(guestVote(token(14), voteBody(), t)); add(guestRead(token(14), done.tables));
    add(read(W.recruiter, K.book, t)); add(scoresOf(W.recruiter, K.book, t));
    add(makeLink(W.recruiter, K.book, { interview_id: iv(1), guest_email: NEVER.guestEmail2 }, t));
    for (const table of [TABLE.state, IDEM_TABLE]) {
      add(book(W.recruiter, K.fresh, bookBody({ candidate_note: NEVER.note, guest_email: NEVER.guestEmail }), t, { failTable: table }));
      add(act(W.recruiter, K.book, iv(1), CANCEL('OTHER', { reason_note: NEVER.reasonNote }), t, { failTable: table }));
    }
    add(vote(W.p1, iv(2), voteBody(), t, { failTable: TABLE.state }));
    add(guestVote(token(14), voteBody(), t, { failTable: TABLE.state }));
    const lines = runs.flatMap((r) => logsOf(r));
    expect(lines.length, 'the runs logged something').toBeGreaterThan(0);
    const NOTE_LIKE = Object.values(NEVER);
    expect.soft(lines.filter((l) => NOTE_LIKE.some((v) => l.includes(v.split(' ')[0]!))), 'no place, link, note or email').toEqual([]);
    expect.soft(lines.filter((l) => /[^\s@"']+@[^\s@"']+\.[a-z]{2,}/i.test(l)), 'no email address').toEqual([]);
    expect.soft(lines.filter((l) => l.includes(FAULT_MESSAGE)), 'error names only, never the message').toEqual([]);
    const allLinks = runs.reduce<Tables>((acc, r) => withRows(acc, linksOf(r.tables).map((x) => av(x))), world());
    expect.soft(leakedTokens(lines.join('\n'), allLinks), 'no token').toEqual([]);
    expect.soft(lines.filter((l) => l.includes(G) || l.includes(token(14))), 'no raw token of the seeded links').toEqual([]);
  });

  test('AC-16 IAM, settings and CORS: only GetItem and PutItem on the request-key table are added to scheduleInterview; no other grant on any policy; every AWS call the four Lambdas make is held; IDEMPOTENCY_TABLE set; idempotency-key in allow_headers', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const baseline = JSON.parse(readFileSync(join(__dirname, 'support', 'int-01', 'iam-bd6d02c', 'policies.json'), 'utf8')) as Record<string, { role: string; stack: string; pairs?: string[]; squash?: string }>;
    const now = policyLines();
    const NEW = [
      /^Allow dynamodb:GetItem (arn:aws:dynamodb:[^ ]+:table\/(\$\{local\.tf_table_idempotency\}|talent-flow-idempotency-keys)|aws_dynamodb_table\.[\w]*idempotency[\w]*\.arn) null$/,
      /^Allow dynamodb:PutItem (arn:aws:dynamodb:[^ ]+:table\/(\$\{local\.tf_table_idempotency\}|talent-flow-idempotency-keys)|aws_dynamodb_table\.[\w]*idempotency[\w]*\.arn) null$/,
    ];
    const isSI = (k: string, role: string | undefined) => /schedule_interview|scheduleInterview/.test(`${k} ${role ?? ''}`);
    const gainedSI: string[] = [];
    for (const k of new Set([...Object.keys(baseline), ...Object.keys(now)])) {
      const was = new Set(baseline[k]?.pairs ?? [`squashed ${baseline[k]?.squash}`]);
      const is = new Set(now[k]?.pairs ?? (now[k] ? [`squashed ${now[k]?.squash}`] : []));
      const gained = [...is].filter((l) => !was.has(l));
      if (isSI(k, now[k]?.role ?? baseline[k]?.role)) { gainedSI.push(...gained); continue; }
      if (isRec16Role(k, now[k]?.role)) continue; // REC-16 (child lock rec-16.1): its own role, judged in rec-16.spec.ts AC-10.
      // Child lock int-01.2 (REC-06): REC-06's two manage_offers lines are its own (rec-06.spec.ts AC-9 pins them exactly), not INT-01's.
      expect.soft(gained.filter((l) => !(REC06_GRANTS[k] ?? []).some((re) => re.test(l)) && !isRec062Grant(l, k)), `${k}: no new grant`).toEqual([]);
    }
    expect.soft(gainedSI.filter((l) => !NEW.some((re) => re.test(l))), 'scheduleInterview gains only GetItem and PutItem on the request-key table (no index, no *)').toEqual([]);
    expect.soft(NEW.map((re) => gainedSI.filter((l) => re.test(l)).length), 'each once').toEqual([1, 1]);
    expect.soft(Object.keys(now).filter((k) => !baseline[k] && !isRec16Role(k, now[k]?.role) && !isRec09Policy(k, now[k]?.pairs)), 'no new policy').toEqual([]);
    // The settings and CORS.
    const si = lambdaNamed('scheduleInterview')[0];
    expect(si, 'scheduleInterview is a Lambda in Terraform').toBeTruthy();
    const env = settingsOf(si!.block);
    expect.soft(['local.tf_table_idempotency', '"talent-flow-idempotency-keys"', 'talent-flow-idempotency-keys'], 'IDEMPOTENCY_TABLE is the request-key table (R-22)').toContain(env.get('IDEMPOTENCY_TABLE'));
    const api = readFileSync(join(REPO, 'talent-flow-infra', 'talent-flow-apigateway.tf'), 'utf8');
    const allow = /allow_headers\s*=\s*\[([^\]]*)\]/.exec(api)?.[1] ?? '';
    expect.soft(allow.toLowerCase(), 'idempotency-key in the TalentFlow API\'s CORS allow_headers').toContain('idempotency-key');
    for (const stack of ['infra', 'talent-flow-infra'] as const) expect.soft(resourcesOf(stack, 'aws_dynamodb_table_item').length, `${stack}: no table item`).toBe(0);
    expect.soft(/talent_flow_state/.test(/resource\s+"aws_dynamodb_table"\s+"\w*idempotency\w*"[\s\S]*?\n\}/.exec(readTf('talent-flow-infra'))?.[0] ?? ''), 'the request-key table uses the state KMS key scheduleInterview already holds').toBe(true);
    // Every AWS call made, judged against the grants after INT-01 (the fake does not check IAM, so this list does).
    const T_ = { state: TABLE.state, config: TABLE.config, roles: 'talent-flow-roles', tenants: TENANTS, idem: IDEM_TABLE };
    const ACT: Record<string, string> = { Put: 'PutItem', Update: 'UpdateItem', Delete: 'DeleteItem', ConditionCheck: 'ConditionCheckItem' };
    type Grant = { [op: string]: (table: string, index: string | undefined) => boolean };
    const stateAny = (tb: string) => tb === T_.state;
    const MAY: Record<string, Grant> = {
      scheduleInterview: {
        GetItem: (tb, i) => !i && [T_.state, T_.config, T_.roles, T_.tenants, T_.idem].includes(tb), PutItem: (tb) => [T_.state, T_.idem].includes(tb), UpdateItem: stateAny,
        Query: (tb, i) => (tb === T_.state) || (tb === T_.config && i === 'GSI1-active-configs') || (tb === T_.tenants && !i),
      },
      submitVote: { GetItem: (tb, i) => !i && [T_.state, T_.config, T_.tenants].includes(tb), PutItem: stateAny, UpdateItem: stateAny, Query: (tb, i) => (tb === T_.state && (!i || i === 'interview-id-index')) || (tb === T_.config && i === 'GSI1-active-configs') },
      submitVoteByToken: { GetItem: (tb) => [T_.state, T_.config, T_.tenants].includes(tb), PutItem: stateAny, UpdateItem: stateAny, Query: (tb, i) => tb === T_.state || (tb === T_.config && i === 'GSI1-active-configs') },
      generateScoringLink: { GetItem: (tb) => [T_.state, T_.tenants].includes(tb), PutItem: stateAny, Query: stateAny },
    };
    const OTHER: Record<string, RegExp> = { scheduleInterview: /^(cognito AdminGetUser|events PutEvents|sqs SendMessage)$/, submitVote: /^events PutEvents$/, submitVoteByToken: /^events PutEvents$/, generateScoringLink: /^$/ };
    const notHeld = (fn: string, r: Run): string[] => {
      const out: string[] = [];
      for (const c of awsOf(r) as any[]) {
        if (c.service !== 'dynamodb') { if (!OTHER[fn]!.test(`${c.service} ${c.op}`)) out.push(`${fn}: ${c.service} ${c.op}`); continue; }
        const items: [string, string, string | undefined][] = c.op === 'TransactWriteItems'
          ? (c.input?.TransactItems ?? []).map((x: any) => { const k = Object.keys(x)[0]!; return [ACT[k] ?? k, x[k]?.TableName, undefined]; })
          : c.op === 'BatchWriteItem' ? Object.keys(c.input?.RequestItems ?? {}).map((tb) => ['BatchWriteItem', tb, undefined])
          : c.op === 'BatchGetItem' ? Object.keys(c.input?.RequestItems ?? {}).map((tb) => ['GetItem', tb, undefined])
          : [[c.op, c.table, c.input?.IndexName]];
        for (const [op, tb, i] of items) if (!MAY[fn]![op]?.(tb, i)) out.push(`${fn}: dynamodb ${op} ${tb}${i ? ' index ' + i : ''}`);
      }
      return out;
    };
    const G = token(15);
    const t = w({ id: iv(1), cand: K.book, at: FUT, guest: G }, { id: iv(2), cand: K.book, type: 'PHONE_SCREEN', at: PAST, guest: token(16) }, { id: iv(3), cand: K.book, type: 'BEHAVIORAL', at: PAST, sequence: null });
    const runs: [string, Run][] = [
      ['scheduleInterview', book(W.recruiter, K.fresh, bookBody({ guest_email: NEVER.guestEmail }), t)],
      ['scheduleInterview', act(W.recruiter, K.book, iv(1), RES({ guest_email: NEVER.guestEmail2 }), t)],
      ['scheduleInterview', act(W.recruiter, K.book, iv(1), CANCEL(), t)],
      ['scheduleInterview', act(W.recruiter, K.book, iv(2), DNH(), t)],
      ['scheduleInterview', act(W.recruiter, K.book, iv(2), DONE(), t)],
      ['scheduleInterview', act(W.recruiter, K.book, iv(3), DONE(), t)],
      ['scheduleInterview', read(W.recruiter, K.book, t)],
      ['submitVote', vote(W.p1, iv(2), voteBody(), t)],
      ['submitVote', vote(W.recruiter, iv(2), voteBody({ on_behalf_of: P.p2 }), t)],
      ['submitVote', scoresOf(W.recruiter, K.book, t)],
      ['submitVoteByToken', guestRead(token(16), t)],
      ['submitVoteByToken', guestVote(token(16), voteBody(), t)],
      ['generateScoringLink', makeLink(W.recruiter, K.book, { interview_id: iv(1), guest_email: NEVER.guestEmail2 }, t)],
    ];
    for (const [fn, r] of runs) expect.soft(notHeld(fn, r), `${fn}: every AWS call is held (${describe(r).slice(0, 120)})`).toEqual([]);
  });

  // ---------------------------------------------------------------- AC-19 and AC-20

  test('AC-19 The scores read: the full summary for a Recruiter and the decider; a panel person (and a hiring manager on the panel who does not decide) gets only their own votes; a hiring manager who does not decide 403; company B 404', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = withRows(w({ id: iv(1), cand: K.book, at: PAST, votesSubmitted: 2 }), [voteRow(K.book, iv(1), P.p1), voteRow(K.book, iv(1), P.p2, { scores: { technical: 2, communication: 5 }, rating: 'NO' })]);
    const SUMMARY = ['overall', 'split', 'pending_count'];
    for (const [label, who, tt] of [['the Recruiter', W.recruiter, t], ['the decider (hiring manager, HR_OR_HM)', W.hm, t]] as [string, Caller, Tables][]) {
      const r = fits(ROUTE.scores, scoresOf(who, K.book, tt), label);
      const x = (ok(r, 200, label)?.interviews ?? [])[0];
      expect.soft(SUMMARY.every((k) => k in (x ?? {})) && Array.isArray(x?.votes) && x?.votes.length === 2, `${label}: the summary and both votes`).toBe(true);
      expect.soft(((x?.criteria ?? []) as any[]).every((c) => 'mean' in c), `${label}: criteria means`).toBe(true);
    }
    const hrOnly = withDecider(t, 'HR_ONLY');
    const hm = scoresOf(W.hm, K.book, hrOnly);
    expect.soft(statusOf(hm), `a hiring manager who does not decide and is on no panel: 403 (got ${describe(hm)})`).toBe(403);
    const own = (label: string, who: Caller, tt: Tables, me: string) => {
      const r = fits(ROUTE.scores, scoresOf(who, K.book, tt), label);
      const b = ok(r, 200, label);
      expect.soft('final_score' in (b ?? {}), `${label}: no final score`).toBe(false);
      for (const x of (b?.interviews ?? []) as any[]) {
        expect.soft(['overall', 'split', 'pending_count', 'vote_count', 'consensus'].filter((k) => k in x), `${label}: none of the summary fields`).toEqual([]);
        expect.soft(((x?.criteria ?? []) as any[]).filter((c) => 'mean' in c).length, `${label}: no means`).toBe(0);
        expect.soft(((x?.votes ?? []) as any[]).map((v) => v.voter_id), `${label}: only their own vote`).toEqual([me]);
      }
    };
    own('a panel person', W.p1, t, P.p1);
    const hmOnPanel = withRows(hrOnly, [interviewRow({ id: iv(2), cand: K.book, type: 'PHONE_SCREEN', at: PAST, panel: [P.p3, SUB.hmA], votesSubmitted: 1 }), voteRow(K.book, iv(2), SUB.hmA)]);
    own('a hiring manager on the panel who does not decide', W.hm, hmOnPanel, SUB.hmA);
    const b = scoresOf(W.recruiterB, K.book, t);
    expect.soft(statusOf(b), 'company B: 404').toBe(404);
  });

  test('AC-20 The vote object { rating, overall, on_behalf_by_name } on a panel entry shows to the voter, a Recruiter and the decider only; a guest entry\'s email to a Recruiter only', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(17);
    const t = withRows(w([{ id: iv(1), cand: K.book, at: PAST, guest: G, votesSubmitted: 3 }, { used: H(-0.5) }]), [
      voteRow(K.book, iv(1), P.p1), voteRow(K.book, iv(1), P.p2, { onBehalfBy: REC_U, scores: { technical: 5, communication: 2 }, rating: 'STRONG_YES' }), voteRow(K.book, iv(1), guestVoter(G)),
    ]);
    const V1 = { rating: 'YES', overall: 3.5, on_behalf_by_name: null };
    const V2 = { rating: 'STRONG_YES', overall: 3.5, on_behalf_by_name: REC_U_NAME };
    for (const [label, who] of [['the Recruiter', W.recruiter], ['the decider', W.hm]] as [string, Caller][]) {
      const x = ivIn(readOk(who, K.book, t, label), iv(1));
      expect.soft([person(x, P.p1)?.vote, person(x, P.p2)?.vote, person(x, P.p3)?.vote ?? null], `${label}: p1's and p2's votes, p3 none`).toEqual([V1, V2, null]);
      const g = guests(x)[0];
      if (who === W.recruiter) expect.soft(g?.email, 'the Recruiter sees the guest email').toBe(NEVER.guestEmail);
      else expect.soft(blank(g?.email), `${label}: no guest email`).toBe(true);
    }
    const hrOnly = ivIn(readOk(W.hm, K.book, withDecider(t, 'HR_ONLY'), 'a hiring manager who does not decide'), iv(1));
    expect.soft(((hrOnly?.panel ?? []) as any[]).filter((e) => !blank(e?.vote)).length, 'a hiring manager who does not decide sees no vote').toBe(0);
    expect.soft(blank(guests(hrOnly)[0]?.email), 'nor the guest email').toBe(true);
    const p1 = ivIn(readOk(W.p1, K.book, t, 'p1'), iv(1));
    expect.soft([person(p1, P.p1)?.vote, ((p1?.panel ?? []) as any[]).length], 'p1: their own entry with their vote').toEqual([V1, 1]);
    const p3 = ivIn(readOk(W.p3, K.book, t, 'p3'), iv(1));
    expect.soft([blank(person(p3, P.p3)?.vote), JSON.stringify(p3).includes('STRONG_YES')], 'p3 has not voted: no vote, and nobody else\'s').toEqual([true, false]);
  });

  // ---------------------------------------------------------------- AC-21 Guests only when they can be told

  test('AC-21 The guest switch: OFF, missing, true and any other value refuse guest_email 409 GUEST_EMAIL_OFF (after the body checks); ON books with guest_link_hash; generateScoringLink refuses a new-way interview 409 USE_BOOKING with no token', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const v of ['OFF', undefined, true, 'on', 1]) {
      const t = withEmails(world(), v);
      const r = book(W.recruiter, K.book, bookBody({ guest_email: NEVER.guestEmail }), t);
      refused(r, 409, 'GUEST_EMAIL_OFF', undefined, `the switch ${JSON.stringify(v) ?? 'missing'}`);
      nothing(t, r, `the switch ${String(v)}`);
      const fut = withIv(t, { id: iv(1), cand: K.book, at: FUT });
      const rs = act(W.recruiter, K.book, iv(1), RES({ guest_email: NEVER.guestEmail }), fut);
      refused(rs, 409, 'GUEST_EMAIL_OFF', undefined, `reschedule adding a guest, switch ${String(v)}`);
      nothing(fut, rs, 'reschedule with the switch off');
    }
    const off = withEmails(world(), 'OFF');
    refused(book(W.recruiter, K.book, bookBody({ guest_email: NEVER.guestEmail, length_minutes: 10 }), off), 400, 'INVALID_FIELD', 'length_minutes', 'the body checks come first');
    expect.soft(statusOf(book(W.recruiter, K.book, bookBody(), off)), 'no guest: books with the switch off').toBe(201);
    const on = book(W.recruiter, K.book, bookBody({ guest_email: NEVER.guestEmail }), world());
    const b = ok(on, 201, 'the switch ON');
    expect.soft(ivOf(on.tables, K.book, String(b?.interview_id))?.['guest_link_hash'], 'the row holds guest_link_hash').toBe(linksOf(on.tables)[0]?.['token_hash']);
    refused(book(W.recruiter, K.book, bookBody({ guest_email: NEVER.guestEmail }), withPanelConfig(world(), { guestAllowed: false })), 400, 'INVALID_FIELD', 'guest_email', 'guestAllowed false comes first');
    // Company B: its switch is off; B's Recruiter can book without a guest.
    const tB = world();
    refused(book(W.recruiterB, K.bee, bookBody({ panel: [P.pB], guest_email: NEVER.guestEmail }), tB), 409, 'GUEST_EMAIL_OFF', undefined, 'company B with a guest');
    const bb = book(W.recruiterB, K.bee, bookBody({ panel: [P.pB] }), tB);
    const bbb = ok(bb, 201, 'company B books without a guest');
    expect.soft(ivOf(bb.tables, K.bee, String(bbb?.interview_id))?.['tenant_id'], 'stamped B').toBe(B);
    // The REC-07 link route.
    const nw = w({ id: iv(2), cand: K.book, at: FUT });
    const lk = makeLink(W.recruiter, K.book, { interview_id: iv(2), guest_email: NEVER.guestEmail }, nw);
    refused(lk, 409, 'USE_BOOKING', undefined, 'a link for a new-way interview');
    nothing(nw, lk, 'a link for a new-way interview');
    expect.soft(Object.keys(bodyOf(lk) ?? {}).includes('token'), 'no token').toBe(false);
    const ow = w({ id: iv(3), cand: K.book, at: FUT, sequence: null });
    const lo = makeLink(W.recruiter, K.book, { interview_id: iv(3), guest_email: NEVER.guestEmail }, ow);
    expect.soft([statusOf(lo), linksOf(lo.tables).length], `an old-way interview still gets a link as today (${describe(lo)})`).toEqual([201, 1]);
  });

  // ---------------------------------------------------------------- AC-22 Strict PATCH bodies

  test('AC-22 A PATCH with no action is 400 action; the add-panel branch is gone; every action\'s body is strict (outcome, tenant_id and fields of other actions are refused)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = w({ id: iv(1), cand: K.book, at: FUT }, { id: iv(2), cand: K.book, type: 'PHONE_SCREEN', at: PAST });
    const cases: [string, string, unknown, string][] = [
      ['no action', iv(1), {}, 'action'], ['the old add-panel body', iv(1), { panelMemberIds: [P.p3] }, 'action'], ['the old add-panel body with ad hoc members', iv(1), { adhocPanelMembers: [{ name: 'x' }] }, 'action'],
      ['an unknown action', iv(1), { action: 'add_panel' }, 'action'], ['COMPLETE in capitals', iv(2), { action: 'COMPLETE', reason: 'OTHER', reason_note: 'x' }, 'action'], ['action null', iv(1), { action: null }, 'action'],
      ['complete with outcome', iv(2), DONE('FEEDBACK_GIVEN_ANOTHER_WAY', { outcome: 'PASS' }), 'outcome'], ['cancel with tenant_id', iv(1), CANCEL('CANDIDATE_ASKED', { tenant_id: A }), 'tenant_id'],
      ['cancel with at', iv(1), CANCEL('CANDIDATE_ASKED', { at: zoned(H(30)) }), 'at'], ['reschedule with reason', iv(1), RES({ length_minutes: 45, reason: 'CANDIDATE_ASKED' }), 'reason'],
      ['reschedule with status', iv(1), RES({ length_minutes: 45, status: 'CANCELLED' }), 'status'], ['reschedule with sequence', iv(1), RES({ length_minutes: 45, sequence: 9 }), 'sequence'],
      ['did not happen with panel', iv(2), DNH('CANDIDATE_DID_NOT_COME', { panel: [P.p1] }), 'panel'], ['complete with status', iv(2), DONE('FEEDBACK_GIVEN_ANOTHER_WAY', { status: 'COMPLETED' }), 'status'],
    ];
    for (const [label, id, body, field] of cases) {
      const r = act(W.recruiter, K.book, id, body, t);
      refused(r, 400, 'INVALID_FIELD', field, label);
      nothing(t, r, label);
    }
  });

  // ---------------------------------------------------------------- AC-23 Request keys

  test('AC-23 Request keys: no, empty or long header 400; the table setting missing 500 and nothing runs; a replay of each action raises sequence once; a changed body 409 KEY_REUSED; a refused request can be sent again; a store fault on reserve writes nothing', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    // iv(1) is BEHAVIORAL so that TECHNICAL is free to book on K.book.
    const t = w({ id: iv(1), cand: K.book, type: 'BEHAVIORAL', at: FUT }, { id: iv(2), cand: K.book, type: 'PHONE_SCREEN', at: PAST });
    for (const [label, headers] of [['no header', undefined], ['an empty header', { 'Idempotency-Key': '' }], ['a 201-character header', { 'Idempotency-Key': 'k'.repeat(201) }]] as [string, Record<string, string> | undefined][]) {
      for (const [route, path, body] of [[ROUTE.book, { id: K.book }, bookBody()], [ROUTE.act, { id: K.book, interviewId: iv(1) }, CANCEL()]] as [string, Record<string, string>, unknown][]) {
        const r = call({ route, who: W.recruiter, path, body, headers }, t, { key: headers ? undefined : null });
        refused(r, 400, 'INVALID_FIELD', 'Idempotency-Key', `${route}: ${label}`);
        nothing(t, r, `${route}: ${label}`);
        expect.soft(changed(t, r.tables, true), `${route}: ${label}: no key stored either`).toEqual([]);
      }
    }
    expect.soft(statusOf(book(W.recruiter, K.book, bookBody(), t, { key: 'k'.repeat(200) })), 'a 200-character key is fine').toBe(201);
    // Role and company checks come before the key check.
    expect.soft(statusOf(book(W.hm, K.book, bookBody(), t, { key: null })), 'the hiring manager with no header: 403').toBe(403);
    // B passes the role and company checks; the header check comes before any read, so B with no header is 400, not 404.
    refused(book(W.recruiterB, K.book, bookBody(), t, { key: null }), 400, 'INVALID_FIELD', 'Idempotency-Key', 'B with no header');
    // The setting missing.
    const unset: O = { env: { IDEMPOTENCY_TABLE: undefined, IDEMPOTENCY_TABLE_NAME: undefined } };
    for (const [label, r] of [['book', book(W.recruiter, K.book, bookBody(), t, unset)], ['cancel', act(W.recruiter, K.book, iv(1), CANCEL(), t, unset)]] as [string, Run][]) {
      expect.soft(statusOf(r), `${label} with IDEMPOTENCY_TABLE unset: 500 (got ${describe(r)})`).toBe(500);
      nothing(t, r, `${label} with the setting unset`);
      expect.soft(logsOf(r).some((l) => l.includes('NO_REQUEST_KEY_TABLE')), `${label}: logs NO_REQUEST_KEY_TABLE`).toBe(true);
    }
    // A replay of each action: the first answer, sequence raised once, nothing sent again.
    for (const [label, id, body] of [['reschedule', iv(1), RES({ length_minutes: 45 })], ['cancel', iv(1), CANCEL()], ['did not happen', iv(2), DNH()], ['mark as done', iv(2), DONE()]] as [string, string, unknown][]) {
      const key = newKey();
      const r1 = act(W.recruiter, K.book, id, body, t, { key });
      const r2 = act(W.recruiter, K.book, id, body, r1.tables, { key });
      expect.soft([statusOf(r2), bodyOf(r2)], `${label}: the replay gives the first answer`).toEqual([200, bodyOf(r1)]);
      expect.soft(statusOf(r1), `${label}: the first is 200 (${describe(r1)})`).toBe(200);
      expect.soft(changed(r1.tables, r2.tables), `${label}: the replay writes nothing`).toEqual([]);
      expect.soft(ivEvents(r2).length, `${label}: the replay sends nothing`).toBe(0);
      expect.soft(ivOf(r2.tables, K.book, id)?.['sequence'], `${label}: sequence as after the first`).toBe(ivOf(r1.tables, K.book, id)?.['sequence']);
    }
    // The same key with a changed body.
    const k1 = newKey();
    const first = book(W.recruiter, K.book, bookBody(), t, { key: k1 });
    ok(first, 201, 'the first booking');
    const reused = book(W.recruiter, K.book, bookBody({ length_minutes: 90 }), first.tables, { key: k1 });
    refused(reused, 409, 'KEY_REUSED', undefined, 'the same key with a changed body');
    nothing(first.tables, reused, 'KEY_REUSED');
    // The same key on another route, another candidate, another caller: judged on its own (D-T4).
    const newIv = String(bodyOf(first)?.interview_id);
    const other = act(W.recruiter, K.book, newIv, CANCEL(), first.tables, { key: k1 });
    expect.soft([statusOf(other), ivOf(other.tables, K.book, newIv)?.['status']], 'the same key on the PATCH route: the cancel itself runs').toEqual([200, 'CANCELLED']);
    const otherCand = book(W.recruiter, K.fresh, bookBody(), first.tables, { key: k1 });
    expect.soft([statusOf(otherCand), ivsOf(otherCand.tables, K.fresh).length], 'the same key on another candidate: its own booking').toEqual([201, 1]);
    const otherCaller = book(W.recU, K.book, bookBody(), first.tables, { key: k1 });
    refused(otherCaller, 409, 'TYPE_ALREADY_BOOKED', undefined, 'the same key from another Recruiter: judged on its own, not a replay');
    // A refused request, fixed, with the same key goes through; so does one refused 409.
    const k2 = newKey();
    const bad = book(W.recruiter, K.book, bookBody({ length_minutes: 10 }), t, { key: k2 });
    refused(bad, 400, 'INVALID_FIELD', 'length_minutes', 'the first try');
    expect.soft(statusOf(book(W.recruiter, K.book, bookBody(), bad.tables, { key: k2 })), 'fixed, the same key: 201').toBe(201);
    // A store fault on the reserve: 500, nothing runs.
    const sf = book(W.recruiter, K.book, bookBody(), t, { failTable: IDEM_TABLE });
    expect.soft(statusOf(sf), `a store fault on the request-key table: 500 (got ${describe(sf)})`).toBe(500);
    nothing(t, sf, 'a store fault on reserve');
    expect.soft(awsOf(sf).filter((c: any) => c.table === TABLE.state && /Put|Update|Transact/.test(c.op)).length, 'no state write was even tried').toBe(0);
  });

  test('AC-23 Two at once: the same key while the first is still running is 409 KEY_IN_USE; two same-type bookings at once give one 201 and one 409 and one interview', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const key = newKey();
    const same: Req = { route: ROUTE.book, who: W.recruiter, path: { id: K.book }, body: bookBody(), headers: { 'Idempotency-Key': key } };
    const r = book(W.recruiter, K.book, bookBody(), t, { key, race: { when: 'after', match: key, table: IDEM_TABLE, second: same } });
    const s = secondOf(r);
    expect.soft(statusOf(r), `the first: 201 (${describe(r)})`).toBe(201);
    refused(s as Run, 409, 'KEY_IN_USE', undefined, 'the same key while the first runs');
    expect.soft(ivsOf(r.tables, K.book).length, 'one interview').toBe(1);
    for (const when of ['before', 'after'] as const) {
      const other: Req = { route: ROUTE.book, who: W.recU, path: { id: K.book }, body: bookBody({ at: zoned(H(50)) }) };
      const x = book(W.recruiter, K.book, bookBody(), t, { race: { when, match: '"TECHNICAL"', table: TABLE.state, second: other } });
      const y = secondOf(x);
      expect.soft(sorted([statusOf(x), statusOf(y)]), `${when}: one 201 and one 409 (${describe(x)} / ${describe(y)})`).toEqual([201, 409]);
      const loser = statusOf(x) === 409 ? x : y;
      expect.soft(bodyOf(loser)?.code, `${when}: the loser is TYPE_ALREADY_BOOKED`).toBe('TYPE_ALREADY_BOOKED');
      expect.soft(ivsOf(x.tables, K.book).filter((v) => v['interviewType'] === 'TECHNICAL').length, `${when}: one TECHNICAL`).toBe(1);
      expect.soft(ivEvents(x).map((e: any) => e.detailType), `${when}: one INTERVIEW_BOOKED`).toEqual(['INTERVIEW_BOOKED']);
    }
  });

  // ---------------------------------------------------------------- AC-25 Old routes

  test('AC-25 The old vote routes refuse an interview booked the new way (signed-in 409 USE_NEW_ROUTE, the bus event skipped, the old guest route the expired answer), writing nothing; an old-way interview still behaves as today', async ({}, testInfo) => {
    once(testInfo.project.name);
    const LEGACY = 'int01LegacyLinkTokenAAAAAAAAAAAAAAA';
    const legacy = (ivId: string) => av({ PK: `SCORING_LINK#${LEGACY}`, SK: 'META', token: LEGACY, candidateId: K.book, tenant_id: A, panelMemberId: P.p2, interviewId: ivId, used: false, createdAt: H(-30), ttl: 4102444800 });
    const oldBody = (ivId: string) => ({ interviewId: ivId, rating: 'YES', scores: oldScores });
    const busEvent = (ivId: string) => ({ source: 'talentflow', 'detail-type': 'VoteSubmitted', detail: { tenant_id: A, candidateId: K.book, voterId: P.p1, interviewId: ivId, rating: 'YES', scores: oldScores } });
    // New way.
    const nw = withRows(w({ id: iv(1), cand: K.book, at: PAST }), [legacy(iv(1))]);
    const a = oldVote(W.p1, K.book, oldBody(iv(1)), nw);
    expect.soft([statusOf(a), bodyOf(a)], `(a) the old signed-in route: 409 USE_NEW_ROUTE (got ${describe(a)})`).toEqual([409, { error: 'Conflict', code: 'USE_NEW_ROUTE' }]);
    nothing(nw, a, '(a)');
    const b = invoke('submitVote', busEvent(iv(1)), nw);
    expect.soft([statusOf(b), bodyOf(b)], `(b) the VoteSubmitted event: 200 { skipped: true } (got ${describe(b)})`).toEqual([200, { skipped: true }]);
    nothing(nw, b, '(b)');
    expect.soft(logsOf(b).some((l) => l.includes('USE_NEW_ROUTE')), '(b) logs USE_NEW_ROUTE').toBe(true);
    const c = oldGuestVote(LEGACY, { rating: 'YES', scores: oldScores }, nw);
    expect.soft([statusOf(c), bodyOf(c)], `(c) the old guest route: the single expired answer (got ${describe(c)})`).toEqual([410, EXPIRED]);
    nothing(nw, c, '(c)');
    // Old way: as today.
    const ow = withRows(w({ id: iv(2), cand: K.book, at: PAST, sequence: null }), [legacy(iv(2))]);
    const a2 = oldVote(W.p1, K.book, oldBody(iv(2)), ow);
    expect.soft([(statusOf(a2) ?? 0) < 300, votesOf(a2.tables, K.book, iv(2)).length], `(a) old way: the vote is stored as today (${describe(a2)})`).toEqual([true, 1]);
    const b2 = invoke('submitVote', busEvent(iv(2)), ow);
    expect.soft(votesOf(b2.tables, K.book, iv(2)).length, `(b) old way: the event stores the vote as today (${describe(b2)})`).toBe(1);
    const c2 = oldGuestVote(LEGACY, { rating: 'YES', scores: oldScores }, ow);
    // Today's old guest route stores no interviewId on the vote row, so the new row is counted on the candidate.
    expect.soft([(statusOf(c2) ?? 0) < 300, votesOf(c2.tables, K.book).length - votesOf(ow, K.book).length], `(c) old way: the old guest route stores the vote as today (${describe(c2)})`).toEqual([true, 1]);
  });

  // ---------------------------------------------------------------- AC-26 No sign-in

  test('AC-26 No sign-in: a POST event shaped like InterviewScheduled and a PATCH-shaped invoke, for company A and for company B, make no AWS call, write nothing, send nothing and log only NO_SIGN_IN', async ({}, testInfo) => {
    once(testInfo.project.name);
    for (const [company, cand] of [[A, K.book], [B, K.bee]] as [string, string][]) {
      const t = withIv(world(), { id: iv(1), cand, at: FUT, company, panel: company === A ? PANEL3() : [P.pB] });
      const post = { source: 'talent-flow.workflow', 'detail-type': 'InterviewScheduled', detail: { tenant_id: company, candidateId: cand, interviewId: iv(2), interviewType: 'PHONE_SCREEN', scheduledAt: H(48), panelMemberIds: [P.p1] } };
      const patch = apiEvent({ route: ROUTE.act, who: undefined, path: { id: cand, interviewId: iv(1) }, body: { ...CANCEL(), tenant_id: company }, headers: { 'Idempotency-Key': newKey() } });
      delete patch.requestContext;
      for (const [label, ev] of [['the InterviewScheduled event', post], ['a PATCH with no requestContext', patch], ['a bare old body', { tenant_id: company, candidateId: cand, interviewId: iv(3), interviewType: 'TECHNICAL', scheduledAt: H(48), panelMemberIds: [P.p1] }]] as [string, unknown][]) {
        const r = invoke(HANDLER[ROUTE.book]!, ev, t);
        const where = `${label}, company ${company === A ? 'A' : 'B'}`;
        expect.soft([statusOf(r), bodyOf(r)], `${where}: 200 { skipped: true } (got ${describe(r)})`).toEqual([200, { skipped: true }]);
        expect.soft(awsOf(r).map((c: any) => `${c.service} ${c.op}`), `${where}: no AWS call`).toEqual([]);
        nothing(t, r, where);
        const logs = logsOf(r);
        expect.soft(logs.length > 0 && logs.every((l) => l.includes('NO_SIGN_IN')), `${where}: logs only NO_SIGN_IN (got ${JSON.stringify(logs).slice(0, 200)})`).toBe(true);
      }
    }
  });

  // ---------------------------------------------------------------- AC-27 Races

  test('AC-27 (a) cancel and reschedule at once: one 200 and one 409, the link matches the winner only, one event', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(18);
    const t = w({ id: iv(1), cand: K.book, at: FUT, guest: G });
    const resReq: Req = { route: ROUTE.act, who: W.recU, path: { id: K.book, interviewId: iv(1) }, body: RES({ at: zoned(H(72)) }) };
    const canReq: Req = { route: ROUTE.act, who: W.recU, path: { id: K.book, interviewId: iv(1) }, body: CANCEL() };
    // The reschedule lands between the cancel's read and its write: the reschedule wins.
    const x = act(W.recruiter, K.book, iv(1), CANCEL(), t, { race: { when: 'before', match: `INTERVIEW#${iv(1)}`, table: TABLE.state, second: resReq } });
    const xs = secondOf(x);
    expect.soft([statusOf(x), statusOf(xs)], `the cancel 409, the reschedule 200 (${describe(x)} / ${describe(xs)})`).toEqual([409, 200]);
    const xr = ivOf(x.tables, K.book, iv(1));
    expect.soft([xr?.['status'], xr?.['scheduledAt'], xr?.['sequence'], linkOf(x.tables, G)?.['expires_at']], 'SCHEDULED at the new time, sequence 2, the link at the new time + 7 days').toEqual(['SCHEDULED', H(72), 2, plusDays(H(72), 7)]);
    expect.soft(ivEvents(x).map((e: any) => e.detailType), 'one event, the reschedule\'s').toEqual(['INTERVIEW_RESCHEDULED']);
    // The cancel lands between the reschedule's read and its write: the cancel wins.
    const y = act(W.recruiter, K.book, iv(1), RES({ at: zoned(H(72)) }), t, { race: { when: 'before', match: `INTERVIEW#${iv(1)}`, table: TABLE.state, second: canReq } });
    const ys = secondOf(y);
    expect.soft([statusOf(y), statusOf(ys)], `the reschedule 409, the cancel 200 (${describe(y)} / ${describe(ys)})`).toEqual([409, 200]);
    const yr = ivOf(y.tables, K.book, iv(1));
    expect.soft([yr?.['status'], yr?.['scheduledAt'], linkOf(y.tables, G)?.['expires_at']], 'CANCELLED at the old time, the link stopped now').toEqual(['CANCELLED', FUT, NOW]);
    expect.soft(ivEvents(y).map((e: any) => e.detailType), 'one event, the cancel\'s').toEqual(['INTERVIEW_CANCELLED']);
  });

  test('AC-27 (b1) a vote and did-not-happen at once, (b2) a vote and mark as done at once: never both against each other\'s rule, never a voter marked no_feedback', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = w({ id: iv(1), cand: K.book, at: PAST, guest: token(19) });
    const voteReq: Req = { route: ROUTE.vote, who: W.p1, path: { id: iv(1) }, body: voteBody() };
    const actReq = (body: unknown): Req => ({ route: ROUTE.act, who: W.recU, path: { id: K.book, interviewId: iv(1) }, body });
    // (b1) did-not-happen lands between the vote's read and its write: did-not-happen won, the vote is 409 NOT_ALLOWED_NOW, nothing of it written.
    const a = vote(W.p1, iv(1), voteBody(), t, { race: { when: 'before', match: `VOTE#${P.p1}`, second: actReq(DNH()) } });
    refused(a, 409, 'NOT_ALLOWED_NOW', undefined, '(b1) the vote after did-not-happen won');
    expect.soft([statusOf(secondOf(a)), ivOf(a.tables, K.book, iv(1))?.['status'], votesOf(a.tables, K.book, iv(1)).length, guardsOf(a.tables, K.book).length], '(b1) DID_NOT_HAPPEN, no vote, no guard row').toEqual([200, 'DID_NOT_HAPPEN', 0, 0]);
    // (b1) the vote lands between did-not-happen's read and its write: the vote is in, did-not-happen is 409 NOT_ALLOWED_NOW.
    const b = act(W.recruiter, K.book, iv(1), DNH(), t, { race: { when: 'before', match: `INTERVIEW#${iv(1)}`, table: TABLE.state, second: voteReq } });
    refused(b, 409, 'NOT_ALLOWED_NOW', undefined, '(b1) did-not-happen after the vote won');
    expect.soft([statusOf(secondOf(b)), ivOf(b.tables, K.book, iv(1))?.['status'], votesOf(b.tables, K.book, iv(1)).length, ivEvents(b).length], '(b1) SCHEDULED, the vote kept, no event').toEqual([201, 'SCHEDULED', 1, 0]);
    // (b2) mark as done lands between the vote's read and its write: the vote is 409 ALREADY_DONE with nothing written.
    const c = vote(W.p1, iv(1), voteBody(), t, { race: { when: 'before', match: `VOTE#${P.p1}`, second: actReq(DONE()) } });
    refused(c, 409, 'ALREADY_DONE', undefined, '(b2) the vote after mark as done won');
    expect.soft([statusOf(secondOf(c)), ivOf(c.tables, K.book, iv(1))?.['status'], votesOf(c.tables, K.book, iv(1)).length, guardsOf(c.tables, K.book).length], '(b2) COMPLETED, no vote, no guard row').toEqual([200, 'COMPLETED', 0, 0]);
    expect.soft(person(ivIn(readOk(W.recruiter, K.book, c.tables, 'read'), iv(1)), P.p1)?.no_feedback, '(b2) p1 gave nothing: no_feedback').toBe(true);
    // (b2) the vote lands between mark as done's read and its write (D-T13).
    const d = act(W.recruiter, K.book, iv(1), DONE(), t, { race: { when: 'before', match: `INTERVIEW#${iv(1)}`, table: TABLE.state, second: voteReq } });
    expect.soft(statusOf(secondOf(d)), '(b2) the vote is accepted').toBe(201);
    expect.soft(votesOf(d.tables, K.book, iv(1)).length, '(b2) the vote stands').toBe(1);
    const dr = ivOf(d.tables, K.book, iv(1));
    if (statusOf(d) === 200) {
      expect.soft(dr?.['status'], '(b2) both stand: COMPLETED').toBe('COMPLETED');
      expect.soft(person(ivIn(readOk(W.recruiter, K.book, d.tables, 'read'), iv(1)), P.p1)?.no_feedback === true, '(b2) the voter is never no_feedback').toBe(false);
    } else {
      refused(d, 409, 'NOT_ALLOWED_NOW', undefined, '(b2) mark as done refused by R-16/R-17');
      expect.soft([dr?.['status'], ivEvents(d).length], '(b2) still SCHEDULED, no event').toEqual(['SCHEDULED', 0]);
    }
  });

  test('AC-27 (c) a reschedule judged before a vote and written after it is 409 HAS_FEEDBACK with nothing changed; (e) an old-way row with old votes can be marked done and then has sequence 1', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = w({ id: iv(1), cand: K.book, at: PAST });
    const voteReq: Req = { route: ROUTE.vote, who: W.p1, path: { id: iv(1) }, body: voteBody() };
    const r = act(W.recruiter, K.book, iv(1), RES({ at: zoned(H(24)) }), t, { race: { when: 'before', match: `INTERVIEW#${iv(1)}`, table: TABLE.state, second: voteReq } });
    refused(r, 409, 'HAS_FEEDBACK', undefined, '(c) the reschedule after the vote');
    const s = split(r);
    expect.soft(statusOf(secondOf(r)), '(c) the vote is in').toBe(201);
    const row = ivOf(r.tables, K.book, iv(1));
    expect.soft([row?.['scheduledAt'], row?.['sequence'], row?.['votesSubmitted']], '(c) the time and sequence unchanged; the vote counted').toEqual([PAST, 1, 1]);
    expect.soft(busOf({ calls: s.own }).length, '(c) the reschedule sent nothing').toBe(0);
    // (e)
    const old = withRows(w({ id: iv(2), cand: K.book, at: PAST, sequence: null, votesSubmitted: 2 }), [oldVoteRow(K.book, iv(2), P.p1), oldVoteRow(K.book, iv(2), P.p2)]);
    const e = act(W.recruiter, K.book, iv(2), DONE(), old);
    ok(e, 200, '(e) mark an old-way row done');
    expect.soft([ivOf(e.tables, K.book, iv(2))?.['status'], ivOf(e.tables, K.book, iv(2))?.['sequence']], '(e) COMPLETED, sequence 1').toEqual(['COMPLETED', 1]);
    const after = oldVote(W.p3, K.book, { interviewId: iv(2), rating: 'YES', scores: oldScores }, e.tables);
    expect.soft(statusOf(after), '(e) now booked the new way: the old route refuses').toBe(409);
    const oc = act(W.recruiter, K.book, iv(3), CANCEL(), w({ id: iv(3), cand: K.book, at: FUT, sequence: null }));
    ok(oc, 200, '(e) cancel an old-way row');
    expect.soft(ivOf(oc.tables, K.book, iv(3))?.['sequence'], '(e) sequence 1 after the cancel').toBe(1);
  });

  test('AC-27 (f) did-not-happen and mark as done at once, both orders: one 200 and one 409 NOT_ALLOWED_NOW, the row is the winner\'s, one event (R-16)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(21);
    const t = w({ id: iv(1), cand: K.book, at: PAST, guest: G });
    const dnh = DNH('INTERVIEWER_DID_NOT_COME');
    const done = DONE('PANEL_MEMBER_CANNOT_GIVE_FEEDBACK');
    const actReq = (body: unknown): Req => ({ route: ROUTE.act, who: W.recU, path: { id: K.book, interviewId: iv(1) }, body });
    // Did-not-happen lands between mark as done's read and its write: did-not-happen wins.
    const x = act(W.recruiter, K.book, iv(1), done, t, { race: { when: 'before', match: `INTERVIEW#${iv(1)}`, table: TABLE.state, second: actReq(dnh) } });
    const xs = secondOf(x);
    expect.soft(statusOf(xs), `(f) did-not-happen 200 (${describe(xs)})`).toBe(200);
    refused(x, 409, 'NOT_ALLOWED_NOW', undefined, '(f) mark as done after did-not-happen won');
    const xr = ivOf(x.tables, K.book, iv(1));
    expect.soft([xr?.['status'], xr?.['closed_reason']], '(f) DID_NOT_HAPPEN with did-not-happen\'s reason').toEqual(['DID_NOT_HAPPEN', 'INTERVIEWER_DID_NOT_COME']);
    expect.soft(ivEvents(x).map((e: any) => e.detailType), '(f) one event, did-not-happen\'s').toEqual(['INTERVIEW_DID_NOT_HAPPEN']);
    // Mark as done lands between did-not-happen's read and its write: mark as done wins.
    const y = act(W.recruiter, K.book, iv(1), dnh, t, { race: { when: 'before', match: `INTERVIEW#${iv(1)}`, table: TABLE.state, second: actReq(done) } });
    const ys = secondOf(y);
    expect.soft(statusOf(ys), `(f) mark as done 200 (${describe(ys)})`).toBe(200);
    refused(y, 409, 'NOT_ALLOWED_NOW', undefined, '(f) did-not-happen after mark as done won');
    const yr = ivOf(y.tables, K.book, iv(1));
    expect.soft([yr?.['status'], yr?.['closed_reason']], '(f) COMPLETED with mark as done\'s reason').toEqual(['COMPLETED', 'PANEL_MEMBER_CANNOT_GIVE_FEEDBACK']);
    expect.soft(ivEvents(y).map((e: any) => e.detailType), '(f) one event, mark as done\'s').toEqual(['INTERVIEW_MARKED_DONE']);
  });

  test('AC-27 (d) the same vote sent twice at once leaves one vote and votesSubmitted 1 (panel person and guest) — a guard, green on develop', async ({}, testInfo) => {
    once(testInfo.project.name);
    const G = token(20);
    const t = w({ id: iv(1), cand: K.book, at: PAST, guest: G });
    const r = vote(W.p1, iv(1), voteBody(), t, { race: { when: 'before', match: `VOTE#${P.p1}`, second: { route: ROUTE.vote, who: W.p1, path: { id: iv(1) }, body: voteBody() } } });
    expect.soft(sorted([statusOf(r), statusOf(secondOf(r))]), 'one 201, one 409').toEqual([201, 409]);
    expect.soft(bodyOf(statusOf(r) === 409 ? r : secondOf(r))?.code, 'ALREADY_SCORED').toBe('ALREADY_SCORED');
    expect.soft([votesOf(r.tables, K.book, iv(1)).filter((v) => v['voterId'] === P.p1).length, ivOf(r.tables, K.book, iv(1))?.['votesSubmitted']], 'one vote, counted once').toEqual([1, 1]);
    const g = guestVote(G, voteBody(), t, { race: { when: 'before', match: guestVoter(G), second: { route: ROUTE.guestVote, path: { token: G }, body: voteBody() } } });
    expect.soft(sorted([statusOf(g), statusOf(secondOf(g))]), 'the guest: one 200, one 410').toEqual([200, 410]);
    expect.soft([votesOf(g.tables, K.book, iv(1)).filter((v) => v['voterId'] === guestVoter(G)).length, ivOf(g.tables, K.book, iv(1))?.['votesSubmitted']], 'the guest: one vote, counted once').toEqual([1, 1]);
  });

  // ---------------------------------------------------------------- AC-18 on pepla-dev

  const devIds = () => JSON.parse(readFileSync(join(__dirname, 'support', 'int-01', 'dev-ids.json'), 'utf8')) as Record<string, string>;
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
    const api = async (who: string | undefined, method: string, path: string, body?: unknown, key?: string) => {
      const r = await page.request.fetch(`${tfApi}${path}`, {
        method, headers: { ...(who ? { Authorization: `Bearer ${tokens[who]}` } : {}), 'content-type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, ...(body === undefined ? {} : { data: JSON.stringify(body) }),
      });
      const text = await r.text();
      let json: any;
      try { json = JSON.parse(text); } catch { json = undefined; }
      return { status: r.status() as number, text, json };
    };
    return api;
  }

  test('AC-18 on pepla-dev: HR books PHONE_SCREEN and TECHNICAL at once, reschedules one, cancels the other, books TECHNICAL again; a panel login cannot vote before the start; the seeded past interview is done when the guest votes @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1 to AC-27.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(6 * 60_000);
    const ids = devIds();
    const api = await devApi(page, ['E2E_HR', 'E2E_EMP', 'E2E_IT']);
    const cand = encodeURIComponent(ids['candidate']!);
    const key = () => `int01-dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const first = await api('E2E_HR', 'GET', `/v1/candidates/${cand}/interviews`);
    expect(first.status, `HR reads the seeded candidate (${first.text.slice(0, 200)})`).toBe(200);
    const past = ((first.json?.interviews ?? []) as any[]).find((x) => x.id === ids['pastInterview']);
    expect(past, 'the seeded past interview is there').toBeTruthy();
    const panel = ((past?.panel ?? []) as any[]).filter((e) => e.kind === 'PERSON').map((e) => e.person_id as string);
    expect(panel.length, 'it has two panel logins').toBe(2);
    const at = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const body = (type: string) => ({ type, at: at(3), length_minutes: 60, where: 'ONLINE', video_link: 'https://meet.example.test/int-01-dev', panel });
    const ps = await api('E2E_HR', 'POST', `/v1/candidates/${cand}/interviews`, body('PHONE_SCREEN'), key());
    const te = await api('E2E_HR', 'POST', `/v1/candidates/${cand}/interviews`, body('TECHNICAL'), key());
    expect([ps.status, te.status], `both book (${ps.text} / ${te.text})`).toEqual([201, 201]);
    const rs = await api('E2E_HR', 'PATCH', `/v1/candidates/${cand}/interviews/${ps.json.interview_id}`, { action: 'reschedule', at: at(4) }, key());
    expect([rs.status, rs.text.slice(0, 200)], 'PHONE_SCREEN is rescheduled').toEqual([200, rs.text.slice(0, 200)]);
    const cn = await api('E2E_HR', 'PATCH', `/v1/candidates/${cand}/interviews/${te.json.interview_id}`, { action: 'cancel', reason: 'PANEL_NOT_AVAILABLE' }, key());
    expect(cn.status, `TECHNICAL is cancelled (${cn.text.slice(0, 200)})`).toBe(200);
    const again = await api('E2E_HR', 'POST', `/v1/candidates/${cand}/interviews`, body('TECHNICAL'), key());
    expect(again.status, `TECHNICAL books again (${again.text.slice(0, 200)})`).toBe(201);
    const early = await api('E2E_EMP', 'POST', `/v1/interviews/${encodeURIComponent(ids['futureInterview']!)}/votes`, { scores: {}, rating: 'YES' });
    const futureRead = ((first.json?.interviews ?? []) as any[]).find((x) => x.id === ids['futureInterview']);
    const keys = ((futureRead?.criteria_snapshot ?? past?.criteria_snapshot ?? []) as any[]).map((c) => c.key) as string[];
    const scores = (v: number) => Object.fromEntries(keys.map((k) => [k, v]));
    const early2 = await api('E2E_EMP', 'POST', `/v1/interviews/${encodeURIComponent(ids['futureInterview']!)}/votes`, { scores: scores(4), rating: 'YES' });
    expect([early2.status, early2.json?.code], `a panel login before the start: 409 NOT_STARTED (${early2.text.slice(0, 200)}; first try ${early.status})`).toEqual([409, 'NOT_STARTED']);
    for (const who of ['E2E_EMP', 'E2E_IT']) {
      const v = await api(who, 'POST', `/v1/interviews/${encodeURIComponent(ids['pastInterview']!)}/votes`, { scores: scores(4), rating: 'YES' });
      expect([200, 201], `${who} scores the past interview (${v.text.slice(0, 200)})`).toContain(v.status);
    }
    const mid = await api('E2E_HR', 'GET', `/v1/candidates/${cand}/interviews`);
    expect(((mid.json?.interviews ?? []) as any[]).find((x) => x.id === ids['pastInterview'])?.status, 'both panel votes in, the guest not yet: SCHEDULED').toBe('SCHEDULED');
    const g = await api(undefined, 'POST', `/v1/scoring-links/${encodeURIComponent(ids['guestToken']!)}`, { scores: scores(3), rating: 'NO' });
    expect(g.status, `the guest scores (${g.text.slice(0, 200)})`).toBe(200);
    const end = await api('E2E_HR', 'GET', `/v1/candidates/${cand}/interviews`);
    expect(((end.json?.interviews ?? []) as any[]).find((x) => x.id === ids['pastInterview'])?.status, 'the guest\'s vote makes it done').toBe('COMPLETED');
  });

  test('AC-18 on pepla-dev: company B\'s HR login gets 404 on A\'s interview, for the read and every action @pepla-dev', async ({ page }, testInfo) => {
    // Runs in the dev workflow's "Company walk (TEN-04)" step, where E2E_HR_B is the walk company with Recruitment on (as rec-15d AC-17).
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-12.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(3 * 60_000);
    const ids = devIds();
    const api = await devApi(page, ['E2E_HR_B']);
    const cand = encodeURIComponent(ids['candidate']!);
    expect((await api('E2E_HR_B', 'GET', `/v1/candidates/${cand}/interviews`)).status, 'the read: 404').toBe(404);
    for (const body of [{ action: 'cancel', reason: 'CANDIDATE_ASKED' }, { action: 'complete', reason: 'FEEDBACK_GIVEN_ANOTHER_WAY' }, { action: 'reschedule', length_minutes: 45 }]) {
      const r = await api('E2E_HR_B', 'PATCH', `/v1/candidates/${cand}/interviews/${encodeURIComponent(ids['futureInterview']!)}`, body, `int01-dev-b-${Date.now()}-${body.action}`);
      expect.soft(r.status, `${body.action}: 404`).toBe(404);
    }
    const b = await api('E2E_HR_B', 'POST', `/v1/candidates/${cand}/interviews`, { type: 'FINAL', at: new Date(Date.now() + 3 * 86_400_000).toISOString(), length_minutes: 60, where: 'IN_PERSON', place: 'Room', panel: ['x'] }, `int01-dev-b-${Date.now()}`);
    expect.soft(b.status, 'booking: 404').toBe(404);
  });

  test('AC-18 seed: seed-dev.py writes the INT-01 dev candidate with a past interview (two panel logins, a guest link in the R-21 format) and a future one, under the ids in support/int-01/dev-ids.json; the REC-07 seed interview starts in the past', async ({}, testInfo) => {
    once(testInfo.project.name);
    const ids = existsSync(join(__dirname, 'support', 'int-01', 'dev-ids.json')) ? devIds() : {};
    const seed = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    expect.soft(/def seed_int01\(/.test(seed) && /seed_int01\(\s*ddb\s*,/.test(seed), 'seed_int01 is defined and called from main()').toBe(true);
    // As seed_rec07 does, the seed may read the ids from dev-ids.json instead of writing them out.
    const readsIds = /support["'\s/,]*int-01["'\s/,]*dev-ids\.json/.test(seed);
    for (const k of ['candidate', 'pastInterview', 'futureInterview', 'guestToken']) expect.soft(!!ids[k] && (readsIds || seed.includes(ids[k]!)), `the seed writes ${k}`).toBe(true);
    for (const f of ['guest_link_hash', 'sequence', 'length_minutes', 'booked_by', 'token_hash']) expect.soft(seed.includes(f), `the seed writes ${f}`).toBe(true);
    const rec07 = /def seed_rec07\([\s\S]*?(?=\ndef )/.exec(seed)?.[0] ?? '';
    const when = /scheduledAt['"]?\s*[:=]\s*['"]([^'"]+)['"]/.exec(rec07)?.[1];
    expect.soft(when === undefined || Date.parse(when) < Date.parse('2026-11-26T00:00:00Z'), `the REC-07 dev interview starts in the past (rule 14; got ${when ?? 'a computed time'})`).toBe(true);
  });
});
