import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { CognitoFake } from './support/cognito-fake';
import { ON_DEV, avatarButton, type SignInPage } from './support/fixtures';
import { FAILING_MODES, type ModulesFake } from './support/mod-02/modules-fake';
import { navHeadings, navItems, navLabels, openNav } from './support/mod-02/shell-snapshot';
import { WHO, companyIdIn, drawsIcon, enter, quiet, signInAs, test, watchErrors, type HireFake, type Who } from './support/rec-ui/harness';
import { KIT } from './support/rec-ui-02/kit';
import { A_ALL, W, clockCases, expect, extra, initialsOf, listCalls, many, names, queryOf, readRows, recruitmentOn, scrollToEnd, table, type Row } from './support/rec-ui-02/lists';

/**
 * REC-UI-02 step 1 · The candidate lists: Candidates and the Pipeline list (Jira NH-228, epic NH-223, amber).
 * Spec: onboarding-cards/specs/REC-UI-02.md rule 1, rule 2, AC-1, AC-2, AC-11 to AC-15 (the list parts), REC-UI-00.md.
 * The list answer is the real one since REC-15 step A (PR 495): the harness fake answers api/openapi.yaml CandidateList
 * exactly and checks it (child lock rec-ui-01.3, decision D-T-A12). Where the card is silent, cards/rec-ui-02.md fixes what
 * these tests assume (the builder implements exactly that). Words: only the kit's, the approved lines and settled U-1, U-7.
 *
 * Not in this lock (their backend is not built, so a test would judge a pretend server): Add candidate (AC-3, AC-4: REC-15
 * step B; built since child lock rec-ui-02.1, judged in rec-ui-02-add.spec.ts), the candidate record and its tabs (AC-5, AC-6, AC-9, AC-10, AC-11's record part: step C), Interviews and
 * Schedule (AC-7: step D and REC-07), Reopen (AC-8: U-8). Each comes as a child lock rec-ui-02.N when its step merges.
 * Until the record exists a row opens nothing (no link to a page that is not there).
 *
 * Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg.
 * AC-15 runs on pepla-dev only. No test calls Bedrock or any paid AI.
 */

const phone = () => test.info().project.name === 'phone-390';
const desktopOnly = (why: string) => test.skip(phone(), `Desktop only: ${why}`);
const phoneOnly = (why: string) => test.skip(!phone(), `Phone only: ${why}`);
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake API.');

type Fx = { page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null };
const fxOf = (a: { page: Page; signIn: SignInPage; cognito: CognitoFake | null; modules: ModulesFake | null; hire: HireFake | null }): Fx => a;

const main = (page: Page): Locator => page.locator('main');
const h1 = (page: Page): Locator => page.locator('main h1').first();
const either = (scope: Page | Locator, name: string | RegExp, exact = true) => scope.getByRole('button', { name, exact }).or(scope.getByRole('link', { name, exact }));
const searchBox = (page: Page) => main(page).locator(`input[type="search"][placeholder="${W.search}"]`);
const tab = (page: Page, name: string) => main(page).getByRole('tab', { name: new RegExp(`^${name}\\s*\\d+$`) });
const view = (page: Page, name: 'List' | 'Board') => main(page).getByRole('button', { name, exact: true });

async function asRecruiter(fx: Fx, who: Who = WHO.recruiterA): Promise<void> {
  await enter(fx.page, fx.signIn, fx.cognito, fx.modules, fx.hire, who);
}

/** Opens Candidates and waits for its list (or its empty or failed state). */
async function openCandidates(fx: Fx): Promise<void> {
  await fx.page.goto('/hire/candidates');
  await expect(h1(fx.page)).toHaveText(W.candidates);
  await quiet(fx.page);
}

/** Opens the Pipeline list; `role` is a role id or nothing for All roles. */
async function openPipelineList(fx: Fx, role?: string): Promise<void> {
  await fx.page.goto(role ? `/hire/pipeline?role=${role}&view=list` : '/hire/pipeline');
  await expect(h1(fx.page)).toHaveText(W.pipeline);
  await quiet(fx.page);
}

async function pick(page: Page, label: string, option: string): Promise<void> {
  const field = main(page).getByLabel(label, { exact: true });
  if ((await field.evaluate((el) => el.tagName)) === 'SELECT') await field.selectOption({ label: option });
  else { await field.click(); await page.getByRole('option', { name: option, exact: true }).click(); }
}
async function optionsOf(page: Page, label: string): Promise<string[]> {
  const field = main(page).getByLabel(label, { exact: true });
  if ((await field.evaluate((el) => el.tagName)) === 'SELECT') return (await field.locator('option').allTextContents()).map((t) => t.trim());
  await field.click();
  const out = (await page.getByRole('option').allTextContents()).map((t) => t.trim());
  await page.keyboard.press('Escape');
  return out;
}

const without = (r: Row) => ({ name: r.name, meta: r.meta, stage: r.stage, time: r.time, tone: r.tone, applied: r.applied });
const lastList = (hire: HireFake) => listCalls(hire).at(-1)!;

// ================================================================ AC-1 Entry and guard (rule 1, REC-UI-00 rules 2, 3, 9)
test.describe('AC-1 Entry and guard', () => {
  test.beforeEach(noBackendOnly);

  test('AC-1 A Recruiter of A sees Hire > Roles, Pipeline, Candidates in that order, Candidates with the kit icon and its link, and no console error', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page } = fx;
    const errors = watchErrors(page);
    await asRecruiter(fx);
    await openNav(page);
    await expect.poll(() => navLabels(page)).toEqual(expect.arrayContaining(['Roles', 'Pipeline', 'Candidates']));
    expect(await navHeadings(page)).toContain('Hire');
    const hire = await page.locator('pp-side-navigation .pp-side-navigation__section').evaluateAll((sections) =>
      sections.map((s) => ({ heading: (s.querySelector('.pp-side-navigation__heading')?.textContent ?? '').trim(), items: [...s.querySelectorAll('a.pp-side-navigation__item')].map((x) => ({ label: (x.querySelector('.pp-side-navigation__label')?.textContent ?? '').trim(), href: x.getAttribute('href') })) }))
        .find((s) => s.heading === 'Hire'));
    expect(hire?.items, 'Roles, Pipeline, Candidates under Hire').toEqual([{ label: 'Roles', href: '/hire/roles' }, { label: 'Pipeline', href: '/hire/pipeline' }, { label: 'Candidates', href: '/hire/candidates' }]);
    expect(await drawsIcon(navItems(page).filter({ hasText: /^Candidates$/ }), 'user-search'), 'Candidates draws the kit icon').toBe(true);
    await navItems(page).filter({ hasText: /^Candidates$/ }).click();
    await expect(page).toHaveURL(/\/hire\/candidates$/);
    await expect(h1(page)).toHaveText(W.candidates);
    await quiet(page);
    expect(errors, 'no console error').toEqual([]);
  });

  const DENIED: Array<[string, Who]> = [
    ['a Recruiter of company B (Recruitment off)', WHO.recruiterB], ['a Recruiter of company C (nothing on)', WHO.recruiterC],
    ['HR without the Recruitment tick', WHO.hrNoTickA], ['the tick without HR', WHO.tickOnlyA], ['a hiring manager', WHO.managerA],
    ['an Admin', WHO.adminA], ['an Employee', WHO.employeeA],
  ];
  for (const [label, who] of DENIED) {
    test(`AC-1 ${label} has no Candidates entry, is sent away from both lists by the address bar, and makes no Recruitment request`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
      const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
      const { page, hire } = fx;
      const errors = watchErrors(page);
      await signInAs(fx.signIn, fx.cognito, fx.modules, hire, who);
      if (who.lands) {
        await expect(page).toHaveURL(who.lands);
        await quiet(page);
        await openNav(page);
        expect(await navLabels(page), 'no Candidates entry').not.toContain('Candidates');
      } else {
        await expect(page).toHaveURL(/\/sign-in/); // ONB-23 refuses this group at sign-in today (cards/rec-ui-01.md)
      }
      for (const path of ['/hire/candidates', '/hire/pipeline', '/hire/pipeline?view=list', '/hire/pipeline?role=role-fleet&view=list']) {
        await page.goto(path);
        await quiet(page);
        await expect(page, `${path} sends them away`).not.toHaveURL(/\/hire\//);
        if (who.lands) await expect(page).toHaveURL(who.lands);
        else await expect(page).toHaveURL(/\/sign-in/);
      }
      expect(hire!.recruitmentCalls.map((c) => `${c.method} ${c.path}`), 'no request to a Recruitment route').toEqual([]);
      expect(errors, 'no console error').toEqual([]);
    });
  }

  for (const mode of FAILING_MODES) {
    test(`AC-1 With the modules call failing (${mode}) a Recruiter has no Candidates entry and the address bar sends them to HR home`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
      const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
      const { page, hire, modules } = fx;
      modules!.mode = mode;
      await signInAs(fx.signIn, fx.cognito, modules, hire, WHO.recruiterA);
      await expect(page).toHaveURL('/hr');
      await quiet(page);
      await openNav(page);
      expect(await navLabels(page)).not.toContain('Candidates');
      await page.goto('/hire/candidates');
      await quiet(page);
      await expect(page).toHaveURL('/hr');
      expect(hire!.recruitmentCalls).toEqual([]);
    });
  }
});

// ================================================================ AC-1 Candidates (rule 2)
test.describe('AC-1 Candidates', () => {
  test.beforeEach(noBackendOnly);

  test('AC-1 The page shows the heading, the line, the tabs with the answer\'s counts, the search, More filters and the table with its caption and columns; Add candidate is its one primary button', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    hire!.countsOverride = { all: 13, mine: 5, overdue: 2, due_soon: 3, not_hired: 4 };
    await asRecruiter(fx);
    await openCandidates(fx);
    await expect(main(page).getByText(W.candidatesLine, { exact: true })).toBeVisible();
    const counts: Record<string, number> = { All: 13, 'My candidates': 5, Overdue: 2, 'Due soon': 3 };
    for (const name of phone() ? W.phoneTabs : W.tabs) await expect(tab(page, name), `tab ${name}`).toHaveAccessibleName(new RegExp(`^${name}\\s*${counts[name]}$`));
    await expect(searchBox(page)).toBeVisible();
    await expect(main(page).getByLabel(W.search, { exact: true })).toBeVisible();
    await expect(either(main(page), W.moreFilters)).toBeVisible();
    await expect(table(page)).toBeAttached();
    expect((await table(page).locator('thead th').allTextContents()).map((t) => t.trim()).filter(Boolean)).toEqual(W.columns);
    // Child lock rec-ui-02.1 (REC-UI-02 step 2): Add candidate is built; it is the page's one primary button (rec-ui-02-add.spec.ts judges it).
    await expect(main(page).getByRole('button', { name: 'Add candidate', exact: true })).toHaveCount(1);
    await expect(main(page).locator('.pp-button--primary')).toHaveCount(1);
  });

  test('AC-1 Desktop: the Role filter offers All roles and the company\'s open roles; the Stage filter offers All stages and the six stages, Not hired among them', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    desktopOnly('the kit\'s phone Candidates screen has no Role or Stage filter');
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page } = fx;
    await asRecruiter(fx);
    await openCandidates(fx);
    expect(await optionsOf(page, 'Role')).toEqual([W.allRoles, 'Fleet controller', 'Warehouse supervisor', 'Senior accountant']);
    expect(await optionsOf(page, 'Stage')).toEqual([W.allStages, ...W.stages]);
  });

  test('AC-1 The first read asks for all roles (no role_id), a page of at most 100 and no filter, and the rows are the answer\'s, in its order, with the kit\'s cells', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    await asRecruiter(fx);
    await openCandidates(fx);
    const first = listCalls(hire!)[0]!;
    expect(first.query['role_id'], 'All roles sends no role_id').toBeUndefined();
    expect(Number(first.query['limit'] ?? 100), 'a page of at most 100 (D-RUI-3)').toBeLessThanOrEqual(100);
    for (const k of ['stage', 'sla_status', 'mine', 'search', 'nextToken']) expect(first.query[k], `no ${k}`).toBeUndefined();
    const rows = await readRows(page);
    expect(rows.map(without), 'company A\'s open and hired candidates, most urgent first, with the kit\'s words').toEqual(A_ALL);
    for (const r of rows) expect(r.initials, `${r.name}'s initials`).toBe(initialsOf(r.name));
    for (const secret of ['Nomvula Zulu', 'Farai Moyo', 'Mpho Sithole', 'Hlengiwe Sibiya', 'Mandla Cele', 'Palesa Mofokeng']) expect(rows.map((r) => r.name), `${secret} is not in the default list`).not.toContain(secret);
  });

  test('AC-1 The stage-time words follow the answer\'s due date and status with the clock fixed: overdue, due today, due in days, on track with days left, and nothing without a clock', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    const cases = clockCases(hire!.world.now);
    hire!.world.cands = hire!.world.cands.filter((c) => !['role-fleet', 'role-warehouse', 'role-accountant'].includes(c.role_id)).concat(cases.map(([c]) => c));
    await asRecruiter(fx);
    await openCandidates(fx);
    const rows = await readRows(page);
    expect(rows.map((r) => r.name).sort(), 'every case is listed').toEqual(cases.map(([c]) => c.name).sort());
    for (const [c, words, tone] of cases) {
      const r = rows.find((x) => x.name === c.name)!;
      expect({ time: r.time, tone: r.tone }, `${c.name}: ${c.sla_status} due ${c.due_at}`).toEqual({ time: words, tone });
    }
    expect(rows.find((r) => r.name === 'Sibusiso Hired')!.stage).toBe('Hired');
    expect((await main(page).textContent()) ?? '', 'no empty value written out').not.toMatch(/undefined|null|NaN|Invalid Date/);
  });

  test('AC-1 A candidate with no role yet, or a level the company has not named, is still listed; the line holds only what the answer has', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    const now = hire!.world.now;
    hire!.world.cands.push(
      extra(now, 'cand-norole', 'Thando Norole', 'APPLIED', { role_id: '', company: 'A', due_at: hire!.world.cands[0]!.due_at }),
      extra(now, 'cand-oddlevel', 'Mbali Oddlevel', 'APPLIED', { level: 'PRINCIPAL' }),
    );
    await asRecruiter(fx);
    await openCandidates(fx);
    const rows = await readRows(page);
    expect(rows.find((r) => r.name === 'Thando Norole')?.meta, 'no role: the level alone').toBe('Mid');
    // A level key the company's levels do not list is shown as the answer sends it, never as an empty part.
    expect(rows.find((r) => r.name === 'Mbali Oddlevel')?.meta).toBe('Senior accountant · PRINCIPAL');
    expect(rows.map((r) => r.meta).join('|')).not.toMatch(/(^|\|)( · |· | ·)|· (\||$)/);
  });

  test('AC-1 With the company\'s levels unreadable the list still shows: each line is the role title alone', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    hire!.refuse({ method: 'GET', path: /\/v1\/roles\/options$/, status: 500, once: false });
    await asRecruiter(fx);
    await openCandidates(fx);
    const rows = await readRows(page);
    expect(rows.length).toBe(A_ALL.length);
    expect(rows.find((r) => r.name === 'Bongani Mthembu')?.meta).toBe('Fleet controller');
    await expect(page.getByText(W.failed)).toHaveCount(0);
  });

  test('AC-1 Each tab sends its filter (All none, My candidates mine, Overdue and Due soon the status), shows the answer\'s rows, and the counts stay the answer\'s', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    await asRecruiter(fx);
    await openCandidates(fx);
    const steps: Array<[string, Record<string, string>, string[]]> = [
      ['Overdue', { sla_status: 'OVERDUE' }, ['Bongani Mthembu']],
      ['Due soon', { sla_status: 'DUE_SOON' }, ['Tendai Ncube', 'Vusi Naidoo']],
      ...(phone() && !(await tab(page, 'My candidates').isVisible()) ? [] : [['My candidates', { mine: 'true' }, ['Bongani Mthembu', 'Amahle Dlamini', 'Tariro Moyo']] as [string, Record<string, string>, string[]]]),
      ['All', {}, A_ALL.map((r) => r.name)],
    ];
    for (const [name, query, expected] of steps) {
      await tab(page, name).click();
      await expect.poll(() => names(page), `${name} shows the answer`).toEqual(expected);
      const q = queryOf(lastList(hire!).query);
      delete q['limit'];
      expect(q, `${name} sends ${JSON.stringify(query)} and nothing else`).toEqual(query);
      await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
      await expect(tab(page, 'All'), 'counts stay the answer\'s whatever the tab').toHaveAccessibleName(/^All\s*13$/);
    }
  });

  test('AC-1 Desktop: the Role filter sends that role_id and All roles sends none; the Stage filter sends the stage, Not hired lists only the not-hired', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    desktopOnly('the kit\'s phone Candidates screen has no Role or Stage filter');
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    await asRecruiter(fx);
    await openCandidates(fx);
    await pick(page, 'Role', 'Warehouse supervisor');
    await expect.poll(() => names(page)).toEqual(['Lwazi Buthelezi', 'Zanele Pillay', 'Pule Maseko', 'Dineo Kruger']);
    expect(lastList(hire!).query['role_id']).toBe('role-warehouse');
    await pick(page, 'Stage', 'Not hired');
    // Wait for the request and then for its answer: an empty table is already true while the read is on its way (lock check S3).
    await expect.poll(() => lastList(hire!).query['stage']).toBe('NOT_HIRED');
    expect(queryOf(lastList(hire!).query)).toMatchObject({ role_id: 'role-warehouse', stage: 'NOT_HIRED' });
    await expect(main(page).getByText(W.empty, { exact: true }), 'Warehouse supervisor has no Not hired but the old-system one, which is not in the list').toBeVisible();
    expect(await names(page)).toEqual([]);
    await pick(page, 'Role', W.allRoles);
    await expect.poll(() => listCalls(hire!).filter((c) => c.query['stage'] === 'NOT_HIRED' && c.query['role_id'] === undefined).length).toBe(1);
    await expect.poll(() => names(page)).toEqual(['Farai Moyo', 'Nomvula Zulu']);
    expect(lastList(hire!).query['role_id'], 'All roles sends no role_id').toBeUndefined();
    expect(lastList(hire!).query['stage']).toBe('NOT_HIRED');
    const nh = await readRows(page);
    expect(nh.map((r) => [r.stage, r.time]), 'Not hired rows: the word, no clock').toEqual([['Not hired', ''], ['Not hired', '']]);
    await pick(page, 'Stage', 'Screening');
    await expect.poll(() => names(page)).toEqual(['Tariro Moyo', 'Ayanda Mkhize', 'Ntombi Dlamini', 'Zanele Pillay']);
    expect(lastList(hire!).query['stage']).toBe('SCREENING');
    await pick(page, 'Stage', W.allStages);
    await expect.poll(() => names(page)).toEqual(A_ALL.map((r) => r.name));
    expect(lastList(hire!).query['stage'], 'All stages sends none').toBeUndefined();
  });

  test('AC-1 Search sends the words trimmed and shows the answer; only spaces sends no search; nothing found reads "No one yet"', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    await asRecruiter(fx);
    await openCandidates(fx);
    await searchBox(page).fill('  warehouse  ');
    await expect.poll(() => names(page)).toEqual(['Lwazi Buthelezi', 'Zanele Pillay', 'Pule Maseko', 'Dineo Kruger']);
    expect(lastList(hire!).query['search']).toBe('warehouse');
    await searchBox(page).fill('zz-nobody');
    await expect.poll(() => lastList(hire!).query['search']).toBe('zz-nobody');
    await expect(main(page).getByText(W.empty, { exact: true })).toBeVisible();
    expect(await readRows(page)).toEqual([]);
    await searchBox(page).fill('    ');
    await expect.poll(() => names(page)).toEqual(A_ALL.map((r) => r.name));
    await quiet(page);
    expect(lastList(hire!).query['search'], 'only spaces sends no search').toBeUndefined();
    expect(listCalls(hire!).filter((c) => c.status !== 200).length, 'no list request was refused').toBe(0);
  });

  test('AC-1 A search over 100 characters is never sent (the server refuses it) and the list keeps working', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    await asRecruiter(fx);
    await openCandidates(fx);
    await searchBox(page).fill('Tendai ' + 'y'.repeat(140));
    await quiet(page);
    for (const c of listCalls(hire!)) expect((c.query['search'] ?? '').length).toBeLessThanOrEqual(100);
    expect(listCalls(hire!).filter((c) => c.status !== 200).map((c) => c.status), 'no list request was refused').toEqual([]);
    await expect(page.getByText(W.failed)).toHaveCount(0);
  });

  test('AC-1 The next page loads at the end of the list with the answer\'s nextToken and the same filters, once per token; every candidate shows once; the last page asks for nothing more', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    const more = many(hire!.world.now, 205);
    hire!.world.cands.push(...more);
    await asRecruiter(fx);
    await openCandidates(fx);
    const firstPage = (await readRows(page)).length;
    expect(firstPage, 'the first page is at most 100 rows').toBeLessThanOrEqual(100);
    expect(firstPage).toBeLessThan(A_ALL.length + more.length);
    await scrollToEnd(page, 30);
    const all = await names(page);
    expect(all.length, 'every candidate, once').toBe(A_ALL.length + more.length);
    expect(new Set(all).size, 'no candidate twice').toBe(all.length);
    expect(all.slice(0, A_ALL.length)).toEqual(A_ALL.map((r) => r.name));
    const calls = listCalls(hire!);
    const tokens = calls.map((c) => c.query['nextToken']).filter(Boolean);
    expect(calls[0]!.query['nextToken'], 'the first read has no token').toBeUndefined();
    expect(tokens.length, 'one read per further page').toBe(calls.length - 1);
    expect(new Set(tokens).size, 'each token is used once').toBe(tokens.length);
    for (const c of calls) expect(queryOf(c.query), 'the same filters on every page').toEqual(queryOf(calls[0]!.query));
    const before = calls.length;
    await scrollToEnd(page, 3);
    expect(listCalls(hire!).length, 'the last page asks for nothing more').toBe(before);
  });

  test('AC-1 With a search on, every next page carries the same search and limit as the first; only matching people show, each once', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    const more = many(hire!.world.now, 205);
    hire!.world.cands.push(...more);
    await asRecruiter(fx);
    await openCandidates(fx);
    await searchBox(page).fill('Paging');
    await expect.poll(() => lastList(hire!).query['search']).toBe('Paging');
    const from = listCalls(hire!).length - 1;
    await expect.poll(async () => (await names(page))[0]).toBe('Paging Person001');
    await scrollToEnd(page, 30);
    const all = await names(page);
    expect(all.length, 'every match, once').toBe(more.length);
    expect(new Set(all).size).toBe(all.length);
    expect(all.every((n) => n.startsWith('Paging Person')), 'only people the search matches').toBe(true);
    const calls = listCalls(hire!).slice(from);
    expect(calls.length, 'three pages of at most 100').toBeGreaterThanOrEqual(3);
    for (const c of calls) expect(queryOf(c.query), 'the same filters on every page (lock check B11)').toEqual(queryOf(calls[0]!.query));
    const tokens = calls.slice(1).map((c) => c.query['nextToken']);
    expect(tokens.every(Boolean) && new Set(tokens).size === tokens.length, 'each later page with its own token').toBe(true);
  });

  test('AC-1 A new tab or search starts again from the first page (no token) and the table holds only the new answer', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    hire!.world.cands.push(...many(hire!.world.now, 320));
    await asRecruiter(fx);
    await openCandidates(fx);
    // Read one more page, so the page holds a token for a third one; a new tab must not send it.
    await table(page).locator('tbody tr').last().scrollIntoViewIfNeeded();
    await expect.poll(() => listCalls(hire!).length, 'the second page was read').toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await names(page)).length).toBeGreaterThan(100);
    await tab(page, 'Overdue').click();
    await expect.poll(() => names(page)).toEqual(['Bongani Mthembu']);
    expect(lastList(hire!).query['nextToken'], 'a new filter starts at the first page').toBeUndefined();
    expect(queryOf(lastList(hire!).query)).toMatchObject({ sla_status: 'OVERDUE' });
    await searchBox(page).fill('Paging Person3');
    await expect.poll(() => lastList(hire!).query['search']).toBe('Paging Person3');
    expect(lastList(hire!).query['nextToken'], 'a new search starts at the first page').toBeUndefined();
  });

  test('AC-1 Until the candidate record is built a row opens nothing: no link to a record page and no Open button (D-RUI-02.4)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page } = fx;
    await asRecruiter(fx);
    await openCandidates(fx);
    expect(await readRows(page)).toHaveLength(A_ALL.length);
    await expect(main(page).locator('a[href*="/hire/candidates/cand-"]'), 'no link to a page that is not built').toHaveCount(0);
    await expect(main(page).getByRole('button', { name: /^Open /, exact: false }), 'no Open button').toHaveCount(0);
  });

  test('AC-1 A company with no candidates reads "No one yet" and shows no rows (U-7)', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    hire!.world.cands = hire!.world.cands.filter((c) => !['role-fleet', 'role-warehouse', 'role-accountant'].includes(c.role_id));
    await asRecruiter(fx);
    await openCandidates(fx);
    await expect(main(page).getByText(W.empty, { exact: true })).toBeVisible();
    expect(await readRows(page)).toEqual([]);
    await expect(page.getByText(W.failed)).toHaveCount(0);
  });

  const FAILS: Array<[string, { status?: number; abort?: boolean; body?: unknown }]> = [
    ['a 500', { status: 500 }], ['a dropped connection', { abort: true }], ['a 403', { status: 403, body: { error: 'Forbidden' } }],
    ['a 400 refusal of the query', { status: 400, body: { error: 'Bad request', code: 'INVALID_FIELD', field: 'search' } }],
  ];
  for (const [label, how] of FAILS) {
    test(`AC-1 ${label} shows "${W.failed}" with Try again, never rows, and Try again reads once more`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
      const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
      const { page, hire } = fx;
      await asRecruiter(fx);
      hire!.refuse({ method: 'GET', path: /\/v1\/candidates$/, ...how });
      await page.goto('/hire/candidates');
      await expect(main(page).getByText(W.failed, { exact: true })).toBeVisible();
      expect(await readRows(page)).toEqual([]);
      await expect(main(page).getByText('Bongani Mthembu')).toHaveCount(0);
      const before = listCalls(hire!).length;
      await main(page).getByRole('button', { name: W.tryAgain, exact: true }).click();
      await expect.poll(() => names(page)).toEqual(A_ALL.map((r) => r.name));
      expect(listCalls(hire!).length).toBe(before + 1);
    });
  }
});

// ================================================================ AC-1 A failure after a good read (lock check B13, standing line 7)
test.describe('AC-1 A failure after a good read', () => {
  test.beforeEach(noBackendOnly);
  const LISTS: Array<[string, (fx: Fx) => Promise<void>]> = [['Candidates', openCandidates], ['the Pipeline list', (fx) => openPipelineList(fx)]];
  const HOW: Array<[string, { status: number; body: unknown }]> = [['a 403 (the right was just taken away)', { status: 403, body: { error: 'Forbidden' } }], ['a 500', { status: 500, body: { error: 'Something went wrong' } }]];
  for (const [list, open] of LISTS) {
    for (const [label, how] of HOW) {
      test(`AC-1 On ${list}, ${label} after a good read shows "${W.failed}" and none of the earlier rows; Try again reads once and shows the new tab`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
        const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
        const { page, hire } = fx;
        await asRecruiter(fx);
        await open(fx);
        expect(await names(page)).toEqual(A_ALL.map((r) => r.name));
        hire!.refuse({ method: 'GET', path: /\/v1\/candidates$/, ...how, once: false });
        await tab(page, 'Overdue').click();
        await expect(main(page).getByText(W.failed, { exact: true })).toBeVisible();
        expect(await readRows(page), 'no rows of the earlier tab under the new one').toEqual([]);
        for (const n of A_ALL.map((r) => r.name)) await expect(main(page).getByText(n, { exact: true }), `${n} is gone`).toHaveCount(0);
        hire!.lift();
        const before = listCalls(hire!).length;
        await main(page).getByRole('button', { name: W.tryAgain, exact: true }).click();
        await expect.poll(() => names(page)).toEqual(['Bongani Mthembu']);
        expect(listCalls(hire!).length, 'Try again reads once').toBe(before + 1);
        expect(lastList(hire!).query['sla_status'], 'the new tab\'s read').toBe('OVERDUE');
        await expect(main(page).getByText(W.failed, { exact: true })).toHaveCount(0);
      });
    }
  }
});

// ================================================================ AC-1 Pipeline list (rule 2, D-RUI-2)
test.describe('AC-1 Pipeline list', () => {
  test.beforeEach(noBackendOnly);

  test('AC-1 Pipeline with no role is the list of all roles: heading, "{n} candidates", List chosen and Board disabled, tabs, search, Role with All roles, More filters, "Not hired {n}"', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    // The answer's total differs from the 13 rows on the page: the line is the answer's count (lock check B14).
    hire!.countsOverride = { all: 40, mine: 5, overdue: 2, due_soon: 3, not_hired: 4 };
    await asRecruiter(fx);
    await openPipelineList(fx);
    await expect(main(page).getByText('40 candidates', { exact: true })).toBeVisible();
    await expect(main(page).getByText('13 candidates', { exact: true })).toHaveCount(0);
    await expect(view(page, 'List')).toHaveAttribute('aria-pressed', 'true');
    await expect(view(page, 'Board'), 'no board for all roles (D-RUI-2)').toBeDisabled();
    const counts: Record<string, number> = { All: 40, 'My candidates': 5, Overdue: 2, 'Due soon': 3 };
    for (const name of phone() ? W.phoneTabs : W.tabs) await expect(tab(page, name)).toHaveAccessibleName(new RegExp(`^${name}\\s*${counts[name]}$`));
    await expect(searchBox(page)).toBeVisible();
    expect(await optionsOf(page, 'Role')).toEqual([W.allRoles, 'Fleet controller', 'Warehouse supervisor', 'Senior accountant']);
    await expect(either(main(page), W.moreFilters)).toBeVisible();
    if (!phone()) await expect(main(page).getByRole('button', { name: 'Not hired 4', exact: true })).toBeVisible();
    expect(listCalls(hire!)[0]!.query['role_id'], 'All roles sends no role_id').toBeUndefined();
    expect((await readRows(page)).map(without)).toEqual(A_ALL);
    await expect(main(page).getByRole('button', { name: 'Add candidate', exact: true }), 'Add candidate (rec-ui-02.1)').toHaveCount(1);
  });

  test('AC-1 Choosing a role lists its candidates with role_id and its own count, and turns Board on; Board opens that role\'s board; the board\'s List comes back to the list', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    await asRecruiter(fx);
    await openPipelineList(fx);
    hire!.countsOverride = { all: 9 };
    await pick(page, 'Role', 'Fleet controller');
    await expect.poll(() => names(page)).toEqual(['Bongani Mthembu', 'Tendai Ncube', 'Amahle Dlamini', 'Tariro Moyo', 'Ayanda Mkhize', 'Kagiso Molefe']);
    expect(lastList(hire!).query['role_id']).toBe('role-fleet');
    await expect(main(page).getByText('9 candidates', { exact: true }), 'the answer\'s count for the role, not the 6 rows').toBeVisible();
    hire!.countsOverride = null;
    await expect(view(page, 'Board')).toBeEnabled();
    await view(page, 'Board').click();
    await expect(page).toHaveURL(/\/hire\/pipeline\?.*role=role-fleet/);
    await expect(page).toHaveURL(/view=board/);
    await expect(h1(page)).toHaveText('Fleet controller');
    await expect(main(page).locator('.pp-pipeline').first()).toBeVisible();
    await expect(view(page, 'List')).toBeEnabled();
    await view(page, 'List').click();
    await expect(page).toHaveURL(/view=list/);
    await expect(h1(page)).toHaveText(W.pipeline);
    await expect.poll(() => names(page)).toEqual(['Bongani Mthembu', 'Tendai Ncube', 'Amahle Dlamini', 'Tariro Moyo', 'Ayanda Mkhize', 'Kagiso Molefe']);
    expect(lastList(hire!).query['role_id']).toBe('role-fleet');
    await pick(page, 'Role', W.allRoles);
    await expect(view(page, 'Board')).toBeDisabled();
    expect(lastList(hire!).query['role_id']).toBeUndefined();
  });

  test('AC-1 The board address with All roles shows the list, not a board', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page } = fx;
    await asRecruiter(fx);
    await page.goto('/hire/pipeline?role=all&view=board');
    await expect(h1(page)).toHaveText(W.pipeline);
    await expect(main(page).locator('.pp-pipeline')).toHaveCount(0);
    await expect(view(page, 'Board')).toBeDisabled();
    await expect.poll(() => names(page)).toEqual(A_ALL.map((r) => r.name));
  });

  test('AC-1 Desktop: "Not hired {n}" lists the not-hired with stage NOT_HIRED (the Stage filter\'s place), and pressing it again goes back', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    desktopOnly('the kit\'s phone Pipeline list has no Not hired button');
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    await asRecruiter(fx);
    await openPipelineList(fx);
    await expect(main(page).getByLabel('Stage', { exact: true }), 'the Pipeline list has no Stage filter: the button replaces it').toHaveCount(0);
    await main(page).getByRole('button', { name: 'Not hired 2', exact: true }).click();
    await expect.poll(() => names(page)).toEqual(['Farai Moyo', 'Nomvula Zulu']);
    expect(lastList(hire!).query['stage']).toBe('NOT_HIRED');
    await main(page).getByRole('button', { name: 'Not hired 2', exact: true }).click();
    await expect.poll(() => names(page)).toEqual(A_ALL.map((r) => r.name));
    expect(lastList(hire!).query['stage']).toBeUndefined();
  });

  test('AC-1 The tabs and the search send the same filters as on Candidates', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    await asRecruiter(fx);
    await openPipelineList(fx);
    await tab(page, 'Overdue').click();
    await expect.poll(() => names(page)).toEqual(['Bongani Mthembu']);
    expect(lastList(hire!).query['sla_status']).toBe('OVERDUE');
    await tab(page, 'All').click();
    await searchBox(page).fill(' Kagiso ');
    await expect.poll(() => names(page)).toEqual(['Kagiso Molefe']);
    expect(lastList(hire!).query['search']).toBe('Kagiso');
  });

  test('AC-1 A failing read shows the generic state with Try again on the Pipeline list too', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    await asRecruiter(fx);
    hire!.refuse({ method: 'GET', path: /\/v1\/candidates$/, status: 500 });
    await page.goto('/hire/pipeline');
    await expect(main(page).getByText(W.failed, { exact: true })).toBeVisible();
    expect(await readRows(page)).toEqual([]);
    await main(page).getByRole('button', { name: W.tryAgain, exact: true }).click();
    await expect.poll(() => names(page)).toEqual(A_ALL.map((r) => r.name));
  });
});

// ================================================================ AC-2 Same table
test.describe('AC-2 Same table', () => {
  test.beforeEach(noBackendOnly);

  const VIEWS: Array<[string, Record<string, string> | null]> = [['All', null], ['Overdue', { sla_status: 'OVERDUE' }], ['Due soon', { sla_status: 'DUE_SOON' }], ['the clock cases', null]];
  for (const [label] of VIEWS) {
    test(`AC-2 Candidates and the Pipeline list draw the same rows, words and parts for the same answer (${label})`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
      const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
      const { page, hire } = fx;
      if (label === 'the clock cases') hire!.world.cands.push(...clockCases(hire!.world.now).map(([c]) => c));
      await asRecruiter(fx);
      const shape = () => table(page).evaluate((el) => [...el.querySelectorAll('thead, tbody')].map((part) => [...part.querySelectorAll('*')].map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].filter((c) => c.startsWith('pp-') && !c.startsWith('pp-avatar--')).sort().join('.')}`).join(' ')));
      const read = async (): Promise<{ rows: Row[]; shape: string[] }> => {
        if (label !== 'All' && label !== 'the clock cases') await tab(page, label).click();
        await quiet(page);
        return { rows: await readRows(page), shape: await shape() };
      };
      await openCandidates(fx);
      const c = await read();
      await openPipelineList(fx);
      const p = await read();
      expect(c.rows.length).toBeGreaterThan(0);
      expect(p.rows, 'the same words in the same order').toEqual(c.rows);
      expect(p.shape, 'the same table parts').toEqual(c.shape);
    });
  }
});

// ================================================================ AC-12 Company B and C (REC-UI-00 rule 9, tenancy)
test.describe('AC-12 Company B and C', () => {
  test.beforeEach(noBackendOnly);

  const A_NAMES = [...A_ALL.map((r) => r.name), 'Nomvula Zulu', 'Farai Moyo', 'Mpho Sithole', 'Fleet controller', 'Warehouse supervisor', 'Senior accountant'];
  for (const [who, co, own, others] of [
    [WHO.recruiterB, 'B', ['Hlengiwe Sibiya', 'Mandla Cele'], ['Palesa Mofokeng', 'Head baker']],
    [WHO.recruiterC, 'C', ['Palesa Mofokeng'], ['Hlengiwe Sibiya', 'Mandla Cele', 'Dispatch lead']],
  ] as const) {
    test(`AC-12 A Recruiter of company ${co} with Recruitment on sees only their own candidates and roles on both lists, never company A's`, async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
      const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
      const { page, modules } = fx;
      recruitmentOn(modules!.answers, co);
      await asRecruiter(fx, who);
      for (const open of [openCandidates, openPipelineList]) {
        await open(fx);
        expect((await names(page)).sort()).toEqual([...own].sort());
        const text = (await main(page).textContent()) ?? '';
        for (const secret of [...A_NAMES, ...others]) expect(text, `no data of another company ("${secret}")`).not.toContain(secret);
        if (!phone() || open === openPipelineList) {
          const roles = await optionsOf(page, 'Role');
          for (const r of ['Fleet controller', 'Warehouse supervisor', 'Senior accountant']) expect(roles).not.toContain(r);
        }
      }
    });
  }

  // Lock check S6 (safety): the app's sign-out does not reload the page, so anything a list keeps in memory would survive it.
  test('AC-12 After a Recruiter of A signs out, a Recruiter of B who signs in in the same tab never sees A\'s candidates on either list, not even for a moment', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, signIn, cognito, modules, hire } = fx;
    recruitmentOn(modules!.answers, 'B');
    await asRecruiter(fx);
    await openCandidates(fx);
    expect(await names(page)).toEqual(A_ALL.map((r) => r.name));
    await openPipelineList(fx);
    expect(await names(page)).toEqual(A_ALL.map((r) => r.name));
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    // From here on no full page load: B signs in on the sign-in page the app routed to.
    const loads: string[] = [];
    page.on('load', () => loads.push(page.url()));
    if (cognito && cognito.subOf(WHO.recruiterB.email) === undefined) cognito.addAccount(WHO.recruiterB);
    modules!.assign(WHO.recruiterB.email, WHO.recruiterB.company);
    hire!.assign(WHO.recruiterB);
    await signIn.signInAs(WHO.recruiterB);
    await expect(page).toHaveURL(WHO.recruiterB.lands!);
    // Watch every change of the page from now on: an A name shown even for a moment is caught.
    await page.evaluate((secret) => {
      const seen: string[] = [];
      (window as unknown as { __seenA: string[] }).__seenA = seen;
      const look = () => { const t = document.body.innerText; for (const n of secret) if (t.includes(n) && !seen.includes(n)) seen.push(n); };
      look();
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true, characterData: true });
    }, A_NAMES);
    for (const [label, url, heading] of [['Candidates', /\/hire\/candidates$/, W.candidates], ['Pipeline', /\/hire\/pipeline/, W.pipeline]] as const) {
      await openNav(page);
      await navItems(page).filter({ hasText: new RegExp(`^${label}$`) }).click();
      await expect(page).toHaveURL(url);
      await expect(h1(page)).toHaveText(heading);
      await quiet(page);
      expect((await names(page)).sort(), `${label}: only B's own people`).toEqual(['Hlengiwe Sibiya', 'Mandla Cele']);
    }
    expect(loads, 'no full page load after sign-out (the memory of the tab was kept)').toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __seenA: string[] }).__seenA), 'no name of company A was ever on the page after B signed in').toEqual([]);
    expect(listCalls(hire!).filter((c) => c.company === 'B').length, 'B\'s lists were read for B').toBeGreaterThanOrEqual(2);
  });

  test('AC-12 Company A\'s role id in a company B address shows no data: the empty answer reads "No one yet"', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire, modules } = fx;
    recruitmentOn(modules!.answers, 'B');
    await asRecruiter(fx, WHO.recruiterB);
    await page.goto('/hire/pipeline?role=role-fleet&view=list');
    await quiet(page);
    await expect(main(page).getByText(W.empty, { exact: true }), 'the empty answer reads "No one yet"').toBeVisible();
    expect(listCalls(hire!).some((c) => c.query['role_id'] === 'role-fleet'), 'the list asked the server, which answered for B only').toBe(true);
    expect(await readRows(page)).toEqual([]);
    const text = (await main(page).textContent()) ?? '';
    for (const secret of A_NAMES) expect(text).not.toContain(secret);
    expect(listCalls(hire!).every((c) => c.status === 200 && c.company === 'B'), 'every read was B\'s own').toBe(true);
  });

  test('AC-12 No request of either list carries a company: not in the address, the query, the headers (but the token) or the body', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    hire!.world.cands.push(...many(hire!.world.now, 110));
    await asRecruiter(fx);
    await openCandidates(fx);
    await tab(page, 'Overdue').click();
    await tab(page, 'All').click();
    await searchBox(page).fill('Paging');
    await quiet(page);
    await scrollToEnd(page, 5);
    if (!phone()) { await pick(page, 'Role', 'Fleet controller'); await pick(page, 'Stage', 'Not hired'); }
    await openPipelineList(fx);
    await pick(page, 'Role', 'Senior accountant');
    await quiet(page);
    const all = hire!.calls.filter((c) => c.method !== 'OPTIONS');
    expect(listCalls(hire!).length, 'the lists made their requests').toBeGreaterThan(5);
    expect(listCalls(hire!).some((c) => c.query['nextToken']), 'a page token was among them').toBe(true);
    for (const call of all) expect(companyIdIn(call), `${call.method} ${call.path}`).toEqual([]);
  });
});

// ================================================================ AC-13 Phone
test.describe('AC-13 Phone', () => {
  test.beforeEach(noBackendOnly);
  test.beforeEach(() => phoneOnly('the criterion is the 390 wide screen'));

  /** Every heading, button, link, tab and field in the main area is on the screen, not under the top bar and not covered; nothing scrolls sideways. */
  async function everythingReachable(page: Page, where: string): Promise<void> {
    const problems = await page.evaluate(async () => {
      const out: string[] = [];
      const width = document.documentElement.clientWidth;
      const bar = document.querySelector('pp-top-navigation')?.getBoundingClientRect();
      const targets = [...document.querySelectorAll<HTMLElement>('main h1, main h2, main button, main a[href], main [role="tab"], main input, main select, main th, main td')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert],[hidden],[aria-hidden="true"]') && !el.classList.contains('pp-visually-hidden') && !el.closest('.pp-visually-hidden');
      });
      for (const el of targets) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = el.getBoundingClientRect();
        const label = `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
        if (r.left < -1 || r.right > width + 1) out.push(`${label} is cut off sideways (${Math.round(r.left)} to ${Math.round(r.right)})`);
        if (bar && r.top < bar.bottom - 1 && r.bottom > 0) out.push(`${label} is under the top bar`);
        if (el.tagName === 'TD' || el.tagName === 'TH') continue;
        const x = Math.min(Math.max(r.left + r.width / 2, 1), width - 1), y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        if (hit && !el.contains(hit) && !hit.contains(el) && !(el.tagName === 'INPUT' && hit.closest('label,.pp-field,.pp-text-field,.pp-search')?.contains(el)) && !(el.tagName === 'SELECT' && hit.closest('.pp-select')?.contains(el))) out.push(`${label} is covered by ${hit.tagName.toLowerCase()}.${String(hit.className).slice(0, 40)}`);
      }
      window.scrollTo(0, 0);
      if (document.documentElement.scrollWidth > width + 1) out.push(`the page scrolls sideways (${document.documentElement.scrollWidth} wide)`);
      return out;
    });
    expect(problems, where).toEqual([]);
  }

  /** At 390 the table is the design system's stacked table: the person on top, every other cell below it with its column name
   *  (the design system may set two short cells side by side), and no cell wider than the row. */
  async function stacked(page: Page): Promise<void> {
    await expect(table(page)).toHaveClass(/pp-table--stack/);
    const first = table(page).locator('tbody tr').first();
    const rowBox = (await first.boundingBox())!;
    const boxes = await first.locator('td').evaluateAll((tds) => tds.filter((td) => (td as HTMLElement).getBoundingClientRect().height > 0).map((td) => { const r = td.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), label: td.getAttribute('data-label') }; }));
    expect(boxes.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.top, 'every cell sits below the person').toBeGreaterThanOrEqual(boxes[0]!.bottom - 1);
    for (const b of boxes) expect(b.right - b.left, 'no cell is wider than the row').toBeLessThanOrEqual(Math.round(rowBox.width) + 1);
    expect(boxes.map((b) => b.label).filter(Boolean)).toEqual(expect.arrayContaining([...W.columns]));
  }

  test('AC-13 Candidates at 390: every heading, tab, field and button is visible and not under the top bar, the rows stack, nothing scrolls sideways', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page } = fx;
    await asRecruiter(fx);
    await openCandidates(fx);
    await everythingReachable(page, 'Candidates');
    await stacked(page);
    await tab(page, 'Overdue').click();
    await expect.poll(() => names(page)).toEqual(['Bongani Mthembu']);
    await everythingReachable(page, 'Candidates, Overdue');
  });

  test('AC-13 The Pipeline list at 390: the same, with the List and Board switch and the Role filter reachable', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page } = fx;
    await asRecruiter(fx);
    await openPipelineList(fx);
    await everythingReachable(page, 'Pipeline list');
    await stacked(page);
    await pick(page, 'Role', 'Fleet controller');
    await expect.poll(() => names(page)).toHaveLength(6);
    await everythingReachable(page, 'Pipeline list, Fleet controller');
  });

  test('AC-13 The empty and failed states at 390 are reachable too', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    await asRecruiter(fx);
    hire!.refuse({ method: 'GET', path: /\/v1\/candidates$/, status: 500 });
    await page.goto('/hire/candidates');
    await expect(main(page).getByText(W.failed, { exact: true })).toBeVisible();
    await everythingReachable(page, 'Candidates, failed');
    await main(page).getByRole('button', { name: W.tryAgain, exact: true }).click();
    await searchBox(page).fill('zz-nobody');
    await expect(main(page).getByText(W.empty, { exact: true })).toBeVisible();
    await everythingReachable(page, 'Candidates, nobody found');
  });
});

// ================================================================ AC-14 Kit match and words
test.describe('AC-14 Kit match and words', () => {
  test.beforeEach(noBackendOnly);

  const DS = join(__dirname, '..', '..', 'src', 'styles', 'design-system');
  const known = (): Set<string> => new Set(['components.css', 'tokens/base.css'].flatMap((f) => readFileSync(join(DS, f), 'utf8').match(/\.pp-[a-z0-9_-]+/g) ?? []).map((c: string) => c.slice(1)));

  async function onlyPp(page: Page, where: string): Promise<void> {
    const have = known();
    const found = await main(page).evaluate((el) => ({
      classes: [...new Set([el, ...el.querySelectorAll('*')].flatMap((e) => [...e.classList]).filter((c) => c.startsWith('pp-')))],
      styled: [...el.querySelectorAll('[style]')].filter((e) => !/^(--[\w-]+:[^;]*;?\s*)+$/.test(e.getAttribute('style') ?? '')).map((e) => e.tagName.toLowerCase()),
      styles: el.querySelectorAll('style').length,
      tags: [...new Set([...el.querySelectorAll('*')].map((e) => e.tagName.toLowerCase()).filter((t) => t.includes('-') && !t.startsWith('pp-') && !t.startsWith('app-') && t !== 'router-outlet'))],
    }));
    expect(found.classes.filter((c) => !have.has(c)), `${where}: every pp-* class exists in the design system`).toEqual([]);
    expect(found.styled, `${where}: no style attribute that sets a look`).toEqual([]);
    expect(found.styles, `${where}: no style element`).toBe(0);
    expect(found.tags, `${where}: no custom element but pp-* and app-*`).toEqual([]);
  }

  /** The kit's classes are on the page, but for the kit's layout helpers and the parts this step does not build yet. */
  async function matchesKit(page: Page, screen: 'Candidates' | 'Pipeline, list'): Promise<void> {
    const name = phone() ? `${screen} (phone)` : screen;
    const kit = (KIT.screens as Record<string, { main: readonly string[] }>)[name]!.main;
    const have = new Set(await main(page).evaluate((root) => [...new Set([root, ...root.querySelectorAll('*')].flatMap((el) => [...el.classList]).filter((c) => c.startsWith('pp-')))]));
    const layoutOnly = [/^pp-gap-/, /^pp-inline/, /^pp-grow/, /^pp-measure-/, /^pp-stack/, /--inline$/, /^pp-text(--|$)/, /^pp-avatar--/, /^pp-text-field--small$/];
    // Not built yet: the row's Open column (D-RUI-02.4, the record is step C) and the page's More actions (subtle icon buttons).
    // Add candidate (primary, and on Candidates the header's actions slot) is built since rec-ui-02.1.
    const later = [/^pp-button--subtle$/, /^pp-button--icon$/, /^pp-table__actions$/];
    const missing = kit.filter((c) => !have.has(c) && ![...layoutOnly, ...later].some((re) => re.test(c)));
    expect(missing, `${name}: classes the kit has and the page lacks`).toEqual([]);
  }

  test('AC-14 The app is synced to the design system ref these structures were captured at', async () => {
    const sync = JSON.parse(readFileSync(join(DS, 'sync.json'), 'utf8')) as { ref: string };
    expect(sync.ref, 'a design system change needs these structures captured again (a child lock)').toBe(KIT.ref);
  });

  test('AC-14 Candidates matches the kit screen "Candidates" and uses only design system parts; Overdue is a danger lozenge, Due a warning lozenge, On track plain small text', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page } = fx;
    await asRecruiter(fx);
    await openCandidates(fx);
    await matchesKit(page, 'Candidates');
    await onlyPp(page, 'Candidates');
    const rows = await readRows(page);
    expect(rows.find((r) => r.name === 'Bongani Mthembu')!.tone).toBe('danger');
    expect(rows.find((r) => r.name === 'Tendai Ncube')!.tone).toBe('warning');
    expect(rows.find((r) => r.name === 'Amahle Dlamini')!.tone, 'on track is words, not a lozenge').toBe('text');
    await expect(table(page).locator('tbody tr').first().locator('.pp-person .pp-avatar')).toHaveCount(1);
  });

  test('AC-14 The Pipeline list matches the kit screen "Pipeline, list" and uses only design system parts', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page } = fx;
    await asRecruiter(fx);
    await openPipelineList(fx);
    await matchesKit(page, 'Pipeline, list');
    await onlyPp(page, 'Pipeline list');
  });

  test('AC-14 Neither list, nor their empty and failed states, uses an old word: Masked, Rejected, Evaluation, Provisioning, sentiment', async ({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h }) => {
    const fx = fxOf({ page: _p, signIn: _s, cognito: _c, modules: _m, hire: _h });
    const { page, hire } = fx;
    const OLD = /\b(Masked|Rejected|Evaluation|Provisioning|sentiment)\b/i;
    await asRecruiter(fx);
    const texts: string[] = [];
    await openCandidates(fx);
    texts.push((await main(page).innerText()));
    if (!phone()) { await pick(page, 'Stage', 'Not hired'); await quiet(page); texts.push(await main(page).innerText()); }
    await openPipelineList(fx);
    texts.push(await main(page).innerText());
    await searchBox(page).fill('zz-nobody');
    await quiet(page);
    texts.push(await main(page).innerText());
    hire!.refuse({ method: 'GET', path: /\/v1\/candidates$/, status: 500 });
    await page.goto('/hire/candidates');
    await expect(main(page).getByText(W.failed, { exact: true })).toBeVisible();
    texts.push(await main(page).innerText());
    for (const t of texts) expect(t).not.toMatch(OLD);
  });
});

// ================================================================ AC-15 pepla-dev (the list parts)
test.describe('AC-15 pepla-dev', () => {
  test.skip(!ON_DEV, 'AC-15 runs on pepla-dev only.');

  test('AC-15 @pepla-dev The Recruiter opens Candidates from the sidebar and sees the seeded candidates across roles; the Pipeline list for Fleet controller agrees with its board', async ({ page, signIn, hr }) => {
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL('/hr');
    await openNav(page);
    await navItems(page).filter({ hasText: /^Candidates$/ }).click();
    await expect(h1(page)).toHaveText(W.candidates);
    await quiet(page);
    await scrollToEnd(page, 20);
    const rows = await readRows(page);
    const amahle = rows.find((r) => r.name === 'Amahle Dlamini');
    expect(amahle, 'the seeded Applied candidate is listed').toBeTruthy();
    expect(amahle!.meta.startsWith('Fleet controller'), 'with the role title the server read').toBe(true);
    expect(rows.some((r) => r.meta.startsWith('Warehouse supervisor') || r.meta.startsWith('Senior accountant')), 'more than one role is listed').toBe(true);
    await expect(tab(page, 'All'), 'the All count is the number of rows the list holds').toHaveAccessibleName(new RegExp(`^All\\s*${rows.length}$`));
    await page.goto('/hire/pipeline?role=all&view=list');
    await expect(h1(page)).toHaveText(W.pipeline);
    await expect(main(page).getByText(`${rows.length} candidates`, { exact: true })).toBeVisible();
  });

  test('AC-15 @pepla-dev An Employee has no Candidates entry and the address is sent away', async ({ page, signIn, employee }) => {
    await signIn.open();
    await signIn.signInAs(employee);
    await expect(page).toHaveURL('/start');
    await page.goto('/hire/candidates');
    await expect(page).not.toHaveURL(/\/hire\//);
  });

  test('AC-15 @pepla-dev Company B\'s HR login has no Candidates entry and the address is redirected', async ({ page, signIn }) => {
    const email = process.env['E2E_B_HR_EMAIL'], password = process.env['E2E_B_HR_PASSWORD'];
    test.skip(!email || !password, 'E2E_B_HR_EMAIL and E2E_B_HR_PASSWORD are not set: the company B part cannot run.');
    await signIn.open();
    await signIn.signInAs({ email: email!, password: password! });
    await expect(page).toHaveURL('/hr');
    await openNav(page);
    expect(await navLabels(page)).not.toContain('Candidates');
    await page.goto('/hire/candidates');
    await expect(page).toHaveURL('/hr');
  });
});
