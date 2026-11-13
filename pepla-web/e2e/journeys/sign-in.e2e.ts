import { CognitoFake } from '../acceptance/support/cognito-fake';
import { HELP_NEW_EMPLOYEES, HELP_PEOPLE } from '../fixtures/help-company';
import { expect, test } from '../support/help';

/**
 * HELP-01 · Help pictures and video: HR signs in (Jira NH-149).
 * Spec: https://claude.ai/artifact/2ymwurnoSSuNJZFDZi4VUN
 *
 * Pieter van Wyk, the HR person of the fake company Sunbird Bakery, opens the
 * sign-in page, fills in his email and password and signs in to HR home.
 *
 * Normal run: checks the journey. Help mode (HELP_SHOTS=1): the same steps,
 * with captions, and these files appear in help/media/<desktop|phone>/sign-in/
 *   01-sign-in-page.png, 02-filled-in.png, 03-hr-home.png, hr-signs-in.webm
 * Pictures arrive only through the help retake pull request.
 *
 * No backend: the browser answers Cognito with the fake from the acceptance
 * tests (read only, never copied). Any request to another host fails the
 * journey, except the Inter and Manrope font files from Google Fonts.
 * The employees API is answered the same way, with Sunbird Bakery's new employees from
 * e2e/fixtures/help-company.ts, so HR home shows the help company's people and counts.
 * Nothing here calls an AI service.
 */

const hr = HELP_PEOPLE.find((p) => p.key === 'hr')!;
const [givenName = '', ...familyName] = hr.name.split(' ');

// Made up, only ever typed into the fake. It is a password field, so pictures show dots.
const MADE_UP_PASSWORD = 'winter-protea-2026';

// Font files are the one outside host the app needs: the Google Fonts stylesheet and its files.
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

test('HR signs in', async ({ page, context, help, baseURL }) => {
  help.video('sign-in/hr-signs-in');

  // Everything that is not the app, the Cognito fake or the font files is refused and counted.
  const appHost = new URL(baseURL!).host;
  const refused: string[] = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.host === appHost || FONT_HOSTS.has(url.host)) return route.fallback();
    refused.push(url.href);
    return route.abort('blockedbyclient');
  });

  // Installed after the catch-all, so it answers Cognito first.
  const fake = new CognitoFake([{ email: hr.email, givenName, familyName: familyName.join(' '), groups: ['hr_staff'] }]);
  await fake.install(context);

  // The employees API answers with the help company's new employees only (GET /v1/employees on any host but the app).
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, OPTIONS' };
  await context.route(
    (url) => /\/v1\/employees$/.test(url.pathname) && url.host !== appHost,
    (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (req.method() !== 'GET' || !/^Bearer \S+$/.test(req.headers()['authorization'] ?? '')) {
        return route.fulfill({ status: 401, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Unauthorized' }) });
      }
      const items = HELP_NEW_EMPLOYEES.map((p) => ({ ...p, middle_name: '', phone: '', job_title: '', id_number_last4: '', hr_staff_email: hr.email }));
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ items, count: items.length }) });
    },
  );

  await page.goto('/sign-in');
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await help.shot('sign-in/01-sign-in-page');

  await help.fill('Email', hr.email);
  await help.fill('Password', MADE_UP_PASSWORD);
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await help.shot('sign-in/02-filled-in');

  await help.tap('Sign in');
  await expect(page.getByRole('heading', { name: `Welcome back, ${givenName}`, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/hr(\/|\?|$)/);
  await help.shot('sign-in/03-hr-home');
  // Stay on HR home a moment so the video ends on it.
  if (help.on) await page.waitForTimeout(1500);

  expect(refused, 'the page asked a host other than the app, the Cognito fake or the font files').toEqual([]);
});
