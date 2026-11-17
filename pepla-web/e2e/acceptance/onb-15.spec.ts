import AxeBuilder from '@axe-core/playwright';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DocumentsFake, storedDocument, storedEmployee, type FakePerson } from './support/documents-fake';
import { ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { forgetSignIn } from './support/sign-in-again';
import { WaitingFake, type WaitingItem } from './support/onb-13/waiting-fake';
import {
  COMPARISON_WORDS, DocumentFake, SERVER_TEXT, TYPE_NAME, type Compared, type ComparedField, type Comparison, type DocumentType,
  type FakeDocument, type Read,
} from './support/onb-15/document-fake';
import {
  REPO, awsCalls, docRow, dynamoCalls, encrypted, fileUrl, getOne, openapiRoute, published, review, row, writes,
  type Caller, type Run, type Tables,
} from './support/onb-15/lambda-harness';
import { ROLE, baseline, movedOrRemoved, policyOf, resourcesNamed, squash, table } from './support/onb-15/tf-policy';
import { decide, statements } from './support/ops-05/iam-eval';

/**
 * ONB-15 · HR accepts a document or asks for a new one (Jira NH-164, epic NH-150).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-15.md (14 Nov 2026)
 *
 * Each page test runs at 1280 and 390 wide (projects in ./playwright.config.ts).
 * No-backend run: the browser answers GET /v1/verifications/<id>, PATCH .../review and
 * GET /v1/documents/<id>/url with made-up documents (support/onb-15/document-fake.ts), and Cognito with
 * the fake. The Lambda tests run the real getSingleDocumentVerification, getDocumentPresignedUrl and
 * reviewDocumentVerification once each, in their own Node process, against a fake AWS
 * (support/onb-15/fake-aws). AC-5 also runs against pepla-dev, and never decides a seeded document.
 *
 * These files are locked once the lock check accepts them: see ./README.md and cards/onb-15.md.
 */

const LIST_PATH = '/hr/documents';
const docPath = (id: string) => `${LIST_PATH}/${encodeURIComponent(id)}`;
const personPath = (id: string) => `/hr/employees/${encodeURIComponent(id)}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

const CHECK_WORD = { READING: 'Being checked', MATCHES: 'Matches', NEEDS_A_LOOK: 'Needs a look', DOESNT_MATCH: "Doesn't match" } as const;
type CheckWord = (typeof CHECK_WORD)[keyof typeof CHECK_WORD];

const WORDS = {
  found: 'What Batsi found',
  readFrom: 'Read from the uploaded document',
  read: 'What Batsi read',
  uploaded: 'Uploaded document',
  decision: 'Your decision',
  noCompare: 'Nothing on the record to compare for this document type.',
  noFields: 'Batsi does not read fields from this document type.',
  stillReading: 'Batsi is still reading this document.',
  cannotDecideYet: 'HR can decide once Batsi has read this document.',
  recorded: 'Your choice is recorded with your name and the time.',
  accept: 'Accept document',
  askNew: 'Ask for a new one',
  cancel: 'Cancel',
  reason: 'Reason',
  reasonHint: 'Kept with the decision.',
  enterReason: 'Enter a reason.',
  notFound: 'This document could not be found.',
  backToList: 'Back to Documents to check',
  onlyHr: 'Only HR can open documents.',
  loadFailed: 'This document could not be loaded.',
  tryAgain: 'Try again',
  alreadyDecided: 'This document was already decided.',
  notSaved: 'Your choice could not be saved. Try again.',
  notOpened: 'The document could not be opened. Try again.',
  open: 'Open document',
  viewEmployee: 'View employee',
  checkedByBatsi: 'Checked by Batsi',
  notRead: 'Not read',
  notYet: 'Not yet',
};
const BAND = { high: 'High confidence', check: 'Check this', unsure: 'Batsi could not tell' } as const;

// ---------------------------------------------------------------- dates, South Africa time

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function sa(iso: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const p = (t: string) => parts.find((x) => x.type === t)!.value;
  return { day: `${Number(p('day'))} ${MONTHS[Number(p('month')) - 1]} ${p('year')}`, time: `${p('hour')}:${p('minute')}` };
}
/** "4 Nov 2026, 10:00" */
const dayTime = (iso: string) => `${sa(iso).day}, ${sa(iso).time}`;
/** "on 4 Nov 2026 at 10:00" */
const onAt = (iso: string) => `on ${sa(iso).day} at ${sa(iso).time}`;

// ---------------------------------------------------------------- made-up documents (the page tests)

const NALEDI = { employee_id: 'EMP-1501', first_name: 'Naledi', last_name: 'Dlamini', id_number_last4: '0876' };
const ID_NUMBER = '9803145800876';
const ACCOUNT_NUMBER = '62845519023';
const UPLOADED = '2026-11-04T08:00:00Z';
const READ_AT = '2026-11-04T08:02:00Z';
/** Read from documents but never shown (they give away the ID number, or are the model's own words). */
const ID_READ: Read = { id_number: ID_NUMBER, name: 'NALEDI THANDO', surname: 'DLAMINI', date_of_birth: '1998-03-14', gender: 'FEMALE', citizenship: 'SA CITIZEN BY BIRTH' };
const BANK_READ: Read = { account_holder: 'MS N DLAMINI', bank_name: 'Ubuntu Mutual Bank', account_number: ACCOUNT_NUMBER, branch_code: '250655', account_type: 'Cheque' };
const REASONING = 'The hologram and the photograph agree; the date of birth 1998-03-14 fits the number 9803145800876.';
const MODEL_CHECKS = { hologram_visible: true, photo_quality: 'Sharp portrait, no glare' };
const NEVER_SHOWN = [/Date of birth/i, /\bGender\b/i, /Citizenship/i, /1998-03-14/, /14 Mar(ch)? 1998/i, /\bfemale\b/i, /SA CITIZEN BY BIRTH/i, /hologram/i, /Sharp portrait/i, /photo_quality/];

let serial = 0;
function doc(p: Partial<FakeDocument> & Pick<FakeDocument, 'document_type'>): FakeDocument {
  serial++;
  const id = `doc_17630${String(serial).padStart(8, '0')}`;
  return {
    document_id: id,
    employee: NALEDI,
    file_name: `${p.document_type.toLowerCase().replace(/_/g, '-')}-${serial}.pdf`,
    uploaded_at: UPLOADED,
    ocr_status: 'MANUAL_REVIEW',
    ocr_completed_at: READ_AT,
    ...p,
  };
}
const verified = (confidence: number, read: Read, check?: string) => ({ confidence, check, read, reasoning: REASONING, checks: MODEL_CHECKS });
const fullName = (d: FakeDocument) => `${d.employee.first_name} ${d.employee.last_name}`;
const titleOf = (d: FakeDocument) => `${TYPE_NAME[d.document_type]}, ${fullName(d)}`;

type Shown = {
  title: string;
  doc: FakeDocument;
  check: CheckWord;
  lines: Array<[string, 'match' | 'mismatch' | 'unsure']> | 'none';
  band?: keyof typeof BAND;
  rows: Array<[string, string | { hidden: string; full: string }]> | 'none' | 'skip';
};
const line = (field: ComparedField, result: Compared): [string, 'match' | 'mismatch' | 'unsure'] => [
  COMPARISON_WORDS[field][result],
  result === 'AGREES' ? 'match' : result === 'DIFFERS' ? 'mismatch' : 'unsure',
];
const idRows = (r: Read): Shown['rows'] => [
  ['First names', r.name && r.name !== 'NOT_FOUND' ? r.name : WORDS.notRead],
  ['Surname', r.surname && r.surname !== 'NOT_FOUND' ? r.surname : WORDS.notRead],
  ['ID number', r.id_number ? { hidden: r.id_number.slice(-4), full: r.id_number } : WORDS.notRead],
];
const bankRows = (r: Read, overrides: Partial<Record<string, string>> = {}): Shown['rows'] => [
  ['Account holder', overrides['Account holder'] ?? r.account_holder ?? WORDS.notRead],
  ['Bank', overrides['Bank'] ?? r.bank_name ?? WORDS.notRead],
  ['Account number', r.account_number ? { hidden: r.account_number.slice(-4), full: r.account_number } : WORDS.notRead],
  ['Branch code', overrides['Branch code'] ?? r.branch_code ?? WORDS.notRead],
  ['Account type', overrides['Account type'] ?? r.account_type ?? WORDS.notRead],
];

/** Every check, every comparison word, every confidence band and every type, as AC-1 shows them. */
function everyCase(): Shown[] {
  const noLast4 = { ...NALEDI, id_number_last4: undefined };
  return [
    { title: 'ID, both agree, 95', doc: doc({ document_type: 'NATIONAL_ID', verification: verified(95, ID_READ, 'MATCHES') }), check: 'Matches',
      lines: [line('SURNAME', 'AGREES'), line('ID_NUMBER', 'AGREES')], band: 'high', rows: idRows(ID_READ) },
    { title: 'ID, both differ, 89', doc: doc({ document_type: 'NATIONAL_ID', verification: verified(89, { ...ID_READ, surname: 'MOKOENA', id_number: '9803145800999' }, 'DOESNT_MATCH') }),
      check: "Doesn't match", lines: [line('SURNAME', 'DIFFERS'), line('ID_NUMBER', 'DIFFERS')], band: 'check', rows: idRows({ ...ID_READ, surname: 'MOKOENA', id_number: '9803145800999' }) },
    { title: 'ID, surname not read, no last 4 on the record, 40', doc: doc({ document_type: 'NATIONAL_ID', employee: noLast4, verification: verified(40, { ...ID_READ, surname: 'NOT_FOUND', name: '' }, 'NEEDS_A_LOOK') }),
      check: 'Needs a look', lines: [line('SURNAME', 'NOT_READ'), line('ID_NUMBER', 'NOT_ON_RECORD')], band: 'check', rows: idRows({ ...ID_READ, surname: 'NOT_FOUND', name: '' }) },
    { title: 'ID, no surname on the record, ID not read, 1', doc: doc({
      document_type: 'NATIONAL_ID', verification: verified(1, { ...ID_READ, id_number: null }, 'NEEDS_A_LOOK'),
      comparisons: [{ field: 'SURNAME', result: 'NOT_ON_RECORD' }, { field: 'ID_NUMBER', result: 'NOT_READ' }],
    }), check: 'Needs a look', lines: [line('SURNAME', 'NOT_ON_RECORD'), line('ID_NUMBER', 'NOT_READ')], band: 'check', rows: idRows({ ...ID_READ, id_number: null }) },
    { title: 'Bank, holder differs, 72', doc: doc({ document_type: 'BANK_CONFIRMATION', verification: verified(72, { ...BANK_READ, account_holder: 'MR P VAN WYK', account_type: 'NOT_FOUND' }, 'DOESNT_MATCH') }),
      check: "Doesn't match", lines: [line('ACCOUNT_HOLDER', 'DIFFERS')], band: 'check', rows: bankRows({ ...BANK_READ, account_holder: 'MR P VAN WYK' }, { 'Account type': WORDS.notRead }) },
    { title: 'Bank, holder agrees, 90', doc: doc({ document_type: 'BANK_CONFIRMATION', verification: verified(90, BANK_READ, 'MATCHES') }),
      check: 'Matches', lines: [line('ACCOUNT_HOLDER', 'AGREES')], band: 'high', rows: bankRows(BANK_READ) },
    { title: 'Bank, holder not read, 0', doc: doc({ document_type: 'BANK_CONFIRMATION', verification: verified(0, { ...BANK_READ, account_holder: null, bank_name: '' }, 'NEEDS_A_LOOK') }),
      check: 'Needs a look', lines: [line('ACCOUNT_HOLDER', 'NOT_READ')], band: 'unsure', rows: bankRows({ ...BANK_READ, account_holder: null }, { Bank: WORDS.notRead }) },
    { title: 'Bank, no surname on the record, 60', doc: doc({
      document_type: 'BANK_CONFIRMATION', verification: verified(60, BANK_READ, 'NEEDS_A_LOOK'), comparisons: [{ field: 'ACCOUNT_HOLDER', result: 'NOT_ON_RECORD' }],
    }), check: 'Needs a look', lines: [line('ACCOUNT_HOLDER', 'NOT_ON_RECORD')], band: 'check', rows: bankRows(BANK_READ) },
    { title: 'Matric, 91', doc: doc({ document_type: 'MATRIC_CERTIFICATE', verification: verified(91, {}, 'MATCHES') }), check: 'Matches', lines: 'none', band: 'high', rows: 'none' },
    { title: 'Tertiary, 0', doc: doc({ document_type: 'TERTIARY_QUALIFICATION', verification: verified(0, {}, 'NEEDS_A_LOOK') }), check: 'Needs a look', lines: 'none', band: 'unsure', rows: 'none' },
    { title: 'ID, no verification (AI skipped)', doc: doc({ document_type: 'NATIONAL_ID', verification: null, ocr_completed_at: undefined }),
      check: 'Needs a look', lines: [line('SURNAME', 'NOT_READ'), line('ID_NUMBER', 'NOT_READ')], band: 'unsure', rows: idRows({}) },
  ];
}

// ---------------------------------------------------------------- the page, found by its words

type Fixtures = { one: DocumentFake | null; waiting: WaitingFake | null; people: DocumentsFake | null };

const test = base.extend<Fixtures>({
  // Installed before the first page load. pepla-dev answers for itself.
  waiting: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new WaitingFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
  people: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new DocumentsFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
  // After the list fake, so /v1/verifications/<id> reaches this one (Playwright tries the last route first).
  one: async ({ context, baseURL, waiting }, use) => {
    void waiting;
    if (ON_DEV) return use(null);
    const fake = new DocumentFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
});

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs made-up documents.');
const lambdaOnce = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambda against a fake AWS.');
  test.skip(projectName !== 'desktop-1280', 'Runs the Lambda once: it has no screen width.');
};

const main = (page: Page) => page.locator('main');
const heading1 = (page: Page) => page.getByRole('heading', { level: 1 });

/** The innermost card or section holding a heading with this name. */
function section(page: Page, name: string): Locator {
  return main(page)
    .locator('section, article, [role="article"], [role="region"], .pp-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .last();
}
/** The value beside a term in a description list. */
function ddOf(scope: Locator, term: string): Locator {
  return scope.locator('dt').filter({ hasText: new RegExp(`^\\s*${esc(term)}\\s*$`) }).locator('xpath=following-sibling::dd[1]');
}
const acceptButton = (page: Page) => main(page).getByRole('button', { name: WORDS.accept, exact: true });
const askButtons = (page: Page) => main(page).getByRole('button', { name: WORDS.askNew, exact: true });
const reasonBox = (page: Page) => main(page).getByRole('textbox', { name: WORDS.reason, exact: true });
const showButton = (page: Page) => main(page).getByRole('button', { name: /^Show\b/ });

/** Opens a document straight from its address, signing in first when needed. */
async function openDoc(page: Page, signIn: SignInPage, hr: Login, id: string): Promise<void> {
  await page.goto(docPath(id));
  if (await signIn.email.isVisible().catch(() => false)) {
    await signIn.signInAs(hr);
  } else {
    await Promise.race([
      signIn.email.waitFor({ state: 'visible', timeout: 15_000 }).then(() => signIn.signInAs(hr)),
      heading1(page).waitFor({ state: 'visible', timeout: 15_000 }),
    ]).catch(() => undefined);
  }
  await expect(page).toHaveURL(new RegExp(`${esc(docPath(id))}(\\?.*)?$`), { timeout: 20_000 });
}

async function bodyText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

/** Nothing the card keeps off the page is in its words or its accessibility tree. */
async function expectNothingForbidden(page: Page, what: string): Promise<void> {
  const text = await bodyText(page);
  const tree = await page.locator('body').ariaSnapshot();
  for (const re of NEVER_SHOWN) {
    expect(text, `${what}: the page text holds nothing like ${re}`).not.toMatch(re);
    expect(tree, `${what}: the accessibility tree holds nothing like ${re}`).not.toMatch(re);
  }
  expect(text, `${what}: the model's reasoning is not shown`).not.toContain('photograph agree');
}

/** The full number is nowhere in the page text, the accessibility tree or the markup. */
async function expectHidden(page: Page, full: string, what: string): Promise<void> {
  const text = await bodyText(page);
  expect(text.replace(/[^\d]/g, ''), `${what}: the full number is not in the page text`).not.toContain(full);
  expect(text, `${what}: the first digits are not in the page text`).not.toContain(full.slice(0, full.length - 4));
  expect(await page.locator('body').ariaSnapshot(), `${what}: the full number is not in the accessibility tree`).not.toContain(full);
  expect(await page.content(), `${what}: the full number is not in the page markup`).not.toContain(full);
  await expect(main(page), `${what}: the last four digits show`).toContainText(full.slice(-4));
}

/** What a compare list item says and how it is marked. */
async function compareLines(page: Page): Promise<Array<[string, 'match' | 'mismatch' | 'unsure']>> {
  const list = main(page).getByRole('list', { name: 'What was compared' });
  if (!(await list.count())) return [];
  return list.locator('li').evaluateAll((lis) =>
    lis.map((li) => {
      const cls = `${li.className} ${li.getAttribute('data-result') ?? ''}`;
      const mark = /mismatch/.test(cls) ? 'mismatch' : /unsure/.test(cls) ? 'unsure' : 'match';
      return [(li as HTMLElement).innerText.replace(/\s+/g, ' ').trim(), mark] as [string, 'match' | 'mismatch' | 'unsure'];
    }),
  );
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

/**
 * Every heading, link and button in main that a person can see: inside the screen's width, below the
 * top bar when the page is at the top, and reached by a tap at its centre once scrolled into view.
 * (The same check as ONB-13 AC-7.)
 */
async function hiddenOrCovered(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    const bar = document.querySelector('.pp-top-navigation, [role="banner"]');
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const els = [...document.querySelectorAll('main :is(h1,h2,h3,h4,h5,h6,[role="heading"],a[href],button)')].filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null;
    });
    const name = (el: Element) => `${el.tagName.toLowerCase()} "${(el as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
    window.scrollTo(0, 0);
    document.querySelector('main')?.scrollTo?.(0, 0);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.top < barBottom - 1) out.push(`${name(el)} starts under the top bar (${Math.round(r.top)} < ${Math.round(barBottom)})`);
      if (r.left < -1 || r.right > window.innerWidth + 1) out.push(`${name(el)} is outside the screen's width`);
    }
    for (const el of els) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2)), r.top + r.height / 2);
      if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) out.push(`${name(el)} is covered by ${hit ? hit.tagName.toLowerCase() + '.' + hit.className : 'nothing'}`);
    }
    window.scrollTo(0, 0);
    return out;
  });
}

/** Tab until `reached` says focus is where it should be. */
async function tabTo(page: Page, reached: () => Promise<boolean>, what: string): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let ok = false;
  for (let i = 0; i < 80 && !ok; i++) {
    await page.keyboard.press('Tab');
    ok = await reached();
  }
  expect(ok, `Tab reaches ${what}`).toBe(true);
}
const focusedName = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.replace(/\s+/g, ' ').trim() ?? '');
const focusedHref = (page: Page) => page.evaluate(() => (document.activeElement instanceof HTMLAnchorElement ? document.activeElement.getAttribute('href') ?? '' : ''));

/** A button is out of use: disabled, or aria-disabled, or busy. */
async function outOfUse(button: Locator): Promise<boolean> {
  return button.evaluate((b) => (b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true' || b.getAttribute('aria-busy') === 'true');
}

/** The sidebar item, found whether or not the phone drawer is open (as ONB-13). */
function navItem(page: Page): Locator {
  return page.locator('[role="navigation"] a[href="/hr/documents"], nav a[href="/hr/documents"]').filter({ hasText: 'Documents to check' });
}
async function navCount(page: Page): Promise<number | null> {
  const text = clean((await navItem(page).first().textContent()) ?? '');
  const m = /\d+/.exec(text.replace('Documents to check', ''));
  return m ? Number(m[0]) : null;
}

/** The waiting list item for a made-up document. */
const waitingItem = (d: FakeDocument): WaitingItem => ({
  document_id: d.document_id, employee_id: d.employee.employee_id, employee_name: fullName(d), document_type: d.document_type,
  check: 'NEEDS_A_LOOK', arrived_at: d.uploaded_at ?? null,
});

// ---------------------------------------------------------------- pepla-dev helpers (as ONB-13)

/** Naledi Dlamini's bank letter in scripts/ci/seed-dev.py (ONB-13 AC-8 reads it in the same run: never decide it). */
const SEEDED_BANK_LETTER = 'doc_1762243200000';

function devDocumentApi(): string {
  const file = join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts');
  const m = /documentUploadApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(existsSync(file) ? readFileSync(file, 'utf8') : '');
  expect(m, 'pepla-web/src/environments/environment.ts has documentUploadApiUrl').toBeTruthy();
  expect(m![1], 'documentUploadApiUrl points at pepla-dev, not the placeholder').not.toMatch(/\.invalid\b/);
  return m![1]!.replace(/\/+$/, '');
}

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

// ---------------------------------------------------------------- the stored tables (the Lambda tests)

const E = 'EMP-1501';
const HR_CALLER: Caller = { kind: 'jwt', email: 'thandi.demo-hr@kestrel-foods.co.za', groups: ['hr_staff'], givenName: 'Thandi', familyName: 'Demo-HR' };
const HR_NO_NAMES: Caller = { kind: 'jwt', email: 'people-team@kestrel-foods.co.za', groups: ['hr_staff'] };
const RECORD_LAST4 = '0876';

type StoredDoc = {
  id: string;
  type: DocumentType;
  status: 'PENDING' | 'PROCESSING' | 'PASSED' | 'MANUAL_REVIEW' | 'FAILED';
  upload_timestamp?: string;
  uploaded_at?: string;
  hr_reviewed_at?: string;
  hr_reviewed_by_name?: string;
  hr_decision_notes?: string;
  /** The verification row's values (null: none). */
  v?: Record<string, string | number | undefined> | null;
};

function tables(docs: StoredDoc[], employee: Record<string, string | undefined> = {}): Tables {
  const emp = row({
    employee_id: E, first_name: 'Naledi', last_name: 'Dlamini', email: 'naledi.dlamini@kestrel-foods.co.za', phone: '+27 82 555 0142',
    department: 'Finance', job_title: 'Bookkeeper', stage: 'DOCUMENTS_SUBMITTED', id_number_last4: RECORD_LAST4,
    id_number_encrypted: encrypted('8001015009087'), hr_staff_name: 'Jane Smith', hr_staff_email: 'jane.smith@mokoena-logistics.co.za',
    created_at: '2026-10-20T08:00:00.000Z', ...employee,
  });
  for (const [k, v] of Object.entries(employee)) if (v === undefined) delete emp[k];
  const documents = docs.map((d) => row({
    employee_id: E, document_id: d.id, document_type: d.type, file_name: `${d.type.toLowerCase()}.pdf`, file_size: 48213, content_type: 'application/pdf',
    s3_key: `uploads/${E}/${d.type}/${d.id}_${d.type.toLowerCase()}.pdf`, ocr_status: d.status, upload_timestamp: d.upload_timestamp, uploaded_at: d.uploaded_at,
    verification_id: d.v ? `ver_${d.id}` : undefined, ocr_completed_at: d.v ? '2026-11-04T08:02:00.000Z' : undefined,
    hr_reviewed_at: d.hr_reviewed_at, hr_reviewed_by: d.hr_reviewed_at && d.hr_reviewed_by_name ? 'someone@kestrel-foods.co.za' : undefined,
    hr_reviewed_by_name: d.hr_reviewed_by_name, hr_decision_notes: d.hr_decision_notes,
  }));
  const verifications = docs.filter((d) => d.v).map((d) => row({
    verificationId: `ver_${d.id}`, employeeId: E, documentId: d.id, documentType: d.type, decision: 'MANUAL_REVIEW',
    createdAt: '2026-11-04T08:02:00.000Z', reasoning: REASONING, checks: JSON.stringify(MODEL_CHECKS), ...d.v,
  }));
  // An unrelated row ahead of ours in scan order, so a reader that takes the first row is caught.
  documents.unshift(row({ employee_id: 'EMP-1599', document_id: 'doc_1760000000000', document_type: 'NATIONAL_ID', file_name: 'other.pdf', s3_key: 'uploads/EMP-1599/other.pdf', ocr_status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-01T08:00:00Z' }));
  return { employees: [emp, row({ employee_id: 'EMP-1599', first_name: 'Other', last_name: 'Person', id_number_last4: '1111' })], documents, 'document-verification': verifications };
}

const idRow = (o: Record<string, string | number | undefined> = {}) => ({
  confidence: 95, check: 'MATCHES', name: 'NALEDI THANDO', surname: 'DLAMINI', idNumber_encrypted: encrypted(ID_NUMBER), idNumber_last4: ID_NUMBER.slice(-4),
  dateOfBirth: '1998-03-14', gender: 'FEMALE', citizenship: 'SA CITIZEN BY BIRTH', ...o,
});
const bankRow = (o: Record<string, string | number | undefined> = {}) => ({
  confidence: 92, check: 'MATCHES', accountHolder: 'MS N DLAMINI', bankName: 'Ubuntu Mutual Bank', accountNumber: ACCOUNT_NUMBER, branchCode: '250655', accountType: 'Cheque', ...o,
});

const sortCmp = (c: Comparison[] | undefined) => [...(c ?? [])].sort((a, b) => a.field.localeCompare(b.field));

function ok(run: Run, what: string): any {
  expect(run.error, `${what}: the handler does not throw\n${run.error?.stack ?? ''}`).toBeUndefined();
  expect(run.status, `${what}: 200\n${run.raw.slice(0, 500)}`).toBe(200);
  return run.body;
}

const STRANGERS: Array<[string, Caller]> = [
  ['a new employee', { kind: 'jwt', email: 'naledi.dlamini@kestrel-foods.co.za', groups: ['employee'], givenName: 'Naledi', familyName: 'Dlamini' }],
  ['a group named not_hr_staff only', { kind: 'jwt', email: 'temp@kestrel-foods.co.za', groups: ['not_hr_staff'] }],
  ['a group named hr_staff_readonly', { kind: 'jwt', email: 'audit@kestrel-foods.co.za', groups: ['employee', 'hr_staff_readonly'] }],
  ['a signed-in person in no group', { kind: 'jwt', email: 'visitor@kestrel-foods.co.za', groups: [] }],
  ['a call with no claims at all', { kind: 'none' }],
];

// ---------------------------------------------------------------- tests

test.describe('ONB-15 HR accepts a document or asks for a new one', () => {
  test('AC-1 What HR sees: heading, person, check, compare lines, How sure, what Batsi read and the file; nothing that gives the ID number away', async ({ page, signIn, hr, one }) => {
    noBackendOnly();
    const cases = everyCase();
    const reading = doc({ document_type: 'TERTIARY_QUALIFICATION', ocr_status: 'PENDING', ocr_completed_at: undefined, verification: null });
    one!.add(...cases.map((c) => c.doc), reading);

    for (const [n, c] of cases.entries()) {
      const d = c.doc;
      const what = c.title;
      if (n === 0) await openDoc(page, signIn, hr, d.document_id);
      else await page.goto(docPath(d.document_id));
      await expect(heading1(page), `${what}: the heading`).toHaveText(titleOf(d), { timeout: 20_000 });
      await expect(heading1(page), `${what}: one level-one heading`).toHaveCount(1);

      // The person and View employee, both to the employee page; the uploaded date and time.
      const person = main(page).getByRole('link', { name: fullName(d), exact: true });
      await expect(person.first(), `${what}: the person's name is a link`).toBeVisible();
      expect(new URL((await person.first().getAttribute('href'))!, 'http://x').pathname, `${what}: the name links to the employee page`).toBe(personPath(d.employee.employee_id));
      const view = main(page).getByRole('link', { name: WORDS.viewEmployee, exact: true });
      await expect(view, `${what}: View employee`).toBeVisible();
      expect(new URL((await view.getAttribute('href'))!, 'http://x').pathname, `${what}: View employee links to the employee page`).toBe(personPath(d.employee.employee_id));
      expect(clean(await main(page).innerText()), `${what}: "Uploaded ${dayTime(UPLOADED)}" (South Africa time)`).toContain(`Uploaded ${dayTime(UPLOADED)}`);

      // What Batsi found: the check, the compare lines, How sure, By.
      const found = section(page, WORDS.found);
      await expect(found, `${what}: What Batsi found`).toBeVisible();
      const foundText = await found.innerText();
      expect(foundText, `${what}: "${WORDS.readFrom}"`).toContain(WORDS.readFrom);
      expect(foundText, `${what}: the check is ${c.check}`).toMatch(new RegExp(`(^|[^\\w'])${esc(c.check)}\\b`));
      for (const other of Object.values(CHECK_WORD).filter((w) => w !== c.check)) {
        expect(foundText, `${what}: the check is not ${other}`).not.toMatch(new RegExp(`(^|[^\\w'])${esc(other)}\\b`));
      }
      if (c.lines === 'none') {
        await expect(main(page).getByRole('list', { name: 'What was compared' }), `${what}: no compare list`).toHaveCount(0);
        await expect(found.getByText(WORDS.noCompare, { exact: true }), `${what}: "${WORDS.noCompare}"`).toBeVisible();
      } else {
        expect(await compareLines(page), `${what}: the compare lines, in the answer's order, marked match / mismatch / unsure`).toEqual(c.lines);
        await expect(main(page).getByText(WORDS.noCompare), `${what}: not "${WORDS.noCompare}"`).toHaveCount(0);
      }
      if (c.band) {
        const sure = clean(await ddOf(found, 'How sure').innerText());
        expect(sure, `${what}: How sure says ${BAND[c.band]}`).toContain(BAND[c.band]);
        for (const other of Object.values(BAND).filter((b) => b !== BAND[c.band!])) expect(sure, `${what}: How sure is not ${other}`).not.toContain(other);
        expect(sure, `${what}: one source`).toMatch(/\b1 source\b/);
      }
      expect(clean(await ddOf(found, 'By').innerText()), `${what}: By "${WORDS.checkedByBatsi}"`).toContain(WORDS.checkedByBatsi);

      // What Batsi read.
      const read = section(page, WORDS.read);
      await expect(read, `${what}: What Batsi read`).toBeVisible();
      if (c.rows === 'none') {
        await expect(read.getByText(WORDS.noFields, { exact: true }), `${what}: "${WORDS.noFields}"`).toBeVisible();
        await expect(read.locator('dt'), `${what}: no read fields`).toHaveCount(0);
      } else if (c.rows !== 'skip') {
        const terms = (await read.locator('dt').allInnerTexts()).map(clean);
        expect(terms, `${what}: the read fields for ${TYPE_NAME[d.document_type]}`).toEqual(c.rows.map((r) => r[0]));
        for (const [term, want] of c.rows) {
          const got = clean(await ddOf(read, term).innerText());
          if (typeof want === 'string') expect(got, `${what}: ${term}`).toBe(want);
          else {
            expect(got, `${what}: ${term} shows its last four digits`).toContain(want.hidden);
            expect(got.replace(/\D/g, ''), `${what}: ${term} is Hidden`).not.toContain(want.full);
          }
        }
      }

      // The uploaded document.
      const file = section(page, WORDS.uploaded);
      await expect(file, `${what}: Uploaded document`).toBeVisible();
      await expect(file, `${what}: the file name`).toContainText(d.file_name);
      expect(clean(await ddOf(file, 'Type').innerText()), `${what}: Type`).toBe(TYPE_NAME[d.document_type]);
      expect(clean(await ddOf(file, 'Uploaded').innerText()), `${what}: Uploaded`).toContain(sa(UPLOADED).day);
      const checked = clean(await ddOf(file, 'Checked').innerText());
      if (d.ocr_completed_at) expect(checked, `${what}: Checked`).toContain(sa(d.ocr_completed_at).day);
      else expect(checked, `${what}: Checked "${WORDS.notYet}"`).toBe(WORDS.notYet);
      await expect(file.getByRole('button', { name: WORDS.open, exact: true }).or(file.getByRole('link', { name: WORDS.open, exact: true })), `${what}: Open document`).toBeVisible();

      // Not decided, read: HR can decide.
      await expect(acceptButton(page), `${what}: Accept document`).toBeVisible();
      await expect(askButtons(page).first(), `${what}: Ask for a new one`).toBeVisible();
      await expectNothingForbidden(page, what);
    }

    // Being checked.
    await page.goto(docPath(reading.document_id));
    await expect(heading1(page)).toHaveText(titleOf(reading), { timeout: 20_000 });
    const found = section(page, WORDS.found);
    await expect(found, 'Being checked: the check').toContainText(CHECK_WORD.READING);
    await expect(main(page).getByText(WORDS.stillReading, { exact: true }), `Being checked: "${WORDS.stillReading}"`).toBeVisible();
    await expect(main(page).getByRole('list', { name: 'What was compared' }), 'Being checked: no compare list').toHaveCount(0);
    await expect(main(page).getByText(WORDS.cannotDecideYet, { exact: true }), `Being checked: "${WORDS.cannotDecideYet}"`).toBeVisible();
    await expect(acceptButton(page), 'Being checked: no Accept document').toHaveCount(0);
    await expect(askButtons(page), 'Being checked: no Ask for a new one').toHaveCount(0);
  });

  test('AC-2 Accept sends one PASSED; Ask for a new one needs a reason, sends one FAILED with it trimmed; Cancel sends nothing; busy buttons send nothing more; mouse and keyboard', async ({ page, signIn, hr, one }) => {
    noBackendOnly();
    const a = doc({ document_type: 'BANK_CONFIRMATION', verification: verified(72, BANK_READ, 'NEEDS_A_LOOK') });
    const b = doc({ document_type: 'NATIONAL_ID', verification: verified(95, ID_READ, 'MATCHES') });
    const c = doc({ document_type: 'MATRIC_CERTIFICATE', verification: verified(91, {}, 'MATCHES') });
    const k = doc({ document_type: 'TERTIARY_QUALIFICATION', verification: verified(93, {}, 'MATCHES') });
    one!.add(a, b, c, k);

    // Accept, by mouse.
    await openDoc(page, signIn, hr, a.document_id);
    await expect(heading1(page)).toHaveText(titleOf(a), { timeout: 20_000 });
    const decisionCard = section(page, WORDS.decision);
    await expect(decisionCard, 'the Your decision card').toBeVisible();
    await expect(decisionCard, 'its line names the person by first name').toContainText(
      "Batsi's check only flags what does not match. HR decides: accept the document, or ask Naledi for a new one.",
    );
    expect(one!.decisions(), 'nothing is decided on opening').toEqual([]);
    await acceptButton(page).click();
    await expect.poll(() => one!.decisions(a.document_id).length, 'Accept document sends one PATCH').toBe(1);
    await page.waitForLoadState('networkidle');
    const accepted = one!.decisions(a.document_id);
    expect(accepted.length, 'exactly one').toBe(1);
    expect(accepted[0]!.body?.decision, 'decision PASSED').toBe('PASSED');
    expect(accepted[0]!.body?.employee_id, 'with the employee_id').toBe(a.employee.employee_id);
    expect(accepted[0]!.body?.notes ?? '', 'no reason with an Accept').toBe('');
    expect(accepted[0]!.idempotencyKey ?? '', 'with an Idempotency-Key').not.toBe('');
    expect(accepted[0]!.authorization, 'signed in').toMatch(/^Bearer /);

    // Ask for a new one: empty, spaces, Cancel, then a reason.
    await page.goto(docPath(b.document_id));
    await expect(heading1(page)).toHaveText(titleOf(b), { timeout: 20_000 });
    await askButtons(page).first().click();
    await expect(reasonBox(page), 'Ask for a new one opens the Reason field').toBeVisible();
    await expect(main(page).getByText(WORDS.reasonHint, { exact: true }), `the hint "${WORDS.reasonHint}"`).toBeVisible();
    await expect(main(page).getByRole('button', { name: WORDS.cancel, exact: true }), 'Cancel').toBeVisible();
    const send = () => askButtons(page).last();
    await send().click();
    await expect(main(page).getByText(WORDS.enterReason, { exact: true }), 'empty: "Enter a reason."').toBeVisible();
    await reasonBox(page).fill('    ');
    await send().click();
    await expect(main(page).getByText(WORDS.enterReason, { exact: true }), 'spaces: "Enter a reason."').toBeVisible();
    expect(one!.decisions(b.document_id), 'nothing sent without a reason').toEqual([]);
    await main(page).getByRole('button', { name: WORDS.cancel, exact: true }).click();
    await expect(reasonBox(page), 'Cancel closes the Reason field').toHaveCount(0);
    expect(one!.decisions(b.document_id), 'Cancel sends nothing').toEqual([]);
    await expect(acceptButton(page), 'after Cancel, Accept document is there').toBeVisible();

    await askButtons(page).first().click();
    const long = 'x'.repeat(600);
    await reasonBox(page).fill(long);
    const kept = await reasonBox(page).inputValue();
    expect(clean(await main(page).innerText()), 'a counter against 500').toMatch(/\b500\b/);
    if (kept.length > 500) {
      await send().click();
      await page.waitForTimeout(500);
      expect(one!.decisions(b.document_id), 'over 500 characters is not sent').toEqual([]);
    } else {
      expect(kept.length, 'the field stops at 500 characters').toBe(500);
    }
    await reasonBox(page).fill('  The photo is blurred. Please upload a clearer scan.  ');
    await send().click();
    await expect.poll(() => one!.decisions(b.document_id).length, 'one PATCH').toBe(1);
    await page.waitForLoadState('networkidle');
    const asked = one!.decisions(b.document_id);
    expect(asked.length, 'exactly one').toBe(1);
    expect(asked[0]!.body, 'FAILED with the trimmed reason and the employee_id').toMatchObject({
      decision: 'FAILED', notes: 'The photo is blurred. Please upload a clearer scan.', employee_id: b.employee.employee_id,
    });
    expect(asked[0]!.idempotencyKey ?? '', 'with an Idempotency-Key').not.toBe('');

    // While sending, both buttons are out of use and a second click sends nothing more.
    one!.decideMode = 'hold';
    await page.goto(docPath(c.document_id));
    await expect(heading1(page)).toHaveText(titleOf(c), { timeout: 20_000 });
    await acceptButton(page).click();
    await expect.poll(() => one!.decisions(c.document_id).length).toBe(1);
    expect(await outOfUse(acceptButton(page)), 'Accept document is out of use while sending').toBe(true);
    expect(await outOfUse(askButtons(page).first()), 'Ask for a new one is out of use while sending').toBe(true);
    const busy = await acceptButton(page).evaluate((b) => b.getAttribute('aria-busy') === 'true' || !!b.querySelector('.pp-spinner, [role="progressbar"]'));
    expect(busy, 'the pressed button shows it is working').toBe(true);
    await acceptButton(page).click({ force: true }).catch(() => undefined);
    await askButtons(page).first().click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(300);
    one!.release();
    await page.waitForLoadState('networkidle');
    expect(one!.decisions(c.document_id).length, 'still one PATCH').toBe(1);
    expect(one!.decisions().filter((x) => x.url.pathname.includes(c.document_id) && x.body?.decision === 'FAILED'), 'no FAILED after an Accept').toEqual([]);

    // Keyboard: Ask for a new one, type, send.
    await page.goto(docPath(k.document_id));
    await expect(heading1(page)).toHaveText(titleOf(k), { timeout: 20_000 });
    await tabTo(page, async () => (await focusedName(page)) === WORDS.askNew, WORDS.askNew);
    await page.keyboard.press('Enter');
    await expect(reasonBox(page)).toBeVisible();
    await reasonBox(page).focus();
    await page.keyboard.type('Wrong certificate');
    let reached = false;
    for (let i = 0; i < 10 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = (await focusedName(page)) === WORDS.askNew;
    }
    expect(reached, 'Tab from the reason reaches Ask for a new one').toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(() => one!.decisions(k.document_id).length, 'the keyboard sends one PATCH').toBe(1);
    expect(one!.decisions(k.document_id)[0]!.body, 'FAILED with the reason').toMatchObject({ decision: 'FAILED', notes: 'Wrong certificate' });
  });

  test('AC-3 The decision carries HR\'s name and the time, in the record and the audit event; once only; never while reading; the reason rules', async ({ page, signIn, hr, one, waiting }, testInfo) => {
    noBackendOnly();
    if (testInfo.project.name === 'desktop-1280') {
      // ---- The Lambda.
      const docs: StoredDoc[] = [
        { id: 'doc_1763300000001', type: 'NATIONAL_ID', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T08:00:00Z', v: idRow() },
        { id: 'doc_1763300000002', type: 'BANK_CONFIRMATION', status: 'MANUAL_REVIEW', uploaded_at: '2026-11-04T09:00:00Z', v: bankRow({ check: 'DOESNT_MATCH', accountHolder: 'MR P VAN WYK' }) },
        { id: 'doc_1763300000003', type: 'MATRIC_CERTIFICATE', status: 'PENDING', upload_timestamp: '2026-11-04T10:00:00Z' },
        { id: 'doc_1763300000004', type: 'TERTIARY_QUALIFICATION', status: 'PROCESSING', upload_timestamp: '2026-11-04T10:00:00Z' },
        // Auto-passed the old way: PASSED, no hr_reviewed_at. Not decided.
        { id: 'doc_1763300000005', type: 'MATRIC_CERTIFICATE', status: 'PASSED', upload_timestamp: '2026-11-01T10:00:00Z', v: { confidence: 97 } },
        { id: 'doc_1763300000006', type: 'TERTIARY_QUALIFICATION', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T10:00:00Z', v: { confidence: 60, check: 'NEEDS_A_LOOK' } },
        { id: 'doc_1763300000007', type: 'TERTIARY_QUALIFICATION', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T10:00:00Z', v: { confidence: 60, check: 'NEEDS_A_LOOK' } },
      ];
      let t = tables(docs);

      // Accept, by HR with names in the token.
      const accept = review(t, 'doc_1763300000001', HR_CALLER, { decision: 'PASSED', notes: '', employee_id: E }, { 'idempotency-key': 'onb15-accept-1' });
      const a = ok(accept, 'Accept');
      const r1 = docRow(accept.tables, E, 'doc_1763300000001')!;
      expect(r1['ocr_status'], 'Accept: PASSED').toBe('PASSED');
      expect(typeof r1['hr_reviewed_at'] === 'string' && !Number.isNaN(Date.parse(String(r1['hr_reviewed_at']))), 'Accept: hr_reviewed_at is a time').toBe(true);
      expect(r1['hr_reviewed_by'], 'Accept: hr_reviewed_by is the caller\'s email').toBe(HR_CALLER.kind === 'jwt' ? HR_CALLER.email : '');
      expect(r1['hr_reviewed_by_name'], 'Accept: hr_reviewed_by_name from given and family name').toBe('Thandi Demo-HR');
      const ev = published(accept, 'document.reviewed');
      expect(ev.length, 'Accept: one document.reviewed').toBe(1);
      expect(ev[0]!.source, 'from naleko.onboarding').toBe('naleko.onboarding');
      expect(ev[0]!.detail, 'document.reviewed says who, when and that a person did it').toMatchObject({
        document_id: 'doc_1763300000001', employee_id: E, decision: 'PASSED',
        decided_by: 'thandi.demo-hr@kestrel-foods.co.za', decided_by_name: 'Thandi Demo-HR', decided_at: r1['hr_reviewed_at'], actor: 'HUMAN',
      });
      expect(a, 'Accept: the 200 answer carries the decision').toMatchObject({
        hr_decision: 'ACCEPTED', hr_decided_at: r1['hr_reviewed_at'], hr_decided_by_name: 'Thandi Demo-HR', hr_decision_reason: null,
      });
      t = accept.tables;

      // Again on the same document: 409, nothing written, nothing published.
      for (const [how, caller, body] of [
        ['a second Accept', HR_CALLER, { decision: 'PASSED', notes: '', employee_id: E }],
        ['Ask for a new one after an Accept', HR_NO_NAMES, { decision: 'FAILED', notes: 'Changed my mind', employee_id: E }],
        ['a second decision with no employee_id (scan path)', HR_CALLER, { decision: 'FAILED', notes: 'x' }],
      ] as Array<[string, Caller, unknown]>) {
        const again = review(t, 'doc_1763300000001', caller, body);
        expect(again.status, `${how}: 409\n${again.raw}`).toBe(409);
        expect(again.body, `${how}: the 409 words`).toEqual({ error: 'This document was already decided or is still being read' });
        // A refused conditional write writes nothing: the tables are as they were, and no other write is tried.
        expect(again.tables, `${how}: nothing written`).toEqual(t);
        expect(writes(again).filter((w) => w !== 'UpdateItem documents'), `${how}: no other write is tried`).toEqual([]);
        expect(published(again), `${how}: nothing published`).toEqual([]);
        expect(docRow(again.tables, E, 'doc_1763300000001'), `${how}: the row is as the first decision left it`).toEqual(r1);
      }

      // Ask for a new one, HR with no names in the token: the email is the name; the reason trimmed.
      const ask = review(t, 'doc_1763300000002', HR_NO_NAMES, { decision: 'FAILED', notes: '  The account holder is someone else.  ', employee_id: E });
      const b = ok(ask, 'Ask for a new one');
      const r2 = docRow(ask.tables, E, 'doc_1763300000002')!;
      expect(r2['ocr_status'], 'Ask: FAILED').toBe('FAILED');
      expect(r2['hr_reviewed_by'], 'Ask: hr_reviewed_by').toBe('people-team@kestrel-foods.co.za');
      expect(r2['hr_reviewed_by_name'], 'Ask: with no names in the token, the name is the email').toBe('people-team@kestrel-foods.co.za');
      expect(r2['hr_decision_notes'], 'Ask: the trimmed reason').toBe('The account holder is someone else.');
      const ev2 = published(ask, 'document.reviewed');
      expect(ev2.length).toBe(1);
      expect(ev2[0]!.detail).toMatchObject({ decision: 'FAILED', decided_by: 'people-team@kestrel-foods.co.za', decided_by_name: 'people-team@kestrel-foods.co.za', decided_at: r2['hr_reviewed_at'], actor: 'HUMAN' });
      expect(b).toMatchObject({ hr_decision: 'NEW_ONE_ASKED', hr_decided_at: r2['hr_reviewed_at'], hr_decided_by_name: 'people-team@kestrel-foods.co.za', hr_decision_reason: 'The account holder is someone else.' });
      t = ask.tables;

      // Still being read: 409, nothing written or published.
      for (const id of ['doc_1763300000003', 'doc_1763300000004']) {
        for (const decision of ['PASSED', 'FAILED']) {
          const r = review(t, id, HR_CALLER, { decision, notes: decision === 'FAILED' ? 'Too early' : '', employee_id: E });
          expect(r.status, `${id} (being read), ${decision}: 409`).toBe(409);
          expect(r.tables, `${id}, ${decision}: nothing written`).toEqual(t);
          expect(writes(r).filter((w) => w !== 'UpdateItem documents'), `${id}, ${decision}: no other write is tried`).toEqual([]);
          expect(published(r), `${id}, ${decision}: nothing published`).toEqual([]);
        }
      }

      // A reason over 500 characters: 400, nothing written. 500 is fine.
      const tooLong = review(t, 'doc_1763300000006', HR_CALLER, { decision: 'FAILED', notes: 'y'.repeat(501), employee_id: E });
      expect(tooLong.status, '501 characters: 400').toBe(400);
      expect(tooLong.body, '501 characters: the words').toEqual({ error: 'The reason is too long' });
      expect(writes(tooLong), '501 characters: nothing written').toEqual([]);
      expect(published(tooLong), '501 characters: nothing published').toEqual([]);
      const bad = review(t, 'doc_1763300000006', HR_CALLER, { decision: 'MAYBE', employee_id: E });
      expect(bad.status, 'a decision that is neither PASSED nor FAILED: 400').toBe(400);
      expect(writes(bad), 'nothing written on a 400').toEqual([]);
      const fiveHundred = review(t, 'doc_1763300000006', HR_CALLER, { decision: 'FAILED', notes: 'z'.repeat(500), employee_id: E });
      ok(fiveHundred, '500 characters');
      expect(docRow(fiveHundred.tables, E, 'doc_1763300000006')!['hr_decision_notes'], '500 characters kept').toBe('z'.repeat(500));

      // The old app's reject: FAILED with no notes at all, still accepted, empty reason.
      const old = review(t, 'doc_1763300000007', HR_CALLER, { decision: 'FAILED' });
      const o = ok(old, 'old app reject without notes');
      expect(docRow(old.tables, E, 'doc_1763300000007')!['hr_decision_notes'], 'stored as an empty reason').toBe('');
      expect(o['hr_decision_reason'], 'no reason in the answer').toBeNull();

      // Auto-passed the old way can still be decided.
      const auto = review(t, 'doc_1763300000005', HR_CALLER, { decision: 'PASSED', employee_id: E });
      ok(auto, 'auto-passed document');
      expect(docRow(auto.tables, E, 'doc_1763300000005')!['hr_reviewed_by_name'], 'auto-passed: now decided by HR').toBe('Thandi Demo-HR');
    }

    // ---- The page: the line before deciding, the decided view from the answer, the sidebar count.
    const d = doc({ document_type: 'BANK_CONFIRMATION', verification: verified(72, BANK_READ, 'NEEDS_A_LOOK') });
    const d2 = doc({ document_type: 'NATIONAL_ID', verification: verified(95, ID_READ, 'MATCHES') });
    const others = [doc({ document_type: 'MATRIC_CERTIFICATE' }), doc({ document_type: 'TERTIARY_QUALIFICATION' }), doc({ document_type: 'NATIONAL_ID', employee: { ...NALEDI, employee_id: 'EMP-1502', first_name: 'Kagiso', last_name: 'Molefe' } })];
    one!.add(d, d2);
    waiting!.items = [d, d2, ...others].map(waitingItem);

    await page.goto(LIST_PATH);
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(new RegExp(`${esc(LIST_PATH)}$`));
    await expect.poll(() => navCount(page), 'the list has loaded: 5 waiting').toBe(5);
    await main(page).locator(`a[href$="${docPath(d.document_id)}"]`).first().click();
    await expect(heading1(page)).toHaveText(titleOf(d), { timeout: 20_000 });
    await expect(main(page).getByText(WORDS.recorded, { exact: true }), 'before deciding: the line under the buttons').toBeVisible();
    const lineBox = await main(page).getByText(WORDS.recorded, { exact: true }).boundingBox();
    const acceptBox = await acceptButton(page).boundingBox();
    expect(lineBox!.y, 'the line sits under the buttons').toBeGreaterThanOrEqual(acceptBox!.y + acceptBox!.height - 1);
    const getsBefore = one!.gets(d.document_id).length;
    await acceptButton(page).click();
    const decided = `Accepted by Jane Smith ${onAt(one!.now)}.`;
    await expect(main(page).getByText(decided, { exact: true }), `the decided view: "${decided}" (the time is the server's, from the answer)`).toBeVisible();
    await expect(main(page).getByText('Accepted', { exact: true }).first(), 'the Accepted lozenge').toBeVisible();
    await expect(main(page).getByRole('status').or(main(page).getByRole('region')).filter({ hasText: WORDS.recorded }).first(), 'the success message').toBeVisible();
    await expect(acceptButton(page), 'no Accept document after deciding').toHaveCount(0);
    await expect(askButtons(page), 'no Ask for a new one after deciding').toHaveCount(0);
    expect(one!.gets(d.document_id).length, 'no reload: the decided view comes from the PATCH answer').toBe(getsBefore);
    await expect.poll(() => navCount(page), 'the sidebar count is one lower').toBe(4);

    // Ask for a new one: the reason shows in the decided view.
    await page.goto(docPath(d2.document_id));
    await expect(heading1(page)).toHaveText(titleOf(d2), { timeout: 20_000 });
    await askButtons(page).first().click();
    await reasonBox(page).fill('The photo is blurred.');
    await askButtons(page).last().click();
    const asked = `New one asked for by Jane Smith ${onAt(one!.now)}.`;
    await expect(main(page).getByText(asked, { exact: true }), `the decided view: "${asked}"`).toBeVisible();
    await expect(main(page).getByText('Reason: The photo is blurred.', { exact: true }), 'and the reason').toBeVisible();
    await expect(acceptButton(page)).toHaveCount(0);
    await expect(reasonBox(page), 'the Reason field is gone').toHaveCount(0);
  });

  test('AC-4 A decided document shows who and when, with no buttons; an auto-passed one is not decided', async ({ page, signIn, hr, one }) => {
    noBackendOnly();
    const at = '2026-11-04T08:00:00Z';
    const cases: Array<[string, FakeDocument, string[], string]> = [
      ['accepted', doc({ document_type: 'NATIONAL_ID', ocr_status: 'PASSED', hr_reviewed_at: at, hr_reviewed_by_name: 'Thandi Demo-HR', verification: verified(95, ID_READ, 'MATCHES') }),
        [`Accepted by Thandi Demo-HR ${onAt(at)}.`], 'Accepted'],
      ['new one asked for, with a reason', doc({ document_type: 'BANK_CONFIRMATION', ocr_status: 'FAILED', hr_reviewed_at: at, hr_reviewed_by_name: 'Thandi Demo-HR', hr_decision_notes: 'The account holder is someone else.', verification: verified(72, BANK_READ, 'DOESNT_MATCH') }),
        [`New one asked for by Thandi Demo-HR ${onAt(at)}.`, 'Reason: The account holder is someone else.'], 'New one asked for'],
      ['new one asked for, an old decision with no reason', doc({ document_type: 'MATRIC_CERTIFICATE', ocr_status: 'FAILED', hr_reviewed_at: at, hr_reviewed_by_name: 'Thandi Demo-HR', hr_decision_notes: '', verification: verified(50, {}) }),
        [`New one asked for by Thandi Demo-HR ${onAt(at)}.`, 'No reason was recorded.'], 'New one asked for'],
      ['accepted, an old decision with no name', doc({ document_type: 'TERTIARY_QUALIFICATION', ocr_status: 'PASSED', hr_reviewed_at: at, verification: verified(93, {}) }),
        [`Accepted ${onAt(at)}. Who decided was not recorded.`], 'Accepted'],
      ['new one asked for, an old decision with no name', doc({ document_type: 'NATIONAL_ID', ocr_status: 'FAILED', hr_reviewed_at: at, verification: verified(40, ID_READ) }),
        [`New one asked for ${onAt(at)}. Who decided was not recorded.`], 'New one asked for'],
    ];
    const auto = doc({ document_type: 'MATRIC_CERTIFICATE', ocr_status: 'PASSED', verification: null });
    one!.add(...cases.map((c) => c[1]), auto);

    for (const [n, [what, d, lines, lozenge]] of cases.entries()) {
      if (n === 0) await openDoc(page, signIn, hr, d.document_id);
      else await page.goto(docPath(d.document_id));
      await expect(heading1(page)).toHaveText(titleOf(d), { timeout: 20_000 });
      for (const l of lines) await expect(main(page).getByText(l, { exact: true }), `${what}: "${l}"`).toBeVisible();
      await expect(main(page).getByText(lozenge, { exact: true }).first(), `${what}: the ${lozenge} lozenge`).toBeVisible();
      await expect(acceptButton(page), `${what}: no Accept document`).toHaveCount(0);
      await expect(askButtons(page), `${what}: no Ask for a new one`).toHaveCount(0);
      const text = await main(page).innerText();
      if (!lines.some((l) => l.includes('Who decided was not recorded'))) expect(text, `${what}: names who decided`).not.toContain('Who decided was not recorded');
      if (lozenge === 'Accepted') expect(text, `${what}: not "New one asked for"`).not.toContain('New one asked for');
      else expect(text, `${what}: not "Accepted"`).not.toMatch(/\bAccepted\b/);
    }

    await page.goto(docPath(auto.document_id));
    await expect(heading1(page)).toHaveText(titleOf(auto), { timeout: 20_000 });
    await expect(section(page, WORDS.found), 'auto-passed: Needs a look').toContainText(CHECK_WORD.NEEDS_A_LOOK);
    await expect(acceptButton(page), 'auto-passed: Accept document').toBeVisible();
    await expect(askButtons(page).first(), 'auto-passed: Ask for a new one').toBeVisible();
    expect(await main(page).innerText(), 'auto-passed: not shown as decided').not.toMatch(/\bAccepted\b|Who decided/);
  });

  test('AC-5 Only HR, on all three routes: 403 with nothing read for anyone else; HR gets 200 @pepla-dev', async ({ page, signIn, hr, employee }, testInfo) => {
    if (ON_DEV) {
      test.skip(testInfo.project.name !== 'desktop-1280', 'pepla-dev: once, at one width.');
      const api = devDocumentApi();
      const id = SEEDED_BANK_LETTER;
      const empToken = await signInForToken(page, signIn, employee);
      const asEmployee = { Authorization: `Bearer ${empToken}` };
      const refused = [
        ['GET /v1/verifications/<id>', await page.request.get(`${api}/v1/verifications/${id}`, { headers: asEmployee })],
        ['GET /v1/documents/<id>/url', await page.request.get(`${api}/v1/documents/${id}/url`, { headers: asEmployee })],
        // Refused before anything is read or written: the seeded document is never decided.
        ['PATCH /v1/verifications/<id>/review', await page.request.patch(`${api}/v1/verifications/${id}/review`, {
          headers: { ...asEmployee, 'content-type': 'application/json' }, data: { decision: 'PASSED' },
        })],
      ] as const;
      for (const [route, r] of refused) {
        expect(r.status(), `the employee login gets 403 from ${route}`).toBe(403);
        const text = await r.text();
        for (const leak of ['Dlamini', 's3_key', 'extracted_data', 'X-Amz', 'https://']) expect(text, `${route}: the 403 carries no "${leak}"`).not.toContain(leak);
      }
      await forgetSignIn(page); // ONB-23.1: the employee's session is kept, so it is forgotten before HR signs in
      const hrToken = await signInForToken(page, signIn, hr);
      const asHr = { Authorization: `Bearer ${hrToken}` };
      const one_ = await page.request.get(`${api}/v1/verifications/${id}`, { headers: asHr });
      expect(one_.status(), 'HR gets 200 from GET /v1/verifications/<id>').toBe(200);
      const link = await page.request.get(`${api}/v1/documents/${id}/url`, { headers: asHr });
      expect(link.status(), 'HR gets 200 from GET /v1/documents/<id>/url').toBe(200);
      return;
    }

    lambdaOnce(testInfo.project.name);
    const t = tables([
      { id: 'doc_1763500000001', type: 'BANK_CONFIRMATION', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T08:00:00Z', v: bankRow() },
      { id: 'doc_1763500000002', type: 'NATIONAL_ID', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T08:00:00Z', v: idRow() },
    ]);
    const leaks = ['Dlamini', 'NALEDI', ACCOUNT_NUMBER, ID_NUMBER, 'uploads/', 's3_key', 'X-Amz', 'Ubuntu Mutual'];
    // BE-17 (re-locked as onb-15.2): the file link opens to the document's own person, so its row uses a
    // document that belongs to none of the strangers (EMP-1599's, first in scan order). A signed-in stranger
    // gets BE-17's words after reading only the documents and employees rows, and never a signed link.
    const OWN_FILE = 'You can only open your own documents';
    const routes: Array<[string, (c: Caller) => Run, string, boolean?]> = [
      ['GET /v1/verifications/{id}', (c) => getOne(t, 'doc_1763500000002', c), 'Only HR can open documents'],
      ['GET /v1/verifications/{id} with employee_id', (c) => getOne(t, 'doc_1763500000002', c, E), 'Only HR can open documents'],
      ['GET /v1/documents/{id}/url', (c) => fileUrl(t, 'doc_1760000000000', c), 'Only HR can open documents', true],
      ['PATCH /v1/verifications/{id}/review', (c) => review(t, 'doc_1763500000001', c, { decision: 'PASSED', notes: '', employee_id: E }, { 'idempotency-key': 'onb15-stranger' }), 'Only HR can decide on a document'],
    ];
    for (const [route, call, words, ownerRule] of routes) {
      for (const [who, caller] of STRANGERS) {
        const r = call(caller);
        const how = `${route}, ${who}`;
        const signedInStranger = ownerRule && caller.kind === 'jwt';
        const expected = signedInStranger ? OWN_FILE : words;
        expect(r.error, `${how}: does not throw`).toBeUndefined();
        expect(r.status, `${how}: 403`).toBe(403);
        expect(r.body, `${how}: { "error": "${expected}" }`).toEqual({ error: expected });
        if (signedInStranger) {
          expect(awsCalls(r).filter((c) => !/^dynamodb (GetItem|Query|Scan|BatchGetItem) (documents|employees)$/.test(c)), `${how}: no S3 call, and only reads of documents and employees`).toEqual([]);
        } else {
          expect(awsCalls(r), `${how}: no DynamoDB, S3, KMS or EventBridge call`).toEqual([]);
        }
        for (const leak of [...leaks, 'other.pdf', 'EMP-1599']) expect(r.raw, `${how}: the 403 carries no "${leak}"`).not.toContain(leak);
      }
      const both: Caller = { kind: 'jwt', email: 'jane.smith@mokoena-logistics.co.za', groups: ['naleko-onboarding-hr', 'hr_staff'], givenName: 'Jane', familyName: 'Smith' };
      for (const caller of [HR_CALLER, both]) {
        const r = call(caller);
        expect(r.status, `${route}: hr_staff (${(caller as { groups: string[] }).groups.join(' + ')}) gets 200\n${r.raw.slice(0, 400)}`).toBe(200);
      }
    }
  });

  test('AC-6 ID and account numbers are Hidden, with Show; Hide, 2 minutes and leaving hide them; the GET decrypts the ID number', async ({ page, signIn, hr, one }, testInfo) => {
    noBackendOnly();
    if (testInfo.project.name === 'desktop-1280') {
      const t = tables([
        { id: 'doc_1763600000001', type: 'NATIONAL_ID', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T08:00:00Z', v: idRow() },
        // A row from before NH-11: the plain idNumber, no ciphertext.
        { id: 'doc_1763600000002', type: 'NATIONAL_ID', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T08:00:00Z', v: idRow({ idNumber_encrypted: undefined, idNumber_last4: undefined, idNumber: '8001015009087' }) },
      ]);
      const enc = getOne(t, 'doc_1763600000001', HR_CALLER, E);
      expect(ok(enc, 'encrypted row').verification?.extracted_data?.id_number, 'the KMS-decrypted ID number').toBe(ID_NUMBER);
      expect(enc.calls.flatMap((c) => (c.service === 'kms' ? [c.op] : [])), 'decrypted with KMS').toContain('Decrypt');
      const legacy = getOne(t, 'doc_1763600000002', HR_CALLER);
      expect(ok(legacy, 'legacy row').verification?.extracted_data?.id_number, 'the plain legacy ID number').toBe('8001015009087');
    }

    const id = doc({ document_type: 'NATIONAL_ID', verification: verified(95, ID_READ, 'MATCHES') });
    const bank = doc({ document_type: 'BANK_CONFIRMATION', verification: verified(92, BANK_READ, 'MATCHES') });
    one!.add(id, bank);
    await page.clock.install();
    await openDoc(page, signIn, hr, id.document_id);

    for (const [d, full, noun] of [[id, ID_NUMBER, 'ID number'], [bank, ACCOUNT_NUMBER, 'account number']] as const) {
      if (d !== id) await page.goto(docPath(d.document_id));
      await expect(heading1(page)).toHaveText(titleOf(d), { timeout: 20_000 });
      const show = showButton(page);
      await expect(show, `${noun}: one Show`).toHaveCount(1);
      const named = await show.evaluate((b, n) => {
        const name = `${b.getAttribute('aria-label') ?? ''} ${(b as HTMLElement).innerText}`;
        const described = (b.getAttribute('aria-describedby') ?? '').split(/\s+/).map((x) => (x && document.getElementById(x)?.getAttribute('aria-label')) || (x && document.getElementById(x)?.textContent) || '').join(' ');
        return new RegExp(n, 'i').test(name) || new RegExp(n, 'i').test(described);
      }, noun);
      expect(named, `a screen reader hears that Show is for the ${noun}`).toBe(true);

      const hidden = async (why: string) => {
        await expect(showButton(page), `${noun}, ${why}: Show is offered`).toBeVisible();
        await expectHidden(page, full, `${noun}, ${why}`);
      };
      const shown = () => expect(main(page).getByText(new RegExp(full.split('').join('\\s?'))), `${noun}: Show shows the full number`).toBeVisible();
      const noRecordingLine = async () => expect(await bodyText(page), `${noun}: the page does not say showing is recorded`).not.toMatch(/(Showing|Revealing) (this )?is recorded/i);

      await hidden('before Show');
      await noRecordingLine();
      await showButton(page).click();
      await shown();
      await noRecordingLine();
      await main(page).getByRole('button', { name: /^Hide\b/ }).click();
      await hidden('after Hide');

      await showButton(page).click();
      await shown();
      await page.clock.fastForward('01:50');
      await shown();
      await page.clock.fastForward('00:15');
      await hidden('after 2 minutes');

      await showButton(page).click();
      await shown();
      // Leave in the app (the breadcrumb back to the list, there at both widths), then come back.
      await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Documents to check', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${esc(LIST_PATH)}$`));
      await page.goBack();
      await expect(heading1(page)).toHaveText(titleOf(d), { timeout: 20_000 });
      await hidden('after leaving the page and coming back');
    }
  });

  test('AC-7 Placeholders while loading; not found; Only HR; could not be loaded with Try again; already decided; not saved; could not be opened; no server words', async ({ page, signIn, hr, one }, testInfo) => {
    noBackendOnly();
    if (testInfo.project.name === 'desktop-1280') {
      const t = tables([{ id: 'doc_1763700000001', type: 'BANK_CONFIRMATION', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T08:00:00Z', v: bankRow() }]);
      // A table that is not there makes every DynamoDB call on it fail ("fake DynamoDB: no table ...").
      const broken = { employees: t.employees, documents: t.documents } as unknown as Tables;
      const getFail = getOne(broken, 'doc_1763700000001', HR_CALLER, E);
      const getFail2 = getOne({ employees: t.employees } as unknown as Tables, 'doc_1763700000001', HR_CALLER, E);
      for (const [what, r] of [['GET, the verification table failing', getFail], ['GET, the documents table failing', getFail2]] as const) {
        expect(r.error, `${what}: answers, does not throw`).toBeUndefined();
        expect(r.status, `${what}: 500`).toBe(500);
        expect(r.body, `${what}: { "error": "Document could not be loaded" }`).toEqual({ error: 'Document could not be loaded' });
        expect(r.raw, `${what}: no exception text`).not.toMatch(/fake DynamoDB|no table|Exception|stack|at \w+ \(/i);
      }
      const patchFail = review({ employees: t.employees } as unknown as Tables, 'doc_1763700000001', HR_CALLER, { decision: 'PASSED', notes: '', employee_id: E });
      expect(patchFail.error, 'PATCH failing: answers, does not throw').toBeUndefined();
      expect(patchFail.status, 'PATCH failing: 500').toBe(500);
      expect(patchFail.body, 'PATCH failing: { "error": "Internal server error" }, no details').toEqual({ error: 'Internal server error' });
      expect(patchFail.raw, 'PATCH failing: no exception text').not.toMatch(/fake DynamoDB|no table|Exception|details/i);
    }

    // (The reason's counter, "37 of 500", is not a status code.)
    const serverWords = /Internal server error|ProvisionedThroughput|Exception|index\.mjs|status code|Http failure|(?<!of )\b500\b|\b409\b|\b403\b|\b404\b|Document not found/i;
    const noServerWords = async (what: string) => {
      const text = await bodyText(page);
      expect(text, `${what}: no server words`).not.toMatch(serverWords);
      expect(text, `${what}: not "${SERVER_TEXT}"`).not.toContain(SERVER_TEXT);
      expect(clean(await main(page).innerText()).length, `${what}: not a blank page`).toBeGreaterThan(10);
    };
    const d = doc({ document_type: 'BANK_CONFIRMATION', verification: verified(72, BANK_READ, 'NEEDS_A_LOOK') });
    const d2 = doc({ document_type: 'NATIONAL_ID', verification: verified(95, ID_READ, 'MATCHES') });
    const d3 = doc({ document_type: 'MATRIC_CERTIFICATE', verification: verified(91, {}, 'MATCHES') });
    one!.add(d, d2, d3);

    // Loading.
    one!.getMode = 'hold';
    await page.goto(docPath(d.document_id));
    await signIn.signInAs(hr);
    await expect.poll(() => one!.gets(d.document_id).length, 'the page asks for the document').toBeGreaterThan(0);
    await expect.poll(() => page.locator('main .pp-skeleton').filter({ visible: true }).count(), 'placeholders while loading').toBeGreaterThanOrEqual(2);
    await expect(acceptButton(page), 'no buttons while loading').toHaveCount(0);
    one!.release();
    await expect(heading1(page)).toHaveText(titleOf(d), { timeout: 20_000 });
    await expect(page.locator('main .pp-skeleton').filter({ visible: true }), 'placeholders gone').toHaveCount(0);

    // Not found.
    await page.goto(docPath('doc_does_not_exist'));
    await expect(main(page).getByText(WORDS.notFound, { exact: true }), '404').toBeVisible({ timeout: 20_000 });
    const back = main(page).getByRole('link', { name: WORDS.backToList, exact: true });
    await expect(back, `404: "${WORDS.backToList}"`).toBeVisible();
    expect(new URL((await back.getAttribute('href'))!, 'http://x').pathname, '404: back to the list').toBe(LIST_PATH);
    await noServerWords('404');

    // 403.
    one!.getMode = 'forbidden';
    await page.goto(docPath(d.document_id));
    await expect(main(page).getByText(WORDS.onlyHr, { exact: true }), '403').toBeVisible({ timeout: 20_000 });
    await expect(acceptButton(page), '403: no buttons').toHaveCount(0);
    await noServerWords('403');

    // Error answer and no connection, then Try again.
    for (const mode of ['error', 'offline'] as const) {
      one!.getMode = mode;
      await page.goto(docPath(d.document_id));
      await expect(main(page).getByText(WORDS.loadFailed, { exact: true }), `${mode}: "${WORDS.loadFailed}"`).toBeVisible({ timeout: 20_000 });
      await noServerWords(mode);
      one!.getMode = 'ok';
      await main(page).getByRole('button', { name: WORDS.tryAgain, exact: true }).click();
      await expect(heading1(page), `${mode}: Try again loads it`).toHaveText(titleOf(d), { timeout: 20_000 });
      await expect(main(page).getByText(WORDS.loadFailed)).toHaveCount(0);
    }

    // Deciding refused with 409: reloads, shows the warning and who decided first.
    one!.decideMode = 'conflict';
    await acceptButton(page).click();
    await expect(main(page).getByText(WORDS.alreadyDecided, { exact: true }), `409: "${WORDS.alreadyDecided}"`).toBeVisible({ timeout: 20_000 });
    await expect(main(page).getByText(`Accepted by Sam Peters ${onAt(one!.otherHr.at)}.`, { exact: true }), '409: the decided view, from the reload').toBeVisible();
    await expect(acceptButton(page), '409: no buttons').toHaveCount(0);
    await noServerWords('409');

    // Deciding failed otherwise: the message, the buttons and the reason stay.
    for (const mode of ['error', 'offline'] as const) {
      one!.decideMode = mode;
      await page.goto(docPath(d2.document_id));
      await expect(heading1(page)).toHaveText(titleOf(d2), { timeout: 20_000 });
      await askButtons(page).first().click();
      await reasonBox(page).fill('Please send the back of the card too.');
      await askButtons(page).last().click();
      await expect(main(page).getByText(WORDS.notSaved, { exact: true }), `${mode}: "${WORDS.notSaved}"`).toBeVisible({ timeout: 20_000 });
      await expect(reasonBox(page), `${mode}: the reason is kept`).toHaveValue('Please send the back of the card too.');
      await expect(askButtons(page).last(), `${mode}: the button stays`).toBeVisible();
      expect(await outOfUse(askButtons(page).last()), `${mode}: and can be pressed again`).toBe(false);
      await noServerWords(`decision ${mode}`);
    }
    one!.decideMode = 'ok';

    // Open document failing.
    for (const mode of ['error', 'offline'] as const) {
      one!.linkMode = mode;
      await page.goto(docPath(d3.document_id));
      await expect(heading1(page)).toHaveText(titleOf(d3), { timeout: 20_000 });
      await section(page, WORDS.uploaded).getByRole('button', { name: WORDS.open, exact: true }).or(section(page, WORDS.uploaded).getByRole('link', { name: WORDS.open, exact: true })).click();
      await expect(main(page).getByText(WORDS.notOpened, { exact: true }), `Open document ${mode}: "${WORDS.notOpened}"`).toBeVisible({ timeout: 20_000 });
      await noServerWords(`Open document ${mode}`);
    }
  });

  test('AC-8 On a phone every heading, link and button is visible and clear of the top bar, the decision buttons stack, one column, nothing scrolls sideways', async ({ page, signIn, hr, one }) => {
    noBackendOnly();
    const d = doc({
      document_type: 'TERTIARY_QUALIFICATION', employee: { ...NALEDI, first_name: 'Thandeka Nomvula', last_name: 'Dlamini-Mokoena' },
      file_name: 'tertiary-qualification-bachelor-of-commerce-accounting-2025-final-certified-copy.pdf', verification: verified(72, {}, 'NEEDS_A_LOOK'),
    });
    const b = doc({ document_type: 'BANK_CONFIRMATION', verification: verified(72, { ...BANK_READ, bank_name: 'First National Bank of Southern Africa Limited' }, 'DOESNT_MATCH') });
    one!.add(d, b);
    await openDoc(page, signIn, hr, d.document_id);
    await expect(heading1(page)).toHaveText(titleOf(d), { timeout: 20_000 });

    const width = page.viewportSize()!.width;
    for (const [what, open] of [
      ['not decided', async () => undefined],
      ['with the Reason field open', async () => { await askButtons(page).first().click(); await expect(reasonBox(page)).toBeVisible(); }],
      ['a bank letter', async () => { await page.goto(docPath(b.document_id)); await expect(heading1(page)).toHaveText(titleOf(b), { timeout: 20_000 }); }],
    ] as Array<[string, () => Promise<void>]>) {
      await open();
      expect(await noSidewaysScroll(page), `${what}: nothing scrolls sideways`).toEqual([]);
      expect(await hiddenOrCovered(page), `${what}: every heading, link and button is visible and not under the top bar`).toEqual([]);
      if (width > 400) continue;

      // The cards are one column: none sits beside another.
      const cards = await Promise.all([WORDS.found, WORDS.read, WORDS.uploaded, WORDS.decision].map(async (h) => section(page, h).boundingBox()));
      const boxes = cards.filter((x): x is NonNullable<typeof x> => !!x);
      expect(boxes.length, `${what}: the four cards`).toBe(4);
      for (const [i, x] of boxes.entries()) {
        expect(x.x, `${what}: card ${i + 1} inside the screen`).toBeGreaterThanOrEqual(0);
        expect(x.x + x.width, `${what}: card ${i + 1} inside the screen`).toBeLessThanOrEqual(width + 1);
        expect(x.width, `${what}: card ${i + 1} takes the width`).toBeGreaterThan(width * 0.6);
        for (const y of boxes.slice(i + 1)) {
          const overlap = Math.min(x.y + x.height, y.y + y.height) - Math.max(x.y, y.y);
          expect(overlap, `${what}: cards are one under another, not side by side`).toBeLessThanOrEqual(1);
        }
      }
    }

    if (width > 400) return;
    // The decision buttons stack (Reason field closed again).
    await page.goto(docPath(d.document_id));
    await expect(heading1(page)).toHaveText(titleOf(d), { timeout: 20_000 });
    const acc = (await acceptButton(page).boundingBox())!;
    const ask = (await askButtons(page).first().boundingBox())!;
    const stacked = ask.y >= acc.y + acc.height - 1 || acc.y >= ask.y + ask.height - 1;
    expect(stacked, 'Accept document and Ask for a new one stack, one under the other').toBe(true);
  });

  test('AC-9 Opening the page asks for no file link; Open document asks once and opens the link in a new tab', async ({ page, signIn, hr, one, context }) => {
    noBackendOnly();
    const d = doc({ document_type: 'NATIONAL_ID', verification: verified(95, ID_READ, 'MATCHES') });
    one!.add(d);
    await openDoc(page, signIn, hr, d.document_id);
    await expect(heading1(page)).toHaveText(titleOf(d), { timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    expect(one!.links(), 'opening the page makes no call to /v1/documents/<id>/url').toEqual([]);
    const fileRequests: string[] = [];
    context.on('request', (r) => { if (r.url().startsWith('https://document-files.onb15.example')) fileRequests.push(r.url()); });
    expect(fileRequests, 'and opens no file').toEqual([]);

    const popup = context.waitForEvent('page', { timeout: 15_000 });
    await section(page, WORDS.uploaded).getByRole('button', { name: WORDS.open, exact: true }).or(section(page, WORDS.uploaded).getByRole('link', { name: WORDS.open, exact: true })).click();
    const tab = await popup;
    await expect.poll(() => tab.url(), 'the new tab opens the returned link').toBe(one!.fileLink(d.document_id));
    expect(await tab.evaluate(() => window.opener === null), 'opened with noopener').toBe(true);
    await page.waitForLoadState('networkidle');
    expect(one!.links(d.document_id).length, 'exactly one call to /v1/documents/<id>/url').toBe(1);
    expect(one!.links(d.document_id)[0]!.authorization, 'signed in').toMatch(/^Bearer /);
    expect(page.url(), 'the page itself stays').toContain(docPath(d.document_id));
    await tab.close();
  });

  test('AC-10 Only the document routes, never AI; axe finds no serious or critical issue before and after deciding; one level-one heading', async ({ page, signIn, hr, one, baseURL }) => {
    noBackendOnly();
    const d = doc({ document_type: 'BANK_CONFIRMATION', verification: verified(72, BANK_READ, 'DOESNT_MATCH') });
    const d2 = doc({ document_type: 'NATIONAL_ID', verification: verified(95, ID_READ, 'MATCHES') });
    one!.add(d, d2);
    const seen: Array<{ method: string; url: URL }> = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') seen.push({ method: r.method(), url });
    });
    const axe = async (what: string) => {
      const results = await new AxeBuilder({ page }).analyze();
      const bad = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help} :: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
      expect(bad, `axe, ${what}`).toEqual([]);
      await expect(heading1(page), `${what}: one level-one heading`).toHaveCount(1);
    };

    await openDoc(page, signIn, hr, d.document_id);
    await expect(heading1(page)).toHaveText(titleOf(d), { timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    await axe('before deciding');
    await askButtons(page).first().click();
    await expect(reasonBox(page)).toBeVisible();
    await axe('with the Reason field open');
    await reasonBox(page).fill('The account holder is someone else.');
    await askButtons(page).last().click();
    await expect(main(page).getByText(/^New one asked for by /)).toBeVisible();
    await axe('after deciding');

    await page.goto(docPath(d2.document_id));
    await expect(heading1(page)).toHaveText(titleOf(d2), { timeout: 20_000 });
    await acceptButton(page).click();
    await expect(main(page).getByText(/^Accepted by /)).toBeVisible();
    const popup = page.context().waitForEvent('page', { timeout: 15_000 });
    await section(page, WORDS.uploaded).getByRole('button', { name: WORDS.open, exact: true }).or(section(page, WORDS.uploaded).getByRole('link', { name: WORDS.open, exact: true })).click();
    await (await popup).close();
    await page.waitForLoadState('networkidle');

    const app = new URL(baseURL!).origin;
    const cognito = /^cognito-idp\.[a-z0-9-]+\.amazonaws\.com$/;
    const fonts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
    const outside = seen.filter((s) => !(s.method === 'GET' && /\/v1\/company\/modules$/.test(s.url.pathname)) && s.url.origin !== app && !cognito.test(s.url.hostname) && !fonts.has(s.url.hostname));
    const allowed = (s: { method: string; url: URL }) =>
      (s.method === 'GET' || s.method === 'OPTIONS') && /^\/v1\/verifications\/[^/]+$/.test(s.url.pathname) && [...s.url.searchParams.keys()].every((k) => k === 'employee_id')
      || (s.method === 'PATCH' || s.method === 'OPTIONS') && /^\/v1\/verifications\/[^/]+\/review$/.test(s.url.pathname) && !s.url.search
      || (s.method === 'GET' || s.method === 'OPTIONS') && /^\/v1\/documents\/[^/]+\/url$/.test(s.url.pathname) && !s.url.search;
    expect(outside.filter((s) => !allowed(s)).map((s) => `${s.method} ${s.url.href}`), 'no other host or route is called').toEqual([]);
    expect([...new Set(outside.map((s) => s.url.origin))].length, 'one document upload API').toBe(1);
    const ai = /\/agent\/|\/ai\/|\/chat|batsi|\/summary|\/external|assess-risk|risk-report|bedrock|textract|anthropic|openai/i;
    expect(seen.filter((s) => ai.test(s.url.href)).map((s) => s.url.href), 'no summary, Batsi, agent, risk or AI route is called').toEqual([]);
  });

  test('AC-11 Getting there: a Documents to check row opens the document by mouse, keyboard and address; the employee page links each uploaded document; the breadcrumb goes back', async ({ page, signIn, hr, one, waiting, people }) => {
    noBackendOnly();
    const d = doc({ document_type: 'BANK_CONFIRMATION', verification: verified(72, BANK_READ, 'NEEDS_A_LOOK') });
    const other = doc({ document_type: 'NATIONAL_ID', employee: { ...NALEDI, employee_id: 'EMP-1502', first_name: 'Kagiso', last_name: 'Molefe' }, verification: verified(95, ID_READ, 'MATCHES') });
    one!.add(d, other);
    waiting!.items = [other, d].map(waitingItem);

    // Mouse.
    await page.goto(LIST_PATH);
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(new RegExp(`${esc(LIST_PATH)}$`));
    await main(page).locator(`a[href$="${docPath(d.document_id)}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`${esc(docPath(d.document_id))}(\\?.*)?$`));
    await expect(heading1(page), 'mouse: that document').toHaveText(titleOf(d), { timeout: 20_000 });

    // The breadcrumb goes back.
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await crumbs.getByRole('link', { name: 'Documents to check', exact: true }).click();
    await expect(page, 'the breadcrumb goes back to the list').toHaveURL(new RegExp(`${esc(LIST_PATH)}$`));

    // Keyboard.
    await expect(main(page).locator(`a[href$="${docPath(d.document_id)}"]`).first()).toBeVisible();
    await tabTo(page, async () => (await focusedHref(page)).endsWith(docPath(d.document_id)), 'the bank letter\'s row');
    await page.keyboard.press('Enter');
    await expect(heading1(page), 'keyboard: that document').toHaveText(titleOf(d), { timeout: 20_000 });

    // Straight from the address, after sign-in.
    await page.context().clearCookies();
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto('about:blank');
    await page.goto(docPath(other.document_id));
    await expect(signIn.email).toBeVisible({ timeout: 20_000 });
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(new RegExp(`${esc(docPath(other.document_id))}(\\?.*)?$`), { timeout: 20_000 });
    await expect(heading1(page), 'from the address: that document').toHaveText(titleOf(other), { timeout: 20_000 });

    // The employee page: each uploaded document's type name links to its page; Not uploaded yet has none.
    const lerato: FakePerson = {
      employee: storedEmployee({ first_name: 'Lerato', last_name: 'Mokoena', stage: 'DOCUMENTS_SUBMITTED' }),
      documents: [
        storedDocument({ document_type: 'NATIONAL_ID', ocr_status: 'MANUAL_REVIEW', uploaded_at: '2026-11-03T08:00:00Z', verification: { confidence: 95 } }),
        storedDocument({ document_type: 'MATRIC_CERTIFICATE', ocr_status: 'PENDING', uploaded_at: '2026-11-05T08:00:00Z' }),
      ],
    };
    people!.add(lerato);
    const [nid, matric] = lerato.documents as [typeof lerato.documents[0], typeof lerato.documents[0]];
    one!.add(doc({ document_id: nid.document_id, document_type: 'NATIONAL_ID', employee: { employee_id: lerato.employee.employee_id, first_name: 'Lerato', last_name: 'Mokoena' }, verification: verified(95, ID_READ, 'MATCHES') }));
    await page.goto(personPath(lerato.employee.employee_id));
    await expect(heading1(page)).toHaveText('Lerato Mokoena', { timeout: 20_000 });
    const docLinks = main(page).locator('a[href*="/hr/documents/"]');
    const found = await docLinks.evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href') ?? '', name: (a.getAttribute('aria-label') ?? (a as HTMLElement).innerText).replace(/\s+/g, ' ').trim() })));
    expect(found.map((f) => new URL(f.href, 'http://x').pathname).sort(), 'one link for each uploaded document, to its page').toEqual([docPath(nid.document_id), docPath(matric.document_id)].sort());
    expect(found.find((f) => f.href.endsWith(docPath(nid.document_id)))!.name, 'the ID\'s link is its type name').toContain('National ID');
    expect(found.find((f) => f.href.endsWith(docPath(matric.document_id)))!.name, 'the matric\'s link is its type name').toContain('Matric certificate');
    await expect(main(page).getByText('Not uploaded yet').first(), 'the types not uploaded yet').toBeVisible();
    for (const name of ['Bank confirmation', 'Tertiary qualification']) {
      await expect(main(page).getByRole('link', { name, exact: true }), `"${name}" (not uploaded yet) has no link`).toHaveCount(0);
    }
    await docLinks.filter({ hasText: 'National ID' }).first().click();
    await expect(page).toHaveURL(new RegExp(`${esc(docPath(nid.document_id))}(\\?.*)?$`));
    await expect(heading1(page), 'the employee page\'s link opens that document').toHaveText('National ID, Lerato Mokoena', { timeout: 20_000 });
  });

  test('AC-12 The GET answer, comparisons and old fields; the IAM line; the OpenAPI spec', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);

    // ---- The GET answer.
    const docs: StoredDoc[] = [
      { id: 'doc_1763120000001', type: 'NATIONAL_ID', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T08:00:00Z', v: idRow() },
      { id: 'doc_1763120000002', type: 'NATIONAL_ID', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T08:00:00Z', v: idRow({ surname: 'Moyo-Ncube', check: 'DOESNT_MATCH' }) },
      { id: 'doc_1763120000003', type: 'NATIONAL_ID', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T08:00:00Z', v: idRow({ idNumber_encrypted: encrypted('9803145800999'), idNumber_last4: '0999', check: 'DOESNT_MATCH' }) },
      { id: 'doc_1763120000004', type: 'BANK_CONFIRMATION', status: 'MANUAL_REVIEW', uploaded_at: '2026-11-04T09:00:00Z', v: bankRow({ accountHolder: 'MS N DLAMINI' }) },
      { id: 'doc_1763120000005', type: 'BANK_CONFIRMATION', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T09:00:00Z', v: bankRow({ accountHolder: 'MR P VAN WYK', check: 'DOESNT_MATCH' }) },
      { id: 'doc_1763120000006', type: 'BANK_CONFIRMATION', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T09:00:00Z', v: bankRow({ accountHolder: 'NOT_FOUND', check: 'NEEDS_A_LOOK' }) },
      { id: 'doc_1763120000007', type: 'MATRIC_CERTIFICATE', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T09:00:00Z', v: { confidence: 91, check: 'MATCHES' } },
      { id: 'doc_1763120000008', type: 'NATIONAL_ID', status: 'PASSED', upload_timestamp: '2026-11-04T08:00:00Z', hr_reviewed_at: '2026-11-05T09:00:00.000Z', hr_reviewed_by_name: 'Thandi Demo-HR', v: idRow() },
      { id: 'doc_1763120000009', type: 'BANK_CONFIRMATION', status: 'FAILED', upload_timestamp: '2026-11-04T08:00:00Z', hr_reviewed_at: '2026-11-05T09:00:00.000Z', hr_reviewed_by_name: 'Thandi Demo-HR', hr_decision_notes: ' Wrong account. ', v: bankRow() },
      { id: 'doc_1763120000010', type: 'NATIONAL_ID', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-04T08:00:00Z' },
      { id: 'doc_1763120000011', type: 'MATRIC_CERTIFICATE', status: 'PASSED', upload_timestamp: '2026-11-04T08:00:00Z', v: { confidence: 97 } },
      { id: 'doc_1763120000012', type: 'TERTIARY_QUALIFICATION', status: 'FAILED', upload_timestamp: '2026-11-04T08:00:00Z', hr_reviewed_at: '2026-11-05T09:00:00.000Z', v: { confidence: 40 } },
    ];
    const t = tables(docs);
    const tNoLast4 = tables(docs, { id_number_last4: undefined });
    const cases: Array<[string, Tables, string, Comparison[], string]> = [
      ['ID matching', t, 'doc_1763120000001', [{ field: 'SURNAME', result: 'AGREES' }, { field: 'ID_NUMBER', result: 'AGREES' }], 'MATCHES'],
      ['ID with a different surname', t, 'doc_1763120000002', [{ field: 'SURNAME', result: 'DIFFERS' }, { field: 'ID_NUMBER', result: 'AGREES' }], 'DOESNT_MATCH'],
      ['ID with different last 4', t, 'doc_1763120000003', [{ field: 'SURNAME', result: 'AGREES' }, { field: 'ID_NUMBER', result: 'DIFFERS' }], 'DOESNT_MATCH'],
      ['ID with no last 4 on the record', tNoLast4, 'doc_1763120000001', [{ field: 'SURNAME', result: 'AGREES' }, { field: 'ID_NUMBER', result: 'NOT_ON_RECORD' }], 'MATCHES'],
      ['ID with nothing on the record', tables(docs, { id_number_last4: undefined, last_name: undefined }), 'doc_1763120000001', [{ field: 'SURNAME', result: 'NOT_ON_RECORD' }, { field: 'ID_NUMBER', result: 'NOT_ON_RECORD' }], 'MATCHES'],
      ['bank holder containing the surname', t, 'doc_1763120000004', [{ field: 'ACCOUNT_HOLDER', result: 'AGREES' }], 'MATCHES'],
      ['bank holder not containing it', t, 'doc_1763120000005', [{ field: 'ACCOUNT_HOLDER', result: 'DIFFERS' }], 'DOESNT_MATCH'],
      ['holder not read', t, 'doc_1763120000006', [{ field: 'ACCOUNT_HOLDER', result: 'NOT_READ' }], 'NEEDS_A_LOOK'],
      ['matric', t, 'doc_1763120000007', [], 'MATCHES'],
      ['ID with no verification (AI skipped)', t, 'doc_1763120000010', [{ field: 'SURNAME', result: 'NOT_READ' }, { field: 'ID_NUMBER', result: 'NOT_READ' }], 'NEEDS_A_LOOK'],
    ];
    for (const [what, tb, id, comparisons, check] of cases) {
      for (const employeeId of [E, undefined]) {
        const how = `${what} (${employeeId ? 'with employee_id' : 'no employee_id'})`;
        const r = getOne(tb, id, HR_CALLER, employeeId);
        const b = ok(r, how);
        expect(sortCmp(b.comparisons), `${how}: comparisons`).toEqual(sortCmp(comparisons));
        expect(b.check, `${how}: check`).toBe(check);
        expect(b.employee, `${how}: employee holds only id and names`).toEqual(
          tb === t || tb === tNoLast4 ? { employee_id: E, first_name: 'Naledi', last_name: 'Dlamini' } : expect.objectContaining({ employee_id: E, first_name: 'Naledi' }),
        );
        expect(Object.keys(b.employee).sort(), `${how}: no other employee field`).toEqual(expect.arrayContaining(['employee_id', 'first_name']));
        expect(Object.keys(b.employee).every((k) => ['employee_id', 'first_name', 'last_name'].includes(k)), `${how}: employee has nothing but employee_id, first_name, last_name`).toBe(true);
        expect(r.raw, `${how}: never the employee record's own encrypted ID number`).not.toContain(encrypted('8001015009087'));
        expect(writes(r), `${how}: nothing written`).toEqual([]);
        const calls = dynamoCalls(r);
        expect(calls.filter((c) => c.op === 'Scan' && c.table === 'document-verification'), `${how}: the verification is read with GetItem, never a Scan`).toEqual([]);
        if (employeeId) expect(calls.filter((c) => c.op === 'Scan' && c.table === 'documents'), `${how}: with employee_id, the document is read with GetItem`).toEqual([]);
        expect(calls.filter((c) => c.table === 'employees').map((c) => c.op), `${how}: the employee is read with GetItem`).toEqual(['GetItem']);
      }
    }
    // The record's last 4 never leaves: here the record says 0876 and the document 0999.
    const diff = getOne(t, 'doc_1763120000003', HR_CALLER, E);
    expect(JSON.stringify(ok(diff, 'different last 4').employee), 'the employee answer holds no id_number_last4').not.toContain('0876');
    // (The model's own reasoning stays in the answer for the old app; it quotes the document, not the record.)
    const diffBody = ok(diff, 'different last 4');
    expect(JSON.stringify({ ...diffBody, verification: { ...diffBody.verification, reasoning: undefined } }), 'the record\'s last 4 (0876) is nowhere else in the answer when the document says 0999').not.toContain('0876');

    // Every field the old app reads, plus the new ones.
    const idAnswer = ok(getOne(t, 'doc_1763120000001', HR_CALLER, E), 'ID');
    expect(Object.keys(idAnswer), 'the answer\'s fields').toEqual(expect.arrayContaining([
      'document', 'verification', 'can_reupload', 'employee', 'check', 'hr_decision', 'hr_decided_at', 'hr_decided_by_name', 'hr_decision_reason', 'comparisons',
    ]));
    expect(Object.keys(idAnswer.document), 'document keeps today\'s fields').toEqual(expect.arrayContaining([
      'document_id', 'employee_id', 'document_type', 'file_name', 's3_key', 'uploaded_at', 'ocr_status', 'ocr_completed_at',
    ]));
    expect(idAnswer.document.uploaded_at, 'uploaded_at falls back to upload_timestamp').toBe('2026-11-04T08:00:00Z');
    expect(idAnswer.document.s3_key, 's3_key stays').toBe(`uploads/${E}/NATIONAL_ID/doc_1763120000001_national_id.pdf`);
    expect(Object.keys(idAnswer.verification), 'verification keeps today\'s fields').toEqual(expect.arrayContaining(['verification_id', 'confidence', 'decision', 'reasoning', 'extracted_data', 'checks', 'created_at']));
    expect(idAnswer.verification.extracted_data, 'extracted_data: the ID fields').toMatchObject({
      id_number: ID_NUMBER, id_number_last4: ID_NUMBER.slice(-4), name: 'NALEDI THANDO', surname: 'DLAMINI', date_of_birth: '1998-03-14', gender: 'FEMALE', citizenship: 'SA CITIZEN BY BIRTH',
    });
    expect(idAnswer.verification.checks, 'checks parsed as today').toEqual(MODEL_CHECKS);
    expect(idAnswer.can_reupload, 'can_reupload as today').toBe(true);
    expect(idAnswer, 'not decided').toMatchObject({ hr_decision: null, hr_decided_at: null, hr_decided_by_name: null, hr_decision_reason: null });
    const bankAnswer = ok(getOne(t, 'doc_1763120000004', HR_CALLER, E), 'bank');
    expect(bankAnswer.verification.extracted_data, 'extracted_data: the bank fields').toMatchObject({
      account_holder: 'MS N DLAMINI', bank_name: 'Ubuntu Mutual Bank', account_number: ACCOUNT_NUMBER, branch_code: '250655', account_type: 'Cheque',
    });
    expect(bankAnswer.document.uploaded_at, 'uploaded_at as stored').toBe('2026-11-04T09:00:00Z');
    expect(ok(getOne(t, 'doc_1763120000008', HR_CALLER, E), 'accepted'), 'accepted').toMatchObject({
      hr_decision: 'ACCEPTED', hr_decided_at: '2026-11-05T09:00:00.000Z', hr_decided_by_name: 'Thandi Demo-HR', hr_decision_reason: null,
    });
    expect(ok(getOne(t, 'doc_1763120000009', HR_CALLER, E), 'new one asked'), 'new one asked for').toMatchObject({
      hr_decision: 'NEW_ONE_ASKED', hr_decided_at: '2026-11-05T09:00:00.000Z', hr_decided_by_name: 'Thandi Demo-HR', hr_decision_reason: 'Wrong account.',
    });
    expect(ok(getOne(t, 'doc_1763120000011', HR_CALLER, E), 'auto-passed'), 'auto-passed the old way (PASSED, no hr_reviewed_at): not decided').toMatchObject({ hr_decision: null, hr_decided_at: null, hr_decided_by_name: null, hr_decision_reason: null });
    expect(ok(getOne(t, 'doc_1763120000012', HR_CALLER, E), 'old decision, no name'), 'an old decision with no name').toMatchObject({
      hr_decision: 'NEW_ONE_ASKED', hr_decided_by_name: null, hr_decision_reason: null,
    });
    const missing = getOne(t, 'doc_9999999999999', HR_CALLER, E);
    expect(missing.status, 'an unknown document: 404').toBe(404);
    expect(getOne(t, 'doc_9999999999999', HR_CALLER).status, 'an unknown document, scan path: 404').toBe(404);

    // The file link: HR gets it; 15 minutes, inline; no AWS keys in the answer.
    // (A document on the Scan's first page: the card leaves this route's lookup unchanged.)
    const link = fileUrl(t, 'doc_1763120000001', HR_CALLER);
    const l = ok(link, 'file link');
    expect(l.expires_in, '15 minutes').toBe(900);
    expect(String(l.url), 'a signed link to the document').toContain('doc_1763120000001');
    expect(link.raw, 'no AWS key in the answer').not.toMatch(/onb15-fake|AKIA|aws_secret|SecretAccessKey/i);
    expect(writes(link), 'nothing written').toEqual([]);

    // ---- Terraform: getSingleDocumentVerification may GetItem on employees; nothing destroyed or replaced.
    const roles = resourcesNamed('aws_iam_role', ROLE);
    expect(roles.length, 'the role is declared once').toBe(1);
    expect(squash(roles[0]!.raw), 'the role is unchanged').toBe(squash(baseline('aws_iam_role').raw));
    const policies = resourcesNamed('aws_iam_role_policy', ROLE);
    expect(policies.length, 'its policy is declared once').toBe(1);
    const before = baseline('aws_iam_role_policy');
    for (const attr of ['name', 'role']) expect(policies[0]!.attrs.get(attr), `the policy's ${attr} is unchanged (no replacement)`).toBe(before.attrs.get(attr));
    const now = policyOf(policies[0]!);
    const old = policyOf(before);
    for (const s of statements(old).filter((x) => x.Effect === 'Allow')) {
      for (const action of ([] as string[]).concat(s.Action ?? [])) {
        for (const resource of ([] as string[]).concat(s.Resource ?? [])) {
          expect(decide(now, { action, resource }), `still allowed: ${action} on ${resource}`).toBe('allowed');
        }
      }
    }
    expect(decide(now, { action: 'dynamodb:GetItem', resource: table('employees') }), 'GetItem on employees').toBe('allowed');
    for (const action of ['dynamodb:Scan', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:BatchWriteItem']) {
      expect(decide(now, { action, resource: table('employees') }), `nothing more on employees: ${action}`).not.toBe('allowed');
    }
    for (const action of ['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem']) {
      for (const tb of ['documents', 'document-verification']) expect(decide(now, { action, resource: table(tb) }), `no write on ${tb}: ${action}`).not.toBe('allowed');
    }
    expect(statements(now).some((s) => s.Effect === 'Allow' && ([] as string[]).concat(s.Action ?? []).some((a) => a === '*' || a === 'dynamodb:*')), 'no wildcard action').toBe(false);
    for (const block of movedOrRemoved()) {
      expect(block, 'no moved or removed block takes the role or its policy away').not.toMatch(new RegExp(`aws_iam_role(_policy)?\\.${ROLE}\\b`));
    }

    // ---- The OpenAPI spec.
    const get = openapiRoute('/v1/verifications/{id}', 'get');
    expect(get.found, 'GET /v1/verifications/{id} is in api/openapi.yaml').toBe(true);
    expect(get.responses, 'GET lists 403').toContain('403');
    for (const f of ['employee', 'check', 'hr_decision', 'hr_decided_at', 'hr_decided_by_name', 'hr_decision_reason', 'comparisons', 'field', 'result',
      'account_holder', 'bank_name', 'account_number', 'branch_code', 'account_type', 'id_number_last4', 'uploaded_at']) {
      expect(get.fields['200'] ?? [], `GET 200 lists "${f}"`).toContain(f);
    }
    const url = openapiRoute('/v1/documents/{id}/url', 'get');
    expect(url.responses, 'GET /v1/documents/{id}/url lists 403').toContain('403');
    const patch = openapiRoute('/v1/verifications/{id}/review', 'patch');
    for (const code of ['400', '403', '409']) expect(patch.responses, `PATCH lists ${code}`).toContain(code);
    for (const f of ['hr_decision', 'hr_decided_at', 'hr_decided_by_name', 'hr_decision_reason']) expect(patch.fields['200'] ?? [], `PATCH 200 lists "${f}"`).toContain(f);
    expect(patch.request, 'the request takes employee_id and notes').toEqual(expect.arrayContaining(['decision', 'notes', 'employee_id']));

  });
});
