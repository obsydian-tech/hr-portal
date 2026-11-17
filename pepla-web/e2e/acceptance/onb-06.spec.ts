import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { blocks, stripComments, tfFiles } from './support/infra-harness';
import { ON_DEV, expect, expectAnnounced, test as base, type Login, type SignInPage } from './support/fixtures';
import { VERSION } from './support/onb-05/notice';
import { policyOf, resourcesNamed } from './support/onb-15/tf-policy';
import {
  CONSENT_FIRST,
  DOC_TYPES,
  LIMIT_BYTES,
  MISSING,
  NOT_EMPLOYEE,
  NOT_FOUND,
  entry,
  listOf,
  type DocState,
  type DocType,
  type ListAnswer,
  type MyDocumentsFake,
} from './support/onb-06/documents-fake';
import {
  CREATE_LINK,
  GET_DOCS,
  HR,
  LINDIWE,
  LINDIWE_ID,
  NOTICE_MODULE,
  OTHER_ID,
  T0,
  TEN_A,
  TEN_B,
  UPLOAD_LINK_MODULE,
  consentRow,
  docRow,
  documentRows,
  dynamoCalls,
  exportsOf,
  list,
  logLines,
  makeLink,
  noAwsCalls,
  presigns,
  s3Calls,
  storedEmployee,
  world,
  writes,
  type Caller,
  type Run,
  type StoredDoc,
} from './support/onb-06/lambda-harness';
import { forgetSignIn } from './support/sign-in-again';

/**
 * ONB-06 · Phone: documents and upload (Jira NH-175, epic NH-150). Red.
 * One test per acceptance criterion (some criteria have several tests), written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-06.md (NH-175). Notes: ./cards/onb-06.md.
 *
 * Screens: the no-backend run answers GET /v1/me/documents, POST /v1/me/documents/upload-url and the S3 PUT with
 * support/onb-06/documents-fake.ts (on for every test, support/fixtures.ts). Lambdas: the real
 * lambda/getMyDocuments and lambda/createMyUploadLink run against a fake AWS (support/onb-06/fake-aws).
 *
 * Each screen test runs at 1280 and 390 wide unless it says why not. Lambda and text checks run once, at 1280.
 * AC-11 runs on pepla-dev. Nothing here calls an AI service. Locked once accepted: see ./README.md.
 */

const HERE = __dirname;
const WEB = join(HERE, '..', '..');
const REPO = join(WEB, '..');

// ---------------------------------------------------------------- the card's words (Iggie approved all, 16 Nov)
const HEADING = 'Upload your documents';
const SUBTITLE = 'Batsi reads your ID and bank letter. HR decides every document.';
const COMPLETE = 'Complete';
const COUNT = (n: number) => `${n} of 4 complete`;
const REQUIRED = 'Required';
const TERTIARY_META = 'Degree, diploma or certificate. You can add more than one.';
const STATE_WORD: Record<DocState, string> = { NOT_UPLOADED: 'Not uploaded yet', WITH_HR: 'With HR', SENT_BACK: 'Needs a new copy', ACCEPTED: 'Accepted' };
const NAMES: Record<DocType, string> = {
  NATIONAL_ID: 'National ID',
  BANK_CONFIRMATION: 'Bank account confirmation letter',
  MATRIC_CERTIFICATE: 'Matric certificate',
  TERTIARY_QUALIFICATION: 'Tertiary qualifications',
};
const BUTTON: Record<DocType, string> = {
  NATIONAL_ID: 'Upload ID',
  BANK_CONFIRMATION: 'Upload bank letter',
  MATRIC_CERTIFICATE: 'Upload matric',
  TERTIARY_QUALIFICATION: 'Upload qualification',
};
const SLUG: Record<DocType, string> = { NATIONAL_ID: 'national-id', BANK_CONFIRMATION: 'bank-letter', MATRIC_CERTIFICATE: 'matric', TERTIARY_QUALIFICATION: 'qualifications' };
const DESCRIPTION: Record<DocType, string> = {
  NATIONAL_ID: 'Your South African ID book or card.',
  BANK_CONFIRMATION: 'A letter from your bank confirming your account, from the last 3 months.',
  MATRIC_CERTIFICATE: 'Your matric certificate.',
  TERTIARY_QUALIFICATION: 'Your degree, diploma or professional certificate. HR checks it by hand.',
};
const YOUR_DOCUMENTS = 'Your documents';
const ADD_A_FILE = 'Add a file';
const DROP = /Drag your file here, or\s*choose a file/;
const CHOOSE = 'Take a photo or choose a file';
const HINT = 'PDF, JPG or PNG, up to 10 MB. A phone photo is fine if all four corners show.';
const BAD_FILE = "This file can't be used. Use a PDF, JPG or PNG up to 10 MB.";
const NOTE = 'Files upload as soon as you pick them.';
const BACK = 'Back to your documents';
const OFFLINE = "We can't reach Naleko People. Check your connection and try again.";
const TRY_AGAIN = 'Try again';
const UPLOADING = /^Uploading, \d+(\.\d+)? of \d+(\.\d+)? MB$/;

const START = /\/start$/;
const MB = 1024 * 1024;
// "10 MB" is read as 10 MiB or as 10 million bytes by different people. The tests stay clear of the gap between
// the two (10,000,000 to 10,485,760 bytes): a file of 9.9 million bytes is within the limit either way, one of 10.5
// million is over it either way.
const FITS = 9_900_000;
const TOO_BIG = 10_500_000;

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: AC-11 is the pepla-dev check.');
const onceOnly = (testInfo: TestInfo) => {
  test.skip(ON_DEV, 'Reads files and runs Lambdas: no-backend run only.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Reads files and runs Lambdas, not the screen: runs once, at one width.');
};

const test = base;

// ---------------------------------------------------------------- the page, found by its words

const welcome = (page: Page, name: string) => page.getByRole('heading', { name: `Welcome, ${name}`, exact: true });
const checklistHeading = (page: Page) => page.getByRole('heading', { name: HEADING, exact: true });
const row = (page: Page, type: DocType) => page.getByRole('listitem').filter({ has: page.getByText(NAMES[type], { exact: true }) });
/** The row's button, found by its words (a link that looks like a button counts). */
const rowAction = (page: Page, type: DocType) => row(page, type).getByRole('button', { name: BUTTON[type], exact: true }).or(row(page, type).getByRole('link', { name: BUTTON[type], exact: true }));
const anyAction = (page: Page, type: DocType) => row(page, type).getByRole('button').or(row(page, type).getByRole('link'));
const lozenge = (page: Page, type: DocType, state: DocState) => row(page, type).getByText(STATE_WORD[state], { exact: true });
const fileInput = (page: Page) => page.locator('input[type="file"]');
const pageHeading = (page: Page, type: DocType) => page.getByRole('heading', { level: 1, name: NAMES[type], exact: true });
const backToDocuments = (page: Page) => page.getByRole('link', { name: BACK, exact: true }).or(page.getByRole('button', { name: BACK, exact: true }));
const fileRow = (page: Page, name: string) => page.getByRole('listitem').filter({ hasText: name });
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });
const sleep = (page: Page, ms: number) => page.waitForTimeout(ms);

const upload = (name: string, mimeType: string, size: number) => ({ name, mimeType, buffer: Buffer.alloc(size, 0x41) });
const pdf = (name = 'scan.pdf', size = 2 * MB) => upload(name, 'application/pdf', size);

const ACCEPTED_AT = '2026-11-16T06:42:00.000Z';
const JWT = /^Bearer (eyJ[\w-]+)\.(eyJ[\w-]+)\.[\w-]*$/;

type Fx = { page: Page; signIn: SignInPage; employee: Login; me: import('./support/onb-05/me-fake').MeFake | null; myDocuments: MyDocumentsFake | null };

/** Signs the employee in, having accepted the current notice, and lands on Today. */
async function signInConsented({ page, signIn, employee, me, myDocuments }: Fx, answer?: ListAnswer): Promise<MyDocumentsFake> {
  me!.people.set(employee.email, { ...me!.defaultPerson(employee.givenName), consents: { [VERSION]: ACCEPTED_AT } });
  if (answer) myDocuments!.answer = answer;
  await signIn.open();
  await signIn.signInAs(employee);
  await expect(page).toHaveURL(START, { timeout: 20_000 });
  await expect(welcome(page, employee.givenName)).toBeVisible();
  return myDocuments!;
}

/** From Today, opens one type's upload page with its row button. */
async function openFromToday(page: Page, type: DocType): Promise<void> {
  await expect(checklistHeading(page)).toBeVisible();
  await rowAction(page, type).click();
  await expect(page).toHaveURL(new RegExp(`/start/documents/${SLUG[type]}$`));
  await expect(pageHeading(page, type)).toBeVisible();
}

const openUploadPage = async (page: Page, type: DocType) => {
  await page.goto(`/start/documents/${SLUG[type]}`);
  await expect(pageHeading(page, type)).toBeVisible();
};

// ---------------------------------------------------------------- Lambda helpers

const EMPLOYEE_ONLY = { error: NOT_EMPLOYEE };
const NO_RECORD = { error: NOT_FOUND };

let version: string | undefined;
/** The version privacy-notice.mjs serves now. A polished notice is a new version, so these tests follow it. */
function currentVersion(): string {
  version ??= String(exportsOf(NOTICE_MODULE)['CURRENT_NOTICE_VERSION']);
  return version;
}
const consentNow = () => consentRow(LINDIWE_ID, currentVersion(), T0);
const worldWith = (docs: StoredDoc[] = [], consent = true) => world({ consents: consent ? [consentNow()] : [], docs: docs.map(docRow) });

function expectStatus(run: Run, status: number, what: string): void {
  expect(run.error, `${what}: the handler threw ${run.error?.message}`).toBeUndefined();
  expect(run.status, `${what}: ${run.raw}`).toBe(status);
}

/** Every string anywhere in a value. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => (out.push(k), strings(x, out)));
  return out;
}

const NO_GROUP: Caller = { kind: 'jwt', email: LINDIWE.email, groups: [], sub: LINDIWE.sub };
const CONTRACTOR: Caller = { kind: 'jwt', email: LINDIWE.email, groups: ['contractor'], sub: LINDIWE.sub };
const NEAR_MISS: Caller = { kind: 'jwt', email: LINDIWE.email, groups: ['employees', 'new-employee'], sub: LINDIWE.sub };
const HR_WITH_EMAIL: Caller = { ...HR, email: LINDIWE.email };
const WHO_IS_REFUSED: Array<[string, Caller]> = [
  ['no claims', { kind: 'none' }],
  ['an HR token', HR],
  ['an HR token carrying the employee\'s email', HR_WITH_EMAIL],
  ['a token in no group', NO_GROUP],
  ['a token in another group (contractor)', CONTRACTOR],
  ['a token in groups whose names only contain "employee"', NEAR_MISS],
];
const GOOD_BODY = { documentType: 'MATRIC_CERTIFICATE', fileName: 'matric.pdf', contentType: 'application/pdf', fileSize: 120_000 };

/** What the OCR Lambda (processDocumentOCR) reads out of the S3 key: employee, type, document id. */
function ocrParse(key: string): { parts: string[]; employeeId: string; type: string; documentId: string } {
  const parts = key.split('/');
  return { parts, employeeId: parts[1]!, type: parts[2]!, documentId: parts[3]!.split('_')[1]! };
}

// ---------------------------------------------------------------- the tests

test.describe('ONB-06 Documents and upload', () => {
  // -------------------------------------------------------------- AC-1
  test('AC-1 After consent Today lists the four documents in order, with each one\'s state, "Required" on two, and the count', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const docs = await signInConsented(fx, {
      documents: [
        entry('NATIONAL_ID', 'ACCEPTED', [{ fileName: 'id-book.pdf', uploadedAt: '2026-11-10T08:15:00.000Z' }]),
        entry('BANK_CONFIRMATION', 'SENT_BACK', [{ fileName: 'bank-letter.pdf', uploadedAt: '2026-11-09T09:00:00.000Z' }]),
        entry('MATRIC_CERTIFICATE', 'WITH_HR', [{ fileName: 'matric.pdf', uploadedAt: '2026-11-12T16:40:00.000Z' }]),
        entry('TERTIARY_QUALIFICATION', 'NOT_UPLOADED'),
      ],
    });
    await expect(checklistHeading(page)).toBeVisible();
    await expect(page.getByText(SUBTITLE, { exact: true }), 'the subtitle').toBeVisible();
    await expect(page.getByText(COMPLETE, { exact: true }), '"Complete" on the progress bar').toBeVisible();
    await expect(page.getByText(COUNT(1), { exact: true }), '1 of 4 complete: only the accepted one counts').toBeVisible();

    // The four rows, in order, with the kit's names.
    const ys: number[] = [];
    for (const type of DOC_TYPES) {
      await expect(row(page, type), `a row for ${NAMES[type]}`).toHaveCount(1);
      ys.push((await row(page, type).boundingBox())!.y);
    }
    expect(ys, 'National ID, bank letter, matric, tertiary: top to bottom').toEqual([...ys].sort((a, b) => a - b));

    // Required on the first two only.
    for (const type of DOC_TYPES) {
      await expect(row(page, type).getByText(REQUIRED, { exact: true }), `${NAMES[type]}: "Required"`).toHaveCount(type === 'NATIONAL_ID' || type === 'BANK_CONFIRMATION' ? 1 : 0);
    }
    // Each state in words, and the date in the kit's format (10 Nov 2026 is 10:15 in Johannesburg).
    await expect(lozenge(page, 'NATIONAL_ID', 'ACCEPTED')).toBeVisible();
    await expect(lozenge(page, 'BANK_CONFIRMATION', 'SENT_BACK')).toBeVisible();
    await expect(lozenge(page, 'MATRIC_CERTIFICATE', 'WITH_HR')).toBeVisible();
    await expect(lozenge(page, 'TERTIARY_QUALIFICATION', 'NOT_UPLOADED')).toBeVisible();
    await expect(row(page, 'NATIONAL_ID').getByText(/Uploaded 10 Nov 2026/)).toBeVisible();
    await expect(row(page, 'BANK_CONFIRMATION').getByText(/Uploaded 9 Nov 2026/)).toBeVisible();
    await expect(row(page, 'MATRIC_CERTIFICATE').getByText(/Uploaded 12 Nov 2026/)).toBeVisible();
    await expect(row(page, 'TERTIARY_QUALIFICATION').getByText(TERTIARY_META, { exact: true })).toBeVisible();
    await expect(row(page, 'TERTIARY_QUALIFICATION').getByText(/Uploaded/), 'nothing uploaded, no date').toHaveCount(0);

    // Buttons: none on a row HR has or is deciding on (accepted, with HR), one on a sent-back row, always one on tertiary.
    await expect(anyAction(page, 'NATIONAL_ID'), 'accepted: no button').toHaveCount(0);
    await expect(anyAction(page, 'MATRIC_CERTIFICATE'), 'with HR: no button').toHaveCount(0);
    await expect(rowAction(page, 'BANK_CONFIRMATION'), 'sent back: "Upload bank letter"').toBeVisible();
    await expect(rowAction(page, 'TERTIARY_QUALIFICATION'), 'tertiary: "Upload qualification"').toBeVisible();

    // One call for the list, nothing else; the sidebar has no Documents item (ONB-19 adds the items).
    expect(docs.gets(), 'one GET /v1/me/documents when Today loads').toHaveLength(1);
    expect(docs.gets()[0]!.headers['authorization'], 'the call carries the sign-in token').toMatch(JWT);
    expect(docs.links(), 'no link is asked for by looking').toHaveLength(0);
    expect(docs.puts).toHaveLength(0);
    await expect(sidebar(page).getByRole('link', { name: 'Documents', exact: true }), 'the sidebar has no Documents item').toHaveCount(0);
  });

  test('AC-1 Nothing uploaded: four "Not uploaded yet", four buttons with their words, "0 of 4 complete"; all accepted: "4 of 4 complete" and no button but the tertiary one', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const docs = await signInConsented(fx);
    await expect(checklistHeading(page)).toBeVisible();
    await expect(page.getByText(COUNT(0), { exact: true })).toBeVisible();
    for (const type of DOC_TYPES) {
      await expect(lozenge(page, type, 'NOT_UPLOADED'), `${NAMES[type]}: "Not uploaded yet"`).toBeVisible();
      await expect(rowAction(page, type), `${NAMES[type]}: "${BUTTON[type]}"`).toBeVisible();
    }
    // The page asks again when it is opened again, and shows what the server says.
    docs.answer = listOf({ NATIONAL_ID: 'ACCEPTED', BANK_CONFIRMATION: 'ACCEPTED', MATRIC_CERTIFICATE: 'ACCEPTED', TERTIARY_QUALIFICATION: 'ACCEPTED' });
    await page.reload();
    await expect(page.getByText(COUNT(4), { exact: true })).toBeVisible();
    for (const type of DOC_TYPES) await expect(lozenge(page, type, 'ACCEPTED')).toBeVisible();
    for (const type of ['NATIONAL_ID', 'BANK_CONFIRMATION', 'MATRIC_CERTIFICATE'] as const) await expect(anyAction(page, type), `${NAMES[type]}: accepted, no button`).toHaveCount(0);
    await expect(rowAction(page, 'TERTIARY_QUALIFICATION'), 'more qualifications can always be added').toBeVisible();
  });

  test('AC-1 Before the notice is accepted there is no documents call and nothing to upload; accepting brings the checklist, with one call', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const docs = myDocuments!;
    await signIn.open();
    await signIn.signInAs(employee);
    await expect(page).toHaveURL(START, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Declaration and consent', exact: true })).toBeVisible();
    await sleep(page, 700);
    expect(docs.seen(), 'no documents call before the notice is accepted').toEqual([]);
    await expect(checklistHeading(page)).toHaveCount(0);
    await expect(fileInput(page)).toHaveCount(0);
    for (const type of DOC_TYPES) await expect(page.getByText(BUTTON[type], { exact: true })).toHaveCount(0);

    await page.getByRole('checkbox', { name: /^I have read and agree to the declaration above/ }).check();
    await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
    await expect(checklistHeading(page), 'right after Accept the checklist shows').toBeVisible();
    await expect(page.getByText(COUNT(0), { exact: true })).toBeVisible();
    expect(docs.gets(), 'one call for the list after Accept').toHaveLength(1);
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 The upload page for each type: the title, breadcrumb, description, the picker with its words, the hint and the note; an unknown type goes to Today', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    await signInConsented(fx);
    for (const type of DOC_TYPES) {
      await openUploadPage(page, type);
      await expect(page, `${NAMES[type]}: the tab title`).toHaveTitle(`${NAMES[type]} · Naleko People`);
      await expect(page.getByRole('link', { name: YOUR_DOCUMENTS, exact: true }), 'breadcrumb "Your documents"').toHaveAttribute('href', /^\/start\/?$/);
      await expect(page.getByText(DESCRIPTION[type], { exact: true }), `${NAMES[type]}: its description`).toBeVisible();
      await expect(page.getByText(ADD_A_FILE, { exact: true }), '"Add a file"').toBeVisible();
      await expect(page.getByText(DROP), 'the drop words').toBeVisible();
      await expect(page.getByText(CHOOSE, { exact: true }), 'the picker button').toBeVisible();
      await expect(page.getByText(HINT, { exact: true }), 'the hint, 10 MB').toBeVisible();
      await expect(page.getByText(NOTE, { exact: true }), 'the note').toBeVisible();
      await expect(backToDocuments(page)).toBeVisible();
      const input = fileInput(page);
      await expect(input, 'one file input').toHaveCount(1);
      const accept = ((await input.getAttribute('accept')) ?? '').toLowerCase().split(',').map((a) => a.trim()).sort();
      expect(accept, 'accepts PDF, JPG, JPEG and PNG, and nothing else').toEqual(['.jpeg', '.jpg', '.pdf', '.png']);
      expect(await input.getAttribute('capture'), 'no capture attribute: the phone offers the camera or the files').toBeNull();
      expect(await page.locator('[capture]').count(), 'no capture attribute anywhere').toBe(0);
    }
    // "Back to your documents" and the breadcrumb both lead to Today.
    await backToDocuments(page).click();
    await expect(page).toHaveURL(START);
    await expect(checklistHeading(page)).toBeVisible();
    await openUploadPage(page, 'MATRIC_CERTIFICATE');
    await page.getByRole('link', { name: YOUR_DOCUMENTS, exact: true }).click();
    await expect(page).toHaveURL(START);

    // Not a document type this page knows: back to Today.
    for (const bad of ['passport', 'national_id', 'NATIONAL_ID', '..']) {
      await page.goto(`/start/documents/${bad}`);
      await expect(page, `/start/documents/${bad} lands on /start`).toHaveURL(START);
      await expect(welcome(page, fx.employee.givenName)).toBeVisible();
    }
  });

  test('AC-2 A JPEG, a PNG and a PDF within the limit each send one link request and one PUT, with the file as it is', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const docs = await signInConsented(fx);
    await openFromToday(page, 'TERTIARY_QUALIFICATION');
    const files = [pdf('degree.pdf', 2 * MB), upload('diploma photo.jpg', 'image/jpeg', 1_500_000), upload('certificate.png', 'image/png', 900_000), upload('almost-ten.pdf', 'application/pdf', FITS)];
    for (const [i, f] of files.entries()) {
      await fileInput(page).setInputFiles(f);
      await expect.poll(() => docs.puts.length, { message: `${f.name}: one PUT`, timeout: 15_000 }).toBe(i + 1);
      expect(docs.links(), `${f.name}: one link request, not more`).toHaveLength(i + 1);
      const link = docs.links()[i]!;
      expect(link.body, `${f.name}: the request names the type, the file, its content type and its size, and nothing else`).toEqual({
        documentType: 'TERTIARY_QUALIFICATION',
        fileName: f.name,
        contentType: f.mimeType,
        fileSize: f.buffer.length,
      });
      const put = docs.puts[i]!;
      expect(put.url, `${f.name}: the PUT goes to the link, as it was handed over`).toBe(docs.issued[i]!.url);
      expect(put.headers['content-type'], `${f.name}: the PUT's Content-Type is the one in the link`).toBe(f.mimeType);
      expect(put.body.equals(f.buffer), `${f.name}: the body is the file, byte for byte`).toBe(true);
      await expect(fileRow(page, f.name).getByText('With HR', { exact: true }), `${f.name}: With HR`).toBeVisible();
    }
  });

  test('AC-2 Each type\'s own button uploads into that type, from Today and back', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const docs = await signInConsented(fx);
    for (const [i, type] of DOC_TYPES.entries()) {
      await openFromToday(page, type);
      await fileInput(page).setInputFiles(pdf(`${SLUG[type]}.pdf`, 300_000));
      await expect.poll(() => docs.puts.length, { timeout: 15_000 }).toBe(i + 1);
      expect((docs.links()[i]!.body as { documentType: string }).documentType, `${NAMES[type]}: the request names its own type`).toBe(type);
      await expect(fileRow(page, `${SLUG[type]}.pdf`).getByText('With HR', { exact: true })).toBeVisible();
      await backToDocuments(page).click();
      await expect(page).toHaveURL(START);
      await expect(lozenge(page, type, 'WITH_HR'), `${NAMES[type]}: With HR on Today`).toBeVisible();
    }
    expect(docs.links()).toHaveLength(4);
    expect(docs.puts).toHaveLength(4);
  });

  test('AC-2 A file over the limit, an empty file, a .heic, a .docx and a .txt each say what is allowed and send nothing', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const docs = await signInConsented(fx);
    await openFromToday(page, 'MATRIC_CERTIFICATE');
    const bad = [
      upload('huge.pdf', 'application/pdf', TOO_BIG),
      upload('huge-photo.jpg', 'image/jpeg', 12 * MB),
      upload('empty.pdf', 'application/pdf', 0),
      upload('photo.heic', 'image/heic', 1 * MB),
      upload('letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 200_000),
      upload('notes.txt', 'text/plain', 2_000),
    ];
    for (const f of bad) {
      await fileInput(page).setInputFiles(f);
      await expect(page.getByText(BAD_FILE, { exact: true }), `${f.name}: "${BAD_FILE}"`).toBeVisible();
      await sleep(page, 400);
      expect(docs.links(), `${f.name}: no link request`).toHaveLength(0);
      expect(docs.puts, `${f.name}: nothing sent to S3`).toHaveLength(0);
      await expect(page.getByText('With HR', { exact: true }), `${f.name}: nothing is With HR`).toHaveCount(0);
    }
    // The limit is the same for every type, and a good file still goes after the bad ones.
    await fileInput(page).setInputFiles(pdf('matric.pdf', 500_000));
    await expect.poll(() => docs.puts.length, { timeout: 15_000 }).toBe(1);
    expect(docs.links()).toHaveLength(1);
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 After the PUT the file shows "With HR" from the 2xx alone, and it is announced', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const docs = await signInConsented(fx);
    docs.autoRecord = false; // the server's list is not what shows it: the page saw the PUT succeed
    await openFromToday(page, 'MATRIC_CERTIFICATE');
    await fileInput(page).setInputFiles(pdf('matric.pdf', 400_000));
    await expect(fileRow(page, 'matric.pdf').getByText('With HR', { exact: true })).toBeVisible();
    await expect.poll(async () => page.getByRole('status').filter({ hasText: 'With HR' }).count(), { message: '"With HR" is announced (role=status)' }).toBeGreaterThan(0);
    expect(docs.puts).toHaveLength(1);
  });

  test('AC-3 On return the row on Today shows "With HR" with no reload and no button; the other rows are as they were', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const docs = await signInConsented(fx, listOf({ NATIONAL_ID: 'ACCEPTED' }));
    await openFromToday(page, 'MATRIC_CERTIFICATE');
    await page.evaluate(() => ((window as unknown as { __onb06?: number }).__onb06 = 1));
    await fileInput(page).setInputFiles(pdf('matric.pdf', 400_000));
    await expect(fileRow(page, 'matric.pdf').getByText('With HR', { exact: true })).toBeVisible();
    await backToDocuments(page).click();
    await expect(page).toHaveURL(START);
    expect(await page.evaluate(() => (window as unknown as { __onb06?: number }).__onb06), 'the page was not reloaded').toBe(1);
    await expect(lozenge(page, 'MATRIC_CERTIFICATE', 'WITH_HR')).toBeVisible();
    await expect(anyAction(page, 'MATRIC_CERTIFICATE'), 'With HR: no upload button').toHaveCount(0);
    await expect(lozenge(page, 'NATIONAL_ID', 'ACCEPTED')).toBeVisible();
    await expect(lozenge(page, 'BANK_CONFIRMATION', 'NOT_UPLOADED')).toBeVisible();
    await expect(page.getByText(COUNT(1), { exact: true }), 'only an accepted document counts as complete').toBeVisible();
    expect(docs.puts).toHaveLength(1);
  });

  test('AC-3 While a file uploads the row shows its progress and a Cancel; cancelling stops the upload and nothing shows With HR', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const docs = await signInConsented(fx);
    docs.autoRecord = false;
    await openFromToday(page, 'TERTIARY_QUALIFICATION');
    docs.holdPuts = true;
    await fileInput(page).setInputFiles(pdf('degree.pdf', 3 * MB));
    await expect.poll(() => docs.puts.length, { timeout: 15_000 }).toBe(1);
    const mine = fileRow(page, 'degree.pdf');
    await expect(mine.getByText(UPLOADING), 'Uploading, x of y MB').toBeVisible();
    await expect(mine.getByText('With HR', { exact: true }), 'not With HR while it uploads').toHaveCount(0);
    await expect(page.getByRole('progressbar', { name: /degree\.pdf/ }), 'a progress bar named for the file').toBeVisible();
    await page.getByRole('button', { name: 'Cancel upload of degree.pdf', exact: true }).click();
    await expect(mine, 'the cancelled file leaves the list').toHaveCount(0);
    docs.release();
    await sleep(page, 600);
    await expect(page.getByText('With HR', { exact: true }), 'a cancelled file never shows With HR').toHaveCount(0);
    expect(docs.puts, 'cancelling does not send it again').toHaveLength(1);
  });

  test('AC-3 A single-document type shows its newest file only, tertiary shows all, each with its state in words', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    await signInConsented(fx, {
      documents: [
        entry('NATIONAL_ID', 'NOT_UPLOADED'),
        entry('BANK_CONFIRMATION', 'NOT_UPLOADED'),
        {
          ...entry('MATRIC_CERTIFICATE', 'WITH_HR', [{ fileName: 'matric-new.pdf', uploadedAt: '2026-11-12T10:00:00.000Z', state: 'WITH_HR' }, { fileName: 'matric-old.pdf', uploadedAt: '2026-11-05T10:00:00.000Z', state: 'SENT_BACK' }]),
        },
        entry('TERTIARY_QUALIFICATION', 'WITH_HR', [
          { fileName: 'bsc.pdf', uploadedAt: '2026-11-12T10:00:00.000Z', state: 'WITH_HR' },
          { fileName: 'diploma.jpg', uploadedAt: '2026-11-08T10:00:00.000Z', state: 'ACCEPTED' },
          { fileName: 'cert.png', uploadedAt: '2026-11-03T10:00:00.000Z', state: 'SENT_BACK' },
        ]),
      ],
    });
    await openUploadPage(page, 'MATRIC_CERTIFICATE');
    await expect(fileRow(page, 'matric-new.pdf').getByText('With HR', { exact: true })).toBeVisible();
    await expect(page.getByText('matric-old.pdf'), 'only the newest file of a single-document type').toHaveCount(0);
    await openUploadPage(page, 'TERTIARY_QUALIFICATION');
    await expect(fileRow(page, 'bsc.pdf').getByText(STATE_WORD.WITH_HR, { exact: true })).toBeVisible();
    await expect(fileRow(page, 'diploma.jpg').getByText(STATE_WORD.ACCEPTED, { exact: true })).toBeVisible();
    await expect(fileRow(page, 'cert.png').getByText(STATE_WORD.SENT_BACK, { exact: true })).toBeVisible();
  });

  // -------------------------------------------------------------- AC-5 (screen)
  test('AC-5 The link request carries the sign-in token and nothing else new; the PUT carries no token, no cookie and no header but Content-Type', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const docs = await signInConsented(fx);
    await openFromToday(page, 'BANK_CONFIRMATION');
    await fileInput(page).setInputFiles(pdf('bank-letter.pdf', 600_000));
    await expect.poll(() => docs.puts.length, { timeout: 15_000 }).toBe(1);
    await expect(fileRow(page, 'bank-letter.pdf').getByText('With HR', { exact: true })).toBeVisible();

    const link = docs.links()[0]!;
    const token = JWT.exec(link.headers['authorization'] ?? '');
    expect(token, 'the link request carries Authorization: Bearer <token>').toBeTruthy();
    expect(link.headers['content-type'] ?? '', 'sent as JSON').toMatch(/^application\/json/);

    const put = docs.puts[0]!;
    const sent = Object.keys(put.headers);
    expect(sent, 'no Authorization header on the PUT').not.toContain('authorization');
    expect(sent, 'no cookie on the PUT').not.toContain('cookie');
    expect(sent.filter((h) => /^(x-|idempotency)/.test(h)), 'no other custom header on the PUT').toEqual([]);
    // Playwright answers a routed request itself and hands the test no preflight, so any that does show is checked,
    // and the PUT's own headers (above) are what prove nothing but Content-Type goes.
    const s3Preflights = docs.preflights.filter((p) => p.kind === 's3');
    for (const p of s3Preflights) {
      const asked = p.requestHeaders.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
      expect(asked.filter((h) => h !== 'content-type'), 'the PUT asks for no header but content-type').toEqual([]);
    }
    const everything = [put.url, ...Object.values(put.headers)].join('\n') + put.body.toString('latin1').slice(0, 2000);
    expect(everything, 'no part of the token reaches S3').not.toContain(token![2]!);
    // No new request header on the API either: the employees API allows authorization and content-type (LESSONS, NH-187).
    for (const p of docs.preflights.filter((x) => x.kind === 'api')) {
      const asked = p.requestHeaders.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
      expect(asked.filter((h) => !['authorization', 'content-type'].includes(h)), `${p.path}: no header the API does not allow`).toEqual([]);
    }
  });

  // -------------------------------------------------------------- AC-7
  test('AC-7 403, 404 and 400 from the link request show the server\'s words and send no file', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const docs = await signInConsented(fx);
    const cases: Array<[number, string]> = [[403, CONSENT_FIRST], [404, NOT_FOUND], [400, MISSING], [400, 'Unsupported content type. Allowed: application/pdf, image/jpeg, image/png']];
    for (const [i, [status, words]] of cases.entries()) {
      await openUploadPage(page, 'MATRIC_CERTIFICATE');
      docs.nextLinks.push({ status, body: { error: words } });
      const before = docs.links().length;
      await fileInput(page).setInputFiles(pdf(`try-${i}.pdf`, 200_000));
      await expect(page.getByText(words, { exact: true }), `${status}: the server's words`).toBeVisible();
      expect(docs.links().length, 'one link request').toBe(before + 1);
      await expect(page.getByText(OFFLINE, { exact: true }), `${status}: not the connection words`).toHaveCount(0);
    }
    expect(docs.puts, 'no file went to S3').toHaveLength(0);
  });

  test('AC-7 An S3 refusal, an S3 5xx, no answer from S3, a 5xx from the API and no answer from the API say the connection words with Try again', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const docs = await signInConsented(fx);
    const cases: Array<[string, () => void]> = [
      ['S3 refuses (403)', () => docs.nextPuts.push({ status: 403, body: '<Error><Code>AccessDenied</Code></Error>' })],
      ['S3 answers 503', () => docs.nextPuts.push({ status: 503 })],
      ['S3 gives no answer', () => docs.nextPuts.push('offline')],
      ['the API answers 500', () => docs.nextLinks.push({ status: 500, body: { error: 'Internal server error' } })],
      ['the API gives no answer', () => docs.nextLinks.push('offline')],
    ];
    for (const [i, [what, arm]] of cases.entries()) {
      await openUploadPage(page, 'MATRIC_CERTIFICATE');
      arm();
      await fileInput(page).setInputFiles(pdf(`fail-${i}.pdf`, 200_000));
      await expect(page.getByText(OFFLINE, { exact: true }), `${what}: the connection words`).toBeVisible();
      await expect(page.getByRole('button', { name: TRY_AGAIN, exact: true }), `${what}: Try again`).toBeVisible();
      await expect(page.getByText('With HR', { exact: true }), `${what}: not With HR`).toHaveCount(0);
    }
  });

  test('AC-7 Try again repeats from the link request: one new link request and one PUT, and a double tap sends one', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const docs = await signInConsented(fx);
    await openFromToday(page, 'TERTIARY_QUALIFICATION');
    docs.nextPuts.push({ status: 503 });
    await fileInput(page).setInputFiles(pdf('degree.pdf', 300_000));
    await expect(page.getByText(OFFLINE, { exact: true })).toBeVisible();
    expect([docs.links().length, docs.puts.length], 'one request, one PUT, so far').toEqual([1, 1]);

    // A double tap on Try again: one new link request (held, so the second tap comes while it is in flight).
    docs.holdLinks = true;
    const again = page.getByRole('button', { name: TRY_AGAIN, exact: true });
    await again.click();
    await again.click({ force: true, timeout: 1_000 }).catch(() => undefined);
    await again.press('Enter', { timeout: 1_000 }).catch(() => undefined);
    await expect.poll(() => docs.links().length).toBe(2);
    await sleep(page, 600);
    expect(docs.links(), 'a double tap sends one link request').toHaveLength(2);
    docs.release();
    await expect(fileRow(page, 'degree.pdf').getByText('With HR', { exact: true })).toBeVisible();
    expect(docs.puts, 'one PUT for the second try').toHaveLength(2);
    expect(docs.links(), 'and still one link request').toHaveLength(2);
    expect((docs.links()[1]!.body as { fileName: string }).fileName, 'the same file again').toBe('degree.pdf');
    await expect(page.getByText(OFFLINE, { exact: true }), 'the message is gone').toHaveCount(0);
  });

  // -------------------------------------------------------------- AC-8
  test('AC-8 Keyboard: Tab reaches each row\'s button, Enter opens the upload page; Tab reaches the picker, the breadcrumb and "Back to your documents"', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    await signInConsented(fx);
    await expect(checklistHeading(page)).toBeVisible();

    const focused = async (target: Locator) => target.evaluate((el) => el === document.activeElement || el.contains(document.activeElement));
    const reached = new Set<DocType>();
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    for (let i = 0; i < 60 && reached.size < DOC_TYPES.length; i++) {
      await page.keyboard.press('Tab');
      for (const type of DOC_TYPES) if (!reached.has(type) && (await focused(rowAction(page, type)))) reached.add(type);
    }
    expect([...reached].sort(), 'Tab reaches the button of every row that has one').toEqual([...DOC_TYPES].sort());

    // Enter on "Upload matric" opens the matric page.
    await rowAction(page, 'MATRIC_CERTIFICATE').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/start\/documents\/matric$/);
    await expect(pageHeading(page, 'MATRIC_CERTIFICATE')).toBeVisible();

    // Tab from the top of the page reaches the breadcrumb, the picker and the way back, each at some point.
    const targets: Record<string, Locator> = {
      'the breadcrumb': page.getByRole('link', { name: YOUR_DOCUMENTS, exact: true }),
      'the file picker': fileInput(page),
      'Back to your documents': backToDocuments(page),
    };
    const got = new Set<string>();
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    for (let i = 0; i < 60 && got.size < 3; i++) {
      await page.keyboard.press('Tab');
      for (const [name, target] of Object.entries(targets)) if (!got.has(name) && (await focused(target))) got.add(name);
    }
    expect([...got].sort(), 'Tab reaches all three').toEqual(Object.keys(targets).sort());
    await expect(page.getByText(CHOOSE, { exact: true }), 'the picker is labelled with its words').toBeVisible();
  });

  test('AC-8 Screen reader: the progress bar has a name, an error is announced, "With HR" after the upload is announced', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const docs = await signInConsented(fx, listOf({ NATIONAL_ID: 'ACCEPTED' }));
    await expect(checklistHeading(page)).toBeVisible();
    const bars = page.getByRole('progressbar');
    expect(await bars.count(), 'the checklist has a progress bar').toBeGreaterThan(0);
    expect(await page.getByRole('progressbar', { name: /\S/ }).count(), 'every progress bar has an accessible name').toBe(await bars.count());

    await openFromToday(page, 'MATRIC_CERTIFICATE');
    // A wrong file: the message is announced.
    await fileInput(page).setInputFiles(upload('notes.txt', 'text/plain', 2_000));
    await expectAnnounced(page, BAD_FILE, fileInput(page));
    // A failed upload: the message is announced (role=alert).
    docs.nextPuts.push({ status: 503 });
    await fileInput(page).setInputFiles(pdf('matric.pdf', 200_000));
    await expect(page.getByText(OFFLINE, { exact: true })).toBeVisible();
    await expectAnnounced(page, OFFLINE);
    // The upload goes through the second time: "With HR" is announced.
    await page.getByRole('button', { name: TRY_AGAIN, exact: true }).click();
    await expect.poll(async () => page.getByRole('status').filter({ hasText: 'With HR' }).count(), { message: '"With HR" is announced (role=status)' }).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------- AC-9
  test('AC-9 Phone: Today after consent and each upload page fit 390 wide, nothing sits under the top bar, buttons are at least 44 pixels tall', async ({ page, signIn, employee, me, myDocuments }, testInfo) => {
    noBackendOnly();
    test.skip(testInfo.project.name !== 'phone-390', 'The phone criterion: runs at 390 wide.');
    const fx = { page, signIn, employee, me, myDocuments };

    const check = async (what: string, parts: Locator[], buttons: Locator[]) => {
      const viewport = page.viewportSize()!;
      const scroll = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
      expect(scroll.doc, `${what}: no sideways scroll`).toBeLessThanOrEqual(scroll.win);
      for (const part of [...parts, ...buttons]) {
        // Centred, so a fixed top bar can't hide a part the page scrolled to its top edge.
        await part.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
        await expect(part, `${what}: visible`).toBeVisible();
        const b = (await part.boundingBox())!;
        expect(b.x, `${what}: left edge on screen`).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, `${what}: right edge on screen`).toBeLessThanOrEqual(viewport.width);
        expect(b.y, `${what}: top on screen`).toBeGreaterThanOrEqual(0);
        expect(b.y + b.height, `${what}: bottom on screen`).toBeLessThanOrEqual(viewport.height);
        const onTop = await part.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 8));
          return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
        });
        expect(onTop, `${what}: nothing sits on top of it (the top bar included)`).toBe(true);
      }
      for (const button of buttons) expect((await button.boundingBox())!.height, `${what}: button at least 44 pixels tall`).toBeGreaterThanOrEqual(44);
    };

    await signInConsented(fx, {
      documents: [
        entry('NATIONAL_ID', 'ACCEPTED', [{ fileName: 'id-book.pdf' }]),
        entry('BANK_CONFIRMATION', 'SENT_BACK', [{ fileName: 'bank-letter.pdf' }]),
        entry('MATRIC_CERTIFICATE', 'NOT_UPLOADED'),
        entry('TERTIARY_QUALIFICATION', 'WITH_HR', [{ fileName: 'bsc-computer-science.pdf' }]),
      ],
    });
    await expect(checklistHeading(page)).toBeVisible();
    await check(
      'Today after consent',
      [
        welcome(page, fx.employee.givenName),
        checklistHeading(page),
        page.getByText(SUBTITLE, { exact: true }),
        page.getByText(COUNT(1), { exact: true }),
        ...DOC_TYPES.map((t) => page.getByText(NAMES[t], { exact: true })),
        lozenge(page, 'NATIONAL_ID', 'ACCEPTED'),
        lozenge(page, 'BANK_CONFIRMATION', 'SENT_BACK'),
        lozenge(page, 'MATRIC_CERTIFICATE', 'NOT_UPLOADED'),
        lozenge(page, 'TERTIARY_QUALIFICATION', 'WITH_HR'),
        row(page, 'NATIONAL_ID').getByText(REQUIRED, { exact: true }),
        row(page, 'BANK_CONFIRMATION').getByText(REQUIRED, { exact: true }),
      ],
      [rowAction(page, 'BANK_CONFIRMATION'), rowAction(page, 'MATRIC_CERTIFICATE'), rowAction(page, 'TERTIARY_QUALIFICATION')],
    );

    for (const type of DOC_TYPES) {
      await openUploadPage(page, type);
      await check(
        `${NAMES[type]} upload page`,
        [pageHeading(page, type), page.getByText(DESCRIPTION[type], { exact: true }), page.getByText(ADD_A_FILE, { exact: true }), page.getByText(HINT, { exact: true }), page.getByText(NOTE, { exact: true }), page.getByRole('link', { name: YOUR_DOCUMENTS, exact: true })],
        [page.locator('label').filter({ hasText: CHOOSE }), backToDocuments(page)],
      );
    }

    // While a file uploads and after a failure, the rows still fit.
    const docs = fx.myDocuments!;
    await openUploadPage(page, 'MATRIC_CERTIFICATE');
    docs.nextPuts.push({ status: 503 });
    await fileInput(page).setInputFiles(pdf('a-very-long-file-name-for-a-phone-photo-of-my-matric-certificate-front-and-back-2026.pdf', 500_000));
    await expect(page.getByText(OFFLINE, { exact: true })).toBeVisible();
    await check('after a failed upload', [page.getByText(OFFLINE, { exact: true }), pageHeading(page, 'MATRIC_CERTIFICATE')], [page.getByRole('button', { name: TRY_AGAIN, exact: true }), backToDocuments(page)]);
  });

  // -------------------------------------------------------------- AC-11
  test('AC-11 pepla-dev: the employee test login uploads a matric certificate and it shows "With HR", also after a reload; S3 refuses a body of another size; no record id is taken @pepla-dev', async ({ page, signIn, employee }, testInfo) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only, after ONB-06 is merged and deployed there.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once, at one width.');
    test.setTimeout(240_000);
    const api = devEmployeesApi();

    const token = await signInKeepingToken(page, signIn, employee);
    await expect(page).toHaveURL(START, { timeout: 30_000 });
    await expect(welcome(page, employee.givenName)).toBeVisible();

    // The notice: accepted already by ONB-05's check (it runs first), or accepted here.
    const tick = page.getByRole('checkbox', { name: /^I have read and agree to the declaration above/ });
    const heading = checklistHeading(page);
    await expect(tick.or(heading), 'the consent form or the checklist').toBeVisible({ timeout: 30_000 });
    if (await tick.isVisible()) {
      await tick.check();
      await page.getByRole('button', { name: 'Accept and continue', exact: true }).click();
    }
    await expect(heading).toBeVisible({ timeout: 30_000 });

    // Matric is optional, so this never moves the persona's Verified state (ONB-08's AC-9).
    const matric = rowAction(page, 'MATRIC_CERTIFICATE');
    await expect(matric, 'the seed left the persona without a matric certificate: "Upload matric"').toBeVisible();
    await matric.click();
    await expect(pageHeading(page, 'MATRIC_CERTIFICATE')).toBeVisible();
    await fileInput(page).setInputFiles({ name: 'matric-test.pdf', mimeType: 'application/pdf', buffer: TEST_PDF });
    await expect(fileRow(page, 'matric-test.pdf').getByText('With HR', { exact: true }), 'the file went to S3 from the browser (the bucket allows this address)').toBeVisible({ timeout: 60_000 });
    await backToDocuments(page).click();
    await expect(lozenge(page, 'MATRIC_CERTIFICATE', 'WITH_HR')).toBeVisible({ timeout: 30_000 });

    // A reload still shows it: the server reads the file as received (the robot skips AI, so no AI runs).
    await expect(async () => {
      await page.reload();
      await expect(lozenge(page, 'MATRIC_CERTIFICATE', 'WITH_HR')).toBeVisible({ timeout: 10_000 });
    }, 'a reload still shows With HR').toPass({ timeout: 120_000, intervals: [3_000, 5_000, 10_000] });

    // The server takes no record id: another person's id in the body is ignored, the link is for the caller's own record.
    const asEmployee = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const probe = await page.request.post(`${api}/v1/me/documents/upload-url`, {
      headers: asEmployee,
      data: { documentType: 'MATRIC_CERTIFICATE', fileName: 'probe.pdf', contentType: 'application/pdf', fileSize: 1024, employee_id: 'E2E-EMP-9999' },
    });
    expect(probe.status(), `a link for the caller's own record: ${await probe.text()}`).toBe(200);
    const made = (await probe.json()) as { url: string; documentId: string; expiresIn: number; headers: Record<string, string> };
    expect(Object.keys(made).sort(), 'the answer holds the link, its id, its life and its header, nothing else').toEqual(['documentId', 'expiresIn', 'headers', 'url']);
    const path = decodeURIComponent(new URL(made.url).pathname);
    expect(path, 'the key is under the caller\'s own record').toContain(`/uploads/${DEV_EMPLOYEE_ID}/MATRIC_CERTIFICATE/`);
    expect(made.url, 'not another person\'s').not.toContain('E2E-EMP-9999');

    // S3 refuses a body of another size than the link was made for.
    const tooBig = await page.request.put(made.url, { headers: { 'Content-Type': 'application/pdf' }, data: Buffer.alloc(4096, 0x41) });
    expect([400, 403], `S3 refuses a body larger than the declared fileSize (got ${tooBig.status()})`).toContain(tooBig.status());
    // ...and a type other than the one it was made for.
    const wrongType = await page.request.put(made.url, { headers: { 'Content-Type': 'image/png' }, data: Buffer.alloc(1024, 0x41) });
    expect([400, 403], `S3 refuses another content type (got ${wrongType.status()})`).toContain(wrongType.status());
    // A type or size the page would never send is refused by the API itself.
    const heic = await page.request.post(`${api}/v1/me/documents/upload-url`, { headers: asEmployee, data: { ...GOOD_BODY, contentType: 'image/heic' } });
    expect(heic.status(), 'image/heic is refused').toBe(400);
    const huge = await page.request.post(`${api}/v1/me/documents/upload-url`, { headers: asEmployee, data: { ...GOOD_BODY, fileSize: TOO_BIG } });
    expect(huge.status(), 'a file over the limit is refused').toBe(400);
    const noAuth = await page.request.post(`${api}/v1/me/documents/upload-url`, { headers: { 'content-type': 'application/json' }, data: GOOD_BODY });
    expect([401, 403], 'no token, no link').toContain(noAuth.status());
  });

  // ================================================================ the Lambdas

  // -------------------------------------------------------------- AC-2 (Lambda)
  test('AC-2 createMyUploadLink: a wrong type, content type or size, a body that is not JSON and a missing field get 400 with words, never 500, and write nothing', async ({}, testInfo) => {
    onceOnly(testInfo);
    const w = worldWith();
    const bad: Array<[string, unknown, RegExp?]> = [
      ['documentType not one of the four', { ...GOOD_BODY, documentType: 'DRIVERS_LICENCE' }, /NATIONAL_ID/],
      ['documentType in lower case', { ...GOOD_BODY, documentType: 'national_id' }, /NATIONAL_ID/],
      ['documentType empty', { ...GOOD_BODY, documentType: '' }],
      ['documentType a number', { ...GOOD_BODY, documentType: 42 }],
      ['documentType a list', { ...GOOD_BODY, documentType: ['NATIONAL_ID'] }],
      ['contentType heic', { ...GOOD_BODY, contentType: 'image/heic' }, /pdf/i],
      ['contentType gif', { ...GOOD_BODY, contentType: 'image/gif' }, /png/i],
      ['contentType text', { ...GOOD_BODY, contentType: 'text/plain' }, /jpe?g/i],
      ['contentType word', { ...GOOD_BODY, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
      ['contentType image/jpg (not one of the three)', { ...GOOD_BODY, contentType: 'image/jpg' }],
      ['contentType empty', { ...GOOD_BODY, contentType: '' }],
      ['fileSize 0', { ...GOOD_BODY, fileSize: 0 }, /10/],
      ['fileSize negative', { ...GOOD_BODY, fileSize: -1 }, /10/],
      ['fileSize not whole', { ...GOOD_BODY, fileSize: 1.5 }, /10/],
      ['fileSize over the limit', { ...GOOD_BODY, fileSize: TOO_BIG }, /10/],
      ['fileSize enormous', { ...GOOD_BODY, fileSize: 1e12 }, /10/],
      ['fileSize text', { ...GOOD_BODY, fileSize: 'abc' }, /10/],
      ['fileSize true', { ...GOOD_BODY, fileSize: true }, /10/],
      ['fileSize null', { ...GOOD_BODY, fileSize: null }],
      ['no documentType', (({ documentType, ...rest }) => rest)(GOOD_BODY)],
      ['no fileName', (({ fileName, ...rest }) => rest)(GOOD_BODY)],
      ['fileName empty', { ...GOOD_BODY, fileName: '' }],
      ['fileName a number', { ...GOOD_BODY, fileName: 7 }],
      ['no contentType', (({ contentType, ...rest }) => rest)(GOOD_BODY)],
      ['no fileSize', (({ fileSize, ...rest }) => rest)(GOOD_BODY)],
      ['an empty object', {}],
      ['not JSON', '{"documentType": '],
      ['plain text', 'hello'],
      ['the JSON word null', 'null'],
      ['a JSON list', '[]'],
      ['a JSON number', '42'],
      ['no body at all', undefined],
    ];
    for (const [what, body, mentions] of bad) {
      const run = makeLink(w, LINDIWE, body);
      expectStatus(run, 400, `${what}`);
      const error = (run.body as { error?: unknown } | null)?.error;
      expect(typeof error === 'string' && error.length > 0, `${what}: an "error" in words (${run.raw})`).toBe(true);
      if (mentions) expect(String(error), `${what}: says what is allowed`).toMatch(mentions);
      expect(writes(run).map((c) => `${c.op} ${c.table}`), `${what}: writes nothing`).toEqual([]);
      expect(presigns(run), `${what}: signs nothing`).toEqual([]);
      expect(s3Calls(run), `${what}: no S3 call`).toEqual([]);
    }
    // The edges that are fine: one byte, and just under the limit.
    for (const fileSize of [1, 1024, FITS]) {
      const ok = makeLink(w, LINDIWE, { ...GOOD_BODY, fileSize });
      expectStatus(ok, 200, `fileSize ${fileSize}`);
    }
    for (const documentType of DOC_TYPES) for (const [contentType, fileName] of [['application/pdf', 'a.pdf'], ['image/jpeg', 'a.jpg'], ['image/png', 'a.png']] as const) {
      expectStatus(makeLink(w, LINDIWE, { documentType, fileName, contentType, fileSize: 5000 }), 200, `${documentType} ${contentType}`);
    }
  });

  // -------------------------------------------------------------- AC-3 (Lambda)
  test('AC-3 getMyDocuments: what each stored row means: nothing read yet is ignored, waiting is With HR, accepted by HR is Accepted, failed is Sent back, the newest counted row decides', async ({}, testInfo) => {
    onceOnly(testInfo);
    const ID = 'NATIONAL_ID';
    const T = (day: number, hh = '08') => `2026-11-${String(day).padStart(2, '0')}T${hh}:00:00.000Z`;
    type Case = { what: string; docs: StoredDoc[]; state: DocState; files: DocState[] };
    const cases: Case[] = [
      { what: 'no rows', docs: [], state: 'NOT_UPLOADED', files: [] },
      { what: 'PENDING with nothing read: a link was made and no file came', docs: [{ id: 'doc_1763000000001', type: ID, status: 'PENDING', uploaded: T(10) }], state: 'NOT_UPLOADED', files: [] },
      { what: 'PENDING with ocr_started_at', docs: [{ id: 'doc_1763000000001', type: ID, status: 'PENDING', uploaded: T(10), started: T(10, '09') }], state: 'WITH_HR', files: ['WITH_HR'] },
      { what: 'PENDING with ocr_completed_at only', docs: [{ id: 'doc_1763000000001', type: ID, status: 'PENDING', uploaded: T(10), completed: T(10, '09') }], state: 'WITH_HR', files: ['WITH_HR'] },
      { what: 'MANUAL_REVIEW', docs: [{ id: 'doc_1763000000001', type: ID, status: 'MANUAL_REVIEW', uploaded: T(10), started: T(10, '09'), completed: T(10, '10') }], state: 'WITH_HR', files: ['WITH_HR'] },
      { what: 'PASSED and HR decided', docs: [{ id: 'doc_1763000000001', type: ID, status: 'PASSED', uploaded: T(10), started: T(10, '09'), completed: T(10, '10'), reviewed: T(11) }], state: 'ACCEPTED', files: ['ACCEPTED'] },
      { what: 'PASSED, no decision from HR (an old auto-pass)', docs: [{ id: 'doc_1763000000001', type: ID, status: 'PASSED', uploaded: T(10), started: T(10, '09'), completed: T(10, '10') }], state: 'WITH_HR', files: ['WITH_HR'] },
      { what: 'FAILED', docs: [{ id: 'doc_1763000000001', type: ID, status: 'FAILED', uploaded: T(10), started: T(10, '09'), completed: T(10, '10'), reviewed: T(11) }], state: 'SENT_BACK', files: ['SENT_BACK'] },
      { what: 'a status nobody listed', docs: [{ id: 'doc_1763000000001', type: ID, status: 'PROCESSING', uploaded: T(10), started: T(10, '09') }], state: 'WITH_HR', files: ['WITH_HR'] },
      {
        what: 'the newest counted row decides: an older accepted file, a newer failed one',
        docs: [
          { id: 'doc_1763000000001', type: ID, status: 'PASSED', uploaded: T(5), started: T(5, '09'), reviewed: T(6) },
          { id: 'doc_1763000000002', type: ID, status: 'FAILED', uploaded: T(12), started: T(12, '09'), reviewed: T(13) },
        ],
        state: 'SENT_BACK',
        files: ['SENT_BACK', 'ACCEPTED'],
      },
      {
        what: 'the newest counted row decides, the other way round in the table',
        docs: [
          { id: 'doc_1763000000002', type: ID, status: 'FAILED', uploaded: T(5), started: T(5, '09'), reviewed: T(6) },
          { id: 'doc_1763000000001', type: ID, status: 'PASSED', uploaded: T(12), started: T(12, '09'), reviewed: T(13) },
        ],
        state: 'ACCEPTED',
        files: ['ACCEPTED', 'SENT_BACK'],
      },
      {
        what: 'a newer link with no file does not replace an accepted document',
        docs: [
          { id: 'doc_1763000000001', type: ID, status: 'PASSED', uploaded: T(5), started: T(5, '09'), reviewed: T(6) },
          { id: 'doc_1763000000002', type: ID, status: 'PENDING', uploaded: T(12) },
        ],
        state: 'ACCEPTED',
        files: ['ACCEPTED'],
      },
      {
        what: 'the same upload time: the larger document id is newer',
        docs: [
          { id: 'doc_1763000000009', type: ID, status: 'FAILED', uploaded: T(10), started: T(10, '09') },
          { id: 'doc_1763000000003', type: ID, status: 'PASSED', uploaded: T(10), started: T(10, '09'), reviewed: T(11) },
        ],
        state: 'SENT_BACK',
        files: ['SENT_BACK', 'ACCEPTED'],
      },
      {
        what: 'a row with no upload time is as new as the milliseconds in its id (6 Nov 2026), so it is newer than 4 Nov',
        docs: [
          { id: 'doc_1793900000000', type: ID, status: 'PASSED', started: T(6, '09'), reviewed: T(7) },
          { id: 'doc_1793000000000', type: ID, status: 'FAILED', uploaded: T(4), started: T(4, '09') },
        ],
        state: 'ACCEPTED',
        files: ['ACCEPTED', 'SENT_BACK'],
      },
    ];
    for (const c of cases) {
      const run = list(worldWith(c.docs), LINDIWE);
      expectStatus(run, 200, c.what);
      const entryOf = (run.body.documents as any[]).find((d) => d.type === ID);
      expect(entryOf.state, `${c.what}: state`).toBe(c.state);
      expect(entryOf.files.map((f: any) => f.state), `${c.what}: each file's state, newest first`).toEqual(c.files);
      expect(entryOf.required, `${c.what}: National ID is required`).toBe(true);
      expect((run.body.documents as any[]).filter((d) => d.type !== ID).every((d) => d.state === 'NOT_UPLOADED' && d.files.length === 0), `${c.what}: the other three have nothing`).toBe(true);
      expect(writes(run), `${c.what}: reading writes nothing`).toEqual([]);
    }

    // Every type in its own row, in the spec's order, with `required` from requiredFor().
    const all = list(worldWith(), LINDIWE);
    expectStatus(all, 200, 'an empty list');
    expect((all.body.documents as any[]).map((d) => [d.type, d.required, d.state, d.files.length]), 'the four types in order').toEqual([
      ['NATIONAL_ID', true, 'NOT_UPLOADED', 0],
      ['BANK_CONFIRMATION', true, 'NOT_UPLOADED', 0],
      ['MATRIC_CERTIFICATE', false, 'NOT_UPLOADED', 0],
      ['TERTIARY_QUALIFICATION', false, 'NOT_UPLOADED', 0],
    ]);

    // Every file carries its name and its upload time as it was stored.
    const timed = list(worldWith([{ id: 'doc_1763000000001', type: 'MATRIC_CERTIFICATE', status: 'MANUAL_REVIEW', uploaded: T(12, '14'), started: T(12, '15'), file: 'My matric (front).pdf' }]), LINDIWE);
    const m = (timed.body.documents as any[])[2];
    expect(m.files[0].fileName, 'the name the person gave it').toBe('My matric (front).pdf');
    expect(Date.parse(m.files[0].uploadedAt), 'the upload time').toBe(Date.parse(T(12, '14')));

    // Another person's rows are not in the list, and a long list is read to its end (the fake pages four rows at a time).
    const theirs = [{ id: 'doc_1763000000050', type: ID, status: 'PASSED', uploaded: T(9), started: T(9, '09'), reviewed: T(10), employee: OTHER_ID }];
    const mine: StoredDoc[] = [
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `doc_17630000000${String(n).padStart(2, '0')}`, type: 'MATRIC_CERTIFICATE', status: 'FAILED', uploaded: T(n), started: T(n, '09') })),
      { id: 'doc_1763000000099', type: 'MATRIC_CERTIFICATE', status: 'PASSED', uploaded: T(20), started: T(20, '09'), reviewed: T(21) },
    ];
    const long = list(worldWith([...theirs, ...mine]), LINDIWE);
    expectStatus(long, 200, 'seven documents of one type');
    const matric = (long.body.documents as any[]).find((d) => d.type === 'MATRIC_CERTIFICATE');
    expect(matric.files, 'all seven are read, not only the first page').toHaveLength(7);
    expect(matric.state, 'the newest one, last in the table, decides').toBe('ACCEPTED');
    expect((long.body.documents as any[]).find((d) => d.type === ID).state, 'Kagiso\'s accepted ID is not Lindiwe\'s').toBe('NOT_UPLOADED');
  });

  // -------------------------------------------------------------- AC-4
  test('AC-4 Both routes: no claims, HR, any other group, an unverified email and no company get 403 before any DynamoDB or S3 call', async ({}, testInfo) => {
    onceOnly(testInfo);
    const w = worldWith([{ id: 'doc_1763000000001', type: 'NATIONAL_ID', status: 'MANUAL_REVIEW', uploaded: '2026-11-10T08:00:00.000Z', started: '2026-11-10T08:01:00.000Z' }]);
    const routes: Array<[string, (c: Caller, o?: any) => Run]> = [
      ['GET /v1/me/documents', (c, o) => list(w, c, o)],
      ['POST /v1/me/documents/upload-url', (c, o) => makeLink(w, c, GOOD_BODY, o)],
    ];
    for (const [route, call] of routes) {
      for (const [who, caller] of WHO_IS_REFUSED) {
        const run = call(caller);
        expectStatus(run, 403, `${route} for ${who}`);
        expect(run.body, `${route} for ${who}: ONB-05's words`).toEqual(EMPLOYEE_ONLY);
        expect(noAwsCalls(run), `${route} for ${who}: nothing read, written or signed`).toEqual([]);
      }
      for (const [what, verified] of [['false', false], ['the text "false"', 'false'], ['missing', 'omit'], ['empty', ''], ['"yes"', 'yes'], ['0', 0]] as const) {
        const run = call(LINDIWE, { emailVerified: verified });
        expectStatus(run, 403, `${route} with email_verified ${what}`);
        expect(run.body, `${route} with email_verified ${what}: ONB-05's words`).toEqual(EMPLOYEE_ONLY);
        expect(noAwsCalls(run), `${route} with email_verified ${what}: nothing read, written or signed`).toEqual([]);
      }
      // BE-18: an access token is in no group here. Whatever else it carries, it is refused before anything is read (an ID token, or claims with no token_use, is fine).
      for (const [what, use] of [['an access token', 'access'], ['an empty token_use', ''], ['a look-alike token_use', 'ID']] as const) {
        const run = call(LINDIWE, { tokenUse: use });
        expectStatus(run, 403, `${route} with ${what}`);
        expect(run.body, `${route} with ${what}: ONB-05's words`).toEqual(EMPLOYEE_ONLY);
        expect(noAwsCalls(run), `${route} with ${what}: nothing read, written or signed`).toEqual([]);
      }
      expectStatus(call(LINDIWE, { tokenUse: 'id' }), 200, `${route} with token_use id`);
      // Cognito hands the claim over as a string, in any case; a real boolean is fine too.
      for (const verified of ['true', true]) expectStatus(call(LINDIWE, { emailVerified: verified }), 200, `${route} with email_verified ${String(verified)}`);
      // The company: a token without one (TEN-01 fails closed) gets 403 before anything is read.
      const noCompany = call(LINDIWE, { tenant: null });
      expectStatus(noCompany, 403, `${route} with no company in the token`);
      expect(noAwsCalls(noCompany), `${route} with no company: nothing read, written or signed`).toEqual([]);
      const badCompany = call(LINDIWE, { tenant: 'ten_not-a-company-id' });
      expectStatus(badCompany, 403, `${route} with a malformed company id`);
      expect(noAwsCalls(badCompany), `${route} with a malformed company id: nothing read`).toEqual([]);
    }
  });

  test('AC-4 Both routes: the record is the caller\'s own, found by the token\'s email. An employee_id in the body, the query, the path or a header is ignored', async ({}, testInfo) => {
    onceOnly(testInfo);
    const stranger = { id: 'doc_1763000000050', type: 'NATIONAL_ID', status: 'PASSED', uploaded: '2026-11-09T08:00:00.000Z', started: '2026-11-09T08:01:00.000Z', reviewed: '2026-11-10T08:00:00.000Z', employee: OTHER_ID, file: 'kagiso-id.pdf' };
    const w = worldWith([stranger]);
    const smuggled = { query: { employee_id: OTHER_ID, employeeId: OTHER_ID }, pathParameters: { employee_id: OTHER_ID }, headers: { 'x-employee-id': OTHER_ID, 'x-amzn-employee-id': OTHER_ID } };

    const link = makeLink(w, LINDIWE, { ...GOOD_BODY, employee_id: OTHER_ID, employeeId: OTHER_ID, s3_key: `uploads/${OTHER_ID}/NATIONAL_ID/x.pdf` }, smuggled);
    expectStatus(link, 200, 'a link with another person\'s id everywhere');
    const stored = documentRows(link.world).filter((r) => r['document_id'] !== stranger.id);
    expect(stored, 'one new row').toHaveLength(1);
    expect(stored[0]!['employee_id'], 'the row is the caller\'s own').toBe(LINDIWE_ID);
    expect(String(stored[0]!['s3_key']).startsWith(`uploads/${LINDIWE_ID}/MATRIC_CERTIFICATE/`), 'the key is the caller\'s own, for the type asked').toBe(true);
    expect(String(link.raw) + JSON.stringify(link.calls), 'the other person\'s id is nowhere in what the Lambda did or answered').not.toContain(OTHER_ID);
    expect(writes(link).every((c) => c.input.Item?.employee_id?.S === LINDIWE_ID), 'every write is to the caller\'s record').toBe(true);

    const got = list(w, LINDIWE, smuggled);
    expectStatus(got, 200, 'the list with another person\'s id everywhere');
    expect((got.body.documents as any[]).find((d) => d.type === 'NATIONAL_ID').files, 'the stranger\'s file is not in the caller\'s list').toEqual([]);
    expect(String(got.raw) + JSON.stringify(got.calls), 'the other person\'s id is not read for').not.toContain(OTHER_ID);
  });

  test('AC-4 Both routes: an email matching no record or two records is 404 and nothing is written or signed; before any consent check', async ({}, testInfo) => {
    onceOnly(testInfo);
    const none: Caller = { kind: 'jwt', email: 'nobody@x.co.za', groups: ['employee'], sub: 'sub-nobody' };
    const twins = world({ consents: [consentNow()], employees: [storedEmployee(), storedEmployee({ employee_id: OTHER_ID })] });
    const cases: Array<[string, ReturnType<typeof world>, Caller]> = [
      ['no record', worldWith(), none],
      ['two records', twins, LINDIWE],
      ['no record and no consent anywhere', worldWith([], false), none],
    ];
    for (const [what, w, caller] of cases) {
      const g = list(w, caller);
      expectStatus(g, 404, `GET with ${what}`);
      expect(g.body, `GET with ${what}: ONB-05's words`).toEqual(NO_RECORD);
      expect(dynamoCalls(g).filter((c) => c.table === 'documents'), `GET with ${what}: the documents are never read`).toEqual([]);
      const p = makeLink(w, caller, GOOD_BODY);
      expectStatus(p, 404, `POST with ${what}`);
      expect(p.body, `POST with ${what}: ONB-05's words`).toEqual(NO_RECORD);
      expect(writes(p), `POST with ${what}: nothing written`).toEqual([]);
      expect(presigns(p), `POST with ${what}: nothing signed`).toEqual([]);
    }
  });

  test('AC-4 createMyUploadLink: no consent, or only an older notice version\'s, is 403 with the words, no row and no link; the current version\'s consent lets it through', async ({}, testInfo) => {
    onceOnly(testInfo);
    const current = currentVersion();
    const older = world({ consents: [consentRow(LINDIWE_ID, '2025-01-1', '2025-01-02T08:00:00.000Z')] });
    const someoneElses = world({ consents: [consentRow(OTHER_ID, current, T0)] });
    for (const [what, w] of [['no consent row', worldWith([], false)], ['an older version only', older], ['only another person\'s consent to the current version', someoneElses]] as const) {
      const run = makeLink(w, LINDIWE, GOOD_BODY);
      expectStatus(run, 403, what);
      expect(run.body, `${what}: "Accept the privacy notice first."`).toEqual({ error: CONSENT_FIRST });
      expect(writes(run), `${what}: no row written`).toEqual([]);
      expect(presigns(run), `${what}: no link signed`).toEqual([]);
      expect(documentRows(run.world), `${what}: no documents row`).toEqual([]);
    }
    const ok = makeLink(worldWith(), LINDIWE, GOOD_BODY);
    expectStatus(ok, 200, 'with the current version accepted');
    expect(presigns(ok)).toHaveLength(1);
  });

  test('AC-4 Tenancy (TEN-01): a caller of company B gets 404 for company A\'s record and nothing is written or signed; the row written and the rows read are the caller\'s company\'s', async ({}, testInfo) => {
    onceOnly(testInfo);
    const aDoc: StoredDoc = { id: 'doc_1763000000001', type: 'NATIONAL_ID', status: 'PASSED', uploaded: '2026-11-10T08:00:00.000Z', started: '2026-11-10T08:01:00.000Z', reviewed: '2026-11-11T08:00:00.000Z' };
    const w = worldWith([aDoc]);

    // Company B asks about a record that is company A's (same email, company A's row): not found, never forbidden.
    const g = list(w, LINDIWE, { tenant: TEN_B });
    expectStatus(g, 404, 'company B reads company A\'s record');
    expect(dynamoCalls(g).filter((c) => c.table === 'documents'), 'the documents of company A are not read for company B').toEqual([]);
    expect(g.raw, 'nothing of company A in the answer').not.toMatch(/Lindiwe|id-book|scan\.pdf|NATIONAL_ID/);
    const p = makeLink(w, LINDIWE, GOOD_BODY, { tenant: TEN_B });
    expectStatus(p, 404, 'company B asks for a link into company A\'s record');
    expect(writes(p), 'nothing written').toEqual([]);
    expect(presigns(p), 'nothing signed').toEqual([]);

    // Company A: allowed, and what is written carries company A's id (stampTenant).
    const mine = makeLink(w, LINDIWE, GOOD_BODY, { tenant: TEN_A });
    expectStatus(mine, 200, 'company A');
    const added = documentRows(mine.world).filter((r) => r['document_id'] !== aDoc.id);
    expect(added, 'one new row').toHaveLength(1);
    expect(added[0]!['tenant_id'], 'the new row carries the caller\'s company').toBe(TEN_A);
    expect(added[0]!['tenant_id'], 'the company comes from the token, not from the request').not.toBe(TEN_B);
    // A company in the body, the query, the path or a header changes nothing.
    const sneaky = makeLink(w, LINDIWE, { ...GOOD_BODY, tenant_id: TEN_B }, { tenant: TEN_A, query: { tenant_id: TEN_B }, headers: { 'x-tenant-id': TEN_B }, pathParameters: { tenant_id: TEN_B } });
    expectStatus(sneaky, 200, 'company A with a company B everywhere in the request');
    expect(documentRows(sneaky.world).filter((r) => r['document_id'] !== aDoc.id).map((r) => r['tenant_id']), 'still company A').toEqual([TEN_A]);

    // A row of another company that sits under the same employee id is never part of the list.
    const foreign: StoredDoc = { id: 'doc_1763000000077', type: 'MATRIC_CERTIFICATE', status: 'PASSED', uploaded: '2026-11-12T08:00:00.000Z', started: '2026-11-12T08:01:00.000Z', reviewed: '2026-11-13T08:00:00.000Z', tenant: TEN_B };
    const own: StoredDoc = { id: 'doc_1763000000078', type: 'TERTIARY_QUALIFICATION', status: 'MANUAL_REVIEW', uploaded: '2026-11-12T09:00:00.000Z', started: '2026-11-12T09:01:00.000Z', tenant: TEN_A };
    const mixed = list(worldWith([foreign, own]), LINDIWE, { tenant: TEN_A });
    expectStatus(mixed, 200, 'company A with a company B row under its employee id');
    const docsOf = (t: string) => (mixed.body.documents as any[]).find((d) => d.type === t);
    expect(docsOf('MATRIC_CERTIFICATE').state, 'company B\'s row does not count').toBe('NOT_UPLOADED');
    expect(docsOf('TERTIARY_QUALIFICATION').state, 'company A\'s row does').toBe('WITH_HR');

    // And the employee row itself: the record is company A's only when its company is.
    const other = world({ consents: [consentNow()], employees: [storedEmployee({ tenant_id: TEN_B })] });
    expectStatus(list(other, LINDIWE, { tenant: TEN_A }), 404, 'a record of company B read by company A');
    expectStatus(makeLink(other, LINDIWE, GOOD_BODY, { tenant: TEN_A }), 404, 'a record of company B, link asked by company A');
  });

  // -------------------------------------------------------------- AC-5 (Lambda)
  test('AC-5 createMyUploadLink: a 15 minute link that binds the content type and the size, an answer with those four fields only, and the row written exactly as the old route writes it', async ({}, testInfo) => {
    onceOnly(testInfo);
    const w = worldWith();
    const run = makeLink(w, LINDIWE, { ...GOOD_BODY, fileName: 'Lindiwe ID (copy).pdf', documentType: 'NATIONAL_ID', fileSize: 1_234_567 });
    expectStatus(run, 200, 'a good request');
    expect(Object.keys(run.body).sort(), 'url, documentId, expiresIn and headers, nothing else (no s3_key, no employee id)').toEqual(['documentId', 'expiresIn', 'headers', 'url']);
    expect(run.body.expiresIn, '15 minutes').toBe(900);
    expect(run.body.headers, 'the one header to send').toEqual({ 'Content-Type': 'application/pdf' });
    expect(run.body.documentId, 'doc_<ms>, on the server\'s clock').toBe(`doc_${Date.parse(T0)}`);
    expect(String(run.body.url), 'a link').toMatch(/^https:\/\//);

    // What the signature binds.
    const signed = presigns(run);
    expect(signed, 'one link signed').toHaveLength(1);
    const p = signed[0]!;
    expect(p.op, 'a PUT link').toBe('presign:PutObject');
    expect(p.contentType, 'the content type is bound').toBe('application/pdf');
    expect(p.contentLength, 'the size is bound: S3 refuses a body of another size').toBe(1_234_567);
    expect(p.expiresIn, 'valid 900 seconds').toBe(900);
    expect(p.bucket, 'a bucket').toBeTruthy();
    expect((p.unsignable ?? []).map((h) => h.toLowerCase()), 'the length is not left out of the signature').not.toContain('content-length');
    expect((p.unsignable ?? []).map((h) => h.toLowerCase()), 'the type is not left out of the signature').not.toContain('content-type');
    expect(s3Calls(run).filter((c) => !c.op.startsWith('presign:')), 'the file never goes through the Lambda').toEqual([]);

    // The row, as generateDocumentUploadUrl writes it today, plus the company.
    const rows = documentRows(run.world);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(Object.keys(r).sort(), 'the same fields as today, plus tenant_id').toEqual(['document_id', 'document_type', 'employee_id', 'file_name', 'ocr_status', 's3_key', 'tenant_id', 'upload_timestamp', 'verification_id']);
    expect(r['employee_id']).toBe(LINDIWE_ID);
    expect(r['document_id']).toBe(run.body.documentId);
    expect(r['document_type']).toBe('NATIONAL_ID');
    expect(r['ocr_status'], 'PENDING until the file is read').toBe('PENDING');
    expect(r['verification_id'], 'null').toBeNull();
    expect(r['upload_timestamp'], 'the server\'s time').toBe(T0);
    expect(r['file_name'], 'the name the person gave it').toBe('Lindiwe ID (copy).pdf');
    expect(r['s3_key'], 'the key: the cleaned name').toBe(`uploads/${LINDIWE_ID}/NATIONAL_ID/${run.body.documentId}_Lindiwe_ID__copy_.pdf`);
    expect(p.key, 'the signed key is the stored key').toBe(r['s3_key']);
    expect(String(run.body.url), 'and the link is for that key').toContain(encodeURI(String(r['s3_key'])));
    expect(writes(run).map((c) => `${c.op} ${c.table}`), 'one write: the documents row').toEqual(['PutItem documents']);
    // Where the row is read from: the one record found by email, nothing scanned.
    expect(dynamoCalls(run).filter((c) => c.op === 'Scan'), 'no scan').toEqual([]);
  });

  test('AC-5 createMyUploadLink: the key holds a cleaned name: exactly four parts the OCR Lambda reads back to the same employee, type and document id, whatever the name', async ({}, testInfo) => {
    onceOnly(testInfo);
    const w = worldWith();
    const names = [
      'plain.pdf',
      'My ID.pdf',
      '../../etc/passwd.pdf',
      '..\\..\\windows\\system32\\id.png',
      'uploads/OTHER/NATIONAL_ID/doc_1_x.pdf',
      'résumé ünïcode 简历 🎓.jpg',
      'name with spaces and (brackets) & symbols #1 %20 +plus.png',
      '   leading and trailing   .pdf',
      'no-extension',
      'a'.repeat(300) + '.pdf',
      'UPPER.PDF',
      'two.dots.in.name.jpeg',
    ];
    for (const fileName of names) {
      const type = 'TERTIARY_QUALIFICATION';
      const contentType = /\.png$/i.test(fileName) ? 'image/png' : /\.jpe?g$/i.test(fileName) ? 'image/jpeg' : 'application/pdf';
      const run = makeLink(w, LINDIWE, { documentType: type, fileName, contentType, fileSize: 4000 });
      expectStatus(run, 200, fileName.slice(0, 40));
      const row = documentRows(run.world).at(-1)!;
      const key = String(row['s3_key']);
      const parsed = ocrParse(key);
      expect(parsed.parts, `"${fileName.slice(0, 40)}": exactly four parts (${key})`).toHaveLength(4);
      expect(parsed.parts[0], 'uploads/').toBe('uploads');
      expect(parsed.employeeId, 'the OCR Lambda reads the same employee').toBe(LINDIWE_ID);
      expect(parsed.type, 'the same type').toBe(type);
      expect(parsed.documentId, 'the same document id').toBe(String(run.body.documentId).split('_')[1]);
      expect(parsed.parts[3], 'document id, an underscore, the cleaned name of 1 to 100 characters from A-Z a-z 0-9 . _ -').toMatch(/^doc_\d+_[A-Za-z0-9._-]{1,100}$/);
      expect(key, 'nothing but safe characters in the whole key').toMatch(/^uploads\/[A-Za-z0-9-]+\/[A-Z_]+\/[A-Za-z0-9._-]+$/);
      const ext = /\.[A-Za-z0-9]+$/.exec(fileName)?.[0];
      if (ext) expect(parsed.parts[3], `the extension ${ext} is kept`).toMatch(new RegExp(`${ext.replace('.', '\\.')}$`));
      expect(String(row['file_name']).length, 'the shown name is cut to 200 characters').toBeLessThanOrEqual(200);
      expect(String(row['file_name']), 'and is the name as given, as far as it goes').toBe(fileName.slice(0, 200));
      expect(presigns(run)[0]!.key, 'the signed key is the stored key').toBe(key);
    }
  });

  // -------------------------------------------------------------- AC-6
  test('AC-6 getMyDocuments: only the listed fields; never the employee id, a document id, an S3 key, a verification id, the check, a confidence, reasoning or the ID number, even when the rows hold them', async ({}, testInfo) => {
    onceOnly(testInfo);
    const T = (d: number, h = '08') => `2026-11-${String(d).padStart(2, '0')}T${h}:00:00.000Z`;
    const rows: StoredDoc[] = [
      { id: 'doc_1763000000001', type: 'NATIONAL_ID', status: 'PASSED', uploaded: T(10), started: T(10, '09'), completed: T(10, '10'), reviewed: T(11), file: 'id-book.pdf', extra: { id_number: '9506145009087', extracted_data: '{"idNumber":"9506145009087"}', check: 'MATCH', hr_returned_reason: 'none' } },
      { id: 'doc_1763000000002', type: 'BANK_CONFIRMATION', status: 'FAILED', uploaded: T(10), started: T(10, '09'), completed: T(10, '10'), reviewed: T(11), file: 'bank.pdf', extra: { returned_by: 'Thandi Nkosi', reason: 'The letter is dated 2 Aug 2026' } },
      { id: 'doc_1763000000003', type: 'MATRIC_CERTIFICATE', status: 'MANUAL_REVIEW', uploaded: T(12), started: T(12, '09'), completed: T(12, '10'), file: 'matric.pdf' },
      { id: 'doc_1763000000004', type: 'TERTIARY_QUALIFICATION', status: 'PASSED', uploaded: T(13), started: T(13, '09'), completed: T(13, '10'), reviewed: T(14), file: 'bsc.pdf' },
    ];
    const run = list(worldWith(rows), LINDIWE);
    expectStatus(run, 200, 'the list');
    expect(Object.keys(run.body), 'one field: documents').toEqual(['documents']);
    const FILE_FIELDS = ['fileName', 'uploadedAt', 'state'];
    const SENT_BACK_ONLY = ['returnedAt', 'returnedBy', 'reason']; // ONB-20 adds these, on a sent-back file only
    for (const d of run.body.documents as any[]) {
      expect(Object.keys(d).sort(), `${d.type}: type, required, state and files, and nothing at the type level (not even ONB-20's)`).toEqual(['files', 'required', 'state', 'type']);
      for (const f of d.files as any[]) {
        const keys = Object.keys(f);
        expect(keys.filter((k) => ![...FILE_FIELDS, ...SENT_BACK_ONLY].includes(k)), `${d.type}/${f.fileName}: no field outside the list`).toEqual([]);
        for (const k of FILE_FIELDS) expect(keys, `${d.type}/${f.fileName}: ${k}`).toContain(k);
        if (f.state !== 'SENT_BACK') expect(keys.filter((k) => SENT_BACK_ONLY.includes(k)), `${d.type}/${f.fileName} is ${f.state}: no returnedAt, returnedBy or reason (only a sent-back file has them)`).toEqual([]);
      }
    }
    const sentBack = (run.body.documents as any[]).find((d) => d.type === 'BANK_CONFIRMATION').files[0];
    expect(sentBack.state).toBe('SENT_BACK');

    const secrets = [
      LINDIWE_ID, OTHER_ID, 'doc_1763000000001', 'doc_1763000000002', 'doc_1763000000003', 'doc_1763000000004',
      'uploads/', 's3_key', 'ver-doc_', 'verification_id', 'verificationId', '9506145009087', 'id_number', 'extracted_data', 'confidence', '0.9731', 'reasoning',
      'The ID number', 'MATCH', 'check', 'Thandi Nkosi', 'Checked by hand', 'hr_reviewed', 'ocr_', 'tenant', TEN_A, 'X-Amz', 'first_name', 'salary', 'bank_account', '62841937055', 'First National', 'Private HR note',
    ];
    const text = JSON.stringify(run.body);
    for (const s of secrets) expect(text, `the list holds no "${s}"`).not.toContain(s);
    // The key names and every string value in the answer are known words.
    const allowedWords = new Set(['documents', 'type', 'required', 'state', 'files', 'fileName', 'uploadedAt', ...DOC_TYPES, 'NOT_UPLOADED', 'WITH_HR', 'SENT_BACK', 'ACCEPTED', 'id-book.pdf', 'bank.pdf', 'matric.pdf', 'bsc.pdf']);
    const unknown = strings(run.body).filter((s) => !allowedWords.has(s) && !/^\d{4}-\d{2}-\d{2}T/.test(s) && !SENT_BACK_ONLY.includes(s) && s !== 'The letter is dated 2 Aug 2026');
    expect(unknown, 'every key and value in the answer is one of the listed ones').toEqual([]);
  });

  // -------------------------------------------------------------- AC-10
  test('AC-10 Text check: the route and guard, group and email checks first, the company helper, the two roles and KMS, the dev bucket, OpenAPI, no new header, the old route not touched, pp-* only, the words', async ({}, testInfo) => {
    onceOnly(testInfo);
    const app = join(WEB, 'src', 'app');

    // Routes: /start/documents/:type under the employee frame, behind employeeGuard, with a title.
    const routes = readFileSync(join(app, 'app.routes.ts'), 'utf8');
    const start = routeBlock(routes, 'start');
    expect(start, 'app.routes.ts has a start route').not.toBeNull();
    expect(start!, '/start is behind employeeGuard').toMatch(/canActivate\s*:\s*\[\s*employeeGuard\s*\]/);
    const nested = routeBlock(start!, 'documents/:type');
    const flat = routeBlock(routes, 'start/documents/:type');
    const documentsRoute = nested ?? flat;
    expect(documentsRoute, 'a route documents/:type inside the /start route (the employee frame, behind its guard)').not.toBeNull();
    expect(documentsRoute!, 'a title for the page').toMatch(/title\s*:/);
    if (!nested) expect(flat!, '/start/documents/:type is behind employeeGuard').toMatch(/canActivate\s*:\s*\[\s*employeeGuard\s*\]/);

    // Both Lambdas: group, then the verified email, then the company, before any send(.
    for (const fn of ['getMyDocuments', 'createMyUploadLink']) {
      const file = join(REPO, 'lambda', fn, 'index.mjs');
      expect(existsSync(file), `lambda/${fn}/index.mjs`).toBe(true);
      expect(existsSync(join(REPO, 'lambda', fn, 'package.json')), `lambda/${fn}/package.json (build-lambdas.py builds every folder that has one)`).toBe(true);
      const text = stripComments(readFileSync(file, 'utf8'));
      const handlerAt = text.search(/export\s+(const|async\s+function|function)\s+handler\b/);
      expect(handlerAt, `${fn}: exports handler`).toBeGreaterThanOrEqual(0);
      const body = text.slice(handlerAt);
      const group = body.search(/groupsOf\s*\(/);
      const verified = body.search(/emailIsVerified\s*\(|email_verified/);
      const company = body.search(/requireTenant\s*\(/);
      const send = body.search(/\.send\s*\(|getSignedUrl\s*\(|findEmployee\s*\(|hasCurrentConsent\s*\(|readConsent\s*\(/);
      expect(group, `${fn}: reads the groups with groupsOf in the handler`).toBeGreaterThanOrEqual(0);
      expect(verified, `${fn}: checks email_verified in the handler`).toBeGreaterThanOrEqual(0);
      expect(company, `${fn}: runs requireTenant in the handler`).toBeGreaterThanOrEqual(0);
      expect(send, `${fn}: reads or signs something`).toBeGreaterThanOrEqual(0);
      expect(group, `${fn}: the group check comes before the first read or signature`).toBeLessThan(send);
      expect(verified, `${fn}: the email_verified check comes before the first read or signature`).toBeLessThan(send);
      expect(company, `${fn}: requireTenant comes before the first read or signature`).toBeLessThan(send);
      expect(group, `${fn}: the group check is first (TEN-01: requireTenant right after it)`).toBeLessThan(company);
      expect(text, `${fn}: imports lambda/shared/tenant.mjs`).toMatch(/from\s+['"]\.\.\/shared\/tenant\.mjs['"]/);
      expect(text, `${fn}: checks the row it finds with ownsRow`).toMatch(/ownsRow\s*\(/);
      expect(text, `${fn}: imports no AI client`).not.toMatch(/(from|import)\s*\(?\s*['"`][^'"`]*(bedrock|textract|anthropic|openai)/i);
    }
    expect(stripComments(readFileSync(join(REPO, 'lambda', 'createMyUploadLink', 'index.mjs'), 'utf8')), 'createMyUploadLink: writes the row through stampTenant').toMatch(/stampTenant\s*\(/);
    expect(stripComments(readFileSync(join(REPO, 'lambda', 'getMyDocuments', 'index.mjs'), 'utf8')), 'getMyDocuments: reads the list through tenantFilter').toMatch(/tenantFilter\s*\(/);
    expect(existsSync(UPLOAD_LINK_MODULE), 'lambda/shared/upload-link.mjs').toBe(true);

    // The old route is not touched by this card: it does not use the new shared code, nor the consent gate (OPS-04).
    const old = stripComments(readFileSync(join(REPO, 'lambda', 'generateDocumentUploadUrl', 'index.mjs'), 'utf8'));
    expect(old, 'generateDocumentUploadUrl does not use upload-link.mjs').not.toMatch(/upload-link/);
    expect(old, 'generateDocumentUploadUrl has no consent gate (decision 1: the new route only; OPS-04 owns the old one)').not.toMatch(/consent/i);

    // The roles: logs, X-Ray and exactly their own actions. Both read the encrypted employees table: the PII key's DynamoDB list.
    const files = tfFiles();
    const res = (type: string) => blocks(files, 'resource').filter((b) => b.labels[0] === type);
    const attr = (b: { body: string }, name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm').exec(b.body)?.[1]?.trim().replace(/\s+/g, '') ?? '';
    type Row = { effect: string; action: string; resource: string };
    const flatten = (s: unknown): Row[] => (Array.isArray(s) ? s : [s]).flatMap((st: any) => {
      const actions = ([] as string[]).concat(st.Action ?? []);
      const resources = ([] as string[]).concat(st.Resource ?? []);
      return actions.flatMap((action) => resources.map((resource) => ({ effect: st.Effect, action, resource: resource.replace(/\$\{([^}]+)\}/g, '$1') })));
    });
    const isDocuments = (r: string) => r === 'arn:aws:dynamodb:af-south-1:000000000000:table/documents' || r === 'aws_dynamodb_table.documents.arn';
    const isConsents = (r: string) => r === 'arn:aws:dynamodb:af-south-1:000000000000:table/employee_consents' || r === 'aws_dynamodb_table.employee_consents.arn';
    const isEmailIndex = (r: string) => r === 'arn:aws:dynamodb:af-south-1:000000000000:table/employees/index/email-index' || r === 'aws_dynamodb_table.employees.arn/index/email-index';
    const isUploads = (r: string) => /^arn:aws:s3:::[^/]+\/uploads\/\*$/.test(r);
    const NEW = [
      { fn: 'getMyDocuments', route: 'GET /v1/me/documents', want: [['dynamodb:Query', isEmailIndex], ['dynamodb:Query', isDocuments]] as const },
      { fn: 'createMyUploadLink', route: 'POST /v1/me/documents/upload-url', want: [['dynamodb:Query', isEmailIndex], ['dynamodb:GetItem', isConsents], ['dynamodb:PutItem', isDocuments], ['s3:PutObject', isUploads]] as const },
    ];
    const roles: string[] = [];
    for (const n of NEW) {
      const fn = res('aws_lambda_function').find((b) => attr(b, 'function_name') === `"${n.fn}"`);
      expect(fn, `a Terraform function named ${n.fn}`).toBeTruthy();
      expect(attr(fn!, 'runtime'), `${n.fn}: runtime`).toBe('"nodejs22.x"');
      expect(fn!.body, `${n.fn}: X-Ray on`).toMatch(/tracing_config\s*\{\s*mode\s*=\s*"Active"/);
      expect(fn!.body, `${n.fn}: its own log group`).toContain(`"/aws/lambda/${n.fn}"`);
      const roleRef = /aws_iam_role\.(\w+)\.arn/.exec(attr(fn!, 'role'));
      expect(roleRef, `${n.fn}: a role of its own`).toBeTruthy();
      roles.push(roleRef![1]!);
      expect(res('aws_lambda_function').filter((b) => attr(b, 'role') === attr(fn!, 'role')).map((b) => attr(b, 'function_name')), `${n.fn}: the role is used by this function only`).toEqual([`"${n.fn}"`]);
      const policies = res('aws_iam_role_policy').filter((b) => attr(b, 'role') === `aws_iam_role.${roleRef![1]}.name`);
      expect(policies, `${n.fn}: one inline policy`).toHaveLength(1);
      expect(res('aws_iam_role_policy_attachment').filter((b) => attr(b, 'role').includes(`aws_iam_role.${roleRef![1]}.`)), `${n.fn}: no attached managed policy`).toEqual([]);
      const rows = flatten(policyOf(resourcesNamed('aws_iam_role_policy', policies[0]!.labels[1]!)[0]!).Statement);
      expect(rows.every((r) => r.effect === 'Allow'), `${n.fn}: Allow only`).toBe(true);
      for (const r of rows) {
        expect(r.action, `${n.fn}: no wildcard action (${r.action})`).not.toMatch(/\*/);
        if (r.resource === '*') expect(r.action, `${n.fn}: Resource "*" only for X-Ray`).toMatch(/^xray:/);
      }
      expect(rows.filter((r) => r.action.startsWith('logs:')).every((r) => r.resource.includes(`/aws/lambda/${n.fn}`)), `${n.fn}: logs only into its own group`).toBe(true);
      const extra = rows.filter((r) => !r.action.startsWith('logs:') && !r.action.startsWith('xray:'));
      for (const [action, on] of n.want) expect(extra.some((r) => r.action === action && on(r.resource)), `${n.fn}: may ${action} on the right resource`).toBe(true);
      expect(extra.filter((r) => !n.want.some(([action, on]) => r.action === action && on(r.resource))).map((r) => `${r.action} ${r.resource}`), `${n.fn}: nothing else`).toEqual([]);

      const route = res('aws_apigatewayv2_route').find((b) => attr(b, 'route_key') === `"${n.route}"`.replace(/\s+/g, ''));
      expect(route, `a route ${n.route}`).toBeTruthy();
      expect(attr(route!, 'api_id'), `${n.route}: on the employees API`).toBe('aws_apigatewayv2_api.employees_api.id');
      expect(attr(route!, 'authorization_type'), `${n.route}: JWT`).toBe('"JWT"');
      expect(attr(route!, 'authorizer_id'), `${n.route}: the Cognito authorizer`).toBe('aws_apigatewayv2_authorizer.employees_api_cognito.id');
    }
    const kms = blocks(files, 'module').find((b) => b.labels[0] === 'kms_pii');
    const kmsList = (name: string) => /\[([^\]]*)\]/.exec(new RegExp(`${name}\\s*=\\s*\\[[^\\]]*\\]`).exec(kms!.body)?.[0] ?? '')?.[1] ?? '';
    for (const role of roles) expect(kmsList('dynamodb_read_role_arns'), `${role} is in kms_pii dynamodb_read_role_arns (LESSONS 15 Nov)`).toContain(`aws_iam_role.${role}.arn`);

    // The dev bucket lets the new app's address put a file (port 4300; it allowed 4200 only).
    const cors = res('aws_s3_bucket_cors_configuration').find((b) => b.labels[1] === 'document_uploads');
    expect(cors, 'aws_s3_bucket_cors_configuration.document_uploads').toBeTruthy();
    expect(cors!.body, 'allows http://localhost:4300').toContain('"http://localhost:4300"');
    expect(cors!.body, 'allows http://127.0.0.1:4300').toContain('"http://127.0.0.1:4300"');
    expect(cors!.body, 'allows PUT').toMatch(/allowed_methods\s*=\s*\[[^\]]*"PUT"/);

    // No new request header: the employees API's CORS list is as it was.
    const api = res('aws_apigatewayv2_api').find((b) => b.labels[1] === 'employees_api')!;
    const allow = (/allow_headers\s*=\s*\[([^\]]*)\]/.exec(api.body)?.[1] ?? '').split(',').map((h) => h.trim().replace(/"/g, '').toLowerCase()).filter(Boolean).sort();
    expect(allow, 'the employees API allows the same request headers as before').toEqual(['authorization', 'content-type', 'idempotency-key']);

    // Both routes are in the OpenAPI spec (a required check).
    const spec = readFileSync(join(REPO, 'api', 'openapi.yaml'), 'utf8');
    const pathBlock = (p: string) => new RegExp(`^  ${p.replace(/[/{}]/g, '\\$&')}:\\s*\\n((?:    .*\\n|\\s*\\n)+)`, 'm').exec(spec)?.[1] ?? '';
    expect(pathBlock('/v1/me/documents'), 'openapi.yaml: GET /v1/me/documents').toMatch(/^    get:/m);
    expect(pathBlock('/v1/me/documents/upload-url'), 'openapi.yaml: POST /v1/me/documents/upload-url').toMatch(/^    post:/m);

    // Alarm, log group and dashboard lists: every list that names createEmployee names both.
    for (const file of ['alarms.tf', 'cloudwatch.tf', 'dashboards.tf']) {
      const text = stripComments(readFileSync(join(REPO, 'infra', file), 'utf8'));
      const named = (l: string, name: string) => new RegExp(`"(/aws/lambda/)?${name}"`).test(l);
      const lists = [...text.matchAll(/\[[^\[\]]*\]/g)].map((m) => m[0]).filter((l) => named(l, 'createEmployee'));
      expect(lists.length, `infra/${file} has a list naming createEmployee`).toBeGreaterThan(0);
      for (const fn of ['getMyDocuments', 'createMyUploadLink']) for (const l of lists) expect(named(l, fn), `infra/${file}: every list that names createEmployee names ${fn}`).toBe(true);
    }

    // The new files: no "Masked", "credentials" or "Work email"; no extra header; nothing paid AI.
    const startDir = join(app, 'features', 'start');
    const mine = [
      ...walk(startDir).filter((f) => /\.(ts|html)$/.test(f)),
      ...walk(join(WEB, 'src')).filter((f) => /\.ts$/.test(f) && !f.startsWith(startDir) && /\/v1\/me\/documents\b/.test(readFileSync(f, 'utf8'))),
      join(REPO, 'lambda', 'getMyDocuments', 'index.mjs'),
      join(REPO, 'lambda', 'createMyUploadLink', 'index.mjs'),
      UPLOAD_LINK_MODULE,
    ].filter((f) => existsSync(f));
    expect(mine.some((f) => /\/v1\/me\/documents\b/.test(readFileSync(f, 'utf8')) && f.startsWith(join(WEB, 'src'))), 'the app calls /v1/me/documents from a service').toBe(true);
    for (const f of mine) {
      const text = readFileSync(f, 'utf8');
      expect(text, `${rel(f)}: never "Masked"`).not.toMatch(/\bmasked\b/i);
      expect(text, `${rel(f)}: never "credentials"`).not.toMatch(/\bcredentials\b/i);
      expect(text, `${rel(f)}: never "Work email"`).not.toMatch(/work email/i);
      expect(text, `${rel(f)}: no Idempotency-Key or X- header`).not.toMatch(/idempotency-key|['"`]x-[a-z-]+['"`]/i);
      expect(text, `${rel(f)}: imports no AI client`).not.toMatch(/(from|import)\s*\(?\s*['"`][^'"`]*(bedrock|textract|anthropic|openai)/i);
    }

    // Only pp-* components on screens.
    try {
      execFileSync('node', ['scripts/verify-design.mjs'], { cwd: WEB, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      throw new Error(`verify:design failed:\n${err.stdout ?? ''}${err.stderr ?? ''}`);
    }
  });

  test('AC-10 No log line of either Lambda holds the signed link, the S3 key, the sign-in email or a file name', async ({}, testInfo) => {
    onceOnly(testInfo);
    const secretName = 'Lindiwe private ID 9506145009087.pdf';
    const made = makeLink(worldWith(), LINDIWE, { ...GOOD_BODY, fileName: secretName });
    expectStatus(made, 200, 'a link');
    const got = list(worldWith([{ id: 'doc_1763000000001', type: 'NATIONAL_ID', status: 'PASSED', uploaded: '2026-11-10T08:00:00.000Z', started: '2026-11-10T08:01:00.000Z', reviewed: '2026-11-11T08:00:00.000Z', file: secretName }]), LINDIWE);
    expectStatus(got, 200, 'the list');
    // The error paths log too: a failed write and a failed read, each with the same private values in play.
    const brokenWrite = worldWith();
    brokenWrite.fail = [{ op: 'PutItem', table: 'documents' }];
    const failedLink = makeLink(brokenWrite, LINDIWE, { ...GOOD_BODY, fileName: secretName });
    expectStatus(failedLink, 500, 'a link when the write fails');
    const brokenRead = worldWith([{ id: 'doc_1763000000001', type: 'NATIONAL_ID', status: 'PASSED', uploaded: '2026-11-10T08:00:00.000Z', started: '2026-11-10T08:01:00.000Z', reviewed: '2026-11-11T08:00:00.000Z', file: secretName }]);
    brokenRead.fail = [{ op: 'Query', table: 'documents' }];
    const failedList = list(brokenRead, LINDIWE);
    expectStatus(failedList, 500, 'the list when the read fails');
    for (const [what, run] of [['createMyUploadLink', made], ['getMyDocuments', got], ['createMyUploadLink (failing)', failedLink], ['getMyDocuments (failing)', failedList]] as const) {
      const logs = logLines(run).map((l) => l.message + ' ' + JSON.stringify(l.extra ?? '')).join('\n') + '\n' + run.output;
      for (const s of [LINDIWE.email, LINDIWE.email.toLowerCase(), 'X-Amz', 'uploads/', '9506145009087', secretName, 'Lindiwe']) expect(logs, `${what}: no "${s}" in its logs`).not.toContain(s);
    }
  });
});

// ---------------------------------------------------------------- pepla-dev helpers (as ONB-08 and ONB-15)

const TEST_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
/** The employee test persona's record id (scripts/ci/seed-dev.py). */
const DEV_EMPLOYEE_ID = 'E2E-EMP-0001';

/** The employees API address the app was built with (CI writes it into environment.ts). */
function devEmployeesApi(): string {
  const file = join(REPO, 'pepla-web', 'src', 'environments', 'environment.ts');
  const m = /employeesApiUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(existsSync(file) ? readFileSync(file, 'utf8') : '');
  expect(m, 'pepla-web/src/environments/environment.ts has employeesApiUrl').toBeTruthy();
  expect(m![1], 'employeesApiUrl points at pepla-dev, not the placeholder').not.toMatch(/\.invalid\b/);
  return m![1]!.replace(/\/+$/, '');
}

/** Signs in through the app and keeps the ID token Cognito hands back. */
async function signInKeepingToken(page: Page, signIn: SignInPage, login: Login): Promise<string> {
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
void forgetSignIn;

// ---------------------------------------------------------------- helpers

function rel(f: string): string {
  return relative(REPO, f).split(sep).join('/');
}

function walk(d: string): string[] {
  if (!existsSync(d)) return [];
  return readdirSync(d).flatMap((n) => {
    const f = join(d, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
}

/** The `{ ... }` route object whose path is `path`, or null. */
function routeBlock(text: string, path: string): string | null {
  const m = new RegExp(`path\\s*:\\s*['"\`]${path}['"\`]`).exec(text);
  if (!m) return null;
  let start = m.index;
  let depth = 0;
  for (; start >= 0; start--) {
    if (text[start] === '}') depth++;
    if (text[start] === '{') {
      if (depth === 0) break;
      depth--;
    }
  }
  depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// Silence "unused" for helpers a later card's tests may want from this file's imports.
void LIMIT_BYTES;
void TEN_A;
void CREATE_LINK;
void GET_DOCS;
