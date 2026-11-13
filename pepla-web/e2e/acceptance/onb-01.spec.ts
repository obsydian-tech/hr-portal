import AxeBuilder from '@axe-core/playwright';
import { COGNITO_ERRORS } from './support/cognito-fake';
import {
  HR_HOME,
  ON_DEV,
  ON_SIGN_IN,
  avatarButton,
  expect,
  expectAnnounced,
  expectNoSession,
  test,
} from './support/fixtures';

/**
 * ONB-01 · HR signs in to Naleko People (Jira NH-147).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: https://claude.ai/artifact/6CCqqjLxwN6Jtt2szsKjZC
 * Board: journey "HR adds a new employee", step 1, desktop and phone.
 *
 * Each test runs at 1280 and 390 wide (projects in ./playwright.config.ts).
 * Tests tagged @pepla-dev also run against pepla-dev with the seeded logins.
 *
 * These files are locked once Iggie accepts them: see ./README.md.
 */

const NOT_HR = 'This sign-in is for HR. New employees use the link in their welcome email.';
const WRONG = 'Email or password is incorrect.';
const TOO_MANY = 'Too many attempts. Try again in a few minutes.';
const OFFLINE = "We can't reach Naleko People. Check your connection and try again.";
const SET_PASSWORD = 'Use the link in your invite email to set your password.';
const BAD_EMAIL = 'Enter a valid work email.';
const NO_PASSWORD = 'Enter your password.';

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend journey only (ONB-01 test layers).');

test.describe('ONB-01 HR sign-in', () => {
  test('AC-1 Sign-in page shows the mark, Work email, Password, Sign in and the Forgot your password line, inside the page', async ({ page, signIn }) => {
    noBackendOnly();
    await signIn.open();

    const parts = [signIn.mark, signIn.heading, signIn.email, signIn.password, signIn.submit, signIn.forgot];
    for (const part of parts) await expect(part).toBeVisible();

    // Laid out as the board screen: mark, then the card (Sign in, Work email,
    // Password, Sign in button), then the Forgot your password line, top to bottom.
    const boxes = [];
    for (const part of parts) boxes.push((await part.boundingBox())!);
    for (let i = 1; i < boxes.length; i++) {
      expect(boxes[i]!.y, `item ${i + 1} sits below item ${i}`).toBeGreaterThanOrEqual(boxes[i - 1]!.y + boxes[i - 1]!.height - 1);
    }

    // Nothing outside its box: no sideways scroll, every part inside the window,
    // and the fields and button inside the form.
    const viewport = page.viewportSize()!;
    const scroll = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    expect(scroll.doc, 'no sideways scroll').toBeLessThanOrEqual(scroll.win);
    for (const [i, b] of boxes.entries()) {
      expect(b.x, `item ${i + 1} left edge`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `item ${i + 1} right edge`).toBeLessThanOrEqual(viewport.width);
    }
    const form = page.getByRole('form', { name: 'Sign in' }).or(page.locator('form')).first();
    const f = (await form.boundingBox())!;
    for (const field of [signIn.email, signIn.password, signIn.submit]) {
      const b = (await field.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(f.x - 1);
      expect(b.x + b.width).toBeLessThanOrEqual(f.x + f.width + 1);
      expect(b.y + b.height).toBeLessThanOrEqual(f.y + f.height + 1);
    }
    await expect(signIn.email).toHaveAttribute('type', 'email');
    await expect(signIn.password).toHaveAttribute('type', 'password');
  });

  test('AC-2 Email and password are checked before anything is sent', async ({ signIn, cognito, hr }) => {
    noBackendOnly();
    await signIn.open();

    // Empty email.
    await signIn.password.fill(hr.password);
    await signIn.submit.click();
    await expect(signIn.message(BAD_EMAIL)).toBeVisible();
    await expect(signIn.email).toBeFocused();

    // Badly formed email.
    for (const bad of ['jane.smith', 'jane.smith@', 'jane smith@mokoena-logistics.co.za']) {
      await signIn.email.fill(bad);
      await signIn.submit.click();
      await expect(signIn.message(BAD_EMAIL)).toBeVisible();
      await expect(signIn.email).toBeFocused();
    }

    // Good email, empty password.
    await signIn.email.fill(hr.email);
    await signIn.password.fill('');
    await signIn.submit.click();
    await expect(signIn.message(NO_PASSWORD)).toBeVisible();
    await expect(signIn.password).toBeFocused();

    expect(cognito!.calls, 'nothing is sent to Cognito').toEqual([]);

    // Any well-formed address is allowed, whatever the domain: no company-domain rule.
    for (const ok of ['jane.smith@gmail.com', 'jane@outlook.com', 'jane.smith@mokoena-logistics.co.za']) {
      const before = cognito!.signInCalls().length;
      await signIn.signInAs({ email: ok, password: hr.password });
      await expect.poll(() => cognito!.signInCalls().length, `${ok} is sent to Cognito`).toBeGreaterThan(before);
      await expect(signIn.message(BAD_EMAIL)).toHaveCount(0);
    }
  });

  test('AC-3 HR signs in and lands on HR home @pepla-dev', async ({ page, signIn, hr }) => {
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(HR_HOME);
    await expect(page.getByRole('heading', { name: `Welcome back, ${hr.givenName}`, exact: true })).toBeVisible();
  });

  test('AC-4 An account outside hr_staff is refused and keeps no session @pepla-dev', async ({ page, signIn, employee }) => {
    await signIn.open();
    await signIn.signInAs(employee);
    await expect(signIn.message(NOT_HR)).toBeVisible();
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expectNoSession(page);

    await page.goto(HR_HOME);
    await expect(page).toHaveURL(ON_SIGN_IN);
  });

  test('AC-5 Wrong email or password shows one message and clears the password @pepla-dev', async ({ page, signIn, cognito, hr }) => {
    const unknown = `nobody-${Date.now()}@blackhole.postmarkapp.com`;
    await signIn.open();

    // Unknown email.
    await signIn.signInAs({ email: unknown, password: hr.password });
    await expect(signIn.message(WRONG)).toBeVisible();
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expect(signIn.password).toHaveValue('');

    // Known email, wrong password. Same message: it never says which one.
    cognito?.rejectNextSignIn(COGNITO_ERRORS.wrongPassword);
    await signIn.signInAs({ email: hr.email, password: `${hr.password}-wrong` });
    await expect(signIn.message(WRONG)).toBeVisible();
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expect(signIn.password).toHaveValue('');
    await expect(page.getByText(/does not exist|not found|incorrect password|wrong password/i)).toHaveCount(0);
  });

  test('AC-6 Too many attempts shows the wait message', async ({ page, signIn, cognito, hr }) => {
    noBackendOnly();
    await signIn.open();

    for (const reason of [COGNITO_ERRORS.lockedOut, COGNITO_ERRORS.throttled]) {
      cognito!.rejectNextSignIn(reason);
      await signIn.signInAs(hr);
      await expect(signIn.message(TOO_MANY), `after ${reason.type}: ${reason.message}`).toBeVisible();
      await expect(signIn.message(WRONG)).toHaveCount(0);
      await expect(page).toHaveURL(ON_SIGN_IN);
    }
  });

  test('AC-7 No connection shows the connection message and keeps the email', async ({ page, context, signIn, cognito, hr }) => {
    noBackendOnly();
    await signIn.open();
    await signIn.fill(hr);

    cognito!.offline = true;
    await context.setOffline(true);
    await signIn.submit.click();

    await expect(signIn.message(OFFLINE)).toBeVisible();
    await expect(signIn.email).toHaveValue(hr.email);
    await expect(page).toHaveURL(ON_SIGN_IN);
  });

  test('AC-8 An account whose password is not set yet is sent to the invite email', async ({ page, signIn, newHr }) => {
    noBackendOnly();
    await signIn.open();
    await signIn.signInAs(newHr);

    await expect(signIn.message(SET_PASSWORD)).toBeVisible();
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expectNoSession(page);
    await page.goto(HR_HOME);
    await expect(page).toHaveURL(ON_SIGN_IN);
  });

  test('AC-9 A signed-out visit to an HR page goes to sign in, then back to that page @pepla-dev', async ({ page, signIn, hr }) => {
    const askedFor = `${HR_HOME}?view=ac-9`;
    await page.goto(askedFor);
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expect(signIn.email).toBeVisible();

    await signIn.signInAs(hr);
    await expect(page).toHaveURL(askedFor);
    await expect(page.getByRole('heading', { name: `Welcome back, ${hr.givenName}`, exact: true })).toBeVisible();
  });

  test('AC-10 Sign out from the avatar menu ends the session @pepla-dev', async ({ page, signIn, hr }) => {
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(HR_HOME);

    await avatarButton(page).click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expectNoSession(page);

    await page.goto(HR_HOME);
    await expect(page).toHaveURL(ON_SIGN_IN);
  });

  test('AC-11 Keyboard only: visible focus in order, Enter submits, messages are announced', async ({ page, signIn, cognito, hr, employee }) => {
    noBackendOnly();
    await signIn.open();

    // Tab from the top of the page through every control, in order. Focus is
    // visible when the control looks different focused and not focused.
    const order: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        (window as unknown as { __stop: HTMLElement }).__stop = el;
        const r = el.getBoundingClientRect();
        const label = el.getAttribute('aria-label') ?? (el instanceof HTMLInputElement ? el.labels?.[0]?.textContent : el.textContent) ?? '';
        return { label: label.replace(/\s+/g, ' ').trim(), x: r.x, y: r.y, width: r.width, height: r.height };
      });
      if (!stop) break;
      const pad = 6;
      const clip = { x: Math.max(0, stop.x - pad), y: Math.max(0, stop.y - pad), width: stop.width + 2 * pad, height: stop.height + 2 * pad };
      const focused = await page.screenshot({ clip, animations: 'disabled' });
      await page.evaluate(() => (window as unknown as { __stop: HTMLElement }).__stop.blur());
      const unfocused = await page.screenshot({ clip, animations: 'disabled' });
      await page.evaluate(() => (window as unknown as { __stop: HTMLElement }).__stop.focus());
      expect(focused.equals(unfocused), `focus is visible on "${stop.label}"`).toBe(false);
      order.push(stop.label);
    }
    const at = (name: RegExp) => order.findIndex((l) => name.test(l));
    expect(at(/^Work email$/), `tab order was: ${order.join(' → ')}`).toBeGreaterThanOrEqual(0);
    expect(at(/^Password$/)).toBeGreaterThan(at(/^Work email$/));
    expect(at(/^Sign in$/)).toBeGreaterThan(at(/^Password$/));

    // Field messages are announced.
    await signIn.email.focus();
    await page.keyboard.press('Enter');
    await expectAnnounced(page, BAD_EMAIL, signIn.email);
    await signIn.email.fill(hr.email);
    await signIn.password.focus();
    await page.keyboard.press('Enter');
    await expectAnnounced(page, NO_PASSWORD, signIn.password);
    expect(cognito!.calls).toEqual([]);

    // Enter in the password field submits; page messages are announced.
    await signIn.password.fill('typed-with-keys');
    cognito!.rejectNextSignIn(COGNITO_ERRORS.wrongPassword);
    await signIn.password.press('Enter');
    await expect.poll(() => cognito!.signInCalls().length, 'Enter sent the sign-in').toBeGreaterThan(0);
    await expectAnnounced(page, WRONG);

    cognito!.rejectNextSignIn(COGNITO_ERRORS.lockedOut);
    await signIn.password.fill('typed-with-keys');
    await signIn.password.press('Enter');
    await expectAnnounced(page, TOO_MANY);

    await signIn.email.fill(employee.email);
    await signIn.password.fill(employee.password);
    await signIn.password.press('Enter');
    await expectAnnounced(page, NOT_HR);
  });

  test('AC-12 axe finds no serious or critical issues', async ({ page, signIn, cognito, hr }) => {
    noBackendOnly();
    const scan = async (state: string) => {
      const results = await new AxeBuilder({ page }).analyze();
      const bad = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help}`);
      expect(bad, `axe on ${state}`).toEqual([]);
    };

    await signIn.open();
    await scan('the empty sign-in page');

    await signIn.submit.click();
    await expect(signIn.message(BAD_EMAIL)).toBeVisible();
    await scan('the page with a field message');

    cognito!.rejectNextSignIn(COGNITO_ERRORS.wrongPassword);
    await signIn.signInAs(hr);
    await expect(signIn.message(WRONG)).toBeVisible();
    await scan('the page with a sign-in message');
  });
});
