import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { CognitoFake } from './support/cognito-fake';
import { ON_DEV, type SignInPage } from './support/fixtures';
import type { ModulesFake } from './support/mod-02/modules-fake';
import { readBoard, showStage } from './support/ang-01/gallery';
import {
  DEFAULT_CRITERIA, DEPT, WHO, answerProblems, companyIdIn, contract, depId, enter, expect, quiet, requestProblems, roleBodyProblems, test, watchErrors,
  type HireFake, type Options, type Who,
} from './support/rec-ui/harness';
import { REPO } from './support/rec-14/lambda-harness';
import { answerSchema, checker, readDoc } from './support/rec-14/schema';

/**
 * REC-14 step C · The Open a role page and the board read one checked answer (spec onboarding-cards/specs/REC-14.md, rules 16
 * to 24; AC-7 the UI half, AC-8, AC-9, AC-10, AC-12, AC-13). Red tier card; this step is the page.
 * Lock: acceptance-lock/rec-14.3 (this file and the step C note in cards/rec-14.md). It needs the child lock
 * acceptance-lock/rec-ui-01.2 (the shared fake: `world.options`, the api/openapi.yaml checks of rule 17). The builder merges
 * both, never copies them.
 *
 * Every UI test runs at 1280 and 390 wide against the fake API, unless it says why not. Nothing calls Bedrock or any paid AI.
 * AC-12 is the pepla-dev check (@pepla-dev, desktop, once).
 *
 * Decisions these tests pin where the spec is silent (D-T-C1 to D-T-C8, for the BA to confirm; also in cards/rec-14.md):
 *   D-T-C1 The Department and Hiring manager selects start on their placeholders "Choose a department" and "Choose a hiring
 *          manager" (the design system select's placeholder option); Seniority level starts on the first level by `order`.
 *   D-T-C2 While the options call is out, nothing can be sent: "Open a role" is absent or disabled.
 *   D-T-C3 W-1 is a danger section message whose words are exactly "Role choices could not be loaded.", with a "Try again"
 *          button; while it shows, no field of the form is on the page.
 *   D-T-C4 W-2 and W-3 are shown as text on the page while the list is empty (where on the form is the builder's), and
 *          the empty select keeps only its placeholder.
 *   D-T-C5 After a 400 or 409 the page reads the options once more (two options calls in all), keeps the title, level and panel
 *          size, keeps a chosen department or manager only while the new answer still offers it, and the next attempt carries
 *          a new key. A 403 or 500 on the POST does not reload the options.
 *   D-T-C6 The generated types: pepla-web `npm run api:types` runs openapi-typescript on ../api/openapi.yaml into
 *          src/app/core/api/openapi.d.ts; the committed file equals `npx openapi-typescript ../api/openapi.yaml` output; a
 *          workflow under .github/workflows runs `npm run api:types` and then `git diff --exit-code` on that file.
 *   D-T-C7 hire-api.ts takes RoleOptions and Role from that file (components['schemas']); no `HireConfig` is left in src/app.
 *   D-T-C8 A runtime schema check of the options answer in development builds: an answer whose departments are plain strings
 *          (or with no hiring_managers) shows W-1, like a failed call.
 */

const phone = () => test.info().project.name === 'phone-390';
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');
const once = () => test.skip(test.info().project.name !== 'desktop-1280', 'A file check: once, at one width.');

// ---------------------------------------------------------------- the words (spec W-1 to W-3, approved U-2, kit labels)
const W1 = 'Role choices could not be loaded.';
const W2 = 'No departments yet. Ask an Admin to add one.';
const W3 = 'No hiring managers yet. Ask an Admin to give someone the manager role.';
const CHOOSE_DEPARTMENT = 'Choose a department';
const CHOOSE_MANAGER = 'Choose a hiring manager';
const SAVE_FAIL = 'Your change could not be saved. Try again.';
const LABELS = ['Job title', 'Department', 'Seniority level', 'Hiring manager', 'What the panel scores', 'Panel size'];

const PEPLA_WEB = join(REPO, 'pepla-web');
const read = (...p: string[]) => readFileSync(join(REPO, ...p), 'utf8');

// ---------------------------------------------------------------- helpers

type Fx = { page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null };
const fxOf = (a: { page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null }): Fx => a;

const h1 = (page: Page): Locator => page.locator('main h1').first();
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const openButton = (page: Page) => page.getByRole('button', { name: 'Open a role', exact: true });
const optionsCalls = (hire: HireFake) => hire.to('GET', /\/v1\/roles\/options$/);
const posts = (hire: HireFake) => hire.to('POST', /\/v1\/roles$/);

/** The visible words of a select's options, in order. */
const optionTexts = async (page: Page, label: string) => (await field(page, label).locator('option').allTextContents()).map((t) => t.trim());
/** The words of the chosen option. */
const chosen = (page: Page, label: string) => field(page, label).evaluate((el) => ((el as HTMLSelectElement).selectedOptions?.[0]?.textContent ?? '').trim());

async function pick(page: Page, label: string, option: string): Promise<void> {
  await field(page, label).selectOption({ label: option });
}

/** Signs in as a Recruiter and opens Open a role by its address; answers the index of the first call the page made. */
async function openForm(fx: Fx, who: Who = WHO.recruiterA, wait = true): Promise<number> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
  const from = fx.hire!.calls.length;
  await fx.page.goto('/hire/roles/new');
  await expect(h1(fx.page)).toHaveText('Open a role');
  if (wait) await expect(field(fx.page, 'Job title')).toBeVisible();
  return from;
}

/** Fills the form to a sendable state. */
async function fill(page: Page, title = 'Yard planner', department = 'Fleet', manager = 'Farai Chikwanha'): Promise<void> {
  await field(page, 'Job title').fill(title);
  await pick(page, 'Department', department);
  await pick(page, 'Hiring manager', manager);
}

/** A second fixture: other names, levels given out of order (the page sorts by `order`), other panel sizes. */
const OTHER: Options = {
  departments: [{ id: depId(41), name: 'Bakery' }, { id: depId(42), name: 'Logistics' }, { id: depId(43), name: 'Quality' }],
  levels: [{ key: 'LEAD', label: 'Lead', order: 3 }, { key: 'TRAINEE', label: 'Trainee', order: 1 }, { key: 'SKILLED', label: 'Skilled', order: 2 }],
  criteria: [{ key: 'safety', label: 'Safety record' }, { key: 'routes', label: 'Route knowledge' }],
  panel_size_by_level: { TRAINEE: 1, SKILLED: 3, LEAD: 5 },
  screening: true,
  hiring_managers: [{ id: 'hm-bheki', name: 'Bheki Ntuli' }, { id: 'hm-zodwa', name: 'Zodwa Hlatshwayo' }],
};

// ================================================================ AC-7 Contract checks (the UI half)
test.describe('AC-7 Contract checks, the app and the fake', () => {
  test('AC-7 The app\'s types are generated from api/openapi.yaml: the committed openapi.d.ts is current, and a planted edit to the file makes it stale', async () => {
    once();
    test.setTimeout(3 * 60_000);
    const committed = join(PEPLA_WEB, 'src', 'app', 'core', 'api', 'openapi.d.ts');
    let file = '';
    try { file = readFileSync(committed, 'utf8'); } catch { /* the check below says so */ }
    expect(file, 'pepla-web/src/app/core/api/openapi.d.ts is committed').not.toBe('');
    const pkg = JSON.parse(read('pepla-web', 'package.json'));
    expect(pkg.devDependencies?.['openapi-typescript'], 'openapi-typescript is a dev dependency of pepla-web').toBeTruthy();
    expect(String(pkg.scripts?.['api:types'] ?? ''), 'npm run api:types makes the file from ../api/openapi.yaml (D-T-C6)').toMatch(/openapi-typescript\s+\.\.\/api\/openapi\.yaml\s+(-o|--output)\s+src\/app\/core\/api\/openapi\.d\.ts/);
    const gen = (yaml: string) => execFileSync('npx', ['--no-install', 'openapi-typescript', yaml], { cwd: PEPLA_WEB, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const fresh = gen('../api/openapi.yaml');
    expect(fresh.trimEnd() === file.trimEnd(), 'the committed openapi.d.ts is what openapi-typescript makes from api/openapi.yaml today').toBe(true);
    for (const name of ['RoleOptions', 'Role', 'Department', 'DepartmentList']) expect(file, `it holds ${name}`).toMatch(new RegExp(`\\b${name}: \\{`));
    // The check bites: a field added to RoleOptions without regenerating gives another file.
    const dir = mkdtempSync(join(tmpdir(), 'rec14c-'));
    const planted = read('api', 'openapi.yaml').replace(/(\n    RoleOptions:\n(?:.*\n)*?      properties:\n)/, '$1        planted_field:\n          type: string\n');
    expect(planted, 'the planted edit took').toContain('planted_field');
    writeFileSync(join(dir, 'openapi.yaml'), planted);
    expect(gen(join(dir, 'openapi.yaml')).trimEnd() === file.trimEnd(), 'a planted edit to api/openapi.yaml makes the committed file stale').toBe(false);
    // A CI step regenerates and fails on a difference (rule 16).
    const flows = readdirSync(join(REPO, '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f)).map((f) => read('.github', 'workflows', f));
    expect(flows.some((t) => /npm run api:types/.test(t) && /git diff --exit-code[^\n]*openapi\.d\.ts/.test(t)), 'a workflow runs npm run api:types and then git diff --exit-code on openapi.d.ts (D-T-C6)').toBe(true);
  });

  test('AC-7 The page cannot be compiled against another shape: hire-api.ts takes RoleOptions and Role from the generated file, and no page calls /v1/config or /v1/hiring-managers', async () => {
    once();
    const api = read('pepla-web', 'src', 'app', 'features', 'recruitment', 'hire-api.ts');
    expect(api, 'hire-api.ts imports the generated types').toMatch(/from\s+['"]\.\.\/\.\.\/core\/api\/openapi['"]/);
    expect(api, 'RoleOptions comes from the file').toMatch(/components\[['"]schemas['"]\]\[['"]RoleOptions['"]\]/);
    expect(api, 'Role comes from the file').toMatch(/components\[['"]schemas['"]\]\[['"]Role['"]\]/);
    let left = '';
    try { left = execFileSync('grep', ['-rln', '--include=*.ts', '\\bHireConfig\\b', join(PEPLA_WEB, 'src', 'app')], { encoding: 'utf8' }).trim(); } catch { left = ''; }
    expect(left, 'no HireConfig is left in src/app (D-T-C7)').toBe('');
    for (const f of ['open-role.page.ts', 'board.page.ts']) {
      const src = read('pepla-web', 'src', 'app', 'features', 'recruitment', f);
      expect(src, `${f} does not call /v1/config`).not.toMatch(/['"`]\/v1\/config/);
      expect(src, `${f} does not call /v1/hiring-managers`).not.toMatch(/\/v1\/hiring-managers/);
      expect(src, `${f} reads /v1/roles/options`).toMatch(/\/v1\/roles\/options/);
    }
  });

  test('AC-7 The fake refuses what the file refuses: a route it does not have, GET /v1/config with no configType; and it checks answers and the POST body', async () => {
    once();
    expect(requestProblems('GET', '/v1/config', {}), 'GET /v1/config with no configType').toEqual([expect.stringContaining('configType')]);
    expect(requestProblems('GET', '/v1/config', { configType: 'STAGE_CONFIG' })).toEqual([]);
    expect(requestProblems('GET', '/v1/roles/options', {})).toEqual([]);
    expect(requestProblems('GET', '/v1/candidates/old-system', {})).toEqual([]);
    expect(requestProblems('GET', '/v1/roles/nowhere/else', {}).length, 'a route the file does not have').toBe(1);
    expect(requestProblems('DELETE', '/v1/roles/role-fleet', {}).length, 'a method the file does not have').toBe(1);
    const good = structuredClone(OTHER);
    expect(answerProblems('GET /v1/roles/options', 200, good), 'a good answer passes').toEqual([]);
    const planted: Array<[string, (o: any) => unknown]> = [
      ['hiring_managers renamed', (o) => { o.hiringManagers = o.hiring_managers; delete o.hiring_managers; return o; }],
      ['departments dropped', (o) => { delete o.departments; return o; }],
      ['a field added', (o) => ({ ...o, company_id: 'tnt-a-4c1e9b27' })],
      ['departments as plain strings', (o) => ({ ...o, departments: o.departments.map((d: any) => d.name) })],
      ['a manager with an email', (o) => ({ ...o, hiring_managers: [{ ...o.hiring_managers[0], email: 'x@example.org' }] })],
    ];
    for (const [what, plant] of planted) expect(answerProblems('GET /v1/roles/options', 200, plant(structuredClone(OTHER))).length, `the checker fails an answer with ${what}`).toBeGreaterThan(0);
    expect(answerProblems('GET /v1/roles/options', 418, {}).length, 'an answer the file does not describe').toBeGreaterThan(0);
    expect(roleBodyProblems({ job_title: 'x', department_id: depId(1), level: 'MID', hiring_manager_id: 'hm' }), 'the new body').toEqual([]);
    expect(roleBodyProblems({ job_title: 'x', department: 'Finance', level: 'MID', hiring_manager_id: 'hm' }).length, 'the old body with department text').toBeGreaterThan(0);
    expect(roleBodyProblems({ job_title: 'x', department_id: depId(1), level: 'MID', hiring_manager_id: 'hm', tenant_id: 'tnt-a-4c1e9b27' }).length, 'a body with a company').toBeGreaterThan(0);
    // The fixture is the file's shape (rule 17: built from a fixture that is itself schema-checked).
    const doc = readDoc();
    expect(checker(doc).check({ $ref: '#/components/schemas/RoleOptions' }, OTHER)).toEqual([]);
    expect(contract().doc.paths?.['/v1/roles/options'], 'the harness reads the same file').toBeTruthy();
  });

  test('AC-7 A test whose fake answer breaks the schema is caught by the harness, and the page shows W-1 for it (D-T-C8)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    noBackendOnly();
    const fx = fxOf(args);
    const { page, hire } = fx;
    const errors = watchErrors(page);
    (hire!.world.options.A as any).departments = ['Fleet', 'Stores'];
    await openForm(fx, WHO.recruiterA, false);
    await expect(page.locator('.pp-section-message').filter({ hasText: W1 })).toBeVisible();
    await expect(field(page, 'Job title')).toHaveCount(0);
    expect(hire!.contractErrors.some((e) => e.startsWith('GET /v1/roles/options 200')), `the harness wrote the broken answer down (${hire!.contractErrors.join(' | ').slice(0, 300)})`).toBe(true);
    expect(errors, 'no console error').toEqual([]);
    // The planted answer is this test's own: the harness caught it, so the test clears it and ends green.
    hire!.contractErrors.length = 0;
  });
});

// ================================================================ AC-8 The Open a role page
test.describe('AC-8 Open a role page', () => {
  test.beforeEach(noBackendOnly);

  test('AC-8 On open the page sends one GET /v1/roles/options and nothing else; no /v1/config, no /v1/hiring-managers', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { page, hire } = fx;
    const from = await openForm(fx);
    await quiet(page);
    const made = hire!.calls.slice(from).filter((c) => c.method !== 'OPTIONS').map((c) => `${c.method} ${c.path.slice(c.path.indexOf('/v1/'))}`);
    expect(made, 'one options call and nothing else').toEqual(['GET /v1/roles/options']);
    expect(companyIdIn(hire!.calls.at(-1)!), 'no company in it').toEqual([]);
  });

  test('AC-8 The fields show the answer: departments by name after "Choose a department", the first level chosen, managers after "Choose a hiring manager", the criteria labels and the panel size of that level', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { page } = fx;
    await openForm(fx);
    for (const label of LABELS) await expect(field(page, label), label).toBeVisible();
    expect(await optionTexts(page, 'Department')).toEqual([CHOOSE_DEPARTMENT, 'Engineering', 'Finance', 'Fleet', 'Operations', 'People']);
    expect(await chosen(page, 'Department'), 'Department starts empty').toBe(CHOOSE_DEPARTMENT);
    expect(await optionTexts(page, 'Seniority level')).toEqual(['Junior', 'Mid', 'Senior']);
    expect(await chosen(page, 'Seniority level'), 'the first level is chosen').toBe('Junior');
    expect(await optionTexts(page, 'Hiring manager')).toEqual([CHOOSE_MANAGER, 'Farai Chikwanha', 'Precious Mwale', 'Sipho Ndlovu']);
    expect(await chosen(page, 'Hiring manager'), 'Hiring manager starts empty').toBe(CHOOSE_MANAGER);
    await expect(field(page, 'What the panel scores')).toHaveValue(DEFAULT_CRITERIA.map((c) => c.label).join(', '));
    await expect(field(page, 'Panel size'), 'Junior panel size').toHaveValue('2');
  });

  test('AC-8 Another answer shows other values: other departments, levels in their order, other managers, criteria and panel size', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { page, hire } = fx;
    hire!.world.options.A = structuredClone(OTHER);
    await openForm(fx);
    expect(await optionTexts(page, 'Department')).toEqual([CHOOSE_DEPARTMENT, 'Bakery', 'Logistics', 'Quality']);
    expect(await optionTexts(page, 'Seniority level'), 'by order, not as listed').toEqual(['Trainee', 'Skilled', 'Lead']);
    expect(await chosen(page, 'Seniority level')).toBe('Trainee');
    expect(await optionTexts(page, 'Hiring manager')).toEqual([CHOOSE_MANAGER, 'Bheki Ntuli', 'Zodwa Hlatshwayo']);
    await expect(field(page, 'What the panel scores')).toHaveValue('Safety record, Route knowledge');
    await expect(field(page, 'Panel size')).toHaveValue('1');
    for (const old of ['Engineering', 'Sipho Ndlovu', 'Junior']) await expect(page.locator('main option', { hasText: old }), `no ${old}`).toHaveCount(0);
  });

  test('AC-8 Panel size follows the level until the person types a value, then stays', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { page } = fx;
    await openForm(fx);
    await pick(page, 'Seniority level', 'Senior');
    await expect(field(page, 'Panel size')).toHaveValue('4');
    await pick(page, 'Seniority level', 'Mid');
    await expect(field(page, 'Panel size')).toHaveValue('3');
    await field(page, 'Panel size').fill('6');
    await pick(page, 'Seniority level', 'Junior');
    await expect(field(page, 'Panel size'), 'a typed value stays').toHaveValue('6');
    await pick(page, 'Seniority level', 'Senior');
    await expect(field(page, 'Panel size')).toHaveValue('6');
  });

  test('AC-8 "Open a role" is disabled until a title, a department, a level and a hiring manager are chosen', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { page, hire } = fx;
    await openForm(fx);
    await expect(openButton(page), 'at the start').toBeDisabled();
    await field(page, 'Job title').fill('Yard planner');
    await expect(openButton(page), 'a title only').toBeDisabled();
    await pick(page, 'Department', 'Fleet');
    await expect(openButton(page), 'no hiring manager').toBeDisabled();
    await pick(page, 'Hiring manager', 'Farai Chikwanha');
    await expect(openButton(page), 'all four').toBeEnabled();
    await field(page, 'Job title').fill('   ');
    await expect(openButton(page), 'a blank title').toBeDisabled();
    await openButton(page).click({ force: true, timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    expect(posts(hire!), 'nothing sent').toHaveLength(0);
  });

  test('AC-8 While the options call is out nothing can be sent (D-T-C2)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { page, hire } = fx;
    hire!.refuse({ method: 'GET', path: /\/v1\/roles\/options$/, hold: true });
    await openForm(fx, WHO.recruiterA, false);
    await page.waitForTimeout(500);
    const button = openButton(page);
    if (await button.count()) await expect(button).toBeDisabled();
    hire!.release();
    await expect(field(page, 'Job title')).toBeVisible();
    await expect(field(page, 'Department').locator('option', { hasText: 'Fleet' })).toHaveCount(1);
    expect(posts(hire!)).toHaveLength(0);
  });

  test('AC-8 Submitting sends { job_title, department_id, level, hiring_manager_id, criteria, panel_size } once, one key, no company, and opens the new board', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { page, hire } = fx;
    await openForm(fx);
    await fill(page, 'Yard planner', 'Fleet', 'Precious Mwale');
    await pick(page, 'Seniority level', 'Mid');
    await field(page, 'What the panel scores').fill('Technical, Cultural fit, Forklift licence');
    await openButton(page).click();
    await expect(page).toHaveURL(/\/hire\/pipeline\?(?=.*role=role-new-1)(?=.*view=board)/);
    await expect(h1(page)).toHaveText('Yard planner');
    const sent = posts(hire!);
    expect(sent, 'exactly one POST').toHaveLength(1);
    expect(sent[0]!.body, 'the body').toEqual({
      job_title: 'Yard planner', department_id: DEPT.fleet.id, level: 'MID', hiring_manager_id: 'hm-precious',
      criteria: ['technical', 'culturalFit', 'Forklift licence'], panel_size: 3,
    });
    expect(sent[0]!.idempotencyKey, 'one Idempotency-Key').toMatch(/^[\w-]{8,}$/);
    expect(companyIdIn(sent[0]!), 'no company').toEqual([]);
    expect(hire!.world.roles.find((r) => r.role_id === 'role-new-1')?.department_id, 'the role has the department id').toBe(DEPT.fleet.id);
  });

  test('AC-8 Company B\'s Recruiter is offered only B\'s answer', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { page, hire, modules } = fx;
    modules!.answers['B'] = ['onboarding', 'recruitment'];
    await openForm(fx, WHO.recruiterB);
    expect(await optionTexts(page, 'Department')).toEqual([CHOOSE_DEPARTMENT, 'Dispatch', 'Stores']);
    expect(await optionTexts(page, 'Hiring manager')).toEqual([CHOOSE_MANAGER, 'Lindiwe Peters']);
    expect(optionsCalls(hire!).every((c) => c.company === 'B' && companyIdIn(c).length === 0)).toBe(true);
    // One name is still not chosen for the person (spec rule 20: "starting empty").
    expect(await chosen(page, 'Hiring manager'), 'one manager is not picked for the person').toBe(CHOOSE_MANAGER);
    await field(page, 'Job title').fill('Dispatch clerk');
    await pick(page, 'Department', 'Stores');
    await expect(openButton(page), 'no manager chosen yet').toBeDisabled();
  });

  test('AC-8 A list of one department is not picked for the person either', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { page, hire } = fx;
    hire!.world.options.A.departments = [DEPT.fleet];
    await openForm(fx);
    expect(await optionTexts(page, 'Department')).toEqual([CHOOSE_DEPARTMENT, 'Fleet']);
    expect(await chosen(page, 'Department'), 'one department is not picked for the person').toBe(CHOOSE_DEPARTMENT);
    await field(page, 'Job title').fill('Yard planner');
    await pick(page, 'Hiring manager', 'Farai Chikwanha');
    await expect(openButton(page), 'no department chosen yet').toBeDisabled();
  });
});

// ================================================================ AC-9 Page failures
test.describe('AC-9 Page failures', () => {
  test.beforeEach(noBackendOnly);

  const FAILURES: Array<[string, { status?: number; abort?: boolean; body?: unknown }]> = [
    ['no answer', { abort: true }], ['a 403', { status: 403, body: { error: 'Forbidden' } }], ['a 500', { status: 500, body: { error: 'Something went wrong' } }],
  ];
  for (const [label, how] of FAILURES) {
    test(`AC-9 The options call failing with ${label} shows W-1 and Try again, no form and no console error; Try again recovers`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
      const fx = fxOf(args);
      const { page, hire } = fx;
      const errors = watchErrors(page);
      hire!.refuse({ method: 'GET', path: /\/v1\/roles\/options$/, ...how });
      await openForm(fx, WHO.recruiterA, false);
      const message = page.locator('.pp-section-message').filter({ hasText: W1 });
      await expect(message).toBeVisible();
      await expect(message, 'a danger message (D-T-C3)').toHaveClass(/danger/);
      for (const l of LABELS) await expect(field(page, l), `no ${l} field`).toHaveCount(0);
      await expect(openButton(page)).toHaveCount(0);
      expect(optionsCalls(hire!)).toHaveLength(1);
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(field(page, 'Job title')).toBeVisible();
      expect(optionsCalls(hire!), 'Try again sends the call once more').toHaveLength(2);
      expect(await optionTexts(page, 'Department')).toContain('Fleet');
      await expect(page.getByText(W1, { exact: true })).toHaveCount(0);
      expect(errors, 'no console error, no thrown error').toEqual([]);
    });
  }

  test('AC-9 No departments: W-2 shows and the button stays disabled', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { page, hire } = fx;
    hire!.world.options.A.departments = [];
    await openForm(fx);
    await expect(page.getByText(W2, { exact: true })).toBeVisible();
    expect(await optionTexts(page, 'Department'), 'only the placeholder (D-T-C4)').toEqual([CHOOSE_DEPARTMENT]);
    await field(page, 'Job title').fill('Yard planner');
    await pick(page, 'Hiring manager', 'Farai Chikwanha');
    await expect(openButton(page)).toBeDisabled();
    await expect(page.getByText(W3, { exact: true })).toHaveCount(0);
  });

  test('AC-9 No hiring managers: W-3 shows and the button stays disabled', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { page, hire } = fx;
    hire!.world.options.A.hiring_managers = [];
    await openForm(fx);
    await expect(page.getByText(W3, { exact: true })).toBeVisible();
    expect(await optionTexts(page, 'Hiring manager')).toEqual([CHOOSE_MANAGER]);
    await field(page, 'Job title').fill('Yard planner');
    await pick(page, 'Department', 'Fleet');
    await expect(openButton(page)).toBeDisabled();
    await expect(page.getByText(W2, { exact: true })).toHaveCount(0);
  });

  const REFUSED: Array<[string, (o: Options) => void, 'Department' | 'Hiring manager']> = [
    ['INVALID_DEPARTMENT (the department was archived meanwhile)', (o) => { o.departments = o.departments.filter((d) => d.name !== 'Fleet'); }, 'Department'],
    ['INVALID_HIRING_MANAGER (the manager was removed meanwhile)', (o) => { o.hiring_managers = o.hiring_managers.filter((m) => m.name !== 'Farai Chikwanha'); }, 'Hiring manager'],
  ];
  for (const [label, change, gone] of REFUSED) {
    test(`AC-9 A POST refused with ${label} keeps the form, shows the save-failure line, reloads the options once, and the next attempt has a new key`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
      const fx = fxOf(args);
      const { page, hire } = fx;
      const errors = watchErrors(page);
      await openForm(fx);
      await fill(page, 'Yard planner', 'Fleet', 'Farai Chikwanha');
      await pick(page, 'Seniority level', 'Senior');
      await field(page, 'Panel size').fill('5');
      change(hire!.world.options.A); // the server's list changes after the page read it
      await openButton(page).click();
      await expect(page.getByText(SAVE_FAIL, { exact: true }).first()).toBeVisible();
      expect(posts(hire!)[0]!.status, 'the fake refused it').toBe(400);
      await expect(page).toHaveURL(/\/hire\/roles\/new$/);
      await expect.poll(() => optionsCalls(hire!).length, 'the options are read once more (D-T-C5)').toBe(2);
      await page.waitForTimeout(500);
      expect(optionsCalls(hire!), 'once, not more').toHaveLength(2);
      await expect(field(page, 'Job title')).toHaveValue('Yard planner');
      expect(await chosen(page, 'Seniority level')).toBe('Senior');
      await expect(field(page, 'Panel size')).toHaveValue('5');
      const what = gone === 'Department' ? 'Fleet' : 'Farai Chikwanha';
      expect(await optionTexts(page, gone), `${what} is no longer offered`).not.toContain(what);
      // The next attempt: choose again and send; a new key.
      if (gone === 'Department') await pick(page, 'Department', 'Operations'); else await pick(page, 'Hiring manager', 'Sipho Ndlovu');
      await openButton(page).click();
      await expect(page).toHaveURL(/role=role-new-1/);
      const sent = posts(hire!);
      expect(sent).toHaveLength(2);
      expect(sent[1]!.idempotencyKey, 'a new key').not.toBe(sent[0]!.idempotencyKey);
      expect((sent[1]!.body as any).job_title).toBe('Yard planner');
      expect(errors).toEqual([]);
    });
  }

  test('AC-9 A POST refused with a 409 is treated like a 400: form kept, save-failure line, options read once more, a new key next time', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { page, hire } = fx;
    const errors = watchErrors(page);
    await openForm(fx);
    await fill(page, 'Yard planner', 'Fleet', 'Farai Chikwanha');
    await field(page, 'Panel size').fill('5');
    hire!.refuse({ method: 'POST', path: /\/v1\/roles$/, status: 409, body: { error: 'Conflict' } });
    await openButton(page).click();
    await expect(page.getByText(SAVE_FAIL, { exact: true }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/hire\/roles\/new$/);
    await expect.poll(() => optionsCalls(hire!).length, 'the options are read once more after a 409 (rule 23)').toBe(2);
    await page.waitForTimeout(500);
    expect(optionsCalls(hire!), 'once, not more').toHaveLength(2);
    await expect(field(page, 'Job title')).toHaveValue('Yard planner');
    await expect(field(page, 'Panel size')).toHaveValue('5');
    expect(await chosen(page, 'Department'), 'a choice still offered is kept').toBe('Fleet');
    await openButton(page).click();
    await expect(page).toHaveURL(/role=role-new-1/);
    const sent = posts(hire!);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.idempotencyKey, 'a new key after a 409').not.toBe(sent[0]!.idempotencyKey);
    expect(errors).toEqual([]);
    // api/openapi.yaml describes no 409 for POST /v1/roles; spec rule 23 names one, so this test's planted 409 is allowed here (leftover for the BA).
    hire!.contractErrors.splice(0, hire!.contractErrors.length, ...hire!.contractErrors.filter((e) => !e.startsWith('POST /v1/roles 409')));
  });

  for (const [label, how] of [['a 403', { status: 403, body: { error: 'Forbidden' } }], ['a 500', { status: 500, body: { error: 'Something went wrong' } }]] as const) {
    test(`AC-9 A POST refused with ${label} keeps the form and does not read the options again (D-T-C5)`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
      const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
      const fx = fxOf(args);
      const { page, hire } = fx;
      await openForm(fx);
      await fill(page);
      hire!.refuse({ method: 'POST', path: /\/v1\/roles$/, ...how });
      await openButton(page).click();
      await expect(page.getByText(SAVE_FAIL, { exact: true }).first()).toBeVisible();
      await page.waitForTimeout(800);
      expect(optionsCalls(hire!), `no reload after ${label}`).toHaveLength(1);
      await expect(field(page, 'Job title')).toHaveValue('Yard planner');
      expect(await chosen(page, 'Department')).toBe('Fleet');
    });
  }

  test('AC-9 A dropped connection on the POST keeps the key and does not reload the options', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { page, hire } = fx;
    await openForm(fx);
    await fill(page);
    hire!.refuse({ method: 'POST', path: /\/v1\/roles$/, abort: true });
    await openButton(page).click();
    await expect(page.getByText(SAVE_FAIL, { exact: true }).first()).toBeVisible();
    await page.waitForTimeout(500);
    expect(optionsCalls(hire!), 'no reload after a dropped connection').toHaveLength(1);
    await openButton(page).click();
    await expect(page).toHaveURL(/role=role-new-1/);
    const sent = posts(hire!);
    expect(sent[1]!.idempotencyKey, 'the same key').toBe(sent[0]!.idempotencyKey);
  });
});

// ================================================================ AC-10 The board's Screening column
test.describe('AC-10 Board screening', () => {
  test.beforeEach(noBackendOnly);

  async function board(fx: Fx): Promise<{ scope: Locator; from: number }> {
    await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, WHO.recruiterA);
    const from = fx.hire!.calls.length;
    await fx.page.goto('/hire/pipeline?role=role-fleet&view=board');
    await expect(h1(fx.page)).toHaveText('Fleet controller');
    const scope = fx.page.locator('main');
    await expect(scope.locator('.pp-pipeline').first()).toBeVisible();
    return { scope, from };
  }
  /** The stage names the board offers: the column names on desktop, the picker's options on a phone. */
  async function stages(scope: Locator): Promise<string[]> {
    const picker = scope.getByLabel('Stage', { exact: true });
    if (await picker.isVisible()) return (await picker.locator('option').allTextContents()).map((t) => t.replace(/\s*\(\d+\)\s*$/, '').trim());
    return (await readBoard(scope)).map((c) => c.stage);
  }

  test('AC-10 Screening off in the options answer: four columns; the board reads it from /v1/roles/options, not /v1/config', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { hire } = fx;
    hire!.world.options.A.screening = false;
    for (const c of hire!.world.cands.filter((x) => x.stage === 'SCREENING')) c.stage = 'APPLIED';
    const { scope, from } = await board(fx);
    await expect.poll(() => stages(scope)).toEqual(['Applied', 'Interview', 'Offer', 'Hired']);
    const made = hire!.calls.slice(from).filter((c) => c.method === 'GET').map((c) => c.path.slice(c.path.indexOf('/v1/')));
    expect(made.filter((p) => p === '/v1/roles/options'), 'one options call').toHaveLength(1);
    expect(made.filter((p) => p.startsWith('/v1/config') || p.startsWith('/v1/hiring-managers')), 'no settings or picker call').toEqual([]);
  });

  test('AC-10 Screening on: five columns', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { scope } = await board(fx);
    await expect.poll(() => stages(scope)).toEqual(['Applied', 'Screening', 'Interview', 'Offer', 'Hired']);
    expect(optionsCalls(fx.hire!)).toHaveLength(1);
  });

  for (const [label, how] of [['a 500', { status: 500, body: { error: 'Something went wrong' } }], ['no answer', { abort: true }]] as const) {
    test(`AC-10 The options call failing (${label}): five columns, the board's data shows and no error line`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
      const fx = fxOf(args);
      const { page, hire } = fx;
      const errors = watchErrors(page);
      hire!.world.options.A.screening = false; // would hide Screening if the board had read it
      hire!.refuse({ method: 'GET', path: /\/v1\/roles\/options$/, ...how });
      const { scope } = await board(fx);
      await expect.poll(() => stages(scope)).toEqual(['Applied', 'Screening', 'Interview', 'Offer', 'Hired']);
      await showStage(scope, 'Applied');
      await expect(scope.locator('.pp-pipeline__card', { hasText: 'Amahle Dlamini' })).toBeVisible();
      await expect(page.locator('.pp-section-message'), 'no error line').toHaveCount(0);
      await expect(page.getByText(/could not be loaded/)).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
});

// ================================================================ AC-13 Phone and words
test.describe('AC-13 Phone and words', () => {
  test.beforeEach(noBackendOnly);

  async function everythingReachable(page: Page, where: string): Promise<void> {
    const problems = await page.evaluate(async () => {
      const out: string[] = [];
      const width = document.documentElement.clientWidth;
      const bar = document.querySelector('pp-top-navigation')?.getBoundingClientRect();
      const targets = [...document.querySelectorAll<HTMLElement>('main h1, main h2, main h3, main button, main a[href], main input, main select, main textarea, main label, main .pp-section-message')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert],[hidden],[aria-hidden="true"]');
      });
      for (const el of targets) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = el.getBoundingClientRect();
        const label = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
        if (r.left < -1 || r.right > width + 1) out.push(`${label} is cut off sideways (${Math.round(r.left)} to ${Math.round(r.right)})`);
        if (bar && r.top < bar.bottom - 1 && r.bottom > 0) out.push(`${label} is under the top bar`);
        const x = Math.min(Math.max(r.left + r.width / 2, 1), width - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        if (hit && !el.contains(hit) && !hit.contains(el) && !(['INPUT', 'SELECT', 'LABEL'].includes(el.tagName) && hit.closest('label,.pp-field,.pp-select')?.contains(el))) out.push(`${label} is covered by ${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}`);
      }
      window.scrollTo(0, 0);
      if (document.documentElement.scrollWidth > width + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide)`);
      return out;
    });
    expect(problems, where).toEqual([]);
  }

  test('AC-13 At 390 wide every heading, field and button of Open a role is visible and not under the top bar, in the form, W-1, W-2 and W-3', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    test.skip(!phone(), 'Phone only: the criterion is the 390 wide screen.');
    const fx = fxOf(args);
    const { page, hire } = fx;
    await openForm(fx);
    for (const l of LABELS) await expect(field(page, l)).toBeVisible();
    await everythingReachable(page, 'Open a role');
    hire!.world.options.A.departments = [];
    hire!.world.options.A.hiring_managers = [];
    await page.reload();
    await expect(page.getByText(W2, { exact: true })).toBeVisible();
    await everythingReachable(page, 'Open a role with W-2 and W-3');
    hire!.refuse({ method: 'GET', path: /\/v1\/roles\/options$/, status: 500, body: { error: 'Something went wrong' } });
    await page.reload();
    await expect(page.getByText(W1, { exact: true })).toBeVisible();
    await everythingReachable(page, 'Open a role with W-1');
  });

  test('AC-13 The page has only the kit\'s words, the approved lines and W-1 to W-3: exact placeholders, no Masked, no Claude, no "Select"', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const args = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const fx = fxOf(args);
    const { page, hire } = fx;
    const words = () => page.evaluate(() => {
      const out: string[] = [document.title, document.body.innerText];
      for (const el of document.querySelectorAll('[aria-label],[placeholder],[title],option,[alt]')) out.push(el.getAttribute('aria-label') ?? '', el.getAttribute('placeholder') ?? '', el.getAttribute('title') ?? '', el.getAttribute('alt') ?? '', el.tagName === 'OPTION' ? el.textContent ?? '' : '');
      return out.join('\n');
    });
    const clean = (text: string, where: string) => {
      expect(text, `${where}: no Masked`).not.toMatch(/\bmasked\b/i);
      expect(text, `${where}: no Claude`).not.toMatch(/\bclaude\b/i);
      expect(text, `${where}: no "Select ..." placeholder`).not.toMatch(/^\s*select\b/im);
      expect(text, `${where}: no raw keys or ids`).not.toMatch(/\bdep_[0-9A-Z]{6,}|\bhm-[a-z]+|\b(culturalFit|problemSolving)\b/);
    };
    await openForm(fx);
    const form = await words();
    clean(form, 'the form');
    for (const w of [CHOOSE_DEPARTMENT, CHOOSE_MANAGER, "From your company's default. Change it for this role if you need to."]) expect(form, `the form says "${w}"`).toContain(w);
    hire!.world.options.A.departments = [];
    hire!.world.options.A.hiring_managers = [];
    await page.reload();
    await expect(page.getByText(W3, { exact: true })).toBeVisible();
    clean(await words(), 'W-2 and W-3');
    hire!.refuse({ method: 'GET', path: /\/v1\/roles\/options$/, status: 403, body: { error: 'Forbidden' } });
    await page.reload();
    await expect(page.getByText(W1, { exact: true })).toBeVisible();
    const failed = await words();
    clean(failed, 'W-1');
    expect(failed, 'W-1 does not echo the server').not.toMatch(/Forbidden|Something went wrong|\b403\b|\b500\b/);
  });
});

// ================================================================ AC-12 pepla-dev
test.describe('AC-12 pepla-dev', () => {
  test('AC-12 @pepla-dev The Recruiter opens a role with a seeded department and the seeded hiring manager; the real answers pass the schema; B sees only B; the Admin adds and archives a test department', async ({ page, signIn, hr }, testInfo) => {
    test.skip(!ON_DEV, 'pepla-dev only: the no-backend run covers this in AC-7 to AC-10.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
    test.setTimeout(5 * 60_000);
    const env = (k: string) => process.env[k] ?? '';
    const login = (p: string) => ({ email: env(`${p}_EMAIL`), password: env(`${p}_PASSWORD`) });
    // E2E_TF is the dev Admin login (seed-dev.py "tf": admin), E2E_MANAGER the seeded hiring manager ("manager", PR 492).
    const logins = { hr: login('E2E_HR'), companyB: login('E2E_HR_B'), admin: login('E2E_TF'), manager: login('E2E_MANAGER') };
    for (const [who, l] of Object.entries(logins)) expect(l.email && l.password, `the ${who} test login is set`).toBeTruthy();
    const { devEnv } = await import('./support/ten-02/dev');
    const { api, region, clientId } = devEnv();
    const envFile = read('pepla-web', 'src', 'environments', 'environment.ts');
    const hireApi = (/talentFlowApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(envFile)?.[1] ?? '').replace(/\/+$/, '');
    expect(hireApi, 'talentFlowApiUrl points at pepla-dev').toMatch(/^https:\/\//);
    const tokenOf = async (l: { email: string; password: string }) => {
      const r = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
        headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
        data: JSON.stringify({ AuthFlow: 'USER_PASSWORD_AUTH', ClientId: clientId, AuthParameters: { USERNAME: l.email, PASSWORD: l.password } }),
      });
      expect(r.status(), 'signs in at Cognito').toBe(200);
      return ((await r.json()) as any).AuthenticationResult.IdToken as string;
    };
    const [hrT, bT, adminT, managerT] = await Promise.all([tokenOf(logins.hr), tokenOf(logins.companyB), tokenOf(logins.admin), tokenOf(logins.manager)]);
    const subOf = (t: string) => JSON.parse(Buffer.from(t.split('.')[1]!, 'base64url').toString('utf8')).sub as string;
    const call = async (base: string, method: string, path: string, token: string, body?: unknown, key?: string) => {
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (key) headers['idempotency-key'] = key;
      const r = await page.request.fetch(`${base}${path}`, { method, headers, data: body === undefined ? undefined : JSON.stringify(body) });
      const text = await r.text();
      let json: any = text;
      try { json = JSON.parse(text); } catch { /* shown below */ }
      return { status: r.status(), body: json };
    };
    const doc = readDoc();
    const chk = checker(doc);
    const fits = (route: string, r: { status: number; body: unknown }, what: string) => expect.soft(chk.check(answerSchema(doc, route, r.status), r.body), `${what}: the real answer passes api/openapi.yaml`).toEqual([]);

    // The real options answer, as the Recruiter.
    const opts = await call(hireApi, 'GET', '/v1/roles/options', hrT);
    expect(opts.status, `the Recruiter reads the options (${JSON.stringify(opts.body).slice(0, 200)})`).toBe(200);
    fits('GET /v1/roles/options', opts, 'options');
    const o = opts.body as Options;
    for (const n of ['Engineering', 'Finance', 'Fleet', 'Operations', 'People']) expect.soft(o.departments.map((d) => d.name), `the seeded ${n}`).toContain(n);
    expect.soft(o.levels.length, 'the company\'s levels').toBeGreaterThan(0);
    expect.soft(o.criteria, 'the four default criteria').toEqual(DEFAULT_CRITERIA);
    const manager = o.hiring_managers.find((m) => m.id === subOf(managerT));
    expect(manager, 'the seeded hiring-manager login is listed').toBeTruthy();
    const fleet = o.departments.find((d) => d.name === 'Fleet')!;

    // Departments: A's and B's, each its own.
    const aDeps = await call(api, 'GET', '/v1/company/departments', hrT);
    expect(aDeps.status).toBe(200);
    fits('GET /v1/company/departments', aDeps, 'A\'s departments');
    const bDeps = await call(api, 'GET', '/v1/company/departments', bT);
    expect(bDeps.status, 'B reads its own list').toBe(200);
    fits('GET /v1/company/departments', bDeps, 'B\'s departments');
    const aIds = (aDeps.body.departments as Array<{ id: string }>).map((d) => d.id);
    expect.soft((bDeps.body.departments as Array<{ id: string }>).filter((d) => aIds.includes(d.id)), 'B gets none of A\'s departments').toEqual([]);

    // The page, as the Recruiter: the lists are the answer's, and a role opens with Fleet and the seeded manager.
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await page.goto('/hire/roles/new');
    await expect(h1(page)).toHaveText('Open a role');
    await expect(field(page, 'Job title')).toBeVisible();
    expect(await optionTexts(page, 'Department')).toEqual([CHOOSE_DEPARTMENT, ...o.departments.map((d) => d.name)]);
    expect(await optionTexts(page, 'Seniority level')).toEqual([...o.levels].sort((x, y) => x.order - y.order).map((l) => l.label));
    expect(await optionTexts(page, 'Hiring manager')).toContain(manager!.name);
    await expect(field(page, 'What the panel scores')).toHaveValue(DEFAULT_CRITERIA.map((c) => c.label).join(', '));
    const title = `REC-14 dev check ${Date.now()}`;
    await field(page, 'Job title').fill(title);
    await pick(page, 'Department', 'Fleet');
    await pick(page, 'Hiring manager', manager!.name);
    await openButton(page).click();
    await expect(page).toHaveURL(/\/hire\/pipeline\?.*role=/);
    await expect(h1(page)).toHaveText(title);
    const roleId = new URL(page.url()).searchParams.get('role')!;
    try {
      const role = await call(hireApi, 'GET', `/v1/roles/${encodeURIComponent(roleId)}`, hrT);
      expect.soft([role.status, role.body.department_id, role.body.department, role.body.hiring_manager_id], 'the role keeps Fleet\'s id and the manager').toEqual([200, fleet.id, 'Fleet', manager!.id]);
    } finally {
      // Clean up: a role with no candidate closes.
      const closed = await call(hireApi, 'POST', `/v1/roles/${encodeURIComponent(roleId)}/close`, hrT, {}, `rec14c-close-${roleId}`);
      expect.soft(closed.status, 'the test role is closed again').toBe(200);
    }

    // The Admin adds (or brings back) a test department and archives it again: never deleted, so no run leaves one behind.
    const TEST_NAME = 'REC-14 dev check department';
    const all = await call(api, 'GET', '/v1/company/departments?include=archived', adminT);
    expect(all.status, 'the Admin reads the whole list').toBe(200);
    let version = all.body.version as number;
    let test1 = (all.body.departments as Array<{ id: string; name: string; status: string }>).find((d) => d.name.toLowerCase() === TEST_NAME.toLowerCase());
    if (!test1) {
      const added = await call(api, 'POST', '/v1/admin/company/departments', adminT, { name: TEST_NAME }, `rec14c-${Date.now()}`);
      expect(added.status, `the Admin adds it (${JSON.stringify(added.body).slice(0, 200)})`).toBe(201);
      fits('POST /v1/admin/company/departments', added, 'add');
      test1 = added.body.department; version = added.body.version;
    } else if (test1.status === 'ARCHIVED') {
      const back = await call(api, 'PATCH', `/v1/admin/company/departments/${test1.id}`, adminT, { status: 'ACTIVE', expected_version: version });
      expect(back.status, `the Admin brings it back (${JSON.stringify(back.body).slice(0, 200)})`).toBe(200);
      fits('PATCH /v1/admin/company/departments/{id}', back, 'restore');
      version = back.body.version;
    }
    const during = await call(hireApi, 'GET', '/v1/roles/options', hrT);
    expect.soft((during.body.departments as Array<{ id: string }>).map((d) => d.id), 'the Recruiter is offered it while it is active').toContain(test1!.id);
    const archived = await call(api, 'PATCH', `/v1/admin/company/departments/${test1!.id}`, adminT, { status: 'ARCHIVED', expected_version: version });
    expect(archived.status, `the Admin archives it (${JSON.stringify(archived.body).slice(0, 200)})`).toBe(200);
    fits('PATCH /v1/admin/company/departments/{id}', archived, 'archive');
    const after = await call(hireApi, 'GET', '/v1/roles/options', hrT);
    expect.soft((after.body.departments as Array<{ id: string }>).map((d) => d.id), 'and no longer once it is archived').not.toContain(test1!.id);

    // The real preflight of the add, with idempotency-key, from the app's addresses (LESSONS NH-187).
    const origins = [...new Set([new URL(env('E2E_BASE_URL') || 'http://127.0.0.1:4300').origin, 'http://localhost:4300'])];
    for (const origin of origins) {
      const pre = await page.request.fetch(`${api}/v1/admin/company/departments`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key' } });
      expect.soft(pre.status(), `the preflight from ${origin} passes`).toBeLessThan(300);
      expect.soft((pre.headers()['access-control-allow-headers'] ?? '').toLowerCase(), 'with idempotency-key').toContain('idempotency-key');
    }
  });
});
