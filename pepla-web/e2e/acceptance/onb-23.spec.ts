import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { FakeAccount } from './support/cognito-fake';
import { HR_HOME, ON_DEV, ON_SIGN_IN, expect, expectAnnounced, expectNoSession, test as base, type Login } from './support/fixtures';

/**
 * ONB-23 · Employees sign in on the same page (Jira NH-189, epic NH-150).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-23.md (NH-189).
 *
 * One sign-in page for everyone: HR lands on HR home, an employee on their own page (/start),
 * an account in neither group is refused and keeps no session. ONB-23 also changed ONB-01 AC-4 and
 * the end of ONB-01 AC-11 (onb-01.spec.ts) and ONB-17 AC-8 (onb-17.spec.ts): see ./cards/onb-23.md.
 *
 * Each test runs at 1280 and 390 wide unless it says why not. AC-7 also runs on pepla-dev.
 * Nothing here calls an AI service. These files are locked once accepted: see ./README.md.
 */

const HERE = __dirname;
const SRC = join(HERE, '..', '..', 'src');

const NO_ACCESS = "This account can't use Naleko People yet. Ask your HR team.";
const OLD_WORDS = 'This sign-in is for HR';
// ONB-05 (NH-174) replaced the holding page: /start shows the consent form, and Sign out moved into the account menu.
const CONSENT_HEADING = 'Declaration and consent';

const START = /\/start$/;
const ON_START = /\/start(\?.*)?$/;

const FAKE_PASSWORD = 'winter-protea-2026';
/** In a group the app does not know: it may not use Naleko People either. */
const OTHER_GROUP: FakeAccount = { email: 'ayanda.zulu@mokoena-logistics.co.za', givenName: 'Ayanda', familyName: 'Zulu', groups: ['contractor'] };
/** In both groups: treated as HR (spec item 1). */
const BOTH: FakeAccount = { email: 'naledi.mokoena@mokoena-logistics.co.za', givenName: 'Naledi', familyName: 'Mokoena', groups: ['employee', 'hr_staff'] };

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: AC-7 is the pepla-dev check.');

/** Every request the browser made. */
class Watch {
  readonly requests: Array<{ url: string; method: string }> = [];
  track(page: Page): void {
    page.context().on('request', (r) => this.requests.push({ url: r.url(), method: r.method() }));
  }
  /** Calls to our own APIs: anything that is not the app, Cognito or fonts. */
  apiCalls(appOrigin: string, from = 0): string[] {
    return this.requests
      .slice(from)
      .filter((r) => {
        const u = new URL(r.url);
        if (u.origin === appOrigin || !/^https?:$/.test(u.protocol)) return false;
        if (/cognito-idp\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)) return false;
        if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) return false;
        if (r.method === 'GET' && /\/v1\/company\/modules$/.test(u.pathname)) return false; // MOD-02: the shell asks which modules are on
        return r.method !== 'OPTIONS';
      })
      .map((r) => `${r.method} ${r.url}`);
  }
}

const test = base.extend<{ watch: Watch; appOrigin: string }>({
  appOrigin: async ({ baseURL }, use) => {
    await use(new URL(baseURL!).origin);
  },
  watch: async ({ page }, use) => {
    const watch = new Watch();
    watch.track(page);
    await use(watch);
  },
});

const login = (a: FakeAccount): Login => ({ email: a.email, password: FAKE_PASSWORD, givenName: a.givenName });

function welcome(page: Page, givenName: string): Locator {
  return page.getByRole('heading', { name: `Welcome, ${givenName}`, exact: true });
}

async function expectStart(page: Page, givenName: string): Promise<void> {
  await expect(page).toHaveURL(START, { timeout: 20_000 });
  await expect(welcome(page, givenName)).toBeVisible();
}

/** ONB-05: Sign out is in the "Your account" menu, as for HR. */
function accountButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Your account/ });
}
function signOutItem(page: Page): Locator {
  return page.getByRole('menuitem', { name: 'Sign out', exact: true });
}
async function signOutEmployee(page: Page): Promise<void> {
  await accountButton(page).click();
  await signOutItem(page).click();
}

/** ONB-05: the employee's page asks GET /v1/me, and nothing else. */
const notMe = (calls: string[]) => calls.filter((c) => !/^GET \S+\/v1\/me$/.test(c));

/** Every file under a folder. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

test.describe('ONB-23 Employees sign in on the same page', () => {
  // -------------------------------------------------------------- AC-1
  test('AC-1 An employee comes back, signs in at /sign-in and lands on /start; a reload stays there; no HR API is called', async ({ page, signIn, employee, watch, appOrigin }) => {
    noBackendOnly();
    await signIn.open();
    await expect(signIn.heading).toBeVisible();
    await signIn.signInAs(employee);
    await expectStart(page, employee.givenName);
    await expect(page.getByRole('heading', { name: CONSENT_HEADING, exact: true })).toBeVisible();
    await expect(signIn.message(NO_ACCESS)).toHaveCount(0);

    await page.reload();
    await expectStart(page, employee.givenName);

    expect(notMe(watch.apiCalls(appOrigin)), 'no call to an HR API (or any API of ours but GET /v1/me)').toEqual([]);
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 An employee never reaches an HR page, whatever the address or returnUrl; HR still follows returnUrl', async ({ page, signIn, cognito, employee, hr, watch, appOrigin }) => {
    noBackendOnly();

    // Signed in as the employee, every HR page lands on /start.
    await signIn.open();
    await signIn.signInAs(employee);
    await expectStart(page, employee.givenName);
    for (const path of [HR_HOME, '/hr/documents', '/hr/employees/new']) {
      await page.goto(path);
      await expect(page, `${path} lands on /start`).toHaveURL(START);
      await expect(welcome(page, employee.givenName)).toBeVisible();
    }
    // The sign-in page itself sends a signed-in employee home.
    await page.goto('/sign-in');
    await expect(page, '/sign-in lands on /start').toHaveURL(START);
    await signOutEmployee(page);
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expectNoSession(page);

    // Signing in with an HR returnUrl, or one outside the app, lands on /start.
    for (const returnUrl of ['/hr/employees/new', '/hr/documents', '/hr', '/hr?view=ac-2', '/starting', '//example.com/start', 'https://example.com/start']) {
      await page.goto(`/sign-in?returnUrl=${encodeURIComponent(returnUrl)}`);
      await expect(signIn.email).toBeVisible();
      await signIn.signInAs(employee);
      await expect(page, `employee with returnUrl=${returnUrl} lands on /start`).toHaveURL(START, { timeout: 20_000 });
      await expect(welcome(page, employee.givenName)).toBeVisible();
      await signOutEmployee(page);
      await expect(page).toHaveURL(ON_SIGN_IN);
    }

    // A returnUrl on the employee's own page is fine (kept or dropped).
    await page.goto(`/sign-in?returnUrl=${encodeURIComponent('/start?from=ac-2')}`);
    await signIn.signInAs(employee);
    await expect(page).toHaveURL(ON_START, { timeout: 20_000 });
    await expect(welcome(page, employee.givenName)).toBeVisible();
    await signOutEmployee(page);
    await expect(page).toHaveURL(ON_SIGN_IN);

    expect(notMe(watch.apiCalls(appOrigin)), 'the employee never called an HR API (only GET /v1/me)').toEqual([]);

    // HR signing in with returnUrl=/hr/documents still lands there (ONB-01 AC-9 unchanged).
    await page.goto(`/sign-in?returnUrl=${encodeURIComponent('/hr/documents')}`);
    await signIn.signInAs(hr);
    await expect(page, 'HR follows an HR returnUrl').toHaveURL(/\/hr\/documents$/, { timeout: 20_000 });
    await signOutHr(page);

    // HR never lands on the employee's page: no returnUrl, and returnUrl=/start, both land on HR home.
    for (const path of ['/sign-in', `/sign-in?returnUrl=${encodeURIComponent('/start')}`]) {
      await page.goto(path);
      await signIn.signInAs(hr);
      await expect(page, `HR from ${path} lands on HR home`).toHaveURL(new RegExp(`${HR_HOME}$`), { timeout: 20_000 });
      await expect(page.getByRole('heading', { name: `Welcome back, ${hr.givenName}`, exact: true })).toBeVisible();
      await signOutHr(page);
    }

    // Someone in both groups is treated as HR.
    cognito!.addAccount(BOTH);
    await signIn.open();
    await signIn.signInAs(login(BOTH));
    await expect(page, 'both groups: HR home').toHaveURL(new RegExp(`${HR_HOME}$`), { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: `Welcome back, ${BOTH.givenName}`, exact: true })).toBeVisible();
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 An account in neither group is refused with the new words, keeps no session, and no page opens', async ({ page, signIn, cognito, noAccess }) => {
    noBackendOnly();
    cognito!.addAccount(OTHER_GROUP);

    for (const [who, account] of [['no group', noAccess], ['an unknown group', login(OTHER_GROUP)]] as const) {
      await signIn.open();
      await signIn.signInAs(account);
      await expect(signIn.message(NO_ACCESS), `${who}: the no-access words`).toBeVisible();
      await expect(page.getByText(OLD_WORDS), `${who}: never the old HR-only words`).toHaveCount(0);
      await expect(page).toHaveURL(ON_SIGN_IN);
      await expectNoSession(page);

      for (const path of [HR_HOME, '/start']) {
        await page.goto(path);
        await expect(page, `${who}: ${path} lands on /sign-in`).toHaveURL(ON_SIGN_IN);
        await expect(signIn.email).toBeVisible();
      }
      await expectNoSession(page);
    }
  });

  test('AC-3 The old HR-only words appear nowhere in pepla-web/src', async ({}, testInfo: TestInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1280', 'Reads files, not the screen: runs once, at one width.');
    const hits = walk(SRC)
      .filter((f) => /\.(ts|html|json|scss|css)$/.test(f))
      .filter((f) => readFileSync(f, 'utf8').includes(OLD_WORDS))
      .map((f) => relative(SRC, f));
    expect(hits, `"${OLD_WORDS}" is deleted from the app`).toEqual([]);
    const sayIt = walk(SRC).filter((f) => f.endsWith('.ts') && readFileSync(f, 'utf8').includes(NO_ACCESS));
    expect(sayIt.length, 'the new words live in the app source').toBeGreaterThan(0);
  });

  // -------------------------------------------------------------- AC-5
  test('AC-5 The employee signs out from /start, keeps no session, signs in again and lands on /start', async ({ page, signIn, employee }) => {
    noBackendOnly();
    await signIn.open();
    await signIn.signInAs(employee);
    await expectStart(page, employee.givenName);

    await signOutEmployee(page);
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expectNoSession(page);
    await page.goto('/start');
    await expect(page, 'signed out: /start goes to /sign-in').toHaveURL(ON_SIGN_IN);

    await signIn.open();
    await signIn.signInAs(employee);
    await expectStart(page, employee.givenName);
    await page.reload();
    await expectStart(page, employee.givenName);
  });

  // -------------------------------------------------------------- AC-6
  test('AC-6 Keyboard only: Enter signs the employee in, and the no-access message is announced', async ({ page, signIn, employee, noAccess }) => {
    noBackendOnly();
    await signIn.open();

    await signIn.email.focus();
    await page.keyboard.type(employee.email);
    await page.keyboard.press('Tab');
    await expect(signIn.password).toBeFocused();
    await page.keyboard.type(employee.password);
    await page.keyboard.press('Enter');
    await expectStart(page, employee.givenName);

    // Sign out by keyboard, from the account menu.
    await accountButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(signOutItem(page)).toBeVisible();
    await signOutItem(page).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expectNoSession(page);

    await expect(signIn.email).toBeVisible();
    await signIn.email.focus();
    await page.keyboard.type(noAccess.email);
    await page.keyboard.press('Tab');
    await page.keyboard.type(noAccess.password);
    await page.keyboard.press('Enter');
    await expectAnnounced(page, NO_ACCESS);
    await expectNoSession(page);
  });

  test('AC-6 Phone: the sign-in page, its no-access message and /start fit 390 wide, every heading and button fully on screen', async ({ page, signIn, employee, noAccess }, testInfo) => {
    noBackendOnly();
    test.skip(testInfo.project.name !== 'phone-390', 'The phone criterion: runs at 390 wide.');

    const check = async (what: string, parts: Locator[]) => {
      const viewport = page.viewportSize()!;
      const scroll = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
      expect(scroll.doc, `${what}: no sideways scroll`).toBeLessThanOrEqual(scroll.win);
      for (const part of parts) {
        await part.scrollIntoViewIfNeeded();
        await expect(part, `${what}: visible`).toBeVisible();
        const b = (await part.boundingBox())!;
        expect(b.x, `${what}: left edge on screen`).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, `${what}: right edge on screen`).toBeLessThanOrEqual(viewport.width);
        expect(b.y, `${what}: top on screen`).toBeGreaterThanOrEqual(0);
        expect(b.y + b.height, `${what}: bottom on screen`).toBeLessThanOrEqual(viewport.height);
        const onTop = await part.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 8));
          return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
        });
        expect(onTop, `${what}: nothing sits on top of it`).toBe(true);
      }
    };

    await signIn.open();
    await check('the sign-in page', [signIn.heading, signIn.email, signIn.password, signIn.submit]);

    await signIn.signInAs(noAccess);
    await expect(signIn.message(NO_ACCESS)).toBeVisible();
    await check('the no-access message', [signIn.heading, signIn.message(NO_ACCESS), signIn.submit]);

    await signIn.signInAs(employee);
    await expectStart(page, employee.givenName);
    await check('/start', [welcome(page, employee.givenName), accountButton(page)]);
  });

  // -------------------------------------------------------------- AC-7
  test('AC-7 pepla-dev: the employee test login signs in at /sign-in and lands on /start; an HR page sends it back @pepla-dev', async ({ page, signIn, employee }, testInfo) => {
    test.skip(ON_DEV && testInfo.project.name !== 'desktop-1280', 'On pepla-dev: desktop once.');
    await page.goto(`/sign-in?returnUrl=${encodeURIComponent('/hr/employees/new')}`);
    await expect(signIn.email).toBeVisible();
    await signIn.signInAs(employee);
    await expectStart(page, employee.givenName);

    await page.goto(HR_HOME);
    await expect(page).toHaveURL(START);
    await expect(welcome(page, employee.givenName)).toBeVisible();

    await signOutEmployee(page);
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expectNoSession(page);
  });
});

/** Signs HR out from the avatar menu (ONB-01 AC-10). */
async function signOutHr(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Your account/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(ON_SIGN_IN);
}
