import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { COGNITO_ERRORS, type CognitoFake } from './support/cognito-fake';
import { FAKE, HR_HOME, ON_DEV, ON_SIGN_IN, expect, expectAnnounced, test as base, type Login, type SignInPage } from './support/fixtures';
import { lambdaChecks } from './support/onb-24/lambda-checks';
import { terraformChecks } from './support/onb-24/terraform-checks';

/**
 * ONB-24 · Forgot your password (Jira NH-188).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-24.md (NH-188).
 *
 * The screens (AC-1 to AC-10) run at 1280 and 390 wide with no backend, against the shared Cognito fake
 * (support/cognito-fake.ts), which answers ForgotPassword and ConfirmForgotPassword the way the real pool
 * does with the app client's PreventUserExistenceErrors on. A password set by a reset is checked for real
 * by SRP at sign-in, so "the old password is refused" is a real check here too.
 * AC-11 runs the two new Lambdas against a fake AWS and a fake Postmark (support/onb-24/fake-aws).
 * AC-12 runs on pepla-dev only, after the merge and deploy. AC-13 reads files.
 *
 * Nothing here calls an AI service, AWS (outside the pepla-dev run) or sends a real email.
 * These files are locked once accepted: see ./README.md and ./cards/onb-24.md.
 */

const HERE = __dirname;
const WEB = join(HERE, '..', '..');
const REPO = join(WEB, '..');

// ---------------------------------------------------------------- the card's words
const LINK = 'Forgot your password?';
const OLD_LINE = 'Your Admin can send you a new link';
const RESET_HEADING = 'Reset your password';
const RESET_LEAD = "Enter the email you sign in with. We'll send you a 6-digit code.";
const SEND = 'Send code';
const BACK = 'Back to sign in';
const CODE_HEADING = 'Enter the code';
const codeLead = (email: string) => `If ${email} has a Naleko People account, a 6-digit code is on its way. It works for 1 hour.`;
const CHANGE = 'Change password';
const RESEND = 'Send a new code';
const DIFFERENT = 'Use a different email';
const FOOTER = "Haven't set a password yet? Use the link in your welcome email.";
const NEW_CODE_SENT = 'A new code is on its way.';
const CODE_EMPTY = 'Enter the code from the email.';
const CODE_SIX = 'The code is 6 digits.';
const WRONG_CODE = 'That code is not right. Check the email and try again.';
const EXPIRED = 'That code has expired. Send a new code.';
const OTHER = "That didn't work. Try again in a few minutes.";
const CHANGED = 'Your password is changed. Sign in with your new password.';
// Reused, not new (SIGN_IN_MESSAGES and ONB-17's rule lines).
const TOO_MANY = 'Too many attempts. Try again in a few minutes.';
const OFFLINE = "We can't reach Naleko People. Check your connection and try again.";
const BAD_EMAIL = 'Enter a valid email.';
const WRONG_PASSWORD = 'Email or password is incorrect.';
const HELP = 'At least 12 characters, with an upper case letter, a lower case letter, a number and a symbol.';
const LINE = {
  minLength: 'Use at least 12 characters.',
  maxLength: 'Use 256 characters or fewer.',
  upper: 'Add an upper case letter.',
  lower: 'Add a lower case letter.',
  number: 'Add a number.',
  symbol: 'Add a symbol, such as ! or #.',
} as const;
const EMPTY_PASSWORD = 'Enter a new password.';
const GENERAL = 'Check the password against the rules under the field.';
const ALL_PASSWORD_LINES = [...Object.values(LINE), EMPTY_PASSWORD, GENERAL];
/** Cognito's own words: never shown to a person. */
const COGNITO_WORDS = Object.values(COGNITO_ERRORS).map((e) => e.message);

/** Passes every pool rule. */
const NEW_PASSWORD = 'Blue-kettle-7!';
const OLD_PASSWORD = 'winter-protea-2026'; // what every fake account signs in with until a reset (fixtures.ts)
const UNKNOWN = 'nobody.here@mokoena-logistics.co.za';

const RESET_PATH = /\/forgot-password$/;
const START = /\/start$/;

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: AC-12 is the pepla-dev check.');
const onceOnly = (testInfo: TestInfo) => test.skip(testInfo.project.name !== 'desktop-1280', 'Reads files, not the screen: runs once, at one width.');

// ---------------------------------------------------------------- watching what leaves the page

/** Every request, console line, page error, address the page went to, and every history entry it wrote. */
class Watch {
  readonly requests: Array<{ url: string; method: string; headers: Record<string, string>; postData: string | null; target: string }> = [];
  readonly console: string[] = [];
  readonly addresses: string[] = [];
  private readonly pending: Promise<unknown>[] = [];

  async track(page: Page): Promise<void> {
    page.context().on('request', (r) => {
      const seen = { url: r.url(), method: r.method(), headers: r.headers(), postData: r.postData(), target: (r.headers()['x-amz-target'] ?? '').replace('AWSCognitoIdentityProviderService.', '') };
      this.requests.push(seen);
      this.pending.push(r.allHeaders().then((h) => (seen.headers = h)).catch(() => undefined));
    });
    page.on('console', (m) => this.console.push(m.text()));
    page.on('pageerror', (e) => this.console.push(`${e.name}: ${e.message}\n${e.stack ?? ''}`));
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) this.addresses.push(f.url());
    });
    // Every history entry the app writes: its address and its state, as text.
    await page.addInitScript(() => {
      const w = window as unknown as { __onb24History: string[] };
      w.__onb24History = [];
      for (const k of ['pushState', 'replaceState'] as const) {
        const original = history[k].bind(history);
        history[k] = (state: unknown, title: string, url?: string | URL | null) => {
          let text = '';
          try {
            text = JSON.stringify(state);
          } catch {
            text = String(state);
          }
          w.__onb24History.push(`url=${url == null ? '' : String(url)}\nstate=${text}`);
          return original(state, title, url);
        };
      }
    });
  }

  async settled(): Promise<void> {
    await Promise.all(this.pending);
  }

  /** History entries written since the page loaded, plus the current state. */
  async history(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const w = window as unknown as { __onb24History?: string[] };
      let state = '';
      try {
        state = JSON.stringify(history.state);
      } catch {
        state = String(history.state);
      }
      return [...(w.__onb24History ?? []), `current state=${state}`, `current url=${location.href}`];
    });
  }
}

type Fixtures = { watch: Watch };

const test = base.extend<Fixtures>({
  watch: async ({ page }, use) => {
    const w = new Watch();
    await w.track(page);
    await use(w);
  },
});

/** Both steps of /forgot-password, found the way a person finds them: by their words. */
class Reset {
  readonly heading: Locator;
  readonly lead: Locator;
  readonly email: Locator;
  readonly send: Locator;
  readonly back: Locator;
  readonly codeHeading: Locator;
  readonly code: Locator;
  readonly password: Locator;
  readonly help: Locator;
  readonly change: Locator;
  readonly resend: Locator;
  readonly different: Locator;
  readonly footer: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { name: RESET_HEADING, exact: true });
    this.lead = page.getByText(RESET_LEAD, { exact: true });
    this.email = page.getByLabel('Email', { exact: true });
    this.send = page.getByRole('button', { name: SEND, exact: true });
    this.back = page.getByRole('link', { name: BACK, exact: true });
    this.codeHeading = page.getByRole('heading', { name: CODE_HEADING, exact: true });
    this.code = page.getByLabel('Code', { exact: true });
    this.password = page.getByLabel('New password', { exact: true });
    this.help = page.getByText(HELP, { exact: true });
    this.change = page.getByRole('button', { name: CHANGE, exact: true });
    // "Send a new code" and "Use a different email" act on the page: a link or a button styled as one.
    const resendName = new RegExp(`^${RESEND}( \\(\\d+s\\))?$`);
    this.resend = page.getByRole('link', { name: resendName }).or(page.getByRole('button', { name: resendName }));
    this.different = page.getByRole('link', { name: DIFFERENT, exact: true }).or(page.getByRole('button', { name: DIFFERENT, exact: true }));
    this.footer = page.getByText(FOOTER, { exact: true });
  }

  async open(): Promise<void> {
    await this.page.goto('/forgot-password');
    await expect(this.heading).toBeVisible();
  }

  /** Step 1 with this email, ending on step 2. */
  async request(email: string): Promise<void> {
    await this.email.fill(email);
    await this.send.click();
    await expect(this.codeHeading).toBeVisible();
  }

  async confirm(code: string, password: string): Promise<void> {
    await this.code.fill(code);
    await this.password.fill(password);
    await this.change.click();
  }

  message(text: string): Locator {
    return this.page.getByText(text, { exact: true });
  }

  /** The words a field is described by (aria-describedby), in order. */
  async description(field: Locator): Promise<string> {
    return field.evaluate((el) =>
      (el.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ')
        .replace(/\s+/g, ' '),
    );
  }

  /** The New password field shows exactly these lines, in ONB-17's order, and is invalid and described by them. */
  async expectPasswordLines(lines: string[], what: string): Promise<void> {
    for (const line of lines) await expect(this.page.getByText(line).first(), `${what}: "${line}" shows`).toBeVisible();
    for (const line of ALL_PASSWORD_LINES.filter((l) => !lines.includes(l))) {
      await expect(this.page.getByText(line), `${what}: "${line}" does not show`).toHaveCount(0);
    }
    await expect(this.password, `${what}: New password is marked invalid`).toHaveAttribute('aria-invalid', 'true');
    const described = await this.description(this.password);
    let last = -1;
    for (const line of lines) {
      const at = described.indexOf(line);
      expect(at, `${what}: New password is described by "${line}" (described by: "${described}")`).toBeGreaterThanOrEqual(0);
      expect(at, `${what}: "${line}" comes after the line before it`).toBeGreaterThan(last);
      last = at;
    }
  }

  /** `text` sits next to the Code field: the field is invalid and described by it. */
  async expectCodeLine(text: string, what: string): Promise<void> {
    await expect(this.message(text).first(), `${what}: "${text}" shows`).toBeVisible();
    await expect(this.code, `${what}: Code is marked invalid`).toHaveAttribute('aria-invalid', 'true');
    expect(await this.description(this.code), `${what}: Code is described by "${text}"`).toContain(text);
  }
}

async function noCognitoWords(page: Page, what: string): Promise<void> {
  const text = await page.locator('body').innerText();
  for (const w of COGNITO_WORDS) expect(text, `${what}: Cognito's own words "${w}" are not shown`).not.toContain(w);
  expect(text, `${what}: no Cognito error name is shown`).not.toMatch(/Exception\b/);
}

/** Is a link or button out of use: disabled, or aria-disabled. */
async function isDisabled(el: Locator): Promise<boolean> {
  return el.evaluate((n) => (n as HTMLButtonElement).disabled === true || n.getAttribute('aria-disabled') === 'true');
}

/** The element holding `text` sits in role=status (or a polite live region). */
async function expectStatus(page: Page, text: string): Promise<void> {
  const el = page.getByText(text, { exact: true }).first();
  await expect(el).toBeVisible();
  const ok = await el.evaluate((node) => {
    for (let n: Element | null = node as Element; n; n = n.parentElement) {
      if (n.getAttribute('role') === 'status' || n.getAttribute('aria-live') === 'polite') return true;
    }
    return false;
  });
  expect(ok, `"${text}" is announced as a status (role=status)`).toBe(true);
}

/** The page as a screen reader gets it, with `email` taken out, and every live region's words. */
async function seen(page: Page, email: string): Promise<string> {
  await page.waitForTimeout(300); // let any late live-region update land
  const tree = await page.locator('body').ariaSnapshot();
  const live = await page.evaluate(() =>
    [...document.querySelectorAll('[role="alert"], [role="status"], [aria-live]')].map((n) => `${n.getAttribute('role') ?? n.getAttribute('aria-live')}: ${(n.textContent ?? '').trim()}`).join('\n'),
  );
  const out = `${tree}\n--- live ---\n${live}\n--- title ---\n${await page.title()}`;
  return out.split(email).join('<email>');
}

/**
 * The page's own console lines, with `email` taken out. The browser's own network line for a 4xx answer
 * ("Failed to load resource") is left out: the browser writes it, not the app, and a real pool with
 * PreventUserExistenceErrors answers an unknown email with a 200 anyway. Sorted: the dev server's own lines
 * come in no fixed order.
 */
function appConsole(lines: string[], email: string): string[] {
  return lines.filter((l) => !/^Failed to load resource: the server responded with a status of 4\d\d/.test(l)).map((l) => l.split(email).join('<email>')).sort();
}

async function signOutHere(page: Page): Promise<void> {
  if (!/^https?:/.test(page.url())) await page.goto('/sign-in');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.context().clearCookies();
}

// ================================================================ the tests

test.describe('ONB-24 Forgot your password', () => {
  // -------------------------------------------------------------- AC-1
  test('AC-1 The link is on the sign-in page, under Sign in, and opens step 1; a typed email comes along, never in the address', async ({ page, signIn, watch }) => {
    noBackendOnly();
    await signIn.open();
    await expect(signIn.forgot, `"${LINK}" is a link`).toBeVisible();
    await expect(page.getByText(OLD_LINE), 'the old footer line is gone').toHaveCount(0);
    const button = (await signIn.submit.boundingBox())!;
    const link = (await signIn.forgot.boundingBox())!;
    expect(link.y, 'the link sits under the Sign in button').toBeGreaterThanOrEqual(button.y + button.height - 1);

    // Nothing typed: step 1 opens with an empty Email.
    await signIn.forgot.click();
    await expect(page).toHaveURL(RESET_PATH);
    const reset = new Reset(page);
    for (const part of [reset.heading, reset.lead, reset.email, reset.send, reset.back]) await expect(part).toBeVisible();
    await expect(page).toHaveTitle('Reset your password · Naleko People');
    await expect(reset.email).toHaveValue('');
    await expect(reset.email).toHaveAttribute('type', 'email');
    await expect(reset.email).toHaveAttribute('autocomplete', 'username');
    await expect(reset.codeHeading, 'step 2 is not shown yet').toHaveCount(0);

    // "Back to sign in", then type an email and follow the link: it comes along, the address never holds it.
    await reset.back.click();
    await expect(page).toHaveURL(ON_SIGN_IN);
    await signIn.email.fill(FAKE.hr.email);
    await signIn.forgot.click();
    await expect(page).toHaveURL(RESET_PATH);
    await expect(reset.email, 'the email typed on /sign-in is carried over').toHaveValue(FAKE.hr.email);
    for (const a of watch.addresses) {
      expect(a, 'no address holds the email').not.toContain(FAKE.hr.email);
      expect(decodeURIComponent(a), 'no address holds the email, even encoded').not.toContain(FAKE.hr.email);
    }
    for (const h of await watch.history(page)) {
      const address = h.split('\n').find((l) => /^(url=|current url=)/.test(l)) ?? '';
      expect(decodeURIComponent(address), 'no history entry address holds the email').not.toContain(FAKE.hr.email);
    }
  });

  test('AC-1 The old footer words are nowhere in pepla-web/src', async ({}, testInfo) => {
    noBackendOnly();
    onceOnly(testInfo);
    const hits = walk(join(WEB, 'src')).filter((f) => readFileSync(f, 'utf8').includes(OLD_LINE));
    expect(hits.map(rel), `"${OLD_LINE}" appears nowhere in pepla-web/src`).toEqual([]);
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 Happy path: a known account resets its password, signs in with it, and the old one is refused', async ({ page, signIn, cognito, hr, employee }) => {
    noBackendOnly();
    const reset = new Reset(page);

    // HR, from the sign-in page with the email typed in.
    await signIn.open();
    await signIn.email.fill(hr.email);
    await signIn.forgot.click();
    await expect(reset.email).toHaveValue(hr.email);
    await reset.send.click();
    await expect(reset.codeHeading).toBeVisible();
    await expect(reset.message(codeLead(hr.email)), 'the lead names the email').toBeVisible();
    await expect(page, 'step 2 is the same address').toHaveURL(RESET_PATH);
    for (const part of [reset.code, reset.password, reset.help, reset.change, reset.resend, reset.different, reset.footer]) await expect(part).toBeVisible();
    await expect(reset.code).toHaveAttribute('inputmode', 'numeric');
    await expect(reset.code).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(reset.password).toHaveAttribute('autocomplete', 'new-password');
    await expect(reset.password).toHaveAttribute('type', 'password');

    const code = cognito!.codeFor(hr.email)!;
    expect(code, 'the fake sent a code').toMatch(/^\d{6}$/);
    await reset.confirm(code, NEW_PASSWORD);
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expect(signIn.email, 'the email is filled in on /sign-in').toHaveValue(hr.email);
    await expect(signIn.message(CHANGED)).toBeVisible();
    expect(new URL(page.url()).search, 'the address holds no email').not.toContain('%40');

    const forgot = cognito!.callsTo('ForgotPassword');
    const confirm = cognito!.callsTo('ConfirmForgotPassword');
    expect(forgot, 'exactly one ForgotPassword').toHaveLength(1);
    expect(confirm, 'exactly one ConfirmForgotPassword').toHaveLength(1);
    expect(forgot[0]!.body['Username']).toBe(hr.email);
    expect(confirm[0]!.body['Username']).toBe(hr.email);
    expect(confirm[0]!.body['ConfirmationCode']).toBe(code);
    expect(confirm[0]!.body['Password']).toBe(NEW_PASSWORD);
    expect(String(confirm[0]!.body['ClientId'] ?? ''), 'the same app client as sign-in').toBe(String(forgot[0]!.body['ClientId'] ?? 'x'));

    // The new password works; the old one is refused (the fake checks a reset password by SRP).
    await signIn.password.fill(NEW_PASSWORD);
    await signIn.submit.click();
    await expect(page).toHaveURL(HR_HOME);
    await signOutHere(page);
    await signIn.open();
    await signIn.signInAs({ email: hr.email, password: OLD_PASSWORD });
    await expect(signIn.message(WRONG_PASSWORD), 'the old password is refused').toBeVisible();
    await expect(page).toHaveURL(ON_SIGN_IN);

    // An employee, opening the page directly: lands on /start with the new password.
    await reset.open();
    await reset.request(employee.email);
    await reset.confirm(cognito!.codeFor(employee.email)!, NEW_PASSWORD);
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expect(signIn.email).toHaveValue(employee.email);
    await signIn.password.fill(NEW_PASSWORD);
    await signIn.submit.click();
    await expect(page).toHaveURL(START);
    await signOutHere(page);
    await signIn.open();
    await signIn.signInAs({ email: employee.email, password: OLD_PASSWORD });
    await expect(signIn.message(WRONG_PASSWORD), 'the employee\'s old password is refused').toBeVisible();
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 No account enumeration: an unknown email, and every Cognito "no" on step 1, read exactly like a real account', async ({ page, cognito, watch, hr }) => {
    noBackendOnly();
    const reset = new Reset(page);

    const step2For = async (email: string, scripted?: { type: string; message: string }) => {
      await page.goto('about:blank');
      const from = watch.console.length;
      await reset.open();
      if (scripted) cognito!.failNext('ForgotPassword', scripted);
      await reset.request(email);
      await expect(reset.message(codeLead(email))).toBeVisible();
      await noCognitoWords(page, `step 2 for ${email}`);
      return { page: await seen(page, email), console: appConsole(watch.console.slice(from), email) };
    };

    const known = await step2For(hr.email);
    const cases: Array<[string, string, { type: string; message: string } | undefined]> = [
      ['an unknown email', UNKNOWN, undefined],
      ['UserNotFoundException', UNKNOWN, COGNITO_ERRORS.userNotFound],
      ['InvalidParameterException (no verified email)', hr.email, COGNITO_ERRORS.invalidParameter],
      ['NotAuthorizedException (password not set yet)', hr.email, COGNITO_ERRORS.cannotReset],
      ['an account whose first password is not set yet', FAKE.newHr.email, undefined],
    ];
    for (const [what, email, scripted] of cases) {
      const other = await step2For(email, scripted);
      expect(other.page, `${what}: step 2 reads exactly as for a real account`).toBe(known.page);
      expect(other.console, `${what}: the console says the same as for a real account`).toEqual(known.console);
    }

    // Step 2 with an unknown email: any code reads as a wrong code, exactly as for a real account.
    const wrongFor = async (email: string) => {
      await page.goto('about:blank');
      const from = watch.console.length;
      await reset.open();
      await reset.request(email);
      await reset.confirm('123456', NEW_PASSWORD);
      await expect(reset.message(WRONG_CODE)).toBeVisible();
      await noCognitoWords(page, `wrong code for ${email}`);
      return { page: await seen(page, email), console: appConsole(watch.console.slice(from), email) };
    };
    const knownWrong = await wrongFor(hr.email);
    expect(cognito!.codeFor(hr.email), 'the real account had a code, and 123456 was not it').not.toBe('123456');
    const unknownWrong = await wrongFor(UNKNOWN);
    expect(unknownWrong.page, 'an unknown email with a code reads as a wrong code, the same as a real account').toBe(knownWrong.page);
    expect(unknownWrong.console).toEqual(knownWrong.console);
  });

  // -------------------------------------------------------------- AC-4
  test('AC-4 A wrong code is said next to Code, keeps the new password, and a right code after it works', async ({ page, cognito, hr }) => {
    noBackendOnly();
    const reset = new Reset(page);
    await reset.open();
    await reset.request(hr.email);
    const code = cognito!.codeFor(hr.email)!;
    const wrong = code === '000000' ? '111111' : '000000';

    await reset.confirm(wrong, NEW_PASSWORD);
    await reset.expectCodeLine(WRONG_CODE, 'a wrong code');
    await expect(reset.password, 'the new password stays in its field').toHaveValue(NEW_PASSWORD);
    await expect(page).toHaveURL(RESET_PATH);
    await noCognitoWords(page, 'a wrong code');

    await reset.code.fill(code);
    await reset.change.click();
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expect(page.getByText(CHANGED, { exact: true })).toBeVisible();
    expect(cognito!.callsTo('ConfirmForgotPassword')).toHaveLength(2);
  });

  // -------------------------------------------------------------- AC-5
  test('AC-5 An expired code says so; "Send a new code" sends one call for the same email, then waits 30 seconds', async ({ page, cognito, hr }) => {
    noBackendOnly();
    await page.clock.install();
    const reset = new Reset(page);
    await reset.open();
    await reset.request(hr.email);
    // Whether or not the first send also starts the wait, it is over after 31 seconds.
    await page.clock.runFor(31_000);
    await expect(reset.resend).toHaveAccessibleName(RESEND);

    const first = cognito!.codeFor(hr.email)!;
    cognito!.expireCode(hr.email);
    await reset.confirm(first, NEW_PASSWORD);
    await expect(reset.message(EXPIRED)).toBeVisible();
    await noCognitoWords(page, 'an expired code');
    await expect(reset.password, 'the new password stays').toHaveValue(NEW_PASSWORD);

    await reset.resend.click();
    await expect(reset.message(NEW_CODE_SENT)).toBeVisible();
    const sends = cognito!.callsTo('ForgotPassword');
    expect(sends, 'one new ForgotPassword').toHaveLength(2);
    expect(sends[1]!.body['Username'], 'for the same email').toBe(hr.email);

    // Out of use for 30 seconds, with the seconds left on it.
    await expect(reset.resend).toHaveAccessibleName(/^Send a new code \((30|29)s\)$/);
    expect(await isDisabled(reset.resend), 'out of use right after a send').toBe(true);
    await page.clock.runFor(5_000);
    await expect(reset.resend).toHaveAccessibleName(/^Send a new code \((2[3-5])s\)$/);
    expect(await isDisabled(reset.resend)).toBe(true);
    await reset.resend.dispatchEvent('click');
    await page.waitForTimeout(300);
    expect(cognito!.callsTo('ForgotPassword'), 'a tap while it waits sends nothing').toHaveLength(2);
    await page.clock.runFor(26_000);
    await expect(reset.resend).toHaveAccessibleName(RESEND);
    expect(await isDisabled(reset.resend), 'in use again after 30 seconds').toBe(false);

    // The new code works.
    const second = cognito!.codeFor(hr.email)!;
    await reset.code.fill(second);
    await reset.change.click();
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expect(page.getByText(CHANGED, { exact: true })).toBeVisible();
    expect(cognito!.callsTo('ConfirmForgotPassword').at(-1)!.body['ConfirmationCode']).toBe(second);
  });

  // -------------------------------------------------------------- AC-6
  test('AC-6 Password rules and code checks are said next to their field in ONB-17\'s words, and nothing is sent', async ({ page, cognito, hr }) => {
    noBackendOnly();
    const reset = new Reset(page);
    await reset.open();

    // Step 1: an empty or malformed email calls nothing.
    for (const bad of ['', 'jane.smith', 'jane smith@x.co.za']) {
      await reset.email.fill(bad);
      await reset.send.click();
      await expect(reset.message(BAD_EMAIL).first(), `"${bad}": ${BAD_EMAIL}`).toBeVisible();
      await expect(reset.heading).toBeVisible();
    }
    expect(cognito!.callsTo('ForgotPassword'), 'no ForgotPassword for a bad email').toHaveLength(0);

    await reset.request(hr.email);
    const code = cognito!.codeFor(hr.email)!;
    await expect(reset.help, 'ONB-17\'s help text under New password').toBeVisible();

    const cases: Array<[string, string, string[]]> = [
      ['11 characters', 'Abcdef1!xyz', [LINE.minLength]],
      ['no upper case', 'abcdefgh1!xyz', [LINE.upper]],
      ['no lower case', 'ABCDEFGH1!XYZ', [LINE.lower]],
      ['no number', 'Abcdefgh!xyzw', [LINE.number]],
      ['no symbol', 'Abcdefgh1xyzw', [LINE.symbol]],
      ['257 characters', `Aa1!${'x'.repeat(253)}`, [LINE.maxLength]],
      ['empty', '', [EMPTY_PASSWORD]],
      ['several rules at once, in ONB-17\'s order', 'abc', [LINE.minLength, LINE.upper, LINE.number, LINE.symbol]],
    ];
    for (const [what, password, lines] of cases) {
      await reset.confirm(code, password);
      await reset.expectPasswordLines(lines, what);
      expect(cognito!.callsTo('ConfirmForgotPassword'), `${what}: no ConfirmForgotPassword`).toHaveLength(0);
    }

    // Code checks, with a good password.
    const codeCases: Array<[string, string, string]> = [
      ['empty code', '', CODE_EMPTY],
      ['5 digits', '12345', CODE_SIX],
      ['letters', 'abcdef', CODE_SIX],
    ];
    for (const [what, c, line] of codeCases) {
      await reset.confirm(c, NEW_PASSWORD);
      await reset.expectCodeLine(line, what);
      expect(cognito!.callsTo('ConfirmForgotPassword'), `${what}: no ConfirmForgotPassword`).toHaveLength(0);
    }

    // The server finds what the page let through: the general line.
    cognito!.failNext('ConfirmForgotPassword', COGNITO_ERRORS.invalidPassword);
    await reset.confirm(code, NEW_PASSWORD);
    await expect.poll(() => cognito!.callsTo('ConfirmForgotPassword').length).toBe(1);
    await expect(page.getByText(GENERAL).first(), 'a server InvalidPasswordException shows the general line').toBeVisible();
    for (const line of Object.values(LINE)) await expect(page.getByText(line), `not "${line}"`).toHaveCount(0);
    await noCognitoWords(page, 'InvalidPasswordException');
    await expect(reset.password).toHaveValue(NEW_PASSWORD);
  });

  // -------------------------------------------------------------- AC-7
  test('AC-7 Limits, no network and other failures are said plainly and clear nothing; a double tap sends one call', async ({ page, cognito, hr }) => {
    noBackendOnly();
    const reset = new Reset(page);
    await reset.open();

    // Step 1.
    for (const [what, error] of [['LimitExceededException', COGNITO_ERRORS.limitExceeded], ['TooManyRequestsException', COGNITO_ERRORS.throttled]] as const) {
      cognito!.failNext('ForgotPassword', error);
      await reset.email.fill(hr.email);
      await reset.send.click();
      await expect(reset.message(TOO_MANY), `step 1, ${what}`).toBeVisible();
      await expect(reset.heading, `step 1, ${what}: stays on step 1`).toBeVisible();
      await expect(reset.email, `step 1, ${what}: the email stays`).toHaveValue(hr.email);
      await noCognitoWords(page, `step 1, ${what}`);
    }
    cognito!.offline = true;
    await reset.send.click();
    await expect(reset.message(OFFLINE), 'step 1, no network').toBeVisible();
    await expect(reset.heading).toBeVisible();
    await expect(reset.email).toHaveValue(hr.email);
    cognito!.offline = false;

    // A double tap on "Send code" sends one call.
    const before = cognito!.callsTo('ForgotPassword').length;
    const releaseSend = cognito!.hold('ForgotPassword');
    await reset.send.dblclick();
    await page.waitForTimeout(300);
    releaseSend();
    await expect(reset.codeHeading).toBeVisible();
    expect(cognito!.callsTo('ForgotPassword').length - before, 'a double tap on "Send code" sends one ForgotPassword').toBe(1);
    const code = cognito!.codeFor(hr.email)!;

    // Step 2.
    await reset.code.fill(code);
    await reset.password.fill(NEW_PASSWORD);
    const kept = async (what: string) => {
      await expect(reset.code, `${what}: the code stays`).toHaveValue(code);
      await expect(reset.password, `${what}: the password stays`).toHaveValue(NEW_PASSWORD);
      await expect(page, `${what}: stays on the page`).toHaveURL(RESET_PATH);
      await noCognitoWords(page, what);
    };
    for (const [what, error] of [['LimitExceededException', COGNITO_ERRORS.limitExceeded], ['TooManyRequestsException', COGNITO_ERRORS.throttled]] as const) {
      cognito!.failNext('ConfirmForgotPassword', error);
      await reset.change.click();
      await expect(reset.message(TOO_MANY), `step 2, ${what}`).toBeVisible();
      await kept(`step 2, ${what}`);
    }
    cognito!.offline = true;
    await reset.change.click();
    await expect(reset.message(OFFLINE), 'step 2, no network').toBeVisible();
    await kept('step 2, no network');
    cognito!.offline = false;
    cognito!.failNext('ConfirmForgotPassword', { type: 'InternalErrorException', message: 'An internal error occurred.' });
    await reset.change.click();
    await expect(reset.message(OTHER), 'step 2, anything else').toBeVisible();
    await kept('step 2, anything else');

    // A double tap on "Change password" sends one call.
    const confirms = cognito!.callsTo('ConfirmForgotPassword').length;
    const releaseConfirm = cognito!.hold('ConfirmForgotPassword');
    await reset.change.dblclick();
    await page.waitForTimeout(300);
    releaseConfirm();
    await expect(page).toHaveURL(ON_SIGN_IN);
    expect(cognito!.callsTo('ConfirmForgotPassword').length - confirms, 'a double tap on "Change password" sends one call').toBe(1);
  });

  // -------------------------------------------------------------- AC-8
  test('AC-8 The code and new password go only to Cognito\'s ConfirmForgotPassword; the email never sits in an address', async ({ page, signIn, cognito, watch, hr }) => {
    noBackendOnly();
    const reset = new Reset(page);
    await signIn.open();
    await signIn.email.fill(hr.email);
    await signIn.forgot.click();
    await reset.send.click();
    await expect(reset.codeHeading).toBeVisible();
    const code = cognito!.codeFor(hr.email)!;
    const wrong = code === '000000' ? '111111' : '000000';
    const secrets = [code, wrong, NEW_PASSWORD, 'Abcdefgh1xyzw'];

    // A broken rule, a wrong code, then the right one; then sign in with the new password.
    await reset.confirm(code, 'Abcdefgh1xyzw');
    await expect(page.getByText(LINE.symbol).first()).toBeVisible();
    await reset.confirm(wrong, NEW_PASSWORD);
    await expect(reset.message(WRONG_CODE)).toBeVisible();
    // Storage, cookies and history while the code and password sit on the page.
    const midway = (await everythingStored(page)) + '\n' + (await watch.history(page)).join('\n');
    await reset.code.fill(code);
    await reset.change.click();
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expect(page.getByText(CHANGED, { exact: true })).toBeVisible();
    const after = (await everythingStored(page)) + '\n' + (await watch.history(page)).join('\n');
    await signIn.password.fill(NEW_PASSWORD);
    await signIn.submit.click();
    await expect(page).toHaveURL(HR_HOME);
    await watch.settled();

    for (const s of secrets) {
      for (const r of watch.requests) {
        expect(r.url, `"${s}" is in no address`).not.toContain(s);
        for (const [k, v] of Object.entries(r.headers)) expect(`${k}: ${v}`, `"${s}" is in no request header`).not.toContain(s);
        if ((r.postData ?? '').includes(s)) {
          expect(`${r.method} ${r.url} ${r.target}`, `"${s}" is only ever sent to Cognito's ConfirmForgotPassword`).toMatch(/^POST https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/? ConfirmForgotPassword$/);
        }
      }
      for (const line of watch.console) expect(line, `"${s}" is in no console line`).not.toContain(s);
      expect(midway, `"${s}" is in no storage, cookie or history entry while on the page`).not.toContain(s);
      expect(after, `"${s}" is in no storage, cookie or history entry after`).not.toContain(s);
      expect(await everythingStored(page), `"${s}" is in nothing stored after signing in`).not.toContain(s);
    }
    // The email: never in an address or a history entry's address.
    for (const a of [...watch.addresses, page.url()]) expect(decodeURIComponent(a), 'the email is never in the address bar').not.toContain(hr.email);
    for (const h of [...midway.split('\n'), ...after.split('\n')].filter((l) => /^(url=|current url=)/.test(l))) {
      expect(decodeURIComponent(h), 'the email is in no history address').not.toContain(hr.email);
    }
    for (const r of watch.requests) expect(decodeURIComponent(r.url), 'the email is in no request address').not.toContain(hr.email);
  });

  // -------------------------------------------------------------- AC-9
  test('AC-9 Signed-in people are sent home; "Back to sign in" and "Use a different email" work', async ({ page, signIn, hr, employee }) => {
    noBackendOnly();
    const reset = new Reset(page);

    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(HR_HOME);
    await page.goto('/forgot-password');
    await expect(page, 'signed-in HR goes to HR home').toHaveURL(HR_HOME);
    await signOutHere(page);

    await signIn.open();
    await signIn.signInAs(employee);
    await expect(page).toHaveURL(START);
    await page.goto('/forgot-password');
    await expect(page, 'a signed-in employee goes to /start').toHaveURL(START);
    await signOutHere(page);

    await reset.open();
    await reset.request(hr.email);
    await reset.different.click();
    await expect(reset.heading, '"Use a different email" goes back to step 1').toBeVisible();
    await expect(reset.email, 'with the email kept').toHaveValue(hr.email);
    await expect(page).toHaveURL(RESET_PATH);
    await reset.back.click();
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expect(signIn.heading).toBeVisible();
  });

  test('AC-9 Sign-in still lands people safely: an employee ignores every returnUrl, HR follows only HR pages on this origin', async ({ page, signIn, employee, hr, baseURL }) => {
    // Folded in from the ONB-23 security review (probes 1 to 3, findings L-1 and L-2): this card changes the
    // sign-in page, so the landing rules are checked on screen here, not only by review.
    noBackendOnly();
    test.setTimeout(180_000);
    const origin = new URL(baseURL!).origin;
    const employeeUrls = ['/set-password', '/dev/parity', '/hr', '/hr/employees/new', '//evil.example', '/\\evil.example', 'https://evil.example', '/%2F%2Fevil.example', '/start/../hr/documents', '/start%2F..%2Fhr', '/dev/design-system', 'javascript:alert(1)', '/start?x=1', '/start#a'];
    for (const r of employeeUrls) {
      await signOutHere(page);
      await page.goto(`/sign-in?returnUrl=${encodeURIComponent(r)}`);
      await expect(signIn.email).toBeVisible();
      await signIn.signInAs(employee);
      await expect.poll(() => new URL(page.url()).pathname, { message: `employee, returnUrl=${r}: lands on /start`, timeout: 20_000 }).toBe('/start');
      expect(new URL(page.url()).origin, `employee, returnUrl=${r}: same origin`).toBe(origin);
    }
    const hrUrls = ['//evil.example', '/\\evil.example', 'https://evil.example', '/%2F%2Fevil.example', '/\t/evil.example', 'javascript:alert(1)', '/start', '/set-password', '/dev/parity', '/dev/design-system'];
    for (const r of hrUrls) {
      await signOutHere(page);
      await page.goto(`/sign-in?returnUrl=${encodeURIComponent(r)}`);
      await expect(signIn.email).toBeVisible();
      await signIn.signInAs(hr);
      await expect.poll(() => new URL(page.url()).pathname, { message: `HR, returnUrl=${r}: lands on an HR page`, timeout: 20_000 }).toMatch(/^\/hr(\/|$)/);
      expect(new URL(page.url()).origin, `HR, returnUrl=${r}: same origin`).toBe(origin);
    }
    // An HR page is still followed.
    await signOutHere(page);
    await page.goto(`/sign-in?returnUrl=${encodeURIComponent('/hr/documents')}`);
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(/\/hr\/documents$/);
  });

  // -------------------------------------------------------------- AC-10
  test('AC-10 Keyboard and screen reader: the whole path by Tab and Enter, focus where it should be, every message announced', async ({ page, signIn, cognito, hr }) => {
    noBackendOnly();
    const reset = new Reset(page);
    await page.clock.install();
    await signIn.open();
    await signIn.email.fill(hr.email);

    // Tab from the Sign in button reaches the link; Enter opens step 1 with focus in Email.
    await signIn.submit.focus();
    for (let i = 0; i < 5 && !(await signIn.forgot.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    await expect(signIn.forgot, 'Tab reaches "Forgot your password?"').toBeFocused();
    await page.keyboard.press('Enter');
    await expect(reset.heading).toBeVisible();
    await expect(reset.email, 'focus starts in Email').toBeFocused();

    // A bad email is announced; Enter sends.
    await reset.email.fill('jane.smith');
    await page.keyboard.press('Enter');
    await expectAnnounced(page, BAD_EMAIL, reset.email);
    await reset.email.fill(hr.email);
    cognito!.failNext('ForgotPassword', COGNITO_ERRORS.limitExceeded);
    await reset.email.press('Enter');
    await expectAnnounced(page, TOO_MANY);
    await reset.email.press('Enter');
    await expect(reset.codeHeading).toBeVisible();
    await expect(reset.code, 'focus starts in Code on step 2').toBeFocused();

    // A broken rule: focus moves to the first error line or the field it describes; announced.
    const code = cognito!.codeFor(hr.email)!;
    await page.keyboard.type(code);
    await page.keyboard.press('Tab');
    await expect(reset.password, 'Tab goes from Code to New password').toBeFocused();
    await page.keyboard.type('Abcdefgh1xyzw');
    await page.keyboard.press('Enter');
    await expectAnnounced(page, LINE.symbol, reset.password);
    const focus = await page.evaluate((line) => {
      const el = document.activeElement;
      return { isInput: el instanceof HTMLInputElement && el.getAttribute('autocomplete') === 'new-password', text: el?.textContent ?? '', line };
    }, LINE.symbol);
    expect(focus.isInput || focus.text.includes(LINE.symbol), 'focus moves to the first error line, or the field it describes').toBe(true);

    // A wrong code is announced.
    await reset.password.fill(NEW_PASSWORD);
    await reset.code.fill(code === '000000' ? '111111' : '000000');
    await reset.password.press('Enter');
    await expectAnnounced(page, WRONG_CODE, reset.code);

    // "Send a new code" by keyboard: a status, announced.
    await page.clock.runFor(31_000);
    await reset.resend.focus();
    await page.keyboard.press('Enter');
    await expectStatus(page, NEW_CODE_SENT);

    // Enter with the right code: the success message on /sign-in is a status.
    await reset.code.fill(cognito!.codeFor(hr.email)!);
    await reset.password.press('Enter');
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expectStatus(page, CHANGED);
  });

  test('AC-10 Phone: both steps and the sign-in page with the success message fit 390 wide, nothing under a top bar, buttons 44 pixels', async ({ page, signIn, cognito, hr }, testInfo) => {
    noBackendOnly();
    test.skip(testInfo.project.name !== 'phone-390', 'The phone criterion: runs at 390 wide.');
    const reset = new Reset(page);

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

    await signIn.open();
    await check('the sign-in page', [signIn.heading, signIn.email, signIn.password, signIn.submit, signIn.forgot], []);

    await reset.open();
    await check('step 1', [reset.heading, reset.lead, reset.email, reset.back], [reset.send]);
    await reset.send.click();
    await check('step 1 with a bad email', [reset.email, reset.message(BAD_EMAIL).first()], [reset.send]);

    await reset.request(hr.email);
    await check('step 2', [reset.codeHeading, reset.message(codeLead(hr.email)), reset.code, reset.password, reset.help, reset.resend, reset.different, reset.footer], [reset.change]);
    await reset.confirm('000000' === cognito!.codeFor(hr.email) ? '111111' : '000000', 'abc');
    await check('step 2 with rule lines', [reset.password, page.getByText(LINE.minLength).first(), page.getByText(LINE.symbol).first()], [reset.change]);
    await reset.confirm(cognito!.codeFor(hr.email) === '000000' ? '111111' : '000000', NEW_PASSWORD);
    await check('step 2 with a wrong code', [reset.code, reset.message(WRONG_CODE)], [reset.change]);

    await reset.confirm(cognito!.codeFor(hr.email)!, NEW_PASSWORD);
    await expect(page).toHaveURL(ON_SIGN_IN);
    // The sign-in button's height is ONB-01's; the phone check here is that everything shows.
    await check('the sign-in page with the success message', [signIn.heading, page.getByText(CHANGED, { exact: true }), signIn.email, signIn.password, signIn.submit, signIn.forgot], []);
  });

  // -------------------------------------------------------------- AC-11
  test('AC-11 cognitoEmailSender sends the code by Postmark, logs no secret, writes the dev sink only for blackhole addresses', async ({}, testInfo) => {
    noBackendOnly();
    onceOnly(testInfo);
    lambdaChecks.emailSender();
  });

  test('AC-11 cognitoPostConfirmation signs the person out everywhere after a reset, and never throws', async ({}, testInfo) => {
    noBackendOnly();
    onceOnly(testInfo);
    lambdaChecks.postConfirmation();
  });

  // -------------------------------------------------------------- AC-12
  test('AC-12 pepla-dev: a test login resets its password by the real email path, signs in with it, and its old refresh token is refused @pepla-dev', async ({ page, signIn, hr }, testInfo) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only, after the merge and deploy.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once, at one width.');
    test.setTimeout(300_000);
    const api = devSetting('employeesApiUrl');
    const clientId = devSetting('clientId');
    const region = devSetting('region');
    const reset = new Reset(page);

    // The run makes its own test login: the HR test login registers a blackhole address and gets the invite
    // link back (ONB-04 AC-5), and the link sets a first password.
    const hrToken = await signInForTokens(page, signIn, hr);
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const email = `e2e.run-${stamp}@blackhole.postmarkapp.com`;
    const res = await page.request.post(`${api}/v1/employees`, {
      headers: { Authorization: `Bearer ${hrToken.id}`, 'content-type': 'application/json', 'Idempotency-Key': randomUUID() },
      data: { first_name: 'Ayanda', last_name: `Run${Math.floor(Math.random() * 1e4)}`, email, phone: '081 234 5678', department: 'Operations', job_title: 'Test starter', planned_start_date: '2026-12-01' },
    });
    expect(res.status(), `register ${email}: ${await res.text()}`).toBe(201);
    const invited = ((await res.json()) as { invite?: { link?: string } }).invite?.link ?? '';
    const token = /#token=([\w-]{43})$/.exec(invited)?.[1];
    expect(token, 'the answer carries invite.link for a test login and a test address').toBeTruthy();
    const firstPassword = `Dev-${randomBytes(6).toString('base64url')}-7!aA`;
    const redeem = await page.request.post(`${api}/v1/invites/redeem`, { headers: { 'content-type': 'application/json' }, data: { token, password: firstPassword } });
    expect(redeem.status(), `redeem: ${await redeem.text()}`).toBe(204);

    // An earlier sign-in: its refresh token must stop working after the reset.
    await signOutHere(page);
    const before = await signInForTokens(page, signIn, { email, password: firstPassword, givenName: 'Ayanda' });
    expect(before.refresh, 'the earlier sign-in has a refresh token').not.toBe('');
    await signOutHere(page);

    // Step 1 in the app; the code from the dev sink table (Postmark's blackhole delivers nothing).
    await reset.open();
    await reset.request(email);
    const code = await sinkCode(email, 90_000);
    expect(code, 'the sender wrote the code to the dev sink').toMatch(/^\d{6}$/);
    const newPassword = `Dev-${randomBytes(6).toString('base64url')}-8#bB`;
    await reset.confirm(code!, newPassword);
    await expect(page).toHaveURL(ON_SIGN_IN, { timeout: 30_000 });
    await expect(page.getByText(CHANGED, { exact: true })).toBeVisible();

    // The new password works, the old one does not, and the old refresh token is refused.
    await signIn.password.fill(newPassword);
    await signIn.submit.click();
    await expect(page).toHaveURL(START, { timeout: 30_000 });
    await signOutHere(page);
    await signIn.open();
    await signIn.signInAs({ email, password: firstPassword });
    await expect(signIn.message(WRONG_PASSWORD), 'the old password is refused').toBeVisible({ timeout: 30_000 });
    const refreshed = await page.request.post(`https://cognito-idp.${region}.amazonaws.com/`, {
      headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
      data: JSON.stringify({ AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: clientId, AuthParameters: { REFRESH_TOKEN: before.refresh } }),
    });
    expect(refreshed.status(), 'the refresh token from before the reset is refused').toBe(400);
    expect(await refreshed.text()).toMatch(/NotAuthorizedException/);

    // An unknown blackhole address reaches step 2 the same way, and no sink row is written.
    const unknown = `e2e.run-${stamp}-nobody@blackhole.postmarkapp.com`;
    await reset.open();
    await reset.request(unknown);
    await expect(reset.message(codeLead(unknown))).toBeVisible();
    expect(await sinkCode(unknown, 20_000), 'no sink row for an address with no account').toBeNull();
    // Both people are removed by the dev cleanup (scripts/ci/cleanup-dev-e2e.py, e2e.run- addresses).
  });

  // -------------------------------------------------------------- AC-13
  test('AC-13 Terraform: the pool triggers, the key policy, the roles, the dev sink, and the build, deploy, alarm and dashboard lists', async ({}, testInfo) => {
    noBackendOnly();
    onceOnly(testInfo);
    terraformChecks.all();
  });

  test('AC-13 Text check: the route, the words, only pp-* components, and no AI', async ({}, testInfo) => {
    noBackendOnly();
    onceOnly(testInfo);
    const app = join(WEB, 'src', 'app');
    const routes = readFileSync(join(app, 'app.routes.ts'), 'utf8');
    const block = routeBlock(routes, 'forgot-password');
    expect(block, 'app.routes.ts has a forgot-password route').not.toBeNull();
    expect(block!, '/forgot-password is behind signedOutGuard').toMatch(/canActivate\s*:\s*\[\s*signedOutGuard\s*\]/);
    expect(block!).toMatch(/title\s*:\s*['"`]Reset your password · Naleko People['"`]/);

    // New words live in RESET_MESSAGES beside SIGN_IN_MESSAGES; reused words are imported, not copied.
    const messages = readFileSync(join(app, 'core', 'auth', 'auth.messages.ts'), 'utf8');
    expect(messages, 'auth.messages.ts exports RESET_MESSAGES').toMatch(/export\s+const\s+RESET_MESSAGES\b/);
    const src = walk(join(WEB, 'src')).filter((f) => /\.(ts|html)$/.test(f) && !f.endsWith('.spec.ts'));
    for (const words of [TOO_MANY, OFFLINE, BAD_EMAIL]) {
      const copies = src.filter((f) => readFileSync(f, 'utf8').includes(words)).map(rel);
      expect(copies, `"${words}" is written once (auth.messages.ts) and imported elsewhere`).toEqual(['pepla-web/src/app/core/auth/auth.messages.ts']);
    }
    for (const words of Object.values(LINE)) {
      const copies = src.filter((f) => readFileSync(f, 'utf8').includes(words));
      expect(copies.length, `ONB-17's rule line "${words}" is written once and reused`).toBe(1);
    }
    const service = readFileSync(join(app, 'core', 'auth', 'auth.service.ts'), 'utf8');
    expect(service, 'auth.service.ts has requestPasswordReset').toMatch(/\brequestPasswordReset\s*\(/);
    expect(service, 'auth.service.ts has confirmPasswordReset').toMatch(/\bconfirmPasswordReset\s*\(/);

    // The card's own new files (found by their words) never say Masked, credentials or Work email, and
    // nothing new under src or the two Lambdas reaches an AI service.
    const before = new Set(readFileSync(join(HERE, 'support', 'onb-24', 'src-files.f56421a.txt'), 'utf8').split('\n').filter(Boolean));
    const mine = src.filter((f) => !before.has(rel(f)) && /Reset your password|Enter the code|RESET_MESSAGES|requestPasswordReset/.test(readFileSync(f, 'utf8')));
    expect(mine.length, 'the card adds a file for the reset page').toBeGreaterThan(0);
    const resetWords = /export\s+const\s+RESET_MESSAGES\s*=\s*\{[\s\S]*?\}/.exec(messages)?.[0] ?? '';
    expect(resetWords, 'RESET_MESSAGES: never "Masked", "credentials" or "Work email"').not.toMatch(/\bmasked\b|\bcredentials\b|work email/i);
    const lambdas = ['cognitoEmailSender', 'cognitoPostConfirmation'].flatMap((d) => (existsSync(join(REPO, 'lambda', d)) ? walk(join(REPO, 'lambda', d)).filter((f) => /\.(m?js|json)$/.test(f) && !/node_modules|package-lock/.test(f)) : []));
    expect(lambdas.length, 'both Lambdas exist').toBeGreaterThanOrEqual(2);
    for (const f of [...mine, ...lambdas]) {
      const text = readFileSync(f, 'utf8');
      expect(text, `${rel(f)}: never "Masked"`).not.toMatch(/\bmasked\b/i);
      expect(text, `${rel(f)}: never "credentials"`).not.toMatch(/\bcredentials\b/i);
      expect(text, `${rel(f)}: never "Work email"`).not.toMatch(/work email/i);
      expect(text, `${rel(f)}: no AI service`).not.toMatch(/bedrock|anthropic|openai|textract|comprehend|sagemaker/i);
    }

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

/** A setting CI writes into environment.ts for pepla-dev (never the placeholder). */
function devSetting(key: 'employeesApiUrl' | 'clientId' | 'region'): string {
  const file = join(WEB, 'src', 'environments', 'environment.ts');
  const m = new RegExp(`${key}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`).exec(existsSync(file) ? readFileSync(file, 'utf8') : '');
  expect(m, `environment.ts has ${key}`).toBeTruthy();
  expect(m![1], `${key} is pepla-dev's, not the placeholder`).not.toMatch(/\.invalid\b|not-configured|NotConfigured/);
  return m![1]!.replace(/\/+$/, '');
}

/** Signs in on /sign-in and returns the ID and refresh tokens Cognito handed over. */
async function signInForTokens(page: Page, signIn: SignInPage, login: Login): Promise<{ id: string; refresh: string }> {
  const tokens = { id: '', refresh: '' };
  const listen = async (r: import('@playwright/test').Response) => {
    if (!/cognito-idp\.[a-z0-9-]+\.amazonaws\.com/.test(r.url()) || r.request().method() !== 'POST') return;
    try {
      const b = (await r.json()) as { AuthenticationResult?: { IdToken?: string; RefreshToken?: string } };
      if (b.AuthenticationResult?.IdToken) tokens.id = b.AuthenticationResult.IdToken;
      if (b.AuthenticationResult?.RefreshToken) tokens.refresh = b.AuthenticationResult.RefreshToken;
    } catch {
      /* not JSON */
    }
  };
  page.on('response', listen);
  await signIn.open();
  await signIn.signInAs(login);
  await expect.poll(() => tokens.id, { message: `Cognito hands ${login.email} an ID token`, timeout: 30_000 }).not.toBe('');
  page.off('response', listen);
  return tokens;
}

/**
 * The code the sender wrote to the pepla-dev sink table for `email`, or null when none arrives in `waitMs`.
 * Reads with the AWS CLI and the run's own pepla-dev role (the dev E2E job). Never prod.
 */
async function sinkCode(email: string, waitMs: number): Promise<string | null> {
  const table = process.env['RESET_TEST_SINK_TABLE'] ?? 'naleko-people-dev-reset-test-sink';
  expect(table, 'the sink is a dev table').toMatch(/-dev-/);
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    const out = execFileSync('aws', ['dynamodb', 'get-item', '--region', 'af-south-1', '--table-name', table, '--key', JSON.stringify({ email: { S: email } }), '--consistent-read', '--output', 'json'], { encoding: 'utf8' });
    const item = out.trim() ? (JSON.parse(out) as { Item?: { code?: { S?: string } } }).Item : undefined;
    if (item?.code?.S) return item.code.S;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  return null;
}
