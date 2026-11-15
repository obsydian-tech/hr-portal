import type { Route } from '@playwright/test';
import { CognitoFake } from '../acceptance/support/cognito-fake';
import {
  HELP_DOCUMENT_DECIDED_AT,
  HELP_DOCUMENT_PAGES,
  HELP_DOCUMENT_REASON,
  HELP_NEW_EMPLOYEES,
  HELP_NEW_EMPLOYEE_STEPS,
  HELP_PEOPLE,
  HELP_WAITING_DOCUMENTS,
} from '../fixtures/help-company';
import { expect, test } from '../support/help';

/**
 * HELP-03 · Help pictures and video: HR checks a document (Jira NH-167).
 * Spec: /mnt/project-files/onboarding-cards/specs/HELP-03.md
 *
 * Pieter van Wyk, HR at Sunbird Bakery, opens Documents to check, accepts Johan Botha's National ID,
 * then asks Johan for a new bank letter with a reason. Pictures and video arrive only through the retake PR.
 * No backend: the browser answers Cognito with the locked fake and the document API from help-company.ts.
 * Show and Open document are never pressed. Any other host or route fails the journey. Nothing calls an AI service.
 */

const hr = HELP_PEOPLE.find((p) => p.key === 'hr')!;
const [givenName = '', ...familyName] = hr.name.split(' ');
const MADE_UP_PASSWORD = 'winter-protea-2026';
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const [idDoc, bankDoc] = HELP_WAITING_DOCUMENTS;
const linkName = (d: typeof idDoc) => `${d!.document_type === 'NATIONAL_ID' ? 'National ID' : 'Bank confirmation'}, ${d!.employee_name}`;

test('HR checks a document', async ({ page, context, help, baseURL }) => {
  help.video('checks-a-document/hr-checks-a-document');
  const phone = test.info().project.name === 'phone';

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

  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type, idempotency-key', 'access-control-allow-methods': 'GET, PATCH, OPTIONS' };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const signedIn = (route: Route) => /^Bearer \S+$/.test(route.request().headers()['authorization'] ?? '');

  await context.route(
    (url) => /\/v1\/employees$/.test(url.pathname) && url.host !== appHost,
    (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (route.request().method() !== 'GET' || !signedIn(route)) return json(route, 401, { message: 'Unauthorized' });
      return json(route, 200, {
        items: HELP_NEW_EMPLOYEES.map((p) => ({ ...p, step: HELP_NEW_EMPLOYEE_STEPS[p.employee_id], middle_name: '', phone: '', job_title: '', id_number_last4: '', hr_staff_email: hr.email })),
        count: HELP_NEW_EMPLOYEES.length,
      });
    },
  );

  const decided = new Map<string, { hr_decision: string; hr_decided_at: string; hr_decided_by_name: string; hr_decision_reason: string }>();
  await context.route(
    (url) => url.host !== appHost && url.pathname.startsWith('/v1/verifications'),
    async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const m = /^\/v1\/verifications\/([^/]+)(\/review)?$/.exec(url.pathname);
      const known = url.pathname === '/v1/verifications' || (!!m && !!HELP_DOCUMENT_PAGES[m[1]!]);
      if (!known) {
        refused.push(`${req.method()} ${url.href}`);
        return json(route, 404, { message: 'Not found' });
      }
      if (!signedIn(route)) return json(route, 401, { message: 'Unauthorized' });
      if (req.method() === 'GET' && url.pathname === '/v1/verifications' && url.searchParams.get('waiting') === 'true') {
        const items = HELP_WAITING_DOCUMENTS.filter((d) => !decided.has(d.document_id));
        const counts: Record<string, number> = {};
        for (const d of items) counts[d.check] = (counts[d.check] ?? 0) + 1;
        return json(route, 200, { items, count: items.length, counts });
      }
      const one = /^\/v1\/verifications\/([^/]+)$/.exec(url.pathname);
      if (req.method() === 'GET' && one && HELP_DOCUMENT_PAGES[one[1]!]) {
        return json(route, 200, { ...(HELP_DOCUMENT_PAGES[one[1]!] as object), ...(decided.get(one[1]!) ?? {}) });
      }
      const review = /^\/v1\/verifications\/([^/]+)\/review$/.exec(url.pathname);
      if (req.method() === 'PATCH' && review && HELP_DOCUMENT_PAGES[review[1]!]) {
        const body = req.postDataJSON() as { decision?: string; notes?: string };
        if (body.decision !== 'PASSED' && body.decision !== 'FAILED') return json(route, 400, { message: 'bad decision' });
        if (body.decision === 'FAILED' && !body.notes?.trim()) return json(route, 400, { message: 'reason required' });
        const answer = {
          hr_decision: body.decision === 'PASSED' ? 'ACCEPTED' : 'NEW_ONE_ASKED',
          hr_decided_at: HELP_DOCUMENT_DECIDED_AT[review[1]!]!,
          hr_decided_by_name: hr.name,
          hr_decision_reason: body.notes ?? '',
        };
        decided.set(review[1]!, answer);
        return json(route, 200, answer);
      }
      refused.push(`${req.method()} ${url.href}`);
      return json(route, 404, { message: 'Not found' });
    },
  );

  await page.goto('/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(hr.email);
  await page.getByLabel('Password', { exact: true }).fill(MADE_UP_PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Welcome back, ${givenName}`, exact: true })).toBeVisible();

  // Let HR home settle so the trimmed video's first frame is HR home, not the sign-in page.
  await page.waitForLoadState('networkidle');
  if (help.on) await page.waitForTimeout(1500);
  if (phone) await help.tap('Open menu');
  await help.open('Documents to check', page.getByRole('navigation', { name: 'Main' }));
  await expect(page.getByRole('heading', { name: 'Documents to check', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: linkName(bankDoc), exact: true })).toBeVisible();
  await help.shot('checks-a-document/01-documents-to-check');

  await help.open(linkName(idDoc));
  await expect(page.getByRole('heading', { name: linkName(idDoc), exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept document', exact: true })).toBeVisible();
  await help.shot('checks-a-document/02-id-document');

  await help.scrollTo('Your decision', page, { inner: true });
  await help.tap('Accept document');
  await expect(page.getByRole('heading', { name: 'Decision', exact: true })).toBeVisible();
  await page.mouse.move(1, 1);
  await help.shot('checks-a-document/03-id-accepted');

  await help.open('Documents to check', page.getByRole('navigation', { name: 'Breadcrumb' }));
  await expect(page.getByRole('link', { name: linkName(idDoc), exact: true })).toHaveCount(0);
  await help.open(linkName(bankDoc));
  await expect(page.getByRole('heading', { name: linkName(bankDoc), exact: true })).toBeVisible();
  await help.scrollTo('Your decision', page, { inner: true });
  await help.tap('Ask for a new one');
  const reason = page.getByRole('textbox', { name: 'Reason', exact: true });
  await expect(reason).toBeVisible();
  await help.step('Enter Reason', () => (help.on ? reason.pressSequentially(HELP_DOCUMENT_REASON, { delay: 30 }) : reason.fill(HELP_DOCUMENT_REASON)));
  // The Reason box made the card taller: bring its buttons into the picture (no caption, nothing pressed).
  await page.getByRole('heading', { name: 'Your decision', exact: true }).evaluate((el) => {
    const bar = Math.max(0, ...[...document.querySelectorAll('[role=banner]')].filter((b) => ['fixed', 'sticky'].includes(getComputedStyle(b).position)).map((b) => b.getBoundingClientRect().bottom));
    const main = document.getElementById('main');
    if (main && main.scrollHeight > main.clientHeight && /(auto|scroll)/.test(getComputedStyle(main).overflowY)) main.scrollTo({ top: main.scrollTop + el.getBoundingClientRect().top - Math.max(bar, main.getBoundingClientRect().top) - 16, behavior: 'instant' });
    else window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - bar - 16, behavior: 'instant' });
  });
  await page.mouse.move(1, 1);
  await help.shot('checks-a-document/04-reason');

  await help.tap('Ask for a new one');
  await expect(page.getByRole('heading', { name: 'Decision', exact: true })).toBeVisible();
  await page.mouse.move(1, 1);
  await help.shot('checks-a-document/05-new-one-asked');
  if (help.on) await page.waitForTimeout(2000);

  expect(refused, 'the page asked something other than the app, the Cognito fake, the fake APIs or the font files').toEqual([]);
});
