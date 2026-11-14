import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { DocumentsFake, storedEmployee, type FakePerson } from './support/documents-fake';
import { EmployeesFake, apiPerson } from './support/employees-fake';
import { HR_HOME, ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import {
  LIST_HANDLER_TODAY, REPO, openapiList, row, runList, runPerson, type Caller, type LambdaRun, type Row, type Tables,
} from './support/onb-13/lambda-harness';
import { CHECKS, WaitingFake, type Check, type WaitingItem } from './support/onb-13/waiting-fake';

/**
 * ONB-13 · Documents to check (Jira NH-162, epic NH-150).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-13.md (14 Nov 2026)
 *
 * Each page test runs at 1280 and 390 wide (projects in ./playwright.config.ts).
 * No-backend run: the browser answers GET <documentUploadApiUrl>/v1/verifications?waiting=true
 * with made-up documents (support/onb-13/waiting-fake.ts), and Cognito with the fake.
 * AC-2, AC-5 and AC-11 also run the real Lambda handlers against a fake AWS whose Scan answers
 * in pages (support/onb-13/). Tests tagged @pepla-dev also run against pepla-dev with the seed.
 *
 * These files are locked once the lock check accepts them: see ./README.md and cards/onb-13.md.
 */

const PAGE_PATH = '/hr/documents';
const HEADING = 'Documents to check';
const NAV_LABEL = 'Documents to check';
const EMPTY = 'No documents are waiting for a decision.';
const LOAD_FAILED = 'Documents could not be loaded.';
const HOLDING_LINE = 'This document opens here once document decisions are built.';

const TYPE_NAME: Record<WaitingItem['document_type'], string> = {
  NATIONAL_ID: 'National ID',
  BANK_CONFIRMATION: 'Bank confirmation',
  MATRIC_CERTIFICATE: 'Matric certificate',
  TERTIARY_QUALIFICATION: 'Tertiary qualification',
};
const CHECK_WORD: Record<Check, string> = {
  READING: 'Being checked',
  MATCHES: 'Matches',
  NEEDS_A_LOOK: 'Needs a look',
  DOESNT_MATCH: "Doesn't match",
};
/** The stat row: label -> how it counts the items. */
const STATS: Array<[string, (items: WaitingItem[]) => number]> = [
  ['Waiting', (items) => items.length],
  ['Needs a look', (items) => items.filter((i) => i.check === 'NEEDS_A_LOOK').length],
  ['Matches', (items) => items.filter((i) => i.check === 'MATCHES').length],
  ["Doesn't match", (items) => items.filter((i) => i.check === 'DOESNT_MATCH').length],
];

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "10 Nov 2026": the South African calendar day of an ISO time, with the year. */
function shownDay(iso: string): string {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date(iso)).split('-').map(Number);
  return `${d} ${MONTHS[m! - 1]} ${y}`;
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

// ---------------------------------------------------------------- made-up waiting documents (the page tests)

let docSerial = 0;
function item(employee_name: string, document_type: WaitingItem['document_type'], check: Check, arrived_at: string | null, employee_id?: string): WaitingItem {
  docSerial++;
  return {
    document_id: `doc_17312${String(docSerial).padStart(8, '0')}`,
    employee_id: employee_id ?? `EMP-13${employee_name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 6)}`,
    employee_name,
    document_type,
    check,
    arrived_at,
  };
}

/**
 * Every check and every type, in the answer's order (oldest first, no date last). Naledi's bank
 * letter arrived at 22:30 UTC on 9 Nov, which is 10 Nov in South Africa; Thandeka's at 23:59 UTC
 * on 4 Nov, which is 5 Nov.
 */
function everyCheck(): WaitingItem[] {
  return [
    item('Kagiso Molefe', 'NATIONAL_ID', 'MATCHES', '2026-11-03T08:00:00Z'),
    item('Thandeka Nkosi', 'MATRIC_CERTIFICATE', 'DOESNT_MATCH', '2026-11-04T23:59:00Z'),
    item('Sipho Ndlovu', 'TERTIARY_QUALIFICATION', 'READING', '2026-11-05T08:00:00Z'),
    item('Naledi Dlamini', 'BANK_CONFIRMATION', 'NEEDS_A_LOOK', '2026-11-09T22:30:00Z'),
    item('Ayesha Patel', 'NATIONAL_ID', 'NEEDS_A_LOOK', null),
  ];
}

/** 23 waiting documents, oldest first: one more page than 20. */
function twentyThree(): WaitingItem[] {
  const names = ['Lerato Mokoena', 'Pieter van Wyk', 'Tendai Moyo', 'Chipo Banda', 'Zanele Khumalo', 'Bongani Zulu'];
  const types = Object.keys(TYPE_NAME) as Array<WaitingItem['document_type']>;
  return Array.from({ length: 23 }, (_x, n) => {
    const day = String(1 + Math.floor(n / 2)).padStart(2, '0');
    return item(names[n % names.length]!, types[n % 4]!, CHECKS[n % 3]!, `2026-11-${day}T${n % 2 ? '14' : '07'}:00:00Z`);
  });
}

// ---------------------------------------------------------------- the page, found by its words

type Fixtures = { waiting: WaitingFake | null; docs: DocumentsFake | null; list: EmployeesFake | null };

const test = base.extend<Fixtures>({
  // Installed before the first page load. pepla-dev answers for itself.
  waiting: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new WaitingFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
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

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs made-up documents.');
const lambdaOnce = (projectName: string) => {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambda against a fake AWS.');
  test.skip(projectName !== 'desktop-1280', 'Runs the Lambda once: it has no screen width.');
};

const onPage = new RegExp(`${esc(PAGE_PATH)}$`);
const docPath = (id: string) => `${PAGE_PATH}/${encodeURIComponent(id)}`;
const personPath = (id: string) => `/hr/employees/${encodeURIComponent(id)}`;

/** Opens the list signed out: sign-in comes first and brings HR back to the list. */
async function openList(page: Page, signIn: SignInPage, hr: Login): Promise<void> {
  await page.goto(PAGE_PATH);
  await expect(signIn.email).toBeVisible();
  await signIn.signInAs(hr);
  await expect(page).toHaveURL(onPage);
  await expect(heading1(page)).toHaveText(HEADING, { timeout: 20_000 });
}

function heading1(page: Page): Locator {
  return page.getByRole('heading', { level: 1 });
}
function main(page: Page): Locator {
  return page.locator('main');
}
/** Rows that are documents: they hold a link to the document's page. */
function docRows(page: Page): Locator {
  return main(page).locator('table tbody tr').filter({ has: page.locator('a[href*="/hr/documents/"]') });
}
function statValue(page: Page, label: string): Locator {
  const label_ = page.locator('.pp-stat__label').filter({ hasText: new RegExp(`^\\s*${esc(label)}\\s*$`) });
  return main(page).locator('.pp-stat').filter({ has: label_ }).locator('.pp-stat__value');
}
/** The sidebar item, found whether or not the phone drawer is open. */
function navItem(page: Page): Locator {
  return page.locator('[role="navigation"] a[href="/hr/documents"], nav a[href="/hr/documents"]').filter({ hasText: NAV_LABEL });
}
/** The number on the sidebar item, or null when it shows none. */
async function navCount(page: Page): Promise<number | null> {
  const text = clean((await navItem(page).first().textContent()) ?? '');
  const m = /\d+/.exec(text.replace(NAV_LABEL, ''));
  return m ? Number(m[0]) : null;
}

type ShownRow = {
  name: string; nameHref: string; doc: string; docHref: string; docLabel: string; check: string; text: string;
};

async function readRows(page: Page): Promise<ShownRow[]> {
  return docRows(page).evaluateAll((trs) =>
    trs.map((tr) => {
      const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
      const person = tr.querySelector('a[href*="/hr/employees/"]') as HTMLAnchorElement | null;
      const doc = tr.querySelector('a[href*="/hr/documents/"]') as HTMLAnchorElement;
      const lozenge = tr.querySelector('.pp-lozenge') as HTMLElement | null;
      const labelled = doc.getAttribute('aria-labelledby');
      const docLabel = doc.getAttribute('aria-label')
        ?? (labelled ? labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : doc.textContent ?? '');
      return {
        name: tidy(person?.innerText ?? ''),
        nameHref: person?.getAttribute('href') ?? '',
        doc: tidy(doc.innerText),
        docHref: doc.getAttribute('href') ?? '',
        docLabel: tidy(docLabel),
        check: tidy(lozenge?.innerText ?? ''),
        text: tidy((tr as HTMLElement).innerText),
      };
    }),
  );
}

const nextPage = (page: Page) => page.getByRole('button', { name: 'Next page', exact: true }).or(page.getByRole('link', { name: 'Next page', exact: true })).first();

/** Every document row on every page of the table, following Next page. */
async function allRowsOnAllPages(page: Page): Promise<ShownRow[]> {
  const rows: ShownRow[] = [];
  for (let n = 0; n < 50; n++) {
    rows.push(...(await readRows(page)));
    const next = nextPage(page);
    if (!(await next.count()) || !(await next.isEnabled())) break;
    const before = (await readRows(page)).map((r) => r.docHref).join();
    await next.click();
    await expect.poll(async () => (await readRows(page)).map((r) => r.docHref).join()).not.toBe(before);
  }
  return rows;
}

/** What one row must show for one waiting document. */
function expectRow(r: ShownRow, i: WaitingItem): void {
  const what = `${i.employee_name}'s ${TYPE_NAME[i.document_type]}`;
  expect(r.name, `${what}: the employee's full name`).toBe(i.employee_name);
  expect(new URL(r.nameHref, 'http://x').pathname, `${what}: the name links to the employee page`).toBe(personPath(i.employee_id));
  expect(r.doc, `${what}: the document type name`).toBe(TYPE_NAME[i.document_type]);
  expect(new URL(r.docHref, 'http://x').pathname, `${what}: the document links to its page`).toBe(docPath(i.document_id));
  expect(r.check, `${what}: the check, in a lozenge`).toBe(CHECK_WORD[i.check]);
  for (const other of Object.values(CHECK_WORD)) {
    if (other !== CHECK_WORD[i.check]) expect(r.text, `${what}: the row does not say "${other}"`).not.toMatch(new RegExp(`(^|[^'\\w])${esc(other)}\\b`));
  }
  if (i.arrived_at) {
    expect(r.text, `${what}: arrived ${shownDay(i.arrived_at)} (South Africa time, with the year)`).toMatch(new RegExp(`\\b${esc(shownDay(i.arrived_at))}\\b`));
    expect(r.text, `${what}: a date is known`).not.toContain('Not known');
  } else {
    expect(r.text, `${what}: no arrived date, so "Not known"`).toContain('Not known');
  }
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
 * Every heading, link and button in main that a person can see: is it inside the screen's width,
 * below the top bar when the page is at the top, and the thing a tap at its centre reaches once it
 * is scrolled into view (nothing on top of it, the top bar included)? Returns what fails.
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
const focusedHref = (page: Page) => page.evaluate(() => (document.activeElement instanceof HTMLAnchorElement ? document.activeElement.getAttribute('href') ?? '' : ''));

/** On a phone the sidebar is a drawer: open it first. */
async function openSidebar(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: 'Open menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await expect(navItem(page).first()).toBeVisible();
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

// ---------------------------------------------------------------- the stored tables (the Lambda tests)

const ID_NUMBER = '9803145800876';
/** Read from documents by OCR: none of it may reach the list. */
const READ_FROM_DOCUMENTS = {
  name: 'GRACE', surname: 'MOLOI-KHAN', dateOfBirth: '1998-03-14', accountNumber: '62845519023', branchCode: '250655',
  bankName: 'Ubuntu Mutual Bank', accountHolder: 'G MOLOI-KHAN',
};

type StoredDoc = {
  employee: string;
  id: string;
  type: WaitingItem['document_type'];
  status: 'PENDING' | 'PASSED' | 'MANUAL_REVIEW' | 'FAILED';
  upload_timestamp?: string;
  uploaded_at?: string;
  hr_reviewed_at?: string;
  confidence?: number;
};

const PEOPLE: Array<[string, string, string]> = [
  ['EMP-1301', 'Naledi', 'Dlamini'],
  ['EMP-1302', 'Kagiso', 'Molefe'],
  ['EMP-1303', 'Thandeka', 'Nkosi'],
  ['EMP-1304', 'Sipho', 'Ndlovu'],
  ['EMP-1305', 'Ayesha', 'Patel'],
  ['EMP-1306', 'Pieter', 'van Wyk'],
];
const fullName = (id: string) => PEOPLE.filter((p) => p[0] === id).map((p) => `${p[1]} ${p[2]}`)[0]!;

/**
 * Eighteen documents in scan order, so that with four rows a Scan page the waiting ones sit on
 * every page, the last page included. Nine are waiting; nine are decided (hr_reviewed_at set).
 * The decided Naledi ID is the oldest of all.
 */
const STORED: StoredDoc[] = [
  { employee: 'EMP-1301', id: 'doc_1730000000000', type: 'NATIONAL_ID', status: 'PASSED', upload_timestamp: '2026-10-27T03:33:20Z', hr_reviewed_at: '2026-10-28T09:00:00Z', confidence: 98 },
  { employee: 'EMP-1302', id: 'doc_1730620800000', type: 'NATIONAL_ID', status: 'PASSED', upload_timestamp: '2026-11-01T06:00:00Z', confidence: 96 },
  { employee: 'EMP-1302', id: 'doc_1730100000000', type: 'BANK_CONFIRMATION', status: 'FAILED', upload_timestamp: '2026-10-28T07:20:00Z', hr_reviewed_at: '2026-10-29T09:00:00Z', confidence: 41 },
  { employee: 'EMP-1303', id: 'doc_1730200000000', type: 'TERTIARY_QUALIFICATION', status: 'PASSED', upload_timestamp: '2026-10-29T11:06:40Z', hr_reviewed_at: '2026-10-30T09:00:00Z', confidence: 95 },
  { employee: 'EMP-1306', id: 'doc_1731191400000', type: 'TERTIARY_QUALIFICATION', status: 'PENDING', upload_timestamp: '2026-11-09T22:30:00Z' },
  { employee: 'EMP-1304', id: 'doc_1730300000000', type: 'NATIONAL_ID', status: 'PASSED', upload_timestamp: '2026-10-30T14:53:20Z', hr_reviewed_at: '2026-10-31T09:00:00Z', confidence: 93 },
  { employee: 'EMP-1303', id: 'doc_1730793600001', type: 'MATRIC_CERTIFICATE', status: 'FAILED', upload_timestamp: '2026-11-03T06:00:00Z' },
  { employee: 'EMP-1305', id: 'doc_1730400000000', type: 'BANK_CONFIRMATION', status: 'PASSED', upload_timestamp: '2026-10-31T18:40:00Z', hr_reviewed_at: '2026-11-01T09:00:00Z', confidence: 91 },
  { employee: 'EMP-1301', id: 'doc_1730707200000', type: 'BANK_CONFIRMATION', status: 'MANUAL_REVIEW', uploaded_at: '2026-11-02T06:00:00Z', confidence: 72 },
  { employee: 'EMP-1306', id: 'doc_1730500000000', type: 'NATIONAL_ID', status: 'FAILED', upload_timestamp: '2026-11-01T22:26:40Z', hr_reviewed_at: '2026-11-03T09:00:00Z' },
  { employee: 'EMP-1304', id: 'doc_1730793600000', type: 'TERTIARY_QUALIFICATION', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-03T06:00:00Z', confidence: 89 },
  { employee: 'EMP-1305', id: 'doc_1730600000000', type: 'MATRIC_CERTIFICATE', status: 'PASSED', upload_timestamp: '2026-11-03T02:13:20Z', hr_reviewed_at: '2026-11-04T09:00:00Z', confidence: 97 },
  { employee: 'EMP-1305', id: 'doc_1730880000000', type: 'NATIONAL_ID', status: 'PASSED', upload_timestamp: '2026-11-04T06:00:00Z', uploaded_at: '2026-10-01T00:00:00Z', confidence: 90 },
  { employee: 'EMP-1306', id: 'doc_1730650000000', type: 'BANK_CONFIRMATION', status: 'PASSED', upload_timestamp: '2026-11-03T16:06:40Z', hr_reviewed_at: '2026-11-05T09:00:00Z', confidence: 94 },
  { employee: 'EMP-1301', id: 'doc_1729999999999', type: 'MATRIC_CERTIFICATE', status: 'PENDING' },
  { employee: 'EMP-1304', id: 'doc_1730660000000', type: 'MATRIC_CERTIFICATE', status: 'FAILED', upload_timestamp: '2026-11-03T18:53:20Z', hr_reviewed_at: '2026-11-06T09:00:00Z', confidence: 30 },
  { employee: 'EMP-1302', id: 'doc_1729999999998', type: 'BANK_CONFIRMATION', status: 'FAILED' },
  // An older row whose stored status and confidence disagree: ONB-12's table goes by the confidence.
  { employee: 'EMP-1303', id: 'doc_1731000000000', type: 'BANK_CONFIRMATION', status: 'MANUAL_REVIEW', upload_timestamp: '2026-11-07T17:20:00Z', confidence: 93 },
];

/** The check by ONB-12's table (the verification's confidence, else the stored status). */
function checkOf(d: StoredDoc): Check {
  if (d.confidence !== undefined) return d.confidence >= 90 ? 'MATCHES' : 'NEEDS_A_LOOK';
  if (d.status === 'FAILED' || d.status === 'MANUAL_REVIEW') return 'NEEDS_A_LOOK';
  if (d.status === 'PASSED') return 'MATCHES';
  return 'READING';
}
const arrivedOf = (d: StoredDoc): string | null => d.upload_timestamp ?? d.uploaded_at ?? null;

/** The waiting list the card asks for: no hr_reviewed_at; oldest arrived first, no date last, then document_id. */
function expectedWaiting(docs: StoredDoc[]): WaitingItem[] {
  return docs
    .filter((d) => !d.hr_reviewed_at)
    .map((d) => ({ document_id: d.id, employee_id: d.employee, employee_name: fullName(d.employee), document_type: d.type, check: checkOf(d), arrived_at: arrivedOf(d) }))
    .sort((a, b) => {
      if (a.arrived_at !== b.arrived_at) {
        if (a.arrived_at === null) return 1;
        if (b.arrived_at === null) return -1;
        return a.arrived_at < b.arrived_at ? -1 : 1;
      }
      return a.document_id < b.document_id ? -1 : 1;
    });
}

/** The three tables as DynamoDB stores them, in scan order. */
function tablesOf(docs: StoredDoc[]): Tables {
  const employees = PEOPLE.map(([id, first, last], n) =>
    row({
      employee_id: id, first_name: first, last_name: last, email: `${first}.${last}`.toLowerCase().replace(/ /g, '') + '@kestrel-foods.co.za',
      phone: '+27 82 555 0142', department: 'Finance', job_title: 'Clerk', stage: 'DOCUMENTS_SUBMITTED', planned_start_date: '2026-12-01',
      hr_staff_id: n % 2 ? 'hr-0002' : 'hr-0001', hr_staff_name: n % 2 ? 'Sam Peters' : 'Jane Smith', created_at: '2026-10-20T08:00:00.000Z',
    }),
  );
  const documents: Row[] = [];
  const verifications: Row[] = [];
  for (const d of docs) {
    const file = `${fullName(d.employee).toLowerCase().replace(/ /g, '-')}-${d.type.toLowerCase()}.pdf`;
    const verificationId = d.confidence !== undefined ? `ver_${d.id.slice(4)}` : undefined;
    documents.push(row({
      employee_id: d.employee, document_id: d.id, document_type: d.type, file_name: file, file_size: 48213, content_type: 'application/pdf',
      s3_key: `uploads/${d.employee}/${d.type}/${d.id}_${file}`, ocr_status: d.status, upload_timestamp: d.upload_timestamp, uploaded_at: d.uploaded_at,
      hr_reviewed_at: d.hr_reviewed_at, hr_reviewed_by: d.hr_reviewed_at ? 'hr-0001' : undefined, verification_id: verificationId,
      ocr_completed_at: verificationId ? (d.upload_timestamp ?? d.uploaded_at ?? '2026-11-01T00:00:00Z') : undefined,
    }));
    if (verificationId) {
      const isId = d.type === 'NATIONAL_ID';
      const isBank = d.type === 'BANK_CONFIRMATION';
      verifications.push(row({
        verificationId, employeeId: d.employee, documentId: d.id, documentType: d.type, confidence: d.confidence!,
        decision: d.confidence! >= 90 ? 'PASSED' : d.status === 'FAILED' ? 'FAILED' : 'MANUAL_REVIEW', createdAt: d.upload_timestamp ?? d.uploaded_at ?? '2026-11-01T00:00:00Z',
        reasoning: 'Sample data.', name: READ_FROM_DOCUMENTS.name, surname: READ_FROM_DOCUMENTS.surname,
        dateOfBirth: isId ? READ_FROM_DOCUMENTS.dateOfBirth : undefined,
        idNumber_encrypted: isId ? Buffer.from(`kms:${ID_NUMBER}`).toString('base64') : undefined,
        idNumber_last4: isId ? ID_NUMBER.slice(-4) : undefined,
        accountNumber: isBank ? READ_FROM_DOCUMENTS.accountNumber : undefined, branchCode: isBank ? READ_FROM_DOCUMENTS.branchCode : undefined,
        bankName: isBank ? READ_FROM_DOCUMENTS.bankName : undefined, accountHolder: isBank ? READ_FROM_DOCUMENTS.accountHolder : undefined,
        s3_key: `uploads/${d.employee}/${d.type}/${d.id}_${file}`,
      }));
    }
  }
  return { employees, documents, 'document-verification': verifications };
}

const HR: Caller = { kind: 'jwt', email: 'jane.smith@mokoena-logistics.co.za', groups: ['hr_staff'] };
const WAITING = { waiting: 'true' };
const ITEM_FIELDS = ['arrived_at', 'check', 'document_id', 'document_type', 'employee_id', 'employee_name'];

/** The 403 the card asks for: nothing read, nothing about anyone sent. */
function expectRefused(r: LambdaRun, who: string): void {
  expect(r.status, `${who} gets 403`).toBe(403);
  expect(r.body, `${who}: the answer is { "error": "Forbidden" }`).toEqual({ error: 'Forbidden' });
  expect(r.calls.filter((c) => c.service === 'dynamodb').map((c) => `${c.op} ${c.table}`), `${who}: no table is read`).toEqual([]);
  expect(r.calls.filter((c) => c.service === 'kms'), `${who}: nothing is decrypted`).toEqual([]);
}

// ---------------------------------------------------------------- tests

test.describe('ONB-13 Documents to check', () => {
  test('AC-1 Each row shows the employee, the document type, the check and the arrived date in South Africa time', async ({ page, signIn, hr, waiting }) => {
    noBackendOnly();
    const items = everyCheck();
    waiting!.items = items;
    await openList(page, signIn, hr);
    await expect(page).toHaveTitle(`${HEADING} · Naleko People`);
    await expect(docRows(page)).toHaveCount(items.length);

    const headers = await main(page).locator('table thead th').evaluateAll((ths) => ths.map((th) => (th.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean));
    expect(headers, 'the columns').toEqual(['Employee', 'Document', 'Check', 'Arrived']);

    const rows = await readRows(page);
    items.forEach((it, n) => expectRow(rows[n]!, it));
    // The traps: 22:30 UTC on 9 Nov is 10 Nov in South Africa; no date says "Not known".
    expect(rows[3]!.text, 'Naledi\'s bank letter shows 10 Nov 2026, not 9 Nov').toMatch(/\b10 Nov 2026\b/);
    expect(rows[3]!.text).not.toMatch(/\b9 Nov\b/);
    expect(rows[1]!.text, 'Thandeka\'s matric shows 5 Nov 2026, not 4 Nov').toMatch(/\b5 Nov 2026\b/);
  });

  test('AC-2 Rows in the answer\'s order, 20 a page; the Lambda leaves decided documents out and lists oldest first, no date last', async ({ page, signIn, hr, waiting }, testInfo) => {
    noBackendOnly();
    if (testInfo.project.name === 'desktop-1280') {
      // The Lambda: decided documents (hr_reviewed_at set, PASSED or FAILED) never listed; oldest first.
      const r = runList(tablesOf(STORED), HR, WAITING);
      expect(r.status, `HR gets 200\n${r.raw.slice(0, 400)}`).toBe(200);
      const got = ((r.body?.items ?? []) as WaitingItem[]).map((i) => i.document_id);
      const decided = STORED.filter((d) => d.hr_reviewed_at).map((d) => d.id);
      expect(got.filter((id) => decided.includes(id)), 'no decided document is in the answer').toEqual([]);
      expect(got, 'oldest arrived first, no date last, then by document_id').toEqual(expectedWaiting(STORED).map((i) => i.document_id));
    }

    const items = twentyThree();
    waiting!.items = items;
    await openList(page, signIn, hr);
    await expect(docRows(page)).toHaveCount(20);
    expect((await readRows(page)).map((r) => new URL(r.docHref, 'http://x').pathname), 'page 1: the first 20, in the answer\'s order').toEqual(items.slice(0, 20).map((i) => docPath(i.document_id)));
    await nextPage(page).click();
    await expect(docRows(page)).toHaveCount(3);
    expect((await readRows(page)).map((r) => new URL(r.docHref, 'http://x').pathname), 'page 2: the last 3').toEqual(items.slice(20).map((i) => docPath(i.document_id)));
  });

  test('AC-3 The sidebar count equals Waiting and the answer\'s count, stays after the list loads, and is never fetched by HR home or an employee page', async ({ page, signIn, hr, waiting, docs, list }) => {
    noBackendOnly();
    const naledi: FakePerson = { employee: storedEmployee({ employee_id: 'EMP-1301', first_name: 'Naledi', last_name: 'Dlamini' }), documents: [] };
    docs!.add(naledi);
    list!.people = [apiPerson({ employee_id: 'EMP-1301', first_name: 'Naledi', last_name: 'Dlamini', stage: 'DOCUMENTS_SUBMITTED' })];
    waiting!.items = twentyThree();

    // HR home first: the item is there with no number, and nothing asks for the list.
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(HR_HOME);
    await expect(navItem(page), 'the sidebar has "Documents to check"').toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Naledi Dlamini', exact: true })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await navCount(page), 'HR home: no number before the list has loaded').toBeNull();
    expect(waiting!.calls.map((c) => c.url.href), 'HR home makes no call to /v1/verifications').toEqual([]);

    // An employee page: the same.
    await page.getByRole('link', { name: 'Naledi Dlamini', exact: true }).click();
    await expect(heading1(page)).toHaveText('Naledi Dlamini');
    await page.waitForLoadState('networkidle');
    expect(await navCount(page), 'employee page: no number before the list has loaded').toBeNull();
    expect(waiting!.calls.map((c) => c.url.href), 'the employee page makes no call to /v1/verifications').toEqual([]);

    // The list, from the sidebar: 23 everywhere, not 20.
    await openSidebar(page);
    await navItem(page).first().click();
    await expect(page).toHaveURL(onPage);
    await expect(docRows(page)).toHaveCount(20);
    await expect(statValue(page, 'Waiting'), 'Waiting is the full total').toHaveText('23');
    await expect.poll(() => navCount(page), 'the sidebar shows 23').toBe(23);
    const listCalls = waiting!.gets().length;
    expect(listCalls, 'the list is asked for').toBeGreaterThan(0);

    // Back to HR home and to the employee page: the number stays, with no new call.
    await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL(HR_HOME);
    await expect(page.getByRole('link', { name: 'Naledi Dlamini', exact: true })).toBeVisible();
    expect(await navCount(page), 'HR home keeps 23').toBe(23);
    await page.getByRole('link', { name: 'Naledi Dlamini', exact: true }).click();
    await expect(heading1(page)).toHaveText('Naledi Dlamini');
    await page.waitForLoadState('networkidle');
    expect(await navCount(page), 'the employee page keeps 23').toBe(23);
    expect(waiting!.gets().length, 'no new call to /v1/verifications').toBe(listCalls);
  });

  test('AC-4 The document link opens /hr/documents/<document_id>, the name opens the employee page, by mouse and keyboard; the holding page calls no API', async ({ page, signIn, hr, waiting, docs, baseURL }) => {
    noBackendOnly();
    const items = everyCheck();
    waiting!.items = items;
    const target = items[3]!; // Naledi's bank letter
    docs!.add({ employee: storedEmployee({ employee_id: target.employee_id, first_name: 'Naledi', last_name: 'Dlamini' }), documents: [] });

    const seen: URL[] = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') seen.push(url);
    });
    const app = new URL(baseURL!).origin;
    const apiCallsSince = (from: number) => seen.slice(from).filter((u) => u.origin !== app && !['fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname)).map((u) => u.href);
    const expectHolding = async (id: string) => {
      await expect(page).toHaveURL(new RegExp(`${esc(docPath(id))}$`));
      await expect(heading1(page)).toHaveText('Document');
      await expect(page.getByText(HOLDING_LINE, { exact: true })).toBeVisible();
    };

    // Mouse.
    await openList(page, signIn, hr);
    await expect(docRows(page)).toHaveCount(items.length);
    const row_ = docRows(page).nth(3);
    let from = seen.length;
    await row_.locator(`a[href*="/hr/documents/"]`).click();
    await expectHolding(target.document_id);
    await page.waitForLoadState('networkidle');
    expect(apiCallsSince(from), 'the holding page calls no API').toEqual([]);

    await page.goBack();
    await expect(docRows(page)).toHaveCount(items.length);
    await docRows(page).nth(3).locator('a[href*="/hr/employees/"]').click();
    await expect(page).toHaveURL(new RegExp(`${esc(personPath(target.employee_id))}$`));
    await expect(heading1(page)).toHaveText('Naledi Dlamini');

    // Keyboard.
    await page.goBack();
    await expect(docRows(page)).toHaveCount(items.length);
    await tabTo(page, async () => (await focusedHref(page)).endsWith(docPath(target.document_id)), 'Naledi\'s bank letter');
    from = seen.length;
    await page.keyboard.press('Enter');
    await expectHolding(target.document_id);
    await page.waitForLoadState('networkidle');
    expect(apiCallsSince(from), 'the holding page calls no API').toEqual([]);
    await page.goBack();
    await expect(docRows(page)).toHaveCount(items.length);
    await tabTo(page, async () => {
      const href = await focusedHref(page);
      return href.endsWith(personPath(target.employee_id)) && (await page.evaluate(() => !!document.activeElement?.closest('main table')));
    }, 'Naledi Dlamini in the table');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${esc(personPath(target.employee_id))}$`));

    // Opened straight from an address: sign-in, then the holding page, and still no API call.
    await page.context().clearCookies();
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto('about:blank');
    from = seen.length;
    const before = waiting!.calls.length;
    await page.goto(docPath(target.document_id));
    await expect(signIn.email).toBeVisible();
    await signIn.signInAs(hr);
    await expectHolding(target.document_id);
    await page.waitForLoadState('networkidle');
    expect(apiCallsSince(from).filter((h) => !/cognito-idp\.[a-z0-9-]+\.amazonaws\.com/.test(h)), 'opened straight, the holding page calls no API').toEqual([]);
    expect(waiting!.calls.length, 'and the list is not asked for').toBe(before);
  });

  test('AC-5 Only HR may read the list: 403 for anyone else signed in, nothing read; the Agent API keeps today\'s answer @pepla-dev', async ({ page, signIn, hr, employee }, testInfo) => {
    if (ON_DEV) {
      const api = devDocumentApi();
      const get = (token: string) => page.request.get(`${api}/v1/verifications?waiting=true`, { headers: { Authorization: `Bearer ${token}` } });
      const empToken = await signInForToken(page, signIn, employee);
      const refused = await get(empToken);
      expect(refused.status(), 'the employee login gets 403').toBe(403);
      const text = await refused.text();
      for (const leak of ['Naledi', 'Dlamini', '"items"', 'document_id']) expect(text, `the 403 carries no "${leak}"`).not.toContain(leak);

      await page.context().clearCookies();
      await page.goto('about:blank');
      const hrToken = await signInForToken(page, signIn, hr);
      const ok = await get(hrToken);
      expect(ok.status(), 'the HR login gets 200').toBe(200);
      expect(Array.isArray(((await ok.json()) as { items?: unknown }).items), 'with a list of items').toBe(true);
      return;
    }

    lambdaOnce(testInfo.project.name);
    const tables = tablesOf(STORED);
    const names = PEOPLE.flatMap((p) => [p[1], p[2]]);
    const strangers: Array<[string, Caller]> = [
      ['a new employee', { kind: 'jwt', email: 'naledi.dlamini@kestrel-foods.co.za', groups: ['employee'] }],
      ['a signed-in person in no group', { kind: 'jwt', email: 'visitor@kestrel-foods.co.za', groups: [] }],
      ['someone in another group', { kind: 'jwt', email: 'it.admin@kestrel-foods.co.za', groups: ['TalentFlowAdmin'] }],
      ['a group named not_hr_staff', { kind: 'jwt', email: 'temp@kestrel-foods.co.za', groups: ['not_hr_staff'] }],
      ['a group named hr_staff_readonly', { kind: 'jwt', email: 'audit@kestrel-foods.co.za', groups: ['employee', 'hr_staff_readonly'] }],
      ['a call with no authorizer at all', { kind: 'none' }],
    ];
    for (const [who, caller] of strangers) {
      for (const query of [WAITING, {}]) {
        const r = runList(tables, caller, query);
        const how = `${who} (${query.waiting ? 'waiting=true' : 'no query'})`;
        expectRefused(r, how);
        for (const leak of names) expect(r.raw, `${how}: the 403 carries no "${leak}"`).not.toContain(leak);
      }
    }

    for (const groups of [['hr_staff'], ['naleko-onboarding-hr', 'hr_staff']]) {
      const caller: Caller = { kind: 'jwt', email: 'jane.smith@mokoena-logistics.co.za', groups };
      expect(runList(tables, caller, WAITING).status, `${groups.join(' + ')} gets 200 for the waiting list`).toBe(200);
      expect(runList(tables, caller).status, `${groups.join(' + ')} gets 200 for today's list`).toBe(200);
    }

    // The Agent API (key authorizer, no JWT claims) gets exactly today's answer.
    const today = runList(tables, { kind: 'agent' }, {}, LIST_HANDLER_TODAY);
    expect(today.status, 'today\'s Lambda answers the Agent API').toBe(200);
    const agent = runList(tables, { kind: 'agent' });
    expect(agent.status, 'the Agent API still gets 200').toBe(200);
    expect(agent.body, 'the Agent API gets today\'s answer').toEqual(today.body);
  });

  test('AC-6 Placeholders while loading; "No documents are waiting for a decision."; "Documents could not be loaded." with Try again', async ({ page, signIn, hr, waiting }) => {
    noBackendOnly();
    const items = everyCheck();
    waiting!.items = items;

    // Loading: the answer is held back.
    waiting!.mode = 'hold';
    await page.goto(PAGE_PATH);
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(onPage);
    await expect.poll(() => waiting!.gets().length, 'the page asks for the list').toBeGreaterThan(0);
    const placeholders = page.locator('main .pp-skeleton').filter({ visible: true });
    await expect.poll(() => placeholders.count(), 'placeholders for the stats and the table').toBeGreaterThanOrEqual(3);
    const boxes = await placeholders.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ top: r.top, bottom: r.bottom })));
    expect(Math.max(...boxes.map((b) => b.bottom)) - Math.min(...boxes.map((b) => b.top)), 'the placeholders cover the stats and the table (over 150px)').toBeGreaterThanOrEqual(150);
    await expect(docRows(page)).toHaveCount(0);
    await expect(page.getByText(EMPTY)).toHaveCount(0);
    await expect(page.getByText(LOAD_FAILED)).toHaveCount(0);
    waiting!.release();
    await expect(docRows(page)).toHaveCount(items.length);
    await expect(page.locator('main .pp-skeleton').filter({ visible: true })).toHaveCount(0);

    // Nothing waiting.
    waiting!.items = [];
    await page.reload();
    await expect(page.getByText(EMPTY, { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(docRows(page)).toHaveCount(0);
    await expect(page.getByText(LOAD_FAILED)).toHaveCount(0);

    // An error answer, then Try again.
    waiting!.items = items;
    for (const mode of ['error', 'offline'] as const) {
      waiting!.mode = mode;
      await page.reload();
      await expect(page.getByText(LOAD_FAILED, { exact: true }), `${mode}: the failure message`).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(EMPTY)).toHaveCount(0);
      const body = await page.locator('body').innerText();
      expect(body, `${mode}: no server error text`).not.toMatch(/Internal server error|ProvisionedThroughput|Exception|status code|Http failure|\b500\b/i);
      waiting!.mode = 'ok';
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(docRows(page), `${mode}: Try again loads the list`).toHaveCount(items.length);
      await expect(page.getByText(LOAD_FAILED)).toHaveCount(0);
    }
  });

  test('AC-7 On a phone every heading, link and button is visible and clear of the top bar, the table stacks, and nothing scrolls sideways', async ({ page, signIn, hr, waiting }) => {
    noBackendOnly();
    const items = twentyThree().slice(0, 6);
    items[0]!.employee_name = 'Thandeka Nomvula Dlamini-Mokoena';
    items[0]!.document_type = 'TERTIARY_QUALIFICATION';
    waiting!.items = items;
    await openList(page, signIn, hr);
    await expect(docRows(page)).toHaveCount(items.length);

    expect(await noSidewaysScroll(page), 'nothing scrolls sideways').toEqual([]);
    expect(await hiddenOrCovered(page), 'every heading, link and button is visible and not under the top bar').toEqual([]);

    // The table stacks on a phone (the rule ONB-02 AC-5 holds HR home to): each row is one card as
    // wide as the list, holding all four details, not on one table line; cards one under the other.
    const width = page.viewportSize()!.width;
    const shapes = await docRows(page).evaluateAll((trs) =>
      trs.map((tr) => {
        const box = tr.getBoundingClientRect();
        const cells = [...tr.querySelectorAll('td')].map((td) => td.getBoundingClientRect()).filter((b) => b.width > 0 && b.height > 0);
        return {
          left: box.left, right: box.right, top: box.top, bottom: box.bottom, cells: cells.length,
          cellsInside: cells.every((c) => c.left >= box.left - 1 && c.right <= box.right + 1 && c.top >= box.top - 1 && c.bottom <= box.bottom + 1),
          stacked: cells.some((c) => c.top >= cells[0]!.bottom - 1),
          oneLine: cells.every((c) => Math.abs(c.top - cells[0]!.top) <= 2),
        };
      }),
    );
    if (width > 400) {
      for (const [i, s] of shapes.entries()) expect(s.oneLine, `desktop row ${i + 1} is one table line`).toBe(true);
      return;
    }
    for (const [i, s] of shapes.entries()) {
      expect(s.cells, `card ${i + 1}: four details`).toBe(4);
      expect(s.left, `card ${i + 1} inside the screen on the left`).toBeGreaterThanOrEqual(0);
      expect(s.right, `card ${i + 1} inside the screen on the right`).toBeLessThanOrEqual(width);
      expect(s.right - s.left, `card ${i + 1} is as wide as the list`).toBeGreaterThan(width * 0.6);
      expect(s.cellsInside, `card ${i + 1} holds all its details`).toBe(true);
      expect(s.stacked, `card ${i + 1} stacks its details, not one table line`).toBe(true);
      if (i > 0) expect(s.top, `card ${i + 1} sits below card ${i}`).toBeGreaterThanOrEqual(shapes[i - 1]!.bottom - 1);
    }
  });

  test('AC-8 pepla-dev: HR sees Naledi Dlamini\'s ID, bank letter and tertiary qualification, oldest first, not her accepted matric; the count equals the rows @pepla-dev', async ({ page, signIn, hr, waiting }) => {
    const naledi = ON_DEV ? seededId('Naledi', 'Dlamini') : 'EMP-1301';
    if (waiting) {
      // No-backend run: the seed as the Lambda answers it (the Lambda tests hold the Lambda to this).
      waiting.items = [
        { document_id: 'doc-national-id', employee_id: naledi, employee_name: 'Naledi Dlamini', document_type: 'NATIONAL_ID', check: 'MATCHES', arrived_at: '2026-11-03T08:00:00Z' },
        { document_id: 'doc-bank', employee_id: naledi, employee_name: 'Naledi Dlamini', document_type: 'BANK_CONFIRMATION', check: 'NEEDS_A_LOOK', arrived_at: '2026-11-04T08:00:00Z' },
        { document_id: 'doc-tertiary', employee_id: naledi, employee_name: 'Naledi Dlamini', document_type: 'TERTIARY_QUALIFICATION', check: 'READING', arrived_at: '2026-11-05T08:00:00Z' },
      ];
    }
    await openList(page, signIn, hr);
    await expect(docRows(page).first()).toBeVisible({ timeout: 20_000 });
    const rows = await allRowsOnAllPages(page);
    const hers = rows.filter((r) => r.name === 'Naledi Dlamini' && new URL(r.nameHref, 'http://x').pathname === personPath(naledi));
    expect(hers.map((r) => [r.doc, r.check]), 'Naledi\'s waiting documents, oldest first').toEqual([
      ['National ID', 'Matches'],
      ['Bank confirmation', 'Needs a look'],
      ['Tertiary qualification', 'Being checked'],
    ]);
    expect(hers.map((r) => r.text.match(/\b\d{1,2} [A-Z][a-z]{2} \d{4}\b/)?.[0]), 'arrived 3, 4 and 5 Nov 2026').toEqual(['3 Nov 2026', '4 Nov 2026', '5 Nov 2026']);
    expect(hers.filter((r) => r.doc === 'Matric certificate'), 'her accepted matric is not listed').toEqual([]);
    await expect(statValue(page, 'Waiting'), 'Waiting equals the rows').toHaveText(String(rows.length));
    await expect.poll(() => navCount(page), 'the sidebar count equals the rows').toBe(rows.length);
  });

  test('AC-9 Opening the list calls only Cognito, GET /v1/verifications?waiting=true and Google Fonts, never AI', async ({ page, signIn, hr, waiting, baseURL }) => {
    noBackendOnly();
    const seen: Array<{ method: string; url: URL }> = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.protocol === 'http:' || url.protocol === 'https:') seen.push({ method: r.method(), url });
    });
    waiting!.items = everyCheck();
    await openList(page, signIn, hr);
    await expect(docRows(page)).toHaveCount(5);
    await page.waitForLoadState('networkidle');

    const app = new URL(baseURL!).origin;
    const cognito = /^cognito-idp\.[a-z0-9-]+\.amazonaws\.com$/;
    const fonts = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
    const outside = seen.filter((s) => s.url.origin !== app && !cognito.test(s.url.hostname) && !fonts.has(s.url.hostname));
    const list = outside.filter((s) => s.url.pathname === '/v1/verifications');
    expect(list.filter((s) => s.method === 'GET').length, 'the list is asked for').toBeGreaterThan(0);
    expect(outside.filter((s) => !list.includes(s)).map((s) => `${s.method} ${s.url.href}`), 'no other host or route is called').toEqual([]);
    expect([...new Set(list.map((s) => s.url.origin))].length, 'one document upload API').toBe(1);
    for (const s of list.filter((x) => x.method !== 'OPTIONS')) {
      expect(s.method, 'only GET').toBe('GET');
      expect([...s.url.searchParams.entries()], 'with ?waiting=true and nothing else').toEqual([['waiting', 'true']]);
    }
    const ai = /\/agent\/|\/ai\/|\/chat|batsi|\/summary|assess-risk|risk-report|bedrock|textract|anthropic|openai/i;
    expect(seen.filter((s) => ai.test(s.url.href)).map((s) => s.url.href), 'no AI route is called').toEqual([]);
  });

  test('AC-10 axe finds no serious or critical issue; one level-one heading; each document link is named with the type and the person', async ({ page, signIn, hr, waiting }) => {
    noBackendOnly();
    const items = everyCheck();
    waiting!.items = items;
    await openList(page, signIn, hr);
    await expect(docRows(page)).toHaveCount(items.length);

    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help} :: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    expect(bad, 'axe on Documents to check').toEqual([]);

    await expect(heading1(page), 'one level-one heading').toHaveCount(1);
    await expect(heading1(page)).toHaveText(HEADING);

    for (const it of items) {
      const link = main(page).locator(`a[href$="${docPath(it.document_id)}"]`);
      await expect(link, `${it.employee_name}'s ${TYPE_NAME[it.document_type]}: one link`).toHaveCount(1);
      await expect(link, `${it.employee_name}'s ${TYPE_NAME[it.document_type]}: named with the type and the person`).toHaveAccessibleName(
        new RegExp(`(?=.*\\b${esc(TYPE_NAME[it.document_type])}\\b)(?=.*\\b${esc(it.employee_name)}\\b)`),
      );
    }
  });

  test('AC-11 The Lambda answers six fields, count and counts, from every scan page, with nothing read from documents; today\'s answer and the OpenAPI spec', async ({}, testInfo) => {
    lambdaOnce(testInfo.project.name);
    const tables = tablesOf(STORED);
    const want = expectedWaiting(STORED);

    const r = runList(tables, HR, WAITING);
    expect(r.status, `HR gets 200\n${r.raw.slice(0, 500)}`).toBe(200);
    expect(Object.keys(r.body ?? {}).sort(), 'the answer holds items, count and counts only').toEqual(['count', 'counts', 'items']);
    const items = r.body.items as Array<Record<string, unknown>>;
    for (const it of items) expect(Object.keys(it).sort(), `${String(it['document_id'])}: only the six fields`).toEqual(ITEM_FIELDS);
    // Every page: the documents on the last scan page (and every other) are there.
    expect(items.map((i) => i['document_id']).sort(), 'every waiting document, from every scan page').toEqual(want.map((w) => w.document_id).sort());
    for (const w of want) {
      const got = items.find((i) => i['document_id'] === w.document_id);
      expect(got, `${w.document_id}`).toBeTruthy();
      expect(got!['employee_id'], `${w.document_id}: employee_id`).toBe(w.employee_id);
      expect(got!['employee_name'], `${w.document_id}: employee_name`).toBe(w.employee_name);
      expect(got!['document_type'], `${w.document_id}: document_type`).toBe(w.document_type);
      expect(got!['check'], `${w.document_id}: check by ONB-12's table`).toBe(w.check);
      expect(got!['arrived_at'], `${w.document_id}: arrived_at from upload_timestamp, else uploaded_at, else null`).toBe(w.arrived_at);
    }
    expect(r.body.count, 'count is the number waiting').toBe(want.length);
    expect(r.body.counts, 'counts by check').toEqual(Object.fromEntries(CHECKS.map((c) => [c, want.filter((w) => w.check === c).length])));
    expect(r.calls.filter((c) => c.service === 'dynamodb' && c.table === 'documents' && c.op === 'Scan' && c.startKey).length, 'the documents scan follows LastEvaluatedKey').toBeGreaterThan(0);

    // More than 20 waiting: count, counts and items cover all of them, not a first page.
    const many: StoredDoc[] = Array.from({ length: 23 }, (_x, n) => ({
      employee: PEOPLE[n % PEOPLE.length]![0], id: `doc_17320000000${String(n).padStart(2, '0')}`, type: 'TERTIARY_QUALIFICATION' as const,
      status: 'PENDING' as const, upload_timestamp: `2026-11-${10 + (n % 15)}T08:00:00Z`,
    }));
    const big = runList(tablesOf([...STORED.filter((d) => d.hr_reviewed_at), ...many]), HR, WAITING);
    expect(big.status).toBe(200);
    expect(big.body.items?.length, '23 waiting: 23 items').toBe(23);
    expect(big.body.count, '23 waiting: count 23').toBe(23);
    expect(big.body.counts, '23 waiting: counts 23 being checked').toEqual({ READING: 23, MATCHES: 0, NEEDS_A_LOOK: 0, DOESNT_MATCH: 0 });

    // Nothing read from a document, no file address.
    for (const leak of [ID_NUMBER, ID_NUMBER.slice(-4), ...Object.values(READ_FROM_DOCUMENTS), 'uploads/', '.pdf', 'ver_', 's3_key', 'file_name', 'idNumber', 'confidence']) {
      expect(r.raw, `the answer carries no "${leak}"`).not.toContain(leak);
    }
    expect(r.calls.filter((c) => c.service === 'kms'), 'no ID number is decrypted').toEqual([]);

    // Without waiting=true, HR's answer is today's.
    const queries: Array<Record<string, string>> = [{}, { decision: 'MANUAL_REVIEW' }, { employee_id: 'EMP-1301' }, { status: 'PENDING' }, { limit: '3' }, { waiting: 'false' }];
    for (const q of queries) {
      const today = runList(tables, HR, q, LIST_HANDLER_TODAY);
      const now = runList(tables, HR, q);
      expect(now.status, `${JSON.stringify(q)}: today's status`).toBe(today.status);
      expect(now.body, `${JSON.stringify(q)}: today's answer`).toEqual(today.body);
    }

    // The employee page's Lambda: uploaded_at falls back to upload_timestamp.
    const person = runPerson(tables, 'EMP-1305', HR);
    expect(person.status, `HR reads Ayesha Patel\n${person.raw.slice(0, 300)}`).toBe(200);
    const byId = new Map<string, any>((person.body.documents ?? []).map((d: any) => [d.document_id, d]));
    expect(byId.get('doc_1730400000000')?.uploaded_at, 'only upload_timestamp stored: uploaded_at is upload_timestamp').toBe('2026-10-31T18:40:00Z');
    expect(byId.get('doc_1730880000000')?.uploaded_at, 'uploaded_at stored: it is kept').toBe('2026-10-01T00:00:00Z');
    const kagiso = runPerson(tables, 'EMP-1302', HR);
    const none = (kagiso.body.documents ?? []).find((d: any) => d.document_id === 'doc_1729999999998');
    expect(none && 'uploaded_at' in none && none.uploaded_at === null, 'neither stored: uploaded_at is null').toBe(true);

    // The OpenAPI spec.
    const spec = openapiList();
    expect(spec.parameters, 'GET /v1/verifications takes ?waiting').toContainEqual({ name: 'waiting', in: 'query' });
    expect(spec.responses, 'it lists a 403 answer').toContain('403');
    const listShape = spec.objects.find((o) => ['items', 'count', 'counts'].every((p) => o.properties.includes(p)) && ITEM_FIELDS.every((f) => o.items?.includes(f)));
    expect(listShape, 'the 200 answer describes items (the six fields), count and counts').toBeTruthy();
    expect(spec.objects.some((o) => CHECKS.every((c) => o.properties.includes(c))), 'counts lists READING, MATCHES, NEEDS_A_LOOK and DOESNT_MATCH').toBe(true);
  });
});
