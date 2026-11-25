import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { attributes, blocks } from './support/infra-harness';
import { STACKS, filesOf, lambdaNamed, localsOf, policyLines, resourcesOf, roleResourceOf, settingsOf, valueOf } from './support/rec-02/iam';
import { LAMBDA, REPO } from './support/rec-05/lambda-harness';
import {
  A, B, C, D, DAY, FORGED_HEADERS, FORGED_QUERY, K, LEGACY, LEGACY_SALARY, MIGRATE, NOW, OFFERS, ONE_OFFER_ROUTES, PERSON_IDS, R, ROLE_TITLE, S3_EMPTY, SUB, TABLE, UPLOAD_BUCKET,
  act, answer, asPerson, at, awsOf, bodyOf, candName, changed, create, dbOf, describe, eventsOf, fullName, get, isModulesRead, keysDeep, list, logsOf, migrate, monitor,
  newRows, offerRow, ok, oldCreate, oldGet, oldPut, patch, plain, poolUsers, rowsOf, sagaOf, statusOf, withRecruitmentOff, world, writesOf,
  type Caller, type Opts, type Run, type Tables,
} from './support/rec-05/world';
import type { S3World } from './support/rec-05/lambda-harness';

/**
 * REC-05 · Offer approval that finishes, and a send that needs it (red). Spec: /mnt/project-files/onboarding-cards/specs/REC-05.md
 * (rules 1 to 17, AC-1 to AC-15; updated 25 Nov for REC-UI-04). Notes: cards/rec-05.md. Review page:
 * onboarding-cards/specs/REC-05-tests-for-review.md (the bar).
 *
 * The Lambda tests run the real handlers (lambda/manageOffers, lambda/createOffer, lambda/advanceOfferState, lambda/getOffer,
 * lambda/monitorTalentFlowSLAs) and the script scripts/recruitment/migrate-offers.mjs in a fresh Node process each call, against this
 * card's fake AWS (support/rec-05/fake-aws, copied from REC-14's with code added only), over REC-02's companies with the real Standard
 * pack for A and B and this card's rows (support/rec-05/world.ts), at fixed times (REC-15's clock). Terraform is read as text. Nothing
 * calls AWS or any AI. Nothing here has a screen width: each test runs once, at 1280. AC-11 runs on pepla-dev only.
 *
 * Pinned by the verifier where the spec is silent (each is in cards/rec-05.md for the BA to confirm):
 *  - D-T-5.1 Every /v1/offers route (GET and POST /v1/offers; GET and PATCH /v1/offers/{id}; POST /v1/offers/{id}/submit, approve,
 *    send-back, send, answer, withdraw, signed-upload) is served by one new Lambda, lambda/manageOffers (Terraform
 *    aws_lambda_function.manage_offers, function name manageOffers, its own role aws_iam_role.manage_offers), on the talent-flow API with
 *    the JWT authoriser. The handler tells the routes apart by the route key. Expiry runs in monitorTalentFlowSLAs (rule 8).
 *  - D-T-5.2 Answers: 403 { error: 'Forbidden' }; 404 { error: 'Not found' }; 400 { error: 'Bad request', code } with
 *    code INVALID_FIELD and `field` for a bad or missing field of rule 2, 7 or 13 (NOTE_REQUIRED and INVALID_SIGNED_KEY as the spec
 *    names them); 409 { error: 'Conflict', code } with the spec's codes; 410 { error: 'OLD_ROUTE' } exactly as rule 17 writes it.
 *    A create answers 200 or 201; every other saved change 200. A create on a candidate that is not in Offer is 409 NOT_IN_OFFER
 *    (decision 25 Nov, lock check Q1). Any Recruiter of the company may submit (Q2). The withdraw route also takes SENT and then
 *    publishes OfferAnswered WITHDRAWN (F9). A failure answers 500 { error: 'Something went wrong' } with nothing changed.
 *  - D-T-5.3 The stored offer row (talent-flow-state) carries offer_id, tenant_id, state, version, drafted_by and, after a PATCH of an
 *    approved offer, approval_history. Its keys are the builder's. Rows other than the offer (history, audit) never carry the offer's
 *    state field under the name `state` together with `offer_id` and an SK that does not start with HISTORY.
 *  - D-T-5.4 Bodies: create { candidate_id, salary, currency?, start_date, expiry_date, benefits? } with dates as YYYY-MM-DD (a date
 *    "in the future" is after the day of NOW, Johannesburg or UTC alike at 08:00 UTC); approve { version }; send-back { version, note };
 *    PATCH { version, ...fields }; answer { answer, signed_key?, confirmed_start_date? }; withdraw { note? }; signed-upload
 *    { file_name, content_type, file_size } answering { upload_url, signed_key }.
 *  - D-T-5.5 One live offer per candidate: a candidate whose earlier offer is WITHDRAWN, DECLINED or EXPIRED may get a new one, so the
 *    offers are not keyed one per candidate.
 *  - D-T-5.6 The salary is "revealed" with ?reveal=salary; the answer then holds the number and salary_hidden false. The audit row of
 *    rule 9 may be in any table of the world; the tests find it by its fields (tenant_id, person_id, kind, offer_id, at).
 *  - D-T-5.7 The "approver tick" is held by a person who is in a sign-in group that carries perm-approve-offers (TEN-05's roles.mjs),
 *    CONFIRMED and enabled, with exactly one Member row, of this company (as REC-14's hiring manager list reads people).
 *  - D-T-5.8 History entries carry { from, to, by_kind, by_name, at, note? } in the answer (and kind: 'EDITED' with `fields` for an
 *    edit); `by` stays in the row. An expiry is by_kind 'system' with by_name null.
 *  - D-T-5.9 The list's newest-first order is by created_at, then offer_id.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const NOT_FOUND = { error: 'Not found' };
const FORBIDDEN = { error: 'Forbidden' };
const conflict = (code: string) => ({ error: 'Conflict', code });
const invalid = (field: string) => ({ error: 'Bad request', code: 'INVALID_FIELD', field });
const OLD_ROUTE = { error: 'OLD_ROUTE' };
const SALARY = 487250.75;
const START = '2027-01-04';
const EXPIRY = '2026-12-10';
const BENEFITS = 'Medical aid, a company phone and a fuel card.';
const draftBody = (candidate: string, extra: Record<string, unknown> = {}) => ({ candidate_id: candidate, salary: SALARY, start_date: START, expiry_date: EXPIRY, benefits: BENEFITS, ...extra });
const STATES = ['DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN'] as const;
type State = (typeof STATES)[number];
const AFTER_EXPIRY = '2026-12-11T08:00:00.000Z';
const ROW_FIELDS = ['offer_id', 'candidate_id', 'candidate_name', 'role_title', 'state', 'expires_at'];
const ONE_FIELDS = ['offer_id', 'candidate_id', 'candidate_name', 'role_title', 'department', 'state', 'version', 'start_date', 'expiry_date', 'benefits', 'currency', 'salary', 'salary_hidden', 'created_at', 'drafted_by_name', 'history', 'drafted_by_me', 'can_reveal_salary'];
const PDF = { file_name: 'Signed offer.pdf', content_type: 'application/pdf', file_size: 245_760 };

/** Every run made by the shared ladder and the tests, to look through all answers, events and log lines at once. */
const RUNS: { what: string; run: Run }[] = [];
const keep = (what: string, run: Run) => { RUNS.push({ what, run }); return run; };
/** Runs a step that must succeed; fails the test with the answer when it does not. */
function must(what: string, run: Run): Run {
  keep(what, run);
  expect(ok(run), `${what} (${describe(run)})`).toBe(true);
  return run;
}
const idOf = (r: Run) => bodyOf(r)?.offer_id as string;
const versionOf = (r: Run) => bodyOf(r)?.version as number;
/** Nothing changed: no row anywhere and no event, message, start or upload. */
function nothingDone(what: string, before: Tables, r: Run) {
  expect.soft(changed(before, r.tables), `${what}: no row changes`).toEqual([]);
  expect.soft(writesOf(r).map((c: any) => `${c.service} ${c.op}`), `${what}: nothing written, sent or started`).toEqual([]);
}
function refused(what: string, before: Tables, r: Run, status: number, body: unknown) {
  expect.soft(answer(r), `${what}: ${status} ${JSON.stringify(body)}`).toEqual([status, body]);
  nothingDone(what, before, r);
}

// ---------------------------------------------------------------- offers built through the routes

type Built = { t: Tables; id: string; version: number; candidate: string; s3: S3World; runs: Run[] };
/**
 * Takes one candidate's offer to `upTo` through the routes (each step at its own time from second n0), drafted by `drafter`, approved by
 * `approver`. ACCEPTED uploads a signed copy first; EXPIRED runs the hourly job after the expiry date.
 */
function build(t0: Tables, candidate: string, upTo: State | 'SENT_BACK', n0: number, o: { drafter?: Caller; approver?: Caller; s3?: S3World; body?: Record<string, unknown> } = {}): Built {
  const drafter = o.drafter ?? (candidate.includes('REC05B') ? C.recB : C.recA);
  const approver = o.approver ?? (candidate.includes('REC05B') ? C.apprB : C.apprA);
  const s3: S3World = structuredClone(o.s3 ?? S3_EMPTY);
  const runs: Run[] = [];
  const step = (what: string, r: Run) => { runs.push(must(`${what} (${candidate})`, r)); return r; };
  let r = step('draft', create(drafter, draftBody(candidate, o.body ?? {}), t0, { now: at(n0) }));
  const id = idOf(r);
  let t = r.tables;
  const go = (what: string, run: Run) => { r = step(what, run); t = r.tables; };
  if (upTo === 'WITHDRAWN') { go('withdraw', act(R.withdraw, drafter, id, { note: 'The role was put on hold.' }, t, { now: at(n0 + 1) })); return { t, id, version: versionOf(r), candidate, s3, runs }; }
  if (upTo === 'DRAFT') return { t, id, version: versionOf(r), candidate, s3, runs };
  go('submit', act(R.submit, drafter, id, {}, t, { now: at(n0 + 1) }));
  if (upTo === 'WAITING_APPROVAL') return { t, id, version: versionOf(r), candidate, s3, runs };
  if (upTo === 'SENT_BACK') { go('send back', act(R.sendBack, approver, id, { version: versionOf(r), note: 'Please check the start date with the depot.' }, t, { now: at(n0 + 2) })); return { t, id, version: versionOf(r), candidate, s3, runs }; }
  go('approve', act(R.approve, approver, id, { version: versionOf(r) }, t, { now: at(n0 + 2) }));
  if (upTo === 'APPROVED') return { t, id, version: versionOf(r), candidate, s3, runs };
  go('send', act(R.send, drafter, id, {}, t, { now: at(n0 + 3) }));
  if (upTo === 'SENT') return { t, id, version: versionOf(r), candidate, s3, runs };
  if (upTo === 'ACCEPTED') {
    const up = step('signed upload', act(R.upload, drafter, id, PDF, t, { now: at(n0 + 4) }));
    t = up.tables;
    s3.objects[bodyOf(up).signed_key] = { size: PDF.file_size, contentType: PDF.content_type };
    go('accept', act(R.answer, drafter, id, { answer: 'ACCEPTED', signed_key: bodyOf(up).signed_key, confirmed_start_date: START }, t, { now: at(n0 + 5), extra: { s3, cognito: { users: poolUsers() } } }));
  } else if (upTo === 'DECLINED') go('decline', act(R.answer, drafter, id, { answer: 'DECLINED' }, t, { now: at(n0 + 4) }));
  else if (upTo === 'EXPIRED') {
    const m = monitor(t, AFTER_EXPIRY);
    keep('expiry run', m);
    expect(m.error, `the hourly job runs (${m.error?.message})`).toBeUndefined();
    t = m.tables;
    runs.push(m);
  }
  return { t, id, version: versionOf(r), candidate, s3, runs };
}

/**
 * The shared ladder: one offer of company A in each of the eight states, plus a draft that was sent back (so it was submitted once),
 * and one offer of company B waiting for approval. Built once per worker, through the routes only.
 */
type Ladder = { t: Tables; id: Record<State | 'SENT_BACK' | 'B', string>; cand: Record<State | 'SENT_BACK' | 'B', string>; s3: S3World; created: string[] };
let ladderCache: Ladder | undefined;
function ladder(): Ladder {
  if (ladderCache) return ladderCache;
  let t = world();
  const id = {} as Ladder['id'];
  const cand = {} as Ladder['cand'];
  let s3 = structuredClone(S3_EMPTY);
  const plan: [State | 'SENT_BACK' | 'B', string, State | 'SENT_BACK'][] = [
    ['EXPIRED', K.a[7]!, 'EXPIRED'], ['DRAFT', K.a[0]!, 'DRAFT'], ['WAITING_APPROVAL', K.a[1]!, 'WAITING_APPROVAL'], ['APPROVED', K.a[2]!, 'APPROVED'],
    ['SENT', K.a[3]!, 'SENT'], ['ACCEPTED', K.a[4]!, 'ACCEPTED'], ['DECLINED', K.a[5]!, 'DECLINED'], ['WITHDRAWN', K.a[6]!, 'WITHDRAWN'],
    ['SENT_BACK', K.a[8]!, 'SENT_BACK'], ['B', K.b[0]!, 'WAITING_APPROVAL'],
  ];
  plan.forEach(([name, c, upTo], i) => {
    const b = build(t, c, upTo, i * 10, { s3 });
    t = b.t;
    s3 = b.s3;
    id[name] = b.id;
    cand[name] = c;
  });
  ladderCache = { t, id, cand, s3, created: plan.map(([name]) => id[name]) };
  return ladderCache;
}
/** The ladder's offers of company A, newest first (each was drafted ten seconds after the one before). */
const ladderA = (l: Ladder) => ['SENT_BACK', 'WITHDRAWN', 'DECLINED', 'ACCEPTED', 'SENT', 'APPROVED', 'WAITING_APPROVAL', 'DRAFT', 'EXPIRED'].map((s) => l.id[s as State]);
/** The ones submitted at least once (what an approver-only person may see): every one but the never-submitted draft and the draft withdrawn before submitting. */
const submittedA = (l: Ladder) => ladderA(l).filter((x) => x !== l.id.DRAFT && x !== l.id.WITHDRAWN);
const opts = (l: Ladder, o: Opts = {}): Opts => ({ ...o, extra: { s3: l.s3, cognito: { users: poolUsers() }, ...(o.extra ?? {}) } });

test.describe('REC-05 Offer approval that finishes, and a send that needs it', () => {
  // ---------------------------------------------------------------- control

  test('Control: the world is sound (candidates in Offer, both companies\' settings, old offer rows readable by today\'s route)', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(240_000);
    const t = world();
    expect.soft(sagaOf(t, K.a[0]!)['currentStage'], 'A\'s candidates are in Offer').toBe('OFFER');
    expect.soft(rowsOf(t, TABLE.config).filter((r) => r['tenant_id'] === B && r['configType'] === 'APPROVAL_RULES').length, 'company B has its Standard pack').toBe(1);
    expect.soft(rowsOf(t, TABLE.config).find((r) => r['tenant_id'] === A && r['configType'] === 'APPROVAL_RULES')?.['data'], 'company A approves with one approver').toEqual({ mode: 'ONE_APPROVER' });
    const r = oldGet(C.recA, K.l[2]!, t);
    expect.soft(statusOf(r), `today's GET /v1/candidates/{id}/offer reads an old row for a Recruiter (${describe(r)})`).toBe(200);
    expect.soft(oldGet(C.recB, K.l[2]!, t).response?.statusCode, 'and not for company B').toBe(404);
  });

  // ---------------------------------------------------------------- AC-1

  test('AC-1 Create: a Recruiter drafts from a candidate in Offer; every bad field is INVALID_FIELD; a second live offer is OFFER_EXISTS; the title comes from the role; body extras are ignored; no letter without a template', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(600_000);
    const t0 = world();
    // A good draft, with every field a caller might try to set besides the five.
    const extras = { role: 'Chief executive', role_title: 'Chief executive', positionTitle: 'Chief executive', tenantId: B, tenant_id: B, drafted_by: SUB.rec2A, drafted_by_name: 'Somebody Else', state: 'APPROVED', version: 9, approval: { approver_id: SUB.apprA }, offer_id: 'OFFER-CHOSEN-BY-CALLER', letter_text: 'A letter the caller wrote.' };
    const r = keep('create', create(C.recA, draftBody(K.a[10]!, extras), t0, { now: at(1) }));
    expect(ok(r), `a Recruiter drafts an offer for a candidate in Offer (${describe(r)})`).toBe(true);
    const b = bodyOf(r) ?? {};
    expect.soft(b.state, 'it is a draft').toBe('DRAFT');
    expect.soft(b.version, 'version 1').toBe(1);
    expect.soft(b.role_title, 'the title is the role\'s (REC-04), not the body\'s or the candidate\'s old positionTitle').toBe(ROLE_TITLE.ra);
    expect.soft(b.department, 'the department is the role\'s department by id, as the company names it now').toBe('Operations');
    expect.soft(b.candidate_name, 'the candidate\'s name is copied').toBe(candName(K.a[10]!));
    expect.soft([b.salary, b.salary_hidden], 'the answer never holds the salary').toEqual([null, true]);
    expect.soft([b.currency, b.start_date, b.expiry_date, b.benefits], 'currency ZAR by default, and the dates and benefits as sent').toEqual(['ZAR', START, EXPIRY, BENEFITS]);
    expect.soft([b.drafted_by_me, b.drafted_by_name], 'drafted by the caller').toEqual([true, fullName(SUB.recA)]);
    expect.soft(b.created_at, 'created at the time of the call').toBe(at(1));
    expect.soft(b.offer_id === 'OFFER-CHOSEN-BY-CALLER' || typeof b.offer_id !== 'string' || !b.offer_id, `the offer id is the system's (got ${b.offer_id})`).toBe(false);
    const row = offerRow(r.tables, b.offer_id) ?? {};
    expect.soft([row['tenant_id'], row['drafted_by'], row['state'], row['version']], 'stored as company A\'s draft by the caller, version 1, whatever the body said').toEqual([A, SUB.recA, 'DRAFT', 1]);
    expect.soft(row['letter_text'] ?? null, 'no letter: the company has no offer_letter template (D-REC-12.5)').toBeNull();
    expect.soft(JSON.stringify(row), 'nothing from the body\'s extras is stored').not.toMatch(/Chief executive|Somebody Else|A letter the caller wrote|OFFER-CHOSEN-BY-CALLER/);
    expect.soft(r.calls.filter((c: any) => c.service === 'sfn').map((c: any) => c.op), 'no state machine is started (rule 10)').toEqual([]);
    expect.soft(JSON.stringify(eventsOf(r)), 'no event carries the salary').not.toContain(String(SALARY));

    // A second live offer on the same candidate.
    const twice = create(C.rec2A, draftBody(K.a[10]!), r.tables, { now: at(2) });
    refused('a second draft for the same candidate', r.tables, twice, 409, conflict('OFFER_EXISTS'));
    const l = ladder();
    for (const s of ['WAITING_APPROVAL', 'APPROVED', 'SENT'] as const) refused(`a new draft while the candidate's offer is ${s}`, l.t, create(C.recA, draftBody(l.cand[s]), l.t, opts(l, { now: at(500) })), 409, conflict('OFFER_EXISTS'));
    // A candidate whose offer ended may get a new one (D-T-5.5).
    for (const s of ['WITHDRAWN', 'DECLINED', 'EXPIRED'] as const) {
      const again = keep(`new draft after ${s}`, create(C.recA, draftBody(l.cand[s]), l.t, opts(l, { now: at(501) })));
      expect.soft(ok(again), `a new draft for a candidate whose offer is ${s} (${describe(again)})`).toBe(true);
      expect.soft(bodyOf(again)?.offer_id !== l.id[s], 'it is a new offer').toBe(true);
    }

    // Each bad or missing field: 400 INVALID_FIELD naming it, nothing written.
    const c = K.a[11]!;
    const bad: [string, string, Record<string, unknown>][] = [
      ['salary', 'missing', { salary: undefined }], ['salary', '0', { salary: 0 }], ['salary', 'negative', { salary: -5 }], ['salary', 'as text', { salary: '487250.75' }],
      ['salary', 'three decimals', { salary: 50000.555 }], ['salary', '13 digits', { salary: 1234567890123 }], ['salary', 'null', { salary: null }],
      ['currency', 'two letters', { currency: 'ZA' }], ['currency', 'five letters', { currency: 'RANDS' }], ['currency', 'digits', { currency: '710' }], ['currency', 'a number', { currency: 710 }],
      ['start_date', 'missing', { start_date: undefined }], ['start_date', 'in the past', { start_date: '2026-11-01' }], ['start_date', 'not a day', { start_date: '2027-02-30' }],
      ['start_date', 'another format', { start_date: '04/01/2027' }], ['start_date', 'a number', { start_date: 20270104 }],
      ['expiry_date', 'missing', { expiry_date: undefined }], ['expiry_date', 'in the past', { expiry_date: '2026-11-20' }], ['expiry_date', 'after the start date', { expiry_date: '2027-01-05' }],
      ['expiry_date', 'not a day', { expiry_date: '2026-13-01' }],
      ['benefits', '2001 characters', { benefits: 'b'.repeat(2001) }], ['benefits', 'a number', { benefits: 5 }],
      ['candidate_id', 'missing', { candidate_id: undefined }], ['candidate_id', 'not an id', { candidate_id: 'CAND-<script>' }], ['candidate_id', 'a number', { candidate_id: 7 }],
    ];
    for (const [field, what, change] of bad) {
      const body: Record<string, unknown> = { ...draftBody(c), ...change };
      for (const k of Object.keys(change)) if (change[k] === undefined) delete body[k];
      refused(`${field} ${what}`, t0, create(C.recA, body, t0, { now: at(3) }), 400, invalid(field));
    }
    // The edges that are allowed, each on its own candidate.
    const good: [string, Record<string, unknown>, (b: any) => unknown, unknown][] = [
      ['salary with 12 digits', { salary: 123456789012 }, (x) => x.state, 'DRAFT'],
      ['salary with two decimals', { salary: 50000.55 }, (x) => x.state, 'DRAFT'],
      ['the expiry date on the start date', { expiry_date: START }, (x) => x.expiry_date, START],
      ['2000 characters of benefits', { benefits: 'b'.repeat(2000) }, (x) => x.benefits?.length, 2000],
      ['no benefits and another currency', { benefits: undefined, currency: 'USD' }, (x) => x.currency, 'USD'],
    ];
    good.forEach(([what, change, pick, want], i) => {
      const body: Record<string, unknown> = { ...draftBody(K.a[12 + i]!), ...change };
      for (const k of Object.keys(change)) if (change[k] === undefined) delete body[k];
      const g = keep(what, create(C.recA, body, t0, { now: at(4) }));
      expect.soft(ok(g) ? pick(bodyOf(g)) : describe(g), `${what} is allowed`).toEqual(want);
    });

    // The candidate must be in Offer, and the company's.
    for (const [what, id] of [['in Applied', K.applied], ['Hired', K.hired], ['Not hired', K.notHired]] as const) {
      const x = create(C.recA, draftBody(id), t0, { now: at(5) });
      expect.soft(answer(x), `a candidate ${what}: 409 NOT_IN_OFFER (decision 25 Nov, Q1)`).toEqual([409, conflict('NOT_IN_OFFER')]);
      nothingDone(`a candidate ${what}`, t0, x);
    }
    const other = create(C.recA, draftBody(K.b[1]!), t0, { now: at(5) });
    const ghost = create(C.recA, draftBody('CAND-REC05AGH000000000000000001'), t0, { now: at(5) });
    refused('company B\'s candidate', t0, other, 404, NOT_FOUND);
    refused('a candidate that does not exist', t0, ghost, 404, NOT_FOUND);

    // Who may create: a Recruiter only, refused before any AWS call.
    for (const who of [C.apprA, C.hmA, C.adminA, C.empA, C.guestA, C.hrNoTickA]) {
      const x = create(who, draftBody(K.a[10]!), t0, { now: at(6) });
      expect.soft([...answer(x), awsOf(x).length], `${who.name}: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 Drafter cannot approve: a person with both ticks (and Admin) who drafted gets 403 on approve and send-back; a different approver passes; a Recruiter without the approver tick gets 403', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const w = build(world(), K.a[17]!, 'WAITING_APPROVAL', 0, { drafter: C.bothA });
    const v = w.version;
    refused('the drafter (both ticks, Admin) approves', w.t, act(R.approve, C.bothA, w.id, { version: v }, w.t, { now: at(10) }), 403, FORBIDDEN);
    refused('the drafter sends back', w.t, act(R.sendBack, C.bothA, w.id, { version: v, note: 'Mine to fix.' }, w.t, { now: at(10) }), 403, FORBIDDEN);
    // The drafter is the person id of the sign-in: the same person with other ticks or names in the body is still refused.
    refused('the drafter, naming another person in the body', w.t, act(R.approve, C.bothA, w.id, { version: v, approver_id: SUB.apprA, drafted_by: SUB.apprA }, w.t, { now: at(10) }), 403, FORBIDDEN);
    for (const who of [C.recA, C.rec2A, C.hmA, C.adminA, C.empA]) {
      const x = act(R.approve, who, w.id, { version: v }, w.t, { now: at(11) });
      expect.soft([...answer(x), awsOf(x).length], `${who.name} approves: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
      const y = act(R.sendBack, who, w.id, { version: v, note: 'No.' }, w.t, { now: at(11) });
      expect.soft([...answer(y), awsOf(y).length], `${who.name} sends back: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }
    const okRun = keep('approve', act(R.approve, C.apprA, w.id, { version: v }, w.t, { now: at(12) }));
    expect.soft([statusOf(okRun), bodyOf(okRun)?.state], `a different approver approves (${describe(okRun)})`).toEqual([200, 'APPROVED']);
    // A different person who holds both ticks may approve an offer they did not draft.
    const w2 = build(world(), K.a[18]!, 'WAITING_APPROVAL', 20);
    const both = keep('approve by bothA', act(R.approve, C.bothA, w2.id, { version: w2.version }, w2.t, { now: at(30) }));
    expect.soft([statusOf(both), bodyOf(both)?.state], `a person with both ticks approves an offer someone else drafted (${describe(both)})`).toEqual([200, 'APPROVED']);
  });

  test('AC-2 Submit and withdraw by the wrong person: only a Recruiter of the company, 403 before any AWS call for anyone else; company B 404; any Recruiter may submit, not only the drafter (decision 25 Nov, Q2)', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    const d = build(world(), K.a[26]!, 'DRAFT', 0);
    const ROUTES2: [string, Record<string, unknown>][] = [[R.submit, {}], [R.withdraw, { note: 'Not this one.' }]];
    for (const who of [C.apprA, C.hmA, C.hm2A, C.adminA, C.empA, C.guestA, C.hrNoTickA, C.apprB]) {
      for (const [route, body] of ROUTES2) {
        const x = act(route, who, d.id, body, d.t, { now: at(5) });
        expect.soft([...answer(x), awsOf(x).length], `${who.name} on ${route}: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
        nothingDone(`${who.name} on ${route}`, d.t, x);
      }
    }
    for (const [route, body] of ROUTES2) {
      refused(`company B's Recruiter on ${route} of A's draft`, d.t, act(route, C.recB, d.id, body, d.t, { now: at(6) }), 404, NOT_FOUND);
      const off = act(route, C.recD, d.id, body, d.t, { now: at(6) });
      expect.soft(answer(off), `${route}, a Recruiter of D (Recruitment off): 403`).toEqual([403, FORBIDDEN]);
      expect.soft(awsOf(off).filter((c) => !isModulesRead(c)).map((c: any) => `${c.service} ${c.op}`), `${route}, Recruitment off: only the module read`).toEqual([]);
      const none = act(route, C.recNone, d.id, body, d.t, { now: at(6) });
      expect.soft([...answer(none), awsOf(none).length], `${route}, a Recruiter with no company: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }
    // Any Recruiter of the company may submit (D-REC-5.7, REC-UI-04); the drafter still cannot approve it.
    const s2 = must('submit by a second Recruiter, not the drafter', act(R.submit, C.rec2A, d.id, {}, d.t, { now: at(7) }));
    expect.soft([bodyOf(s2)?.state, bodyOf(s2)?.submitted_at], 'a second Recruiter submits: WAITING_APPROVAL').toEqual(['WAITING_APPROVAL', at(7)]);
    const db = build(world(), K.a[27]!, 'DRAFT', 10, { drafter: C.bothA });
    const s3 = must('submit by recA of bothA\'s draft', act(R.submit, C.recA, db.id, {}, db.t, { now: at(20) }));
    refused('the drafter approves after someone else submitted', s3.tables, act(R.approve, C.bothA, db.id, { version: versionOf(s3) }, s3.tables, { now: at(21) }), 403, FORBIDDEN);
    // Any Recruiter may withdraw too.
    const w2 = must('withdraw by a second Recruiter', act(R.withdraw, C.rec2A, d.id, {}, s2.tables, { now: at(8) }));
    expect.soft(bodyOf(w2)?.state, 'withdrawn by a second Recruiter').toBe('WITHDRAWN');
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 Submit, approve and send back: submit needs another approver; approve stores the approval; send-back needs a note, returns to DRAFT and keeps the note; editing an approved offer returns it to DRAFT', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const t0 = world();
    const d = build(t0, K.a[19]!, 'DRAFT', 0);
    // No approver but the drafter in the company (D-T-5.7): NO_APPROVER, nothing changes. B's approver does not count for A.
    const onlyB = poolUsers().filter((u) => ![SUB.apprA, SUB.bothA].includes(u.sub));
    refused('submit with no approver in company A (B has one)', d.t, act(R.submit, C.recA, d.id, {}, d.t, { now: at(1), extra: { cognito: { users: onlyB }, s3: S3_EMPTY } }), 409, conflict('NO_APPROVER'));
    const dBoth = build(t0, K.a[20]!, 'DRAFT', 2, { drafter: C.bothA });
    const onlyDrafter = poolUsers().filter((u) => u.sub !== SUB.apprA);
    refused('submit when the only approver of A is the drafter', dBoth.t, act(R.submit, C.bothA, dBoth.id, {}, dBoth.t, { now: at(3), extra: { cognito: { users: onlyDrafter }, s3: S3_EMPTY } }), 409, conflict('NO_APPROVER'));
    // A disabled approver, or one whose Member row is another company's, is nobody's approver.
    const disabled = poolUsers().filter((u) => u.sub !== SUB.bothA).map((u) => (u.sub === SUB.apprA ? { ...u, enabled: false } : u));
    refused('submit when A\'s only other approver is disabled', d.t, act(R.submit, C.recA, d.id, {}, d.t, { now: at(1), extra: { cognito: { users: disabled }, s3: S3_EMPTY } }), 409, conflict('NO_APPROVER'));
    // Approve before submit: refused, nothing written.
    const early = act(R.approve, C.apprA, d.id, { version: d.version }, d.t, { now: at(4) });
    expect.soft([statusOf(early), bodyOf(early)?.error], 'approve of a draft that was not submitted: 409').toEqual([409, 'Conflict']);
    nothingDone('approve before submit', d.t, early);
    // Submit, then approve.
    const s = must('submit', act(R.submit, C.recA, d.id, {}, d.t, { now: at(5) }));
    expect.soft([bodyOf(s)?.state, bodyOf(s)?.submitted_at], 'submit: WAITING_APPROVAL, submitted_at recorded').toEqual(['WAITING_APPROVAL', at(5)]);
    const a = must('approve', act(R.approve, C.apprA, d.id, { version: versionOf(s) }, s.tables, { now: at(6) }));
    expect.soft(bodyOf(a)?.state, 'approve: APPROVED').toBe('APPROVED');
    expect.soft(bodyOf(a)?.approval, 'the approval: who by name, when, one approver').toEqual({ approver_name: fullName(SUB.apprA), at: at(6), mode: 'ONE_APPROVER' });
    expect.soft(offerRow(a.tables, d.id)?.['approval']?.['approver_id'], 'the row keeps the approver\'s person id').toBe(SUB.apprA);
    const hist = (bodyOf(get(C.recA, d.id, a.tables, { now: at(7) }))?.history ?? []) as any[];
    expect.soft(hist.map((h) => [h.from, h.to, h.by_name]), 'history: draft, submit, approve, each with who').toEqual([[null, 'DRAFT', fullName(SUB.recA)], ['DRAFT', 'WAITING_APPROVAL', fullName(SUB.recA)], ['WAITING_APPROVAL', 'APPROVED', fullName(SUB.apprA)]].map((x, i) => (i === 0 ? [hist[0]?.from ?? null, x[1], x[2]] : x)));

    // Send back: a note of 1 to 1000 characters.
    const w = build(t0, K.a[21]!, 'WAITING_APPROVAL', 10);
    for (const [what, note] of [['no note', undefined], ['an empty note', ''], ['spaces only', '   '], ['1001 characters', 'n'.repeat(1001)], ['a number', 5]] as const) {
      const body: Record<string, unknown> = { version: w.version, ...(note === undefined ? {} : { note }) };
      refused(`send back with ${what}`, w.t, act(R.sendBack, C.apprA, w.id, body, w.t, { now: at(20) }), 400, { error: 'Bad request', code: 'NOTE_REQUIRED' });
    }
    const NOTE = `${'Check the start date. '.repeat(45)}`.slice(0, 1000);
    const back = must('send back', act(R.sendBack, C.apprA, w.id, { version: w.version, note: NOTE }, w.t, { now: at(21) }));
    expect.soft(bodyOf(back)?.state, 'send-back returns it to DRAFT').toBe('DRAFT');
    expect.soft(bodyOf(back)?.approval ?? null, 'with no approval on it').toBeNull();
    const lastH = ((bodyOf(back)?.history ?? []) as any[]).at(-1) ?? {};
    expect.soft([lastH.from, lastH.to, lastH.by_name, lastH.note], 'history keeps the note and who sent it back').toEqual(['WAITING_APPROVAL', 'DRAFT', fullName(SUB.apprA), NOTE]);
    const kept = JSON.stringify(offerRow(back.tables, w.id)?.['approval_history'] ?? null);
    expect.soft(kept.includes(NOTE.slice(0, 40)) && kept.includes(SUB.apprA), 'approval_history keeps the note and who').toBe(true);
    // It may be submitted again, and an approved offer that is edited goes back to DRAFT (rule 15; AC-14 judges the rest).
    const again = must('submit again', act(R.submit, C.recA, w.id, {}, back.tables, { now: at(22) }));
    const ap = must('approve', act(R.approve, C.apprA, w.id, { version: versionOf(again) }, again.tables, { now: at(23) }));
    const ed = must('edit approved', patch(C.recA, w.id, { version: versionOf(ap), salary: 490000 }, ap.tables, { now: at(24) }));
    expect.soft([bodyOf(ed)?.state, bodyOf(ed)?.approval ?? null], 'editing an approved offer returns it to DRAFT with no approval').toEqual(['DRAFT', null]);
  });

  test('AC-3 Wrong state: submit from anything but DRAFT, approve and send-back from anything but WAITING_APPROVAL are 409 with nothing written, even with the right version', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    const l = ladder();
    const vOf = (s: State | 'SENT_BACK') => bodyOf(get(C.recA, l.id[s], l.t, opts(l, { now: at(1500) })))?.version as number;
    const is409 = (what: string, x: Run) => {
      expect.soft([statusOf(x), bodyOf(x)?.error], `${what}: 409 Conflict (${describe(x)})`).toEqual([409, 'Conflict']);
      nothingDone(what, l.t, x);
    };
    for (const s of ['WAITING_APPROVAL', 'APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'] as const) {
      is409(`submit from ${s}`, act(R.submit, C.recA, l.id[s], {}, l.t, opts(l, { now: at(1501) })));
    }
    // bothA did not draft these and holds both ticks, so only the state can refuse.
    for (const s of ['DRAFT', 'SENT_BACK', 'APPROVED', 'SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'] as const) {
      const v = vOf(s);
      expect.soft(Number.isInteger(v), `${s}: its version is read`).toBe(true);
      is409(`approve from ${s}`, act(R.approve, C.bothA, l.id[s], { version: v }, l.t, opts(l, { now: at(1502) })));
      is409(`send back from ${s}`, act(R.sendBack, C.bothA, l.id[s], { version: v, note: 'Please look again.' }, l.t, opts(l, { now: at(1503) })));
    }
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Send needs approval: DRAFT, WAITING_APPROVAL and a sent-back offer are NOT_APPROVED; APPROVED becomes SENT with OfferSent and no salary; no email is queued', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const l = ladder();
    for (const s of ['DRAFT', 'WAITING_APPROVAL', 'SENT_BACK'] as const) refused(`send from ${s}`, l.t, act(R.send, C.recA, l.id[s], {}, l.t, opts(l, { now: at(600) })), 409, conflict('NOT_APPROVED'));
    for (const s of ['SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'] as const) refused(`send from ${s}`, l.t, act(R.send, C.recA, l.id[s], {}, l.t, opts(l, { now: at(600) })), 409, conflict('NOT_APPROVED'));
    for (const who of [C.apprA, C.hmA, C.adminA]) {
      const x = act(R.send, who, l.id.APPROVED, {}, l.t, opts(l, { now: at(601) }));
      expect.soft([...answer(x), awsOf(x).length], `${who.name} sends: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }
    const sent = must('send', act(R.send, C.rec2A, l.id.APPROVED, {}, l.t, opts(l, { now: at(602) })));
    expect.soft([bodyOf(sent)?.state, bodyOf(sent)?.sent_at, bodyOf(sent)?.salary], 'APPROVED becomes SENT, sent_at recorded, salary null in the answer').toEqual(['SENT', at(602), null]);
    const ev = eventsOf(sent);
    expect.soft(ev.map((e: any) => e.detailType), 'one event: OfferSent').toEqual(['OfferSent']);
    expect.soft(ev[0]?.detail, 'OfferSent holds exactly tenant_id, offer_id, candidate_id, role_id, at (no salary)').toEqual({ tenant_id: A, offer_id: l.id.APPROVED, candidate_id: l.cand.APPROVED, role_id: K.ra, at: at(602) });
    const outside = sent.calls.filter((c: any) => /^(sqs|ses|lambda|http|postmark|sfn|cognito-send)$/.test(c.service)).map((c: any) => `${c.service} ${c.op ?? ''}`);
    expect.soft(outside, 'nothing is emailed, queued, invoked or started (W-R6)').toEqual([]);
    refused('send again', sent.tables, act(R.send, C.recA, l.id.APPROVED, {}, sent.tables, opts(l, { now: at(603) })), 409, conflict('NOT_APPROVED'));
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 Answers: accept needs a signed copy of this offer and company and a start date; decline and withdraw work; withdraw from earlier states; nothing from a final state; the candidate stays in Offer', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    const l = ladder();
    const sent = l.id.SENT;
    const t = l.t;
    const up = must('signed upload', act(R.upload, C.recA, sent, PDF, t, opts(l, { now: at(700) })));
    const key = bodyOf(up)?.signed_key as string;
    const t1 = up.tables;
    const withObject = (keys: string[]): S3World => ({ bucket: UPLOAD_BUCKET, objects: { ...l.s3.objects, ...Object.fromEntries(keys.map((k) => [k, { size: 1000, contentType: 'application/pdf' }])) } });
    const answerWith = (body: unknown, s3: S3World, n: number) => act(R.answer, C.recA, sent, body, t1, { now: at(n), extra: { s3, cognito: { users: poolUsers() } } });
    const BAD_KEY = { error: 'Bad request', code: 'INVALID_SIGNED_KEY' };
    // Not uploaded yet (the HEAD check fails).
    refused('accept with a key that was never uploaded', t1, answerWith({ answer: 'ACCEPTED', signed_key: key, confirmed_start_date: START }, l.s3, 701), 400, BAD_KEY);
    // Another offer's key and company B's prefix, even when such objects exist.
    const otherOffer = `recruitment/${A}/offers/${l.id.APPROVED}/01REC05OTHEROFFER0000000000`;
    const otherCompany = `recruitment/${B}/offers/${sent}/01REC05OTHERCOMPANY00000000`;
    const sideways = `recruitment/${A}/offers/${sent}/../${l.id.APPROVED}/x`;
    for (const [what, k] of [['another offer\'s key', otherOffer], ['a key under company B', otherCompany], ['a key that climbs out', sideways], ['an onboarding upload key', `uploads/emp-1/NATIONAL_ID/doc-1_id.pdf`]] as const) {
      refused(`accept with ${what}`, t1, answerWith({ answer: 'ACCEPTED', signed_key: k, confirmed_start_date: START }, withObject([k, key]), 702), 400, BAD_KEY);
    }
    const s3 = withObject([key]);
    for (const [what, body] of [['no signed_key', { answer: 'ACCEPTED', confirmed_start_date: START }], ['no confirmed_start_date', { answer: 'ACCEPTED', signed_key: key }], ['a start date that is not a day', { answer: 'ACCEPTED', signed_key: key, confirmed_start_date: '2027-13-01' }], ['an unknown answer', { answer: 'MAYBE' }], ['no answer', {}]] as const) {
      const x = answerWith(body, s3, 703);
      expect.soft(statusOf(x), `accept with ${what}: 400`).toBe(400);
      nothingDone(`accept with ${what}`, t1, x);
    }
    for (const who of [C.apprA, C.hmA, C.adminA]) {
      const x = act(R.answer, who, sent, { answer: 'DECLINED' }, t1, opts(l, { now: at(704) }));
      expect.soft([...answer(x), awsOf(x).length], `${who.name} records an answer: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }
    const acc = must('accept', answerWith({ answer: 'ACCEPTED', signed_key: key, confirmed_start_date: START }, s3, 705));
    expect.soft([bodyOf(acc)?.state, bodyOf(acc)?.answered_at], 'ACCEPTED, answered_at recorded').toEqual(['ACCEPTED', at(705)]);
    expect.soft(JSON.stringify(offerRow(acc.tables, sent) ?? {}), 'the row keeps the signed copy\'s key').toContain(key);
    expect.soft(offerRow(acc.tables, sent)?.['answered_by'], 'and who recorded the answer').toBe(SUB.recA);
    expect.soft(eventsOf(acc).map((e: any) => e.detail), 'OfferAnswered { tenant_id, offer_id, candidate_id, answer }').toEqual([{ tenant_id: A, offer_id: sent, candidate_id: l.cand.SENT, answer: 'ACCEPTED' }]);
    expect.soft(eventsOf(acc).map((e: any) => e.detailType), 'the event is OfferAnswered').toEqual(['OfferAnswered']);
    // Until REC-06 an accepted offer changes nothing on the candidate.
    expect.soft(JSON.stringify(sagaOf(acc.tables, l.cand.SENT)), 'the candidate row is unchanged (still in Offer)').toBe(JSON.stringify(sagaOf(t1, l.cand.SENT)));
    expect.soft(acc.calls.filter((c: any) => c.service === 's3').map((c: any) => `${c.op} ${c.key}`), 'the only S3 call is the HEAD of the signed copy').toEqual([`HeadObject ${key}`]);

    // Decline and withdraw from SENT need no document.
    for (const [ans, n] of [['DECLINED', 710], ['WITHDRAWN', 711]] as const) {
      const x = must(`answer ${ans}`, act(R.answer, C.recA, sent, { answer: ans }, t, opts(l, { now: at(n) })));
      expect.soft([bodyOf(x)?.state, eventsOf(x).map((e: any) => e.detail?.answer)], `${ans}: the state and the event`).toEqual([ans, [ans]]);
      expect.soft(sagaOf(x.tables, l.cand.SENT)['currentStage'], `${ans}: the candidate stays in Offer`).toBe('OFFER');
    }
    // Withdraw from SENT through the withdraw route (decision 25 Nov, F9: the offer screen does this): WITHDRAWN with OfferAnswered, the candidate freed.
    const wd = must('withdraw from SENT', act(R.withdraw, C.rec2A, sent, { note: 'The candidate took another job.' }, t, opts(l, { now: at(715) })));
    expect.soft(bodyOf(wd)?.state, 'withdraw from SENT: WITHDRAWN').toBe('WITHDRAWN');
    expect.soft(eventsOf(wd).map((e: any) => [e.detailType, e.detail]), 'one OfferAnswered WITHDRAWN, no salary').toEqual([['OfferAnswered', { tenant_id: A, offer_id: sent, candidate_id: l.cand.SENT, answer: 'WITHDRAWN' }]]);
    expect.soft(sagaOf(wd.tables, l.cand.SENT)['currentStage'], 'withdraw from SENT: the candidate stays in Offer').toBe('OFFER');
    const fresh = keep('a new draft after the withdraw', create(C.recA, draftBody(l.cand.SENT), wd.tables, opts(l, { now: at(716) })));
    expect.soft(ok(fresh), `the candidate may get a new offer after a withdraw from SENT (${describe(fresh)})`).toBe(true);
    // Withdraw from DRAFT, WAITING_APPROVAL and APPROVED, with an optional note.
    for (const s of ['DRAFT', 'WAITING_APPROVAL', 'APPROVED'] as const) {
      const x = must(`withdraw from ${s}`, act(R.withdraw, C.rec2A, l.id[s], s === 'APPROVED' ? {} : { note: 'The role is on hold.' }, t, opts(l, { now: at(712) })));
      expect.soft(bodyOf(x)?.state, `withdraw from ${s}: WITHDRAWN`).toBe('WITHDRAWN');
    }
    // Nothing from a final state, and answer only from SENT.
    for (const s of ['ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'] as const) {
      refused(`answer on ${s}`, t, act(R.answer, C.recA, l.id[s], { answer: 'DECLINED' }, t, opts(l, { now: at(713) })), 409, conflict('NOT_SENT'));
      const w = act(R.withdraw, C.recA, l.id[s], {}, t, opts(l, { now: at(713) }));
      expect.soft([statusOf(w), bodyOf(w)?.error], `withdraw on ${s}: 409`).toEqual([409, 'Conflict']);
      nothingDone(`withdraw on ${s}`, t, w);
    }
    for (const s of ['DRAFT', 'WAITING_APPROVAL', 'APPROVED'] as const) refused(`answer on ${s}`, t, act(R.answer, C.recA, l.id[s], { answer: 'DECLINED' }, t, opts(l, { now: at(714) })), 409, conflict('NOT_SENT'));
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 Expiry: a SENT offer past its expiry date becomes EXPIRED once, with the event; approved, draft and not-yet-expired offers are not touched; a company with Recruitment off is skipped', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    let t = world();
    const sentA = build(t, K.a[22]!, 'SENT', 0); t = sentA.t;
    const later = build(t, K.a[23]!, 'SENT', 10, { body: { expiry_date: '2026-12-20', start_date: '2027-01-10' } }); t = later.t;
    const approved = build(t, K.a[24]!, 'APPROVED', 20); t = approved.t;
    const draft = build(t, K.a[25]!, 'DRAFT', 30); t = draft.t;
    const sentB = build(t, K.b[2]!, 'SENT', 40); t = sentB.t;
    // Offers that are past the date but not SENT: never touched (F4).
    const accepted = build(t, K.a[13]!, 'ACCEPTED', 50); t = accepted.t;
    const declined = build(t, K.a[14]!, 'DECLINED', 60); t = declined.t;
    const withdrawn = build(t, K.a[15]!, 'WITHDRAWN', 70); t = withdrawn.t;
    const waiting = build(t, K.a[16]!, 'WAITING_APPROVAL', 80); t = waiting.t;
    const before = t;
    const m = keep('expiry run', monitor(t, AFTER_EXPIRY));
    expect(m.error, `the hourly job runs (${m.error?.message})`).toBeUndefined();
    const stateOf = (tt: Tables, id: string) => offerRow(tt, id)?.['state'];
    expect.soft([sentA.id, sentB.id].map((x) => stateOf(m.tables, x)), 'both companies\' SENT offers past the date: EXPIRED').toEqual(['EXPIRED', 'EXPIRED']);
    expect.soft([later.id, approved.id, draft.id].map((x) => stateOf(m.tables, x)), 'a SENT offer not yet past, an APPROVED one and a DRAFT one: untouched').toEqual(['SENT', 'APPROVED', 'DRAFT']);
    for (const x of [later.id, approved.id, draft.id]) expect.soft(JSON.stringify(offerRow(m.tables, x)), `${x}: the row did not change`).toBe(JSON.stringify(offerRow(before, x)));
    for (const [what, x] of [['ACCEPTED', accepted.id], ['DECLINED', declined.id], ['WITHDRAWN', withdrawn.id], ['WAITING_APPROVAL', waiting.id]] as const) {
      expect.soft(JSON.stringify(offerRow(m.tables, x)), `an offer ${what} past its expiry date: the row did not change`).toBe(JSON.stringify(offerRow(before, x)));
    }
    const ev = eventsOf(m, 'OfferAnswered').map((e: any) => e.detail).sort((a: any, b: any) => String(a.offer_id).localeCompare(String(b.offer_id)));
    expect.soft(ev, 'one OfferAnswered EXPIRED for each, carrying its own company').toEqual([
      { tenant_id: A, offer_id: sentA.id, candidate_id: sentA.candidate, answer: 'EXPIRED' }, { tenant_id: B, offer_id: sentB.id, candidate_id: sentB.candidate, answer: 'EXPIRED' },
    ].sort((a, b) => a.offer_id.localeCompare(b.offer_id)));
    const g = bodyOf(get(C.recA, sentA.id, m.tables, { now: AFTER_EXPIRY }));
    const h = ((g?.history ?? []) as any[]).at(-1) ?? {};
    expect.soft([g?.state, h.from, h.to, h.by_kind, h.by_name ?? null], 'the history says the system expired it').toEqual(['EXPIRED', 'SENT', 'EXPIRED', 'system', null]);
    expect.soft(sagaOf(m.tables, sentA.candidate)['currentStage'], 'the candidate stays in Offer').toBe('OFFER');
    // Once: the next run changes nothing and sends nothing.
    const m2 = monitor(m.tables, new Date(Date.parse(AFTER_EXPIRY) + 3_600_000).toISOString());
    expect.soft(eventsOf(m2, 'OfferAnswered').length, 'the next run sends no second event').toBe(0);
    expect.soft([sentA.id, sentB.id].map((x) => JSON.stringify(offerRow(m2.tables, x))), 'and changes neither offer again').toEqual([sentA.id, sentB.id].map((x) => JSON.stringify(offerRow(m.tables, x))));
    // A company with Recruitment off is skipped (B still expires).
    const off = monitor(withRecruitmentOff(before, A), AFTER_EXPIRY);
    expect.soft(stateOf(off.tables, sentA.id), 'company A with Recruitment off: its SENT offer stays SENT').toBe('SENT');
    expect.soft(stateOf(off.tables, sentB.id), 'while company B\'s expires').toBe('EXPIRED');
    expect.soft(eventsOf(off, 'OfferAnswered').map((e: any) => e.detail?.tenant_id), 'and only B gets an event').toEqual([B]);
  });

  // ---------------------------------------------------------------- AC-7

  test('AC-7 Upload: the link is for this offer\'s prefix in the uploads bucket, a PDF, JPEG or PNG up to 10 MB; a hostile file name reaches no header and no key; the link alone stores nothing', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const l = ladder();
    const id = l.id.SENT;
    const r = must('signed upload', act(R.upload, C.recA, id, PDF, l.t, opts(l, { now: at(800) })));
    const b = bodyOf(r) ?? {};
    const prefix = `recruitment/${A}/offers/${id}/`;
    expect.soft(typeof b.upload_url === 'string' && b.upload_url.startsWith('https://'), 'an upload link').toBe(true);
    expect.soft(String(b.signed_key).startsWith(prefix) && /^[^/]{10,}$/.test(String(b.signed_key).slice(prefix.length)), `the key is ${prefix}<id> (got ${b.signed_key})`).toBe(true);
    const sign = r.calls.filter((c: any) => c.service === 's3');
    expect.soft(sign.map((c: any) => c.op), 'one signed PUT link, and no other S3 call').toEqual(['presign:PutObject']);
    const s = sign[0] ?? {};
    expect.soft([s.bucket, s.key, s.putContentType, s.putContentLength], 'for the uploads bucket, that key, the type and the size given').toEqual([UPLOAD_BUCKET, b.signed_key, 'application/pdf', PDF.file_size]);
    expect.soft(typeof s.expiresIn === 'number' && s.expiresIn > 0 && s.expiresIn <= 3600, `the link works for at most an hour (got ${s.expiresIn})`).toBe(true);
    expect.soft(changed(l.t, r.tables), 'asking for a link stores nothing (the key is stored only once the object exists)').toEqual([]);
    // Allowed and refused types and sizes.
    for (const [type, size] of [['image/jpeg', 1], ['image/png', 10 * 1024 * 1024]] as const) {
      const x = keep(`upload ${type}`, act(R.upload, C.recA, id, { ...PDF, content_type: type, file_size: size }, l.t, opts(l, { now: at(801) })));
      expect.soft(statusOf(x), `${type} of ${size} bytes is allowed (${describe(x)})`).toBe(200);
    }
    for (const [what, change, field] of [
      ['a ZIP file', { content_type: 'application/zip' }, 'content_type'], ['an HTML page', { content_type: 'text/html' }, 'content_type'], ['a GIF', { content_type: 'image/gif' }, 'content_type'],
      ['a PDF type with extra words', { content_type: 'application/pdf; charset=utf-8' }, 'content_type'], ['10 MB and one byte', { file_size: 10 * 1024 * 1024 + 1 }, 'file_size'],
      ['0 bytes', { file_size: 0 }, 'file_size'], ['a size as text', { file_size: '1000' }, 'file_size'], ['half a byte', { file_size: 1.5 }, 'file_size'], ['no file name', { file_name: undefined }, 'file_name'],
    ] as const) {
      const body: Record<string, unknown> = { ...PDF, ...change };
      for (const k of Object.keys(change)) if ((change as any)[k] === undefined) delete body[k];
      const x = act(R.upload, C.recA, id, body, l.t, opts(l, { now: at(802) }));
      expect.soft(answer(x), `${what}: 400 INVALID_FIELD ${field}`).toEqual([400, invalid(field)]);
      expect.soft(x.calls.filter((c: any) => c.service === 's3').length, `${what}: no link is signed`).toBe(0);
    }
    // A hostile file name: nothing of it reaches a header or the key in a form that can break out.
    const HOSTILE = 'offer"; filename=evil.exe\r\nX-Injected: 1\\..\\é.pdf';
    const h = must('upload with a hostile name', act(R.upload, C.recA, id, { ...PDF, file_name: HOSTILE }, l.t, opts(l, { now: at(803) })));
    const hs = h.calls.find((c: any) => c.service === 's3') ?? {};
    const key = String(bodyOf(h)?.signed_key ?? '');
    expect.soft(key.startsWith(prefix) && !/[\r\n"\\;]|\.\.|[^\x20-\x7e]/.test(key) && !key.slice(prefix.length).includes('/'), `the key holds nothing of the name that can break out (got ${JSON.stringify(key)})`).toBe(true);
    for (const [name, v] of [['ContentDisposition', hs.putDisposition], ['ContentType', hs.putContentType], ['Metadata', hs.putMetadata === undefined ? undefined : JSON.stringify(hs.putMetadata)]] as const) {
      if (v === undefined || v === null) continue;
      const text = String(v);
      const fileName = /filename\*?=("?)([^"]*)\1/i.exec(text)?.[2] ?? '';
      expect.soft(!/[\r\n]|[^\x20-\x7e]/.test(text), `${name} holds no line break and nothing outside plain ASCII (got ${JSON.stringify(text)})`).toBe(true);
      expect.soft(!/["\\;]/.test(fileName) && !/X-Injected/.test(text), `${name}: the file name in it holds no quote, backslash or semicolon, and nothing injected (got ${JSON.stringify(text)})`).toBe(true);
    }
    // Who: a Recruiter; and only on the company's own offer (AC-10).
    for (const who of [C.apprA, C.hmA, C.adminA]) {
      const x = act(R.upload, who, id, PDF, l.t, opts(l, { now: at(804) }));
      expect.soft([...answer(x), awsOf(x).length], `${who.name} asks for an upload link: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Salary: reads hide it; reveal works for a Recruiter and an approver only and writes an audit row; lists, events, logs and today\'s read never hold it', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(300_000);
    const l = ladder();
    const id = l.id.APPROVED;
    const plainRead = keep('read', get(C.recA, id, l.t, opts(l, { now: at(900) })));
    expect.soft([statusOf(plainRead), bodyOf(plainRead)?.salary, bodyOf(plainRead)?.salary_hidden], 'a read hides the salary').toEqual([200, null, true]);
    expect.soft(newRows(l.t, plainRead.tables), 'a read writes nothing').toEqual([]);
    for (const [who, n] of [[C.recA, 901], [C.apprA, 902], [C.bothA, 903]] as const) {
      const r = keep(`reveal by ${who.name}`, get(who, id, l.t, opts(l, { now: at(n), query: { reveal: 'salary' } })));
      expect.soft([statusOf(r), bodyOf(r)?.salary, bodyOf(r)?.salary_hidden], `${who.name} reveals the salary`).toEqual([200, SALARY, false]);
      const fresh = newRows(l.t, r.tables);
      const audit = fresh.filter((x) => x.row['offer_id'] === id && x.row['person_id'] === who.sub);
      expect.soft(audit.length, `${who.name}'s reveal writes one audit row`).toBe(1);
      const a = audit[0]?.row ?? {};
      expect.soft([a['tenant_id'], a['person_id'], a['offer_id'], a['at'], typeof a['kind'] === 'string' && a['kind'] !== ''], `the audit row is { tenant_id, person_id, kind, offer_id, at } of ${who.name}`).toEqual([A, who.sub, id, at(n), true]);
      expect.soft(JSON.stringify(a), 'the audit row does not hold the salary').not.toContain(String(SALARY));
      expect.soft(JSON.stringify(fresh.filter((x) => x !== audit[0])), 'and nothing else is written').toBe('[]');
    }
    // The hiring manager may read the offer but not reveal it: 403, no audit row.
    const hm = keep('hm read', get(C.hmA, id, l.t, opts(l, { now: at(904) })));
    expect.soft([statusOf(hm), bodyOf(hm)?.salary, bodyOf(hm)?.can_reveal_salary], 'the hiring manager reads it with the salary hidden').toEqual([200, null, false]);
    refused('the hiring manager asks to reveal', l.t, get(C.hmA, id, l.t, opts(l, { now: at(905), query: { reveal: 'salary' } })), 403, FORBIDDEN);
    // Anything other than ?reveal=salary reveals nothing.
    for (const q of [{ reveal: 'true' }, { reveal: 'SALARY' }, { show: 'salary' }]) {
      const r = get(C.recA, id, l.t, opts(l, { now: at(906), query: q }));
      expect.soft([statusOf(r), bodyOf(r)?.salary], `?${new URLSearchParams(q)} reveals nothing`).toEqual([200, null]);
    }
    // Lists, events, logs: never.
    const lst = keep('list', list(C.recA, {}, l.t, opts(l, { now: at(907) })));
    expect.soft(keysDeep(bodyOf(lst)).filter((k) => /salary/i.test(k)), 'the list has no salary field').toEqual([]);
    expect.soft(JSON.stringify(bodyOf(lst)), 'nor the number').not.toContain(String(SALARY));
    const all = [...RUNS, ...l.created.map(() => undefined)].filter(Boolean) as { what: string; run: Run }[];
    for (const { what, run } of all) {
      for (const e of eventsOf(run)) {
        expect.soft(keysDeep(e.detail).filter((k) => /salary/i.test(k)), `${what}: event ${e.detailType} has no salary field`).toEqual([]);
        expect.soft(JSON.stringify(e.detail), `${what}: event ${e.detailType} has no salary`).not.toContain(String(SALARY));
      }
      const leaks = logsOf(run).filter((x) => x.includes(String(SALARY)) || x.includes('487250') || /Ayanda|Busisiwe|Mkhize|Shabalala/.test(x));
      expect.soft(leaks, `${what}: no log line holds the salary or a candidate's name`).toEqual([]);
    }
    // Today's read route keeps its 200 but no longer shows a Recruiter the salary (rule 17).
    const old = oldGet(C.recA, K.l[2]!, l.t, opts(l));
    expect.soft(statusOf(old), 'today\'s GET /v1/candidates/{id}/offer still answers a Recruiter').toBe(200);
    const salaryKeys = Object.entries(Object.fromEntries(keysDeep(bodyOf(old)).map((k) => [k, true]))).map(([k]) => k).filter((k) => /salary/i.test(k));
    expect.soft(JSON.stringify(bodyOf(old)), `and no longer holds the salary (fields ${salaryKeys.join(', ')})`).not.toContain(String(LEGACY_SALARY));
  });

  test('AC-8 Failures: a salary is never shown when its audit row cannot be written or the offer cannot be read; a failed write changes nothing and sends no event; logs carry error names only', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    const l = ladder();
    const WRITES = ['PutItem', 'UpdateItem', 'TransactWriteItems', 'BatchWriteItem', 'DeleteItem'];
    const fail = (ops: string[], nth?: number) => ({ service: 'dynamodb', ops, ...(nth === undefined ? {} : { nth }), name: 'ProvisionedThroughputExceededException', message: `planted failure ${SALARY} ${BENEFITS}` });
    const SOMETHING = { error: 'Something went wrong' };
    const clean = (what: string, x: Run) => {
      expect.soft(answer(x), `${what}: 500 Something went wrong (${describe(x)})`).toEqual([500, SOMETHING]);
      expect.soft(JSON.stringify(bodyOf(x)), `${what}: no salary in the answer`).not.toContain(String(SALARY));
      expect.soft(logsOf(x).join('\n'), `${what}: the logs carry no salary, benefits or error message`).not.toMatch(new RegExp(`${String(SALARY).replace('.', '\\.')}|${BENEFITS}|planted failure`));
      expect.soft(changed(l.t, x.tables), `${what}: no row changes`).toEqual([]);
      expect.soft(eventsOf(x).map((e: any) => e.detailType), `${what}: no event`).toEqual([]);
    };
    // The audit row cannot be written: no salary.
    for (const who of [C.recA, C.apprA]) {
      clean(`${who.name} reveals while the audit write fails`, get(who, l.id.APPROVED, l.t, opts(l, { now: at(1700), query: { reveal: 'salary' }, extra: { fail: fail(WRITES) } })));
    }
    // The offer cannot be read (the read after the module read): no salary, no audit row.
    clean('a reveal whose offer read fails', get(C.recA, l.id.APPROVED, l.t, opts(l, { now: at(1701), query: { reveal: 'salary' }, extra: { fail: fail(['GetItem'], 2) } })));
    // A write that fails: nothing changes and no event is sent.
    clean('submit whose write fails', act(R.submit, C.recA, l.id.DRAFT, {}, l.t, opts(l, { now: at(1702), extra: { fail: fail(WRITES) } })));
    clean('send whose write fails', act(R.send, C.recA, l.id.APPROVED, {}, l.t, opts(l, { now: at(1703), extra: { fail: fail(WRITES) } })));
    clean('decline whose write fails', act(R.answer, C.recA, l.id.SENT, { answer: 'DECLINED' }, l.t, opts(l, { now: at(1704), extra: { fail: fail(WRITES) } })));
    clean('withdraw from SENT whose write fails', act(R.withdraw, C.recA, l.id.SENT, {}, l.t, opts(l, { now: at(1705), extra: { fail: fail(WRITES) } })));
    clean('PATCH whose write fails', patch(C.recA, l.id.DRAFT, { version: bodyOf(get(C.recA, l.id.DRAFT, l.t, opts(l, { now: at(1706) })))?.version, salary: 1000 }, l.t, opts(l, { now: at(1706), extra: { fail: fail(WRITES) } })));
    // The expiry job: a failed write leaves the offer SENT and sends no event.
    const before = l.t;
    const m = monitor(before, AFTER_EXPIRY, { fail: fail(WRITES) });
    expect.soft(offerRow(m.tables, l.id.SENT)?.['state'], 'expiry whose write fails: the offer stays SENT').toBe('SENT');
    expect.soft(eventsOf(m, 'OfferAnswered').length, 'and no OfferAnswered').toBe(0);
    expect.soft(logsOf(m).join('\n'), 'and its logs carry no salary or error message').not.toMatch(new RegExp(`${String(SALARY).replace('.', '\\.')}|planted failure`));
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 Legacy: old state codes read as rule 1; the script maps them, writes the list key, is idempotent, counts only, and leaves other companies alone', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    const t0 = world();
    // Today's read route maps the old codes (rule 1 and 17).
    LEGACY.forEach(([old, now], i) => {
      const r = oldGet(C.recA, K.l[i]!, t0);
      expect.soft([statusOf(r), bodyOf(r)?.state], `an old ${old} row reads as ${now}`).toEqual([200, now]);
    });
    expect.soft(existsSync(MIGRATE), 'scripts/recruitment/migrate-offers.mjs exists').toBe(true);
    const base = ['--env', 'dev', '--tenant', A];
    const dry = migrate(base, t0);
    expect.soft(dry.code, `a dry run exits 0 (${dry.stderr.slice(-300)})`).toBe(0);
    expect.soft(dry.writes.length, 'a dry run writes nothing').toBe(0);
    const said = dry.stdout + dry.stderr;
    // Company A's old rows: the five of this card and the one REC-02's world already holds.
    const oldOfA = rowsOf(t0).filter((r) => r['tenant_id'] === A && r['SK'] === 'OFFER' && String(r['PK']).startsWith('CANDIDATE#')).length;
    expect.soft(oldOfA, 'the world holds six old offer rows of A').toBe(6);
    expect.soft(new RegExp(`\\b${oldOfA}\\b`).test(said), `the dry run counts A's ${oldOfA} old rows (said ${JSON.stringify(said.slice(0, 300))})`).toBe(true);
    expect.soft(said, 'counts only: no names, ids or salary').not.toMatch(new RegExp(['Legacy1', 'Person', K.l[0]!, String(LEGACY_SALARY), '312345'].join('|')));
    const check1 = migrate([...base, '--check'], t0);
    expect.soft([check1.code, check1.writes.length], '--check before the move: exit 1, nothing written').toEqual([1, 0]);
    const applied = migrate([...base, '--apply'], t0);
    expect.soft(applied.code, `--apply exits 0 (${applied.stderr.slice(-300)})`).toBe(0);
    const t1 = applied.tables;
    expect.soft((applied.stdout + applied.stderr), '--apply output: counts only').not.toMatch(new RegExp(['Legacy1', K.l[0]!, String(LEGACY_SALARY)].join('|')));
    // After the move the old offers are in the list with the new codes, and each reads by its id.
    const lst = list(C.recA, {}, t1, { now: at(1000) });
    const rows = ((bodyOf(lst)?.offers ?? []) as any[]).filter((x) => K.l.includes(x.candidate_id));
    expect.soft(rows.map((x) => [x.candidate_id, x.state]).sort(), 'the list shows A\'s five old offers with the new codes').toEqual(K.l.map((c, i) => [c, LEGACY[i]![1]]).sort());
    for (const x of rows) {
      const g = get(C.recA, x.offer_id, t1, { now: at(1001) });
      expect.soft([statusOf(g), bodyOf(g)?.state], `${x.candidate_id}: reads by its id as ${x.state}`).toEqual([200, x.state]);
      expect.soft(ONE_FIELDS.filter((f) => !(f in (bodyOf(g) ?? {}))), `${x.candidate_id}: the same shape as a new offer`).toEqual([]);
      expect.soft(bodyOf(g)?.salary ?? null, `${x.candidate_id}: the salary is hidden`).toBeNull();
    }
    expect.soft(rowsOf(t1).filter((r) => r['tenant_id'] === A && /^(OFFER_CREATED|IN_APPROVAL|OFFER_SENT|REJECTED)$/.test(String(r['state'] ?? ''))).length, 'no row of A keeps an old code').toBe(0);
    // Idempotent; company B untouched; --check now passes.
    const twice = migrate([...base, '--apply'], t1);
    expect.soft([twice.code, changed(t1, twice.tables)], 'a second --apply changes nothing').toEqual([0, []]);
    expect.soft(migrate([...base, '--check'], t1).code, '--check after the move: exit 0').toBe(0);
    const bRows = (t: Tables) => JSON.stringify(rowsOf(t).filter((r) => r['tenant_id'] === B || String(r['PK'] ?? '').includes(K.lb)));
    expect.soft(bRows(t1), 'A\'s move leaves company B\'s rows exactly as they were').toBe(bRows(t0));
    const bMove = migrate(['--env', 'dev', '--tenant', B, '--apply'], t1);
    expect.soft(bMove.code, '--tenant B exits 0').toBe(0);
    const lb = ((bodyOf(list(C.recB, {}, bMove.tables, { now: at(1002) }))?.offers ?? []) as any[]).find((x) => x.candidate_id === K.lb);
    expect.soft(lb?.state, 'B\'s IN_APPROVAL row is now B\'s DRAFT').toBe('DRAFT');
    const aRows = (t: Tables) => JSON.stringify(rowsOf(t).filter((r) => r['tenant_id'] === A));
    expect.soft(aRows(bMove.tables), '--tenant B leaves A as it was').toBe(aRows(t1));
    // Refusals, as REC-03's script: nothing written.
    const PROD = { Account: '937137806477', Arn: 'arn:aws:sts::937137806477:assumed-role/ops/rec05' };
    for (const [what, args, sts] of [
      ['no --tenant', ['--env', 'dev', '--apply'], undefined], ['--env prod on the dev account', ['--env', 'prod', '--tenant', A, '--apply'], undefined],
      ['--env dev on the prod account', [...base, '--apply'], PROD], ['a bad company id', ['--env', 'dev', '--tenant', 'ten_x', '--apply'], undefined],
    ] as const) {
      const r = migrate([...args], t0, sts ? { sts } : {});
      expect.soft(r.code, `${what}: refused (non-zero exit)`).not.toBe(0);
      expect.soft(r.writes.length, `${what}: nothing written`).toBe(0);
    }
  });

  // ---------------------------------------------------------------- AC-10

  test('AC-10 No state machine, company B, roles: no StartExecution; every route is 404 for another company\'s offer; the company comes from the sign-in only; Terraform grants exact actions', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(600_000);
    // Text: no offer code starts the state machine.
    const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const files = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => /\.(m?js)$/.test(f) && !/\.test\./.test(f)).map((f) => join(dir, f)) : []);
    const offerCode = [...files(join(LAMBDA, OFFERS)), ...files(join(LAMBDA, 'createOffer')), ...files(join(LAMBDA, 'advanceOfferState')), ...files(join(LAMBDA, 'shared', 'recruitment-actions')).filter((f) => /offer/i.test(f))];
    expect.soft(files(join(LAMBDA, OFFERS)).length, 'lambda/manageOffers exists').toBeGreaterThan(0);
    for (const f of offerCode) expect.soft(code(f), `${f.slice(REPO.length + 1)}: no StartExecution`).not.toMatch(/StartExecution/);

    // Every route, company B's callers on A's offer: 404, the same as an offer that does not exist, nothing written.
    const l = ladder();
    const aId = l.id.WAITING_APPROVAL;
    const GHOST = 'offer-does-not-exist-0000000000';
    const bodyFor = (route: string) => (route === R.patch ? { version: 2, salary: 1 } : route === R.approve ? { version: 2 } : route === R.sendBack ? { version: 2, note: 'x' } : route === R.answer ? { answer: 'DECLINED' } : route === R.upload ? PDF : {});
    for (const route of ONE_OFFER_ROUTES) {
      const who = route === R.approve || route === R.sendBack ? C.apprB : C.recB;
      const r = act(route, who, aId, bodyFor(route), l.t, opts(l, { now: at(1100) }));
      const g = act(route, who, GHOST, bodyFor(route), l.t, opts(l, { now: at(1100) }));
      refused(`${route} by ${who.name} on A's offer`, l.t, r, 404, NOT_FOUND);
      expect.soft(answer(r), `${route}: the same answer as an offer that does not exist`).toEqual(answer(g));
      if (route === R.get) refused(`GET by B's approver on A's offer`, l.t, act(route, C.apprB, aId, {}, l.t, opts(l, { now: at(1100) })), 404, NOT_FOUND);
      // And A's Recruiter on B's offer.
      const back = act(route, route === R.approve || route === R.sendBack ? C.apprA : C.recA, l.id.B, bodyFor(route), l.t, opts(l, { now: at(1101) }));
      refused(`${route} by company A on B's offer`, l.t, back, 404, NOT_FOUND);
    }
    // The company comes from the sign-in only: B's Recruiter naming A everywhere drafts a B offer on B's candidate; naming A's candidate is 404.
    const forgeA = { headers: Object.fromEntries(Object.keys(FORGED_HEADERS).map((k) => [k, A])), query: Object.fromEntries(Object.keys(FORGED_QUERY).map((k) => [k, A])) };
    const fb = keep('B creates naming A', create(C.recB, draftBody(K.b[3]!, { tenant_id: A, tenantId: A }), l.t, opts(l, { now: at(1102), ...forgeA })));
    expect.soft(ok(fb), `B's Recruiter drafts for B's candidate (${describe(fb)})`).toBe(true);
    expect.soft(offerRow(fb.tables, idOf(fb))?.['tenant_id'], 'the offer is B\'s').toBe(B);
    refused('B\'s Recruiter naming A everywhere, on A\'s candidate', l.t, create(C.recB, draftBody(K.a[26]!), l.t, opts(l, { now: at(1103), ...forgeA })), 404, NOT_FOUND);
    const lb = list(C.recB, {}, l.t, opts(l, { now: at(1104), ...forgeA }));
    expect.soft(((bodyOf(lb)?.offers ?? []) as any[]).map((x) => x.offer_id), 'B\'s list naming A everywhere: only B\'s offer').toEqual([l.id.B]);
    // Recruitment off (D) and no company: refused, at most the module read.
    for (const route of [R.create, R.list]) {
      const d = call2(route, C.recD, l);
      expect.soft(answer(d), `${route}, a Recruiter of D (Recruitment off): 403`).toEqual([403, FORBIDDEN]);
      expect.soft(awsOf(d).filter((c) => !isModulesRead(c)).map((c: any) => `${c.service} ${c.op}`), `${route}, Recruitment off: only the module read`).toEqual([]);
      const n = call2(route, C.recNone, l);
      expect.soft([...answer(n), awsOf(n).length], `${route}, a Recruiter with no company: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }

    // Terraform (rule 12): manageOffers runs as its own role with exact actions; no wildcard; no table rows.
    const fn = lambdaNamed(OFFERS);
    expect(fn.length, 'one aws_lambda_function named manageOffers').toBe(1);
    const stack = fn[0]!.stack;
    expect.soft(stack, 'in talent-flow-infra').toBe('talent-flow-infra');
    const role = roleResourceOf(fn[0]!.block);
    expect.soft(role, 'it runs as aws_iam_role.manage_offers').toBe('manage_offers');
    const lines = Object.values(policyLines()).filter((p) => p.stack === stack && p.role === role).flatMap((p) => p.pairs ?? [`unreadable ${p.squash}`]);
    expect.soft(lines.length, 'its policy can be read line by line').toBeGreaterThan(3);
    for (const line of lines) {
      const [effect, action, resource] = line.split(' ');
      expect.soft(effect, `${line}: Allow only`).toBe('Allow');
      expect.soft(/\*/.test(action ?? ''), `${line}: no wildcard action`).toBe(false);
      if (/^(logs|xray):/.test(action ?? '')) continue;
      // The same list as support/rec-05.1/grants.ts (F8). IAM has no separate TransactWriteItems or HeadObject action: a transaction needs the
      // item actions, and HEAD needs s3:GetObject.
      expect.soft(/^(dynamodb:(GetItem|Query|PutItem|UpdateItem|ConditionCheckItem)|s3:(PutObject|GetObject)|events:PutEvents|cognito-idp:ListUsersInGroup|kms:(Decrypt|DescribeKey|GenerateDataKey))$/.test(action ?? ''), `${line}: one of the actions the card needs`).toBe(true);
      if (/^s3:/.test(action ?? '')) expect.soft(/\/recruitment\/\*$/.test(resource ?? ''), `${line}: S3 only under recruitment/`).toBe(true);
      else if (!/^(events:|cognito-idp:|kms:)/.test(action ?? '')) expect.soft(/\*/.test((resource ?? '').replace(/\/index\/\*$/, '/index/x').replace(/\/index\/[\w-]+$/, '/index/x')), `${line}: no wildcard resource`).toBe(false);
      expect.soft(/^(dynamodb:(Scan|DeleteItem|BatchWriteItem)|states:|sfn:|ses:|sqs:)/.test(action ?? ''), `${line}: no Scan, delete, state machine or email`).toBe(false);
    }
    expect.soft(lines.some((x) => /^Allow events:PutEvents /.test(x)), 'it may put events (OfferSent, OfferAnswered)').toBe(true);
    // And not too little (F7): every grant the routes need to work at all.
    const STATE_T = String.raw`(\$\{local\.(tf_table_state|tf_state_table)\}|talent-flow-state|aws_dynamodb_table\.talent_flow_state\.arn)`;
    const IDEM_T = String.raw`(\$\{local\.tf_table_idempotency\}|talent-flow-idempotency-keys|aws_dynamodb_table\.\w*idempotency\w*\.arn)`;
    const ROLES_T = String.raw`(\$\{local\.tf_table_roles\}|talent-flow-roles|aws_dynamodb_table\.talent_flow_roles\.arn)`;
    const TENANTS_T = String.raw`(\$\{local\.tf_tenants_table\}|naleko-people-\$\{var\.environment\}-tenants|aws_dynamodb_table\.tenants\.arn)`;
    const needs = (pairs: string[], who: string, list: [string, RegExp][]) => {
      for (const [what, re] of list) expect.soft(pairs.some((x) => re.test(x)), `${who} has ${what}`).toBe(true);
    };
    const tableLine = (action: string, table: string, index = false) => new RegExp(String.raw`^Allow dynamodb:${action} (\S*[:/])?${table}${index ? String.raw`\/index\/[\w-]+` : ''} null$`);
    needs(lines, 'manageOffers', [
      ['GetItem on the state table', tableLine('GetItem', STATE_T)], ['PutItem on the state table', tableLine('PutItem', STATE_T)],
      ['UpdateItem on the state table (the live lock)', tableLine('UpdateItem', STATE_T)], ['Query on a state table index (the list)', tableLine('Query', STATE_T, true)],
      ['GetItem on the request-key table', tableLine('GetItem', IDEM_T)], ['PutItem on the request-key table', tableLine('PutItem', IDEM_T)],
      ['GetItem on the roles table (the title)', tableLine('GetItem', ROLES_T)], ['GetItem on the tenants table (modules and Member rows)', tableLine('GetItem', TENANTS_T)],
      ['s3:PutObject under recruitment/ (the upload link)', /^Allow s3:PutObject \S*\/recruitment\/\* null$/], ['s3:GetObject under recruitment/ (the HEAD check)', /^Allow s3:GetObject \S*\/recruitment\/\* null$/],
      ['cognito-idp:ListUsersInGroup (the approvers)', /^Allow cognito-idp:ListUsersInGroup \S+ null$/],
      ['kms:Decrypt on the state key', /^Allow kms:Decrypt \S*state\S* null$/], ['kms:GenerateDataKey on the state key', /^Allow kms:GenerateDataKey \S*state\S* null$/],
    ]);
    // The expiry job (rule 8) runs as monitorTalentFlowSLAs: it must read the company's modules and write the offer.
    const mon = lambdaNamed('monitorTalentFlowSLAs');
    expect(mon.length, 'monitorTalentFlowSLAs is in Terraform').toBe(1);
    const monRole = roleResourceOf(mon[0]!.block);
    const monLines = Object.values(policyLines()).filter((p) => p.stack === mon[0]!.stack && p.role === monRole).flatMap((p) => p.pairs ?? []);
    needs(monLines, 'monitorTalentFlowSLAs', [['GetItem on the tenants table', tableLine('GetItem', TENANTS_T)], ['UpdateItem on the state table', tableLine('UpdateItem', STATE_T)]]);
    expect.soft(settingsOf(mon[0]!.block).has('TENANTS_TABLE'), 'monitorTalentFlowSLAs has the setting TENANTS_TABLE').toBe(true);
    const env = settingsOf(fn[0]!.block);
    for (const k of ['STATE_TABLE_NAME', 'IDEMPOTENCY_TABLE', 'UPLOAD_BUCKET', 'TENANTS_TABLE', 'EVENTBRIDGE_BUS_NAME', 'ROLES_TABLE_NAME']) expect.soft(env.has(k), `manageOffers has the setting ${k}`).toBe(true);
    expect.soft(STACKS.flatMap((s) => resourcesOf(s, 'aws_dynamodb_table_item').map((b) => b.labels[1])), 'no table rows in Terraform').toEqual([]);
    void [D, DAY, localsOf, valueOf, blocks, attributes, filesOf];
  });

  // ---------------------------------------------------------------- AC-11 (pepla-dev)

  test('AC-11 pepla-dev: the seed is put back each run (text check)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const src = readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8');
    expect.soft(src, 'seed-dev.py has seed_rec05').toMatch(/def seed_rec05\(/);
    const main = src.slice(src.indexOf('def main('));
    expect.soft(main, 'main() calls seed_rec05').toMatch(/seed_rec05\(\s*ddb\s*,/);
    const card = readFileSync(join(__dirname, 'cards', 'rec-05.md'), 'utf8');
    expect.soft(card, 'the card notes name the dev seed contract').toContain('REC-05 dev seed');
    expect.soft(existsSync(join(__dirname, 'support', 'rec-05', 'dev-ids.json')), 'the seed\'s ids are written down for the dev test').toBe(true);
  });

  test('AC-11 The test logins on pepla-dev: the Recruiter drafts and edits, cannot approve; the approver approves; the Recruiter sends; salary hidden until revealed; real preflights pass; both read the list; B gets 404 and an empty list @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1 to AC-15.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(6 * 60_000);
    const env = (k: string) => process.env[k] ?? '';
    const login = (p: string) => ({ email: env(`${p}_EMAIL`), password: env(`${p}_PASSWORD`) });
    // The Recruiter is the HR login; the approver is the approver login of the seed (approver tick only); B is company B's HR login.
    const logins = { hr: login('E2E_HR'), approver: login('E2E_APPROVER'), companyB: login('E2E_HR_B') };
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
    const api = async (token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      page.request.fetch(`${tfApi}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { data: JSON.stringify(body) }) });
    const ids = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-05', 'dev-ids.json'), 'utf8')) as Record<string, string>;
    const [hr, approver, companyB] = await Promise.all([signIn(logins.hr), signIn(logins.approver), signIn(logins.companyB)]);
    // Real preflights for the new routes, from the app's address, with idempotency-key.
    const origin = 'https://df2hrxausiknc.cloudfront.net';
    for (const [method, path] of [['PATCH', `/v1/offers/${ids['draftOffer']}`], ['POST', '/v1/offers']] as const) {
      const pre = await page.request.fetch(`${tfApi}${path}`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': method, 'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key' } });
      expect([200, 204], `the preflight for ${method} ${path} passes`).toContain(pre.status());
      expect((pre.headers()['access-control-allow-headers'] ?? '').toLowerCase(), `${method} ${path}: idempotency-key is allowed`).toContain('idempotency-key');
      expect((pre.headers()['access-control-allow-methods'] ?? '').toUpperCase(), `${method} ${path}: the method is allowed`).toContain(method);
    }
    // The seeded draft (never submitted) is edited, then a new draft for the seeded candidate in Offer goes through the whole flow.
    const read0 = await api(hr, 'GET', `/v1/offers/${ids['draftOffer']}`);
    expect(read0.status(), 'the Recruiter reads the seeded draft').toBe(200);
    const v0 = ((await read0.json()) as any).version;
    const ed = await api(hr, 'PATCH', `/v1/offers/${ids['draftOffer']}`, { version: v0, salary: 400000 + (Date.now() % 1000) }, { 'idempotency-key': `rec05-dev-${Date.now()}` });
    expect(ed.status(), `the Recruiter edits the draft's salary (${await ed.text()})`).toBe(200);
    const made = await api(hr, 'POST', '/v1/offers', { candidate_id: ids['candidate'], salary: 350000, start_date: ids['startDate'], expiry_date: ids['expiryDate'] }, { 'idempotency-key': `rec05-dev-create-${Date.now()}` });
    expect([200, 201], `the Recruiter drafts an offer for the seeded candidate (${await made.text()})`).toContain(made.status());
    const offer = (await made.json()) as any;
    const sub = await api(hr, 'POST', `/v1/offers/${offer.offer_id}/submit`, {});
    expect(sub.status(), 'the Recruiter submits it').toBe(200);
    const v1 = ((await sub.json()) as any).version;
    expect((await api(hr, 'POST', `/v1/offers/${offer.offer_id}/send`, {})).status(), 'send before approval is refused').toBe(409);
    expect((await api(hr, 'POST', `/v1/offers/${offer.offer_id}/approve`, { version: v1 })).status(), 'the Recruiter login cannot approve').toBe(403);
    const ap = await api(approver, 'POST', `/v1/offers/${offer.offer_id}/approve`, { version: v1 });
    expect(ap.status(), `the approver login approves (${await ap.text()})`).toBe(200);
    const sent = await api(hr, 'POST', `/v1/offers/${offer.offer_id}/send`, {});
    expect(sent.status(), 'the Recruiter sends it').toBe(200);
    const after = (await (await api(hr, 'GET', `/v1/offers/${offer.offer_id}`)).json()) as any;
    expect([after.state, after.salary, after.salary_hidden], 'it reads SENT, salary hidden').toEqual(['SENT', null, true]);
    const shown = (await (await api(hr, 'GET', `/v1/offers/${offer.offer_id}?reveal=salary`)).json()) as any;
    expect(shown.salary, 'revealed for the Recruiter').toBe(350000);
    for (const [who, token] of [['the Recruiter', hr], ['the approver', approver]] as const) {
      const ls = await api(token, 'GET', '/v1/offers');
      expect(ls.status(), `${who} reads the list`).toBe(200);
      expect((((await ls.json()) as any).offers ?? []).map((x: any) => x.offer_id), `${who} sees the new offer`).toContain(offer.offer_id);
    }
    expect((await api(companyB, 'GET', `/v1/offers/${offer.offer_id}`)).status(), 'B\'s login gets 404 on A\'s offer').toBe(404);
    const bl = (await (await api(companyB, 'GET', `/v1/offers?candidate_id=${ids['candidate']}`)).json()) as any;
    expect(bl.offers, 'B\'s list for A\'s candidate is empty').toEqual([]);
    // Withdraw it, so the seeded candidate is free for the next run.
    expect((await api(hr, 'POST', `/v1/offers/${offer.offer_id}/answer`, { answer: 'WITHDRAWN' })).status(), 'the Recruiter withdraws it at the end').toBe(200);
  });

  // ---------------------------------------------------------------- AC-12

  test('AC-12 The list: every offer of A newest first with exactly the row fields; approver-only sees submitted offers only; filters and paging; wrong callers 403 with no read; B sees only B; one Query on the company index', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    const l = ladder();
    const o = (n: number, q: Record<string, string> = {}) => opts(l, { now: at(n), query: q });
    const idsOf = (r: Run) => ((bodyOf(r)?.offers ?? []) as any[]).map((x) => x.offer_id);
    const r = keep('list recA', list(C.recA, {}, l.t, o(1200)));
    expect(statusOf(r), `the Recruiter reads the list (${describe(r)})`).toBe(200);
    expect.soft(idsOf(r), 'every offer of A, newest first').toEqual(ladderA(l));
    const rows = (bodyOf(r)?.offers ?? []) as any[];
    for (const x of rows) {
      const extra = Object.keys(x).filter((k) => !ROW_FIELDS.includes(k) && k !== 'approver_name');
      expect.soft([ROW_FIELDS.filter((k) => !(k in x)), extra], `${x.offer_id}: exactly the row fields`).toEqual([[], []]);
    }
    const byId = Object.fromEntries(rows.map((x) => [x.offer_id, x]));
    const ap = byId[l.id.APPROVED] ?? {};
    expect.soft([ap.candidate_id, ap.candidate_name, ap.role_title, ap.state, ap.expires_at, ap.approver_name], 'an approved row: candidate, names, title, state, expiry, approver\'s name').toEqual([l.cand.APPROVED, candName(l.cand.APPROVED), ROLE_TITLE.ra, 'APPROVED', EXPIRY, fullName(SUB.apprA)]);
    expect.soft(byId[l.id.WAITING_APPROVAL]?.approver_name ?? null, 'a row nobody approved has no approver name').toBeNull();
    const raw = JSON.stringify(bodyOf(r));
    expect.soft(keysDeep(bodyOf(r)).filter((k) => ['salary', 'currency', 'benefits', 'letter_text', 'history', 'drafted_by', 'approver_id'].includes(k)), 'no row anywhere holds salary, currency, benefits, letter_text, history, drafted_by or approver_id').toEqual([]);
    expect.soft(PERSON_IDS.filter((p) => raw.includes(p)), 'no person id in the list').toEqual([]);
    expect.soft(raw, 'nor the salary').not.toContain(String(SALARY));
    // One Query on the company-keyed index, never a Scan.
    const db = dbOf(r);
    expect.soft(db.filter((c: any) => c.op === 'Scan').length, 'no Scan').toBe(0);
    const q = db.filter((c: any) => c.op === 'Query' && c.table === TABLE.state);
    expect.soft(q.length >= 1 && q.every((c: any) => c.input?.IndexName && JSON.stringify(c.input?.ExpressionAttributeValues ?? {}).includes(`TENANT#${A}#OFFER`)), `the list reads with a Query on an index keyed TENANT#${A}#OFFER (got ${JSON.stringify(q.map((c: any) => [c.input?.IndexName, c.input?.ExpressionAttributeValues]))})`).toBe(true);
    expect.soft(db.filter((c: any) => !(c.op === 'Query' && c.table === TABLE.state) && !isModulesRead(c)).map((c: any) => `${c.op} ${c.table}`), 'and no other read but the module read').toEqual([]);

    // Who sees what.
    const appr = keep('list apprA', list(C.apprA, {}, l.t, o(1201)));
    expect.soft(idsOf(appr), 'the approver-only person: every submitted offer of A in any state, never a draft nobody submitted').toEqual(submittedA(l));
    expect.soft(idsOf(list(C.bothA, {}, l.t, o(1202))), 'a person with both ticks: every offer').toEqual(ladderA(l));
    // Filters.
    expect.soft(idsOf(list(C.recA, { state: 'APPROVED' }, l.t, o(1203))), 'state=APPROVED').toEqual([l.id.APPROVED]);
    expect.soft(idsOf(list(C.recA, { state: 'DRAFT' }, l.t, o(1204))), 'state=DRAFT: the sent-back draft and the never-submitted one').toEqual([l.id.SENT_BACK, l.id.DRAFT]);
    expect.soft(idsOf(list(C.apprA, { state: 'DRAFT' }, l.t, o(1205))), 'state=DRAFT for the approver: only the sent-back one').toEqual([l.id.SENT_BACK]);
    expect.soft(idsOf(list(C.recA, { candidate_id: l.cand.SENT }, l.t, o(1206))), 'candidate_id').toEqual([l.id.SENT]);
    expect.soft(idsOf(list(C.recA, { candidate_id: l.cand.SENT, state: 'DRAFT' }, l.t, o(1206))), 'both filters').toEqual([]);
    for (const [what, q2, field] of [
      ['state in small letters', { state: 'approved' }, 'state'], ['an unknown state', { state: 'OPEN' }, 'state'], ['an old state code', { state: 'IN_APPROVAL' }, 'state'],
      ['candidate_id with a space', { candidate_id: 'CAND-1 OR 1=1' }, 'candidate_id'], ['candidate_id far too long', { candidate_id: `CAND-${'A'.repeat(300)}` }, 'candidate_id'],
      ['limit 0', { limit: '0' }, 'limit'], ['limit 101', { limit: '101' }, 'limit'], ['limit as a word', { limit: 'ten' }, 'limit'], ['limit 2.5', { limit: '2.5' }, 'limit'],
      ['a made-up nextToken', { nextToken: 'not-a-token' }, 'nextToken'], ['a nextToken of base64 rubbish', { nextToken: Buffer.from('{"x":1}').toString('base64url') }, 'nextToken'],
    ] as const) {
      const x = list(C.recA, q2 as Record<string, string>, l.t, o(1207));
      expect.soft(answer(x), `${what}: 400 INVALID_FIELD ${field}`).toEqual([400, invalid(field)]);
    }
    // Paging: two a page, every row once, in order.
    const seen: string[] = [];
    let token: string | undefined;
    let pages = 0;
    do {
      const pg = list(C.recA, { limit: '2', ...(token ? { nextToken: token } : {}) }, l.t, o(1208 + pages));
      expect.soft(statusOf(pg), `page ${pages + 1} (${describe(pg)})`).toBe(200);
      seen.push(...idsOf(pg));
      expect.soft(idsOf(pg).length <= 2, `page ${pages + 1} holds at most 2`).toBe(true);
      token = bodyOf(pg)?.nextToken ?? undefined;
      pages++;
    } while (token && pages < 12);
    expect.soft(seen, 'the pages together: every row once, newest first').toEqual(ladderA(l));
    expect.soft(pages, 'five pages of two (nine offers)').toBe(5);
    // Wrong callers: 403 with no table read.
    for (const who of [C.hmA, C.hm2A, C.adminA, C.empA, C.guestA, C.hrNoTickA]) {
      const x = list(who, {}, l.t, o(1220));
      expect.soft([...answer(x), dbOf(x).length], `${who.name}: 403 with no table read`).toEqual([403, FORBIDDEN, 0]);
    }
    // Company B.
    expect.soft(idsOf(list(C.recB, {}, l.t, o(1221))), 'B\'s Recruiter: only B\'s offer').toEqual([l.id.B]);
    expect.soft(idsOf(list(C.apprB, {}, l.t, o(1222))), 'B\'s approver: only B\'s submitted offer').toEqual([l.id.B]);
    expect.soft(answer(list(C.recB, { candidate_id: l.cand.APPROVED }, l.t, o(1223))), 'B with A\'s candidate id: an empty list').toEqual([200, { offers: [] }]);
    const empty = world();
    expect.soft(answer(list(C.recB, {}, empty, { now: at(1224) })), 'B with no offers: an empty list').toEqual([200, { offers: [] }]);
  });

  // ---------------------------------------------------------------- AC-13

  test('AC-13 The one-offer answer: every field on each of the eight states; drafted_by_me from the sign-in only; can_reveal_salary; names copied onto the offer; no person ids; the approver\'s unsubmitted draft is 404; write answers and cached answers hold no salary', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    const l = ladder();
    const o = (n: number, extra: Opts = {}) => opts(l, { now: at(n), ...extra });
    const want: Record<State, string[]> = {
      DRAFT: [], WAITING_APPROVAL: ['submitted_at'], APPROVED: ['submitted_at', 'approval'], SENT: ['submitted_at', 'approval', 'sent_at'],
      ACCEPTED: ['submitted_at', 'approval', 'sent_at', 'answered_at'], DECLINED: ['submitted_at', 'approval', 'sent_at', 'answered_at'],
      EXPIRED: ['submitted_at', 'approval', 'sent_at', 'answered_at'], WITHDRAWN: [],
    };
    for (const s of STATES) {
      const r = keep(`get ${s}`, get(C.recA, l.id[s], l.t, o(1300)));
      const b = bodyOf(r) ?? {};
      expect.soft(statusOf(r), `${s}: 200 (${describe(r)})`).toBe(200);
      expect.soft([...ONE_FIELDS, ...want[s]].filter((f) => !(f in b) || (want[s].includes(f) && (b[f] === null || b[f] === undefined))), `${s}: every field of rule 14`).toEqual([]);
      expect.soft([b.state, b.candidate_name, b.role_title, b.department, b.drafted_by_name, b.salary, b.salary_hidden], `${s}: the values`).toEqual([s, candName(l.cand[s]), ROLE_TITLE.ra, 'Operations', fullName(SUB.recA), null, true]);
      expect.soft(Array.isArray(b.history) && b.history.every((h: any) => 'by_name' in h && !('by' in h)), `${s}: each history entry has by_name and no by`).toBe(true);
      if (want[s].includes('approval')) expect.soft(b.approval, `${s}: the approval`).toEqual({ approver_name: fullName(SUB.apprA), at: b.approval?.at, mode: 'ONE_APPROVER' });
      expect.soft(keysDeep(b).filter((k) => ['drafted_by', 'approver_id', 'by', 'person_id', 'answered_by'].includes(k)), `${s}: no person id field`).toEqual([]);
      expect.soft(PERSON_IDS.filter((p) => JSON.stringify(b).includes(p)), `${s}: no person id anywhere`).toEqual([]);
    }
    // drafted_by_me: true for the drafter only, from the sign-in only.
    const mine = (who: Caller, extra: Opts = {}) => bodyOf(get(who, l.id.WAITING_APPROVAL, l.t, o(1301, extra)))?.drafted_by_me;
    expect.soft([mine(C.recA), mine(C.rec2A), mine(C.apprA), mine(C.bothA)], 'the drafter true; a second Recruiter, the approver and bothA false').toEqual([true, false, false, false]);
    expect.soft([mine(asPerson(C.recA, SUB.rec2A)), mine(asPerson(C.rec2A, SUB.recA))], 'only the sign-in\'s person id changed: it flips').toEqual([false, true]);
    const naming = { query: { drafted_by: SUB.recA, person_id: SUB.recA, user_id: SUB.recA, sub: SUB.recA }, headers: { 'x-person-id': SUB.recA, 'x-user-id': SUB.recA, 'x-sub': SUB.recA } };
    expect.soft(mine(C.rec2A, naming), 'a query or header naming the drafter does not make it true').toBe(false);
    const withClaim = { ...C.rec2A, claims: { ...C.rec2A.claims, user_id: SUB.recA } };
    expect.soft(mine(withClaim), 'the user_id claim (TEN-06) is the person id when present').toBe(true);
    // can_reveal_salary.
    const crs = (who: Caller) => bodyOf(get(who, l.id.SENT, l.t, o(1302)))?.can_reveal_salary;
    expect.soft([crs(C.recA), crs(C.apprA), crs(C.hmA)], 'Recruiter and approver true, the hiring manager false').toEqual([true, true, false]);
    // Names come from the offer row: the approver gets them while every read of the candidate, the role and the people is refused.
    const deny = [{ table: TABLE.state, sk: 'SAGA' }, { table: TABLE.roles }, { table: TABLE.users }, { table: TABLE.tenants, pk: 'USER#' }, { table: TABLE.tenants, sk: 'DEPARTMENTS' }];
    for (const s of ['APPROVED', 'SENT', 'EXPIRED'] as const) {
      const r = get(C.apprA, l.id[s], l.t, o(1303, { extra: { s3: l.s3, cognito: { users: [] }, denyReads: deny } }));
      const b = bodyOf(r) ?? {};
      expect.soft([statusOf(r), b.candidate_name, b.role_title, b.department, b.drafted_by_name, b.approval?.approver_name], `${s} for the approver with no read of candidate, role or people: the names come from the offer`).toEqual([200, candName(l.cand[s]), ROLE_TITLE.ra, 'Operations', fullName(SUB.recA), fullName(SUB.apprA)]);
      expect.soft(r.calls.filter((c: any) => c.service === 'cognito').length, `${s}: no sign-in pool read`).toBe(0);
      const lst = list(C.apprA, { candidate_id: l.cand[s] }, l.t, o(1304, { extra: { s3: l.s3, cognito: { users: [] }, denyReads: deny } }));
      expect.soft([statusOf(lst), (bodyOf(lst)?.offers ?? [])[0]?.candidate_name], `${s}: the list too`).toEqual([200, candName(l.cand[s])]);
    }
    // The approver's never-submitted draft: the same 404 as a missing id. The hiring manager: their candidate's only.
    const draft = get(C.apprA, l.id.DRAFT, l.t, o(1305));
    expect.soft(answer(draft), 'the approver on a draft nobody submitted: 404').toEqual([404, NOT_FOUND]);
    expect.soft(answer(draft), 'the same as an id that does not exist').toEqual(answer(get(C.apprA, 'offer-does-not-exist-0000000000', l.t, o(1305))));
    expect.soft(answer(get(C.apprA, l.id.WITHDRAWN, l.t, o(1305))), 'and on a draft withdrawn before anyone submitted it').toEqual([404, NOT_FOUND]);
    expect.soft(statusOf(get(C.apprA, l.id.SENT_BACK, l.t, o(1305))), 'a sent-back draft was submitted once: 200').toBe(200);
    expect.soft(statusOf(get(C.hmA, l.id.DRAFT, l.t, o(1306))), 'the hiring manager of the candidate reads it').toBe(200);
    for (const who of [C.hm2A, C.empA, C.guestA, C.adminA, C.hrNoTickA]) expect.soft(answer(get(who, l.id.SENT, l.t, o(1306))), `${who.name}: 404`).toEqual([404, NOT_FOUND]);
    // Every write answer holds salary null; a cached answer holds no salary.
    for (const { what, run } of RUNS.filter((x) => x.run.response && ok(x.run) && !/^(get|read|list|reveal|hm read|expiry run)/.test(x.what))) {
      const b = bodyOf(run);
      if (!b || typeof b !== 'object' || !('offer_id' in b)) continue;
      expect.soft('salary' in b ? b.salary : 'missing', `${what}: the answer's salary is null`).toBeNull();
    }
    const KEY = 'rec05-cache-check-0001';
    const made = must('create with a key', create(C.recA, draftBody(K.a[27]!), world(), { now: at(1310), headers: { 'idempotency-key': KEY } }));
    const edited = must('patch with a key', patch(C.recA, idOf(made), { version: 1, salary: 455500.25 }, made.tables, { now: at(1311), headers: { 'idempotency-key': `${KEY}-p` } }));
    const cache = JSON.stringify(rowsOf(edited.tables, TABLE.idempotency));
    expect.soft(cache.includes(KEY), 'the answers were cached under the keys').toBe(true);
    expect.soft(cache.includes(String(SALARY)) || cache.includes('455500.25'), 'the cached answers hold no salary').toBe(false);
  });

  // ---------------------------------------------------------------- AC-14

  test('AC-14 Edit a draft: PATCH changes the given fields of a DRAFT and adds one to version; an APPROVED offer goes back to DRAFT; other states NOT_OPEN; a stale version is STALE everywhere; one change per key; who may edit', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(600_000);
    const t0 = world();
    const d = build(t0, K.a[9]!, 'DRAFT', 0);
    const p1 = must('patch', patch(C.recA, d.id, { version: 1, salary: 499000, benefits: 'Medical aid only.' }, d.t, { now: at(10) }));
    const b = bodyOf(p1) ?? {};
    expect.soft([b.state, b.version, b.benefits, b.salary], 'DRAFT stays DRAFT, version 2, benefits changed, salary null in the answer').toEqual(['DRAFT', 2, 'Medical aid only.', null]);
    expect.soft(bodyOf(get(C.recA, d.id, p1.tables, { now: at(11), query: { reveal: 'salary' } }))?.salary, 'the new salary is stored').toBe(499000);
    const h = ((b.history ?? []) as any[]).at(-1) ?? {};
    expect.soft([h.from, h.to, h.kind, [...(h.fields ?? [])].sort(), h.by_name], 'an EDITED history row naming the fields').toEqual(['DRAFT', 'DRAFT', 'EDITED', ['benefits', 'salary'], fullName(SUB.recA)]);
    // The history, wherever the builder keeps it: rows naming the offer other than the offer row itself, the row's own history fields, the answer's.
    const stored = offerRow(p1.tables, d.id) ?? {};
    const others = rowsOf(p1.tables).filter((r) => JSON.stringify(r).includes(d.id) && !(r['offer_id'] === d.id && 'state' in r));
    const historyText = JSON.stringify(others) + JSON.stringify(Object.entries(stored).filter(([k]) => /history/i.test(k))) + JSON.stringify(b.history);
    expect.soft(historyText, 'no history holds the values').not.toMatch(/499000|Medical aid only/);
    // Each bad field: 400 INVALID_FIELD, nothing written. The expiry is checked against the start date that will be stored.
    const t1 = p1.tables;
    for (const [what, body, field] of [
      ['salary 0', { salary: 0 }, 'salary'], ['salary as text', { salary: '1' }, 'salary'], ['start in the past', { start_date: '2026-11-01' }, 'start_date'],
      ['expiry after the stored start', { expiry_date: '2027-01-05' }, 'expiry_date'], ['a start before the stored expiry', { start_date: '2026-12-01' }, 'expiry_date'],
      ['benefits 2001 characters', { benefits: 'x'.repeat(2001) }, 'benefits'], ['expiry not a day', { expiry_date: '2026-12-32' }, 'expiry_date'],
    ] as const) refused(`patch ${what}`, t1, patch(C.recA, d.id, { version: 2, ...body }, t1, { now: at(12) }), 400, invalid(field));
    const none = patch(C.recA, d.id, { version: 2 }, t1, { now: at(12) });
    expect.soft(statusOf(none), 'a PATCH with none of the four fields: 400').toBe(400);
    nothingDone('a PATCH with none of the four fields', t1, none);
    const both = must('patch both dates', patch(C.recA, d.id, { version: 2, start_date: '2027-02-01', expiry_date: '2027-01-20' }, t1, { now: at(13) }));
    expect.soft([bodyOf(both)?.start_date, bodyOf(both)?.expiry_date, bodyOf(both)?.version], 'both dates together, judged against each other').toEqual(['2027-02-01', '2027-01-20', 3]);
    // Fields that may not change are ignored.
    const ign = must('patch with extras', patch(C.recA, d.id, { version: 3, benefits: 'Fuel card.', role_title: 'Chief executive', candidate_id: K.a[1], currency: 'USD', state: 'APPROVED', tenant_id: B, drafted_by: SUB.rec2A, approval: { approver_id: SUB.apprA } }, both.tables, { now: at(14) }));
    const row = offerRow(ign.tables, d.id) ?? {};
    expect.soft([row['role_title'], row['candidate_id'], row['currency'], row['state'], row['tenant_id'], row['drafted_by'], row['approval'] ?? null, row['benefits']], 'only benefits changed').toEqual([ROLE_TITLE.ra, d.candidate, 'ZAR', 'DRAFT', A, SUB.recA, null, 'Fuel card.']);

    // APPROVED goes back to DRAFT, the approval moves to approval_history; a send is then NOT_APPROVED.
    const ap = build(t0, K.a[10]!, 'APPROVED', 20);
    const back = must('patch approved', patch(C.recA, ap.id, { version: ap.version, salary: 470000 }, ap.t, { now: at(30) }));
    expect.soft([bodyOf(back)?.state, bodyOf(back)?.approval ?? null, bodyOf(back)?.version], 'APPROVED becomes DRAFT, no approval, version up one').toEqual(['DRAFT', null, ap.version + 1]);
    const kept = JSON.stringify(offerRow(back.tables, ap.id)?.['approval_history'] ?? null);
    expect.soft(kept.includes(SUB.apprA) && kept.includes('ONE_APPROVER'), 'the approval is kept in approval_history').toBe(true);
    refused('send after the edit', back.tables, act(R.send, C.recA, ap.id, {}, back.tables, { now: at(31) }), 409, conflict('NOT_APPROVED'));
    // Other states: NOT_OPEN, nothing written.
    const l = ladder();
    for (const s of ['WAITING_APPROVAL', 'SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'] as const) {
      const v = bodyOf(get(C.recA, l.id[s], l.t, opts(l, { now: at(1400) })))?.version;
      refused(`patch on ${s}`, l.t, patch(C.recA, l.id[s], { version: v, salary: 1000 }, l.t, opts(l, { now: at(1401) })), 409, conflict('NOT_OPEN'));
    }
    // A missing or old version: STALE on PATCH, approve and send-back, nothing written.
    const w = build(t0, K.a[11]!, 'WAITING_APPROVAL', 40);
    const wrong = (v: number): [string, unknown][] => [['missing', undefined], ['old', v - 1], ['ahead', v + 1], ['as text', String(v)]];
    const withVersion = (v: unknown, extra: Record<string, unknown>) => ({ ...(v === undefined ? {} : { version: v }), ...extra });
    for (const [what, v] of wrong(w.version)) {
      refused(`approve with a ${what} version`, w.t, act(R.approve, C.apprA, w.id, withVersion(v, {}), w.t, { now: at(50) }), 409, conflict('STALE'));
      refused(`send back with a ${what} version`, w.t, act(R.sendBack, C.apprA, w.id, withVersion(v, { note: 'Fix it.' }), w.t, { now: at(50) }), 409, conflict('STALE'));
    }
    for (const [what, v] of wrong(d.version)) refused(`patch with a ${what} version`, d.t, patch(C.recA, d.id, withVersion(v, { salary: 1000 }), d.t, { now: at(50) }), 409, conflict('STALE'));
    // Two approves on one version: the one that writes second loses with STALE.
    const first = must('approve first', act(R.approve, C.apprA, w.id, { version: w.version }, w.t, { now: at(51) }));
    const winner = (w.t[TABLE.state] ?? []).find((r) => plain(r)['offer_id'] === w.id);
    const winnerAfter = (first.tables[TABLE.state] ?? []).find((r) => plain(r)['offer_id'] === w.id);
    expect(winner && winnerAfter, 'the offer row is found by offer_id').toBeTruthy();
    const race = act(R.approve, C.bothA, w.id, { version: w.version }, w.t, { now: at(52), extra: { cognito: { users: poolUsers() }, s3: S3_EMPTY, raceBeforeWrite: { table: TABLE.state, match: { offer_id: { S: w.id } }, replace: winnerAfter! } } });
    expect.soft(answer(race), 'the second approve on the same version: 409 STALE').toEqual([409, conflict('STALE')]);
    expect.soft(JSON.stringify((race.tables[TABLE.state] ?? []).find((r) => plain(r)['offer_id'] === w.id)), 'the first approve stands').toBe(JSON.stringify(winnerAfter));
    // Two edits of one DRAFT on one version (the state stays DRAFT, so only the version can tell them apart): the second loses with STALE.
    const firstEdit = must('edit first', patch(C.recA, d.id, { version: d.version, salary: 2000 }, d.t, { now: at(53) }));
    const editAfter = (firstEdit.tables[TABLE.state] ?? []).find((r) => plain(r)['offer_id'] === d.id);
    expect(editAfter, 'the edited offer row is found by offer_id').toBeTruthy();
    const editRace = patch(C.recA, d.id, { version: d.version, salary: 3000 }, d.t, { now: at(54), extra: { raceBeforeWrite: { table: TABLE.state, match: { offer_id: { S: d.id } }, replace: editAfter! } } });
    expect.soft(answer(editRace), 'the second edit on the same version: 409 STALE').toEqual([409, conflict('STALE')]);
    expect.soft(JSON.stringify((editRace.tables[TABLE.state] ?? []).find((r) => plain(r)['offer_id'] === d.id)), 'the first edit stands').toBe(JSON.stringify(editAfter));
    // The same Idempotency-Key twice: one change.
    const KEY = 'rec05-patch-key-0001';
    const k1 = must('patch with a key', patch(C.recA, d.id, { version: 2, salary: 488000 }, t1, { now: at(60), headers: { 'idempotency-key': KEY } }));
    const k2 = keep('the same patch again', patch(C.recA, d.id, { version: 2, salary: 488000 }, k1.tables, { now: at(61), headers: { 'idempotency-key': KEY } }));
    expect.soft(answer(k2), 'the second answer is the first').toEqual(answer(k1));
    expect.soft(JSON.stringify(offerRow(k2.tables, d.id)), 'and changes nothing more').toBe(JSON.stringify(offerRow(k1.tables, d.id)));
    expect.soft(((bodyOf(get(C.recA, d.id, k2.tables, { now: at(62) }))?.history ?? []) as any[]).filter((x) => x.kind === 'EDITED').length, 'one EDITED row for the two calls (plus the first edit)').toBe(2);
    // Who may edit.
    for (const who of [C.hmA, C.apprA, C.adminA, C.empA]) {
      const x = patch(who, d.id, { version: 2, salary: 1000 }, t1, { now: at(63) });
      expect.soft([...answer(x), awsOf(x).length], `${who.name}: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }
    refused('company B\'s Recruiter', t1, patch(C.recB, d.id, { version: 2, salary: 1000 }, t1, { now: at(63) }), 404, NOT_FOUND);
    // A second Recruiter may edit another's draft; the original drafter still cannot approve after.
    const dd = build(t0, K.a[12]!, 'DRAFT', 70, { drafter: C.bothA });
    const e2 = must('second Recruiter edits', patch(C.rec2A, dd.id, { version: 1, salary: 410000 }, dd.t, { now: at(80) }));
    expect.soft([bodyOf(e2)?.version, offerRow(e2.tables, dd.id)?.['drafted_by'], bodyOf(e2)?.drafted_by_me], 'edited by the second Recruiter; drafted_by stays bothA').toEqual([2, SUB.bothA, false]);
    const s2 = must('submit', act(R.submit, C.bothA, dd.id, {}, e2.tables, { now: at(81) }));
    refused('the original drafter approves after another edited', s2.tables, act(R.approve, C.bothA, dd.id, { version: versionOf(s2) }, s2.tables, { now: at(82) }), 403, FORBIDDEN);
  });

  test('AC-14 One key belongs to one company and one route: the same Idempotency-Key from company B, or on another route, does its own work and never gets another answer back', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    let t = world();
    const a = build(t, K.a[13]!, 'DRAFT', 0); t = a.t;
    const b = build(t, K.b[1]!, 'DRAFT', 10); t = b.t;
    const h = { 'idempotency-key': 'rec05-shared-key-0001' };
    const pa = must('A edits with the key', patch(C.recA, a.id, { version: a.version, salary: 410000 }, t, { now: at(20), headers: h }));
    // B's Recruiter sends the same key on its own draft: B's own edit happens.
    const pb = must('B edits its own draft with the same key', patch(C.recB, b.id, { version: b.version, salary: 420000 }, pa.tables, { now: at(21), headers: h }));
    expect.soft([bodyOf(pb)?.offer_id, bodyOf(pb)?.version], 'B gets its own offer back, edited, not A\'s answer').toEqual([b.id, b.version + 1]);
    expect.soft(offerRow(pb.tables, b.id)?.['salary'], 'B\'s offer is changed').toBe(420000);
    expect.soft(JSON.stringify(offerRow(pb.tables, a.id)), 'A\'s offer is as A left it').toBe(JSON.stringify(offerRow(pa.tables, a.id)));
    expect.soft(JSON.stringify(bodyOf(pb)), 'nothing of A in B\'s answer').not.toContain(a.id);
    // B's Recruiter sends the same key on A's offer: the 404 any B caller gets, never A's stored answer.
    // (B may keep its own record of the key, under B's name; nothing else is written and nothing of A is kept.)
    const bOnA = patch(C.recB, a.id, { version: a.version, salary: 410000 }, pa.tables, { now: at(22), headers: h });
    expect.soft(answer(bOnA), 'B sends the key on A\'s offer: 404, never A\'s stored answer').toEqual([404, NOT_FOUND]);
    expect.soft(changed(pa.tables, bOnA.tables).filter((x) => !x.startsWith(`${TABLE.idempotency} `)), 'B on A\'s offer: no row changes but B\'s own key record').toEqual([]);
    for (const k of newRows(pa.tables, bOnA.tables)) {
      expect.soft(JSON.stringify(k.row), 'a key record B keeps is filed under B').toContain(B);
      expect.soft(JSON.stringify(k.row), 'and holds nothing of A\'s offer').not.toMatch(new RegExp(`${a.id}|410000|${A}`));
    }
    expect.soft(eventsOf(bOnA), 'and no event').toEqual([]);
    // The same key on another route of A: the submit runs (it is not the edit's answer).
    const sa = must('A submits with the same key', act(R.submit, C.recA, a.id, {}, pa.tables, { now: at(23), headers: h }));
    expect.soft([bodyOf(sa)?.state, bodyOf(sa)?.version], 'the submit runs: WAITING_APPROVAL, version up one more').toEqual(['WAITING_APPROVAL', a.version + 2]);
    expect.soft(offerRow(sa.tables, a.id)?.['state'], 'and is stored').toBe('WAITING_APPROVAL');
    // The same key again on A's PATCH: the edit's answer again, and nothing written.
    const again = patch(C.recA, a.id, { version: a.version, salary: 410000 }, sa.tables, { now: at(24), headers: h });
    expect.soft(answer(again), 'A\'s PATCH with its key again: the first answer').toEqual(answer(pa));
    expect.soft(changed(sa.tables, again.tables), 'and no row changes').toEqual([]);
    // A create with the key A used on PATCH is a create.
    const ca = keep('A creates with the same key', create(C.recA, draftBody(K.a[14]!), pa.tables, { now: at(25), headers: h }));
    expect.soft([statusOf(ca) === 200 || statusOf(ca) === 201, bodyOf(ca)?.candidate_id, bodyOf(ca)?.state], `the create runs (${describe(ca)})`).toEqual([true, K.a[14], 'DRAFT']);
  });

  test('AC-14 Every write adds exactly one to version, in the answer and on the stored row: create, submit, send-back, approve, PATCH, send, accept, decline, withdraw (from DRAFT and from SENT) and expiry', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(500_000);
    const t0 = world();
    const vCheck = (what: string, r: Run, id: string, want: number) => {
      expect.soft(bodyOf(r)?.version, `${what}: the answer's version is ${want}`).toBe(want);
      expect.soft(offerRow(r.tables, id)?.['version'], `${what}: the stored version is ${want}`).toBe(want);
    };
    let r = must('draft', create(C.recA, draftBody(K.a[16]!), t0, { now: at(1) }));
    const id = idOf(r);
    vCheck('create', r, id, 1);
    let n = 2;
    const step = (what: string, f: (t: Tables) => Run, want: number) => { r = must(what, f(r.tables)); vCheck(what, r, id, want); n += 1; };
    step('submit', (t) => act(R.submit, C.recA, id, {}, t, { now: at(n) }), 2);
    step('send back', (t) => act(R.sendBack, C.apprA, id, { version: 2, note: 'Check the date.' }, t, { now: at(n) }), 3);
    step('submit again', (t) => act(R.submit, C.recA, id, {}, t, { now: at(n) }), 4);
    step('approve', (t) => act(R.approve, C.apprA, id, { version: 4 }, t, { now: at(n) }), 5);
    step('PATCH of the approved offer', (t) => patch(C.recA, id, { version: 5, salary: 401000 }, t, { now: at(n) }), 6);
    step('submit a third time', (t) => act(R.submit, C.recA, id, {}, t, { now: at(n) }), 7);
    step('approve again', (t) => act(R.approve, C.apprA, id, { version: 7 }, t, { now: at(n) }), 8);
    step('send', (t) => act(R.send, C.recA, id, {}, t, { now: at(n) }), 9);
    const up = must('signed upload', act(R.upload, C.recA, id, PDF, r.tables, { now: at(n) }));
    expect.soft(offerRow(up.tables, id)?.['version'], 'the upload link changes no version').toBe(9);
    const s3: S3World = { bucket: UPLOAD_BUCKET, objects: { [bodyOf(up)?.signed_key]: { size: PDF.file_size, contentType: PDF.content_type } } };
    r = up;
    step('accept', (t) => act(R.answer, C.recA, id, { answer: 'ACCEPTED', signed_key: bodyOf(up)?.signed_key, confirmed_start_date: START }, t, { now: at(n + 1), extra: { s3, cognito: { users: poolUsers() } } }), 10);
    // The others, each on its own offer.
    const dec = build(t0, K.a[17]!, 'SENT', 100);
    vCheck('decline', must('decline', act(R.answer, C.recA, dec.id, { answer: 'DECLINED' }, dec.t, { now: at(120) })), dec.id, dec.version + 1);
    const dr = build(t0, K.a[18]!, 'DRAFT', 130);
    vCheck('withdraw from DRAFT', must('withdraw from DRAFT', act(R.withdraw, C.recA, dr.id, {}, dr.t, { now: at(140) })), dr.id, dr.version + 1);
    const se = build(t0, K.a[19]!, 'SENT', 150);
    vCheck('withdraw from SENT', must('withdraw from SENT', act(R.withdraw, C.recA, se.id, {}, se.t, { now: at(160) })), se.id, se.version + 1);
    const ex = build(t0, K.a[20]!, 'SENT', 170);
    const m = keep('expiry run', monitor(ex.t, AFTER_EXPIRY));
    expect.soft([offerRow(m.tables, ex.id)?.['state'], offerRow(m.tables, ex.id)?.['version']], 'expiry: EXPIRED, the stored version up one').toEqual(['EXPIRED', ex.version + 1]);
  });

  // ---------------------------------------------------------------- AC-15

  test('AC-15 CORS and old routes: the API carrying /v1/offers allows PATCH and idempotency-key; every new route exists with the JWT authoriser; the old write routes answer 410 OLD_ROUTE and write nothing; their 403, 404 and module answers stay', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(400_000);
    const all = resourcesOf('talent-flow-infra', 'aws_apigatewayv2_route');
    const plainKey = (v: string | undefined) => (v ?? '').replace(/["\s]/g, '');
    const integrations = resourcesOf('talent-flow-infra', 'aws_apigatewayv2_integration');
    const apis = new Set<string>();
    for (const key of Object.values(R)) {
      const found = all.filter((b) => plainKey(attributes(b.body).get('route_key')) === plainKey(key));
      expect.soft(found.length, `${key} is declared once`).toBe(1);
      const b = found[0];
      if (!b) continue;
      const a = attributes(b.body);
      expect.soft((a.get('authorization_type') ?? '').replace(/"/g, ''), `${key}: JWT`).toBe('JWT');
      expect.soft(a.get('authorizer_id') ?? '', `${key}: the Cognito JWT authoriser`).toMatch(/aws_apigatewayv2_authorizer\.talent_flow_api_cognito\.id/);
      const integration = /integrations\/\$\{aws_apigatewayv2_integration\.([\w-]+)\.id\}/.exec(a.get('target') ?? '')?.[1];
      const i = integrations.find((x) => x.labels[1] === integration);
      expect.soft(/aws_lambda_function\.manage_offers\.invoke_arn/.test(attributes(i?.body ?? '').get('integration_uri') ?? ''), `${key} goes to manageOffers`).toBe(true);
      const api = /aws_apigatewayv2_api\.([\w-]+)\.id/.exec(a.get('api_id') ?? '')?.[1];
      if (api) apis.add(api);
    }
    expect.soft([...apis], 'every offers route is on one API').toHaveLength(1);
    for (const api of apis) {
      const b = resourcesOf('talent-flow-infra', 'aws_apigatewayv2_api').find((x) => x.labels[1] === api);
      const cors = /cors_configuration\s*\{([\s\S]*?)\n\s*\}/.exec(b?.body ?? '')?.[1] ?? '';
      expect.soft(/allow_methods\s*=\s*\[[^\]]*"PATCH"/.test(cors), `${api}: allow_methods holds PATCH`).toBe(true);
      expect.soft(/allow_headers\s*=\s*\[[^\]]*"idempotency-key"/i.test(cors), `${api}: allow_headers holds idempotency-key`).toBe(true);
    }
    // The old write routes: 410 OLD_ROUTE for a Recruiter of a company with Recruitment on, nothing written, nothing started.
    const t = world();
    const oc = oldCreate(C.recA, K.a[28]!, {}, t);
    refused('POST /v1/candidates/{id}/offer', t, oc, 410, OLD_ROUTE);
    expect.soft(oc.calls.filter((c: any) => /^(sfn|events)$/.test(c.service)).length, 'nothing started or published').toBe(0);
    const payload = { baseSalary: 100000, currency: 'ZAR', startDate: '2027-01-01', expiryDate: '2026-12-20' };
    const actions: [string, number, Record<string, unknown>][] = [
      ['SUBMIT_FOR_APPROVAL', 0, payload], ['MARK_SENT', 1, {}], ['CONFIRM_ACCEPTANCE', 2, { acceptanceDate: '2026-11-25', confirmedStartDate: '2027-01-04', acceptanceSentiment: 'POSITIVE' }],
      ['LOG_INTERACTION', 2, { interactionType: 'CALL', outcome: 'ACKNOWLEDGED' }],
    ];
    for (const [action, i, p] of actions) {
      const r = oldPut(C.recA, K.l[i]!, { action, payload: p }, t);
      refused(`PUT /v1/candidates/{id}/offer ${action} on an old ${LEGACY[i]![0]} row`, t, r, 410, OLD_ROUTE);
    }
    expect.soft(rowsOf(t).find((r) => r['PK'] === `CANDIDATE#${K.l[1]}` && r['SK'] === 'OFFER')?.['state'], 'MARK_SENT on IN_APPROVAL left it unsent').toBe('IN_APPROVAL');
    // Their answers to the callers who got a 403, 404 or module answer before stay the same.
    for (const [what, r, want] of [
      ['an Employee creates', oldCreate(C.empA, K.a[28]!, {}, t), [403, FORBIDDEN]], ['an Employee advances', oldPut(C.empA, K.l[0]!, { action: 'SUBMIT_FOR_APPROVAL', payload }, t), [403, FORBIDDEN]],
      ['B\'s Recruiter creates on A\'s candidate', oldCreate(C.recB, K.a[28]!, {}, t), [404, NOT_FOUND]], ['B\'s Recruiter advances A\'s offer', oldPut(C.recB, K.l[0]!, { action: 'SUBMIT_FOR_APPROVAL', payload }, t), [404, NOT_FOUND]],
      ['D\'s Recruiter creates (Recruitment off)', oldCreate(C.recD, K.a[28]!, {}, t), [403, FORBIDDEN]], ['D\'s Recruiter advances (Recruitment off)', oldPut(C.recD, K.l[0]!, { action: 'SUBMIT_FOR_APPROVAL', payload }, t), [403, FORBIDDEN]],
    ] as [string, Run, unknown[]][]) refused(what, t, r, want[0] as number, want[1]);
    // Today's read stays (read only).
    const g = oldGet(C.recA, K.l[2]!, t);
    expect.soft([statusOf(g), bodyOf(g)?.state], 'GET /v1/candidates/{id}/offer still reads (the mapped state)').toEqual([200, 'SENT']);
    void [C.hmA, DAY];
  });
});

/** A refused call on a route with no offer id (create or list), for AC-10. */
function call2(route: string, who: Caller, l: Ladder): Run {
  return route === R.create ? create(who, draftBody(K.a[29]!), l.t, opts(l, { now: at(1150) })) : list(who, {}, l.t, opts(l, { now: at(1150) }));
}
