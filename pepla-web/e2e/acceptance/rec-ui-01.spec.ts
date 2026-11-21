import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { CognitoFake } from './support/cognito-fake';
import { ON_DEV, avatarButton, type SignInPage } from './support/fixtures';
import { FAILING_MODES, type ModulesFake } from './support/mod-02/modules-fake';
import { navHeadings, navItems, navLabels, openNav } from './support/mod-02/shell-snapshot';
import { card, chooseStage, dialog, firstName, moveButton, moveFirst, moveTo, readBoard, reason, showStage, stageOptions, dragCardTo, pickerCounts, visibleBlocks, WORDS } from './support/ang-01/gallery';
import { KIT } from './support/rec-ui/kit';
import { REASONS, WHO, companyIdIn, drawsIcon, enter, expect, quiet, signInAs, test, watchErrors, withoutRoles, type Cand, type HireFake, type Who } from './support/rec-ui/harness';

/**
 * REC-UI-01 · Roles and the hiring board (Jira NH-227, epic NH-223, amber).
 * Spec: onboarding-cards/specs/REC-UI-01.md and REC-UI-00.md. The fake API (support/rec-ui/harness.ts) is generated
 * from the contract table of REC-UI-01.md (D-API-1). Where the card is silent, cards/rec-ui-01.md fixes what these tests
 * assume (the builder implements exactly that). Words: only the kit's, the approved lines and the settled U-1, U-2, U-3, U-7.
 * Every test runs at 1280 and 390 wide, unless it says why not. No test calls Bedrock or any paid AI.
 *
 * AC-13 is the pepla-dev check: it cannot run until REC-02, REC-03 and REC-04 are on dev. It is tagged @pepla-dev and stays
 * red there until they are; it does not run in the no-backend run, and it does not hold the lock or the board's merge.
 */

const phone = () => test.info().project.name === 'phone-390';
const desktopOnly = (why: string) => test.skip(test.info().project.name !== 'desktop-1280', `Desktop only: ${why}`);
const phoneOnly = (why: string) => test.skip(!phone(), `Phone only: ${why}`);
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');

// ---------------------------------------------------------------- the words (kit text, approved lines, settled U-1, U-2, U-3, U-7)
const SAVE_FAIL = 'Your change could not be saved. Try again.';
const ROLE_NOT_FOUND = 'This role could not be found.';
const ROLES_FAIL = 'Roles could not be loaded.';
const CLOSE_LINE = 'Move each open candidate to Hired or Not hired before you close this role.';
const EMPTY_ROLES = 'No open roles yet';
const EMPTY_ROLES_LINE = 'Open a role to start its hiring board.';
const HELP_LINE = "From your company's default. Change it for this role if you need to.";
const NOT_HIRED_LINE = 'Not hired always carries a reason.';
const OLD_LINE = 'These candidates were turned down by a score before 17 Nov. Open any of them to look again.';
const must = (name: string) => `${name} must confirm before this is final.`;

// ---------------------------------------------------------------- helpers

type Fx = { page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null };

/** Signs in as a Recruiter of company A and lands on HR home. */
async function asRecruiter(fx: Fx, who: Who = WHO.recruiterA): Promise<void> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
}

const main = (page: Page): Locator => page.locator('main');
const h1 = (page: Page): Locator => page.locator('main h1').first();
const either = (page: Page, name: string | RegExp, exact = true) => page.getByRole('button', { name, exact }).or(page.getByRole('link', { name, exact }));

async function openRoles(fx: Fx): Promise<void> {
  await fx.page.goto('/hire/roles');
  await expect(h1(fx.page)).toHaveText('Roles');
}

async function openBoard(fx: Fx, role = 'role-fleet', title = 'Fleet controller'): Promise<Locator> {
  await fx.page.goto(`/hire/pipeline?role=${role}&view=board`);
  await expect(h1(fx.page)).toHaveText(title);
  await expect(main(fx.page).locator('.pp-pipeline').first()).toBeVisible();
  return main(fx.page);
}

/** The board's own cards, found by what a person sees; on a phone the picker shows the card's stage first. */
async function cardOf(scope: Locator, name: string, stage: string): Promise<Locator> {
  await showStage(scope, stage);
  const c = card(scope, name);
  await expect(c, `${name} is on the ${stage} column`).toHaveCount(1);
  return c;
}

const moveBtn = (scope: Locator, name: string) => scope.getByRole('button', { name: moveFirst(name), exact: true });
const cardMore = (scope: Locator, name: string) => scope.getByRole('button', { name: `More actions for ${firstName(name)}`, exact: true });
const pageMore = (scope: Locator, role: string) => scope.getByRole('button', { name: `More actions for ${role}`, exact: true });
const moveCalls = (hire: HireFake) => hire.to('PUT', /\/stage$/);
const notHiredCalls = (hire: HireFake) => hire.to('POST', /\/not-hired(\/confirm|\/cancel)?$/);

/** Where every card is: stage name to names, whatever the width shows (a phone shows one stage at a time). */
async function boardNow(scope: Locator): Promise<Record<string, string[]>> {
  const picker = scope.getByLabel('Stage', { exact: true });
  if (await picker.isVisible()) {
    const out: Record<string, string[]> = {};
    for (const t of await picker.locator('option').allTextContents()) {
      const stage = t.replace(/\s*\(\d+\)\s*$/, '').trim();
      await showStage(scope, stage);
      out[stage] = (await readBoard(scope)).find((c) => c.stage === stage)?.cards ?? [];
    }
    return out;
  }
  return Object.fromEntries((await readBoard(scope)).map((c) => [c.stage, c.cards]));
}
const FLEET_AT_START = { Applied: ['Amahle Dlamini'], Screening: ['Tariro Moyo', 'Ayanda Mkhize'], Interview: ['Bongani Mthembu', 'Tendai Ncube'], Offer: ['Kagiso Molefe'], Hired: [] as string[] };

/** The sentence is on the page, once, in the main area or in a dialog. */
async function seeLine(page: Page, text: string): Promise<void> {
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
}

async function pickOption(scope: Locator | Page, label: string, option: string): Promise<void> {
  const field = scope.getByLabel(label, { exact: true });
  if ((await field.evaluate((el) => el.tagName)) === 'SELECT') await field.selectOption({ label: option });
  else { await field.click(); await (scope as Page).getByRole('option', { name: option, exact: true }).click(); }
}

// ================================================================ AC-1 Entry and guard
test.describe('AC-1 Entry and guard', () => {
  test.beforeEach(noBackendOnly);

  test('AC-1 A Recruiter of A sees Hire > Roles and Pipeline in the design system order, with the kit labels, links and icons, and no console error', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page } = fx;
    const errors = watchErrors(page);
    await asRecruiter(fx);
    await openNav(page);
    await expect.poll(() => navLabels(page), { message: 'the sidebar shows Roles and Pipeline once the modules answer has come' }).toEqual(expect.arrayContaining(['Roles', 'Pipeline']));
    const labels = await navLabels(page);
    expect(labels.indexOf('Roles') + 1, 'Pipeline sits straight after Roles').toBe(labels.indexOf('Pipeline'));
    expect(await navHeadings(page), 'the group is Hire').toContain('Hire');
    const under = await page.locator('pp-side-navigation .pp-side-navigation__section').evaluateAll((sections) =>
      sections.map((s) => ({ heading: (s.querySelector('.pp-side-navigation__heading')?.textContent ?? '').trim(), items: [...s.querySelectorAll('a.pp-side-navigation__item')].map((a) => ({ label: (a.querySelector('.pp-side-navigation__label')?.textContent ?? '').trim(), href: a.getAttribute('href') })) })));
    const hire = under.find((s) => s.heading === 'Hire');
    expect(hire?.items, 'Roles then Pipeline, under the heading Hire, with their routes').toEqual([{ label: 'Roles', href: '/hire/roles' }, { label: 'Pipeline', href: '/hire/pipeline' }]);
    expect(await drawsIcon(navItems(page).filter({ hasText: /^Roles$/ }), 'briefcase'), 'Roles draws the briefcase icon').toBe(true);
    expect(await drawsIcon(navItems(page).filter({ hasText: /^Pipeline$/ }), 'columns-3'), 'Pipeline draws the columns icon').toBe(true);
    // HR's first page stays Today (D-LANDING): this card registers no landing override.
    await expect(page).toHaveURL('/hr');
    // Both entries open: the link goes to the screen.
    await navItems(page).filter({ hasText: /^Roles$/ }).click();
    await expect(page).toHaveURL(/\/hire\/roles$/);
    await expect(h1(page)).toHaveText('Roles');
    await quiet(page);
    expect(errors, 'no console error').toEqual([]);
  });

  const DENIED: Array<[string, Who, string]> = [
    ['a Recruiter of company B (Recruitment off)', WHO.recruiterB, 'B'],
    ['a Recruiter of company C (nothing on)', WHO.recruiterC, 'C'],
    ['HR without the Recruitment tick', WHO.hrNoTickA, 'A'],
    ['the tick without HR', WHO.tickOnlyA, 'A'],
    ['a hiring manager', WHO.managerA, 'A'],
    ['an Admin', WHO.adminA, 'A'],
    ['an Employee', WHO.employeeA, 'A'],
  ];
  for (const [label, who] of DENIED) {
    test(`AC-1 ${label} sees no Hire entry, is sent to their own first page from the address bar, makes no Recruitment request and causes no console error`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
      const { page, hire } = fx;
      const errors = watchErrors(page);
      await signInAs(fx.signIn, fx.cognito, fx.modules, hire, who);
      if (who.lands) {
        await expect(page).toHaveURL(who.lands);
        await quiet(page);
        await openNav(page);
        const labels = await navLabels(page);
        expect(labels, 'no Roles or Pipeline in the sidebar').not.toContain('Roles');
        expect(labels).not.toContain('Pipeline');
        expect(await navHeadings(page), 'no Hire heading').not.toContain('Hire');
      } else {
        await expect(page).toHaveURL(/\/sign-in/); // today ONB-23 refuses this group at sign-in (cards/rec-ui-01.md)
      }
      for (const path of ['/hire/roles', '/hire/roles/new', '/hire/pipeline?role=role-fleet&view=board', '/hire/candidates/old-system']) {
        await page.goto(path);
        await quiet(page);
        await expect(page, `${path} sends them away`).not.toHaveURL(/\/hire\//);
        if (who.lands) await expect(page, `${path} sends them to their first page`).toHaveURL(who.lands);
        else await expect(page).toHaveURL(/\/sign-in/);
      }
      expect(hire!.recruitmentCalls.map((c) => `${c.method} ${c.path}`), 'no request to a Recruitment route').toEqual([]);
      expect(errors, 'no console error').toEqual([]);
    });
  }

  for (const mode of FAILING_MODES) {
    test(`AC-1 With the modules call failing (${mode}) a Recruiter sees no Hire entry, is sent to HR home from the address bar and makes no Recruitment request`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
      const { page, hire, modules } = fx;
      const errors = watchErrors(page);
      modules!.mode = mode;
      await signInAs(fx.signIn, fx.cognito, modules, hire, WHO.recruiterA);
      await expect(page).toHaveURL('/hr');
      await quiet(page);
      await openNav(page);
      expect(await navLabels(page)).not.toContain('Roles');
      await page.goto('/hire/roles');
      await quiet(page);
      await expect(page).toHaveURL('/hr');
      expect(hire!.recruitmentCalls, 'no request to a Recruitment route').toEqual([]);
      expect(errors, 'no console error').toEqual([]);
    });
  }
});

// ================================================================ AC-2 Roles list
test.describe('AC-2 Roles list', () => {
  test.beforeEach(noBackendOnly);

  test('AC-2 The page, its line, its button and its table show the words and the answer: three roles with their managers, counts, lozenges and dates', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    await asRecruiter(fx);
    await openRoles(fx);
    await expect(page.getByText(/^Every open role at \S.*\.$/), 'the line under the heading').toBeVisible();
    await expect(either(page, 'Open a role'), 'the button').toBeVisible();
    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    if (!phone()) for (const c of ['Role', 'Hiring manager', 'Candidates', 'Opened']) await expect(table.getByRole('columnheader', { name: c, exact: true }), `column ${c}`).toBeVisible();
    const rows = table.getByRole('row').filter({ has: page.getByRole('button', { name: /^Open /, exact: false }).or(page.getByRole('link', { name: /^Open /, exact: false })) });
    await expect(rows).toHaveCount(3);
    const text = async (name: string) => ((await rows.filter({ hasText: name }).first().textContent()) ?? '').replace(/\s+/g, ' ');
    const fleet = await text('Fleet controller');
    for (const part of ['Sipho Ndlovu', '6', '1 overdue', '12 Oct 2026']) expect(fleet, `Fleet controller row has ${part}`).toContain(part);
    const wh = await text('Warehouse supervisor');
    for (const part of ['Farai Chikwanha', '4', '20 Oct 2026']) expect(wh, `Warehouse supervisor row has ${part}`).toContain(part);
    expect(wh, 'no lozenge for a role with nothing late').not.toMatch(/overdue|due soon/i);
    const acc = await text('Senior accountant');
    for (const part of ['Precious Mwale', '3', '1 due soon', '28 Oct 2026']) expect(acc, `Senior accountant row has ${part}`).toContain(part);
    // The numbers come from the answer, not from the page.
    expect(hire!.to('GET', /\/v1\/roles$/).map((c) => c.query['status']), 'one read of the open roles').toEqual(['OPEN']);
    await expect(either(page, 'Open Fleet controller')).toBeVisible();
    await expect(either(page, 'Open Warehouse supervisor')).toBeVisible();
    await expect(either(page, 'Open Senior accountant')).toBeVisible();
  });

  test('AC-2 The counts and lozenges are the answer\'s: another answer shows other numbers', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    const fleet = hire!.world.cands.filter((c) => c.role_id === 'role-warehouse' && c.stage !== 'NOT_HIRED' && !c.old_system);
    fleet[0]!.sla_status = 'OVERDUE'; fleet[1]!.sla_status = 'OVERDUE'; fleet[2]!.sla_status = 'DUE_SOON';
    await asRecruiter(fx);
    await openRoles(fx);
    const row = page.getByRole('row').filter({ hasText: 'Warehouse supervisor' });
    await expect(row).toContainText('2 overdue');
    await expect(row).toContainText('Farai Chikwanha');
  });

  test('AC-2 A row opens the board of that role', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page } = fx;
    await asRecruiter(fx);
    await openRoles(fx);
    await either(page, 'Open Warehouse supervisor').click();
    await expect(page).toHaveURL(/\/hire\/pipeline\?(?=.*role=role-warehouse)(?=.*view=board)/);
    await expect(h1(page)).toHaveText('Warehouse supervisor');
  });

  test('AC-2 No open roles shows the approved empty state, no table and a way to open one', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    withoutRoles(hire!.world, 'A');
    await asRecruiter(fx);
    await openRoles(fx);
    await seeLine(page, EMPTY_ROLES);
    await seeLine(page, EMPTY_ROLES_LINE);
    await expect(page.getByRole('table')).toHaveCount(0);
    await expect(either(page, 'Open a role').first()).toBeVisible();
  });

  const FAILURES: Array<[string, { status?: number; abort?: boolean; body?: unknown }]> = [
    ['a 403', { status: 403, body: { error: 'Forbidden' } }], ['a 500', { status: 500 }], ['a dropped connection', { abort: true }], ['a 404', { status: 404 }],
  ];
  for (const [label, how] of FAILURES) {
    test(`AC-2 ${label} shows the generic failure state with Try again, never data, and Try again asks once more`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
      const { page, hire } = fx;
      await asRecruiter(fx);
      hire!.refuse({ method: 'GET', path: /\/v1\/roles$/, ...how });
      await page.goto('/hire/roles');
      await seeLine(page, ROLES_FAIL);
      await expect(page.getByText('Fleet controller')).toHaveCount(0);
      await expect(page.getByRole('table')).toHaveCount(0);
      const before = hire!.to('GET', /\/v1\/roles$/).length;
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(page.getByText('Fleet controller').first()).toBeVisible();
      expect(hire!.to('GET', /\/v1\/roles$/).length, 'Try again sent exactly one more read').toBe(before + 1);
    });
  }
});

// ================================================================ AC-3 Open a role
test.describe('AC-3 Open a role', () => {
  test.beforeEach(noBackendOnly);

  async function openForm(fx: Fx): Promise<void> {
    await asRecruiter(fx);
    await openRoles(fx);
    await either(fx.page, 'Open a role').first().click();
    await expect(fx.page).toHaveURL(/\/hire\/roles\/new$/);
    await expect(h1(fx.page)).toHaveText('Open a role');
  }
  const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });

  test('AC-3 The page has the breadcrumb Roles > Open a role, every field with its approved label, the default criteria, the help line and the two buttons', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page } = fx;
    await openForm(fx);
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    // On a phone the design system shows only the last crumb: the parent is still there, pointing at Roles.
    if (phone()) await expect(crumbs.locator('a', { hasText: /^Roles$/ })).toHaveAttribute('href', /\/hire\/roles$/);
    else await expect(crumbs.getByRole('link', { name: 'Roles', exact: true })).toBeVisible();
    await expect(crumbs.locator('li').last()).toHaveText('Open a role');
    for (const label of ['Job title', 'Department', 'Seniority level', 'Hiring manager', 'What the panel scores', 'Panel size']) await expect(field(page, label), label).toBeVisible();
    await expect(field(page, 'What the panel scores')).toHaveValue('Technical ability, Communication, Cultural fit, Problem solving');
    await seeLine(page, HELP_LINE);
    await expect(page.getByRole('button', { name: 'Open a role', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
    if (!phone()) await crumbs.getByRole('link', { name: 'Roles', exact: true }).click();
    else await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(/\/hire\/roles$/);
  });

  test('AC-3 Levels, departments and the default criteria are the company settings\' (another company setting shows other choices), and the hiring managers are the picker\'s answer only', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    hire!.world.config.A = {
      seniority_levels: [{ key: 'TRAINEE', label: 'Trainee', order: 1 }, { key: 'LEAD', label: 'Lead', order: 2 }],
      criteria: [{ key: 'SAFETY', label: 'Safety record' }, { key: 'ROUTES', label: 'Route knowledge' }],
      departments: ['Fleet', 'Stores'], screening: true,
    };
    hire!.world.managers.A = [{ id: 'hm-zodwa', name: 'Zodwa Hlatshwayo' }, { id: 'hm-bheki', name: 'Bheki Ntuli' }];
    await openForm(fx);
    await expect(field(page, 'What the panel scores')).toHaveValue('Safety record, Route knowledge');
    const options = async (label: string) => (await field(page, label).locator('option').allTextContents()).map((t) => t.trim()).filter(Boolean);
    expect(await options('Seniority level')).toEqual(expect.arrayContaining(['Trainee', 'Lead']));
    expect(await options('Seniority level')).not.toContain('Senior');
    expect(await options('Department')).toEqual(expect.arrayContaining(['Fleet', 'Stores']));
    const managers = await options('Hiring manager');
    expect(managers.filter((m) => !/^(choose|select)/i.test(m)), 'only the picker\'s names').toEqual(['Zodwa Hlatshwayo', 'Bheki Ntuli']);
    expect(hire!.to('GET', /\/v1\/hiring-managers$/).length, 'the picker was read').toBeGreaterThanOrEqual(1);
    expect(hire!.to('GET', /\/v1\/config$/).length, 'the settings were read').toBeGreaterThanOrEqual(1);
  });

  test('AC-3 Submitting sends the contract body once with one Idempotency-Key and no company, then opens the new role\'s board', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    await openForm(fx);
    await field(page, 'Job title').fill('Dispatch coordinator');
    await pickOption(page, 'Department', 'Finance');
    await pickOption(page, 'Seniority level', 'Senior');
    await pickOption(page, 'Hiring manager', 'Farai Chikwanha');
    await field(page, 'Panel size').fill('4');
    await page.getByRole('button', { name: 'Open a role', exact: true }).click();
    await expect(page).toHaveURL(/\/hire\/pipeline\?(?=.*role=role-new-1)(?=.*view=board)/);
    await expect(h1(page)).toHaveText('Dispatch coordinator');
    const posts = hire!.to('POST', /\/v1\/roles$/);
    expect(posts, 'exactly one POST').toHaveLength(1);
    expect(posts[0]!.body, 'the contract body').toEqual({
      job_title: 'Dispatch coordinator', department: 'Finance', level: 'SENIOR', hiring_manager_id: 'hm-farai',
      criteria: ['TECHNICAL', 'COMMUNICATION', 'CULTURAL_FIT', 'PROBLEM_SOLVING'], panel_size: 4,
    });
    expect(posts[0]!.idempotencyKey, 'one Idempotency-Key').toMatch(/^[\w-]{8,}$/);
    expect(companyIdIn(posts[0]!), 'no company in the request').toEqual([]);
  });

  test('AC-3 Changing the criteria sends the kept keys; a second role in a row carries another key', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    await openForm(fx);
    await field(page, 'Job title').fill('Route planner');
    await field(page, 'What the panel scores').fill('Technical ability, Communication');
    await page.getByRole('button', { name: 'Open a role', exact: true }).click();
    await expect(page).toHaveURL(/role=role-new-1/);
    await page.goto('/hire/roles/new');
    await field(page, 'Job title').fill('Route planner two');
    await page.getByRole('button', { name: 'Open a role', exact: true }).click();
    await expect(page).toHaveURL(/role=role-new-2/);
    const posts = hire!.to('POST', /\/v1\/roles$/);
    expect(posts).toHaveLength(2);
    expect((posts[0]!.body as { criteria: string[] }).criteria).toEqual(['TECHNICAL', 'COMMUNICATION']);
    expect(posts[0]!.idempotencyKey).not.toBe(posts[1]!.idempotencyKey);
  });

  test('AC-3 Nothing is sent without a job title', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    await openForm(fx);
    await page.getByRole('button', { name: 'Open a role', exact: true }).click();
    await page.waitForTimeout(500);
    expect(hire!.to('POST', /\/v1\/roles$/), 'no request').toHaveLength(0);
    await expect(page).toHaveURL(/\/hire\/roles\/new$/);
  });

  test('AC-3 Pressing the button twice while the request is in flight sends one request', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    await openForm(fx);
    await field(page, 'Job title').fill('Fleet clerk');
    hire!.refuse({ method: 'POST', path: /\/v1\/roles$/, hold: true });
    const button = page.getByRole('button', { name: 'Open a role', exact: true });
    await button.click();
    await button.click({ force: true, timeout: 1000 }).catch(() => undefined);
    await page.waitForTimeout(300);
    expect(hire!.to('POST', /\/v1\/roles$/), 'one request while the first is in flight').toHaveLength(1);
    hire!.release();
    await expect(page).toHaveURL(/role=role-new-1/);
    expect(hire!.to('POST', /\/v1\/roles$/)).toHaveLength(1);
  });

  const FAIL: Array<[string, { status?: number; abort?: boolean; body?: unknown }]> = [
    ['INVALID_HIRING_MANAGER', { status: 400, body: { error: 'Invalid', code: 'INVALID_HIRING_MANAGER' } }],
    ['a field error', { status: 400, body: { error: 'Invalid', code: 'INVALID_FIELD' } }], ['a 500', { status: 500 }], ['a 403', { status: 403, body: { error: 'Forbidden' } }],
  ];
  for (const [label, how] of FAIL) {
    test(`AC-3 ${label} keeps the form filled and shows the generic save failure; nothing is created`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
      const { page, hire } = fx;
      await openForm(fx);
      await field(page, 'Job title').fill('Stores clerk');
      await pickOption(page, 'Department', 'Sales');
      await pickOption(page, 'Seniority level', 'Junior');
      await field(page, 'Panel size').fill('2');
      hire!.refuse({ method: 'POST', path: /\/v1\/roles$/, ...how });
      await page.getByRole('button', { name: 'Open a role', exact: true }).click();
      await seeLine(page, SAVE_FAIL);
      await expect(page).toHaveURL(/\/hire\/roles\/new$/);
      await expect(field(page, 'Job title')).toHaveValue('Stores clerk');
      await expect(field(page, 'Department')).toHaveValue(/Sales/);
      await expect(field(page, 'Panel size')).toHaveValue('2');
      expect(hire!.world.roles.filter((r) => r.job_title === 'Stores clerk'), 'no role was made').toHaveLength(0);
    });
  }

  test('AC-3 After a dropped connection the same attempt is sent again with the same Idempotency-Key, so a role that was saved is not made twice', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    await openForm(fx);
    await field(page, 'Job title').fill('Depot manager');
    hire!.refuse({ method: 'POST', path: /\/v1\/roles$/, abort: true });
    await page.getByRole('button', { name: 'Open a role', exact: true }).click();
    await seeLine(page, SAVE_FAIL);
    await page.getByRole('button', { name: 'Open a role', exact: true }).click();
    await expect(page).toHaveURL(/role=role-new-1/);
    const posts = hire!.to('POST', /\/v1\/roles$/);
    expect(posts).toHaveLength(2);
    expect(posts[1]!.idempotencyKey, 'the second attempt re-sends the first attempt\'s key').toBe(posts[0]!.idempotencyKey);
    expect(hire!.world.roles.filter((r) => r.job_title === 'Depot manager')).toHaveLength(1);
  });

  test('AC-3 Cancel goes back to Roles and sends nothing', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    await openForm(fx);
    await field(page, 'Job title').fill('Nobody');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(/\/hire\/roles$/);
    expect(hire!.to('POST', /\/v1\/roles$/)).toHaveLength(0);
  });
});

// ================================================================ AC-4 The board
test.describe('AC-4 The board', () => {
  test.beforeEach(noBackendOnly);

  test('AC-4 The page shows the breadcrumb, the heading, the line, the view switch, More actions, the tabs with their counts, the search, More filters and "Not hired 2"; the numbers come from the answer', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    hire!.countsOverride = { all: 6, mine: 3, overdue: 2, due_soon: 2, not_hired: 2 };
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    // On a phone the design system shows only the last crumb: the parent is still there, pointing at Roles.
    if (phone()) await expect(crumbs.locator('a', { hasText: /^Roles$/ })).toHaveAttribute('href', /\/hire\/roles$/);
    else await expect(crumbs.getByRole('link', { name: 'Roles', exact: true })).toBeVisible();
    await expect(crumbs.locator('li').last()).toHaveText('Fleet controller');
    await expect(scope.getByText('6 candidates · Hiring manager Sipho Ndlovu', { exact: true })).toBeVisible();
    for (const view of ['List', 'Board']) await expect(either(page, view).or(page.getByRole('radio', { name: view, exact: true })).or(page.getByRole('tab', { name: view, exact: true })).first(), `view ${view}`).toBeVisible();
    await expect(pageMore(scope, 'Fleet controller')).toBeVisible();
    for (const [name, n] of [['All', 6], ['My candidates', 3], ['Overdue', 2], ['Due soon', 2]] as const) {
      await expect(scope.getByRole('tab', { name: new RegExp(`^${name}\\s*${n}$`) }), `tab ${name} ${n}`).toBeVisible();
    }
    await expect(scope.locator('input[type="search"][placeholder="Search by name, email or role"]')).toBeVisible();
    await expect(scope.getByRole('button', { name: 'More filters', exact: true })).toBeVisible();
    await expect(scope.getByRole('button', { name: 'Not hired 2', exact: true })).toBeVisible();
    // The role and its cards were read with the company's token only.
    expect(hire!.to('GET', /\/v1\/roles\/role-fleet$/).length).toBeGreaterThanOrEqual(1);
    const first = hire!.to('GET', /\/v1\/candidates$/)[0]!;
    expect(first.query['role_id']).toBe('role-fleet');
    expect(Number(first.query['limit'] ?? 100), 'a page of at most 100 (D-RUI-3)').toBeLessThanOrEqual(100);
  });

  test('AC-4 Five columns with their names and counts, "No one yet" in the empty one, and each card shows initials, name and its line with the Move button', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page } = fx;
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    expect(await boardNow(scope)).toEqual(FLEET_AT_START);
    if (phone()) expect(await pickerCounts(scope)).toEqual({ Applied: 1, Screening: 2, Interview: 2, Offer: 1, Hired: 0 });
    else expect((await readBoard(scope)).map((c) => [c.stage, c.count])).toEqual([['Applied', 1], ['Screening', 2], ['Interview', 2], ['Offer', 1], ['Hired', 0]]);
    await showStage(scope, 'Hired');
    await expect(scope.locator('.pp-pipeline__column').filter({ hasText: 'Hired' }).getByText('No one yet', { exact: true })).toBeVisible();
    const lines: Array<[string, string, RegExp | string]> = [
      ['Amahle Dlamini', 'Applied', 'Referral'], ['Tariro Moyo', 'Screening', /Day \d+/], ['Bongani Mthembu', 'Interview', '2 of 3 interviews'],
      ['Tendai Ncube', 'Interview', '1 of 2 interviews'], ['Kagiso Molefe', 'Offer', 'Offer sent'],
    ];
    for (const [name, stage, line] of lines) {
      const c = await cardOf(scope, name, stage);
      await expect(c, `${name}'s line`).toContainText(line);
      await expect(c.locator('.pp-avatar').first(), `${name}'s initials`).toContainText(name.split(' ').map((w) => w[0]).join(''));
      await expect(moveBtn(scope, name), `${name}'s Move button`).toBeVisible();
    }
    void page;
  });

  test('AC-4 The stage-time lozenge shows the answer\'s status: overdue, due today, nothing when on track', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    await expect(await cardOf(scope, 'Bongani Mthembu', 'Interview')).toContainText('Overdue by 2 days');
    await expect(await cardOf(scope, 'Tendai Ncube', 'Interview')).toContainText('Due today');
    await expect((await cardOf(scope, 'Amahle Dlamini', 'Applied')).locator('.pp-lozenge'), 'an on-track card carries no lozenge').toHaveCount(0);
    await expect((await cardOf(scope, 'Tariro Moyo', 'Screening')).locator('.pp-lozenge')).toHaveCount(0);
  });

  test('AC-4 With Screening off the board has four columns (no Screening) and the picker has no Screening', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { hire } = fx;
    hire!.world.config.A.screening = false;
    for (const c of hire!.world.cands.filter((x) => x.stage === 'SCREENING')) c.stage = 'APPLIED';
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    const now = await boardNow(scope);
    expect(Object.keys(now)).toEqual(['Applied', 'Interview', 'Offer', 'Hired']);
    expect(now['Applied']).toEqual(['Amahle Dlamini', 'Tariro Moyo', 'Ayanda Mkhize']);
  });

  test('AC-4 The tabs send their filter: All none, My candidates, Overdue, Due soon; the board shows what the answer holds', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { hire } = fx;
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    const names = async () => Object.values(await boardNow(scope)).flat().sort();
    await scope.getByRole('tab', { name: /^Overdue/ }).click();
    await expect.poll(names).toEqual(['Bongani Mthembu']);
    expect(hire!.calls.filter((c) => c.path.endsWith('/v1/candidates')).at(-1)!.query).toMatchObject({ role_id: 'role-fleet', sla_status: 'OVERDUE' });
    await scope.getByRole('tab', { name: /^Due soon/ }).click();
    await expect.poll(names).toEqual(['Tendai Ncube']);
    expect(hire!.calls.filter((c) => c.path.endsWith('/v1/candidates')).at(-1)!.query).toMatchObject({ sla_status: 'DUE_SOON' });
    await scope.getByRole('tab', { name: /^My candidates/ }).click();
    await expect.poll(names).toEqual(['Amahle Dlamini', 'Bongani Mthembu', 'Tariro Moyo']);
    expect(hire!.calls.filter((c) => c.path.endsWith('/v1/candidates')).at(-1)!.query).toMatchObject({ role_id: 'role-fleet', mine: 'true' });
    await scope.getByRole('tab', { name: /^All/ }).click();
    await expect.poll(names).toHaveLength(6);
    const last = hire!.calls.filter((c) => c.path.endsWith('/v1/candidates')).at(-1)!.query;
    expect(last['sla_status'], 'All sends no status').toBeUndefined();
    expect(last['mine'], 'All sends no "mine"').toBeUndefined();
  });

  test('AC-4 Search sends the words typed and the board shows what the answer holds', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { hire } = fx;
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    await scope.locator('input[type="search"][placeholder="Search by name, email or role"]').fill('Ayanda');
    await expect.poll(async () => Object.values(await boardNow(scope)).flat()).toEqual(['Ayanda Mkhize']);
    expect(hire!.calls.filter((c) => c.path.endsWith('/v1/candidates')).at(-1)!.query).toMatchObject({ role_id: 'role-fleet', search: 'Ayanda' });
  });

  test('AC-4 Add candidate is hidden until REC-UI-02 is on, so the board has no primary button', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page } = fx;
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    await expect(either(page, /add candidate/i, false), 'no Add candidate button').toHaveCount(0);
    await expect(scope.locator('.pp-button--primary'), 'no primary button on the board').toHaveCount(0);
  });

  test('AC-4 A failing read shows the generic could-not-be-loaded state with Try again, never cards, and Try again reads once more', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    await asRecruiter(fx);
    hire!.refuse({ method: 'GET', path: /\/v1\/candidates$/, status: 500 });
    await page.goto('/hire/pipeline?role=role-fleet&view=board');
    await expect(page.getByText(/could not be loaded\.$/).first()).toBeVisible();
    await expect(page.getByText('Amahle Dlamini')).toHaveCount(0);
    const before = hire!.to('GET', /\/v1\/candidates$/).length;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('Amahle Dlamini').first()).toBeAttached();
    expect(hire!.to('GET', /\/v1\/candidates$/).length).toBe(before + 1);
  });
});

// ================================================================ AC-5 Moving by button and by drag
test.describe('AC-5 Moving by button and by drag', () => {
  test.beforeEach(noBackendOnly);

  async function openMove(fx: Fx, name: string, stage: string): Promise<{ scope: Locator; d: Locator }> {
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    await showStage(scope, stage);
    await moveBtn(scope, name).click();
    const d = dialog(fx.page, name);
    await expect(d).toBeVisible();
    return { scope, d };
  }

  test('AC-5 The button opens the dialog with the approved words; nothing moves and nothing is sent while it is open; Move stays disabled until a reason and a different stage', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    const { scope, d } = await openMove(fx, 'Tariro Moyo', 'Screening');
    const words = (await visibleBlocks(d)).join(' | ');
    for (const w of [moveFirst('Tariro Moyo'), WORDS.field, WORDS.reason, WORDS.reasonHelp, WORDS.cancel, WORDS.move]) expect(words, `the dialog says "${w}"`).toContain(w);
    expect(words, 'going forward does not say moving back').not.toContain(WORDS.backHelp);
    await expect(moveButton(d)).toBeDisabled(); // same stage, no reason
    await reason(d).fill('Phone screen done');
    await expect(moveButton(d), 'a reason but the same stage').toBeDisabled();
    await chooseStage(d, 'Interview');
    await reason(d).fill('   ');
    await expect(moveButton(d), 'a stage but a blank reason').toBeDisabled();
    await reason(d).fill('Phone screen done');
    await expect(moveButton(d)).toBeEnabled();
    await page.waitForTimeout(200);
    expect(moveCalls(hire!), 'nothing sent while the dialog is open').toHaveLength(0);
    await d.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await boardNow(scope)).toEqual(FLEET_AT_START);
  });

  test('AC-5 Moving back a stage shows "Moving back a stage needs a reason too."', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { d } = await openMove(fx, 'Tariro Moyo', 'Screening');
    await chooseStage(d, 'Applied');
    await expect(d.getByText(WORDS.backHelp, { exact: true })).toBeVisible();
    await chooseStage(d, 'Interview');
    await expect(d.getByText(WORDS.backHelp, { exact: true })).toHaveCount(0);
  });

  test('AC-5 Confirming sends exactly one PUT with { to, reason } and one Idempotency-Key; the card moves only after the answer, counts follow, and no company travels', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    const { scope, d } = await openMove(fx, 'Amahle Dlamini', 'Applied');
    await chooseStage(d, 'Screening');
    await reason(d).fill('Phone screen booked');
    hire!.refuse({ method: 'PUT', path: /\/stage$/, hold: true });
    await moveButton(d).click();
    await expect.poll(() => moveCalls(hire!).length).toBe(1);
    expect(await boardNow(scope), 'the card has not moved while the request is open').toEqual(FLEET_AT_START);
    hire!.release();
    await expect.poll(async () => (await boardNow(scope))['Screening']).toEqual(['Tariro Moyo', 'Ayanda Mkhize', 'Amahle Dlamini']);
    const calls = moveCalls(hire!);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toMatch(/\/v1\/candidates\/cand-amahle\/stage$/);
    expect(calls[0]!.body).toEqual({ to: 'SCREENING', reason: 'Phone screen booked' });
    expect(calls[0]!.idempotencyKey).toMatch(/^[\w-]{8,}$/);
    expect(companyIdIn(calls[0]!)).toEqual([]);
    await expect(dialog(page, 'Amahle Dlamini')).toHaveCount(0);
    const now = await boardNow(scope);
    expect(now['Applied']).toEqual([]);
    // A second move is another request with another key.
    await showStage(scope, 'Screening');
    await moveBtn(scope, 'Tariro Moyo').click();
    const d2 = dialog(page, 'Tariro Moyo');
    await chooseStage(d2, 'Interview');
    await reason(d2).fill('Good call');
    await moveButton(d2).click();
    await expect.poll(() => moveCalls(hire!).length).toBe(2);
    expect(moveCalls(hire!)[1]!.idempotencyKey).not.toBe(moveCalls(hire!)[0]!.idempotencyKey);
  });

  test('AC-5 Pressing Move twice sends one request', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { hire } = fx;
    const { d } = await openMove(fx, 'Amahle Dlamini', 'Applied');
    await chooseStage(d, 'Screening');
    await reason(d).fill('Phone screen booked');
    hire!.refuse({ method: 'PUT', path: /\/stage$/, hold: true });
    await moveButton(d).click();
    await moveButton(d).click({ force: true, timeout: 800 }).catch(() => undefined);
    await d.page().waitForTimeout(300);
    expect(moveCalls(hire!)).toHaveLength(1);
    hire!.release();
  });

  for (const how of ['Cancel', 'Close', 'Escape'] as const) {
    test(`AC-5 ${how} closes the dialog, leaves the card, sends nothing and returns focus to its Move button`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
      const { page, hire } = fx;
      const { scope, d } = await openMove(fx, 'Amahle Dlamini', 'Applied');
      await chooseStage(d, 'Screening');
      await reason(d).fill('Not sent');
      if (how === 'Escape') await page.keyboard.press('Escape');
      else await d.getByRole('button', { name: how, exact: true }).click();
      await expect(d).toHaveCount(0);
      await expect(moveBtn(scope, 'Amahle Dlamini'), 'focus is back on the Move button').toBeFocused(); // before anything else moves focus (on a phone, reading the board changes the stage picker)
      expect(await boardNow(scope)).toEqual(FLEET_AT_START);
      expect(moveCalls(hire!)).toHaveLength(0);
    });
  }

  test('AC-5 A drop on another column opens the same dialog with that stage chosen; the card stays until confirmed (desktop)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    desktopOnly('a phone board is one list with no drag');
    const { page, hire } = fx;
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    await dragCardTo(page, scope, 'Amahle Dlamini', 'Screening');
    const d = dialog(page, 'Amahle Dlamini');
    await expect(d).toBeVisible();
    expect(await (async () => (await moveTo(d).evaluate((s: HTMLSelectElement) => (s.selectedOptions[0]?.textContent ?? '').trim())))()).toBe('Screening');
    expect(await boardNow(scope), 'the card did not move on the drop').toEqual(FLEET_AT_START);
    expect(moveCalls(hire!)).toHaveLength(0);
    await reason(d).fill('Dragged');
    await moveButton(d).click();
    await expect.poll(async () => (await boardNow(scope))['Screening']).toContain('Amahle Dlamini');
    expect(moveCalls(hire!)).toHaveLength(1);
    expect(moveCalls(hire!)[0]!.body).toEqual({ to: 'SCREENING', reason: 'Dragged' });
  });

  test('AC-5 Hired is never reached by a move: the dialog does not offer it, or the refusal leaves the card where it was', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    const { scope, d } = await openMove(fx, 'Kagiso Molefe', 'Offer');
    const options = await stageOptions(d);
    if (options.includes('Hired')) {
      await chooseStage(d, 'Hired');
      await reason(d).fill('Accepted');
      await moveButton(d).click();
      await seeLine(page, SAVE_FAIL);
      expect(moveCalls(hire!)[0]!.body).toEqual({ to: 'HIRED', reason: 'Accepted' });
    }
    expect((await boardNow(scope))['Hired'], 'nobody is in Hired').toEqual([]);
    expect(options, 'Not hired is not a stage of the dialog').not.toContain('Not hired');
  });

  test('AC-5 The server refuses Interview to Offer while interviews are open (INTERVIEWS_INCOMPLETE): the card stays and the page shows the generic save failure', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    const { scope, d } = await openMove(fx, 'Bongani Mthembu', 'Interview');
    await chooseStage(d, 'Offer');
    await reason(d).fill('Panel agreed');
    await moveButton(d).click();
    await seeLine(page, SAVE_FAIL);
    expect(moveCalls(hire!)).toHaveLength(1);
    expect(moveCalls(hire!)[0]!.status).toBe(409);
    expect((await boardNow(scope))['Interview']).toEqual(['Bongani Mthembu', 'Tendai Ncube']);
    expect((await boardNow(scope))['Offer']).toEqual(['Kagiso Molefe']);
  });

  const REFUSALS: Array<[string, { status?: number; abort?: boolean; body?: unknown }]> = [
    ['NOT_NEXT_STAGE', { status: 400, body: { error: 'x', code: 'NOT_NEXT_STAGE' } }], ['USE_ACTION', { status: 400, body: { error: 'x', code: 'USE_ACTION' } }],
    ['REASON_REQUIRED', { status: 400, body: { error: 'x', code: 'REASON_REQUIRED' } }], ['OFFER_LIVE', { status: 409, body: { error: 'x', code: 'OFFER_LIVE' } }],
    ['NOT_OPEN', { status: 409, body: { error: 'x', code: 'NOT_OPEN' } }], ['a 404', { status: 404, body: { error: 'x' } }], ['a 500', { status: 500 }], ['a dropped connection', { abort: true }],
  ];
  for (const [label, how] of REFUSALS) {
    test(`AC-5 ${label} leaves the card in place, shows the generic save failure and lets the person try again`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
      const { page, hire } = fx;
      const { scope, d } = await openMove(fx, 'Amahle Dlamini', 'Applied');
      await chooseStage(d, 'Screening');
      await reason(d).fill('Phone screen booked');
      hire!.refuse({ method: 'PUT', path: /\/stage$/, ...how });
      await moveButton(d).click();
      await seeLine(page, SAVE_FAIL);
      expect(await boardNow(scope), 'the card is where it was').toEqual(FLEET_AT_START);
      // The person can go on: the same move, asked again, works.
      if (await d.isVisible()) await moveButton(d).click();
      else {
        await showStage(scope, 'Applied');
        await moveBtn(scope, 'Amahle Dlamini').click();
        const again = dialog(page, 'Amahle Dlamini');
        await chooseStage(again, 'Screening');
        await reason(again).fill('Phone screen booked');
        await moveButton(again).click();
      }
      await expect.poll(async () => (await boardNow(scope))['Screening']).toContain('Amahle Dlamini');
    });
  }
});

// ================================================================ AC-6 Not hired
test.describe('AC-6 Not hired', () => {
  test.beforeEach(noBackendOnly);

  async function openNotHired(fx: Fx, name: string, stage: string): Promise<{ scope: Locator; d: Locator }> {
    const scope = await openBoard(fx);
    await showStage(scope, stage);
    await cardMore(scope, name).click();
    await fx.page.getByRole('menuitem', { name: 'Not hired', exact: true }).click();
    const d = fx.page.getByRole('dialog', { name: `${firstName(name)} not hired`, exact: true });
    await expect(d).toBeVisible();
    return { scope, d };
  }
  const record = (d: Locator) => d.getByRole('button', { name: 'Record not hired', exact: true });

  test('AC-6 The dialog has the approved words, the eight reasons in order, the closing line and two buttons; Record not hired needs a reason', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    await asRecruiter(fx);
    const { d } = await openNotHired(fx, 'Bongani Mthembu', 'Interview');
    const words = (await visibleBlocks(d)).join(' | ');
    for (const w of ['Bongani not hired', WORDS.reason, NOT_HIRED_LINE, 'Cancel', 'Record not hired']) expect(words).toContain(w);
    const radios = await d.getByRole('radio').evaluateAll((rs) => rs.map((r) => (document.querySelector(`label[for="${r.id}"]`)?.textContent ?? r.closest('label')?.textContent ?? r.getAttribute('aria-label') ?? '').trim()));
    expect(radios, 'the eight reasons, in the approved order').toEqual(REASONS.map(([, words]) => words));
    await expect(record(d), 'no reason yet').toBeDisabled();
    await d.getByRole('radio', { name: 'Salary did not match', exact: true }).check();
    await expect(record(d)).toBeEnabled();
  });

  test('AC-6 Recording sends one POST with the chosen code, the card leaves the board and the Not hired number goes up', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    await asRecruiter(fx);
    const { scope, d } = await openNotHired(fx, 'Bongani Mthembu', 'Interview');
    await d.getByRole('radio', { name: 'Salary did not match', exact: true }).check();
    await record(d).click();
    await expect(d).toHaveCount(0);
    const calls = notHiredCalls(hire!);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toMatch(/\/v1\/candidates\/cand-bongani\/not-hired$/);
    expect((calls[0]!.body as { reason: string }).reason).toBe('SALARY_MISMATCH');
    expect(Object.keys(calls[0]!.body as object).filter((k) => !['reason', 'note'].includes(k)), 'only reason and note').toEqual([]);
    expect(companyIdIn(calls[0]!)).toEqual([]);
    await expect.poll(async () => (await boardNow(scope))['Interview']).toEqual(['Tendai Ncube']);
    await expect(scope.getByRole('button', { name: 'Not hired 3', exact: true })).toBeVisible();
    void page;
  });

  for (const how of ['Cancel', 'Close', 'Escape'] as const) {
    test(`AC-6 ${how} closes the dialog, sends nothing and returns focus to the card's More actions`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
      const { page, hire } = fx;
      await asRecruiter(fx);
      const { scope, d } = await openNotHired(fx, 'Tendai Ncube', 'Interview');
      await d.getByRole('radio', { name: 'Other', exact: true }).check();
      if (how === 'Escape') await page.keyboard.press('Escape');
      else await d.getByRole('button', { name: how, exact: true }).click();
      await expect(d).toHaveCount(0);
      expect(notHiredCalls(hire!)).toHaveLength(0);
      await expect(cardMore(scope, 'Tendai Ncube')).toBeFocused(); // before anything else moves focus
      expect(await boardNow(scope)).toEqual(FLEET_AT_START);
    });
  }

  test('AC-6 A candidate with an offer sent is refused (OFFER_LIVE): the card stays and the generic save failure shows', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    await asRecruiter(fx);
    const { scope, d } = await openNotHired(fx, 'Kagiso Molefe', 'Offer');
    await d.getByRole('radio', { name: 'Chose another candidate', exact: true }).check();
    await record(d).click();
    await seeLine(page, SAVE_FAIL);
    expect(notHiredCalls(hire!)[0]!.status).toBe(409);
    expect((await boardNow(scope))['Offer']).toEqual(['Kagiso Molefe']);
  });

  const REFUSALS: Array<[string, { status?: number; abort?: boolean; body?: unknown }]> = [
    ['REASON_REQUIRED', { status: 400, body: { error: 'x', code: 'REASON_REQUIRED' } }], ['INVALID_REASON', { status: 400, body: { error: 'x', code: 'INVALID_REASON' } }],
    ['NOT_OPEN', { status: 409, body: { error: 'x', code: 'NOT_OPEN' } }], ['a 500', { status: 500 }], ['a dropped connection', { abort: true }],
  ];
  for (const [label, how] of REFUSALS) {
    test(`AC-6 ${label} leaves the card where it was and shows the generic save failure`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
      const { page, hire } = fx;
      await asRecruiter(fx);
      const { scope, d } = await openNotHired(fx, 'Tendai Ncube', 'Interview');
      await d.getByRole('radio', { name: 'Did not attend', exact: true }).check();
      hire!.refuse({ method: 'POST', path: /\/not-hired$/, ...how });
      await record(d).click();
      await seeLine(page, SAVE_FAIL);
      expect(await boardNow(scope)).toEqual(FLEET_AT_START);
    });
  }

  test('AC-6 When the answer says pending the card stays and shows "{name} must confirm before this is final."; the same person cannot confirm; another person confirms and the card leaves', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    hire!.secondConfirmation.add('cand-bongani');
    await asRecruiter(fx);
    const { scope, d } = await openNotHired(fx, 'Bongani Mthembu', 'Interview');
    await d.getByRole('radio', { name: 'Not the right skills', exact: true }).check();
    await record(d).click();
    await expect.poll(() => notHiredCalls(hire!).length).toBe(1);
    await seeLine(page, must('Sipho Ndlovu'));
    expect((await boardNow(scope))['Interview'], 'the card stays in its column').toEqual(['Bongani Mthembu', 'Tendai Ncube']);
    // The card shows the state (after the dialog is closed, if it stays open).
    if (await d.isVisible()) await d.getByRole('button', { name: /^(Cancel|Close)$/ }).first().click();
    await showStage(scope, 'Interview');
    await expect(card(scope, 'Bongani Mthembu')).toContainText(must('Sipho Ndlovu'));
    // The same person opens the same dialog and confirms: refused.
    await cardMore(scope, 'Bongani Mthembu').click();
    await page.getByRole('menuitem', { name: 'Not hired', exact: true }).click();
    const again = page.getByRole('dialog', { name: 'Bongani not hired', exact: true });
    await expect(again.getByText(must('Sipho Ndlovu'), { exact: true })).toBeVisible();
    await record(again).click();
    await seeLine(page, SAVE_FAIL);
    const confirm = hire!.to('POST', /\/not-hired\/confirm$/);
    expect(confirm).toHaveLength(1);
    expect(confirm[0]!.status, 'the server refuses the same person').toBe(409);
    expect((await boardNow(scope))['Interview']).toContain('Bongani Mthembu');
    // Another Recruiter signs in and confirms.
    await page.getByRole('button', { name: /^(Cancel|Close)$/ }).first().click().catch(() => undefined);
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await signInAs(fx.signIn, fx.cognito, fx.modules, hire, WHO.recruiter2A);
    await expect(page).toHaveURL('/hr');
    const scope2 = await openBoard(fx);
    await showStage(scope2, 'Interview');
    await expect(card(scope2, 'Bongani Mthembu')).toContainText(must('Sipho Ndlovu'));
    await cardMore(scope2, 'Bongani Mthembu').click();
    await page.getByRole('menuitem', { name: 'Not hired', exact: true }).click();
    const second = page.getByRole('dialog', { name: 'Bongani not hired', exact: true });
    await record(second).click();
    await expect.poll(() => hire!.to('POST', /\/not-hired\/confirm$/).length).toBe(2);
    await expect.poll(async () => (await boardNow(scope2))['Interview']).toEqual(['Tendai Ncube']);
  });

  test('AC-6 A pending decision can be cancelled with the word Cancel on the card\'s More actions: it stays in its column and the line goes', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    hire!.secondConfirmation.add('cand-bongani');
    await asRecruiter(fx);
    const { scope, d } = await openNotHired(fx, 'Bongani Mthembu', 'Interview');
    await d.getByRole('radio', { name: 'Not the right skills', exact: true }).check();
    await record(d).click();
    await expect.poll(() => notHiredCalls(hire!).length).toBe(1);
    if (await d.isVisible()) await d.getByRole('button', { name: /^(Cancel|Close)$/ }).first().click();
    await showStage(scope, 'Interview');
    await cardMore(scope, 'Bongani Mthembu').click();
    await page.getByRole('menuitem', { name: 'Cancel', exact: true }).click();
    await expect.poll(() => hire!.to('POST', /\/not-hired\/cancel$/).length).toBe(1);
    await expect(card(scope, 'Bongani Mthembu')).not.toContainText('must confirm');
    expect((await boardNow(scope))['Interview']).toEqual(['Bongani Mthembu', 'Tendai Ncube']);
    expect(hire!.world.cands.find((c) => c.id === 'cand-bongani')!.pending, 'the server let it go').toBeUndefined();
  });

  test('AC-6 When the person to confirm is not named in the answer the line has no name in it (U-3)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    hire!.secondConfirmation.add('cand-bongani');
    const origin = hire!.world.roles.find((r) => r.role_id === 'role-fleet')!;
    origin.hiring_manager_name = '';
    await asRecruiter(fx);
    const { d } = await openNotHired(fx, 'Bongani Mthembu', 'Interview');
    await d.getByRole('radio', { name: 'Other', exact: true }).check();
    await record(d).click();
    await expect.poll(() => notHiredCalls(hire!).length).toBe(1);
    await page.waitForTimeout(300);
    const text = (await main(page).textContent()) ?? '';
    expect(text + ((await page.getByRole('dialog').allTextContents()).join(' ')), 'no empty name, no "undefined" or "null"').not.toMatch(/undefined|null| must confirm before this is final\.$/);
  });

  test('AC-6 "Not hired {n}" opens the list of the role\'s not-hired candidates (stage NOT_HIRED); an empty list reads "No one yet"', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    const none = page.getByText('No one yet', { exact: true });
    const emptyBefore = await none.count(); // the board's own empty columns say it too
    await scope.getByRole('button', { name: 'Not hired 2', exact: true }).click();
    const list = page.getByRole('table', { name: 'Not hired', exact: true });
    await expect(list.getByText('Nomvula Zulu')).toBeVisible();
    await expect(list.getByText('Farai Moyo')).toBeVisible();
    await expect(list.getByText('Amahle Dlamini'), 'open candidates are not in the not-hired list').toHaveCount(0);
    await expect(none, 'a list with people in it adds no "No one yet"').toHaveCount(emptyBefore);
    expect(hire!.calls.filter((c) => c.path.endsWith('/v1/candidates')).at(-1)!.query).toMatchObject({ role_id: 'role-fleet', stage: 'NOT_HIRED' });
  });

  test('AC-6 A role with nobody turned down reads "No one yet" in its Not hired list', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    hire!.world.cands = hire!.world.cands.filter((c) => !(c.role_id === 'role-fleet' && c.stage === 'NOT_HIRED'));
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    const before = hire!.calls.filter((c) => c.path.endsWith('/v1/candidates')).length;
    const none = page.getByText('No one yet', { exact: true });
    const emptyBefore = await none.count(); // the board's own empty columns say it too
    await scope.getByRole('button', { name: 'Not hired 0', exact: true }).click();
    await expect(none, 'the Not hired list adds its own "No one yet"').toHaveCount(emptyBefore + 1);
    expect(await page.getByRole('table', { name: 'Not hired', exact: true }).getByRole('row').count(), 'no candidate rows under the list').toBeLessThanOrEqual(1);
    await expect(page.getByText('Nomvula Zulu')).toHaveCount(0);
    expect(hire!.calls.filter((c) => c.path.endsWith('/v1/candidates')).slice(before).some((c) => c.query?.stage === 'NOT_HIRED'), 'the list was asked for with stage NOT_HIRED').toBe(true);
  });
});

// ================================================================ AC-7 Close role
test.describe('AC-7 Close role', () => {
  test.beforeEach(noBackendOnly);

  test('AC-7 With open candidates the server says no (OPEN_CANDIDATES) and the page shows the approved line in a section message; the role stays and no dialog asks anything', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    await pageMore(scope, 'Fleet controller').click();
    await page.getByRole('menuitem', { name: 'Close role', exact: true }).click();
    await expect.poll(() => hire!.to('POST', /\/v1\/roles\/role-fleet\/close$/).length).toBe(1);
    const message = page.locator('.pp-section-message').filter({ hasText: CLOSE_LINE });
    await expect(message, 'the approved line in a section message').toBeVisible();
    expect(hire!.to('POST', /close$/)[0]!.status).toBe(409);
    await expect(h1(page)).toHaveText('Fleet controller');
    await expect(page.getByRole('dialog'), 'closing asks nothing (the card has no confirmation)').toHaveCount(0);
    expect(hire!.world.roles.find((r) => r.role_id === 'role-fleet')!.status).toBe('OPEN');
  });

  test('AC-7 With no open candidate the role closes and leaves the Roles list', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    for (const c of hire!.world.cands.filter((x) => x.role_id === 'role-warehouse' && !x.old_system)) c.stage = c.stage === 'OFFER' ? 'HIRED' : 'NOT_HIRED';
    await asRecruiter(fx);
    const scope = await openBoard(fx, 'role-warehouse', 'Warehouse supervisor');
    await pageMore(scope, 'Warehouse supervisor').click();
    await page.getByRole('menuitem', { name: 'Close role', exact: true }).click();
    await expect.poll(() => hire!.to('POST', /\/v1\/roles\/role-warehouse\/close$/).length).toBe(1);
    await expect(page).toHaveURL(/\/hire\/roles$/);
    await expect(page.getByText('Warehouse supervisor')).toHaveCount(0);
    await expect(page.getByText('Fleet controller').first()).toBeVisible();
  });

  test('AC-7 Closing is final: nothing on the board or the list offers to reopen a role', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page } = fx;
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    await pageMore(scope, 'Fleet controller').click();
    const items = await page.getByRole('menuitem').allTextContents();
    expect(items.map((t) => t.trim()), 'the menu holds Close role and nothing that reopens').toContain('Close role');
    expect(items.join(' | ')).not.toMatch(/reopen|re-open|open again|reactivate|restore/i);
    await page.keyboard.press('Escape');
    await openRoles(fx);
    await expect(page.getByText(/reopen|closed roles|show closed/i)).toHaveCount(0);
  });

  test('AC-7 A failing close shows the generic save failure and the role stays', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    for (const c of hire!.world.cands.filter((x) => x.role_id === 'role-warehouse' && !x.old_system)) c.stage = 'NOT_HIRED';
    await asRecruiter(fx);
    const scope = await openBoard(fx, 'role-warehouse', 'Warehouse supervisor');
    hire!.refuse({ method: 'POST', path: /\/close$/, status: 500 });
    await pageMore(scope, 'Warehouse supervisor').click();
    await page.getByRole('menuitem', { name: 'Close role', exact: true }).click();
    await seeLine(page, SAVE_FAIL);
    await expect(h1(page)).toHaveText('Warehouse supervisor');
    expect(hire!.world.roles.find((r) => r.role_id === 'role-warehouse')!.status).toBe('OPEN');
  });
});

// ================================================================ AC-8 Old-system list
test.describe('AC-8 Old-system list', () => {
  test.beforeEach(noBackendOnly);

  test('AC-8 When the answer has rows the Not hired list links to them; the page has the title, the approved line, the table and a link to each candidate', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    await scope.getByRole('button', { name: 'Not hired 2', exact: true }).click();
    const link = page.getByRole('link', { name: 'Not hired by the old system', exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/hire\/candidates\/old-system$/);
    await expect(h1(page)).toHaveText('Not hired by the old system');
    await seeLine(page, OLD_LINE);
    const table = page.getByRole('table');
    if (!phone()) for (const c of ['Candidate', 'Role', 'Applied']) await expect(table.getByRole('columnheader', { name: c, exact: true })).toBeVisible();
    const row = table.getByRole('row').filter({ hasText: 'Mpho Sithole' });
    await expect(row).toContainText('Warehouse supervisor');
    await expect(row).toContainText('12 Oct 2026');
    await expect(row.getByRole('link', { name: 'Mpho Sithole', exact: true })).toHaveAttribute('href', /\/hire\/candidates\/cand-os-1/);
    expect(hire!.to('GET', /\/v1\/candidates\/old-system$/).length).toBeGreaterThanOrEqual(1);
  });

  test('AC-8 With no rows the link is not shown', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    hire!.world.cands = hire!.world.cands.filter((c) => !c.old_system);
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    await scope.getByRole('button', { name: 'Not hired 2', exact: true }).click();
    await expect(page.getByText('Nomvula Zulu')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Not hired by the old system' })).toHaveCount(0);
  });

  test('AC-8 Company B sees none of company A\'s old-system rows, in the list or at the address', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire, modules } = fx;
    modules!.answers.B = ['onboarding', 'recruitment'];
    await asRecruiter(fx, WHO.recruiterB);
    const scope = await openBoard(fx, 'role-b-dispatch', 'Dispatch lead');
    await expect(scope.getByRole('button', { name: /^Not hired \d+$/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Not hired by the old system' })).toHaveCount(0);
    await page.goto('/hire/candidates/old-system');
    await quiet(page);
    await expect(page.getByText('Mpho Sithole')).toHaveCount(0);
    expect(hire!.to('GET', /old-system$/).every((c) => c.company === 'B')).toBe(true);
  });
});

// ================================================================ AC-9 Company B and C
test.describe('AC-9 Company B and C', () => {
  test.beforeEach(noBackendOnly);

  for (const [who, co, others] of [[WHO.recruiterB, 'B', ['role-fleet', 'role-c-baker']], [WHO.recruiterC, 'C', ['role-fleet', 'role-b-dispatch']]] as const) {
    test(`AC-9 A Recruiter of company ${co} sees only their own company's roles, and another company's role in the address bar shows the not-found state and no data`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
      const { page, hire, modules } = fx;
      modules!.answers[co] = ['onboarding', 'recruitment'];
      await asRecruiter(fx, who);
      await openRoles(fx);
      await expect(page.getByText(co === 'B' ? 'Dispatch lead' : 'Head baker').first()).toBeVisible();
      for (const name of ['Fleet controller', 'Warehouse supervisor', 'Senior accountant']) await expect(page.getByText(name), `${name} is company A's`).toHaveCount(0);
      for (const role of others) {
        await page.goto(`/hire/pipeline?role=${role}&view=board`);
        await seeLine(page, ROLE_NOT_FOUND);
        for (const secret of ['Fleet controller', 'Amahle Dlamini', 'Sipho Ndlovu', 'Bongani', 'Dispatch lead', 'Head baker', 'Hlengiwe', 'Palesa']) {
          if (secret === (co === 'B' ? 'Dispatch lead' : 'Head baker')) continue;
          await expect(page.getByText(secret), `no data of another company ("${secret}")`).toHaveCount(0);
        }
        await expect(main(page).locator('.pp-pipeline__card'), 'no card at all').toHaveCount(0);
      }
      // The not-found state is the server's answer, not the page's guess.
      expect(hire!.to('GET', /\/v1\/roles\/role-fleet$/).every((c) => c.status === 404)).toBe(true);
    });
  }

  test('AC-9 A Recruiter of A sees their own role and an id that does not exist shows the same not-found state', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page } = fx;
    await asRecruiter(fx);
    await page.goto('/hire/pipeline?role=role-nobody-has&view=board');
    await seeLine(page, ROLE_NOT_FOUND);
    await expect(main(page).locator('.pp-pipeline__card')).toHaveCount(0);
  });

  test('AC-9 No request of any screen carries a company: not in the address, the query, the headers (but the token) or the body', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    await asRecruiter(fx);
    await openRoles(fx);
    await either(page, 'Open a role').first().click();
    await page.getByLabel('Job title', { exact: true }).fill('Company check');
    await page.getByRole('button', { name: 'Open a role', exact: true }).click();
    await expect(page).toHaveURL(/role=role-new-1/);
    const scope = await openBoard(fx);
    await showStage(scope, 'Applied');
    await moveBtn(scope, 'Amahle Dlamini').click();
    const d = dialog(page, 'Amahle Dlamini');
    await chooseStage(d, 'Screening');
    await reason(d).fill('Check');
    await moveButton(d).click();
    await expect.poll(() => moveCalls(hire!).length).toBe(1);
    await showStage(scope, 'Interview');
    await cardMore(scope, 'Tendai Ncube').click().catch(() => undefined);
    await page.keyboard.press('Escape');
    await scope.getByRole('button', { name: /^Not hired \d+$/ }).click();
    await page.goto('/hire/candidates/old-system');
    await quiet(page);
    const all = hire!.calls.filter((c) => c.method !== 'OPTIONS');
    expect(all.length, 'the screens made their requests').toBeGreaterThan(6);
    for (const call of all) expect(companyIdIn(call), `${call.method} ${call.path}`).toEqual([]);
  });
});

// ================================================================ AC-10 Phone
test.describe('AC-10 Phone', () => {
  test.beforeEach(noBackendOnly);
  test.beforeEach(() => phoneOnly('the criterion is the 390 wide screen'));

  /** Every heading, button, link and tab in the main area is on the screen, not under the top bar and not covered; nothing scrolls sideways. */
  async function everythingReachable(page: Page, where: string): Promise<void> {
    const problems = await page.evaluate(async () => {
      const out: string[] = [];
      // the phone's own width: under phone emulation innerWidth stretches to fit wide content and would hide a sideways overflow
      const width = document.documentElement.clientWidth;
      const bar = document.querySelector('pp-top-navigation')?.getBoundingClientRect();
      const targets = [...document.querySelectorAll<HTMLElement>('main h1, main h2, main h3, main button, main a[href], main [role="tab"], main [role="radio"], main input, main select, main textarea, [role="dialog"] button, [role="dialog"] h2, [role="dialog"] input, [role="dialog"] select, [role="dialog"] textarea')].filter((el) => !document.querySelector('[role="dialog"]') || el.closest('[role="dialog"]')).filter((el) => {
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
        if (hit && !el.contains(hit) && !hit.contains(el) && !(el.tagName === 'INPUT' && hit.closest('label,.pp-field,.pp-radio,.pp-checkbox')?.contains(el))) out.push(`${label} is covered by ${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}`);
      }
      window.scrollTo(0, 0);
      if (document.documentElement.scrollWidth > width + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide)`);
      return out;
    });
    expect(problems, where).toEqual([]);
  }

  test('AC-10 Roles, Open a role and the old-system list: every heading and button is visible, not under the top bar, nothing scrolls sideways', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page } = fx;
    await asRecruiter(fx);
    await openRoles(fx);
    await everythingReachable(page, 'Roles');
    await page.goto('/hire/roles/new');
    await expect(h1(page)).toHaveText('Open a role');
    await everythingReachable(page, 'Open a role');
    await page.goto('/hire/candidates/old-system');
    await expect(h1(page)).toHaveText('Not hired by the old system');
    await everythingReachable(page, 'Not hired by the old system');
  });

  test('AC-10 The board: the stage picker shows one column at a time, every stage is reachable, everything is visible, and the Move button reaches the same dialog', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page } = fx;
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    await everythingReachable(page, 'the board');
    const visibleColumns = () => scope.locator('.pp-pipeline__column').evaluateAll((cs) => cs.filter((c) => (c as HTMLElement).offsetParent !== null && c.getBoundingClientRect().width > 0).length);
    expect(await visibleColumns(), 'one column shows').toBe(1);
    for (const stage of ['Applied', 'Screening', 'Interview', 'Offer', 'Hired']) {
      await showStage(scope, stage);
      expect(await visibleColumns(), `one column shows (${stage})`).toBe(1);
    }
    await showStage(scope, 'Interview');
    await everythingReachable(page, 'the Interview column');
    await moveBtn(scope, 'Bongani Mthembu').click();
    const d = dialog(page, 'Bongani Mthembu');
    await expect(d).toBeVisible();
    await everythingReachable(page, 'the Move dialog');
    await d.getByRole('button', { name: 'Cancel', exact: true }).click();
    await cardMore(scope, 'Bongani Mthembu').click();
    await page.getByRole('menuitem', { name: 'Not hired', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Bongani not hired', exact: true })).toBeVisible();
    await everythingReachable(page, 'the Not hired dialog');
  });

  test('AC-10 The Not hired list and the Close role message are reachable too', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page } = fx;
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    await scope.getByRole('button', { name: 'Not hired 2', exact: true }).click();
    await expect(page.getByText('Nomvula Zulu')).toBeVisible();
    await everythingReachable(page, 'the Not hired list');
    const board = await openBoard(fx);
    await pageMore(board, 'Fleet controller').click();
    await page.getByRole('menuitem', { name: 'Close role', exact: true }).click();
    await expect(page.locator('.pp-section-message').filter({ hasText: CLOSE_LINE })).toBeVisible();
    await everythingReachable(page, 'the Close role message');
  });
});

// ================================================================ AC-11 Kit match
test.describe('AC-11 Kit match', () => {
  test.beforeEach(noBackendOnly);

  const DS = join(__dirname, '..', '..', 'src', 'styles', 'design-system');
  const known = (): Set<string> => new Set(['components.css', 'tokens/base.css'].flatMap((f) => readFileSync(join(DS, f), 'utf8').match(/\.pp-[a-z0-9_-]+/g) ?? []).map((c: string) => c.slice(1)));

  /** The pp-* classes inside `scope` (every element, the scope's own too). */
  const classesIn = (scope: Locator): Promise<string[]> => scope.evaluate((root) => [...new Set([root, ...root.querySelectorAll('*')].flatMap((el) => [...el.classList]).filter((c) => c.startsWith('pp-')))].sort());

  /** The page's main area uses only design system parts: pp-* elements and classes that exist, no style attribute, no style element. */
  async function onlyPp(page: Page, where: string, root = 'main'): Promise<void> {
    const have = known();
    const found = await page.locator(root).first().evaluate((el) => ({
      classes: [...new Set([el, ...el.querySelectorAll('*')].flatMap((e) => [...e.classList]).filter((c) => c.startsWith('pp-')))],
      styled: [...el.querySelectorAll('[style]')].filter((e) => !e.closest('[cdkdrag], .cdk-drag, .cdk-drag-preview') && !/^(--[\w-]+:[^;]*;?\s*)+$/.test(e.getAttribute('style') ?? '')).map((e) => e.tagName.toLowerCase()),
      styles: el.querySelectorAll('style').length,
      tags: [...new Set([...el.querySelectorAll('*')].map((e) => e.tagName.toLowerCase()).filter((t) => t.includes('-') && !t.startsWith('pp-') && !t.startsWith('app-') && t !== 'router-outlet'))],
    }));
    expect(found.classes.filter((c) => !have.has(c)), `${where}: every pp-* class exists in the design system`).toEqual([]);
    expect(found.styled, `${where}: no style attribute that sets a look`).toEqual([]);
    expect(found.styles, `${where}: no style element`).toBe(0);
    expect(found.tags, `${where}: no custom element but pp-* and app-*`).toEqual([]);
  }

  /** The kit's classes are all on the page (the kit's own demonstration-only parts excepted). */
  async function matchesKit(scope: Locator, screen: keyof typeof KIT.screens, kitKey: 'main' | 'dialog', except: RegExp[] = []): Promise<void> {
    const name = phone() ? `${screen} (phone)` : screen;
    const kit = (KIT.screens as Record<string, { main: readonly string[]; dialog: readonly string[] }>)[name]![kitKey];
    expect(kit.length, `the kit captured for ${name}`).toBeGreaterThan(0);
    const have = new Set(await classesIn(scope));
    // Layout helpers (gaps, inline rows, grow, measure) and the kit's own `--inline` frame classes are the kit's page layout, not the design: a build may lay the page out another way.
    const layoutOnly = [/^pp-gap-/, /^pp-inline/, /^pp-grow/, /^pp-measure-/, /^pp-stack/, /--inline$/, /^pp-text(--|$)/, /^pp-avatar--/, /^pp-text-field--small$/, /^pp-textarea$/];
    const missing = kit.filter((c) => !have.has(c) && ![...layoutOnly, ...except].some((re) => re.test(c)));
    expect(missing, `${name}: classes the kit has and the page lacks`).toEqual([]);
  }

  test('AC-11 The app is synced to the design system ref these structures were captured at', async () => {
    const sync = JSON.parse(readFileSync(join(DS, 'sync.json'), 'utf8')) as { ref: string };
    expect(sync.ref, 'a design system change needs these structures captured again (a child lock)').toBe(KIT.ref);
  });

  test('AC-11 Roles matches the kit screen "Roles"; Open a role matches "Open a role"', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page } = fx;
    await asRecruiter(fx);
    await openRoles(fx);
    await expect(page.getByRole('table')).toBeVisible();
    await matchesKit(main(page), 'Roles', 'main');
    await onlyPp(page, 'Roles');
    await page.goto('/hire/roles/new');
    await expect(h1(page)).toHaveText('Open a role');
    await matchesKit(main(page), 'Open a role', 'main', [/^pp-section-message/, /^pp-icon/]);
    await onlyPp(page, 'Open a role');
  });

  test('AC-11 The board matches the kit screen "Pipeline, board"; the drag motion is the board\'s own', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    hire!.countsOverride = { all: 6, mine: 3, overdue: 2, due_soon: 2, not_hired: 2 };
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    await matchesKit(scope, 'Pipeline, board', 'main', [/^pp-button--primary$/, /^pp-icon/, /^pp-person-header/]);
    await onlyPp(page, 'the board');
    if (!phone()) {
      await expect(scope.locator('.pp-pipeline__card.cdk-drag').first(), 'cards drag with the board\'s own motion').toBeVisible();
      await expect(scope.locator('.pp-pipeline__cards.cdk-drop-list')).toHaveCount(5);
    }
  });

  test('AC-11 The Move dialog matches the kit screen "Move a candidate"; the Not hired dialog matches "Not hired"; the old-system list matches its kit screen', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page } = fx;
    await asRecruiter(fx);
    const scope = await openBoard(fx);
    await showStage(scope, 'Interview');
    await moveBtn(scope, 'Bongani Mthembu').click();
    const move = dialog(page, 'Bongani Mthembu');
    await expect(move).toBeVisible();
    await matchesKit(move, 'Move a candidate', 'dialog', [/^pp-icon/]);
    await onlyPp(page, 'the Move dialog', '[role="dialog"]');
    await move.getByRole('button', { name: 'Cancel', exact: true }).click();
    await cardMore(scope, 'Bongani Mthembu').click();
    await page.getByRole('menuitem', { name: 'Not hired', exact: true }).click();
    const nh = page.getByRole('dialog', { name: 'Bongani not hired', exact: true });
    await expect(nh).toBeVisible();
    await matchesKit(nh, 'Not hired', 'dialog', [/^pp-icon/]);
    await onlyPp(page, 'the Not hired dialog', '[role="dialog"]');
    await nh.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.goto('/hire/candidates/old-system');
    await expect(h1(page)).toHaveText('Not hired by the old system');
    await matchesKit(main(page), 'Not hired by the old system', 'main', [/^pp-icon/]);
    await onlyPp(page, 'the old-system list');
  });
});

// ================================================================ AC-12 No old words
test.describe('AC-12 No old words', () => {
  test.beforeEach(noBackendOnly);

  const OLD = /\b(masked|rejected|provisioning|sentiment)\b/i;

  /** Every word a person can read on the page: text, labels, placeholders, titles, option text. */
  async function words(page: Page): Promise<string> {
    return page.evaluate(() => {
      const out: string[] = [document.title, document.body.innerText];
      for (const el of document.querySelectorAll('[aria-label],[placeholder],[title],option,[alt]')) out.push(el.getAttribute('aria-label') ?? '', el.getAttribute('placeholder') ?? '', el.getAttribute('title') ?? '', el.getAttribute('alt') ?? '', el.tagName === 'OPTION' ? el.textContent ?? '' : '');
      return out.join('\n');
    });
  }
  const noOldWords = async (page: Page, where: string) => {
    const text = await words(page);
    expect(text.match(OLD), `${where} has none of Masked, Rejected, Provisioning, sentiment`).toBeNull();
    const stages = await page.locator('main .pp-pipeline__column-name, main .pp-pipeline__picker option, [role="dialog"] option, main [role="tab"]').allTextContents();
    expect(stages.map((s) => s.trim().replace(/\s*\(\d+\)$/, '')), `${where}: no stage called Evaluation`).not.toContain('Evaluation');
    expect(text, `${where}: no stage called Evaluation`).not.toMatch(/\bEvaluation\b/);
  };

  test('AC-12 Roles, Open a role, the board, both dialogs, the Not hired list and the old-system list use none of the old words', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page } = fx;
    await asRecruiter(fx);
    await openRoles(fx);
    await noOldWords(page, 'Roles');
    await page.goto('/hire/roles/new');
    await expect(h1(page)).toHaveText('Open a role');
    await noOldWords(page, 'Open a role');
    const scope = await openBoard(fx);
    await noOldWords(page, 'the board');
    await showStage(scope, 'Interview');
    await moveBtn(scope, 'Bongani Mthembu').click();
    await expect(dialog(page, 'Bongani Mthembu')).toBeVisible();
    await noOldWords(page, 'the Move dialog');
    await dialog(page, 'Bongani Mthembu').getByRole('button', { name: 'Cancel', exact: true }).click();
    await cardMore(scope, 'Bongani Mthembu').click();
    await page.getByRole('menuitem', { name: 'Not hired', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Bongani not hired', exact: true })).toBeVisible();
    await noOldWords(page, 'the Not hired dialog');
    await page.keyboard.press('Escape');
    await scope.getByRole('button', { name: 'Not hired 2', exact: true }).click();
    await expect(page.getByText('Nomvula Zulu')).toBeVisible();
    await noOldWords(page, 'the Not hired list');
    await page.goto('/hire/candidates/old-system');
    await expect(h1(page)).toHaveText('Not hired by the old system');
    await noOldWords(page, 'the old-system list');
  });

  test('AC-12 The failure and empty states use none of the old words either', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx: Fx = { page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h };
    const { page, hire } = fx;
    withoutRoles(hire!.world, 'A');
    await asRecruiter(fx);
    await openRoles(fx);
    await seeLine(page, EMPTY_ROLES);
    await noOldWords(page, 'the empty Roles page');
    hire!.refuse({ method: 'GET', path: /\/v1\/roles$/, status: 500 });
    await page.goto('/hire/roles');
    await seeLine(page, ROLES_FAIL);
    await noOldWords(page, 'the failing Roles page');
    await page.goto('/hire/pipeline?role=role-fleet&view=board');
    await seeLine(page, ROLE_NOT_FOUND);
    await noOldWords(page, 'the not-found state');
  });
});

// ================================================================ AC-13 @pepla-dev
/**
 * AC-13 · judged on pepla-dev when REC-02, REC-03 and REC-04 are on dev. Until then it is red there; it never runs in the
 * no-backend run, and it does not hold the lock or the board's merge (decision of 21 Nov, cards/rec-ui-01.md).
 * It needs: E2E_HR_EMAIL / E2E_HR_PASSWORD for an HR login that holds the Recruitment tick (perm-recruitment), E2E_EMP_*
 * for an Employee, E2E_B_HR_EMAIL / E2E_B_HR_PASSWORD for company B's HR login (without them the company B part says so and skips),
 * and the seed of cards/rec-ui-01.md (the kit's role "Fleet controller" and its six candidates, reseeded before each run).
 * The Move and Open a role calls send Idempotency-Key from a real browser, so the real preflight is what proves the CORS line.
 */
test.describe('AC-13 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-13 runs on pepla-dev only.');

  test('AC-13 @pepla-dev The Recruiter sees Roles, opens a role and its stages, moves a candidate with a reason and it stays moved after a reload, records Not hired, and cannot close a role while a candidate is open', async ({ page, signIn, hr }) => {
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await openNav(page);
    await expect(navItems(page).filter({ hasText: /^Roles$/ }), 'Hire > Roles is there for the Recruiter').toBeVisible();
    await page.goto('/hire/roles');
    await expect(h1(page)).toHaveText('Roles');
    await expect(either(page, 'Open Fleet controller')).toBeVisible();
    await either(page, 'Open Fleet controller').click();
    await expect(h1(page)).toHaveText('Fleet controller');
    const scope = main(page);
    const before = await boardNow(scope);
    expect(before['Applied'], 'the seeded Applied candidate is on the board').toContain('Amahle Dlamini');
    // Move forward with a reason, reload, still moved; then move back so the next run starts the same.
    await showStage(scope, 'Applied');
    await moveBtn(scope, 'Amahle Dlamini').click();
    const d = dialog(page, 'Amahle Dlamini');
    await chooseStage(d, 'Screening');
    await reason(d).fill('Phone screen booked');
    await moveButton(d).click();
    await expect.poll(async () => (await boardNow(scope))['Screening']).toContain('Amahle Dlamini');
    try {
      await page.reload();
      await expect(h1(page)).toHaveText('Fleet controller');
      expect((await boardNow(main(page)))['Screening'], 'still moved after a reload').toContain('Amahle Dlamini');
    } finally {
      await showStage(main(page), 'Screening');
      await moveBtn(main(page), 'Amahle Dlamini').click();
      const back = dialog(page, 'Amahle Dlamini');
      await chooseStage(back, 'Applied');
      await reason(back).fill('Put back by the test');
      await moveButton(back).click();
    }
    // Close is refused while a candidate is open.
    await pageMore(main(page), 'Fleet controller').click();
    await page.getByRole('menuitem', { name: 'Close role', exact: true }).click();
    await expect(page.locator('.pp-section-message').filter({ hasText: CLOSE_LINE })).toBeVisible();
    // Not hired with a reason (the seeded candidate "Tendai Ncube" is reset by the seed).
    await showStage(main(page), 'Interview');
    await cardMore(main(page), 'Tendai Ncube').click();
    await page.getByRole('menuitem', { name: 'Not hired', exact: true }).click();
    const nh = page.getByRole('dialog', { name: 'Tendai not hired', exact: true });
    await nh.getByRole('radio', { name: 'Did not attend', exact: true }).check();
    await nh.getByRole('button', { name: 'Record not hired', exact: true }).click();
    await expect.poll(async () => (await boardNow(main(page)))['Interview']).not.toContain('Tendai Ncube');
  });

  test('AC-13 @pepla-dev A Employee has no Roles entry and a direct address is sent away', async ({ page, signIn, employee }) => {
    await signIn.open();
    await signIn.signInAs(employee);
    await expect(page).toHaveURL('/start');
    await page.goto('/hire/roles');
    await expect(page).not.toHaveURL(/\/hire\//);
  });

  test('AC-13 @pepla-dev Company B\'s HR login has no Hire entry and a direct address is redirected', async ({ page, signIn }) => {
    const email = process.env['E2E_B_HR_EMAIL'], password = process.env['E2E_B_HR_PASSWORD'];
    test.skip(!email || !password, 'E2E_B_HR_EMAIL and E2E_B_HR_PASSWORD are not set: the company B part cannot run.');
    await signIn.open();
    await signIn.signInAs({ email: email!, password: password! });
    await expect(page).toHaveURL('/hr');
    await openNav(page);
    expect(await navLabels(page)).not.toContain('Roles');
    await page.goto('/hire/roles');
    await expect(page).toHaveURL('/hr');
  });
});

export type { Cand };
