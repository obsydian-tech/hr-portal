import { expect, test } from '@playwright/test';
import { ON_DEV } from './support/fixtures';
import { OldApp, oldAppText, type CognitoAnswer } from './support/ten-08/old-app';

/**
 * TEN-08 · The old portal signs in with email only (Jira NH-200).
 * Spec: onboarding-cards/specs/TEN-08.md (rescoped 16 Nov 2026, Iggie: "sign in, email only").
 * One test per acceptance criterion, written from the card before any code.
 *
 * The old portal (hr-portal/) has no acceptance set-up of its own, so these tests run its
 * real AuthService and LoginComponent in Node through support/ten-08/old-app.ts, with a
 * stand-in Cognito and every HTTP call recorded and refused. No browser, no AWS, no AI.
 * They run once, in the desktop-1280 project, in the no-backend run. Nothing runs on pepla-dev.
 *
 * These files are locked once accepted: see ./README.md.
 */

const AUTH = 'app/core/services/auth.service.ts';
const LOGIN = 'app/features/login/login.component.ts';
const LOGIN_HTML = 'app/features/login/login.component.html';
const PASSWORD = 'Blue-kettle-7!x';

/** The message the old sign-in page shows today for a wrong email or password (unchanged by this card). */
const WRONG_SIGN_IN = 'Incorrect email or password.';
const NOT_AUTHORIZED: CognitoAnswer = { kind: 'error', code: 'NotAuthorizedException', message: 'Incorrect username or password.' };

const HR = {
  sub: 'hr-sub-ten08',
  email: 'john.doe@example.com',
  given_name: 'John',
  family_name: 'Doe',
  'custom:staff_id': 'AS00001',
  'custom:employee_id': '',
  'custom:role': 'hr_staff',
  'cognito:groups': ['hr_staff', 'naleko-onboarding-hr'],
};
const EMPLOYEE = {
  sub: 'emp-sub-ten08',
  email: 'jane.smith@example.com',
  given_name: 'Jane',
  family_name: 'Smith',
  'custom:staff_id': '',
  'custom:employee_id': 'EMP-0000014',
  'custom:role': 'employee',
  'cognito:groups': ['employee'],
};

type Login = {
  username: string;
  password: string;
  errorMessage: () => string;
  onLogin: () => Promise<void>;
};
type Auth = {
  login: (u: string, p: string) => Promise<{ status: string; message?: string; user?: { email: string; fullName: string } }>;
  isAuthenticated: () => boolean;
};

/** Signs in on the old sign-in page (the real LoginComponent and AuthService) with what a person typed. */
async function signInOnPage(typed: string, answer: CognitoAnswer) {
  const app = new OldApp();
  app.answer = answer;
  const page = app.create<Login>(LOGIN, 'LoginComponent');
  page.username = typed;
  page.password = PASSWORD;
  await page.onLogin();
  return { app, page, auth: app.create<Auth>(AUTH, 'AuthService') };
}

test.describe('TEN-08 The old portal signs in with email only', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(ON_DEV, 'No-backend run only: these run the old app in Node against a stand-in Cognito.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once: no browser, so the width does not matter.');
  });

  test('AC-1 An email signs in as before', async () => {
    // The service on its own: the email is sent trimmed, the password as typed, and the person is signed in.
    const app = new OldApp();
    app.answer = { kind: 'success', payload: HR };
    const auth = app.create<Auth>(AUTH, 'AuthService');
    const result = await auth.login(' john.doe@example.com ', PASSWORD);

    expect(app.signIns, 'one sign-in is sent to Cognito').toHaveLength(1);
    expect(app.signIns[0], 'Cognito gets the email trimmed and the password as typed').toEqual({
      userUsername: 'john.doe@example.com',
      detailsUsername: 'john.doe@example.com',
      password: PASSWORD,
    });
    expect(result.status, 'the sign-in succeeds').toBe('SUCCESS');
    expect(result.user?.email).toBe('john.doe@example.com');
    expect(result.user?.fullName).toBe('John Doe');
    expect(auth.isAuthenticated(), 'the service holds the signed-in person').toBe(true);
    expect(app.http, 'no HTTP call is made').toEqual([]);

    // Through the page: HR lands on the platform home, an employee on their own page, as today.
    const hr = await signInOnPage('  john.doe@example.com', { kind: 'success', payload: HR });
    expect(hr.app.signIns.map((s) => s.userUsername)).toEqual(['john.doe@example.com']);
    expect(hr.page.errorMessage(), 'no message on a good sign-in').toBe('');
    expect(hr.app.navigations, 'HR goes to the platform home').toEqual([['/platform/home']]);
    expect(hr.app.http).toEqual([]);

    const emp = await signInOnPage('jane.smith@example.com ', { kind: 'success', payload: EMPLOYEE });
    expect(emp.app.signIns.map((s) => s.userUsername)).toEqual(['jane.smith@example.com']);
    expect(emp.app.navigations, 'an employee goes to their own page').toEqual([['/employees', 'EMP-0000014']]);
    expect(emp.app.http).toEqual([]);

    // A wrong password for an email still shows the page's usual message.
    const wrong = await signInOnPage('john.doe@example.com', NOT_AUTHORIZED);
    expect(wrong.app.signIns).toHaveLength(1);
    expect(wrong.page.errorMessage()).toBe(WRONG_SIGN_IN);
    expect(wrong.app.navigations).toEqual([]);
  });

  test('AC-2 Staff and employee numbers are not looked up', async () => {
    const cases = [
      { typed: 'AS00001', sent: 'AS00001' },
      { typed: 'as00006', sent: 'as00006' },
      { typed: 'AS99999', sent: 'AS99999' },
      { typed: 'EMP-0000001', sent: 'EMP-0000001' },
      { typed: ' emp-0000014 ', sent: 'emp-0000014' },
    ];
    for (const c of cases) {
      const { app, page } = await signInOnPage(c.typed, NOT_AUTHORIZED);
      expect(app.signIns, `"${c.typed}": one sign-in is sent to Cognito`).toHaveLength(1);
      expect(app.signIns[0].userUsername, `"${c.typed}": Cognito gets it as typed (trimmed), not a looked-up email`).toBe(c.sent);
      expect(app.signIns[0].detailsUsername, `"${c.typed}": the sign-in details carry it as typed (trimmed)`).toBe(c.sent);
      expect(app.http, `"${c.typed}": no HTTP call (no /v1/employees/lookup)`).toEqual([]);
      expect(page.errorMessage(), `"${c.typed}": the page shows its usual wrong email or password message`).toBe(WRONG_SIGN_IN);
      expect(app.navigations, `"${c.typed}": nobody is signed in`).toEqual([]);
    }

    // The service on its own answers the same, and never calls the lookup route.
    const app = new OldApp();
    app.answer = NOT_AUTHORIZED;
    const auth = app.create<Auth>(AUTH, 'AuthService');
    const result = await auth.login('EMP-0000001', PASSWORD);
    expect(result).toEqual({ status: 'ERROR', message: WRONG_SIGN_IN });
    expect(app.http).toEqual([]);
    expect(auth.isAuthenticated()).toBe(false);
  });

  test('AC-3 The page says Email', () => {
    const html = oldAppText(LOGIN_HTML);
    const label = /<label\b[^>]*\bfor="username"[^>]*>([\s\S]*?)<\/label>/.exec(html);
    expect(label, 'the sign-in field keeps its label (for="username")').not.toBeNull();
    expect(label![1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(), 'the label is exactly "Email"').toBe('Email');

    const input = /<input\b[^>]*\bid="username"[^>]*>/.exec(html);
    expect(input, 'the sign-in field is still there (id="username")').not.toBeNull();
    expect(input![0], 'the sign-in field has no placeholder').not.toMatch(/\bplaceholder\s*=/i);

    expect(html, 'the old placeholder is gone').not.toContain('e.g. AS00001 or EMP-0000001');
    expect(html, '"Staff ID" is gone from the sign-in page').not.toMatch(/staff\s+id/i);
    expect(html, '"Employee ID" is gone from the sign-in page').not.toMatch(/employee\s+id/i);
    expect(html, 'never "Work email"').not.toMatch(/work\s+email/i);

    const auth = oldAppText(AUTH);
    expect(auth, 'auth.service.ts no longer imports hr-staff').not.toMatch(/(from|import|require\()\s*['"][^'"]*hr-staff['"]/);
  });
});
