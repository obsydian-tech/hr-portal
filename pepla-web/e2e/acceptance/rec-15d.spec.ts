import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO } from './support/rec-14/lambda-harness';
import { answerSchema, checker, looseObjects, operation, readDoc, refName, type Doc } from './support/rec-14/schema';
import { kmsList, lambdaNamed, policyLines, resourcesOf, roleResourceOf, settingsOf } from './support/rec-04/iam';
import { C } from './support/rec-04/callers';
import { bodyOf, describe, statusOf, type Caller } from './support/rec-04/world';
import { changedRows } from './support/rec-04/roles';
import { recordRun, withCandidate, withNewVersion } from './support/rec-15c/world';
import { REC15D_GRANTS } from './support/rec-15d.1/grants';
/** Child lock rec-15d.2 (REC-06): grants later cards add to policies step D does not own, each matched exactly. */
const LATER_CARD_GRANTS: Record<string, RegExp[]> = {
  'talent-flow-infra/manage_offers': [
    /^Allow dynamodb:PutItem arn:aws:dynamodb:af-south-1:000000000000:table\/employees null$/,
    /^Allow dynamodb:Query arn:aws:dynamodb:af-south-1:000000000000:table\/employees\/index\/email-index null$/,
  ],
};
import {
  A, ALL_NAMES, AT, B, BEMAIL, D, GUEST, GUEST_VOTER, IV, MANY, NAME, NEVER, NOW, P, PC, POOL_OTHER, Q, SUB, TABLE, TENANTS, awsOf, eventsRun,
  interviewsRun, logsOf, membersRead, poolAsked, rowsOf, withFeedbackHours, withInterview, world, EVENTS, INTERVIEWS, type Opts, type Run, type Tables,
} from './support/rec-15d/world';
import { isInt01Grant } from './support/int-01.1/grants'; // child lock int-01.1
// The fault preload (support/rec-15d/faults.mjs) throws with this exact message; it is kept in step with that file.
const FAULT_MESSAGE = 'zz-rec15d-fault-message';

/**
 * REC-15 step D · Interviews read with names, and history names (red). Jira NH-279. Spec:
 * /mnt/project-files/onboarding-cards/specs/REC-15.md, Part 4 (rules 24 to 28), AC-14, AC-15, the rest of AC-16 and step D's lines of
 * AC-17, decision D-REC-15.10, with the spec check's fixes (onboarding-cards/specs/REC-15D-spec-check.md: D-1 to D-14, round 2 R2-1 to
 * R2-5) and step C's note N-2. Notes: cards/rec-15d.md. Review page: onboarding-cards/specs/REC-15D-tests-for-review.md (the bar).
 *
 * The tests run the real handlers (lambda/scheduleInterview's GET for the interviews, lambda/getCandidateEvents for the history,
 * lambda/getCandidate for N-2 and for the record's numbers) in a fresh Node process for each call, against REC-14's fake AWS over step C's
 * world plus this card's people and candidates (support/rec-15d/world.ts), at a fixed time NOW, with a fake sign-in pool. Every answer is
 * checked against api/openapi.yaml. Terraform is read as text. Nothing calls AWS or any AI. Nothing here has a screen width: each test
 * runs once, at 1280.
 *
 * Pinned by the verifier where the spec is silent (each is in cards/rec-15d.md for the BA to confirm):
 *  - D-T-D1 A PERSON entry is exactly { kind, person_id, name, feedback, due_at }; a GUEST entry exactly { kind, name, feedback, due_at }.
 *    due_at is null when feedback is GIVEN. One PERSON entry per panelMemberIds item, one GUEST entry per adhocPanelMembers item (the
 *    order is not judged).
 *  - D-T-D2 Each interview carries id, type, at, status and panel (the new names, from interviewId, interviewType, scheduledAt and status),
 *    votes (as today, with today's per-caller filtering), and the kept old fields of rule 25 that the row stores, with the stored value
 *    (a panel member's cut to their own, D-4). Nothing else.
 *  - D-T-D3 required is { done, total } exactly when step C's record gives the same caller interviews_done and interviews_required as
 *    numbers, and then equal to them; else null. A panel member: null.
 *  - D-T-D4 namesOf asks the pool at most once per person per read, and at most 50 times per read; every pool call names an id in
 *    sign-in form. Every Member read names an id in sign-in form.
 *  - D-T-D5 Error answers stay as today and are described in api/openapi.yaml: 404 { error: 'Not found' } for both routes; the interviews
 *    500 { error }, the history 400 and 500 { message }.
 *  - D-T-D6 Each history event carries at, kind and by_name always (by_name may be null); at equals timestamp and kind equals eventType.
 *  - D-T-D7 The read never writes, for any caller (no PutItem, UpdateItem, DeleteItem, batch or transaction), and every AWS call is one the
 *    Lambda's role holds after step D (DynamoDB reads named below, cognito-idp:AdminGetUser).
 *  - D-T-D8 The SDK is added to both Lambdas' package.json and package-lock.json (spec check round 2, D-9 note).
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const NOT_FOUND = { error: 'Not found' };
const R_ = C.recruiter;
const HM = C.hmC1; // hiring manager hmA (dee, big and step C's Fleet candidates)
const P1 = PC.p1;
const P2 = PC.p2;
const SIGN_IN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sorted = (a: Iterable<string>) => [...a].sort();
const due = (hoursAgo: number, hours: number) => new Date(Date.parse(NOW) - Math.round(hoursAgo * 3_600_000) + hours * 3_600_000).toISOString();
const KEPT = ['interviewId', 'candidateId', 'interviewType', 'scheduledAt', 'panelMemberIds', 'adhocPanelMembers', 'votesRequired', 'votesSubmitted', 'status',
  'completedAt', /* 'outcome' left the list: child lock int-01.1 (INT-01 R-4) */ 'createdAt', 'criteria_snapshot', 'PANEL_SPLIT_FLAG', 'PANEL_CONSENSUS'];
const NEW_IV = ['id', 'type', 'at', 'status', 'panel', 'votes'];
const PERSON_KEYS = ['due_at', 'feedback', 'kind', 'name', 'person_id'];
const GUEST_KEYS = ['due_at', 'feedback', 'kind', 'name'];
// child lock int-01.1 (INT-01 rule 6, R-2, R-4): each interview gains the rule 6 keys and loses `outcome`; a panel entry may carry `vote`,
// `no_feedback` and (a guest's, for a Recruiter) `email`, each left out for a caller who may not see it. int-01.spec.ts AC-11 and AC-20
// judge those; the checks here judge the rest of each entry as before.
const INT01_IV = ['length_minutes', 'where', 'place', 'video_link', 'sequence', 'closed_reason', 'closed_note', 'closed_by_name', 'closed_at', 'candidate_note', 'can'];
const INT01_IV_ALWAYS = INT01_IV.filter((k) => k !== 'closed_note' && k !== 'candidate_note');
const INT01_ENTRY = ['vote', 'no_feedback', 'email'];
const base = (e: any) => (e && typeof e === 'object' ? Object.fromEntries(Object.entries(e).filter(([k]) => !INT01_ENTRY.includes(k))) : e);

// ---------------------------------------------------------------- the checks every read must pass

const WRITE = /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems|ExecuteStatement|BatchExecuteStatement/;
const writesOf = (r: Run) => awsOf(r).filter((c) => c.service === 'dynamodb' && WRITE.test(c.op)).map((c) => `${c.op} ${c.table ?? ''}`);
/**
 * D-T-D7: the calls each role allows after step D. scheduleInterview: GetItem on the state, roles, config and tenants tables; Query on the
 * state table, on the config table's GSI1-active-configs index and on the tenants table (no index); AdminGetUser. getCandidateEvents:
 * GetItem and Query on the events table (and its indexes); Query on the state table; GetItem and Query (no index) on the tenants table;
 * AdminGetUser. The fake does not check IAM, so this list does.
 */
type May = { get: string[]; query: Record<string, (index: string | undefined) => boolean> };
const MAY: Record<'interviews' | 'events', May> = {
  interviews: {
    get: [TABLE.state, 'talent-flow-roles', TABLE.config, TENANTS],
    query: { [TABLE.state]: (i) => i === undefined, [TABLE.config]: (i) => i === 'GSI1-active-configs', [TENANTS]: (i) => i === undefined },
  },
  events: {
    get: [TABLE.events, TENANTS],
    query: { [TABLE.events]: () => true, [TABLE.state]: (i) => i === undefined, [TENANTS]: (i) => i === undefined },
  },
};
function notAllowed(r: Run, which: 'interviews' | 'events'): string[] {
  const out: string[] = [];
  for (const c of awsOf(r)) {
    const where = String(c.table ?? '');
    const index = c.input?.IndexName as string | undefined;
    let ok = false;
    if (c.service === 'cognito') ok = c.op === 'AdminGetUser';
    else if (c.service === 'dynamodb' && c.op === 'GetItem') ok = MAY[which].get.includes(where) && index === undefined;
    else if (c.service === 'dynamodb' && c.op === 'Query') ok = !!MAY[which].query[where]?.(index);
    if (!ok) out.push(`${c.service} ${c.op} ${where}${index ? ' index ' + index : ''}`);
  }
  return out;
}
let docCache: Doc | undefined;
const doc = () => (docCache ??= readDoc());
const misfit = (route: string, r: Run): string[] => {
  const s = statusOf(r);
  if (s === undefined) return [`no answer (${describe(r)})`];
  return checker(doc()).check(answerSchema(doc(), route, s), bodyOf(r)).map((p) => `${route} ${s}: ${p}`);
};
/** The checks every read makes: no write, only granted calls, every pool and Member read by an id in sign-in form, the schema. */
function checked(r: Run, route: string, label: string): Run {
  const which = route === INTERVIEWS ? 'interviews' : 'events';
  expect.soft(writesOf(r), `${label}: the read writes nothing (D-5, D-T-D7)`).toEqual([]);
  expect.soft(notAllowed(r, which), `${label}: every AWS call is one the role holds after step D (D-T-D7)`).toEqual([]);
  expect.soft(poolAsked(r).filter((u) => !SIGN_IN.test(u)), `${label}: the pool is only asked for ids in sign-in form (R2-1)`).toEqual([]);
  expect.soft(membersRead(r).filter((u) => !SIGN_IN.test(u)), `${label}: Member rows are only read for ids in sign-in form (R2-1)`).toEqual([]);
  expect.soft(misfit(route, r), `${label}: the answer (${describe(r).slice(0, 160)}) passes api/openapi.yaml`).toEqual([]);
  return r;
}
const ivs = (who: Caller, id: string, t: Tables, o: Opts = {}, label = `${who.name} reads ${id}'s interviews`) => checked(interviewsRun(who, id, t, o), INTERVIEWS, label);
const evs = (who: Caller, id: string, t: Tables, o: Opts = {}, label = `${who.name} reads ${id}'s history`) => checked(eventsRun(who, id, t, o), EVENTS, label);
const ok = (r: Run, label: string) => {
  expect(statusOf(r), `${label}: 200 (${describe(r).slice(0, 300)})`).toBe(200);
  return bodyOf(r) as Record<string, any>;
};
const ivOf = (b: Record<string, any>, id: string) => ((b?.['interviews'] ?? []) as any[]).find((x) => x?.id === id || x?.interviewId === id);
const personEntry = (iv: any, id: string) => ((iv?.panel ?? []) as any[]).find((e) => e?.kind === 'PERSON' && e?.person_id === id);
const guestEntries = (iv: any) => ((iv?.panel ?? []) as any[]).filter((e) => e?.kind === 'GUEST');
const count = (list: string[], x: string) => list.filter((y) => y === x).length;
const legacyA: Opts = { legacy: A };

// ---------------------------------------------------------------- tests

test.describe('REC-15 step D · Interviews with names, and history names', () => {
  test('Control: the world is good: the people, their Member rows, the pool, dee\'s interviews, votes and history are there as the tests expect', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const st = rowsOf(t, TABLE.state);
    const deeIvs = st.filter((x) => x['PK'] === `CANDIDATE#${D.dee}` && String(x['SK']).startsWith('INTERVIEW#'));
    expect.soft(deeIvs.map((x) => `${x['interviewId']} ${x['status']} ${x['tenant_id'] === A ? 'A' : 'B'}`).sort(), 'dee has four interview rows, one stamped B').toEqual([
      `${IV.iv1} COMPLETED A`, `${IV.iv2} SCHEDULED A`, `${IV.iv3} CANCELLED A`, `${IV.ivB} COMPLETED B`,
    ]);
    expect.soft(st.filter((x) => x['PK'] === `CANDIDATE#${D.dee}` && String(x['SK']).startsWith('VOTE#')).map((x) => x['voterId']).sort(), 'dee\'s votes').toEqual(sorted([P.p1, 'Gift.Guest@OUTSIDE.test', GUEST_VOTER, P.p3]));
    expect.soft('settingVersions' in (st.find((x) => x['PK'] === `CANDIDATE#${D.dee}` && x['SK'] === 'SAGA') ?? {}), 'dee is an older row with no settings lock').toBe(false);
    const members = rowsOf(t, TENANTS).filter((x) => String(x['pk']).startsWith('USER#d15d'));
    expect.soft(members.length, 'the Member rows of the sign-in-form people (two rows for `two`)').toBe(9 + MANY.length);
    expect.soft(members.some((x) => x['pk'] === `USER#${P.noRow}`), 'noRow has no Member row').toBe(false);
    for (const id of Object.values(P).concat(MANY)) expect.soft(SIGN_IN.test(id), `${id} is in sign-in form`).toBe(true);
    expect.soft(SIGN_IN.test(BEMAIL) || SIGN_IN.test(SUB.panelA), 'BEMAIL and sub-panel-a are not').toBe(false);
    expect.soft(rowsOf(t, TABLE.events).filter((x) => x['candidateId'] === D.dee).length, 'dee has nine history events').toBe(9);
    // Today's route answers the Recruiter (it exists and reads the world).
    const r = interviewsRun(R_, D.dee, t);
    expect.soft(statusOf(r), `today the Recruiter reads dee's interviews (${describe(r).slice(0, 200)})`).toBe(200);
  });

  // ---------------------------------------------------------------- AC-14 entries, names, guests, due times

  test('AC-14 Each interview has its panel entries: a person\'s name and feedback state, a guest\'s typed name and no email; the due time only while waiting; the new names beside the kept old fields', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    for (const [kind, who] of [['R', R_], ['HM', HM]] as [string, Caller][]) {
      const b = ok(ivs(who, D.dee, t, legacyA), `${kind} reads dee`);
      expect.soft(((b['interviews'] ?? []) as any[]).map((x) => x.id), `${kind}: A's three interviews, oldest first; the one stamped B is not there`).toEqual([IV.iv1, IV.iv2, IV.iv3]);
      const i1 = ivOf(b, IV.iv1);
      const i2 = ivOf(b, IV.iv2);
      const i3 = ivOf(b, IV.iv3);
      expect.soft([i1?.type, i1?.at, i1?.status, i3?.status], `${kind}: id, type, at and status from the stored row (CANCELLED sent as stored)`).toEqual(['PHONE_SCREEN', new Date(Date.parse(NOW) - AT.iv1 * 3_600_000).toISOString(), 'COMPLETED', 'CANCELLED']);
      // Persons: one entry per panel member id, with the name rule 24 gives and the feedback state from the votes.
      const want = (iv: any, ids: string[], voted: string[], h: number) => {
        for (const id of ids) {
          const e = personEntry(iv, id);
          const given = voted.includes(id);
          expect.soft(e && sorted(Object.keys(base(e))), `${kind} ${iv?.id}: ${id}'s entry is exactly kind, person_id, name, feedback, due_at (D-T-D1)`).toEqual(PERSON_KEYS);
          expect.soft([e?.name, e?.feedback, e?.due_at], `${kind} ${iv?.id}: ${id}: name, feedback, due_at`).toEqual([NAME[id] ?? null, given ? 'GIVEN' : 'WAITING', given ? null : due(h, 24)]);
        }
        expect.soft(((iv?.panel ?? []) as any[]).filter((e) => e?.kind === 'PERSON').length, `${kind} ${iv?.id}: one entry per panel member id`).toBe(ids.length);
      };
      want(i1, [P.p1, P.p2], [P.p1], AT.iv1);
      want(i2, [P.p1, P.p3, P.blank, P.noRow, P.pB, P.two, P.gone, P.alias, BEMAIL, SUB.panelA], [P.p3], AT.iv2);
      want(i3, [P.p2], [], AT.iv3);
      // Guests: from adhocPanelMembers, the typed name trimmed (spaces only: null), never the email; the old link vote (email as voterId,
      // other capitals) is GIVEN; the REC-07 GUEST# vote adds no entry (D-6).
      const g1 = guestEntries(i1);
      expect.soft(g1.map((e) => sorted(Object.keys(base(e)))), `${kind}: guest entries are exactly kind, name, feedback, due_at (D-T-D1)`).toEqual([GUEST_KEYS, GUEST_KEYS]);
      expect.soft(g1.map((e) => `${e.name} ${e.feedback} ${e.due_at}`).sort(), `${kind}: Gift voted the old way (GIVEN); Rec Seven is waiting; no entry for the GUEST# vote`).toEqual(sorted(['Gift Guest GIVEN null', `Rec Seven WAITING ${due(AT.iv1, 24)}`]));
      expect.soft(guestEntries(i2).map((e) => [e.name, e.feedback]), `${kind}: a guest whose typed name is only spaces has name null`).toEqual([[null, 'WAITING']]);
      expect.soft(guestEntries(i3), `${kind}: no guest on iv3`).toEqual([]);
      // person_id is the stored panel member id as stored (BEMAIL on iv2 is the R2-1 case), so the search leaves person_id out.
      const noId = (iv: any) => ((iv?.panel ?? []) as any[]).map(({ person_id: _id, ...rest }) => base(rest)); // base(): child lock int-01.1
      const entries = JSON.stringify([noId(i1), noId(i2), noId(i3)]).toLowerCase();
      for (const w of [GUEST.gift.email, GUEST.seven.email, GUEST.blank.email, GUEST_VOTER.toLowerCase(), '@', 'rating', 'score', 'comment', NEVER.comment, 'yes']) {
        expect.soft(entries.includes(w), `${kind}: no entry holds "${w}" (no email, no score, no rating, no comment)`).toBe(false);
      }
      // The kept old fields stay for the Recruiter and the hiring manager, with their stored values.
      expect.soft([i2?.panelMemberIds?.length, i2?.adhocPanelMembers, i2?.votesSubmitted, i2?.PANEL_SPLIT_FLAG, i2?.PANEL_CONSENSUS, i2?.criteria_snapshot?.length], `${kind}: the old fields on iv2 as stored`).toEqual([10, [GUEST.blank], 1, true, 'SPLIT', 2]);
      expect.soft([i1?.interviewId, i1?.interviewType, i1?.completedAt, i1?.outcome, i1?.votesRequired], `${kind}: iv1's old fields as stored`).toEqual([IV.iv1, 'PHONE_SCREEN', new Date(Date.parse(NOW) - 40 * 3_600_000).toISOString(), undefined /* outcome left the list: child lock int-01.1 (INT-01 R-4) */, 3]);
    }
  });

  test('AC-14 The feedback due time is the interview time plus the company\'s feedbackDueHours (24), or 48 when the company has none, from the candidate\'s own settings; null when the time is not a time', async ({}, testInfo) => {
    once(testInfo.project.name);
    const base = world();
    const p2On1 = (t: Tables, label: string) => personEntry(ivOf(ok(ivs(R_, D.dee, t, legacyA), label), IV.iv1), P.p2)?.due_at;
    expect.soft(p2On1(withFeedbackHours(base, 24), '24'), 'feedbackDueHours 24: 24 hours after iv1').toBe(due(AT.iv1, 24));
    expect.soft(p2On1(withFeedbackHours(base, null), 'absent'), 'no feedbackDueHours: the default 48').toBe(due(AT.iv1, 48));
    expect.soft(p2On1(withFeedbackHours(base, 6), '6'), 'feedbackDueHours 6: 6 hours').toBe(due(AT.iv1, 6));
    // R2-5: the candidate's own settings. Step C's `full` is locked to version 1 (feedbackDueHours 24); a new active version 2 says 6.
    const v2 = withNewVersion(base, A, 'SLA_THRESHOLDS', (d) => ({ ...d, feedbackDueHours: 6 })).t;
    const fullB = ok(ivs(R_, Q.full, v2), 'full, version 2 active');
    const waiting = ((fullB['interviews'] ?? []) as any[]).flatMap((x) => ((x.panel ?? []) as any[]).filter((e) => e.feedback === 'WAITING').map((e) => [x.at, e.due_at]));
    expect.soft(waiting.length > 0, 'full has waiting entries').toBe(true);
    for (const [at, d] of waiting) expect.soft(d, 'full (locked to version 1): 24 hours, not the active 6').toBe(new Date(Date.parse(at) + 24 * 3_600_000).toISOString());
    const twiceW = ((ok(ivs(R_, Q.twice, v2), 'twice, version 2 active')['interviews'] ?? []) as any[]).flatMap((x) => ((x.panel ?? []) as any[]).filter((e) => e.feedback === 'WAITING').map((e) => [x.at, e.due_at]));
    expect.soft(twiceW.length > 0, 'twice has waiting entries').toBe(true);
    for (const [at, d] of twiceW) expect.soft(d, 'twice (not locked): the active version 2, 6 hours').toBe(new Date(Date.parse(at) + 6 * 3_600_000).toISOString());
    // A stored time that is not a time: no due time, still a 200.
    const odd = withInterview(base, D.dee, IV.iv3, { scheduledAt: 'next week' });
    const e = personEntry(ivOf(ok(ivs(R_, D.dee, odd, legacyA), 'iv3 has no time'), IV.iv3), P.p2);
    expect.soft([e?.feedback, e?.due_at], 'iv3 with no time: WAITING, due_at null').toEqual(['WAITING', null]);
  });

  // ---------------------------------------------------------------- AC-14 the panel member (D-4, safety)

  test('AC-14 A panel member sees only the interviews they are on, and in each only their own entry; a deep search of their whole answer finds no other member\'s id, no guest name or email and no vote count (D-4, R2-4)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const b = ok(ivs(P1, D.dee, t, legacyA), 'p1 reads dee');
    expect.soft(((b['interviews'] ?? []) as any[]).map((x) => x.id), 'p1 is on iv1 and iv2 only (not iv3; ivB is B\'s)').toEqual([IV.iv1, IV.iv2]);
    for (const [iv, given, h] of [[IV.iv1, true, AT.iv1], [IV.iv2, false, AT.iv2]] as [string, boolean, number][]) {
      const x = ivOf(b, iv);
      expect.soft(((x?.panel ?? []) as any[]).map(base), `p1 on ${iv}: only their own entry`) /* base(): child lock int-01.1 */.toEqual([{ kind: 'PERSON', person_id: P.p1, name: 'Thandi Mokoena', feedback: given ? 'GIVEN' : 'WAITING', due_at: given ? null : due(h, 24) }]);
      expect.soft(x?.panelMemberIds, `p1 on ${iv}: panelMemberIds is [me]`).toEqual([P.p1]);
      for (const k of ['adhocPanelMembers', 'votesSubmitted', 'PANEL_SPLIT_FLAG', 'PANEL_CONSENSUS', 'PANEL_FEEDBACK_PENDING_COUNT']) expect.soft(k in (x ?? {}), `p1 on ${iv}: no ${k}`).toBe(false);
      expect.soft(x?.votesRequired, `p1 on ${iv}: votesRequired (the panel size the company set) stays (R2-4)`).toBe(3);
    }
    expect.soft(b['required'], 'a panel member: required is null').toBeNull();
    const text = JSON.stringify(b).toLowerCase();
    const others = [P.p2, P.p3, P.blank, P.noRow, P.pB, P.two, P.gone, P.alias, BEMAIL, SUB.panelA, GUEST_VOTER, 'Gift Guest', 'Rec Seven', GUEST.gift.email, GUEST.seven.email, GUEST.blank.email, 'votesSubmitted', 'PANEL_FEEDBACK_PENDING_COUNT', 'Sizwe', 'Ndlovu', 'Naledi'];
    for (const w of others) expect.soft(text.includes(w.toLowerCase()), `the deep search of p1's whole answer finds no "${w}"`).toBe(false);
    // p2: iv1 and iv3, their own entry waiting on both.
    const b2 = ok(ivs(P2, D.dee, t, legacyA), 'p2 reads dee');
    expect.soft(((b2['interviews'] ?? []) as any[]).map((x) => [x.id, x.panel]), 'p2: iv1 and iv3, each only their own entry').toEqual([
      [IV.iv1, [{ kind: 'PERSON', person_id: P.p2, name: 'Sizwe', feedback: 'WAITING', due_at: due(AT.iv1, 24) }]],
      [IV.iv3, [{ kind: 'PERSON', person_id: P.p2, name: 'Sizwe', feedback: 'WAITING', due_at: due(AT.iv3, 24) }]],
    ]);
    const text2 = JSON.stringify(b2).toLowerCase();
    for (const w of [P.p1, 'Thandi', 'Mokoena', 'Gift Guest', GUEST.gift.email, 'votesSubmitted', GUEST_VOTER]) expect.soft(text2.includes(w.toLowerCase()), `the deep search of p2's answer finds no "${w}"`).toBe(false);
    // A panel member never gets another person's name looked up for them.
    const asked = poolAsked(interviewsRun(P1, D.dee, t, legacyA));
    expect.soft(asked.filter((u) => u !== P.p1), 'reading as p1, the pool is asked about p1 only').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-14 who gets a name: the company check first (D-2, D-8a, R2-1)

  test('AC-14 Names only for the caller\'s company, checked before the pool is asked: B\'s person, a person in two companies, an email stored as an id and an id not in sign-in form are null with no pool call; deleted, alias and nameless people are null and not told apart (D-8a, R2-1)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const r = ivs(R_, D.dee, t, legacyA);
    const b = ok(r, 'R reads dee, LEGACY_TENANT_ID A');
    const i2 = ivOf(b, IV.iv2);
    const asked = poolAsked(r);
    const read = membersRead(r);
    // R2-1: company B's person's email stored as a panel member id: null, and neither the pool nor the Member rows are asked about it.
    expect.soft(personEntry(i2, BEMAIL)?.name, 'B\'s person\'s email as an id: name null').toBeNull();
    expect.soft([count(asked, BEMAIL), count(read, BEMAIL)], 'no AdminGetUser and no Member read for the email (R2-1)').toEqual([0, 0]);
    expect.soft(asked.some((u) => u.toLowerCase().includes('bontle')), 'the pool is never asked about any form of it').toBe(false);
    // An id not in sign-in form (one with a Member row of A and a pool user here): null, no read at all.
    expect.soft(personEntry(i2, SUB.panelA)?.name, 'sub-panel-a: name null').toBeNull();
    expect.soft([count(asked, SUB.panelA), count(read, SUB.panelA)], 'no AdminGetUser and no Member read for sub-panel-a').toEqual([0, 0]);
    // D-8a: B's person and a person in two companies: null, and the pool is never asked about them.
    for (const id of [P.pB, P.two]) {
      expect.soft(personEntry(i2, id)?.name, `${id}: null`).toBeNull();
      expect.soft(count(asked, id), `${id}: no AdminGetUser (the company check comes first)`).toBe(0);
    }
    // Deleted (not in the pool), alias (the pool record's sub is another id), nameless: null.
    for (const id of [P.gone, P.alias, P.blank]) expect.soft(personEntry(i2, id)?.name, `${id}: null`).toBeNull();
    const nulls = [P.pB, P.two, P.gone, P.alias, P.blank, BEMAIL, SUB.panelA].map((id) => personEntry(i2, id));
    expect.soft(new Set(nulls.map((e) => JSON.stringify({ ...e, person_id: 'x' }))).size, 'the null entries are not told apart (same keys, same values but the id)').toBe(1);
    // D-T-D4: each person asked once, however many interviews they are on (p1 is on iv1 and iv2).
    expect.soft(count(asked, P.p1), 'p1 is asked once').toBe(1);
    expect.soft(asked.filter((u, i) => asked.indexOf(u) !== i), 'no one asked twice').toEqual([]);
    // D-2: a person with no Member row follows the pickers' rule (LEGACY_TENANT_ID).
    const unset = interviewsRun(R_, D.dee, t);
    expect.soft(personEntry(ivOf(ok(checked(unset, INTERVIEWS, 'legacy unset'), 'legacy unset'), IV.iv2), P.noRow)?.name, 'LEGACY_TENANT_ID unset: noRow is null').toBeNull();
    expect.soft(count(poolAsked(unset), P.noRow), 'and the pool is not asked about noRow').toBe(0);
    expect.soft(personEntry(i2, P.noRow)?.name, 'LEGACY_TENANT_ID A, caller of A: noRow has their name').toBe('Naledi Norow');
    const bRun = ivs(C.recruiterB, D.bee, t, legacyA);
    const bee = ivOf(ok(bRun, 'B\'s Recruiter reads bee, LEGACY_TENANT_ID A'), IV.bee);
    expect.soft([personEntry(bee, P.noRow)?.name, personEntry(bee, P.pB)?.name], 'B\'s Recruiter: noRow (legacy A) is null, B\'s own person has their name').toEqual([null, 'Bheki Bcompany']);
    expect.soft(count(poolAsked(bRun), P.noRow), 'and the pool is not asked about noRow for a B caller').toBe(0);
    // D-8b: nothing the pool holds but the joined name reaches the answer.
    const text = JSON.stringify(b);
    for (const w of POOL_OTHER) expect.soft(text.includes(w), `the answer holds no "${w}" from the pool`).toBe(false);
  });

  test('AC-14 Who may read: B\'s Recruiter, another manager and an Employee get 404; the company never comes from the query, a header or the body', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    for (const who of [C.recruiterB, C.hmOther, C.employee]) {
      const r = ivs(who, D.dee, t, legacyA);
      expect.soft([statusOf(r), bodyOf(r)], `${who.name}: 404`).toEqual([404, NOT_FOUND]);
      expect.soft(poolAsked(r), `${who.name}: the pool is not asked`).toEqual([]);
    }
    const sent: Opts = { legacy: A, query: { tenant_id: A, tenantId: A }, headers: { 'x-tenant-id': A }, body: { tenant_id: A } };
    const r = ivs(C.recruiterB, D.dee, t, sent);
    expect.soft([statusOf(r), bodyOf(r)], 'B\'s Recruiter naming company A in the query, a header and the body: still 404').toEqual([404, NOT_FOUND]);
    const mine = ivs(R_, D.dee, t, { legacy: A, query: { tenant_id: B }, headers: { 'x-tenant-id': B }, body: { tenant_id: B } });
    expect.soft(personEntry(ivOf(ok(mine, 'A\'s Recruiter naming B'), IV.iv2), P.pB)?.name, 'A\'s Recruiter naming B: still A\'s answer, B\'s person still null').toBeNull();
    expect.soft(count(poolAsked(mine), P.pB), 'and the pool is not asked about B\'s person').toBe(0);
  });

  // ---------------------------------------------------------------- AC-14 limits and errors (D-8c, D-8d)

  test('AC-14 51 distinct people give 50 names and one null, with at most 50 pool calls and no name or id in the log', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const r = ivs(R_, D.big, t, legacyA);
    const iv = ivOf(ok(r, 'R reads big'), IV.big);
    const names = MANY.map((id) => personEntry(iv, id)?.name);
    expect.soft(names.filter((x) => x === null).length, 'one null').toBe(1);
    expect.soft(names.filter((x) => typeof x === 'string' && /^Many P\d+$/.test(x)).length, '50 names, each the person\'s own').toBe(50);
    MANY.forEach((id, i) => { if (names[i] !== null) expect.soft(names[i], `${id}: their own name`).toBe(`Many P${i}`); });
    expect.soft(poolAsked(r).length <= 50, `at most 50 pool calls (${poolAsked(r).length})`).toBe(true);
    const lines = logsOf(r).join('\n');
    for (const w of [...MANY, 'Many P']) expect.soft(lines.includes(w), `no log line holds "${w}"`).toBe(false);
  });

  test('AC-14 A thrown TooManyRequestsException and a failed Member read give null for that person and a 200; the log names the error only', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const r = ivs(R_, D.dee, t, { legacy: A, faults: { pool: { [P.p2]: 'TooManyRequestsException' }, member: { [P.p3]: 'ProvisionedThroughputExceededException' } } });
    const b = ok(r, 'R reads dee with two failing lookups');
    expect.soft(personEntry(ivOf(b, IV.iv1), P.p2)?.name, 'p2 (the pool throws): null').toBeNull();
    expect.soft(personEntry(ivOf(b, IV.iv2), P.p3)?.name, 'p3 (the Member read throws): null').toBeNull();
    expect.soft(count(poolAsked(r), P.p3), 'p3: the pool is not asked after the Member read failed').toBe(0);
    expect.soft([personEntry(ivOf(b, IV.iv1), P.p1)?.name, personEntry(ivOf(b, IV.iv2), P.noRow)?.name], 'the others still have their names').toEqual(['Thandi Mokoena', 'Naledi Norow']);
    expect.soft(personEntry(ivOf(b, IV.iv2), P.p3)?.feedback, 'p3\'s feedback still comes from the votes').toBe('GIVEN');
    const lines = logsOf(r).join('\n');
    for (const n of ['TooManyRequestsException', 'ProvisionedThroughputExceededException']) expect.soft(lines, `the log names ${n}`).toContain(n);
    for (const w of [FAULT_MESSAGE, ...ALL_NAMES, ...POOL_OTHER]) expect.soft(lines.includes(w), `no log line holds "${w}"`).toBe(false);
    // UserNotFoundException (gone) is null with no error line naming it.
    const good = ivs(R_, D.dee, t, legacyA);
    expect.soft(personEntry(ivOf(ok(good, 'R reads dee'), IV.iv2), P.gone)?.name, 'gone: null').toBeNull();
    const goodLines = logsOf(good).join('\n');
    for (const w of [...ALL_NAMES, ...POOL_OTHER, ...Object.values(P)]) expect.soft(goodLines.includes(w), `a good read logs no "${w}"`).toBe(false);
  });

  // ---------------------------------------------------------------- AC-14 no writes, the explicit list, required (D-3, D-5, D-11)

  test('AC-14 The read never writes, for each caller kind, on an older candidate with no settings lock (D-5)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    for (const [who, id] of [[R_, D.dee], [HM, D.dee], [P1, D.dee], [P2, D.dee], [R_, Q.twice], [HM, Q.twice], [HM, Q.junior], [C.panelA, Q.twice]] as [Caller, string][]) {
      const r = ivs(who, id, t, legacyA);
      expect.soft(statusOf(r), `${who.name} on ${id}: 200`).toBe(200);
      expect.soft(changedRows(t, r.tables), `${who.name} on ${id}: no stored row changed (no settings lock written)`).toEqual([]);
    }
  });

  test('AC-14 Each interview is an explicit list: the kept old fields and the new ones, never PK, SK, tenant_id, PANEL_FEEDBACK_PENDING_COUNT or a stray stored key; the hiring manager gets the same fields as the Recruiter', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const bodies: Record<string, Record<string, any>> = {};
    for (const [kind, who] of [['R', R_], ['HM', HM], ['P', P1]] as [string, Caller][]) {
      const b = ok(ivs(who, D.dee, t, legacyA), `${kind} reads dee`);
      bodies[kind] = b;
      expect.soft(sorted(Object.keys(b)), `${kind}: the answer is { interviews, required }`).toEqual(['interviews', 'required']);
      for (const x of (b['interviews'] ?? []) as any[]) {
        const extra = Object.keys(x).filter((k) => !KEPT.includes(k) && !NEW_IV.includes(k) && !INT01_IV.includes(k)); // && INT01_IV: child lock int-01.1
        expect.soft(extra, `${kind} ${x.id}: no key outside the explicit list (D-3)`).toEqual([]);
        for (const k of NEW_IV) expect.soft(k in x, `${kind} ${x.id}: ${k} is there (D-T-D2)`).toBe(true);
      }
      const text = JSON.stringify(b);
      for (const w of ['"PK"', '"SK"', '"tenant_id"', '"tenantId"', 'PANEL_FEEDBACK_PENDING_COUNT', NEVER.stray, 'zzStrayKey', 'CANDIDATE#', 'INTERVIEW#']) expect.soft(text.includes(w), `${kind}: the answer holds no ${w}`).toBe(false);
    }
    const keysOf = (b: Record<string, any>) => ((b['interviews'] ?? []) as any[]).map((x) => `${x.id}: ${sorted(Object.keys(x)).join(',')}`);
    expect.soft(keysOf(bodies['HM']!), 'the hiring manager gets the same fields as the Recruiter').toEqual(keysOf(bodies['R']!));
    const r2 = ivOf(bodies['R']!, IV.iv2);
    expect.soft(sorted(Object.keys(r2 ?? {})), 'the Recruiter\'s iv2: every kept field it stores, and the new ones').toEqual(sorted([
      'interviewId', 'candidateId', 'interviewType', 'scheduledAt', 'panelMemberIds', 'adhocPanelMembers', 'votesRequired', 'votesSubmitted', 'status', 'createdAt',
      'criteria_snapshot', 'PANEL_SPLIT_FLAG', 'PANEL_CONSENSUS', 'id', 'type', 'at', 'panel', 'votes', ...INT01_IV_ALWAYS, // child lock int-01.1
    ]));
    // votes[] keeps today's rule: the Recruiter sees every vote of the interview, the panel member only their own.
    expect.soft(((ivOf(bodies['R']!, IV.iv1)?.votes ?? []) as any[]).map((v) => v.voterId).sort(), 'R: every vote on iv1').toEqual(sorted([P.p1, 'Gift.Guest@OUTSIDE.test', GUEST_VOTER]));
    expect.soft(((ivOf(bodies['P']!, IV.iv1)?.votes ?? []) as any[]).map((v) => v.voterId), 'p1: only their own vote').toEqual([P.p1]);
  });

  test('AC-14 required follows the record: the Recruiter\'s and the hiring manager\'s { done, total } equal step C\'s record numbers on the same candidate; null before Interview and for a panel member (D-11)', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(6 * 60_000);
    const t = world();
    const ids = [D.dee, Q.full, Q.ready, Q.twice, Q.foreign, Q.applied, Q.screening, Q.offer, Q.legacy, Q.employed, Q.notHired, Q.old, Q.junior, Q.senior];
    let nums = 0;
    let nulls = 0;
    for (const id of ids) {
      for (const [kind, who] of [['R', R_], ['HM', id === Q.senior ? C.hmOther : HM]] as [string, Caller][]) {
        const rec = bodyOf(recordRun(who, id, t)) as Record<string, any>;
        const b = ok(ivs(who, id, t, legacyA), `${kind} on ${id}`);
        const want = typeof rec?.['interviews_done'] === 'number' && typeof rec?.['interviews_required'] === 'number' ? { done: rec['interviews_done'], total: rec['interviews_required'] } : null;
        expect.soft(b['required'], `${kind} on ${id}: required equals the record's ${JSON.stringify([rec?.['interviews_done'], rec?.['interviews_required']])}`).toEqual(want);
        if (want) nums++; else nulls++;
      }
    }
    expect.soft([nums > 10, nulls >= 4], 'the fixtures hold both numbers and nulls').toEqual([true, true]);
    expect.soft(bodyOf(interviewsRun(R_, D.dee, t, legacyA))?.required, 'dee: PHONE_SCREEN completed, TECHNICAL not (CANCELLED and B\'s interview do not count): 1 of 2').toEqual({ done: 1, total: 2 });
    expect.soft(bodyOf(interviewsRun(C.panelA, Q.full, t))?.required, 'a panel member on full: null').toBeNull();
  });

  test('AC-14 N-2: the record answer has no key matching offer or salary at any depth, for the Recruiter, the hiring manager and a panel member', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = withCandidate(world(), Q.full, { evaluationResult: { offer_note: 'zz-offer-note', salary_band: 'zz-band', kept: 'zz-kept' }, interviewSentiment: { offerRisk: 'zz' } });
    const deep = (v: unknown, at = ''): string[] => (v && typeof v === 'object' ? Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [...(/offer|salary/i.test(k) ? [`${at}.${k}`] : []), ...deep(x, `${at}.${k}`)]) : []);
    for (const [kind, who] of [['R', R_], ['HM', HM], ['P', C.panelA]] as [string, Caller][]) {
      const r = recordRun(who, Q.full, t);
      expect.soft(statusOf(r), `${kind}: 200 (${describe(r).slice(0, 160)})`).toBe(200);
      expect.soft(deep(bodyOf(r)), `${kind}: no offer or salary key at any depth`).toEqual([]);
      expect.soft(JSON.stringify(bodyOf(r)).includes('zz-offer-note') || JSON.stringify(bodyOf(r)).includes('zz-band'), `${kind}: and none of their values`).toBe(false);
    }
  });

  // ---------------------------------------------------------------- AC-15 history names

  test('AC-15 Every history event has by_name, at and kind: the name for a person of A, null for a stranger, a person of B, an id not in sign-in form and SYSTEM, system, HUMAN and AGENT, with no pool call for those (D-7)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    for (const [kind, who] of [['R', R_], ['HM', HM], ['P', P1]] as [string, Caller][]) {
      const r = evs(who, D.dee, t, legacyA);
      const b = ok(r, `${kind} reads dee's history`);
      const events = (b['events'] ?? []) as any[];
      expect.soft(events.length >= 11, `${kind}: the events and the stage rows (${events.length})`).toBe(true);
      for (const e of events) {
        expect.soft('by_name' in e && 'at' in e && 'kind' in e, `${kind} ${e.eventId}: by_name, at and kind are there (D-T-D6)`).toBe(true);
        expect.soft([e.at, e.kind], `${kind} ${e.eventId}: at is the time and kind the type, beside the old names`).toEqual([e.timestamp, e.eventType]);
      }
      const byActor = (a: string | undefined) => events.filter((e) => (e.by ?? e.actor) === a).map((e) => e.by_name);
      expect.soft(byActor(P.p1), `${kind}: an event by p1 (A) has her name`).toEqual(['Thandi Mokoena']);
      expect.soft(byActor(P.p2), `${kind}: the stage row by p2 has his name`).toEqual(['Sizwe']);
      expect.soft(byActor(P.p3), `${kind}: the old stage row (actor p3) has the name`).toEqual(['Ndlovu']);
      expect.soft(byActor(P.noRow), `${kind}: noRow, LEGACY_TENANT_ID A: the name`).toEqual(['Naledi Norow']);
      for (const a of [P.pB, P.stranger, SUB.recA, 'HUMAN', 'AGENT', 'system']) expect.soft(byActor(a), `${kind}: ${a}: null`).toEqual([null]);
      expect.soft(byActor('SYSTEM'), `${kind}: SYSTEM and an event with no actor: null`).toEqual([null, null]);
      const asked = poolAsked(r);
      for (const a of [P.pB, 'SYSTEM', 'system', 'HUMAN', 'AGENT', SUB.recA]) expect.soft(count(asked, a), `${kind}: no pool call for ${a}`).toBe(0);
      const text = JSON.stringify(b);
      for (const w of POOL_OTHER) expect.soft(text.includes(w), `${kind}: the answer holds nothing else from the pool ("${w}")`).toBe(false);
      const lines = logsOf(r).join('\n');
      for (const w of [...ALL_NAMES, ...POOL_OTHER]) expect.soft(lines.includes(w), `${kind}: no log line holds "${w}"`).toBe(false);
      // The reason still shows to deciders only.
      expect.soft(text.includes(NEVER.reason), `${kind}: the reason ${kind === 'P' ? 'is hidden from a panel member' : 'shows'}`).toBe(kind !== 'P');
    }
    // D-2 for the history: noRow with LEGACY_TENANT_ID unset is null, and the pool is not asked.
    const unset = evs(R_, D.dee, t);
    expect.soft(((bodyOf(unset)?.events ?? []) as any[]).filter((e) => e.actor === P.noRow).map((e) => e.by_name), 'legacy unset: noRow null').toEqual([null]);
    expect.soft(count(poolAsked(unset), P.noRow), 'and not asked').toBe(0);
    // A failing pool and Member read: null and a 200.
    const f = evs(R_, D.dee, t, { legacy: A, faults: { pool: { [P.p1]: 'TooManyRequestsException' }, member: { [P.p2]: 'ProvisionedThroughputExceededException' } } });
    const fe = (ok(f, 'history with failing lookups')['events'] ?? []) as any[];
    expect.soft([fe.find((e) => e.actor === P.p1)?.by_name, fe.find((e) => e.by === P.p2)?.by_name, fe.find((e) => (e.by ?? e.actor) === P.p3)?.by_name], 'the failed ones null, the others named').toEqual([null, null, 'Ndlovu']);
    expect.soft(logsOf(f).join('\n').includes(FAULT_MESSAGE), 'no log line holds the error\'s message').toBe(false);
    // B's Recruiter: 404.
    const rb = evs(C.recruiterB, D.dee, t, legacyA);
    expect.soft([statusOf(rb), bodyOf(rb)], 'B\'s Recruiter: 404').toEqual([404, NOT_FOUND]);
    // The company never comes from the query, a header or the body: A's Recruiter naming B still gets A's names, and B's person stays null.
    const named = evs(R_, D.dee, t, { legacy: A, query: { tenant_id: B, tenantId: B }, headers: { 'x-tenant-id': B }, body: { tenant_id: B } });
    const ne = (ok(named, 'A\'s Recruiter naming B in the query, a header and the body')['events'] ?? []) as any[];
    const nameOfActor = (a: string) => ne.filter((e) => (e.by ?? e.actor) === a).map((e) => e.by_name);
    expect.soft([nameOfActor(P.p1), nameOfActor(P.pB)], 'naming B: p1 still has her name, B\'s person still null').toEqual([['Thandi Mokoena'], [null]]);
    expect.soft(count(poolAsked(named), P.pB), 'naming B: the pool is not asked about B\'s person').toBe(0);
  });

  // ---------------------------------------------------------------- AC-16 the contract

  test('AC-16 InterviewList, PanelEntry and CandidateEvents are written once in api/openapi.yaml, closed (detail the one open object); every answer described; the validator fails planted answers', async ({}, testInfo) => {
    once(testInfo.project.name);
    const d = doc();
    expect(operation(d, INTERVIEWS), 'GET /v1/candidates/{id}/interviews is in the file').toBeTruthy();
    expect(operation(d, EVENTS), 'GET /v1/candidates/{id}/events is in the file').toBeTruthy();
    expect.soft(refName(answerSchema(d, INTERVIEWS, 200)), 'the interviews 200 is InterviewList').toBe('InterviewList');
    expect.soft(refName(answerSchema(d, EVENTS, 200)), 'the history 200 is CandidateEvents').toBe('CandidateEvents');
    for (const [route, codes] of [[INTERVIEWS, [403, 404, 500]], [EVENTS, [400, 403, 404, 500]]] as [string, number[]][]) for (const s of codes) expect.soft(!!answerSchema(d, route, s), `${route} ${s} is described`).toBe(true);
    const S = d.components?.schemas ?? {};
    for (const n of ['InterviewList', 'PanelEntry', 'CandidateEvents']) expect.soft(S[n]?.additionalProperties, `${n} is closed`).toBe(false);
    const ivItem = S['InterviewList']?.properties?.interviews?.items;
    const ivProps = Object.keys((ivItem?.$ref ? S[String(ivItem.$ref).split('/').pop()!] : ivItem)?.properties ?? {});
    expect.soft(sorted(ivProps), 'an interview has exactly the kept old fields and the new ones').toEqual(sorted([...new Set([...KEPT, ...NEW_IV, ...INT01_IV])])); // INT01_IV: child lock int-01.1
    expect.soft(sorted(Object.keys(S['PanelEntry']?.properties ?? {})), 'PanelEntry: kind, person_id, name, feedback, due_at').toEqual(sorted([...PERSON_KEYS, ...INT01_ENTRY])); // INT01_ENTRY: child lock int-01.1
    expect.soft(sorted(S['PanelEntry']?.required ?? []), 'PanelEntry requires all but person_id').toEqual(GUEST_KEYS);
    const optional = [...KEPT, 'person_id', 'source', 'tenant_id', 'detail', 'from', 'to', 'by', 'by_kind', 'reason_code', 'reason', 'nextToken', 'PANEL_SPLIT_FLAG', 'PANEL_CONSENSUS', 'name', 'email', 'role',
      'closed_note', 'candidate_note', 'vote', 'no_feedback']; // the last four: child lock int-01.1 (shown only to some callers)
    expect.soft(looseObjects(d, { $ref: '#/components/schemas/InterviewList' }, 'InterviewList', new Set(), optional), 'every object of InterviewList closed').toEqual([]);
    const evItem = S['CandidateEvents']?.properties?.events?.items;
    const evSchema = evItem?.$ref ? S[String(evItem.$ref).split('/').pop()!] : evItem;
    expect.soft(evSchema?.properties?.detail?.additionalProperties, 'detail is the one open object').not.toBe(false);
    const { detail: _d, ...evRest } = evSchema?.properties ?? {};
    expect.soft(looseObjects(d, { ...evSchema, properties: evRest }, 'CandidateEvents event', new Set(), optional), 'every other object of CandidateEvents closed').toEqual([]);
    for (const k of ['by_name', 'at', 'kind']) expect.soft((evSchema?.required ?? []).includes(k), `an event requires ${k}`).toBe(true);
    // Planted answers.
    const ck = checker(d);
    const iv200 = answerSchema(d, INTERVIEWS, 200);
    const entry = { kind: 'PERSON', person_id: 'p', name: 'A Person', feedback: 'WAITING', due_at: NOW };
    const iv = { id: 'i', type: 'TECHNICAL', at: NOW, status: 'SCHEDULED', panel: [entry, { kind: 'GUEST', name: null, feedback: 'GIVEN', due_at: null }], votes: [], interviewId: 'i', panelMemberIds: ['p'],
      // child lock int-01.1: INT-01 rule 6's keys, as an old-way interview shows them.
      length_minutes: null, where: null, place: null, video_link: null, sequence: null, closed_reason: null, closed_by_name: null, closed_at: null,
      can: { reschedule: false, cancel: false, did_not_happen: false, mark_done: false, capture_feedback: false } };
    const good = { interviews: [iv], required: { done: 1, total: 2 } };
    expect.soft(ck.check(iv200, good), 'a right interviews answer passes').toEqual([]);
    expect.soft(ck.check(iv200, { interviews: [{ ...iv, status: 'CANCELLED' }], required: null }), 'CANCELLED and required null pass').toEqual([]);
    const bad: [string, unknown][] = [
      ['an extra key on an interview', { ...good, interviews: [{ ...iv, PK: 'x' }] }], ['tenant_id on an interview', { ...good, interviews: [{ ...iv, tenant_id: A }] }],
      ['PANEL_FEEDBACK_PENDING_COUNT', { ...good, interviews: [{ ...iv, PANEL_FEEDBACK_PENDING_COUNT: 2 }] }],
      ['a phone in an entry', { ...good, interviews: [{ ...iv, panel: [{ ...entry, phone: '0821234567' }] }] }], // child lock int-01.1: a guest entry may carry email (R-2), so the stray key is a phone
      ['a score in an entry', { ...good, interviews: [{ ...iv, panel: [{ ...entry, score: 4 }] }] }], ['a rating in an entry', { ...good, interviews: [{ ...iv, panel: [{ ...entry, rating: 'YES' }] }] }],
      ['a comment in an entry', { ...good, interviews: [{ ...iv, panel: [{ ...entry, comment: 'x' }] }] }],
      ['feedback DONE', { ...good, interviews: [{ ...iv, panel: [{ ...entry, feedback: 'DONE' }] }] }], ['kind PANEL', { ...good, interviews: [{ ...iv, panel: [{ ...entry, kind: 'PANEL' }] }] }],
      ['an entry with no name key', { ...good, interviews: [{ ...iv, panel: [{ kind: 'PERSON', person_id: 'p', feedback: 'GIVEN', due_at: null }] }] }],
      ['status PASSED', { ...good, interviews: [{ ...iv, status: 'PASSED' }] }], ['required with a third key', { ...good, required: { done: 1, total: 2, left: 1 } }],
      ['no required', { interviews: [iv] }], ['an extra top key', { ...good, total: 1 }],
    ];
    for (const [label, v] of bad) expect.soft(ck.check(iv200, v).length > 0, `${label} fails`).toBe(true);
    const ev200 = answerSchema(d, EVENTS, 200);
    const ev = { eventId: 'e', eventType: 'CandidateCreated', candidateId: 'c', actor: 'SYSTEM', timestamp: NOW, at: NOW, kind: 'CandidateCreated', by_name: null, detail: { anything: { goes: 1 } } };
    expect.soft(ck.check(ev200, { events: [ev], total: 1 }), 'a right history answer (detail open) passes').toEqual([]);
    const { by_name: _b, ...noName } = ev;
    for (const [label, v] of [['an extra key on an event', { events: [{ ...ev, email: 'x' }], total: 1 }], ['an event with no by_name', { events: [noName], total: 1 }], ['an extra top key', { events: [ev], total: 1, more: true }]] as [string, unknown][]) {
      expect.soft(ck.check(ev200, v).length > 0, `${label} fails`).toBe(true);
    }
    expect.soft(ck.check(answerSchema(d, INTERVIEWS, 404), NOT_FOUND), 'the interviews 404 body passes').toEqual([]);
    expect.soft(ck.check(answerSchema(d, EVENTS, 404), NOT_FOUND), 'the history 404 body passes').toEqual([]);
    const types = readFileSync(join(REPO, 'pepla-web', 'src', 'app', 'core', 'api', 'openapi.d.ts'), 'utf8');
    for (const n of ['InterviewList', 'PanelEntry', 'CandidateEvents']) expect.soft(new RegExp(`\\b${n}:\\s*\\{`).test(types), `openapi.d.ts has ${n} (npm run api:types)`).toBe(true);
  });

  // ---------------------------------------------------------------- AC-17 step D's lines and spec check D-9

  test('AC-17 Every AWS call both reads make, on every fixture, is one their roles hold; Terraform gives exactly the four lines, the two settings each, the SDK; no wildcard, no new role, policy or KMS line', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const t = world();
    const seen = new Set<string>();
    const runs: [Run, string][] = [];
    for (const [who, id] of [[R_, D.dee], [HM, D.dee], [P1, D.dee], [R_, D.big], [C.recruiterB, D.bee], [R_, Q.full], [HM, Q.full], [C.panelA, Q.full]] as [Caller, string][]) {
      runs.push([interviewsRun(who, id, t, legacyA), 'interviews'], [eventsRun(who, id, t, legacyA), 'events']);
    }
    for (const [r, which] of runs) {
      expect.soft(notAllowed(r, which as 'interviews' | 'events'), `${which}: only granted calls`).toEqual([]);
      for (const c of awsOf(r)) seen.add(`${which} ${c.service} ${c.op} ${c.table ?? ''}${c.input?.IndexName ? ' index ' + c.input.IndexName : ''}`.trim());
    }
    expect.soft([...seen], 'both reads look up names: Member rows on the tenants table, then the pool').toEqual(expect.arrayContaining([
      `interviews dynamodb Query ${TENANTS}`, 'interviews cognito AdminGetUser', `events dynamodb Query ${TENANTS}`, 'events cognito AdminGetUser',
    ]));
    // Terraform: the four lines, each once, only on the two existing policies.
    const baseline = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-15d', 'iam-a1e82c1', 'policies.json'), 'utf8')) as Record<string, { role: string; stack: string; pairs?: string[]; squash?: string }>;
    const now = policyLines();
    for (const k of new Set([...Object.keys(baseline), ...Object.keys(now)])) {
      const was = new Set(baseline[k]?.pairs ?? [`squashed ${baseline[k]?.squash}`]);
      const is = new Set(now[k]?.pairs ?? [`squashed ${now[k]?.squash}`]);
      const gained = [...is].filter((l) => !was.has(l) && !isInt01Grant(l, k)); // && isInt01Grant: child lock int-01.1 (INT-01's two request-key lines)
      const lost = [...was].filter((l) => !is.has(l));
      const want = REC15D_GRANTS[k];
      if (!baseline[k]) { expect.soft(gained, `${k}: a new policy gains nothing (D-9: no new policy, no new role)`).toEqual([]); continue; }
      if (want) {
        expect.soft(gained.filter((l) => !want.some((w) => w.test(l))), `${k}: gains only step D's two lines`).toEqual([]);
        expect.soft(want.map((w) => gained.filter((l) => w.test(l)).length), `${k}: each of the two, once`).toEqual([1, 1]);
        expect.soft(lost, `${k}: loses nothing`).toEqual([]);
      } else {
        // Child lock rec-15d.2 (REC-06): the two lines REC-06 gives manage_offers are REC-06's own (its AC-9 checks them exactly), not a step D change.
        const later = LATER_CARD_GRANTS[k] ?? [];
        expect.soft(gained.filter((l) => !later.some((w) => w.test(l))), `${k}: no new grant`).toEqual([]);
      }
    }
    // The new lines name one pool and one table each (the older lines of these policies, such as the events table's index/*, are not step D's).
    for (const k of Object.keys(REC15D_GRANTS)) for (const l of (now[k]?.pairs ?? []).filter((x) => !(baseline[k]?.pairs ?? []).includes(x))) expect.soft(l.split(' ')[2], `${k} ${l}: no wildcard`).not.toMatch(/\*/);
    expect.soft(Object.values(now).flatMap((v) => v.pairs ?? []).filter((l) => /cognito-idp:(AdminGetUser|\*)/.test(l) && / \*$|userpool\/\*/.test(l.split(' ').slice(2, 3).join(''))), 'no pool grant on every pool').toEqual([]);
    // The settings, from the right Terraform value each (R2-3).
    const fnOf = (name: string) => { const f = lambdaNamed(name)[0]; expect(f, `${name} is a Lambda in Terraform`).toBeTruthy(); return f!; };
    const si = fnOf('scheduleInterview');
    const ge = fnOf('getCandidateEvents');
    const sEnv = settingsOf(si.block);
    const gEnv = settingsOf(ge.block);
    expect.soft([si.stack, ge.stack], 'scheduleInterview is in talent-flow-infra, getCandidateEvents in infra').toEqual(['talent-flow-infra', 'infra']);
    expect.soft(['local.tf_naleko_pool_id', 'var.naleko_pool_id'], 'scheduleInterview: COGNITO_POOL_ID is the Naleko pool').toContain(sEnv.get('COGNITO_POOL_ID'));
    expect.soft(sEnv.get('LEGACY_TENANT_ID'), 'scheduleInterview: LEGACY_TENANT_ID = var.roles_legacy_tenant_id (R2-3)').toBe('var.roles_legacy_tenant_id');
    expect.soft(gEnv.get('COGNITO_POOL_ID'), 'getCandidateEvents: COGNITO_POOL_ID is the Naleko pool').toBe('aws_cognito_user_pool.naleko_dev.id');
    expect.soft(gEnv.get('LEGACY_TENANT_ID'), 'getCandidateEvents: LEGACY_TENANT_ID = var.legacy_tenant_id (R2-3)').toBe('var.legacy_tenant_id');
    expect.soft([!!sEnv.get('TENANTS_TABLE'), !!gEnv.get('TENANTS_TABLE')], 'both keep TENANTS_TABLE').toEqual([true, true]);
    expect.soft([roleResourceOf(si.block), roleResourceOf(ge.block)], 'both keep their own roles').toEqual(['schedule_interview', 'get_candidate_events']);
    // No KMS line: both roles were already in the PII key's read list, once each, and never in the encrypt list.
    const readList = kmsList('dynamodb_read_role_arns');
    const encList = kmsList('allowed_role_arns');
    expect.soft([(readList.match(/talent-flow-role-scheduleInterview"/g) ?? []).length, (readList.match(/aws_iam_role\.get_candidate_events\.arn/g) ?? []).length], 'each once in the read list').toEqual([1, 1]);
    expect.soft(/talent-flow-role-scheduleInterview"|aws_iam_role\.get_candidate_events\.arn/.test(encList), 'neither in the encrypt list').toBe(false);
    for (const stack of ['infra', 'talent-flow-infra'] as const) expect.soft(resourcesOf(stack, 'aws_dynamodb_table_item').length, `${stack}: no table item`).toBe(0);
    expect.soft(resourcesOf('infra', 'aws_iam_role').filter((b) => /getCandidateEvents/.test(b.body)).map((b) => b.labels[1]), 'no second role for getCandidateEvents').toEqual(['get_candidate_events']);
    // The SDK in both Lambdas (D-T-D8), and the handlers keep their company and module checks.
    for (const fn of ['scheduleInterview', 'getCandidateEvents']) {
      const pkg = JSON.parse(readFileSync(join(REPO, 'lambda', fn, 'package.json'), 'utf8'));
      expect.soft(!!({ ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>)['@aws-sdk/client-cognito-identity-provider'], `${fn}/package.json lists the Cognito SDK`).toBe(true);
      const lock = join(REPO, 'lambda', fn, 'package-lock.json');
      expect.soft(existsSync(lock) && readFileSync(lock, 'utf8').includes('"node_modules/@aws-sdk/client-cognito-identity-provider"'), `${fn}/package-lock.json has it`).toBe(true);
      const src = readFileSync(join(REPO, 'lambda', fn, 'index.js'), 'utf8');
      expect.soft(/requireTenant/.test(src) && /requireModule/.test(src) && /modules\.mjs/.test(src), `${fn} keeps requireTenant and requireModule`).toBe(true);
    }
    expect.soft(existsSync(join(REPO, 'lambda', 'shared', 'people-names.mjs')) && existsSync(join(REPO, 'lambda', 'shared', 'feedback-due.mjs')), 'lambda/shared/people-names.mjs and feedback-due.mjs exist (rules 24 and 25)').toBe(true);
  });

  // ---------------------------------------------------------------- standing line 11: the new grants on pepla-dev

  test('AC-17 on pepla-dev: the HR login opens the seeded interview and sees a person\'s name (the pool grant and the Member read work), and the history in the new shape; company B gets 404 @pepla-dev', async ({ page }, testInfo) => {
    // Runs in the dev workflow's "Company walk (TEN-04)" step, where E2E_HR_B is the walk company with Recruitment on (cards/rec-15d.md).
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-14 to AC-17.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(4 * 60_000);
    const env = (k: string) => process.env[k] ?? '';
    const login = (p: string) => ({ email: env(`${p}_EMAIL`), password: env(`${p}_PASSWORD`) });
    const logins = { hr: login('E2E_HR'), companyB: login('E2E_HR_B') };
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
    const [hr, companyB] = await Promise.all([signIn(logins.hr), signIn(logins.companyB)]);
    // The REC-07 dev seed's candidate and interview (support/rec-07/dev-ids.json): its panel is two seeded logins with given and family names.
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-07', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const cand = encodeURIComponent(ids['candidate']!);
    const iv = await page.request.get(`${tfApi}/v1/candidates/${cand}/interviews`, { headers: { Authorization: `Bearer ${hr}` } });
    const ivText = await iv.text();
    expect(iv.status(), `the HR login reads the seeded interviews (${ivText.slice(0, 200)})`).toBe(200);
    expect.soft(misfit(INTERVIEWS, { response: { statusCode: 200, body: ivText } } as any), 'the answer passes api/openapi.yaml').toEqual([]);
    const seeded = ((JSON.parse(ivText).interviews ?? []) as any[]).find((x) => x.id === ids['interview']);
    expect(seeded, 'the seeded interview is there').toBeTruthy();
    const named = ((seeded.panel ?? []) as any[]).filter((e) => e.kind === 'PERSON' && typeof e.name === 'string' && e.name.length > 0);
    expect.soft(named.length, 'at least one panel person has a name (a missing pool grant or Member read gives null names, not an error)').toBeGreaterThan(0);
    expect.soft('required' in JSON.parse(ivText), 'required is there').toBe(true);
    const ev = await page.request.get(`${tfApi}/v1/candidates/${cand}/events`, { headers: { Authorization: `Bearer ${hr}` } });
    const evText = await ev.text();
    expect(ev.status(), `the HR login reads the history (${evText.slice(0, 200)})`).toBe(200);
    expect.soft(misfit(EVENTS, { response: { statusCode: 200, body: evText } } as any), 'the history passes api/openapi.yaml').toEqual([]);
    const evList = (JSON.parse(evText).events ?? []) as any[];
    expect.soft(evList.every((e) => 'by_name' in e), 'every event has by_name').toBe(true);
    // Lock check round 1, F-1: at least one event by a person carries that person's name. The seed writes a stage row on this candidate
    // by a company A login (cards/rec-15d.md), so a missing pool grant, Member read, COGNITO_POOL_ID or LEGACY_TENANT_ID on
    // getCandidateEvents shows here as all-null names, not a silent pass.
    expect(evList.filter((e) => typeof e.by_name === 'string' && e.by_name.length > 0).length, 'at least one history event has a person\'s name (the history\'s pool grant and Member read work)').toBeGreaterThan(0);
    for (const path of ['interviews', 'events']) {
      const x = await page.request.get(`${tfApi}/v1/candidates/${cand}/${path}`, { headers: { Authorization: `Bearer ${companyB}` } });
      expect.soft(x.status(), `company B's HR on ${path}: 404`).toBe(404);
    }
  });
});
