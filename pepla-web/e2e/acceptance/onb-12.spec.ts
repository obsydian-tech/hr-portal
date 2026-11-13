import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import {
  CHECK_WORD, DECISION_WORD, DOCUMENT_TYPES, DocumentsFake, TYPE_NAME, checkOf, decisionOf, storedDocument, storedEmployee,
  type FakePerson, type StoredDocument,
} from './support/documents-fake';
import { EmployeesFake, apiPerson } from './support/employees-fake';
import { HR_HOME, ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { REPO, openapiRoute, runLambda, type Caller } from './support/onb-12/lambda-harness';

/**
 * ONB-12 · One new employee's page (Jira NH-156, epic NH-150).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-12.md (approved 13 Nov 2026)
 *
 * Each test runs at 1280 and 390 wide (projects in ./playwright.config.ts).
 * No-backend run: the browser answers GET <documentUploadApiUrl>/v1/employees/<id>/verifications
 * with made-up people and documents (support/documents-fake.ts) and Cognito with the fake.
 * AC-5 and AC-11 also run the real Lambda handler against a fake AWS (support/onb-12/).
 * Tests tagged @pepla-dev also run against pepla-dev with the seeded people.
 *
 * These files are locked once Iggie accepts them: see ./README.md.
 */

const STEP_OF: Record<string, string> = {
  INVITED: 'Invited',
  ACTIVE: 'Documents',
  DOCUMENTS_SUBMITTED: 'In review',
  VERIFIED: 'Verified',
  TRAINING: 'Verified',
  ONBOARDED: 'Verified',
};
const STEPS = ['Invited', 'Documents', 'In review', 'Verified'];

const NOT_FOUND = 'This employee could not be found.';
const LOAD_FAILED = 'This employee could not be loaded.';
const NOT_UPLOADED = 'Not uploaded yet';

const nameOf = (p: FakePerson) => `${p.employee.first_name} ${p.employee.last_name}`;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "9 Nov 2026" from an ISO time, on the South African calendar day. The year may be left out on the page. */
function dayOf(iso: string): RegExp {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date(iso)).split('-').map(Number);
  return new RegExp(`\\b${d} ${MONTHS[m! - 1]}(?: ${y})?\\b`);
}

// ---------------------------------------------------------------- pepla-dev seed (scripts/ci/seed-dev.py)

/** uuid5, as Python's uuid.uuid5 makes it. */
function uuid5(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  const h = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const SEED_NS = '6f1c2b1e-5d0a-4c55-9a59-2f1f0e1d7c11';
const seededId = (first: string, last: string) => uuid5(SEED_NS, `pepla-demo-${first.toLowerCase()}.${last.toLowerCase().replace(/ /g, '')}@blackhole.postmarkapp.com`);
const DEV_EMPLOYEE_ID = 'E2E-EMP-0001';

// ---------------------------------------------------------------- made-up people

const ID_NUMBER = '9803145800876';

/** Kagiso Molefe: an ID read at 96% with the full number, and a bank letter. */
function kagiso(): FakePerson {
  return {
    employee: storedEmployee({ first_name: 'Kagiso', last_name: 'Molefe', job_title: 'Bookkeeper', department: 'Finance', stage: 'DOCUMENTS_SUBMITTED', phone: '+27 82 941 7736' }),
    documents: [
      storedDocument({ document_type: 'NATIONAL_ID', file_name: 'kagiso-id-front.pdf', ocr_status: 'PASSED', uploaded_at: '2026-11-09T08:02:00Z', verification: { confidence: 96, idNumber: ID_NUMBER } }),
      storedDocument({ document_type: 'BANK_CONFIRMATION', file_name: 'fnb-letter-nov.pdf', ocr_status: 'MANUAL_REVIEW', uploaded_at: '2026-11-10T09:15:00Z', verification: { confidence: 72 } }),
    ],
  };
}

/**
 * Every row of the card's two tables, given to the API in an order that is
 * not the card's: two IDs, two bank letters, a matric, three tertiary.
 */
function everyState(): FakePerson {
  const docs: StoredDocument[] = [
    // MATCHES at exactly 90, accepted by HR on 11 Nov
    storedDocument({ document_type: 'NATIONAL_ID', file_name: 'id-second-try.jpg', ocr_status: 'PASSED', uploaded_at: '2026-11-08T10:00:00Z', verification: { confidence: 90, idNumber: '0105225123089' }, hr_reviewed_at: '2026-11-11T12:00:00Z' }),
    // A 92% auto-pass with no person: Matches, Not decided (never "Accepted")
    storedDocument({ document_type: 'TERTIARY_QUALIFICATION', file_name: 'bcom-transcript.pdf', ocr_status: 'PASSED', uploaded_at: '2026-11-07T10:00:00Z', verification: { confidence: 92 } }),
    // Could not be read: Needs a look, Not decided
    storedDocument({ document_type: 'NATIONAL_ID', file_name: 'id-blurry.jpg', ocr_status: 'FAILED', uploaded_at: '2026-11-02T10:00:00Z' }),
    // Under 90, HR asked for a new one on 5 Nov
    storedDocument({ document_type: 'BANK_CONFIRMATION', file_name: 'old-bank-letter.pdf', ocr_status: 'FAILED', uploaded_at: '2026-11-03T10:00:00Z', verification: { confidence: 41 }, hr_reviewed_at: '2026-11-05T12:00:00Z' }),
    // Still being read
    storedDocument({ document_type: 'MATRIC_CERTIFICATE', file_name: 'nsc-2015.jpg', ocr_status: 'PROCESSING', uploaded_at: '2026-11-10T10:00:00Z' }),
    // 89%: Needs a look, accepted by HR on 12 Nov
    storedDocument({ document_type: 'TERTIARY_QUALIFICATION', file_name: 'diploma.pdf', ocr_status: 'PASSED', uploaded_at: '2026-11-04T10:00:00Z', verification: { confidence: 89 }, hr_reviewed_at: '2026-11-12T12:00:00Z' }),
    // Newest bank letter, waiting: Needs a look, Not decided
    storedDocument({ document_type: 'BANK_CONFIRMATION', file_name: 'capitec-letter.pdf', ocr_status: 'MANUAL_REVIEW', uploaded_at: '2026-11-09T10:00:00Z', verification: { confidence: 64 } }),
    // Newest tertiary: uploaded, not read yet
    storedDocument({ document_type: 'TERTIARY_QUALIFICATION', file_name: 'honours.pdf', ocr_status: 'PENDING', uploaded_at: '2026-11-10T11:00:00Z' }),
    // "Doesn't match" (from ONB-07; the API answers it, nothing stores it yet)
    storedDocument({ document_type: 'TERTIARY_QUALIFICATION', file_name: 'certificate-scan.pdf', ocr_status: 'MANUAL_REVIEW', uploaded_at: '2026-11-01T10:00:00Z', verification: { confidence: 55 }, futureCheck: 'DOESNT_MATCH' }),
  ];
  return {
    employee: storedEmployee({ first_name: 'Thandeka', last_name: 'Dlamini', job_title: 'Payroll Clerk', department: 'Finance' }),
    documents: docs,
  };
}

/** The card's order: ID, bank, matric, tertiary; newest first inside a type. */
function cardOrder(docs: StoredDocument[]): StoredDocument[] {
  return [...docs].sort((a, b) => DOCUMENT_TYPES.indexOf(a.document_type) - DOCUMENT_TYPES.indexOf(b.document_type) || b.uploaded_at.localeCompare(a.uploaded_at));
}

// ---------------------------------------------------------------- the page, found by its words

type Fixtures = { docs: DocumentsFake | null; list: EmployeesFake | null };

const test = base.extend<Fixtures>({
  // Installed before the first page load. pepla-dev answers for itself.
  docs: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new DocumentsFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
  list: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new EmployeesFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
});

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs made-up people.');

const personPath = (id: string) => `/hr/employees/${encodeURIComponent(id)}`;
const onPerson = (id: string) => new RegExp(`${esc(personPath(id))}$`);

/** Opens the person's page signed out: sign-in comes first and brings HR back to the page. */
async function openPerson(page: Page, signIn: SignInPage, hr: Login, id: string): Promise<void> {
  await page.goto(personPath(id));
  await expect(signIn.email).toBeVisible();
  await signIn.signInAs(hr);
  await expect(page).toHaveURL(onPerson(id));
}

function heading1(page: Page): Locator {
  return page.getByRole('heading', { level: 1 });
}
function header(page: Page): Locator {
  return page.locator('.pp-person-header');
}
async function textOf(l: Locator): Promise<string> {
  return clean(await l.innerText());
}

type Card = { heading: string; text: string; left: number; right: number; top: number; bottom: number };

/**
 * Every document card, in page order. A card is the largest box around one
 * type's heading ("National ID", ...) that holds no other type's heading.
 */
async function readCards(page: Page): Promise<Card[]> {
  const names = Object.values(TYPE_NAME);
  return page.evaluate((names) => {
    const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
    const isHeading = (el: Element) => /^H[1-6]$/.test(el.tagName) || el.getAttribute('role') === 'heading';
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].filter(
      (el) => names.includes(tidy((el as HTMLElement).innerText)) && (el as HTMLElement).offsetParent !== null,
    );
    const typeHeadingsIn = (el: Element) => [...el.querySelectorAll('*')].filter((x) => isHeading(x) && names.includes(tidy((x as HTMLElement).innerText))).length;
    return headings.map((h) => {
      let box: Element = h;
      while (box.parentElement && box.parentElement !== document.body && typeHeadingsIn(box.parentElement) <= 1) box = box.parentElement;
      const r = box.getBoundingClientRect();
      return { heading: tidy((h as HTMLElement).innerText), text: tidy((box as HTMLElement).innerText), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
  }, names);
}

/** What one uploaded document's card must say, by the card's tables. */
function expectCard(card: Card, d: StoredDocument): void {
  const what = `${TYPE_NAME[d.document_type]} ${d.file_name}`;
  expect(card.heading, `${what}: type name`).toBe(TYPE_NAME[d.document_type]);
  expect(card.text, `${what}: file name`).toContain(d.file_name);
  expect(card.text, `${what}: uploaded date`).toMatch(dayOf(d.uploaded_at));
  const check = checkOf(d)!;
  expect(card.text, `${what}: "Check: ${CHECK_WORD[check]}"`).toMatch(new RegExp(`Check:?\\s*${esc(CHECK_WORD[check])}`));
  for (const other of Object.values(CHECK_WORD)) {
    if (other !== CHECK_WORD[check]) expect(card.text, `${what}: the check is not "${other}"`).not.toMatch(new RegExp(`Check:?\\s*${esc(other)}`));
  }
  const decision = decisionOf(d);
  if (decision === null) {
    expect(card.text, `${what}: "HR decision: Not decided"`).toMatch(/HR decision:?\s*Not decided/);
    expect(card.text, `${what}: not Accepted`).not.toMatch(/\bAccepted\b/);
    expect(card.text, `${what}: no new one asked for`).not.toMatch(/New one asked for/);
  } else {
    const word = DECISION_WORD[decision!];
    expect(card.text, `${what}: "HR decision: ${word}" with the date`).toMatch(new RegExp(`HR decision:?\\s*${esc(word)}\\b.{0,24}?${dayOf(d.hr_reviewed_at!).source}`));
    expect(card.text, `${what}: not "Not decided"`).not.toMatch(/Not decided/);
  }
  expect(card.text, `${what}: not "${NOT_UPLOADED}"`).not.toContain(NOT_UPLOADED);
}

async function noSidewaysScroll(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    for (const el of document.querySelectorAll('main *')) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()}.${el.className} ${el.scrollWidth} > ${el.clientWidth}`);
    }
    return out;
  });
}

/** The page's words and markup hold the full ID number nowhere. */
async function expectIdHidden(page: Page, full: string): Promise<void> {
  const text = await page.locator('body').innerText();
  expect(text.replace(/\D/g, ''), 'the full ID number is not in the page text').not.toContain(full);
  expect(text, 'the first nine digits are not in the page text').not.toContain(full.slice(0, 9));
  expect(await page.locator('body').ariaSnapshot(), 'the full ID number is not in the accessibility tree').not.toContain(full);
  expect(await page.content(), 'the full ID number is not in the page markup').not.toContain(full);
}

function showButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Show\b/ });
}

// ---------------------------------------------------------------- pepla-dev helpers

/** The document upload API address the app was built with (CI writes it into environment.ts). */
function devDocumentApi(): string {
  const file = join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts');
  const m = /documentUploadApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(existsSync(file) ? readFileSync(file, 'utf8') : '');
  expect(m, 'pepla-web/src/environments/environment.ts has documentUploadApiUrl').toBeTruthy();
  expect(m![1], 'documentUploadApiUrl points at pepla-dev, not the placeholder').not.toMatch(/\.invalid\b/);
  return m![1]!.replace(/\/+$/, '');
}

/** Signs in through the app and keeps the ID token Cognito hands back (also for a login the app then signs out). */
async function signInForToken(page: Page, signIn: SignInPage, login: Login): Promise<string> {
  let token = '';
  const listen = async (r: import('@playwright/test').Response) => {
    if (!/cognito-idp\.[a-z0-9-]+\.amazonaws\.com/.test(r.url()) || r.request().method() !== 'POST') return;
    try {
      const body = (await r.json()) as { AuthenticationResult?: { IdToken?: string } };
      if (body.AuthenticationResult?.IdToken) token = body.AuthenticationResult.IdToken;
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

// ---------------------------------------------------------------- tests

test.describe('ONB-12 One new employee\'s page', () => {
  test('AC-1 Who they are: name, job title, department, email, phone, employee ID, start date, HR partner and step @pepla-dev', async ({ page, signIn, hr, docs }) => {
    if (!docs) {
      // pepla-dev: the seeded Naledi Dlamini.
      const id = seededId('Naledi', 'Dlamini');
      await openPerson(page, signIn, hr, id);
      await expect(heading1(page)).toHaveText('Naledi Dlamini', { timeout: 20_000 });
      const h = await textOf(header(page));
      for (const part of ['Bookkeeper', 'Finance', 'pepla-demo-naledi.dlamini@blackhole.postmarkapp.com', '0800000000', id, 'Starts 1 Dec 2026', 'HR partner: Thandi Demo-HR']) {
        expect(h, `Naledi's header shows "${part}"`).toContain(part);
      }
      await expect(header(page).getByText('In review', { exact: true }), 'step In review').toBeVisible();
      return;
    }

    const lerato: FakePerson = {
      employee: storedEmployee({
        first_name: 'Lerato', last_name: 'Mokoena', job_title: 'Account Executive', department: 'Sales', email: 'lerato.mokoena@gmail.com',
        phone: '+27 82 941 7736', stage: 'DOCUMENTS_SUBMITTED', planned_start_date: '2026-12-01', hr_staff_name: 'Jane Smith',
      }),
      documents: [],
    };
    const noDates: FakePerson = {
      employee: storedEmployee({ first_name: 'Sipho', last_name: 'Ndlovu', job_title: 'Driver', department: 'Operations', stage: 'INVITED', planned_start_date: '', hr_staff_name: '' }),
      documents: [],
    };
    const byStage = Object.keys(STEP_OF).map((stage, i): FakePerson => ({
      employee: storedEmployee({ first_name: ['Amahle', 'Bongani', 'Chipo', 'Dineo', 'Elias', 'Farai'][i]!, last_name: 'Nkosi', stage }),
      documents: [],
    }));
    docs.add(lerato, noDates, ...byStage);

    await openPerson(page, signIn, hr, lerato.employee.employee_id);
    await expect(heading1(page)).toHaveText('Lerato Mokoena');
    await expect(heading1(page), 'one level-one heading').toHaveCount(1);
    const h = await textOf(header(page));
    for (const part of ['Account Executive', 'Sales', 'lerato.mokoena@gmail.com', lerato.employee.employee_id, 'Starts 1 Dec 2026', 'HR partner: Jane Smith']) {
      expect(h, `the header shows "${part}"`).toContain(part);
    }
    expect(h.includes('+27 82 941 7736') || h.replace(/\D/g, '').includes('829417736'), 'the header shows the phone number').toBe(true);
    await expect(header(page).getByText('In review', { exact: true }), 'step In review').toBeVisible();

    await page.goto(personPath(noDates.employee.employee_id));
    await expect(heading1(page)).toHaveText('Sipho Ndlovu');
    const h2 = await textOf(header(page));
    expect(h2, 'no start date').toContain('Start date not set');
    expect(h2, 'no HR partner').toContain('HR partner not assigned');
    expect(h2, 'no "Starts" when there is no date').not.toMatch(/Starts \d/);

    for (const p of byStage) {
      await page.goto(personPath(p.employee.employee_id));
      await expect(heading1(page)).toHaveText(nameOf(p));
      const want = STEP_OF[p.employee.stage]!;
      await expect(header(page).getByText(want, { exact: true }), `${p.employee.stage} shows as ${want}`).toBeVisible();
      for (const other of STEPS.filter((s) => s !== want)) await expect(header(page).getByText(other, { exact: true }), `${p.employee.stage} is not ${other}`).toHaveCount(0);
    }
  });

  test('AC-2 The ID number shows its last four digits until Show; Hide, 2 minutes and leaving the page hide it again', async ({ page, signIn, hr, docs }) => {
    noBackendOnly();
    const k = kagiso();
    docs!.add(k);
    await page.clock.install();
    await openPerson(page, signIn, hr, k.employee.employee_id);
    await expect(heading1(page)).toHaveText(nameOf(k));
    await expect(showButton(page)).toBeVisible();

    const hidden = async (why: string) => {
      await expect(page.getByText(ID_NUMBER), `${why}: the full number is gone`).toHaveCount(0);
      await expect(page.locator('body'), `${why}: the last four digits show`).toContainText(ID_NUMBER.slice(-4));
      await expectIdHidden(page, ID_NUMBER);
      await expect(showButton(page), `${why}: Show is offered again`).toBeVisible();
    };
    const noRecordingWords = async () => expect(await page.locator('body').innerText(), 'the page says nothing about recording').not.toMatch(/\brecorded\b|\blogged\b/i);

    await hidden('before Show');
    await noRecordingWords();

    // Show, then Hide.
    await showButton(page).click();
    await expect(page.locator('body').getByText(new RegExp(ID_NUMBER.split('').join('\\s?'))), 'Show shows the full number').toBeVisible();
    await noRecordingWords();
    await page.getByRole('button', { name: /^Hide\b/ }).click();
    await hidden('after Hide');

    // Show, then wait: still shown at 1:50, hidden by 2:05.
    await showButton(page).click();
    await expect(page.locator('body').getByText(new RegExp(ID_NUMBER.split('').join('\\s?')))).toBeVisible();
    await page.clock.fastForward('01:50');
    await expect(page.locator('body').getByText(new RegExp(ID_NUMBER.split('').join('\\s?'))), 'still shown before 2 minutes').toBeVisible();
    await page.clock.fastForward('00:15');
    await hidden('after 2 minutes');

    // Show, leave for HR home, come back.
    await showButton(page).click();
    await expect(page.locator('body').getByText(new RegExp(ID_NUMBER.split('').join('\\s?')))).toBeVisible();
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL(HR_HOME);
    await page.goBack();
    await expect(page).toHaveURL(onPerson(k.employee.employee_id));
    await expect(heading1(page)).toHaveText(nameOf(k));
    await hidden('after leaving the page and coming back');
  });

  test('AC-3 Each document shows its type, file name, uploaded date, the check and HR\'s decision, as the card\'s tables map them', async ({ page, signIn, hr, docs }) => {
    noBackendOnly();
    const p = everyState();
    docs!.add(p);
    await openPerson(page, signIn, hr, p.employee.employee_id);
    await expect(heading1(page)).toHaveText(nameOf(p));
    await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();

    const want = cardOrder(p.documents);
    await expect.poll(async () => (await readCards(page)).length, 'one card per document').toBe(want.length);
    const cards = await readCards(page);
    expect(cards.map((c) => c.heading), 'cards in the card\'s order').toEqual(want.map((d) => TYPE_NAME[d.document_type]));
    want.forEach((d, i) => expectCard(cards[i]!, d));
    // Newest first inside a type: the file names follow the upload times.
    expect(cards.map((c) => want.find((d) => c.text.includes(d.file_name))?.file_name), 'newest first inside each type').toEqual(want.map((d) => d.file_name));
  });

  test('AC-4 A type with no upload says "Not uploaded yet"; the four types come in the order ID, bank, matric, tertiary @pepla-dev', async ({ page, signIn, hr, docs }) => {
    const order = DOCUMENT_TYPES.map((t) => TYPE_NAME[t]);
    if (!docs) {
      // pepla-dev: the seeded Lerato Mokoena has no documents.
      await openPerson(page, signIn, hr, seededId('Lerato', 'Mokoena'));
      await expect(heading1(page)).toHaveText('Lerato Mokoena', { timeout: 20_000 });
      await expect.poll(async () => (await readCards(page)).map((c) => c.heading), { timeout: 20_000 }).toEqual(order);
      for (const c of await readCards(page)) expect(c.text, `${c.heading}: ${NOT_UPLOADED}`).toContain(NOT_UPLOADED);
      return;
    }

    const bank = storedDocument({ document_type: 'BANK_CONFIRMATION', file_name: 'standard-bank-letter.pdf', ocr_status: 'MANUAL_REVIEW', uploaded_at: '2026-11-06T10:00:00Z', verification: { confidence: 70 } });
    const tertiary = storedDocument({ document_type: 'TERTIARY_QUALIFICATION', file_name: 'bsc-certificate.pdf', ocr_status: 'PENDING', uploaded_at: '2026-11-07T10:00:00Z' });
    const p: FakePerson = { employee: storedEmployee({ first_name: 'Pieter', last_name: 'van Wyk' }), documents: [tertiary, bank] };
    const none: FakePerson = { employee: storedEmployee({ first_name: 'Ayesha', last_name: 'Patel' }), documents: [] };
    docs.add(p, none);

    await openPerson(page, signIn, hr, p.employee.employee_id);
    await expect(heading1(page)).toHaveText(nameOf(p));
    await expect.poll(async () => (await readCards(page)).map((c) => c.heading)).toEqual(order);
    const cards = await readCards(page);
    expect(cards[0]!.text, 'National ID: not uploaded').toContain(NOT_UPLOADED);
    expectCard(cards[1]!, bank);
    expect(cards[2]!.text, 'Matric certificate: not uploaded').toContain(NOT_UPLOADED);
    expectCard(cards[3]!, tertiary);
    for (const i of [0, 2]) expect(cards[i]!.text, `${cards[i]!.heading}: no check for a missing document`).not.toMatch(/Check:?\s*(Being checked|Matches|Needs a look|Doesn't match)/);

    await page.goto(personPath(none.employee.employee_id));
    await expect(heading1(page)).toHaveText(nameOf(none));
    await expect.poll(async () => (await readCards(page)).map((c) => c.heading)).toEqual(order);
    for (const c of await readCards(page)) expect(c.text, `${c.heading}: ${NOT_UPLOADED}`).toContain(NOT_UPLOADED);
  });

  test('AC-5 Only HR or the person can read a person\'s documents; anyone else gets 403 and no data @pepla-dev', async ({ page, signIn, hr, employee }, testInfo) => {
    if (ON_DEV) {
      const api = devDocumentApi();
      const naledi = seededId('Naledi', 'Dlamini');
      const get = (token: string, id: string) => page.request.get(`${api}/v1/employees/${encodeURIComponent(id)}/verifications`, { headers: { Authorization: `Bearer ${token}` } });

      const empToken = await signInForToken(page, signIn, employee);
      const stranger = await get(empToken, naledi);
      expect(stranger.status(), 'the employee login reading Naledi Dlamini gets 403').toBe(403);
      const strangerText = await stranger.text();
      for (const leak of ['Naledi', 'Dlamini', 'naledi.dlamini', '"documents"', '"employee"']) expect(strangerText, `the 403 carries no "${leak}"`).not.toContain(leak);
      const own = await get(empToken, DEV_EMPLOYEE_ID);
      expect(own.status(), 'the employee login reading its own record gets 200').toBe(200);
      expect(((await own.json()) as { employee?: { employee_id?: string } }).employee?.employee_id).toBe(DEV_EMPLOYEE_ID);

      await page.context().clearCookies();
      await page.goto('about:blank');
      const hrToken = await signInForToken(page, signIn, hr);
      for (const id of [naledi, DEV_EMPLOYEE_ID]) {
        const r = await get(hrToken, id);
        expect(r.status(), `HR reading ${id} gets 200`).toBe(200);
        expect(((await r.json()) as { employee?: { employee_id?: string } }).employee?.employee_id).toBe(id);
      }
      return;
    }

    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs the Lambda once: it has no screen width.');
    const k = kagiso();
    const other: FakePerson = { employee: storedEmployee({ first_name: 'Mwila', last_name: 'Phiri', email: 'mwila.phiri@gmail.com' }), documents: [] };
    const people = [k, other];
    const id = k.employee.employee_id;
    const hrCaller: Caller = { email: 'jane.smith@mokoena-logistics.co.za', groups: ['hr_staff', 'naleko-onboarding-hr'] };

    const strangers: Array<[string, Caller | null]> = [
      ['another new employee', { email: other.employee.email, groups: ['employee'] }],
      ['a signed-in person in no group', { email: 'visitor@kestrel-foods.co.za', groups: [] }],
      ['someone in another group', { email: 'it.admin@kestrel-foods.co.za', groups: ['TalentFlowAdmin'] }],
    ];
    for (const [who, caller] of strangers) {
      const r = runLambda(people, id, caller);
      expect(r.status, `${who} gets 403`).toBe(403);
      for (const leak of [k.employee.first_name, k.employee.last_name, k.employee.email, ID_NUMBER, ID_NUMBER.slice(-4), 'kagiso-id-front.pdf', 'fnb-letter-nov.pdf']) {
        expect(r.raw, `${who}: the 403 carries no "${leak}"`).not.toContain(leak);
      }
      const body = (typeof r.body === 'object' && r.body) || {};
      expect('employee' in body || 'documents' in body, `${who}: no employee or documents in the answer`).toBe(false);
      expect(r.calls.filter((c) => c.service === 'kms'), `${who}: no ID number is decrypted`).toEqual([]);
      expect(r.calls.filter((c) => c.table === 'documents' || c.table === 'document-verification'), `${who}: no document is read`).toEqual([]);
    }

    const asHr = runLambda(people, id, hrCaller);
    expect(asHr.status, 'HR gets 200').toBe(200);
    expect(asHr.body.employee.employee_id).toBe(id);
    expect(runLambda(people, other.employee.employee_id, hrCaller).status, 'HR gets 200 for anyone').toBe(200);

    const self = runLambda(people, id, { email: k.employee.email, groups: ['employee'] });
    expect(self.status, 'the person gets 200 for their own record').toBe(200);
    expect(self.body.employee.employee_id).toBe(id);
  });

  test('AC-6 A name on HR home opens the page, and "Home" in the breadcrumbs goes back, by mouse and by keyboard', async ({ page, signIn, hr, docs, list }) => {
    noBackendOnly();
    const k = kagiso();
    const second: FakePerson = { employee: storedEmployee({ first_name: 'Zanele', last_name: 'Khumalo', planned_start_date: '2027-03-01' }), documents: [] };
    docs!.add(k, second);
    list!.people = [k, second].map((p) =>
      apiPerson({ ...p.employee, employee_id: p.employee.employee_id, first_name: p.employee.first_name, last_name: p.employee.last_name, planned_start_date: p.employee.planned_start_date }),
    );

    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(HR_HOME);

    // Mouse.
    await page.getByRole('link', { name: nameOf(k), exact: true }).click();
    await expect(page).toHaveURL(onPerson(k.employee.employee_id));
    await expect(heading1(page)).toHaveText(nameOf(k));
    // The breadcrumbs hold the way back (the design system shows parents only; the name is the page heading).
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    const home = crumbs.getByRole('link', { name: 'Home', exact: true });
    expect(new URL((await home.getAttribute('href'))!, page.url()).pathname, '"Home" goes to HR home').toBe(HR_HOME);
    await home.click();
    await expect(page).toHaveURL(HR_HOME);

    // Keyboard: Tab to the name, Enter; then Tab to "Home", Enter.
    const tabTo = async (test_: () => Promise<boolean>, what: string) => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      let reached = false;
      for (let i = 0; i < 80 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await test_();
      }
      expect(reached, `Tab reaches ${what}`).toBe(true);
    };
    await expect(page.getByRole('link', { name: nameOf(second), exact: true })).toBeVisible();
    await tabTo(() => page.evaluate((n) => document.activeElement instanceof HTMLAnchorElement && document.activeElement.innerText.replace(/\s+/g, ' ').trim() === n, nameOf(second)), nameOf(second));
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(onPerson(second.employee.employee_id));
    await expect(heading1(page)).toHaveText(nameOf(second));
    await tabTo(
      () => page.evaluate(() => {
        const a = document.activeElement;
        return a instanceof HTMLAnchorElement && a.innerText.trim() === 'Home' && !!a.closest('nav[aria-label="Breadcrumb"]');
      }),
      'Home in the breadcrumbs',
    );
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(HR_HOME);
  });

  test('AC-7 On a phone the facts and document cards stack in one column, and the page never scrolls sideways', async ({ page, signIn, hr, docs }) => {
    noBackendOnly();
    const p = everyState();
    p.employee.phone = '+27 71 302 5519';
    p.employee.email = 'thandeka.dlamini.payroll-and-benefits@kestrel-foods.co.za';
    docs!.add(p);
    await openPerson(page, signIn, hr, p.employee.employee_id);
    await expect(heading1(page)).toHaveText(nameOf(p));
    await expect.poll(async () => (await readCards(page)).length).toBe(p.documents.length);
    expect(await noSidewaysScroll(page), 'nothing scrolls sideways').toEqual([]);

    const width = page.viewportSize()!.width;
    if (width > 400) return;

    const facts = await header(page).locator('li').evaluateAll((lis) => lis.filter((li) => (li as HTMLElement).offsetParent !== null).map((li) => li.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })));
    expect(facts.length, 'the header lists the facts').toBeGreaterThanOrEqual(6);
    facts.forEach((f, i) => {
      expect(f.right, `fact ${i + 1} inside the screen`).toBeLessThanOrEqual(width);
      expect(Math.abs(f.left - facts[0]!.left), `fact ${i + 1} in the same column as the first`).toBeLessThanOrEqual(2);
      if (i > 0) expect(f.top, `fact ${i + 1} below fact ${i}`).toBeGreaterThanOrEqual(facts[i - 1]!.bottom - 1);
    });

    const cards = await readCards(page);
    cards.forEach((c, i) => {
      expect(c.left, `card ${i + 1} inside the screen on the left`).toBeGreaterThanOrEqual(0);
      expect(c.right, `card ${i + 1} inside the screen on the right`).toBeLessThanOrEqual(width);
      expect(Math.abs(c.left - cards[0]!.left), `card ${i + 1} in one column`).toBeLessThanOrEqual(2);
      if (i > 0) expect(c.top, `card ${i + 1} below card ${i}`).toBeGreaterThanOrEqual(cards[i - 1]!.bottom - 1);
    });
  });

  test('AC-8 Placeholders while loading; "could not be found" for an unknown id; "could not be loaded" with Try again', async ({ page, signIn, hr, docs }) => {
    noBackendOnly();
    const k = kagiso();
    docs!.add(k);
    const id = k.employee.employee_id;

    // Loading: the answer is held back.
    docs!.mode = 'hold';
    await openPerson(page, signIn, hr, id);
    await expect.poll(() => docs!.gets().length, 'the page asks for the person').toBeGreaterThan(0);
    // Placeholders for the header and for the documents: several, reaching from the top of the page well down into it.
    const placeholders = async () => {
      const boxes = (await page.locator('.pp-skeleton').filter({ visible: true }).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom }))));
      return boxes.length < 3 ? 0 : Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top));
    };
    await expect.poll(placeholders, 'placeholders for the header and the documents (3 or more, over 200px of the page)').toBeGreaterThanOrEqual(200);
    await expect(heading1(page).filter({ hasText: nameOf(k) })).toHaveCount(0);
    await expect(page.getByText(NOT_UPLOADED)).toHaveCount(0);
    docs!.release();
    await expect(heading1(page)).toHaveText(nameOf(k));
    await expect.poll(async () => (await readCards(page)).length).toBe(4);
    await expect(page.locator('.pp-skeleton')).toHaveCount(0);

    // Not found.
    await page.goto(personPath('EMP-NOBODY-404'));
    await expect(page.getByText(NOT_FOUND, { exact: true })).toBeVisible();
    const near = await page.getByText(NOT_FOUND, { exact: true }).evaluate((el) => {
      let box: Element | null = el;
      for (let i = 0; i < 5 && box; i++, box = box.parentElement) {
        const links = [...box.querySelectorAll('a[href]')].filter((a) => !a.closest('nav, header, aside'));
        if (links.length) return links.map((a) => a.getAttribute('href') ?? '');
      }
      return [] as string[];
    });
    expect(near.map((h) => new URL(h, 'http://x').pathname), 'the message links to HR home').toContain(HR_HOME);
    await expect(page.getByText(LOAD_FAILED)).toHaveCount(0);

    // An error answer, then Try again.
    docs!.mode = 'error';
    await page.goto(personPath(id));
    await expect(page.getByText(LOAD_FAILED, { exact: true })).toBeVisible();
    await expect(page.getByText(NOT_FOUND)).toHaveCount(0);
    docs!.mode = 'ok';
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(heading1(page)).toHaveText(nameOf(k));
    await expect(page.getByText(LOAD_FAILED)).toHaveCount(0);

    // No connection, then Try again.
    docs!.mode = 'offline';
    await page.goto(personPath(id));
    await expect(page.getByText(LOAD_FAILED, { exact: true })).toBeVisible();
    docs!.mode = 'ok';
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(heading1(page)).toHaveText(nameOf(k));
    await expect(page.getByText(LOAD_FAILED)).toHaveCount(0);
  });

  test('AC-9 Opening the page calls only Cognito, GET /v1/employees/<id>/verifications and Google Fonts, never AI', async ({ page, signIn, hr, docs, baseURL }) => {
    noBackendOnly();
    const seen: Array<{ method: string; url: URL }> = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') seen.push({ method: r.method(), url });
    });
    const p = everyState();
    docs!.add(p);
    await openPerson(page, signIn, hr, p.employee.employee_id);
    await expect(heading1(page)).toHaveText(nameOf(p));
    await expect.poll(async () => (await readCards(page)).length).toBe(p.documents.length);
    await page.waitForLoadState('networkidle');

    const app = new URL(baseURL!).origin;
    const cognito = /^cognito-idp\.[a-z0-9-]+\.amazonaws\.com$/;
    const fonts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
    const outside = seen.filter((s) => s.url.origin !== app && !cognito.test(s.url.hostname) && !fonts.has(s.url.hostname));
    const route = `/v1/employees/${encodeURIComponent(p.employee.employee_id)}/verifications`;
    const api = outside.filter((s) => s.url.pathname === route);
    expect(api.filter((s) => s.method === 'GET').length, 'the document upload API is asked for this person').toBeGreaterThan(0);
    expect(outside.filter((s) => !api.includes(s)).map((s) => `${s.method} ${s.url.href}`), 'no other host or route is called').toEqual([]);
    expect([...new Set(api.map((s) => s.url.origin))].length, 'one document upload API').toBe(1);
    expect(api.filter((s) => s.method !== 'GET' && s.method !== 'OPTIONS').map((s) => `${s.method} ${s.url.pathname}`), 'only GET').toEqual([]);

    const ai = /\/agent\/|\/ai\/|\/chat|batsi|\/summary|assess-risk|risk-report|bedrock|textract|anthropic|openai/i;
    expect(seen.filter((s) => ai.test(s.url.href)).map((s) => s.url.href), 'no AI route is called').toEqual([]);
    await expect(page.getByRole('button', { name: /Ask Batsi/i }), 'no "Ask Batsi to assess risk" button').toHaveCount(0);
    await expect(page.getByText(/assess risk/i)).toHaveCount(0);
  });

  test('AC-10 axe finds no serious or critical issue with documents loaded; one level-one heading; Show is named for the ID number', async ({ page, signIn, hr, docs }) => {
    noBackendOnly();
    const p = everyState();
    p.documents = p.documents.filter((d) => d.document_type !== 'NATIONAL_ID');
    p.documents.unshift(storedDocument({ document_type: 'NATIONAL_ID', file_name: 'id-card.jpg', ocr_status: 'PASSED', uploaded_at: '2026-11-09T08:00:00Z', verification: { confidence: 97, idNumber: ID_NUMBER } }));
    docs!.add(p);
    await openPerson(page, signIn, hr, p.employee.employee_id);
    await expect(heading1(page)).toHaveText(nameOf(p));
    await expect.poll(async () => (await readCards(page)).length).toBe(p.documents.length);

    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help} :: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    expect(bad, 'axe on the employee page').toEqual([]);

    await expect(heading1(page), 'one level-one heading').toHaveCount(1);
    await expect(heading1(page), 'and it is the name').toHaveText(nameOf(p));

    const show = showButton(page);
    await expect(show).toHaveCount(1);
    const named = await expect(show).toHaveAccessibleName(/ID number/i, { timeout: 1_000 }).then(() => true, () => false);
    const described = await expect(show).toHaveAccessibleDescription(/ID number/i, { timeout: 1_000 }).then(() => true, () => false);
    expect(named || described, 'a screen reader hears that Show is for the ID number (its name or its description says "ID number")').toBe(true);
  });

  test('AC-11 The Lambda answers job_title, check, hr_decision and hr_decided_at, refuses strangers, and the OpenAPI spec says so', async ({}, testInfo) => {
    test.skip(ON_DEV, 'No-backend run only: it runs the Lambda against a fake AWS.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs the Lambda once: it has no screen width.');

    const p = everyState();
    p.documents = p.documents.filter((d) => !d.futureCheck); // nothing stores "Doesn't match" until ONB-07
    p.documents.push(
      storedDocument({ document_type: 'NATIONAL_ID', file_name: 'id-reading.jpg', ocr_status: 'PENDING', uploaded_at: '2026-11-12T10:00:00Z' }),
      storedDocument({ document_type: 'MATRIC_CERTIFICATE', file_name: 'nsc-asked-again.jpg', ocr_status: 'FAILED', uploaded_at: '2026-11-06T10:00:00Z', hr_reviewed_at: '2026-11-08T09:30:00Z' }),
    );
    const hrCaller: Caller = { email: 'jane.smith@mokoena-logistics.co.za', groups: ['hr_staff'] };
    const r = runLambda([p], p.employee.employee_id, hrCaller);
    expect(r.status, `HR gets 200\n${r.raw.slice(0, 500)}`).toBe(200);

    expect(r.body.employee?.job_title, 'job_title on the employee').toBe(p.employee.job_title);
    // Today's fields stay, so the old app keeps working until OPS-04.
    for (const f of ['employee_id', 'first_name', 'last_name', 'email', 'phone', 'stage', 'department', 'planned_start_date', 'hr_staff_name']) {
      expect(r.body.employee, `employee.${f} is still answered`).toHaveProperty(f);
    }
    expect(r.body, 'summary is still answered').toHaveProperty('summary');

    const byId = new Map<string, any>((r.body.documents ?? []).map((d: any) => [d.document_id, d]));
    expect(byId.size, 'every document is answered').toBe(p.documents.length);
    for (const d of p.documents) {
      const got = byId.get(d.document_id);
      const what = `${d.document_id} (${d.ocr_status}${d.verification ? `, ${d.verification.confidence}%` : ', no verification'}${d.hr_reviewed_at ? ', HR reviewed' : ''})`;
      expect(got?.check, `${what}: check`).toBe(checkOf(d));
      expect(got?.hr_decision, `${what}: hr_decision`).toBe(decisionOf(d));
      expect(got?.hr_decided_at, `${what}: hr_decided_at`).toBe(d.hr_reviewed_at ?? null);
      for (const f of ['document_type', 'file_name', 'uploaded_at', 'ocr_status', 'verification', 'can_reupload']) expect(got, `${what}: ${f} is still answered`).toHaveProperty(f);
    }
    const id = p.documents.find((d) => d.verification?.idNumber)!;
    expect(byId.get(id.document_id)?.verification?.id_number, 'HR still gets the full ID number (until ONB-14 / OPS-04)').toBe(id.verification!.idNumber);

    // Who may read it: HR, or the person (email compared without case); anyone else 403.
    const emailCases: Array<[string, string]> = [
      ['the same email', p.employee.email],
      ['the email in capitals', p.employee.email.toUpperCase()],
      ['the email in mixed case', p.employee.email.replace(/^./, (c) => c.toUpperCase()).replace('@kestrel', '@Kestrel')],
    ];
    for (const [how, email] of emailCases) expect(runLambda([p], p.employee.employee_id, { email, groups: ['employee'] }).status, `the person with ${how} gets 200`).toBe(200);
    expect(runLambda([p], p.employee.employee_id, { email: 'someone.else@kestrel-foods.co.za', groups: ['employee'] }).status, 'a stranger gets 403').toBe(403);
    expect(runLambda([p], p.employee.employee_id, { email: `x${p.employee.email}`, groups: ['employee'] }).status, 'an email that only ends the same gets 403').toBe(403);

    // The OpenAPI spec for the route.
    const spec = openapiRoute();
    expect(spec.responses, 'the route lists a 403 answer').toContain('403');
    expect(spec.employee, 'the employee lists job_title').toContain('job_title');
    for (const f of ['check', 'hr_decision', 'hr_decided_at']) expect(Object.keys(spec.document), `each document lists ${f}`).toContain(f);
    expect([...(spec.document['check']?.enum ?? [])].sort(), 'check: its four values').toEqual(['DOESNT_MATCH', 'MATCHES', 'NEEDS_A_LOOK', 'READING']);
    expect((spec.document['hr_decision']?.enum ?? []).filter((v) => v !== null).sort(), 'hr_decision: its two values').toEqual(['ACCEPTED', 'NEW_ONE_ASKED']);
    expect(spec.document['hr_decision']?.nullable, 'hr_decision may be null').toBe(true);
    expect(spec.document['hr_decided_at']?.nullable, 'hr_decided_at may be null').toBe(true);
  });
});
