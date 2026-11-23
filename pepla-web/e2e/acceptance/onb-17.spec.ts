import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { COGNITO_ERRORS, type FakeAccount } from './support/cognito-fake';
import { HR_HOME, ON_DEV, ON_SIGN_IN, expect, expectAnnounced, expectNoSession, test as base, type Login, type SignInPage } from './support/fixtures';
import { InviteFake, MAX_REFUSED, TOO_MANY, newToken, type Invite } from './support/onb-17/invite-fake';
import { withoutGeneratedApiTypes } from './support/generated-api-types';

/**
 * ONB-17 · Set your password, and an expired link (Jira NH-171).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-17.md (NH-171).
 *
 * The page calls two public routes that ONB-04 (NH-170) builds. Here they are answered by
 * support/onb-17/invite-fake.ts, exactly as ONB-04's spec fixes them; Cognito is the shared fake.
 * AC-11 runs on pepla-dev only, after ONB-04 and this card are both deployed there.
 *
 * Each test runs at 1280 and 390 wide unless it says why not. Nothing here calls an AI service.
 * These files are locked once accepted: see ./README.md and ./cards/onb-17.md.
 */

const HERE = __dirname;
const WEB = join(HERE, '..', '..');
const REPO = join(WEB, '..');

// ---------------------------------------------------------------- the card's words
const SET_HEADING = 'Set your password';
const BUTTON = 'Set password and continue';
const HELP = 'At least 12 characters, with an upper case letter, a lower case letter, a number and a symbol.';
const KIT_HELP = /A short sentence is easy to remember/;
const LINE = {
  minLength: 'Use at least 12 characters.',
  maxLength: 'Use 256 characters or fewer.',
  upper: 'Add an upper case letter.',
  lower: 'Add a lower case letter.',
  number: 'Add a number.',
  symbol: 'Add a symbol, such as ! or #.',
} as const;
const EMPTY = 'Enter a new password.';
const GENERAL = 'Check the password against the rules under the field.';
const ALL_LINES = [...Object.values(LINE), EMPTY, GENERAL];
const COULD_NOT = 'Could not set the password. Try again.';
const OFFLINE = "We can't reach Naleko People. Check your connection and try again.";
const SIGN_IN_FAILED = 'Your password is set, but signing in did not work. Try again.';
const EXPIRED = 'This link has expired';
// ONB-23 (NH-189): employees sign in at /sign-in too; only an account in neither group is refused.
const NO_ACCESS = "This account can't use Naleko People yet. Ask your HR team.";
// ONB-05 (NH-174) replaced the holding page: /start shows the consent form, and Sign out moved into the account menu.
const CONSENT_HEADING = 'Declaration and consent';

// ---------------------------------------------------------------- the people
const COMPANY = 'Mokoena Logistics';
const PARTNER = 'Thandeka Dlamini';
const LEAD_NAMES = `Links work once and for 7 days. ${PARTNER} at ${COMPANY} can send you a new one.`;
const LEAD_NO_NAMES = 'Links work once and for 7 days. HR at your new company can send you a new one.';
const STARTER: FakeAccount = { email: 'lerato.molefe@gmail.com', givenName: 'Lerato', familyName: 'Molefe', groups: ['employee'] };
const SECOND: FakeAccount = { email: 'sipho.ndlovu@outlook.com', givenName: 'Sipho', familyName: 'Ndlovu', groups: ['employee'] };
/** Passes every pool rule (12+, upper, lower, number, symbol). */
const GOOD_PASSWORD = 'Blue-kettle-7!';

const START = /\/start$/;
const ON_START = /\/start(\?.*)?$/;

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: AC-11 is the pepla-dev check.');
const onceOnly = (testInfo: TestInfo) => test.skip(testInfo.project.name !== 'desktop-1280', 'Reads files, not the screen: runs once, at one width.');

// ---------------------------------------------------------------- fixtures

/** Every request the browser made, every console line and page error. */
class Watch {
  readonly requests: Array<{ url: string; method: string; headers: Record<string, string>; postData: string | null }> = [];
  readonly console: string[] = [];
  private readonly pending: Promise<unknown>[] = [];

  track(page: Page): void {
    page.context().on('request', (r) => {
      const seen = { url: r.url(), method: r.method(), headers: r.headers(), postData: r.postData() };
      this.requests.push(seen);
      this.pending.push(r.allHeaders().then((h) => (seen.headers = h)).catch(() => undefined));
    });
    page.on('console', (m) => this.console.push(m.text()));
    page.on('pageerror', (e) => this.console.push(`${e.name}: ${e.message}\n${e.stack ?? ''}`));
  }

  async settled(): Promise<void> {
    await Promise.all(this.pending);
  }

  /** Calls to our own APIs (anything that is not the app, Cognito, fonts or the two invite routes), from index `from`. */
  apiCalls(appOrigin: string, from = 0): string[] {
    return this.requests
      .slice(from)
      .filter((r) => {
        const u = new URL(r.url);
        if (u.origin === appOrigin || !/^https?:$/.test(u.protocol)) return false;
        if (/cognito-idp\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)) return false;
        if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) return false;
        if (/\/v1\/invites\/(lookup|redeem)$/.test(u.pathname)) return false;
        if (r.method === 'GET' && /\/v1\/company\/modules$/.test(u.pathname)) return false; // MOD-02: the shell asks which modules are on
        return r.method !== 'OPTIONS';
      })
      .map((r) => `${r.method} ${r.url}`);
  }
}

type Fixtures = { invite: InviteFake | null; watch: Watch; appOrigin: string };

const test = base.extend<Fixtures>({
  appOrigin: async ({ baseURL }, use) => {
    await use(new URL(baseURL!).origin);
  },
  invite: async ({ context, cognito, appOrigin }, use) => {
    if (ON_DEV) return use(null);
    const fake = new InviteFake(appOrigin, cognito);
    await fake.install(context);
    await use(fake);
  },
  watch: async ({ page }, use) => {
    const w = new Watch();
    w.track(page);
    await use(w);
  },
});

function link(o: Partial<Invite> & { person?: FakeAccount } = {}): Invite {
  return { company: COMPANY, hrPartnerName: PARTNER, person: STARTER, startDate: '2026-12-01', state: 'ok', ...o };
}

/** The set-password page, found the way a person finds it: by its words. */
class SetPassword {
  readonly heading: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly help: Locator;
  readonly expired: Locator;
  readonly tryAgain: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: SET_HEADING, exact: true });
    this.email = page.getByLabel('Email', { exact: true });
    this.password = page.getByLabel('New password', { exact: true });
    this.submit = page.getByRole('button', { name: BUTTON, exact: true });
    this.help = page.getByText(HELP, { exact: true });
    this.expired = page.getByRole('heading', { name: EXPIRED, exact: true });
    this.tryAgain = page.getByRole('button', { name: 'Try again', exact: true });
  }

  /**
   * Opens the link as the email gives it, in a fresh page load: the token in the fragment. (Going
   * from one /set-password address to another by its fragment alone would not load the page again.)
   */
  async open(token: string | null): Promise<void> {
    await this.page.goto('about:blank');
    await this.page.goto(token === null ? '/set-password' : `/set-password#token=${token}`);
  }

  async openForm(token: string): Promise<void> {
    await this.open(token);
    await expect(this.heading).toBeVisible();
    await expect(this.password).toBeVisible();
  }

  async setPassword(password: string): Promise<void> {
    await this.password.fill(password);
    await this.submit.click();
  }

  message(text: string): Locator {
    return this.page.getByText(text, { exact: true });
  }

  /** The words the field is described by (aria-describedby), in order. */
  async description(): Promise<string> {
    return this.password.evaluate((el) =>
      (el.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' '),
    );
  }

  /** The field shows exactly these lines, in this order, next to it, and is invalid and described by them. */
  async expectLines(lines: string[], what: string): Promise<void> {
    for (const line of lines) await expect(this.page.getByText(line).first(), `${what}: "${line}" shows`).toBeVisible();
    for (const line of ALL_LINES.filter((l) => !lines.includes(l))) {
      await expect(this.page.getByText(line), `${what}: "${line}" does not show`).toHaveCount(0);
    }
    await expect(this.password, `${what}: the field is marked invalid`).toHaveAttribute('aria-invalid', 'true');
    const described = await this.description();
    let last = -1;
    for (const line of lines) {
      const at = described.indexOf(line);
      expect(at, `${what}: the field is described by "${line}" (described by: "${described}")`).toBeGreaterThanOrEqual(0);
      expect(at, `${what}: "${line}" comes after the line before it`).toBeGreaterThan(last);
      last = at;
    }
    // Next to the field: under the input and above the button.
    const field = (await this.password.boundingBox())!;
    const button = (await this.submit.boundingBox())!;
    for (const line of lines) {
      const b = (await this.page.getByText(line).first().boundingBox())!;
      expect(b.y, `${what}: "${line}" sits under the field`).toBeGreaterThanOrEqual(field.y + field.height - 2);
      expect(b.y + b.height, `${what}: "${line}" sits above the button`).toBeLessThanOrEqual(button.y + 2);
    }
  }
}

/** Email addresses of every sign-in token kept in the browser's storage. */
async function storedSessionEmails(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const v = store.getItem(store.key(i) ?? '') ?? '';
        const m = /^eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]*$/.exec(v);
        if (!m) continue;
        try {
          const claims = JSON.parse(atob(m[1]!.replace(/-/g, '+').replace(/_/g, '/')));
          if (typeof claims.email === 'string') out.push(claims.email);
        } catch {
          /* not a token */
        }
      }
    }
    return [...new Set(out)];
  });
}

async function everythingStored(page: Page): Promise<string> {
  const stored = await page.evaluate(() => {
    const values: string[] = [];
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i) ?? '';
        values.push(k, store.getItem(k) ?? '');
      }
    }
    values.push(document.cookie);
    return values.join('\n');
  });
  const cookies = (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join('\n');
  return `${stored}\n${cookies}`;
}

async function signInAsHr(page: Page, signIn: SignInPage, hr: Login): Promise<void> {
  await signIn.open();
  await signIn.signInAs(hr);
  await expect(page).toHaveURL(HR_HOME);
}

async function expectStart(page: Page, givenName: string): Promise<void> {
  await expect(page).toHaveURL(START, { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: `Welcome, ${givenName}`, exact: true })).toBeVisible();
}

/** ONB-05: Sign out is in the "Your account" menu, as for HR. */
async function signOutEmployee(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Your account/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
}

/** ONB-05: the employee's page asks GET /v1/me, and nothing else. */
const notMe = (calls: string[]) => calls.filter((c) => !/^GET \S+\/v1\/me$/.test(c));

async function expectExpired(sp: SetPassword, lead: string, what: string): Promise<void> {
  await expect(sp.expired, `${what}: "${EXPIRED}"`).toBeVisible();
  await expect(sp.message(lead), `${what}: the lead`).toBeVisible();
  const other = lead === LEAD_NAMES ? LEAD_NO_NAMES : LEAD_NAMES;
  await expect(sp.message(other), `${what}: not the other lead`).toHaveCount(0);
  await expect(sp.page.locator('input[type="password"]'), `${what}: no password field`).toHaveCount(0);
  await expect(sp.password, `${what}: no New password field`).toHaveCount(0);
  await expect(sp.submit, `${what}: no "${BUTTON}" button`).toHaveCount(0);
  await expect(sp.heading, `${what}: not "${SET_HEADING}"`).toHaveCount(0);
}

// ================================================================ the tests

test.describe('ONB-17 Set your password, and an expired link', () => {
  // -------------------------------------------------------------- AC-1
  test('AC-1 The page opens with the person\'s email, company, start date, the pool\'s rules and one button', async ({ page, invite }) => {
    noBackendOnly();
    const sp = new SetPassword(page);
    const token = invite!.add(link());
    await sp.openForm(token);

    await expect(page).toHaveTitle('Set your password · Naleko People');
    await expect(sp.message(`${COMPANY} · Starts 1 Dec 2026`), 'the company line').toBeVisible();

    await expect(sp.email).toBeVisible();
    await expect(sp.email).toHaveValue(STARTER.email);
    await expect(sp.email, 'the email is read-only').not.toBeEditable();
    await expect(sp.email).toHaveAttribute('autocomplete', 'username');

    await expect(sp.password).toHaveAttribute('type', 'password');
    await expect(sp.password).toHaveAttribute('autocomplete', 'new-password');
    await expect(sp.password).toHaveValue('');
    await expect(sp.help, 'the help text gives the pool\'s rules').toBeVisible();
    expect(await sp.description(), 'the field is described by the help text').toContain(HELP);
    await expect(page.getByText(KIT_HELP), 'not the kit\'s help text').toHaveCount(0);

    await expect(sp.submit).toBeVisible();
    await expect(page.locator('input[type="password"]'), 'one password field').toHaveCount(1);

    // No start date: the line is the company alone.
    const noDate = invite!.add(link({ person: SECOND, startDate: undefined }));
    await sp.openForm(noDate);
    await expect(sp.email).toHaveValue(SECOND.email);
    await expect(sp.message(COMPANY), 'the company line without a date').toBeVisible();
    await expect(page.getByText(/Starts/), 'no "Starts"').toHaveCount(0);
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 The link does not stay in the address or leave the page, and the invite calls carry no sign-in, even with HR signed in', async ({ page, signIn, hr, invite, watch, cognito }) => {
    noBackendOnly();
    const sp = new SetPassword(page);
    const token = invite!.add(link());

    // HR is signed in, in this browser, when the new person opens their link.
    await signInAsHr(page, signIn, hr);

    await sp.openForm(token);
    await expect(sp.email).toHaveValue(STARTER.email);

    // The address bar: no fragment, no token, same page.
    const now = new URL(page.url());
    expect(now.hash, 'no fragment left in the address').toBe('');
    expect(page.url(), 'no token in the address').not.toContain(token);
    expect(now.pathname).toBe('/set-password');

    // Exactly one lookup, its body only { token }, sent after the fragment was gone, with no sign-in.
    await expect.poll(() => invite!.lookups().length).toBe(1);
    const lookup = invite!.lookups()[0]!;
    expect(lookup.body, 'lookup body').toEqual({ token });
    expect(lookup.pageUrl, 'the fragment is gone before the lookup is sent').not.toContain(token);
    expect(lookup.headers['authorization'], 'lookup carries no Authorization header').toBeUndefined();
    const lookupSent = await invite!.sentFrom(page);
    expect(lookupSent.length, 'the page sent the lookup').toBeGreaterThan(0);
    for (const s of lookupSent) expect(s.href, `the page's address when it sent ${s.url}: the fragment was already gone`).not.toContain(token);

    // Set the password: one redeem with { token, password }, no sign-in, after the fragment was gone.
    await sp.setPassword(GOOD_PASSWORD);
    await expectStart(page, STARTER.givenName);
    expect(invite!.redeems(), 'one redeem').toHaveLength(1);
    const redeem = invite!.redeems()[0]!;
    expect(redeem.body, 'redeem body').toEqual({ token, password: GOOD_PASSWORD });
    expect(redeem.pageUrl, 'no token in the address when redeem is sent').not.toContain(token);
    expect(redeem.headers['authorization'], 'redeem carries no Authorization header').toBeUndefined();
    const sent = await invite!.sentFrom(page);
    expect(sent.filter((x) => /\/redeem$/.test(x.url)), 'the page sent one redeem').toHaveLength(1);
    for (const s of sent) expect(s.href, `the page's address when it sent ${s.url}`).not.toContain(token);
    for (const p of invite!.preflights) expect(p.requestHeaders.toLowerCase(), `${p.route} preflight asks for no authorization header`).not.toContain('authorization');

    // The token is in exactly one request body per invite call, and nowhere else.
    await watch.settled();
    const carrying = watch.requests.filter((r) => (r.postData ?? '').includes(token));
    expect(carrying.map((r) => `${r.method} ${new URL(r.url).pathname}`), 'only the two invite calls carry the token').toEqual(['POST /v1/invites/lookup', 'POST /v1/invites/redeem']);
    for (const r of carrying) expect((r.postData ?? '').split(token).length - 1, 'once per body').toBe(1);
    for (const r of watch.requests) {
      expect(r.url, `no token in the address of ${r.method} ${r.url}`).not.toContain(token);
      for (const [name, value] of Object.entries(r.headers)) expect(value, `no token in header ${name} of ${r.method} ${r.url}`).not.toContain(token);
    }
    for (const r of watch.requests.filter((x) => /cognito-idp\./.test(x.url))) expect(r.postData ?? '', 'Cognito never sees the token').not.toContain(token);
    expect(watch.console.filter((l) => l.includes(token)), 'no console line has the token').toEqual([]);
    expect(await everythingStored(page), 'no local storage, session storage or cookie has the token').not.toContain(token);
    expect(cognito!.calls.some((c) => JSON.stringify(c.body).includes(token))).toBe(false);

    // History: no entry holds the link with the token.
    const entries = await page.evaluate(() => history.length);
    const seen: string[] = [page.url()];
    for (let i = 1; i < entries; i++) {
      await page.goBack({ waitUntil: 'commit' }).catch(() => null);
      seen.push(page.url());
    }
    expect(seen.filter((u) => u.includes(token)), `history holds no URL with the token (walked: ${seen.join(' , ')})`).toEqual([]);
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 A broken rule says which one, next to the field, and nothing is sent; a server 400 shows the same way', async ({ page, invite }) => {
    noBackendOnly();
    const sp = new SetPassword(page);
    const token = invite!.add(link());
    await sp.openForm(token);

    const cases: Array<[string, string, string[]]> = [
      ['11 characters', 'Abcdef1!xyz', [LINE.minLength]],
      ['no upper case', 'abcdefgh1!xyz', [LINE.upper]],
      ['no lower case', 'ABCDEFGH1!XYZ', [LINE.lower]],
      ['no number', 'Abcdefgh!xyzw', [LINE.number]],
      ['no symbol', 'Abcdefgh1xyzw', [LINE.symbol]],
      ['257 characters', `Aa1!${'x'.repeat(253)}`, [LINE.maxLength]],
      ['empty', '', [EMPTY]],
      ['several rules at once, in the card\'s order', 'abc', [LINE.minLength, LINE.upper, LINE.number, LINE.symbol]],
    ];
    for (const [what, password, lines] of cases) {
      await sp.setPassword(password);
      await sp.expectLines(lines, what);
      await expect(sp.password, `${what}: the password stays in the field`).toHaveValue(password);
      expect(invite!.redeems(), `${what}: no redeem call`).toHaveLength(0);
    }

    // The server finds what the page let through.
    invite!.nextRedeems.push({ status: 400, body: { error: 'Check the password', fields: { password: ['symbol'] } } });
    await sp.setPassword(GOOD_PASSWORD);
    await expect.poll(() => invite!.redeems().length).toBe(1);
    await sp.expectLines([LINE.symbol], 'a server 400 with symbol');
    await expect(sp.password, 'the password stays after a 400').toHaveValue(GOOD_PASSWORD);
    await expect(page).toHaveURL(/\/set-password$/);

    // A rule name the page does not know: the general line.
    invite!.nextRedeems.push({ status: 400, body: { error: 'Check the password', fields: { password: ['breached'] } } });
    await sp.submit.click();
    await expect.poll(() => invite!.redeems().length).toBe(2);
    await expect(page.getByText(GENERAL).first(), 'the general line').toBeVisible();
    for (const line of Object.values(LINE)) await expect(page.getByText(line), `not "${line}"`).toHaveCount(0);
    await expect(sp.password).toHaveValue(GOOD_PASSWORD);
  });

  // -------------------------------------------------------------- AC-4
  test('AC-4 Setting the password signs the person in and opens their page, which survives a reload; a double tap sends one redeem', async ({ page, invite, cognito }) => {
    noBackendOnly();
    const sp = new SetPassword(page);
    const token = invite!.add(link());
    await sp.openForm(token);

    await sp.password.fill(GOOD_PASSWORD);
    invite!.holdRedeem = true;
    await sp.submit.dblclick();
    await sp.submit.dispatchEvent('click');
    await sp.password.press('Enter', { timeout: 2_000 }).catch(() => undefined);
    await expect.poll(() => invite!.redeems().length).toBe(1);
    invite!.release();

    await expectStart(page, STARTER.givenName);
    await expect(page).toHaveTitle('Welcome · Naleko People');
    await expect(page.getByRole('heading', { name: CONSENT_HEADING, exact: true })).toBeVisible();
    expect(invite!.redeems(), 'one redeem for a double tap').toHaveLength(1);
    expect(invite!.redeems()[0]!.body).toEqual({ token, password: GOOD_PASSWORD });

    // Signed in as that person, with the email from the lookup.
    const signIns = cognito!.calls.filter((c) => c.target === 'InitiateAuth');
    expect(signIns.map((c) => (c.body['AuthParameters'] as Record<string, string>)['USERNAME']), 'one sign-in, as the new person').toEqual([STARTER.email]);
    expect(await storedSessionEmails(page), 'the session kept is the new person\'s').toEqual([STARTER.email]);

    await page.reload();
    await expectStart(page, STARTER.givenName);
    expect(invite!.redeems(), 'a reload sends nothing to the invite routes').toHaveLength(1);
    expect(invite!.lookups(), 'a reload does not look the link up again').toHaveLength(1);
  });

  // -------------------------------------------------------------- AC-5
  test('AC-5 A used, old or broken link shows who can help, with no form', async ({ page, invite }) => {
    noBackendOnly();
    const sp = new SetPassword(page);

    for (const state of ['expired', 'used'] as const) {
      await sp.open(invite!.add(link({ state })));
      await expectExpired(sp, LEAD_NAMES, `lookup ${state}`);
    }

    await sp.open(newToken()); // not a link the API knows: invalid
    await expectExpired(sp, LEAD_NO_NAMES, 'lookup invalid');

    invite!.nextLookups.push({ status: 400, body: { error: 'The request body is missing or not valid' } });
    await sp.open(invite!.add(link()));
    await expectExpired(sp, LEAD_NO_NAMES, 'lookup 400');

    await sp.open(null);
    await expectExpired(sp, LEAD_NO_NAMES, 'no token in the address');

    expect(invite!.redeems(), 'none of these pages calls redeem').toHaveLength(0);

    // The link was fine when it was looked up, but redeem says it is gone: the names from the lookup.
    const late = invite!.add(link());
    await sp.openForm(late);
    invite!.nextRedeems.push({ status: 410, body: { status: 'expired' } });
    await sp.setPassword(GOOD_PASSWORD);
    await expectExpired(sp, LEAD_NAMES, 'redeem 410');
    expect(invite!.redeems()).toHaveLength(1);
    await expect(page).not.toHaveURL(ON_START);
  });

  // -------------------------------------------------------------- AC-6
  test('AC-6 A failure is said plainly and loses nothing: lookup with no answer, redeem 502 or no answer, and a failed sign-in after the set', async ({ page, invite, cognito }) => {
    noBackendOnly();
    const sp = new SetPassword(page);

    // The lookup gets no answer, then a 5xx: the connection words and Try again, never the expired page.
    const token = invite!.add(link());
    const lookupFailures = [
      ['lookup with no answer', 'offline'],
      ['lookup 503', { status: 503, body: { message: 'Service Unavailable' } }],
      ['lookup 429 from the gateway', TOO_MANY],
    ] as const;
    for (const [what, failure] of lookupFailures) {
      const before = invite!.lookups().length;
      invite!.nextLookups.push(failure);
      await sp.open(token);
      await expect(sp.message(OFFLINE), `${what}: the connection words`).toBeVisible();
      await expect(sp.tryAgain, `${what}: Try again`).toBeVisible();
      await expect(sp.expired, `${what}: not the expired page`).toHaveCount(0);
      await expect(sp.message(LEAD_NO_NAMES)).toHaveCount(0);
      await sp.tryAgain.click();
      await expect(sp.heading, `${what}: Try again repeats the lookup and shows the form`).toBeVisible();
      await expect(sp.email).toHaveValue(STARTER.email);
      expect(invite!.lookups().length, `${what}: two lookups`).toBe(before + 2);
      await expect(sp.message(OFFLINE)).toHaveCount(0);
    }

    // Redeem gets no answer: the connection words, the password stays.
    await sp.password.fill(GOOD_PASSWORD);
    invite!.nextRedeems.push('offline');
    await sp.submit.click();
    await expect(sp.message(OFFLINE), 'redeem with no answer').toBeVisible();
    await expect(sp.password).toHaveValue(GOOD_PASSWORD);
    await expect(sp.email).toHaveValue(STARTER.email);
    await expect(sp.expired).toHaveCount(0);

    // Redeem 502, then the gateway's 429: the server's words, the password stays.
    for (const [what, failure] of [['redeem 502', { status: 502, body: { error: COULD_NOT } }], ['redeem 429 from the gateway', TOO_MANY]] as const) {
      const before = invite!.redeems().length;
      invite!.nextRedeems.push(failure);
      await sp.submit.click();
      await expect.poll(() => invite!.redeems().length).toBe(before + 1);
      await expect(sp.message(COULD_NOT), what).toBeVisible();
      await expect(sp.password, `${what}: the password stays`).toHaveValue(GOOD_PASSWORD);
      await expect(sp.email).toHaveValue(STARTER.email);
      await expect(sp.expired, `${what}: not the expired page`).toHaveCount(0);
      await expect(sp.message(OFFLINE), `${what}: not the connection words`).toHaveCount(0);
    }
    expect(invite!.redeems()).toHaveLength(3);

    // Trying again sets it; then the sign-in fails once.
    cognito!.rejectNextSignIn(COGNITO_ERRORS.throttled);
    await sp.submit.click();
    await expect(sp.message(SIGN_IN_FAILED), 'the sign-in after the set failed').toBeVisible();
    expect(invite!.redeems(), 'the fourth redeem answered 204').toHaveLength(4);
    expect(invite!.redeems()[3]!.status).toBe(204);
    await expect(sp.message(COULD_NOT)).toHaveCount(0);
    await expect(sp.tryAgain).toBeVisible();
    await sp.tryAgain.click();
    await expectStart(page, STARTER.givenName);
    expect(invite!.redeems(), 'Try again signs in without a second redeem').toHaveLength(4);
    expect(cognito!.calls.filter((c) => c.target === 'InitiateAuth'), 'two sign-in attempts').toHaveLength(2);
  });

  // -------------------------------------------------------------- AC-7
  test('AC-7 The right person, the right pages: HR is signed out for the new person, an employee never reaches an HR page', async ({ page, signIn, hr, invite, cognito, watch, appOrigin }) => {
    noBackendOnly();
    const sp = new SetPassword(page);
    const token = invite!.add(link());

    // HR is signed in, in this browser.
    await signInAsHr(page, signIn, hr);
    expect(await storedSessionEmails(page)).toEqual([hr.email]);

    await sp.openForm(token);
    await sp.setPassword(GOOD_PASSWORD);
    await expectStart(page, STARTER.givenName);

    // Only the new person's session is left.
    expect(await storedSessionEmails(page), 'the HR session is ended; the person signed in is the employee').toEqual([STARTER.email]);
    const lastUser = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) ?? '';
        if (k.endsWith('.LastAuthUser')) return localStorage.getItem(k);
      }
      return null;
    });
    expect(lastUser, 'the browser\'s current Cognito user is the employee').toBe(cognito!.subOf(STARTER.email));
    await expect(page.getByRole('heading', { name: new RegExp(hr.givenName) })).toHaveCount(0);

    // An employee who opens HR pages lands on /start, and no HR API is called.
    const from = watch.requests.length;
    for (const hrPage of ['/hr', '/hr/documents', '/hr/employees/new']) {
      await page.goto(hrPage);
      await expect(page, `${hrPage} sends an employee to /start`).toHaveURL(START);
      await expect(page.getByRole('heading', { name: `Welcome, ${STARTER.givenName}`, exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: /Welcome back/ }), `${hrPage}: no HR page`).toHaveCount(0);
    }
    await page.goto('/sign-in');
    await expect(page, 'a signed-in employee who opens /sign-in lands on /start').toHaveURL(START);
    expect(notMe(watch.apiCalls(appOrigin, from)), 'no HR API (or any API but GET /v1/me) is called for the employee').toEqual([]);

    // Sign out from the account menu; nobody signed in who opens /start lands on /sign-in.
    await signOutEmployee(page);
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expectNoSession(page);
    await page.goto('/start');
    await expect(page, 'nobody signed in: /start goes to /sign-in').toHaveURL(ON_SIGN_IN);

    // HR who opens /start goes to HR home.
    await signInAsHr(page, signIn, hr);
    await page.goto('/start');
    await expect(page, 'HR who opens /start lands on /hr').toHaveURL(HR_HOME);
  });

  // -------------------------------------------------------------- AC-8
  // ONB-23 (NH-189) changed this test: an employee at /sign-in used to be refused. Re-locked as acceptance-lock/onb-17.2.
  test('AC-8 Sign-in at /sign-in: an employee lands on /start, an account in neither group is refused and keeps no session', async ({ page, signIn, employee, noAccess }) => {
    noBackendOnly();

    // An employee who comes back signs in at /sign-in and lands on their own page.
    await signIn.open();
    await signIn.signInAs(employee);
    await expectStart(page, employee.givenName);
    await page.goto(HR_HOME);
    await expect(page, 'an employee session never opens an HR page').toHaveURL(START);
    await signOutEmployee(page);
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expectNoSession(page);

    // Now that an employee session can be kept (restore), an account in neither group still keeps none.
    await signIn.open();
    await signIn.signInAs(noAccess);
    await expect(signIn.message(NO_ACCESS)).toBeVisible();
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expectNoSession(page);
    await page.goto('/start');
    await expect(page, 'no session from /sign-in: /start goes to /sign-in').toHaveURL(ON_SIGN_IN);
    await page.goto(HR_HOME);
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expectNoSession(page);
  });

  // -------------------------------------------------------------- AC-9
  test('AC-9 Keyboard and screen reader: focus starts in New password, Enter submits, every message is announced', async ({ page, invite, cognito }) => {
    noBackendOnly();
    const sp = new SetPassword(page);

    // Loading is announced, and there is no form yet.
    const token = invite!.add(link());
    invite!.holdLookup = true;
    await sp.open(token);
    await expect(page.getByRole('status').first(), 'loading sits in role=status').toBeAttached();
    await expect(sp.password, 'no form while the lookup runs').toHaveCount(0);
    invite!.release();

    await expect(sp.password).toBeVisible();
    await expect(sp.password, 'focus starts in New password').toBeFocused();

    // The read-only email is in the tab order and read out.
    await page.keyboard.press('Shift+Tab');
    await expect(sp.email, 'Shift+Tab reaches the email').toBeFocused();
    await expect(sp.email).toHaveAccessibleName('Email');
    await expect(sp.email).toHaveValue(STARTER.email);
    await page.keyboard.press('Tab');
    await expect(sp.password).toBeFocused();

    // Enter submits; a broken rule moves focus to the first error line (or the field it describes) and is announced.
    await page.keyboard.type('Abcdefgh1xyzw');
    await page.keyboard.press('Enter');
    await expectAnnounced(page, LINE.symbol, sp.password);
    const focus = await page.evaluate((line) => {
      const el = document.activeElement;
      return { isInput: el instanceof HTMLInputElement && el.getAttribute('autocomplete') === 'new-password', text: el?.textContent ?? '', line };
    }, LINE.symbol);
    expect(focus.isInput || focus.text.includes(LINE.symbol), 'focus moves to the first error line, or the field it describes').toBe(true);
    expect(invite!.redeems()).toHaveLength(0);

    // Enter with a good password sends it; a 502 is announced.
    await sp.password.fill(GOOD_PASSWORD);
    invite!.nextRedeems.push({ status: 502, body: { error: COULD_NOT } });
    await sp.password.press('Enter');
    await expect.poll(() => invite!.redeems().length, 'Enter sent the password').toBe(1);
    await expectAnnounced(page, COULD_NOT);

    invite!.nextRedeems.push('offline');
    await sp.password.press('Enter');
    await expectAnnounced(page, OFFLINE);

    cognito!.rejectNextSignIn(COGNITO_ERRORS.throttled);
    await sp.password.press('Enter');
    await expectAnnounced(page, SIGN_IN_FAILED);
    await sp.tryAgain.focus();
    await page.keyboard.press('Enter');
    await expectStart(page, STARTER.givenName);

    // A lookup with no answer is announced too.
    await signOutEmployee(page);
    await expect(page).toHaveURL(ON_SIGN_IN);
    invite!.nextLookups.push('offline');
    await sp.open(invite!.add(link({ person: SECOND })));
    await expectAnnounced(page, OFFLINE);
  });

  // -------------------------------------------------------------- AC-10
  test('AC-10 Phone: both pages and /start fit 390 wide, nothing under a top bar, buttons at least 44 pixels tall', async ({ page, invite }, testInfo) => {
    noBackendOnly();
    test.skip(testInfo.project.name !== 'phone-390', 'The phone criterion: runs at 390 wide.');
    const sp = new SetPassword(page);

    const check = async (what: string, parts: Locator[], buttons: Locator[]) => {
      const viewport = page.viewportSize()!;
      const scroll = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
      expect(scroll.doc, `${what}: no sideways scroll`).toBeLessThanOrEqual(scroll.win);
      for (const part of [...parts, ...buttons]) {
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
      for (const button of buttons) expect((await button.boundingBox())!.height, `${what}: button at least 44 pixels tall`).toBeGreaterThanOrEqual(44);
    };

    await sp.openForm(invite!.add(link()));
    await check('the form', [sp.heading, sp.message(`${COMPANY} · Starts 1 Dec 2026`), sp.email, sp.password, sp.help], [sp.submit]);

    await sp.setPassword('abc');
    await check('the form with rule lines', [sp.password, sp.page.getByText(LINE.minLength).first(), sp.page.getByText(LINE.symbol).first()], [sp.submit]);

    await sp.open(invite!.add(link({ state: 'expired' })));
    await check('the expired page', [sp.expired, sp.message(LEAD_NAMES)], []);

    await sp.openForm(invite!.add(link()));
    await sp.setPassword(GOOD_PASSWORD);
    await expectStart(page, STARTER.givenName);
    await check('/start', [page.getByRole('heading', { name: `Welcome, ${STARTER.givenName}`, exact: true }), page.getByRole('heading', { name: CONSENT_HEADING, exact: true })], [page.getByRole('button', { name: 'Accept and continue', exact: true })]);
  });

  // -------------------------------------------------------------- AC-11
  test('AC-11 pepla-dev: a real invite link from the HR test login sets the password, signs in to /start, and works only once @pepla-dev', async ({ page, signIn, hr }, testInfo) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only, after ONB-04 and ONB-17 are both deployed there.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once, at one width.');
    test.setTimeout(240_000);
    const api = devApi();
    const sp = new SetPassword(page);

    // The HR test login registers a test address through the real API and gets the link back (ONB-04 AC-5).
    const hrToken = await signInForToken(page, signIn, hr);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const email = `e2e.run-${stamp}@blackhole.postmarkapp.com`;
    const res = await page.request.post(`${api}/v1/employees`, {
      headers: { Authorization: `Bearer ${hrToken}`, 'content-type': 'application/json', 'Idempotency-Key': randomUUID() },
      data: { first_name: 'Zanele', last_name: `Run${Math.floor(Math.random() * 1e4)}`, email, phone: '081 234 5678', department: 'Operations', job_title: 'Test starter', planned_start_date: '2026-12-01' },
    });
    expect(res.status(), `register ${email}: ${await res.text()}`).toBe(201);
    const answer = (await res.json()) as { invite?: { link?: string } };
    const invited = answer.invite?.link ?? '';
    expect(invited, 'the answer carries invite.link for a test login and a test address').toMatch(/\/set-password#token=[\w-]{43}$/);
    const path = new URL(invited);

    // Signed out, the person opens the link in the app on this run's address.
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.context().clearCookies();
    await page.goto(`${path.pathname}${path.hash}`);
    await expect(sp.heading).toBeVisible({ timeout: 30_000 });
    await expect(sp.email).toHaveValue(email);
    // The whole path: ONB-04's lookup (company from its dev setting "Sunbird Bakery", startDate as YYYY-MM-DD) to the page's line.
    await expect(sp.message('Sunbird Bakery · Starts 1 Dec 2026'), 'the company line from the real lookup').toBeVisible();
    expect(new URL(page.url()).hash, 'no fragment left in the address').toBe('');

    const password = `Dev-${randomBytes(6).toString('base64url')}-7!aA`;
    await sp.setPassword(password);
    await expect(page).toHaveURL(START, { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Welcome, Zanele', exact: true })).toBeVisible();

    // The same link again: expired.
    await page.goto(`${path.pathname}${path.hash}`);
    await expect(sp.expired, 'the link works once').toBeVisible({ timeout: 30_000 });
    // The person is removed by the dev cleanup (scripts/ci/cleanup-dev-e2e.py, e2e.run- addresses).
  });

  // -------------------------------------------------------------- AC-12
  test('AC-12 Text check: the routes, no token in storage, console or a query string, the words, and verify:design', async ({}, testInfo) => {
    noBackendOnly();
    onceOnly(testInfo);
    const app = join(WEB, 'src', 'app');

    // Routes: /set-password with no guard, /start behind employeeGuard.
    const routes = readFileSync(join(app, 'app.routes.ts'), 'utf8');
    const setPw = routeBlock(routes, 'set-password');
    expect(setPw, 'app.routes.ts has a set-password route').not.toBeNull();
    expect(setPw!, '/set-password has no guard').not.toMatch(/canActivate|canMatch|canActivateChild|canLoad/);
    expect(setPw!).toMatch(/title\s*:\s*['"`]Set your password · Naleko People['"`]/);
    const start = routeBlock(routes, 'start');
    expect(start, 'app.routes.ts has a start route').not.toBeNull();
    expect(start!, '/start is behind employeeGuard').toMatch(/canActivate\s*:\s*\[\s*employeeGuard\s*\]/);
    expect(start!).toMatch(/title\s*:\s*['"`]Welcome · Naleko People['"`]/);
    expect(readFileSync(join(app, 'core', 'auth', 'auth.guard.ts'), 'utf8')).toMatch(/export\s+const\s+employeeGuard\b/);

    // Nothing under pepla-web/src writes a token to storage or the console, or puts it in a query string.
    const src = walk(join(WEB, 'src')).filter((f) => /\.(ts|html)$/.test(f) && !f.endsWith('.spec.ts'));
    const bad: string[] = [];
    for (const f of src) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        const at = `${rel(f)}:${i + 1}: ${line.trim()}`;
        if (/(localStorage|sessionStorage|document\.cookie|console\.\w+)/.test(line) && /token/i.test(line)) bad.push(`storage or console: ${at}`);
        if (/[?&]token=/.test(line)) bad.push(`query string: ${at}`);
        if (/(HttpParams|queryParams|params\s*:|searchParams)[^\n]{0,120}\btoken\b/i.test(line)) bad.push(`query string: ${at}`);
      });
    }
    expect(bad, 'no token in storage, the console or a query string').toEqual([]);

    // The card's own new files: found by what they do, among the files that were not there at ae7bba4.
    const before = new Set(readFileSync(join(HERE, 'support', 'onb-17', 'src-files.ae7bba4.txt'), 'utf8').split('\n').filter(Boolean));
    const added = src.filter((f) => !before.has(rel(f)));
    const mine = withoutGeneratedApiTypes(added).filter((f) => /\/v1\/invites\/|Set your password|This link has expired|Your onboarding steps will show here/.test(readFileSync(f, 'utf8')));
    expect(mine.length, 'the card adds files for the page and its invite calls').toBeGreaterThan(0);
    for (const f of mine) {
      const text = readFileSync(f, 'utf8');
      expect(text, `${rel(f)}: never "Masked"`).not.toMatch(/\bmasked\b/i);
      expect(text, `${rel(f)}: never "credentials"`).not.toMatch(/\bcredentials\b/i);
      expect(text, `${rel(f)}: never "Work email"`).not.toMatch(/work email/i);
      expect(text, `${rel(f)}: not the kit's help text`).not.toMatch(KIT_HELP);
    }
    const invites = mine.filter((f) => /\/v1\/invites\//.test(readFileSync(f, 'utf8')));
    for (const f of invites) expect(readFileSync(f, 'utf8'), `${rel(f)}: adds no Authorization header to an invite call`).not.toMatch(/['"`]Authorization['"`]|\bAuthorization\s*:|idToken\s*\(/);

    // Only pp-* components on screens.
    let out = '';
    try {
      out = execFileSync('node', ['scripts/verify-design.mjs'], { cwd: WEB, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      throw new Error(`verify:design failed:\n${err.stdout ?? ''}${err.stderr ?? ''}`);
    }
    void out;
  });
});

// ---------------------------------------------------------------- helpers

function rel(f: string): string {
  return relative(REPO, f).split(sep).join('/');
}

function walk(d: string): string[] {
  return readdirSync(d).flatMap((n) => {
    const f = join(d, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
}

/** The `{ ... }` route object whose path is `path`, or null. */
function routeBlock(text: string, path: string): string | null {
  const m = new RegExp(`path\\s*:\\s*['"\`]${path}['"\`]`).exec(text);
  if (!m) return null;
  let start = m.index;
  let depth = 0;
  for (; start >= 0; start--) {
    if (text[start] === '}') depth++;
    if (text[start] === '{') {
      if (depth === 0) break;
      depth--;
    }
  }
  depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function devApi(): string {
  const file = join(WEB, 'src', 'environments', 'environment.ts');
  const m = /employeesApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(existsSync(file) ? readFileSync(file, 'utf8') : '');
  expect(m, 'pepla-web/src/environments/environment.ts has employeesApiUrl').toBeTruthy();
  expect(m![1], 'employeesApiUrl points at pepla-dev, not the placeholder').not.toMatch(/\.invalid\b/);
  return m![1]!.replace(/\/+$/, '');
}

async function signInForToken(page: Page, signIn: SignInPage, login: Login): Promise<string> {
  let token = '';
  const listen = async (r: import('@playwright/test').Response) => {
    if (!/cognito-idp\.[a-z0-9-]+\.amazonaws\.com/.test(r.url()) || r.request().method() !== 'POST') return;
    try {
      const b = (await r.json()) as { AuthenticationResult?: { IdToken?: string } };
      if (b.AuthenticationResult?.IdToken) token = b.AuthenticationResult.IdToken;
    } catch {
      /* not JSON */
    }
  };
  page.on('response', listen);
  await signIn.open();
  await signIn.signInAs(login);
  await expect.poll(() => token, { message: `Cognito hands ${login.email} an ID token`, timeout: 30_000 }).not.toBe('');
  page.off('response', listen);
  return token;
}
