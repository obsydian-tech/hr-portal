import type { Page, Route } from '@playwright/test';
import { CognitoFake } from '../acceptance/support/cognito-fake';
import {
  HELP_HR_PARTNERS,
  HELP_INVITE,
  HELP_NEW_EMPLOYEES,
  HELP_NEW_EMPLOYEE_STEPS,
  HELP_PEOPLE,
  HELP_REGISTERED,
  helpNewEmployeeForm,
  helpThandiDetail,
} from '../fixtures/help-company';
import { expect, test } from '../support/help';
import { environment } from '../../src/environments/environment';

/**
 * HELP-04 · Help pictures and video: HR adds a new employee (Jira NH-173).
 * Spec: /mnt/project-files/onboarding-cards/specs/HELP-04.md
 *
 * Pieter van Wyk, HR at Sunbird Bakery, registers Thandi Mahlangu in the four steps, opens her page and
 * resends her invite link. Every value typed comes from help-company.ts; the ID number is never typed.
 * Pictures and video arrive only through the retake PR. No backend: the browser answers Cognito with the
 * locked fake and the employees and document APIs from help-company.ts, and refuses any call without a
 * Bearer token. Any other host or route fails the journey. Nothing calls an AI service or sends an email.
 */

const hr = HELP_PEOPLE.find((p) => p.key === 'hr')!;
const [givenName = '', ...familyName] = hr.name.split(' ');
const MADE_UP_PASSWORD = 'winter-protea-2026';
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const EMPLOYEES = new URL(environment.employeesApiUrl).host;
const DOCUMENTS = new URL(environment.documentUploadApiUrl).host;

/** Window and the app's main area back to the top, pointer away from every button. */
async function toTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.getElementById('main')?.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.mouse.move(1, 1);
}

test('HR adds a new employee', async ({ page, context, help, baseURL }) => {
  help.video('adds-an-employee/hr-adds-an-employee');
  const phone = test.info().project.name === 'phone';
  const form = helpNewEmployeeForm();
  const partner = HELP_HR_PARTNERS[0];
  const id = HELP_REGISTERED.employee.employee_id;

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

  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, idempotency-key', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const signedIn = (route: Route) => /^Bearer \S+$/.test(route.request().headers()['authorization'] ?? '');

  let registered = false;
  let posts = 0;
  let resends = 0;
  await context.route(
    (url) => url.host === EMPLOYEES || url.host === DOCUMENTS,
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const m = req.method();
      if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const at = `${url.host === EMPLOYEES ? 'employees' : 'documents'} ${m} ${url.pathname}`;
      const known = [
        'employees GET /v1/employees',
        'employees GET /v1/employees/email-check',
        'employees GET /v1/hr-partners',
        'employees POST /v1/employees',
        `employees GET /v1/employees/${id}/invite`,
        `employees POST /v1/employees/${id}/invite`,
        `documents GET /v1/employees/${id}/verifications`,
      ];
      if (!known.includes(at)) {
        refused.push(`${m} ${url.href}`);
        return json(route, 404, { message: 'Not found' });
      }
      if (!signedIn(route)) return json(route, 401, { message: 'Unauthorized' });
      if (at === 'employees GET /v1/employees') {
        const people = HELP_NEW_EMPLOYEES.filter((p) => registered || p.employee_id !== id);
        return json(route, 200, {
          items: people.map((p) => ({ ...p, step: HELP_NEW_EMPLOYEE_STEPS[p.employee_id], middle_name: '', phone: '', job_title: '', id_number_last4: '', hr_staff_email: hr.email })),
          count: people.length,
        });
      }
      if (at === 'employees GET /v1/employees/email-check') return json(route, 200, { inUse: url.searchParams.get('email') !== form.email });
      if (at === 'employees GET /v1/hr-partners') return json(route, 200, { items: HELP_HR_PARTNERS });
      if (at === 'employees POST /v1/employees') {
        posts++;
        const body = req.postDataJSON() as Record<string, string>;
        const want = { first_name: form.firstName, last_name: form.lastName, email: form.email, phone: form.phone, department: form.department, job_title: form.jobTitle, hr_staff_id: partner.id, planned_start_date: form.startDate };
        if (JSON.stringify(Object.entries(body).sort()) !== JSON.stringify(Object.entries(want).sort())) {
          refused.push(`POST /v1/employees with ${JSON.stringify(body)}`);
          return json(route, 400, { message: 'not the typed values' });
        }
        registered = true;
        return json(route, 201, HELP_REGISTERED);
      }
      if (at.endsWith('/invite') && m === 'GET') return json(route, 200, HELP_INVITE.sent);
      if (at.endsWith('/invite') && m === 'POST') {
        resends++;
        return json(route, 200, HELP_INVITE.resent);
      }
      return json(route, 200, helpThandiDetail());
    },
  );

  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(hr.email);
  await page.getByLabel('Password', { exact: true }).fill(MADE_UP_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome back, ${givenName}`, exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  if (help.on) await page.waitForTimeout(1500);

  await help.open('Add new employee');
  await expect(page.getByRole('heading', { name: 'Register a new employee', exact: true })).toBeVisible();
  await help.fill('First name', form.firstName);
  await help.fill('Last name', form.lastName);
  await help.fill('Email address', form.email);
  await help.fill('Phone number', form.phone);
  await toTop(page);
  await help.shot('adds-an-employee/01-personal-information');
  await help.tap('Next: job and start date');

  await expect(page.getByText('Step 2 of 4', { exact: true })).toBeVisible();
  await help.choose('Department', form.department);
  await help.fill('Job title', form.jobTitle);
  await help.fill('Start date', form.startDate);
  await page.getByLabel('Start date', { exact: true }).press('Tab');
  await toTop(page);
  await help.shot('adds-an-employee/02-job-and-start-date');
  await help.tap('Next: HR partner');

  await expect(page.getByRole('radio', { name: new RegExp(`^${partner.name}`) })).toBeChecked();
  await toTop(page);
  await help.shot('adds-an-employee/03-hr-partner');
  await help.tap('Next: check details');

  await expect(page.getByRole('heading', { name: 'Assigned HR partner', exact: true })).toBeVisible();
  await toTop(page);
  await help.shot('adds-an-employee/04-confirmation');
  await help.tap(`Register ${form.firstName}`);

  await expect(page.getByRole('heading', { name: `${form.firstName} ${form.lastName} is registered`, exact: true })).toBeVisible();
  await toTop(page);
  await help.shot('adds-an-employee/05-registered');
  await help.open('View employee');

  await expect(page.getByRole('heading', { name: 'Invite link', exact: true })).toBeVisible();
  await help.scrollTo('Invite link', page, { inner: true });
  await page.mouse.move(1, 1);
  await help.shot('adds-an-employee/06-invite-link');
  await help.tap('Resend link');
  await expect(page.getByText(/09:05, to /)).toBeVisible();
  await page.mouse.move(1, 1);
  await help.shot('adds-an-employee/07-link-resent');
  if (help.on) await page.waitForTimeout(2000);

  expect(posts, 'one POST /v1/employees').toBe(1);
  expect(resends, 'one Resend link').toBe(1);
  expect(refused, 'the page asked something other than the app, the Cognito fake, the fake APIs or the font files').toEqual([]);
});
