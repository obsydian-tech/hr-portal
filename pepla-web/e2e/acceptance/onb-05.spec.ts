import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { blocks, stripComments, tfFiles } from './support/infra-harness';
import type { FakeAccount } from './support/cognito-fake';
import { HR_HOME, ON_DEV, ON_SIGN_IN, expect, expectAnnounced, expectNoSession, test as base, type Login } from './support/fixtures';
import {
  CONSENTS,
  COMPANY as SERVER_COMPANY,
  CONSENT_HELPER,
  GET_ME,
  HR,
  LINDIWE,
  LINDIWE_ID,
  NOTICE_MODULE,
  OTHER_ID,
  RECORD,
  T0,
  at,
  consentRow,
  consents,
  dynamoCalls,
  exportsOf,
  getMe,
  hasCurrentConsent,
  logLines,
  plain,
  record,
  runModule,
  consentEvent,
  storedEmployee,
  world,
  writes,
  type Caller,
  type Run,
  type World,
} from './support/onb-05/lambda-harness';
import { BAD_BODY, CHANGED, ME_COMPANY, NOT_EMPLOYEE, NOT_FOUND, type MeFake } from './support/onb-05/me-fake';
import { NEXT_VERSION, NOTICE_2026_11_1, NOTICE_NEXT, PINNED_SHA256, VERSION, canonical, filled, sha256Hex, type Notice } from './support/onb-05/notice';
import { policyOf, resourcesNamed } from './support/onb-15/tf-policy';
import { InviteFake } from './support/onb-17/invite-fake';

/**
 * ONB-05 · Privacy notice and consent (Jira NH-174, epic NH-150). Red.
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/ONB-05.md (NH-174).
 *
 * Screens: the no-backend run answers GET /v1/me and POST /v1/me/consent with support/onb-05/me-fake.ts (on for
 * every test, support/fixtures.ts). Lambdas: the real lambda/getMyStart and lambda/recordConsent run against a
 * fake AWS (support/onb-05/fake-aws). The notice's words are support/onb-05/notice.ts.
 * ONB-05 also changed three checks in onb-17.spec.ts and onb-23.spec.ts (the /start holding page went away):
 * see ./cards/onb-05.md.
 *
 * Each screen test runs at 1280 and 390 wide unless it says why not. Lambda and text checks run once, at
 * 1280. AC-11 runs on pepla-dev. Nothing here calls an AI service. Locked once accepted: see ./README.md.
 */

const HERE = __dirname;
const WEB = join(HERE, '..', '..');
const REPO = join(WEB, '..');

// ---------------------------------------------------------------- the card's words
const TITLE = 'Declaration and consent';
const TICK = 'I have read and agree to the declaration above';
const TICK_HELP = 'Needed before you can upload documents';
const ACCEPT = 'Accept and continue';
const READ_FULL = 'Read the full privacy notice';
const READ_RECORD = 'Read the privacy notice';
const BACK = 'Back to Today';
const UNTICKED = 'Tick the box to agree before you continue.';
const AGREED = (v: string) => `You agreed to the privacy notice (version ${v}).`;
const NOTICE_CHANGED = 'The privacy notice has changed. Read it and agree again.';
const OFFLINE = "We can't reach Naleko People. Check your connection and try again.";
const DOCS_META = 'Upload your ID and your bank letter.';
const TRACKER = 'Getting started, 2 steps';
const DRAFT_KEY = 'naleko.registration.draft';

const START = /\/start$/;
const NOTICE_PAGE = /\/start\/privacy-notice$/;
const FAKE_PASSWORD = 'winter-protea-2026';
const GOOD_PASSWORD = 'Blue-kettle-7!';
const STARTER: FakeAccount = { email: 'lerato.molefe@gmail.com', givenName: 'Lerato', familyName: 'Molefe', groups: ['employee'] };

const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: AC-11 is the pepla-dev check.');
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

const test = base.extend<{ watch: Watch; appOrigin: string }>({
  appOrigin: async ({ baseURL }, use) => {
    await use(new URL(baseURL!).origin);
  },
  watch: async ({ page }, use) => {
    const w = new Watch();
    w.track(page);
    await use(w);
  },
});

// ---------------------------------------------------------------- the page, found by its words

const welcome = (page: Page, name: string) => page.getByRole('heading', { name: `Welcome, ${name}`, exact: true });
const formHeading = (page: Page) => page.getByRole('heading', { name: TITLE, exact: true });
const checkbox = (page: Page) => page.getByRole('checkbox', { name: new RegExp(`^${TICK}`) });
const acceptButton = (page: Page) => page.getByRole('button', { name: ACCEPT, exact: true });
const tracker = (page: Page) => page.getByRole('list', { name: TRACKER, exact: true });
const step = (page: Page, label: 'Consent' | 'Documents') => tracker(page).getByRole('listitem').filter({ hasText: label });
const agreed = (page: Page, v: string) => page.getByText(AGREED(v), { exact: true });
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });
const accountButton = (page: Page) => page.getByRole('button', { name: /^Your account/ });
const signOutItem = (page: Page) => page.getByRole('menuitem', { name: 'Sign out', exact: true });

async function signInEmployee(page: Page, signIn: { open(): Promise<void>; signInAs(l: Login): Promise<void> }, who: Login): Promise<void> {
  await signIn.open();
  await signIn.signInAs(who);
  await expect(page).toHaveURL(START, { timeout: 20_000 });
  await expect(welcome(page, who.givenName)).toBeVisible();
}

async function signOutEmployee(page: Page): Promise<void> {
  await accountButton(page).click();
  await signOutItem(page).click();
  await expect(page).toHaveURL(ON_SIGN_IN);
}

/** The form as AC-1 describes it, for `notice` filled in with `company`, nothing ticked. */
async function expectForm(page: Page, notice: Notice, company: string): Promise<void> {
  const n = filled(notice, company);
  await expect(formHeading(page), `"${TITLE}"`).toBeVisible();
  await expect(page.getByText(n.intro, { exact: true }), 'the intro').toBeVisible();
  for (const t of n.terms) {
    await expect(page.getByText(t.term, { exact: true }).first(), `term "${t.term}"`).toBeVisible();
    await expect(page.getByText(t.text, { exact: true }), `the words of "${t.term}"`).toBeVisible();
  }
  await expect(checkbox(page), 'the checkbox').toBeVisible();
  await expect(checkbox(page), 'nothing is ticked at first').not.toBeChecked();
  await expect(page.getByText(TICK_HELP, { exact: true }), 'the checkbox description').toBeVisible();
  await expect(page.getByRole('link', { name: READ_FULL, exact: true })).toBeVisible();
  await expect(acceptButton(page)).toBeVisible();
}

/** Steps in the tracker: Consent then Documents, with the state each is in. */
async function expectSteps(page: Page, consent: 'current' | 'done', documents: 'not started' | 'current'): Promise<void> {
  await expect(tracker(page), `the tracker "${TRACKER}"`).toBeVisible();
  const items = tracker(page).getByRole('listitem');
  await expect(items, 'two steps').toHaveCount(2);
  await expect(items.nth(0)).toContainText('Consent');
  await expect(items.nth(1)).toContainText('Documents');
  if (consent === 'current') {
    await expect(step(page, 'Consent'), 'Consent is the current step').toHaveAttribute('aria-current', 'step');
  } else {
    await expect(step(page, 'Consent'), 'Consent is done').not.toHaveAttribute('aria-current', /.+/);
    await expect(step(page, 'Consent'), 'Consent is done').toContainText(/Done/);
  }
  if (documents === 'not started') {
    await expect(step(page, 'Documents'), 'Documents is not started').not.toHaveAttribute('aria-current', /.+/);
    await expect(step(page, 'Documents'), 'Documents is "Not started"').toContainText('Not started');
  } else {
    await expect(step(page, 'Documents'), 'Documents is the current step').toHaveAttribute('aria-current', 'step');
    await expect(step(page, 'Documents'), `Documents: "${DOCS_META}"`).toContainText(DOCS_META);
  }
}

/** Before consent: no upload button, link or file input anywhere on the page. */
async function expectNoUpload(page: Page): Promise<void> {
  await expect(page.locator('input[type=file]'), 'no file input').toHaveCount(0);
  await expect(page.getByRole('button', { name: /upload/i }), 'no upload button').toHaveCount(0);
  await expect(page.getByRole('link', { name: /upload|documents/i }), 'no upload or documents link').toHaveCount(0);
}

/** On a phone the sidebar is a drawer: open it first. */
async function openSidebar(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: 'Open menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await expect(sidebar(page)).toBeVisible();
}

/** A section heading of the full notice: "Why" or "3. Why". */
const sectionHeading = (page: Page, heading: string) =>
  page.getByRole('heading', { name: new RegExp(`^(\\d+\\.\\s*)?${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });

const sleep = (page: Page, ms: number) => page.waitForTimeout(ms);

// ---------------------------------------------------------------- Lambda helpers

const EMPLOYEE_ONLY = { error: NOT_EMPLOYEE };
// ONB-10 (re-lock acceptance-lock/onb-05.2): `documentsDue` is the one field added to the list.
const LISTED = ['firstName', 'company', 'department', 'startDate', 'documentsDue', 'notice', 'consent'];

/** Every string anywhere in a value. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** The SHA-256 forms (hex, base64, base64url) of the text a GET /v1/me served, with or without its version. */
function servedHashes(served: Record<string, unknown>): string[] {
  const { version, ...text } = served;
  void version;
  const out: string[] = [];
  for (const s of [JSON.stringify(served), JSON.stringify(text)]) {
    const hex = sha256Hex(s);
    const buf = Buffer.from(hex, 'hex');
    out.push(hex, buf.toString('base64'), buf.toString('base64url'));
  }
  return out;
}

function expectStatus(run: Run, status: number, what: string): void {
  expect(run.error, `${what}: the handler threw ${run.error?.message}`).toBeUndefined();
  expect(run.status, `${what}: ${run.raw}`).toBe(status);
}

const NO_GROUP: Caller = { kind: 'jwt', email: LINDIWE.email, groups: [], sub: LINDIWE.sub };
const CONTRACTOR: Caller = { kind: 'jwt', email: LINDIWE.email, groups: ['contractor'], sub: LINDIWE.sub };
const NEAR_MISS: Caller = { kind: 'jwt', email: LINDIWE.email, groups: ['employees', 'new-employee'], sub: LINDIWE.sub };
const HR_WITH_EMAIL: Caller = { ...HR, email: LINDIWE.email };
const REFUSED: Array<[string, Caller]> = [
  ['no claims', { kind: 'none' }],
  ['an HR token', HR],
  ['an HR token carrying the employee\'s email', HR_WITH_EMAIL],
  ['a token in no group', NO_GROUP],
  ['a token in another group (contractor)', CONTRACTOR],
  ['a token in groups whose names only contain "employee"', NEAR_MISS],
];

// ---------------------------------------------------------------- the tests

/** The version privacy-notice.mjs serves now. A polished notice is a new version, so the Lambda tests follow it. */
function currentVersion(): string {
  return String(exportsOf(NOTICE_MODULE)['CURRENT_NOTICE_VERSION']);
}
/** The current notice as privacy-notice.mjs holds it, `{company}` not filled in. */
function currentNotice(): Notice {
  const mod = exportsOf(NOTICE_MODULE);
  return (mod['NOTICES'] as Record<string, Notice>)[String(mod['CURRENT_NOTICE_VERSION'])]!;
}

test.describe('ONB-05 Privacy notice and consent', () => {
  // -------------------------------------------------------------- AC-1
  test('AC-1 /start shows the frame, the header, the tracker and the declaration word for word; the full notice opens and comes back', async ({ page, signIn, employee, me }) => {
    noBackendOnly();
    await signInEmployee(page, signIn, employee);
    await expect(page).toHaveTitle('Welcome · Naleko People');

    // The frame: the company in the sidebar.
    await openSidebar(page);
    await expect(sidebar(page).getByText(ME_COMPANY, { exact: true }), 'the company in the sidebar').toBeVisible();
    await sidebar(page).getByRole('link', { name: 'Today', exact: true }).click();
    await expect(page).toHaveURL(START);

    // Header, tracker and the form for version 2026-11-1, the company filled in.
    await expect(welcome(page, employee.givenName)).toBeVisible();
    await expect(page.getByText('Operations · Starts 1 Dec 2026', { exact: true }), 'department and start date').toBeVisible();
    await expectSteps(page, 'current', 'not started');
    await expectForm(page, NOTICE_2026_11_1, ME_COMPANY);
    await expect(page.getByText(new RegExp(`${ME_COMPANY} processing your personal information`)), 'the company is named').toBeVisible();

    // One GET /v1/me for the page, with the person's token.
    await expect.poll(() => me!.gets().length).toBe(1);
    expect(me!.gets()[0]!.headers['authorization'], 'the call carries the ID token').toMatch(/^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/);
    expect(me!.gets()[0]!.email, 'as the person signed in').toBe(employee.email);

    // The full notice, and back.
    await page.getByRole('link', { name: READ_FULL, exact: true }).click();
    await expect(page).toHaveURL(NOTICE_PAGE);
    await expect(page).toHaveTitle('Privacy notice · Naleko People');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy notice', exact: true })).toBeVisible();
    await expect(page.getByText(`Version ${VERSION}`, { exact: true })).toBeVisible();
    const full = filled(NOTICE_2026_11_1, ME_COMPANY).full;
    for (const s of full) {
      await expect(sectionHeading(page, s.heading), `section "${s.heading}"`).toBeVisible();
      await expect(page.getByText(s.text, { exact: true }), `the words of "${s.heading}"`).toBeVisible();
    }
    // Opened straight from its address, it shows the same.
    await page.reload();
    await expect(page.getByText(full[5]!.text, { exact: true }), 'after a reload').toBeVisible();
    await page.getByRole('link', { name: BACK, exact: true }).click();
    await expect(page).toHaveURL(START);
    await expect(formHeading(page)).toBeVisible();
  });

  test('AC-1 GET /v1/me serves the current notice from privacy-notice.mjs, the company from COMPANY_NAME filled in', async ({}, testInfo) => {
    onceOnly(testInfo);
    const run = getMe(world(), LINDIWE);
    expectStatus(run, 200, 'GET /v1/me');
    expect(run.body.firstName).toBe('Lindiwe');
    expect(run.body.company, 'the company is the COMPANY_NAME setting').toBe(SERVER_COMPANY);
    expect(run.body.department).toBe('Finance');
    expect(run.body.startDate, 'startDate is YYYY-MM-DD').toBe('2026-12-01');
    const CUR = currentVersion();
    const source = currentNotice();
    expect(run.body.notice, 'the current notice from privacy-notice.mjs, word for word').toEqual({ version: CUR, ...filled(source, SERVER_COMPANY) });
    expect(run.body.consent, 'nothing accepted yet').toBeNull();
    const words = strings(run.body.notice).join('\n');
    for (const must of [SERVER_COMPANY, 'POPIA']) expect(words, `the notice says "${must}"`).toContain(must);
    expect(words, 'no placeholder left').not.toContain('{company}');

    // Another company, another name: the setting, not a fixed word.
    const other = getMe(world(), LINDIWE, { env: { COMPANY_NAME: 'Mokoena Logistics' } });
    expect(other.body.notice).toEqual({ version: CUR, ...filled(source, 'Mokoena Logistics') });

    // A row with no department or start date: those fields are left out, not empty.
    const bare = world();
    bare.tables.employees[0] = storedEmployee({ department: '', planned_start_date: '' });
    delete bare.tables.employees[0]!['department'];
    delete bare.tables.employees[0]!['planned_start_date'];
    const b = getMe(bare, LINDIWE);
    expectStatus(b, 200, 'GET /v1/me, no department or start date');
    expect('startDate' in b.body ? b.body.startDate : undefined, 'no startDate').toBeUndefined();
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 Nothing about documents opens before the tick; unticked sends nothing; ticked sends one POST with the version shown', async ({ page, signIn, employee, me }) => {
    noBackendOnly();
    await signInEmployee(page, signIn, employee);
    await expectForm(page, NOTICE_2026_11_1, ME_COMPANY);
    await expectNoUpload(page);
    await expectSteps(page, 'current', 'not started');

    // Unticked: nothing is sent, the checkbox says why and gets focus.
    await acceptButton(page).click();
    await expect(page.getByText(UNTICKED, { exact: true }), 'the unticked error').toBeVisible();
    await expect(checkbox(page), 'focus moves to the checkbox').toBeFocused();
    await expectAnnounced(page, UNTICKED, checkbox(page));
    await sleep(page, 500);
    expect(me!.posts(), 'nothing is sent without the tick').toHaveLength(0);
    await expectNoUpload(page);

    // Ticked, tapped twice (and more): one POST.
    await checkbox(page).check();
    me!.holdPosts = true;
    await acceptButton(page).dblclick();
    await acceptButton(page).dispatchEvent('click').catch(() => undefined);
    await acceptButton(page).press('Enter', { timeout: 2_000 }).catch(() => undefined);
    await expect.poll(() => me!.posts().length).toBe(1);
    me!.release();
    await expect(agreed(page, VERSION)).toBeVisible();
    await sleep(page, 500);
    expect(me!.posts(), 'a double tap sends one POST').toHaveLength(1);
    const post = me!.posts()[0]!;
    expect(post.body, 'the body is the version shown, nothing else').toEqual({ version: VERSION });
    expect(post.headers['authorization']).toMatch(/^Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]*$/);
    expect(post.headers['content-type'] ?? '', 'sent as JSON').toMatch(/^application\/json/);
    // No new request header: the API allows only authorization and content-type (LESSONS, NH-187).
    for (const p of me!.preflights) {
      const asked = p.requestHeaders.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
      expect(asked.filter((h) => !['authorization', 'content-type'].includes(h)), `${p.path}: no header the API does not allow`).toEqual([]);
    }
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 After accepting, the record shows with the version and the time, Documents is current, and a reload shows the record', async ({ page, signIn, employee, me }) => {
    noBackendOnly();
    await signInEmployee(page, signIn, employee);
    await expectForm(page, NOTICE_2026_11_1, ME_COMPANY);
    await checkbox(page).check();
    await acceptButton(page).click();

    await expect(agreed(page, VERSION)).toBeVisible();
    // 06:42 UTC is 08:42 in Johannesburg, the browser's time zone.
    await expect(page.getByText(/16 Nov 2026, 08:42/).first(), 'the time, in the browser\'s time zone').toBeVisible();
    await expect(checkbox(page), 'the form is gone').toHaveCount(0);
    await expect(acceptButton(page)).toHaveCount(0);
    await expectSteps(page, 'done', 'current');
    expect(me!.posts()).toHaveLength(1);

    // The record links to the notice.
    await page.getByRole('link', { name: READ_RECORD, exact: true }).click();
    await expect(page).toHaveURL(NOTICE_PAGE);
    await page.getByRole('link', { name: BACK, exact: true }).click();
    await expect(page).toHaveURL(START);

    // A reload shows the record, not the form, and sends nothing.
    await page.reload();
    await expect(agreed(page, VERSION)).toBeVisible();
    await expect(page.getByText(/16 Nov 2026, 08:42/).first()).toBeVisible();
    await expect(checkbox(page)).toHaveCount(0);
    await expectSteps(page, 'done', 'current');
    expect(me!.posts(), 'a reload sends no POST').toHaveLength(1);
  });

  test('AC-3 Someone who already accepted sees the record, not the form, and it is not announced again', async ({ page, signIn, employee, me }) => {
    noBackendOnly();
    me!.people.set(employee.email, { ...me!.defaultPerson(employee.givenName), consents: { [VERSION]: '2026-11-14T13:05:00.000Z' } });
    await signInEmployee(page, signIn, employee);
    await expect(agreed(page, VERSION)).toBeVisible();
    await expect(page.getByText(/14 Nov 2026, 15:05/).first()).toBeVisible();
    await expect(checkbox(page)).toHaveCount(0);
    await expect(formHeading(page)).toHaveCount(0);
    await expectSteps(page, 'done', 'current');
    await expect(page.getByRole('status').filter({ hasText: AGREED(VERSION) }), 'a record loaded with the page is not a live message').toHaveCount(0);
    expect(me!.posts()).toHaveLength(0);
  });

  test('AC-3 recordConsent stores one row on its own: the time, the version, the hash of the text served, nothing personal', async ({}, testInfo) => {
    onceOnly(testInfo);
    const CUR = currentVersion();
    const w0 = world();
    const served = getMe(w0, LINDIWE).body.notice as Record<string, unknown>;

    const first = record(w0, LINDIWE, { version: CUR });
    expectStatus(first, 201, 'first acceptance');
    expect(first.body, '201 { version, acceptedAt } with the server time').toEqual({ version: CUR, acceptedAt: T0 });
    const rows = consents(first.world);
    expect(rows, 'one row').toHaveLength(1);
    const r = rows[0]!;
    // TEN-02 (re-lock): and the company the consent belongs to (tenant_id).
    expect(Object.keys(r).sort(), 'exactly the six fields and the company').toEqual(['accepted_at', 'cognito_sub', 'employee_id', 'notice_sha256', 'notice_version', 'source', 'tenant_id']);
    expect(r['employee_id'], 'the caller\'s own record, found by the token email').toBe(LINDIWE_ID);
    expect(r['notice_version']).toBe(CUR);
    expect(r['accepted_at'], 'server time, ISO 8601 UTC').toBe(T0);
    expect(r['cognito_sub']).toBe(LINDIWE.sub);
    expect(r['source']).toBe('web');
    expect(servedHashes(served), 'notice_sha256 is the SHA-256 of the notice GET /v1/me serves for this company').toContain(String(r['notice_sha256']));
    const text = JSON.stringify(r).toLowerCase();
    for (const personal of ['lindiwe', 'mokoena', '@', '9506145009087', '4087', '62841937055', '082 555 0147']) expect(text, `no "${personal}" in the consent row`).not.toContain(personal);

    // Written with a conditional put, never an update; the employees table is untouched.
    const w = writes(first);
    expect(w.map((c) => `${c.op} ${c.table}`), 'one write: a put on employee_consents').toEqual([`PutItem ${CONSENTS}`]);
    expect(String(w[0]!.input.ConditionExpression ?? ''), 'the put is conditional (attribute_not_exists)').toMatch(/attribute_not_exists\s*\(/);
    // TEN-02 (re-lock): the run fills user_sub from the person's own sign-in, as the TEN-02 backfill does
    // (support/ten-02/legacy-company.mjs); that is not a write by this route.
    // Only a user_sub the row did not have, equal to the caller's own sub, is left out; the write list above shows no route write.
    const subOf = (v: unknown) => (v && typeof v === 'object' ? (v as { S?: string }).S : v);
    const unfilled = (rows: Array<Record<string, unknown>>) => rows.map((r, i) => {
      const { user_sub: filled, ...rest } = r;
      return w0.tables.employees[i]?.['user_sub'] === undefined && subOf(filled) === LINDIWE.sub ? rest : r;
    });
    expect(unfilled(first.world.tables.employees), 'nothing in the employees rows changes').toEqual(w0.tables.employees);

    // Again, an hour later: 200 with the first time, nothing written.
    const again = record(first.world, LINDIWE, { version: CUR }, { now: at(T0, 3600) });
    expectStatus(again, 200, 'the same version again');
    expect(again.body).toEqual({ version: CUR, acceptedAt: T0 });
    expect(consents(again.world), 'still one row, unchanged').toEqual(rows);
    expect(writes(again).filter((c) => c.op !== 'PutItem'), 'no update, delete or batch').toEqual([]);

    // Two requests racing: one row, both answers carry the same time.
    const race = runModule(RECORD, w0, [consentEvent(LINDIWE, { version: CUR }), consentEvent(LINDIWE, { version: CUR })], { concurrent: true });
    expect(race.all.map((a) => a.status).sort(), 'one 201 and one 200').toEqual([200, 201]);
    expect(race.all.map((a) => a.body?.acceptedAt), 'the same acceptedAt').toEqual([T0, T0]);
    expect(consents(race.world), 'one row').toHaveLength(1);

    // GET /v1/me now carries the consent.
    const after = getMe(first.world, LINDIWE, { now: at(T0, 7200) });
    expect(after.body.consent).toEqual({ version: CUR, acceptedAt: T0 });
  });

  // -------------------------------------------------------------- AC-4
  test('AC-4 A new notice version asks again: the form for the new version, unticked, and accepting it records that version', async ({ page, signIn, employee, me }) => {
    noBackendOnly();
    me!.people.set(employee.email, { ...me!.defaultPerson(employee.givenName), consents: { [VERSION]: '2026-11-14T13:05:00.000Z' } });
    me!.notices[NEXT_VERSION] = NOTICE_NEXT;
    me!.current = NEXT_VERSION;
    await signInEmployee(page, signIn, employee);
    await expectForm(page, NOTICE_NEXT, ME_COMPANY);
    await expect(agreed(page, VERSION), 'the old acceptance does not count').toHaveCount(0);
    await expectSteps(page, 'current', 'not started');
    await checkbox(page).check();
    await acceptButton(page).click();
    await expect(agreed(page, NEXT_VERSION)).toBeVisible();
    expect(me!.posts().map((p) => p.body)).toEqual([{ version: NEXT_VERSION }]);
  });

  test('AC-4 The notice changes while the page is open: 409, the new words, the box unticked, and the message', async ({ page, signIn, employee, me }) => {
    noBackendOnly();
    await signInEmployee(page, signIn, employee);
    await expectForm(page, NOTICE_2026_11_1, ME_COMPANY);
    const getsBefore = me!.gets().length;

    me!.notices[NEXT_VERSION] = NOTICE_NEXT;
    me!.current = NEXT_VERSION;
    await checkbox(page).check();
    await acceptButton(page).click();
    await expect.poll(() => me!.posts().length).toBe(1);
    expect(me!.posts()[0]!.body, 'sent with the version on screen').toEqual({ version: VERSION });

    await expect(page.getByText(NOTICE_CHANGED, { exact: true }), 'the message').toBeVisible();
    await expect.poll(() => me!.gets().length, 'the page asks for the notice again').toBeGreaterThan(getsBefore);
    await expectForm(page, NOTICE_NEXT, ME_COMPANY);
    await expect(page.getByText(filled(NOTICE_2026_11_1, ME_COMPANY).intro, { exact: true }), 'the old words are gone').toHaveCount(0);
    await expect(agreed(page, VERSION)).toHaveCount(0);

    // The full notice shows the server's new words too, not a copy kept in the app.
    await page.getByRole('link', { name: READ_FULL, exact: true }).click();
    await expect(page).toHaveURL(NOTICE_PAGE);
    await expect(page.getByText(`Version ${NEXT_VERSION}`, { exact: true })).toBeVisible();
    const changedSection = filled(NOTICE_NEXT, ME_COMPANY).full.find((s) => s.heading === 'Changes')!;
    await expect(page.getByText(changedSection.text, { exact: true }), 'the changed section, as the server sends it').toBeVisible();
    await page.getByRole('link', { name: BACK, exact: true }).click();
    await expect(page).toHaveURL(START);
    await expectForm(page, NOTICE_NEXT, ME_COMPANY);

    // Agreeing to the new version works, after a new tick.
    await acceptButton(page).click();
    await expect(page.getByText(UNTICKED, { exact: true })).toBeVisible();
    await sleep(page, 300);
    expect(me!.posts(), 'unticked: nothing sent').toHaveLength(1);
    await checkbox(page).check();
    await acceptButton(page).click();
    await expect(agreed(page, NEXT_VERSION)).toBeVisible();
    expect(me!.posts().map((p) => p.body)).toEqual([{ version: VERSION }, { version: NEXT_VERSION }]);
  });

  test('AC-4 Lambdas: an older version\'s row is not consent to the current one; an old version is refused with 409 and nothing stored', async ({}, testInfo) => {
    onceOnly(testInfo);
    const CUR = currentVersion();
    const old = '2000-01-1';
    const w = world([consentRow(LINDIWE_ID, old, '2026-10-20T09:00:00.000Z')]);
    const me = getMe(w, LINDIWE);
    expectStatus(me, 200, 'GET with only an older row');
    expect(me.body.consent, 'an older version\'s row gives null').toBeNull();
    expect(me.body.notice.version).toBe(CUR);

    for (const v of [old, '2999-12-1', `${CUR} `, CUR.toUpperCase() + 'x']) {
      const r = record(w, LINDIWE, { version: v });
      expectStatus(r, 409, `POST version "${v}"`);
      expect(r.body, `409 for "${v}"`).toEqual({ error: CHANGED, version: CUR });
      expect(writes(r), `nothing stored for "${v}"`).toEqual([]);
    }

    // The helper ONB-06 will call counts the current version only.
    expect(hasCurrentConsent(w, LINDIWE_ID).response, 'only an older row: false').toBe(false);
    expect(hasCurrentConsent(world(), LINDIWE_ID).response, 'no row: false').toBe(false);
    expect(hasCurrentConsent(world([consentRow(OTHER_ID, CUR, T0)]), LINDIWE_ID).response, 'someone else\'s row: false').toBe(false);
    expect(hasCurrentConsent(world([consentRow(LINDIWE_ID, CUR, T0)]), LINDIWE_ID).response, 'the current version: true').toBe(true);
  });

  test('AC-4 Text check: version 2026-11-1 in privacy-notice.mjs is the released text, pinned by its SHA-256; the current version is one of the notices', async ({}, testInfo) => {
    onceOnly(testInfo);
    const mod = exportsOf(NOTICE_MODULE);
    const released = mod['NOTICES']?.[VERSION] as Notice | undefined;
    expect(released, 'NOTICES["2026-11-1"]').toBeTruthy();
    expect(JSON.parse(canonical(released!)), 'word for word, as the spec\'s appendix').toEqual(JSON.parse(canonical(NOTICE_2026_11_1)));
    expect(sha256Hex(canonical(released!)), 'the pinned SHA-256: a released version is never edited, a change is a new version').toBe(PINNED_SHA256);
    for (const [v, n] of Object.entries(mod['NOTICES'] as Record<string, Notice>)) {
      expect(n.terms.length, `${v}: terms`).toBeGreaterThan(0);
      expect(n.full.length, `${v}: full`).toBeGreaterThan(0);
    }
    expect(Object.keys(mod['NOTICES']), 'the current version is one of the notices').toContain(mod['CURRENT_NOTICE_VERSION']);
  });

  // -------------------------------------------------------------- AC-5
  test('AC-5 Only the person records their own consent: the group first, no one else\'s record, 404 for no or two rows, only the listed fields', async ({}, testInfo) => {
    onceOnly(testInfo);
    const CUR = currentVersion();
    // The group comes first: 403 before any DynamoDB call, on both routes.
    for (const [who, caller] of REFUSED) {
      for (const [route, run] of [['GET /v1/me', getMe(world(), caller)], ['POST /v1/me/consent', record(world(), caller, { version: CUR })]] as const) {
        expectStatus(run, 403, `${route}, ${who}`);
        expect(run.body, `${route}, ${who}: the words`).toEqual(EMPLOYEE_ONLY);
        expect(dynamoCalls(run).map((c) => c.op), `${route}, ${who}: no DynamoDB call before the group check`).toEqual([]);
      }
    }
    // The groups claim in each form API Gateway may hand over.
    for (const form of ['bracket', 'array', 'name'] as const) {
      const run = getMe(world(), { ...LINDIWE, form });
      expectStatus(run, 200, `groups claim as ${form}`);
    }

    // A body naming someone else still records for the caller only.
    const w0 = world();
    const sneaky = record(w0, LINDIWE, { version: CUR, employee_id: OTHER_ID, employeeId: OTHER_ID, cognito_sub: 'not-mine', accepted_at: '2020-01-01T00:00:00.000Z', source: 'agent' });
    expectStatus(sneaky, 201, 'a body naming someone else');
    expect(consents(sneaky.world).map((r) => [r['employee_id'], r['cognito_sub'], r['accepted_at'], r['source']]), 'the caller\'s own row, the server\'s values').toEqual([[LINDIWE_ID, LINDIWE.sub, T0, 'web']]);

    // The other person's token reaches only their own record.
    const kagiso: Caller = { kind: 'jwt', email: 'kagiso.molefe@x.co.za', groups: ['employee'], sub: 'b1c2d3e4-0000-4000-8000-00000000c0de' };
    const theirs = getMe(sneaky.world, kagiso);
    expect(theirs.body.firstName).toBe('Kagiso');
    expect(theirs.body.consent, 'Lindiwe\'s acceptance is not Kagiso\'s').toBeNull();

    // No row, or two rows, for the token's email: 404, nothing written, the email not logged.
    const nobody: Caller = { kind: 'jwt', email: 'thabo.dlamini@x.co.za', groups: ['employee'], sub: 'c0ffee00-0000-4000-8000-000000000001' };
    const twice = world();
    twice.tables.employees.push(storedEmployee({ employee_id: '1e2d3c4b-0000-4000-8000-000000000002', first_name: 'Lindiwe' }));
    for (const [what, w, caller] of [['no row', world(), nobody], ['two rows', twice, LINDIWE]] as const) {
      for (const [route, run] of [['GET', getMe(w, caller)], ['POST', record(w, caller, { version: CUR })]] as const) {
        expectStatus(run, 404, `${route}, ${what}`);
        expect(run.body, `${route}, ${what}`).toEqual({ error: NOT_FOUND });
        expect(writes(run), `${route}, ${what}: nothing written`).toEqual([]);
        const logged = logLines(run).map((l) => `${l.message} ${JSON.stringify(l.extra ?? '')}`).join('\n').toLowerCase();
        expect(logged, `${route}, ${what}: the email is never logged`).not.toContain((caller as { email: string }).email.toLowerCase());
      }
    }

    // Found through the email index, not a scan of everyone.
    const ok = getMe(world(), LINDIWE);
    const reads = dynamoCalls(ok);
    expect(reads.filter((c) => c.op === 'Scan'), 'no Scan').toEqual([]);
    expect(reads.some((c) => c.op === 'Query' && c.table === 'employees' && c.input.IndexName === 'email-index'), 'a Query on employees email-index').toBe(true);

    // GET /v1/me returns no field outside the list, and none of the private values.
    expect(Object.keys(ok.body).filter((k) => !LISTED.includes(k)), 'no field outside the list').toEqual([]);
    expect(Object.keys(ok.body.notice).sort(), 'the notice: version, title, intro, terms, full').toEqual(['full', 'intro', 'terms', 'title', 'version']);
    for (const secret of [LINDIWE_ID, '9506145009087', '4087', '62841937055', 'First National Bank', '082 555 0147', '38500', 'Private HR note', 'lindiwe.mokoena@x.co.za', 'Thandi', 'Bookkeeper', 'E2EHR01']) {
      expect(ok.raw, `GET /v1/me never carries "${secret}"`).not.toContain(secret);
    }
  });

  test('AC-5 POST /v1/me/consent refuses a body without the version, and writes nothing', async ({}, testInfo) => {
    onceOnly(testInfo);
    const CUR = currentVersion();
    for (const [what, b] of [['no body', undefined], ['an empty object', {}], ['a number', { version: 5 }], ['an empty version', { version: '' }], ['not JSON', '{version:'], ['a list', [CUR]]] as const) {
      const run = record(world(), LINDIWE, b);
      expectStatus(run, 400, what);
      expect(run.body, what).toEqual({ error: BAD_BODY });
      expect(writes(run), `${what}: nothing written`).toEqual([]);
    }
  });

  // -------------------------------------------------------------- AC-6
  test('AC-6 403 and 404 show the server\'s words and no form', async ({ page, signIn, employee, me }) => {
    noBackendOnly();
    for (const [status, words] of [[403, NOT_EMPLOYEE], [404, NOT_FOUND]] as const) {
      me!.nextGets.push({ status, body: { error: words } });
      if (status === 403) await signInEmployee(page, signIn, employee);
      else await page.reload();
      await expect(page.getByText(words, { exact: true }), `${status}: the server's words`).toBeVisible();
      await expect(welcome(page, employee.givenName), `${status}: the heading still shows`).toBeVisible();
      await expect(formHeading(page), `${status}: no form`).toHaveCount(0);
      await expect(checkbox(page)).toHaveCount(0);
      await expect(acceptButton(page)).toHaveCount(0);
      await expectNoUpload(page);
    }
  });

  test('AC-6 No answer or a 5xx on load or on accept: the connection words and Try again; a failed accept keeps the tick and Try again sends one POST', async ({ page, signIn, employee, me }) => {
    noBackendOnly();
    // On load.
    me!.nextGets.push({ status: 500, body: { error: 'Something went wrong' } });
    await signInEmployee(page, signIn, employee);
    await expect(page.getByText(OFFLINE, { exact: true }), 'a 500 on load').toBeVisible();
    await expect(formHeading(page)).toHaveCount(0);
    me!.nextGets.push('offline');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText(OFFLINE, { exact: true }), 'no answer on load').toBeVisible();
    const gets = me!.gets().length;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expectForm(page, NOTICE_2026_11_1, ME_COMPANY);
    expect(me!.gets().length, 'Try again asks once more').toBe(gets + 1);

    // On accept.
    await checkbox(page).check();
    me!.nextPosts.push({ status: 502, body: { message: 'Bad Gateway' } });
    await acceptButton(page).click();
    await expect(page.getByText(OFFLINE, { exact: true }), 'a 502 on accept').toBeVisible();
    await expect(checkbox(page), 'the tick stays').toBeChecked();
    await expect(agreed(page, VERSION)).toHaveCount(0);
    expect(me!.posts()).toHaveLength(1);

    me!.nextPosts.push('offline');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect.poll(() => me!.posts().length, 'Try again sends one POST').toBe(2);
    await expect(page.getByText(OFFLINE, { exact: true }), 'no answer on accept').toBeVisible();
    await expect(checkbox(page), 'the tick stays').toBeChecked();

    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(agreed(page, VERSION)).toBeVisible();
    await sleep(page, 300);
    expect(me!.posts(), 'each Try again sent one POST').toHaveLength(3);
    expect(me!.posts().map((p) => p.body)).toEqual([{ version: VERSION }, { version: VERSION }, { version: VERSION }]);
    await expect(page.getByText(OFFLINE, { exact: true })).toHaveCount(0);
  });

  // -------------------------------------------------------------- AC-7
  test('AC-7 The frame: one sidebar item, the company, Sign out in the account menu; the next person sees only their own page; HR lands on /hr; no HR API from an employee page', async ({ page, signIn, employee, hr, watch, appOrigin, cognito, me }) => {
    noBackendOnly();
    await signInEmployee(page, signIn, employee);
    await expect(formHeading(page)).toBeVisible();

    await openSidebar(page);
    const links = sidebar(page).getByRole('link');
    await expect(links, 'exactly one sidebar item').toHaveCount(1);
    await expect(links.first()).toHaveAccessibleName('Today');
    expect(await links.first().getAttribute('href'), 'Today is /start').toMatch(/^\/start\/?$/);
    await expect(sidebar(page).getByText(ME_COMPANY, { exact: true })).toBeVisible();
    await links.first().click();
    await expect(page).toHaveURL(START);

    await page.goto('/start/privacy-notice');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy notice', exact: true })).toBeVisible();
    await page.goto('/start');
    await expect(formHeading(page)).toBeVisible();

    const calls = watch.apiCalls(appOrigin);
    expect(calls.length, 'the pages asked for /v1/me').toBeGreaterThan(0);
    expect(calls.filter((c) => !/^(GET \/v1\/me|POST \/v1\/me\/consent)$/.test(c)), 'no HR API (or any other API) from an employee page').toEqual([]);

    // Sign out from "Your account".
    await accountButton(page).click();
    await expect(page.getByRole('menu', { name: 'Your account' }).or(page.getByRole('menu')).first()).toBeVisible();
    await signOutItem(page).click();
    await expect(page).toHaveURL(ON_SIGN_IN);
    await expectNoSession(page);

    // The next employee on the same tab sees their own page, nothing of the person before.
    const second = { email: 'jane.smith@sunbird-bakery.co.za', password: 'Second-Employee-1!', givenName: 'Jane', familyName: 'Smith', groups: ['employee'] };
    cognito!.addAccount(second);
    me!.people.set(second.email, { firstName: 'Jane', company: 'Sunbird Bakery', department: 'Sales', startDate: '2027-01-11', consents: {} });
    // Straight from the sign-in page Sign out lands on, with no page load in between.
    await signIn.signInAs(second);
    await expect(page).toHaveURL(START, { timeout: 20_000 });
    await expect(welcome(page, second.givenName)).toBeVisible();
    await expect(page.getByText('Sales · Starts 11 Jan 2027', { exact: true }), 'the second person\'s own department and start date').toBeVisible();
    await expectForm(page, NOTICE_2026_11_1, 'Sunbird Bakery');
    await expect(page.getByText('Operations · Starts 1 Dec 2026', { exact: true }), 'nothing of the person before').toHaveCount(0);
    await expect(page.getByText(ME_COMPANY, { exact: true }), 'not the company of the person before').toHaveCount(0);
    await signOutEmployee(page);
    await expect(page).toHaveURL(ON_SIGN_IN);
    for (const path of ['/start', '/start/privacy-notice']) {
      await page.goto(path);
      await expect(page, `signed out: ${path} lands on /sign-in`).toHaveURL(ON_SIGN_IN);
    }

    // HR opening either page lands on HR home.
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(new RegExp(`${HR_HOME}$`), { timeout: 20_000 });
    for (const path of ['/start', '/start/privacy-notice']) {
      await page.goto(path);
      await expect(page, `HR: ${path} lands on /hr`).toHaveURL(new RegExp(`${HR_HOME}$`));
    }
  });

  // -------------------------------------------------------------- AC-8
  test('AC-8 Every session end clears the HR registration draft: Sign out, a new employee signed in over HR, and a session restore() drops', async ({ page, signIn, employee, hr, cognito, appOrigin }) => {
    noBackendOnly();
    const draft = JSON.stringify({ first_name: 'Ayanda', last_name: 'Zulu', email: 'ayanda.zulu@mokoena-logistics.co.za' });
    const setDraft = () => page.evaluate(([k, v]) => sessionStorage.setItem(k!, v!), [DRAFT_KEY, draft]);
    const getDraft = () => page.evaluate((k) => sessionStorage.getItem(k), DRAFT_KEY);

    // 1. The employee frame's Sign out.
    await signInEmployee(page, signIn, employee);
    await setDraft();
    expect(await getDraft()).toBe(draft);
    await signOutEmployee(page);
    expect(await getDraft(), 'after the employee frame\'s Sign out').toBeNull();

    // 2. /set-password signs a new employee in over an HR session.
    const invite = new InviteFake(appOrigin, cognito);
    await invite.install(page.context());
    const token = invite.add({ company: ME_COMPANY, hrPartnerName: 'Thandeka Dlamini', person: STARTER, startDate: '2026-12-01', state: 'ok' });
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(new RegExp(`${HR_HOME}$`), { timeout: 20_000 });
    await setDraft();
    await page.goto('about:blank');
    await page.goto(`/set-password#token=${token}`);
    await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
    expect(await getDraft(), 'the draft is still there before the password is set').toBe(draft);
    await page.getByLabel('New password', { exact: true }).fill(GOOD_PASSWORD);
    await page.getByRole('button', { name: 'Set password and continue', exact: true }).click();
    await expect(page).toHaveURL(START, { timeout: 20_000 });
    await expect(welcome(page, STARTER.givenName)).toBeVisible();
    expect(await getDraft(), 'after a new employee is signed in over the HR session').toBeNull();

    // 3. A reload whose restore() drops the session (the stored ID token is in no group any more).
    await setDraft();
    await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) ?? '';
        if (!k.endsWith('.idToken')) continue;
        const [h, p, s] = (localStorage.getItem(k) ?? '').split('.');
        const claims = JSON.parse(atob(p!.replace(/-/g, '+').replace(/_/g, '/')));
        delete claims['cognito:groups'];
        const enc = btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        localStorage.setItem(k, `${h}.${enc}.${s}`);
      }
    });
    await page.reload();
    await expect(page, 'restore() dropped the session').toHaveURL(ON_SIGN_IN, { timeout: 20_000 });
    expect(await getDraft(), 'after restore() drops a session').toBeNull();
    await expectNoSession(page);
  });

  // -------------------------------------------------------------- AC-9
  test('AC-9 Keyboard and screen reader: skip link, Tab to the box, Space ticks, Enter accepts; the error and the record are announced; focus moves to the record', async ({ page, signIn, employee, me }) => {
    noBackendOnly();
    await signInEmployee(page, signIn, employee);
    await expect(formHeading(page)).toBeVisible();

    // The skip link is the first stop and reaches the main area.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content', exact: true });
    await expect(skip, 'the first Tab reaches the skip link').toBeFocused();
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => !!document.activeElement?.closest('main')), 'Enter moves focus into the main area').toBe(true);

    const tabTo = async (target: Locator, what: string) => {
      for (let i = 0; i < 60; i++) {
        if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
        await page.keyboard.press('Tab');
      }
      throw new Error(`Tab never reaches ${what}`);
    };

    // Enter on the button without the tick: the error is announced and focus goes to the box.
    await tabTo(acceptButton(page), ACCEPT);
    await page.keyboard.press('Enter');
    await expectAnnounced(page, UNTICKED, checkbox(page));
    await expect(checkbox(page)).toBeFocused();
    expect(me!.posts()).toHaveLength(0);

    // Space ticks, Enter on the button accepts.
    await page.keyboard.press('Space');
    await expect(checkbox(page)).toBeChecked();
    await tabTo(acceptButton(page), ACCEPT);
    await page.keyboard.press('Enter');
    await expect(agreed(page, VERSION)).toBeVisible();
    expect(me!.posts()).toHaveLength(1);

    // The saved record is announced and has focus.
    await expect(page.getByRole('status').filter({ hasText: AGREED(VERSION) }), 'the record sits in role=status').toHaveCount(1);
    const focused = await page.evaluate((text) => {
      const a = document.activeElement;
      if (!a || a === document.body) return false;
      return (a.textContent ?? '').includes(text);
    }, AGREED(VERSION));
    expect(focused, 'focus moves to the record').toBe(true);
  });

  // -------------------------------------------------------------- AC-10
  test('AC-10 Phone: /start before and after accepting, and the notice page, fit 390 wide; buttons at least 44 pixels tall', async ({ page, signIn, employee }, testInfo) => {
    noBackendOnly();
    test.skip(testInfo.project.name !== 'phone-390', 'The phone criterion: runs at 390 wide.');

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
    const n = filled(NOTICE_2026_11_1, ME_COMPANY);
    const tickLabel = page.locator('label').filter({ hasText: TICK });

    await signInEmployee(page, signIn, employee);
    await expect(formHeading(page)).toBeVisible();
    await check('/start before accepting', [
      welcome(page, employee.givenName),
      page.getByText('Operations · Starts 1 Dec 2026', { exact: true }),
      formHeading(page),
      ...n.terms.map((t) => page.getByText(t.text, { exact: true })),
      tickLabel,
      page.getByRole('link', { name: READ_FULL, exact: true }),
    ], [acceptButton(page)]);

    await acceptButton(page).click();
    await expect(page.getByText(UNTICKED, { exact: true })).toBeVisible();
    await check('/start with the error', [page.getByText(UNTICKED, { exact: true }), tickLabel], [acceptButton(page)]);

    await checkbox(page).check();
    await acceptButton(page).click();
    await expect(agreed(page, VERSION)).toBeVisible();
    await check('/start after accepting', [welcome(page, employee.givenName), agreed(page, VERSION), page.getByRole('link', { name: READ_RECORD, exact: true }), step(page, 'Documents')], []);

    await page.getByRole('link', { name: READ_RECORD, exact: true }).click();
    await expect(page).toHaveURL(NOTICE_PAGE);
    await check('the notice page', [
      page.getByRole('heading', { level: 1, name: 'Privacy notice', exact: true }),
      ...n.full.map((s) => sectionHeading(page, s.heading)),
      page.getByText(n.full[5]!.text, { exact: true }),
      page.getByRole('link', { name: BACK, exact: true }),
    ], []);
  });

  // -------------------------------------------------------------- AC-11
  test('AC-11 pepla-dev: the employee test login signs in, accepts the notice for Sunbird Bakery once, and a reload shows the record @pepla-dev', async ({ page, signIn, employee }, testInfo) => {
    test.skip(!ON_DEV, 'Runs on pepla-dev only, after ONB-05 is merged and deployed there.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs once, at one width.');
    test.setTimeout(120_000);
    await signIn.open();
    await signIn.signInAs(employee);
    await expect(page).toHaveURL(START, { timeout: 30_000 });
    await expect(welcome(page, employee.givenName)).toBeVisible();

    // The seed removed this persona's consent rows: the form for the current version, with the dev company.
    await expect(formHeading(page), 'the consent form (the seed removed earlier acceptances)').toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Sunbird Bakery/).first(), 'the company from COMPANY_NAME').toBeVisible();
    await expect(checkbox(page)).not.toBeChecked();
    await checkbox(page).check();
    await acceptButton(page).click();
    const saved = page.getByText(/^You agreed to the privacy notice \(version [\w.-]+\)\.$/);
    await expect(saved, 'the record').toBeVisible({ timeout: 30_000 });

    // A reload shows the record, not the form: a second accept is impossible.
    await page.reload();
    await expect(saved).toBeVisible({ timeout: 30_000 });
    await expect(checkbox(page)).toHaveCount(0);
    await expect(acceptButton(page)).toHaveCount(0);
    await signOutEmployee(page);
  });

  // -------------------------------------------------------------- AC-12
  test('AC-12 Text check: routes, group check first, the table, the two roles and KMS, pp-* only, the words, no new header', async ({}, testInfo) => {
    onceOnly(testInfo);
    const app = join(WEB, 'src', 'app');

    // Routes: /start and /start/privacy-notice behind employeeGuard, with their titles.
    const routes = readFileSync(join(app, 'app.routes.ts'), 'utf8');
    const start = routeBlock(routes, 'start');
    expect(start, 'app.routes.ts has a start route').not.toBeNull();
    expect(start!, '/start is behind employeeGuard').toMatch(/canActivate\s*:\s*\[\s*employeeGuard\s*\]/);
    expect(start!, '"Welcome · Naleko People"').toMatch(/title\s*:\s*['"`]Welcome · Naleko People['"`]/);
    const nested = routeBlock(start!, 'privacy-notice');
    const flat = routeBlock(routes, 'start/privacy-notice');
    const notice = nested ?? flat;
    expect(notice, 'a privacy-notice route under /start').not.toBeNull();
    expect(notice!, '"Privacy notice · Naleko People"').toMatch(/title\s*:\s*['"`]Privacy notice · Naleko People['"`]/);
    if (!nested) expect(flat!, '/start/privacy-notice is behind employeeGuard').toMatch(/canActivate\s*:\s*\[\s*employeeGuard\s*\]/);

    // Both Lambdas check the employee group before any send(.
    for (const fn of ['getMyStart', 'recordConsent']) {
      const file = join(REPO, 'lambda', fn, 'index.mjs');
      expect(existsSync(file), `lambda/${fn}/index.mjs`).toBe(true);
      expect(existsSync(join(REPO, 'lambda', fn, 'package.json')), `lambda/${fn}/package.json (build-lambdas.py builds every folder that has one)`).toBe(true);
      const text = stripComments(readFileSync(file, 'utf8'));
      const handlerAt = text.search(/export\s+(const|async\s+function|function)\s+handler\b/);
      expect(handlerAt, `${fn}: exports handler`).toBeGreaterThanOrEqual(0);
      const body = text.slice(handlerAt);
      // The group is read by name (groupsOf splits the claim), in the handler or a shared file it imports.
      const imported = [...text.matchAll(/from\s+['"](\.\.?\/[^'"]+)['"]/g)].map((m) => join(REPO, 'lambda', fn, m[1]!)).filter((f) => existsSync(f));
      expect([text, ...imported.map((f) => readFileSync(f, 'utf8'))].join('\n'), `${fn}: reads the groups with groupsOf (never a substring match)`).toMatch(/groupsOf\s*\(/);
      const group = body.search(/groupsOf\s*\(|['"`]employee['"`]|EMPLOYEE_GROUP/);
      const send = body.search(/\.send\s*\(/);
      if (group >= 0 && send >= 0) expect(group, `${fn}: the group check comes before the first send( in the handler`).toBeLessThan(send);
    }
    for (const f of ['privacy-notice.mjs', 'consent.mjs']) expect(existsSync(join(REPO, 'lambda', 'shared', f)), `lambda/shared/${f}`).toBe(true);

    // The table.
    const files = tfFiles();
    const res = (type: string) => blocks(files, 'resource').filter((b) => b.labels[0] === type);
    const attr = (b: { body: string }, name: string) => new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm').exec(b.body)?.[1]?.trim().replace(/\s+/g, '') ?? '';
    const table = res('aws_dynamodb_table').find((b) => attr(b, 'name') === `"${CONSENTS}"`);
    expect(table, `a DynamoDB table named ${CONSENTS}`).toBeTruthy();
    const T = table!.labels[1]!;
    expect(attr(table!, 'hash_key'), 'hash key employee_id').toBe('"employee_id"');
    expect(attr(table!, 'range_key'), 'range key notice_version').toBe('"notice_version"');
    expect(attr(table!, 'billing_mode'), 'on demand').toBe('"PAY_PER_REQUEST"');
    expect(attr(table!, 'deletion_protection_enabled'), 'deletion protection').toBe('true');
    expect(table!.body, 'point-in-time recovery').toMatch(/point_in_time_recovery\s*\{\s*enabled\s*=\s*true\s*\}/);
    expect(table!.body, 'encrypted with the PII KMS key').toMatch(/server_side_encryption\s*\{\s*enabled\s*=\s*true\s*kms_key_arn\s*=\s*module\.kms_pii\.key_arn\s*\}/);
    expect(table!.body, 'prevent_destroy, as every table').toMatch(/lifecycle\s*\{[^}]*prevent_destroy\s*=\s*true/);
    expect(table!.body, 'no time to live: rows are kept').not.toMatch(/\bttl\s*\{/);

    // The two roles: logs, X-Ray and exactly their DynamoDB actions.
    type Row = { effect: string; action: string; resource: string };
    const flatten = (s: unknown): Row[] => (Array.isArray(s) ? s : [s]).flatMap((st: any) => {
      const actions = ([] as string[]).concat(st.Action ?? []);
      const resources = ([] as string[]).concat(st.Resource ?? []);
      return actions.flatMap((action) => resources.map((resource) => ({ effect: st.Effect, action, resource: resource.replace(/\$\{([^}]+)\}/g, '$1') })));
    });
    const isConsents = (r: string) => r === `arn:aws:dynamodb:af-south-1:000000000000:table/${CONSENTS}` || r === `aws_dynamodb_table.${T}.arn`;
    const isEmailIndex = (r: string) => r === 'arn:aws:dynamodb:af-south-1:000000000000:table/employees/index/email-index' || r === 'aws_dynamodb_table.employees.arn/index/email-index';
    const NEW = [
      { fn: 'getMyStart', route: 'GET /v1/me', want: [['dynamodb:Query', isEmailIndex], ['dynamodb:GetItem', isConsents]] as const },
      { fn: 'recordConsent', route: 'POST /v1/me/consent', want: [['dynamodb:Query', isEmailIndex], ['dynamodb:GetItem', isConsents], ['dynamodb:PutItem', isConsents]] as const },
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

      // Its route: on the employees API, behind the Cognito JWT authorizer.
      const route = res('aws_apigatewayv2_route').find((b) => attr(b, 'route_key') === `"${n.route}"`.replace(/\s+/g, ''));
      expect(route, `a route ${n.route}`).toBeTruthy();
      expect(attr(route!, 'api_id'), `${n.route}: on the employees API`).toBe('aws_apigatewayv2_api.employees_api.id');
      expect(attr(route!, 'authorization_type'), `${n.route}: JWT`).toBe('"JWT"');
      expect(attr(route!, 'authorizer_id'), `${n.route}: the Cognito authorizer`).toBe('aws_apigatewayv2_authorizer.employees_api_cognito.id');
    }
    const kms = blocks(files, 'module').find((b) => b.labels[0] === 'kms_pii');
    const list = (name: string) => /\[([^\]]*)\]/.exec(new RegExp(`${name}\\s*=\\s*\\[[^\\]]*\\]`).exec(kms!.body)?.[0] ?? '')?.[1] ?? '';
    for (const role of roles) expect(list('dynamodb_read_role_arns'), `${role} is in kms_pii dynamodb_read_role_arns (LESSONS 15 Nov)`).toContain(`aws_iam_role.${role}.arn`);

    // No new request header: the employees API's CORS list is as it was.
    const api = res('aws_apigatewayv2_api').find((b) => b.labels[1] === 'employees_api')!;
    const allow = (/allow_headers\s*=\s*\[([^\]]*)\]/.exec(api.body)?.[1] ?? '').split(',').map((h) => h.trim().replace(/"/g, '').toLowerCase()).filter(Boolean).sort();
    expect(allow, 'the employees API allows the same request headers as before').toEqual(['authorization', 'content-type', 'idempotency-key']);

    // Alarm, log group and dashboard lists: every list that names createEmployee names both.
    for (const file of ['alarms.tf', 'cloudwatch.tf', 'dashboards.tf']) {
      const text = stripComments(readFileSync(join(REPO, 'infra', file), 'utf8'));
      const named = (l: string, name: string) => new RegExp(`"(/aws/lambda/)?${name}"`).test(l);
      const lists = [...text.matchAll(/\[[^\[\]]*\]/g)].map((m) => m[0]).filter((l) => named(l, 'createEmployee'));
      expect(lists.length, `infra/${file} has a list naming createEmployee`).toBeGreaterThan(0);
      for (const fn of ['getMyStart', 'recordConsent']) for (const l of lists) expect(named(l, fn), `infra/${file}: every list that names createEmployee names ${fn}`).toBe(true);
    }
    // The dev seed starts each run unconsented; the cleanup removes consent rows.
    expect(readFileSync(join(REPO, 'scripts', 'ci', 'seed-dev.py'), 'utf8'), 'seed-dev.py removes the persona\'s consent rows').toMatch(/employee_consents/);
    expect(readFileSync(join(REPO, 'scripts', 'ci', 'cleanup-dev-e2e.py'), 'utf8'), 'cleanup-dev-e2e.py removes consent rows').toMatch(/employee_consents/);

    // The new files: no "Masked", "credentials" or "Work email"; no extra header; nothing paid AI.
    const startDir = join(app, 'features', 'start');
    const mine = [
      ...walk(startDir).filter((f) => /\.(ts|html)$/.test(f)),
      ...walk(join(WEB, 'src')).filter((f) => /\.ts$/.test(f) && !f.startsWith(startDir) && /\/v1\/me\b/.test(readFileSync(f, 'utf8'))),
      join(REPO, 'lambda', 'getMyStart', 'index.mjs'),
      join(REPO, 'lambda', 'recordConsent', 'index.mjs'),
      join(REPO, 'lambda', 'shared', 'privacy-notice.mjs'),
      join(REPO, 'lambda', 'shared', 'consent.mjs'),
    ];
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
