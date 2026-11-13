import { CognitoFake } from '../acceptance/support/cognito-fake';
import { HELP_JOHAN_DETAIL, HELP_NEW_EMPLOYEES, HELP_PEOPLE } from '../fixtures/help-company';
import { expect, test } from '../support/help';

/**
 * HELP-02 · Help pictures and video: HR sees who is starting (Jira NH-159).
 * Spec: /mnt/project-files/onboarding-cards/specs/HELP-02.md
 *
 * Pieter van Wyk, HR at the fake company Sunbird Bakery, is on HR home, opens the new employee
 * Johan Botha and scrolls to his documents.
 *
 * Normal run: checks the journey. Help mode (HELP_SHOTS=1): the same steps, with captions, and
 * these files appear in help/media/<desktop|phone>/who-is-starting/
 *   01-hr-home.png, 02-employee-page.png, 03-documents.png, hr-opens-new-employee.webm
 * Pictures arrive only through the help retake pull request.
 *
 * No backend: the browser answers Cognito with the locked fake, GET /v1/employees with Sunbird
 * Bakery's new employees and Johan's page with HELP_JOHAN_DETAIL. Every person, email, date and
 * file name comes from e2e/fixtures/help-company.ts. Any request to another host fails the
 * journey, except the Google Fonts files. Show is never pressed: the ID number stays hidden.
 * Nothing here calls an AI service.
 */

const hr = HELP_PEOPLE.find((p) => p.key === 'hr')!;
const [givenName = '', ...familyName] = hr.name.split(' ');
const johan = HELP_NEW_EMPLOYEES.find((e) => e.email === HELP_JOHAN_DETAIL.employee.email)!;
const johanName = `${johan.first_name} ${johan.last_name}`;

// Made up, only ever typed into the fake. It is a password field, so pictures show dots.
const MADE_UP_PASSWORD = 'winter-protea-2026';

const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

test('HR sees who is starting', async ({ page, context, help, baseURL }) => {
  help.video('who-is-starting/hr-opens-new-employee');

  const appHost = new URL(baseURL!).host;
  const refused: string[] = [];
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.host === appHost || FONT_HOSTS.has(url.host)) return route.fallback();
    refused.push(url.href);
    return route.abort('blockedbyclient');
  });

  const fake = new CognitoFake([{ email: hr.email, givenName, familyName: familyName.join(' '), groups: ['hr_staff'] }]);
  await fake.install(context);

  // Both APIs answer GET with a Bearer token only; anything else is refused. Johan is the only person answered.
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, OPTIONS' };
  const answer = (body: unknown) => (route: import('@playwright/test').Route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.method() !== 'GET' || !/^Bearer \S+$/.test(req.headers()['authorization'] ?? '')) {
      return route.fulfill({ status: 401, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Unauthorized' }) });
    }
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  };
  await context.route(
    (url) => /\/v1\/employees$/.test(url.pathname) && url.host !== appHost,
    answer({
      items: HELP_NEW_EMPLOYEES.map((p) => ({ ...p, middle_name: '', phone: '', job_title: '', id_number_last4: '', hr_staff_email: hr.email })),
      count: HELP_NEW_EMPLOYEES.length,
    }),
  );
  await context.route((url) => url.pathname === `/v1/employees/${johan.employee_id}/verifications` && url.host !== appHost, answer(HELP_JOHAN_DETAIL));

  // Sign in with no captions, so the video starts on HR home.
  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(hr.email);
  await page.getByLabel('Password', { exact: true }).fill(MADE_UP_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome back, ${givenName}`, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: johanName, exact: true })).toBeVisible();
  await help.shot('who-is-starting/01-hr-home');

  await help.open(johanName);
  await expect(page).toHaveURL(new RegExp(`/hr/employees/${johan.employee_id}$`));
  await expect(page.getByRole('heading', { name: johanName, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  await help.shot('who-is-starting/02-employee-page');

  await help.scrollTo('Documents');
  await help.shot('who-is-starting/03-documents');
  // Hold on the documents a moment so the video ends on them.
  if (help.on) await page.waitForTimeout(2000);

  expect(refused, 'the page asked a host other than the app, the Cognito fake, the two fake APIs or the font files').toEqual([]);
});
