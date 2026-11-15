import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { ON_DEV, FAKE, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { blocks, tfFiles } from './support/infra-harness';
import { policyOf, resourcesNamed } from './support/onb-15/tf-policy';
import type { Statement } from './support/ops-05/iam-eval';
import {
  AGENT, EMPLOYEE, EMAIL_CHECK, HR, PAGE, PARTNERS, POOL, REPO, aiReached, aws, body, cognitoCalls, create, createEvent, dynamoCalls, emailCheck,
  emailCheckEvent, emptyWorld, employeeRow, member, partners, partnersEvent, published, runHandler, saId, stored, storedWithEmail, withBadCheck, writesTo,
  type Caller, type JwtCaller, type CognitoUser, type GroupsForm, type Run, type World,
} from './support/onb-03/lambda-harness';
import { hiddenOrCovered, noSidewaysScroll } from './support/onb-03/phone';
import { RegistrationFake, threePartners, type Partner } from './support/onb-03/registration-fake';

/**
 * ONB-03 · Add a new employee (Jira NH-169, epic NH-150).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-03.md (15 Nov 2026)
 *
 * Screen tests (AC-1 to AC-7) run at 1280 and 390 wide with no backend: the browser answers the employees API
 * (the list, POST /v1/employees, GET /v1/hr-partners, GET /v1/employees/email-check) with
 * support/onb-03/registration-fake.ts and Cognito with the fake. Lambda tests (AC-8 to AC-11) run once, in
 * desktop-1280: the real createEmployee, getHrPartners and checkEmployeeEmail handlers, each in a fresh Node
 * process, against support/onb-03/fake-aws (DynamoDB with the email index, KMS, EventBridge, Step Functions,
 * Postmark, and a Cognito user pool that answers ListUsersInGroup 60 a page). AC-12 reads infra/*.tf, the
 * Lambda folders, scripts and api/openapi.yaml as text. AC-13 runs on pepla-dev (desktop, once).
 * Nothing here calls AWS or any AI service.
 *
 * These files are locked once the lock check accepts them: see ./README.md and cards/onb-03.md.
 */

const FORM = '/hr/employees/new';
const HOME = '/hr';
const TITLE = 'Register a new employee';
const STEPS = ['Personal information', 'Job and start date', 'HR partner', 'Confirmation'] as const;
const NEXT = ['Next: job and start date', 'Next: HR partner', 'Next: check details'] as const;
const PHONE_WORDS = 'Use numbers and spaces only, like 081 234 5678.';
const ID_WORDS = 'Check the ID number. It has 13 digits.';
const ID_HINT = '13 digits. Optional. Batsi compares it with the ID document.';
const IN_USE = 'This email is already in use';
const NOT_USED = 'This email is not used yet.';
const LOAD_FAILED = 'HR partners could not be loaded.';
const FAILED = 'Registering did not work. Your answers are kept.';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- the people

type Person = {
  first: string; middle: string; last: string; email: string; phone: string; id: string;
  department: string; title: string; start: string; startIso: string; offer: string; offerIso: string;
};
const AYANDA: Person = {
  first: 'Ayanda', middle: 'Thembeka', last: 'Zulu', email: 'ayanda.zulu@mokoena.co.za', phone: '072 555 0198', id: saId('950614'),
  department: 'Engineering', title: 'Software engineer', start: '1 Dec 2026', startIso: '2026-12-01', offer: '6 Nov 2026', offerIso: '2026-11-06',
};
const LONG: Person = {
  ...AYANDA, first: 'Nokuthula-Precious', middle: 'Thembeka-Lindiwe', last: 'Mahlangu-Vilakazi',
  email: 'nokuthula-precious.mahlangu-vilakazi@a-very-long-company-name.co.za', title: 'Senior Payroll and Benefits Administrator',
};

// ---------------------------------------------------------------- fixtures

type Fixtures = { api: RegistrationFake | null };

const test = base.extend<Fixtures>({
  // Installed before the first page load. pepla-dev answers for itself.
  api: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new RegistrationFake(new URL(baseURL!).origin);
    fake.partners = threePartners(FAKE.hr.email);
    await fake.install(context);
    await use(fake);
  },
});

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs the made-up API.');
function lambdaOnce(testInfo: TestInfo): void {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambdas against a fake AWS.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Runs the Lambdas once: they have no screen width.');
}
const textOnce = (testInfo: TestInfo) => {
  test.skip(ON_DEV, 'No-backend run only: it reads the repository as text.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Reads the repository once: it has no screen width.');
};

// ---------------------------------------------------------------- the form, found by its words

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });
const main = (page: Page) => page.locator('main');
const label = (page: Page, name: string) => page.getByLabel(new RegExp(`^${esc(name)}`));
const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name: typeof name === 'string' ? new RegExp(`^${esc(name)}$`) : name });
const f = {
  first: (p: Page) => label(p, 'First name'),
  middle: (p: Page) => label(p, 'Middle name'),
  last: (p: Page) => label(p, 'Last name'),
  email: (p: Page) => label(p, 'Email address'),
  phone: (p: Page) => label(p, 'Phone number'),
  id: (p: Page) => label(p, 'ID number'),
  department: (p: Page) => label(p, 'Department'),
  title: (p: Page) => label(p, 'Job title'),
  start: (p: Page) => label(p, 'Start date'),
  offer: (p: Page) => label(p, 'Offer accepted'),
};
const tracker = (page: Page) => main(page).locator('ol[aria-label]').filter({ has: page.locator('li[aria-current="step"]') });
const currentStep = (page: Page) => main(page).locator('li[aria-current="step"]');
const radios = (page: Page) => main(page).getByRole('radio');
const registerButton = (page: Page, first: string) => page.getByRole('button', { name: new RegExp(`^Register( ${esc(first)})?$`) });
const alertBox = (page: Page) => main(page).locator('[role="alert"]').first();

/** HR is on this step (the tracker says so). */
async function expectStep(page: Page, n: 1 | 2 | 3 | 4): Promise<void> {
  await expect(currentStep(page), `step ${n}: ${STEPS[n - 1]}`).toContainText(STEPS[n - 1]!, { timeout: 20_000 });
  await expect(currentStep(page)).toContainText(`Step ${n} of 4`);
}

async function open(page: Page, signIn: SignInPage, hr: Login, path = FORM): Promise<void> {
  await page.goto(path);
  await expect(signIn.email).toBeVisible();
  await signIn.signInAs(hr);
  await expect(page).toHaveURL(new RegExp(`${esc(path)}$`));
  await expect(h1(page)).toHaveText(path === FORM ? TITLE : /Welcome back/, { timeout: 20_000 });
}

async function typeDate(input: Locator, text: string): Promise<void> {
  await input.fill(text);
  await input.press('Tab');
}

async function fillStep1(page: Page, p: Person, o: { id?: boolean; middle?: boolean } = {}): Promise<void> {
  await f.first(page).fill(p.first);
  if (o.middle !== false) await f.middle(page).fill(p.middle);
  await f.last(page).fill(p.last);
  await f.email(page).fill(p.email);
  await f.phone(page).fill(p.phone);
  if (o.id) await f.id(page).fill(p.id);
}
async function fillStep2(page: Page, p: Person, o: { offer?: boolean } = {}): Promise<void> {
  await f.department(page).selectOption({ label: p.department });
  await f.title(page).fill(p.title);
  await typeDate(f.start(page), p.start);
  if (o.offer !== false) await typeDate(f.offer(page), p.offer);
}

/** Next on step 1, 2 or 3. */
async function next(page: Page, from: 1 | 2 | 3): Promise<void> {
  await button(page, NEXT[from - 1]!).click();
}
async function toStep2(page: Page, p: Person, o: { id?: boolean } = {}): Promise<void> {
  await fillStep1(page, p, o);
  await next(page, 1);
  await expectStep(page, 2);
}
async function toStep3(page: Page, p: Person): Promise<void> {
  await toStep2(page, p);
  await fillStep2(page, p);
  await next(page, 2);
  await expectStep(page, 3);
}
async function toConfirmation(page: Page, p: Person, o: { id?: boolean; partner?: RegExp } = {}): Promise<void> {
  await toStep2(page, p, o);
  await fillStep2(page, p);
  await next(page, 2);
  await expectStep(page, 3);
  if (o.partner) await page.getByRole('radio', { name: o.partner }).check();
  await next(page, 3);
  await expectStep(page, 4);
}
async function register(page: Page, p: Person): Promise<void> {
  await registerButton(page, p.first).click();
}

/** The values a form's fields hold, by label. */
async function values(page: Page, names: Array<keyof typeof f>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const n of names) out[n] = await f[n](page).inputValue();
  return out;
}

/** Everything a person can read or a screen reader is given on the page, as one string (text, attributes, field values). */
async function everythingOnPage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const out: string[] = [document.body.innerText, document.title];
    for (const el of document.querySelectorAll('*')) {
      for (const a of Array.from(el.attributes)) out.push(a.value);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) out.push(el.value);
    }
    return out.join('\n');
  });
}
async function storageText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < store.length; i++) out.push(`${store.key(i)}=${store.getItem(store.key(i) ?? '') ?? ''}`);
    }
    return out.join('\n');
  });
}

/** The summary of what to fix: it is an alert, holds focus, and lists one link per problem. */
async function expectSummary(page: Page, what: string, count: number): Promise<void> {
  const box = alertBox(page);
  await expect(box, `${what}: a summary of what to fix is shown`).toBeVisible();
  expect(await box.evaluate((el) => el.contains(document.activeElement)), `${what}: focus is in the summary`).toBe(true);
  await expect(box.getByRole('link'), `${what}: one link in the summary for each of the ${count} problems`).toHaveCount(count);
}
async function expectInvalid(field: Locator, what: string): Promise<void> {
  await expect(field, `${what}: marked invalid`).toHaveAttribute('aria-invalid', 'true');
  await expect(field, `${what}: has a message beside it`).toHaveAccessibleDescription(/\S/);
}
async function expectValid(field: Locator, what: string): Promise<void> {
  await expect(field, `${what}: not marked invalid`).not.toHaveAttribute('aria-invalid', 'true');
}

const SA_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Johannesburg', hour: '2-digit', minute: '2-digit', hour12: false });
const saMinutes = (d: Date) => { const [h, m] = SA_TIME.format(d).split(':').map(Number); return h! * 60 + m!; };

// ---------------------------------------------------------------- pepla-dev helpers

function devApi(): string {
  const file = join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts');
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

// ================================================================ the tests

test.describe('ONB-03 Add a new employee', () => {
  // -------------------------------------------------------------- AC-1
  test('AC-1 Four steps, in order: Previous keeps every entry, Cancel clears the draft, nothing is sent before Register', async ({ page, signIn, hr, api }, testInfo) => {
    noBackendOnly();
    await open(page, signIn, hr, HOME);
    const add = page.getByRole('link', { name: 'Add new employee', exact: true }).or(page.getByRole('button', { name: 'Add new employee', exact: true })).first();
    await expect(add, 'HR home has "Add new employee"').toBeVisible();
    await add.click();
    await expect(page).toHaveURL(new RegExp(`${esc(FORM)}$`));
    await expect(h1(page)).toHaveText(TITLE);
    expect(await page.title(), 'the page title').toBe('Register a new employee · Naleko People');
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    // on a phone the design system's breadcrumbs show the last level only (Home is hidden there)
    if (testInfo.project.name !== 'phone-390') await expect(crumbs.getByRole('link', { name: 'Home', exact: true }), 'breadcrumb: Home').toBeVisible();
    await expect(crumbs, 'breadcrumb: Register a new employee').toContainText(TITLE);

    // the tracker names the four steps, in order
    const items = (await tracker(page).locator('li').allTextContents()).map(clean);
    expect(items, 'four steps in the tracker').toHaveLength(4);
    STEPS.forEach((s, i) => expect(items[i], `tracker item ${i + 1} names "${s}"`).toContain(s));
    await expectStep(page, 1);
    await expect(button(page, NEXT[0]!), 'step 1 has "Next: job and start date"').toBeVisible();
    await expect(button(page, 'Cancel')).toBeVisible();

    // typing makes a draft, saved in South Africa time
    await fillStep1(page, AYANDA);
    const saved = page.getByText(/^Draft saved \d{2}:\d{2}$/);
    await expect(saved, '"Draft saved HH:MM"').toBeVisible();
    const shown = /(\d{2}):(\d{2})$/.exec(clean((await saved.first().textContent()) ?? ''))!;
    const gap = Math.abs(Number(shown[1]) * 60 + Number(shown[2]) - saMinutes(new Date()));
    expect(Math.min(gap, 1440 - gap), 'the draft time is the South Africa time now (within two minutes)').toBeLessThanOrEqual(2);

    // forward through the steps
    await next(page, 1);
    await expectStep(page, 2);
    await expect(button(page, 'Previous')).toBeVisible();
    await fillStep2(page, AYANDA);
    await next(page, 2);
    await expectStep(page, 3);
    await next(page, 3);
    await expectStep(page, 4);
    await expect(h1(page)).toHaveText(TITLE);
    await expect(registerButton(page, AYANDA.first), 'step 4: Register').toBeVisible();

    // and back: every entry is still there
    await button(page, 'Previous').click();
    await expectStep(page, 3);
    await button(page, 'Previous').click();
    await expectStep(page, 2);
    expect(await values(page, ['title', 'start', 'offer']), 'step 2 keeps its entries').toEqual({ title: AYANDA.title, start: AYANDA.start, offer: AYANDA.offer });
    expect(await f.department(page).evaluate((s: HTMLSelectElement) => s.selectedOptions[0]?.textContent?.trim()), 'step 2 keeps the department').toBe(AYANDA.department);
    await button(page, 'Previous').click();
    await expectStep(page, 1);
    expect(await values(page, ['first', 'middle', 'last', 'email', 'phone']), 'step 1 keeps its entries').toEqual({
      first: AYANDA.first, middle: AYANDA.middle, last: AYANDA.last, email: AYANDA.email, phone: AYANDA.phone,
    });

    // Edit on the confirmation goes back to the step with its entries
    await next(page, 1);
    await expectStep(page, 2);
    await next(page, 2);
    await expectStep(page, 3);
    await next(page, 3);
    await expectStep(page, 4);
    await page.getByRole('button', { name: 'Edit personal details', exact: true }).click();
    await expectStep(page, 1);
    expect(await f.last(page).inputValue(), 'Edit personal details keeps the entries').toBe(AYANDA.last);

    expect(api!.posts, 'no POST /v1/employees before Register').toHaveLength(0);

    // Cancel goes home and clears the draft
    await button(page, 'Cancel').click();
    await expect(page).toHaveURL(new RegExp(`${esc(HOME)}$`));
    await expect(h1(page)).toHaveText(/Welcome back/);
    const left = await storageText(page);
    for (const secret of [AYANDA.email, AYANDA.last, AYANDA.phone]) expect(left, `Cancel clears the draft: "${secret}" is not kept`).not.toContain(secret);
    await add.click();
    await expectStep(page, 1);
    expect(await values(page, ['first', 'middle', 'last', 'email', 'phone']), 'a new form after Cancel is empty').toEqual({ first: '', middle: '', last: '', email: '', phone: '' });
    expect(api!.posts, 'still no POST /v1/employees').toHaveLength(0);
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 A missing or wrong entry stops Next: a summary, a message beside each field, focus on the summary', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    api!.partners = threePartners('someone.else@mokoena-logistics.co.za'); // the signed-in HR person is not in the list: nobody is chosen
    await open(page, signIn, hr);

    // step 1: four required fields
    await next(page, 1);
    await expectStep(page, 1);
    await expectSummary(page, 'step 1', 4);
    for (const n of ['first', 'last', 'email', 'phone'] as const) await expectInvalid(f[n](page), `step 1 ${n}`);
    await expectValid(f.middle(page), 'Middle name (optional)');
    await expectValid(f.id(page), 'ID number (optional)');
    const text = clean(await alertBox(page).innerText());
    for (const w of ['First name', 'Last name', 'Email', 'Phone']) expect(text, `the summary names ${w}`).toContain(w);
    // typing clears that field's message and no other
    await f.first(page).fill('A');
    await expectValid(f.first(page), 'First name once typed in');
    await expectInvalid(f.last(page), 'Last name, not yet typed in');

    // a phone with letters
    await fillStep1(page, AYANDA, { middle: false });
    await f.phone(page).fill('072 555 O198x');
    await next(page, 1);
    await expectStep(page, 1);
    await expect(main(page).getByText(PHONE_WORDS, { exact: true }), 'the phone words').toBeVisible();
    await expectInvalid(f.phone(page), 'Phone number with letters');
    await f.phone(page).fill(AYANDA.phone);
    await expect(main(page).getByText(PHONE_WORDS, { exact: true }), 'typing clears the phone message').toHaveCount(0);
    expect(api!.posts).toHaveLength(0);

    // step 2: department, job title, start date; Offer accepted is optional
    await next(page, 1);
    await expectStep(page, 2);
    await next(page, 2);
    await expectStep(page, 2);
    await expectSummary(page, 'step 2', 3);
    for (const n of ['department', 'title', 'start'] as const) await expectInvalid(f[n](page), `step 2 ${n}`);
    await expectValid(f.offer(page), 'Offer accepted (optional)');
    await f.title(page).fill('Clerk');
    await expectValid(f.title(page), 'Job title once typed in');
    await expectInvalid(f.start(page), 'Start date, not yet typed in');
    // Offer accepted left empty is fine
    await f.department(page).selectOption({ label: 'Finance' });
    await typeDate(f.start(page), AYANDA.start);
    await next(page, 2);
    await expectStep(page, 3);

    // step 3: nobody chosen
    await expect(radios(page), 'three HR partners are listed').toHaveCount(3);
    await expect(page.locator('input[type="radio"]:checked'), 'nobody is chosen when the signed-in person is not in the list').toHaveCount(0);
    await next(page, 3);
    await expectStep(page, 3);
    await expectSummary(page, 'step 3', 1);
    await expect(alertBox(page).getByRole('link'), 'the summary names the HR partner').toHaveText(/HR partner/i);
    expect(api!.posts).toHaveLength(0);
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 An email already in use is refused on step 1, whatever the capitals; Next waits for the answer', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    api!.takenEmails = ['sarah.nkosi@mokoena-logistics.co.za'];
    await open(page, signIn, hr);
    await fillStep1(page, AYANDA, { middle: false });

    // Check email: a taken address, capitals and spaces around it
    await f.email(page).fill('  Sarah.NKOSI@Mokoena-Logistics.co.za ');
    await button(page, 'Check email').click();
    await expect(main(page).getByText(IN_USE, { exact: true }), 'in use').toBeVisible();
    expect(api!.emailChecks.at(-1), 'the call carries the address trimmed and lower-cased').toBe('sarah.nkosi@mokoena-logistics.co.za');
    await expectInvalid(f.email(page), 'Email address in use');
    await next(page, 1);
    await expectStep(page, 1);
    await expect(main(page).getByText(IN_USE, { exact: true }), 'Next with a taken address stays on step 1 and still says so').toBeVisible();
    await expect(h1(page)).toHaveText(TITLE);

    // a free address
    await f.email(page).fill(AYANDA.email);
    await button(page, 'Check email').click();
    await expect(main(page).getByText(NOT_USED, { exact: true }), 'not used yet').toBeVisible();
    expect(api!.emailChecks.at(-1), 'the free address is sent trimmed and lower-cased too').toBe(AYANDA.email);
    await expect(main(page).getByText(IN_USE, { exact: true }), 'the old message is gone').toHaveCount(0);

    // Next on its own asks, and a taken address given only to Next is refused
    api!.emailChecks.length = 0;
    await f.email(page).fill('SARAH.nkosi@mokoena-logistics.co.za');
    await next(page, 1);
    await expect(main(page).getByText(IN_USE, { exact: true }), 'Next asks the check by itself').toBeVisible();
    await expectStep(page, 1);
    expect(api!.emailChecks.length, 'Next made the call').toBeGreaterThan(0);
    expect(api!.emailChecks.every((e) => e === 'sarah.nkosi@mokoena-logistics.co.za'), 'every call carries the address trimmed and lower-cased').toBe(true);

    // Next never skips the check: with the answer held it waits, and a taken answer keeps HR on step 1
    api!.emailMode = 'hold';
    await f.email(page).fill('sarah.nkosi@mokoena-logistics.co.za ');
    await next(page, 1);
    await expect.poll(() => api!.emailChecks.length, { message: 'the check was asked' }).toBeGreaterThan(1);
    await page.waitForTimeout(500);
    await expectStep(page, 1);
    api!.takenEmails.push('sarah.nkosi@mokoena-logistics.co.za');
    api!.release();
    await expect(main(page).getByText(IN_USE, { exact: true })).toBeVisible();
    await expectStep(page, 1);

    // ...and a free answer lets Next go on
    api!.emailMode = 'hold';
    await f.email(page).fill(AYANDA.email);
    await next(page, 1);
    await page.waitForTimeout(500);
    await expectStep(page, 1);
    api!.release();
    await expectStep(page, 2);

    // Register comes back 409: back to step 1 with the same message and every entry
    await fillStep2(page, AYANDA);
    await next(page, 2);
    await expectStep(page, 3);
    await next(page, 3);
    await expectStep(page, 4);
    api!.createMode = 'duplicate';
    await register(page, AYANDA);
    await expectStep(page, 1);
    await expect(main(page).getByText(IN_USE, { exact: true }), 'a 409 DUPLICATE_EMAIL shows the same message on step 1').toBeVisible();
    expect(await values(page, ['first', 'last', 'email', 'phone']), 'every entry is kept').toEqual({ first: AYANDA.first, last: AYANDA.last, email: AYANDA.email, phone: AYANDA.phone });
  });

  // -------------------------------------------------------------- AC-4
  test('AC-4 ID number: optional, checked, shown hidden, and never kept or sent except in the one POST', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    const requests: Array<{ method: string; url: string; headers: string; post: string }> = [];
    page.on('request', (r) => requests.push({ method: r.method(), url: r.url(), headers: JSON.stringify(r.headers()), post: r.postData() ?? '' }));
    await open(page, signIn, hr);
    await expect(main(page).getByText(ID_HINT, { exact: true }), 'the hint').toBeVisible();
    await fillStep1(page, AYANDA, { middle: false });

    // wrong ones stop Next with the words
    const good = AYANDA.id;
    const wrong: Array<[string, string]> = [
      ['12 digits', good.slice(0, 12)],
      ['14 digits', good + '1'],
      ['letters', '95061450090A5'],
      ['a bad checksum', withBadCheck(good)],
      ['an impossible date (31 February)', saId('950231')],
      ['an impossible month', saId('951301')],
    ];
    for (const [what, value] of wrong) {
      await f.id(page).fill(value);
      await next(page, 1);
      await expectStep(page, 1);
      await expect(main(page).getByText(ID_WORDS, { exact: true }), `${what}: the words`).toBeVisible();
      await expectInvalid(f.id(page), `ID number, ${what}`);
    }
    // empty is accepted, a right one is accepted
    await f.id(page).fill('');
    await expect(main(page).getByText(ID_WORDS, { exact: true }), 'emptying the field clears the words').toHaveCount(0);
    await f.id(page).fill(good);
    await expect(main(page).getByText(ID_WORDS, { exact: true })).toHaveCount(0);
    await next(page, 1);
    await expectStep(page, 2);

    // the number is nowhere on steps 2 and 3
    await fillStep2(page, AYANDA);
    expect(await everythingOnPage(page), 'step 2: the full ID number is on no page').not.toContain(good);
    await next(page, 2);
    await expectStep(page, 3);
    expect(await everythingOnPage(page), 'step 3: the full ID number is on no page').not.toContain(good);
    await next(page, 3);
    await expectStep(page, 4);

    // the confirmation shows it hidden except the last four, with no Show
    const row = main(page).locator('dt', { hasText: /^\s*ID number\s*$/ });
    await expect(row, 'the confirmation has an "ID number" row').toHaveCount(1);
    const shown = clean(await row.locator('xpath=following-sibling::dd[1]').innerText());
    expect(shown, 'the row shows nine dots and the last four digits').toBe(`•••••••••${good.slice(-4)}`);
    await expect(page.getByRole('button', { name: /^(Show|Reveal|Unhide)/i }), 'no Show button').toHaveCount(0);
    expect(await everythingOnPage(page), 'the confirmation: the full number is in no text, title, tooltip, label or field').not.toContain(good);
    const stores = await storageText(page);
    expect(stores, 'the full number is in neither sessionStorage nor localStorage').not.toContain(good);
    expect(stores.replace(/\D/g, ''), 'nor as digits inside something else').not.toContain(good);

    // Register: the number goes in the one POST and nowhere else
    await register(page, AYANDA);
    await expect(h1(page)).toHaveText(`${AYANDA.first} ${AYANDA.last} is registered`, { timeout: 20_000 });
    expect(await everythingOnPage(page), 'the registered page: the full number is on no page').not.toContain(good);
    expect(await storageText(page), 'after Register: not in storage').not.toContain(good);
    const holding = requests.filter((r) => r.url.includes(good) || r.headers.includes(good) || r.post.includes(good));
    expect(holding.map((r) => `${r.method} ${new URL(r.url).pathname}`), 'only one request carries the number: POST /v1/employees').toEqual(['POST /v1/employees']);
    expect(api!.posts, 'exactly one POST').toHaveLength(1);
    expect(api!.posts[0]!.body['id_number'], 'the POST carries id_number').toBe(good);
    expect(requests.filter((r) => /email-check/.test(r.url)).every((r) => !r.url.includes(good)), 'email-check does not carry it').toBe(true);
  });

  test('AC-4 An empty ID number is sent as nothing, and a reload leaves the field empty', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    await open(page, signIn, hr);
    await fillStep1(page, AYANDA, { id: true, middle: false });
    await next(page, 1);
    await expectStep(page, 2);
    expect(await storageText(page), 'the draft is kept in the tab, without the ID number').not.toContain(AYANDA.id);
    expect(await storageText(page), 'the draft is kept in the tab').toContain(AYANDA.first);
    await page.reload();
    // the sign-in the browser keeps comes back by itself; if the app asks again, sign in again
    await expect(h1(page).or(signIn.email)).toBeVisible({ timeout: 20_000 });
    if (await signIn.email.isVisible()) await signIn.signInAs(hr);
    await expect(h1(page)).toHaveText(TITLE, { timeout: 20_000 });
    await expect(f.first(page).or(button(page, 'Previous')), 'the form is back').toBeVisible({ timeout: 20_000 });
    // the draft remembers the step HR was on: go back to step 1, one Previous at a time
    const stepNow = Number(/Step (\d) of 4/.exec(await currentStep(page).innerText())?.[1] ?? '1');
    for (let n = stepNow; n > 1; n--) {
      await button(page, 'Previous').click();
      await expectStep(page, (n - 1) as 1 | 2 | 3);
    }
    await expect(f.first(page), 'the draft comes back after a reload').toHaveValue(AYANDA.first);
    await expect(f.last(page)).toHaveValue(AYANDA.last);
    await expect(f.email(page)).toHaveValue(AYANDA.email);
    await expect(f.id(page), 'the ID number does not').toHaveValue('');
    expect(await everythingOnPage(page), 'and the number is on no page').not.toContain(AYANDA.id);
    // an empty one is accepted and sent as nothing
    await next(page, 1);
    await expectStep(page, 2);
    await fillStep2(page, AYANDA);
    await next(page, 2);
    await next(page, 3);
    await expectStep(page, 4);
    await register(page, AYANDA);
    await expect(h1(page)).toHaveText(`${AYANDA.first} ${AYANDA.last} is registered`, { timeout: 20_000 });
    const sent = api!.posts[0]!.body['id_number'];
    expect(sent === undefined || sent === '' || sent === null, `no ID number typed: nothing is sent (got ${JSON.stringify(sent)})`).toBe(true);
  });

  // -------------------------------------------------------------- AC-5
  test('AC-5 The HR partner is picked from the real list; Register sends the id and no name or email', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    await open(page, signIn, hr);
    await toStep3(page, AYANDA);
    const list = api!.partners;
    await expect(radios(page), 'one choice for each person the API lists').toHaveCount(list.length);
    for (const pt of list) {
      await expect(page.getByRole('radio', { name: new RegExp(esc(pt.name)) }), `${pt.name} is a choice`).toHaveCount(1);
      await expect(main(page).getByText(`Staff ID ${pt.staffId} · ${pt.email}`, { exact: true }), `${pt.name}: "Staff ID <id> · <email>"`).toBeVisible();
    }
    expect(api!.partnerCalls.length, 'the list was read from the API').toBeGreaterThan(0);
    await expect(page.getByRole('radio', { name: /Jane Smith/ }), 'the signed-in HR person is chosen first').toBeChecked();
    await expect(page.locator('input[type="radio"]:checked'), 'and nobody else').toHaveCount(1);

    // choose someone else, whose id and staff id differ
    const sipho = list.find((p) => p.id === 'pool-user-17')!;
    await page.getByRole('radio', { name: /Sipho Ndlovu/ }).check();
    await next(page, 3);
    await expectStep(page, 4);
    const card = main(page).getByRole('heading', { name: /HR partner/ }).first().locator('xpath=ancestor::*[self::article or self::section or self::pp-card or contains(concat(" ", normalize-space(@class), " "), " card ")][1]');
    await expect(card, 'the confirmation has an HR partner card').toHaveCount(1);
    await expect(card, 'the confirmation shows the chosen name').toContainText(sipho.name);
    await expect(card, '...Staff ID').toContainText(sipho.staffId);
    await expect(card, '...and email').toContainText(sipho.email);
    await register(page, AYANDA);
    await expect(h1(page)).toHaveText(`${AYANDA.first} ${AYANDA.last} is registered`, { timeout: 20_000 });
    expect(api!.posts).toHaveLength(1);
    const sent = api!.posts[0]!.body;
    expect(sent['hr_staff_id'], 'Register sends hr_staff_id (the pool id, not the staff ID)').toBe(sipho.id);
    expect(Object.keys(sent), 'and no hr_staff_name or hr_staff_email').not.toEqual(expect.arrayContaining(['hr_staff_name']));
    expect(sent, 'no hr_staff_name').not.toHaveProperty('hr_staff_name');
    expect(sent, 'no hr_staff_email').not.toHaveProperty('hr_staff_email');
  });

  test('AC-5 If the list cannot be loaded the step says so, with Try again, and Next stays off', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    api!.partnersMode = 'error';
    await open(page, signIn, hr);
    await toStep3(page, AYANDA);
    await expect(main(page).getByText(LOAD_FAILED, { exact: true }), 'the words').toBeVisible();
    await expect(radios(page), 'no choices').toHaveCount(0);
    const nextBtn = button(page, NEXT[2]!);
    expect((await nextBtn.count()) === 0 || (await nextBtn.isDisabled()), 'Next: check details is off').toBe(true);
    api!.partnersMode = 'ok';
    await main(page).getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(radios(page), 'Try again reads the list again').toHaveCount(api!.partners.length);
    await expect(main(page).getByText(LOAD_FAILED, { exact: true })).toHaveCount(0);
    await expect(nextBtn).toBeEnabled();
  });

  // -------------------------------------------------------------- AC-6
  test('AC-6 Register once, then say so: one POST with an Idempotency-Key, values as typed, a registered page with no password and no UUID', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    const typed: Person = { ...AYANDA, email: ' Ayanda.Zulu@Mokoena.co.za ' };
    await open(page, signIn, hr);
    await toConfirmation(page, typed, { id: true });
    expect(await everythingOnPage(page)).toContain('Engineering');
    // a double press, as fast as a script can: the page makes one request
    api!.createMode = 'hold';
    await registerButton(page, typed.first).evaluate((b: HTMLElement) => { b.click(); b.click(); });
    await page.waitForTimeout(600);
    await expect.poll(() => api!.posts.length, { message: 'the request went out' }).toBeGreaterThan(0);
    await page.waitForTimeout(400);
    api!.release();
    await expect(h1(page)).toHaveText(`${AYANDA.first} ${AYANDA.last} is registered`, { timeout: 20_000 });
    expect(api!.posts, 'pressing Register twice sends exactly one POST').toHaveLength(1);
    const post = api!.posts[0]!;
    expect(post.authorization, 'with the signed-in token').toMatch(/^Bearer eyJ/);
    expect(post.headers['idempotency-key'], 'with an Idempotency-Key').toMatch(/\S{8,}/);
    expect(post.body, 'values as typed, the email trimmed, dates as YYYY-MM-DD').toMatchObject({
      first_name: AYANDA.first, middle_name: AYANDA.middle, last_name: AYANDA.last, email: 'Ayanda.Zulu@Mokoena.co.za', phone: AYANDA.phone,
      department: AYANDA.department, job_title: AYANDA.title, planned_start_date: AYANDA.startIso, offer_accept_date: AYANDA.offerIso,
    });
    expect(post.body['hr_staff_id'], 'the signed-in HR person was chosen first').toBe('E2EHR01');

    // the registered page
    const name = `${AYANDA.first} ${AYANDA.last}`;
    await expect(main(page).getByText(`${name} has been added.`, { exact: true }), 'success message').toBeVisible();
    await expect(main(page).getByText(`${AYANDA.first} uploads their documents after they sign in.`, { exact: true }), 'what happens next').toBeVisible();
    await expect(main(page).getByRole('heading', { name: 'Sign-in details' }), 'Sign-in details card').toBeVisible();
    await expect(main(page).locator('dt', { hasText: /^\s*Email\s*$/ }).locator('xpath=following-sibling::dd[1]'), 'the Email row').toHaveText(new RegExp(`^\\s*${esc(AYANDA.email)}\\s*$`, 'i'));
    await expect(main(page).getByText(new RegExp(`^A welcome email was sent to ${esc(AYANDA.email)}\\.$`, 'i')), 'the welcome email was sent').toBeVisible();
    const text = await main(page).innerText();
    expect(text, 'no password is shown or mentioned').not.toMatch(/password/i);
    expect(text, 'no UUID is shown').not.toMatch(UUID);
    expect(text, 'the kit\'s "She" lines are not used').not.toMatch(/\b(she|her|he|his)\b/i);
    expect(text, 'no invite link wording before ONB-04').not.toMatch(/invite link/i);
    await expect(page.getByRole('button', { name: /resend|send a new/i }), 'no resend button yet (ONB-18)').toHaveCount(0);
    expect(await storageText(page), 'Register clears the draft').not.toContain(AYANDA.last);

    // View employee opens the employee's page
    const id = api!.created[0]!.id;
    const view = page.getByRole('link', { name: 'View employee', exact: true }).or(page.getByRole('button', { name: 'View employee', exact: true })).first();
    await expect(view).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to home', exact: true }).or(page.getByRole('button', { name: 'Back to home', exact: true })).first()).toBeVisible();
    await view.click();
    await expect(page, 'View employee: the employee\'s page').toHaveURL(new RegExp(`/hr/employees/${esc(id)}$`));
  });

  test('AC-6 The welcome email "not sent" line; Register another opens an empty step 1; HR home lists the person as Invited', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    api!.welcomeSent = false;
    await open(page, signIn, hr);
    await toConfirmation(page, AYANDA, { partner: /Sipho Ndlovu/ });
    await register(page, AYANDA);
    await expect(h1(page)).toHaveText(`${AYANDA.first} ${AYANDA.last} is registered`, { timeout: 20_000 });
    await expect(main(page).getByText(`The welcome email was not sent. ${AYANDA.first} can still be sent a new one later.`, { exact: true }), 'not sent').toBeVisible();
    expect(await main(page).innerText(), 'and does not say it was sent').not.toMatch(/welcome email was sent/i);

    // Back to home: the person is there as Invited, with the chosen HR partner (named from the pool, not the browser)
    await page.getByRole('link', { name: 'Back to home', exact: true }).or(page.getByRole('button', { name: 'Back to home', exact: true })).first().click();
    await expect(page).toHaveURL(new RegExp(`${esc(HOME)}$`));
    const row = page.getByRole('row').filter({ hasText: `${AYANDA.first} ${AYANDA.last}` });
    await expect(row, 'HR home lists the new person').toHaveCount(1, { timeout: 20_000 });
    await expect(row).toContainText('Invited');
    await expect(row).toContainText('Sipho Ndlovu');

    // Register another: an empty step 1
    await page.getByRole('link', { name: 'Add new employee', exact: true }).or(page.getByRole('button', { name: 'Add new employee', exact: true })).first().click();
    await expectStep(page, 1);
    expect(await values(page, ['first', 'middle', 'last', 'email', 'phone', 'id']), 'a new registration starts empty').toEqual({ first: '', middle: '', last: '', email: '', phone: '', id: '' });
  });

  test('AC-6 Register another from the registered page opens an empty step 1; a failed POST keeps the answers and Try again reuses the key', async ({ page, signIn, hr, api }) => {
    noBackendOnly();
    await open(page, signIn, hr);
    await toConfirmation(page, AYANDA);
    api!.createMode = 'error';
    await register(page, AYANDA);
    await expect(main(page).getByText(FAILED, { exact: true }), 'the failure words').toBeVisible();
    const again = main(page).getByRole('button', { name: 'Try again', exact: true });
    await expect(again).toBeVisible();
    await expectStep(page, 4);
    expect(api!.posts).toHaveLength(1);
    expect(await storageText(page), 'the draft is left in place').toContain(AYANDA.first);
    api!.createMode = 'created';
    await again.click();
    await expect(h1(page)).toHaveText(`${AYANDA.first} ${AYANDA.last} is registered`, { timeout: 20_000 });
    expect(api!.posts, 'Try again sends the request again').toHaveLength(2);
    const [k1, k2] = api!.posts.map((p) => p.headers['idempotency-key']);
    expect(k1, 'the first request has a key').toMatch(/\S/);
    expect(k2, 'Try again reuses the key').toBe(k1);
    expect(api!.created, 'one person was made').toHaveLength(1);

    // a new registration gets a new key
    await page.getByRole('button', { name: 'Register another', exact: true }).or(page.getByRole('link', { name: 'Register another', exact: true })).first().click();
    await expectStep(page, 1);
    expect(await values(page, ['first', 'middle', 'last', 'email', 'phone']), 'Register another opens an empty step 1').toEqual({ first: '', middle: '', last: '', email: '', phone: '' });
    const second: Person = { ...AYANDA, first: 'Sipho', last: 'Dube', email: 'sipho.dube@mokoena.co.za' };
    await toConfirmation(page, second);
    await register(page, second);
    await expect(h1(page)).toHaveText('Sipho Dube is registered', { timeout: 20_000 });
    expect(api!.posts).toHaveLength(3);
    expect(api!.posts[2]!.headers['idempotency-key'], 'a second registration has its own key').not.toBe(k1);
  });

  // -------------------------------------------------------------- AC-7
  test('AC-7 Phone: on every step and the registered page every heading and button is visible, clear of the top bar and inside the screen', async ({ page, signIn, hr, api }, testInfo) => {
    noBackendOnly();
    test.skip(testInfo.project.name !== 'phone-390', 'The phone criterion: 390 wide.');
    await open(page, signIn, hr);
    const check = async (what: string, names: Array<string | RegExp>, step?: 1 | 2 | 3 | 4) => {
      await expect(h1(page), `${what}: the heading is visible`).toBeVisible();
      if (step) {
        await expectStep(page, step);
        await expect(currentStep(page), `${what}: the tracker shows the current step`).toBeVisible();
        const box = (await currentStep(page).boundingBox())!;
        expect(box.x >= 0 && box.x + box.width <= 391, `${what}: the current step is inside the 390 width`).toBe(true);
      }
      for (const n of names) await expect(button(page, n).or(page.getByRole('link', { name: n })).first(), `${what}: ${String(n)} is visible`).toBeVisible();
      expect(await noSidewaysScroll(page), `${what}: nothing scrolls sideways`).toEqual([]);
      expect(await hiddenOrCovered(page), `${what}: every heading and button is visible, inside the width and not under the top bar`).toEqual([]);
    };
    await check('step 1', ['Cancel', NEXT[0]!], 1);
    await fillStep1(page, LONG, { id: true });
    await next(page, 1);
    await check('step 2', ['Previous', NEXT[1]!], 2);
    await fillStep2(page, LONG);
    await next(page, 2);
    await check('step 3', ['Previous', NEXT[2]!], 3);
    await next(page, 3);
    await check('confirmation', ['Previous', new RegExp(`^Register( ${esc(LONG.first)})?$`)], 4);
    await register(page, LONG);
    await expect(h1(page)).toHaveText(`${LONG.first} ${LONG.last} is registered`, { timeout: 20_000 });
    await check('registered page', ['View employee', 'Register another', 'Back to home']);
    expect(api!.posts).toHaveLength(1);
  });

  // -------------------------------------------------------------- AC-8
  test('AC-8 Only HR: createEmployee, getHrPartners and checkEmployeeEmail refuse everyone else with a 403 and touch nothing', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const as = (groups: string[], form: GroupsForm = 'bracket'): JwtCaller => ({ ...EMPLOYEE, groups, form });
    const strangers: Array<[string, Caller]> = [
      ['employee only, "[employee]"', as(['employee'], 'bracket')],
      ['employee only, as a list', as(['employee'], 'array')],
      ['employee only, as one name', as(['employee'], 'name')],
      ['in no group', as([])],
      ['not_hr_staff, "[not_hr_staff]"', as(['not_hr_staff'], 'bracket')],
      ['not_hr_staff, as a list', as(['not_hr_staff'], 'array')],
      ['not_hr_staff, as one name', as(['not_hr_staff'], 'name')],
      ['employee and not_hr_staff', as(['employee', 'not_hr_staff'], 'bracket')],
      ['hr_staff_helper (a longer name)', as(['hr_staff_helper'], 'array')],
    ];
    const world: World = { ...emptyWorld(), cognito: { users: [member('Lerato', 'Mokoena', { staffId: 'AS00002' })] } };
    world.tables.employees.push(employeeRow({ employee_id: 'E-1', email: 'taken@x.co.za', first_name: 'Taken' }));
    const routes: Array<[string, (c: Caller) => Run, string | null]> = [
      ['POST /v1/employees', (c) => create(world, c, body({ email: 'new.person@x.co.za' })), 'Only HR can add an employee'],
      ['POST /v1/employees with a broken body', (c) => create(world, c, 'not json'), 'Only HR can add an employee'],
      ['POST /v1/employees with no body', (c) => create(world, c, undefined), 'Only HR can add an employee'],
      ['GET /v1/hr-partners', (c) => partners(world, c), null],
      ['GET /v1/employees/email-check', (c) => emailCheck(world, c, 'taken@x.co.za'), null],
    ];
    for (const [route, call, words] of routes) {
      for (const [who, caller] of strangers) {
        const r = call(caller);
        const how = `${route}, ${who}`;
        expect(r.error, `${how}: does not throw`).toBeUndefined();
        expect(r.status, `${how}: 403`).toBe(403);
        expect(typeof r.body?.error, `${how}: an error message`).toBe('string');
        if (words) expect(r.body.error, `${how}: the words`).toBe(words);
        expect(aws(r), `${how}: nothing is written, listed, read, created or sent`).toEqual([]);
        for (const leak of ['items', 'inUse', 'Lerato', 'taken@x.co.za', 'AS00002']) expect(r.raw, `${how}: the 403 does not carry "${leak}"`).not.toContain(leak);
      }
    }
    // no sign-in claims at all
    for (const [route, call] of routes) {
      const r = call({ kind: 'none' });
      expect([401, 403], `${route}, no claims at all: refused (${r.status})`).toContain(r.status);
      expect(aws(r), `${route}, no claims at all: nothing is touched`).toEqual([]);
    }
    // HR gets through, in each form of the claim
    const hrForms: Array<[string, Caller]> = [
      ['"[hr_staff]"', { ...HR, form: 'bracket' }],
      ['"[employee hr_staff]"', { ...HR, groups: ['employee', 'hr_staff'], form: 'bracket' }],
      ['a list', { ...HR, form: 'array' }],
      ['one name', { ...HR, form: 'name' }],
    ];
    let n = 0;
    for (const [what, caller] of hrForms) {
      n++;
      const made = create(world, caller, body({ email: `hr.form${n}@x.co.za` }));
      expect(made.status, `createEmployee: HR as ${what} passes`).toBe(201);
      expect(partners(world, caller).status, `getHrPartners: HR as ${what} passes`).toBe(200);
      const c = emailCheck(world, caller, 'someone.free@x.co.za');
      expect(c.status, `checkEmployeeEmail: HR as ${what} passes`).toBe(200);
      expect(c.body, `checkEmployeeEmail: HR as ${what}: not in use`).toEqual({ inUse: false });
    }
    const agent = create(world, AGENT, body({ email: 'agent.made@x.co.za' }));
    expect(agent.status, 'createEmployee: the agent still gets through').toBe(201);
    expect(aiReached(agent), 'no AI is reached').toEqual([]);
  });

  // -------------------------------------------------------------- AC-9
  test('AC-9 A bad request is a 400, not a 500, and nothing is written', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const world = emptyWorld();
    const long = (n: number) => 'x'.repeat(n);
    const cases: Array<[string, unknown, string | null]> = [
      ['no body at all', undefined, null],
      ['an empty body', '', null],
      ['not json', 'not json', null],
      ['the JSON null', 'null', null],
      ['a JSON list', '[]', null],
      ['a JSON string', '"hello"', null],
      ['a missing first name', body({ first_name: undefined }), 'first_name'],
      ['an empty last name', body({ last_name: '' }), 'last_name'],
      ['a bad email', body({ email: 'jane.doe@' }), 'email'],
      ['an email with spaces inside', body({ email: 'jane doe@x.co.za' }), 'email'],
      ['a phone with letters', body({ phone: '081 234 5ab8' }), 'phone'],
      ['a phone with letters among enough digits', body({ phone: '081 234 5678 ab' }), 'phone'],
      ['a phone that is too short', body({ phone: '081 234' }), 'phone'],
      ['a phone that is too long', body({ phone: '081 234 5678 9012 3456' }), 'phone'],
      ['30 February as the start date', body({ planned_start_date: '2026-02-30' }), 'planned_start_date'],
      ['a start date that is not ISO', body({ planned_start_date: '1 Dec 2026' }), 'planned_start_date'],
      ['month 13 as the offer date', body({ offer_accept_date: '2026-13-01' }), 'offer_accept_date'],
      ['a 12-digit ID number', body({ id_number: saId('950614').slice(0, 12) }), 'id_number'],
      ['an ID number with a bad checksum', body({ id_number: withBadCheck(saId('950614')) }), 'id_number'],
      ['an ID number with letters', body({ id_number: '95061450090A5' }), 'id_number'],
      ['an ID number with an impossible date', body({ id_number: saId('950231') }), 'id_number'],
      ['a 300-character first name', body({ first_name: long(300) }), 'first_name'],
      ['a 101-character last name', body({ last_name: long(101) }), 'last_name'],
      ['a 101-character job title', body({ job_title: long(101) }), 'job_title'],
      ['a 101-character department', body({ department: long(101) }), 'department'],
    ];
    for (const [what, payload, field] of cases) {
      const r = create(world, HR, payload);
      expect(r.error, `${what}: does not throw`).toBeUndefined();
      expect(r.status, `${what}: 400 (got ${r.status}: ${r.raw.slice(0, 120)})`).toBe(400);
      expect(typeof r.body?.error, `${what}: an error message`).toBe('string');
      if (field === 'first_name' && what.startsWith('a missing')) {
        expect(r.body.missing ?? Object.keys(r.body.fields ?? {}), `${what}: the missing list names the field`).toContain(field);
      } else if (field === 'last_name' && what.startsWith('an empty')) {
        expect(r.body.missing ?? Object.keys(r.body.fields ?? {}), `${what}: the missing list names the field`).toContain(field);
      } else if (field) {
        expect(r.body.error, `${what}: the error words`).toBe('Check the highlighted fields');
        expect(Object.keys(r.body.fields ?? {}), `${what}: fields names the field`).toContain(field);
        expect(typeof r.body.fields[field], `${what}: with a message`).toBe('string');
        expect(r.body.fields[field], `${what}: the message is not empty`).toMatch(/\S/);
      } else {
        expect(r.body.error, `${what}: the error words`).toBe('The request body is missing or not valid');
      }
      expect(writesTo(r, 'employees'), `${what}: nothing is put in employees`).toBe(0);
      expect(cognitoCalls(r), `${what}: Cognito is never called`).toEqual([]);
      expect(published(r), `${what}: nothing is published`).toEqual([]);
      expect(r.calls.filter((c) => c.service === 'postmark' || c.service === 'kms' || c.service === 'sfn'), `${what}: no email, no KMS, no Step Functions`).toEqual([]);
    }
    expect(stored(world), 'nothing was stored by any of them').toEqual([]);

    // several mistakes: all named at once
    const many = create(world, HR, body({ email: 'nope', phone: 'abc', planned_start_date: '2026-02-30' }));
    expect(many.status).toBe(400);
    expect(Object.keys(many.body.fields ?? {}).sort(), 'every wrong field is named').toEqual(['email', 'phone', 'planned_start_date']);

    // a valid body still works
    const good = saId('950614');
    const ok = create(world, HR, body({ id_number: good, middle_name: 'Thembeka', offer_accept_date: '2026-11-06', planned_start_date: '2028-02-29' }));
    expect(ok.status, `a valid body: 201 (${ok.raw.slice(0, 150)})`).toBe(201);
    expect(ok.body.employee, 'the answer carries the employee').toBeTruthy();
    expect(ok.raw, 'id_number_encrypted is never in the answer').not.toContain('id_number_encrypted');
    expect(ok.raw, 'nor the encrypted number').not.toContain(Buffer.from(`kms:${good}`).toString('base64'));
    expect(ok.raw, 'nor the full number').not.toContain(good);
    const row = stored(ok.world)[0]!;
    expect(row['id_number_last4'], 'the last four are kept').toBe(good.slice(-4));
    expect(typeof row['id_number_encrypted'], 'the number is kept encrypted').toBe('string');
    expect(JSON.stringify(row), 'and never in clear').not.toContain(good);
    expect(row['stage'], 'in stage INVITED').toBe('INVITED');
    expect(published(ok).map((e) => e.detailType), 'employee.invited is published').toEqual(['employee.invited']);
    // dates and phone shapes that are fine
    for (const phone of ['+27 81 234 5678', '0812345678', '081 234 5678']) {
      expect(create(emptyWorld(), HR, body({ phone })).status, `phone "${phone}" is accepted`).toBe(201);
    }
    expect(create(emptyWorld(), HR, body({ offer_accept_date: '', planned_start_date: undefined, job_title: undefined })).status, 'optional fields may be left out or empty').toBe(201);
  });

  // -------------------------------------------------------------- AC-10
  test('AC-10 Email is one person whatever the capitals: stored lower case, duplicates refused in every form, email-check answers inUse and nothing else', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const world = emptyWorld();
    const first = create(world, HR, body({ email: 'Jane.Doe@X.co.za' }));
    expect(first.status, `first registration: 201 (${first.raw.slice(0, 120)})`).toBe(201);
    expect(stored(first.world).map((p) => p['email']), 'the email is stored lower case').toEqual(['jane.doe@x.co.za']);
    expect(cognitoCalls(first, 'AdminCreateUser').length, 'one sign-in is made').toBe(1);

    for (const form of ['jane.doe@x.co.za', ' JANE.DOE@X.CO.ZA ', 'Jane.Doe@X.co.za', 'JANE.doe@x.co.za']) {
      const dup = create(first.world, HR, body({ email: form, first_name: 'Other' }));
      expect(dup.status, `"${form}": 409`).toBe(409);
      expect(dup.body.code, `"${form}": DUPLICATE_EMAIL`).toBe('DUPLICATE_EMAIL');
      expect(writesTo(dup, 'employees'), `"${form}": nothing written`).toBe(0);
      expect(cognitoCalls(dup, 'AdminCreateUser'), `"${form}": no second sign-in`).toEqual([]);
      expect(published(dup), `"${form}": nothing published`).toEqual([]);
      const check = emailCheck(first.world, HR, form);
      expect(check.status, `email-check "${form}": 200`).toBe(200);
      expect(check.body, `email-check "${form}": inUse and nothing else`).toEqual({ inUse: true });
      expect(writesTo(check, 'employees'), 'email-check writes nothing').toBe(0);
    }
    expect(emailCheck(first.world, HR, 'someone.new@x.co.za').body, 'a free address').toEqual({ inUse: false });
    expect(emailCheck(first.world, HR, '  Someone.New@X.co.za  ').body, 'a free address, with capitals and spaces').toEqual({ inUse: false });

    // a row stored earlier as typed, with capitals: found by the address as typed
    const old = emptyWorld();
    old.tables.employees.push(employeeRow({ employee_id: 'old-1', email: 'Old.Person@x.co.za', first_name: 'Old', last_name: 'Person', stage: 'INVITED' }));
    const dup = create(old, HR, body({ email: 'Old.Person@x.co.za' }));
    expect(dup.status, 'an old mixed-case row still blocks the address as typed: 409').toBe(409);
    expect(writesTo(dup, 'employees')).toBe(0);
    expect(emailCheck(old, HR, 'Old.Person@x.co.za').body, 'and email-check says in use').toEqual({ inUse: true });
    expect(emailCheck(old, HR, ' Old.Person@x.co.za ').body, 'with spaces around it').toEqual({ inUse: true });

    // the index is only asked, never scanned, never read consistently
    for (const r of [dup, emailCheck(old, HR, 'Old.Person@x.co.za')]) {
      const ops = dynamoCalls(r).map((c) => `${c.op}${c.input?.IndexName ? ' ' + c.input.IndexName : ''}`);
      expect(ops.every((o) => o === 'Query email-index'), `only Query on email-index (got ${ops.join(', ')})`).toBe(true);
    }

    // email-check: bad shapes are a 400, and the answer has no id
    for (const bad of [undefined, '', 'not-an-email', 'a@b', '@x.co.za', 'jane doe@x.co.za']) {
      const r = emailCheck(first.world, HR, bad);
      expect(r.status, `email-check "${String(bad)}": 400`).toBe(400);
      expect(r.raw, `email-check "${String(bad)}": no id leaks`).not.toMatch(/employee_id|existingEmployeeId|jane/i);
    }
    const hit = emailCheck(first.world, HR, 'jane.doe@x.co.za');
    expect(Object.keys(hit.body), 'the answer has the one key').toEqual(['inUse']);
    expect(hit.raw, 'and no id of the person').not.toMatch(new RegExp(String(stored(first.world)[0]!['employee_id'])));
  });

  // -------------------------------------------------------------- AC-11
  test('AC-11 The HR partner comes from the pool, not the browser; getHrPartners lists every page and nothing more', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    // 130 HR people: three pages of 60, 60 and 10. Names mix capitals; two have no staff ID; five people are not HR.
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const given = (i: number) => {
      const s = letters[Math.floor(i / 676) % 26]! + letters[Math.floor(i / 26) % 26]! + letters[i % 26]! + 'ndu';
      return i % 3 === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
    };
    const hrPeople: CognitoUser[] = [];
    for (let i = 0; i < 130; i++) hrPeople.push(member(given(i * 7 + 1), 'Test', { staffId: `HR${String(i).padStart(4, '0')}` }));
    const shuffled = hrPeople.map((u, i) => [u, (i * 37) % 130] as const).sort((a, b) => a[1] - b[1]).map(([u]) => u);
    const strangers = ['Pele', 'Quinn', 'Rudo', 'Sizwe', 'Thabo'].map((n, i) => member(n, 'Employee', { staffId: `EMP${i}`, groups: ['employee'] }));
    const both = member('Both', 'Groups', { staffId: 'BOTH1', groups: ['employee', 'hr_staff'] });
    const world: World = { ...emptyWorld(), cognito: { users: [...strangers.slice(0, 2), ...shuffled, ...strangers.slice(2), both] } };
    const everyone = [...shuffled, both];

    const r = partners(world, HR);
    expect(r.status, `200 (${r.raw.slice(0, 120)})`).toBe(200);
    expect(r.error).toBeUndefined();
    const items = r.body.items as Array<Record<string, string>>;
    expect(Object.keys(r.body), 'the answer is { items }').toEqual(['items']);
    expect(items, 'every member, over every page: 131').toHaveLength(everyone.length);
    expect(cognitoCalls(r, 'ListUsersInGroup').length, 'the pool was read page after page').toBeGreaterThanOrEqual(3);
    expect(cognitoCalls(r).every((c) => c.input.GroupName === 'hr_staff' && c.op === 'ListUsersInGroup'), 'only ListUsersInGroup, only hr_staff').toBe(true);
    for (const it of items) expect(Object.keys(it).sort(), 'each item has id, name, staffId and email, and nothing else').toEqual(['email', 'id', 'name', 'staffId']);
    const want = everyone.map((u) => ({ id: u.attributes['custom:staff_id']!, name: `${u.attributes['given_name']} ${u.attributes['family_name']}`, staffId: u.attributes['custom:staff_id']!, email: u.attributes['email']! }));
    expect([...items].sort((a, b) => a.id!.localeCompare(b.id!)), 'the right people with the right values').toEqual(want.sort((a, b) => a.id.localeCompare(b.id)));
    const lower = items.map((i) => i.name!.toLowerCase());
    expect(lower, 'sorted by name, ignoring case').toEqual([...lower].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    for (const s of strangers) expect(r.raw, `${s.attributes['given_name']} is not in hr_staff: not listed`).not.toContain(s.attributes['email']!);
    for (const u of everyone.slice(0, 5)) {
      for (const secret of [u.attributes['sub']!, u.attributes['phone_number']!, u.attributes['custom:disabled_reason']!, 'email_verified', 'custom:']) {
        expect(r.raw, `no "${secret}" in the answer`).not.toContain(secret);
      }
    }
    expect(aiReached(r)).toEqual([]);

    // a member with no staff ID: the Cognito username is the id
    const noId = member('Zandile', 'Nosid', { username: 'zandile-nosid-user' });
    const w2: World = { ...emptyWorld(), cognito: { users: [noId, member('Lerato', 'Mokoena', { staffId: 'AS00002' })] } };
    const r2 = partners(w2, HR);
    const z = (r2.body.items as Array<Record<string, string>>).find((i) => i.name === 'Zandile Nosid');
    expect(z?.id, 'with no staff ID the id is the Cognito username').toBe('zandile-nosid-user');
    expect(z?.email).toBe(noId.attributes['email']);

    // createEmployee: the saved partner is the pool's, whatever the body says
    const lastOne = everyone[everyone.length - 2]!; // on the third page
    expect(everyone.indexOf(lastOne), 'the chosen member is on the third page').toBeGreaterThanOrEqual(120);
    const made = create(world, HR, body({ hr_staff_id: lastOne.attributes['custom:staff_id'], hr_staff_name: 'Mallory Fake', hr_staff_email: 'mallory@evil.test' }));
    expect(made.status, `a member: 201 (${made.raw.slice(0, 150)})`).toBe(201);
    const row = stored(made.world).find((p) => p['email'] === 'jane.doe@x.co.za')!;
    expect(row['hr_staff_id'], 'saved hr_staff_id').toBe(lastOne.attributes['custom:staff_id']);
    expect(row['hr_staff_name'], 'saved name is the member\'s').toBe(`${lastOne.attributes['given_name']} ${lastOne.attributes['family_name']}`);
    expect(row['hr_staff_email'], 'saved email is the member\'s').toBe(lastOne.attributes['email']);
    expect(JSON.stringify(row), 'nothing of the body\'s text is kept').not.toMatch(/Mallory|evil\.test/);
    expect(made.raw, 'nor in the answer').not.toMatch(/Mallory|evil\.test/);
    expect(cognitoCalls(made, 'ListUsersInGroup').length, 'every page was read to find them').toBeGreaterThanOrEqual(3);

    // a member with no staff ID is found by the username
    const byName = create(w2, HR, body({ email: 'by.username@x.co.za', hr_staff_id: 'zandile-nosid-user' }));
    expect(byName.status, 'a member known by username: 201').toBe(201);
    expect(storedWithEmail(byName.world, 'by.username@x.co.za')?.['hr_staff_name']).toBe('Zandile Nosid');

    // not a member: 400, nothing written
    for (const [what, id] of [['an id nobody has', 'HR9999'], ['an employee-only person', 'EMP2'], ['the caller\'s own text as an id', 'jane.smith@mokoena-logistics.co.za']] as const) {
      const bad = create(world, HR, body({ email: 'bad.partner@x.co.za', hr_staff_id: id, hr_staff_name: 'Jane Smith' }));
      expect(bad.status, `${what}: 400 (${bad.raw.slice(0, 120)})`).toBe(400);
      expect(bad.body.error, `${what}: the words`).toBe('Choose an HR partner from the list');
      expect(Object.keys(bad.body.fields ?? {}), `${what}: fields names hr_staff_id`).toContain('hr_staff_id');
      expect(writesTo(bad, 'employees'), `${what}: nothing written`).toBe(0);
      expect(cognitoCalls(bad, 'AdminCreateUser'), `${what}: no sign-in made`).toEqual([]);
      expect(published(bad), `${what}: nothing published`).toEqual([]);
    }

    // none sent: the caller, as today
    const own = create(world, HR, body({ email: 'own.partner@x.co.za' }));
    expect(own.status).toBe(201);
    expect(storedWithEmail(own.world, 'own.partner@x.co.za')?.['hr_staff_id'], 'no hr_staff_id sent: the caller').toBe('E2EHR01');
    const byAgent = create(world, AGENT, body({ email: 'agent.partner@x.co.za' }));
    expect(byAgent.status).toBe(201);
    expect(storedWithEmail(byAgent.world, 'agent.partner@x.co.za')?.['hr_staff_id'], 'the agent: as today').toBe('agent');
  });

  // -------------------------------------------------------------- AC-12
  test('AC-12 Terraform, the Lambda folders and the API description match: two routes, two roles, one new IAM line, no wildcards', async ({}, testInfo) => {
    textOnce(testInfo);
    const NEW = [
      { fn: 'getHrPartners', route: 'GET /v1/hr-partners', only: (s: { action: string; resource: string }) => s.action === 'cognito-idp:ListUsersInGroup' && /:userpool\//.test(s.resource) && !s.resource.includes('*') },
      { fn: 'checkEmployeeEmail', route: 'GET /v1/employees/email-check', only: (s: { action: string; resource: string }) => s.action === 'dynamodb:Query' && /:table\/employees\/index\/email-index$/.test(s.resource) },
    ];
    const files = tfFiles();
    const res = (type: string) => blocks(files, 'resource').filter((b) => b.labels[0] === type);
    const attr = (b: { body: string }, name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm').exec(b.body)?.[1]?.trim().replace(/\s+/g, '') ?? '';
    const flat = (s: Statement | Statement[]) => (Array.isArray(s) ? s : [s]).flatMap((st) => {
      const actions = ([] as string[]).concat((st.Action as string | string[] | undefined) ?? []);
      const resources = ([] as string[]).concat((st.Resource as string | string[] | undefined) ?? []);
      return actions.flatMap((action) => resources.map((resource) => ({ sid: st.Sid ?? '', effect: st.Effect, action, resource })));
    });
    const ordinary = (a: string) => !a.startsWith('logs:') && !a.startsWith('xray:');

    for (const n of NEW) {
      // the Lambda folder, in the build
      expect(existsSync(join(REPO, 'lambda', n.fn, 'index.mjs')), `lambda/${n.fn}/index.mjs exists`).toBe(true);
      expect(existsSync(join(REPO, 'lambda', n.fn, 'package.json')), `lambda/${n.fn}/package.json exists (build-lambdas.py zips every folder that has one)`).toBe(true);
      expect(readFileSync(join(REPO, 'lambda', n.fn, 'index.mjs'), 'utf8'), `${n.fn} exports handler`).toMatch(/export\s+(const|async function|function)\s+handler\b/);

      // the function, its own role and policy
      const fn = res('aws_lambda_function').find((b) => attr(b, 'function_name') === `"${n.fn}"`);
      expect(fn, `a Terraform function named ${n.fn}`).toBeTruthy();
      expect(attr(fn!, 'handler'), `${n.fn}: handler`).toBe('"index.handler"');
      expect(attr(fn!, 'runtime'), `${n.fn}: runtime`).toBe('"nodejs22.x"');
      expect(fn!.body, `${n.fn}: X-Ray tracing is on`).toMatch(/tracing_config\s*\{\s*mode\s*=\s*"Active"/);
      expect(fn!.body, `${n.fn}: its own log group`).toContain(`"/aws/lambda/${n.fn}"`);
      expect(fn!.body, `${n.fn}: ignore_changes for code, as the others`).toMatch(/ignore_changes\s*=\s*\[[^\]]*filename/);
      const roleRef = /aws_iam_role\.(\w+)\.arn/.exec(attr(fn!, 'role'));
      expect(roleRef, `${n.fn}: has a role of its own`).toBeTruthy();
      expect(roleRef![1], `${n.fn}: not createEmployee's role`).not.toBe('create_employee');
      const sharing = res('aws_lambda_function').filter((b) => attr(b, 'role') === attr(fn!, 'role'));
      expect(sharing.map((b) => attr(b, 'function_name')), `${n.fn}: the role is used by this function only`).toEqual([`"${n.fn}"`]);
      const role = res('aws_iam_role').find((b) => b.labels[1] === roleRef![1]);
      expect(role, `${n.fn}: the role resource exists`).toBeTruthy();
      const policies = res('aws_iam_role_policy').filter((b) => attr(b, 'role') === `aws_iam_role.${roleRef![1]}.name`);
      expect(policies, `${n.fn}: one inline policy`).toHaveLength(1);
      expect(res('aws_iam_role_policy_attachment').filter((b) => attr(b, 'role').includes(`aws_iam_role.${roleRef![1]}.`)), `${n.fn}: no attached managed policy`).toEqual([]);
      const rows = flat(policyOf(resourcesNamed('aws_iam_role_policy', policies[0]!.labels[1]!)[0]!).Statement);
      expect(rows.every((r) => r.effect === 'Allow'), `${n.fn}: Allow only`).toBe(true);
      for (const r of rows) {
        expect(r.action, `${n.fn}: no wildcard action (${r.action})`).not.toMatch(/\*/);
        if (r.resource === '*') expect(r.action, `${n.fn}: Resource "*" only for X-Ray`).toMatch(/^xray:/);
      }
      const extra = rows.filter((r) => ordinary(r.action));
      expect(extra.map((r) => `${r.action} ${r.resource}`), `${n.fn}: the only real action is the one it needs`).toHaveLength(1);
      expect(n.only(extra[0]!), `${n.fn}: the one action is the right one on the right resource (${extra[0]?.action} on ${extra[0]?.resource})`).toBe(true);
      const logs = rows.filter((r) => r.action.startsWith('logs:'));
      expect(logs.every((r) => r.resource.includes(`/aws/lambda/${n.fn}`)), `${n.fn}: logs only into its own group`).toBe(true);

      // the route, on the employees API, behind the JWT authorizer, and allowed to call the function
      const route = res('aws_apigatewayv2_route').find((b) => attr(b, 'route_key') === `"${n.route.replace(/\s+/g, '')}"`);
      expect(route, `a route ${n.route}`).toBeTruthy();
      expect(attr(route!, 'api_id'), `${n.route}: on the employees API`).toBe('aws_apigatewayv2_api.employees_api.id');
      expect(attr(route!, 'authorization_type'), `${n.route}: JWT`).toBe('"JWT"');
      expect(attr(route!, 'authorizer_id'), `${n.route}: the Cognito authorizer`).toBe('aws_apigatewayv2_authorizer.employees_api_cognito.id');
      const integration = /aws_apigatewayv2_integration\.(\w+)\.id/.exec(attr(route!, 'target'));
      const ib = res('aws_apigatewayv2_integration').find((b) => b.labels[1] === integration?.[1]);
      expect(ib, `${n.route}: has an integration`).toBeTruthy();
      expect(attr(ib!, 'integration_uri'), `${n.route}: calls ${n.fn}`).toContain(`aws_lambda_function.${fn!.labels[1]}.invoke_arn`);
      expect(attr(ib!, 'api_id'), `${n.route}: integration on the employees API`).toBe('aws_apigatewayv2_api.employees_api.id');
      const perm = res('aws_lambda_permission').find((b) => attr(b, 'function_name').includes(`aws_lambda_function.${fn!.labels[1]}.`));
      expect(perm, `${n.fn}: API Gateway may invoke it`).toBeTruthy();
      expect(attr(perm!, 'principal'), 'principal').toBe('"apigateway.amazonaws.com"');
    }

    // createEmployee: its role gains ListUsersInGroup on the pool, and nothing else
    const baselineFile = join(__dirname, 'support', 'onb-03', 'iam.create-employee.0841faa.tf.txt');
    const before = flat(policyOf(resourcesNamed('aws_iam_role_policy', 'create_employee', [baselineFile])[0]!).Statement).map((r) => `${r.effect} ${r.action} ${r.resource}`).sort();
    const now = flat(policyOf(resourcesNamed('aws_iam_role_policy', 'create_employee')[0]!).Statement);
    const after = now.map((r) => `${r.effect} ${r.action} ${r.resource}`).sort();
    const added = after.filter((x) => !before.includes(x));
    const removed = before.filter((x) => !after.includes(x));
    expect(removed, 'createEmployee\'s policy loses nothing').toEqual([]);
    expect(added, 'createEmployee\'s policy gains exactly ListUsersInGroup on the pool').toHaveLength(1);
    expect(added[0], 'on the user pool the function already has').toMatch(/^Allow cognito-idp:ListUsersInGroup arn:aws:cognito-idp:af-south-1:000000000000:userpool\/\$\{aws_cognito_user_pool\.naleko_dev\.id\}$/);
    for (const r of now) {
      expect(r.action, `createEmployee: no wildcard action (${r.action})`).not.toMatch(/\*/);
      if (r.resource === '*') expect(r.action, 'createEmployee: Resource "*" only for X-Ray').toMatch(/^xray:/);
    }

    // the alarm, log and dashboard lists: wherever createEmployee is, both new Lambdas are
    for (const file of ['alarms.tf', 'cloudwatch.tf', 'dashboards.tf']) {
      const text = readFileSync(join(REPO, 'infra', file), 'utf8').replace(/#.*$/gm, '');
      const count = (name: string) => (text.match(new RegExp(`"(/aws/lambda/)?${name}"`, 'g')) ?? []).length;
      expect(count('createEmployee'), `infra/${file} lists createEmployee`).toBeGreaterThan(0);
      for (const n of NEW) expect(count(n.fn), `infra/${file} lists ${n.fn} as often as createEmployee`).toBeGreaterThanOrEqual(count('createEmployee'));
    }

    // nothing existing is moved, renamed or removed
    const whole = files.map((f) => readFileSync(f, 'utf8').replace(/#.*$/gm, '')).join('\n');
    const moves = [...whole.matchAll(/^\s*(moved|removed)\s*\{[^}]*\}/gm)].map((m) => m[0]);
    expect(moves.filter((m) => /create_employee|get_hr_partners|check_employee_email|createEmployee|getHrPartners|checkEmployeeEmail/.test(m)), 'no moved or removed block touches createEmployee or the two new functions').toEqual([]);
    for (const name of ['aws_lambda_function.create_employee', 'aws_iam_role.create_employee', 'aws_iam_role_policy.create_employee', 'aws_apigatewayv2_route.create_employee']) {
      expect(whole, `${name} keeps its address`).toContain(`${name.split('.')[0]}" "${name.split('.')[1]}"`);
    }
    expect(attr(res('aws_iam_role').find((b) => b.labels[1] === 'create_employee')!, 'name'), 'createEmployee\'s role keeps its name').toBe('"naleko-createEmployee-role"');
    expect(attr(res('aws_lambda_function').find((b) => b.labels[1] === 'create_employee')!, 'function_name'), 'createEmployee keeps its name').toBe('"createEmployee"');

    // api/openapi.yaml
    const route = (p: string, m: string) => JSON.parse(execFileSync('python3', [join(__dirname, 'support', 'onb-15', 'openapi_route.py'), join(REPO, 'api', 'openapi.yaml'), p, m], { encoding: 'utf8' })) as { found: boolean; responses: string[]; fields: Record<string, string[]>; request: string[] };
    const params = (p: string, m: string) => JSON.parse(execFileSync('python3', [join(__dirname, 'support', 'onb-03', 'openapi_params.py'), join(REPO, 'api', 'openapi.yaml'), p, m], { encoding: 'utf8' })) as { found: boolean; parameters: Array<{ name: string; in: string; required: boolean }> };
    const partnersApi = route('/v1/hr-partners', 'get');
    expect(partnersApi.found, 'GET /v1/hr-partners is described').toBe(true);
    expect(partnersApi.responses, 'GET /v1/hr-partners: 200 and 403').toEqual(expect.arrayContaining(['200', '403']));
    expect(partnersApi.fields['200'], 'GET /v1/hr-partners: items with id, name, staffId, email').toEqual(expect.arrayContaining(['items', 'id', 'name', 'staffId', 'email']));
    const checkApi = route('/v1/employees/email-check', 'get');
    expect(checkApi.found, 'GET /v1/employees/email-check is described').toBe(true);
    expect(checkApi.responses, 'GET /v1/employees/email-check: 200, 400 and 403').toEqual(expect.arrayContaining(['200', '400', '403']));
    expect(checkApi.fields['200'], 'email-check answers inUse').toContain('inUse');
    expect(checkApi.fields['200']!.filter((x) => x !== 'inUse'), 'and nothing else').toEqual([]);
    const q = params('/v1/employees/email-check', 'get').parameters.find((x) => x.name === 'email');
    expect(q, 'email-check takes an email query parameter').toBeTruthy();
    expect(q!.in).toBe('query');
    expect(q!.required, 'a required one').toBe(true);
    const post = route('/v1/employees', 'post');
    expect(post.responses, 'POST /v1/employees: 400 and 403').toEqual(expect.arrayContaining(['400', '403']));
    expect(post.fields['400'], 'POST /v1/employees 400: error and fields').toEqual(expect.arrayContaining(['error', 'fields']));
    expect(post.fields['403'], 'POST /v1/employees 403: error').toContain('error');
    expect(post.request, 'EmployeeCreate has id_number').toContain('id_number');
    expect(post.request, 'and hr_staff_id').toContain('hr_staff_id');
  });

  // -------------------------------------------------------------- AC-13
  test('AC-13 pepla-dev: HR registers someone through the four steps and finds them Invited; the employee login gets 403 @pepla-dev', async ({ page, signIn, hr, employee }, testInfo) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only: AC-1 to AC-12 hold everything else in the no-backend run.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once, at one width.');
    test.setTimeout(240_000);
    const api = devApi();

    // the employee login, first: refused by every one of the three routes (an empty body is never created)
    const empToken = await signInForToken(page, signIn, employee);
    const asEmployee = { Authorization: `Bearer ${empToken}`, 'content-type': 'application/json' };
    const post = await page.request.post(`${api}/v1/employees`, { headers: asEmployee, data: {} });
    expect(post.status(), 'the employee login gets 403 from POST /v1/employees').toBe(403);
    const list = await page.request.get(`${api}/v1/hr-partners`, { headers: asEmployee });
    expect(list.status(), 'the employee login gets 403 from GET /v1/hr-partners').toBe(403);
    const check = await page.request.get(`${api}/v1/employees/email-check?email=${encodeURIComponent('nobody@blackhole.postmarkapp.com')}`, { headers: asEmployee });
    expect(check.status(), 'the employee login gets 403 from GET /v1/employees/email-check').toBe(403);
    for (const r of [post, list, check]) {
      const text = await r.text();
      for (const leak of ['"items"', 'inUse', 'Demo-HR', 'E2EHR01']) expect(text, `a 403 carries no ${leak}`).not.toContain(leak);
    }
    await page.context().clearCookies();
    await page.goto('about:blank');

    // HR: the four steps
    const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;
    const person: Person = { ...AYANDA, first: 'Zinhle', middle: '', last: `Run${Math.floor(Math.random() * 1e4)}`, email: `e2e.run-${stamp}@blackhole.postmarkapp.com`, department: 'Operations', title: 'Test starter' };
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(/\/hr$/, { timeout: 30_000 });
    await page.getByRole('link', { name: 'Add new employee', exact: true }).or(page.getByRole('button', { name: 'Add new employee', exact: true })).first().click();
    await expectStep(page, 1);
    await fillStep1(page, person, { middle: false });
    await button(page, 'Check email').click();
    await expect(main(page).getByText(NOT_USED, { exact: true }), 'the test address is free').toBeVisible({ timeout: 30_000 });
    await next(page, 1);
    await expectStep(page, 2);
    await fillStep2(page, person, { offer: false });
    await next(page, 2);
    await expectStep(page, 3);
    const mine = page.getByRole('radio', { name: /Demo-HR/ });
    await expect(mine, 'the HR test login is in the list').toHaveCount(1, { timeout: 30_000 });
    await mine.check();
    await next(page, 3);
    await expectStep(page, 4);
    await register(page, person);
    await expect(h1(page), 'the registered page').toHaveText(`${person.first} ${person.last} is registered`, { timeout: 60_000 });
    expect(await main(page).innerText(), 'no password on the page').not.toMatch(/password/i);

    // HR home: Invited
    await page.getByRole('link', { name: 'Back to home', exact: true }).or(page.getByRole('button', { name: 'Back to home', exact: true })).first().click();
    const row = page.getByRole('row').filter({ hasText: `${person.first} ${person.last}` });
    await expect(row, 'HR home lists the new person').toHaveCount(1, { timeout: 60_000 });
    await expect(row).toContainText('Invited');
  });
});
