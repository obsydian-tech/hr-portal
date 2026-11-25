import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO } from './support/rec-14/lambda-harness';
import { answerSchema, checker, looseObjects, operation, readDoc, refName, type Doc } from './support/rec-14/schema';
import { kmsList, lambdaNamed, policyLines, resourcesOf, roleResourceOf, settingsOf, valueOf } from './support/rec-04/iam';
import { C } from './support/rec-04/callers';
import { bodyOf, describe, statusOf, type Caller } from './support/rec-04/world';
import { awsOf, changedRows, logsOf } from './support/rec-04/roles';
import { K as K15, list, withRole } from './support/rec-15/world';
import { isRec07Grant } from './support/rec-07.1/grants';
import { isRec05Grant } from './support/rec-05.1/grants';
import { isRec15dGrant } from './support/rec-15d.1/grants'; // child lock rec-15d.1
import {
  A, B, CAND, DEP, EMPLOYEE_ID, LOCK_V1, NEVER, NEVER_FIELDS, OLD_KEPT_VALUES, Q, R, ROLES_TABLE, SUB, TABLE, TENANTS, ago, activeData, moveRun, nameOf,
  notHiredRun, recordRun, reopenRun, rowsOf, sagaOf, STRAY, interviewIdOf, withPanel, withStrayRoles, withCandidate, withDecider, withDepartmentName, withNewVersion, withScreening, withSetting, world,
  type Run, type Tables,
} from './support/rec-15c/world';

/**
 * REC-15 step C · The candidate record (red). Jira NH-278. Spec: /mnt/project-files/onboarding-cards/specs/REC-15.md, Part 2 (rules 12 to
 * 18), AC-10 to AC-13, the record half of AC-16 and step C's lines of AC-17, with the four fixes of the spec check
 * (onboarding-cards/specs/REC-15C-spec-check.md, C-1 to C-4). Notes: cards/rec-15c.md. Review page:
 * onboarding-cards/specs/REC-15C-tests-for-review.md (the bar).
 *
 * Child lock rec-15c.2 (REC-15 rule 12, step 0 item 1; onboarding-cards/specs/REC-15C-record-fields.md): the locked dev checks rec-02 AC-12
 * and rec-03 AC-11 read strong_no_count, reason_code, decided_by, stage_before_not_hired and legacy_stage from the record as the HR login.
 * The Recruiter and the hiring manager get each of them when the row has it, with its stored value; a panel member gets none of them
 * (D-REC-15C.2-1). Every other field off rule 12's list stays out for everyone.
 *
 * The tests run the real handlers (lambda/getCandidate for the record; advanceCandidateStage and recordNotHired where the record's answers
 * are compared with the real routes) in a fresh Node process for each call, against REC-14's fake AWS over REC-15 step A's world plus this
 * card's candidates (support/rec-15c/world.ts), at a fixed time NOW. Every answer is checked against api/openapi.yaml. Terraform is read as
 * text. Nothing calls AWS or any AI. Nothing here has a screen width: each test runs once, at 1280.
 *
 * Pinned by the verifier where the spec is silent (each is in cards/rec-15c.md for the BA to confirm):
 *  - D-T-C1 The fields of rule 18 are present exactly as the table says, always (a value may be null): R and HM get stage, role_id,
 *    role_title, level, applied_at, can_move, can_decide, due_at, sla_status, stage_entered_at, next_step, interviews_done,
 *    interviews_required, legacy_hired; P gets stage, role_id, role_title, level, applied_at, can_move, can_decide. department_id is present
 *    when the row has one; department when the row has a department_id or a stored department text; source when the row has one;
 *    employee_id and added_by (R only) when the row has them. The old fields of rule 12 (and step 0's list) are present when the row
 *    stores them, for all three, with the stored value; id and candidateId always; currentInterviewId as today. settingVersions to R only
 *    when stored (spec check C-1). No other key, ever.
 *  - D-T-C2 The values the list also gives (stage, stage_entered_at, due_at, sla_status, role_id, role_title, level, applied_at, source)
 *    equal the list row GET /v1/candidates gives the same caller for the same candidate: one clock, one title rule (rules 1, 4, 5).
 *  - D-T-C3 department: a department_id found in the company's own list gives that department's current name; one not found there (another
 *    company's id, a deleted id) gives the stored text. Another company's name never shows.
 *  - D-T-C4 interviews_done and interviews_required: numbers from Interview on, in the six-stage order (Interview, Offer, Hired, Not hired);
 *    null on Applied and Screening. They and the blocker count the candidate's own pinned settings (its lock where it has one, else the
 *    active version), as moveCandidate does; an interview stamped with another company never counts.
 *  - D-T-C5 next_step is exactly { from, to, blocker } and blocker exactly { code, done, total }: codes and numbers, nothing else.
 *  - D-T-C6 can_move and can_decide (spec check C-4): compared with the real routes for R and HM on every open stage and on Not hired:
 *    can_move is true when PUT .../stage to the previous or next open stage answers anything but 403 or 404 (a 409 is "allowed but
 *    blocked"); can_decide when POST .../not-hired (open stages) or POST .../reopen (Not hired) answers anything but 403 or 404. Hired:
 *    both false. A panel member: both false.
 *  - D-T-C7 The record never writes (spec check C-2): no PutItem, UpdateItem, DeleteItem, batch or transaction call on any table, for any
 *    caller, on a locked or an unlocked row; the stored row is unchanged after a read.
 *  - D-T-C8 Every AWS call the record makes is one getCandidate's role may make after step C (spec check C-3): DynamoDB GetItem on the
 *    state, tenants, roles and config tables; Query on the state table (no index) and on the config table's GSI1-active-configs index only.
 *  - D-T-C9 legacy_hired is true only when the row stores legacy_hired: true (the REC-03 script's marker). employee_id is the row's own,
 *    never a request value; no read of the employees table.
 *  - D-T-C10 A failed read is 500 { error: 'Something went wrong' } (no other key); the log names the error, never its message, a name or
 *    an email. A role row that is not found gives the stored title (rule 5's fallback). 404 stays { error: 'Not found' }.
 *  - D-T-C11 Terraform: getCandidate's existing policy (aws_iam_role_policy.get_candidate) gains exactly GetItem on talent-flow-roles,
 *    GetItem on talent-flow-config and Query on talent-flow-config/index/GSI1-active-configs; its Lambda gets ROLES_TABLE_NAME and
 *    CONFIG_TABLE_NAME. No new role, policy resource or KMS line (both tables use the state key the role holds).
 *  - D-T-C12 In api/openapi.yaml, CandidateRecord's `required` holds id, candidateId, stage, role_id, role_title, level, applied_at,
 *    can_move and can_decide; NextStep and its blocker are closed with every field required.
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const ROUTE = 'GET /v1/candidates/{id}';
const NOT_FOUND = { error: 'Not found' };
const SERVER_ERROR = { error: 'Something went wrong' };
const answer = (r: Run) => [statusOf(r), bodyOf(r)];
const sorted = (a: Iterable<string>) => [...new Set(a)].sort();
const R_ = C.recruiter;
const HM = C.hmC1; // hiring manager hmA (Fleet controller's candidates)
const P = C.panelA; // panel member of the interviews of full, ready, twice, foreign, offer, legacy, employed, notHired, old

/** Rule 12's kept old fields and step 0 item 1's additions (the old Angular record page reads them). */
const KEPT_OLD = [
  'candidateId', 'id', 'firstName', 'lastName', 'email', 'phone', 'positionTitle', 'positionLevel', 'department', 'location', 'experienceYears', 'source',
  'hiringManagerId', 'appliedDate', 'currentStage', 'stageEnteredAt', 'status', 'slaStatus', 'createdAt', 'currentInterviewId',
  'workflowTemplateId', 'configVersion', 'updatedAt', 'slaBreachedAt', 'interviewSentiment', 'engagementSentiment', 'acceptanceSentiment', 'engagementScore',
  'evaluationResult', 'finalScore', 'decided_by_kind',
];
const FOR_ALL = ['stage', 'role_id', 'role_title', 'level', 'applied_at', 'can_move', 'can_decide'];
const FOR_R_HM = ['due_at', 'sla_status', 'stage_entered_at', 'next_step', 'interviews_done', 'interviews_required', 'legacy_hired'];
const NEW_FIELDS = [...FOR_ALL, ...FOR_R_HM, 'department_id', 'department', 'source', 'employee_id', 'added_by'];
/** Child lock rec-15c.2: old row fields the locked dev checks read (rec-02 AC-12, rec-03 AC-11), for R and HM when the row has them. */
const READ_BY_OLD_CHECKS: Record<string, 'integer' | 'string'> = {
  strong_no_count: 'integer', reason_code: 'string', decided_by: 'string', stage_before_not_hired: 'string', legacy_stage: 'string',
};
const OLD_CHECK_FIELDS = Object.keys(READ_BY_OLD_CHECKS);
const INTERNAL = ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'settingVersions', 'idempotencyKey'];
type Kind = 'R' | 'HM' | 'P';

/** The keys the record must have for this caller kind, from the stored row (D-T-C1). */
function expectedKeys(row: Record<string, any>, kind: Kind, hasInterview: boolean): string[] {
  const out = new Set<string>(['id', 'candidateId', ...FOR_ALL]);
  for (const k of KEPT_OLD) if (k in row && k !== 'currentInterviewId') out.add(k);
  if (hasInterview) out.add('currentInterviewId');
  if (row['department_id'] !== undefined) out.add('department_id');
  if (row['department_id'] !== undefined || row['department'] !== undefined) out.add('department');
  if (row['source'] !== undefined) out.add('source');
  if (kind !== 'P') for (const k of FOR_R_HM) out.add(k);
  if (kind !== 'P') for (const k of OLD_CHECK_FIELDS) if (row[k] !== undefined) out.add(k); // child lock rec-15c.2
  if (kind === 'R') for (const k of ['employee_id', 'added_by', 'settingVersions']) if (row[k] !== undefined) out.add(k);
  return sorted(out);
}

/**
 * D-T-C8: the calls getCandidate's role allows after step C (talent-flow-iam.tf get_candidate and get_candidate_modules_read, plus the
 * three reads of D-T-C11). The fake AWS does not check IAM, so this list does: a call outside it would be refused on AWS.
 */
const MAY: Record<string, string[]> = {
  'dynamodb GetItem': [TABLE.state, TENANTS, ROLES_TABLE, TABLE.config],
  'dynamodb Query': [TABLE.state, TABLE.config],
};
function notAllowed(r: Run): string[] {
  const out: string[] = [];
  for (const c of awsOf(r) as any[]) {
    const what = `${c.service} ${c.op}`;
    const where = String(c.table ?? '');
    const index = c.input?.IndexName;
    let ok = (MAY[what] ?? []).includes(where);
    if (ok && what === 'dynamodb Query') ok = where === TABLE.state ? index === undefined : index === 'GSI1-active-configs';
    if (ok && what === 'dynamodb GetItem') ok = index === undefined;
    if (!ok) out.push(`${what} ${where}${index ? ' index ' + index : ''}`);
  }
  return out;
}
const WRITE = /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems|ExecuteStatement|BatchExecuteStatement/;
const writesOf = (r: Run) => (awsOf(r) as any[]).filter((c) => c.service !== 'dynamodb' || WRITE.test(c.op)).map((c) => `${c.service} ${c.op} ${c.table ?? ''}`);

let docCache: Doc | undefined;
const doc = () => (docCache ??= readDoc());
const misfit = (r: Run): string[] => {
  const s = statusOf(r);
  if (s === undefined) return [`no answer (${describe(r)})`];
  return checker(doc()).check(answerSchema(doc(), ROUTE, s), bodyOf(r)).map((p) => `${ROUTE} ${s}: ${p}`);
};

/** GET /v1/candidates/{id}, with the checks every read must pass: no write (D-T-C7), only granted calls (D-T-C8), the schema (AC-16). */
function rec(who: Caller, id: string, t: Tables, o: Parameters<typeof recordRun>[3] = {}, label = `${who.name} reads ${id}`): Run {
  const r = recordRun(who, id, t, o);
  expect.soft(writesOf(r), `${label}: the record writes nothing and calls nothing but DynamoDB reads (D-T-C7)`).toEqual([]);
  expect.soft(notAllowed(r), `${label}: every AWS call is one getCandidate's role may make (D-T-C8)`).toEqual([]);
  expect.soft(misfit(r), `${label}: the answer (${describe(r).slice(0, 120)}) passes api/openapi.yaml`).toEqual([]);
  return r;
}
const ok = (r: Run, label: string) => {
  expect(statusOf(r), `${label}: 200 (${describe(r).slice(0, 300)})`).toBe(200);
  return bodyOf(r) as Record<string, any>;
};
const hasInterviewFor = (id: string, kind: Kind) => (CAND[id]?.ivs ?? []).some((iv) => !iv.company && (kind !== 'P' || iv.panel.includes(SUB.panelA)));
/** Plain stored candidate row of the world. */
const stored = (t: Tables, id: string) => sagaOf(t, id) ?? {};
const listRows = (who: Caller, t: Tables) => [...((bodyOf(list(who, {}, t))?.candidates ?? []) as any[]), ...((bodyOf(list(who, { stage: 'NOT_HIRED' }, t))?.candidates ?? []) as any[])];
const SAME_AS_LIST = ['stage', 'stage_entered_at', 'due_at', 'sla_status', 'role_id', 'role_title', 'level', 'applied_at', 'source'];
const pick = (o: Record<string, any> | undefined, keys: string[]) => Object.fromEntries(keys.filter((k) => o && k in o).map((k) => [k, o![k]]));

// ---------------------------------------------------------------- tests

test.describe('REC-15 step C · The candidate record', () => {
  test('Control: the world is good: the candidates, interviews, settings and departments are there as the tests expect', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    for (const id of Object.values(Q)) expect.soft(stored(t, id)['candidateId'], `${nameOf(id)} is stored`).toBe(id);
    expect.soft(stored(t, Q.full)['settingVersions'], 'full is locked to version 1 of every setting').toEqual(LOCK_V1);
    expect.soft(Object.values(Q).filter((id) => id !== Q.full).filter((id) => 'settingVersions' in stored(t, id)), 'every other candidate is an older, unlocked row').toEqual([]);
    expect.soft(activeData(t, A, 'INTERVIEW_TYPES')?.requiredByLevel, 'A\'s Standard pack interview rule').toEqual({ JUNIOR: ['PHONE_SCREEN'], MID: ['PHONE_SCREEN', 'TECHNICAL'], SENIOR: ['PHONE_SCREEN', 'TECHNICAL', 'BEHAVIORAL'] });
    expect.soft(activeData(t, A, 'REJECTION_RULES')?.decider, 'A\'s Standard pack lets the hiring manager decide at every level').toEqual({ JUNIOR: 'HR_OR_HM', MID: 'HR_OR_HM', SENIOR: 'HR_OR_HM' });
    expect.soft(activeData(t, A, 'STAGE_CONFIG'), 'Screening is on for A').toEqual({ screening: true });
    const deps = rowsOf(t, TENANTS).find((x) => x['pk'] === `TENANT#${A}` && x['sk'] === 'DEPARTMENTS')?.['departments'] as any[];
    expect.soft(deps?.find((d) => d.id === DEP.opsA.id)?.name, 'A\'s list names Operations').toBe('Operations');
    expect.soft(deps?.some((d) => d.id === DEP.dispatchB.id), 'and does not hold B\'s department').toBe(false);
    const ivs = rowsOf(t, TABLE.state).filter((x) => String(x['SK']).startsWith('INTERVIEW#') && x['candidateId'] === Q.full);
    expect.soft(ivs.map((x) => `${x['interviewType']} ${x['status']}`).sort(), 'full has a completed PHONE_SCREEN and a scheduled TECHNICAL').toEqual(['PHONE_SCREEN COMPLETED', 'TECHNICAL SCHEDULED']);
    // Today's record answers for the Recruiter (the route exists and reads the world).
    const r = recordRun(R_, Q.full, t);
    expect.soft(statusOf(r), `today the Recruiter opens full (${describe(r).slice(0, 200)})`).toBe(200);
  });

  // ---------------------------------------------------------------- AC-10

  test('AC-10 The record is an explicit list: each of R, HM and P gets exactly the fields of rule 18 and the kept old fields with their stored values; no internal key or unlisted field for anyone', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const row = stored(t, Q.full);
    const runs: [Kind, Caller][] = [['R', R_], ['HM', HM], ['P', P]];
    const bodies: Record<string, Record<string, any>> = {};
    for (const [kind, who] of runs) {
      const a = ok(rec(who, Q.full, t), `${kind} opens full`);
      bodies[kind] = a;
      expect.soft(Object.keys(a).sort(), `${kind}: exactly the fields rule 18 and rule 12 give (D-T-C1)`).toEqual(expectedKeys(row, kind, hasInterviewFor(Q.full, kind)));
      for (const k of INTERNAL.filter((x) => kind !== 'R' || x !== 'settingVersions')) expect.soft(k in a, `${kind}: no ${k}`).toBe(false);
      // Child lock rec-15c.2: legacy_stage and stage_before_not_hired are read by the locked dev checks, so R and HM get them as stored.
      for (const k of Object.keys(NEVER_FIELDS)) {
        if (kind !== 'P' && OLD_CHECK_FIELDS.includes(k)) expect.soft(a[k], `${kind}: ${k} as stored (child lock rec-15c.2)`).toEqual(NEVER_FIELDS[k]);
        else expect.soft(k in a, `${kind}: no ${k} (not on rule 12's list)`).toBe(false);
      }
      const text = JSON.stringify(a);
      for (const [what, v] of Object.entries(NEVER)) expect.soft(text.includes(v), `${kind}: the answer holds no ${what}`).toBe(false);
      expect.soft(/salary|offer/i.test(Object.keys(a).join(' ')), `${kind}: no offer or salary field (rule 12: the Offer tab reads its own route)`).toBe(false);
      for (const [k, v] of Object.entries(OLD_KEPT_VALUES)) expect.soft(a[k], `${kind}: ${k} is kept with its stored value`).toEqual(k === 'department' ? 'Operations' : v);
      expect.soft([a['id'], a['candidateId']], `${kind}: id and candidateId`).toEqual([Q.full, Q.full]);
      expect.soft(
        pick(a, ['stage', 'role_id', 'role_title', 'level', 'applied_at', 'department_id', 'department', 'source']),
        `${kind}: the new fields everyone sees (role_title is the role's, not the stored "Fleet ctrl (old title)"; department by id)`,
      ).toEqual({ stage: 'INTERVIEW', role_id: R.fleet, role_title: 'Fleet controller', level: 'MID', applied_at: OLD_KEPT_VALUES['appliedDate'], department_id: DEP.opsA.id, department: 'Operations', source: 'Referral' });
    }
    // The values only R and HM see.
    for (const kind of ['R', 'HM'] as const) {
      const a = bodies[kind] ?? {};
      expect.soft(pick(a, ['stage_entered_at', 'due_at', 'sla_status']), `${kind}: the stage clock (30 of 100 hours: on track, though the stored slaStatus says AT_RISK)`).toEqual({
        stage_entered_at: OLD_KEPT_VALUES['stageEnteredAt'], due_at: new Date(Date.parse(String(OLD_KEPT_VALUES['stageEnteredAt'])) + 100 * 3_600_000).toISOString(), sla_status: 'ON_TRACK',
      });
      expect.soft(a['next_step'], `${kind}: next step Interview to Offer, blocked 1 of 2`).toEqual({ from: 'INTERVIEW', to: 'OFFER', blocker: { code: 'INTERVIEWS_INCOMPLETE', done: 1, total: 2 } });
      expect.soft([a['interviews_done'], a['interviews_required'], a['legacy_hired']], `${kind}: 1 of 2 interviews done, not a legacy hire`).toEqual([1, 2, false]);
      expect.soft([a['can_move'], a['can_decide']], `${kind}: may move and decide (Recruiter; hiring manager where the level's decider is HR_OR_HM)`).toEqual([true, true]);
    }
    expect.soft([bodies['R']?.['added_by'], bodies['R']?.['settingVersions']], 'R: added_by and the lock (spec check C-1)').toEqual([SUB.recA, LOCK_V1]);
    expect.soft([bodies['P']?.['can_move'], bodies['P']?.['can_decide']], 'P: both false').toEqual([false, false]);
    // The old fields keep their old rules: each caller sees the same old values.
    for (const k of ['firstName', 'lastName', 'email', 'phone', 'positionTitle', 'currentStage', 'hiringManagerId']) {
      expect.soft(new Set(['R', 'HM', 'P'].map((x) => JSON.stringify(bodies[x]?.[k]))).size, `${k} is the same for R, HM and P`).toBe(1);
    }
    expect.soft(changedRows(t, recordRun(R_, Q.full, t).tables), 'the read changes no row').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-10, child lock rec-15c.2

  test('AC-10 Child lock rec-15c.2: the fields the locked dev checks read (Strong No count, Not hired reason, who decided, the stage it left, the old stage name) reach the Recruiter and the hiring manager as stored, never a panel member, and only when the row has them', async ({}, testInfo) => {
    once(testInfo.project.name);
    const STORED: Record<string, unknown> = { strong_no_count: 2, reason_code: 'WITHDREW', decided_by: SUB.recA, stage_before_not_hired: 'SCREENING', legacy_stage: 'INTERVIEWING' };
    const t = withCandidate(world(), Q.full, STORED);
    expect.soft(pick(stored(t, Q.full), OLD_CHECK_FIELDS), 'the row holds all five').toEqual(STORED);
    for (const [kind, who] of [['R', R_], ['HM', HM]] as const) {
      const a = ok(rec(who, Q.full, t), `${kind} opens full holding the five fields`);
      expect.soft(pick(a, OLD_CHECK_FIELDS), `${kind}: each of the five as stored`).toEqual(STORED);
      expect.soft(Object.keys(a).sort(), `${kind}: and otherwise exactly the fields of rule 18 and rule 12`).toEqual(expectedKeys(stored(t, Q.full), kind, hasInterviewFor(Q.full, kind)));
    }
    const p = ok(rec(P, Q.full, t), 'P opens full holding the five fields');
    expect.soft(OLD_CHECK_FIELDS.filter((k) => k in p), 'a panel member gets none of the five').toEqual([]);
    expect.soft(Object.keys(p).sort(), 'P: exactly the fields of rule 18 and rule 12').toEqual(expectedKeys(stored(t, Q.full), 'P', hasInterviewFor(Q.full, 'P')));
    // A row without them gets no key for them (not null), for R and HM.
    const plain = world();
    expect.soft(OLD_CHECK_FIELDS.filter((k) => k in stored(plain, Q.ready)), 'ready stores none of the five').toEqual([]);
    for (const [kind, who] of [['R', R_], ['HM', HM]] as const) {
      const a = ok(rec(who, Q.ready, plain), `${kind} opens ready`);
      expect.soft(OLD_CHECK_FIELDS.filter((k) => k in a), `${kind}: a row without them gets none of the keys`).toEqual([]);
    }
    // As rec-02 AC-12 reads it on dev: the real Not hired route, then the record shows the reason, who decided and the stage it left.
    const nh = notHiredRun(R_, Q.applied, plain);
    expect(statusOf(nh), `the Recruiter records Not hired on applied (${describe(nh).slice(0, 200)})`).toBe(200);
    const after = ok(rec(R_, Q.applied, nh.tables), 'R opens applied after Not hired');
    const row = stored(nh.tables, Q.applied);
    expect.soft(pick(after, ['stage', 'reason_code', 'decided_by', 'decided_by_kind', 'stage_before_not_hired']), 'the record shows what the Not hired route stored').toEqual({
      stage: 'NOT_HIRED', reason_code: row['reason_code'], decided_by: row['decided_by'], decided_by_kind: row['decided_by_kind'], stage_before_not_hired: 'APPLIED',
    });
    expect.soft([row['reason_code'], row['decided_by']], 'the route stored the reason and the Recruiter\'s id').toEqual(['WITHDREW', SUB.recA]);
    const pAfter = bodyOf(recordRun(P, Q.applied, nh.tables)) ?? {};
    expect.soft(OLD_CHECK_FIELDS.filter((k) => k in pAfter), 'a panel member still gets none of them').toEqual([]);
    // The schema takes the five with their types and refuses a wrong type.
    const ck = checker(doc());
    const a200 = answerSchema(doc(), ROUTE, 200);
    const good = ok(rec(R_, Q.full, t), 'R opens full again');
    expect.soft(ck.check(a200, good), 'R\'s answer with the five passes api/openapi.yaml').toEqual([]);
    expect.soft(ck.check(a200, { ...good, strong_no_count: 'two' }).length > 0, 'strong_no_count as text fails').toBe(true);
    expect.soft(ck.check(a200, { ...good, legacy_stage: 3 }).length > 0, 'legacy_stage as a number fails').toBe(true);
    expect.soft(changedRows(t, recordRun(R_, Q.full, t).tables), 'the read changes no row').toEqual([]);
  });

  test('AC-10 Every A candidate reads without error for the Recruiter and its own hiring manager, with the list\'s values; an old row and Hired, Not hired and stray rows too; B\'s Recruiter reads B\'s with B\'s hours and titles', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(6 * 60_000);
    const t = world();
    // The Recruiter: every A candidate in the world (REC-15 step A's and this card's), against the list row (D-T-C2).
    const rows = new Map(listRows(R_, t).map((x) => [x.id, x]));
    const ids = rowsOf(t, TABLE.state).filter((x) => x['SK'] === 'SAGA' && x['tenant_id'] === A && x['GSI1PK'] === `TENANT#${A}`).map((x) => String(x['candidateId']));
    expect.soft(ids.length, 'A has more than 25 candidates in the world').toBeGreaterThan(25);
    for (const id of ids) {
      const a = ok(rec(R_, id, t), `R opens ${id}`);
      const want = rows.get(id);
      expect.soft(!!want, `${id} is in the Recruiter's list`).toBe(true);
      expect.soft(pick(a, SAME_AS_LIST), `R ${id}: stage, clock, role and dates equal the list row (D-T-C2)`).toEqual(pick(want, SAME_AS_LIST));
      expect.soft(Object.keys(a).sort(), `R ${id}: exactly the fields of rule 18 and rule 12`).toEqual(expectedKeys(stored(t, id), 'R', hasInterviewFor(id, 'R')));
    }
    // The hiring manager hmA: every candidate of theirs, against their own list.
    const hmRows = new Map(listRows(HM, t).map((x) => [x.id, x]));
    for (const id of ids.filter((x) => stored(t, x)['hiringManagerId'] === SUB.hmA).slice(0, 12)) {
      const a = ok(rec(HM, id, t), `HM opens ${id}`);
      expect.soft(pick(a, SAME_AS_LIST), `HM ${id}: equal to the hiring manager's list row`).toEqual(pick(hmRows.get(id), SAME_AS_LIST));
      expect.soft(Object.keys(a).sort(), `HM ${id}: exactly the fields of rule 18 and rule 12`).toEqual(expectedKeys(stored(t, id), 'HM', hasInterviewFor(id, 'HM')));
    }
    // The old row: no role_id, no appliedDate, the old stage name TECHNICAL_INTERVIEW, a free-text department.
    const old = ok(rec(R_, Q.old, t), 'the old row');
    expect.soft(pick(old, ['stage', 'role_id', 'role_title', 'department', 'applied_at']), 'the old row reads as Interview, no role, its own title and department text, applied_at from createdAt').toEqual({
      stage: 'INTERVIEW', role_id: null, role_title: 'Bread maker', department: 'Bakery floor', applied_at: stored(t, Q.old)['createdAt'],
    });
    expect.soft('department_id' in old, 'no department_id on a row that has none').toBe(false);
    expect.soft(old['next_step'], 'the old row\'s next step counts its MID rule: 1 of 2').toEqual({ from: 'INTERVIEW', to: 'OFFER', blocker: { code: 'INTERVIEWS_INCOMPLETE', done: 1, total: 2 } });
    // REC-15 step A's stray row (A's partition, stamped B) is nobody's: the same 404 as a made-up id.
    const ghost = rec(R_, 'CAND-15REC15CGHOSTAAAAAAAAA1', t);
    expect.soft(answer(rec(R_, K15.x1, t)), 'a row stamped B in A\'s partition: the made-up answer').toEqual(answer(ghost));
    // B's Recruiter on B's candidates: B's hours (10 an open stage) and B's role title; bA carries A's role id and keeps its own title.
    const bRows = new Map(listRows(C.recruiterB, t).map((x) => [x.id, x]));
    for (const id of [Q.bCand, K15.b1, K15.bA]) {
      const a = ok(rec(C.recruiterB, id, t), `B's Recruiter opens ${id}`);
      expect.soft(pick(a, SAME_AS_LIST), `B ${id}: equal to B's list row`).toEqual(pick(bRows.get(id), SAME_AS_LIST));
    }
    const bc = ok(rec(C.recruiterB, Q.bCand, t), 'bCand');
    expect.soft(pick(bc, ['role_title', 'due_at', 'sla_status']), 'bCand: Dispatch lead, due 10 hours after it entered Interview (B\'s hours), on track at 5').toEqual({ role_title: 'Dispatch lead', due_at: new Date(Date.parse(ago(5)) + 10 * 3_600_000).toISOString(), sla_status: 'ON_TRACK' });
    expect.soft(bodyOf(recordRun(C.recruiterB, K15.bA, t))?.role_title, 'bA (B, carrying A\'s Fleet controller id): its own stored title, never A\'s role').toBe('Fleet ctrl (old title)');
    expect.soft(bc['next_step'], 'bCand: B\'s Standard pack, MID: 1 of 2').toEqual({ from: 'INTERVIEW', to: 'OFFER', blocker: { code: 'INTERVIEWS_INCOMPLETE', done: 1, total: 2 } });
  });

  test('AC-10 Who gets 404: B\'s Recruiter, another manager, an Employee, a panel member of another candidate and a made-up id all get the same answer; the company never comes from the request', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const made = rec(R_, 'CAND-15REC15CMADEUPAAAAAAAA1', t);
    expect.soft(answer(made), 'a made-up id: 404 Not found').toEqual([404, NOT_FOUND]);
    const outsiders: Caller[] = [C.recruiterB, C.managerB, C.panelB, C.adminB, C.hmOther, C.employee, C.panel2A, C.adminOnly, C.hrNoTick, C.tickNoHr, C.approver, C.guest];
    for (const who of outsiders) {
      const r = rec(who, Q.full, t);
      expect.soft(answer(r), `${who.name}: the made-up answer`).toEqual(answer(made));
      expect.soft(JSON.stringify(bodyOf(r)), `${who.name}: names nothing of full`).not.toMatch(/Thabo|Nkosi|Fleet/);
    }
    // A's own people with the company named elsewhere: still A's record. B's Recruiter naming A everywhere but the sign-in: still 404.
    const named = rec(R_, Q.full, t, { query: { tenantId: B, tenant_id: B }, headers: { 'x-tenant-id': B }, body: { tenant_id: B } });
    expect.soft(ok(named, 'A naming B')['stage'], 'A\'s Recruiter naming B in the query, a header and the body: A\'s record').toBe('INTERVIEW');
    const bTry = rec(C.recruiterB, Q.full, t, { query: { tenantId: A, tenant_id: A }, headers: { 'x-tenant-id': A }, body: { tenant_id: A } });
    expect.soft(answer(bTry), 'B\'s Recruiter naming A everywhere but the sign-in: 404').toEqual(answer(made));
    expect.soft(ok(rec(C.recruiterB, Q.bCand, t), 'B\'s own')['role_title'], 'B\'s Recruiter opens B\'s own candidate, in the new shape').toBe('Dispatch lead');
    // The hiring manager of another candidate and the panel member of another interview get 404 on full, and their own candidates in the new shape.
    expect.soft(ok(rec(C.hmOther, Q.senior, t), 'hm2A on senior')['next_step'], 'hm2A opens senior (their own): SENIOR, 2 of 3').toEqual({ from: 'INTERVIEW', to: 'OFFER', blocker: { code: 'INTERVIEWS_INCOMPLETE', done: 2, total: 3 } });
    const p2 = ok(rec(C.panel2A, Q.senior, t), 'panel2A on senior');
    expect.soft(Object.keys(p2).filter((k) => FOR_R_HM.includes(k)), 'a panel member gets none of the R and HM fields').toEqual([]);
    expect.soft([p2['can_move'], p2['can_decide']], 'and both false').toEqual([false, false]);
    // Recruitment off for the company: refused.
    // Recruitment off for the company: the module check refuses with 403 before any candidate row is read (MOD-01).
    const d = recordRun(C.recruiterD, Q.full, t);
    expect.soft(answer(d), `Recruitment off: 403 from the module check (${describe(d)})`).toEqual([403, { error: 'Forbidden' }]);
    expect.soft((awsOf(d) as any[]).filter((c) => c.table === TABLE.state).length, 'Recruitment off: no candidate row is read').toBe(0);
  });

  test('AC-10 department follows a renamed department, falls back to the stored text, and never shows another company\'s name; role_title follows a renamed role', async ({}, testInfo) => {
    once(testInfo.project.name);
    const base = world();
    const t = withRole(withDepartmentName(base, A, DEP.opsA.id, 'Operations and Fleet'), A, R.fleet, { job_title: 'Fleet lead' });
    for (const [kind, who] of [['R', R_], ['HM', HM], ['P', P]] as [Kind, Caller][]) {
      const a = ok(rec(who, Q.full, t), `${kind} after the renames`);
      expect.soft([a['department'], a['department_id'], a['role_title']], `${kind}: the department's and the role's new names at once`).toEqual(['Operations and Fleet', DEP.opsA.id, 'Fleet lead']);
    }
    const bd = ok(rec(R_, Q.bDept, t), 'bDept');
    expect.soft(bd['department'], 'a department id that is B\'s: the stored text, never B\'s name (D-T-C3)').toBe('Typed dispatch');
    expect.soft(JSON.stringify(bd), 'B\'s department name is nowhere').not.toContain(DEP.dispatchB.name);
    // B renames its own department to a name that would give itself away: still not shown to A.
    const t2 = withDepartmentName(t, B, DEP.dispatchB.id, 'Zz B only name');
    expect.soft(JSON.stringify(bodyOf(recordRun(R_, Q.bDept, t2))), 'B\'s renamed department is nowhere in A\'s record').not.toContain('Zz B only name');
    const gone = ok(rec(R_, Q.full, withCandidate(t, Q.full, { department_id: 'dep_01REC15CDELETEDAAAAAAAAAA' })), 'a department id no list holds');
    expect.soft(gone['department'], 'a department id no list holds: the stored text').toBe('Ops (typed when added)');
    // A role that is not found (deleted, or never there): the stored title.
    const noRole = ok(rec(R_, Q.full, withCandidate(t, Q.full, { role_id: R.none })), 'a role id no role row has');
    expect.soft([noRole['role_id'], noRole['role_title']], 'a role id no row has: that id and the stored title').toEqual([R.none, 'Fleet ctrl (old title)']);
  });

  // ---------------------------------------------------------------- lock check round 1: FX-1, FX-2, FX-3 and M01

  test('AC-10 The stage clock reads the company\'s current hours, as the list does, even for a candidate locked to an older version (lock check FX-1)', async ({}, testInfo) => {
    once(testInfo.project.name);
    // A new active SLA_THRESHOLDS version: Interview 35 hours (version 1 says 100). full is locked to version 1; it is 30 hours into Interview.
    const v2 = withNewVersion(world(), A, 'SLA_THRESHOLDS', () => ({ APPLIED: 24, SCREENING: 48, INTERVIEW: 35, OFFER: 72 }));
    expect.soft([v2.version, stored(v2.t, Q.full)['settingVersions']?.['SLA_THRESHOLDS']], 'version 2 is active and full stays locked to version 1').toEqual([2, 1]);
    for (const [kind, who] of [['R', R_], ['HM', HM]] as [Kind, Caller][]) {
      const rows = new Map(listRows(who, v2.t).map((x) => [x.id, x]));
      for (const id of [Q.full, Q.ready]) {
        const a = ok(rec(who, id, v2.t), `${kind} on ${nameOf(id)}, hours version 2`);
        expect.soft(pick(a, ['stage_entered_at', 'due_at', 'sla_status']), `${kind} ${nameOf(id)}: the clock equals the list row under version 2 (D-T-C2)`).toEqual(pick(rows.get(id), ['stage_entered_at', 'due_at', 'sla_status']));
      }
      const f = bodyOf(recordRun(who, Q.full, v2.t)) ?? {};
      expect.soft([f['due_at'], f['sla_status']], `${kind} full: 35 hours from entering Interview, 30 used: due soon`).toEqual([new Date(Date.parse(String(OLD_KEPT_VALUES['stageEnteredAt'])) + 35 * 3_600_000).toISOString(), 'DUE_SOON']);
    }
  });

  test('AC-10 A role row that is not the company\'s own lends no title: one in A\'s space stamped B, one stored under another role id; the record keeps the stored title, as the list does (lock check FX-2)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const base = withStrayRoles(world());
    for (const stray of [STRAY.stampedB, STRAY.mismatch]) {
      const t = withCandidate(base, Q.full, { role_id: stray.id });
      for (const [kind, who] of [['R', R_], ['HM', HM], ['P', P]] as [Kind, Caller][]) {
        const r = rec(who, Q.full, t);
        const a = ok(r, `${kind} on full pointing at ${stray.id}`);
        expect.soft([a['role_id'], a['role_title']], `${kind}: ${stray.title}: the stored title, never the stray row's`).toEqual([stray.id, 'Fleet ctrl (old title)']);
        expect.soft(JSON.stringify(bodyOf(r)), `${kind}: "${stray.title}" is nowhere in the answer`).not.toContain(stray.title);
      }
      const row = listRows(R_, t).find((x) => x.id === Q.full);
      expect.soft(row?.role_title, `the list row agrees: the stored title (${stray.title})`).toBe('Fleet ctrl (old title)');
    }
  });

  test('AC-10 A failed read of the role row is the 500 too, never a quiet 200 with the stored title; the log names the error only (lock check FX-3)', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    // Which GetItem is the role read: found from a good run's own calls, so the order the build reads in does not matter.
    const good = recordRun(R_, Q.full, t);
    const gets = (awsOf(good) as any[]).filter((c) => c.service === 'dynamodb' && c.op === 'GetItem');
    const nth = gets.findIndex((c) => c.table === ROLES_TABLE) + 1;
    expect(nth, `the good read GetItems the role row (${gets.map((c) => c.table).join(', ')})`).toBeGreaterThan(0);
    const SECRET = 'zz-rec15c-role-read-detail';
    const fail = { service: 'dynamodb', ops: ['GetItem'], nth, message: `${SECRET} Thabo thabo.nkosi@example.test`, name: 'ProvisionedThroughputExceededException' };
    const r = rec(R_, Q.full, t, { fail });
    expect.soft((awsOf(r) as any[]).filter((c) => c.op === 'GetItem').length >= nth, 'the failed call was reached').toBe(true);
    expect.soft(answer(r), 'a failed role read: 500 Something went wrong (D-T-C10)').toEqual([500, SERVER_ERROR]);
    const lines = logsOf(r).join('\n');
    expect.soft(lines, 'the log names the error').toContain('ProvisionedThroughputExceededException');
    for (const w of [SECRET, 'thabo', 'nkosi']) expect.soft(lines.toLowerCase().includes(w), `no log line holds "${w}"`).toBe(false);
  });

  test('AC-10 A panel member\'s currentInterviewId is one of their own interviews, never another panel\'s (lock check M01)', async ({}, testInfo) => {
    once(testInfo.project.name);
    // full's interview 2 (TECHNICAL, scheduled) now has panelX only; P (panelA) sits on interview 1 (PHONE_SCREEN, completed) only.
    const t = withPanel(world(), Q.full, 2, [SUB.panelX]);
    expect.soft(ok(rec(R_, Q.full, t), 'R')['currentInterviewId'], 'the Recruiter: the scheduled interview, as today').toBe(interviewIdOf(Q.full, 2));
    expect.soft(ok(rec(P, Q.full, t), 'P')['currentInterviewId'], 'the panel member: their own interview only').toBe(interviewIdOf(Q.full, 1));
  });

  test('AC-10 A failed read is a 500 that says nothing more; logs carry error names only, never a name or an email', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const SECRET = 'zz-rec15c-planted-detail';
    const fail = { service: 'dynamodb', ops: ['Query'], message: `${SECRET} thabo.nkosi@example.test Thabo`, name: 'ProvisionedThroughputExceededException' };
    const r = rec(R_, Q.full, t, { fail });
    expect.soft(answer(r), 'a failed read: 500 Something went wrong (D-T-C10)').toEqual([500, SERVER_ERROR]);
    const lines = logsOf(r).join('\n');
    expect.soft(lines, 'the log names the error').toContain('ProvisionedThroughputExceededException');
    for (const w of [SECRET, 'thabo.nkosi', 'Thabo', 'Nkosi']) expect.soft(lines.toLowerCase().includes(w.toLowerCase()), `no log line holds "${w}"`).toBe(false);
    for (const [kind, who] of [['R', R_], ['HM', HM], ['P', P]] as [Kind, Caller][]) {
      const good = rec(who, Q.full, t);
      const text = logsOf(good).join('\n').toLowerCase();
      for (const w of ['thabo', 'nkosi', 'thabo.nkosi@example.test', '+27 82 555 0199', NEVER.idNumber]) expect.soft(text.includes(w), `${kind}: a good read logs no "${w}"`).toBe(false);
    }
  });

  // ---------------------------------------------------------------- AC-11

  test('AC-11 Next step and interviews done: each stage\'s next step, the blocker\'s numbers, types counted once, another company\'s interview not counted, Screening off; codes and numbers only', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const blocked = (done: number, total: number) => ({ code: 'INTERVIEWS_INCOMPLETE', done, total });
    const want: [string, unknown, [number | null, number | null]][] = [
      [Q.applied, { from: 'APPLIED', to: 'SCREENING', blocker: null }, [null, null]],
      [Q.screening, { from: 'SCREENING', to: 'INTERVIEW', blocker: null }, [null, null]],
      [Q.full, { from: 'INTERVIEW', to: 'OFFER', blocker: blocked(1, 2) }, [1, 2]],
      [Q.ready, { from: 'INTERVIEW', to: 'OFFER', blocker: null }, [2, 2]],
      [Q.twice, { from: 'INTERVIEW', to: 'OFFER', blocker: blocked(1, 2) }, [1, 2]],
      [Q.foreign, { from: 'INTERVIEW', to: 'OFFER', blocker: blocked(1, 2) }, [1, 2]],
      [Q.junior, { from: 'INTERVIEW', to: 'OFFER', blocker: blocked(0, 1) }, [0, 1]],
      [Q.old, { from: 'INTERVIEW', to: 'OFFER', blocker: blocked(1, 2) }, [1, 2]],
      [Q.offer, null, [2, 2]],
      [Q.legacy, null, [1, 2]],
      [Q.employed, null, [2, 2]],
      [Q.notHired, null, [1, 2]],
    ];
    for (const [id, step, nums] of want) {
      const a = ok(rec(R_, id, t), nameOf(id));
      expect.soft(a['next_step'], `${nameOf(id)}: next_step`).toEqual(step);
      expect.soft([a['interviews_done'], a['interviews_required']], `${nameOf(id)}: interviews done of required (D-T-C4)`).toEqual(nums);
      if (a['next_step']) {
        expect.soft(Object.keys(a['next_step']).sort(), `${nameOf(id)}: next_step is { from, to, blocker } only (D-T-C5)`).toEqual(['blocker', 'from', 'to']);
        if (a['next_step'].blocker) expect.soft(Object.keys(a['next_step'].blocker).sort(), `${nameOf(id)}: blocker is { code, done, total } only`).toEqual(['code', 'done', 'total']);
      }
      for (const v of [a['next_step']?.from, a['next_step']?.to, a['next_step']?.blocker?.code].filter((x) => x !== undefined && x !== null)) expect.soft(v, `${nameOf(id)}: a code, not a sentence`).toMatch(/^[A-Z_]+$/);
    }
    // The senior candidate (hm2A): SENIOR adds BEHAVIORAL.
    expect.soft(ok(rec(R_, Q.senior, t), 'senior')['next_step'], 'SENIOR: 2 of 3').toEqual({ from: 'INTERVIEW', to: 'OFFER', blocker: blocked(2, 3) });
    // Screening off: Applied goes to Interview, Screening's row still reads.
    const off = withScreening(t, false);
    expect.soft(ok(rec(R_, Q.applied, off), 'Screening off')['next_step'], 'Screening off: Applied points to Interview').toEqual({ from: 'APPLIED', to: 'INTERVIEW', blocker: null });
    // The company's own rule decides the count: MID needs nothing (0 of 0, no blocker), or MID needs FINAL too (1 of 3 for full).
    const none = withSetting(t, A, 'INTERVIEW_TYPES', (d) => ({ ...d, requiredByLevel: { ...d.requiredByLevel, MID: [] } }));
    expect.soft(ok(rec(R_, Q.twice, none), 'MID needs none')['next_step'], 'MID needs no interview: not blocked').toEqual({ from: 'INTERVIEW', to: 'OFFER', blocker: null });
    expect.soft([bodyOf(recordRun(R_, Q.twice, none))?.interviews_done, bodyOf(recordRun(R_, Q.twice, none))?.interviews_required], 'and 0 of 0').toEqual([0, 0]);
    const more = withSetting(t, A, 'INTERVIEW_TYPES', (d) => ({ ...d, requiredByLevel: { ...d.requiredByLevel, MID: ['PHONE_SCREEN', 'TECHNICAL', 'FINAL'] } }));
    expect.soft(ok(rec(R_, Q.ready, more), 'MID needs FINAL')['next_step'], 'ready, when MID also needs FINAL: 2 of 3').toEqual({ from: 'INTERVIEW', to: 'OFFER', blocker: blocked(2, 3) });
    // Changing the active version in place keeps its number, so it reaches locked rows too; the lock itself is tested with a new version below.
  });

  test('AC-11 The blocker is set exactly when the real move Interview to Offer is refused with INTERVIEWS_INCOMPLETE, on every fixture and setting, locked and unlocked rows (spec check C-2)', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(6 * 60_000);
    const base = world();
    const v2 = withNewVersion(base, A, 'INTERVIEW_TYPES', (d) => ({ ...d, requiredByLevel: { ...d.requiredByLevel, MID: ['PHONE_SCREEN'] } }));
    const worlds: [string, Tables][] = [
      ['the Standard pack', base],
      ['MID needs nothing', withSetting(base, A, 'INTERVIEW_TYPES', (d) => ({ ...d, requiredByLevel: { ...d.requiredByLevel, MID: [] } }))],
      ['MID needs FINAL too', withSetting(base, A, 'INTERVIEW_TYPES', (d) => ({ ...d, requiredByLevel: { ...d.requiredByLevel, MID: ['PHONE_SCREEN', 'TECHNICAL', 'FINAL'] } }))],
      ['a new active version where MID needs only PHONE_SCREEN (full stays locked to version 1)', v2.t],
    ];
    const ids = [Q.full, Q.ready, Q.twice, Q.foreign, Q.junior, Q.senior, Q.old];
    let blockedSeen = 0;
    let openSeen = 0;
    for (const [label, t] of worlds) {
      for (const id of ids) {
        const a = ok(rec(R_, id, t), `${label}: ${nameOf(id)}`);
        const blocker = a['next_step']?.blocker ?? null;
        const mv = moveRun(R_, id, 'OFFER', t);
        const refused = statusOf(mv) === 409 && bodyOf(mv)?.code === 'INTERVIEWS_INCOMPLETE';
        expect.soft(blocker !== null, `${label}: ${nameOf(id)}: blocker set (${JSON.stringify(blocker)}) exactly when the move is refused INTERVIEWS_INCOMPLETE (${describe(mv).slice(0, 120)})`).toBe(refused);
        expect.soft([200, 409], `${label}: ${nameOf(id)}: the Recruiter's move is 200 or 409 (${describe(mv).slice(0, 120)})`).toContain(statusOf(mv));
        if (refused) blockedSeen++; else if (statusOf(mv) === 200) openSeen++;
      }
    }
    expect.soft([blockedSeen > 4, openSeen > 4], 'the fixtures hold both blocked and open moves').toEqual([true, true]);
    // C-2: the lock decides. full is locked to version 1 (MID: PHONE_SCREEN and TECHNICAL) while version 2 (PHONE_SCREEN only) is active.
    expect.soft(bodyOf(recordRun(R_, Q.full, v2.t))?.next_step?.blocker, 'full, locked to version 1: still blocked 1 of 2').toEqual({ code: 'INTERVIEWS_INCOMPLETE', done: 1, total: 2 });
    expect.soft(bodyOf(recordRun(R_, Q.twice, v2.t))?.next_step?.blocker, 'twice, not locked: the active version 2 (1 of 1, not blocked)').toBeNull();
    // An old unlocked row: the record reads it without locking it (no write), and the stored row has no settingVersions after.
    const read = recordRun(R_, Q.twice, v2.t);
    expect.soft(changedRows(v2.t, read.tables), 'reading an unlocked row changes nothing').toEqual([]);
    expect.soft('settingVersions' in (sagaOf(read.tables, Q.twice) ?? {}), 'and does not lock it').toBe(false);
    expect.soft(v2.version, 'version 2 was made').toBe(2);
  });

  // ---------------------------------------------------------------- AC-12

  test('AC-12 can_move and can_decide equal what the real routes do, for the Recruiter and the hiring manager, on every stage and every decider; Hired and a panel member are false', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(12 * 60_000);
    const base = world();
    const deciders: [string, Tables][] = [
      ['HR_OR_HM at every level', withDecider(base, 'HR_OR_HM')],
      ['HR_ONLY at every level', withDecider(base, 'HR_ONLY')],
      ['HR_ONLY for MID only', withDecider(withDecider(base, 'HR_OR_HM'), 'HR_ONLY', 'MID')],
    ];
    const OPEN = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER'];
    const steps = (stage: string) => { const i = OPEN.indexOf(stage); return i < 0 ? [] : [OPEN[i - 1], OPEN[i + 1]].filter((x): x is string => !!x); };
    const ids = [Q.applied, Q.screening, Q.full, Q.ready, Q.junior, Q.offer, Q.notHired, Q.legacy, Q.employed];
    const seen = { move: new Set<string>(), decide: new Set<string>() };
    for (const [label, t] of deciders) {
      for (const [kind, who] of [['R', R_], ['HM', HM]] as [Kind, Caller][]) {
        for (const id of ids) {
          const a = ok(rec(who, id, t), `${label}, ${kind}, ${nameOf(id)}`);
          const stage = a['stage'];
          const where = `${label}, ${kind}, ${nameOf(id)} (${stage})`;
          if (stage === 'HIRED') {
            expect.soft([a['can_move'], a['can_decide']], `${where}: Hired: both false`).toEqual([false, false]);
            continue;
          }
          const moves = steps(stage).map((to) => statusOf(moveRun(who, id, to, t)));
          const mayMove = moves.some((s) => s !== 403 && s !== 404);
          expect.soft(a['can_move'], `${where}: can_move equals the real route (moves answered ${JSON.stringify(moves)})`).toBe(mayMove);
          const d = stage === 'NOT_HIRED' ? reopenRun(who, id, t) : notHiredRun(who, id, t);
          const mayDecide = statusOf(d) !== 403 && statusOf(d) !== 404;
          expect.soft(a['can_decide'], `${where}: can_decide equals the real ${stage === 'NOT_HIRED' ? 'reopen' : 'Not hired'} route (${describe(d).slice(0, 100)})`).toBe(mayDecide);
          seen.move.add(String(a['can_move']));
          seen.decide.add(String(a['can_decide']));
        }
      }
    }
    expect.soft([sorted(seen.move), sorted(seen.decide)], 'the matrix holds both answers for each').toEqual([['false', 'true'], ['false', 'true']]);
    // A panel member: both false on every stage they can open.
    for (const id of [Q.full, Q.ready, Q.offer, Q.notHired, Q.old]) {
      const a = ok(rec(P, id, base), `P on ${nameOf(id)}`);
      expect.soft([a['can_move'], a['can_decide']], `P on ${nameOf(id)}: both false`).toEqual([false, false]);
    }
    // The hiring manager's decider comes from the candidate's lock (spec check C-2): full is locked to version 1 (HR_OR_HM for MID) while a
    // new active version says HR_ONLY. The record and the real route agree.
    const v2 = withNewVersion(base, A, 'REJECTION_RULES', (d) => ({ ...d, decider: { JUNIOR: 'HR_ONLY', MID: 'HR_ONLY', SENIOR: 'HR_ONLY' } })).t;
    for (const id of [Q.full, Q.ready]) {
      const a = ok(rec(HM, id, v2), `HM on ${nameOf(id)}, version 2 active`);
      const d = notHiredRun(HM, id, v2);
      const mv = moveRun(HM, id, 'OFFER', v2);
      expect.soft(a['can_decide'], `HM on ${nameOf(id)} with version 2 active: can_decide equals the route (${describe(d).slice(0, 80)})`).toBe(statusOf(d) !== 403 && statusOf(d) !== 404);
      expect.soft(a['can_move'], `HM on ${nameOf(id)} with version 2 active: can_move equals the route (${describe(mv).slice(0, 80)})`).toBe(statusOf(mv) !== 403 && statusOf(mv) !== 404);
    }
    expect.soft([bodyOf(recordRun(HM, Q.full, v2))?.can_decide, bodyOf(recordRun(HM, Q.ready, v2))?.can_decide], 'full (locked to version 1) may be decided by its manager, ready (unlocked, version 2) may not').toEqual([true, false]);
  });

  // ---------------------------------------------------------------- AC-13

  test('AC-13 legacy_hired only with the marker; employee_id is the row\'s own, to the Recruiter only; a request value changes nothing; the employees table is never read', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const runs: Run[] = [];
    const legacyOf = (id: string, tt = t) => { const r = rec(R_, id, tt); runs.push(r); return bodyOf(r)?.legacy_hired; };
    expect.soft(legacyOf(Q.legacy), 'the marked Hired row: legacy_hired true').toBe(true);
    for (const id of [Q.employed, Q.full, Q.applied, Q.notHired]) expect.soft(legacyOf(id), `${nameOf(id)}: false`).toBe(false);
    expect.soft(legacyOf(Q.legacy, withCandidate(t, Q.legacy, { legacy_hired: false })), 'legacy_hired stored false: false').toBe(false);
    expect.soft(legacyOf(Q.legacy, withCandidate(t, Q.legacy, { legacy_hired: 'true' })), 'legacy_hired stored as the text "true" (not the marker): false (D-T-C9)').toBe(false);
    expect.soft(bodyOf(recordRun(HM, Q.legacy, t))?.legacy_hired, 'the hiring manager sees legacy_hired').toBe(true);
    expect.soft('legacy_hired' in (bodyOf(recordRun(P, Q.legacy, t)) ?? {}), 'a panel member does not').toBe(false);
    // employee_id: R only, and only the row's own.
    const r = ok(rec(R_, Q.employed, t), 'R on employed');
    expect.soft(r['employee_id'], 'R sees the row\'s employee_id').toBe(EMPLOYEE_ID);
    for (const [kind, who] of [['HM', HM], ['P', P]] as [Kind, Caller][]) {
      const a = ok(rec(who, Q.employed, t), `${kind} on employed`);
      expect.soft('employee_id' in a || JSON.stringify(a).includes(EMPLOYEE_ID), `${kind}: no employee_id anywhere`).toBe(false);
    }
    expect.soft('employee_id' in ok(rec(R_, Q.legacy, t), 'legacy'), 'a legacy hire has no employee_id').toBe(false);
    const sent = { query: { employee_id: 'emp_FROMTHEQUERYAAAAAAAAAAAAA' }, headers: { 'x-employee-id': 'emp_FROMAHEADERAAAAAAAAAAAAA' }, body: { employee_id: 'emp_FROMTHEBODYAAAAAAAAAAAAAA' } };
    const tried = ok(rec(R_, Q.full, t, sent), 'employee ids sent');
    expect.soft('employee_id' in tried, 'a request employee_id on a row with none: still none').toBe(false);
    expect.soft(ok(rec(R_, Q.employed, t, sent), 'employed with ids sent')['employee_id'], 'on a row with one: the row\'s own').toBe(EMPLOYEE_ID);
    expect.soft(JSON.stringify(tried), 'no sent id is echoed').not.toMatch(/FROMTHE|FROMAHEADER/);
    for (const x of runs) expect.soft((awsOf(x) as any[]).filter((c) => /employee/i.test(String(c.table ?? ''))).length, 'no call to an employees table').toBe(0);
    expect.soft(bodyOf(recordRun(R_, Q.employed, t))?.added_by, 'a row with no added_by: none').toBeUndefined();
  });

  // ---------------------------------------------------------------- AC-16 (the record half)

  test('AC-16 The record is written once in api/openapi.yaml: CandidateRecord and NextStep closed, every answer described; the validator fails a planted answer', async ({}, testInfo) => {
    once(testInfo.project.name);
    const d = doc();
    const op = operation(d, ROUTE);
    expect(op, 'GET /v1/candidates/{id} is in the file').toBeTruthy();
    expect.soft(refName(answerSchema(d, ROUTE, 200)), 'its 200 is CandidateRecord').toBe('CandidateRecord');
    for (const s of [403, 404, 500]) expect.soft(!!answerSchema(d, ROUTE, s), `the ${s} answer is described`).toBe(true);
    const cr = d.components?.schemas?.['CandidateRecord'];
    expect.soft(cr?.additionalProperties, 'CandidateRecord is closed').toBe(false);
    const props = Object.keys(cr?.properties ?? {});
    expect.soft(sorted(props), 'CandidateRecord has exactly the kept old fields, the new fields, settingVersions and the fields of child lock rec-15c.2').toEqual(sorted([...KEPT_OLD, ...NEW_FIELDS, 'settingVersions', ...OLD_CHECK_FIELDS]));
    for (const [k, type] of Object.entries(READ_BY_OLD_CHECKS)) expect.soft(cr?.properties?.[k]?.type, `CandidateRecord.${k} is a ${type} (child lock rec-15c.2)`).toBe(type);
    for (const k of ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'salary', 'offer', 'idNumber', 'criteria', 'reason_note', 'idempotencyKey']) expect.soft(props.includes(k), `CandidateRecord has no ${k}`).toBe(false);
    expect.soft(sorted(cr?.required ?? []), 'the fields every caller always gets are required (D-T-C12)').toEqual(sorted(['id', 'candidateId', ...FOR_ALL]));
    expect.soft(cr?.properties?.next_step?.$ref ?? cr?.properties?.next_step?.allOf?.[0]?.$ref ?? cr?.properties?.next_step?.oneOf?.find((x: any) => x.$ref)?.$ref, 'next_step is a NextStep').toBe('#/components/schemas/NextStep');
    const optional = props.filter((p) => !(cr?.required ?? []).includes(p));
    expect.soft(looseObjects(d, { $ref: '#/components/schemas/CandidateRecord' }, 'CandidateRecord', new Set(), [...optional, ...Object.keys(LOCK_V1), 'RETENTION']), 'every object closed').toEqual([]);
    const ns = d.components?.schemas?.['NextStep'];
    expect.soft([ns?.additionalProperties, sorted(ns?.required ?? []), sorted(Object.keys(ns?.properties ?? {}))], 'NextStep is closed: from, to, blocker, all required').toEqual([false, ['blocker', 'from', 'to'], ['blocker', 'from', 'to']]);
    const ck = checker(d);
    const ok200 = answerSchema(d, ROUTE, 200);
    const good = {
      id: 'c', candidateId: 'c', firstName: 'A', lastName: 'B', stage: 'INTERVIEW', role_id: 'r', role_title: 'T', level: 'MID', applied_at: NOW_TEXT, can_move: true, can_decide: false,
      due_at: NOW_TEXT, sla_status: 'ON_TRACK', stage_entered_at: NOW_TEXT, next_step: { from: 'INTERVIEW', to: 'OFFER', blocker: { code: 'INTERVIEWS_INCOMPLETE', done: 1, total: 2 } },
      interviews_done: 1, interviews_required: 2, legacy_hired: false,
    };
    expect.soft(ck.check(ok200, good), 'a right answer passes').toEqual([]);
    expect.soft(ck.check(ok200, { ...good, next_step: null, interviews_done: null, interviews_required: null, due_at: null, sla_status: null, role_id: null }), 'nulls where the rules allow them pass').toEqual([]);
    const { due_at: _d, sla_status: _s, stage_entered_at: _e, next_step: _n, interviews_done: _i, interviews_required: _q, legacy_hired: _l, ...panel } = good;
    expect.soft(ck.check(ok200, panel), 'a panel member\'s answer passes').toEqual([]);
    const bad: [string, unknown][] = [
      ['an extra key', { ...good, PK: 'CANDIDATE#c' }], ['salary', { ...good, salary: 1 }], ['an offer', { ...good, offer: {} }],
      ['a sentence on the blocker', { ...good, next_step: { ...good.next_step, blocker: { ...good.next_step.blocker, message: 'Two interviews to go' } } }],
      ['another blocker code', { ...good, next_step: { ...good.next_step, blocker: { code: 'NOT_READY', done: 1, total: 2 } } }],
      ['an old stage name', { ...good, stage: 'INTERVIEWING' }], ['the stored slaStatus word', { ...good, sla_status: 'BREACHED' }],
      ['no can_move', (() => { const { can_move: _x, ...o } = good; return o; })()], ['can_decide as text', { ...good, can_decide: 'yes' }],
      ['next_step with a next field', { ...good, next_step: { ...good.next_step, label: 'Move to Offer' } }],
    ];
    for (const [label, v] of bad) expect.soft(ck.check(ok200, v).length > 0, `${label} fails`).toBe(true);
    expect.soft(ck.check(answerSchema(d, ROUTE, 500), SERVER_ERROR), 'the 500 body passes').toEqual([]);
    expect.soft(ck.check(answerSchema(d, ROUTE, 500), { message: 'Failed to retrieve candidate' }).length > 0, 'today\'s 500 body fails').toBe(true);
    expect.soft(ck.check(answerSchema(d, ROUTE, 404), NOT_FOUND), 'the 404 body passes').toEqual([]);
    const types = readFileSync(join(REPO, 'pepla-web', 'src', 'app', 'core', 'api', 'openapi.d.ts'), 'utf8');
    for (const n of ['CandidateRecord', 'NextStep']) expect.soft(new RegExp(`\\b${n}:\\s*\\{`).test(types), `openapi.d.ts has ${n} (npm run api:types)`).toBe(true);
  });

  // ---------------------------------------------------------------- AC-17 (step C's lines) and spec check C-3

  test('AC-17 Every AWS call the record makes, for every caller and fixture, is one getCandidate\'s role may make; Terraform gives exactly those three reads, the table names, no wildcard, no new role or KMS line', async ({}, testInfo) => {
    once(testInfo.project.name);
    // The calls, over every caller kind and fixture (the fake does not enforce IAM; spec check C-3).
    const t = world();
    const all = new Set<string>();
    for (const [who, ids] of [[R_, Object.values(Q).filter((x) => x !== Q.bCand)], [HM, [Q.full, Q.ready, Q.offer]], [P, [Q.full, Q.employed]], [C.recruiterB, [Q.bCand]]] as [Caller, string[]][]) {
      for (const id of ids) {
        const r = recordRun(who, id, t);
        for (const c of awsOf(r) as any[]) all.add(`${c.service} ${c.op} ${c.table ?? ''}${c.input?.IndexName ? ' index ' + c.input.IndexName : ''}`);
        expect.soft(notAllowed(r), `${who.name} on ${nameOf(id)}: only granted calls`).toEqual([]);
      }
    }
    expect.soft([...all].sort(), 'the record reads the candidate, its interviews, the settings, the role and the departments (and nothing else)').toEqual(expect.arrayContaining([
      `dynamodb GetItem ${TABLE.state}`, `dynamodb Query ${TABLE.state}`, `dynamodb Query ${TABLE.config} index GSI1-active-configs`, `dynamodb GetItem ${ROLES_TABLE}`, `dynamodb GetItem ${TENANTS}`,
    ]));
    // Terraform.
    const fn = lambdaNamed('getCandidate')[0];
    expect(fn, 'getCandidate is a Lambda in Terraform').toBeTruthy();
    const env = settingsOf(fn!.block);
    expect.soft([valueOf(fn!.stack, env.get('ROLES_TABLE_NAME')), valueOf(fn!.stack, env.get('CONFIG_TABLE_NAME'))], 'getCandidate gets ROLES_TABLE_NAME and CONFIG_TABLE_NAME').toEqual(['talent-flow-roles', 'talent-flow-config']);
    expect.soft(roleResourceOf(fn!.block), 'it keeps its own role').toBe('get_candidate');
    const baseline = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-15c', 'iam-7048cb9', 'policies.json'), 'utf8')) as Record<string, { role: string; stack: string; pairs?: string[]; squash?: string }>;
    const now = policyLines();
    const ROLES = String.raw`(talent-flow-roles|\$\{local\.tf_table_roles\})`;
    const CONFIG = String.raw`(talent-flow-config|\$\{local\.tf_table_config\})`;
    const arn = (table: string, tail = '') => String.raw`(arn:aws:dynamodb:af-south-1:[^:\s]+:table\/${table}${tail})`;
    const WANT = [
      new RegExp(String.raw`^Allow dynamodb:GetItem (aws_dynamodb_table\.talent_flow_roles\.arn|${arn(ROLES)}) null$`),
      new RegExp(String.raw`^Allow dynamodb:GetItem (aws_dynamodb_table\.talent_flow_config\.arn|${arn(CONFIG)}) null$`),
      new RegExp(String.raw`^Allow dynamodb:Query (\$\{aws_dynamodb_table\.talent_flow_config\.arn\}\/index\/GSI1-active-configs|${arn(CONFIG, String.raw`\/index\/GSI1-active-configs`)}) null$`),
    ];
    const KEY = 'talent-flow-infra/get_candidate';
    for (const k of new Set([...Object.keys(baseline), ...Object.keys(now)])) {
      const was = new Set(baseline[k]?.pairs ?? [`squashed ${baseline[k]?.squash}`]);
      const is = new Set(now[k]?.pairs ?? [`squashed ${now[k]?.squash}`]);
      const gained = [...is].filter((l) => !was.has(l));
      const lost = [...was].filter((l) => !is.has(l));
      if (!baseline[k]) {
        expect.soft(now[k]?.role, `${k}: a new policy is not on getCandidate's role (D-T-C11: the lines go in aws_iam_role_policy.get_candidate)`).not.toBe('get_candidate');
        if (now[k]?.role !== 'get_candidate') expect.soft(gained.filter((l) => !isRec07Grant(l, k) && !isRec05Grant(l, k) && !isRec15dGrant(l, k)), `${k}: no new grant`).toEqual([]); // && isRec15dGrant: child lock rec-15d.1
        continue;
      }
      if (k === KEY) {
        expect.soft(gained.filter((l) => !WANT.some((w) => w.test(l))), 'getCandidate gains only the three reads (D-T-C11)').toEqual([]);
        expect.soft(WANT.map((w) => gained.filter((l) => w.test(l)).length), 'each of the three, once').toEqual([1, 1, 1]);
        expect.soft(lost, 'getCandidate loses nothing').toEqual([]);
      } else {
        expect.soft(gained.filter((l) => !isRec07Grant(l, k) && !isRec05Grant(l, k) && !isRec15dGrant(l, k)), `${k}: no new grant`).toEqual([]); // && isRec15dGrant: child lock rec-15d.1
      }
    }
    const mine = Object.entries(now).filter(([, v]) => v.role === 'get_candidate').flatMap(([, v]) => v.pairs ?? []);
    for (const l of mine) if (/ (dynamodb|kms):/.test(l)) expect.soft(l.split(' ')[2], `${l}: no wildcard`).not.toMatch(/^\*$|table\/\*|index\/\*|\*$/);
    for (const name of ['talent_flow_roles', 'talent_flow_config']) {
      const tb = resourcesOf('talent-flow-infra', 'aws_dynamodb_table').find((b) => b.labels[1] === name);
      expect.soft(/kms_key_arn\s*=\s*aws_kms_key\.talent_flow_state\.arn/.test(tb?.body ?? ''), `${name} is encrypted with the state key getCandidate already holds`).toBe(true);
    }
    expect.soft(mine.some((l) => /^Allow (local\.tf_kms_actions|kms:Decrypt) aws_kms_key\.talent_flow_state\.arn null$/.test(l)), 'it keeps the state key').toBe(true);
    const readList = kmsList('dynamodb_read_role_arns');
    expect.soft((readList.match(/talent-flow-role-getCandidate"/g) ?? []).length, 'getCandidate is in the PII key\'s read list exactly once (no KMS line added twice)').toBe(1);
    expect.soft(/talent-flow-role-getCandidate"|get_candidate\.arn/.test(kmsList('allowed_role_arns')), 'and never in the encrypt list').toBe(false);
    for (const stack of ['infra', 'talent-flow-infra'] as const) expect.soft(resourcesOf(stack, 'aws_dynamodb_table_item').length, `${stack}: no table item`).toBe(0);
    expect.soft(resourcesOf('talent-flow-infra', 'aws_iam_role').filter((b) => /tf_lambda_get_candidate\}|role-getCandidate"|for getCandidate Lambda/.test(b.body)).map((b) => b.labels[1]), 'no second role for getCandidate').toEqual(['get_candidate']);
    // The handler file and its module check stay (mod-01 reads them as text).
    const src = readFileSync(join(REPO, 'lambda', 'getCandidate', 'index.js'), 'utf8');
    expect.soft(/requireModule/.test(src) && /modules\.mjs/.test(src), 'lambda/getCandidate/index.js keeps requireModule from modules.mjs').toBe(true);
  });

  // ---------------------------------------------------------------- standing line 11: the new reads on pepla-dev

  test('AC-17 on pepla-dev: the Recruiter opens a seeded candidate through the new reads (roles table, settings index), in the new shape; the manager login and company B get 404 @pepla-dev', async ({ page }, testInfo) => {
    // Runs in the dev workflow's "Company walk (TEN-04)" step, where E2E_HR_B is the walk company with Recruitment on (cards/rec-15c.md).
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-10 to AC-17.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(4 * 60_000);
    const env = (k: string) => process.env[k] ?? '';
    const login = (p: string) => ({ email: env(`${p}_EMAIL`), password: env(`${p}_PASSWORD`) });
    const logins = { hr: login('E2E_HR'), manager: login('E2E_MANAGER'), companyB: login('E2E_HR_B') };
    for (const [who, l] of Object.entries(logins)) expect(l.email && l.password, `the ${who} test login is set`).toBeTruthy();
    const { devEnv } = await import('./support/ten-02/dev');
    const { region, clientId } = devEnv();
    const oldEnv = join(REPO, 'hr-portal', 'src', 'environments', 'environment.ts');
    const tfApi = (/talentFlow\s*:\s*\{[^}]*?apiUrl\s*:\s*['"`]([^'"`]+)['"`]/s.exec(existsSync(oldEnv) ? readFileSync(oldEnv, 'utf8') : '')?.[1] ?? '').replace(/\/+$/, '').replace(/\/v1$/, '');
    expect(tfApi, 'the TalentFlow API address is written for pepla-dev').toMatch(/^https:\/\/[^/]+\.execute-api\./);
    const signIn = async (l: { email: string; password: string }) => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: l.email, PASSWORD: l.password } }),
      });
      expect(r.status(), 'signs in at Cognito').toBe(200);
      return ((await r.json()) as any).AuthenticationResult.IdToken as string;
    };
    const [hr, manager, companyB] = await Promise.all([signIn(logins.hr), signIn(logins.manager), signIn(logins.companyB)]);
    // The seed's Tendai Ncube: Fleet controller (MID), not the manager login's role (scripts/ci/seed-dev.py, REC04_CANDIDATES).
    const id = 'CAND-SEEDREC040000000000004';
    const r = await page.request.get(`${tfApi}/v1/candidates/${id}`, { headers: { Authorization: `Bearer ${hr}` } });
    const text = await r.text();
    expect(r.status(), `the Recruiter opens the seeded candidate (a 500 here is a missing grant or key line: ${text.slice(0, 200)})`).toBe(200);
    const a = JSON.parse(text) as Record<string, any>;
    expect.soft(INTERNAL.filter((k) => k in a), 'no internal key').toEqual([]);
    expect.soft(a['role_title'], 'the role\'s title, read from the roles table').toBe('Fleet controller');
    expect.soft(misfit({ response: { statusCode: 200, body: text } } as any), 'the answer passes api/openapi.yaml').toEqual([]);
    expect.soft(['boolean', 'boolean'], 'can_move and can_decide are there').toEqual([typeof a['can_move'], typeof a['can_decide']]);
    expect.soft('interviews_required' in a && 'next_step' in a, 'the settings were read (interviews_required and next_step are there)').toBe(true);
    for (const [who, token] of [['the manager login (not this role\'s manager)', manager], ['company B\'s HR', companyB]] as const) {
      const x = await page.request.get(`${tfApi}/v1/candidates/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      expect.soft(x.status(), `${who}: 404`).toBe(404);
    }
  });
});

const NOW_TEXT = '2026-11-23T12:00:00.000Z';
