import { CognitoFake } from '../acceptance/support/cognito-fake';
import { HELP_NEW_EMPLOYEES, HELP_PEOPLE, helpJohanDetail } from '../fixtures/help-company';
import { expect, test } from '../support/help';

/**
 * HELP-02 · Help pictures and video: HR sees who is starting (Jira NH-159).
 * Spec: /mnt/project-files/onboarding-cards/specs/HELP-02.md
 *
 * Pieter van Wyk, the HR person of the fake company Sunbird Bakery, is on HR
 * home. He opens one new employee and scrolls to that person's documents.
 *
 * Normal run: checks the journey. Help mode (HELP_SHOTS=1): the same steps,
 * with captions, and these files appear in help/media/<desktop|phone>/who-is-starting/
 *   01-hr-home.png, 02-employee-page.png, 03-documents.png, hr-opens-new-employee.webm
 * Pictures arrive only through the help retake pull request.
 *
 * No backend: the browser answers Cognito with the fake from the acceptance
 * tests (imported, never copied), the employees API with the help company's new
 * employees, and the document upload API with one person's page. Everyone and
 * everything shown comes from e2e/fixtures/help-company.ts. Any request to any
 * other host fails the journey, except the Google Fonts files. Show is never
 * pressed, so the ID number stays hidden. Nothing here calls an AI service.
 */

const hr = HELP_PEOPLE.find((p) => p.key === 'hr')!;
const [givenName = '', ...familyName] = hr.name.split(' ');
const starter = HELP_PEOPLE.find((p) => p.key === 'employee3')!;
const detail = helpJohanDetail();

// Made up, only ever typed into the fake. It is a password field, so pictures show dots.
const MADE_UP_PASSWORD = 'winter-protea-2026';
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

test('HR sees who is starting', async ({ page, context, help, baseURL }) => {
  help.video('who-is-starting/hr-opens-new-employee');

  // Everything that is not the app, the Cognito fake or the font files is refused and counted.
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

  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, OPTIONS' };
  const answer = (route: import('@playwright/test').Route, body: unknown) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.method() !== 'GET' || !/^Bearer \S+$/.test(req.headers()['authorization'] ?? '')) {
      return route.fulfill({ status: 401, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify({ message: 'Unauthorized' }) });
    }
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  };

  // GET /v1/employees: the help company's new employees.
  await context.route(
    (url) => /\/v1\/employees$/.test(url.pathname) && url.host !== appHost,
    (route) => {
      const items = HELP_NEW_EMPLOYEES.map((p) => ({ ...p, middle_name: '', phone: '', job_title: '', id_number_last4: '', hr_staff_email: hr.email }));
      return answer(route, { items, count: items.length });
    },
  );

  // GET /v1/employees/<id>/verifications: one person's page. Any other person is refused.
  await context.route(
    (url) => /\/v1\/employees\/[^/]+\/verifications$/.test(url.pathname) && url.host !== appHost,
    (route) => {
      const asked = new URL(route.request().url());
      if (asked.pathname !== `/v1/employees/${detail.employee.employee_id}/verifications`) {
        refused.push(asked.href);
        return route.abort('blockedbyclient');
      }
      return answer(route, detail);
    },
  );

  // Sign in with no captions, so the video starts on HR home.
  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(hr.email);
  await page.getByLabel('Password', { exact: true }).fill(MADE_UP_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome back, ${givenName}`, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: starter.name, exact: true })).toBeVisible();
  await help.shot('who-is-starting/01-hr-home');

  await help.open(starter.name);
  await expect(page).toHaveURL(new RegExp(`/hr/employees/${detail.employee.employee_id}$`));
  await expect(page.getByRole('heading', { name: starter.name, exact: true })).toBeVisible();
  await expect(page.getByText(detail.employee.hr_staff_name, { exact: false }).first()).toBeVisible();
  await help.shot('who-is-starting/02-employee-page');

  await help.scrollTo('Documents');
  await expect(page.getByText(detail.documents[0]!.file_name, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(detail.documents[1]!.file_name, { exact: false }).first()).toBeVisible();
  await help.shot('who-is-starting/03-documents');
  // Stay on the documents a moment so the video ends on them.
  if (help.on) await page.waitForTimeout(1500);

  expect(refused, 'the page asked a host other than the app, the Cognito fake, the font files or the two fake APIs, or asked for another person').toEqual([]);
});
