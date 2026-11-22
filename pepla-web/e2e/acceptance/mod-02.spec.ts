import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { Page } from '@playwright/test';
import type { CognitoFake, FakeAccount } from './support/cognito-fake';
import { EmployeesFake } from './support/employees-fake';
import { FAKE, ON_DEV, avatarButton, expect, expectNoSession, test as base, type Login, type SignInPage } from './support/fixtures';
import { forgetSignIn } from './support/sign-in-again';
import { FAILING_MODES, ModulesFake, isModulesCall, type Company } from './support/mod-02/modules-fake';
import { closeNav, geometry, navHeadings, navItems, navLabels, openNav, snapshot, type Box, type Geometry, type ShellSnapshot } from './support/mod-02/shell-snapshot';
import { BASELINE } from './support/mod-02/baseline';

/**
 * MOD-02 · The app shell and guards know which modules a company has and what a person may open
 * (Jira NH-225, epic NH-222). Spec: onboarding-cards/specs/MOD-02.md. API contract: the table in MOD-01.md
 * ("GET /v1/company/modules"); the fake API (support/mod-02/modules-fake.ts) is generated from it (D-API-1).
 *
 * The spec does not name the test-only hook of its rule 8, so cards/mod-02.md fixes it. In short:
 *   window.__nalekoTestSetup  the test sets it BEFORE the app starts (addInitScript): { entries, routes }.
 *                             The app, in a non-production build only, registers each entry in the nav registry and
 *                             adds each route, guarded by accessGuard({ module, roles, perms, allOf }), showing an h1 with its path.
 *                             roles and perms are "any of"; allOf lists group names (roles and perm- names) that must ALL be held.
 *                             Every part that is given must pass (module, roles, perms and allOf are ANDed).
 *   window.__nalekoTest       the app sets it, in a non-production build only: { rolesOf, landingFor, modules }.
 *
 * Everything here is made of words that exist today (Today, Documents to check, the sign-in refusal) or of
 * test-only labels that start with "Test " and never ship. No test calls Bedrock or any paid AI.
 */

type Fixtures = { modules: ModulesFake | null; list: EmployeesFake | null };

const test = base.extend<Fixtures>({
  // HR home reads the employees list; answering it keeps every page quiet. Add-only: no earlier route.
  list: [
    async ({ context, baseURL }, use) => {
      if (ON_DEV) return use(null);
      const fake = new EmployeesFake(new URL(baseURL!).origin);
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
  // GET /v1/company/modules, answered for every page in the no-backend run.
  modules: [
    async ({ context, cognito }, use) => {
      if (ON_DEV) return use(null);
      const fake = new ModulesFake((email) => cognito!.subOf(email));
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
});

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake modules answer.');
const desktopOnly = (name: string) => test.skip(name !== 'desktop-1280', 'Runs once: it reads files or builds the app, it has no screen width.');

const PASSWORD = 'winter-protea-2026';
const PROJECT = (name: string) => BASELINE.projects[name]!;

// ---------------------------------------------------------------- the people

type Who = FakeAccount & { company: Company; password: string; lands: '/hr' | '/start' };
const person = (p: Omit<Who, 'password'>): Who => ({ ...p, password: PASSWORD });
const SUNBIRD = 'sunbird-bakery.co.za';

/** Company A has onboarding and recruitment, B onboarding only, C nothing (the card's three fake companies). */
const WHO = {
  hrA: person({ ...FAKE.hr, company: 'A', lands: '/hr' }),
  empA: person({ ...FAKE.employee, company: 'A', lands: '/start' }),
  hrB: person({ email: `pieter.vanwyk@${SUNBIRD}`, givenName: 'Pieter', familyName: 'van Wyk', groups: ['hr_staff'], company: 'B', lands: '/hr' }),
  hrC: person({ email: `lerato.molefe@${SUNBIRD}`, givenName: 'Lerato', familyName: 'Molefe', groups: ['hr_staff'], company: 'C', lands: '/hr' }),
  hrTickA: person({ email: `thandi.dube@${SUNBIRD}`, givenName: 'Thandi', familyName: 'Dube', groups: ['hr_staff', 'perm-recruitment'], company: 'A', lands: '/hr' }),
  hrTickB: person({ email: `sipho.zulu@${SUNBIRD}`, givenName: 'Sipho', familyName: 'Zulu', groups: ['hr_staff', 'perm-recruitment'], company: 'B', lands: '/hr' }),
  empTickA: person({ email: `naledi.mokoena@${SUNBIRD}`, givenName: 'Naledi', familyName: 'Mokoena', groups: ['employee', 'perm-recruitment'], company: 'A', lands: '/start' }),
  empTickB: person({ email: `kabelo.nkosi@${SUNBIRD}`, givenName: 'Kabelo', familyName: 'Nkosi', groups: ['employee', 'perm-recruitment'], company: 'B', lands: '/start' }),
  // Groups that look like the ones MOD-02 reads but are not (near names, old names): they give nothing.
  empNearA: person({
    email: `anele.khoza@${SUNBIRD}`, givenName: 'Anele', familyName: 'Khoza', company: 'A', lands: '/start',
    groups: ['employee', 'hr_staffx', 'xhr_staff', 'perm-recruitmentx', 'xperm-recruitment', 'managers', 'naleko-onboarding-hr', 'naleko-talentflow-hr', 'TalentFlowAdmin', 'HRDirector', 'ITAdmin'],
  }),
  // Today these two cannot sign in (ONB-23): neither group is hr_staff or employee.
  managerA: person({ email: `refilwe.sithole@${SUNBIRD}`, givenName: 'Refilwe', familyName: 'Sithole', groups: ['manager'], company: 'A', lands: '/hr' }),
  guestA: person({ email: `bongani.cele@${SUNBIRD}`, givenName: 'Bongani', familyName: 'Cele', groups: ['guest'], company: 'A', lands: '/hr' }),
};

/** Adds a person to the fake Cognito and the fake modules answer, once, and signs them in. */
async function signInAs(page: Page, signIn: SignInPage, cognito: CognitoFake | null, modules: ModulesFake | null, who: Who): Promise<void> {
  if (cognito && cognito.subOf(who.email) === undefined) cognito.addAccount(who);
  modules?.assign(who.email, who.company);
  await signIn.open();
  await signIn.signInAs(who);
}

async function enter(page: Page, signIn: SignInPage, cognito: CognitoFake | null, modules: ModulesFake | null, who: Who): Promise<void> {
  await signInAs(page, signIn, cognito, modules, who);
  await expect(page).toHaveURL(who.lands);
  await expect(page.locator('main h1').first()).toBeVisible();
}

async function signOutByMenu(page: Page): Promise<void> {
  await avatarButton(page).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

// ---------------------------------------------------------------- the test-only hook (cards/mod-02.md)

type TestEntry = { id: string; group: string; label: string; icon: string; route: string; module?: string; roles?: string[]; perms?: string[]; allOf?: string[]; order?: number };
type TestRoute = { path: string; module?: string; roles?: string[]; perms?: string[]; allOf?: string[] };

/** One entry for each module state the card names. Registered in a scrambled order on purpose: the shell sorts them. */
const ENTRIES: TestEntry[] = [
  { id: 'mod02-settings', group: 'Settings', label: 'Test settings item', icon: 'settings', route: '/mod02/settings', roles: ['hr_staff'] },
  { id: 'mod02-perform', group: 'Perform', label: 'Test perform item', icon: 'target', route: '/mod02/perform' },
  { id: 'mod02-onboard', group: 'Onboard', label: 'Test onboard item', icon: 'list-checks', route: '/mod02/onboard', module: 'onboarding', roles: ['hr_staff'] },
  { id: 'mod02-pipeline', group: 'Hire', label: 'Test pipeline item', icon: 'user-search', route: '/mod02/pipeline', module: 'recruitment', perms: ['perm-recruitment'], order: 2 },
  { id: 'mod02-hire', group: 'Hire', label: 'Test hire item', icon: 'users', route: '/mod02/hire', module: 'recruitment', roles: ['hr_staff'], perms: ['perm-recruitment'], order: 1 },
  { id: 'mod02-leave', group: 'Leave', label: 'Test leave item', icon: 'calendar-days', route: '/mod02/leave', module: 'leave', roles: ['hr_staff'] },
  { id: 'mod02-records', group: 'Records', label: 'Test records item', icon: 'id-card', route: '/mod02/records', roles: ['hr_staff', 'employee'] },
];
const REC = 'Test records item';
const HIRE = 'Test hire item';
const PIPE = 'Test pipeline item';
const ONB = 'Test onboard item';
const PERF = 'Test perform item';
const SET = 'Test settings item';
/** The DS group order, for reading the headings. */
const GROUP_ORDER = ['Records', 'Hire', 'Onboard', 'Leave', 'Comply', 'Help desk', 'Perform', 'Settings'];

/** Guarded test routes (top level, no shell), each with a link in the sidebar that every signed-in person sees. */
const ROUTES: TestRoute[] = [
  { path: 'mod02/guarded', module: 'recruitment', perms: ['perm-recruitment'] },
  { path: 'mod02/onboarding-only', module: 'onboarding' },
  { path: 'mod02/hr-only', roles: ['hr_staff'] },
];
const LINK_ENTRIES: TestEntry[] = ROUTES.map((r, i) => ({
  id: `mod02-link-${i}`, group: 'Comply', label: `Test link ${r.path}`, icon: 'shield-check', route: `/${r.path}`, order: i,
}));

async function register(page: Page, setup: { entries?: TestEntry[]; routes?: TestRoute[] }): Promise<void> {
  await page.addInitScript((s) => { (window as unknown as { __nalekoTestSetup: unknown }).__nalekoTestSetup = s; }, { entries: setup.entries ?? [], routes: setup.routes ?? [] });
}

type Hook = {
  rolesOf(claim: unknown): { roles: string[]; perms: string[] };
  landingFor(roles: string[], perms: string[], modules: string[]): string;
  modules(): string[];
};
async function hookReady(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(window as unknown as { __nalekoTest?: unknown }).__nalekoTest, undefined, { timeout: 15_000 });
}
async function loadedModules(page: Page): Promise<string[]> {
  await hookReady(page);
  return (await page.evaluate(() => [...(window as unknown as { __nalekoTest: Hook }).__nalekoTest.modules()])).sort();
}

/** The "Test ..." items the sidebar holds now, in the order drawn. */
async function fakeLabels(page: Page, prefix = 'Test '): Promise<string[]> {
  return (await navLabels(page)).filter((l) => l.startsWith(prefix));
}

/**
 * The modules answer has come (or failed) and the page has drawn what it holds. Waits for the fake to have answered
 * `calls` times in all, not for the network to go quiet (the page's fonts and other calls are not its business).
 */
async function settled(page: Page, modules: ModulesFake | null, calls: number): Promise<void> {
  if (modules) {
    await expect.poll(() => modules.answered, { message: `the app asked for the modules and got an answer (call ${calls})`, timeout: 15_000 }).toBeGreaterThanOrEqual(calls);
    await page.waitForTimeout(300);
  } else {
    await page.waitForLoadState('networkidle');
  }
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

/** The page has had time to make the calls it makes on load (a slow font host does not hold the test). */
async function quiet(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

/** Console errors and uncaught errors the app causes (the fake's own failing answers and the fonts are not the app). */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = m.location().url;
    if (isModulesCall(new URL(where || 'http://x/'))) return;
    if (/fonts\.(googleapis|gstatic)\.com/.test(where)) return;
    errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Words an error screen or a refusal page would carry. */
const REFUSAL_WORDS = /forbidden|not allowed|no access|access denied|unauthori[sz]ed|permission|something went wrong|failed|error/i;

// ---------------------------------------------------------------- tests

test.describe('MOD-02 The module-aware shell and guards', () => {
  test('AC-1 The modules service loads after sign-in, asks at most once a minute, fails closed and silent, retries on the next navigation, and clears on sign-out', async ({ page, signIn, cognito, modules }) => {
    noBackendOnly();
    const fake = modules!;
    await page.clock.install();
    await register(page, { entries: ENTRIES });

    // Signed out: no call at all (there is no company to ask for).
    await signIn.open();
    await hookReady(page);
    expect(fake.calls, 'nothing is asked for before sign-in').toHaveLength(0);
    expect(await loadedModules(page), 'before the first answer the set is empty').toEqual([]);

    // After sign-in: one call, with the person's token, and the set is what the answer says.
    await enter(page, signIn, cognito, fake, WHO.hrA);
    await settled(page, fake, 1);
    expect(fake.calls, 'one call after sign-in').toHaveLength(1);
    expect(fake.calls[0]!.method).toBe('GET');
    expect(fake.calls[0]!.authorization, 'the call carries the sign-in token').toMatch(/^Bearer eyJ/);
    expect(fake.calls[0]!.url.search, 'no query: the company comes from the token only').toBe('');
    await expect.poll(() => loadedModules(page)).toEqual(['onboarding', 'recruitment']);
    expect(await fakeLabels(page), 'the entries it switches on show').toEqual([REC, HIRE, ONB, PERF, SET]);

    // Two page changes inside a minute: no second call.
    await page.getByRole('link', { name: 'Add new employee' }).click();
    await expect(page).toHaveURL(/\/hr\/employees\/new$/);
    await openNav(page);
    await navItems(page).filter({ hasText: /^Today$/ }).click();
    await expect(page).toHaveURL('/hr');
    await settled(page, fake, 1);
    expect(fake.calls, 'a page change inside a minute asks nothing').toHaveLength(1);

    // 45 seconds after the good answer is still inside the minute: a page change asks nothing (not a 30 second throttle).
    await page.clock.fastForward(45_000);
    await page.getByRole('link', { name: 'Add new employee' }).click();
    await expect(page).toHaveURL(/\/hr\/employees\/new$/);
    await openNav(page);
    await navItems(page).filter({ hasText: /^Today$/ }).click();
    await expect(page).toHaveURL('/hr');
    await settled(page, fake, 1);
    expect(fake.calls, '45 seconds after a good answer a page change asks nothing').toHaveLength(1);

    // After a minute the next page change asks again, once; the one after it, not.
    await page.clock.fastForward(16_000);
    await page.getByRole('link', { name: 'Add new employee' }).click();
    await expect(page).toHaveURL(/\/hr\/employees\/new$/);
    await settled(page, fake, 2);
    expect(fake.calls, 'a page change after a minute asks again').toHaveLength(2);
    await openNav(page);
    await navItems(page).filter({ hasText: /^Today$/ }).click();
    await expect(page).toHaveURL('/hr');
    await settled(page, fake, 2);
    expect(fake.calls, 'and only once').toHaveLength(2);

    // Every kind of failure leaves the set empty (even after a good answer), shows no words, and the next page change tries again.
    let asked = 2;
    for (const mode of FAILING_MODES) {
      await page.clock.fastForward(61_000);
      fake.mode = mode;
      await page.getByRole('link', { name: 'Add new employee' }).click();
      await expect(page).toHaveURL(/\/hr\/employees\/new$/);
      asked++;
      await settled(page, fake, asked);
      expect(fake.calls, `${mode}: asked once`).toHaveLength(asked);
      expect(await loadedModules(page), `${mode}: the set is empty`).toEqual([]);
      expect(await fakeLabels(page), `${mode}: what needs a module is gone, what needs none stays`).toEqual([REC, PERF, SET]);
      await expect(page.getByRole('alert'), `${mode}: no alert anywhere`).toHaveCount(0);
      const shellText = (await page.locator('pp-side-navigation').innerText()) + (await page.locator('pp-top-navigation').innerText());
      expect(shellText, `${mode}: the shell shows no error words`).not.toMatch(REFUSAL_WORDS);

      // The very next page change asks again, with no minute in between, and a good answer brings the entries back.
      fake.mode = 'ok';
      await openNav(page);
      await navItems(page).filter({ hasText: /^Today$/ }).click();
      await expect(page).toHaveURL('/hr');
      asked++;
      await settled(page, fake, asked);
      expect(fake.calls, `${mode}: the next page change asks again`).toHaveLength(asked);
      await expect.poll(() => loadedModules(page), { message: `${mode}: the set is back` }).toEqual(['onboarding', 'recruitment']);
      expect(await fakeLabels(page), `${mode}: the entries are back`).toEqual([REC, HIRE, ONB, PERF, SET]);
    }

    // App start (a reload with the session kept) asks once. Sign-out clears the set; the next person gets their own company's.
    await page.reload();
    await expect(page).toHaveURL('/hr');
    asked++;
    await settled(page, fake, asked);
    expect(fake.calls, 'app start asks once').toHaveLength(asked);
    await expect.poll(() => loadedModules(page)).toEqual(['onboarding', 'recruitment']);
    await signOutByMenu(page);
    expect(await loadedModules(page), 'sign-out clears the set').toEqual([]);
    expect(fake.calls, 'sign-out asks nothing').toHaveLength(asked);
    await forgetSignIn(page);
    await register(page, { entries: ENTRIES });
    await enter(page, signIn, cognito, fake, WHO.hrB);
    asked++;
    await settled(page, fake, asked);
    await expect.poll(() => loadedModules(page), { message: 'the next person has their own company\'s set, nothing of the last one' }).toEqual(['onboarding']);
    expect(await fakeLabels(page)).toEqual([REC, ONB, PERF, SET]);
    expect(fake.calls.filter((c) => c.authorization === null), 'no call was ever made without a sign-in token').toEqual([]);
  });

  test('AC-2 Roles: the new group names give the TEN-05 result; near names, substrings and old group names give nothing; both claim shapes', async ({ page, signIn, cognito, modules }) => {
    noBackendOnly();
    await register(page, { entries: ENTRIES });
    await signIn.open();
    await hookReady(page);

    const rolesOf = (claim: unknown) =>
      page.evaluate((c) => (window as unknown as { __nalekoTest: Hook }).__nalekoTest.rolesOf(c), claim as never).then((r) => ({ roles: [...r.roles].sort(), perms: [...r.perms].sort() }));
    const none = { roles: [], perms: [] };

    // Each new name alone: the five roles and the three ticks.
    for (const role of ['admin', 'hr_staff', 'manager', 'employee', 'guest']) {
      expect(await rolesOf([role]), `${role} is a role`).toEqual({ roles: [role], perms: [] });
    }
    for (const perm of ['perm-recruitment', 'perm-it', 'perm-approve-offers']) {
      expect(await rolesOf([perm]), `${perm} is a tick`).toEqual({ roles: [], perms: [perm] });
    }
    // Together, in any order.
    expect(await rolesOf(['perm-it', 'guest', 'hr_staff', 'perm-approve-offers', 'admin', 'employee', 'manager', 'perm-recruitment'])).toEqual({
      roles: ['admin', 'employee', 'guest', 'hr_staff', 'manager'], perms: ['perm-approve-offers', 'perm-it', 'perm-recruitment'],
    });
    // Near names and substrings never match.
    for (const near of ['hr_staffx', 'xhr_staff', 'hr_staff2', 'x-employee', 'employee-2', 'managers', 'xmanager', 'guests', 'administrator', 'perm-recruitmentx', 'xperm-recruitment', 'perm-', 'perm-itx', 'perm-approve-offersx']) {
      expect(await rolesOf([near]), `${near} gives nothing`).toEqual(none);
    }
    // Old group names are not mapped here (TEN-06 moves those people).
    for (const old of ['naleko-onboarding-hr', 'naleko-talentflow-hr', 'naleko-talentflow-admin', 'naleko-talentflow-hiringmanager', 'naleko-it-provisioning', 'TalentFlowAdmin', 'HiringManager', 'PanelMember', 'FinanceLead', 'ITAdmin', 'ITSpecialist', 'HRDirector', 'ComplianceOfficer', 'e2e-robots']) {
      expect(await rolesOf([old]), `${old} gives nothing`).toEqual(none);
    }
    // Real names among false ones: only the real ones count.
    expect(await rolesOf(['hr_staffx', 'hr_staff', 'xhr_staff', 'TalentFlowAdmin', 'perm-approve-offers'])).toEqual({ roles: ['hr_staff'], perms: ['perm-approve-offers'] });
    // Both claim shapes: a list, and the text a token's claim can arrive as (JSON, and the [a b] form).
    expect(await rolesOf('["employee","perm-it"]'), 'JSON text').toEqual({ roles: ['employee'], perms: ['perm-it'] });
    expect(await rolesOf('[employee perm-it]'), 'the [a b] form').toEqual({ roles: ['employee'], perms: ['perm-it'] });
    expect(await rolesOf('[hr_staff manager perm-recruitment]'), 'the [a b] form with more names').toEqual({ roles: ['hr_staff', 'manager'], perms: ['perm-recruitment'] });
    expect(await rolesOf('[xhr_staff hr_staffx]'), 'the [a b] form with near names only').toEqual(none);
    expect(await rolesOf('["hr_staffx","xemployee"]'), 'JSON text with near names only').toEqual(none);
    // No claim at all.
    for (const nothing of [undefined, null, '', '[]', []]) expect(await rolesOf(nothing), `${JSON.stringify(nothing)} gives nothing`).toEqual(none);

    // The same through a real sign-in: a person whose token has the near and old names gets nothing from them,
    // and the real tick lets them through. (Cognito's own claim is the list shape.)
    await enter(page, signIn, cognito, modules, WHO.empNearA);
    await settled(page, modules, 1);
    expect(await fakeLabels(page), 'near names and old groups open nothing: only the entry for employees and the one for everyone').toEqual([REC, PERF]);
    await forgetSignIn(page);
    await register(page, { entries: ENTRIES });
    await enter(page, signIn, cognito, modules, WHO.empTickA);
    await settled(page, modules, 2);
    expect(await fakeLabels(page), 'the real tick opens the hire entries').toEqual([REC, HIRE, PIPE, PERF]);
  });

  test('AC-3 The sidebar follows the registry: module on and person allowed, in the DS group order, no empty group, the same list in the phone drawer', async ({ page, signIn, cognito, modules }) => {
    noBackendOnly();
    const fake = modules!;
    const cases: Array<[string, Who, string[]]> = [
      ['company A, HR', WHO.hrA, [REC, HIRE, ONB, PERF, SET]],
      ['company A, HR with the Recruitment tick', WHO.hrTickA, [REC, HIRE, PIPE, ONB, PERF, SET]],
      ['company B (Recruitment off), HR', WHO.hrB, [REC, ONB, PERF, SET]],
      ['company B, HR with the tick: the module is off, the tick does not matter', WHO.hrTickB, [REC, ONB, PERF, SET]],
      ['company C (no modules), HR', WHO.hrC, [REC, PERF, SET]],
      ['company A, employee: nothing of the HR entries', WHO.empA, [REC, PERF]],
      ['company A, employee with the tick', WHO.empTickA, [REC, HIRE, PIPE, PERF]],
      ['company B, employee with the tick', WHO.empTickB, [REC, PERF]],
    ];
    let calls = 0;
    for (const [name, who, expected] of cases) {
      await register(page, { entries: ENTRIES });
      await enter(page, signIn, cognito, fake, who);
      await settled(page, fake, ++calls);
      expect(await fakeLabels(page), name).toEqual(expected);
      const labels = await navLabels(page);
      expect(labels[0], `${name}: Today stays first`).toBe('Today');

      // Same list in the phone drawer, every item visible once it is opened.
      await openNav(page);
      for (const label of expected) await expect(navItems(page).filter({ hasText: label }), `${name}: ${label} is visible`).toBeVisible();
      expect(await fakeLabels(page), `${name}: the drawer holds the same list`).toEqual(expected);
      for (const gone of ENTRIES.map((e) => e.label).filter((l) => !expected.includes(l))) {
        await expect(page.locator('pp-side-navigation').getByText(gone, { exact: true }), `${name}: ${gone} is not there`).toHaveCount(0);
      }

      // Groups: a group with nothing to show is not drawn; the ones drawn follow the DS order.
      const headings = await navHeadings(page);
      const wanted = GROUP_ORDER.filter((g) => ENTRIES.some((e) => e.group === g && expected.includes(e.label)));
      const sections = await page.locator('pp-side-navigation .pp-side-navigation__section').evaluateAll((uls) => uls.map((u) => u.querySelectorAll('a.pp-side-navigation__item').length));
      expect(sections.filter((n) => n === 0), `${name}: no section is drawn with nothing in it`).toEqual([]);
      const emptyGroups = GROUP_ORDER.filter((g) => !wanted.includes(g));
      expect(headings.filter((h) => emptyGroups.some((g) => g.toLowerCase() === h.toLowerCase())), `${name}: no heading for a group with nothing visible`).toEqual([]);
      const known = headings.filter((h) => GROUP_ORDER.some((g) => g.toLowerCase() === h.toLowerCase())).map((h) => GROUP_ORDER.find((g) => g.toLowerCase() === h.toLowerCase())!);
      expect(known, `${name}: the group headings that are drawn are in the DS order`).toEqual(wanted.filter((g) => known.includes(g)));
      await closeNav(page);

      if (who.lands === '/hr') {
        const hrLabels = await navLabels(page);
        expect(hrLabels, `${name}: today's HR items are still there`).toEqual(expect.arrayContaining(['Today', 'Documents to check']));
      }
      await forgetSignIn(page);
    }

    // Until the first answer the set is empty (nothing that needs a module shows); the answer then brings the entries.
    fake.mode = 'hold';
    let before = fake.calls.length;
    await register(page, { entries: ENTRIES });
    await signInAs(page, signIn, cognito, fake, WHO.hrA);
    await expect(page).toHaveURL('/hr');
    await expect.poll(() => fake.calls.length, { timeout: 15_000 }).toBeGreaterThan(before);
    expect(await fakeLabels(page), 'while the first answer is out, only entries that need no module show').toEqual([REC, PERF, SET]);
    fake.release();
    await expect.poll(() => fakeLabels(page), { message: 'the answer arrives and the entries show' }).toEqual([REC, HIRE, ONB, PERF, SET]);
    await forgetSignIn(page);

    // A failing call: the same fail-closed list.
    fake.mode = 'forbidden';
    before = fake.calls.length;
    await register(page, { entries: ENTRIES });
    await enter(page, signIn, cognito, fake, WHO.hrTickA);
    await settled(page, fake, before + 1);
    expect(await fakeLabels(page), 'while the call fails, nothing that needs a module shows, tick or not').toEqual([REC, PERF, SET]);
  });

  test('AC-4 Routes: accessGuard sends a person who fails the test to their own first page, by address bar and by link: no refusal page, no blank page, no console error', async ({ page, signIn, cognito, modules }) => {
    noBackendOnly();
    const fake = modules!;
    const errors = watchErrors(page);
    const GUARDED = '/mod02/guarded';

    // [who, route, opens]. The Recruitment route needs the module AND the tick; the others show the same test on one part each.
    const cases: Array<[string, Who, string, boolean]> = [
      ['company A with the tick opens', WHO.hrTickA, GUARDED, true],
      ['company B with the tick lands on their first page', WHO.hrTickB, GUARDED, false],
      ['company A without the tick lands on their first page', WHO.hrA, GUARDED, false],
      ['company A employee without the tick lands on /start', WHO.empA, GUARDED, false],
      ['company A employee with the tick opens', WHO.empTickA, GUARDED, true],
      ['company B employee with the tick lands on /start', WHO.empTickB, GUARDED, false],
      ['a route that asks only for a module: B opens', WHO.hrB, '/mod02/onboarding-only', true],
      ['a route that asks only for a module: C lands on their first page', WHO.hrC, '/mod02/onboarding-only', false],
      ['a route that asks only for a role: HR of C opens', WHO.hrC, '/mod02/hr-only', true],
      ['a route that asks only for a role: an employee lands on /start', WHO.empA, '/mod02/hr-only', false],
    ];
    const landOrOpen = async (name: string, who: Who, route: string, opens: boolean, how: string) => {
      if (opens) {
        await expect(page, `${name} (${how})`).toHaveURL(route);
        await expect(page.locator('h1').first(), `${name} (${how}): the page is there`).toHaveText(route.slice(1));
      } else {
        await expect(page, `${name} (${how})`).toHaveURL(who.lands);
        await expect(page.locator('main h1').first(), `${name} (${how}): their own first page, not a blank page`).toBeVisible();
        await expect(page.locator('main'), `${name} (${how}): no refusal page`).not.toContainText(REFUSAL_WORDS);
        await expect(page.getByRole('alert'), `${name} (${how}): no alert`).toHaveCount(0);
      }
    };

    for (const [name, who, route, opens] of cases) {
      const before = fake.calls.length;
      await register(page, { entries: LINK_ENTRIES, routes: ROUTES });
      await enter(page, signIn, cognito, fake, who);
      await settled(page, fake, before + 1);
      // The address bar: the app starts on that address, so the guard must wait for the modules answer.
      await page.goto(route);
      await landOrOpen(name, who, route, opens, 'address bar');
      // The link: from the first page, through the sidebar.
      await page.goto(who.lands);
      await expect(page.locator('main h1').first()).toBeVisible();
      await openNav(page);
      await navItems(page).filter({ hasText: `Test link ${route.slice(1)}` }).click();
      await landOrOpen(name, who, route, opens, 'link');
      await forgetSignIn(page);
    }

    // Fail closed: with the modules call failing, the tick does not open a module's route.
    fake.mode = 'forbidden';
    await register(page, { entries: LINK_ENTRIES, routes: ROUTES });
    await enter(page, signIn, cognito, fake, WHO.hrTickA);
    await page.goto(GUARDED);
    await landOrOpen('the modules call fails, company A with the tick', WHO.hrTickA, GUARDED, false, 'address bar');
    await page.goto('/hr');
    await openNav(page);
    await navItems(page).filter({ hasText: `Test link ${GUARDED.slice(1)}` }).click();
    await landOrOpen('the modules call fails, company A with the tick', WHO.hrTickA, GUARDED, false, 'link');
    // A route with no module in its test still opens while the call fails.
    await page.goto('/mod02/hr-only');
    await expect(page.locator('h1').first(), 'a route that needs no module opens even while the call fails').toHaveText('mod02/hr-only');

    expect(errors, 'no console error and no uncaught error anywhere').toEqual([]);
  });

  test('AC-5 Nothing changes today: HR (companies A and B, and with the modules call failing) and an employee see the baseline sidebar, top bar, first page, labels, icons and routes; manager and guest are refused as today', async ({ page, signIn, cognito, modules }, testInfo) => {
    noBackendOnly();
    const fake = modules!;
    const base = PROJECT(testInfo.project.name);

    // No test entries here, so there is nothing for the modules answer to add: what is drawn must equal develop's whether or not it has come.
    const sameShell = async (name: string, expected: { snap: ShellSnapshot; geo: Geometry }, _calls: number) => {
      await quiet(page);
      const got = await snapshot(page);
      expect(got, `${name}: the sidebar, top bar, title, heading and first page equal develop's`).toEqual(expected.snap);
      const geo = await geometry(page);
      expect(geo.items.length, `${name}: the same number of sidebar items`).toBe(expected.geo.items.length);
      const near = (a: Box, b: Box) => (['x', 'y', 'width', 'height'] as const).every((k) => Math.abs(a[k] - b[k]) <= 1);
      expect(near(geo.topBar, expected.geo.topBar), `${name}: the top bar sits where it did (${JSON.stringify(geo.topBar)} against ${JSON.stringify(expected.geo.topBar)})`).toBe(true);
      expected.geo.items.forEach((b, i) => expect(near(geo.items[i]!, b), `${name}: item ${i + 1} sits where it did (${JSON.stringify(geo.items[i])} against ${JSON.stringify(b)})`).toBe(true));
    };

    // HR of company A, then B, then A with the call failing: no module on today's items, so nothing moves.
    await enter(page, signIn, cognito, fake, WHO.hrA);
    await sameShell('HR, company A', base.hr, 1);
    await forgetSignIn(page);
    await enter(page, signIn, cognito, fake, WHO.hrB);
    await sameShell('HR, company B', { ...base.hr, snap: personalised(base.hr.snap, WHO.hrB) }, 2);
    await forgetSignIn(page);
    fake.mode = 'forbidden';
    await enter(page, signIn, cognito, fake, WHO.hrA);
    await sameShell('HR, the modules call failing', base.hr, 3);
    await forgetSignIn(page);
    fake.mode = 'ok';

    // An employee.
    await enter(page, signIn, cognito, fake, WHO.empA);
    await sameShell('Employee', base.employee, 4);

    // Where each kind of visitor ends up when they ask for each page (develop's answers).
    const ends = async (to: string) => {
      await page.goto(to);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(800);
      const u = new URL(page.url());
      return u.pathname + u.search;
    };
    const want = base.redirects as Record<string, string>;
    for (const to of ['/hr', '/hr/documents']) expect(await ends(to), `employee asks for ${to}`).toBe(want[`employee ${to}`]);
    expect(await ends('/start'), 'employee asks for /start and stays').toBe('/start');
    expect(await ends('/sign-in'), 'employee opens /sign-in').toBe(want['employee /sign-in']);
    await forgetSignIn(page);
    await enter(page, signIn, cognito, fake, WHO.hrA);
    for (const to of ['/start', '/sign-in']) expect(await ends(to), `HR asks for ${to}`).toBe(want[`hr ${to}`]);
    expect(await ends('/hr'), 'HR asks for /hr and stays').toBe('/hr');
    expect(await ends('/hr/documents'), 'HR asks for /hr/documents and stays').toBe('/hr/documents');
    await forgetSignIn(page);
    for (const to of ['/hr', '/start', '/hr/documents']) expect(await ends(to), `signed out, asks for ${to}`).toBe(want[`out ${to}`]);

    // Manager and guest: today neither group can sign in (ONB-23). Same words, no session, nothing opens.
    for (const who of [WHO.managerA, WHO.guestA]) {
      await forgetSignIn(page);
      await signInAs(page, signIn, cognito, fake, who);
      await expect(signIn.message("This account can't use Naleko People yet. Ask your HR team."), `${who.groups[0]} is refused as today`).toBeVisible();
      await expect(page).toHaveURL(/\/sign-in(\?.*)?$/);
      await expectNoSession(page);
    }

    // The first-page table: today's answers stay, and a module does not move them (D-LANDING).
    await forgetSignIn(page);
    await register(page, { entries: ENTRIES });
    await signIn.open();
    await hookReady(page);
    const landing = (roles: string[], perms: string[], mods: string[]) =>
      page.evaluate(([r, p, m]) => (window as unknown as { __nalekoTest: Hook }).__nalekoTest.landingFor(r!, p!, m!), [roles, perms, mods] as [string[], string[], string[]]);
    for (const mods of [[], ['onboarding'], ['onboarding', 'recruitment']]) {
      expect(await landing(['hr_staff'], [], mods), `hr_staff lands on /hr (modules ${mods})`).toBe('/hr');
      expect(await landing(['hr_staff'], ['perm-recruitment'], mods), `hr_staff with the tick lands on /hr (modules ${mods})`).toBe('/hr');
      // CHAT-03 (child lock mod-02.4): an admin who is not HR has no /hr page, so they land on the Ask Batsi screen; an admin who is also HR keeps /hr.
      expect(await landing(['admin'], [], mods), `admin lands on /admin/ask-batsi (modules ${mods})`).toBe('/admin/ask-batsi');
      expect(await landing(['admin', 'hr_staff'], [], mods), `admin who is also HR lands on /hr (modules ${mods})`).toBe('/hr');
      expect(await landing(['employee'], [], mods), `employee lands on /start (modules ${mods})`).toBe('/start');
      expect(await landing(['employee'], ['perm-recruitment'], mods), `employee with the tick lands on /start (modules ${mods})`).toBe('/start');
    }
  });

  test('AC-6 Phone: at 390 wide every group heading and item in the drawer is visible, not under the top bar, nothing scrolls sideways; Escape and a tap outside close it as today', async ({ page, signIn, cognito, modules }, testInfo) => {
    noBackendOnly();
    test.skip(testInfo.project.name !== 'phone-390', 'The phone criterion runs at 390 wide only.');
    await register(page, { entries: ENTRIES });
    await enter(page, signIn, cognito, modules, WHO.hrTickA);
    await settled(page, modules, 1);
    const expected = [REC, HIRE, PIPE, ONB, PERF, SET];
    expect(await fakeLabels(page)).toEqual(expected);

    await openNav(page);
    const menu = page.getByRole('button', { name: /menu/i }).first();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    // Let the drawer finish sliding in.
    await expect.poll(async () => Math.round((await page.locator('pp-side-navigation').boundingBox())!.x)).toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(400);
    const seen = await page.evaluate(() => {
      const vw = window.innerWidth;
      const parts = [...document.querySelectorAll('pp-side-navigation .pp-side-navigation__heading, pp-side-navigation a.pp-side-navigation__item')];
      return parts.map((el) => {
        const r = el.getBoundingClientRect();
        const x = Math.min(Math.max(r.x + r.width / 2, 0), vw - 1);
        const y = Math.min(Math.max(r.y + r.height / 2, 0), window.innerHeight - 1);
        const top = document.elementFromPoint(x, y);
        return {
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(), heading: el.classList.contains('pp-side-navigation__heading'),
          left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw, vh: window.innerHeight,
          covered: !(top && (el === top || el.contains(top))), visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden',
        };
      });
    });
    const topBar = (await page.locator('pp-top-navigation').boundingBox())!;
    expect(seen.filter((s) => !s.heading).map((s) => s.text.replace(/^\s+/, '')), 'every item is in the drawer').toEqual(expect.arrayContaining(['Today', 'Documents to check', ...expected]));
    for (const s of seen) {
      expect(s.visible, `"${s.text}" is visible`).toBe(true);
      expect(s.left, `"${s.text}" starts on the screen`).toBeGreaterThanOrEqual(-1);
      expect(s.right, `"${s.text}" ends on the screen`).toBeLessThanOrEqual(s.vw + 1);
      expect(s.bottom, `"${s.text}" is above the bottom of the screen`).toBeLessThanOrEqual(s.vh + 1);
      expect(s.covered, `"${s.text}" is not covered by the top bar or anything else (top bar ends at ${topBar.y + topBar.height})`).toBe(false);
    }
    // The headings that are drawn are readable and in the DS order.
    const headings = (await navHeadings(page)).filter((h) => GROUP_ORDER.some((g) => g.toLowerCase() === h.toLowerCase()));
    expect(headings.map((h) => h.toLowerCase()), 'headings in the DS order').toEqual(GROUP_ORDER.filter((g) => headings.some((h) => h.toLowerCase() === g.toLowerCase())).map((g) => g.toLowerCase()));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'nothing scrolls sideways').toBe(true);

    // Escape closes it, as today; so does a tap on the dimmed page beside it.
    await page.keyboard.press('Escape');
    await expect(page.locator('pp-side-navigation')).not.toHaveAttribute('data-open', 'true');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await openNav(page);
    await page.locator('.pp-app-shell__blanket').waitFor({ state: 'visible' });
    await page.waitForTimeout(400);
    await page.mouse.click(380, 800);
    await expect(page.locator('pp-side-navigation')).not.toHaveAttribute('data-open', 'true');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  test('AC-7 No separate copies: only the registry and core/roles.ts name a group; the shells name no module', async ({}, testInfo) => {
    desktopOnly(testInfo.project.name);
    const SRC = join(__dirname, '..', '..', 'src', 'app');
    const all = (dir: string): string[] => readdirSync(dir).flatMap((e) => { const f = join(dir, e); return statSync(f).isDirectory() ? all(f) : [f]; });
    const files = all(SRC).filter((f) => /\.(ts|html)$/.test(f) && !/\.spec\.ts$/.test(f));
    const rel = (f: string) => relative(SRC, f).replace(/\\/g, '/');
    const read = (f: string) => readFileSync(f, 'utf8');
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    // The three files the card names exist, and core/roles.ts is where the eight names live.
    for (const f of ['core/modules.service.ts', 'core/roles.ts', 'core/nav.ts']) expect(existsSync(join(SRC, f)), `${f} exists`).toBe(true);
    const roles = strip(read(join(SRC, 'core/roles.ts')));
    for (const name of ['admin', 'hr_staff', 'manager', 'employee', 'guest', 'perm-recruitment', 'perm-it', 'perm-approve-offers']) {
      expect(roles, `core/roles.ts names ${name}`).toMatch(new RegExp(`['"\`]${name}['"\`]`));
    }

    // Nothing under features/ names a group string (quoted, so a word in a sentence or a class does not count).
    const GROUP = /['"`](?:hr_staff|employee|manager)['"`]|['"`]perm-[a-z-]*['"`]/;
    const named = files.filter((f) => rel(f).startsWith('features/') && GROUP.test(strip(read(f)))).map(rel);
    expect(named, 'no file under features/ names hr_staff, employee, manager or a perm- tick').toEqual([]);

    // The shell names no module key.
    for (const shell of ['features/hr/hr-shell.ts', 'features/start/employee-shell.ts']) {
      expect(strip(read(join(SRC, shell))), `${shell} names no module`).not.toMatch(/['"`](?:recruitment|onboarding)['"`]/);
    }
    // The old guards no longer read the groups themselves (they are thin uses of accessGuard).
    expect(read(join(SRC, 'core/auth/auth.guard.ts')), 'accessGuard exists and the guards use it').toMatch(/accessGuard/);
  });

  test('AC-8 Production bundle: the test hook is not in it, only pp-* classes in the shells, no new dependency', async ({}, testInfo) => {
    desktopOnly(testInfo.project.name);
    test.setTimeout(15 * 60_000);
    const PEPLA_WEB = join(__dirname, '..', '..');

    // No new dependency: the lists are the ones develop had.
    const pkg = JSON.parse(readFileSync(join(PEPLA_WEB, 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).sort(), 'dependencies').toEqual(BASELINE.dependencies);
    // child lock rec-14.1, REC-14 rule 15: the acceptance tests' schema checker (ajv) is a dev dependency; rec-14.spec.ts AC-1 pins it there.
    expect(Object.keys(pkg.devDependencies).filter((d) => d !== 'ajv').sort(), 'devDependencies').toEqual(BASELINE.devDependencies);

    // The shells use design system parts only: every class they write starts with pp-, and they carry no styles of their own.
    for (const shell of ['features/hr/hr-shell.ts', 'features/start/employee-shell.ts']) {
      const text = readFileSync(join(PEPLA_WEB, 'src', 'app', shell), 'utf8');
      const classes = [...text.matchAll(/\bclass="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/).filter(Boolean));
      expect(classes.filter((c) => !c.startsWith('pp-')), `${shell}: every class is a pp- class`).toEqual([]);
      expect(text, `${shell}: no styles of its own`).not.toMatch(/\bstyles\s*:|<style|styleUrl/);
    }

    // The hook is there while serving the app for the tests (so its absence below is not an empty check) ...
    // (the tests above fail without it) ... and absent from the production build, in every built file.
    const out = mkdtempSync(join(tmpdir(), 'mod02-build-'));
    try {
      const build = execFileSync('npx', ['ng', 'build', '--configuration', 'production', '--output-path', out], {
        cwd: PEPLA_WEB, encoding: 'utf8', timeout: 12 * 60_000, env: { ...process.env, NG_CLI_ANALYTICS: 'false', FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' },
      });
      void build;
      const all = (dir: string): string[] => readdirSync(dir).flatMap((e) => { const f = join(dir, e); return statSync(f).isDirectory() ? all(f) : [f]; });
      const built = all(out).filter((f) => /\.(m?js|html|css|json|txt)$/.test(f));
      const js = built.filter((f) => /\.m?js$/.test(f));
      expect(js.length, 'the build wrote scripts').toBeGreaterThan(0);
      expect(js.some((f) => readFileSync(f, 'utf8').includes('Naleko People')), 'the scripts are the app (they hold its name)').toBe(true);
      // Positive control: the build holds the module-aware shell (develop's build does not call the modules route at all).
      expect(js.some((f) => readFileSync(f, 'utf8').includes('/v1/company/modules')), 'the built app asks for GET /v1/company/modules (so the hook check below is not empty)').toBe(true);
      const withHook = built.filter((f) => /__nalekoTest/.test(readFileSync(f, 'utf8'))).map((f) => relative(out, f));
      expect(withHook, 'no built file carries the test hook (__nalekoTestSetup, __nalekoTest)').toEqual([]);
      const withFakeEntries = built.filter((f) => /Test (?:hire|settings|records) item/.test(readFileSync(f, 'utf8'))).map((f) => relative(out, f));
      expect(withFakeEntries, 'no built file carries a test entry').toEqual([]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  test('AC-10 All-of: an entry or route with allOf shows and opens only for a person who holds EVERY listed group, in the sidebar and in accessGuard, and allOf ANDs with module, roles and perms', async ({ page, signIn, cognito, modules }) => {
    noBackendOnly();
    const fake = modules!;
    const errors = watchErrors(page);
    const BOTH = ['hr_staff', 'perm-recruitment'];
    const entries: TestEntry[] = [
      { id: 'mod02-both', group: 'Hire', label: 'Test both item', icon: 'users', route: '/mod02/both', module: 'recruitment', allOf: BOTH, order: 1 },
      { id: 'mod02-both-any', group: 'Help desk', label: 'Test both anywhere item', icon: 'shield-check', route: '/mod02/both-anywhere', allOf: BOTH },
      { id: 'mod02-mix', group: 'Records', label: 'Test mixed item', icon: 'id-card', route: '/mod02/mixed', roles: ['hr_staff', 'employee'], allOf: ['perm-recruitment'] },
    ];
    const routes: TestRoute[] = [
      { path: 'mod02/both', module: 'recruitment', allOf: BOTH },
      { path: 'mod02/both-anywhere', allOf: BOTH },
      { path: 'mod02/mixed', roles: ['hr_staff', 'employee'], allOf: ['perm-recruitment'] },
    ];
    const links: TestEntry[] = routes.map((r, i) => ({ id: `mod02-alllink-${i}`, group: 'Comply', label: `Test link ${r.path}`, icon: 'shield-check', route: `/${r.path}`, order: i }));
    const BOTH_L = 'Test both item', ANY_L = 'Test both anywhere item', MIX_L = 'Test mixed item';

    // [who, sidebar, routes that open]. hr_staff alone, the tick alone, and both.
    const cases: Array<[string, Who, string[], string[]]> = [
      ['company A, hr_staff only', WHO.hrA, [], []],
      ['company A, employee with the tick only', WHO.empTickA, [MIX_L], ['mod02/mixed']],
      ['company A, hr_staff and the tick', WHO.hrTickA, [MIX_L, BOTH_L, ANY_L], ['mod02/both', 'mod02/both-anywhere', 'mod02/mixed']],
      ['company B (Recruitment off), hr_staff and the tick: the module is still needed where it is named', WHO.hrTickB, [MIX_L, ANY_L], ['mod02/both-anywhere', 'mod02/mixed']],
      ['company A, near group names only', WHO.empNearA, [], []],
    ];
    const labelsOf = async () => (await fakeLabels(page)).filter((l) => !l.startsWith('Test link'));
    const order = [MIX_L, BOTH_L, ANY_L];
    for (const [name, who, shows, opens] of cases) {
      const before = fake.calls.length;
      await register(page, { entries: [...entries, ...links], routes });
      await enter(page, signIn, cognito, fake, who);
      await settled(page, fake, before + 1);
      expect(await labelsOf(), `${name}: the sidebar`).toEqual(order.filter((l) => shows.includes(l)));

      for (const r of routes) {
        const want = opens.includes(r.path);
        await page.goto(`/${r.path}`);
        if (want) {
          await expect(page, `${name}: ${r.path} opens (address bar)`).toHaveURL(`/${r.path}`);
          await expect(page.locator('h1').first()).toHaveText(r.path);
        } else {
          await expect(page, `${name}: ${r.path} sends them to their first page (address bar)`).toHaveURL(who.lands);
          await expect(page.locator('main h1').first()).toBeVisible();
          await expect(page.locator('main'), `${name}: no refusal page`).not.toContainText(REFUSAL_WORDS);
        }
        // By link.
        await page.goto(who.lands);
        await expect(page.locator('main h1').first()).toBeVisible();
        await openNav(page);
        await page.locator('pp-side-navigation').getByRole('link', { name: `Test link ${r.path}`, exact: true }).click();
        if (want) await expect(page, `${name}: ${r.path} opens (link)`).toHaveURL(`/${r.path}`);
        else await expect(page, `${name}: ${r.path} sends them to their first page (link)`).toHaveURL(who.lands);
      }
      await forgetSignIn(page);
    }
    expect(errors, 'no console error and no uncaught error anywhere').toEqual([]);
  });

  test('AC-9 @pepla-dev Nothing breaks: the HR and employee test logins land where they do today with today\'s sidebar, the modules route is asked once per page load, and a company with Recruitment off sees the same sidebar', async ({ page, signIn, cognito, modules, hr, employee }, testInfo) => {
    const base = PROJECT(testInfo.project.name);
    const asked: string[] = [];
    page.on('request', (r) => { if (isModulesCall(new URL(r.url())) && r.method() === 'GET') asked.push(r.url()); });
    let answer: string[] | null = null;
    page.on('response', async (r) => {
      if (!isModulesCall(new URL(r.url())) || r.request().method() !== 'GET') return;
      answer = r.status() === 200 ? ((await r.json().catch(() => null)) as { modules?: string[] } | null)?.modules ?? null : null;
    });

    // Today's shell, whoever's it is: everything but the person's own words.
    // REC-UI-01 adds the "Hire" group (Roles, Pipeline at /hire/...) for a login that has Recruitment. Those entries are
    // new on purpose, so for the founding company's HR login they are set aside; everything else must still be today's.
    // The employee and a company with Recruitment off get no allowance: they must show no Hire entry at all.
    const sameAsToday = async (name: string, expected: ShellSnapshot, hireAllowed = false) => {
      await quiet(page);
      const raw = await snapshot(page);
      const got = hireAllowed
        ? { ...raw, headings: raw.headings.filter((h) => h !== 'Hire'), items: raw.items.filter((i) => !i.href.startsWith('/hire/')) }
        : raw;
      const bare = (s: ShellSnapshot) => ({ ...s, h1: '', topBar: { ...s.topBar, account: null, buttons: s.topBar.buttons.filter((b) => !/^Your account/.test(b.label)) }, product: { ...s.product, area: s.product.area === 'HR' ? 'HR' : '' } });
      expect(bare(got), `${name}: the sidebar, top bar and first page are today's`).toEqual(bare(expected));
    };

    // The founding company's HR login.
    const hrLogin: Login = hr;
    await signIn.open();
    await signIn.signInAs(hrLogin);
    await expect(page).toHaveURL('/hr');
    await expect.poll(() => asked.length, { message: 'the modules route is asked for on the page load' }).toBeGreaterThanOrEqual(1);
    await quiet(page);
    expect(asked, 'the modules route is asked once per page load').toHaveLength(1);
    await sameAsToday('HR', base.hr.snap, true);
    expect(answer, 'the founding company has both modules').toEqual(expect.arrayContaining(['onboarding', 'recruitment']));
    await forgetSignIn(page);

    // The employee test login.
    asked.length = 0;
    await signIn.open();
    await signIn.signInAs(employee);
    await expect(page).toHaveURL('/start');
    await expect.poll(() => asked.length).toBeGreaterThanOrEqual(1);
    await quiet(page);
    expect(asked, 'the modules route is asked once per page load').toHaveLength(1);
    await sameAsToday('Employee', base.employee.snap);
    await forgetSignIn(page);

    // A company with Recruitment off (MOD-01's seed on pepla-dev; the fake's company B here).
    const envEmail = process.env['E2E_B_HR_EMAIL'];
    const envPassword = process.env['E2E_B_HR_PASSWORD'];
    if (ON_DEV && !(envEmail && envPassword)) {
      test.info().annotations.push({ type: 'note', description: 'E2E_B_HR_EMAIL and E2E_B_HR_PASSWORD (MOD-01\'s seeded company B HR login) are not set: the company B part did not run.' });
      return;
    }
    asked.length = 0;
    answer = null;
    if (ON_DEV) {
      await signIn.open();
      await signIn.signInAs({ email: envEmail!, password: envPassword! });
    } else {
      await signInAs(page, signIn, cognito, modules, WHO.hrB);
    }
    await expect(page).toHaveURL('/hr');
    await expect.poll(() => asked.length).toBeGreaterThanOrEqual(1);
    await quiet(page);
    expect(asked, 'the modules route is asked once per page load').toHaveLength(1);
    await expect.poll(() => answer, { message: 'company B answers onboarding only' }).toEqual(['onboarding']);
    await sameAsToday('HR of a company with Recruitment off', base.hr.snap);
  });
});

/** The baseline is Jane Smith's; another HR person differs in the name only, and AC-5 compares everything else. */
function personalised(snap: ShellSnapshot, who: Who): ShellSnapshot {
  const label = `Your account, ${who.givenName} ${who.familyName}`;
  return {
    ...snap,
    h1: `Welcome back, ${who.givenName}`,
    topBar: { ...snap.topBar, account: label, buttons: snap.topBar.buttons.map((b) => (b.label.startsWith('Your account') ? { ...b, label } : b)) },
  };
}
