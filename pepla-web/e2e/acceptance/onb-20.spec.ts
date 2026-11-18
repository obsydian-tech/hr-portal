import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { ON_DEV, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { stripComments } from './support/infra-harness';
import { VERSION } from './support/onb-05/notice';
import { WaitingFake } from './support/onb-13/waiting-fake';
import { DOC_TYPES, entry, type DocState, type DocType, type ListAnswer, type MyDocumentsFake } from './support/onb-06/documents-fake';
import {
  LINDIWE,
  LINDIWE_ID,
  NOTICE_MODULE,
  OTHER_ID,
  T0,
  TEN_A,
  TEN_B,
  HR,
  consentRow,
  docRow,
  exportsOf,
  list,
  logLines,
  world,
  type Caller,
  type Run,
  type StoredDoc,
} from './support/onb-06/lambda-harness';
import { DocumentFake, type FakeDocument } from './support/onb-15/document-fake';
import { published, review } from './support/onb-15/lambda-harness';
import { rolePairsOf } from './support/onb-20/iam';
import {
  ACCOUNT_NUMBER,
  HR_EMAIL,
  ID_NUMBER,
  LOGIN_URL,
  NALEDI,
  REASON,
  TYPE_NAME,
  allText,
  askedDetail,
  bodyOf,
  deliverReviewed,
  shownFromHtml,
  squashWhite,
  subjectOf,
  tablesFor,
  type Type,
} from './support/onb-20/email';

/**
 * ONB-20 · A document sent back (Jira NH-176, epic NH-150). Amber.
 * One test per acceptance criterion (some criteria have several tests), written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-20.md (16 Nov 2026). Notes: ./cards/onb-20.md.
 *
 * Screens: the no-backend run answers GET /v1/me/documents and the upload link with ONB-06's documents fake
 * (support/onb-06/documents-fake.ts, on for every test), which hands over whatever fields the test gives it
 * (`returnedAt`, `returnedBy`, `reason` on a sent-back file). HR's page uses ONB-15's document fake.
 * Lambdas: the real getMyDocuments (ONB-06's harness), reviewDocumentVerification (ONB-15's) and
 * sendNotificationEmail (ONB-07's, with a recording Postmark) run against a fake AWS. Nothing is sent anywhere
 * and nothing here calls an AI service.
 *
 * Each screen test runs at 1280 and 390 wide unless it says why not. Lambda and text checks run once, at 1280.
 * No criterion runs on pepla-dev (as the card). Locked once accepted: see ./README.md.
 *
 * "Today" is fixed at 17 Nov 2026 in the screen tests, so a date in this year is "10 Nov" and one in another year
 * is "30 Dec 2025" (the kit's content rule), whenever the tests run.
 */

const HERE = __dirname;
const WEB = join(HERE, '..', '..');
const REPO = join(WEB, '..');
const rel = (f: string) => f.slice(REPO.length + 1);

// ---------------------------------------------------------------- the card's words (Iggie approved all, 16 Nov)
const HEADING = 'Upload your documents';
const WITH_HR = 'With HR';
const NEEDS = 'Needs a new copy';
const NAMES: Record<DocType, string> = {
  NATIONAL_ID: 'National ID',
  BANK_CONFIRMATION: 'Bank account confirmation letter',
  MATRIC_CERTIFICATE: 'Matric certificate',
  TERTIARY_QUALIFICATION: 'Tertiary qualifications',
};
/** W-1 and the kit: the button of a SENT-BACK row. Tertiary keeps ONB-06's words. */
const BUTTON: Record<DocType, string> = {
  NATIONAL_ID: 'Upload a new ID',
  BANK_CONFIRMATION: 'Upload a new letter',
  MATRIC_CERTIFICATE: 'Upload a new certificate',
  TERTIARY_QUALIFICATION: 'Upload qualification',
};
const SLUG: Record<DocType, string> = { NATIONAL_ID: 'national-id', BANK_CONFIRMATION: 'bank-letter', MATRIC_CERTIFICATE: 'matric', TERTIARY_QUALIFICATION: 'qualifications' };
const REQUIRED = 'Required';
const BACK = 'Back to your documents';
const TERTIARY_META = 'Degree, diploma or certificate. You can add more than one.';
const START = /\/start$/;
const MB = 1024 * 1024;
/** Today for the screen tests. */
const NOW = new Date('2026-11-17T08:00:00+02:00');

/** The reason in the kit's returned bank letter. */
const KIT_REASON = 'The letter is dated 2 Aug 2026. Upload one from the last 3 months.';

const noBackendOnly = () => test.skip(ON_DEV, 'No criterion of this card runs on pepla-dev.');
const onceOnly = (testInfo: TestInfo) => {
  test.skip(ON_DEV, 'Reads files and runs Lambdas: no-backend run only.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Reads files and runs Lambdas, not the screen: runs once, at one width.');
};

// ---------------------------------------------------------------- fixtures: ONB-15's HR page fakes, as onb-15.spec.ts sets them up

type Fixtures = { waiting: WaitingFake | null; one: DocumentFake | null };
const test = base.extend<Fixtures>({
  waiting: async ({ context, baseURL }, use) => {
    if (ON_DEV) return use(null);
    const fake = new WaitingFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
  // After the waiting fake, so /v1/verifications/<id> reaches this one (Playwright tries the last route first).
  one: async ({ context, baseURL, waiting }, use) => {
    void waiting;
    if (ON_DEV) return use(null);
    const fake = new DocumentFake(new URL(baseURL!).origin);
    await fake.install(context);
    await use(fake);
  },
});

// ---------------------------------------------------------------- the page, found by its words (as ONB-06's tests)

const welcome = (page: Page, name: string) => page.getByRole('heading', { name: `Welcome, ${name}`, exact: true });
const checklistHeading = (page: Page) => page.getByRole('heading', { name: HEADING, exact: true });
const row = (page: Page, type: DocType) => page.getByRole('listitem').filter({ has: page.getByText(NAMES[type], { exact: true }) });
const rowAction = (page: Page, type: DocType) => row(page, type).getByRole('button', { name: BUTTON[type], exact: true }).or(row(page, type).getByRole('link', { name: BUTTON[type], exact: true }));
const anyAction = (page: Page, type: DocType) => row(page, type).getByRole('button').or(row(page, type).getByRole('link'));
const lozenge = (page: Page, type: DocType, word: string) => row(page, type).getByText(word, { exact: true });
const fileInput = (page: Page) => page.locator('input[type="file"]');
const pageHeading = (page: Page, type: DocType) => page.getByRole('heading', { level: 1, name: NAMES[type], exact: true });
const backToDocuments = (page: Page) => page.getByRole('link', { name: BACK, exact: true }).or(page.getByRole('button', { name: BACK, exact: true }));
/** The innermost list item that holds a file name. */
const fileRow = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name }).last();
const sleep = (page: Page, ms: number) => page.waitForTimeout(ms);
const pdf = (name = 'new-copy.pdf', size = 2 * MB) => ({ name, mimeType: 'application/pdf', buffer: Buffer.alloc(size, 0x41) });

type Fx = { page: Page; signIn: SignInPage; employee: Login; me: import('./support/onb-05/me-fake').MeFake | null; myDocuments: MyDocumentsFake | null };

/** Signs the employee in, having accepted the current notice, with today fixed, and lands on Today. */
async function signInConsented({ page, signIn, employee, me, myDocuments }: Fx, answer: ListAnswer): Promise<MyDocumentsFake> {
  await page.clock.setFixedTime(NOW);
  me!.people.set(employee.email, { ...me!.defaultPerson(employee.givenName), consents: { [VERSION]: '2026-11-16T06:42:00.000Z' } });
  myDocuments!.answer = answer;
  await signIn.open();
  await signIn.signInAs(employee);
  await expect(page).toHaveURL(START, { timeout: 20_000 });
  await expect(welcome(page, employee.givenName)).toBeVisible();
  await expect(checklistHeading(page)).toBeVisible();
  return myDocuments!;
}

/** What the row says, with white space as single spaces. */
const rowText = async (page: Page, type: DocType) => squashWhite(await row(page, type).innerText());
/** The row's words with the known ones taken out: what is left must be nothing. */
async function leftover(page: Page, type: DocType, known: string[]): Promise<string> {
  let text = await rowText(page, type);
  for (const k of [...known].sort((a, b) => b.length - a.length)) text = text.split(k).join(' ');
  return squashWhite(text);
}

/** Opens an HR document straight from its address, signing in first when needed (as onb-15.spec.ts does). */
async function openDoc(page: Page, signIn: SignInPage, hr: Login, id: string): Promise<void> {
  const path = `/hr/documents/${encodeURIComponent(id)}`;
  await page.goto(path);
  await Promise.race([
    signIn.email.waitFor({ state: 'visible', timeout: 15_000 }).then(() => signIn.signInAs(hr)),
    page.getByRole('heading', { level: 1 }).filter({ hasNotText: 'Sign in' }).waitFor({ state: 'visible', timeout: 15_000 }),
  ]).catch(() => undefined);
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\?.*)?$`), { timeout: 20_000 });
}

// ---------------------------------------------------------------- made-up sent-back answers

type Sent = { fileName: string; uploadedAt: string; returnedAt?: string | null; returnedBy?: string | null; reason?: string | null };
const sentBack = (type: DocType, s: Sent) => entry(type, 'SENT_BACK', [{ ...s, state: 'SENT_BACK' as DocState }]);
const accepted = (type: DocType, fileName: string) => entry(type, 'ACCEPTED', [{ fileName, uploadedAt: '2026-11-02T08:00:00.000Z' }]);

/** The kit's returned bank letter, for the bank row. */
const KIT_BANK: Sent = { fileName: 'bank-letter.pdf', uploadedAt: '2026-11-10T06:00:00.000Z', returnedAt: '2026-11-10T08:00:00.000Z', returnedBy: 'Lerato Mokoena', reason: KIT_REASON };

// ---------------------------------------------------------------- Lambda helpers

let version: string | undefined;
const currentVersion = () => (version ??= String(exportsOf(NOTICE_MODULE)['CURRENT_NOTICE_VERSION']));
const T = (day: number, hour = '08') => `2026-11-${String(day).padStart(2, '0')}T${hour}:00:00.000Z`;
const consentNow = () => consentRow(LINDIWE_ID, currentVersion(), T0);
const worldWith = (docs: StoredDoc[]) => world({ consents: [consentNow()], docs: docs.map(docRow) });
const HR_NAME_AND_EMAIL = { hr_reviewed_by: 'lerato.mokoena@mokoena-logistics.co.za' };

/** A row HR sent back (FAILED), as reviewDocumentVerification leaves it, with the fields given. */
const sentRow = (id: string, type: string, uploaded: string, reviewed: string | undefined, extra: Record<string, string | undefined>): StoredDoc => ({
  id, type, status: 'FAILED', uploaded, started: uploaded, completed: uploaded, reviewed, extra: { ...HR_NAME_AND_EMAIL, ...extra },
});
/** A row waiting for HR. */
const waitingRow = (id: string, type: string, uploaded: string, extra: Record<string, string | undefined> = {}): StoredDoc => ({
  id, type, status: 'MANUAL_REVIEW', uploaded, started: uploaded, completed: uploaded, extra: { hr_reviewed_by: undefined, hr_decision_notes: undefined, ...extra },
});
const acceptedRow = (id: string, type: string, uploaded: string, reviewed: string, extra: Record<string, string | undefined> = {}): StoredDoc => ({
  id, type, status: 'PASSED', uploaded, started: uploaded, completed: uploaded, reviewed, extra: { ...HR_NAME_AND_EMAIL, ...extra },
});

type FileOut = Record<string, unknown> & { fileName: string; state: string };
type TypeOut = { type: string; required: boolean; state: string; files: FileOut[] } & Record<string, unknown>;
const typeOf = (run: Run, type: string): TypeOut => (run.body.documents as TypeOut[]).find((d) => d.type === type)!;

function expectStatus(run: Run, status: number, what: string): void {
  expect(run.error, `${what}: the handler threw ${run.error?.message}`).toBeUndefined();
  expect(run.status, `${what}: ${run.raw}`).toBe(status);
}

const SENT_BACK_ONLY = ['returnedAt', 'returnedBy', 'reason'];
const FILE_FIELDS = ['fileName', 'uploadedAt', 'state'];

// ---------------------------------------------------------------- the tests

test.describe('ONB-20 A document sent back', () => {
  // -------------------------------------------------------------- AC-1 (screen)
  test('AC-1 A sent-back document says "Needs a new copy", who returned it and when, HR\'s reason and the button with the words for its type', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const docs = await signInConsented({ page, signIn, employee, me, myDocuments }, {
      documents: [
        sentBack('NATIONAL_ID', { fileName: 'id-book.pdf', uploadedAt: '2025-12-28T08:00:00.000Z', returnedAt: '2025-12-30T10:00:00.000Z', returnedBy: 'Lerato Mokoena', reason: 'Page two of the ID book is cut off.' }),
        sentBack('BANK_CONFIRMATION', KIT_BANK),
        sentBack('MATRIC_CERTIFICATE', { fileName: 'matric.pdf', uploadedAt: '2026-11-05T08:00:00.000Z', returnedAt: '2026-11-11T08:00:00.000Z', returnedBy: null, reason: 'Please scan both sides.' }),
        sentBack('TERTIARY_QUALIFICATION', { fileName: 'bsc.pdf', uploadedAt: '2026-11-08T08:00:00.000Z', returnedAt: '2026-11-09T08:00:00.000Z', returnedBy: 'Lerato Mokoena', reason: 'The seal is missing.' }),
      ],
    });

    // The kit's returned bank letter, word for word (kit "Documents: checklist").
    await expect(lozenge(page, 'BANK_CONFIRMATION', NEEDS), 'bank letter: "Needs a new copy"').toBeVisible();
    await expect(row(page, 'BANK_CONFIRMATION').getByText('Uploaded 10 Nov 2026 · Returned by Lerato Mokoena, 10 Nov', { exact: true }), 'bank letter: "Uploaded 10 Nov 2026 · Returned by Lerato Mokoena, 10 Nov"').toBeVisible();
    await expect(row(page, 'BANK_CONFIRMATION').getByText(KIT_REASON, { exact: true }), 'bank letter: HR\'s reason').toBeVisible();
    await expect(row(page, 'BANK_CONFIRMATION').getByText(REQUIRED, { exact: true }), 'bank letter: still "Required"').toBeVisible();
    await expect(rowAction(page, 'BANK_CONFIRMATION'), 'bank letter: "Upload a new letter"').toBeVisible();
    await expect(anyAction(page, 'BANK_CONFIRMATION'), 'bank letter: one button, no other').toHaveCount(1);

    // W-1: the words of each type's button; a date in another year carries its year; a date in this year does not.
    await expect(lozenge(page, 'NATIONAL_ID', NEEDS)).toBeVisible();
    await expect(row(page, 'NATIONAL_ID').getByText('Uploaded 28 Dec 2025 · Returned by Lerato Mokoena, 30 Dec 2025', { exact: true }), 'ID: both dates in another year carry the year').toBeVisible();
    await expect(row(page, 'NATIONAL_ID').getByText('Page two of the ID book is cut off.', { exact: true })).toBeVisible();
    await expect(rowAction(page, 'NATIONAL_ID'), 'ID: "Upload a new ID"').toBeVisible();
    await expect(anyAction(page, 'NATIONAL_ID')).toHaveCount(1);

    // W-2: nobody recorded as the one who returned it.
    await expect(lozenge(page, 'MATRIC_CERTIFICATE', NEEDS)).toBeVisible();
    await expect(row(page, 'MATRIC_CERTIFICATE').getByText('Uploaded 5 Nov 2026 · Returned 11 Nov', { exact: true }), 'matric: no name, "Uploaded 5 Nov 2026 · Returned 11 Nov"').toBeVisible();
    await expect(row(page, 'MATRIC_CERTIFICATE').getByText('Please scan both sides.', { exact: true })).toBeVisible();
    await expect(rowAction(page, 'MATRIC_CERTIFICATE'), 'matric: "Upload a new certificate"').toBeVisible();
    await expect(anyAction(page, 'MATRIC_CERTIFICATE')).toHaveCount(1);

    // Tertiary keeps ONB-06's words and button.
    await expect(lozenge(page, 'TERTIARY_QUALIFICATION', NEEDS)).toBeVisible();
    await expect(row(page, 'TERTIARY_QUALIFICATION').getByText(TERTIARY_META, { exact: true }), 'tertiary keeps its own line').toBeVisible();
    await expect(rowAction(page, 'TERTIARY_QUALIFICATION'), 'tertiary: "Upload qualification"').toBeVisible();

    // Nothing leaks as a word: no "null", "undefined", "NaN" or "[object".
    const body = await page.locator('body').innerText();
    for (const bad of ['null', 'undefined', 'NaN', '[object', 'Invalid Date']) expect(body, `the page never says "${bad}"`).not.toContain(bad);
    expect(docs.gets(), 'one call for the list').toHaveLength(1);
    expect(docs.links(), 'looking asks for no upload link').toHaveLength(0);
  });

  test('AC-1 No name, no date or no reason: the approved words, and nothing in their place', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    await signInConsented({ page, signIn, employee, me, myDocuments }, {
      documents: [
        // W-4 and W-3: an old decision, no date, no name, no reason (all three are null).
        sentBack('NATIONAL_ID', { fileName: 'id-book.pdf', uploadedAt: '2025-12-28T08:00:00.000Z', returnedAt: null, returnedBy: null, reason: null }),
        // W-3: a name and a date, an empty reason. 11 Nov 00:30 in South Africa is 10 Nov 22:30 UTC.
        sentBack('BANK_CONFIRMATION', { fileName: 'bank-letter.pdf', uploadedAt: '2026-11-09T09:00:00.000Z', returnedAt: '2026-11-10T22:30:00.000Z', returnedBy: 'Lerato Mokoena', reason: '' }),
        // The three fields not in the answer at all (an answer from before this card): the same as null.
        sentBack('MATRIC_CERTIFICATE', { fileName: 'matric.pdf', uploadedAt: '2026-11-05T08:00:00.000Z' }),
        entry('TERTIARY_QUALIFICATION', 'NOT_UPLOADED'),
      ],
    });
    const nameAndMeta = (type: DocType, meta: string, required: boolean) => [NAMES[type], NEEDS, meta, BUTTON[type], ...(required ? [REQUIRED] : [])];

    // W-4: "Uploaded 28 Dec 2025" only; W-3: no reason line.
    await expect(row(page, 'NATIONAL_ID').getByText('Uploaded 28 Dec 2025', { exact: true }), 'ID: "Uploaded 28 Dec 2025" only (W-4)').toBeVisible();
    expect(await leftover(page, 'NATIONAL_ID', nameAndMeta('NATIONAL_ID', 'Uploaded 28 Dec 2025', true)), 'ID: nothing else in the row: no reason line, no "Returned"').toBe('');
    await expect(row(page, 'NATIONAL_ID').getByText(/Returned/), 'ID: no "Returned"').toHaveCount(0);

    // A name and a date: shown. The day is the day in South Africa. No reason line.
    await expect(row(page, 'BANK_CONFIRMATION').getByText('Uploaded 9 Nov 2026 · Returned by Lerato Mokoena, 11 Nov', { exact: true }), 'bank letter: the date is the day in South Africa (11 Nov)').toBeVisible();
    expect(await leftover(page, 'BANK_CONFIRMATION', nameAndMeta('BANK_CONFIRMATION', 'Uploaded 9 Nov 2026 · Returned by Lerato Mokoena, 11 Nov', true)), 'bank letter: an empty reason leaves no reason line').toBe('');

    // Fields missing from the answer: as null.
    await expect(row(page, 'MATRIC_CERTIFICATE').getByText('Uploaded 5 Nov 2026', { exact: true })).toBeVisible();
    expect(await leftover(page, 'MATRIC_CERTIFICATE', nameAndMeta('MATRIC_CERTIFICATE', 'Uploaded 5 Nov 2026', false)), 'matric: missing fields leave nothing in the row').toBe('');
    await expect(rowAction(page, 'MATRIC_CERTIFICATE'), 'matric: the upload button is still there').toBeVisible();
  });

  test('AC-1 HR\'s reason shows as the characters HR typed, never as HTML or a script', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const reason = '<b>Bold</b> and <script>window.__onb20 = "ran"</script> & <img src=x onerror="window.__onb20=\'ran\'">';
    await signInConsented({ page, signIn, employee, me, myDocuments }, {
      documents: [entry('NATIONAL_ID', 'NOT_UPLOADED'), sentBack('BANK_CONFIRMATION', { ...KIT_BANK, reason }), entry('MATRIC_CERTIFICATE', 'NOT_UPLOADED'), entry('TERTIARY_QUALIFICATION', 'NOT_UPLOADED')],
    });
    await expect(row(page, 'BANK_CONFIRMATION').getByText(reason, { exact: true }), 'the reason shows as typed, tags and all').toBeVisible();
    await expect(row(page, 'BANK_CONFIRMATION').locator('b, script, img[src="x"]'), 'no element was made from it').toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)['__onb20']), 'nothing in it ran').toBeUndefined();
    // HR's name goes in as text too.
    expect(await page.locator('body').innerHTML(), 'the raw reason is not in the page as markup').not.toContain('<script>window.__onb20');
  });

  test('AC-1 Qualifications: each sent-back file shows its own reason and who returned it, and no other file shows one', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    await signInConsented({ page, signIn, employee, me, myDocuments }, {
      documents: [
        entry('NATIONAL_ID', 'NOT_UPLOADED'),
        entry('BANK_CONFIRMATION', 'NOT_UPLOADED'),
        entry('MATRIC_CERTIFICATE', 'NOT_UPLOADED'),
        entry('TERTIARY_QUALIFICATION', 'WITH_HR', [
          { fileName: 'masters.pdf', uploadedAt: '2026-11-12T10:00:00.000Z', state: 'WITH_HR' },
          { fileName: 'bsc.pdf', uploadedAt: '2026-11-08T10:00:00.000Z', state: 'SENT_BACK', returnedAt: '2026-11-09T09:00:00.000Z', returnedBy: 'Lerato Mokoena', reason: 'The seal is missing.' },
          { fileName: 'diploma.jpg', uploadedAt: '2026-11-05T10:00:00.000Z', state: 'ACCEPTED' },
          { fileName: 'cert.png', uploadedAt: '2026-11-03T10:00:00.000Z', state: 'SENT_BACK', returnedAt: '2026-11-04T09:00:00.000Z', returnedBy: 'Thandi Nkosi', reason: 'The photo is blurred.' },
        ]),
      ],
    });
    await page.goto(`/start/documents/${SLUG.TERTIARY_QUALIFICATION}`);
    await expect(pageHeading(page, 'TERTIARY_QUALIFICATION')).toBeVisible();
    const text = async (name: string) => squashWhite(await fileRow(page, name).innerText());
    const bsc = await text('bsc.pdf');
    expect(bsc, 'bsc.pdf: its reason').toContain('The seal is missing.');
    expect(bsc, 'bsc.pdf: who returned it and when').toContain('Returned by Lerato Mokoena, 9 Nov');
    expect(bsc, 'bsc.pdf: not the other file\'s reason').not.toContain('The photo is blurred.');
    const cert = await text('cert.png');
    expect(cert, 'cert.png: its reason').toContain('The photo is blurred.');
    expect(cert, 'cert.png: who returned it and when').toContain('Returned by Thandi Nkosi, 4 Nov');
    expect(cert).not.toContain('The seal is missing.');
    for (const name of ['masters.pdf', 'diploma.jpg']) {
      const t = await text(name);
      expect(t, `${name}: no reason`).not.toMatch(/seal is missing|photo is blurred/);
      expect(t, `${name}: not returned`).not.toContain('Returned');
    }
  });

  // -------------------------------------------------------------- AC-1 and AC-2 (Lambda)
  test('AC-1 getMyDocuments: a sent-back file carries returnedAt, returnedBy and reason (trimmed), or null for each that is empty or missing', async ({}, testInfo) => {
    onceOnly(testInfo);
    const w = worldWith([
      sentRow('doc_1763000000001', 'NATIONAL_ID', T(10), T(11), { hr_reviewed_by_name: '  Lerato Mokoena  ', hr_decision_notes: `  ${KIT_REASON}  ` }),
      sentRow('doc_1763000000002', 'BANK_CONFIRMATION', T(10), T(11), { hr_reviewed_by_name: '', hr_decision_notes: '' }),
      sentRow('doc_1763000000003', 'MATRIC_CERTIFICATE', T(10), T(11), { hr_reviewed_by_name: '   ', hr_decision_notes: '   ' }),
      // Written by hand in the old app, or before names were kept: neither field on the row.
      sentRow('doc_1763000000004', 'TERTIARY_QUALIFICATION', T(8), T(9), { hr_reviewed_by_name: undefined, hr_decision_notes: undefined }),
      // A row sent back the old way: FAILED with no hr_reviewed_at at all.
      sentRow('doc_1763000000005', 'TERTIARY_QUALIFICATION', T(6), undefined, { hr_reviewed_by: undefined, hr_reviewed_by_name: undefined, hr_decision_notes: undefined }),
    ]);
    const run = list(w, LINDIWE);
    expectStatus(run, 200, 'the list');

    const id = typeOf(run, 'NATIONAL_ID');
    expect(id.state, 'ID: sent back').toBe('SENT_BACK');
    expect(id.files, 'ID: one file, with the three fields').toEqual([{ fileName: 'scan.pdf', uploadedAt: T(10), state: 'SENT_BACK', returnedAt: T(11), returnedBy: 'Lerato Mokoena', reason: KIT_REASON }]);

    for (const type of ['BANK_CONFIRMATION', 'MATRIC_CERTIFICATE']) {
      const f = typeOf(run, type).files[0]!;
      expect(f['returnedAt'], `${type}: returnedAt is the time HR decided`).toBe(T(11));
      expect(f['returnedBy'], `${type}: an empty name is null (the field is there)`).toBeNull();
      expect(f['reason'], `${type}: an empty reason is null (the field is there)`).toBeNull();
    }

    const tertiary = typeOf(run, 'TERTIARY_QUALIFICATION');
    expect(tertiary.files.map((f) => f['fileName']).length, 'two qualifications').toBe(2);
    const [newer, older] = tertiary.files;
    expect(newer!['returnedAt'], 'a missing name and reason: the time is still there').toBe(T(9));
    expect(newer!['returnedBy'], 'a missing name is null').toBeNull();
    expect(newer!['reason'], 'a missing reason is null').toBeNull();
    expect(older!['state'], 'the old-way FAILED row is sent back').toBe('SENT_BACK');
    expect(older!['returnedAt'], 'no hr_reviewed_at: returnedAt is null').toBeNull();
    expect(older!['returnedBy'], 'no hr_reviewed_at: returnedBy is null').toBeNull();
    expect(older!['reason'], 'no hr_reviewed_at: reason is null').toBeNull();
    expect(Object.keys(older!).sort(), 'the three fields are in the answer').toEqual([...FILE_FIELDS, ...SENT_BACK_ONLY].sort());
  });

  test('AC-2 getMyDocuments: a newer counted file makes the row "With HR" and the old one keeps its own reason; a newer link with no file leaves it sent back', async ({}, testInfo) => {
    onceOnly(testInfo);
    const OLD = sentRow('doc_1763000000001', 'BANK_CONFIRMATION', T(10), T(11), { hr_reviewed_by_name: 'Lerato Mokoena', hr_decision_notes: KIT_REASON });

    // A newer link was asked for and no file arrived: a PENDING row, not counted (ONB-06).
    const noFile: StoredDoc = { id: 'doc_1763000000002', type: 'BANK_CONFIRMATION', status: 'PENDING', uploaded: T(12) };
    const stillSent = typeOf(list(worldWith([OLD, noFile]), LINDIWE), 'BANK_CONFIRMATION');
    expect(stillSent.state, 'a link with no file leaves the row sent back').toBe('SENT_BACK');
    expect(stillSent.files, 'and the PENDING row is not a file').toHaveLength(1);
    expect(stillSent.files[0]!['reason'], 'with its reason').toBe(KIT_REASON);

    // The new file arrived (the row is being read): "With HR", with none of the three fields.
    const NEW = waitingRow('doc_1763000000003', 'BANK_CONFIRMATION', T(12));
    const replaced = typeOf(list(worldWith([OLD, noFile, NEW]), LINDIWE), 'BANK_CONFIRMATION');
    expect(replaced.state, 'a newer counted file: With HR').toBe('WITH_HR');
    expect(replaced.files.map((f) => f.state), 'newest first: the new file, then the old one').toEqual(['WITH_HR', 'SENT_BACK']);
    expect(Object.keys(replaced.files[0]!).sort(), 'the new file carries none of the three fields').toEqual([...FILE_FIELDS].sort());
    expect(replaced.files[1], 'the old file keeps its own').toMatchObject({ returnedBy: 'Lerato Mokoena', reason: KIT_REASON, returnedAt: T(11) });

    // Qualifications: every sent-back file keeps its own reason, whatever came after it.
    const tert = typeOf(list(worldWith([
      sentRow('doc_1763000000011', 'TERTIARY_QUALIFICATION', T(3), T(4), { hr_reviewed_by_name: 'Thandi Nkosi', hr_decision_notes: 'The photo is blurred.' }),
      acceptedRow('doc_1763000000012', 'TERTIARY_QUALIFICATION', T(5), T(6)),
      sentRow('doc_1763000000013', 'TERTIARY_QUALIFICATION', T(8), T(9), { hr_reviewed_by_name: 'Lerato Mokoena', hr_decision_notes: 'The seal is missing.' }),
      waitingRow('doc_1763000000014', 'TERTIARY_QUALIFICATION', T(12)),
    ]), LINDIWE), 'TERTIARY_QUALIFICATION');
    expect(tert.files.map((f) => f.state), 'four files, newest first').toEqual(['WITH_HR', 'SENT_BACK', 'ACCEPTED', 'SENT_BACK']);
    expect(tert.files[1], 'the second sent-back file: its own reason').toMatchObject({ returnedBy: 'Lerato Mokoena', reason: 'The seal is missing.', returnedAt: T(9) });
    expect(tert.files[3], 'the first sent-back file: its own reason').toMatchObject({ returnedBy: 'Thandi Nkosi', reason: 'The photo is blurred.', returnedAt: T(4) });
    for (const i of [0, 2]) expect(Object.keys(tert.files[i]!).sort(), `file ${i}: none of the three fields`).toEqual([...FILE_FIELDS].sort());
  });

  // -------------------------------------------------------------- AC-2 (screen)
  test('AC-2 "Upload a new letter" opens the upload page; a new file there brings back the row as "With HR", with no reason, no "Returned by" and no button, and no reload', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const docs = await signInConsented({ page, signIn, employee, me, myDocuments }, {
      documents: [entry('NATIONAL_ID', 'ACCEPTED', [{ fileName: 'id-book.pdf' }]), sentBack('BANK_CONFIRMATION', KIT_BANK), entry('MATRIC_CERTIFICATE', 'NOT_UPLOADED'), entry('TERTIARY_QUALIFICATION', 'NOT_UPLOADED')],
    });
    await page.evaluate(() => { (window as unknown as Record<string, unknown>)['__onb20'] = 'same page'; });
    await rowAction(page, 'BANK_CONFIRMATION').click();
    await expect(page, 'the button opens ONB-06\'s upload page for the type').toHaveURL(/\/start\/documents\/bank-letter$/);
    await expect(pageHeading(page, 'BANK_CONFIRMATION')).toBeVisible();

    await fileInput(page).setInputFiles(pdf('new-letter.pdf', 600_000));
    await expect.poll(() => docs.puts.length, { timeout: 15_000 }).toBe(1);
    expect(docs.issued[0]!.type, 'the link is for a bank confirmation').toBe('BANK_CONFIRMATION');
    await expect(fileRow(page, 'new-letter.pdf').getByText(WITH_HR, { exact: true }), 'the page shows the new file "With HR"').toBeVisible();

    await backToDocuments(page).click();
    await expect(page).toHaveURL(START);
    await expect(lozenge(page, 'BANK_CONFIRMATION', WITH_HR), 'the row is "With HR"').toBeVisible();
    await expect(lozenge(page, 'BANK_CONFIRMATION', NEEDS), 'no longer "Needs a new copy"').toHaveCount(0);
    const text = await rowText(page, 'BANK_CONFIRMATION');
    for (const gone of [KIT_REASON, 'Returned', 'Lerato Mokoena', BUTTON.BANK_CONFIRMATION]) expect(text, `the row no longer says "${gone}"`).not.toContain(gone);
    await expect(anyAction(page, 'BANK_CONFIRMATION'), 'no upload button while HR has it').toHaveCount(0);
    await expect(row(page, 'BANK_CONFIRMATION').getByText(/^Uploaded 17 Nov 2026/), 'the new upload\'s date').toBeVisible();
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>)['__onb20']), 'no reload: the page is the same page').toBe('same page');
  });

  test('AC-2 A link with no file leaves the row sent back, with its reason and its button', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const docs = await signInConsented({ page, signIn, employee, me, myDocuments }, {
      documents: [entry('NATIONAL_ID', 'NOT_UPLOADED'), sentBack('BANK_CONFIRMATION', KIT_BANK), entry('MATRIC_CERTIFICATE', 'NOT_UPLOADED'), entry('TERTIARY_QUALIFICATION', 'NOT_UPLOADED')],
    });
    await rowAction(page, 'BANK_CONFIRMATION').click();
    await expect(pageHeading(page, 'BANK_CONFIRMATION')).toBeVisible();
    docs.holdPuts = true; // the link is made, the file never lands
    await fileInput(page).setInputFiles(pdf('new-letter.pdf', 600_000));
    await expect.poll(() => docs.issued.length, { timeout: 15_000 }).toBe(1);
    await backToDocuments(page).click();
    await expect(page).toHaveURL(START);
    await expect(lozenge(page, 'BANK_CONFIRMATION', NEEDS), 'still "Needs a new copy"').toBeVisible();
    await expect(row(page, 'BANK_CONFIRMATION').getByText(KIT_REASON, { exact: true }), 'still HR\'s reason').toBeVisible();
    await expect(rowAction(page, 'BANK_CONFIRMATION'), 'still the button').toBeVisible();
    await expect(lozenge(page, 'BANK_CONFIRMATION', WITH_HR)).toHaveCount(0);
    docs.release();
    await sleep(page, 300);
  });

  // -------------------------------------------------------------- AC-3 and AC-4 (the email)
  test('AC-3 One email to the person: the approved subject and words for each type, the link, nothing else (no reason, no ID or account number, no HR email, no HR name)', async ({}, testInfo) => {
    onceOnly(testInfo);
    for (const type of Object.keys(TYPE_NAME) as Type[]) {
      const { run, sent } = deliverReviewed(tablesFor({ type }), askedDetail());
      expect(run.error, `${type}: sendNotificationEmail does not throw`).toBeUndefined();
      expect(sent, `${type}: exactly one email`).toHaveLength(1);
      const e = sent[0]!;
      expect(e.To, `${type}: to the person, and no one else`).toBe(NALEDI.email);
      expect(e.Cc ?? '', `${type}: no Cc`).toBe('');
      expect(e.Bcc ?? '', `${type}: no Bcc`).toBe('');
      expect(e.Subject, `${type}: the subject`).toBe(subjectOf(type));
      expect(squashWhite(String(e.TextBody)), `${type}: the text, word for word`).toBe(bodyOf(NALEDI.first, type));
      expect(shownFromHtml(String(e.HtmlBody)), `${type}: what the HTML shows, word for word`).toBe(bodyOf(NALEDI.first, type));
      expect(String(e.HtmlBody), `${type}: the link goes to the sign-in page`).toContain(`href="${LOGIN_URL}"`);
      const all = allText(e);
      for (const private_ of [ID_NUMBER, ID_NUMBER.slice(-4), ACCOUNT_NUMBER, HR_EMAIL, 'Thandi', 'jane.smith', 'Jane Smith', REASON, '2 Aug 2026', 'Checked by hand']) {
        expect(all, `${type}: the email never holds "${private_}"`).not.toContain(private_);
      }
    }
  });

  test('AC-3 With no reason, or a long one, it is still one email with the same words; the first name goes into the HTML as text', async ({}, testInfo) => {
    onceOnly(testInfo);
    for (const [what, notes] of [['no reason', ''], ['no notes at all', undefined], ['a 500-character reason', 'x'.repeat(500)]] as const) {
      const { sent } = deliverReviewed(tablesFor(), askedDetail('doc_1763800000001', { notes }));
      expect(sent, `${what}: one email`).toHaveLength(1);
      expect(squashWhite(String(sent[0]!.TextBody)), `${what}: the same words`).toBe(bodyOf(NALEDI.first, 'BANK_CONFIRMATION'));
      expect(allText(sent[0]!), `${what}: no reason in it`).not.toContain('xxxxxxxx');
    }
    // A first name with markup in it.
    const first = 'Na<b>le</b>&"di\'<script>window.x=1</script>';
    const { sent } = deliverReviewed(tablesFor({ employee: { first_name: first } }), askedDetail());
    expect(sent, 'one email').toHaveLength(1);
    const html = String(sent[0]!.HtmlBody);
    expect(html, 'no markup from the name').not.toMatch(/<script|<b>le/i);
    expect(shownFromHtml(html), 'the HTML shows the name as it was typed').toBe(bodyOf(first, 'BANK_CONFIRMATION'));
    expect(String(sent[0]!.Subject), 'the subject names the document, not the person').toBe(subjectOf('BANK_CONFIRMATION'));
  });

  test('AC-3 HR asks once: the PATCH publishes one event and the person gets one email; asking again gets 409, publishes nothing and so sends nothing', async ({}, testInfo) => {
    onceOnly(testInfo);
    const id = 'doc_1763800000001';
    const tables = tablesFor({ documentId: id });
    const HR_CALLER = { kind: 'jwt', email: HR_EMAIL, groups: ['hr_staff'], givenName: 'Thandi', familyName: 'Demo-HR' } as const;
    const first = review(tables, id, HR_CALLER, { decision: 'FAILED', notes: KIT_REASON, employee_id: NALEDI.id }, { 'idempotency-key': 'onb20-ask-1' });
    expect(first.status, `the first decision: ${first.raw}`).toBe(200);
    const events = published(first, 'document.reviewed');
    expect(events, 'one document.reviewed').toHaveLength(1);

    // The bus hands that event to sendNotificationEmail (infra/eventbridge.tf routes it; ONB-07 locks the rule).
    const one = deliverReviewed(first.tables, events[0]!.detail);
    expect(one.sent, 'one email for the decision').toHaveLength(1);
    expect(one.sent[0]!.To).toBe(NALEDI.email);
    expect(one.sent[0]!.Subject).toBe(subjectOf('BANK_CONFIRMATION'));

    // The same document again (a second click, another HR person): 409, nothing published, so nothing to send.
    const again = review(first.tables, id, HR_CALLER, { decision: 'FAILED', notes: 'Again', employee_id: NALEDI.id });
    expect(again.status, 'a second decision on the same document').toBe(409);
    expect(published(again), 'nothing published').toEqual([]);
    expect([...one.sent, ...published(again).map(() => 'another event')].length, 'one email for one decision, in all').toBe(1);
  });

  test('AC-3 The source of sendNotificationEmail never says "password", and the new Lambda code asks for no AI', async ({}, testInfo) => {
    onceOnly(testInfo);
    const src = readFileSync(join(REPO, 'lambda', 'sendNotificationEmail', 'index.mjs'), 'utf8');
    expect(src, 'sendNotificationEmail never mentions a password (ONB-04\'s check, kept)').not.toMatch(/password/i);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, 'and does not use the old words for this email').not.toMatch(/could not be accepted|please re-upload|Log in to re-upload/);
    expect(src, 'no AI client').not.toMatch(/(from|import)\s*\(?\s*['"`][^'"`]*(bedrock|textract|anthropic|openai)/i);
  });

  test('AC-4 Test logins never get a real email: FAILED and PASSED for a test employee make no Postmark call; a real person still gets one of each', async ({}, testInfo) => {
    onceOnly(testInfo);
    const robots = ['pepla-e2e-employee@blackhole.postmarkapp.com', 'Pepla-E2E-Employee@BlackHole.PostmarkApp.com', 'someone.else@blackhole.postmarkapp.com'];
    for (const email of robots) {
      for (const decision of ['FAILED', 'PASSED'] as const) {
        const { run, sent } = deliverReviewed(tablesFor({ employee: { email } }), askedDetail('doc_1763800000001', { decision, notes: decision === 'FAILED' ? REASON : '' }));
        expect(run.error, `${email} ${decision}: no error`).toBeUndefined();
        expect(sent, `${email} ${decision}: no Postmark call`).toEqual([]);
        expect(run.calls.filter((c) => c.service === 'postmark'), `${email} ${decision}: no call to Postmark at all`).toEqual([]);
      }
    }
    // Naledi is not a test login: ONB-07's locked check (onb-07.spec.ts AC-4) stays green, and so does this.
    for (const decision of ['PASSED', 'FAILED'] as const) {
      const { sent } = deliverReviewed(tablesFor(), askedDetail('doc_1763800000001', { decision, notes: '' }));
      expect(sent, `a real person: ${decision} sends one email`).toHaveLength(1);
      expect(sent[0]!.To).toBe(NALEDI.email);
    }
    // A look-alike address is not a test login.
    const alike = deliverReviewed(tablesFor({ employee: { email: 'naledi@blackhole.postmarkapp.com.example.co.za' } }), askedDetail());
    expect(alike.sent, 'an address that only contains the test domain is a real address').toHaveLength(1);
  });

  // -------------------------------------------------------------- AC-5
  test('AC-5 Phone: Today with a sent-back row fits 390 wide: every heading, the lozenge, the reason and the button are visible, nothing sits under the top bar, the button is at least 44 pixels tall', async ({ page, signIn, employee, me, myDocuments }, testInfo) => {
    noBackendOnly();
    test.skip(testInfo.project.name !== 'phone-390', 'The phone criterion: runs at 390 wide.');
    const long = `${KIT_REASON} ${'Please send a clearer copy where all four corners show and the stamp is readable. '.repeat(3)}`.trim();
    await signInConsented({ page, signIn, employee, me, myDocuments }, {
      documents: [
        sentBack('NATIONAL_ID', { fileName: 'id-book.pdf', uploadedAt: '2025-12-28T08:00:00.000Z', returnedAt: '2025-12-30T10:00:00.000Z', returnedBy: 'Lerato Mokoena-Van Der Merwe De Villiers', reason: 'Page two is cut off.' }),
        sentBack('BANK_CONFIRMATION', { ...KIT_BANK, reason: long }),
        sentBack('MATRIC_CERTIFICATE', { fileName: 'matric.pdf', uploadedAt: '2026-11-05T08:00:00.000Z', returnedAt: '2026-11-11T08:00:00.000Z', returnedBy: null, reason: 'Please scan both sides.' }),
        entry('TERTIARY_QUALIFICATION', 'NOT_UPLOADED'),
      ],
    });
    const viewport = page.viewportSize()!;
    const scroll = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    expect(scroll.doc, 'no sideways scroll').toBeLessThanOrEqual(scroll.win);

    const parts: Locator[] = [welcome(page, employee.givenName), checklistHeading(page)];
    const buttons: Locator[] = [];
    const rows: Array<[DocType, string, string]> = [
      ['NATIONAL_ID', 'Uploaded 28 Dec 2025 · Returned by Lerato Mokoena-Van Der Merwe De Villiers, 30 Dec 2025', 'Page two is cut off.'],
      ['BANK_CONFIRMATION', 'Uploaded 10 Nov 2026 · Returned by Lerato Mokoena, 10 Nov', long],
      ['MATRIC_CERTIFICATE', 'Uploaded 5 Nov 2026 · Returned 11 Nov', 'Please scan both sides.'],
    ];
    for (const [type, meta, reason] of rows) {
      parts.push(page.getByText(NAMES[type], { exact: true }), lozenge(page, type, NEEDS), row(page, type).getByText(meta, { exact: true }), row(page, type).getByText(reason, { exact: true }));
      buttons.push(rowAction(page, type));
    }
    for (const part of [...parts, ...buttons]) {
      await part.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await expect(part, 'visible').toBeVisible();
      const b = (await part.boundingBox())!;
      expect(b.x, 'left edge on screen').toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, 'right edge on screen').toBeLessThanOrEqual(viewport.width);
      expect(b.y, 'top on screen').toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, 'bottom on screen').toBeLessThanOrEqual(viewport.height);
      const onTop = await part.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 8));
        return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
      });
      expect(onTop, 'nothing sits on top of it (the top bar included)').toBe(true);
    }
    for (const b of buttons) expect((await b.boundingBox())!.height, 'button at least 44 pixels tall').toBeGreaterThanOrEqual(44);
    // The long reason is not cut off: its whole text is in the row.
    expect(await rowText(page, 'BANK_CONFIRMATION'), 'the whole long reason is in the row').toContain(squashWhite(long));
    const overflow = await row(page, 'BANK_CONFIRMATION').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflow, 'the row does not scroll sideways').toBe(false);
  });

  // -------------------------------------------------------------- AC-6
  test('AC-6 getMyDocuments: the three fields only on a sent-back file, only the person\'s own, and never HR\'s email, an id, an S3 key or another file\'s reason', async ({}, testInfo) => {
    onceOnly(testInfo);
    const HR_MAIL = 'lerato.mokoena@mokoena-logistics.co.za';
    const w = worldWith([
      sentRow('doc_1763000000001', 'NATIONAL_ID', T(10), T(11), { hr_reviewed_by_name: 'Lerato Mokoena', hr_decision_notes: KIT_REASON, hr_reviewed_by: HR_MAIL }),
      // HR with no names in the token: the stored name is the email (ONB-15). It is never given to the person.
      sentRow('doc_1763000000002', 'BANK_CONFIRMATION', T(10), T(11), { hr_reviewed_by_name: 'people-team@kestrel-foods.co.za', hr_reviewed_by: 'people-team@kestrel-foods.co.za', hr_decision_notes: 'Too early.' }),
      // Notes left on rows that are not sent back must not come out.
      acceptedRow('doc_1763000000003', 'MATRIC_CERTIFICATE', T(10), T(11), { hr_reviewed_by_name: 'Lerato Mokoena', hr_decision_notes: 'Looks fine to me', hr_reviewed_by: HR_MAIL }),
      waitingRow('doc_1763000000004', 'TERTIARY_QUALIFICATION', T(12), { hr_decision_notes: 'A note from an earlier decision', hr_reviewed_by_name: 'Lerato Mokoena', hr_reviewed_by: HR_MAIL }),
    ]);
    const run = list(w, LINDIWE);
    expectStatus(run, 200, 'the list');

    for (const t of run.body.documents as TypeOut[]) {
      expect(Object.keys(t).sort(), `${t.type}: only type, required, state, files`).toEqual(['files', 'required', 'state', 'type']);
      for (const f of t.files) {
        const keys = Object.keys(f);
        expect(keys.filter((k) => ![...FILE_FIELDS, ...SENT_BACK_ONLY].includes(k)), `${t.type}/${f.fileName}: no field outside the list`).toEqual([]);
        if (f.state === 'SENT_BACK') expect(keys.sort(), `${t.type}: a sent-back file has all three`).toEqual([...FILE_FIELDS, ...SENT_BACK_ONLY].sort());
        else expect(keys.filter((k) => SENT_BACK_ONLY.includes(k)), `${t.type}: a ${f.state} file has none of the three`).toEqual([]);
      }
    }
    expect(typeOf(run, 'NATIONAL_ID').files[0], 'the person gets HR\'s name, the time and the reason').toMatchObject({ returnedBy: 'Lerato Mokoena', returnedAt: T(11), reason: KIT_REASON });
    expect(typeOf(run, 'BANK_CONFIRMATION').files[0]!['returnedBy'], 'a name that is an email address is not given: null').toBeNull();
    expect(typeOf(run, 'BANK_CONFIRMATION').files[0]!['reason'], 'its reason is').toBe('Too early.');

    const raw = run.raw;
    for (const never of [HR_MAIL, 'people-team@kestrel-foods.co.za', '@', 'hr_reviewed_by', 'hr_decision_notes', 'hr_reviewed_at', 'Looks fine to me', 'A note from an earlier decision',
      'uploads/', 's3_key', 'ver-doc_', 'verification_id', 'confidence', '0.9731', 'check_reasoning', '9506145009087', LINDIWE_ID, 'doc_17630000000', OTHER_ID, 'tenant_id', TEN_A]) {
      expect(raw, `the answer never holds "${never}"`).not.toContain(never);
    }
    const logs = logLines(run).map((l) => `${l.message} ${JSON.stringify(l.extra ?? '')}`).join('\n') + '\n' + run.output;
    for (const s of [KIT_REASON, 'Too early.', 'Lerato Mokoena', HR_MAIL, 'people-team@']) expect(logs, `the logs never hold "${s}"`).not.toContain(s);

    // HTML typed by HR comes back as typed: the server does not change it; the screen shows it as text.
    const typed = '<b>x</b> & "y"';
    const html = typeOf(list(worldWith([sentRow('doc_1763000000001', 'NATIONAL_ID', T(10), T(11), { hr_reviewed_by_name: 'Lerato Mokoena', hr_decision_notes: typed })]), LINDIWE), 'NATIONAL_ID');
    expect(html.files[0]!['reason'], 'the reason is as stored').toBe(typed);
  });

  test('AC-6 Only the person sees it: another employee, another company and HR get none of it, and ONB-06\'s refusals are unchanged', async ({}, testInfo) => {
    onceOnly(testInfo);
    const w = worldWith([sentRow('doc_1763000000001', 'NATIONAL_ID', T(10), T(11), { hr_reviewed_by_name: 'Lerato Mokoena', hr_decision_notes: KIT_REASON })]);
    // The person themselves.
    expect(list(w, LINDIWE).raw, 'the person: sees the reason').toContain(KIT_REASON);
    // Another employee of the same company: their own list, none of Lindiwe's.
    const kagiso: Caller = { ...LINDIWE, email: 'kagiso.molefe@x.co.za', sub: 'kagiso-sub', givenName: 'Kagiso', familyName: 'Molefe' };
    const theirs = list(w, kagiso);
    expect(theirs.status, `Kagiso's list: ${theirs.raw}`).toBe(200);
    for (const s of [KIT_REASON, 'Lerato Mokoena', 'returnedAt']) expect(theirs.raw, `Kagiso never gets "${s}"`).not.toContain(s);
    // Another company: the person's row is not theirs.
    const other = list(w, LINDIWE, { tenant: TEN_B });
    expect(other.status, 'a token from company B: 404').toBe(404);
    expect(other.raw, 'and not a word of it').not.toContain(KIT_REASON);
    // HR, and an employee-looking token for HR's group: 403 and nothing read.
    for (const [what, caller] of [['HR', HR], ['HR with the employee\'s email', { ...HR, email: LINDIWE.email }]] as const) {
      const run = list(w, caller);
      expect(run.status, `${what}: 403`).toBe(403);
      expect(run.raw, `${what}: none of it`).not.toContain(KIT_REASON);
    }
    expect(list(w, { kind: 'none' }).status, 'no sign-in: refused').toBeGreaterThanOrEqual(400);
  });

  // -------------------------------------------------------------- AC-7
  test('AC-7 Keyboard: Tab reaches the sent-back row\'s button and Enter opens the upload page', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    await signInConsented({ page, signIn, employee, me, myDocuments }, {
      documents: [accepted('NATIONAL_ID', 'id-book.pdf'), sentBack('BANK_CONFIRMATION', KIT_BANK), entry('MATRIC_CERTIFICATE', 'NOT_UPLOADED'), entry('TERTIARY_QUALIFICATION', 'NOT_UPLOADED')],
    });
    const focused = async (target: Locator) => target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement));
    let reached = false;
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await focused(rowAction(page, 'BANK_CONFIRMATION'));
    }
    expect(reached, 'Tab reaches "Upload a new letter"').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page, 'Enter opens the bank letter page').toHaveURL(/\/start\/documents\/bank-letter$/);
    await expect(pageHeading(page, 'BANK_CONFIRMATION')).toBeVisible();
  });

  test('AC-7 Screen reader: the reason and who returned it are in the row\'s text, not hidden from assistive technology, and axe finds nothing serious', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    await signInConsented({ page, signIn, employee, me, myDocuments }, {
      documents: [accepted('NATIONAL_ID', 'id-book.pdf'), sentBack('BANK_CONFIRMATION', KIT_BANK), sentBack('MATRIC_CERTIFICATE', { fileName: 'matric.pdf', uploadedAt: '2026-11-05T08:00:00.000Z', returnedAt: null, returnedBy: null, reason: null }), entry('TERTIARY_QUALIFICATION', 'NOT_UPLOADED')],
    });
    const reason = row(page, 'BANK_CONFIRMATION').getByText(KIT_REASON, { exact: true });
    await expect(reason, 'the reason is on the page').toBeVisible();
    for (const text of [KIT_REASON, 'Uploaded 10 Nov 2026 · Returned by Lerato Mokoena, 10 Nov']) {
      const el = row(page, 'BANK_CONFIRMATION').getByText(text, { exact: true });
      const hidden = await el.evaluate((node) => !!node.closest('[aria-hidden="true"], [hidden], [inert]') || getComputedStyle(node).visibility === 'hidden');
      expect(hidden, `"${text}" is not hidden from a screen reader`).toBe(false);
    }
    // The row reads as one item: its name, its state, why and what to do.
    const spoken = await rowText(page, 'BANK_CONFIRMATION');
    for (const part of [NAMES.BANK_CONFIRMATION, NEEDS, 'Returned by Lerato Mokoena', KIT_REASON, BUTTON.BANK_CONFIRMATION]) expect(spoken, `the row's text holds "${part}"`).toContain(part);
    await expect(row(page, 'BANK_CONFIRMATION'), 'the row is a list item').toHaveCount(1);

    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help} :: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
    expect(bad, 'axe: no serious or critical issue on Today with a sent-back row').toEqual([]);
    await expect(page.getByRole('heading', { level: 1 }), 'one level-one heading').toHaveCount(1);
  });

  // -------------------------------------------------------------- AC-8
  test('AC-8 HR\'s page: "Ask for a new one" shows "{First name} sees this reason." with the employee\'s first name, and "Kept with the decision." is gone', async ({ page, signIn, hr, one }) => {
    noBackendOnly();
    const doc = (id: string, first: string, last: string): FakeDocument => ({
      document_id: id,
      employee: { employee_id: `EMP-${id.slice(-4)}`, first_name: first, last_name: last, id_number_last4: '0876' },
      document_type: 'BANK_CONFIRMATION',
      file_name: 'bank-letter.pdf',
      uploaded_at: '2026-11-04T08:00:00Z',
      ocr_status: 'MANUAL_REVIEW',
      ocr_completed_at: '2026-11-04T08:02:00Z',
      verification: { confidence: 72, check: 'NEEDS_A_LOOK', read: { account_holder: 'MS N DLAMINI', bank_name: 'Ubuntu Mutual Bank', account_number: '62845519023', branch_code: '250655', account_type: 'Cheque' }, reasoning: 'A bank letter.', checks: {} },
    });
    const a = doc('doc_1763800000101', 'Naledi', 'Dlamini');
    const b = doc('doc_1763800000102', 'Pieter', 'van Wyk');
    one!.add(a, b);
    const main = page.locator('main');
    for (const [d, first] of [[a, 'Naledi'], [b, 'Pieter']] as const) {
      await openDoc(page, signIn, hr, d.document_id);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(`${first}`, { timeout: 20_000 });
      await main.getByRole('button', { name: 'Ask for a new one', exact: true }).first().click();
      await expect(main.getByRole('textbox', { name: 'Reason', exact: true }), 'the Reason field opens').toBeVisible();
      await expect(main.getByText(`${first} sees this reason.`, { exact: true }), `the hint "${first} sees this reason."`).toBeVisible();
      await expect(page.getByText('Kept with the decision.'), '"Kept with the decision." is nowhere').toHaveCount(0);
      expect(await page.locator('body').innerText(), 'not on the page in any form').not.toContain('Kept with the decision');
    }
  });

  test('AC-8 Nothing else moves: the two Lambdas are as they were; no new route; no new IAM action on the four roles; the robot check comes before any send', async ({}, testInfo) => {
    onceOnly(testInfo);
    const pinned = JSON.parse(readFileSync(join(HERE, 'support', 'onb-20', 'unchanged-08f2aa0.json'), 'utf8')) as { files: Record<string, string>; routes: string[] };
    for (const [file, sha] of Object.entries(pinned.files)) {
      expect(createHash('sha256').update(readFileSync(join(REPO, file))).digest('hex'), `${file} is unchanged (reviewDocumentVerification and generateDocumentUploadUrl stay as they are)`).toBe(sha);
    }

    // No new route about documents or decisions.
    const infra = join(REPO, 'infra');
    const keys = readdirSync(infra).filter((f) => f.endsWith('.tf')).flatMap((f) => [...stripComments(readFileSync(join(infra, f), 'utf8')).matchAll(/route_key\s*=\s*"([^"]+)"/g)].map((m) => m[1]!));
    const mine = [...new Set(keys.filter((k) => /document|verification|reason|sent-?back|returned/i.test(k)))].sort();
    expect(mine, 'no route was added or changed for documents, verifications or decisions').toEqual([...pinned.routes].sort());

    // No new IAM action: the roles of the four Lambdas are as they were.
    const was = JSON.parse(readFileSync(join(HERE, 'support', 'onb-20', 'iam-08f2aa0.json'), 'utf8')) as Record<string, string[]>;
    for (const fn of Object.keys(was)) {
      const now = rolePairsOf(fn);
      expect(now.found, `${fn}: its Lambda and role are in Terraform`).toBe(true);
      expect(now.pairs.filter((p) => !was[fn]!.includes(p)), `${fn}: no new IAM line`).toEqual([]);
      expect(was[fn]!.filter((p) => !now.pairs.includes(p)), `${fn}: no IAM line taken away`).toEqual([]);
    }

    // The robot check is the first thing handleDocumentReviewed does with the person, before any send.
    const src = readFileSync(join(REPO, 'lambda', 'sendNotificationEmail', 'index.mjs'), 'utf8');
    const start = src.indexOf('async function handleDocumentReviewed(');
    expect(start, 'handleDocumentReviewed is in sendNotificationEmail').toBeGreaterThan(-1);
    let depth = 0;
    let end = -1;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++;
      if (src[i] === '}' && --depth === 0) { end = i; break; }
    }
    const body = src.slice(start, end + 1);
    const robot = body.indexOf('isRobotEmail(');
    const send = body.indexOf('sendEmail(');
    expect(robot, 'handleDocumentReviewed calls isRobotEmail').toBeGreaterThan(-1);
    expect(send, 'handleDocumentReviewed sends').toBeGreaterThan(-1);
    expect(robot, 'the test-login check comes before any send (PASSED and FAILED alike)').toBeLessThan(send);
    expect(body.slice(0, robot), 'and not inside one of the two decisions').not.toMatch(/case\s+'(PASSED|FAILED)'/);
  });

  test('AC-8 The words and the parts: no "Masked", "Work email" or "password" in the changed files, only pp-* on screens, no paid AI anywhere', async ({}, testInfo) => {
    onceOnly(testInfo);
    const files = [
      'pepla-web/src/app/features/start/documents-checklist.ts',
      'pepla-web/src/app/features/start/document-upload.page.ts',
      'pepla-web/src/app/features/start/document-types.ts',
      'pepla-web/src/app/core/start/my-documents.service.ts',
      'pepla-web/src/app/features/hr/document.page.ts',
      'lambda/getMyDocuments/index.mjs',
      'lambda/sendNotificationEmail/index.mjs',
    ];
    for (const f of files) {
      expect(existsSync(join(REPO, f)), `${f} exists`).toBe(true);
      const text = readFileSync(join(REPO, f), 'utf8');
      expect(text, `${f}: never "Masked"`).not.toMatch(/\bmasked\b/i);
      expect(text, `${f}: never "Work email"`).not.toMatch(/work email/i);
      expect(text, `${f}: never "password"`).not.toMatch(/password/i);
      expect(text, `${f}: imports no AI client`).not.toMatch(/(from|import)\s*\(?\s*['"`][^'"`]*(bedrock|textract|anthropic|openai)/i);
    }
    expect(readFileSync(join(REPO, 'pepla-web/src/app/features/hr/document.page.ts'), 'utf8'), 'HR\'s page has the new hint').toContain('sees this reason.');
    expect(readFileSync(join(REPO, 'pepla-web/src/app/features/hr/document.page.ts'), 'utf8'), 'and not the old one').not.toContain('Kept with the decision');
    try {
      execFileSync('node', ['scripts/verify-design.mjs'], { cwd: WEB, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      throw new Error(`verify:design failed:\n${err.stdout ?? ''}${err.stderr ?? ''}`);
    }
  });
});
