import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { stripComments, tfFiles, blocks } from './support/infra-harness';
import { ON_DEV, ON_SIGN_IN, HR_HOME, expect, test as base, type Login, type SignInPage } from './support/fixtures';
import { VERSION } from './support/onb-05/notice';
import { listOf, type DocState, type DocType, type ListAnswer, type MyDocumentsFake } from './support/onb-06/documents-fake';
import type { MeFake } from './support/onb-05/me-fake';
import { rolePairsOf } from './support/onb-10/iam';
import { forgetSignIn } from './support/sign-in-again';
import { STEP_CODES, giveSteps, type StepCode, type StepPerson, type StepValue } from './support/onb-19/step-me';
import { openAndReadMe } from './support/onb-19/me-answer';
import { sentBy } from './support/onb-19/sent-by';
import {
  BAR_LABEL, CARD, HEADING, LEFT, META, NAV_LABEL, NOT_FOUND, OFFLINE, STEP_LABELS, TABLE, TITLE, TODAY_DOCS_META, TODAY_TRACKER, TRY_AGAIN, UPLOAD_BANK, UPLOAD_ID,
  describe as stepLine, doneText, type Mark,
} from './support/onb-19/words';
import { A, B, EMP, MAIL, SUB, askAs, bodyOf, describeRun, dynamoCalls, dynamoOps, employeeClaims, hrSees, stored, withRow } from './support/onb-19/world';
import { jwtAuthorizer } from './support/ten-02/lambda-harness';
import { withoutGeneratedApiTypes } from './support/generated-api-types';

/**
 * ONB-19 · Where am I: four steps (Jira NH-177, epic NH-150). Amber.
 * One test per acceptance criterion (a few criteria have several tests), written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-19.md (NH-177). Notes: ./cards/onb-19.md.
 *
 * Screens: the no-backend run answers GET /v1/me with ONB-05's stand-in plus the one new key, `step`
 * (support/onb-19/step-me.ts), and GET /v1/me/documents with ONB-06's stand-in. Both record every call.
 * Lambdas: the real lambda/getMyStart, getEmployees and getEmployeeDocumentVerifications run against TEN-02's
 * two-company fake AWS (support/onb-19/world.ts). Every word is in support/onb-19/words.ts.
 * This card also changes two locked checks, as child locks (see ./cards/onb-19.md): onb-05.spec.ts (the `step` key
 * and the second sidebar item) and support/mod-02/baseline.json (the employee sidebar has one more item).
 *
 * Each screen test runs at 1280 and 390 wide unless it says why not. Lambda and text checks run once, at 1280.
 * AC-12 runs on pepla-dev. Nothing here calls an AI service. Locked once accepted: see ./README.md.
 */

const HERE = __dirname;
const WEB = join(HERE, '..', '..');
const REPO = join(WEB, '..');
const APP = join(WEB, 'src', 'app');

const START = /\/start$/;
const ONBOARDING = '/start/onboarding';
const ONBOARDING_URL = /\/start\/onboarding$/;
const ACCEPTED_AT = '2026-11-17T08:00:00.000Z';
const FAKE_PASSWORD = 'winter-protea-2026';

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: AC-12 is the pepla-dev check.');
const onceOnly = (testInfo: TestInfo) => {
  test.skip(ON_DEV, 'Reads files and runs Lambdas: no-backend run only.');
  test.skip(testInfo.project.name !== 'desktop-1280', 'Reads files and runs Lambdas, not the screen: runs once, at one width.');
};

// ---------------------------------------------------------------- fixtures

/** Every request the browser made. */
class Watch {
  readonly requests: Array<{ url: string; method: string }> = [];
  track(page: Page): void {
    page.context().on('request', (r) => this.requests.push({ url: r.url(), method: r.method() }));
  }
  /** Calls to our own APIs: anything that is not the app, Cognito or fonts. */
  apiCalls(appOrigin: string, from = 0): string[] {
    return this.requests
      .slice(from)
      .filter((r) => {
        const u = new URL(r.url);
        if (u.origin === appOrigin || !/^https?:$/.test(u.protocol)) return false;
        if (/cognito-idp\.[a-z0-9-]+\.amazonaws\.com$/.test(u.hostname)) return false;
        if (/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) return false;
        if (r.method === 'GET' && /\/v1\/company\/modules$/.test(u.pathname)) return false; // MOD-02: the shell asks which modules are on
        return r.method !== 'OPTIONS';
      })
      .map((r) => `${r.method} ${new URL(r.url).pathname}`);
  }
}

const test = base.extend<{ watch: Watch; appOrigin: string; stepMe: void }>({
  appOrigin: async ({ baseURL }, use) => {
    await use(new URL(baseURL!).origin);
  },
  watch: async ({ page }, use) => {
    const w = new Watch();
    w.track(page);
    await use(w);
  },
  // ONB-19's stand-in: the answer of GET /v1/me gets the person's `step` (none, null or a code) on top of ONB-05's.
  stepMe: [
    async ({ me }, use) => {
      if (me) giveSteps(me);
      await use();
    },
    { auto: true },
  ],
});

type Fx = { page: Page; signIn: SignInPage; employee: Login; me: MeFake | null; myDocuments: MyDocumentsFake | null };

/** What GET /v1/me/documents answers: the two required documents in the states given (the optional two are not uploaded). */
const docs = (id: DocState, bank: DocState, more: Partial<Record<DocType, DocState>> = {}): ListAnswer => listOf({ NATIONAL_ID: id, BANK_CONFIRMATION: bank, ...more });

type Setup = {
  /** The key GET /v1/me answers: a code, `null`, or 'absent' (no `step` key at all, as before this card). */
  step: StepValue | 'absent';
  /** Has the person accepted the current privacy notice? (default yes) */
  consent?: boolean;
  documents?: ListAnswer;
};

/** Signs the employee in with the answers the test wants; lands on Today. */
async function arrive(fx: Fx, o: Setup): Promise<void> {
  const person: StepPerson = { ...fx.me!.defaultPerson(fx.employee.givenName), consents: o.consent === false ? {} : { [VERSION]: ACCEPTED_AT } };
  if (o.step !== 'absent') person.step = o.step;
  fx.me!.people.set(fx.employee.email, person);
  if (o.documents) fx.myDocuments!.answer = o.documents;
  await fx.signIn.open();
  await fx.signIn.signInAs(fx.employee);
  await expect(fx.page).toHaveURL(START, { timeout: 20_000 });
  await expect(fx.page.getByRole('heading', { level: 1, name: `Welcome, ${fx.employee.givenName}`, exact: true })).toBeVisible();
}

// ---------------------------------------------------------------- the page, found by its words

const heading1 = (page: Page) => page.getByRole('heading', { level: 1 });
const header = (page: Page) => page.getByRole('heading', { level: 1, name: HEADING, exact: true });
const bar = (page: Page) => page.getByRole('progressbar', { name: BAR_LABEL, exact: true });
const tracker = (page: Page) => page.getByRole('list', { name: CARD, exact: true });
const stepItems = (page: Page) => tracker(page).getByRole('listitem');
const cardHeading = (page: Page) => page.getByRole('heading', { name: CARD, exact: true });
/** A message (region) that holds these words. Danger messages are alerts. */
const message = (page: Page, words: string) => page.getByRole('region').filter({ hasText: words }).or(page.getByRole('alert').filter({ hasText: words }));
const upload = (page: Page, name: string) => page.getByRole('link', { name, exact: true });
const anyUpload = (page: Page) => page.getByRole('link', { name: /^Upload /i }).or(page.getByRole('button', { name: /^Upload /i }));
const tryAgain = (page: Page) => page.getByRole('button', { name: TRY_AGAIN, exact: true }).or(page.getByRole('link', { name: TRY_AGAIN, exact: true }));
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });
const todayTracker = (page: Page) => page.getByRole('list', { name: TODAY_TRACKER, exact: true });

/** The page, opened by address, as a person opens it: the whole page loads. */
async function open(page: Page): Promise<void> {
  await page.goto(ONBOARDING);
  await expect(page).toHaveURL(ONBOARDING_URL);
}

/** On a phone the sidebar is a drawer: open it first. */
async function openSidebar(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: 'Open menu', exact: true });
  const phone = (page.viewportSize()?.width ?? 1280) < 768;
  if (phone) await expect(menu, 'the menu button, on a phone').toBeVisible();
  if (phone || (await menu.isVisible())) {
    // The page may not answer the first press yet: press until the drawer is on screen.
    await expect(async () => {
      const box = await sidebar(page).boundingBox();
      if (!box || box.x < 0 || box.x + box.width > 390 + 1 || box.x + box.width <= 0) await menu.click();
      await page.waitForTimeout(400);
      const now = await sidebar(page).boundingBox();
      expect(now && now.x >= 0 && now.x < 390, 'the drawer is on screen').toBe(true);
    }).toPass({ timeout: 15_000 });
  }
  await expect(sidebar(page)).toBeVisible();
}

/** The links in the page's own area that say "Upload ...", by their names, in the order they come on the page. */
async function expectUploads(page: Page, names: string[], what: string): Promise<void> {
  await expect(page.locator('main').getByRole('link'), `${what}: ${names.length} link(s) on the page: ${names.join(', ') || 'none'}`).toHaveCount(names.length);
  for (const name of names) await expect(upload(page, name), `${what}: the link "${name}"`).toHaveCount(1);
  if (names.length === 2) {
    const inOrder = await page.evaluate(([a, b]) => {
      const links = [...document.querySelectorAll('main a')] as HTMLElement[];
      const at = (t: string) => links.findIndex((l) => (l.textContent ?? '').replace(/\s+/g, ' ').trim().startsWith(t));
      return at(a!) >= 0 && at(a!) < at(b!);
    }, names);
    expect(inOrder, `${what}: ${names[0]} comes before ${names[1]}`).toBe(true);
  }
}

const WORDS_BEFORE: Record<Mark, string> = { done: 'Done: ', current: 'Current step: ', 'not started': 'Not started: ' };

/** One step of the tracker: its state words, its name and the words under it ('' when none). */
async function readStep(page: Page, i: number): Promise<{ state: string; label: string; meta: string; current: boolean }> {
  const li = stepItems(page).nth(i);
  const text = ((await li.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  const state = /^(Done by Batsi|Done|Current step|Blocked|Not started): /.exec(text)?.[0] ?? '';
  const label = STEP_LABELS[i]!;
  const rest = text.slice(state.length);
  return { state, label: rest.startsWith(label) ? label : `(starts with: ${rest.slice(0, 30)})`, meta: rest.startsWith(label) ? rest.slice(label.length).trim() : rest, current: (await li.getAttribute('aria-current')) === 'step' };
}

/** The four steps, each in the state the spec's table gives for `step`, with the words under the steps that have words. */
async function expectSteps(page: Page, step: StepCode, what: string): Promise<void> {
  await expect(tracker(page), `${what}: "${CARD}" is a list`).toBeVisible();
  await expect(stepItems(page), `${what}: exactly four steps`).toHaveCount(4);
  const marks = TABLE[step].marks;
  for (let i = 0; i < 4; i++) {
    const got = await readStep(page, i);
    expect(got.label, `${what}: step ${i + 1} is "${STEP_LABELS[i]}"`).toBe(STEP_LABELS[i]);
    expect(got.state, `${what}: ${STEP_LABELS[i]} is ${marks[i]}`).toBe(WORDS_BEFORE[marks[i]!]);
    expect(got.current, `${what}: ${STEP_LABELS[i]} is marked aria-current="step" only when it is the current step`).toBe(marks[i] === 'current');
  }
  await expect(tracker(page).locator('[aria-current="step"]'), `${what}: at most one step is marked current`).toHaveCount(marks.includes('current') ? 1 : 0);
}

/** The metas the spec words: Documents done, In review current, Verified not started. The others the spec leaves empty or unsaid. */
async function expectMetas(page: Page, step: StepCode, what: string): Promise<void> {
  const [invited, documents, review, verified] = await Promise.all([0, 1, 2, 3].map((i) => readStep(page, i)));
  expect(invited!.meta, `${what}: Invited done or current: no words for a date or an HR name (Q2)`).not.toMatch(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|\d{4}|added you|sent your link/);
  if (TABLE[step].marks[0] === 'done') expect(invited!.meta, `${what}: Invited done: no words (Q2)`).toBe('');
  if (TABLE[step].marks[1] === 'done') expect(documents!.meta, `${what}: Documents done`).toBe(META.documentsDone);
  if (TABLE[step].marks[2] === 'current') expect(review!.meta, `${what}: In review current`).toBe(META.inReviewCurrent);
  if (TABLE[step].marks[3] === 'not started') expect(verified!.meta, `${what}: Verified not started`).toBe(META.verifiedNotStarted);
  if (TABLE[step].marks[3] === 'done') expect(verified!.meta, `${what}: Verified done: no words (Q1)`).toBe('');
  for (const [i, s] of [invited!, documents!, review!, verified!].entries()) {
    expect(s.meta, `${what}: step ${i + 1} shows no date or HR name`).not.toMatch(/\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|Thandeka|Dlamini|Pieter|HR partner/);
  }
}

/** The page, all of it that does not depend on what is left: header, bar, "Your steps to Day 1", and its words. */
async function expectFrame(page: Page, step: StepCode, what: string): Promise<void> {
  await expect(header(page), `${what}: "${HEADING}"`).toBeVisible();
  await expect(page.getByText(stepLine(step), { exact: true }), `${what}: "${stepLine(step)}"`).toBeVisible();
  const b = bar(page);
  await expect(b, `${what}: the bar "${BAR_LABEL}"`).toBeVisible();
  await expect(b, `${what}: the bar's value is ${TABLE[step].d}`).toHaveAttribute('value', String(TABLE[step].d));
  await expect(b, `${what}: the bar's end is 4`).toHaveAttribute('max', '4');
  await expect(b, `${what}: the bar's value text`).toHaveAccessibleDescription(doneText(step));
  await expect(page.getByText(doneText(step), { exact: true }), `${what}: "${doneText(step)}" is shown`).toBeVisible();
  await expect(cardHeading(page), `${what}: the card "${CARD}"`).toBeVisible();
  await expectSteps(page, step, what);
  await expectMetas(page, step, what);
}

const clearOf = (text: string) => text.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- Lambda helpers

const NOT_EMPLOYEE = 'This page is for new employees';
/** The step each stored row answers: the row's own step when it is one of the four, else the old stage's, else null (ONB-09's table, written out here). */
const FROM_STAGE: Record<string, StepCode> = { INVITED: 'INVITED', ACTIVE: 'DOCUMENTS', DOCUMENTS_SUBMITTED: 'IN_REVIEW', VERIFIED: 'VERIFIED', TRAINING: 'VERIFIED', ONBOARDED: 'VERIFIED' };
const ROWS: Array<{ what: string; step: string | undefined; stage: string | undefined; want: StepCode | null }> = [
  { what: 'step INVITED', step: 'INVITED', stage: 'INVITED', want: 'INVITED' },
  { what: 'step DOCUMENTS', step: 'DOCUMENTS', stage: 'ACTIVE', want: 'DOCUMENTS' },
  { what: 'step IN_REVIEW', step: 'IN_REVIEW', stage: 'DOCUMENTS_SUBMITTED', want: 'IN_REVIEW' },
  { what: 'step VERIFIED', step: 'VERIFIED', stage: 'VERIFIED', want: 'VERIFIED' },
  { what: 'the stored step wins over the stage (IN_REVIEW on an ACTIVE row)', step: 'IN_REVIEW', stage: 'ACTIVE', want: 'IN_REVIEW' },
  { what: 'the stored step wins over the stage (DOCUMENTS on an ONBOARDED row)', step: 'DOCUMENTS', stage: 'ONBOARDED', want: 'DOCUMENTS' },
  { what: 'no step, stage ACTIVE', step: undefined, stage: 'ACTIVE', want: 'DOCUMENTS' },
  { what: 'no step, stage DOCUMENTS_SUBMITTED', step: undefined, stage: 'DOCUMENTS_SUBMITTED', want: 'IN_REVIEW' },
  { what: 'no step, stage TRAINING', step: undefined, stage: 'TRAINING', want: 'VERIFIED' },
  { what: 'no step, stage ONBOARDED', step: undefined, stage: 'ONBOARDED', want: 'VERIFIED' },
  { what: 'no step, stage VERIFIED', step: undefined, stage: 'VERIFIED', want: 'VERIFIED' },
  { what: 'no step, stage INVITED', step: undefined, stage: 'INVITED', want: 'INVITED' },
  { what: 'no step, stage ARCHIVED', step: undefined, stage: 'ARCHIVED', want: null },
  { what: 'a step that is not one of the four falls back to the stage', step: 'FINISHED', stage: 'ACTIVE', want: 'DOCUMENTS' },
  { what: 'a step that is not one of the four and a stage that is not known', step: 'FINISHED', stage: 'SOMETHING', want: null },
  { what: 'neither a step nor a stage', step: undefined, stage: undefined, want: null },
];

const hr = (): unknown => jwtAuthorizer({ sub: SUB.hrA, email: MAIL.hrA, email_verified: 'true', 'cognito:groups': '[hr_staff e2e-robots]', 'custom:staff_id': 'HRA001', tenant_id: A });

// ---------------------------------------------------------------- the tests

test.describe('ONB-19 Where am I: four steps', () => {
  // -------------------------------------------------------------- AC-1
  test('AC-1 The page shows the four steps, the one the person is on and "<d> of 4 steps done", for every step', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const waiting = docs('WITH_HR', 'WITH_HR');
    const inDocs: Record<StepCode, ListAnswer> = {
      INVITED: docs('NOT_UPLOADED', 'NOT_UPLOADED'),
      DOCUMENTS: docs('WITH_HR', 'NOT_UPLOADED'),
      IN_REVIEW: waiting,
      VERIFIED: docs('ACCEPTED', 'ACCEPTED'),
    };
    await arrive(fx, { step: 'DOCUMENTS', documents: inDocs.DOCUMENTS });
    for (const code of ['DOCUMENTS', 'IN_REVIEW', 'VERIFIED', 'INVITED'] as const) {
      me!.people.set(employee.email, { ...(me!.people.get(employee.email) as StepPerson), step: code });
      myDocuments!.answer = inDocs[code];
      await open(page);
      await expect(page, `${code}: the title`).toHaveTitle(TITLE);
      await expectFrame(page, code, code);
      await expect(heading1(page), `${code}: one level-one heading`).toHaveCount(1);
      await expect(page.locator('body'), `${code}: the name Pepla is never shown`).not.toContainText(/pepla/i);
      await expect(page.getByRole('progressbar'), `${code}: one bar`).toHaveCount(1);
      await expect(page.getByRole('list', { name: /steps/i }), `${code}: one tracker on the page`).toHaveCount(1);
    }
    // The board's example, word for word.
    me!.people.set(employee.email, { ...(me!.people.get(employee.email) as StepPerson), step: 'IN_REVIEW' });
    myDocuments!.answer = waiting;
    await open(page);
    await expect(page.getByText('Step 3 of 4: In review. 2 of 4 steps done.', { exact: true })).toBeVisible();
    await expect(page.getByText('2 of 4 steps done', { exact: true })).toBeVisible();
    await expect(bar(page)).toHaveAttribute('value', '2');
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 What is left: the line, one link per required document still to give, "Needs a new copy" on a sent-back one; nothing optional; nothing before consent; In review says it is being checked', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    await arrive(fx, { step: 'DOCUMENTS', documents: docs('NOT_UPLOADED', 'NOT_UPLOADED') });
    const setDocs = (answer: ListAnswer) => (myDocuments!.answer = answer);
    const setStep = (step: StepValue | 'absent', consent = true) => {
      const person = me!.people.get(employee.email) as StepPerson;
      person.consents = consent ? { [VERSION]: ACCEPTED_AT } : {};
      if (step === 'absent') delete person.step;
      else person.step = step;
    };
    const tone = async (words: string, want: 'information' | 'warning' | 'success') => {
      const cls = (await message(page, words).first().getAttribute('class')) ?? '';
      const got = (/pp-section-message--(\w+)/.exec(cls)?.[1] ?? 'information') as string;
      expect(got, `the message "${words}" has the ${want} tone`).toBe(want);
    };
    const documentsCalls = () => myDocuments!.gets().length;

    // 1. Neither required document in. The line is the Documents step's words too.
    setStep('DOCUMENTS');
    setDocs(docs('NOT_UPLOADED', 'NOT_UPLOADED', { MATRIC_CERTIFICATE: 'NOT_UPLOADED', TERTIARY_QUALIFICATION: 'NOT_UPLOADED' }));
    // ONB-19.2: only calls My onboarding itself sends count; Today's own late call does not (support/onb-19/sent-by.ts).
    const fromThePage = sentBy(page, 'GET', /\/v1\/me\/documents$/, ONBOARDING_URL);
    await open(page);
    await expect(message(page, LEFT.both).first(), 'both missing: the line').toBeVisible();
    await tone(LEFT.both, 'information');
    expect(fromThePage.count(), 'consent is done: GET /v1/me/documents is asked once').toBe(1);
    fromThePage.stop();
    await expectUploads(page, [UPLOAD_ID, UPLOAD_BANK], 'both missing');
    expect(await upload(page, UPLOAD_ID).getAttribute('href'), 'Upload ID leads to its upload page').toMatch(/\/start\/documents\/national-id$/);
    expect(await upload(page, UPLOAD_BANK).getAttribute('href'), 'Upload bank letter leads to its upload page').toMatch(/\/start\/documents\/bank-letter$/);
    await expect(stepItems(page).nth(1), 'the Documents step says the same line (Q3)').toContainText(LEFT.both);
    await expect(page.getByText(/matric|tertiary|qualification/i), 'an optional document is never listed').toHaveCount(0);
    await expect(page.getByText(LEFT.needsNewCopy), 'nothing was sent back: no "Needs a new copy"').toHaveCount(0);
    // It sits between the bar and the card (the spec's place for it).
    const [barBox, msgBox, cardBox] = await Promise.all([bar(page).boundingBox(), message(page, LEFT.both).first().boundingBox(), cardHeading(page).boundingBox()]);
    expect(msgBox!.y, 'the message is under the bar').toBeGreaterThan(barBox!.y);
    expect(cardBox!.y, 'and above "Your steps to Day 1"').toBeGreaterThan(msgBox!.y);
    // The links lead to the upload pages.
    await upload(page, UPLOAD_ID).click();
    await expect(page).toHaveURL(/\/start\/documents\/national-id$/);
    await page.goBack();
    await expect(upload(page, UPLOAD_BANK)).toBeVisible();
    await upload(page, UPLOAD_BANK).click();
    await expect(page).toHaveURL(/\/start\/documents\/bank-letter$/);

    // 2. The ID is with HR, the bank letter is missing: only the bank letter.
    setDocs(docs('WITH_HR', 'NOT_UPLOADED'));
    await open(page);
    await expect(message(page, LEFT.bank).first()).toBeVisible();
    await expect(page.getByText(LEFT.both, { exact: true }), 'the both-documents line is gone').toHaveCount(0);
    await expect(page.getByText(LEFT.id, { exact: true })).toHaveCount(0);
    await expectUploads(page, [UPLOAD_BANK], 'ID with HR');
    await expect(stepItems(page).nth(1), 'the Documents step says the same line').toContainText(LEFT.bank);

    // 3. The ID is missing, the bank letter is accepted: only the ID.
    setDocs(docs('NOT_UPLOADED', 'ACCEPTED'));
    await open(page);
    await expect(message(page, LEFT.id).first()).toBeVisible();
    await expect(page.getByText(LEFT.bank, { exact: true })).toHaveCount(0);
    await expectUploads(page, [UPLOAD_ID], 'bank letter accepted');

    // 4. The bank letter was sent back: its line, its link and the lozenge; a warning.
    setDocs(docs('WITH_HR', 'SENT_BACK'));
    await open(page);
    await expect(message(page, LEFT.bank).first()).toBeVisible();
    await tone(LEFT.bank, 'warning');
    await expectUploads(page, [UPLOAD_BANK], 'bank letter sent back');
    await expect(page.getByText(LEFT.needsNewCopy, { exact: true }), 'the lozenge on the sent-back document').toHaveCount(1);

    // 5. Both sent back: both lines in one, both links, two lozenges.
    setDocs(docs('SENT_BACK', 'SENT_BACK'));
    await open(page);
    await expect(message(page, LEFT.both).first()).toBeVisible();
    await tone(LEFT.both, 'warning');
    await expectUploads(page, [UPLOAD_ID, UPLOAD_BANK], 'both sent back');
    await expect(page.getByText(LEFT.needsNewCopy, { exact: true })).toHaveCount(2);

    // 6. An optional document that is not in, or that was sent back, is never left.
    setDocs(docs('ACCEPTED', 'NOT_UPLOADED', { MATRIC_CERTIFICATE: 'SENT_BACK', TERTIARY_QUALIFICATION: 'NOT_UPLOADED' }));
    await open(page);
    await expect(message(page, LEFT.bank).first()).toBeVisible();
    await expectUploads(page, [UPLOAD_BANK], 'only the bank letter: no link for a matric or a qualification');
    await expect(page.getByText(LEFT.needsNewCopy), 'a sent-back matric shows no lozenge here').toHaveCount(0);
    await expect(page.getByText(/matric|tertiary|qualification/i)).toHaveCount(0);
    setDocs(docs('ACCEPTED', 'ACCEPTED', { MATRIC_CERTIFICATE: 'NOT_UPLOADED', TERTIARY_QUALIFICATION: 'NOT_UPLOADED' }));
    await open(page);
    await expect(anyUpload(page), 'both required are in, only optional ones are missing: nothing to upload here').toHaveCount(0);

    // 7. Step DOCUMENTS but nothing left (a file is still being read): the In review message.
    setDocs(docs('WITH_HR', 'WITH_HR'));
    await open(page);
    await expect(message(page, LEFT.checkingTitle).first(), 'nothing left to give: the In review message').toBeVisible();
    await expect(page.getByText(LEFT.checkingBody, { exact: true })).toBeVisible();
    await expect(anyUpload(page)).toHaveCount(0);

    // 8. Step IN_REVIEW: the kit's message, no link.
    setStep('IN_REVIEW');
    setDocs(docs('WITH_HR', 'WITH_HR'));
    await open(page);
    await expect(page.getByRole('heading', { name: LEFT.checkingTitle, exact: true }), 'the kit title').toBeVisible();
    await expect(page.getByText(LEFT.checkingBody, { exact: true }), 'the kit body').toBeVisible();
    await expect(anyUpload(page), 'In review: no upload link').toHaveCount(0);
    await expect(page.getByText(LEFT.both, { exact: true })).toHaveCount(0);

    // 9. Before consent: the one line, a link to Today, and no documents call at all.
    setStep('DOCUMENTS', false);
    setDocs(docs('NOT_UPLOADED', 'NOT_UPLOADED'));
    const before = documentsCalls();
    const meBefore = me!.gets().length;
    await open(page);
    await expect(page.getByText(LEFT.consent, { exact: true }), 'before consent: "Accept the privacy notice first."').toBeVisible();
    await tone(LEFT.consent, 'information');
    const go = page.getByRole('link', { name: LEFT.goToday, exact: true });
    await expect(go, 'a link "Go to Today"').toBeVisible();
    expect(await go.getAttribute('href'), 'it leads to /start').toMatch(/^\/start\/?$/);
    await expect(anyUpload(page), 'before consent: no upload link').toHaveCount(0);
    await expect(page.getByText(LEFT.both, { exact: true }), 'before consent: no upload line').toHaveCount(0);
    expect(me!.gets().length - meBefore, 'GET /v1/me is asked once').toBe(1);
    expect(documentsCalls() - before, 'before consent: GET /v1/me/documents is not asked at all').toBe(0);
    await go.click();
    await expect(page).toHaveURL(START);
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 At Verified the page says HR has everything it needs, with all four steps done', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    await arrive(fx, { step: 'VERIFIED', documents: docs('ACCEPTED', 'ACCEPTED') });
    await open(page);
    await expectFrame(page, 'VERIFIED', 'Verified');
    await expect(page.getByText('Step 4 of 4: Verified. 4 of 4 steps done.', { exact: true })).toBeVisible();
    await expect(page.getByText('4 of 4 steps done', { exact: true })).toBeVisible();
    await expect(bar(page)).toHaveAttribute('value', '4');
    const done = message(page, LEFT.verified).first();
    await expect(done, 'Q1: "HR has everything it needs."').toBeVisible();
    expect(clearOf(await done.innerText()), 'Q1: a title and no body').toBe(LEFT.verified);
    const cls = (await done.getAttribute('class')) ?? '';
    expect(cls, 'a success message').toContain('pp-section-message--success');
    await expect(anyUpload(page), 'no upload link').toHaveCount(0);
    await expect(page.getByText(LEFT.checkingTitle), 'not "Your documents are being checked"').toHaveCount(0);
    await expect(page.getByText(LEFT.both), 'no upload line').toHaveCount(0);
    await expect(page.locator('[aria-current="step"]'), 'nothing is current: every step is done').toHaveCount(0);
  });

  // -------------------------------------------------------------- AC-4
  test('AC-4 getMyStart answers the caller\'s own step, whatever else is sent; the group first; the verified email; one Query and one GetItem; the company; HR\'s route stays closed to the employee', async ({}, testInfo) => {
    onceOnly(testInfo);
    test.setTimeout(4 * 60_000);

    // The step is stepOf of the caller's own row, for each stored step and each stage's fallback.
    for (const row of ROWS) {
      const run = askAs('getMyStart', employeeClaims(), {}, withRow(EMP.a1, stored(row.step, row.stage)));
      expect(run.response?.statusCode, `${row.what}: answers (${describeRun(run)})`).toBe(200);
      const body = bodyOf(run) as Record<string, unknown>;
      expect('step' in body, `${row.what}: the answer carries a step key`).toBe(true);
      expect(body['step'], `${row.what}`).toBe(row.want);
      // The answer is otherwise ONB-05's: the same six fields (documentsDue only with a start date) and nothing private.
      expect(Object.keys(body).filter((k) => !['firstName', 'company', 'department', 'startDate', 'documentsDue', 'notice', 'consent', 'step'].includes(k)), `${row.what}: no other field`).toEqual([]);
    }
    // The table the test used is the one stored rows are read with.
    for (const [stage, want] of Object.entries(FROM_STAGE)) expect(ROWS.some((r) => r.step === undefined && r.stage === stage && r.want === want), `the rows cover stage ${stage}`).toBe(true);

    // The caller's own step, whoever else the request names: query, body, path; email or id.
    const t = withRow(EMP.a1, stored('DOCUMENTS', 'ACTIVE'), withRow(EMP.a2, stored('VERIFIED', 'VERIFIED'), withRow(EMP.b1, stored('IN_REVIEW', 'DOCUMENTS_SUBMITTED'))));
    const own = askAs('getMyStart', employeeClaims(), {}, t);
    expect((bodyOf(own) as Record<string, unknown>)['step'], 'A\'s employee: DOCUMENTS').toBe('DOCUMENTS');
    const trick = { employee_id: EMP.a2, id: EMP.a2, email: MAIL.a2, employeeId: EMP.b1, step: 'VERIFIED' };
    for (const [what, a] of [
      ['a query naming another person', { query: trick }],
      ['a body naming another person', { method: 'GET', body: trick }],
      ['a path naming another person', { path: { id: EMP.a2, employee_id: EMP.a2 } }],
      ['a query naming a person of the other company', { query: { employee_id: EMP.b1, email: MAIL.b1, id: EMP.b1 } }],
    ] as const) {
      const run = askAs('getMyStart', employeeClaims(), a, t);
      expect(run.response?.statusCode, `${what}: still answers the caller (${describeRun(run)})`).toBe(200);
      expect(bodyOf(run), `${what}: the same answer as with nothing sent`).toEqual(bodyOf(own));
    }
    // A caller whose token carries a different employee id claim still gets the row their email finds.
    const other = askAs('getMyStart', employeeClaims({ 'custom:employee_id': EMP.a2 }), {}, t);
    expect((bodyOf(other) as Record<string, unknown>)['step'], 'the step comes from the email\'s row, never from a claim naming someone else').toBe('DOCUMENTS');

    // The group comes first: nothing is read for anyone who is not an employee.
    const refused: Array<[string, unknown]> = [
      ['no claims at all', undefined],
      ['an HR token', hr()],
      ['an HR token carrying the employee\'s email', jwtAuthorizer({ sub: SUB.hrA, email: MAIL.a1, email_verified: 'true', 'cognito:groups': '[hr_staff]', 'custom:staff_id': 'HRA001', tenant_id: A })],
      ['an HR token with no company', jwtAuthorizer({ sub: SUB.hrA, email: MAIL.hrA, email_verified: 'true', 'cognito:groups': '[hr_staff]' })],
      ['a token in no group', employeeClaims({ 'cognito:groups': '[]' })],
      ['a token in another group (contractor)', employeeClaims({ 'cognito:groups': '[contractor]' })],
      ['a token in groups whose names only contain "employee"', employeeClaims({ 'cognito:groups': '[employees new-employee]' })],
    ];
    for (const [what, authorizer] of refused) {
      const run = askAs('getMyStart', authorizer, {}, t);
      expect(run.response?.statusCode, `${what}: 403 (${describeRun(run)})`).toBe(403);
      expect(bodyOf(run), `${what}: the words`).toEqual({ error: NOT_EMPLOYEE });
      expect(dynamoOps(run), `${what}: no DynamoDB call before the group check`).toEqual([]);
    }
    // A verified email is needed to find the record: nothing is read before this either (ONB-05's order, unchanged).
    for (const verified of ['false', undefined]) {
      const run = askAs('getMyStart', employeeClaims({ email_verified: verified }), {}, t);
      expect(run.response?.statusCode, `email_verified ${String(verified)}: 404 (${describeRun(run)})`).toBe(404);
      expect(bodyOf(run), `email_verified ${String(verified)}: the words`).toEqual({ error: "We can't find your record. Ask your HR team." });
      expect(dynamoOps(run), `email_verified ${String(verified)}: nothing read`).toEqual([]);
    }

    // Found through the email index and the consent row, no Scan: one Query on email-index, one GetItem on employee_consents.
    const calls = dynamoCalls(own);
    expect(calls.map((c) => c.op), 'exactly a Query then a GetItem').toEqual(['Query', 'GetItem']);
    expect(calls[0]!.table, 'the Query is on employees').toBe('employees');
    expect(calls[0]!.input.IndexName, 'on email-index').toBe('email-index');
    expect(calls[1]!.table, 'the GetItem is on employee_consents').toBe('employee_consents');
    expect(calls.filter((c) => c.op === 'Scan'), 'no Scan').toEqual([]);

    // The company: a person of company B whose email matches a row of company A gets 404, never A's step.
    const crossed = askAs('getMyStart', employeeClaims({ tenant_id: B }), {}, t);
    expect(crossed.response?.statusCode, `company B's token with a company A email (${describeRun(crossed)})`).toBe(404);
    expect(bodyOf(crossed), 'the same words as no record').toEqual({ error: "We can't find your record. Ask your HR team." });
    expect(JSON.stringify(bodyOf(crossed)), 'nothing of A\'s row').not.toMatch(/step|DOCUMENTS|John/);
    // And a person of company B with their own row gets their own step, not A's.
    const bea = askAs('getMyStart', jwtAuthorizer({ sub: SUB.b1, email: MAIL.b1, email_verified: 'true', 'cognito:groups': '[employee]', 'custom:employee_id': EMP.b1, tenant_id: B }), {}, t);
    expect(bea.response?.statusCode, `B's employee (${describeRun(bea)})`).toBe(200);
    expect((bodyOf(bea) as Record<string, unknown>)['step'], 'B\'s employee: IN_REVIEW, B\'s own row').toBe('IN_REVIEW');
    expect((bodyOf(bea) as Record<string, unknown>)['firstName'], 'B\'s own first name').toBe('Bea');

    // BE-17, today's code: an employee's token on the HR route for someone else's verifications is refused.
    for (const id of [EMP.a2]) {
      const run = askAs('getEmployeeDocumentVerifications', employeeClaims(), { path: { id } }, t);
      expect(run.response?.statusCode, `an employee asking for ${id}'s verifications: 403 (${describeRun(run)})`).toBe(403);
    }
  });

  test('AC-4 No employee page calls any /v1/employees route; the person is never asked for an id', async ({ page, signIn, employee, me, myDocuments, watch, appOrigin }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    await arrive(fx, { step: 'DOCUMENTS', documents: docs('NOT_UPLOADED', 'NOT_UPLOADED') });
    for (const [step, documents] of [
      ['DOCUMENTS', docs('WITH_HR', 'NOT_UPLOADED')],
      ['IN_REVIEW', docs('WITH_HR', 'WITH_HR')],
      ['VERIFIED', docs('ACCEPTED', 'ACCEPTED')],
      [null, docs('NOT_UPLOADED', 'NOT_UPLOADED')],
    ] as const) {
      (me!.people.get(employee.email) as StepPerson).step = step;
      myDocuments!.answer = documents;
      await open(page);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await page.goto('/start');
      await expect(page.getByRole('heading', { level: 1, name: `Welcome, ${employee.givenName}`, exact: true })).toBeVisible();
    }
    const calls = watch.apiCalls(appOrigin);
    expect(calls.length, 'the pages asked for /v1/me').toBeGreaterThan(0);
    expect(calls.filter((c) => !/^GET \/v1\/me(\/documents)?$/.test(c)), 'only the person\'s own two routes').toEqual([]);
    expect(calls.filter((c) => /\/v1\/employees/.test(c)), 'no /v1/employees route').toEqual([]);
    const asked = watch.requests.filter((r) => /\/v1\/me/.test(r.url) && r.method !== 'OPTIONS');
    expect(asked.filter((r) => new URL(r.url).search !== ''), 'GET /v1/me and /v1/me/documents are asked with no id and no query').toEqual([]);
    expect(me!.calls.filter((c) => c.method === 'GET' && c.body !== null), 'and no body').toEqual([]);
  });

  // -------------------------------------------------------------- AC-5
  test('AC-5 The page follows the step the API gives, not its own reading of the documents', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };

    // Screen: step IN_REVIEW and both required documents not uploaded. The page follows the step.
    await arrive(fx, { step: 'IN_REVIEW', documents: docs('NOT_UPLOADED', 'NOT_UPLOADED') });
    await open(page);
    await expectFrame(page, 'IN_REVIEW', 'step IN_REVIEW over empty documents');
    await expect(message(page, LEFT.checkingTitle).first(), 'it says "Your documents are being checked"').toBeVisible();
    await expect(anyUpload(page), 'it lists no upload link').toHaveCount(0);
    await expect(page.getByText(LEFT.both), 'and no upload line').toHaveCount(0);
    // And the other way round: step DOCUMENTS over documents that are all accepted. It does not make itself Verified.
    (me!.people.get(employee.email) as StepPerson).step = 'DOCUMENTS';
    myDocuments!.answer = docs('ACCEPTED', 'ACCEPTED');
    await open(page);
    await expectFrame(page, 'DOCUMENTS', 'step DOCUMENTS over accepted documents');
    await expect(page.getByText(LEFT.verified), 'it does not say Verified').toHaveCount(0);
    // And VERIFIED over documents still with HR.
    (me!.people.get(employee.email) as StepPerson).step = 'VERIFIED';
    myDocuments!.answer = docs('NOT_UPLOADED', 'SENT_BACK');
    await open(page);
    await expectFrame(page, 'VERIFIED', 'step VERIFIED over documents not in');
    await expect(message(page, LEFT.verified).first()).toBeVisible();
    await expect(anyUpload(page)).toHaveCount(0);
  });

  test('AC-5 getMyStart answers the step HR sees for the same row (getEmployees and getEmployeeDocumentVerifications), and has no step table of its own', async ({}, testInfo) => {
    onceOnly(testInfo);
    test.setTimeout(4 * 60_000);

    for (const row of ROWS) {
      const t = withRow(EMP.a1, stored(row.step, row.stage));
      const mine = askAs('getMyStart', employeeClaims(), {}, t);
      const hrs = hrSees(EMP.a1, t);
      expect(mine.response?.statusCode, `${row.what}: getMyStart (${describeRun(mine)})`).toBe(200);
      const step = (bodyOf(mine) as Record<string, unknown>)['step'];
      expect(hrs.listRun.response?.statusCode, `${row.what}: getEmployees (${describeRun(hrs.listRun)})`).toBe(200);
      expect(hrs.detailRun.response?.statusCode, `${row.what}: getEmployeeDocumentVerifications (${describeRun(hrs.detailRun)})`).toBe(200);
      expect(hrs.list, `${row.what}: getEmployees answers the same step`).toBe(step);
      expect(hrs.detail, `${row.what}: getEmployeeDocumentVerifications answers the same step`).toBe(step);
      expect(step, `${row.what}`).toBe(row.want);
    }

    // Text: the same function, imported from the one shared file; no table, no stage names, no document reading in getMyStart.
    const source = readFileSync(join(REPO, 'lambda', 'getMyStart', 'index.mjs'), 'utf8');
    const text = stripComments(source);
    expect(text, 'getMyStart imports stepOf from ../shared/onboarding-step.mjs').toMatch(/import\s*\{[^}]*\bstepOf\b[^}]*\}\s*from\s*['"]\.\.\/shared\/onboarding-step\.mjs['"]/);
    expect(text, 'and calls it').toMatch(/\bstepOf\s*\(/);
    expect(text, 'the answer has a step key').toMatch(/(^|[\s,{])step\s*[:,]/m);
    for (const word of ['INVITED', 'DOCUMENTS', 'IN_REVIEW', 'VERIFIED', 'DOCUMENTS_SUBMITTED', 'TRAINING', 'ONBOARDED', 'ACTIVE', 'ARCHIVED', 'STEP_OF_STAGE', 'stepFromDocuments']) {
      expect(text.includes(word), `getMyStart has no step table of its own (it names ${word})`).toBe(false);
    }
    expect(text, 'getMyStart does not read the documents to work out a step').not.toMatch(/allRequiredIn|verifiedReady|required-documents/);
    expect(text, 'getMyStart reads the step from the row it already has: no new read').not.toMatch(/new\s+(Query|Scan|GetItem|BatchGet)\w*Command/);

    // pepla-web: no stage-to-step table anywhere in src, as ONB-09 AC-5.
    const found: string[] = [];
    for (const f of withoutGeneratedApiTypes(walk(join(WEB, 'src'))).filter((p) => /\.(ts|html|scss|css|json)$/.test(p))) {
      const body = readFileSync(f, 'utf8');
      for (const word of ['TRAINING', 'ONBOARDED', 'DOCUMENTS_SUBMITTED', 'stepOfStage']) if (body.includes(word)) found.push(`${rel(f)}: ${word}`);
    }
    expect(found, 'pepla-web/src holds none of TRAINING, ONBOARDED, DOCUMENTS_SUBMITTED, stepOfStage').toEqual([]);
  });

  // -------------------------------------------------------------- AC-6
  test('AC-6 Today\'s tracker stops saying "Upload your ID and your bank letter." once the documents are in; with step DOCUMENTS or none it is exactly as ONB-05 made it', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    const items = (p: Page) => todayTracker(p).getByRole('listitem');
    const read = async (i: number) => ((await items(page).nth(i).textContent()) ?? '').replace(/\s+/g, ' ').trim();

    // Documents in: Consent done, Documents done with the kit's line, and no upload line.
    for (const [step, documents] of [['IN_REVIEW', docs('WITH_HR', 'WITH_HR')], ['VERIFIED', docs('ACCEPTED', 'ACCEPTED')]] as const) {
      await arrive(fx, { step, documents });
      await expect(todayTracker(page), `${step}: Today's tracker "${TODAY_TRACKER}"`).toBeVisible();
      await expect(items(page), `${step}: Today's tracker keeps its two steps`).toHaveCount(2);
      expect(await read(0), `${step}: Consent is done`).toMatch(/^Done: Consent/);
      expect(await read(1), `${step}: Documents is done, with "${META.documentsDone}"`).toMatch(/^Done: Documents\s*Your ID and bank letter are in\.$/);
      await expect(items(page).nth(1), `${step}: Documents is not the current step`).not.toHaveAttribute('aria-current', /.+/);
      await expect(page.getByText(TODAY_DOCS_META, { exact: true }), `${step}: no "${TODAY_DOCS_META}"`).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1, name: `Welcome, ${employee.givenName}`, exact: true })).toBeVisible();
      await forgetSignIn(page);
    }

    // Step DOCUMENTS, none, INVITED or null: exactly what ONB-05 AC-1 to AC-3 check.
    for (const step of ['DOCUMENTS', 'absent', 'INVITED', null] as const) {
      await arrive(fx, { step, documents: docs('NOT_UPLOADED', 'NOT_UPLOADED') });
      await expect(items(page), `step ${String(step)}: two steps`).toHaveCount(2);
      expect(await read(0), `step ${String(step)}: Consent is done`).toMatch(/^Done: Consent/);
      expect(await read(1), `step ${String(step)}: Documents is the current step with the ONB-05 line`).toMatch(/^Current step: Documents\s*Upload your ID and your bank letter\.$/);
      await expect(items(page).nth(1)).toHaveAttribute('aria-current', 'step');
      await forgetSignIn(page);
    }

    // Before consent, whatever the step: Consent current, Documents not started; Today is as ONB-05 made it.
    await arrive(fx, { step: 'DOCUMENTS', consent: false });
    await expect(items(page)).toHaveCount(2);
    expect(await read(0), 'before consent: Consent is the current step').toMatch(/^Current step: Consent/);
    expect(await read(1), 'before consent: Documents is not started').toMatch(/^Not started: Documents/);
    await expect(page.getByRole('link', { name: /upload|documents/i }), 'before consent: no upload or documents link on Today').toHaveCount(0);
  });

  // -------------------------------------------------------------- AC-7
  test('AC-7 The frame: two sidebar links, Today then My onboarding, on every employee page; the open page is marked; HR\'s sidebar is as it was; HR and signed-out are sent away', async ({ page, signIn, employee, hr: hrLogin, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };

    // Signed out: the page is behind the sign-in.
    await page.goto(ONBOARDING);
    await expect(page, 'signed out: /start/onboarding lands on /sign-in').toHaveURL(ON_SIGN_IN);

    await arrive(fx, { step: 'DOCUMENTS', documents: docs('WITH_HR', 'NOT_UPLOADED') });
    const links = () => sidebar(page).getByRole('link');
    const expectTwo = async (path: string, current: 'Today' | 'My onboarding' | null) => {
      await openSidebar(page);
      await expect(links(), `${path}: exactly two sidebar links`).toHaveCount(2);
      await expect(links().nth(0), `${path}: the first is Today`).toHaveAccessibleName('Today');
      await expect(links().nth(1), `${path}: the second is My onboarding`).toHaveAccessibleName(NAV_LABEL);
      expect(await links().nth(0).getAttribute('href'), `${path}: Today is /start`).toMatch(/^\/start\/?$/);
      expect(await links().nth(1).getAttribute('href'), `${path}: My onboarding is /start/onboarding`).toBe(ONBOARDING);
      // The open page's link is marked. (The shell also marks Today on every page under /start, as it marks HR's Today on
      // /hr/documents; the spec says only that the open page's link carries aria-current="page", so that is all this checks.)
      if (current) await expect(links().nth(current === 'Today' ? 0 : 1), `${path}: ${current} is the open page`).toHaveAttribute('aria-current', 'page');
      if (path === '/start') await expect(links().nth(1), `${path}: My onboarding is not the open page`).not.toHaveAttribute('aria-current', 'page');
      await expect(sidebar(page).getByRole('link', { name: /documents/i }), `${path}: no Documents item (Q6)`).toHaveCount(0);
      await expect(sidebar(page).getByRole('link', { name: /details|help/i }), `${path}: no My details or Help item`).toHaveCount(0);
    };
    await expectTwo('/start', 'Today');
    await page.goto(ONBOARDING);
    await expect(header(page)).toBeVisible();
    await expectTwo(ONBOARDING, NAV_LABEL);
    for (const path of ['/start/privacy-notice', '/start/documents/national-id']) {
      await page.goto(path);
      await expect(heading1(page).first()).toBeVisible();
      await expectTwo(path, null);
    }
    // The link works from Today and from this page.
    await page.goto('/start');
    await openSidebar(page);
    await links().nth(1).click();
    await expect(page).toHaveURL(ONBOARDING_URL);
    await expect(header(page)).toBeVisible();
    await page.reload();
    await expect(header(page)).toBeVisible();
    await openSidebar(page);
    await links().nth(0).click();
    await expect(page).toHaveURL(START);

    // Before consent Today still shows no link to upload or documents (the sidebar's two items are not those).
    me!.people.set(employee.email, { ...(me!.people.get(employee.email) as StepPerson), consents: {} });
    await page.goto('/start');
    await expect(page.getByRole('heading', { level: 1, name: `Welcome, ${employee.givenName}`, exact: true })).toBeVisible();
    await openSidebar(page);
    await expect(page.getByRole('link', { name: /upload|documents/i }), 'before consent: no link matching /upload|documents/i anywhere on /start').toHaveCount(0);

    // HR: the sidebar is as it was, and My onboarding is not in it. The page sends HR home.
    await forgetSignIn(page);
    await signIn.open();
    await signIn.signInAs(hrLogin);
    await expect(page).toHaveURL(new RegExp(`${HR_HOME}$`), { timeout: 20_000 });
    await openSidebar(page);
    await expect(links(), 'HR: two items, as MOD-02 froze them').toHaveText(['Today', 'Documents to check']);
    await expect(sidebar(page).getByRole('link', { name: NAV_LABEL }), 'HR: no My onboarding').toHaveCount(0);
    await page.goto(ONBOARDING);
    await expect(page, 'HR: /start/onboarding lands on /hr').toHaveURL(new RegExp(`${HR_HOME}$`));
    await openSidebar(page);
    await expect(links(), 'HR: still the same two items').toHaveText(['Today', 'Documents to check']);
  });

  test('AC-7 The sidebar item is one entry in the core/nav.ts registry, in the employee shell\'s own list, not a line in the shell', async ({}, testInfo) => {
    onceOnly(testInfo);
    const nav = stripComments(readFileSync(join(APP, 'core', 'nav.ts'), 'utf8'));
    const entries = [...nav.matchAll(/\{\s*id\s*:\s*'([^']+)'[^{}]*\}/g)].map((m) => ({ id: m[1]!, text: m[0] }));
    const mine = entries.filter((e) => /\/start\/onboarding/.test(e.text));
    expect(mine.map((e) => e.id), 'one registry entry for /start/onboarding').toEqual(['employee-onboarding']);
    const e = mine[0]!.text;
    expect(e, 'group Today').toMatch(/group\s*:\s*'Today'/);
    expect(e, `label "${NAV_LABEL}"`).toMatch(/label\s*:\s*'My onboarding'/);
    expect(e, 'icon list-checks').toMatch(/icon\s*:\s*'list-checks'/);
    expect(e, 'route /start/onboarding').toMatch(/route\s*:\s*'\/start\/onboarding'/);
    expect(e, 'employees only').toMatch(/roles\s*:\s*\[\s*(ROLE\.employee|'employee')\s*\]/);
    expect(e, 'no module, no permission').not.toMatch(/module\s*:|perms\s*:|allOf\s*:/);
    const order = entries.map((x) => x.id);
    expect(order.indexOf('employee-today'), 'Today comes first').toBeGreaterThanOrEqual(0);
    expect(order.indexOf('employee-today'), 'and My onboarding after it').toBeLessThan(order.indexOf('employee-onboarding'));
    expect(entries.filter((x) => /roles\s*:\s*\[\s*(ROLE\.hrStaff|'hr_staff')/.test(x.text) && /onboarding/i.test(x.text)), 'HR\'s entries do not name My onboarding').toEqual([]);
    expect(entries.filter((x) => /roles\s*:\s*\[\s*(ROLE\.employee|'employee')/.test(x.text)).map((x) => x.id), 'the employee has exactly these two entries').toEqual(['employee-today', 'employee-onboarding']);

    const shell = stripComments(readFileSync(join(APP, 'features', 'start', 'employee-shell.ts'), 'utf8'));
    expect(shell, 'the shell has no line of its own for the page').not.toMatch(/start\/onboarding|My onboarding|list-checks/);
    expect(shell, 'the shell still builds its sidebar from the registry').toMatch(/navEntries\s*\(/);
  });

  // -------------------------------------------------------------- AC-8
  test('AC-8 Failures said plainly: the server\'s words and no steps; the connection words with Try again; only the documents failing keeps the steps; no step says so', async ({ page, signIn, employee, me, myDocuments }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    await arrive(fx, { step: 'DOCUMENTS', documents: docs('WITH_HR', 'NOT_UPLOADED') });
    const noSteps = async (what: string) => {
      await expect(bar(page), `${what}: no bar`).toHaveCount(0);
      await expect(tracker(page), `${what}: no tracker`).toHaveCount(0);
      await expect(page.getByText(/^Step \d of 4/), `${what}: no step line`).toHaveCount(0);
    };

    // 403 and 404 on GET /v1/me: the server's words.
    for (const [status, words] of [[403, NOT_EMPLOYEE], [404, NOT_FOUND]] as const) {
      me!.nextGets.push({ status, body: { error: words } });
      await open(page);
      await expect(page.getByRole('alert').filter({ hasText: words }), `${status}: the server's words`).toBeVisible();
      await noSteps(`${status}`);
      await expect(anyUpload(page), `${status}: no upload link`).toHaveCount(0);
    }
    // 5xx and no answer: the connection words and Try again, which asks once.
    for (const canned of [{ status: 500, body: { error: 'Something went wrong' } }, 'offline'] as const) {
      const what = canned === 'offline' ? 'no answer' : `${canned.status}`;
      me!.nextGets.push(canned);
      await open(page);
      await expect(page.getByText(OFFLINE, { exact: true }), `${what}: the connection words`).toBeVisible();
      await noSteps(what);
      await expect(tryAgain(page), `${what}: Try again`).toBeVisible();
      const before = me!.gets().length;
      const docsBefore = myDocuments!.gets().length;
      await tryAgain(page).click();
      await expect(bar(page), `${what}: after Try again the steps show`).toBeVisible();
      await expect(tracker(page)).toBeVisible();
      expect(me!.gets().length - before, `${what}: Try again sent one GET /v1/me`).toBe(1);
      expect(myDocuments!.gets().length - docsBefore, `${what}: and the documents were asked once`).toBeLessThanOrEqual(1);
    }

    // Only the documents call fails: the steps show, and the left section says so, with Try again that asks for the documents once.
    for (const canned of [{ status: 500, body: { error: 'Something went wrong' } }, 'offline'] as const) {
      const what = canned === 'offline' ? 'documents: no answer' : 'documents: 500';
      myDocuments!.nextGets.push(canned);
      await open(page);
      await expectFrame(page, 'DOCUMENTS', what);
      await expect(message(page, OFFLINE).first(), `${what}: the connection words in the left section`).toBeVisible();
      await expect(tryAgain(page), `${what}: Try again`).toBeVisible();
      await expect(anyUpload(page), `${what}: no upload link until the list is known`).toHaveCount(0);
      const meBefore = me!.gets().length;
      const docsBefore = myDocuments!.gets().length;
      await tryAgain(page).click();
      await expect(upload(page, UPLOAD_BANK), `${what}: after Try again the left section shows`).toBeVisible();
      expect(myDocuments!.gets().length - docsBefore, `${what}: Try again sent one GET /v1/me/documents`).toBe(1);
      expect(me!.gets().length - meBefore, `${what}: and no GET /v1/me`).toBe(0);
      await expectFrame(page, 'DOCUMENTS', `${what}, after`);
    }

    // No step: the words of ONB-05, no bar, no tracker.
    (me!.people.get(employee.email) as StepPerson).step = null;
    await open(page);
    await expect(page.getByText(NOT_FOUND, { exact: true }), 'step null: "We can\'t find your record. Ask your HR team."').toBeVisible();
    await noSteps('step null');
    await expect(anyUpload(page), 'step null: no upload link').toHaveCount(0);
    await expect(page.getByText(/%|of 4 steps done/), 'step null: no progress words').toHaveCount(0);
  });

  // -------------------------------------------------------------- AC-9
  test('AC-9 Keyboard and screen reader: the skip link, Tab reaches every link, the bar and the tracker are named, the current step is marked, axe finds nothing serious', async ({ page, signIn, employee, me, myDocuments }, testInfo) => {
    noBackendOnly();
    test.setTimeout(3 * 60_000);
    const fx = { page, signIn, employee, me, myDocuments };
    const serious = async (what: string) => {
      const results = await new AxeBuilder({ page }).analyze();
      const bad = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help} :: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
      expect(bad, `axe on ${what}`).toEqual([]);
    };
    const states: Array<[string, StepValue, ListAnswer, boolean]> = [
      ['Documents, both missing', 'DOCUMENTS', docs('NOT_UPLOADED', 'NOT_UPLOADED'), true],
      ['Documents, a bank letter sent back', 'DOCUMENTS', docs('WITH_HR', 'SENT_BACK'), true],
      ['In review', 'IN_REVIEW', docs('WITH_HR', 'WITH_HR'), true],
      ['Verified', 'VERIFIED', docs('ACCEPTED', 'ACCEPTED'), true],
      ['Invited', 'INVITED', docs('NOT_UPLOADED', 'NOT_UPLOADED'), true],
      ['before consent', 'DOCUMENTS', docs('NOT_UPLOADED', 'NOT_UPLOADED'), false],
      ['no step', null, docs('NOT_UPLOADED', 'NOT_UPLOADED'), true],
    ];

    await arrive(fx, { step: 'DOCUMENTS', documents: states[0]![2] });
    for (const [what, step, documents, consent] of states) {
      const person = me!.people.get(employee.email) as StepPerson;
      person.step = step;
      person.consents = consent ? { [VERSION]: ACCEPTED_AT } : {};
      myDocuments!.answer = documents;
      await open(page);
      await expect(page.getByRole('heading', { level: 1 }).first(), `${what}: the page is up`).toBeVisible();
      if (step) await expect(bar(page)).toBeVisible();
      else await expect(page.getByText(NOT_FOUND, { exact: true })).toBeVisible();
      await serious(what);
      await expect(heading1(page), `${what}: one level-one heading`).toHaveCount(1);
      if (step) {
        // The bar has a name and a value in words; the tracker is a list with a name and the current step marked.
        await expect(bar(page), `${what}: the bar's name`).toHaveAccessibleName(BAR_LABEL);
        await expect(bar(page), `${what}: the bar's value text`).toHaveAccessibleDescription(doneText(step));
        await expect(tracker(page), `${what}: the tracker is a list named "${CARD}"`).toBeVisible();
        await expect(tracker(page).locator('[aria-current="step"]'), `${what}: the current step is marked`).toHaveCount(TABLE[step].marks.includes('current') ? 1 : 0);
        // Every state is also in words for a screen reader: each step says Done, Current step or Not started.
        for (let i = 0; i < 4; i++) expect((await readStep(page, i)).state, `${what}: step ${i + 1} says its state in words`).toBe(WORDS_BEFORE[TABLE[step].marks[i]!]);
      }
    }

    // Keyboard only (at the desktop width, where the sidebar is open): the skip link first, then every link.
    if (testInfo.project.name === 'desktop-1280') {
      const person = me!.people.get(employee.email) as StepPerson;
      person.step = 'DOCUMENTS';
      person.consents = { [VERSION]: ACCEPTED_AT };
      myDocuments!.answer = docs('NOT_UPLOADED', 'NOT_UPLOADED');
      await open(page);
      await expect(upload(page, UPLOAD_ID)).toBeVisible();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const stops: string[] = [];
      for (let i = 0; i < 60; i++) {
        await page.keyboard.press('Tab');
        stops.push(await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return el ? (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim() : '';
        }));
      }
      expect(stops[0], 'the first Tab reaches the skip link').toBe('Skip to main content');
      for (const name of ['Today', NAV_LABEL, UPLOAD_ID, UPLOAD_BANK]) expect(stops, `Tab reaches "${name}"`).toContain(name);
      // The skip link reaches the main area (on a fresh load, as a person arrives).
      await open(page);
      await expect(upload(page, UPLOAD_ID)).toBeVisible();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Skip to main content', exact: true })).toBeFocused();
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => !!document.activeElement?.closest('main')), 'Enter moves focus into the main area').toBe(true);
      // A link works from the keyboard.
      const target = upload(page, UPLOAD_BANK);
      for (let i = 0; i < 40 && !(await target.evaluate((el) => el === document.activeElement).catch(() => false)); i++) await page.keyboard.press('Tab');
      await expect(target, 'Tab reaches Upload bank letter').toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/start\/documents\/bank-letter$/);
    }
  });

  // -------------------------------------------------------------- AC-10
  test('AC-10 Phone: My onboarding in every state, and Today with the documents in, fit 390 wide; links and buttons at least 44 pixels tall; the drawer shows both items', async ({ page, signIn, employee, me, myDocuments }, testInfo) => {
    noBackendOnly();
    test.skip(testInfo.project.name !== 'phone-390', 'The phone criterion: runs at 390 wide.');
    test.setTimeout(3 * 60_000);
    const fx = { page, signIn, employee, me, myDocuments };

    const check = async (what: string, parts: Locator[]) => {
      const viewport = page.viewportSize()!;
      const scroll = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
      expect(scroll.doc, `${what}: no sideways scroll`).toBeLessThanOrEqual(scroll.win);
      for (const part of parts) {
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
      // Every link and button in the page's own area is at least 44 pixels tall.
      // (ONB-05's own "Read the privacy notice" link is not this card's and is left alone.)
      const hit = page.locator('main').getByRole('link').or(page.locator('main').getByRole('button'));
      for (const target of await hit.all()) {
        if (/privacy notice/i.test((await target.textContent()) ?? '')) continue;
        await target.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
        expect((await target.boundingBox())!.height, `${what}: "${clearOf((await target.textContent()) ?? '')}" at least 44 pixels tall`).toBeGreaterThanOrEqual(44);
      }
    };
    const frame = (step: StepCode): Locator[] => [
      header(page), page.getByText(stepLine(step), { exact: true }), bar(page), page.getByText(doneText(step), { exact: true }), cardHeading(page), ...[0, 1, 2, 3].map((i) => stepItems(page).nth(i)),
    ];

    await arrive(fx, { step: 'DOCUMENTS', documents: docs('NOT_UPLOADED', 'NOT_UPLOADED') });
    const states: Array<[string, StepValue, boolean, ListAnswer, () => Locator[]]> = [
      ['Documents, both missing', 'DOCUMENTS', true, docs('NOT_UPLOADED', 'NOT_UPLOADED'), () => [...frame('DOCUMENTS'), message(page, LEFT.both).first(), upload(page, UPLOAD_ID), upload(page, UPLOAD_BANK)]],
      ['Documents, bank letter sent back', 'DOCUMENTS', true, docs('WITH_HR', 'SENT_BACK'), () => [...frame('DOCUMENTS'), message(page, LEFT.bank).first(), upload(page, UPLOAD_BANK), page.getByText(LEFT.needsNewCopy, { exact: true })]],
      ['In review', 'IN_REVIEW', true, docs('WITH_HR', 'WITH_HR'), () => [...frame('IN_REVIEW'), page.getByRole('heading', { name: LEFT.checkingTitle, exact: true }), page.getByText(LEFT.checkingBody, { exact: true })]],
      ['Verified', 'VERIFIED', true, docs('ACCEPTED', 'ACCEPTED'), () => [...frame('VERIFIED'), message(page, LEFT.verified).first()]],
      ['Invited', 'INVITED', true, docs('NOT_UPLOADED', 'NOT_UPLOADED'), () => frame('INVITED')],
      ['before consent', 'DOCUMENTS', false, docs('NOT_UPLOADED', 'NOT_UPLOADED'), () => [...frame('DOCUMENTS'), page.getByText(LEFT.consent, { exact: true }), page.getByRole('link', { name: LEFT.goToday, exact: true })]],
      ['no step', null, true, docs('NOT_UPLOADED', 'NOT_UPLOADED'), () => [page.getByText(NOT_FOUND, { exact: true })]],
    ];
    for (const [what, step, consent, documents, parts] of states) {
      const person = me!.people.get(employee.email) as StepPerson;
      person.step = step;
      person.consents = consent ? { [VERSION]: ACCEPTED_AT } : {};
      myDocuments!.answer = documents;
      await open(page);
      if (step) await expect(bar(page)).toBeVisible();
      else await expect(page.getByText(NOT_FOUND, { exact: true })).toBeVisible();
      await check(what, parts());
    }

    // Today with the documents in.
    const person = me!.people.get(employee.email) as StepPerson;
    person.step = 'IN_REVIEW';
    person.consents = { [VERSION]: ACCEPTED_AT };
    myDocuments!.answer = docs('WITH_HR', 'WITH_HR');
    await page.goto('/start');
    await expect(todayTracker(page)).toBeVisible();
    await check('Today with the documents in', [
      page.getByRole('heading', { level: 1, name: `Welcome, ${employee.givenName}`, exact: true }),
      todayTracker(page).getByRole('listitem').nth(0),
      todayTracker(page).getByRole('listitem').nth(1),
      page.getByText(META.documentsDone, { exact: true }),
    ]);

    // The drawer shows both items, inside the screen.
    await page.goto(ONBOARDING);
    await expect(header(page)).toBeVisible();
    await openSidebar(page);
    const links = sidebar(page).getByRole('link');
    await expect(links).toHaveText(['Today', NAV_LABEL]);
    const viewport = page.viewportSize()!;
    for (let i = 0; i < 2; i++) {
      const b = (await links.nth(i).boundingBox())!;
      expect(b.x, `drawer item ${i + 1}: left edge`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `drawer item ${i + 1}: right edge`).toBeLessThanOrEqual(viewport.width);
      expect(b.y + b.height, `drawer item ${i + 1}: bottom`).toBeLessThanOrEqual(viewport.height);
      expect(b.height, `drawer item ${i + 1}: at least 44 pixels tall`).toBeGreaterThanOrEqual(44);
    }
  });

  // -------------------------------------------------------------- AC-11
  test('AC-11 Text check: the route behind employeeGuard with its title, step in the OpenAPI, no new route, role, IAM line, KMS entry or header, pp-* only, the words, no paid AI', async ({}, testInfo) => {
    onceOnly(testInfo);
    test.setTimeout(3 * 60_000);

    // The route: under /start, behind employeeGuard, with the title.
    const routes = readFileSync(join(APP, 'app.routes.ts'), 'utf8');
    const start = routeBlock(routes, 'start');
    expect(start, 'app.routes.ts has a start route').not.toBeNull();
    expect(start!, '/start is behind employeeGuard').toMatch(/canActivate\s*:\s*\[\s*employeeGuard\s*\]/);
    const nested = routeBlock(start!, 'onboarding');
    const flat = routeBlock(routes, 'start/onboarding');
    const mine = nested ?? flat;
    expect(mine, 'a route /start/onboarding').not.toBeNull();
    expect(mine!, `the title "${TITLE}"`).toMatch(/title\s*:\s*['"`]My onboarding · Naleko People['"`]/);
    if (!nested) expect(flat!, '/start/onboarding is behind employeeGuard').toMatch(/canActivate\s*:\s*\[\s*employeeGuard\s*\]/);
    expect(routes.match(/path\s*:\s*['"`](start\/)?onboarding['"`]/g)?.length, 'one route for the page').toBe(1);

    // The OpenAPI: step on GET /v1/me 200, the four codes, may be null. And the person's routes are the four there were.
    const openapi = JSON.parse(execFileSync('python3', [join(HERE, 'support', 'onb-19', 'openapi_step.py'), join(REPO, 'api', 'openapi.yaml'), '/v1/me', 'get', '200', 'step'], { encoding: 'utf8' })) as { found: boolean; type?: unknown; nullable?: boolean; enum?: unknown[]; paths: string[] };
    expect(openapi.found, 'api/openapi.yaml: GET /v1/me 200 has a `step` property').toBe(true);
    expect(openapi.type, 'step is text').toBe('string');
    expect([...(openapi.enum ?? [])].filter((v) => v !== null).sort(), 'step is one of the four codes').toEqual([...STEP_CODES].sort());
    expect(openapi.nullable || (openapi.enum ?? []).includes(null), 'step may be null').toBe(true);
    expect(openapi.paths, 'no new /v1/me route in the OpenAPI').toEqual(['/v1/me', '/v1/me/consent', '/v1/me/documents', '/v1/me/documents/upload-url']);

    // Terraform: the routes under /v1/me are the same four; the employees API allows the same request headers.
    const files = tfFiles();
    const res = (type: string) => blocks(files, 'resource').filter((b) => b.labels[0] === type);
    const attr = (b: { body: string }, name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm').exec(b.body)?.[1]?.trim().replace(/\s+/g, '') ?? '';
    const meRoutes = res('aws_apigatewayv2_route').map((b) => attr(b, 'route_key').replace(/"/g, '')).filter((k) => /^[A-Z]+\/v1\/me(\/|$)/.test(k)).sort();
    expect(meRoutes, 'the routes under /v1/me are the four there were: no new route').toEqual(['GET/v1/me', 'GET/v1/me/documents', 'POST/v1/me/consent', 'POST/v1/me/documents/upload-url']);
    const api = res('aws_apigatewayv2_api').find((b) => b.labels[1] === 'employees_api')!;
    const allow = (/allow_headers\s*=\s*\[([^\]]*)\]/.exec(api.body)?.[1] ?? '').split(',').map((h) => h.trim().replace(/"/g, '').toLowerCase()).filter(Boolean).sort();
    expect(allow, 'the employees API allows the same request headers: no new header').toEqual(['authorization', 'content-type', 'idempotency-key']);

    // getMyStart's role: the same lines as on develop c859f0f (no new IAM line, no new KMS line), still one policy and still in the KMS read list.
    const pinned = JSON.parse(readFileSync(join(HERE, 'support', 'onb-19', 'iam-c859f0f.json'), 'utf8')) as { getMyStart: string[] };
    const now = rolePairsOf('getMyStart');
    expect(now.found, 'getMyStart has its role').toBe(true);
    expect(now.pairs.filter((p) => !pinned.getMyStart.includes(p)), 'getMyStart: no new IAM line (a card that needs one re-locks this)').toEqual([]);
    expect(pinned.getMyStart.filter((p) => !now.pairs.includes(p)), 'getMyStart: no IAM line taken away').toEqual([]);
    const fn = res('aws_lambda_function').find((b) => attr(b, 'function_name') === '"getMyStart"')!;
    const role = /aws_iam_role\.(\w+)\.arn/.exec(attr(fn, 'role'))![1]!;
    const kms = blocks(files, 'module').find((b) => b.labels[0] === 'kms_pii')!;
    const list = (name: string) => /\[([^\]]*)\]/.exec(new RegExp(`${name}\\s*=\\s*\\[[^\\]]*\\]`).exec(kms.body)?.[0] ?? '')?.[1] ?? '';
    expect((list('dynamodb_read_role_arns').match(new RegExp(`aws_iam_role\\.${role}\\.arn`, 'g')) ?? []).length, 'getMyStart\'s role is in the KMS read list once, as before').toBe(1);
    expect((list('allowed_role_arns').match(new RegExp(`aws_iam_role\\.${role}\\.arn`, 'g')) ?? []).length, 'and never in the list that may make data keys').toBe(0);

    // The page's files: nothing from the words list, no request header, no AI client. The page is found by its own words.
    const everywhere = walk(join(WEB, 'src')).filter((f) => /\.(ts|html)$/.test(f));
    const page = everywhere.filter((f) => readFileSync(f, 'utf8').includes('Your steps to Day 1'));
    expect(page.length, 'the page that says "Your steps to Day 1" is in pepla-web/src').toBeGreaterThan(0);
    const startDir = join(APP, 'features', 'start');
    const touched = new Set([...page, ...walk(startDir).filter((f) => /\.(ts|html)$/.test(f)), join(APP, 'core', 'start', 'start.service.ts'), join(REPO, 'lambda', 'getMyStart', 'index.mjs')]);
    for (const f of touched) {
      const text = readFileSync(f, 'utf8');
      expect(text, `${rel(f)}: never "Masked"`).not.toMatch(/\bmasked\b/i);
      expect(text, `${rel(f)}: never "credentials"`).not.toMatch(/\bcredentials\b/i);
      expect(text, `${rel(f)}: never "Work email"`).not.toMatch(/work email/i);
      expect(text, `${rel(f)}: never "Training" or "Onboarded" as words`).not.toMatch(/['"`>]\s*(Training|Onboarded)\s*['"`<]/);
      expect(text, `${rel(f)}: no Idempotency-Key or X- header`).not.toMatch(/idempotency-key|['"`]x-[a-z-]+['"`]/i);
      expect(text, `${rel(f)}: imports no AI client`).not.toMatch(/(from|import)\s*\(?\s*['"`][^'"`]*(bedrock|textract|anthropic|openai)/i);
      expect(text, `${rel(f)}: never the name Pepla in a word a person reads`).not.toMatch(/['"`>][^'"`<]*\bPepla\b[^'"`<]*['"`<]/);
    }
    // Only pp-* components on screens.
    try {
      execFileSync('node', ['scripts/verify-design.mjs'], { cwd: WEB, encoding: 'utf8', stdio: 'pipe' });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      throw new Error(`verify:design failed:\n${err.stdout ?? ''}${err.stderr ?? ''}`);
    }
  });

  test('AC-11 No page of the card calls a paid AI service', async ({ page, signIn, employee, me, myDocuments, watch }) => {
    noBackendOnly();
    const fx = { page, signIn, employee, me, myDocuments };
    await arrive(fx, { step: 'IN_REVIEW', documents: docs('WITH_HR', 'WITH_HR') });
    for (const step of ['DOCUMENTS', 'IN_REVIEW', 'VERIFIED', 'INVITED', null] as const) {
      (me!.people.get(employee.email) as StepPerson).step = step;
      await open(page);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    }
    const ai = /\/agent\/|\/ai\/|\/chat|batsi|\/summary|assess-risk|risk-report|bedrock|textract|anthropic|openai/i;
    expect(watch.requests.filter((r) => ai.test(r.url)).map((r) => r.url), 'no AI route is called').toEqual([]);
    await expect(page.getByRole('button', { name: /Ask Batsi/i })).toHaveCount(0);
  });

  // -------------------------------------------------------------- AC-12
  test('AC-12 pepla-dev: the employee test login gets a step from GET /v1/me, /start/onboarding shows the matching line and steps, and the sidebar shows My onboarding @pepla-dev', async ({ page, signIn, employee }, testInfo) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only, after ONB-19 is merged and deployed there.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once, at one width.');
    test.setTimeout(120_000);
    await signIn.open();
    await signIn.signInAs(employee);
    await expect(page).toHaveURL(START, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: `Welcome, ${employee.givenName}`, exact: true })).toBeVisible({ timeout: 30_000 });

    // Reads only: open the page, and read the answer GET /v1/me gave it (ONB-19.1: only a call the page itself made,
    // its body read as it arrives, so a late call from Today cannot be the one read; see support/onb-19/me-answer.ts).
    const answer = await openAndReadMe(page, ONBOARDING, ONBOARDING_URL);
    expect(answer.status, 'GET /v1/me answers').toBe(200);
    expect(answer.body, `GET /v1/me answers a JSON object (got: ${answer.text.slice(0, 200)})`).not.toBeNull();
    const body = answer.body!;
    expect(STEP_CODES as string[], 'GET /v1/me answers a step that is one of the four (other tests move the persona)').toContain(body['step']);
    const step = body['step'] as StepCode;
    await expect(header(page), 'the page').toBeVisible({ timeout: 30_000 });
    await expect(page, 'the title').toHaveTitle(TITLE);
    await expect(page.getByText(stepLine(step), { exact: true }), `"${stepLine(step)}" matches the step the API gave`).toBeVisible();
    await expectSteps(page, step, `pepla-dev, ${step}`);
    await expect(bar(page)).toHaveAttribute('value', String(TABLE[step].d));
    await expect(sidebar(page).getByRole('link', { name: NAV_LABEL, exact: true }), 'the sidebar shows My onboarding').toBeVisible();
    await expect(sidebar(page).getByRole('link', { name: NAV_LABEL, exact: true })).toHaveAttribute('aria-current', 'page');
  });
});

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
