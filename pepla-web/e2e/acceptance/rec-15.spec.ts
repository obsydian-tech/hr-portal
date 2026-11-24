import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO, runModule } from './support/rec-14/lambda-harness';
import { answerSchema, checker, looseObjects, operation, readDoc, refName, type Doc } from './support/rec-14/schema';
import { blocks } from './support/infra-harness';
import { lambdaNamed, policyLines, resourcesOf, roleResourceOf, settingsOf, valueOf } from './support/rec-04/iam';
import { C, RECRUITERS } from './support/rec-04/callers';
import { bodyOf, describe, isModulesRead, statusOf } from './support/rec-04/world';
import { anyWrite, awsOf, changedRows, logsOf } from './support/rec-04/roles';
import {
  A, B, FIX, K, NOW, R, ROLES_TABLE, ROLE_TITLE, SUB, TABLE, THRESHOLDS_A, THRESHOLDS_OLD, after, ago, av, candidateRow, emailOf, fullName, idNumberOf,
  list, many, monitorVerdicts, phoneOf, plain, role, roleRow, roles, runMonitor, withCandidate, withRole, withRows, withThresholds, world, type Run, type Tables,
} from './support/rec-15/world';
import { isRec07Grant } from './support/rec-07.1/grants';

/**
 * REC-15 step A · The candidate lists answer what the screens draw, from one stage clock (amber). Spec:
 * /mnt/project-files/onboarding-cards/specs/REC-15.md, Part 1 (rules 1 to 11) with rules 29 and 30 for the list, AC-1 to AC-6, the list half of
 * AC-16 and step A's lines of AC-17. Notes: cards/rec-15.md. Review page: onboarding-cards/specs/REC-15-step-A-tests-for-review.md (the bar).
 *
 * Scope (coordinator, 23 Nov 2026): one card step per thread, so this lock covers step A only. Steps B (add a candidate), C (the record) and
 * D (interviews and names) get their own tests later as rec-15.2 and on. The harness half of rule 31 (the board's fake checked against
 * CandidateList) is left to REC-UI-02's tests, see D-T-A12.
 * Child lock that carries this step: rec-04.3 (REC-04's count and list fixtures carry a stage time; its Terraform check lets getCandidates
 * read the company's settings).
 *
 * The Lambda tests run the real handlers (lambda/getCandidates, lambda/manageRoles, lambda/monitorTalentFlowSLAs) in a fresh Node process
 * each call, against REC-14's fake AWS over REC-04's world with this card's candidates (support/rec-15/world.ts), at one fixed time (NOW,
 * support/rec-15/clock.mjs). Every answer is checked against api/openapi.yaml. Terraform is read as text. Nothing calls AWS or any AI.
 * Nothing here has a screen width: each test runs once, at 1280.
 *
 * Pinned by the verifier where the spec is silent (each is in cards/rec-15.md for the BA to confirm):
 *  - D-T-A1 The clock reads the company's active SLA_THRESHOLDS. A company with no such setting has no clock: every open candidate is
 *    due_at null and ON_TRACK (spec prod note 3). The monitor's own fallback to built-in hours is not copied.
 *  - D-T-A2 A failed read (the candidate index, the settings, a role) is 500 with no list and no counts, never a list worked out without it.
 *    The 500 body passes the file's 500 schema; the log carries the error's name, not its message.
 *  - D-T-A3 A row has exactly id, name, stage, stage_entered_at, due_at, sla_status, role_id, role_title, level, applied_at,
 *    hiring_manager_id, mine, and `source` only when the stored row has one. due_at and sla_status are null (present) on Hired and Not hired;
 *    role_id is null (present) for a candidate with no role. name is first and last name joined by one space. level is the stored
 *    positionLevel. stage_entered_at and applied_at name the same instant as the stored value (any ISO form).
 *  - D-T-A4 Times compare as instants: due_at is stage_entered_at plus the stage's hours to the second.
 *  - D-T-A5 The query names in rule 3 are the only ones read; any other name (tenantId, positionLevel, slaStatus, hiringManagerId) is
 *    ignored, never refused, so a stale caller is not broken and the company is never read from it. A value outside rule 3 is
 *    400 { error: 'Bad request', code: 'INVALID_FIELD', field } and nothing but the module row is read. An old stage name in `stage` is
 *    outside rule 3. `role_id=` (empty) is all roles.
 *  - D-T-A6 `search` matches the full name, the email or the role_title the row shows (the role's current title), never the stored
 *    positionTitle of a row whose role exists.
 *  - D-T-A7 Ties in the order are broken by id, ascending.
 *  - D-T-A8 nextToken is any text the server can read back; it must not hold a company id, a table key name or a key value (TENANT#,
 *    CANDIDATE#, SAGA, GSI1, PK, SK). A token the server cannot read, or one of the old route's DynamoDB keys, is 400 field nextToken.
 *  - D-T-A9 A manager who is not a Recruiter and hires for nobody gets 200 with an empty list and zero counts (REC-01 lets every manager
 *    in). The spec's AC-6 says "another manager ... 403"; the tests read that as REC-01 unchanged. For the BA.
 *  - D-T-A10 `mine` is true for the row's hiring manager or its added_by. The old recruiterId field is not read.
 *  - D-T-A11 Above 5,000 company rows the answer is 500 with code LIST_TOO_LARGE; 5,000 rows still answer.
 *  - D-T-A12 Rule 31's harness check is left to REC-UI-02's tests: the board's fake gives four fields CandidateRow does not have
 *    (interviews_done, interviews_required, offer_state, pending), which is a gap for the BA, not a lock to write blind.
 *  - D-T-A13 GET /v1/roles and GET /v1/roles/{id} count overdue_count and due_soon_count with the same clock, so a role's numbers equal
 *    the list's counts.overdue and counts.due_soon for that role (rule 11).
 *  - D-T-A14 The role-filtered list still reads the role-id-index (REC-04 AC-6 pins it); the all-roles list reads GSI1. Neither scans.
 *  - D-T-A15 Terraform: getCandidates gains exactly one grant, Query on talent-flow-config's GSI1-active-configs index, and its Lambda
 *    gets CONFIG_TABLE_NAME. The settings table is encrypted with the state key getCandidates already holds. No other role changes.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const FORBIDDEN = { error: 'Forbidden' };
const invalid = (field: string) => ({ error: 'Bad request', code: 'INVALID_FIELD', field });
const answer = (r: Run) => [statusOf(r), bodyOf(r)];
const ROUTE = 'GET /v1/candidates';
const ROW_KEYS = ['applied_at', 'due_at', 'hiring_manager_id', 'id', 'level', 'mine', 'name', 'role_id', 'role_title', 'sla_status', 'stage', 'stage_entered_at'];
const ZERO = { all: 0, mine: 0, overdue: 0, due_soon: 0, not_hired: 0 };
const EMPTY = { candidates: [], counts: ZERO };
const rowsIn = (r: Run): any[] => (bodyOf(r)?.candidates ?? []) as any[];
const idsIn = (r: Run): string[] => rowsIn(r).map((x) => x?.id);
const sorted = (a: string[]) => [...a].sort();
const byId = (r: Run, id: string) => rowsIn(r).find((x) => x?.id === id);
const ms = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : NaN);
const HOUR = 3_600_000;

/** Company A as a Recruiter sees it with no filter: every candidate but the Not hired ones and the stray row. */
const VISIBLE_A = [K.a1, K.a2, K.s1, K.s2, K.i1, K.i2, K.o1, K.o2, K.h1, K.h2, K.h3, K.r0, K.g1, K.ad, K.rc];
/** The order rule 9 gives that list at NOW (due dates: o1 -178h, o2 -8h, s2 0, s1 +0.48h, a2 +6, a1 +14, ad +19, g1 +21, r0 +22, i2 +25, i1 +26, rc +42; Hired newest first). */
const ORDER_A = [K.o1, K.o2, K.s2, K.s1, K.a2, K.a1, K.ad, K.g1, K.r0, K.i2, K.i1, K.rc, K.h3, K.h2, K.h1];
const OF_HMA = [K.a1, K.a2, K.s1, K.i1, K.i2, K.o2, K.h1, K.h3, K.r0, K.g1, K.rc];
const OF_HM2A = [K.s2, K.o1, K.h2, K.ad];
const FLEET = [K.a1, K.a2, K.s1, K.i1, K.i2, K.o2, K.h1, K.ad, K.rc];

// ---------------------------------------------------------------- the contract (rules 29 and 30)

let docCache: Doc | undefined;
const doc = () => (docCache ??= readDoc());
function misfit(route: string, r: Run): string[] {
  const s = statusOf(r);
  if (s === undefined) return [`no answer (${describe(r)})`];
  return checker(doc()).check(answerSchema(doc(), route, s), bodyOf(r)).map((p) => `${route} ${s}: ${p}`);
}
/** Every answer passes the file's schema for its route and status. */
const fits = (label: string, ...runs: Run[]) => {
  for (const r of runs) expect.soft(misfit(ROUTE, r), `${label}: the answer (${describe(r).slice(0, 120)}) passes api/openapi.yaml`).toEqual([]);
};

/** No write call, and no row of any table is different. */
const noWrite = (label: string, before: Tables, r: Run) => {
  expect.soft(anyWrite(r).length, `${label}: no write call`).toBe(0);
  expect.soft(changedRows(before, r.tables).map((x) => `${x['table']} ${x['pk'] ?? x['PK']} ${x['sk'] ?? x['SK']}`), `${label}: no row is different`).toEqual([]);
};
/** Only the module row may be read (a refused query reads nothing else). */
const readsNothing = (label: string, r: Run) => {
  expect.soft(awsOf(r).filter((c: any) => !isModulesRead(c)).map((c: any) => `${c.service} ${c.op} ${c.table ?? ''}`), `${label}: nothing but the module row is read`).toEqual([]);
};

/** What a row of company A or B must hold, for the caller `me` (D-T-A3). */
function rowIsRight(label: string, x: any, me: string) {
  const id = x?.id as string;
  const f = FIX[id];
  if (!f) { expect.soft(id, `${label}: a row of this card (got ${JSON.stringify(x).slice(0, 120)})`).toBe('a fixture id'); return; }
  const stored = plain(candidateRow(id, f));
  const keys = Object.keys(x ?? {}).sort();
  const want = sorted([...ROW_KEYS, ...(stored['source'] !== undefined ? ['source'] : [])]);
  expect.soft(keys, `${label} ${id}: exactly the CandidateRow fields (D-T-A3)`).toEqual(want);
  expect.soft(x.name, `${label} ${id}: name`).toBe(fullName(id));
  expect.soft(x.stage, `${label} ${id}: stage (a code; an old name or old outcome reads as its new stage)`).toBe(f.want!.stage);
  const roleId = f.role ?? null;
  expect.soft(x.role_id, `${label} ${id}: role_id (null with no role)`).toBe(roleId);
  const rolesOfCompany: Record<string, string[]> = { [A]: [R.fleet, R.warehouse, R.accountant, R.closed], [B]: [R.b] };
  const roleTitle = roleId && rolesOfCompany[f.company]!.includes(roleId) ? ROLE_TITLE[roleId] : stored['positionTitle'];
  expect.soft(x.role_title, `${label} ${id}: role_title (the role's job title; the row's own title with no role)`).toBe(roleTitle);
  expect.soft(x.level, `${label} ${id}: level`).toBe(stored['positionLevel']);
  expect.soft(x.hiring_manager_id, `${label} ${id}: hiring_manager_id`).toBe(f.hm);
  expect.soft(ms(x.applied_at), `${label} ${id}: applied_at is appliedDate, else createdAt`).toBe(ms(stored['appliedDate'] ?? stored['createdAt']));
  expect.soft(ms(x.stage_entered_at), `${label} ${id}: stage_entered_at is stageEnteredAt, else createdAt`).toBe(ms(stored['stageEnteredAt'] ?? stored['createdAt']));
  expect.soft(x.mine, `${label} ${id}: mine (hiring manager or added_by; D-T-A10)`).toBe(f.hm === me || stored['added_by'] === me);
  if (stored['source'] !== undefined) expect.soft(x.source, `${label} ${id}: source`).toBe(stored['source']);
  expect.soft(x.sla_status, `${label} ${id}: sla_status from the clock (rule 1)`).toBe(f.want!.sla);
  if (f.want!.hours === null) expect.soft(x.due_at, `${label} ${id}: no due date on Hired or Not hired`).toBeNull();
  else expect.soft((ms(x.due_at) - ms(stored['stageEnteredAt'] ?? stored['createdAt'])) / HOUR, `${label} ${id}: due_at is stage_entered_at plus ${f.want!.hours} hours`).toBe(f.want!.hours);
}

/** Everything about a person the list must never send (D-REC-15.4): emails, phones, ID numbers of every candidate. */
function noPersonalData(label: string, r: Run) {
  const text = JSON.stringify(bodyOf(r) ?? null);
  for (const id of Object.keys(FIX)) {
    for (const v of [emailOf(id), phoneOf(id), idNumberOf(id)]) expect.soft(text.includes(v), `${label}: ${v} is not in the answer`).toBe(false);
  }
  expect.soft(/"(email|phone|idNumber|id_number|PK|SK|GSI1PK|GSI1SK|tenant_id|tenantId)"\s*:/.test(text), `${label}: no email, phone, ID number, table key or company field`).toBe(false);
}

/** The order rule 9 asks for, judged on the answer's own fields: open (a status) first by due_at (none last), then closed newest first; ties by id. */
function orderProblems(rows: any[]): string[] {
  const out: string[] = [];
  const key = (x: any) => (x.sla_status !== null ? [0, x.due_at === null ? 1 : 0, x.due_at === null ? 0 : ms(x.due_at)] : [1, 0, -ms(x.stage_entered_at)]);
  for (let i = 1; i < rows.length; i++) {
    const [p, q] = [key(rows[i - 1]), key(rows[i])];
    const cmp = p[0]! - q[0]! || p[1]! - q[1]! || p[2]! - q[2]! || (rows[i - 1].id < rows[i].id ? -1 : rows[i - 1].id > rows[i].id ? 1 : 0);
    if (cmp >= 0) out.push(`${rows[i - 1].id} then ${rows[i].id}`);
  }
  return out;
}

/** Walks every page of a list with this limit; answers the rows in order, the tokens and each page's size. */
function walk(who: any, query: Record<string, string>, t: Tables, limit?: number) {
  const rows: any[] = [];
  const tokens: string[] = [];
  const sizes: number[] = [];
  const runs: Run[] = [];
  let token: string | undefined;
  for (let n = 0; n < 60; n++) {
    const r = list(who, { ...query, ...(limit ? { limit: String(limit) } : {}), ...(token ? { nextToken: token } : {}) }, t);
    runs.push(r);
    if (statusOf(r) !== 200) break;
    rows.push(...rowsIn(r));
    sizes.push(rowsIn(r).length);
    token = bodyOf(r)?.nextToken;
    if (token === undefined) break;
    tokens.push(token);
  }
  return { rows, tokens, sizes, runs, last: runs[runs.length - 1]! };
}
/** A token as text, and as base64 and base64url decoded (whatever it is). */
const decodings = (token: string) => [token, Buffer.from(token, 'base64').toString('utf8'), Buffer.from(token, 'base64url').toString('utf8')];

// ---------------------------------------------------------------- tests

test.describe('REC-15 step A · The candidate lists, from one stage clock', () => {
  test('Control: the world is good: today\'s lists answer, the hourly SLA job runs at the fixed time, B cannot read A', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const all = list(C.recruiter, {}, t);
    expect.soft(statusOf(all), `A's Recruiter lists candidates (${describe(all)})`).toBe(200);
    const fleet = list(C.recruiter, { role_id: R.fleet }, t);
    expect.soft(statusOf(fleet), `the role list runs (${describe(fleet)})`).toBe(200);
    expect.soft(JSON.stringify(bodyOf(list(C.recruiterB, {}, t))), 'B lists none of A\'s').not.toContain(K.a1);
    // The fixed clock reaches the code: at NOW the job finds s2 at 100 percent of Screening's 48 hours and a2 at 75 percent of Applied's 24.
    const m = monitorVerdicts(runMonitor(t));
    expect.soft([m[K.s2], m[K.a2]], 'the SLA job, run at NOW, marks s2 BREACHED and a2 AT_RISK').toEqual(['BREACHED', 'AT_RISK']);
    expect.soft(m[K.a1], 'and leaves a1 (10 of 24 hours) alone').toBeUndefined();
    expect.soft(statusOf(roles(C.recruiter, t)), 'the roles list runs').toBe(200);
  });

  // ---------------------------------------------------------------- AC-1

  test('AC-1 The stage clock: due_at is the stage time plus the company\'s hours; 74 percent on track, 75 and 99 due soon, 100 overdue; createdAt when there is no stage time; no clock on Hired and Not hired', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const t = world();
    const r = list(C.recruiter, {}, t);
    expect.soft(statusOf(r), `a Recruiter lists all roles (${describe(r)})`).toBe(200);
    for (const x of rowsIn(r)) rowIsRight('all roles', x, SUB.recA);
    // The points are 75 and 100 percent (D-REC-15.1), not the company's riskPoints (10, 20, 30 here); a stored BREACHED is not read.
    expect.soft([byId(r, K.i1)?.sla_status, byId(r, K.a2)?.sla_status, byId(r, K.s1)?.sla_status, byId(r, K.s2)?.sla_status],
      'i1 at 74 percent (stored BREACHED), a2 at 75, s1 at 99, s2 at 100').toEqual(['ON_TRACK', 'DUE_SOON', 'DUE_SOON', 'OVERDUE']);
    expect.soft(ms(byId(r, K.o2)?.due_at), 'o2 has no stage time: its clock runs from createdAt (72 hours after)').toBe(ms(ago(80)) + 72 * HOUR);
    expect.soft(ms(byId(r, K.s2)?.due_at), 's2 is due exactly now').toBe(ms(NOW));
    expect.soft([byId(r, K.h1)?.due_at, byId(r, K.h1)?.sla_status, byId(r, K.h3)?.due_at, byId(r, K.h3)?.sla_status], 'Hired (an old name too) has no clock, even with an HIRED key in the hours').toEqual([null, null, null, null]);
    const nh = list(C.recruiter, { stage: 'NOT_HIRED' }, t);
    for (const x of rowsIn(nh)) rowIsRight('Not hired', x, SUB.recA);
    expect.soft(rowsIn(nh).map((x) => [x.due_at, x.sla_status]), 'Not hired (an old outcome too) has no clock').toEqual([[null, null], [null, null]]);
    // B's candidates are judged by B's hours (10 for Applied), not A's (24).
    const b = list(C.recruiterB, {}, t);
    for (const x of rowsIn(b)) rowIsRight('company B', x, SUB.recB);
    expect.soft(byId(b, K.b1)?.sla_status, 'b1, 10 hours into Applied, is overdue by B\'s hours').toBe('OVERDUE');

    // A stage with no hours: no due date and on track; such rows come after every open row with a date (rule 9).
    const noOffer = withThresholds(t, A, { ...THRESHOLDS_A, OFFER: undefined });
    const n = list(C.recruiter, {}, noOffer);
    expect.soft([byId(n, K.o1)?.due_at, byId(n, K.o1)?.sla_status, byId(n, K.o2)?.due_at, byId(n, K.o2)?.sla_status], 'Offer with no hours: due_at null and ON_TRACK').toEqual([null, 'ON_TRACK', null, 'ON_TRACK']);
    expect.soft(idsIn(n), 'the two Offer rows (no date) come last among the open ones, before Hired').toEqual([K.s2, K.s1, K.a2, K.a1, K.ad, K.g1, K.r0, K.i2, K.i1, K.rc, K.o1, K.o2, K.h3, K.h2, K.h1]);
    // A company with no SLA_THRESHOLDS at all has no clock (D-T-A1).
    const none = list(C.recruiter, {}, withThresholds(t, A, null));
    expect.soft(rowsIn(none).filter((x) => x.stage !== 'HIRED').map((x) => `${x.due_at} ${x.sla_status}`), 'no hours setting: every open candidate is null and ON_TRACK').toEqual(Array(12).fill('null ON_TRACK'));
    expect.soft(bodyOf(none)?.counts, 'and nothing is overdue or due soon').toEqual({ all: 15, mine: 1, overdue: 0, due_soon: 0, not_hired: 2 });

    // The clock is one shared function (rule 1).
    const file = join(REPO, 'lambda', 'shared', 'recruitment-actions', 'stage-clock.mjs');
    const mod = runModule([], { module: file });
    expect.soft(mod.exports ?? [], 'lambda/shared/recruitment-actions/stage-clock.mjs exports stageClock').toContain('stageClock');
    fits('AC-1', r, nh, b, n, none);
  });

  test('AC-1 Old-name hours give what the hourly SLA job uses: both run on one fixture, and every open candidate the job marks is overdue or due soon in the list, and no other', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    // Old names (several became one stage: the longest counts; INTERVIEW 20 is outranked by PANEL_INTERVIEW 100). Every row starts ON_TRACK so
    // the job writes its verdict for each one it judges. o2 has no stage time (the job skips it), so it is left out of the comparison.
    let t = withThresholds(world(), A, THRESHOLDS_OLD);
    for (const id of Object.keys(FIX)) t = withCandidate(t, id, { slaStatus: 'ON_TRACK' });
    const job = monitorVerdicts(runMonitor(t));
    const r = list(C.recruiter, {}, t);
    expect.soft(statusOf(r), `the list answers (${describe(r)})`).toBe(200);
    const open = rowsIn(r).filter((x) => x.sla_status !== null && x.id !== K.o2);
    expect.soft(open.length, 'eleven open candidates are compared').toBe(11);
    for (const x of open) {
      const said = job[x.id] === 'BREACHED' ? 'OVERDUE' : job[x.id] === 'AT_RISK' ? 'DUE_SOON' : 'ON_TRACK';
      expect.soft(x.sla_status, `${x.id}: the list agrees with the SLA job (${job[x.id] ?? 'no mark'})`).toBe(said);
    }
    // The hours themselves: Screening 30 (s1 at 47.52 hours is overdue), Interview 100 (not 20), Applied 24, Offer 72.
    expect.soft((ms(byId(r, K.s1)?.due_at) - ms(byId(r, K.s1)?.stage_entered_at)) / HOUR, 'Screening is 30 hours (PHONE_SCREENING)').toBe(30);
    expect.soft((ms(byId(r, K.i1)?.due_at) - ms(byId(r, K.i1)?.stage_entered_at)) / HOUR, 'Interview is 100 hours (the longest old name wins over INTERVIEW 20)').toBe(100);
    expect.soft((ms(byId(r, K.o1)?.due_at) - ms(byId(r, K.o1)?.stage_entered_at)) / HOUR, 'Offer is 72 hours (OFFER_DELIVERY)').toBe(72);
    expect.soft((ms(byId(r, K.a1)?.due_at) - ms(byId(r, K.a1)?.stage_entered_at)) / HOUR, 'Applied is 24 hours (APPLICATION_REVIEW)').toBe(24);
    expect.soft(job[K.s1], 'the job also marks s1 BREACHED (the comparison is not empty)').toBe('BREACHED');
    fits('AC-1 old names', r);
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 All roles: a Recruiter with no role_id gets every Applied to Hired candidate of A (no role, a missing role, a closed role included), none of B, none Not hired, no email, phone or ID number', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const t = world();
    const before = structuredClone(t);
    const r = list(C.recruiter, {}, t);
    expect.soft(statusOf(r), `200 (${describe(r)})`).toBe(200);
    expect.soft(sorted(idsIn(r)), 'every candidate of A but the Not hired and the stray row stamped with B').toEqual(sorted(VISIBLE_A));
    for (const x of rowsIn(r)) rowIsRight('all roles', x, SUB.recA);
    expect.soft(Object.keys(bodyOf(r) ?? {}).sort(), 'the answer is { candidates, counts } on the last page').toEqual(['candidates', 'counts']);
    noPersonalData('all roles', r);
    expect.soft(JSON.stringify(bodyOf(r)), 'nothing of B').not.toMatch(/Hlengiwe|Mandla|Dispatch lead|ten_b/);
    expect.soft([byId(r, K.r0)?.role_title, byId(r, K.g1)?.role_title, byId(r, K.h3)?.role_title], 'no role, a missing role: the row\'s own title').toEqual(['Junior baker', 'Pastry chef', 'Bakery assistant']);
    expect.soft(byId(r, K.h2)?.role_title, 'a closed role still gives its title').toBe('Old till role');
    noWrite('all roles', before, r);

    // The title follows the role: renamed after the candidates were added, the list shows the new title at once (rule 5).
    const renamed = list(C.recruiter, {}, withRole(t, A, R.fleet, { job_title: 'Fleet lead' }));
    expect.soft(rowsIn(renamed).filter((x) => x.role_id === R.fleet).map((x) => x.role_title), 'every Fleet row shows "Fleet lead"').toEqual(Array(FLEET.length).fill('Fleet lead'));
    // Role reads: under A only, one per distinct role id at most. A row of A that carries B's role id never reads B's role.
    const withB = withRows(t, [candidateRow('CAND-15REC15WBAAAAAAAAAAAAA1', { first: 'Wrong', last: 'Roleid', company: A, stage: 'APPLIED', role: R.b, hm: SUB.hmA, entered: 4, title: 'Baker on a B id' })]);
    const wb = list(C.recruiter, {}, withB);
    expect.soft(rowsIn(wb).find((x) => x.id === 'CAND-15REC15WBAAAAAAAAAAAAA1')?.role_title, 'an A row with B\'s role id shows its own title').toBe('Baker on a B id');
    for (const run of [r, wb]) {
      const reads = awsOf(run).filter((c: any) => c.table === ROLES_TABLE);
      expect.soft(reads.filter((c: any) => !JSON.stringify(c.input?.Key ?? c.input).includes(`TENANT#${A}`)).length, 'every role read is under company A').toBe(0);
      expect.soft(reads.length <= 5, `one role read per distinct role id at most (${reads.length})`).toBe(true);
      expect.soft(awsOf(run).filter((c: any) => c.op === 'Scan').length, 'no Scan (D-T-A14)').toBe(0);
      expect.soft(awsOf(run).some((c: any) => c.op === 'Query' && c.input?.IndexName === 'GSI1'), 'the all-roles list reads the company\'s GSI1 rows').toBe(true);
    }
    expect.soft(logsOf(r).join('\n'), 'the log names no candidate').not.toMatch(/Amahle|Dlamini|Tendai|zz-unique-mail|\+27 82/);
    fits('AC-2', r, renamed, wb);
  });

  test('AC-2 A failed read is a 500 with no list, never a list worked out without it; the log carries the error\'s name only', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const t = world();
    const fail = (ops: string[], nth: number) => ({ service: 'dynamodb' as const, ops, nth, name: 'ProvisionedThroughputExceededException', message: 'SECRET-DETAIL talent-flow-state' });
    // The first Query and the second (the candidate index, the settings, in any order), and the second GetItem (the first is the module row).
    for (const [label, f, q] of [
      ['first Query', fail(['Query'], 1), {}], ['second Query', fail(['Query'], 2), {}], ['first Query, one role', fail(['Query'], 1), { role_id: R.fleet }],
      ['second Query, one role', fail(['Query'], 2), { role_id: R.fleet }], ['a role read', fail(['GetItem'], 2), {}],
    ] as const) {
      const r = list(C.recruiter, q as Record<string, string>, t, { fail: f });
      expect.soft(statusOf(r), `${label} fails: 500 (${describe(r)})`).toBe(500);
      expect.soft(r.error, `${label}: the handler does not throw`).toBeUndefined();
      expect.soft(JSON.stringify(bodyOf(r) ?? null), `${label}: no list and no counts in the answer`).not.toMatch(/"candidates"|"counts"/);
      expect.soft(JSON.stringify(bodyOf(r) ?? null) + logsOf(r).join('\n'), `${label}: the error's message is neither answered nor logged`).not.toContain('SECRET-DETAIL');
      fits(label, r);
    }
  });

  // ---------------------------------------------------------------- AC-3

  test('AC-3 Counts: all, mine, overdue, due_soon and not_hired over the caller\'s rows; they follow role_id and never the stage, status, search or mine filters', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const t = world();
    const ALL = { all: 15, mine: 1, overdue: 3, due_soon: 3, not_hired: 2 };
    const runs: Run[] = [];
    for (const q of [{}, { stage: 'OFFER' }, { stage: 'NOT_HIRED' }, { stage: 'HIRED' }, { sla_status: 'OVERDUE' }, { search: 'moyo' }, { mine: 'true' }, { stage: 'SCREENING', sla_status: 'DUE_SOON', search: 'tendai', mine: 'true' }]) {
      const r = list(C.recruiter, q, t);
      runs.push(r);
      expect.soft(bodyOf(r)?.counts, `Recruiter, all roles, ${JSON.stringify(q)}: the same counts`).toEqual(ALL);
    }
    const fleet = list(C.recruiter, { role_id: R.fleet }, t);
    expect.soft(bodyOf(fleet)?.counts, 'Fleet controller').toEqual({ all: 9, mine: 1, overdue: 1, due_soon: 3, not_hired: 1 });
    expect.soft(bodyOf(list(C.recruiter, { role_id: R.fleet, stage: 'APPLIED', sla_status: 'ON_TRACK' }, t))?.counts, 'Fleet controller, filtered: the same').toEqual({ all: 9, mine: 1, overdue: 1, due_soon: 3, not_hired: 1 });
    const wh = list(C.recruiter, { role_id: R.warehouse }, t);
    expect.soft(bodyOf(wh)?.counts, 'Warehouse supervisor').toEqual({ all: 2, mine: 0, overdue: 2, due_soon: 0, not_hired: 1 });
    expect.soft(bodyOf(list(C.recruiter, { role_id: R.closed }, t))?.counts, 'the closed role: its Hired one').toEqual({ all: 1, mine: 0, overdue: 0, due_soon: 0, not_hired: 0 });
    // A hiring manager's counts are over their own rows only.
    const hm = list(C.hmC1, {}, t);
    expect.soft(bodyOf(hm)?.counts, 'hmA, all roles: their eleven').toEqual({ all: 11, mine: 11, overdue: 1, due_soon: 3, not_hired: 1 });
    expect.soft(bodyOf(list(C.hmC1, { stage: 'OFFER', search: 'x' }, t))?.counts, 'hmA, filtered: the same').toEqual({ all: 11, mine: 11, overdue: 1, due_soon: 3, not_hired: 1 });
    const hm2 = list(C.hmOther, {}, t);
    expect.soft(bodyOf(hm2)?.counts, 'hm2A, all roles').toEqual({ all: 4, mine: 4, overdue: 2, due_soon: 0, not_hired: 1 });
    expect.soft(bodyOf(list(C.hmOther, { role_id: R.fleet }, t))?.counts, 'hm2A on Fleet controller: the one they hire for (added by the Recruiter)').toEqual({ all: 1, mine: 1, overdue: 0, due_soon: 0, not_hired: 0 });
    const b = list(C.recruiterB, {}, t);
    expect.soft(bodyOf(b)?.counts, 'B\'s Recruiter: B\'s two, b1 overdue by B\'s hours, b1 added by them').toEqual({ all: 2, mine: 1, overdue: 1, due_soon: 0, not_hired: 0 });
    fits('AC-3', ...runs, fleet, wh, hm, hm2, b);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Filters and search: stage, sla_status, mine, search (name, email, role title; any case; spaces) and role_id narrow the list and combine; other names are ignored', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const t = world();
    const runs: Run[] = [];
    const shows = (q: Record<string, string>, want: string[], label: string, who = C.recruiter) => {
      const r = list(who, q, t);
      runs.push(r);
      expect.soft(sorted(idsIn(r)), `${label} ${JSON.stringify(q)}`).toEqual(sorted(want));
      return r;
    };
    shows({ stage: 'APPLIED' }, [K.a1, K.a2, K.r0, K.g1, K.ad], 'Applied');
    shows({ stage: 'SCREENING' }, [K.s1, K.s2, K.rc], 'Screening');
    shows({ stage: 'INTERVIEW' }, [K.i1, K.i2], 'Interview (an old name reads as Interview)');
    shows({ stage: 'OFFER' }, [K.o1, K.o2], 'Offer');
    shows({ stage: 'HIRED' }, [K.h1, K.h2, K.h3], 'Hired (an old name too)');
    shows({ stage: 'NOT_HIRED' }, [K.n1, K.n2], 'Not hired shows only Not hired (an old outcome too)');
    shows({ sla_status: 'OVERDUE' }, [K.s2, K.o1, K.o2], 'Overdue');
    shows({ sla_status: 'DUE_SOON' }, [K.a2, K.s1, K.i2], 'Due soon');
    shows({ sla_status: 'ON_TRACK' }, [K.a1, K.i1, K.r0, K.g1, K.ad, K.rc], 'On track (Hired has no status)');
    shows({ mine: 'true' }, [K.ad], 'mine: the one the Recruiter added (recruiterId is not read)');
    shows({ search: 'tendai' }, [K.s1], 'search: a first name, lower case');
    shows({ search: '  NCUBE ' }, [K.s1], 'search: a last name, upper case, with spaces');
    shows({ search: 'tendai ncube' }, [K.s1], 'search: the full name');
    shows({ search: 'UNIQUE-MAIL' }, [K.a1], 'search: the email (only a1\'s email holds it)');
    shows({ search: 'warehouse' }, [K.s2, K.o1], 'search: the role title (n2 is Not hired)');
    shows({ search: 'Fleet Controller' }, FLEET, 'search: the role\'s current title');
    shows({ search: 'old title' }, [], 'search: not the stored title of a row whose role exists (D-T-A6)');
    shows({ search: 'baker' }, [K.r0, K.h3], 'search: the own title of a row with no role');
    shows({ role_id: R.fleet }, FLEET, 'role_id');
    shows({ role_id: '' }, VISIBLE_A, 'role_id empty: all roles');
    shows({ role_id: R.fleet, stage: 'APPLIED' }, [K.a1, K.a2, K.ad], 'role and stage');
    shows({ role_id: R.fleet, stage: 'APPLIED', sla_status: 'DUE_SOON' }, [K.a2], 'role, stage and status');
    shows({ stage: 'APPLIED', search: 'moyo' }, [K.a2], 'stage and search (n2 Farai Moyo is Not hired)');
    shows({ stage: 'NOT_HIRED', search: 'farai' }, [K.n2], 'Not hired and search');
    shows({ mine: 'true', stage: 'SCREENING' }, [], 'mine and stage');
    shows({ role_id: R.fleet, search: 'mkhize', sla_status: 'OVERDUE' }, [K.o2], 'role, search and status');
    shows({ stage: 'OFFER' }, [K.o2], 'a hiring manager\'s filter stays within their rows', C.hmC1);
    // Names rule 3 does not list are ignored (D-T-A5): never a company, never another manager's rows.
    shows({ hiringManagerId: SUB.hm2A, positionLevel: 'SENIOR', slaStatus: 'BREACHED', tenantId: B, tenant_id: B }, VISIBLE_A, 'old and unknown names change nothing');
    shows({ hiringManagerId: SUB.hm2A }, OF_HMA, 'a manager naming another manager still gets their own', C.hmC1);

    // Another company's role, or a role nobody has: one empty answer, the same words.
    const empties = [list(C.recruiter, { role_id: R.b }, t), list(C.recruiter, { role_id: R.none }, t), list(C.recruiterB, { role_id: R.fleet }, t), list(C.recruiter, { role_id: 'role-made-up-0001' }, t)];
    for (const [i, r] of empties.entries()) expect.soft(answer(r), `empty answer ${i + 1}: 200 with no rows and zero counts`).toEqual([200, EMPTY]);
    runs.push(...empties);

    // A value outside rule 3: 400 naming the field, and nothing but the module row is read.
    const BAD: [string, Record<string, string>][] = [
      ['stage', { stage: 'applied' }], ['stage', { stage: 'REJECTED' }], ['stage', { stage: 'INTERVIEWING' }], ['stage', { stage: '' }],
      ['sla_status', { sla_status: 'AT_RISK' }], ['sla_status', { sla_status: 'BREACHED' }], ['sla_status', { sla_status: 'overdue' }],
      ['limit', { limit: '0' }], ['limit', { limit: '101' }], ['limit', { limit: 'abc' }], ['limit', { limit: '1.5' }], ['limit', { limit: '-1' }],
      ['search', { search: 'a'.repeat(101) }], ['search', { search: `  ${'b'.repeat(101)}  ` }],
    ];
    for (const [field, q] of BAD) {
      const r = list(C.recruiter, q, t);
      runs.push(r);
      expect.soft(answer(r), `${JSON.stringify(q).slice(0, 60)}: 400 INVALID_FIELD ${field}`).toEqual([400, invalid(field)]);
      readsNothing(JSON.stringify(q).slice(0, 60), r);
    }
    const okEdges = [list(C.recruiter, { limit: '1' }, t), list(C.recruiter, { limit: '100' }, t), list(C.recruiter, { search: 'z'.repeat(100) }, t)];
    expect.soft(okEdges.map((r) => statusOf(r)), 'limit 1, limit 100 and a search of 100 characters are fine').toEqual([200, 200, 200]);
    expect.soft(rowsIn(okEdges[0]!).length, 'limit 1 gives one row').toBe(1);
    // Lock check F-2 (standing line 9): a person may type an ID number, a phone number or an email into the search. None of it reaches the
    // log, whoever asks and whether or not it matches (the box text is the query; it is never logged).
    const typed = ['8001015000001', '800101 5000 001', '+27 82 555 1234', '0825551234', 'zz-unique-mail', emailOf(K.a1), phoneOf(K.a1), idNumberOf(K.a1)];
    for (const text of typed) {
      for (const who of [C.recruiter, C.hmC1]) {
        const r = list(who, { search: text }, t);
        runs.push(r);
        expect.soft(statusOf(r), `${who.name}, search "${text}": 200`).toBe(200);
        const log = logsOf(r).join('\n');
        for (const piece of new Set([text, text.trim(), text.toLowerCase(), text.replace(/\s+/g, '')])) {
          expect.soft(log.includes(piece), `${who.name}, search "${text}": the log holds none of the typed text`).toBe(false);
        }
      }
    }
    fits('AC-4', ...runs, ...okEdges);
  });

  // ---------------------------------------------------------------- AC-5

  test('AC-5 Order: most overdue first, then by due date, then Hired and Not hired newest first; ties by id', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const r = list(C.recruiter, {}, t);
    expect.soft(idsIn(r), 'the order of rule 9 at NOW').toEqual(ORDER_A);
    expect.soft(idsIn(list(C.recruiter, { stage: 'NOT_HIRED' }, t)), 'Not hired newest first').toEqual([K.n1, K.n2]);
    expect.soft(idsIn(list(C.hmOther, {}, t)), 'a hiring manager\'s rows, in the same order').toEqual([K.o1, K.s2, K.ad, K.h2]);
    // Ties: three Applied rows entered at the same moment are due at the same moment, so they come by id.
    const tie = ['CAND-15REC15TIE3AAAAAAAAAAAA', 'CAND-15REC15TIE1AAAAAAAAAAAA', 'CAND-15REC15TIE2AAAAAAAAAAAA'];
    const tt = withRows(t, tie.map((id) => candidateRow(id, { first: 'Tie', last: id.slice(-16, -12), company: A, stage: 'APPLIED', role: R.warehouse, hm: SUB.hm2A, entered: 12 })));
    const ids = idsIn(list(C.recruiter, { role_id: R.warehouse, stage: 'APPLIED' }, tt));
    expect.soft(ids, 'equal due dates: by id').toEqual(sorted(tie));
    fits('AC-5 order', r);
  });

  test('AC-5 Pages: limit and nextToken walk 250 rows once, with no repeat and no gap, in order; the last page has no token; a role of 101 shows all 101', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    const t = withRows(world(), many(250, { prefix: 'W', role: R.warehouse, hm: SUB.hm2A }));
    const want = sorted([...VISIBLE_A, ...many(250, { prefix: 'W' }).map((x) => plain(x)['candidateId'])]);
    const big = walk(C.recruiter, {}, t);
    expect.soft(big.sizes, 'pages of the default limit (100): 100, 100, 65').toEqual([100, 100, 65]);
    expect.soft(sorted(big.rows.map((x) => x.id)), 'every row once, none missing').toEqual(want);
    expect.soft(new Set(big.rows.map((x) => x.id)).size, 'no row twice').toBe(big.rows.length);
    expect.soft(orderProblems(big.rows), 'in the order of rule 9 across pages').toEqual([]);
    expect.soft('nextToken' in (bodyOf(big.last) ?? {}), 'the last page has no nextToken').toBe(false);
    const small = walk(C.recruiter, {}, t, 7);
    expect.soft(small.rows.map((x) => x.id), 'a limit of 7 walks the same rows in the same order').toEqual(big.rows.map((x) => x.id));
    expect.soft(small.sizes.slice(0, -1).every((n) => n === 7), 'every page but the last is full').toBe(true);
    // Counts are the whole set's on every page.
    expect.soft(small.runs.every((r) => bodyOf(r)?.counts?.all === want.length), 'every page carries the whole set\'s counts').toBe(true);
    // Filters page too.
    const off = walk(C.recruiter, { role_id: R.warehouse, stage: 'OFFER' }, t, 9);
    expect.soft(off.rows.every((x) => x.stage === 'OFFER' && x.role_id === R.warehouse) && off.rows.length === 51, `a filtered walk (Warehouse, Offer: 51 rows; got ${off.rows.length})`).toBe(true);
    expect.soft(new Set(off.rows.map((x) => x.id)).size, 'no repeat').toBe(off.rows.length);
    // A token says nothing about the company or the table (D-T-A8, D-REC-15.7).
    for (const token of [...big.tokens, ...small.tokens.slice(0, 3)]) {
      for (const text of decodings(token)) {
        expect.soft(text, 'a token holds no company id').not.toContain(A);
        expect.soft(text, 'a token holds no table key').not.toMatch(/TENANT#|CANDIDATE#|SAGA|GSI1|"PK"|"SK"|tenant/i);
      }
    }
    // REC-04's cut-off at 100 is gone: a role of 101 open candidates shows all 101 over two pages.
    const r101 = withRows(world(), many(101, { prefix: 'H', role: R.accountant }));
    const acc = walk(C.recruiter, { role_id: R.accountant }, r101);
    expect.soft([acc.sizes, new Set(acc.rows.map((x) => x.id)).size], 'Senior accountant: 100 then 1, all 101').toEqual([[100, 1], 101]);
    fits('AC-5 pages', ...big.runs, ...small.runs.slice(0, 3), ...acc.runs);
  });

  test('AC-5 Pages hold their place: a row that leaves or arrives between two pages causes no repeat and no gap; a bad token is 400; A\'s token used by B gives B\'s rows', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const t = world();
    const p1 = list(C.recruiter, { limit: '5' }, t);
    expect.soft(idsIn(p1), 'page one').toEqual(ORDER_A.slice(0, 5));
    const token = bodyOf(p1)?.nextToken as string;
    expect.soft(typeof token, 'page one has a nextToken').toBe('string');
    // o1 (on page one) leaves the list (Not hired). An offset would skip a1, the first row of page two; a position does not.
    const gone = withCandidate(t, K.o1, { currentStage: 'NOT_HIRED', stageEnteredAt: ago(0.5) });
    expect.soft(idsIn(list(C.recruiter, { limit: '5', nextToken: token }, gone)), 'a row leaves before the place: page two still starts at a1').toEqual(ORDER_A.slice(5, 10));
    // A new, very overdue row arrives before the place. An offset would show a2 (page one's last) again; a position does not.
    const came = withRows(t, [candidateRow('CAND-15REC15NEWAAAAAAAAAAAA1', { first: 'New', last: 'Arrival', company: A, stage: 'OFFER', role: R.fleet, hm: SUB.hmA, entered: 900 })]);
    expect.soft(idsIn(list(C.recruiter, { limit: '5', nextToken: token }, came)), 'a row arrives before the place: no repeat').toEqual(ORDER_A.slice(5, 10));
    // A row of page two moves stage (s1 is offered and its clock restarts): every other row of page two is still there, none of page one.
    const moved = withCandidate(t, K.a1, { currentStage: 'OFFER', stageEnteredAt: ago(1) });
    const p2 = idsIn(list(C.recruiter, { limit: '5', nextToken: token }, moved));
    expect.soft(p2.filter((id) => ORDER_A.slice(0, 5).includes(id)), 'after a move, nothing of page one comes back').toEqual([]);

    // A token the server cannot read, or one of the old route's DynamoDB keys: 400 naming nextToken.
    const oldKey = Buffer.from(JSON.stringify({ PK: { S: `CANDIDATE#${K.a1}` }, SK: { S: 'SAGA' }, GSI1PK: { S: `TENANT#${A}` }, GSI1SK: { S: 'SAGA#2026-11-23T01:00:00.000Z' } })).toString('base64');
    for (const [label, bad] of [
      ['not a token', 'garbage!!'], ['base64 of text', Buffer.from('hello there').toString('base64')], ['base64 of a list', Buffer.from('[1,2]').toString('base64')],
      ['base64 of an empty object', Buffer.from('{}').toString('base64')], ['the old route\'s key', oldKey], ['half a real token', token?.slice(0, Math.floor((token?.length ?? 2) / 2))],
    ] as const) {
      const r = list(C.recruiter, { nextToken: bad }, t);
      expect.soft(answer(r), `${label}: 400 INVALID_FIELD nextToken`).toEqual([400, invalid('nextToken')]);
      readsNothingButCandidates(label, r);
      fits(label, r);
    }
    // A's token as B: only B's rows, never A's.
    const asB = list(C.recruiterB, { limit: '5', nextToken: token }, t);
    expect.soft(statusOf(asB), `A's token used by B: 200 (${describe(asB)})`).toBe(200);
    expect.soft(idsIn(asB).every((id) => FIX[id]?.company === B), `only B's rows (${idsIn(asB).join(', ')})`).toBe(true);
    fits('AC-5 place', p1, asB);
  });

  test('AC-5 Size: the all-roles list reads every page of the company\'s rows; 5,000 rows answer, above 5,000 is 500 LIST_TOO_LARGE with one count line in the log', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    // Every page: the index answering four at a time.
    const paged = list(C.recruiter, {}, world(), { queryPageSize: 4 });
    expect.soft(sorted(idsIn(paged)), 'all of A\'s rows when the index answers four at a time').toEqual(sorted(VISIBLE_A));
    expect.soft(bodyOf(paged)?.counts, 'and every count').toEqual({ all: 15, mine: 1, overdue: 3, due_soon: 3, not_hired: 2 });
    // 5,000 rows of the company in all (this card's 17 of A plus 4,983 more) answer; one more is refused.
    // The stray row x1 (A's partition, B's stamp) is taken out so the count is the same whether a build counts it before or after the company filter.
    const base = world();
    base[TABLE.state] = (base[TABLE.state] ?? []).filter((x) => plain(x)['candidateId'] !== K.x1);
    const ok = list(C.recruiter, { limit: '1' }, withRows(base, many(4983, { prefix: 'S' })), { queryPageSize: 1000 });
    expect.soft(statusOf(ok), `5,000 rows: 200 (${describe(ok).slice(0, 160)})`).toBe(200);
    const tooMany = list(C.recruiter, { limit: '1' }, withRows(base, many(4984, { prefix: 'S' })), { queryPageSize: 1000 });
    expect.soft(statusOf(tooMany), `5,001 rows: 500 (${describe(tooMany).slice(0, 160)})`).toBe(500);
    expect.soft(bodyOf(tooMany)?.code, 'code LIST_TOO_LARGE').toBe('LIST_TOO_LARGE');
    expect.soft(JSON.stringify(bodyOf(tooMany) ?? null), 'no rows in the refusal').not.toMatch(/"candidates"/);
    const lines = logsOf(tooMany).filter((l) => /\b500[01]\b/.test(l));
    expect.soft(lines.length >= 1, `a log line with the count (${logsOf(tooMany).join(' | ').slice(0, 300)})`).toBe(true);
    expect.soft(logsOf(tooMany).join('\n'), 'no names in the log').not.toMatch(/Many|Person|Amahle|example\.test/);
    fits('AC-5 size', paged, ok, tooMany);
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 Who sees what: a Recruiter all, a hiring manager only their own rows and counts, others 403 before any AWS call, Recruitment off refused, B only B; mine is the hiring manager or who added', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const t = world();
    const before = structuredClone(t);
    const runs: Run[] = [];
    for (const who of RECRUITERS) {
      const r = list(who, {}, t);
      runs.push(r);
      expect.soft(sorted(idsIn(r)), `${who.name}: every row of A`).toEqual(sorted(VISIBLE_A));
    }
    const hmA = list(C.hmC1, {}, t);
    expect.soft(sorted(idsIn(hmA)), 'hmA: only the rows they hire for').toEqual(sorted(OF_HMA));
    for (const x of rowsIn(hmA)) rowIsRight('hmA', x, SUB.hmA);
    const hm2 = list(C.hmOther, {}, t);
    expect.soft(sorted(idsIn(hm2)), 'hm2A: only theirs (ad was added by the Recruiter, hm2A hires for it)').toEqual(sorted(OF_HM2A));
    for (const x of rowsIn(hm2)) rowIsRight('hm2A', x, SUB.hm2A);
    expect.soft(sorted(idsIn(list(C.hmC1, { role_id: R.warehouse }, t))), 'hmA on a role they do not hire for: nothing').toEqual([]);
    const nobody = list({ name: 'A manager who hires for nobody', groups: ['manager'], sub: 'sub-hm-none-a' }, {}, t);
    expect.soft(answer(nobody), 'a manager who hires for nobody: 200, empty, zero counts (D-T-A9)').toEqual([200, EMPTY]);
    // mine (rule 8, D-T-A10).
    const rec = list(C.recruiter, {}, t);
    expect.soft(rowsIn(rec).filter((x) => x.mine).map((x) => x.id), 'the Recruiter: mine only on the one they added (not on rc, which names them as recruiterId)').toEqual([K.ad]);
    expect.soft(bodyOf(rec)?.counts?.mine, 'their mine count is 1').toBe(1);
    expect.soft(rowsIn(hm2).filter((x) => x.mine).length, 'hm2A: all four are mine (hiring manager)').toBe(4);
    // Everyone else: 403 before any AWS call.
    // Whatever the query: a role id, a filter, a search, mine or a token changes nothing (the role check comes first).
    const QUERIES: Record<string, string>[] = [{}, { role_id: R.fleet }, { role_id: R.fleet, stage: 'APPLIED' }, { search: 'Amahle' }, { mine: 'true' }, { sla_status: 'OVERDUE', limit: '5' }];
    for (const who of [C.employee, C.guest, C.adminOnly, C.hrNoTick, C.tickNoHr, C.panelA, C.noGroups, C.taClaim, C.nearHrStaffx, C.approver]) {
      for (const q of QUERIES) {
        const r = list(who, q, t);
        expect.soft([...answer(r), awsOf(r).length], `${who.name} (${JSON.stringify(q)}): 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
        runs.push(r);
      }
    }
    const d = list(C.recruiterD, {}, t);
    expect.soft(answer(d), 'a Recruiter of a company with Recruitment off: 403').toEqual([403, FORBIDDEN]);
    readsNothing('Recruitment off', d);
    const nc = list(C.recruiterNoCompany, {}, t);
    expect.soft([...answer(nc), awsOf(nc).length], 'a Recruiter with no company: 403 before any AWS call').toEqual([403, FORBIDDEN, 0]);
    // Company B, whatever the request says about A.
    for (const [what, o] of [['plain', {}], ['query', { q: { tenantId: A, tenant_id: A } }], ['header', { headers: { 'x-tenant-id': A, 'x-tenant': A } }], ['path', { path: { tenantId: A, tenant_id: A } }]] as const) {
      const r = list(C.recruiterB, (o as any).q ?? {}, t, { headers: (o as any).headers, path: (o as any).path });
      runs.push(r);
      expect.soft(sorted(idsIn(r)), `B's Recruiter (${what} naming A): B's two only`).toEqual(sorted([K.b1, K.bA]));
      const rA = list(C.recruiter, (o as any).q ? { tenantId: B, tenant_id: B } : {}, t, { headers: (o as any).headers ? { 'x-tenant-id': B } : undefined, path: (o as any).path ? { tenantId: B } : undefined });
      expect.soft(sorted(idsIn(rA)), `A's Recruiter (${what} naming B): A's only`).toEqual(sorted(VISIBLE_A));
    }
    expect.soft(sorted(idsIn(list(C.managerB, {}, t))), 'B\'s manager: the two they hire for').toEqual(sorted([K.b1, K.bA]));
    // A role row stamped with company B that sits under A's key (a stray, as TEN-02 found) is another company's role: never read (rule 5,
    // rule 2). Its id on an A candidate gives the empty answer, the same as a made-up id, and the row keeps its own title.
    const STRAY = 'role-15REC15STRAYBBBBBBBBBB1';
    const SC = 'CAND-15REC15STRAYROLEAAAAA1';
    const ts = withRows(t, [candidateRow(SC, { first: 'Stray', last: 'Roleholder', company: A, stage: 'APPLIED', role: STRAY, hm: SUB.hmA, entered: 2, title: 'Own title' })]);
    ts[ROLES_TABLE] = [...(ts[ROLES_TABLE] ?? []), roleRow(A, STRAY, SUB.hmA, { tenant_id: B, tenantId: B, job_title: 'Stray B title' })];
    const strayList = list(C.recruiter, { role_id: STRAY }, ts);
    expect.soft(answer(strayList), 'a role row of B under A\'s key: the empty answer').toEqual(answer(list(C.recruiter, { role_id: 'role-15REC15MADEUPAAAAAAAAA1' }, ts)));
    expect.soft(answer(strayList), 'and that answer is empty with zero counts').toEqual([200, EMPTY]);
    const strayAll = list(C.recruiter, {}, ts);
    expect.soft(rowsIn(strayAll).find((x) => x.id === SC)?.role_title, 'the A candidate on it keeps its own title, never B\'s').toBe('Own title');
    expect.soft(JSON.stringify(bodyOf(strayAll)), 'B\'s role title is never sent').not.toContain('Stray B title');
    runs.push(strayList, strayAll);
    expect.soft(JSON.stringify(bodyOf(list(C.hmC1, {}, t))), 'a manager of A never sees B\'s row on A\'s role id, nor the stray row').not.toMatch(new RegExp(`${K.bA}|${K.x1}`));
    // Lock check F-1 (rule 8, standing line 7): a manager who is not a Recruiter sees only the rows they hire for, whatever else they hold.
    // Same person as hmA, with the old TA claim, or also HR without the Recruitment tick: the very same answer as hmA, under any query.
    const alsoTa = { name: 'Manager with the old TA claim', groups: ['manager'], sub: SUB.hmA, claims: { 'custom:roles': '["TA"]' } };
    const alsoHr = { name: 'Manager who is also HR without the Recruitment tick', groups: ['manager', 'hr_staff'], sub: SUB.hmA };
    for (const q of [{}, { mine: 'true' }, { role_id: R.warehouse }, { role_id: R.fleet }, { stage: 'NOT_HIRED' }, { search: 'a' }] as Record<string, string>[]) {
      const own = answer(list(C.hmC1, q, t));
      for (const who of [alsoTa, alsoHr]) {
        const r = list(who as any, q, t);
        runs.push(r);
        expect.soft(answer(r), `${who.name} (${JSON.stringify(q)}): exactly hmA's answer`).toEqual(own);
      }
    }
    expect.soft(sorted(idsIn(list(alsoTa as any, {}, t))), 'the TA-claim manager: only hmA\'s rows').toEqual(sorted(OF_HMA));
    expect.soft(sorted(idsIn(list(alsoHr as any, {}, t))), 'the HR-without-tick manager: only hmA\'s rows').toEqual(sorted(OF_HMA));
    // A candidate added by hmA on a role hm2A hires for: hmA never sees it (adding is not hiring); hm2A does, as theirs.
    const ADDED = 'CAND-15REC15ADDEDBYHMAAAAA1';
    const tAdd = withRows(t, [candidateRow(ADDED, { first: 'Added', last: 'Byamanager', company: A, stage: 'APPLIED', role: R.warehouse, hm: SUB.hm2A, entered: 2, extra: { added_by: SUB.hmA } })]);
    const hmAadd = list(C.hmC1, {}, tAdd);
    expect.soft(answer(hmAadd), 'hmA after adding a candidate they do not hire for: the same answer as before').toEqual(answer(hmA));
    expect.soft(JSON.stringify(bodyOf(list(C.hmC1, { role_id: R.warehouse }, tAdd))), 'and not under that role either').not.toContain(ADDED);
    expect.soft(JSON.stringify(bodyOf(list(C.hmC1, { mine: 'true' }, tAdd))), 'and not under mine').not.toContain(ADDED);
    const hm2add = list(C.hmOther, {}, tAdd);
    expect.soft(rowsIn(hm2add).find((x) => x.id === ADDED)?.mine, 'hm2A sees it, as theirs').toBe(true);
    expect.soft(bodyOf(hm2add)?.counts?.all, 'hm2A\'s count gains it').toBe((bodyOf(hm2)?.counts?.all ?? 0) + 1);
    // A Recruiter whose Recruitment tick was taken away (now only a manager): the candidates they added are no longer theirs to see.
    const former = { name: 'Former Recruiter, now only a manager', groups: ['manager'], sub: SUB.recA };
    for (const q of [{}, { mine: 'true' }, { role_id: R.fleet }, { search: fullName(K.ad) }] as Record<string, string>[]) {
      const r = list(former as any, q, tAdd);
      runs.push(r);
      expect.soft(answer(r), `${former.name} (${JSON.stringify(q)}): 200 and nothing (they hire for no role; ad, which they added, is hm2A's)`).toEqual([200, EMPTY]);
    }
    runs.push(hmAadd, hm2add);
    noWrite('reads', before, rec);
    fits('AC-6', ...runs, hmA, hm2, nobody, rec, d, nc);
  });

  // ---------------------------------------------------------------- rule 11

  test('AC-3 Role counts use the same clock: GET /v1/roles and GET /v1/roles/{id} give the list\'s overdue and due soon numbers, not the stored status', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const t = world();
    const all = roles(C.recruiter, t);
    expect.soft(statusOf(all), `the roles list (${describe(all)})`).toBe(200);
    const of = (id: string) => ((bodyOf(all)?.roles ?? []) as any[]).find((x) => x.role_id === id) ?? {};
    const n = (x: any) => [x.candidate_count, x.overdue_count, x.due_soon_count];
    expect.soft(n(of(R.fleet)), 'Fleet controller: 8 open, 1 overdue (o2), 3 due soon (a2, s1, i2); i1\'s stored BREACHED is not read').toEqual([8, 1, 3]);
    expect.soft(n(of(R.warehouse)), 'Warehouse supervisor: 2 open, both overdue').toEqual([2, 2, 0]);
    expect.soft(n(of(R.closed)), 'the closed role: none open').toEqual([0, 0, 0]);
    for (const id of [R.fleet, R.warehouse]) {
      const c = bodyOf(list(C.recruiter, { role_id: id }, t))?.counts ?? {};
      expect.soft([of(id).overdue_count, of(id).due_soon_count], `${id}: the role's numbers equal the list's`).toEqual([c.overdue, c.due_soon]);
    }
    expect.soft(n(bodyOf(role(C.recruiter, R.fleet, t)) ?? {}), 'GET /v1/roles/{id}: the same numbers').toEqual([8, 1, 3]);
    const b = roles(C.recruiterB, t);
    expect.soft(n(((bodyOf(b)?.roles ?? []) as any[])[0] ?? {}), 'B\'s role, by B\'s hours: b1 is overdue').toEqual([1, 1, 0]);
    // The same rows read a day later: a1, a2, s1, o2 and ad overdue; i1 (98 percent) and i2 (99 percent) due soon; rc (62.5 percent) on track.
    const later = roles(C.recruiter, t, { now: after(24) });
    expect.soft(n(((bodyOf(later)?.roles ?? []) as any[]).find((x) => x.role_id === R.fleet) ?? {}), 'a day later the clock has moved').toEqual([8, 5, 2]);
  });

  // ---------------------------------------------------------------- AC-16 (the list half)

  test('AC-16 The list is written once in api/openapi.yaml: CandidateList and CandidateRow closed, the query names, the 400; the validator fails a planted answer', async ({}, testInfo) => {
    once(testInfo.project.name);
    const d = doc();
    const op = operation(d, ROUTE);
    expect(op, 'GET /v1/candidates is in the file').toBeTruthy();
    const ok = answerSchema(d, ROUTE, 200);
    expect.soft(refName(ok), 'its 200 is CandidateList').toBe('CandidateList');
    const list_ = d.components?.schemas?.['CandidateList'];
    const row = d.components?.schemas?.['CandidateRow'];
    expect.soft(!!list_ && !!row, 'CandidateList and CandidateRow are components').toBe(true);
    expect.soft(looseObjects(d, { $ref: '#/components/schemas/CandidateList' }, 'CandidateList', new Set(), ['nextToken', 'source']), 'every object closed and every field required (but nextToken and source)').toEqual([]);
    expect.soft(Object.keys(row?.properties ?? {}).sort(), 'CandidateRow has exactly the rule 4 fields').toEqual(sorted([...ROW_KEYS, 'source']));
    expect.soft(Object.keys(list_?.properties ?? {}).sort(), 'CandidateList has candidates, counts and nextToken').toEqual(['candidates', 'counts', 'nextToken']);
    for (const s of [400, 403, 500]) expect.soft(!!answerSchema(d, ROUTE, s), `the ${s} answer is described`).toBe(true);
    const params = ((op?.parameters ?? []) as any[]).filter((p) => p.in === 'query');
    const named = (n: string) => params.find((p) => p.name === n)?.schema ?? {};
    expect.soft(params.map((p) => p.name).sort(), 'the query names of rule 3, and no other').toEqual(['limit', 'mine', 'nextToken', 'role_id', 'search', 'sla_status', 'stage']);
    expect.soft([...(named('stage').enum ?? [])].sort(), 'stage: the six codes').toEqual(['APPLIED', 'HIRED', 'INTERVIEW', 'NOT_HIRED', 'OFFER', 'SCREENING']);
    expect.soft([...(named('sla_status').enum ?? [])].sort(), 'sla_status: three words').toEqual(['DUE_SOON', 'ON_TRACK', 'OVERDUE']);
    expect.soft([named('limit').minimum, named('limit').maximum], 'limit 1 to 100').toEqual([1, 100]);
    expect.soft(named('search').maxLength, 'search at most 100').toBe(100);
    expect.soft(params.every((p) => !p.required), 'no query name is required').toBe(true);
    // The checker itself must fail wrong answers.
    const good = { candidates: [{ id: 'c', name: 'A B', stage: 'APPLIED', stage_entered_at: NOW, due_at: NOW, sla_status: 'ON_TRACK', role_id: null, role_title: 'T', level: 'MID', applied_at: NOW, hiring_manager_id: 'h', mine: false }], counts: ZERO };
    const ck = checker(d);
    expect.soft(ck.check(ok, good), 'a right answer passes').toEqual([]);
    expect.soft(ck.check(ok, { ...good, candidates: [{ ...good.candidates[0], email: 'x@y.z' }] }).length > 0, 'a row with an email fails').toBe(true);
    const { due_at: _d, ...noDue } = good.candidates[0]!;
    expect.soft(ck.check(ok, { ...good, candidates: [noDue] }).length > 0, 'a row without due_at fails').toBe(true);
    expect.soft(ck.check(ok, { ...good, counts: { ...ZERO, total: 1 } }).length > 0, 'counts with an extra key fail').toBe(true);
    expect.soft(ck.check(ok, { ...good, total: 1 }).length > 0, 'the old answer\'s total fails').toBe(true);
    expect.soft(ck.check(answerSchema(d, ROUTE, 400), { ...invalid('stage'), extra: 1 }).length > 0, 'a 400 with an extra key fails').toBe(true);
  });

  // ---------------------------------------------------------------- AC-17 (step A's lines)

  test('AC-17 Terraform for the list: getCandidates may read the company\'s settings (one Query grant, CONFIG_TABLE_NAME), nothing else changes, no wildcard, no table item', async ({}, testInfo) => {
    once(testInfo.project.name);
    const fn = lambdaNamed('getCandidates')[0];
    expect(fn, 'getCandidates is a Lambda in Terraform').toBeTruthy();
    const env = settingsOf(fn!.block);
    expect.soft(valueOf(fn!.stack, env.get('CONFIG_TABLE_NAME')), 'getCandidates reads the settings table\'s name from CONFIG_TABLE_NAME').toBe('talent-flow-config');
    const role_ = roleResourceOf(fn!.block)!;
    const baseline = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-15', 'iam-1043aa9', 'policies.json'), 'utf8')) as Record<string, { role: string; stack: string; pairs?: string[]; squash?: string }>;
    const now = policyLines();
    const byRole = (all: Record<string, { role: string; stack: string; pairs?: string[]; squash?: string }>) => {
      const out = new Map<string, Set<string>>();
      for (const p of Object.values(all)) {
        const k = `${p.stack}/${p.role}`;
        if (!out.has(k)) out.set(k, new Set());
        for (const l of p.pairs ?? [`squashed ${p.squash}`]) out.get(k)!.add(l);
      }
      return out;
    };
    const [was, is] = [byRole(baseline), byRole(now)];
    const configRead = /^Allow dynamodb:Query \S*(talent-flow-config|\$\{local\.tf_table_config\})\/index\/GSI1-active-configs null$/;
    for (const [k, lines] of is) {
      const gained = [...lines].filter((l) => !(was.get(k) ?? new Set()).has(l));
      const lost = [...(was.get(k) ?? new Set())].filter((l) => !lines.has(l));
      if (k === `${fn!.stack}/${role_}`) {
        expect.soft(gained.filter((l) => !configRead.test(l)), 'getCandidates gains only the Query on the settings index (D-T-A15)').toEqual([]);
        expect.soft(gained.filter((l) => configRead.test(l)).length, 'that line, once').toBe(1);
        expect.soft(lost, 'getCandidates loses nothing').toEqual([]);
      } else {
        // REC-07 (child lock rec-07.1): scheduleInterview reads the role's criteria, submitVote finds an interview by id (support/rec-07.1/grants.ts).
        expect.soft(gained.filter((l) => !isRec07Grant(l, k)), `${k}: no new grant`).toEqual([]);
      }
    }
    const mine = [...(is.get(`${fn!.stack}/${role_}`) ?? [])];
    for (const l of mine) if (!/ xray:/.test(l)) expect.soft(l.split(' ')[2], `${l}: no wildcard`).not.toMatch(/^\*$|table\/\*|index\/\*/);
    expect.soft(mine.some((l) => /^Allow (local\.tf_kms_actions|kms:Decrypt) aws_kms_key\.talent_flow_state\.arn null$/.test(l)), 'it keeps the state key, which also encrypts the settings table').toBe(true);
    const cfg = resourcesOf('talent-flow-infra', 'aws_dynamodb_table').find((b) => b.labels[1] === 'talent_flow_config');
    expect.soft(/kms_key_arn\s*=\s*aws_kms_key\.talent_flow_state\.arn/.test(cfg?.body ?? ''), 'the settings table is encrypted with the state key').toBe(true);
    for (const stack of ['infra', 'talent-flow-infra'] as const) expect.soft(resourcesOf(stack, 'aws_dynamodb_table_item').length, `${stack}: no table item`).toBe(0);
    expect.soft(blocks([join(REPO, 'talent-flow-infra', 'talent-flow-apigateway.tf')], 'resource').some((b) => b.labels[1] === 'get_candidates' && /GET \/v1\/candidates"/.test(b.body)), 'the route stays on getCandidates').toBe(true);
    expect.soft(existsSync(join(REPO, 'lambda', 'getCandidates')), 'the Lambda folder stays').toBe(true);
  });
});

/** Only the module row may be read before a bad token is refused, or the candidate rows themselves (a token is checked against the order). */
function readsNothingButCandidates(label: string, r: Run) {
  const other = awsOf(r).filter((c: any) => !isModulesRead(c) && !(c.op === 'Query' && /talent-flow-state|talent-flow-config/.test(String(c.table ?? ''))));
  expect.soft(other.map((c: any) => `${c.service} ${c.op} ${c.table ?? ''}`), `${label}: no role read and no write`).toEqual([]);
  expect.soft(anyWrite(r).length, `${label}: nothing written`).toBe(0);
}

void [av, TABLE, ROLES_TABLE];
