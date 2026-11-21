import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { CognitoFake, FakeAccount } from './support/cognito-fake';
import { EmployeesFake } from './support/employees-fake';
import { FAKE, ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { forgetSignIn } from './support/sign-in-again';
import { FAILING_MODES, ModulesFake, type Company } from './support/mod-02/modules-fake';
import { MODULE_COPY, MODULE_KEY, NOT_BUILT, ORDER, PUBLIC_PAGE, WORDS, type Key, type State } from './support/mod-03/catalogue';

/**
 * MOD-03 · The module launcher: every module in one place, with what the company and the person can open
 * (Jira NH-226, epic NH-222). Spec: onboarding-cards/specs/MOD-03.md. Notes and the page contract: cards/mod-03.md.
 *
 * The spec names no markup, so cards/mod-03.md fixes the few handles the tests use:
 *   the button       a button named "Modules" in pp-top-navigation
 *   the container    role="dialog" named "Modules" (pp-popup at 1280, pp-drawer at 390)
 *   a tile           an element with data-module="<key>" and data-state="open|no-access|not-on|coming-soon" inside the dialog
 * and, like MOD-02, the test-only hook `window.__nalekoTestSetup` (entries and routes), which the app already has.
 *
 * Everything else the tests read is what a person sees: words, order, links, boxes, focus. The words are the approved site's
 * (support/mod-03/catalogue.ts). No test calls AWS, Bedrock or any paid AI service.
 */

type Fixtures = { modules: ModulesFake | null; list: EmployeesFake | null };

const test = base.extend<Fixtures>({
  list: [
    async ({ context, baseURL }, use) => {
      if (ON_DEV) return use(null);
      const fake = new EmployeesFake(new URL(baseURL!).origin);
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
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
const desktopOnly = (name: string) => test.skip(name !== 'desktop-1280', 'Runs once: it reads files or builds, it has no screen width.');
const PHONE = (name: string) => name === 'phone-390';

// ---------------------------------------------------------------- the people (the same fake companies as MOD-02)

const PASSWORD = 'winter-protea-2026';
const SUNBIRD = 'sunbird-bakery.co.za';
type Who = FakeAccount & { company: Company; password: string; lands: '/hr' | '/start' | '/admin/ask-batsi' };
const person = (p: Omit<Who, 'password'>): Who => ({ ...p, password: PASSWORD });

const WHO = {
  hrA: person({ ...FAKE.hr, company: 'A', lands: '/hr' }),
  hrB: person({ email: `pieter.vanwyk@${SUNBIRD}`, givenName: 'Pieter', familyName: 'van Wyk', groups: ['hr_staff'], company: 'B', lands: '/hr' }),
  hrC: person({ email: `lerato.molefe@${SUNBIRD}`, givenName: 'Lerato', familyName: 'Molefe', groups: ['hr_staff'], company: 'C', lands: '/hr' }),
  empA: person({ ...FAKE.employee, company: 'A', lands: '/start' }),
  empB: person({ email: `zanele.mahlangu@${SUNBIRD}`, givenName: 'Zanele', familyName: 'Mahlangu', groups: ['employee'], company: 'B', lands: '/start' }),
  // The Recruitment tick (perm-recruitment) on an employee: the "manager with the tick" of the card's matrix. A group `manager` cannot sign in today (ONB-23).
  empTickA: person({ email: `naledi.mokoena@${SUNBIRD}`, givenName: 'Naledi', familyName: 'Mokoena', groups: ['employee', 'perm-recruitment'], company: 'A', lands: '/start' }),
  empTickB: person({ email: `kabelo.nkosi@${SUNBIRD}`, givenName: 'Kabelo', familyName: 'Nkosi', groups: ['employee', 'perm-recruitment'], company: 'B', lands: '/start' }),
  adminA: person({ email: `nomsa.dlamini@${SUNBIRD}`, givenName: 'Nomsa', familyName: 'Dlamini', groups: ['admin'], company: 'A', lands: '/admin/ask-batsi' }),
  adminB: person({ email: `mpho.ndaba@${SUNBIRD}`, givenName: 'Mpho', familyName: 'Ndaba', groups: ['admin'], company: 'B', lands: '/admin/ask-batsi' }),
  adminC: person({ email: `sizwe.radebe@${SUNBIRD}`, givenName: 'Sizwe', familyName: 'Radebe', groups: ['admin'], company: 'C', lands: '/admin/ask-batsi' }),
};

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

// ---------------------------------------------------------------- the test-only hook (as MOD-02's, cards/mod-02.md)

type TestEntry = { id: string; group: string; label: string; icon: string; route: string; module?: string; roles?: string[]; perms?: string[]; order?: number };
type TestRoute = { path: string; module?: string; roles?: string[]; perms?: string[] };
/** One first page for each built module, as the registry would hold it. Hire is for HR and for the Recruitment tick; Records and Onboard for HR. */
const ENTRIES: TestEntry[] = [
  { id: 'mod03-records', group: 'Records', label: 'Test records page', icon: 'id-card', route: '/mod03/records', roles: ['hr_staff'] },
  { id: 'mod03-hire', group: 'Hire', label: 'Test hire page', icon: 'users', route: '/mod03/hire', module: 'recruitment', roles: ['hr_staff'], perms: ['perm-recruitment'] },
  { id: 'mod03-onboard', group: 'Onboard', label: 'Test onboard page', icon: 'list-checks', route: '/mod03/onboard', module: 'onboarding', roles: ['hr_staff'] },
];
const ROUTES: TestRoute[] = [
  { path: 'mod03/records', roles: ['hr_staff'] },
  { path: 'mod03/hire', module: 'recruitment', roles: ['hr_staff'], perms: ['perm-recruitment'] },
  { path: 'mod03/onboard', module: 'onboarding', roles: ['hr_staff'] },
];
async function register(page: Page): Promise<void> {
  await page.addInitScript((s) => { (window as unknown as { __nalekoTestSetup: unknown }).__nalekoTestSetup = s; }, { entries: ENTRIES, routes: ROUTES });
}

// ---------------------------------------------------------------- reading the launcher

const trigger = (page: Page): Locator => page.locator('pp-top-navigation').getByRole('button', { name: WORDS.launcher, exact: true });
const dialog = (page: Page): Locator => page.getByRole('dialog', { name: WORDS.launcher, exact: true });
const tileOf = (page: Page, key: Key): Locator => dialog(page).locator(`[data-module="${key}"]`);

/** Signs in on the sign-in page the app is already showing (no page load), so nothing the app kept in memory is cleared. */
async function enterHere(page: Page, signIn: SignInPage, cognito: CognitoFake | null, modules: ModulesFake | null, who: Who): Promise<void> {
  if (cognito && cognito.subOf(who.email) === undefined) cognito.addAccount(who);
  modules?.assign(who.email, who.company);
  await signIn.signInAs(who);
  await expect(page).toHaveURL(who.lands);
  await expect(page.locator('main h1').first()).toBeVisible();
}
async function signOutInApp(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Your account/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/sign-in/);
}
async function openLauncher(page: Page): Promise<void> {
  await expect(trigger(page), 'the Modules button is in the top bar').toBeVisible();
  await trigger(page).click();
  await expect(dialog(page), 'the launcher opens').toBeVisible();
  await expect(dialog(page).locator('[data-module]').first()).toBeVisible();
  await settleDraw(page);
}
async function closeLauncher(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
}
async function settleDraw(page: Page): Promise<void> {
  // The drawer slides in: wait for every animation to end and the launcher to stop moving before anything is measured.
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))).then(() => undefined));
  let last = '';
  for (let i = 0; i < 40; i++) {
    const now = await page.evaluate(() => { const d = document.querySelector('[role="dialog"]'); const r = d?.getBoundingClientRect(); return r ? [r.x, r.y, r.width, r.height].map(Math.round).join(',') : 'none'; });
    if (now === last) return;
    last = now;
    await page.waitForTimeout(60);
  }
}
/** The modules answer has come (or failed) and the page has drawn what it holds. */
async function answered(page: Page, modules: ModulesFake | null, calls: number): Promise<void> {
  if (modules) {
    await expect.poll(() => modules.answered, { message: `the app asked for the modules and got an answer (call ${calls})`, timeout: 15_000 }).toBeGreaterThanOrEqual(calls);
    await page.waitForTimeout(300);
  } else {
    await page.waitForLoadState('networkidle');
  }
  await settleDraw(page);
}

type Tile = { key: string; state: string; text: string; pressable: number; links: string[] };
/** Every tile in the order drawn: its key, state, words, how many things in it can be pressed, and the links in it. */
async function readTiles(page: Page): Promise<Tile[]> {
  return dialog(page).locator('[data-module]').evaluateAll((els) =>
    els.map((el) => ({
      key: el.getAttribute('data-module') ?? '',
      state: el.getAttribute('data-state') ?? '',
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      pressable: (el.matches('a[href],button,[role="button"],[role="link"]') ? 1 : 0) + el.querySelectorAll('a[href],button,[role="button"],[role="link"],[tabindex]:not([tabindex="-1"])').length,
      links: [...(el.matches('a[href]') ? [el] : []), ...el.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? ''),
    })),
  );
}
const stateOf = (tiles: Tile[], key: Key): string | undefined => tiles.find((t) => t.key === key)?.state;

/** The module tiles' states for one person, as the card's rules give them (rule 3, rule 5). Leave, Comply, Help desk and Perform are always Coming soon. */
type Expected = { records: State; hire: State; onboard: State; recordsName?: string; link?: Partial<Record<Key, boolean>> };
const SOON: State = 'coming-soon';

// ---------------------------------------------------------------- the matrix (card rule 5, companies A: onboarding+recruitment, B: onboarding, C: none)

const MATRIX: Array<[string, Who, Expected]> = [
  ['HR, company A', WHO.hrA, { records: 'open', hire: 'open', onboard: 'open' }],
  ['HR, company B (no Recruitment)', WHO.hrB, { records: 'open', hire: 'not-on', onboard: 'open' }],
  ['HR, company C (no modules)', WHO.hrC, { records: 'open', hire: 'not-on', onboard: 'not-on' }],
  ['employee, company A', WHO.empA, { records: 'open', hire: 'no-access', onboard: 'no-access', recordsName: WORDS.myDetails }],
  ['employee, company B', WHO.empB, { records: 'open', hire: 'not-on', onboard: 'no-access', recordsName: WORDS.myDetails }],
  ['employee with the Recruitment tick, company A', WHO.empTickA, { records: 'open', hire: 'open', onboard: 'no-access', recordsName: WORDS.myDetails }],
  ['employee with the Recruitment tick, company B: the company lacks it, the tick does not matter', WHO.empTickB, { records: 'open', hire: 'not-on', onboard: 'no-access', recordsName: WORDS.myDetails }],
  ['Admin, company A: every company module open', WHO.adminA, { records: 'open', hire: 'open', onboard: 'open' }],
  ['Admin, company B: Not switched on tile has the public page link', WHO.adminB, { records: 'open', hire: 'not-on', onboard: 'open', link: { hire: true } }],
  ['Admin, company C', WHO.adminC, { records: 'open', hire: 'not-on', onboard: 'not-on', link: { hire: true, onboard: true } }],
];

/** The words a tile in this state carries, and the words it must not. */
function checkWords(tile: Tile, who: string, expectedName?: string): void {
  const key = tile.key as Exclude<Key, 'ask-batsi'>;
  const copy = MODULE_COPY[key];
  const all = [WORDS.noAccess, WORDS.notOn, WORDS.comingSoon, WORDS.askAdmin];
  const must: Record<string, string[]> = {
    open: [], 'no-access': [WORDS.noAccess, WORDS.askAdmin], 'not-on': [WORDS.notOn], 'coming-soon': [WORDS.comingSoon],
  };
  const has = must[tile.state]!;
  for (const w of has) expect(tile.text, `${who}: ${key} (${tile.state}) says "${w}"`).toContain(w);
  for (const w of all.filter((x) => !has.includes(x))) expect(tile.text, `${who}: ${key} (${tile.state}) does not say "${w}"`).not.toContain(w);
  expect(tile.text, `${who}: ${key} shows its name`).toContain(expectedName ?? copy.name);
  if (!expectedName) expect(tile.text, `${who}: ${key} shows its one-line description`).toContain(copy.description);
}

// ================================================================ the tests

test.describe('MOD-03 The module launcher', () => {
  test.beforeEach(async ({ page }) => {
    await register(page);
  });

  test('AC-1 The Modules button is in the top bar for every signed-in person (word at 1280, icon only at 390); it opens a popup at 1280 and a full-height drawer at 390; Escape and the close control shut it; focus goes in and comes back', async ({ page, signIn, cognito, modules }, testInfo) => {
    noBackendOnly();
    const phone = PHONE(testInfo.project.name);
    const vp = page.viewportSize()!;

    // Signed out: no Modules button at all.
    await signIn.open();
    await expect(page.getByRole('button', { name: WORDS.launcher, exact: true }), 'the sign-in page has no Modules button').toHaveCount(0);

    let first = true;
    for (const who of [WHO.hrA, WHO.empA, WHO.adminA]) {
      if (!first) await forgetSignIn(page);
      first = false;
      await enter(page, signIn, cognito, modules, who);
      const button = trigger(page);
      await expect(button, `${who.givenName}: the Modules button is in the top bar`).toBeVisible();
      await expect(button, `${who.givenName}: it is closed to start with`).toHaveAttribute('aria-expanded', 'false');
      await expect(dialog(page), `${who.givenName}: nothing is open to start with`).toHaveCount(0);
      const word = button.getByText(WORDS.launcher, { exact: true });
      if (phone) await expect(word, 'at 390 the word is not shown, the icon alone is').toBeHidden();
      else await expect(word, 'at 1280 the word is shown beside the icon').toBeVisible();
      expect(await button.locator('svg').count(), 'the button has an icon').toBeGreaterThan(0);
      // Left end of the bar, before search.
      const bar = page.locator('pp-top-navigation');
      const search = bar.getByRole('button', { name: 'Search', exact: true }).or(bar.getByRole('searchbox')).first();
      const bb = (await button.boundingBox())!;
      const sb = (await search.boundingBox())!;
      expect(bb.x + bb.width, `${who.givenName}: the Modules button sits before search`).toBeLessThanOrEqual(sb.x + 1);

      await button.click();
      await expect(dialog(page), `${who.givenName}: the launcher opens`).toBeVisible();
      await expect(button, 'aria-expanded follows the launcher').toHaveAttribute('aria-expanded', 'true');
      await expect(dialog(page).getByRole('heading', { name: WORDS.launcher, exact: true }), 'the launcher has the title "Modules"').toBeVisible();
      expect(await dialog(page).evaluate((d) => d.contains(document.activeElement)), `${who.givenName}: focus goes into the launcher`).toBe(true);
      await settleDraw(page);

      const box = (await dialog(page).boundingBox())!;
      if (phone) {
        expect(box.y, 'a drawer starts at the top of the screen').toBeLessThanOrEqual(1);
        expect(box.height, 'a drawer is as tall as the screen').toBeGreaterThanOrEqual(vp.height - 2);
        expect(box.x + box.width, 'a drawer stays inside the screen').toBeLessThanOrEqual(vp.width + 1);
      } else {
        expect(box.y, 'a popup hangs under the bar, not at the very top').toBeGreaterThan(20);
        expect(box.width, 'a popup is not the whole screen wide').toBeLessThan(vp.width - 200);
        expect(box.x, 'a popup begins near the button, at the left').toBeLessThan(vp.width / 2);
      }

      await page.keyboard.press('Escape');
      await expect(dialog(page), `${who.givenName}: Escape shuts it`).toHaveCount(0);
      await expect(button, 'aria-expanded is false again').toHaveAttribute('aria-expanded', 'false');
      await expect(button, `${who.givenName}: focus comes back to the Modules button`).toBeFocused();

      await button.click();
      await expect(dialog(page)).toBeVisible();
      await dialog(page).getByRole('button', { name: /^close/i }).click();
      await expect(dialog(page), `${who.givenName}: the close control shuts it`).toHaveCount(0);
      await expect(button, 'focus comes back after the close control too').toBeFocused();
      // Opening it again shows it again (not a one time thing).
      await button.click();
      await expect(dialog(page)).toBeVisible();
      await page.keyboard.press('Escape');
    }
  });

  test('AC-2 The Ask Batsi row and the seven tiles come in order, with the approved names, one-line descriptions and an icon each', async ({ page, signIn, cognito, modules }) => {
    noBackendOnly();
    await enter(page, signIn, cognito, modules, WHO.hrA);
    await answered(page, modules, 1);
    await openLauncher(page);
    const tiles = await readTiles(page);
    expect(tiles.map((t) => t.key), 'Ask Batsi on top, then the modules in the design system order').toEqual(ORDER);
    expect(tiles[0]!.text, 'the Ask Batsi row says "Ask Batsi"').toContain(WORDS.askBatsi);
    for (const t of tiles.slice(1)) checkWords(t, 'HR of company A');
    // Words that are not on the approved site do not creep in: a tile holds only its name, its description and its state words.
    for (const t of tiles.slice(1)) {
      const copy = MODULE_COPY[t.key as Exclude<Key, 'ask-batsi'>];
      const rest = t.text.replace(copy.name, '').replace(copy.description, '').replace(new RegExp(`${WORDS.comingSoon}|${WORDS.noAccess}|${WORDS.notOn}|${WORDS.askAdmin}`, 'g'), '').trim();
      expect(rest, `${t.key}: no other words on the tile`).toBe('');
    }
    expect(tiles.map((t) => t.text).join(' '), 'the word "Masked" is never shown').not.toMatch(/masked/i);
    // An icon on every tile, and no two the same.
    const icons = await dialog(page).locator('[data-module]').evaluateAll((els) => els.map((el) => el.querySelector('svg')?.innerHTML ?? ''));
    expect(icons.every((i) => i.length > 0), 'every tile has an icon').toBe(true);
    expect(new Set(icons).size, 'no two tiles share an icon').toBe(icons.length);
    await closeLauncher(page);

    // The employee's Records tile reads "My details"; the rest are the same.
    await forgetSignIn(page);
    await enter(page, signIn, cognito, modules, WHO.empA);
    await answered(page, modules, 2);
    await openLauncher(page);
    const mine = await readTiles(page);
    expect(mine.map((t) => t.key)).toEqual(ORDER);
    expect(mine.find((t) => t.key === 'records')!.text, 'an employee\'s Records tile reads "My details"').toContain(WORDS.myDetails);
    expect(mine.find((t) => t.key === 'records')!.text, 'and not the module name').not.toContain(MODULE_COPY.records.name);
  });

  test('AC-3 The state of every tile for each person is as the matrix; Open tiles go to the module\'s first page; the others go nowhere; an Admin\'s link on a Not switched on tile is the public page', async ({ page, signIn, cognito, modules }) => {
    noBackendOnly();
    let calls = 0;
    let first = true;
    for (const [name, who, want] of MATRIX) {
      if (!first) await forgetSignIn(page);
      first = false;
      await enter(page, signIn, cognito, modules, who);
      await answered(page, modules, ++calls);
      await openLauncher(page);
      const tiles = await readTiles(page);
      expect(tiles.map((t) => t.key), `${name}: the tiles`).toEqual(ORDER);
      expect(stateOf(tiles, 'records'), `${name}: Employee Records`).toBe(want.records);
      expect(stateOf(tiles, 'hire'), `${name}: Hire`).toBe(want.hire);
      expect(stateOf(tiles, 'onboard'), `${name}: Onboard`).toBe(want.onboard);
      for (const k of NOT_BUILT) expect(stateOf(tiles, k), `${name}: ${k} is Coming soon for everyone`).toBe(SOON);
      for (const t of tiles.slice(1)) checkWords(t, name, t.key === 'records' ? want.recordsName : undefined);

      for (const t of tiles.slice(1)) {
        const key = t.key as Key;
        if (t.state === 'open') {
          expect(t.pressable, `${name}: the Open ${key} tile can be pressed`).toBeGreaterThan(0);
        } else if (t.state === 'not-on' && want.link?.[key]) {
          expect(t.links, `${name}: the Not switched on ${key} tile has one link, the public module page`).toHaveLength(1);
          expect(new URL(t.links[0]!, 'https://naleko.example').pathname.replace(/\/$/, ''), `${name}: ${key} link goes to the public module page`).toMatch(new RegExp(`${PUBLIC_PAGE[key]}(\\.html)?$`));
          expect(t.pressable, `${name}: nothing else on that tile can be pressed`).toBe(1);
        } else {
          expect(t.pressable, `${name}: the ${t.state} ${key} tile cannot be pressed`).toBe(0);
          expect(t.links, `${name}: and has no link`).toEqual([]);
        }
      }

      // Where an Open tile goes (the test registry's first page for the person), and that the rest go nowhere.
      const here = page.url();
      const goes: Array<[Key, string]> = [];
      if (who.groups.includes('hr_staff')) goes.push(['records', '/mod03/records'], ['hire', '/mod03/hire'], ['onboard', '/mod03/onboard']);
      else if (who.groups.includes('employee')) {
        goes.push(['records', '/start']);
        if (who.groups.includes('perm-recruitment') && want.hire === 'open') goes.push(['hire', '/mod03/hire']);
      }
      for (const [key, path] of goes) {
        if (stateOf(tiles, key) !== 'open') continue;
        await tileOf(page, key).click();
        await expect(page, `${name}: the Open ${key} tile goes to its first page`).toHaveURL(path);
        await expect(dialog(page), `${name}: the launcher closes when a tile is pressed`).toHaveCount(0);
        await page.goto(who.lands);
        await expect(page.locator('main h1').first()).toBeVisible();
        await answered(page, modules, calls);
        await openLauncher(page);
      }
      for (const t of tiles.slice(1)) {
        if (t.state === 'open' || t.links.length) continue;
        await tileOf(page, t.key as Key).click({ force: true });
        await expect(page, `${name}: pressing the ${t.state} ${t.key} tile goes nowhere`).toHaveURL(page.url());
        await expect(dialog(page), `${name}: and the launcher stays open`).toBeVisible();
      }
      if (goes.length === 0) expect(page.url(), name).toBe(here);
      await closeLauncher(page);
    }
  });

  test('AC-4 With the modules call failing or not answered yet, no tile is Open except Employee Records (HR, an Admin) or the employee\'s own pages, and no tile shows an error', async ({ page, signIn, cognito, modules }) => {
    noBackendOnly();
    const fake = modules!;
    let first = true;
    for (const mode of [...FAILING_MODES, 'hold' as const]) {
      for (const who of [WHO.hrA, WHO.empTickA, WHO.adminA]) {
        if (!first) await forgetSignIn(page);
        first = false;
        fake.mode = mode;
        const before = fake.answered;
        const asked = fake.calls.length;
        await enter(page, signIn, cognito, fake, who);
        if (mode === 'hold') await expect.poll(() => fake.calls.length, { message: 'the app asked and is still waiting' }).toBeGreaterThan(asked);
        else await expect.poll(() => fake.answered, { message: 'the app asked and the call failed' }).toBeGreaterThan(before);
        await settleDraw(page);
        await openLauncher(page);
        const tiles = await readTiles(page);
        const name = `${who.givenName}, call ${mode}`;
        expect(tiles.map((t) => t.key), `${name}: the tiles are all there`).toEqual(ORDER);
        const open = tiles.slice(1).filter((t) => t.state === 'open').map((t) => t.key);
        expect(open, `${name}: nothing is Open but Employee Records (it needs no module)`).toEqual(['records']);
        expect(stateOf(tiles, 'hire'), `${name}: Hire is as for a company with nothing on`).toBe('not-on');
        expect(stateOf(tiles, 'onboard'), `${name}: Onboard is as for a company with nothing on`).toBe('not-on');
        for (const k of NOT_BUILT) expect(stateOf(tiles, k)).toBe(SOON);
        expect(tiles.map((t) => t.text).join(' '), `${name}: no error words on the tiles`).not.toMatch(/error|failed|try again|forbidden|unauthori[sz]ed/i);
        for (const t of tiles.slice(1).filter((x) => x.links.length === 0)) {
          const copy = MODULE_COPY[t.key as Exclude<Key, 'ask-batsi'>];
          const rest = t.text.replace(copy.name, '').replace(WORDS.myDetails, '').replace(copy.description, '').replace(new RegExp(`${WORDS.comingSoon}|${WORDS.noAccess}|${WORDS.notOn}|${WORDS.askAdmin}`, 'g'), '').trim();
          expect(rest, `${name}: ${t.key} holds only its name, description and state words`).toBe('');
        }
        await closeLauncher(page);
      }
    }
  });

  test('AC-5 After the company\'s modules change on the server, the tiles follow within a minute with no sign-out; another person signing in on the same page never sees the last person\'s tiles', async ({ page, signIn, cognito, modules }) => {
    noBackendOnly();
    const fake = modules!;
    await page.clock.install();
    await enter(page, signIn, cognito, fake, WHO.hrB);
    await answered(page, fake, 1);
    await openLauncher(page);
    expect(stateOf(await readTiles(page), 'hire'), 'company B starts without Recruitment').toBe('not-on');
    await closeLauncher(page);

    // Naleko switches Recruitment on for company B. A minute later, with no sign-out, the next page the person opens shows it.
    fake.answers.B = ['onboarding', 'recruitment'];
    await page.clock.fastForward(61_000);
    await page.getByRole('link', { name: 'Add new employee' }).click();
    await expect(page).toHaveURL(/\/hr\/employees\/new$/);
    await answered(page, fake, 2);
    await openLauncher(page);
    expect(stateOf(await readTiles(page), 'hire'), 'Hire is Open within a minute of the change').toBe('open');
    expect(page.url(), 'the person was not signed out').toMatch(/\/hr\/employees\/new$/);
    await closeLauncher(page);

    // And the other way: switched off again.
    fake.answers.B = ['onboarding'];
    await page.clock.fastForward(61_000);
    await page.goto('/hr');
    await answered(page, fake, 3);
    await openLauncher(page);
    expect(stateOf(await readTiles(page), 'hire'), 'Hire is Not switched on again within a minute').toBe('not-on');
    await closeLauncher(page);

    // Company A's HR signs out, company C's HR signs in on the same page without a reload: C's tiles, never A's.
    await signOutInApp(page);
    await enterHere(page, signIn, cognito, fake, WHO.hrA);
    await answered(page, fake, 4);
    await openLauncher(page);
    expect(stateOf(await readTiles(page), 'hire'), 'company A has Recruitment').toBe('open');
    await closeLauncher(page);
    await signOutInApp(page);
    fake.mode = 'hold';
    await enterHere(page, signIn, cognito, fake, WHO.hrC);
    await openLauncher(page);
    const during = await readTiles(page);
    expect(stateOf(during, 'hire'), 'while the new person\'s answer is awaited, the last person\'s Open is not shown').toBe('not-on');
    expect(stateOf(during, 'onboard')).toBe('not-on');
    fake.release();
    await closeLauncher(page);
    await page.clock.fastForward(61_000);
    await page.goto('/hr');
    await answered(page, fake, 5);
    await openLauncher(page);
    const after = await readTiles(page);
    expect(stateOf(after, 'hire'), 'company C has nothing on').toBe('not-on');
    expect(stateOf(after, 'onboard')).toBe('not-on');
  });

  test('AC-6 At 1280 and 390 wide every heading, tile and the close control is visible, not covered by the top bar or anything else, and nothing scrolls sideways', async ({ page, signIn, cognito, modules }) => {
    noBackendOnly();
    let calls = 0;
    let first = true;
    for (const who of [WHO.hrA, WHO.hrB, WHO.adminC]) {
      if (!first) await forgetSignIn(page);
      first = false;
      await enter(page, signIn, cognito, modules, who);
      await answered(page, modules, ++calls);
      await openLauncher(page);
      const d = dialog(page);
      const vp = page.viewportSize()!;
      const targets: Array<[string, Locator]> = [
        ['the title', d.getByRole('heading', { name: WORDS.launcher, exact: true })],
        ['the close control', d.getByRole('button', { name: /^close/i })],
        ...ORDER.map((k): [string, Locator] => [`the ${k} tile`, tileOf(page, k)]),
      ];
      for (const [what, loc] of targets) {
        await loc.first().scrollIntoViewIfNeeded();
        await expect(loc.first(), `${who.givenName}: ${what} is visible`).toBeVisible();
        const box = (await loc.first().boundingBox())!;
        expect(box.x, `${who.givenName}: ${what} is not cut off on the left`).toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width, `${who.givenName}: ${what} is not cut off on the right`).toBeLessThanOrEqual(vp.width + 0.5);
        expect(box.y, `${who.givenName}: ${what} is not above the screen`).toBeGreaterThanOrEqual(-0.5);
        expect(box.y + box.height, `${who.givenName}: ${what} is not below the screen`).toBeLessThanOrEqual(vp.height + 0.5);
        const covered = await loc.first().evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 12));
          return !(hit && (el === hit || el.contains(hit)));
        });
        expect(covered, `${who.givenName}: ${what} is not under the top bar or anything else`).toBe(false);
      }
      const overflow = await page.evaluate((sel) => {
        const dlg = document.querySelector(sel);
        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, dialog: dlg ? dlg.scrollWidth - dlg.clientWidth : 0 };
      }, '[role="dialog"]');
      expect(overflow.page, `${who.givenName}: the page does not scroll sideways`).toBeLessThanOrEqual(0);
      expect(overflow.dialog, `${who.givenName}: the launcher does not scroll sideways`).toBeLessThanOrEqual(0);
      await closeLauncher(page);
    }
  });

  test('AC-7 The launcher is made of kit parts only: every element and class in it is in the design system "Modules" kit screens (Modules, Modules (phone))', async ({ page, signIn, cognito, modules }, testInfo) => {
    noBackendOnly();
    const web = join(__dirname, '..', '..');
    // The kit file for the ref the app is synced to (npm run parity:kit fetches it; nobody types a kit file).
    execFileSync('npm', ['run', 'parity:kit'], { cwd: web, timeout: 5 * 60_000, stdio: 'pipe' });
    const ref = JSON.parse(readFileSync(join(web, 'src', 'styles', 'design-system', 'sync.json'), 'utf8')).ref as string;
    const dir = join(web, 'e2e', 'parity', '.kit', ref);
    expect(existsSync(join(dir, 'modules.html')), 'the design system has a kit file ui_kits/modules.html at the app\'s synced ref').toBe(true);
    const kit = readFileSync(join(dir, 'modules.html'), 'utf8');
    const screenName = PHONE(testInfo.project.name) ? 'Modules (phone)' : 'Modules';
    for (const s of ['Modules', 'Modules (phone)']) expect(kit, `the kit has the screen "${s}"`).toContain(`data-screen="${s}"`);
    const open = kit.indexOf(`<section data-screen="${screenName}"`);
    const fragment = kit.slice(open, kit.indexOf('</section>', open));
    expect(/<section data-screen="Modules \(phone\)"[^>]*data-device="phone"/.test(kit), 'the phone screen is marked data-device="phone", as the other kits').toBe(true);
    // The kit shows the other states on further screens of the same file ("Modules, other states"): all of its screens are kit parts.
    const kitClasses = new Set([...kit.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/)).filter(Boolean));
    const kitTags = new Set([...kit.matchAll(/<([a-z][a-z0-9-]*)[\s>]/g)].map((m) => m[1]!));
    expect(fragment.length, 'the screen has content').toBeGreaterThan(50);

    await enter(page, signIn, cognito, modules, WHO.hrB);
    await answered(page, modules, 1);
    await openLauncher(page);
    const built = await dialog(page).evaluate((root) => {
      const els = [root, ...root.querySelectorAll('*')];
      return {
        classes: [...new Set(els.flatMap((e) => (typeof e.className === 'string' ? e.className : (e as SVGElement).getAttribute('class') ?? '').split(/\s+/)).filter(Boolean))],
        tags: [...new Set(els.map((e) => e.tagName.toLowerCase()))],
      };
    });
    const foreignClasses = built.classes.filter((c) => !c.startsWith('pp-') && !kitClasses.has(c) && c !== 'lucide' && !/^ng-/.test(c) && !/^cdk-/.test(c));
    expect(foreignClasses, 'every class in the launcher is a design system class or one the kit screen itself uses').toEqual([]);
    const notKit = built.classes.filter((c) => c.startsWith('pp-') && !kitClasses.has(c) && !/^pp-(popup|drawer|card|icon-tile|lozenge|button)/.test(c));
    expect(notKit, 'every pp- class in the launcher is in the kit screen (or is the popup, drawer, card, icon tile, lozenge or button part)').toEqual([]);
    const foreignTags = built.tags.filter((t) => t.includes('-') && !t.startsWith('pp-') && !kitTags.has(t));
    expect(foreignTags, 'every custom element in the launcher is a pp- part').toEqual([]);
    const styleAttrs = await dialog(page).evaluate((root) => [...root.querySelectorAll('[style]')].map((e) => e.getAttribute('style')));
    expect(styleAttrs.filter((s) => s && !/^(--[\w-]+:[^;]*;?\s*)+$/.test(s)), 'no inline styling inside the launcher (kit parts, no kit CSS)').toEqual([]);
    // No new component and no kit CSS in the app: the app's synced stylesheet is the design system's own.
    const sync = JSON.parse(readFileSync(join(web, 'src', 'styles', 'design-system', 'sync.json'), 'utf8')).files as Record<string, string>;
    expect(Object.keys(sync), 'the synced design system files are the same set').toContain('components.css');
    const srcFiles = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? srcFiles(join(d, e.name)) : [join(d, e.name)]));
    const launcherAll = srcFiles(join(web, 'src', 'app')).filter((f) => /launcher/i.test(f));
    expect(launcherAll.filter((f) => /\.(css|scss)$/.test(f)), 'the launcher has no stylesheet of its own').toEqual([]);
    const withStyles = launcherAll.filter((f) => /\.ts$/.test(f) && /\b(styles|styleUrls?)\s*:/.test(readFileSync(f, 'utf8')));
    expect(withStyles, 'and no styles: or styleUrl: in a launcher component').toEqual([]);
    void desktopOnly;
  });

  test('AC-8 @pepla-dev HR of the founding company opens the launcher and sees Hire and Onboard open; a company with Recruitment off sees Hire Not switched on', async ({ page, signIn, cognito, modules, hr }) => {
    const seen = async (): Promise<Tile[]> => {
      await expect(page).toHaveURL('/hr');
      await expect.poll(async () => (await trigger(page).count()) > 0, { message: 'the Modules button is in the top bar' }).toBe(true);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await openLauncher(page);
      return readTiles(page);
    };
    await signIn.open();
    await signIn.signInAs(hr as Login);
    const founding = await seen();
    expect(stateOf(founding, 'hire'), 'the founding company has Recruitment: Hire is open').toBe('open');
    expect(stateOf(founding, 'onboard'), 'and Onboarding: Onboard is open').toBe('open');
    expect(stateOf(founding, 'records')).toBe('open');
    await forgetSignIn(page);

    const envEmail = process.env['E2E_B_HR_EMAIL'];
    const envPassword = process.env['E2E_B_HR_PASSWORD'];
    if (ON_DEV && !(envEmail && envPassword)) {
      test.info().annotations.push({ type: 'note', description: 'E2E_B_HR_EMAIL and E2E_B_HR_PASSWORD (MOD-01\'s seeded company B HR login) are not set: the company B part did not run.' });
      return;
    }
    if (ON_DEV) {
      await signIn.open();
      await signIn.signInAs({ email: envEmail!, password: envPassword! });
    } else {
      await signInAs(page, signIn, cognito, modules, WHO.hrB);
    }
    const companyB = await seen();
    expect(stateOf(companyB, 'hire'), 'a company with Recruitment off: Hire is Not switched on').toBe('not-on');
    expect(stateOf(companyB, 'onboard'), 'it has Onboarding: Onboard is open').toBe('open');
  });
});

void MODULE_KEY;
