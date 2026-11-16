import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page, TestInfo } from '@playwright/test';
import { DOCUMENT_TYPES, TYPE_NAME, storedDocument, storedEmployee, type DocumentType, type FakePerson } from './support/documents-fake';
import { EmployeesFake } from './support/employees-fake';
import { ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { forgetSignIn } from './support/sign-in-again';
import { EmployeeAnswerFake, type Required } from './support/onb-08/employee-fake';
import {
  REPO, REVIEW, eventFor, plain, published, review, row, runHandler, writes, type Caller, type Run, type Tables,
} from './support/onb-15/lambda-harness';

/**
 * ONB-08 · Required documents and when Verified is reached (Jira NH-165, epic NH-150).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-08.md (14 Nov 2026)
 *
 * Lambda tests (AC-1 to AC-5, AC-8) run once, in desktop-1280: the real reviewDocumentVerification and
 * getEmployeeDocumentVerifications handlers, each in a fresh Node process, against ONB-15's fake AWS
 * (support/onb-15/fake-aws: DynamoDB honours ConditionExpression, EventBridge and CloudWatch record what they
 * are asked, any AI client import fails the run). AC-1 also imports lambda/shared/required-documents.mjs.
 * Screen tests (AC-4's page half, AC-6, AC-7) run at 1280 and 390 wide with no backend: the browser answers
 * GET /v1/employees/<id>/verifications with support/onb-08/employee-fake.ts.
 * AC-9 runs on pepla-dev (desktop, once). Nothing here calls Bedrock, Textract, Postmark or AWS.
 *
 * These files are locked once accepted: see ./README.md and cards/onb-08.md.
 */

const ID = 'NATIONAL_ID';
const BANK = 'BANK_CONFIRMATION';
const MATRIC = 'MATRIC_CERTIFICATE';
const TERTIARY = 'TERTIARY_QUALIFICATION';
const BOTH = [ID, BANK];

const GET_PERSON = join(REPO, 'lambda', 'getEmployeeDocumentVerifications', 'index.mjs');
const MODULE = join(REPO, 'lambda', 'shared', 'required-documents.mjs');

const HR: Caller = { kind: 'jwt', email: 'thandi.demo-hr@kestrel-foods.co.za', groups: ['hr_staff'], givenName: 'Thandi', familyName: 'Demo-HR' };
const E = 'EMP-0800001';
const PERSON_EMAIL = 'lindiwe.zulu@gmail.com';
const SELF: Caller = { kind: 'jwt', email: PERSON_EMAIL, groups: ['employee'], givenName: 'Lindiwe', familyName: 'Zulu' };

function lambdaOnce(testInfo: TestInfo): void {
  test.skip(ON_DEV, 'No-backend run only: it runs the Lambdas against a fake AWS.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Runs the Lambdas once: they have no screen width.');
}
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: it needs made-up people.');

// ---------------------------------------------------------------- the fake tables

/** One stored document. `hr`: HR decided it (sets hr_reviewed_at), as accepted (PASSED) or sent back (FAILED). */
type Doc = { n: number; type: string; status: string; hr?: boolean; at?: string | null };
let docSerial = 0;
/** A document id as generateDocumentUploadUrl makes it (doc_<ms>), later for a larger n. */
const docId = (n: number) => `doc_${1763100000000 + n * 60_000}`;

function d(type: string, status: string, opts: { hr?: boolean; n?: number; at?: string | null } = {}): Doc {
  return { n: opts.n ?? ++docSerial, type, status, hr: opts.hr, at: opts.at };
}
/** Read by Batsi and waiting for HR. */
const waiting = (type: string, n?: number) => d(type, 'MANUAL_REVIEW', { n });
/** Accepted by HR. */
const accepted = (type: string, n?: number) => d(type, 'PASSED', { hr: true, n });
/** HR asked for a new one. */
const sentBack = (type: string, n?: number) => d(type, 'FAILED', { hr: true, n });

function docRow(doc: Doc) {
  const ms = 1763100000000 + doc.n * 60_000;
  return row({
    employee_id: E,
    document_id: docId(doc.n),
    document_type: doc.type,
    file_name: `${doc.type.toLowerCase()}-${doc.n}.pdf`,
    s3_key: `uploads/${E}/${doc.type}/${docId(doc.n)}_${doc.type.toLowerCase()}.pdf`,
    upload_timestamp: doc.at === null ? undefined : doc.at ?? new Date(ms).toISOString(),
    ocr_status: doc.status,
    hr_reviewed_at: doc.hr ? '2026-11-13T09:00:00.000Z' : undefined,
    hr_reviewed_by: doc.hr ? 'jane.smith@kestrel-foods.co.za' : undefined,
    hr_reviewed_by_name: doc.hr ? 'Jane Smith' : undefined,
    hr_decision_notes: doc.hr && doc.status === 'FAILED' ? 'The letter is older than three months.' : undefined,
  });
}

function tablesOf(docs: Doc[], stage = 'DOCUMENTS_SUBMITTED'): Tables {
  return {
    employees: [row({ employee_id: E, first_name: 'Lindiwe', last_name: 'Zulu', email: PERSON_EMAIL, stage, created_at: '2026-11-01T08:00:00.000Z' })],
    documents: docs.map(docRow),
    'document-verification': [],
  };
}

const personRow = (t: Tables) => plain(t.employees.find((r) => (r['employee_id'] as { S: string }).S === E))!;
const stageOf = (t: Tables) => personRow(t)['stage'];

/** HR decides one document (by its number), with the employee_id as the page sends it. */
function decide(t: Tables, n: number, decision: 'PASSED' | 'FAILED'): Run {
  const run = review(t, docId(n), HR, { decision, employee_id: E, ...(decision === 'FAILED' ? { notes: 'Please send a clearer copy.' } : {}) });
  expect(run.error, `deciding ${docId(n)} finishes without throwing`).toBeUndefined();
  expect(run.status, `deciding ${docId(n)}: 200 (${run.raw.slice(0, 200)})`).toBe(200);
  return run;
}
const accept = (t: Tables, n: number) => decide(t, n, 'PASSED');

const completed = (run: Run) => published(run, 'onboarding.completed').length;
const stageChanged = (run: Run) => published(run, 'employee.stage_changed').length;

/** Not Verified after this run: the stage is as it was, nothing published, the answer says so. */
function expectNotVerified(run: Run, before: string, what: string): void {
  expect(stageOf(run.tables), `${what}: the stage stays ${before}`).toBe(before);
  expect(personRow(run.tables)['verified_at'], `${what}: no verified_at`).toBeUndefined();
  expect(completed(run), `${what}: no onboarding.completed`).toBe(0);
  expect(stageChanged(run), `${what}: no employee.stage_changed`).toBe(0);
  expect(writes(run).filter((w) => w.endsWith(' employees')).length <= 1, `${what}: at most the refused stage write`).toBe(true);
  expect(run.body?.employee_stage_updated, `${what}: employee_stage_updated false`).toBe(false);
}

/** Verified by this run: stage VERIFIED with verified_at, each event once, the answer says so. */
function expectVerified(run: Run, what: string): void {
  expect(stageOf(run.tables), `${what}: the stage is VERIFIED`).toBe('VERIFIED');
  expect(String(personRow(run.tables)['verified_at'] ?? ''), `${what}: verified_at is set`).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(stageChanged(run), `${what}: employee.stage_changed once`).toBe(1);
  expect(completed(run), `${what}: onboarding.completed once`).toBe(1);
  expect(run.body?.employee_stage_updated, `${what}: employee_stage_updated true`).toBe(true);
  expect(run.body?.all_documents_passed, `${what}: all_documents_passed true`).toBe(true);
}

/** GET /v1/employees/{id}/verifications through the real Lambda. */
function getPerson(t: Tables, caller: Caller): Run {
  const run = runHandler(GET_PERSON, t, eventFor({ method: 'GET', route: '/v1/employees/{id}/verifications', path: `/v1/employees/${E}/verifications`, id: E, caller }));
  expect(run.error, 'the employee answer finishes without throwing').toBeUndefined();
  return run;
}

/** What lambda/shared/required-documents.mjs exports, read in a fresh Node process. */
function moduleValues(): { exists: boolean; types?: unknown; byCompany?: unknown[]; error?: string } {
  if (!existsSync(MODULE)) return { exists: false };
  const script = `
    const m = await import(${JSON.stringify(pathToFileURL(MODULE).href)});
    const companies = [undefined, null, {}, { company_id: 'kestrel-foods' }, 'mokoena-logistics', { required_documents: ['MATRIC_CERTIFICATE'] }];
    process.stdout.write(JSON.stringify({ types: m.REQUIRED_DOCUMENT_TYPES, byCompany: companies.map((c) => (typeof m.requiredFor === 'function' ? m.requiredFor(c) : 'no requiredFor')) }));`;
  try {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 20_000, env: { PATH: process.env['PATH'] ?? '' } });
    return { exists: true, ...JSON.parse(out) };
  } catch (e) {
    return { exists: true, error: String((e as Error).message) };
  }
}

/** What api/openapi.yaml says about one answer (python3 + PyYAML). */
function openapiAnswer(path: string, method: string, status: string): {
  found: boolean;
  description: string;
  properties: Record<string, { type: string | null; items_type: string | null; items_enum: string[] | null; description: string }>;
} {
  const out = execFileSync('python3', [join(__dirname, 'support', 'onb-08', 'openapi_fields.py'), join(REPO, 'api', 'openapi.yaml'), path, method, status], { encoding: 'utf8' });
  return JSON.parse(out);
}

// ---------------------------------------------------------------- the page

type Fixtures = { answers: EmployeeAnswerFake | null; list: EmployeesFake | null };

const test = base.extend<Fixtures>({
  answers: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new EmployeeAnswerFake(new URL(baseURL!).origin);
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

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const personPath = (id: string) => `/hr/employees/${encodeURIComponent(id)}`;
const nameOf = (p: FakePerson) => `${p.employee.first_name} ${p.employee.last_name}`;

async function openPerson(page: Page, signIn: SignInPage, hr: Login, p: FakePerson): Promise<void> {
  await page.goto(personPath(p.employee.employee_id));
  await expect(signIn.email).toBeVisible();
  await signIn.signInAs(hr);
  await expect(page).toHaveURL(new RegExp(`${esc(personPath(p.employee.employee_id))}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(nameOf(p), { timeout: 20_000 });
}

type Card = {
  heading: string;
  text: string;
  uploaded: boolean;
  /** pp-lozenge elements reading exactly "Required" inside the card. */
  marks: number;
  /** Of those, how many carry a status other than neutral. */
  coloured: number;
};

/**
 * Every document card, in page order (as ONB-12 finds them): the largest box around one type's heading
 * ("National ID", ...) that holds no other type's heading. A heading is found by its exact text, so a
 * "Required" inside a heading loses the card.
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
      const marks = [...box.querySelectorAll('pp-lozenge')].filter((l) => tidy((l as HTMLElement).innerText) === 'Required' && (l as HTMLElement).offsetParent !== null);
      const text = tidy((box as HTMLElement).innerText);
      return {
        heading: tidy((h as HTMLElement).innerText),
        text,
        uploaded: !text.includes('Not uploaded yet'),
        marks: marks.length,
        coloured: marks.filter((l) => [...l.classList].some((c) => c.startsWith('pp-lozenge--') && !/--(bold|large)$/.test(c))).length,
      };
    });
  }, names);
}

const typeOfHeading = (h: string) => (Object.entries(TYPE_NAME).find(([, n]) => n === h)?.[0] ?? '') as DocumentType;

/** Each card carries one neutral "Required" when its type is in `required`, and none otherwise. */
async function expectMarks(page: Page, p: FakePerson, required: string[], what: string): Promise<void> {
  const uploads = p.documents.length;
  const empty = DOCUMENT_TYPES.filter((t) => !p.documents.some((x) => x.document_type === t)).length;
  await expect.poll(async () => (await readCards(page)).length, { message: `${what}: every card is found by its exact type name (no "Required" inside a heading)` }).toBe(uploads + empty);
  const cards = await readCards(page);
  for (const c of cards) {
    const type = typeOfHeading(c.heading);
    const want = required.includes(type) ? 1 : 0;
    const card = `${what}: ${c.heading} (${c.uploaded ? 'uploaded' : 'Not uploaded yet'})`;
    expect(c.marks, `${card} shows ${want ? 'one "Required" mark' : 'no "Required" mark'}`).toBe(want);
    expect(c.coloured, `${card}: the "Required" mark is neutral`).toBe(0);
    if (!want) expect(c.text, `${card}: no "Required" word`).not.toMatch(/\bRequired\b/);
  }
  const marks = await page.locator('main pp-lozenge', { hasText: /^\s*Required\s*$/ }).count();
  expect(marks, `${what}: no other "Required" mark on the page`).toBe(cards.filter((c) => required.includes(typeOfHeading(c.heading))).length);
  const body = await page.locator('main').innerText();
  expect(body, `${what}: "Optional" appears nowhere`).not.toMatch(/\boptional\b/i);
  const inHeadings = await page.locator('main').getByRole('heading').evaluateAll((hs) => hs.map((h) => (h as HTMLElement).innerText).filter((t) => /Required/i.test(t)));
  expect(inHeadings, `${what}: "Required" is never inside a heading`).toEqual([]);
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
 * Every heading, link, button and "Required" mark in main that a person can see: inside the screen's width,
 * below the top bar when the page is at the top, and reached by a tap at its centre once scrolled into view.
 * (ONB-15 AC-8's check, with the marks added.)
 */
async function hiddenOrCovered(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    const bar = document.querySelector('.pp-top-navigation, [role="banner"]');
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const els = [...document.querySelectorAll('main :is(h1,h2,h3,h4,h5,h6,[role="heading"],a[href],button,pp-lozenge)')].filter((el) => {
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

/** Two IDs (the newer waiting), no bank letter, a matric, no tertiary. */
function mixedPerson(first: string): FakePerson {
  return {
    employee: storedEmployee({ first_name: first, last_name: 'Mahlangu', job_title: 'Stores Clerk', department: 'Operations', stage: 'DOCUMENTS_SUBMITTED' }),
    documents: [
      storedDocument({ document_type: 'NATIONAL_ID', file_name: 'id-front-blurry.jpg', ocr_status: 'FAILED', uploaded_at: '2026-11-08T08:00:00Z', verification: { confidence: 41 }, hr_reviewed_at: '2026-11-09T09:00:00Z' }),
      storedDocument({ document_type: 'NATIONAL_ID', file_name: 'id-front.jpg', ocr_status: 'MANUAL_REVIEW', uploaded_at: '2026-11-10T08:00:00Z', verification: { confidence: 72, idNumber: '9803145800876' } }),
      storedDocument({ document_type: 'MATRIC_CERTIFICATE', file_name: 'nsc-2016.pdf', ocr_status: 'PASSED', uploaded_at: '2026-11-10T09:00:00Z', verification: { confidence: 93 }, hr_reviewed_at: '2026-11-11T09:00:00Z' }),
    ],
  };
}

// ---------------------------------------------------------------- pepla-dev helpers (as ONB-07 AC-8 and ONB-12)

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
const DEV_EMPLOYEE_ID = 'E2E-EMP-0001';

/** The document upload API address the app was built with (CI writes it into environment.ts). */
function devDocumentApi(): string {
  const file = join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts');
  const m = /documentUploadApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(existsSync(file) ? readFileSync(file, 'utf8') : '');
  expect(m, 'pepla-web/src/environments/environment.ts has documentUploadApiUrl').toBeTruthy();
  expect(m![1], 'documentUploadApiUrl points at pepla-dev, not the placeholder').not.toMatch(/\.invalid\b/);
  return m![1]!.replace(/\/+$/, '');
}

/** Signs in through the app and keeps the ID token Cognito hands back. */
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

test.describe('ONB-08 Required documents and when Verified is reached', () => {
  test('AC-1 ID and Bank confirmation are required by default, for every company; both answers carry the list', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const m = moduleValues();
    expect(m.exists, 'lambda/shared/required-documents.mjs exists').toBe(true);
    expect(m.error, 'lambda/shared/required-documents.mjs loads').toBeUndefined();
    expect(m.types, 'REQUIRED_DOCUMENT_TYPES is the National ID and the Bank confirmation').toEqual(BOTH);
    for (const [i, got] of (m.byCompany ?? []).entries()) expect(got, `requiredFor(company ${i + 1} of 6) gives the same two`).toEqual(BOTH);

    const t = tablesOf([accepted(ID, 1), waiting(BANK, 2), waiting(MATRIC, 3)]);
    for (const [who, caller] of [['HR', HR], ['the person', SELF]] as const) {
      const run = getPerson(t, caller);
      expect(run.status, `GET /v1/employees/{id}/verifications answers ${who}`).toBe(200);
      expect(run.body?.required_documents, `the answer to ${who} carries required_documents`).toEqual(BOTH);
      expect(Object.keys(run.body ?? {}).sort(), `the answer to ${who} keeps employee, documents and summary`).toEqual(['documents', 'employee', 'required_documents', 'summary']);
    }

    const matric = decide(t, 3, 'PASSED');
    expect(matric.body?.required_documents, 'the PATCH answer carries required_documents').toEqual(BOTH);
    expect(matric.body?.required_missing, 'and required_missing: the bank letter is not accepted yet').toEqual([BANK]);
    const none = decide(tablesOf([waiting(BANK, 1), waiting(ID, 2)]), 1, 'FAILED');
    expect(none.body?.required_missing, 'required_missing keeps the order of the list').toEqual(BOTH);
  });

  test('AC-2 Accepting the last required document sets Verified, in either order; later decisions publish nothing more', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    for (const uploaded of ['ID uploaded first', 'bank letter uploaded first'] as const) {
      const [idN, bankN] = uploaded === 'ID uploaded first' ? [1, 2] : [2, 1];
      for (const [first, second] of [[ID, BANK], [BANK, ID]] as const) {
        const what = `${uploaded}, HR accepts the ${first === ID ? 'ID' : 'bank letter'} first`;
        const t = tablesOf([waiting(ID, idN), waiting(BANK, bankN)]);
        const nOf = (type: string) => (type === ID ? idN : bankN);

        const one = accept(t, nOf(first));
        expectNotVerified(one, 'DOCUMENTS_SUBMITTED', `${what}: after the first`);
        expect(one.body?.all_documents_passed, `${what}: after the first, all_documents_passed false`).toBe(false);
        expect(one.body?.required_missing, `${what}: after the first, required_missing names the other`).toEqual([second]);

        const two = accept(one.tables, nOf(second));
        expectVerified(two, `${what}: after the second`);
        expect(two.body?.required_missing, `${what}: after the second, required_missing is empty`).toEqual([]);
      }
    }

    // Once Verified, later decisions change nothing and publish nothing more.
    const done = accept(accept(tablesOf([waiting(ID, 1), waiting(BANK, 2)]), 1).tables, 2);
    expectVerified(done, 'ID then bank');
    // Uploaded after Verified.
    done.tables.documents.push(docRow(waiting(MATRIC, 3)), docRow(waiting(BANK, 4)));
    for (const [what, n, decision] of [['a matric accepted', 3, 'PASSED'], ['a newer bank letter accepted', 4, 'PASSED'], ['a newer bank letter sent back', 4, 'FAILED']] as const) {
      const later = decide(done.tables, n, decision);
      expect(stageOf(later.tables), `Verified, then ${what}: still VERIFIED`).toBe('VERIFIED');
      expect(completed(later) + stageChanged(later), `Verified, then ${what}: nothing more published`).toBe(0);
      expect(later.body?.employee_stage_updated, `Verified, then ${what}: employee_stage_updated false`).toBe(false);
    }

    // Only from DOCUMENTS_SUBMITTED, ACTIVE or INVITED, as today.
    for (const stage of ['INVITED', 'ACTIVE']) {
      expectVerified(accept(tablesOf([accepted(ID, 1), waiting(BANK, 2)], stage), 2), `from ${stage}`);
    }
    for (const stage of ['TRAINING', 'ONBOARDED', 'OFFBOARDED']) {
      expectNotVerified(accept(tablesOf([accepted(ID, 1), waiting(BANK, 2)], stage), 2), stage, `a person at ${stage} with both accepted`);
    }
  });

  test('AC-3 Optional documents alone never set Verified, and never hold it up; an unknown type is optional', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    // Optional documents alone.
    const m = accept(tablesOf([waiting(MATRIC, 1), waiting(TERTIARY, 2), waiting('PROOF_OF_ADDRESS', 3)]), 1);
    expectNotVerified(m, 'DOCUMENTS_SUBMITTED', 'matric accepted, nothing required');
    const mt = accept(m.tables, 2);
    expectNotVerified(mt, 'DOCUMENTS_SUBMITTED', 'matric and tertiary accepted, nothing required');
    expect(mt.body?.all_documents_passed, 'matric and tertiary accepted: all_documents_passed false').toBe(false);
    expectNotVerified(accept(mt.tables, 3), 'DOCUMENTS_SUBMITTED', 'matric, tertiary and an unknown type accepted, nothing required');

    // With ID and bank accepted, an optional document in any state does not hold Verified up.
    const optional: Array<[string, Doc[]]> = [
      ['a matric waiting for HR', [waiting(MATRIC, 3)]],
      ['a matric sent back', [sentBack(MATRIC, 3)]],
      ['a matric that could not be read (FAILED, not decided)', [d(MATRIC, 'FAILED', { n: 3 })]],
      ['a matric with an upload link never used (PENDING)', [d(MATRIC, 'PENDING', { n: 3 })]],
      ['a tertiary still being read', [d(TERTIARY, 'PROCESSING', { n: 3 })]],
      ['a second matric waiting after an accepted one', [accepted(MATRIC, 3), waiting(MATRIC, 5)]],
      ['an unknown type waiting', [waiting('PROOF_OF_ADDRESS', 3)]],
      ['an unknown type sent back', [sentBack('PROOF_OF_ADDRESS', 3)]],
    ];
    for (const [what, extra] of optional) {
      // The bank letter is accepted last; then, separately, the ID.
      expectVerified(accept(tablesOf([accepted(ID, 1), waiting(BANK, 2), ...extra]), 2), `ID accepted, ${what}, bank letter accepted last`);
      expectVerified(accept(tablesOf([waiting(ID, 1), accepted(BANK, 2), ...extra]), 1), `bank accepted, ${what}, ID accepted last`);
    }
  });

  test('AC-4 ID accepted, bank letter missing: the person stays In review', async ({ page, signIn, hr, answers }, testInfo) => {
    if (testInfo.project.name === 'desktop-1280' && !ON_DEV) {
      const cases: Array<[string, Doc[], number, 'PASSED' | 'FAILED']> = [
        ['no bank letter, HR accepts the ID', [waiting(ID, 1)], 1, 'PASSED'],
        ['only a bank upload link never used (PENDING), HR accepts the ID', [d(BANK, 'PENDING', { n: 2 }), waiting(ID, 1)], 1, 'PASSED'],
        ['the bank letter sent back earlier, HR accepts the ID', [sentBack(BANK, 1), waiting(ID, 2)], 2, 'PASSED'],
        ['ID accepted earlier, HR sends the bank letter back', [accepted(ID, 1), waiting(BANK, 2)], 2, 'FAILED'],
      ];
      for (const [what, docs, n, decision] of cases) {
        const run = decide(tablesOf(docs), n, decision);
        expectNotVerified(run, 'DOCUMENTS_SUBMITTED', what);
        expect(run.body?.all_documents_passed, `${what}: all_documents_passed false`).toBe(false);
        expect(run.body?.required_missing, `${what}: required_missing is the bank letter`).toEqual([BANK]);
      }
    }
    noBackendOnly();
    // The page for that answer: In review.
    const p: FakePerson = {
      employee: storedEmployee({ first_name: 'Ayanda', last_name: 'Khumalo', stage: 'DOCUMENTS_SUBMITTED' }),
      documents: [storedDocument({ document_type: 'NATIONAL_ID', file_name: 'id.pdf', ocr_status: 'PASSED', uploaded_at: '2026-11-10T08:00:00Z', verification: { confidence: 95 }, hr_reviewed_at: '2026-11-11T08:00:00Z' })],
    };
    answers!.add(p, BOTH);
    await openPerson(page, signIn, hr, p);
    const header = page.locator('.pp-person-header');
    await expect(header.getByText('In review', { exact: true }), 'the step is In review').toBeVisible();
    await expect(header.getByText('Verified', { exact: true }), 'and not Verified').toHaveCount(0);
  });

  test('AC-5 The newest read copy of each required type counts; an old row sent back does not block', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    // Finding 3 through HR's own steps: the ID is sent back, a new one comes in, HR accepts it.
    {
      const t = tablesOf([accepted(BANK, 1), waiting(ID, 2)]);
      const back = decide(t, 2, 'FAILED');
      expectNotVerified(back, 'DOCUMENTS_SUBMITTED', 'ID sent back');
      back.tables.documents.push(docRow(waiting(ID, 3)));
      expectVerified(accept(back.tables, 3), 'ID sent back, a newer ID accepted, bank accepted: Verified (finding 3)');
    }

    // The card's rule table, for each required type, run through the real Lambda: the rows of one type are
    // given (oldest first); the other required type is accepted last by HR.
    const H = '2026-11-12T10:00:00.000Z';
    const table: Array<[string, (type: string) => Doc[], boolean]> = [
      ['no row', () => [], false],
      ['only an upload link never used (PENDING)', (x) => [d(x, 'PENDING', { n: 10 })], false],
      ['MANUAL_REVIEW', (x) => [waiting(x, 10)], false],
      ['PASSED + hr_reviewed_at', (x) => [accepted(x, 10)], true],
      ['PASSED with no hr_reviewed_at (old auto-pass)', (x) => [d(x, 'PASSED', { n: 10 })], false],
      ['FAILED (new one asked), then PASSED + hr_reviewed_at', (x) => [sentBack(x, 10), accepted(x, 11)], true],
      ['FAILED not decided (could not be read), then PASSED + hr_reviewed_at', (x) => [d(x, 'FAILED', { n: 10 }), accepted(x, 11)], true],
      ['PASSED + hr_reviewed_at, then FAILED (sent back)', (x) => [accepted(x, 10), sentBack(x, 11)], false],
      ['PASSED + hr_reviewed_at, then MANUAL_REVIEW', (x) => [accepted(x, 10), waiting(x, 11)], false],
      ['PASSED + hr_reviewed_at, then PROCESSING', (x) => [accepted(x, 10), d(x, 'PROCESSING', { n: 11 })], false],
      ['PASSED + hr_reviewed_at, then PENDING', (x) => [accepted(x, 10), d(x, 'PENDING', { n: 11 })], true],
      ['an auto-passed copy, then PASSED + hr_reviewed_at', (x) => [d(x, 'PASSED', { n: 10 }), accepted(x, 11)], true],
      ['PASSED + hr_reviewed_at, then an auto-passed copy', (x) => [accepted(x, 10), d(x, 'PASSED', { n: 11 })], false],
      // Newest is the largest upload_timestamp, not the order of the rows or of the ids.
      ['sent back with the later upload_timestamp but the smaller id', (x) => [accepted(x, 11, ), { ...sentBack(x, 10), at: '2026-11-20T08:00:00.000Z' }], false],
      ['accepted with the later upload_timestamp but the smaller id', (x) => [sentBack(x, 11), { ...accepted(x, 10), at: '2026-11-20T08:00:00.000Z' }], true],
      // The order the rows come back in does not decide.
      ['rows given newest first: accepted, then an older one sent back', (x) => [accepted(x, 11), sentBack(x, 10)], true],
      ['rows given newest first: sent back, then an older one accepted', (x) => [sentBack(x, 11), accepted(x, 10)], false],
      // No upload_timestamp: the number in doc_<ms> decides.
      ['no timestamps: sent back, then a later doc_<ms> accepted', (x) => [{ ...sentBack(x, 10), at: null }, { ...accepted(x, 11), at: null }], true],
      ['no timestamps: accepted, then a later doc_<ms> sent back', (x) => [{ ...accepted(x, 10), at: null }, { ...sentBack(x, 11), at: null }], false],
      // Same upload_timestamp: the larger document_id is newer.
      ['same time: the larger id accepted', (x) => [{ ...sentBack(x, 10), at: H }, { ...accepted(x, 11), at: H }], true],
      ['same time: the larger id sent back', (x) => [{ ...accepted(x, 10), at: H }, { ...sentBack(x, 11), at: H }], false],
    ];
    for (const type of [ID, BANK]) {
      const other = type === ID ? BANK : ID;
      for (const [what, rows, done] of table) {
        const label = `${TYPE_NAME[type as DocumentType]}: ${what}; ${TYPE_NAME[other as DocumentType]} accepted last`;
        const run = accept(tablesOf([...rows(type), waiting(other, 30)]), 30);
        if (done) expectVerified(run, label);
        else {
          expectNotVerified(run, 'DOCUMENTS_SUBMITTED', label);
          expect(run.body?.required_missing, `${label}: required_missing`).toEqual([type]);
        }
      }
    }
  });

  test('AC-6 The employee page marks the required types "Required", from the answer only', async ({ page, signIn, hr, answers }) => {
    noBackendOnly();
    const cases: Array<[string, Required, string[]]> = [
      ['ID and bank required', BOTH, BOTH],
      ['only the ID required', [ID], [ID]],
      ['bank and tertiary required (the page hardcodes no type)', [BANK, TERTIARY], [BANK, TERTIARY]],
      ['no required_documents in the answer', 'left out', []],
      ['an empty list', [], []],
    ];
    const people = cases.map(([, required], i) => {
      const p = mixedPerson(['Zanele', 'Mpho', 'Nomsa', 'Tumelo', 'Karabo'][i]!);
      answers!.add(p, required);
      return p;
    });
    await openPerson(page, signIn, hr, people[0]!);
    for (const [i, [what, , want]] of cases.entries()) {
      if (i > 0) {
        await page.goto(personPath(people[i]!.employee.employee_id));
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(nameOf(people[i]!), { timeout: 20_000 });
      }
      await expectMarks(page, people[i]!, want, what);
    }

    // Everything uploaded, both required: every ID and bank card is marked.
    const all: FakePerson = {
      employee: storedEmployee({ first_name: 'Busisiwe', last_name: 'Ngcobo', stage: 'DOCUMENTS_SUBMITTED' }),
      documents: DOCUMENT_TYPES.map((t, i) => storedDocument({ document_type: t, ocr_status: 'MANUAL_REVIEW', uploaded_at: `2026-11-1${i}T08:00:00Z`, verification: { confidence: 70 } })),
    };
    answers!.add(all, BOTH);
    await page.goto(personPath(all.employee.employee_id));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(nameOf(all), { timeout: 20_000 });
    await expectMarks(page, all, BOTH, 'everything uploaded');

    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help} :: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    expect(bad, 'axe on the employee page with "Required" marks').toEqual([]);
  });

  test('AC-7 Phone: every heading, link, "Required" mark and button is visible, clear of the top bar, and nothing scrolls sideways', async ({ page, signIn, hr, answers }) => {
    noBackendOnly();
    const p = mixedPerson('Nokuthula-Precious');
    p.employee.last_name = 'Mahlangu-Vilakazi';
    p.documents.push(storedDocument({
      document_type: 'BANK_CONFIRMATION', file_name: 'first-national-bank-of-southern-africa-confirmation-of-account-details-2026-11.pdf',
      ocr_status: 'MANUAL_REVIEW', uploaded_at: '2026-11-12T08:00:00Z', verification: { confidence: 64 },
    }));
    answers!.add(p, BOTH);
    await openPerson(page, signIn, hr, p);
    await expectMarks(page, p, BOTH, 'phone check');
    const width = page.viewportSize()!.width;
    const marks = page.locator('main pp-lozenge', { hasText: /^\s*Required\s*$/ });
    await expect(marks, 'the three "Required" marks (two IDs, one bank letter)').toHaveCount(3);
    for (const m of await marks.all()) {
      const box = (await m.boundingBox())!;
      expect(box.x >= 0 && box.x + box.width <= width + 1, `a "Required" mark is inside the ${width} width`).toBe(true);
    }
    expect(await noSidewaysScroll(page), 'nothing scrolls sideways').toEqual([]);
    expect(await hiddenOrCovered(page), 'every heading, link, "Required" mark and button is visible and not under the top bar').toEqual([]);
  });

  test('AC-8 The API spec lists required_documents and required_missing, and says when all_documents_passed is true', async ({}, testInfo) => {
    lambdaOnce(testInfo);
    const get = openapiAnswer('/v1/employees/{id}/verifications', 'get', '200');
    expect(get.found, 'GET /v1/employees/{id}/verifications 200 is in api/openapi.yaml').toBe(true);
    const gr = get.properties['required_documents'];
    expect(gr, 'the GET answer lists required_documents').toBeTruthy();
    expect(gr!.type, 'required_documents is an array').toBe('array');
    expect(gr!.items_type, 'of strings').toBe('string');
    for (const k of ['employee', 'documents', 'summary']) expect(get.properties[k], `the GET answer still lists ${k}`).toBeTruthy();

    const patch = openapiAnswer('/v1/verifications/{id}/review', 'patch', '200');
    expect(patch.found, 'PATCH /v1/verifications/{id}/review 200 is in api/openapi.yaml').toBe(true);
    for (const k of ['required_documents', 'required_missing']) {
      const f = patch.properties[k];
      expect(f, `the PATCH answer lists ${k}`).toBeTruthy();
      expect(f!.type, `${k} is an array`).toBe('array');
      expect(f!.items_type, `${k} holds strings`).toBe('string');
    }
    for (const k of ['all_documents_passed', 'employee_stage_updated', 'hr_decision', 'hr_decided_at', 'hr_decided_by_name', 'hr_decision_reason']) {
      expect(patch.properties[k], `the PATCH answer still lists ${k}`).toBeTruthy();
    }
    const all = patch.properties['all_documents_passed']!.description;
    expect(all, 'all_documents_passed is described as every required document accepted').toMatch(/required/i);
    expect(all, 'and the description says HR accepted them').toMatch(/accept/i);
    expect(patch.description, 'the route no longer says Verified needs every document PASSED').not.toMatch(/if all documents are now PASSED/i);
  });

  test('AC-9 pepla-dev: the test employee is Verified only after both required documents are accepted @pepla-dev', async ({ page, signIn, hr, employee }, testInfo) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only: AC-2 and AC-4 hold the Lambda to this in the no-backend run.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once: it uploads documents and decides them.');
    test.setTimeout(300_000);

    const api = devDocumentApi();
    const empToken = await signInForToken(page, signIn, employee);
    const claims = JSON.parse(Buffer.from(empToken.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
    const employeeId = String(claims['custom:employee_id'] ?? DEV_EMPLOYEE_ID);
    const empAuth = { Authorization: `Bearer ${empToken}` };

    const stageNow = async (headers: Record<string, string>) => {
      const r = await page.request.get(`${api}/v1/employees/${encodeURIComponent(employeeId)}/verifications`, { headers });
      expect(r.status(), `the employee documents route answers (${r.status()})`).toBe(200);
      return ((await r.json()) as { employee: { stage: string } }).employee.stage;
    };
    expect(await stageNow(empAuth), 'the seed starts the test employee short of VERIFIED').not.toBe('VERIFIED');

    // The employee uploads a National ID and a Bank confirmation.
    const ids: Record<string, string> = {};
    for (const [type, file] of [[ID, 'onb08-id.pdf'], [BANK, 'onb08-bank.pdf']] as const) {
      const link = await page.request.post(`${api}/v1/employees/${encodeURIComponent(employeeId)}/documents/upload-url`, {
        headers: { ...empAuth, 'Content-Type': 'application/json' },
        data: { documentType: type, fileName: file, contentType: 'application/pdf' },
      });
      expect(link.status(), `the employee test login gets an upload link for the ${type}: ${await link.text()}`).toBe(200);
      const { url, document_id } = (await link.json()) as { url: string; document_id: string };
      const put = await page.request.put(url, { headers: { 'Content-Type': 'application/pdf' }, data: PDF });
      expect(put.ok(), `the ${type} PDF uploads (${put.status()})`).toBe(true);
      ids[type] = document_id;
    }

    await forgetSignIn(page); // ONB-23.1: the employee's session is kept, so it is forgotten before HR signs in
    const hrToken = await signInForToken(page, signIn, hr);
    const auth = { Authorization: `Bearer ${hrToken}` };

    // Both are read (not Being checked) within 90 seconds.
    await expect
      .poll(
        async () => {
          const r = await page.request.get(`${api}/v1/verifications?waiting=true`, { headers: auth });
          if (r.status() !== 200) return `HTTP ${r.status()}`;
          const items = ((await r.json()) as { items?: Array<{ document_id: string; check: string }> }).items ?? [];
          return [ID, BANK].map((t) => `${t}:${items.find((i) => i.document_id === ids[t])?.check ?? 'not listed'}`).join(' ');
        },
        { message: 'within 90 seconds the waiting list shows both uploads, read', timeout: 90_000, intervals: [3_000] },
      )
      .toMatch(/^NATIONAL_ID:(MATCHES|NEEDS_A_LOOK|DOESNT_MATCH) BANK_CONFIRMATION:(MATCHES|NEEDS_A_LOOK|DOESNT_MATCH)$/);

    const decideDev = async (type: string) => {
      const r = await page.request.patch(`${api}/v1/verifications/${encodeURIComponent(ids[type]!)}/review`, {
        headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        data: { decision: 'PASSED', employee_id: employeeId },
      });
      expect(r.status(), `HR accepts the ${type}: ${await r.text()}`).toBe(200);
      return (await r.json()) as { employee_stage_updated?: boolean; required_missing?: string[] };
    };

    const first = await decideDev(ID);
    expect(first.employee_stage_updated, 'after the ID: employee_stage_updated false').toBe(false);
    expect(await stageNow(auth), 'after the ID alone: not VERIFIED, still in review').toBe('DOCUMENTS_SUBMITTED');

    const second = await decideDev(BANK);
    expect(second.employee_stage_updated, 'after the bank letter: employee_stage_updated true').toBe(true);
    expect(await stageNow(auth), 'after the bank letter: VERIFIED').toBe('VERIFIED');
  });
});
