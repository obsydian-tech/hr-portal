import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ON_DEV, expect, test } from './support/fixtures';
import { REPO } from './support/rec-14/lambda-harness';
import { answerSchema, checker, looseObjects, operation, readDoc, refName, type Doc } from './support/rec-14/schema';
import { attributes } from './support/infra-harness';
import { lambdaNamed, resourcesOf, valueOf } from './support/rec-04/iam';
import { C, NOT_RECRUITERS, RECRUITERS } from './support/rec-04/callers';
import { bodyOf, describe, isModulesRead, statusOf } from './support/rec-04/world';
import { R, anyWrite, awsOf, changedRows, logsOf, roleOf, rolesIn } from './support/rec-04/roles';
import {
  A, B, DEP, HIRING_MANAGERS_FILE, HM_GROUPS, LIST_A, LIST_B, P, ROLES_TABLE, ROUTE, SHARED, SUB, TENANTS, VERSION, X,
  activeNames, baseWorld, expectedManagers, helper, hiringManagersRoute, member, noList, noSettings, open, options, pool, role, roleRow, roles, rowsOf, settingOf,
  withList, withSettings, type Tables,
} from './support/rec-14.2/world';

/**
 * REC-14 step B · One checked answer for the Open a role page, and the role rule (red). Spec: /mnt/project-files/onboarding-cards/specs/REC-14.md
 * (Part 2 rules 10 to 13, Part 3 rule 14 and 15, AC-5, AC-6 and the Lambda half of AC-7). Notes: cards/rec-14.md. Review page:
 * onboarding-cards/specs/REC-14-step-B-tests-for-review.md (the bar).
 *
 * Scope (coordinator, 22 Nov 2026): this lock covers step B only. Step A (the departments store) is merged (PR 490, locks rec-14, rec-14.1,
 * ten-04.8). The page and the fake harness (AC-7 UI half, AC-8 to AC-10, AC-12, AC-13) are step C; the old free-text departments are step D.
 * Child locks that carry this step: rec-04.2 (rec-04's own tests send `department_id`), ten-04.9 (a walk row for the options route).
 *
 * The Lambda tests run the real handlers (lambda/manageRoles, lambda/getHiringManagers) and the real shared module in a fresh Node process
 * each call, against REC-14's fake AWS (support/rec-14/fake-aws) over REC-04's world with REC-14's department lists added (support/rec-14.2).
 * Every answer a test gets is checked against api/openapi.yaml (rule 15). The files are read as text for the Terraform route and the one
 * place that lists hiring managers. Nothing calls AWS or any AI. Nothing here has a screen width: each test runs once, at 1280.
 *
 * Pinned by the verifier where the spec is silent (each is in cards/rec-14.md for the BA to confirm):
 *  - D-T-B1 GET /v1/roles/options answers exactly { departments, levels, criteria, panel_size_by_level, screening, hiring_managers } and nothing
 *    else. departments are { id, name } (no status), the company's ACTIVE ones sorted by name ignoring case; levels are { key, label, order }
 *    sorted by order; criteria are { key, label } in the stored order; panel_size_by_level is the company's PANEL_CONFIG.panelSize;
 *    screening is STAGE_CONFIG.screening. Each of the four settings falls back on the REC-12 default on its own (levels Junior, Mid, Senior;
 *    the four default criteria; panel sizes 2, 3, 4; screening true) when the company has none of that type. A company with no list gets
 *    departments []. The answer never carries an email, a group name, a status or a company id.
 *  - D-T-B2 Who: a Recruiter only (the same check as POST /v1/roles), then requireTenant, then requireModule('recruitment'), each before the
 *    next AWS call: a caller who is not a Recruiter, has no company, or whose company has Recruitment off gets 403 { error: 'Forbidden' }, and
 *    the last of those reads only the module row. A manager who is not a Recruiter is refused (the page is for opening a role).
 *  - D-T-B3 The company comes from the sign-in only: a company id in the query, headers or path parameters changes nothing.
 *  - D-T-B4 One failure path: when any read fails (the company list table, the settings table, the Member rows, the sign-in pool) the answer is
 *    500 { error: 'Something went wrong' } with no part of the options, no throw out of the handler, and the log carries the error's name only
 *    (not its message, a table name, a company id or a person's name). Failing the module read itself is not part of this step.
 *  - D-T-B5 Hiring managers (rule 12): lambda/shared/hiring-managers.mjs exports hiringManagersOf(tenantId) -> [{ id, name }], id the person's
 *    sign-in id (the Cognito sub), name given and family name joined by a space, sorted by name ignoring case, each person once even in two
 *    groups. A person is listed when they are CONFIRMED and enabled, in a hiring manager group (HIRING_MANAGER_GROUPS or HM_GROUP_NAME) and
 *    have a Member row for the company. A person with no Member row is never taken as the legacy company's (LEGACY_TENANT_ID is ignored).
 *    Every page of the pool is read. A failing pool or Member read fails the function (it rejects), never a shorter list. getHiringManagers
 *    keeps its answer shape ({ hiringManagers: [{ sub, email, givenName, familyName, name }] }) and lists exactly these people in this order.
 *  - D-T-B6 POST /v1/roles takes department_id (an ACTIVE department of the caller's company). Any other value (another company's, archived,
 *    made up, not text, missing; a body with only the old `department` text) is 400 { error: 'Bad request', code: 'INVALID_DEPARTMENT' } with
 *    no `field`, nothing written, the same words for every case. The row stores department_id and department (the name at that moment). A
 *    `department` text in the body is ignored. The order of checks between a bad department and a bad hiring manager is not pinned.
 *  - D-T-B7 Every role answer (GET /v1/roles, GET /v1/roles/{id}, the 201) has `department` = the current name of its department_id (an
 *    archived department keeps its name), or the stored text when the role has no department_id, and then no `department_id` key at all.
 *    GET /v1/roles reads the company's list at most once. Reading writes nothing.
 *  - D-T-B8 api/openapi.yaml: components RoleOptions and Role (every object closed with additionalProperties: false and every property
 *    required, except a Role's department_id, closed_at and closed_by); GET /v1/roles/options (200 RoleOptions, 403, 500; x-tenant token,
 *    x-roles [perm-recruitment]); GET /v1/roles 200 { roles: [Role] }; GET /v1/roles/{id} 200 Role; POST /v1/roles with a request body of
 *    exactly job_title, department_id, level, hiring_manager_id, criteria, panel_size (the first four required, nothing else allowed), 201 Role,
 *    400, 403, 500; GET /v1/config marks configType required.
 *  - D-T-B9 The route is `GET /v1/roles/options` on the TalentFlow API, JWT, on the manageRoles Lambda, next to the other four role routes.
 *    No IAM or key change is pinned: manageRoles already reads the company list table (modules, Member rows) and the pool (rec-04 AC-8 judges
 *    its grants and stays as it is).
 */

const once = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the code against a fake AWS or reads files.');
  test.skip(projectName !== 'desktop-1280', 'Runs once: nothing here has a screen width.');
};
const FORBIDDEN = { error: 'Forbidden' };
const SOMETHING = { error: 'Something went wrong' };
const bad = (code: string) => ({ error: 'Bad request', code });
const BAD_DEPARTMENT = bad('INVALID_DEPARTMENT');
const BAD_HM = bad('INVALID_HIRING_MANAGER');
const answer = (r: { response?: any }) => [statusOf(r as any), bodyOf(r as any)];
const GOOD = { job_title: 'Night dispatcher', department_id: DEP.opsA.id, level: 'MID', hiring_manager_id: SUB.hmA };
const DEFAULTS = {
  levels: [{ key: 'JUNIOR', label: 'Junior', order: 1 }, { key: 'MID', label: 'Mid', order: 2 }, { key: 'SENIOR', label: 'Senior', order: 3 }],
  criteria: [{ key: 'technical', label: 'Technical' }, { key: 'communication', label: 'Communication' }, { key: 'culturalFit', label: 'Cultural fit' }, { key: 'problemSolving', label: 'Problem solving' }],
  panel: { JUNIOR: 2, MID: 3, SENIOR: 4 },
};
/** The four settings a company's options answer reads, as stored. */
const levelsOf = (d: any) => [...(d?.levels ?? DEFAULTS.levels)].sort((x: any, y: any) => x.order - y.order).map((l: any) => ({ key: l.key, label: l.label, order: l.order }));
const criteriaOf = (d: any) => (d?.defaultCriteria ?? DEFAULTS.criteria).map((c: any) => ({ key: c.key, label: c.label }));
const optionsOf = (t: Tables, c: string, deps: typeof LIST_A | undefined, users = pool()) => ({
  departments: activeNames(deps ?? []),
  levels: levelsOf(settingOf(t, c, 'SENIORITY_PROFILES')),
  criteria: criteriaOf(settingOf(t, c, 'SCORING_WEIGHTS')),
  panel_size_by_level: settingOf(t, c, 'PANEL_CONFIG')?.panelSize ?? DEFAULTS.panel,
  screening: settingOf(t, c, 'STAGE_CONFIG')?.screening ?? true,
  hiring_managers: expectedManagers(users, t, c),
});
const KEYS = ['criteria', 'departments', 'hiring_managers', 'levels', 'panel_size_by_level', 'screening'];

// ---------------------------------------------------------------- the contract (rules 14 and 15)

let docCache: Doc | undefined;
const doc = () => (docCache ??= readDoc());
/** Problems of one answer against the file's schema for its route and status (empty when it fits). */
function misfit(route: string, r: { response?: any }): string[] {
  const s = statusOf(r as any);
  if (s === undefined) return [`no answer (${describe(r as any)})`];
  return checker(doc()).check(answerSchema(doc(), route, s), bodyOf(r as any)).map((p) => `${route} ${s}: ${p}`);
}
/** Every answer passes the file's schema for its route and status. */
const fits = (route: string, label: string, ...runs: { response?: any }[]) => {
  for (const r of runs) expect.soft(misfit(route, r), `${label}: the answer (${describe(r as any).slice(0, 120)}) passes api/openapi.yaml`).toEqual([]);
};

/** The code of a file, or '' when there is none. */
const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
/** Comments blanked out, strings kept. */
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
const code = (p: string) => stripJs(read(p));
const LAMBDA = join(REPO, 'lambda');

/** Nothing written: no write call, and no row of any table is different. */
const noWrite = (label: string, before: Tables, r: { calls: any[]; tables: Tables }) => {
  expect.soft(anyWrite(r as any).length, `${label}: no write call`).toBe(0);
  expect.soft(changedRows(before, r.tables).map((x) => `${x['table']} ${x['pk'] ?? x['PK']} ${x['sk'] ?? x['SK']}`), `${label}: no row is different`).toEqual([]);
};

// ---------------------------------------------------------------- tests

test.describe('REC-14 step B · Options for the Open a role page, and the role rule', () => {
  test('Control: the world is good: both lists and the pool are there, today\'s role routes answer, B cannot read A', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(3 * 60_000);
    const t = baseWorld();
    const list = (c: string) => rowsOf(t, TENANTS).find((r) => r['pk'] === `TENANT#${c}` && r['sk'] === 'DEPARTMENTS');
    expect.soft([list(A)?.['version'], list(B)?.['version']], 'the world holds A\'s and B\'s lists').toEqual([VERSION.A, VERSION.B]);
    expect.soft(expectedManagers(pool(), t, A).map((m) => m.name), 'A\'s hiring managers, by the picker\'s rule, sorted ignoring case').toEqual(
      ['adaeze Zulu', 'Pat sub-hm-a', 'Pat sub-hm2-a', 'Pat sub-rec-a', 'Pat sub-tick-a', 'Thabo Nkosi', 'Zodwa Mokoena']);
    expect.soft(expectedManagers(pool(), t, B).map((m) => m.id).sort(), 'B\'s hiring managers').toEqual([SUB.hmB, SUB.recB, X.twoB].sort());
    expect.soft(settingOf(t, A, 'SENIORITY_PROFILES')?.levels?.length, 'A holds the Standard pack').toBeGreaterThan(0);
    const mine = roles(C.recruiter, t);
    expect.soft(statusOf(mine), `today's GET /v1/roles answers a Recruiter (${describe(mine)})`).toBe(200);
    expect.soft((bodyOf(mine)?.roles ?? []).map((x: any) => x.role_id).sort(), 'A\'s four roles').toEqual([R.fleet, R.warehouse, R.accountant, R.closed].sort());
    expect.soft(statusOf(role(C.recruiterB, R.fleet, t)), 'B cannot read A\'s role').toBe(404);
  });

  // ---------------------------------------------------------------- AC-5 the options answer

  test('AC-5 One options answer: a Recruiter gets the company\'s active departments, levels, criteria, panel sizes, screening switch and hiring managers; the REC-12 default per setting; nothing else', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(8 * 60_000);
    const t = baseWorld();
    const want = optionsOf(t, A, LIST_A);
    expect.soft(want.departments.map((d) => d.name), 'the world: A\'s active departments, ignoring case, the archived one left out').toEqual(['aviation', 'Engineering', 'Finance', 'Fleet', 'Operations', 'People']);

    // Every kind of Recruiter gets the same answer, and it is the whole of rule 10.
    const first = options(C.recruiter, t);
    expect.soft(statusOf(first), `a Recruiter: 200 (${describe(first)})`).toBe(200);
    const body = bodyOf(first) ?? {};
    expect.soft(Object.keys(body).sort(), 'the answer holds exactly the six parts').toEqual(KEYS);
    expect.soft(body, 'A\'s options, as A\'s lists and settings give them').toEqual(want);
    expect.soft(body.departments?.every((d: any) => JSON.stringify(Object.keys(d).sort()) === JSON.stringify(['id', 'name'])), 'a department is { id, name } only (no status)').toBe(true);
    expect.soft(body.hiring_managers?.every((m: any) => JSON.stringify(Object.keys(m).sort()) === JSON.stringify(['id', 'name'])), 'a hiring manager is { id, name } only').toBe(true);
    expect.soft(body.hiring_managers?.map((m: any) => m.id), 'the id is the person\'s sign-in id').toEqual(expectedManagers(pool(), t, A).map((m) => m.id));
    expect.soft(body.hiring_managers?.length, 'the disabled manager, the unconfirmed one, the one with no place in A and B\'s people are not listed').toBe(7);
    const text = JSON.stringify(body);
    for (const leak of ['@', 'example.test', 'perm-recruitment', 'hr_staff', 'manager"', A, B, 'ten_', 'tenant', 'email', 'group', 'ARCHIVED', 'Old Stores', 'Bontle']) expect.soft(text, `the answer holds no "${leak}"`).not.toContain(leak);
    expect.soft(anyWrite(first).length, 'reading writes nothing').toBe(0);
    expect.soft(JSON.stringify(first.tables), 'and no table is different afterwards').toBe(JSON.stringify(t));
    fits(ROUTE.options, 'A\'s options', first);
    for (const who of RECRUITERS.slice(1)) {
      const r = options(who, t);
      expect.soft(answer(r), `${who.name}: the same answer`).toEqual([200, want]);
    }

    // The company's own settings come through; a type the company lacks falls back on its own default (D-T-B1).
    const custom = withSettings(t, A, {
      SENIORITY_PROFILES: { levels: [{ key: 'LEAD', label: 'Team lead', order: 2 }, { key: 'ASSOCIATE', label: 'Associate', order: 1 }] },
      PANEL_CONFIG: { panelSize: { LEAD: 5, ASSOCIATE: 2 }, guestAllowed: true, hrMayEnterForMember: true },
      SCORING_WEIGHTS: { scale: { min: 1, max: 5 }, defaultCriteria: [{ key: 'safety', label: 'Road safety' }, { key: 'punctuality', label: 'Punctuality' }], weights: null },
      STAGE_CONFIG: { screening: false },
    });
    const c1 = options(C.recruiter, custom);
    expect.soft(answer(c1), 'the company\'s own levels (by order), criteria, panel sizes and screening switch').toEqual([200, {
      ...want, levels: [{ key: 'ASSOCIATE', label: 'Associate', order: 1 }, { key: 'LEAD', label: 'Team lead', order: 2 }],
      criteria: [{ key: 'safety', label: 'Road safety' }, { key: 'punctuality', label: 'Punctuality' }], panel_size_by_level: { LEAD: 5, ASSOCIATE: 2 }, screening: false,
    }]);
    fits(ROUTE.options, 'custom settings', c1);
    const bare = noSettings(t, A);
    const c2 = options(C.recruiter, bare);
    expect.soft(answer(c2), 'no settings at all: the REC-12 defaults').toEqual([200, { ...want, levels: DEFAULTS.levels, criteria: DEFAULTS.criteria, panel_size_by_level: DEFAULTS.panel, screening: true }]);
    fits(ROUTE.options, 'default settings', c2);
    const off = withSettings(t, A, { STAGE_CONFIG: { screening: false } });
    const c3 = options(C.recruiter, off);
    expect.soft(answer(c3), 'only the screening switch is the company\'s own: the other three stay as the company has them').toEqual([200, { ...want, screening: false }]);
    // A company with no department list gets an empty list, not an error; one whose every department is archived too.
    const c4 = options(C.recruiter, noList(t, A));
    expect.soft(answer(c4), 'no list row: departments []').toEqual([200, { ...want, departments: [] }]);
    fits(ROUTE.options, 'no list', c4);
    const c5 = options(C.recruiter, withList(t, A, 3, LIST_A.map((d) => ({ ...d, status: 'ARCHIVED' as const }))));
    expect.soft(answer(c5), 'every department archived: departments []').toEqual([200, { ...want, departments: [] }]);
    // Sorted by name ignoring case, whatever the stored order.
    const c6 = options(C.recruiter, withList(t, A, 9, [...LIST_A].reverse()));
    expect.soft(bodyOf(c6)?.departments?.map((d: any) => d.name), 'sorted by name ignoring case, whatever order the list is stored in').toEqual(want.departments.map((d) => d.name));

    // Company B's Recruiter gets only B's (rule 10 and the company rule).
    const b = options(C.recruiterB, t);
    expect.soft(answer(b), 'B\'s Recruiter: B\'s departments and B\'s people').toEqual([200, optionsOf(t, B, LIST_B)]);
    expect.soft(JSON.stringify(bodyOf(b)), 'nothing of A in B\'s answer').not.toMatch(/Fleet|Finance|dep_01REC14A|sub-hm-a|sub-rec-a|Zulu/);
    fits(ROUTE.options, 'B\'s options', b);

    // The company comes from the sign-in only (D-T-B3).
    const forged = options(C.recruiter, t, { query: { tenant_id: B, tenantId: B, company: B }, headers: { 'x-tenant-id': B, tenant_id: B, 'x-company': B }, path: { tenant_id: B, id: B } });
    expect.soft(answer(forged), 'a company id in the query, headers or path changes nothing').toEqual([200, want]);
  });

  test('AC-5 Who may ask, in what order, and what a failed read does: Recruiters only; role, company and module before any other read; every failed read is 500 with no partial answer and no detail', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    const t = baseWorld();
    for (const who of NOT_RECRUITERS) {
      const r = options(who, t);
      expect.soft([...answer(r), awsOf(r).length], `${who.name}: 403 before any AWS call`).toEqual([403, FORBIDDEN, 0]);
    }
    for (const who of [C.employee, C.hmC1, C.adminOnly, C.hrNoTick]) fits(ROUTE.options, who.name, options(who, t));
    const none = options(C.recruiterNoCompany, t);
    expect.soft([...answer(none), awsOf(none).length], 'a Recruiter with no company: 403 before any AWS call').toEqual([403, FORBIDDEN, 0]);
    const token = options(C.recruiter, t, { claims: { token_use: 'access' } });
    expect.soft([...answer(token), awsOf(token).length], 'an access token is not a sign-in: 403 before any AWS call').toEqual([403, FORBIDDEN, 0]);
    const off = options(C.recruiterD, t);
    expect.soft(answer(off), 'Recruitment off: 403').toEqual([403, FORBIDDEN]);
    expect.soft(awsOf(off).filter((c: any) => !isModulesRead(c)).map((c: any) => `${c.service} ${c.op} ${c.table ?? ''}`), 'Recruitment off: only the module read happens (nothing of the options is read)').toEqual([]);
    fits(ROUTE.options, 'Recruitment off', off);

    // Any read that fails: 500 and nothing else. The first read is the module row, which is not this step's.
    const base = options(C.recruiter, t);
    const reads = (awsOf(base) as any[]).filter((c) => c.service === 'dynamodb');
    expect.soft(reads.length, 'the happy run reads the company list table and the settings table').toBeGreaterThan(3);
    const SECRET = 'rec14b-secret-detail Mokoena Bakeries ten_aaaaaaaaaaaaaaaaaaaaaaaaaa naleko-people-dev-tenants';
    reads.forEach((c, i) => {
      if (isModulesRead(c)) return;
      const f = options(C.recruiter, t, {}, { fail: { service: 'dynamodb', message: SECRET, name: 'InternalServerError', nth: i + 1 } });
      expect.soft(f.error, `read ${i + 1} (${c.op} ${String(c.table ?? '').replace(/^naleko-people-dev-/, '')}) fails: the handler does not throw`).toBeUndefined();
      expect.soft(answer(f), `read ${i + 1} (${c.op} ${String(c.table ?? '')}) fails: 500 and nothing of the options`).toEqual([500, SOMETHING]);
      expect.soft(logsOf(f).join('\n'), `read ${i + 1} fails: the log holds no message, table name, company or person`).not.toMatch(/secret-detail|Mokoena|ten_a|naleko-people/);
      fits(ROUTE.options, `read ${i + 1} fails`, f);
    });
    const cog = options(C.recruiter, t, {}, { cognitoFail: ['ListUsersInGroup'] });
    expect.soft(cog.error, 'the sign-in pool fails: the handler does not throw').toBeUndefined();
    expect.soft(answer(cog), 'the sign-in pool fails: 500 and no shorter list').toEqual([500, SOMETHING]);
    expect.soft(logsOf(cog).join('\n'), 'the pool failure: error name only (no message, pool or company)').not.toMatch(/unavailable|Rec01Fake|ten_a|Pat /);
    fits(ROUTE.options, 'the pool fails', cog);
    const noPool = options(C.recruiter, t, {}, { env: { HM_COGNITO_POOL_ID: '' } });
    expect.soft(answer(noPool), 'the pool is not set: 500').toEqual([500, SOMETHING]);
  });

  test('AC-5 One hiring manager rule: hiringManagersOf lists the picker\'s people; getHiringManagers keeps its shape and lists the same people; no legacy company fallback; every page; a failed read fails it', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(8 * 60_000);
    const t = baseWorld();
    expect.soft(existsSync(HIRING_MANAGERS_FILE), 'lambda/shared/hiring-managers.mjs exists (rule 12)').toBe(true);
    const ask = (company: string, tables = t, o: Parameters<typeof helper>[3] = {}) => helper(HIRING_MANAGERS_FILE, [{ fn: 'hiringManagersOf', args: [company] }], tables, o);
    const value = (h: ReturnType<typeof helper>) => (h.results[0]?.ok ? h.results[0].value : `(${h.importError?.message ?? JSON.stringify(h.results[0]?.error ?? 'no result')})`);
    expect.soft(ask(A).exports, 'the file exports hiringManagersOf').toContain('hiringManagersOf');
    expect.soft(value(ask(A)), 'A: the picker\'s people, { id, name }, sorted by name ignoring case, each once').toEqual(expectedManagers(pool(), t, A));
    expect.soft(value(ask(B)), 'B: B\'s people only').toEqual(expectedManagers(pool(), t, B));
    expect.soft(value(ask('ten_zzzzzzzzzzzzzzzzzzzzzzzzzz')), 'a company nobody belongs to: no one').toEqual([]);
    // The legacy company is no longer a way in (PROD-CATCH-UP P-4): a person with no Member row is not listed, whatever LEGACY_TENANT_ID says.
    const legacy = ask(A, t, { env: { LEGACY_TENANT_ID: A } });
    expect.soft(value(legacy), 'LEGACY_TENANT_ID set to A: a person with no Member row is still not listed').toEqual(expectedManagers(pool(), t, A));
    expect.soft(JSON.stringify(value(legacy)), 'the manager with no place in A is not there').not.toContain(P.noMemberHm);
    // The HM_GROUP_NAME setting names one more group.
    const fiona = { username: 'sub-fl-a', sub: 'sub-fl-a', status: 'CONFIRMED', enabled: true, attributes: { sub: 'sub-fl-a', email: 'fl@example.test', given_name: 'Fiona', family_name: 'Lee' }, groups: ['FleetLeads'] };
    const namedPool = [...pool(), fiona];
    const namedTables = structuredClone(t);
    namedTables[TENANTS] = [...(namedTables[TENANTS] ?? []), member('sub-fl-a', A)];
    const namedGroups = [...HM_GROUPS.filter((g) => g !== 'HiringManager'), 'FleetLeads'];
    expect.soft(value(ask(A, namedTables, { env: { HM_GROUP_NAME: 'FleetLeads' }, pool: namedPool })), 'HM_GROUP_NAME names the one extra group (Fiona is in, the HiringManager group is no longer one)').toEqual(expectedManagers(namedPool, namedTables, A, namedGroups));
    // Every page of the pool (60 a page).
    const many = Array.from({ length: 70 }, (_, i) => ({ username: `sub-many-${i}`, sub: `sub-many-${i}`, status: 'CONFIRMED', enabled: true, attributes: { sub: `sub-many-${i}`, email: `many${i}@example.test`, given_name: 'Many', family_name: `Person${String(i).padStart(2, '0')}` }, groups: ['manager'] }));
    const bigPool = [...pool(), ...many];
    const bigTables = structuredClone(t);
    bigTables[TENANTS] = [...(bigTables[TENANTS] ?? []), ...many.map((u) => member(u.sub, A))];
    const paged = ask(A, bigTables, { pool: bigPool });
    expect.soft(value(paged), 'seventy more managers: every page is read').toEqual(expectedManagers(bigPool, bigTables, A));
    expect.soft((value(paged) as any[]).length, 'the count').toBe(7 + 70);
    // A failed read fails the function: it rejects, never a shorter list.
    const failedPool = ask(A, t, { cognitoFail: ['ListUsersInGroup'] });
    expect.soft(failedPool.results[0]?.ok, 'the pool fails: the function rejects').toBe(false);
    const failedMembers = ask(A, t, { fail: { service: 'dynamodb', message: 'rec14b members unavailable' } });
    expect.soft(failedMembers.results[0]?.ok, 'the Member rows fail: the function rejects').toBe(false);

    // getHiringManagers keeps its own answer shape and lists the same people in the same order.
    const g = hiringManagersRoute(C.recruiter, t);
    expect.soft(statusOf(g), `getHiringManagers answers (${describe(g)})`).toBe(200);
    const gb = bodyOf(g) ?? {};
    expect.soft(Object.keys(gb), 'its answer is still { hiringManagers }').toEqual(['hiringManagers']);
    const wantG = expectedManagers(pool(), t, A).map((m) => {
      const u = pool().find((x) => x.sub === m.id)!;
      return { sub: u.sub, email: u.attributes['email'], givenName: u.attributes['given_name'], familyName: u.attributes['family_name'], name: m.name };
    });
    expect.soft(gb.hiringManagers, 'the same people in the same order, in the old shape (sub, email, givenName, familyName, name)').toEqual(wantG);
    const gl = hiringManagersRoute(C.recruiter, t, { env: { LEGACY_TENANT_ID: A } });
    expect.soft(bodyOf(gl)?.hiringManagers?.map((m: any) => m.sub), 'getHiringManagers too: no legacy fallback').toEqual(wantG.map((m) => m.sub));
    expect.soft(JSON.stringify(bodyOf(g)), 'it no longer lists the disabled manager').not.toContain(X.disabled);

    // One place: the pool is read in the shared file only, and the two readers call it (rule 12).
    const coreRoles = join(SHARED, 'recruitment-actions', 'roles.mjs');
    const handlers = [coreRoles, join(LAMBDA, 'manageRoles', 'index.mjs'), join(LAMBDA, 'getHiringManagers', 'index.js')];
    const shared = code(HIRING_MANAGERS_FILE);
    expect.soft(shared, 'the shared file reads the pool').toMatch(/ListUsersInGroup/);
    for (const f of handlers) expect.soft(code(f), `${f.replace(REPO, '')} does not read the pool itself`).not.toMatch(/ListUsersInGroup/);
    expect.soft(code(coreRoles), 'the role core takes its hiring managers from the shared file').toMatch(/hiring-managers\.mjs/);
    expect.soft(code(join(LAMBDA, 'getHiringManagers', 'index.js')), 'getHiringManagers takes its people from the shared file').toMatch(/hiring-managers\.mjs/);
    expect.soft(code(coreRoles), 'the legacy-company check is gone from the role core').not.toMatch(/companyOfSignIn/);
    for (const f of [HIRING_MANAGERS_FILE, ...handlers]) {
      expect.soft(code(f).match(/client-bedrock|bedrock-runtime|@anthropic-ai|anthropic|openai|ai-guard|BedrockRuntime|InvokeModel|Converse(Stream)?Command/gi) ?? [], `${f.replace(REPO, '')}: no model client`).toEqual([]);
    }
  });

  test('AC-5 The options route is on the TalentFlow API, signed in, on manageRoles, and in the file; the page\'s other routes are as they were', async ({}, testInfo) => {
    once(testInfo.project.name);
    const tf = 'talent-flow-infra' as const;
    const fn = lambdaNamed('manageRoles');
    expect(fn.length, 'one aws_lambda_function named manageRoles').toBe(1);
    const { stack, block } = fn[0]!;
    const integrations = resourcesOf(stack, 'aws_apigatewayv2_integration').filter((b) => (attributes(b.body).get('integration_uri') ?? '').includes(`aws_lambda_function.${block.labels[1]}.invoke_arn`)).map((b) => b.labels[1]);
    const routes = resourcesOf(stack, 'aws_apigatewayv2_route').map((b) => ({ key: valueOf(stack, attributes(b.body).get('route_key')).replace(/\s+/g, ''), auth: valueOf(stack, attributes(b.body).get('authorization_type')), target: attributes(b.body).get('target') ?? '', api: attributes(b.body).get('api_id') ?? '', authorizer: attributes(b.body).get('authorizer_id') ?? '' }));
    const r = routes.filter((x) => x.key === 'GET/v1/roles/options');
    expect.soft(stack, 'in the TalentFlow stack').toBe(tf);
    expect.soft(r.length, 'GET /v1/roles/options: one route').toBe(1);
    expect.soft(r[0]?.auth, 'signed in (JWT)').toBe('JWT');
    expect.soft(r[0]?.authorizer, 'with the TalentFlow API\'s authorizer').toContain('aws_apigatewayv2_authorizer.talent_flow_api_cognito');
    expect.soft(integrations.some((n) => r[0]?.target.includes(`aws_apigatewayv2_integration.${n}.id`)), 'on manageRoles').toBe(true);
    expect.soft(r[0]?.api, 'on the TalentFlow API').toContain('aws_apigatewayv2_api.talent_flow_api');
    expect.soft(resourcesOf('infra', 'aws_apigatewayv2_route').map((b) => valueOf('infra', attributes(b.body).get('route_key'))).filter((k) => /v1\/roles\/options/.test(k)), 'no options route on another API').toEqual([]);
    for (const k of ['GET/v1/roles', 'GET/v1/roles/{id}', 'POST/v1/roles', 'POST/v1/roles/{id}/close']) expect.soft(routes.filter((x) => x.key === k).length, `${k} stays`).toBe(1);
    expect.soft(routes.filter((x) => /^(GET|POST|PATCH|PUT|DELETE)\/v1\/roles\//.test(x.key)).length, 'three routes below /v1/roles/ (one, close, options)').toBe(3);
    expect.soft(existsSync(join(LAMBDA, 'manageRoles', 'index.mjs')) && /GET \/v1\/roles\/options/.test(code(join(LAMBDA, 'manageRoles', 'index.mjs'))), 'manageRoles routes GET /v1/roles/options').toBe(true);
    // The old page callers are not this step's; the Lambda for the old picker stays where it is.
    expect.soft(lambdaNamed('getHiringManagers').length, 'getHiringManagers stays (the old app still calls it)').toBe(1);
  });

  // ---------------------------------------------------------------- AC-6 offered equals accepted

  test('AC-6 Offered equals accepted: every department, level and hiring manager the options answer lists opens a role; archived, another company\'s, made-up and missing departments and people outside the picker are refused with nothing written', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(10 * 60_000);
    const t = baseWorld();
    const listed = bodyOf(options(C.recruiter, t)) ?? {};
    const deps: { id: string; name: string }[] = listed.departments ?? [];
    const levels: { key: string }[] = listed.levels ?? [];
    const people: { id: string; name: string }[] = listed.hiring_managers ?? [];
    expect.soft([deps.length, levels.length, people.length], 'the options answer lists six departments, three levels and seven people').toEqual([6, 3, 7]);

    // Everything offered is accepted, and the row keeps the department's id and its name at that moment (rule 11).
    for (const d of deps) {
      const r = open(C.recruiter, { ...GOOD, department_id: d.id }, t);
      expect.soft(statusOf(r), `department ${d.name}: 201 (${describe(r)})`).toBe(201);
      const stored = roleOf(r.tables, bodyOf(r)?.role_id) ?? {};
      expect.soft([stored['department_id'], stored['department']], `department ${d.name}: the row stores the id and the name`).toEqual([d.id, d.name]);
      expect.soft([bodyOf(r)?.department_id, bodyOf(r)?.department], `department ${d.name}: the answer carries both`).toEqual([d.id, d.name]);
      fits(ROUTE.open, `department ${d.name}`, r);
    }
    for (const l of levels) expect.soft(statusOf(open(C.recruiter, { ...GOOD, level: l.key }, t)), `level ${l.key}: 201`).toBe(201);
    for (const p of people) expect.soft(statusOf(open(C.recruiter, { ...GOOD, hiring_manager_id: p.id }, t)), `hiring manager ${p.name}: 201`).toBe(201);
    // B's Recruiter, B's department and B's people.
    const bo = bodyOf(options(C.recruiterB, t)) ?? {};
    const bOk = open(C.recruiterB, { ...GOOD, department_id: bo.departments?.[0]?.id, hiring_manager_id: bo.hiring_managers?.[0]?.id }, t);
    expect.soft(statusOf(bOk), `B's Recruiter opens a role with what B's options offer (${describe(bOk)})`).toBe(201);
    expect.soft(roleOf(bOk.tables, bodyOf(bOk)?.role_id)?.['tenant_id'], 'it is company B\'s').toBe(B);

    // What is not offered is refused with one answer, whatever the reason, and nothing is written (D-T-B6).
    const departmentCases: [string, Record<string, unknown>][] = [
      ['an archived department', { ...GOOD, department_id: DEP.storesA.id }], ['company B\'s department', { ...GOOD, department_id: DEP.engB.id }],
      ['company B\'s other department', { ...GOOD, department_id: DEP.dispatchB.id }], ['an id nobody has', { ...GOOD, department_id: 'dep_01REC14A000000000000000099' }],
      ['a made-up word', { ...GOOD, department_id: 'dep_nope' }], ['the department\'s name instead of its id', { ...GOOD, department_id: 'Operations' }],
      ['an empty id', { ...GOOD, department_id: '' }], ['an id that is a number', { ...GOOD, department_id: 7 }], ['an id that is null', { ...GOOD, department_id: null }],
      ['an id that is a list', { ...GOOD, department_id: [DEP.opsA.id] }], ['an id with spaces round it', { ...GOOD, department_id: ` ${DEP.opsA.id} ` }],
      ['an id in lower case', { ...GOOD, department_id: DEP.opsA.id.toLowerCase() }],
    ];
    const { department_id: _gone, ...noDepartment } = GOOD;
    departmentCases.push(['no department_id at all', noDepartment], ['only the old `department` text', { ...noDepartment, department: 'Operations' }]);
    const departmentBodies: string[] = [];
    for (const [what, body] of departmentCases) {
      const r = open(C.recruiter, body, t);
      expect.soft(answer(r), `${what}: 400 INVALID_DEPARTMENT`).toEqual([400, BAD_DEPARTMENT]);
      departmentBodies.push(String(r.response?.body ?? ''));
      noWrite(what, t, r);
      fits(ROUTE.open, what, r);
    }
    expect.soft(new Set(departmentBodies).size, 'every refusal has the same words: no hint whether the id exists').toBe(1);
    const aOnB = open(C.recruiterB, { ...GOOD, department_id: DEP.opsA.id, hiring_manager_id: SUB.hmB }, t);
    expect.soft(answer(aOnB), 'B\'s Recruiter with A\'s department: 400 INVALID_DEPARTMENT').toEqual([400, BAD_DEPARTMENT]);
    noWrite('B with A\'s department', t, aOnB);
    // A list that is gone, and one with nothing active: nothing to choose.
    for (const [what, tables] of [['a company with no list', noList(t, A)], ['a list with every department archived', withList(t, A, 4, LIST_A.map((d) => ({ ...d, status: 'ARCHIVED' as const })))]] as const) {
      const r = open(C.recruiter, GOOD, tables);
      expect.soft(answer(r), `${what}: 400 INVALID_DEPARTMENT`).toEqual([400, BAD_DEPARTMENT]);
      noWrite(what, tables, r);
    }

    // Hiring managers: the picker's rule, with no legacy company (rule 12; PROD-CATCH-UP P-4).
    const legacyEnv = { env: { LEGACY_TENANT_ID: A } };
    const hmCases: [string, unknown][] = [
      ['a disabled manager', X.disabled], ['a manager not yet confirmed', P.unconfirmedA], ['a manager with no place in company A (even with the legacy company set to A)', P.noMemberHm],
      ['company B\'s manager', SUB.hmB], ['an employee of A', P.employeeA], ['HR in A who is in no hiring manager group', X.hrOnly], ['a person nobody knows', 'sub-nobody-at-all'],
      ['no hiring manager', undefined], ['a hiring manager that is a number', 7],
    ];
    const hmBodies: string[] = [];
    for (const [what, hm] of hmCases) {
      const r = open(C.recruiter, { ...GOOD, hiring_manager_id: hm }, t, newKeyOf(), legacyEnv);
      expect.soft(answer(r), `${what}: 400 INVALID_HIRING_MANAGER`).toEqual([400, BAD_HM]);
      hmBodies.push(String(r.response?.body ?? ''));
      noWrite(what, t, r);
      fits(ROUTE.open, what, r);
    }
    expect.soft(new Set(hmBodies).size, 'every hiring manager refusal has the same words').toBe(1);
    const accepted = open(C.recruiter, GOOD, t, newKeyOf(), legacyEnv);
    expect.soft(statusOf(accepted), 'with the legacy company set, a listed manager is still accepted').toBe(201);
    expect.soft(statusOf(open(C.recruiterB, { ...GOOD, department_id: DEP.engB.id, hiring_manager_id: SUB.hmA }, t)), 'B\'s Recruiter with A\'s manager: refused').toBe(400);
    // A pool or Member read that fails is not an acceptance.
    const poolFails = open(C.recruiter, GOOD, t, newKeyOf(), { cognitoFail: ['ListUsersInGroup'] });
    expect.soft([statusOf(poolFails), rolesIn(poolFails.tables).length], 'the pool fails: not 201, no role written').toEqual([500, rolesIn(t).length]);
    expect.soft(poolFails.error, 'the pool fails: the handler does not throw').toBeUndefined();
    expect.soft(bodyOf(poolFails), 'the pool fails: the one 500').toEqual(SOMETHING);
  });

  test('AC-6 Roles show their department: the name follows a rename, an archived department keeps its name, an old role shows its text and has no department_id, a `department` text in the body is ignored', async ({}, testInfo) => {
    once(testInfo.project.name);
    test.setTimeout(8 * 60_000);
    const base = baseWorld();
    const RD = 'role-01REC14B0000000000000001', RA = 'role-01REC14B0000000000000002', RB = 'role-01REC14B0000000000000003';
    const t = structuredClone(base);
    t[ROLES_TABLE] = [
      ...(t[ROLES_TABLE] ?? []),
      roleRow(A, RD, SUB.hmA, { job_title: 'Depot lead', department_id: DEP.opsA.id, department: 'Operations' }),
      roleRow(A, RA, SUB.hm2A, { job_title: 'Store keeper', department_id: DEP.storesA.id, department: 'Old Stores' }),
      roleRow(B, RB, SUB.hmB, { job_title: 'Yard lead', department_id: DEP.engB.id, department: 'Engineering' }),
    ];
    const pick = (r: { response?: any }, id: string) => {
      const x = (bodyOf(r as any)?.roles ?? []).find((y: any) => y.role_id === id);
      return x === undefined ? undefined : { department_id: x.department_id, department: x.department, hasId: 'department_id' in x };
    };
    // The list and the one-role read: an id and its name; an old role: its text and no id key (D-T-B7).
    const l = roles(C.recruiter, t);
    expect.soft(statusOf(l), `a Recruiter lists the roles (${describe(l)})`).toBe(200);
    expect.soft(pick(l, RD), 'a role with a department: the id and its name').toEqual({ department_id: DEP.opsA.id, department: 'Operations', hasId: true });
    expect.soft(pick(l, RA), 'an archived department keeps its name').toEqual({ department_id: DEP.storesA.id, department: 'Old Stores', hasId: true });
    expect.soft(pick(l, R.fleet), 'an old role: its stored text, no department_id key').toEqual({ department_id: undefined, department: 'Operations', hasId: false });
    expect.soft(pick(l, R.accountant), 'another old role').toEqual({ department_id: undefined, department: 'Finance', hasId: false });
    expect.soft(pick(l, RB), 'company B\'s role is not in A\'s list').toBeUndefined();
    expect.soft(anyWrite(l).length, 'reading writes nothing').toBe(0);
    const listReads = (awsOf(l) as any[]).filter((c) => c.service === 'dynamodb' && c.op === 'GetItem' && JSON.stringify(c.input?.Key ?? {}).includes('DEPARTMENTS'));
    expect.soft(listReads.length, 'the list is read at most once for the whole list of roles').toBeLessThanOrEqual(1);
    fits(ROUTE.list, 'GET /v1/roles', l);
    for (const [id, want] of [[RD, { department_id: DEP.opsA.id, department: 'Operations' }], [RA, { department_id: DEP.storesA.id, department: 'Old Stores' }], [R.fleet, { department: 'Operations' }]] as const) {
      const one = role(C.recruiter, id, t);
      const b = bodyOf(one) ?? {};
      expect.soft([statusOf(one), b.department, 'department_id' in b ? b.department_id : '(none)'], `GET /v1/roles/${id.slice(-3)}: the same as the list`).toEqual([200, want.department, 'department_id' in want ? want.department_id : '(none)']);
      fits(ROUTE.one, `GET one ${id.slice(-3)}`, one);
    }
    const mgr = roles(C.hmC1, t);
    expect.soft(pick(mgr, RD), 'a manager sees the name of their own role\'s department too').toEqual({ department_id: DEP.opsA.id, department: 'Operations', hasId: true });
    expect.soft(pick(mgr, RA), 'and not another manager\'s role').toBeUndefined();
    expect.soft(statusOf(role(C.recruiterB, RD, t)), 'B cannot read A\'s role').toBe(404);

    // A rename follows: the stored name on the role is not what is shown.
    const renamed = withList(t, A, VERSION.A + 1, LIST_A.map((d) => (d.id === DEP.opsA.id ? { ...d, name: 'Depot Operations' } : d)));
    const rl = roles(C.recruiter, renamed);
    expect.soft(pick(rl, RD), 'renamed: the list shows the new name').toEqual({ department_id: DEP.opsA.id, department: 'Depot Operations', hasId: true });
    expect.soft(bodyOf(role(C.recruiter, RD, renamed))?.department, 'renamed: the one-role read shows the new name').toBe('Depot Operations');
    expect.soft(roleOf(rl.tables, RD)?.['department'], 'and the stored text is not rewritten by a read').toBe('Operations');
    // An archived-later department, and a company with no list: the role keeps showing a name.
    const gone = noList(t, A);
    expect.soft(pick(roles(C.recruiter, gone), R.fleet)?.department, 'no list at all: an old role still shows its text').toBe('Operations');

    // Opening a role: the name and the id are stored and answered; a `department` text in the body is ignored.
    const made = open(C.recruiter, { ...GOOD, department_id: DEP.fleetA.id, department: 'Totally different words' }, t);
    expect.soft(statusOf(made), `a body with both: 201 (${describe(made)})`).toBe(201);
    const stored = roleOf(made.tables, bodyOf(made)?.role_id) ?? {};
    expect.soft([stored['department_id'], stored['department']], 'stored: the id and the department\'s own name, never the body\'s text').toEqual([DEP.fleetA.id, 'Fleet']);
    expect.soft([bodyOf(made)?.department_id, bodyOf(made)?.department], 'answered: the same').toEqual([DEP.fleetA.id, 'Fleet']);
    const back = role(C.recruiter, bodyOf(made)?.role_id, made.tables);
    expect.soft([bodyOf(back)?.department_id, bodyOf(back)?.department], 'read back: the same').toEqual([DEP.fleetA.id, 'Fleet']);
    expect.soft(JSON.stringify(Object.keys(stored).filter((k) => /dep/i.test(k)).sort()), 'the row carries department_id and department only (no other department field)').toBe(JSON.stringify(['department', 'department_id']));
    const spaced = open(C.recruiter, { ...GOOD, department_id: DEP.aviationA.id }, t);
    expect.soft(roleOf(spaced.tables, bodyOf(spaced)?.role_id)?.['department'], 'the name is the list\'s, in its own letters').toBe('aviation');
    // The same key again gives the first answer (REC-04's rule), department fields included, and writes no second role.
    const key = newKeyOf();
    const one1 = open(C.recruiter, { ...GOOD, department_id: DEP.finA.id }, t, key);
    const two1 = open(C.recruiter, { ...GOOD, department_id: DEP.finA.id }, one1.tables, key);
    expect.soft(answer(two1), 'the same key again: the first answer').toEqual(answer(one1));
    expect.soft(rolesIn(two1.tables).length, 'and no second role').toBe(rolesIn(one1.tables).length);
    fits(ROUTE.open, 'the replay', two1);
  });

  // ---------------------------------------------------------------- AC-7 the contract (Lambda half)

  test('AC-7 The contract is written once in api/openapi.yaml: RoleOptions and Role closed schemas, the options route, the role routes and the POST body, configType required; the validator fails a planted answer', async ({}, testInfo) => {
    once(testInfo.project.name);
    const d = doc();
    const schemas = d.components?.schemas ?? {};
    for (const name of ['RoleOptions', 'Role', 'Department', 'DepartmentList']) expect.soft(Object.keys(schemas), `components has ${name}`).toContain(name);
    // The options route (rule 10 and 14).
    const op = operation(d, ROUTE.options);
    expect.soft(op, 'the file has GET /v1/roles/options').toBeTruthy();
    expect.soft(refName(answerSchema(d, ROUTE.options, 200)), '200 is RoleOptions').toBe('RoleOptions');
    for (const s of [403, 500]) expect.soft(answerSchema(d, ROUTE.options, s), `${s} has a JSON schema`).toBeTruthy();
    expect.soft([op?.['x-tenant'], op?.['x-roles']], 'the company comes from the sign-in; the Recruitment tick').toEqual(['token', ['perm-recruitment']]);
    const ro = schemas['RoleOptions'] ?? {};
    expect.soft(Object.keys(ro.properties ?? {}).sort(), 'RoleOptions holds the six parts').toEqual(KEYS);
    expect.soft([...(ro.required ?? [])].sort(), 'and requires every one').toEqual(KEYS);
    // Closed schemas (rule 14).
    const loose = (name: string) => looseObjects(d, { $ref: `#/components/schemas/${name}` }, name, new Set(), ['department_id', 'closed_at', 'closed_by']);
    // panel_size_by_level is a map from a level key to a whole number: its keys are the company's own, so it says what its values are instead.
    expect.soft(loose('RoleOptions').filter((m) => !/panel_size_by_level: an object without additionalProperties/.test(m)), 'RoleOptions: every object closed, every property required').toEqual([]);
    expect.soft(ro.properties?.panel_size_by_level?.additionalProperties?.type, 'panel_size_by_level: a map whose values are whole numbers').toBe('integer');
    expect.soft(loose('Role'), 'Role: every object closed, every property required but department_id, closed_at, closed_by').toEqual([]);
    expect.soft(looseObjects(d, { $ref: '#/components/schemas/Department' }), 'Department stays closed').toEqual([]);
    // The role routes (rule 14 and 11).
    const listSchema = answerSchema(d, ROUTE.list, 200);
    expect.soft(refName(listSchema?.properties?.roles?.items), 'GET /v1/roles: { roles: [Role] }').toBe('Role');
    expect.soft(refName(answerSchema(d, ROUTE.one, 200)), 'GET /v1/roles/{id}: Role').toBe('Role');
    expect.soft(refName(answerSchema(d, ROUTE.open, 201)), 'POST /v1/roles: 201 is Role').toBe('Role');
    for (const s of [400, 403, 500]) expect.soft(answerSchema(d, ROUTE.open, s), `POST /v1/roles: ${s} has a JSON schema`).toBeTruthy();
    const body = operation(d, ROUTE.open)?.requestBody?.content?.['application/json']?.schema;
    const bodyShape = body?.$ref ? schemas[refName(body) ?? ''] : body;
    expect.soft(Object.keys(bodyShape?.properties ?? {}).sort(), 'the POST body holds job_title, department_id, level, hiring_manager_id, criteria, panel_size (no department text)').toEqual(['criteria', 'department_id', 'hiring_manager_id', 'job_title', 'level', 'panel_size']);
    expect.soft([...(bodyShape?.required ?? [])].sort(), 'the first four are required').toEqual(['department_id', 'hiring_manager_id', 'job_title', 'level']);
    expect.soft(bodyShape?.additionalProperties, 'nothing else is allowed').toBe(false);
    // configType is required on GET /v1/config (the Lambda refuses a call without it).
    const cfg = (operation(d, 'GET /v1/config')?.parameters ?? []).find((p: any) => p.name === 'configType');
    expect.soft([cfg?.in, cfg?.required], 'GET /v1/config: configType is a required query parameter').toEqual(['query', true]);

    // The validator fails a planted answer (rule 15): a renamed part, a missing part, an added field, plain strings.
    const c = checker(d);
    const sample = { departments: [{ id: DEP.opsA.id, name: 'Operations' }], levels: [{ key: 'MID', label: 'Mid', order: 2 }], criteria: [{ key: 'technical', label: 'Technical' }], panel_size_by_level: { MID: 3 }, screening: true, hiring_managers: [{ id: 'sub-hm-a', name: 'Pat Dlamini' }] };
    const optionsSchema = answerSchema(d, ROUTE.options, 200);
    expect.soft(c.check(optionsSchema, sample), 'a good options answer passes').toEqual([]);
    const { hiring_managers: hm, departments: deps, ...rest } = sample;
    const plants: [string, unknown][] = [
      ['hiring_managers renamed', { ...rest, departments: deps, hiringManagers: hm }], ['departments dropped', { ...rest, hiring_managers: hm }], ['hiring_managers dropped', { ...rest, departments: deps }],
      ['a field added', { ...sample, email: 'a@b.test' }], ['an email in a hiring manager', { ...sample, hiring_managers: [{ id: 'x', name: 'Y', email: 'a@b.test' }] }],
      ['a status in a department', { ...sample, departments: [{ id: DEP.opsA.id, name: 'Operations', status: 'ACTIVE' }] }], ['departments as plain strings', { ...sample, departments: ['Operations'] }],
      ['a level order as text', { ...sample, levels: [{ key: 'MID', label: 'Mid', order: '2' }] }], ['screening as text', { ...sample, screening: 'true' }],
      ['a panel size as text', { ...sample, panel_size_by_level: { MID: '3' } }], ['a criterion with no label', { ...sample, criteria: [{ key: 'technical' }] }],
      ['nothing', {}], ['a list', []],
    ];
    for (const [what, bad] of plants) expect.soft(c.check(optionsSchema, bad).length > 0, `the validator fails a planted answer: ${what}`).toBe(true);
    const role1 = { role_id: 'role-1', job_title: 'Night dispatcher', department_id: DEP.opsA.id, department: 'Operations', level: 'MID', hiring_manager_id: 'sub-hm-a', criteria: [{ key: 'technical', label: 'Technical' }], panel_size: 3, status: 'OPEN', opened_at: '2026-11-22T08:00:00.000Z', opened_by: 'sub-rec-a', legacy: false, candidate_count: 0, overdue_count: 0, due_soon_count: 0 };
    const oneSchema = answerSchema(d, ROUTE.one, 200);
    expect.soft(c.check(oneSchema, role1), 'a good role passes').toEqual([]);
    const { department_id: _id, ...oldRole } = role1;
    expect.soft(c.check(oneSchema, oldRole), 'an old role (no department_id) passes').toEqual([]);
    expect.soft(c.check(oneSchema, { ...role1, closed_at: '2026-11-23T08:00:00.000Z', closed_by: 'sub-rec-a', status: 'CLOSED' }), 'a closed role passes').toEqual([]);
    expect.soft(c.check(listSchema, { roles: [role1, oldRole] }), 'a list of roles passes').toEqual([]);
    const { department: _dn, ...noName } = role1;
    for (const [what, bad] of [['department dropped', noName], ['department_id renamed', { ...oldRole, departmentId: DEP.opsA.id }], ['a company id added', { ...role1, tenant_id: A }], ['the count as text', { ...role1, candidate_count: '0' }]] as const) {
      expect.soft(c.check(oneSchema, bad).length > 0, `the validator fails a planted role: ${what}`).toBe(true);
    }
    expect.soft(c.check(listSchema, { roles: [noName] }).length > 0, 'the validator fails a list with a planted role').toBe(true);
    const postBody = bodyShape ? { job_title: 'x', department_id: DEP.opsA.id, level: 'MID', hiring_manager_id: 'sub-hm-a' } : undefined;
    expect.soft(c.check(bodyShape, postBody), 'a good POST body passes the file\'s schema').toEqual([]);
    expect.soft(c.check(bodyShape, { ...postBody, department: 'Operations' }).length > 0, 'a POST body with the old `department` fails it').toBe(true);
    expect.soft(c.check(bodyShape, { job_title: 'x', level: 'MID', hiring_manager_id: 'sub-hm-a' }).length > 0, 'a POST body with no department_id fails it').toBe(true);
    // The test files in this folder are the only place the schema is read from: the app and harness half is step C.
    expect.soft(readdirSync(join(REPO, 'api')).includes('openapi.yaml'), 'api/openapi.yaml is where it is written').toBe(true);
  });
});

let keyN = 0;
/** A fresh Idempotency-Key for a test that sends several. */
function newKeyOf(): string {
  return `rec14b-spec-${process.pid}-${++keyN}-${Date.now()}`;
}
