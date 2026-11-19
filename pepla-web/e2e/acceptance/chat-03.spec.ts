import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { CognitoFake, FakeAccount } from './support/cognito-fake';
import { EmployeesFake } from './support/employees-fake';
import { FAKE, ON_DEV, avatarButton, expect, expectAnnounced, expectNoSession, test as base, type SignInPage } from './support/fixtures';
import { forgetSignIn } from './support/sign-in-again';
import { AdminSwitchFake, FAILING_READS, FAILING_WRITES, MODULES_PATH, SERVER_WORDS, SWITCH_PATH, type ApiCall, type Company } from './support/chat-03/admin-fake';
import { navHeadings, navItems, openNav } from './support/mod-02/shell-snapshot';

/**
 * CHAT-03 · The admin screen where a company admin turns Ask Batsi on or off (front end only).
 * Spec: /mnt/project-files/ask-batsi-chat/CHAT-03-admin-switch.md (AC-1 to AC-13, conditions C-1 to C-11) with the answers to
 * CHAT-03-04-ORDER-AND-QUESTIONS.md taken as recommended (Q-3 no confirm step, Q-6 two minutes accepted, Q-7 landing taken = C-7,
 * Q-8 W-A1 to W-A4 as proposed). Notes and the choices these tests fix where the card is silent: cards/chat-03.md.
 *
 * The backend of the switch is pinned by CHAT-02's lock (chat-02.spec.ts AC-21, AC-22). Here the API is a stand-in in the browser
 * (support/chat-03/admin-fake.ts), built from that contract. No test calls AWS, Bedrock or any paid AI service.
 * Every criterion runs at 1280 and 390 wide, in the no-backend run only: the real PUT with a dev admin is judged by a person on pepla-dev.
 *
 * Added by the verifier (the card is silent, cards/chat-03.md D-1): AC-14, an `admin` with no other group must be able to sign in, because
 * today the sign-in refuses anyone who is neither `hr_staff` nor `employee`, so the person this card is for cannot reach the screen at all.
 * AC-15, the "batsi" rule for the signed-in app and no stored state.
 */

type Fixtures = { api: AdminSwitchFake | null; list: EmployeesFake | null };

const test = base.extend<Fixtures>({
  // HR home reads the employees list; answering it keeps the HR pages quiet. Add-only: no earlier route.
  list: [
    async ({ context, baseURL }, use) => {
      if (ON_DEV) return use(null);
      const fake = new EmployeesFake(new URL(baseURL!).origin);
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
  api: [
    async ({ context, baseURL, cognito }, use) => {
      if (ON_DEV) return use(null);
      const fake = new AdminSwitchFake(new URL(baseURL!).origin, (email) => cognito!.subOf(email));
      await fake.install(context);
      await use(fake);
    },
    { auto: true },
  ],
});

test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the fake company API.');

const desktopOnly = (name: string) => test.skip(name !== 'desktop-1280', 'Runs once: it reads source files, it has no screen width.');

// ---------------------------------------------------------------- the words (words.json P28 to P35, card PROPOSED table W-A1 to W-A4, kit ask-batsi-admin.html)

const SCREEN = '/admin/ask-batsi';
const W = {
  title: 'Ask Batsi', // P28: page title and card title
  description: 'Turn Ask Batsi on or off for your company.', // P29
  label: 'Use Ask Batsi', // P30
  off: 'Off. HR staff do not see the Ask Batsi button.', // P31
  who: 'Who can use it', // P32
  whoValue: 'HR staff', // P33
  past: 'Past chats', // P34
  pastValue: 'Kept until the person deletes them.', // P35
  on: 'On. HR staff see the Ask Batsi button.', // W-A1
  loadFail: 'We could not load this setting. Try again.', // W-A2
  saveFail: 'We could not save your change. Try again.', // W-A3
  saved: 'Saved.', // W-A4
};
/** Every string the settled screen may show inside the page: the sentences above and the kit's own (breadcrumb, table head and caption, buttons). */
const MAIN_WORDS = new Set([
  ...Object.values(W),
  'Workspace', 'Setting', 'Value', 'What Ask Batsi does for your company', 'Save changes', 'Try again',
]);
const NO_ACCESS = "This account can't use Naleko People yet. Ask your HR team.";

// ---------------------------------------------------------------- the people

const PASSWORD = 'winter-protea-2026';
type Who = FakeAccount & { company: Company; password: string; lands: string };
const person = (p: Omit<Who, 'password'>): Who => ({ ...p, password: PASSWORD });
const SUNBIRD = 'sunbird-bakery.co.za';

const WHO = {
  adminA: person({ email: `nomsa.dlamini@${SUNBIRD}`, givenName: 'Nomsa', familyName: 'Dlamini', groups: ['admin'], company: 'A', lands: SCREEN }),
  adminA2: person({ email: `mpho.ndaba@${SUNBIRD}`, givenName: 'Mpho', familyName: 'Ndaba', groups: ['admin'], company: 'A', lands: SCREEN }),
  adminB: person({ email: `lerato.molefe@${SUNBIRD}`, givenName: 'Lerato', familyName: 'Molefe', groups: ['admin'], company: 'B', lands: SCREEN }),
  adminHrA: person({ email: `thandi.dube@${SUNBIRD}`, givenName: 'Thandi', familyName: 'Dube', groups: ['admin', 'hr_staff'], company: 'A', lands: '/hr' }),
  adminTicksA: person({ email: `anele.khoza@${SUNBIRD}`, givenName: 'Anele', familyName: 'Khoza', groups: ['admin', 'perm-it', 'perm-approve-offers'], company: 'A', lands: SCREEN }),
  hrA: person({ ...FAKE.hr, company: 'A', lands: '/hr' }),
  hrB: person({ email: `pieter.vanwyk@${SUNBIRD}`, givenName: 'Pieter', familyName: 'van Wyk', groups: ['hr_staff'], company: 'B', lands: '/hr' }),
  hrTickA: person({ email: `sipho.zulu@${SUNBIRD}`, givenName: 'Sipho', familyName: 'Zulu', groups: ['hr_staff', 'perm-recruitment'], company: 'A', lands: '/hr' }),
  empA: person({ ...FAKE.employee, company: 'A', lands: '/start' }),
  // Neither role can open the new app alone today (ONB-23). Each is paired with a role that can, so the person can sign in and the role itself is tested.
  managerEmpA: person({ email: `refilwe.sithole@${SUNBIRD}`, givenName: 'Refilwe', familyName: 'Sithole', groups: ['manager', 'employee'], company: 'A', lands: '/start' }),
  guestHrA: person({ email: `bongani.cele@${SUNBIRD}`, givenName: 'Bongani', familyName: 'Cele', groups: ['guest', 'hr_staff'], company: 'A', lands: '/hr' }),
  managerOnlyA: person({ email: `naledi.mokoena@${SUNBIRD}`, givenName: 'Naledi', familyName: 'Mokoena', groups: ['manager'], company: 'A', lands: '/sign-in' }),
  // The old admin-style groups (TalentFlow, IT). The new app gives them no role, so they must be refused like manager-only and guest-only.
  legacyTfA: person({ email: `zanele.mkhize@${SUNBIRD}`, givenName: 'Zanele', familyName: 'Mkhize', groups: ['TalentFlowAdmin'], company: 'A', lands: '/sign-in' }),
  legacyNalekoA: person({ email: `themba.sithole@${SUNBIRD}`, givenName: 'Themba', familyName: 'Sithole', groups: ['naleko-talentflow-admin'], company: 'A', lands: '/sign-in' }),
  legacyItA: person({ email: `fikile.ngwenya@${SUNBIRD}`, givenName: 'Fikile', familyName: 'Ngwenya', groups: ['ITAdmin'], company: 'A', lands: '/sign-in' }),
  guestOnlyA: person({ email: `kabelo.nkosi@${SUNBIRD}`, givenName: 'Kabelo', familyName: 'Nkosi', groups: ['guest'], company: 'A', lands: '/sign-in' }),
};

const isAdmin = (who: Who): boolean => who.groups.includes('admin');

async function signInAs(signIn: SignInPage, cognito: CognitoFake | null, api: AdminSwitchFake | null, who: Who): Promise<void> {
  if (cognito && cognito.subOf(who.email) === undefined) cognito.addAccount(who);
  api?.assign(who.email, who.company);
  await signIn.open();
  await signIn.signInAs(who);
}

const pathOf = (page: Page): string => new URL(page.url()).pathname;

/** Signs in and waits until the person is on their first page, with something drawn. */
async function enter(page: Page, signIn: SignInPage, cognito: CognitoFake | null, api: AdminSwitchFake | null, who: Who): Promise<void> {
  await signInAs(signIn, cognito, api, who);
  await expect.poll(() => pathOf(page), { message: `${who.givenName} lands on ${who.lands}` }).toBe(who.lands);
  await expect(page.locator('main h1').first()).toBeVisible();
}

/** Opens the screen by its address, as a fresh page load, and waits until a page is drawn. */
async function openScreen(page: Page): Promise<void> {
  await page.goto(SCREEN);
  await expect(page.locator('main h1').first()).toBeVisible();
}

/** Reads the app's own modules list through the test hook the app already has (cards/mod-02.md). */
const appModules = (page: Page): Promise<string[]> =>
  page.evaluate(() => ((window as unknown as { __nalekoTest?: { modules(): string[] } }).__nalekoTest?.modules() ?? ['<no hook>']));
const landing = (page: Page, roles: string[]): Promise<string> =>
  page.evaluate((r) => (window as unknown as { __nalekoTest: { landingFor(r: string[], p: string[], m: string[]): string } }).__nalekoTest.landingFor(r, [], []), roles);

/** The calls the page makes to the app's own APIs (the placeholder hosts end in .invalid): the admin screen may make two, and no others. */
function watchApi(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname.endsWith('.invalid')) seen.push(`${r.method()} ${u.pathname}`);
  });
  return seen;
}
const ADMIN_CALLS = [`GET ${MODULES_PATH}`, `PUT ${SWITCH_PATH}`];

// ---------------------------------------------------------------- what is on the screen

const mainOf = (page: Page): Locator => page.locator('main');
const toggle = (page: Page): Locator => page.getByRole('switch', { name: /^Use Ask Batsi/ });
const saveButton = (page: Page): Locator => page.getByRole('button', { name: 'Save changes', exact: true });
const tryAgain = (page: Page): Locator => page.getByRole('button', { name: 'Try again', exact: true });
const said = (page: Page, text: string): Locator => page.getByText(text, { exact: true });

/** What is drawn inside the page, one line each. */
async function mainLines(page: Page): Promise<string[]> {
  const text = await mainOf(page).innerText();
  return text.split(/[\n\t]/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** The switch is drawn from the server's answer: on or off, with the sentence for that state, and nothing says the other. */
async function expectState(page: Page, on: boolean): Promise<void> {
  const t = toggle(page);
  await expect(t, 'the switch is usable once the setting has been read').toBeEnabled();
  if (on) await expect(t).toBeChecked();
  else await expect(t).not.toBeChecked();
  await expect(said(page, on ? W.on : W.off)).toBeVisible();
  await expect(said(page, on ? W.off : W.on)).toHaveCount(0);
}

/** A person moves the switch. (The box can sit under its label, so the click does not wait for it to be hit-testable.) */
const flip = (page: Page): Promise<void> => toggle(page).click({ force: true });

/** The PUT the card pins: exactly { enabled }, nothing else in the body or the address, no header the API does not allow (C-2). */
const BROWSER_HEADERS = /^(authorization|content-type|content-length|accept|accept-encoding|accept-language|origin|referer|user-agent|host|connection|priority|pragma|cache-control|sec-.+)$/;
function expectPut(call: ApiCall, enabled: boolean, what: string): void {
  expect(call.method, `${what}: a PUT`).toBe('PUT');
  expect(call.url.search, `${what}: no query on the address`).toBe('');
  expect(call.url.pathname.endsWith(SWITCH_PATH), `${what}: the address ends ${SWITCH_PATH} (${call.url.pathname})`).toBe(true);
  expect(call.rawBody, `${what}: the body is exactly the choice`).not.toBeNull();
  expect(JSON.parse(call.rawBody!), `${what}: body`).toEqual({ enabled });
  expect(Object.keys(JSON.parse(call.rawBody!)), `${what}: only one field`).toEqual(['enabled']);
  expect(Object.keys(call.headers).filter((h) => !BROWSER_HEADERS.test(h)), `${what}: no header other than the sign-in token and the content type (no company, no Idempotency-Key)`).toEqual([]);
  expect(call.headers['authorization'], `${what}: the sign-in token`).toMatch(/^Bearer eyJ/);
  expect(call.headers['content-type'] ?? '', `${what}: JSON`).toMatch(/json/);
}

// ================================================================ AC-1

test.describe('AC-1 Who sees Ask Batsi in the side navigation', () => {
  test('AC-1 An admin has Settings, Ask Batsi in the side navigation (an admin who is also HR sees it in the HR sidebar), and it opens the screen', async ({ page, signIn, cognito, api }) => {
    await enter(page, signIn, cognito, api, WHO.adminHrA);
    await openNav(page);
    expect(await navHeadings(page), 'the group is Settings').toContain('Settings');
    const entry = navItems(page).filter({ hasText: /^\s*Ask Batsi\s*$/ });
    await expect(entry, 'one item: Ask Batsi').toHaveCount(1);
    await expect(entry).toHaveAttribute('href', SCREEN);
    await entry.click();
    await expect.poll(() => pathOf(page)).toBe(SCREEN);
    await expect(page.getByRole('heading', { level: 1, name: W.title, exact: true })).toBeVisible();
    // Back to Today (the kit's own words) takes an admin who is also HR back to HR home.
    await openNav(page);
    const back = page.getByRole('link', { name: 'Back to Today', exact: true });
    await expect(back).toBeVisible();
    await back.click();
    await expect.poll(() => pathOf(page)).toBe('/hr');
  });

  test('AC-1 An admin with no other role sees the screen in the admin shell: Back to Today and Ask Batsi, nothing else, and the account menu signs out', async ({ page, signIn, cognito, api }) => {
    await enter(page, signIn, cognito, api, WHO.adminA);
    await openNav(page);
    const labels = await navItems(page).evaluateAll((as) => as.map((a) => (a.textContent ?? '').replace(/\s+/g, ' ').trim()));
    expect(labels.sort(), 'the admin shell holds the two links the kit names and no other (no Overview, no Users and roles: nothing is invented)').toEqual(['Ask Batsi', 'Back to Today']);
    await expect(navItems(page).filter({ hasText: /^\s*Ask Batsi\s*$/ })).toHaveAttribute('aria-current', 'page');
    for (const h of await navHeadings(page)) expect(['Workspace', 'Settings'], `heading ${h}`).toContain(h);
    // The account menu has Sign out and works.
    await page.keyboard.press('Escape');
    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await expectNoSession(page);
  });

  test('AC-1 HR, a manager with the employee role, a guest with HR, a plain employee and a signed-out visitor have no Ask Batsi entry; the address sends them to their own first page and no admin request is made', async ({ page, signIn, cognito, api }) => {
    const seen = watchApi(page);
    for (const who of [WHO.hrA, WHO.hrTickA, WHO.empA, WHO.managerEmpA, WHO.guestHrA, WHO.hrB]) {
      await forgetSignIn(page);
      await enter(page, signIn, cognito, api, who);
      await openNav(page);
      const labels = await navItems(page).evaluateAll((as) => as.map((a) => (a.textContent ?? '').replace(/\s+/g, ' ').trim()));
      expect(labels, `${who.givenName} (${who.groups}): no Ask Batsi in the sidebar`).not.toContain('Ask Batsi');
      expect(await navHeadings(page), `${who.givenName}: no Settings group`).not.toContain('Settings');
      expect(await page.locator('a[href^="/admin"]').count(), `${who.givenName}: no link to /admin anywhere`).toBe(0);
      await page.goto(SCREEN);
      await expect.poll(() => pathOf(page), { message: `${who.givenName} asks for ${SCREEN} and is sent to ${who.lands}` }).toBe(who.lands);
      await expect(page.locator('main h1').first()).toBeVisible();
      await expect(page.getByRole('switch'), `${who.givenName}: the switch is not there`).toHaveCount(0);
      await expect(saveButton(page)).toHaveCount(0);
    }
    expect(api!.calls.filter((c) => c.url.pathname.endsWith(SWITCH_PATH)), 'no request to the admin route was made for any of them').toEqual([]);
    expect(seen.filter((c) => c.startsWith('PUT')), 'no PUT at all').toEqual([]);
    // Signed out: the sign-in page, and again no admin request.
    await forgetSignIn(page);
    await page.goto(SCREEN);
    await expect(page).toHaveURL(/\/sign-in/);
    await expectNoSession(page);
    expect(api!.calls.filter((c) => c.url.pathname.endsWith(SWITCH_PATH)), 'signed out: still no request to the admin route').toEqual([]);
  });
});

// ================================================================ AC-2

test.describe('AC-2 The words', () => {
  test('AC-2 The screen shows exactly the approved words and the kit\'s own: title, breadcrumb, one card, one switch, a two-row table and Save changes, and no other string', async ({ page, signIn, cognito, api }, testInfo) => {
    await enter(page, signIn, cognito, api, WHO.adminA);
    await expectState(page, false);
    await expect(page, 'the tab title').toHaveTitle('Ask Batsi · Naleko People');
    // Page header: breadcrumb Workspace / Ask Batsi, one h1, the description.
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs).toBeVisible();
    // (The design system hides the breadcrumb on a phone, so it is checked as present, not as seen.)
    await expect(crumbs.getByText('Workspace', { exact: true })).toHaveCount(1);
    await expect(crumbs.getByText(W.title, { exact: true }), 'the last crumb is the page').toHaveCount(1);
    expect(await crumbs.locator('li').evaluateAll((l) => l.map((x) => (x.textContent ?? '').trim()))).toEqual(['Workspace', 'Ask Batsi']);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: W.title, exact: true })).toBeVisible();
    await expect(said(page, W.description)).toBeVisible();
    // One card titled Ask Batsi with the switch (P30) and its sentence (P31).
    await expect(page.getByRole('heading', { level: 2, name: W.title, exact: true }), 'the card title is P28 too').toHaveCount(1);
    await expect(toggle(page)).toHaveAccessibleName(new RegExp(`^${W.label}`));
    await expect(toggle(page)).toHaveAccessibleDescription(W.off);
    await expect(page.getByRole('switch'), 'one switch, nothing else to change (C-11)').toHaveCount(1);
    // A read-only table: who can use it, past chats.
    const table = page.getByRole('table');
    await expect(table).toHaveCount(1);
    await expect(table.getByRole('row').filter({ hasText: W.who })).toContainText(W.whoValue);
    await expect(table.getByRole('row').filter({ hasText: W.past })).toContainText(W.pastValue);
    await expect(table.getByRole('row').filter({ hasText: W.who }), 'the table is read only').not.toHaveText(/Edit|Change/);
    expect(await table.locator('input, select, textarea, button').count(), 'no control in the table').toBe(0);
    // The only buttons in the page: Save changes. Only one field: the switch (no per-user list, no history, no quota, no model choice).
    expect(await mainOf(page).getByRole('button').evaluateAll((bs) => bs.map((b) => (b.textContent ?? '').trim())), 'one button').toEqual(['Save changes']);
    expect(await mainOf(page).locator('input:not([type="checkbox"]), select, textarea').count(), 'no other field').toBe(0);
    // Every line in the page is one of the allowed strings (C-6). A model name, "Masked" and "pepla" are never there.
    const lines = await mainLines(page);
    expect(lines.filter((l) => !MAIN_WORDS.has(l)), 'strings in the page that are not approved words').toEqual([]);
    for (const must of [W.title, W.description, W.label, W.off, W.who, W.whoValue, W.past, W.pastValue, 'Save changes', ...(testInfo.project.name === 'phone-390' ? [] : ['Workspace'])]) expect(lines, `the page says "${must}"`).toContain(must);
    const everything = await page.evaluate(() => `${document.title}\n${document.body.innerText}\n${[...document.querySelectorAll('meta')].map((m) => m.getAttribute('content') ?? '').join('\n')}\n${[...document.querySelectorAll('[aria-label],[title],[alt]')].map((e) => `${e.getAttribute('aria-label')} ${e.getAttribute('title')} ${e.getAttribute('alt')}`).join('\n')}`);
    for (const bad of [/pepla/i, /masked/i, /claude|anthropic|sonnet|opus|haiku|bedrock/i]) expect(everything, `no ${bad} anywhere on the page`).not.toMatch(bad);
  });

  test('AC-2 With Ask Batsi on, saved, and with each error, the page still holds only approved words', async ({ page, signIn, cognito, api }) => {
    await enter(page, signIn, cognito, api, WHO.adminA);
    await expectState(page, false);
    // Saved, on.
    await flip(page);
    await saveButton(page).click();
    await expect(said(page, W.saved)).toBeVisible();
    await expectState(page, true);
    expect((await mainLines(page)).filter((l) => !MAIN_WORDS.has(l)), 'on and saved').toEqual([]);
    // A failed save.
    await flip(page);
    api!.writeMode = 'server-error';
    await saveButton(page).click();
    await expect(said(page, W.saveFail)).toBeVisible();
    expect((await mainLines(page)).filter((l) => !MAIN_WORDS.has(l)), 'save failed').toEqual([]);
    // A failed read.
    api!.writeMode = 'ok';
    api!.readMode = 'server-error';
    await page.goto(SCREEN);
    await expect(said(page, W.loadFail)).toBeVisible();
    expect((await mainLines(page)).filter((l) => !MAIN_WORDS.has(l)), 'read failed').toEqual([]);
  });
});

// ================================================================ AC-3, AC-4

test.describe('AC-3 and AC-4 Turning it on and off', () => {
  test('AC-3 A company with Ask Batsi off: the switch is off with the off sentence, Save is not offered until the switch moves, then one PUT { enabled: true } and the on sentence and Saved. show; the modules are read again', async ({ page, signIn, cognito, api }) => {
    const seen = watchApi(page); // from before the sign-in: the shell must not call an HR service while it draws
    await enter(page, signIn, cognito, api, WHO.adminA);
    await expectState(page, false);
    await expect(saveButton(page), 'nothing to save yet').toBeDisabled();
    const readsBefore = api!.reads().length;
    await flip(page);
    await expect(toggle(page)).toBeChecked();
    await expect(saveButton(page)).toBeEnabled();
    expect(api!.writes(), 'moving the switch saves nothing').toHaveLength(0);
    // The sentence states a fact about the company, so it follows the saved state, not the unsaved switch.
    await expect(said(page, W.off), 'before Save the off sentence still shows').toBeVisible();
    await expect(said(page, W.on), 'before Save nothing says on').toHaveCount(0);
    expect(api!.has('A')).toBe(false);
    await saveButton(page).click();
    await expect(said(page, W.saved), 'Saved. shows under the button').toBeVisible();
    await expectAnnounced(page, W.saved);
    await expectState(page, true);
    expect(api!.writes(), 'one PUT').toHaveLength(1);
    expectPut(api!.writes()[0]!, true, 'turn on');
    expect(api!.has('A'), 'the company now has it').toBe(true);
    expect(api!.has('B'), 'nobody else is touched').toBe(false);
    await expect.poll(() => api!.reads().length, { message: 'GET /v1/company/modules is read again after the save' }).toBeGreaterThan(readsBefore);
    await expect.poll(() => appModules(page), { message: 'the app\'s own list of modules follows at once (the admin\'s nav and the top bar button read it)' }).toContain('ask_batsi');
    await expect(saveButton(page), 'saved: nothing left to save').toBeDisabled();
    // C-1: an admin with no other role never touches an HR service.
    expect(seen.filter((c) => !ADMIN_CALLS.includes(c)), 'the admin screen calls only the modules read and the save').toEqual([]);
  });

  test('AC-4 Turning it off: one PUT { enabled: false }, no confirm step of any kind, the off sentence and Saved. show', async ({ page, signIn, cognito, api }) => {
    api!.state.A = [...api!.state.A, 'ask_batsi'];
    await enter(page, signIn, cognito, api, WHO.adminA);
    const dialogs: string[] = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
    await expectState(page, true);
    await flip(page);
    await expect(toggle(page)).not.toBeChecked();
    await saveButton(page).click();
    await expect(page.getByRole('dialog'), 'no confirm dialog').toHaveCount(0);
    await expect(page.getByRole('alertdialog'), 'no alert dialog').toHaveCount(0);
    await expect(said(page, W.saved)).toBeVisible();
    await expectState(page, false);
    expect(dialogs, 'no browser confirm').toEqual([]);
    expect(api!.writes(), 'one PUT').toHaveLength(1);
    expectPut(api!.writes()[0]!, false, 'turn off');
    expect(api!.has('A')).toBe(false);
    expect(api!.state.A, 'the other modules are untouched').toEqual(['onboarding', 'recruitment']);
    await expect.poll(() => appModules(page)).not.toContain('ask_batsi');
  });
});

// ================================================================ AC-5

test.describe('AC-5 What the screen shows when it opens', () => {
  test('AC-5 It shows the company\'s setting from the server: on when the list holds ask_batsi (among other keys, any order), off when it does not (so the founding company with no attribute is off)', async ({ page, signIn, cognito, api }) => {
    // Company A, the founding company: onboarding and recruitment and no ask_batsi at all.
    await enter(page, signIn, cognito, api, WHO.adminA);
    await expectState(page, false);
    // Company A with it on and other keys beside it.
    api!.state.A = ['recruitment', 'ask_batsi', 'onboarding'];
    await page.goto(SCREEN);
    await expectState(page, true);
    // Company B, only ask_batsi.
    await forgetSignIn(page);
    api!.state.B = ['ask_batsi'];
    await enter(page, signIn, cognito, api, WHO.adminB);
    await expectState(page, true);
    // Company B with another module and no ask_batsi.
    api!.state.B = ['onboarding'];
    await page.goto(SCREEN);
    await expectState(page, false);
    // A list that names a similar key is not the key.
    api!.state.B = ['onboarding', 'ask_batsi_beta', 'ask-batsi'];
    await page.goto(SCREEN);
    await expectState(page, false);
  });
});

// ================================================================ AC-6, AC-7, AC-8

test.describe('AC-6 to AC-8 Failures and double presses', () => {
  test('AC-6 Until the setting has been read, and when the read fails, the switch is disabled, nothing says on or off, the error and Try again show, and Try again reads again', async ({ page, signIn, cognito, api }) => {
    await enter(page, signIn, cognito, api, WHO.adminA);
    // Before the answer comes.
    api!.readMode = 'hold';
    await page.goto(SCREEN);
    await expect(toggle(page)).toBeDisabled();
    await expect(said(page, W.off)).toHaveCount(0);
    await expect(said(page, W.on)).toHaveCount(0);
    await expect(saveButton(page)).toBeDisabled();
    api!.release();
    await expectState(page, false);
    // Every kind of failed read.
    for (const mode of FAILING_READS) {
      api!.readMode = mode;
      const before = api!.reads().length;
      await page.goto(SCREEN);
      await expect(said(page, W.loadFail), `${mode}: the error`).toBeVisible();
      await expectAnnounced(page, W.loadFail);
      await expect(tryAgain(page), `${mode}: Try again`).toBeVisible();
      await expect(toggle(page), `${mode}: the switch cannot be used`).toBeDisabled();
      await expect(said(page, W.off), `${mode}: it does not say off`).toHaveCount(0);
      await expect(said(page, W.on), `${mode}: it does not say on`).toHaveCount(0);
      await expect(saveButton(page), `${mode}: nothing to save`).toBeDisabled();
      expect((await mainLines(page)).filter((l) => !MAIN_WORDS.has(l)), `${mode}: only approved words, no status or server text`).toEqual([]);
      expect(api!.writes(), `${mode}: no save`).toHaveLength(0);
      // Try again asks again; with the server back it shows the true state.
      const afterOpen = api!.reads().length;
      expect(afterOpen, `${mode}: the page asked`).toBeGreaterThan(before);
      api!.readMode = 'ok';
      await tryAgain(page).click();
      await expectState(page, false);
      await expect(said(page, W.loadFail), `${mode}: the error is gone`).toHaveCount(0);
      expect(api!.reads().length, `${mode}: Try again read again`).toBeGreaterThan(afterOpen);
    }
  });

  test('AC-7 A save that fails (500, 403, 404, offline): the switch goes back to the saved state, the save error shows, no status or server text, nothing but { enabled } was sent, and a second attempt works', async ({ page, signIn, cognito, api }) => {
    await enter(page, signIn, cognito, api, WHO.adminA);
    await expectState(page, false);
    for (const mode of FAILING_WRITES) {
      await flip(page);
      await expect(toggle(page)).toBeChecked();
      api!.writeMode = mode;
      const before = api!.writes().length;
      await saveButton(page).click();
      await expect(said(page, W.saveFail), `${mode}: the error`).toBeVisible();
      await expectAnnounced(page, W.saveFail);
      await expect(toggle(page), `${mode}: back to the saved state`).not.toBeChecked();
      await expect(said(page, W.off), `${mode}: the off sentence again`).toBeVisible();
      await expect(said(page, W.on), `${mode}: nothing claims it saved`).toHaveCount(0);
      await expect(said(page, W.saved), `${mode}: not Saved.`).toHaveCount(0);
      const text = await page.evaluate(() => document.body.innerText);
      expect(text, `${mode}: no status code on screen`).not.toMatch(/\b(401|403|404|500|502)\b/);
      for (const word of SERVER_WORDS) expect(text, `${mode}: no server text ("${word}")`).not.toContain(word);
      expect(page.url(), `${mode}: still on the screen`).toContain(SCREEN);
      expect(api!.has('A'), `${mode}: nothing was saved`).toBe(false);
      expect(api!.writes().length, `${mode}: the save was tried once`).toBe(before + 1);
      expectPut(api!.writes().at(-1)!, true, `${mode}: the attempt`);
      expect(api!.writes().filter((w) => w.rawBody !== '{"enabled":true}' && w.rawBody !== '{"enabled":false}'), `${mode}: only { enabled } on any attempt`).toEqual([]);
      await expect(saveButton(page), `${mode}: nothing to save again until the switch moves`).toBeDisabled();
    }
    // A second attempt works.
    api!.writeMode = 'ok';
    await flip(page);
    await saveButton(page).click();
    await expect(said(page, W.saved)).toBeVisible();
    await expect(said(page, W.saveFail), 'the error is gone').toHaveCount(0);
    await expectState(page, true);
    expect(api!.has('A')).toBe(true);
  });

  test('AC-8 A double press sends one request while it is busy; after the answer the button works again', async ({ page, signIn, cognito, api }) => {
    await enter(page, signIn, cognito, api, WHO.adminA);
    await expectState(page, false);
    await flip(page);
    api!.writeMode = 'hold';
    await saveButton(page).dblclick();
    await page.keyboard.press('Enter');
    await expect.poll(() => api!.writes().length, { message: 'the request went' }).toBe(1);
    await page.waitForTimeout(600);
    expect(api!.writes(), 'a second press while busy sends nothing').toHaveLength(1);
    api!.release();
    await expect(said(page, W.saved)).toBeVisible();
    await expectState(page, true);
    expect(api!.writes(), 'still one request after the answer').toHaveLength(1);
    // Works again: turn it off and save.
    await flip(page);
    await expect(saveButton(page)).toBeEnabled();
    await saveButton(page).click();
    await expect.poll(() => api!.writes().length).toBe(2);
    expectPut(api!.writes()[1]!, false, 'the second save');
    await expect(said(page, W.saved)).toBeVisible();
    await expectState(page, false);
  });
});

// ================================================================ AC-9

test.describe('AC-9 The state is the server\'s, and the company is the sign-in\'s', () => {
  test('AC-9 After a save, a second admin of the same company sees the new state on a fresh page load; an admin of another company is not touched; nothing is kept in the browser', async ({ page, signIn, cognito, api }) => {
    await enter(page, signIn, cognito, api, WHO.adminA);
    await expectState(page, false);
    await flip(page);
    await saveButton(page).click();
    await expect(said(page, W.saved)).toBeVisible();
    expect(api!.wrote, 'the save was made for company A by Nomsa').toEqual([{ company: 'A', enabled: true, by: cognito!.subOf(WHO.adminA.email) }]);
    // A fresh page load shows the server's state.
    await page.reload();
    await expectState(page, true);
    // Nothing about the switch is kept where the browser stores things (the app never reads it from there).
    const stored = await page.evaluate(() => [localStorage, sessionStorage].map((s) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`).join('\n')).join('\n'));
    expect(stored, 'no switch state in local or session storage').not.toMatch(/ask[_-]?batsi|"enabled"|enabled=/i);
    // The server changes under the open session (someone else turned it off): the next load shows the server's answer, whatever this browser saw before.
    api!.state.A = api!.state.A.filter((m) => m !== 'ask_batsi');
    await page.reload();
    await expectState(page, false);
    api!.state.A = [...api!.state.A, 'ask_batsi'];
    // A second admin of company A.
    await forgetSignIn(page);
    await enter(page, signIn, cognito, api, WHO.adminA2);
    await expectState(page, true);
    // An admin of company B: B is off and stays off.
    await forgetSignIn(page);
    await enter(page, signIn, cognito, api, WHO.adminB);
    await expectState(page, false);
    expect(api!.has('B')).toBe(false);
    await flip(page);
    await saveButton(page).click();
    await expect(said(page, W.saved)).toBeVisible();
    expect(api!.wrote.at(-1), 'B\'s admin changed B').toEqual({ company: 'B', enabled: true, by: cognito!.subOf(WHO.adminB.email) });
    expect(api!.state.A, 'company A is as it was').toEqual(['onboarding', 'recruitment', 'ask_batsi']);
    expectPut(api!.writes().at(-1)!, true, 'company B\'s save');
    for (const w of api!.writes()) {
      expect(w.rawBody, `no company in any body (${w.company})`).toBe('{"enabled":true}');
      expect(w.url.search + w.url.pathname, 'no company in the address').not.toMatch(/tenant|company_id|ten_|\bA\b|\bB\b/i);
    }
    // Someone else turns A off at the server: the next fresh load shows it.
    api!.state.A = api!.state.A.filter((m) => m !== 'ask_batsi');
    await forgetSignIn(page);
    await enter(page, signIn, cognito, api, WHO.adminA);
    await expectState(page, false);
  });
});

test.describe('AC-9 Opening the screen from inside the app', () => {
  test('AC-9 Opening the screen from the sidebar reads the setting again, so a change made elsewhere shows at once', async ({ page, signIn, cognito, api }) => {
    await enter(page, signIn, cognito, api, WHO.adminHrA); // /hr: the shell has just read the modules
    await expect.poll(() => api!.reads().length).toBeGreaterThan(0);
    api!.state.A = [...api!.state.A, 'ask_batsi']; // another admin turned it on a moment ago
    const before = api!.reads().length;
    await openNav(page);
    await navItems(page).filter({ hasText: /^\s*Ask Batsi\s*$/ }).click();
    await expect.poll(() => pathOf(page)).toBe(SCREEN);
    await expectState(page, true);
    expect(api!.reads().length, 'the screen read the modules on open').toBeGreaterThan(before);
  });
});

// ================================================================ AC-10, AC-11

test.describe('AC-10 and AC-11 The screen at 1280 and 390 wide, and with Reduce motion', () => {
  test('AC-10 Every heading, the switch, the table and Save are visible and not under the top bar; the table stacks on a phone; nothing scrolls sideways', async ({ page, signIn, cognito, api }, testInfo) => {
    await enter(page, signIn, cognito, api, WHO.adminA);
    await expectState(page, false);
    const width = testInfo.project.name === 'phone-390' ? 390 : 1280;
    const topBar = await page.locator('pp-top-navigation').boundingBox();
    expect(topBar, 'a top bar').not.toBeNull();
    const parts: Array<[string, Locator]> = [
      ['the page title', page.getByRole('heading', { level: 1, name: W.title, exact: true })],
      ['the description', said(page, W.description)],
      ['the card title', page.getByRole('heading', { level: 2, name: W.title, exact: true })],
      ['the switch', toggle(page)],
      ['its sentence', said(page, W.off)],
      ['the table', page.getByRole('table')],
      ['Save changes', saveButton(page)],
    ];
    for (const [name, loc] of parts) {
      await loc.scrollIntoViewIfNeeded();
      await expect(loc, `${name} is visible`).toBeVisible();
      const box = (await loc.boundingBox())!;
      expect(box.y, `${name} is not under the top bar`).toBeGreaterThanOrEqual(topBar!.y + topBar!.height - 1);
      expect(box.x, `${name} starts on the screen`).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width, `${name} ends on the screen`).toBeLessThanOrEqual(width + 1);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, 'no sideways scroll').toBeLessThanOrEqual(0);
    // The table: the kit's stacked table. Side by side on a desktop, one above the other on a phone.
    await expect(page.getByRole('table')).toHaveClass(/pp-table--stack/);
    const rows = await page.getByRole('table').locator('tbody tr').evaluateAll((trs) =>
      trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => { const r = td.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })));
    expect(rows).toHaveLength(2);
    for (const [label, value] of rows) {
      if (width === 390) expect(value!.y, 'phone: the value sits under its label').toBeGreaterThanOrEqual(label!.y + label!.h - 1);
      else expect(value!.x, 'desktop: the value sits beside its label').toBeGreaterThan(label!.x + label!.w - 1);
    }
  });

  test('AC-11 With Reduce motion on the page works and the state change is visible without motion', async ({ page, signIn, cognito, api }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enter(page, signIn, cognito, api, WHO.adminA);
    await expectState(page, false);
    await flip(page);
    await saveButton(page).click();
    await expect(said(page, W.saved)).toBeVisible();
    await expectState(page, true);
    await expect(toggle(page)).toHaveJSProperty('checked', true);
    await flip(page);
    await saveButton(page).click();
    await expect.poll(() => api!.writes().length).toBe(2);
    await expectState(page, false);
    // Nothing on the page runs a long animation or transition while it settles (the change shows at once).
    const moving = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && (a.effect?.getComputedTiming().duration as number) > 50).length);
    expect(moving, 'no running animation or transition over 50 ms with Reduce motion on').toBe(0);
  });
});

// ================================================================ AC-12, AC-14

test.describe('AC-12 and AC-14 The first page, and signing in as an admin', () => {
  test('AC-12 An admin who is not HR lands on the screen; an admin who is also HR keeps /hr; HR, employees and visitors are not moved; no loop for any role', async ({ page, signIn, cognito, api }) => {
    // The table the app reads (the test hook): the card's two cases and the others as today.
    await signIn.open();
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __nalekoTest?: unknown }).__nalekoTest))).toBe(true);
    const cases: Array<[string[], string]> = [
      [['admin'], SCREEN], [['admin', 'hr_staff'], '/hr'], [['hr_staff'], '/hr'], [['employee'], '/start'], [['manager'], '/sign-in'], [['guest'], '/sign-in'], [[], '/sign-in'],
    ];
    for (const [roles, want] of cases) expect(await landing(page, roles), `landing for [${roles}]`).toBe(want);

    // Real sign-ins. The admin: signing in, the sign-in page, /hr and /start all end on the screen and stay there.
    const ends = async (to: string): Promise<string> => { await page.goto(to); await expect(page.locator('main h1, h1').first()).toBeVisible(); return pathOf(page); };
    await enter(page, signIn, cognito, api, WHO.adminA);
    for (const to of ['/hr', '/hr/documents', '/start', '/sign-in', SCREEN]) expect(await ends(to), `admin asks for ${to}`).toBe(SCREEN);
    // The admin who is also HR: /hr stays, the screen is open to them, /start goes to HR home, the sign-in page goes to HR home.
    await forgetSignIn(page);
    await enter(page, signIn, cognito, api, WHO.adminHrA);
    expect(await ends('/hr'), 'admin and HR: /hr').toBe('/hr');
    expect(await ends(SCREEN), 'admin and HR: the screen').toBe(SCREEN);
    expect(await ends('/start'), 'admin and HR: /start').toBe('/hr');
    expect(await ends('/sign-in'), 'admin and HR: the sign-in page').toBe('/hr');
    // HR and employee are not moved.
    await forgetSignIn(page);
    await enter(page, signIn, cognito, api, WHO.hrA);
    expect(await ends(SCREEN), 'HR: the screen').toBe('/hr');
    expect(await ends('/hr'), 'HR: /hr').toBe('/hr');
    await forgetSignIn(page);
    await enter(page, signIn, cognito, api, WHO.empA);
    expect(await ends(SCREEN), 'employee: the screen').toBe('/start');
    expect(await ends('/hr'), 'employee: /hr').toBe('/start');
    // Signed out: the sign-in page, for the screen and for every other address, no loop.
    await forgetSignIn(page);
    for (const to of [SCREEN, '/hr', '/start']) { await page.goto(to); await expect(page).toHaveURL(/\/sign-in/); }
  });

  test('AC-14 An account whose only group is admin can sign in and lands on the screen; one whose only group is manager, guest or an old admin group (TalentFlowAdmin, naleko-talentflow-admin, ITAdmin) is still refused with the same words and keeps no session', async ({ page, signIn, cognito, api }) => {
    // The admin: no refusal, a session, the screen.
    await signInAs(signIn, cognito, api, WHO.adminA);
    await expect.poll(() => pathOf(page)).toBe(SCREEN);
    await expect(signIn.message(NO_ACCESS), 'no refusal for an admin').toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: W.title, exact: true })).toBeVisible();
    // A reload keeps the admin signed in (the session was kept).
    await page.reload();
    expect(pathOf(page)).toBe(SCREEN);
    await expect(page.getByRole('heading', { level: 1, name: W.title, exact: true })).toBeVisible();
    // Manager only, guest only: refused as today.
    for (const who of [WHO.managerOnlyA, WHO.guestOnlyA, WHO.legacyTfA, WHO.legacyNalekoA, WHO.legacyItA]) {
      await forgetSignIn(page);
      await signInAs(signIn, cognito, api, who);
      await expect(signIn.message(NO_ACCESS), `${who.groups[0]} is refused as today`).toBeVisible();
      await expect(page).toHaveURL(/\/sign-in(\?.*)?$/);
      await expectNoSession(page);
      await page.goto(SCREEN);
      await expect(page).toHaveURL(/\/sign-in/);
    }
    expect(api!.calls.filter((c) => c.url.pathname.endsWith(SWITCH_PATH)), 'no admin request for a refused account').toEqual([]);
  });
});

// ================================================================ AC-13

test.describe('AC-13 The sidebar and the route agree', () => {
  test('AC-13 For every role and every company setting, the entry is in the sidebar if and only if the route lets the person in, and it never depends on the module being on', async ({ page, signIn, cognito, api }) => {
    test.setTimeout(150_000);
    const cases: Array<[Who, boolean]> = [
      [WHO.adminA, false], [WHO.adminA, true], [WHO.adminHrA, false], [WHO.adminHrA, true], [WHO.adminTicksA, false], [WHO.adminB, false],
      [WHO.hrA, false], [WHO.hrA, true], [WHO.hrTickA, false], [WHO.hrB, false], [WHO.empA, false], [WHO.empA, true], [WHO.managerEmpA, false], [WHO.guestHrA, false],
    ];
    for (const [who, askOn] of cases) {
      api!.state.A = askOn ? ['onboarding', 'recruitment', 'ask_batsi'] : ['onboarding', 'recruitment'];
      await forgetSignIn(page);
      await enter(page, signIn, cognito, api, who);
      await openNav(page);
      const hrefs = await navItems(page).evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      const inSidebar = hrefs.includes(SCREEN);
      await page.goto(SCREEN);
      await expect(page.locator('main h1').first()).toBeVisible();
      const inRoute = pathOf(page) === SCREEN;
      const name = `${who.givenName} (${who.groups}, company ${who.company}, Ask Batsi ${askOn ? 'on' : 'off'})`;
      expect(inRoute, `${name}: the route lets them in only if they are an admin`).toBe(isAdmin(who));
      expect(inSidebar, `${name}: the sidebar has the entry if and only if the route lets them in`).toBe(inRoute);
    }
  });
});

// ================================================================ AC-15

test.describe('AC-15 The "batsi" rule and stored state', () => {
  const APP = join(__dirname, '..', '..', 'src', 'app');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

  test('AC-15 No file path and no class name in the signed-in app contains "batsi" (the public site keeps its own), and the admin code keeps no state in the browser', async ({}, testInfo) => {
    desktopOnly(testInfo.project.name);
    // The signed-in app: features (not the public site) and core. Angular's dev server writes these names into page addresses.
    const files = [...walk(join(APP, 'features')), ...walk(join(APP, 'core'))].filter((f) => f.endsWith('.ts') && !relative(APP, f).startsWith(join('features', 'public')));
    expect(files.length, 'the source tree was found').toBeGreaterThan(20);
    expect(files.filter((f) => /batsi/i.test(relative(APP, f))), 'a file path with "batsi"').toEqual([]);
    const withClass = files.filter((f) => /\bclass\s+\w*batsi\w*/i.test(readFileSync(f, 'utf8')) || /\bselector:\s*'[^']*batsi/i.test(readFileSync(f, 'utf8')));
    expect(withClass.map((f) => relative(APP, f)), 'a class or selector with "batsi" (the registry id admin-ask-batsi is the card\'s)').toEqual([]);
    // The admin code (features/admin) exists and reads no browser storage for the switch (C-3, spec point 4).
    const admin = walk(join(APP, 'features')).filter((f) => f.endsWith('.ts') && relative(APP, f).startsWith(join('features', 'admin')));
    expect(admin.length, 'the admin area exists under features/admin').toBeGreaterThan(0);
    for (const f of admin) expect(readFileSync(f, 'utf8'), `${relative(APP, f)} does not use browser storage`).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
  });

  test('AC-15 Nothing the admin page loads has "batsi" in its address (the page\'s own address, /admin/ask-batsi, is the card\'s)', async ({ page, signIn, cognito, api }) => {
    const urls: string[] = [];
    page.on('request', (r) => { if (r.resourceType() !== 'document' && !new URL(r.url()).hostname.endsWith('.invalid')) urls.push(decodeURIComponent(r.url())); });
    await enter(page, signIn, cognito, api, WHO.adminA);
    await expectState(page, false);
    await flip(page);
    await saveButton(page).click();
    await expect(said(page, W.saved)).toBeVisible();
    expect(urls.filter((u) => /batsi/i.test(u)), 'requests with "batsi" in them').toEqual([]);
  });
});
