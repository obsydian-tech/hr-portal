import { execFileSync } from 'node:child_process';
import { isRec062Grant, isRec09Policy } from './support/rec-09.1/grants'; // child lock rec-09.1 (REC-09), on top of rec-06.2.1
import { isRec16Role } from './support/rec-16.1/grants'; // child lock rec-16.1
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO, type Tables } from './support/rec-04/lambda-harness';
import { STACKS, filesOf, kmsList, lambdaNamed, policyLines, resourcesOf, roleInfo, roleResourceOf, settingsOf, squash, valueOf, type Stack } from './support/rec-04/iam';
import { attributes, blocks } from './support/infra-harness';
import { ask, av, bodyOf, describe, isModulesRead, plain, rowsOf, statusOf } from './support/rec-04/world';
import { C } from './support/rec-04/callers';
import { DEP } from './support/rec-14/world';
import {
  A, B, CORE, FLEET_OPEN, FLEET_SLA, FLEET_STAGE, HANDLER, INDEX, K, OPEN, P, R, ROLES_TABLE, ROLE_ROUTES, ROUTE, SEED, SEED_RUN, SUB, TABLE, TITLE,
  anyWrite, awsOf, call, candidates, changedRows, close, fullName, handlerFolderFiles, list, logsOf, newKey, one, open, roleOf, rolesIn, sagaOf, withMany, world,
} from './support/rec-04/roles';
import { isRec07Grant } from './support/rec-07.1/grants';
import { isRec05Grant } from './support/rec-05.1/grants'; // child lock rec-05.1
import { isRec15bGrant } from './support/rec-15b.1/grants';
import { isRec15cGrant } from './support/rec-15c.1/grants'; // child lock rec-15c.1
import { isRec15dGrant } from './support/rec-15d.1/grants'; // child lock rec-15d.1
import { isInt01Grant } from './support/int-01.1/grants'; // child lock int-01.1

/**
 * REC-04 · Open roles: a role record, and the candidates of a role (Jira NH-238, epic NH-234). Amber.
 * One test per acceptance criterion this lock covers, written from the card before any code. Spec: /mnt/project-files/onboarding-cards/specs/REC-04.md,
 * read with REC-00.md and the contract table of REC-UI-01.md. Notes: cards/rec-04.md and onboarding-cards/specs/REC-04-tests-for-review.md (the bar).
 *
 * Scope (coordinator, 22 Nov 2026, logged in process/PIPELINE-DECISIONS.md): this lock covers AC-1, AC-2, AC-4, AC-6, AC-8, AC-9 and AC-10 of
 * the card. AC-3 (PATCH /v1/roles/{id}), AC-5 (createCandidate needs a role) and AC-7 (the attach script) move to card REC-13 with their tests.
 * The same decision moves the role routes to the TalentFlow API (next to the candidate routes) and adds the app-side fix the hiring board
 * needs on dev (the app reaches the TalentFlow API; its CORS lets the dev web address in), checked in AC-8 and on dev in AC-10.
 *
 * The Lambda tests run the real handlers and shared files, each call in a fresh Node process, against a fake AWS (support/rec-04/fake-aws,
 * REC-03's copy with the roles table's key added). Companies A and B both hold the Standard pack (written by the real pack script); the card's
 * rows are in support/rec-04/roles.ts. AC-8 reads Terraform, the app and the CI files as text. The seed part of AC-10 runs the real seed function
 * of scripts/ci/seed-dev.py against an in-memory table (support/rec-04/seed-run.py, no AWS). The pepla-dev part of AC-10 runs on pepla-dev
 * only (@pepla-dev). Nothing calls AWS or any AI.
 *
 * Pinned by the verifier where the card is silent (each is in cards/rec-04.md for the BA to confirm, D-T-1 to D-T-12):
 *  - D-T-1 The four role routes are served by one Lambda, lambda/manageRoles, routed by the route key (as REC-02's recordNotHired); its core is
 *    lambda/shared/recruitment-actions/roles.mjs (REC-00 rule 4).
 *  - D-T-2 The role table is `talent-flow-roles` in talent-flow-infra (keys pk, sk), encrypted with the state table's key, point in time
 *    recovery on, pay per request; the Lambda reads its name from ROLES_TABLE_NAME. The candidate index is `role-id-index` on the state table
 *    (hash key role_id).
 *  - D-T-3 `criteria` in POST /v1/roles is a list of { key, label } or a list of text (as the Open a role page sends it): a text that is one of
 *    the company's default criteria keys takes its default label; any other text becomes the label. Stored as [{ key, label }].
 *  - D-T-4 POST /v1/roles without an Idempotency-Key header is 400 IDEMPOTENCY_KEY_REQUIRED. A key is one company's (TEN-02): the same key from
 *    the same company gives back the first answer and writes nothing; another company never gets that answer.
 *  - D-T-5 A field error is 400 { error: 'Bad request', code: 'INVALID_FIELD', field: <the field> }. A title or department of only spaces is
 *    blank. The hiring manager error is 400 { error: 'Bad request', code: 'INVALID_HIRING_MANAGER' }, the same words for every reason.
 *  - D-T-6 The stored SLA words read as the screens' words: ON_TRACK stays, AT_RISK is DUE_SOON, BREACHED is OVERDUE. A role's overdue_count
 *    and due_soon_count count its open candidates in each.
 *  - D-T-7 GET /v1/roles with no status lists open and closed roles; `status=OPEN` or `status=CLOSED` filters.
 *  - D-T-8 A manager who is not a Recruiter lists and reads only the roles whose hiring_manager_id is their person id (REC-01 callerId); any
 *    other role is 404.
 *  - D-T-9 GET /v1/candidates?role_id= lists the role's candidates of the caller's company (a manager: only their own, as today), Not hired
 *    left out unless stage=NOT_HIRED is asked for; each with id, name, stage (one of the six codes), role_id, level, sla_status and
 *    stage_entered_at. `counts` { all, mine, overdue, due_soon, not_hired } count the role's candidates whatever the stage, sla_status, search
 *    and mine filters say (all = every one not Not hired). `search` matches the name whatever the case. `mine=true` lists counts.mine rows,
 *    all of them on the default list. A role of another company, or no role at all, is 200 { candidates: [], counts all 0 }: the same answer;
 *    getCandidates reads the role row (ROLES_TABLE_NAME, GetItem) to know the role is the caller's company's.
 *  - D-T-10 The dev seed is seed_rec04(ddb, tenant_id, manager_sub) in scripts/ci/seed-dev.py, called by main(). It writes the roles and the
 *    candidates REC-UI-01 AC-13 reads (cards/rec-ui-01.md), with fixed ids, again on every run, and puts them back to the seeded stage.
 *  - D-T-11 The app's TalentFlow address is `talentFlowApiUrl` in pepla-web's environment (a .invalid placeholder in the repo; CI writes the real
 *    one in scripts/ci/dev-frontend-env.sh). Every Hire call of features/recruitment goes to it.
 *  - D-T-12 Closing a closed role is 200 with the stored closed_at and closed_by, and writes nothing.
 *  - D-T-13 manageRoles' role goes on the PII key's read list (infra/kms.tf) in a second merge, after the role exists (REC-02's order).
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const FORBIDDEN = { error: 'Forbidden' };
const NOT_FOUND = { error: 'Not found' };
const bad = (code: string, field?: string) => ({ error: 'Bad request', code, ...(field ? { field } : {}) });
const BAD_HM = bad('INVALID_HIRING_MANAGER');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const answer = (r: any) => [statusOf(r), bodyOf(r)];
const ids = (rows: any[] | undefined) => (rows ?? []).map((x: any) => x?.role_id ?? x?.id).sort();
const sorted = (a: string[]) => [...a].sort();
/** Candidate ids of a candidate list (its rows carry role_id too). */
const cids = (rows: any[] | undefined) => (rows ?? []).map((x: any) => x?.id).sort();
const NO_ROLE_WRITE = (label: string, before: Tables, r: any) => {
  expect.soft(JSON.stringify(r.tables[ROLES_TABLE] ?? []), `${label}: the roles table does not change`).toBe(JSON.stringify(before[ROLES_TABLE] ?? []));
  expect.soft(changedRows(before, r.tables).filter((x) => !/idempotency/.test(x['table'])).map((x) => `${x['table']} ${x['pk'] ?? x['PK']} ${x['sk'] ?? x['SK']}`), `${label}: nothing is written`).toEqual([]);
};
/** The pack's settings of a company, plain. */
const pack = (t: Tables, c: string, type: string) => rowsOf(t, TABLE.config).find((x) => x['PK'] === `TENANT#${c}` && String(x['SK']).startsWith(`CONFIG#${type}#`) && x['isActive'] !== false)?.['data'];
// REC-14 step B (child lock rec-04.2): a role is opened with the id of one of the company's departments (support/rec-14/world.ts DEP), not free text.
const GOOD = { job_title: 'Night dispatcher', department_id: DEP.opsA.id, level: 'MID', hiring_manager_id: SUB.hmA };

/** JavaScript with comments blanked out; strings kept (as rec-03.spec.ts). */
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

/** Runs the seed's REC-04 part against an in-memory world (support/rec-04/seed-run.py). */
function runSeed(tables: Record<string, any[]>, tenant: string, manager: string): { tables?: Record<string, any[]>; calls?: any[]; error?: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rec-04-seed-'));
  const file = join(dir, 'world.json');
  writeFileSync(file, JSON.stringify({ tables }));
  const out = execFileSync('python3', ['-I', SEED_RUN, SEED, file, tenant, manager], { encoding: 'utf8', timeout: 60_000, cwd: dir });
  const line = out.split('\n').find((l) => l.startsWith('@@REC04@@'));
  if (!line) throw new Error(`the seed run printed no result:\n${out.slice(-1500)}`);
  return JSON.parse(line.slice('@@REC04@@'.length));
}

// ---------------------------------------------------------------- tests

test.describe('REC-04 · Open roles: a role record, and the candidates of a role', () => {
  test('Control: the world is good: the candidates read, B cannot read A, the pack is there, the seed file loads', async ({}, testInfo) => {
    once(testInfo.project.name);
    const t = world();
    const own = ask('getCandidate', C.recruiter, { path: { id: K.applied } }, { tables: t });
    expect.soft(statusOf(own), `A's Recruiter reads A's candidate (${describe(own)})`).toBe(200);
    const other = ask('getCandidate', C.recruiterB, { path: { id: K.applied } }, { tables: t });
    expect.soft(statusOf(other), 'B\'s Recruiter gets 404 for A\'s candidate').toBe(404);
    const all = ask('getCandidates', C.recruiter, {}, { tables: t });
    expect.soft(statusOf(all), `the candidate list runs (${describe(all)})`).toBe(200);
    expect.soft(pack(t, A, 'SCORING_WEIGHTS')?.defaultCriteria?.length, 'company A has default criteria from the Standard pack').toBeGreaterThan(0);
    expect.soft(pack(t, B, 'PANEL_CONFIG')?.panelSize, 'company B has panel sizes from the Standard pack').toBeTruthy();
    expect.soft(rolesIn(t).length, 'the world holds five roles').toBe(5);
    const s = runSeed({ 'talent-flow-roles': [], 'talent-flow-state': [] }, 'ten_seedaaaaaaaaaaaaaaaaaaaa', 'sub-manager-login');
    expect.soft(s.error ?? '', 'seed-dev.py loads with no AWS (only a missing seed_rec04 may be reported)').not.toMatch(/^(?!.*seed_rec04).+/);
  });

  // ---------------------------------------------------------------- AC-1

  test('AC-1 Open a role: a Recruiter opens one with the card\'s fields; defaults from settings; each invalid field and a hiring manager not of the company is 400 with nothing written', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(6 * 60_000);
    const t = world();
    // A full body: 201, the row as rule 1 gives it, the company and opener from the sign-in.
    const crit = [{ key: 'technical', label: 'Technical' }, { key: 'safety', label: 'Road safety' }];
    const r = open(C.recruiter, { ...GOOD, criteria: crit, panel_size: 4, tenant_id: B, tenantId: B, status: 'CLOSED', opened_by: 'someone-else' }, t);
    expect.soft(statusOf(r), `a Recruiter opens a role: 201 (${describe(r)})`).toBe(201);
    const b = bodyOf(r) ?? {};
    const made = rolesIn(r.tables).filter((x) => !rolesIn(t).some((y) => y['sk'] === x['sk']));
    expect.soft(made.length, 'one new role row').toBe(1);
    const row = made[0] ?? {};
    expect.soft(b['role_id'], 'the answer carries the new role_id').toBe(row['role_id']);
    expect.soft(String(row['role_id'] ?? ''), 'the role id is not empty').toMatch(/\S{6,}/);
    expect.soft([row['pk'], row['sk'], row['tenant_id']], 'keyed and stamped with the caller\'s company, never the body\'s').toEqual([`TENANT#${A}`, `ROLE#${row['role_id']}`, A]);
    expect.soft([row['job_title'], row['department_id'], row['department'], row['level'], row['hiring_manager_id'], row['panel_size'], row['status']], 'the fields as sent (the department as its id and its name); status OPEN whatever the body says')
      .toEqual(['Night dispatcher', DEP.opsA.id, 'Operations', 'MID', SUB.hmA, 4, 'OPEN']);
    expect.soft(row['criteria'], 'the criteria as sent').toEqual(crit);
    expect.soft([String(row['opened_at'] ?? ''), row['opened_by']], 'opened when and by the sign-in\'s person').toEqual([expect.stringMatching(ISO), SUB.recA]);
    expect.soft(row['legacy'] === true, 'a new role is not legacy').toBe(false);
    expect.soft([b['job_title'], b['status'], b['level']], 'the answer is the role').toEqual(['Night dispatcher', 'OPEN', 'MID']);
    expect.soft(rolesIn(r.tables).filter((x) => x['tenant_id'] === B).length, 'nothing is written for company B').toBe(1);

    // Defaults from the company's settings (rule 1): the default criteria and the level's panel size.
    const dflt = (pack(t, A, 'SCORING_WEIGHTS')?.defaultCriteria ?? []) as { key: string; label: string }[];
    const panel = pack(t, A, 'PANEL_CONFIG')?.panelSize ?? {};
    for (const level of ['JUNIOR', 'SENIOR']) {
      const d = open(C.recruiter, { ...GOOD, level }, t);
      const dr = roleOf(d.tables, bodyOf(d)?.role_id) ?? {};
      expect.soft(statusOf(d), `${level}, no criteria or panel size: 201 (${describe(d)})`).toBe(201);
      expect.soft(dr['criteria'], `${level}: the criteria are the company's default`).toEqual(dflt.map((c) => ({ key: c.key, label: c.label })));
      expect.soft(dr['panel_size'], `${level}: the panel size is the level's from PANEL_CONFIG`).toBe(panel[level]);
    }
    // D-T-3: criteria as text, as the page sends them.
    const txt = open(C.recruiter, { ...GOOD, criteria: ['technical', 'communication', 'Forklift licence'] }, t);
    const tr = roleOf(txt.tables, bodyOf(txt)?.role_id) ?? {};
    expect.soft(statusOf(txt), `criteria as text: 201 (${describe(txt)})`).toBe(201);
    expect.soft((tr['criteria'] ?? []).map((c: any) => c.label), 'a default key takes its label; another text becomes the label').toEqual(['Technical', 'Communication', 'Forklift licence']);
    expect.soft(new Set((tr['criteria'] ?? []).map((c: any) => c.key)).size, 'the keys are different').toBe(3);
    expect.soft((tr['criteria'] ?? []).every((c: any) => typeof c.key === 'string' && c.key.length > 0), 'every criterion has a key').toBe(true);
    // The edges that are allowed.
    const ten = Array.from({ length: 10 }, (_, i) => ({ key: `c${i}`, label: `Criterion ${i}` }));
    for (const [what, body] of [
      ['a 120-character title', { ...GOOD, job_title: 'T'.repeat(120) }],
      ['ten criteria', { ...GOOD, criteria: ten }], ['a 60-character label', { ...GOOD, criteria: [{ key: 'x', label: 'L'.repeat(60) }] }],
      ['panel size 1', { ...GOOD, panel_size: 1 }], ['panel size 12', { ...GOOD, panel_size: 12 }], ['a hiring manager with the Recruitment tick', { ...GOOD, hiring_manager_id: P.tickA }],
    ] as const) {
      const e = open(C.recruiter, body, t);
      expect.soft(statusOf(e), `${what}: 201 (${describe(e)})`).toBe(201);
    }

    // Each invalid field: 400 with the field's code, nothing written (D-T-5).
    const eleven = Array.from({ length: 11 }, (_, i) => ({ key: `c${i}`, label: `Criterion ${i}` }));
    const { job_title: _jt, ...noTitle } = GOOD; const { level: _l, ...noLevel } = GOOD;
    const cases: [string, unknown, string][] = [
      ['no title', noTitle, 'job_title'], ['a blank title', { ...GOOD, job_title: '' }, 'job_title'], ['a title of spaces', { ...GOOD, job_title: '   ' }, 'job_title'],
      ['a 121-character title', { ...GOOD, job_title: 'T'.repeat(121) }, 'job_title'], ['a title that is a number', { ...GOOD, job_title: 42 }, 'job_title'],
      // REC-14 step B (rec-04.2): the department is an id now; every bad one is INVALID_DEPARTMENT, judged in rec-14.2.spec.ts AC-6.
      ['no level', noLevel, 'level'], ['a level not in the company\'s list', { ...GOOD, level: 'LEAD' }, 'level'], ['a level in lower case', { ...GOOD, level: 'mid' }, 'level'],
      ['11 criteria', { ...GOOD, criteria: eleven }, 'criteria'], ['no criteria at all (an empty list)', { ...GOOD, criteria: [] }, 'criteria'],
      ['two criteria with one key', { ...GOOD, criteria: [{ key: 'a', label: 'One' }, { key: 'a', label: 'Two' }] }, 'criteria'],
      ['a blank criterion label', { ...GOOD, criteria: [{ key: 'a', label: '' }] }, 'criteria'], ['a 61-character label', { ...GOOD, criteria: [{ key: 'a', label: 'L'.repeat(61) }] }, 'criteria'],
      ['criteria that are not a list', { ...GOOD, criteria: 'technical' }, 'criteria'],
      ['panel size 0', { ...GOOD, panel_size: 0 }, 'panel_size'], ['panel size 13', { ...GOOD, panel_size: 13 }, 'panel_size'], ['panel size 2.5', { ...GOOD, panel_size: 2.5 }, 'panel_size'],
      ['panel size as text', { ...GOOD, panel_size: '3' }, 'panel_size'],
    ];
    for (const [what, body, field] of cases) {
      const e = open(C.recruiter, body, t);
      expect.soft(answer(e), `${what}: 400 INVALID_FIELD ${field}`).toEqual([400, bad('INVALID_FIELD', field)]);
      NO_ROLE_WRITE(what, t, e);
    }
    const notJson = call(ROUTE.open, C.recruiter, { body: '{not json', headers: { 'idempotency-key': newKey() } }, t);
    expect.soft(statusOf(notJson), 'a body that is not JSON: 400').toBe(400);
    NO_ROLE_WRITE('a body that is not JSON', t, notJson);

    // The hiring manager must be one of the company's people the picker lists (D-REC-4.1); every other is the same 400, with no hint why.
    const hmBodies: string[] = [];
    for (const [what, hm] of [
      ['company B\'s manager', SUB.hmB], ['an employee of A', P.employeeA], ['a manager of A not yet confirmed', P.unconfirmedA],
      ['a manager in the sign-in pool with no place in company A', P.noMemberHm], ['a person nobody knows', 'sub-nobody-at-all'], ['no hiring manager', undefined], ['a hiring manager that is a number', 7],
    ] as const) {
      const e = open(C.recruiter, { ...GOOD, hiring_manager_id: hm }, t);
      expect.soft(answer(e), `${what}: 400 INVALID_HIRING_MANAGER`).toEqual([400, BAD_HM]);
      hmBodies.push(String(e.response?.body ?? ''));
      NO_ROLE_WRITE(what, t, e);
    }
    expect.soft(new Set(hmBodies).size, 'every hiring manager refusal has the same words').toBe(1);
    // B's Recruiter can open B's role with B's manager; A's manager is refused for B.
    const bRole = open(C.recruiterB, { ...GOOD, department_id: DEP.dispatchB.id, hiring_manager_id: SUB.hmB }, t);
    expect.soft(statusOf(bRole), `B's Recruiter opens a role with B's manager (${describe(bRole)})`).toBe(201);
    expect.soft(roleOf(bRole.tables, bodyOf(bRole)?.role_id)?.['pk'], 'it is company B\'s').toBe(`TENANT#${B}`);
    expect.soft(answer(open(C.recruiterB, { ...GOOD, department_id: DEP.dispatchB.id, hiring_manager_id: SUB.hmA }, t)), 'B\'s Recruiter with A\'s manager: 400').toEqual([400, BAD_HM]);

    // Who may open: a Recruiter only. Everyone else 403 before any AWS call.
    for (const who of [C.hmC1, C.oldHm, C.employee, C.adminOnly, C.hrNoTick, C.tickNoHr, C.approver, C.guest, C.taClaim, C.noGroups]) {
      const e = open(who, GOOD, t);
      expect.soft([...answer(e), awsOf(e).length], `${who.name}: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }

    // The request key (D-T-4, standing line 8).
    const none = open(C.recruiter, GOOD, t, null);
    expect.soft(answer(none), 'no Idempotency-Key: 400 IDEMPOTENCY_KEY_REQUIRED').toEqual([400, bad('IDEMPOTENCY_KEY_REQUIRED')]);
    NO_ROLE_WRITE('no Idempotency-Key', t, none);
    const key = newKey();
    const first = open(C.recruiter, GOOD, t, key);
    const again = open(C.recruiter, GOOD, first.tables, key);
    expect.soft(answer(again), 'the same key again gives back the first answer').toEqual(answer(first));
    expect.soft(rolesIn(again.tables).length, 'and writes no second role').toBe(rolesIn(first.tables).length);
    const stranger = open(C.recruiterB, { ...GOOD, department_id: DEP.dispatchB.id, hiring_manager_id: SUB.hmB }, first.tables, key);
    expect.soft(JSON.stringify(bodyOf(stranger) ?? {}), 'company B re-sending A\'s key never gets A\'s role').not.toContain(String(bodyOf(first)?.role_id ?? 'none'));
    expect.soft(roleOf(stranger.tables, bodyOf(first)?.role_id), 'and A\'s role row is unchanged').toEqual(roleOf(first.tables, bodyOf(first)?.role_id));
    expect.soft(rolesIn(stranger.tables).filter((x) => x['tenant_id'] === A).length, 'and no role of A is added').toBe(rolesIn(first.tables).filter((x) => x['tenant_id'] === A).length);
  });

  // ---------------------------------------------------------------- AC-2

  test('AC-2 Reads and who sees what: a Recruiter lists all; the hiring manager only theirs; others 403; B gets 404 on A\'s role; candidate_count counts open candidates of the company only', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const t = world();
    const all = list(C.recruiter, t);
    expect.soft(statusOf(all), `a Recruiter lists roles (${describe(all)})`).toBe(200);
    expect.soft(ids(bodyOf(all)?.roles), 'every role of A, open and closed, and none of B (D-T-7)').toEqual(sorted([R.fleet, R.warehouse, R.accountant, R.closed]));
    expect.soft(ids(bodyOf(list(C.recruiter, t, { status: 'OPEN' }))?.roles), 'status=OPEN: the open ones').toEqual(sorted([R.fleet, R.warehouse, R.accountant]));
    expect.soft(ids(bodyOf(list(C.recruiter, t, { status: 'CLOSED' }))?.roles), 'status=CLOSED: the closed one').toEqual([R.closed]);
    const rowOf = (id: string) => (bodyOf(all)?.roles ?? []).find((x: any) => x.role_id === id) ?? {};
    const f = rowOf(R.fleet);
    expect.soft({ job_title: f.job_title, department: f.department, level: f.level, hiring_manager_id: f.hiring_manager_id, status: f.status, opened_at: f.opened_at },
      'a row carries the role\'s fields').toEqual({ job_title: 'Fleet controller', department: 'Operations', level: 'MID', hiring_manager_id: SUB.hmA, status: 'OPEN', opened_at: '2026-10-12T08:00:00.000Z' });
    // Open candidates only: Applied to Offer (an old stage name counts by its new stage); Hired and Not hired (an old rejection too) do not;
    // company B's candidate that carries A's role id never counts (D-T-6 for the SLA counts).
    expect.soft([f.candidate_count, f.overdue_count, f.due_soon_count], 'Fleet controller: 6 open, 1 overdue, 1 due soon').toEqual([FLEET_OPEN.length, 1, 1]);
    expect.soft([rowOf(R.warehouse).candidate_count, rowOf(R.warehouse).overdue_count, rowOf(R.warehouse).due_soon_count], 'Warehouse supervisor: 2 open, 1 overdue').toEqual([2, 1, 0]);
    expect.soft([rowOf(R.accountant).candidate_count, rowOf(R.closed).candidate_count], 'Senior accountant has none; the closed role\'s Hired one does not count').toEqual([0, 0]);
    expect.soft(rowOf(R.closed).status, 'the closed role says CLOSED').toBe('CLOSED');
    expect.soft(JSON.stringify(bodyOf(all)), 'nothing of company B in A\'s list').not.toMatch(/Dispatch lead|ten_b|role-01REC04DISPATCH/);

    // One role, with criteria and panel size.
    const o = one(C.recruiter, R.fleet, t);
    expect.soft(statusOf(o), `a Recruiter reads one role (${describe(o)})`).toBe(200);
    const ob = bodyOf(o) ?? {};
    expect.soft([ob.role_id, ob.job_title, ob.candidate_count, ob.panel_size, ob.status], 'its fields, count and panel size').toEqual([R.fleet, 'Fleet controller', FLEET_OPEN.length, 3, 'OPEN']);
    expect.soft(ob.criteria, 'and its criteria').toEqual([{ key: 'technical', label: 'Technical' }, { key: 'communication', label: 'Communication' }, { key: 'culturalFit', label: 'Cultural fit' }, { key: 'problemSolving', label: 'Problem solving' }]);
    expect.soft(statusOf(one(C.recruiter, R.closed, t)), 'a closed role reads too').toBe(200);

    // The hiring manager (D-T-8): only their roles, by the sign-in's person id.
    expect.soft(ids(bodyOf(list(C.hmC1, t))?.roles), 'hmA lists Fleet controller and Senior accountant').toEqual(sorted([R.fleet, R.accountant]));
    expect.soft(ids(bodyOf(list(C.hmOther, t))?.roles), 'hm2A lists Warehouse supervisor and the closed role').toEqual(sorted([R.warehouse, R.closed]));
    expect.soft(ids(bodyOf(list(C.hmOther, t, { status: 'OPEN' }))?.roles), 'hm2A, open only').toEqual([R.warehouse]);
    expect.soft(ids(bodyOf(list(C.hmC1, t, {}, {}))?.roles), 'a body or query naming another hiring manager changes nothing').toEqual(ids(bodyOf(call(ROUTE.list, C.hmC1, { query: { hiring_manager_id: SUB.hm2A, hiringManagerId: SUB.hm2A } }, t))?.roles));
    const viaUserId = call(ROUTE.list, { ...C.hmC1, sub: 'sub-new-pool-id' }, { claims: { user_id: SUB.hmA } }, t);
    expect.soft(ids(bodyOf(viaUserId)?.roles), 'the person id is user_id when the sign-in has one').toEqual(sorted([R.fleet, R.accountant]));
    expect.soft(statusOf(one(C.hmC1, R.fleet, t)), 'hmA reads Fleet controller').toBe(200);
    for (const [who, id] of [[C.hmOther, R.fleet], [C.hmC1, R.warehouse], [C.hmC1, R.closed]] as const) {
      expect.soft(answer(one(who, id, t)), `${who.name} on ${TITLE[id]}: 404`).toEqual([404, NOT_FOUND]);
    }

    // Everyone else of A: 403 before any AWS call, on the list and on one role.
    for (const who of [C.employee, C.guest, C.adminOnly, C.hrNoTick, C.tickNoHr, C.panelA, C.approver, C.itOnly, C.noGroups, C.taClaim, C.taPanelMember, C.oldAdmin, C.nearHrStaffx]) {
      for (const r of [list(who, t), one(who, R.fleet, t)]) expect.soft([...answer(r), awsOf(r).length], `${who.name}: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }

    // Company B: its own role only; A's role is 404 by id, also when the request names company A.
    const bl = list(C.recruiterB, t);
    expect.soft(ids(bodyOf(bl)?.roles), 'B\'s Recruiter lists only B\'s role').toEqual([R.b]);
    expect.soft((bodyOf(bl)?.roles ?? [])[0]?.candidate_count, 'B\'s role counts B\'s candidate').toBe(1);
    expect.soft(JSON.stringify(bodyOf(bl)), 'no title of A in B\'s list').not.toMatch(/Fleet controller|Warehouse supervisor|Senior accountant/);
    expect.soft(ids(bodyOf(list(C.managerB, t))?.roles), 'B\'s manager lists only B\'s role').toEqual([R.b]);
    for (const [what, a] of [['plain', {}], ['query tenantId A', { query: { tenantId: A, tenant_id: A } }], ['header x-tenant-id A', { headers: { 'x-tenant-id': A, 'x-tenant': A } }], ['body tenant A', { body: { tenant_id: A } }]] as const) {
      const r = call(ROUTE.one, C.recruiterB, { id: R.fleet, ...a }, t);
      expect.soft(answer(r), `B's Recruiter on A's role (${what}): 404`).toEqual([404, NOT_FOUND]);
      const l = call(ROUTE.list, C.recruiterB, { ...a }, t);
      expect.soft(ids(bodyOf(l)?.roles), `B's Recruiter's list (${what}): B's only`).toEqual([R.b]);
    }
    expect.soft(answer(one(C.managerB, R.fleet, t)), 'B\'s manager on A\'s role: 404').toEqual([404, NOT_FOUND]);
    expect.soft(answer(one(C.recruiter, R.b, t)), 'A\'s Recruiter on B\'s role: 404').toEqual([404, NOT_FOUND]);
    expect.soft(answer(one(C.recruiter, R.none, t)), 'a role nobody has: 404').toEqual([404, NOT_FOUND]);
    for (const r of [list(C.recruiter, t), one(C.recruiter, R.fleet, t), list(C.recruiterB, t)]) expect.soft(anyWrite(r).map((c: any) => `${c.service} ${c.op}`), 'a read writes nothing').toEqual([]);

    // Every page is read: 30 more open candidates on Fleet controller, the index answering four at a time.
    const many = withMany(t, 30);
    const ml = list(C.recruiter, many, { status: 'OPEN' }, { queryPageSize: 4 });
    expect.soft((bodyOf(ml)?.roles ?? []).find((x: any) => x.role_id === R.fleet)?.candidate_count, 'the list counts every page').toBe(FLEET_OPEN.length + 30);
    expect.soft(bodyOf(one(C.recruiter, R.fleet, many, { queryPageSize: 4 }))?.candidate_count, 'one role counts every page').toBe(FLEET_OPEN.length + 30);
    // Recruitment off, or no company: refused before any read.
    const d = list(C.recruiterD, t);
    expect.soft(answer(d), 'a Recruiter of a company with Recruitment off: 403').toEqual([403, FORBIDDEN]);
    expect.soft(awsOf(d).filter((c: any) => !isModulesRead(c)).length, 'only the module read happens').toBe(0);
    const nc = list(C.recruiterNoCompany, t);
    expect.soft([...answer(nc), awsOf(nc).length], 'a Recruiter with no company: 403 before any AWS call').toEqual([403, FORBIDDEN, 0]);
  });

  // ---------------------------------------------------------------- AC-4

  test('AC-4 Close: refused with the count while an open candidate exists; allowed when every candidate is Hired or Not hired; who and when are stored; closing again is idempotent', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const t = world();
    const conflict = (n: number) => [409, { error: 'Conflict', code: 'OPEN_CANDIDATES', open_candidates: n }];
    for (const [id, n] of [[R.fleet, FLEET_OPEN.length], [R.warehouse, 2]] as const) {
      const r = close(C.recruiter, id, t);
      expect.soft(answer(r), `${TITLE[id]} with ${n} open candidates: 409 OPEN_CANDIDATES`).toEqual(conflict(n));
      NO_ROLE_WRITE(`${TITLE[id]} refused`, t, r);
      expect.soft(anyWrite(r).length, `${TITLE[id]} refused: nothing written or sent`).toBe(0);
    }
    expect.soft(answer(close(C.recruiter, R.fleet, withMany(t, 30), { queryPageSize: 4 })), 'every page of the index is counted').toEqual(conflict(FLEET_OPEN.length + 30));

    // No candidate at all: closes. The row says who and when; nothing else on it changes.
    const before = roleOf(t, R.accountant)!;
    const c1 = close(C.recruiter, R.accountant, t);
    expect.soft(statusOf(c1), `Senior accountant (no candidates): 200 (${describe(c1)})`).toBe(200);
    expect.soft(bodyOf(c1)?.status, 'the answer says CLOSED').toBe('CLOSED');
    const after = roleOf(c1.tables, R.accountant) ?? {};
    expect.soft([after['status'], after['closed_by'], String(after['closed_at'] ?? '')], 'stored: CLOSED, by the sign-in\'s person, when').toEqual(['CLOSED', SUB.recA, expect.stringMatching(ISO)]);
    const { status: _s, closed_at: _ca, closed_by: _cb, updated_at: _u, updatedAt: _u2, ...rest } = after;
    const { status: _s0, ...rest0 } = before;
    expect.soft(rest, 'nothing else on the role changes').toEqual(rest0);
    expect.soft(changedRows(t, c1.tables).filter((x) => x['table'] !== ROLES_TABLE).map((x) => x['table']), 'no other table changes').toEqual([]);
    expect.soft(ids(bodyOf(list(C.recruiter, c1.tables, { status: 'OPEN' }))?.roles), 'it leaves the open list').toEqual(sorted([R.fleet, R.warehouse]));
    // Closing again (D-T-12): 200, the first close's who and when, nothing written.
    const c2 = close(C.recruiter2, R.accountant, c1.tables);
    expect.soft(statusOf(c2), 'closing it again: 200').toBe(200);
    expect.soft(roleOf(c2.tables, R.accountant), 'the stored close is the first one').toEqual(after);
    expect.soft(anyWrite(c2).filter((c: any) => !/idempotency/.test(c.table ?? '')).length, 'closing again writes nothing').toBe(0);
    expect.soft(answer(close(C.recruiter, R.closed, t))[0], 'a role closed before: 200').toBe(200);
    expect.soft(roleOf(close(C.recruiter, R.closed, t).tables, R.closed), 'and unchanged').toEqual(roleOf(t, R.closed));

    // Every candidate Hired or Not hired (an old rejection counts as Not hired): closes. B's candidate on A's role id does not hold it open.
    const done = structuredClone(t);
    for (const x of done[TABLE.state]!) {
      const p = plain(x);
      if (p['SK'] === 'SAGA' && p['role_id'] === R.fleet && p['tenant_id'] === A && FLEET_OPEN.includes(p['candidateId'])) x['currentStage'] = { S: 'HIRED' };
    }
    const c3 = close(C.recruiter, R.fleet, done);
    expect.soft(statusOf(c3), `Fleet controller with every candidate Hired or Not hired (and B's open candidate on its id): 200 (${describe(c3)})`).toBe(200);
    expect.soft(roleOf(c3.tables, R.fleet)?.['status'], 'it is CLOSED').toBe('CLOSED');
    expect.soft(changedRows(done, c3.tables).filter((x) => x['table'] === TABLE.state).length, 'no candidate changes').toBe(0);

    // Who may close: a Recruiter only; B gets 404; Recruitment off 403.
    for (const who of [C.hmC1, C.employee, C.adminOnly, C.hrNoTick, C.tickNoHr, C.guest, C.taClaim]) {
      const r = close(who, R.accountant, t);
      expect.soft([...answer(r), awsOf(r).length], `${who.name}: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }
    for (const [what, a] of [['plain', {}], ['body tenant A', { body: { tenant_id: A, tenantId: A } }], ['header x-tenant-id A', { headers: { 'x-tenant-id': A } }], ['query tenant A', { query: { tenantId: A } }]] as const) {
      const r = call(ROUTE.close, C.recruiterB, { id: R.accountant, ...a }, t);
      expect.soft(answer(r), `B's Recruiter closing A's role (${what}): 404`).toEqual([404, NOT_FOUND]);
      NO_ROLE_WRITE(`B closing A's role (${what})`, t, r);
    }
    expect.soft(answer(close(C.recruiter, R.none, t)), 'a role nobody has: 404').toEqual([404, NOT_FOUND]);
    const d = close(C.recruiterD, R.accountant, t);
    expect.soft(answer(d), 'Recruitment off: 403').toEqual([403, FORBIDDEN]);
    expect.soft(awsOf(d).filter((c: any) => !isModulesRead(c)).length, 'Recruitment off: only the module read happens').toBe(0);
    // B closes its own role when it has no open candidate.
    const bDone = structuredClone(t);
    for (const x of bDone[TABLE.state]!) if (plain(x)['candidateId'] === K.b1) x['currentStage'] = { S: 'NOT_HIRED' };
    const cb = close(C.recruiterB, R.b, bDone);
    expect.soft([statusOf(cb), roleOf(cb.tables, R.b)?.['closed_by']], 'B\'s Recruiter closes B\'s role').toEqual([200, SUB.recB]);
    expect.soft(roleOf(cb.tables, R.fleet), 'A\'s roles are untouched').toEqual(roleOf(bDone, R.fleet));
  });

  // ---------------------------------------------------------------- AC-6

  test('AC-6 Filter by role: GET /v1/candidates?role_id= gives that role\'s candidates of the caller\'s company in the screens\' shape, with counts; another company\'s role is an empty list', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(5 * 60_000);
    const t = world();
    const r = candidates(C.recruiter, { role_id: R.fleet, limit: '100' }, t);
    expect.soft(statusOf(r), `a Recruiter lists Fleet controller's candidates (${describe(r)})`).toBe(200);
    const b = bodyOf(r) ?? {};
    const shown = (b.candidates ?? []) as any[];
    const wantDefault = Object.keys(FLEET_STAGE).filter((id) => FLEET_STAGE[id] !== 'NOT_HIRED');
    expect.soft(cids(shown), 'the role\'s candidates of company A, Not hired left out (D-T-9)').toEqual(sorted(wantDefault));
    for (const c of shown) {
      const id = c?.id;
      expect.soft([c?.name, c?.stage, c?.role_id, c?.level], `${id}: name, stage (six codes), role and level`).toEqual([fullName(id), FLEET_STAGE[id], R.fleet, 'MID']);
      // REC-15 rule 1 (child lock rec-04.3): Hired has no clock, so its sla_status is null.
      expect.soft(c?.sla_status, `${id}: sla_status in the screens' words (D-T-6)`).toBe(FLEET_STAGE[id] === 'HIRED' ? null : (FLEET_SLA[id] ?? 'ON_TRACK'));
      expect.soft(String(c?.stage_entered_at ?? ''), `${id}: stage_entered_at`).toMatch(ISO);
    }
    const counts = b.counts ?? {};
    expect.soft({ all: counts.all, overdue: counts.overdue, due_soon: counts.due_soon, not_hired: counts.not_hired }, 'the counts of the role').toEqual({ all: wantDefault.length, overdue: 1, due_soon: 1, not_hired: 2 });
    expect.soft(Number.isInteger(counts.mine) && counts.mine >= 0 && counts.mine <= counts.all, `counts.mine is a whole number from 0 to all (${counts.mine})`).toBe(true);
    expect.soft(JSON.stringify(b), 'company B\'s candidate on A\'s role id is never shown').not.toContain(K.bOnA);
    expect.soft(awsOf(r).some((c: any) => c.op === 'Query' && c.input?.IndexName === INDEX), 'it reads the role-id-index (D-REC-4.4)').toBe(true);
    expect.soft(awsOf(r).filter((c: any) => c.op === 'Scan').length, 'and scans nothing').toBe(0);

    // The filters the board sends. The counts stay the role's whatever the filter.
    const filtered = (q: Record<string, string>, label: string, want: string[]) => {
      const x = candidates(C.recruiter, { role_id: R.fleet, ...q }, t);
      expect.soft(cids(bodyOf(x)?.candidates), label).toEqual(sorted(want));
      expect.soft(bodyOf(x)?.counts?.all, `${label}: counts unchanged`).toBe(wantDefault.length);
      return x;
    };
    const nh = filtered({ stage: 'NOT_HIRED' }, 'stage=NOT_HIRED: the Not hired, an old rejection too', [K.notHired, K.oldRejected]);
    expect.soft((bodyOf(nh)?.candidates ?? []).map((c: any) => c.stage), 'each reads NOT_HIRED').toEqual(['NOT_HIRED', 'NOT_HIRED']);
    filtered({ stage: 'INTERVIEW' }, 'stage=INTERVIEW: an old stage name reads as its new stage', [K.interview, K.oldName]);
    filtered({ sla_status: 'OVERDUE' }, 'sla_status=OVERDUE', [K.offer]);
    filtered({ sla_status: 'DUE_SOON' }, 'sla_status=DUE_SOON', [K.oldName]);
    filtered({ search: 'tendai' }, 'search, whatever the case', [K.interview]);
    filtered({ search: 'MOYO' }, 'search, a surname', [K.screening]);
    const mine = candidates(C.recruiter, { role_id: R.fleet, mine: 'true' }, t);
    const m = bodyOf(mine) ?? {};
    expect.soft((m.candidates ?? []).length, 'mine=true lists counts.mine candidates').toBe(m.counts?.mine);
    expect.soft((m.candidates ?? []).every((c: any) => wantDefault.includes(c.id)), 'all of them the role\'s').toBe(true);

    // A manager: only the candidates they are hiring for, as today.
    expect.soft(cids(bodyOf(candidates(C.hmC1, { role_id: R.fleet }, t))?.candidates), 'hmA: Fleet controller\'s candidates whose hiring manager they are').toEqual(sorted(wantDefault.filter((id) => id !== K.otherHm)));
    expect.soft(cids(bodyOf(candidates(C.hmOther, { role_id: R.fleet }, t))?.candidates), 'hm2A: the one they are hiring for').toEqual([K.otherHm]);
    expect.soft(cids(bodyOf(candidates(C.recruiter, { role_id: R.warehouse }, t))?.candidates), 'Warehouse supervisor: its two').toEqual(sorted([K.w1, K.w2]));

    // Another company's role, or a role nobody has: the same empty answer, no hint it exists.
    const empty = { candidates: [], counts: { all: 0, mine: 0, overdue: 0, due_soon: 0, not_hired: 0 } };
    const bOnA = candidates(C.recruiterB, { role_id: R.fleet }, t);
    expect.soft(answer(bOnA), 'B\'s Recruiter with A\'s role id: 200 and an empty list (even with its own row on that id)').toEqual([200, empty]);
    expect.soft(answer(candidates(C.recruiterB, { role_id: R.none }, t)), 'B\'s Recruiter with a role id nobody has: the same answer').toEqual([200, empty]);
    expect.soft(answer(candidates(C.recruiter, { role_id: R.b }, t)), 'A\'s Recruiter with B\'s role id: empty').toEqual([200, empty]);
    expect.soft(answer(candidates(C.recruiterB, { role_id: R.fleet, tenantId: A, tenant_id: A }, t)), 'naming company A in the query changes nothing').toEqual([200, empty]);
    expect.soft(answer(call(ROUTE.candidates, C.recruiterB, { query: { role_id: R.fleet }, headers: { 'x-tenant-id': A } }, t)), 'nor in a header').toEqual([200, empty]);
    expect.soft(cids(bodyOf(candidates(C.recruiterB, { role_id: R.b }, t))?.candidates), 'B with its own role: its own candidate').toEqual([K.b1]);

    // Every page: 30 more on Fleet controller, four at a time.
    const many = candidates(C.recruiter, { role_id: R.fleet, limit: '100' }, withMany(t, 30), { queryPageSize: 4 });
    expect.soft([(bodyOf(many)?.candidates ?? []).length, bodyOf(many)?.counts?.all], 'every page is read for the list and the counts').toEqual([wantDefault.length + 30, wantDefault.length + 30]);

    // Without role_id the list still works as before (the old screens use it).
    const plainList = candidates(C.recruiter, {}, t);
    expect.soft(statusOf(plainList), 'no role_id: 200').toBe(200);
    expect.soft(cids(bodyOf(plainList)?.candidates), 'it still lists a candidate with no role').toContain(K.noRole);
    // Roles first: 403 before any AWS call.
    for (const who of [C.employee, C.adminOnly, C.hrNoTick, C.guest]) {
      const x = candidates(who, { role_id: R.fleet }, t);
      expect.soft([...answer(x), awsOf(x).length], `${who.name}: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }
    expect.soft(logsOf(r).join('\n'), 'the logs name no candidate').not.toMatch(/Amahle|Dlamini|Tendai|Ncube/);
  });

  // ---------------------------------------------------------------- AC-8

  test('AC-8 Terraform, roles and the app\'s address: the table, the index, the Lambda and its routes with exact grants; no wildcard; no table item; CORS and the app reach the TalentFlow API', async ({}, testInfo) => {
    once(testInfo.project.name);
    const tf: Stack = 'talent-flow-infra';
    for (const stack of STACKS) expect.soft(resourcesOf(stack, 'aws_dynamodb_table_item').length, `${stack}: no aws_dynamodb_table_item (LESSONS #362)`).toBe(0);
    // The table (D-T-2).
    const tables = resourcesOf(tf, 'aws_dynamodb_table');
    const roles = tables.filter((b) => valueOf(tf, attributes(b.body).get('name')) === ROLES_TABLE);
    expect(roles.length, 'one aws_dynamodb_table named talent-flow-roles in talent-flow-infra').toBe(1);
    const rt = roles[0]!;
    const ra = attributes(rt.body);
    expect.soft([valueOf(tf, ra.get('hash_key')), valueOf(tf, ra.get('range_key')), valueOf(tf, ra.get('billing_mode'))], 'keys pk and sk, pay per request').toEqual(['pk', 'sk', 'PAY_PER_REQUEST']);
    const sse = /server_side_encryption\s*\{([^}]*)\}/.exec(rt.body)?.[1] ?? '';
    expect.soft(squash(sse), 'encrypted with the state table\'s key').toMatch(/enabled=true/);
    expect.soft(squash(sse), 'the state key').toMatch(/kms_key_arn=aws_kms_key\.talent_flow_state\.arn/);
    expect.soft(squash(/point_in_time_recovery\s*\{([^}]*)\}/.exec(rt.body)?.[1] ?? ''), 'point in time recovery on').toMatch(/enabled=true/);
    // The index on the candidate table.
    const state = tables.find((b) => b.labels[1] === 'talent_flow_state')!;
    const gsis = [...state.body.matchAll(/global_secondary_index\s*\{([^}]*)\}/g)].map((m) => ({ name: /name\s*=\s*"([^"]+)"/.exec(m[1]!)?.[1], hash: /hash_key\s*=\s*"([^"]+)"/.exec(m[1]!)?.[1] }));
    expect.soft(gsis.filter((g) => g.name === INDEX).map((g) => g.hash), 'the state table has role-id-index on role_id').toEqual(['role_id']);
    expect.soft(gsis.map((g) => g.name).filter((n) => n === 'GSI1' || n === 'GSI2'), 'GSI1 and GSI2 stay').toEqual(['GSI1', 'GSI2']);
    expect.soft(/attribute\s*\{\s*name\s*=\s*"role_id"\s*type\s*=\s*"S"\s*\}/.test(state.body), 'role_id is declared as a text attribute').toBe(true);

    // The Lambda and its four routes on the TalentFlow API, signed in (JWT).
    const fn = lambdaNamed(HANDLER);
    expect(fn.length, 'one aws_lambda_function named manageRoles').toBe(1);
    const { stack, block } = fn[0]!;
    expect.soft(stack, 'in the TalentFlow stack, next to the candidate routes').toBe(tf);
    const env = settingsOf(block);
    expect.soft(valueOf(stack, env.get('ROLES_TABLE_NAME')), 'ROLES_TABLE_NAME names the table').toBe(ROLES_TABLE);
    for (const k of ['STATE_TABLE_NAME', 'TENANTS_TABLE', 'HM_COGNITO_POOL_ID']) expect.soft(env.has(k), `${k} is set`).toBe(true);
    const integrations = resourcesOf(stack, 'aws_apigatewayv2_integration').filter((b) => (attributes(b.body).get('integration_uri') ?? '').includes(`aws_lambda_function.${block.labels[1]}.invoke_arn`)).map((b) => b.labels[1]);
    const routesTf = resourcesOf(stack, 'aws_apigatewayv2_route').map((b) => ({ key: valueOf(stack, attributes(b.body).get('route_key')), auth: valueOf(stack, attributes(b.body).get('authorization_type')), target: attributes(b.body).get('target') ?? '', api: attributes(b.body).get('api_id') ?? '' }));
    for (const route of ROLE_ROUTES) {
      const r = routesTf.filter((x) => x.key === route.replace(/\s+/g, ''));
      expect.soft(r.length, `${route}: one route`).toBe(1);
      expect.soft(r[0]?.auth, `${route}: signed-in (JWT)`).toBe('JWT');
      expect.soft(integrations.some((n) => r[0]?.target.includes(`aws_apigatewayv2_integration.${n}.id`)), `${route}: on manageRoles`).toBe(true);
      expect.soft(r[0]?.api, `${route}: on the TalentFlow API`).toContain('aws_apigatewayv2_api.talent_flow_api');
    }
    expect.soft(resourcesOf('infra', 'aws_apigatewayv2_route').map((b) => valueOf('infra', attributes(b.body).get('route_key'))).filter((k) => /\/v1\/roles/.test(k)), 'no role route on another API').toEqual([]);

    // IAM: its own role, the card's actions only, exact resources, writes only to the roles and idempotency tables.
    const role = roleResourceOf(block);
    expect.soft(role, 'manageRoles runs as its own role').toBeTruthy();
    const others = ['getCandidates', 'recordNotHired', 'advanceCandidateStage', 'createCandidate', 'getHiringManagers'].flatMap((n) => lambdaNamed(n)).map((x) => roleResourceOf(x.block));
    expect.soft(others, 'its role is not another Lambda\'s').not.toContain(role);
    const all = policyLines();
    const mine = Object.values(all).filter((p) => p.stack === stack && p.role === role).flatMap((p) => p.pairs ?? [`unreadable ${p.squash}`]);
    expect.soft(blocks(filesOf(stack), 'resource').filter((b) => b.labels[0] === 'aws_iam_role_policy_attachment' && (attributes(b.body).get('role') ?? '').includes(`aws_iam_role.${role}.`)).map((b) => b.labels[1]), 'no managed policy is attached to it').toEqual([]);
    expect.soft(mine.length, 'its policy is read').toBeGreaterThan(3);
    const ALLOWED = /^Allow (dynamodb:(GetItem|PutItem|UpdateItem|Query|ConditionCheckItem|TransactWriteItems)|cognito-idp:(ListUsersInGroup|AdminListGroupsForUser|AdminGetUser)|kms:(Decrypt|GenerateDataKey|GenerateDataKeyWithoutPlaintext|DescribeKey)|logs:(CreateLogGroup|CreateLogStream|PutLogEvents)|xray:(PutTraceSegments|PutTelemetryRecords)) /;
    for (const line of mine) {
      expect.soft(line, 'an action the card needs').toMatch(ALLOWED);
      if (/ logs:/.test(line)) expect.soft(line, `${line}: only its own log group`).toMatch(/log-group:\/aws\/lambda\/manageRoles:\*/);
      else if (!/ xray:/.test(line)) expect.soft(line.split(' ')[2], `${line}: no wildcard resource`).not.toMatch(/^\*$|:\*$|table\/\*|index\/\*|userpool\/\*$/);
      if (/dynamodb:(UpdateItem|PutItem|TransactWriteItems)/.test(line)) expect.soft(line, `${line}: writes only the roles or an idempotency table`).toMatch(/talent-flow-roles|tf_table_roles|talent_flow_roles\.arn|idempotency/);
      if (/ cognito-idp:/.test(line)) expect.soft(line, `${line}: one sign-in pool`).toMatch(/userpool\/[^*\s]+ /);
    }
    expect.soft(mine.some((l) => /^Allow kms:Decrypt .*talent_flow_state/.test(l)) && mine.some((l) => /^Allow kms:GenerateDataKey .*talent_flow_state/.test(l)), 'it can read and write the encrypted roles table (the state key)').toBe(true);
    expect.soft(mine.some((l) => /^Allow dynamodb:Query .*index\/role-id-index /.test(l)), 'it can Query the role-id-index (the counts and the close check)').toBe(true);
    // getCandidates gains two lines, the Query on the new index and the read of one role; no other role gains anything (against develop f55ab09).
    const baseline = JSON.parse(readFileSync(join(__dirname, 'support', 'rec-04', 'iam-f55ab09', 'policies.json'), 'utf8')) as Record<string, { role: string; stack: Stack; pairs?: string[]; squash?: string }>;
    const getCandRole = roleResourceOf(lambdaNamed('getCandidates')[0]!.block);
    const gcEnv = settingsOf(lambdaNamed('getCandidates')[0]!.block);
    expect.soft(valueOf(lambdaNamed('getCandidates')[0]!.stack, gcEnv.get('ROLES_TABLE_NAME')), 'getCandidates reads the roles table\'s name from ROLES_TABLE_NAME').toBe(ROLES_TABLE);
    const roleIndex = /^Allow dynamodb:Query \S*(talent-flow-state|tf_table_state\})\/index\/role-id-index null$/;
    const roleRead = /^Allow dynamodb:GetItem \S*(talent-flow-roles|tf_table_roles\}|talent_flow_roles\.arn) null$/;
    const getCandGained: string[] = [];
    for (const [k, cur] of Object.entries(all)) {
      if (cur.stack === stack && cur.role === role) continue;
      if (/manage_departments|manageDepartments/.test(k) || /manage_departments|manageDepartments/.test(cur.role)) continue; // REC-14 (child lock rec-14.1): the department list's own role, judged in rec-14.spec.ts AC-3.
      if (isRec16Role(k, cur.role)) continue; // REC-16 (child lock rec-16.1): its own role, judged in rec-16.spec.ts AC-10.
      if (isRec09Policy(k, cur.pairs)) continue; // REC-09 (child lock rec-09.1): REC-09's four policies, each exactly its pinned lines (support/rec-09/policy-lines.json), judged in rec-09.spec.ts AC-10.
      const was = new Set(baseline[k]?.pairs ?? []);
      const gained = (cur.pairs ?? []).filter((l) => !was.has(l));
      if (cur.role === getCandRole) {
        getCandGained.push(...gained);
        if (cur.squash !== undefined) expect.soft(cur.squash, `${k}: an unreadable policy did not change`).toBe(baseline[k]?.squash);
      } else {
        // REC-07 (child lock rec-07.1): scheduleInterview reads the role's criteria, submitVote finds an interview by id (support/rec-07.1/grants.ts).
        expect.soft(gained.filter((l) => !isRec07Grant(l, k) && !isRec15bGrant(l, k) && !isRec05Grant(l, k) && !isRec15cGrant(l, k) && !isRec15dGrant(l, k) && !isInt01Grant(l, k) && !isRec062Grant(l, k)), `${k}: no new grant`).toEqual([]); // && isRec15dGrant: child lock rec-15d.1; // && isRec05Grant: child lock rec-05.1; && isRec15cGrant: // child lock rec-15c.1
        if (cur.squash !== undefined) expect.soft(cur.squash, `${k}: an unreadable policy did not change`).toBe(baseline[k]?.squash);
      }
    }
    // REC-15 (child lock rec-04.3): the list's stage clock reads the company's active SLA_THRESHOLDS (rec-15.spec.ts AC-17 pins it).
    const configRead = /^Allow dynamodb:Query arn:aws:dynamodb:af-south-1:[^:\s]+:table\/\$\{local\.tf_table_config\}\/index\/GSI1-active-configs null$/;
    expect.soft(getCandGained.filter((l) => !roleIndex.test(l) && !roleRead.test(l) && !configRead.test(l)), 'getCandidates gains only the Query on role-id-index, the read of one role (is the role the caller\'s company\'s) and REC-15\'s settings read').toEqual([]);
    expect.soft([getCandGained.filter((l) => roleIndex.test(l)).length, getCandGained.filter((l) => roleRead.test(l)).length], 'getCandidates gains those two lines, once each').toEqual([1, 1]);
    // KMS (LESSONS 15 Nov, D-T-13): the module check and the hiring manager check read the encrypted company list, so the role goes on the PII
    // key's read list, and only there. The key refuses a role that does not exist yet and infra/ applies first, so the line may come one merge
    // later (as REC-02's did): here it is named at most once; AC-10 on pepla-dev proves the read works.
    const info = roleInfo(stack, role ?? '');
    const arnText = info ? `role${info.path}${info.name}` : 'no role';
    expect.soft(arnText, 'the role has a path and a name').toMatch(/^role\/talent-flow\/talent-flow-role-manageRoles$/);
    const reads = kmsList('dynamodb_read_role_arns');
    expect.soft(reads.split(arnText).length - 1, `the PII key's read list names ${arnText} at most once`).toBeLessThanOrEqual(1);
    expect.soft(kmsList('allowed_role_arns'), 'and not the encrypt list').not.toContain(arnText);

    // CORS: the header the app sends, and the new app's dev addresses outside prod (the old ones stay).
    const api = blocks(filesOf(tf), 'resource').find((b) => b.labels[0] === 'aws_apigatewayv2_api' && b.labels[1] === 'talent_flow_api');
    const cors = squash(/cors_configuration\s*\{([\s\S]*?)\n\s*\}/.exec(api?.body ?? '')?.[1] ?? '');
    expect.soft((/allow_headers=\[([^\]]*)\]/.exec(cors)?.[1] ?? '').toLowerCase(), 'the TalentFlow API allows the idempotency-key header').toMatch(/"idempotency-key"/);
    for (const o of ['http://localhost:4200', 'https://hr-portal-beryl-three.vercel.app', 'http://localhost:4300', 'http://127.0.0.1:4300']) expect.soft(cors + squash(readTfLocals(tf)), `CORS lets ${o} in`).toContain(`"${o}"`);
    expect.soft(cors + squash(readTfLocals(tf)), 'the dev addresses are behind an environment check (not on prod)').toMatch(/var\.environment!?=+"prod"|var\.environment=="dev"/);

    // The routes are described (TEN-04's check) and on the company walk's list.
    const check = (() => { try { return { code: 0, out: execFileSync('node', [join(REPO, 'scripts', 'ci', 'routes-match-openapi.mjs')], { encoding: 'utf8', timeout: 60_000 }) }; } catch (e: any) { return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }; } })();
    expect.soft(check.code, `routes-match-openapi passes (${check.out.slice(-400)})`).toBe(0);
    const walk = JSON.parse(readFileSync(join(REPO, 'scripts', 'tenancy', 'ten-04-rows.json'), 'utf8')) as Record<string, unknown>;
    for (const route of ROLE_ROUTES) expect.soft(route in walk, `${route} is on the company walk's list`).toBe(true);

    // The app reaches the TalentFlow API (D-T-11).
    const appEnv = readFileSync(join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts'), 'utf8');
    expect.soft(/talentFlowApiUrl\s*:\s*['"`]https:\/\/[^'"`]*\.invalid['"`]/.test(appEnv), 'pepla-web\'s environment has talentFlowApiUrl, a .invalid placeholder').toBe(true);
    const frontEnv = readFileSync(join(REPO, 'scripts', 'ci', 'dev-frontend-env.sh'), 'utf8');
    const webBlock = frontEnv.slice(frontEnv.indexOf('pepla-web/src/environments/environment.ts'));
    expect.soft(webBlock, 'dev-frontend-env.sh writes the TalentFlow address into pepla-web\'s environment').toMatch(/talentFlowApiUrl\s*:\s*'\$\{TF_API\}'/);
    const hire = stripJs(readFileSync(join(REPO, 'pepla-web', 'src', 'app', 'features', 'recruitment', 'hire-api.ts'), 'utf8'));
    expect.soft(hire, 'hire-api.ts calls the TalentFlow address').toMatch(/environment\.talentFlowApiUrl/);
    expect.soft(hire, 'and not the employees API').not.toMatch(/employeesApiUrl/);
    // The dev run: AC-10 needs company B's 404, so it runs in the company walk step (as REC-02 AC-12 and REC-03 AC-11).
    const wf = readFileSync(join(REPO, '.github', 'workflows', 'app-e2e-dev.yml'), 'utf8');
    expect.soft((/--grep-invert "([^"]*)"/.exec(wf)?.[1] ?? ''), 'the main dev run leaves REC-04 AC-10 out').toContain('REC-04 .* AC-10 The test logins on pepla-dev');
    expect.soft((/--reporter=list --grep "([^"]*)"/.exec(wf)?.[1] ?? ''), 'the company walk step runs it').toContain('REC-04 .* AC-10 The test logins on pepla-dev');
  });

  // ---------------------------------------------------------------- AC-9

  test('AC-9 Checks in order: on every role route the REC-01 role check, then the company, then the module, before any read; the core is shared; no model client', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(4 * 60_000);
    const t = world();
    expect.soft(handlerFolderFiles().length, 'lambda/manageRoles exists').toBeGreaterThan(0);
    for (const route of ROLE_ROUTES) {
      const a = route === ROUTE.open ? { body: GOOD, headers: { 'idempotency-key': newKey() } } : route === ROUTE.list ? {} : { id: R.accountant, body: {} };
      for (const who of [C.employee, C.guest, C.adminOnly, C.noGroups]) {
        const r = call(route, who, a, t);
        expect.soft([...answer(r), awsOf(r).length], `${route}, ${who.name}: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
      }
      const none = call(route, C.recruiterNoCompany, a, t);
      expect.soft([...answer(none), awsOf(none).length], `${route}, a Recruiter with no company: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
      const d = call(route, C.recruiterD, a, t);
      expect.soft(answer(d), `${route}, Recruitment off: 403`).toEqual([403, FORBIDDEN]);
      expect.soft(awsOf(d).filter((c: any) => !isModulesRead(c)).map((c: any) => `${c.service} ${c.op} ${c.table ?? ''}`), `${route}, Recruitment off: only the module read happens`).toEqual([]);
      const noAuth = call(route, C.recruiter, { ...a, claims: { token_use: 'access' } }, t);
      expect.soft(statusOf(noAuth), `${route}: an access token (not an ID token) is refused`).toBe(403);
    }
    const handler = handlerFolderFiles().map(code).join('\n');
    const core = code(CORE);
    expect.soft(core.length, 'lambda/shared/recruitment-actions/roles.mjs exists (REC-00 rule 4)').toBeGreaterThan(0);
    expect.soft(handler, 'the handler calls the core').toMatch(/recruitment-actions\/roles\.mjs/);
    expect.soft(handler + core, 'the role check is the REC-01 helper').toMatch(/recruitment-access\.mjs/);
    expect.soft(handler + core, 'the company check is the tenancy helper').toMatch(/requireTenant\s*\(/);
    expect.soft(handler + core, 'rows read by key are checked with ownsRow').toMatch(/ownsRow\s*\(/);
    expect.soft(handler + core, 'the module check is MOD-01\'s').toMatch(/requireModule\s*\(/);
    for (const f of [...handlerFolderFiles(), CORE, ...handlerFolderFiles('getCandidates')]) {
      expect.soft(code(f).match(/client-bedrock|bedrock-runtime|@anthropic-ai|anthropic|openai|ai-guard|BedrockRuntime|InvokeModel|Converse(Stream)?Command/gi) ?? [], `${f.replace(REPO, '')}: no model client`).toEqual([]);
    }
  });

  // ---------------------------------------------------------------- AC-10 (the dev seed, checked here)

  test('AC-10 The dev seed: Fleet controller with its six open and two Not hired, Warehouse supervisor, Senior accountant and the old-system row; no seeded candidate names the manager login; a second run puts everything back', async ({}, testInfo) => {
    once(testInfo.project.name);
    const tid = 'ten_seedaaaaaaaaaaaaaaaaaaaa';
    const mgr = 'sub-manager-login';
    const s1 = runSeed({ 'talent-flow-roles': [], 'talent-flow-state': [] }, tid, mgr);
    expect(s1.error ?? '', 'seed_rec04 runs').toBe('');
    const t1 = s1.tables as Tables;
    const roles = rowsOf(t1, ROLES_TABLE);
    const byTitle = (title: string) => roles.find((x) => x['job_title'] === title) ?? {};
    expect.soft(roles.map((x) => x['job_title']).sort(), 'three roles').toEqual(['Fleet controller', 'Senior accountant', 'Warehouse supervisor']);
    for (const x of roles) {
      expect.soft([x['pk'], x['sk'], x['tenant_id'], x['status']], `${x['job_title']}: keyed, the first company's, OPEN`).toEqual([`TENANT#${tid}`, `ROLE#${x['role_id']}`, tid, 'OPEN']);
      expect.soft(['JUNIOR', 'MID', 'SENIOR'].includes(x['level']) && Number.isInteger(x['panel_size']) && x['panel_size'] >= 1 && x['panel_size'] <= 12, `${x['job_title']}: a pack level and a panel size`).toBe(true);
      expect.soft(Array.isArray(x['criteria']) && x['criteria'].length > 0 && x['criteria'].every((c: any) => c.key && c.label), `${x['job_title']}: criteria`).toBe(true);
      expect.soft(String(x['department'] ?? '').length > 0 && ISO.test(String(x['opened_at'] ?? '')), `${x['job_title']}: department and opened_at`).toBe(true);
    }
    expect.soft(byTitle('Senior accountant')['hiring_manager_id'], 'Senior accountant\'s hiring manager is the manager login (REC-04 AC-10 lists it)').toBe(mgr);
    expect.soft([byTitle('Fleet controller')['hiring_manager_id'], byTitle('Warehouse supervisor')['hiring_manager_id']].filter((h) => !h || h === mgr), 'the other two have another hiring manager').toEqual([]);
    const sagasOf = (t: Tables) => rowsOf(t, TABLE.state).filter((x) => x['SK'] === 'SAGA');
    const fleet = byTitle('Fleet controller')['role_id'];
    const want: Record<string, string> = {
      'Amahle Dlamini': 'APPLIED', 'Tariro Moyo': 'SCREENING', 'Ayanda Mkhize': 'SCREENING', 'Tendai Ncube': 'INTERVIEW', 'Bongani Mthembu': 'INTERVIEW', 'Kagiso Molefe': 'OFFER',
      'Nomvula Zulu': 'NOT_HIRED', 'Farai Moyo': 'NOT_HIRED',
    };
    const fleetNow = (t: Tables) => Object.fromEntries(sagasOf(t).filter((x) => x['role_id'] === fleet).map((x) => [`${x['firstName']} ${x['lastName']}`, x['currentStage']]));
    expect.soft(fleetNow(t1), 'Fleet controller\'s eight candidates in the stages of cards/rec-ui-01.md').toEqual(want);
    for (const x of sagasOf(t1)) {
      expect.soft([x['tenant_id'], x['GSI1PK'], String(x['GSI1SK'] ?? '').startsWith('SAGA#'), x['PK']], `${x['firstName']}: the first company's, on the company index`).toEqual([tid, `TENANT#${tid}`, true, `CANDIDATE#${x['candidateId']}`]);
      expect.soft(x['hiringManagerId'] && x['hiringManagerId'] !== mgr, `${x['firstName']} ${x['lastName']}: a hiring manager, not the manager login (REC-01 AC-9)`).toBeTruthy();
      const r = roles.find((y) => y['role_id'] === x['role_id']);
      expect.soft(r && x['positionTitle'] === r['job_title'] && x['positionLevel'] === r['level'], `${x['firstName']}: on a seeded role, its title and level copied`).toBeTruthy();
    }
    const kagiso = sagasOf(t1).find((x) => x['firstName'] === 'Kagiso');
    const offer = rowsOf(t1, TABLE.state).find((x) => x['PK'] === kagiso?.['PK'] && x['SK'] === 'OFFER');
    expect.soft([offer?.['tenant_id'], /SENT$/.test(String(offer?.['state'] ?? ''))], 'Kagiso Molefe has an offer that was sent').toEqual([tid, true]);
    const mpho = sagasOf(t1).find((x) => x['firstName'] === 'Mpho' && x['lastName'] === 'Sithole');
    expect.soft([mpho?.['role_id'], mpho?.['decided_by_kind'], mpho?.['status']], 'Mpho Sithole: the old system\'s Not hired on Warehouse supervisor').toEqual([byTitle('Warehouse supervisor')['role_id'], 'OLD_SYSTEM', 'REJECTED']);
    expect.soft([...new Set((s1.calls ?? []).map((c: any) => c.table))].sort(), 'it writes only the roles and candidate tables').toEqual(['talent-flow-roles', 'talent-flow-state'].filter((x) => (s1.calls ?? []).some((c: any) => c.table === x)));
    expect.soft((s1.calls ?? []).every((c: any) => ['talent-flow-roles', 'talent-flow-state'].includes(c.table)), 'and touches no other table').toBe(true);

    // What a dev run leaves behind is put back: a candidate moved, one Not hired, a history row, the role closed.
    const dirty = structuredClone(t1) as Tables;
    const sagaRow = (t: Tables, first: string) => t[TABLE.state]!.find((x) => x['SK']?.['S'] === 'SAGA' && x['firstName']?.['S'] === first)!;
    sagaRow(dirty, 'Amahle')['currentStage'] = { S: 'SCREENING' };
    sagaRow(dirty, 'Tendai')['currentStage'] = { S: 'NOT_HIRED' };
    sagaRow(dirty, 'Tendai')['not_hired_reason'] = { S: 'DID_NOT_ATTEND' };
    dirty[TABLE.state]!.push(av({ PK: String(plain(sagaRow(dirty, 'Amahle'))['PK']), SK: 'STAGE#2026-11-21T08:00:00.000Z#x', tenant_id: tid, reason: 'Put back by the test' }));
    dirty[ROLES_TABLE]!.find((x) => x['job_title']?.['S'] === 'Fleet controller')!['status'] = { S: 'CLOSED' };
    const s2 = runSeed(dirty as any, tid, mgr);
    expect(s2.error ?? '', 'a second run works').toBe('');
    const t2 = s2.tables as Tables;
    expect.soft(fleetNow(t2), 'every Fleet controller candidate is back in its seeded stage').toEqual(want);
    expect.soft(sagasOf(t2).find((x) => x['firstName'] === 'Tendai')?.['not_hired_reason'], 'Tendai\'s Not hired reason is gone').toBeUndefined();
    expect.soft(rowsOf(t2, TABLE.state).filter((x) => String(x['SK']).startsWith('STAGE#')).length, 'no history row of a seeded candidate is left').toBe(0);
    expect.soft(rowsOf(t2, ROLES_TABLE).map((x) => `${x['job_title']} ${x['status']}`).sort(), 'the three roles, once each, OPEN again').toEqual(['Fleet controller OPEN', 'Senior accountant OPEN', 'Warehouse supervisor OPEN']);
    expect.soft(sagasOf(t2).length, 'no candidate is added twice').toBe(sagasOf(t1).length);
    expect.soft(rowsOf(t2, ROLES_TABLE).map((x) => x['role_id']).sort(), 'the role ids are fixed').toEqual(roles.map((x) => x['role_id']).sort());
    // main() runs it.
    const src = readFileSync(SEED, 'utf8');
    const main = src.slice(src.indexOf('def main('));
    expect.soft(main, 'main() calls seed_rec04').toMatch(/seed_rec04\(\s*ddb\s*,/);
  });

  // ---------------------------------------------------------------- AC-10 (pepla-dev)

  test('AC-10 The test logins on pepla-dev: HR lists the seeded roles and Fleet controller\'s candidates, cannot close it, opens and closes a new role; the manager sees only theirs; B gets 404; the preflight passes @pepla-dev', async ({ page }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-1 to AC-10.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(8 * 60_000);
    const env = (k: string) => process.env[k] ?? '';
    const login = (p: string) => ({ email: env(`${p}_EMAIL`), password: env(`${p}_PASSWORD`) });
    const logins = { hr: login('E2E_HR'), manager: login('E2E_MANAGER'), companyB: login('E2E_HR_B') };
    for (const [who, l] of Object.entries(logins)) expect(l.email && l.password, `the ${who} test login is set`).toBeTruthy();
    const { devEnv } = await import('./support/ten-02/dev');
    const { region, clientId } = devEnv();
    // The new app's own TalentFlow address (D-T-11), as CI writes it for pepla-dev.
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
    const personOf = (token: string) => { const c = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')); return String(c.user_id ?? c.sub); };
    const api = async (token: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
      page.request.fetch(`${tfApi}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, ...(body === undefined ? {} : { data: JSON.stringify(body) }) });
    const [hr, manager, companyB] = await Promise.all([signIn(logins.hr), signIn(logins.manager), signIn(logins.companyB)]);
    const managerId = personOf(manager);

    // The seeded roles (cards/rec-ui-01.md). Fleet controller is seeded with six open candidates, but REC-UI-01 AC-13 runs in the main
    // batch first and records Tendai Ncube as Not hired, so here Tendai may be open or Not hired (lock check round 1, F-1).
    const rl = await api(hr, 'GET', '/v1/roles?status=OPEN');
    expect(rl.status(), 'HR lists the open roles').toBe(200);
    const roles = (((await rl.json()) as any).roles ?? []) as any[];
    for (const title of ['Fleet controller', 'Warehouse supervisor', 'Senior accountant']) expect(roles.filter((x) => x.job_title === title).length, `${title} is listed once`).toBe(1);
    const fleet = roles.find((x) => x.job_title === 'Fleet controller');
    const cl = await api(hr, 'GET', `/v1/candidates?role_id=${encodeURIComponent(fleet.role_id)}&limit=100`);
    expect(cl.status(), 'HR lists Fleet controller\'s candidates').toBe(200);
    const cb = (await cl.json()) as any;
    const names = (cb.candidates ?? []).map((c: any) => c.name) as string[];
    expect(fleet.candidate_count, 'Fleet controller\'s open count is the candidate list\'s own count').toBe(names.length);
    expect(cb.counts?.all, 'and the list\'s count of all open candidates').toBe(names.length);
    for (const n of ['Amahle Dlamini', 'Tariro Moyo', 'Ayanda Mkhize', 'Bongani Mthembu', 'Kagiso Molefe']) expect(names, `${n} is on the board`).toContain(n);
    const nl = await api(hr, 'GET', `/v1/candidates?role_id=${encodeURIComponent(fleet.role_id)}&stage=NOT_HIRED&limit=100`);
    expect(nl.status(), 'HR lists Fleet controller\'s Not hired').toBe(200);
    const notHired = (((await nl.json()) as any).candidates ?? []).map((c: any) => c.name) as string[];
    expect(names.includes('Tendai Ncube') !== notHired.includes('Tendai Ncube'), 'Tendai Ncube is open or Not hired (once)').toBe(true);
    expect(fleet.candidate_count, 'six open, less Tendai if AC-13 has recorded Not hired').toBe(notHired.includes('Tendai Ncube') ? 5 : 6);
    expect(cb.counts?.not_hired, 'two Not hired').toBeGreaterThanOrEqual(2);
    const refused = await api(hr, 'POST', `/v1/roles/${encodeURIComponent(fleet.role_id)}/close`, {});
    expect([refused.status(), ((await refused.json()) as any).code], 'closing Fleet controller is refused while candidates are open').toEqual([409, 'OPEN_CANDIDATES']);

    // HR opens a role (with an Idempotency-Key, as the page sends it), reads it, and closes it (no candidates).
    // REC-14 step B (rec-04.2): the department is company A's seeded one (support/ten-04/dev-ids.json, put back by seed-dev.py on every run).
    const devDepartmentId = String((JSON.parse(readFileSync(join(__dirname, 'support', 'ten-04', 'dev-ids.json'), 'utf8')) as Record<string, unknown>)['department']);
    const made = await api(hr, 'POST', '/v1/roles', { job_title: `REC-04 dev check ${Date.now()}`, department_id: devDepartmentId, level: fleet.level, hiring_manager_id: managerId }, { 'Idempotency-Key': `rec04-${Date.now()}` });
    expect(made.status(), `HR opens a role (${await made.text()})`).toBe(201);
    const newId = ((await made.json()) as any).role_id as string;
    try {
      const got = await api(hr, 'GET', `/v1/roles/${encodeURIComponent(newId)}`);
      expect([got.status(), ((await got.json()) as any).candidate_count], 'it reads back with no candidates').toEqual([200, 0]);
    } finally {
      const done = await api(hr, 'POST', `/v1/roles/${encodeURIComponent(newId)}/close`, {});
      expect([done.status(), ((await done.json()) as any).status], 'and closes').toEqual([200, 'CLOSED']);
    }

    // The manager login: only roles they are hiring manager of (Senior accountant is seeded that way); not Fleet controller.
    const ml = await api(manager, 'GET', '/v1/roles');
    expect(ml.status(), 'the manager login lists roles').toBe(200);
    const mine = (((await ml.json()) as any).roles ?? []) as any[];
    expect(mine.every((x) => x.hiring_manager_id === managerId), 'only their own').toBe(true);
    expect(mine.map((x) => x.job_title), 'Senior accountant is one of them').toContain('Senior accountant');
    expect((await api(manager, 'GET', `/v1/roles/${encodeURIComponent(fleet.role_id)}`)).status(), 'Fleet controller is 404 for them').toBe(404);

    // Company B: 404 on A's role, and an empty list for its candidates.
    expect((await api(companyB, 'GET', `/v1/roles/${encodeURIComponent(fleet.role_id)}`)).status(), 'the company B login gets 404 on A\'s role').toBe(404);
    const bl = await api(companyB, 'GET', `/v1/candidates?role_id=${encodeURIComponent(fleet.role_id)}`);
    expect([bl.status(), (((await bl.json()) as any).candidates ?? []).length], 'and an empty list of its candidates').toEqual([200, 0]);

    // The real preflight from the new app's address (LESSONS NH-187): the header the page sends is allowed.
    const origins = [...new Set([new URL(env('E2E_BASE_URL') || 'http://127.0.0.1:4300').origin, 'http://localhost:4300'])];
    for (const origin of origins) {
      const pre = await page.request.fetch(`${tfApi}/v1/roles`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key' } });
      expect(pre.status(), `the preflight from ${origin} passes`).toBeLessThan(300);
      const h = pre.headers();
      expect(h['access-control-allow-origin'], `it lets ${origin} in`).toBe(origin);
      expect((h['access-control-allow-headers'] ?? '').toLowerCase(), 'with idempotency-key').toContain('idempotency-key');
    }
    void [A, B, OPEN, sagaOf, readTfLocals];
  });
});

/** The talent-flow-infra locals blocks as text (the CORS list may sit in a local). */
function readTfLocals(stack: Stack): string {
  return blocks(filesOf(stack), 'locals').map((b) => b.body).join('\n');
}
