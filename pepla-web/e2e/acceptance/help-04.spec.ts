import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import * as company from '../fixtures/help-company';
import { ON_DEV } from './support/fixtures';
import {
  ESCAPE_URL,
  WEB,
  WIDTHS,
  failedOnBoth,
  helpRun,
  mediaSnapshot,
  missingTools,
  passedOnBoth,
  pictureDiff,
  placeRun,
  pngSize,
  prChanges,
  projectUse,
  retakeRepo,
  runJourney,
  startFront,
  videoFrame,
  videoInfo,
  type FrontMode,
  type HelpRun,
  type PageEvent,
  type Run,
  type Width,
} from './support/journey-harness';
import { LOCKED_NEW_EMPLOYEES, PHONE, codeOnly, fixtureIdNumbers, fixtureStrings, peopleNames } from './support/help-02';
import { LOCKED_JOHAN_DETAIL, LOCKED_STEPS, type Scroll } from './support/help-03';
import {
  CARD,
  FORM_HEADING,
  LOCKED_PEOPLE,
  PICTURES,
  REGISTERED_HEADING,
  addsAnEmployeeReference,
  watcher,
  type AddsAnEmployeeReference,
  type Answer,
  type Call,
  type ShotFacts,
} from './support/help-04';

/**
 * HELP-04 · Help pictures: HR adds a new employee (Jira NH-173, epic NH-150).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/HELP-04.md (16 Nov 2026).
 *
 * The card's work is a journey, e2e/journeys/hr-adds-an-employee.e2e.ts:
 * Pieter van Wyk (HR at the fake company Sunbird Bakery) registers Thandi
 * Mahlangu in the four steps, sees her registered, opens her page and resends
 * her invite link. These tests run that journey the way CI does (normal run:
 * `npm run e2e`; help run: `npm run e2e:help`) through
 * support/journey-harness.ts, and check what it does and what it writes. The
 * help run goes through the recorder with support/help-04.ts `watcher`, which
 * also sees each picture's scroll position and page facts, every request the
 * page makes and every answer of the two APIs. They run once, in the
 * desktop-1280 project, and check the journey's desktop and phone runs
 * themselves. No-backend run only.
 *
 * Needs ffmpeg, ffprobe, ImageMagick (`compare`) and python3, like HELP-01.
 *
 * These files are locked once accepted: see ./README.md and cards/help-04.md.
 */

const FILE = 'hr-adds-an-employee.e2e.ts';
const JOURNEY = join(WEB, 'e2e', 'journeys', FILE);
const FIXTURE = join(WEB, 'e2e', 'fixtures', 'help-company.ts');
const HELP_TS = join(WEB, 'e2e', 'support', 'help.ts');
/** The three help journeys before this card, as HELP-02.3, HELP-02 and HELP-03 left them (develop f664706, unchanged at 5c48278). */
const LOCKED_JOURNEYS: Record<string, string> = {
  'sign-in.e2e.ts': '5c8e0cb4b4e4cfab5737c7b1c578e1f728cb266db5fa3f69d4e8feba0cd48e21',
  'who-is-starting.e2e.ts': '33b516bb8656043498a687991c82ac267ed0ad277e3510171049dc808e09c2b6',
  'hr-checks-a-document.e2e.ts': '1e8e68d3ad7c06024947600ae66d7cb0828a5ce4857ccfcfe52e8fbd032fa45c',
};
const FOLDER = 'adds-an-employee';
const VIDEO = 'hr-adds-an-employee';
const OTHER_FOLDERS = ['sign-in', 'who-is-starting', 'checks-a-document'];

/** An API address of the no-backend build (src/environments/environment.ts). */
const apiUrl = (key: 'documentUploadApiUrl' | 'employeesApiUrl'): string => {
  const env = readFileSync(join(WEB, 'src', 'environments', 'environment.ts'), 'utf8');
  return new RegExp(`${key}:\\s*'([^']+)'`).exec(env)?.[1] ?? `https://${key}.invalid`;
};
const DOC_API = apiUrl('documentUploadApiUrl');
const EMPLOYEES_API = apiUrl('employeesApiUrl');
const ID = CARD.employee.id;

// ---------------------------------------------------------------- each run happens once, shared by the tests

const once = <T>(make: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => (p ??= make());
};

const normalRun = once(async () => {
  const front = await startFront({ kind: 'plain' });
  const before = mediaSnapshot();
  try {
    const run = await runJourney(FILE, { help: false, base: front.url, tag: 'h4-normal' });
    return { run, wrote: diffSnapshots(before, mediaSnapshot()) };
  } finally {
    await front.close();
  }
});
const firstHelpRun = once(() => helpRun(FILE, FOLDER, 'h4-help-1', watcher(EMPLOYEES_API, DOC_API)));
const secondHelpRun = once(async () => {
  await firstHelpRun();
  return helpRun(FILE, FOLDER, 'h4-help-2', watcher(EMPLOYEES_API, DOC_API));
});
const probeRun = (tag: string, mode: FrontMode) =>
  once(async () => {
    const front = await startFront(mode);
    try {
      return await runJourney(FILE, { help: false, base: front.url, tag });
    } finally {
      await front.close();
    }
  });

/** Requests the journey must not let through (AC-4): another host, Postmark, a Batsi summary, an AI route. */
const ESCAPES = [
  ['another host', ESCAPE_URL],
  ['Postmark (an email leaving)', 'https://api.postmarkapp.com/email'],
  ['a Batsi summary', `${DOC_API}/v1/verifications/${ID}/summary`],
  ['an AI route on the employees API', `${EMPLOYEES_API}/v1/ai/welcome-email`],
] as const;
const escapeRuns = ESCAPES.map(([, url], i) => probeRun(`h4-escape-${i}`, { kind: 'escape', url }));

/** Renamed controls (AC-7): the journey must fail instead of keeping an old caption. */
const FIELD = 'label, .pp-field__label';
const RENAMES: ReadonlyArray<readonly [string, FrontMode]> = [
  ['"Add new employee" renamed', { kind: 'rename', words: { 'Add new employee': 'New hire' }, selector: 'a' }],
  ['the "First name" label renamed', { kind: 'rename', words: { 'First name': 'Given name' }, selector: FIELD }],
  ['the "Last name" label renamed', { kind: 'rename', words: { 'Last name': 'Surname' }, selector: FIELD }],
  ['the "Email address" label renamed', { kind: 'rename', words: { 'Email address': 'Email' }, selector: FIELD }],
  ['the "Phone number" label renamed', { kind: 'rename', words: { 'Phone number': 'Mobile' }, selector: FIELD }],
  ['the "Department" label renamed', { kind: 'rename', words: { Department: 'Team' }, selector: FIELD }],
  ['the "Job title" label renamed', { kind: 'rename', words: { 'Job title': 'Role' }, selector: FIELD }],
  ['the "Start date" label renamed', { kind: 'rename', words: { 'Start date': 'First day' }, selector: FIELD }],
  ['"Next: job and start date" renamed', { kind: 'rename', words: { 'Next: job and start date': 'Continue' }, selector: 'button' }],
  ['"Next: HR partner" renamed', { kind: 'rename', words: { 'Next: HR partner': 'Continue' }, selector: 'button' }],
  ['"Next: check details" renamed', { kind: 'rename', words: { 'Next: check details': 'Continue' }, selector: 'button' }],
  ['"Register Thandi" renamed', { kind: 'rename', words: { [`Register ${CARD.employee.first}`]: 'Save' }, selector: 'button' }],
  ['"View employee" renamed', { kind: 'rename', words: { 'View employee': 'Open profile' }, selector: 'a' }],
  ['the "Invite link" heading renamed', { kind: 'rename', words: { 'Invite link': 'Sign-in link' }, selector: 'h1, h2, h3' }],
  ['"Resend link" renamed', { kind: 'rename', words: { 'Resend link': 'Send again' }, selector: 'button' }],
];
const renameRuns = RENAMES.map(([, mode], i) => probeRun(`h4-rename-${i}`, mode));

function diffSnapshots(a: Record<string, string>, b: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => a[k] !== b[k]).sort();
}

const source = () => (existsSync(JOURNEY) ? readFileSync(JOURNEY, 'utf8') : '');

function why(run: Run): string {
  const errors = run.results.filter((r) => r.error).map((r) => `[${r.project}] ${r.error}`);
  return errors.length ? errors.join('\n').slice(0, 3000) : run.output.slice(-1500);
}

function expectPassed(run: Run, what: string): void {
  expect(run.results.length, `${what}: the journey ${FILE} exists and ran\n${why(run)}`).toBeGreaterThan(0);
  expect(passedOnBoth(run), `${what}: the journey passes on desktop and phone\n${why(run)}`).toBe(true);
}

function picture(run: HelpRun, width: Width, name: string): string {
  return join(run.dir, width, FOLDER, `${name}.png`);
}
function video(run: HelpRun, width: Width): string {
  return join(run.dir, width, FOLDER, `${VIDEO}.webm`);
}

/** The recorder's events for one width, in the order they happened. */
function eventsFor(run: HelpRun, width: Width): PageEvent[] {
  const phone = (e: PageEvent) => e.width <= projectUse('phone').viewport.width + 10;
  const mine = run.events.filter((e) => (width === 'phone' ? phone(e) : !phone(e)));
  const pages = [...new Set(mine.map((e) => e.page))];
  return pages.flatMap((p) => mine.filter((e) => e.page === p).sort((a, b) => a.seq - b.seq));
}

const ofType = <T>(run: HelpRun, width: Width, type: string): T[] =>
  eventsFor(run, width)
    .filter((e) => e.type === (type as PageEvent['type']))
    .map((e) => JSON.parse(e.name) as T);

/** Where the window was at each picture (the watcher's "shot" events). */
function shots(run: HelpRun, width: Width): Scroll[] {
  return eventsFor(run, width)
    .filter((e) => e.type === ('shot' as PageEvent['type']))
    .map((e) => {
      const [x = 0, y = 0, mx = 0, my = 0] = e.name.split(',').map(Number);
      return { x, y, mx, my };
    });
}
const facts = (run: HelpRun, width: Width) => ofType<ShotFacts>(run, width, 'facts');
const calls = (run: HelpRun, width: Width) => ofType<Call>(run, width, 'call');
const answers = (run: HelpRun, width: Width) => ofType<Answer>(run, width, 'answer');

/** "GET /v1/employees" style name of a call to one of the two APIs, or null for anything else. */
function apiCall(c: { m: string; u: string }): string | null {
  const u = new URL(c.u);
  if (u.origin === new URL(EMPLOYEES_API).origin) return `employees ${c.m} ${u.pathname}`;
  if (u.origin === new URL(DOC_API).origin) return `documents ${c.m} ${u.pathname}`;
  return null;
}

const references = new Map<Width, Promise<AddsAnEmployeeReference>>();
function reference(browser: Browser, run: HelpRun, width: Width): Promise<AddsAnEmployeeReference> {
  if (!references.has(width)) references.set(width, addsAnEmployeeReference(browser, width, shots(run, width), { employees: EMPLOYEES_API, documents: DOC_API }));
  return references.get(width)!;
}

/** Each picture is its reference: the important parts, the whole picture, and no caption bar. */
async function expectLikeReference(page: Page, browser: Browser, run: HelpRun): Promise<void> {
  for (const width of WIDTHS) {
    const ref = await reference(browser, run, width);
    const use = projectUse(width);
    const captionZone = { x: 0, y: use.viewport.height - 110, width: use.viewport.width, height: 110 };
    for (const [i, name] of PICTURES.entries()) {
      const shot = readFileSync(picture(run, width, name));
      const opts = { cssWidth: ref.cssWidth };
      for (const [part, region] of Object.entries(ref.regions[i]!)) {
        const d = await pictureDiff(page, shot, ref.pictures[i]!, { ...opts, region });
        expect(d, `[${width}] ${name}: ${part} looks as on the card`).toBeLessThanOrEqual(0.03);
      }
      const whole = await pictureDiff(page, shot, ref.pictures[i]!, { content: true });
      expect(whole, `[${width}] ${name}: the whole picture is this step`).toBeLessThanOrEqual(0.03);
      const caption = await pictureDiff(page, shot, ref.pictures[i]!, { ...opts, region: captionZone });
      expect(caption, `[${width}] ${name}: no caption bar`).toBeLessThanOrEqual(0.01);
    }
  }
}

/** The captions the card's journey shows, in order (spec "The journey"). */
function expectedCaptions(width: Width): string[] {
  const act = width === 'phone' ? 'Tap' : 'Click';
  return [
    `${act} Add new employee`,
    'Enter First name',
    'Enter Last name',
    'Enter Email address',
    'Enter Phone number',
    `${act} Next: job and start date`,
    'Choose Department',
    'Enter Job title',
    'Enter Start date',
    `${act} Next: HR partner`,
    `${act} Next: check details`,
    `${act} Register ${CARD.employee.first}`,
    `${act} View employee`,
    'Scroll to Invite link',
    `${act} Resend link`,
  ];
}

/** What the journey must post: the card's values, the partner id the page was given, no ID number. */
function expectedBody(partnerId: string): Record<string, string> {
  return {
    first_name: CARD.employee.first,
    last_name: CARD.employee.last,
    email: CARD.employee.email,
    phone: CARD.phone,
    department: CARD.department,
    job_title: CARD.jobTitle,
    planned_start_date: CARD.start,
    hr_staff_id: partnerId,
  };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- tests

test.describe('HELP-04 Help pictures: HR adds a new employee', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(ON_DEV, 'No-backend run only: the journey answers Cognito and both APIs in the browser.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs the journey once; it checks the desktop and phone runs itself.');
    testInfo.setTimeout(30 * 60_000);
  });

  test('AC-1 The journey passes in the normal run on desktop and phone and writes nothing to help/media', async () => {
    const { run, wrote } = await normalRun();
    expectPassed(run, 'normal run (npm run e2e)');
    expect(run.results.map((r) => r.title), 'the journey test is named as on the card').toContain('HR adds a new employee');
    expect(wrote, 'the normal run writes nothing to help/media').toEqual([]);
  });

  test('AC-2 Exactly seven pictures per width, at 1440x900 and 390x844', async () => {
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    for (const width of WIDTHS) {
      const folder = join(run.dir, width, FOLDER);
      const pngs = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.png')).sort() : [];
      expect(pngs, `help/media/${width}/${FOLDER}/ holds exactly these pictures`).toEqual(PICTURES.map((p) => `${p}.png`));
      const use = projectUse(width);
      expect(use.viewport, `[${width}] the journeys' size`).toEqual(width === 'phone' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
      for (const name of PICTURES) {
        expect(pngSize(picture(run, width, name)), `[${width}] ${name}.png size`).toEqual({
          width: use.viewport.width * use.deviceScaleFactor,
          height: use.viewport.height * use.deviceScaleFactor,
        });
      }
    }
  });

  test('AC-3 Each picture shows its step: the four steps filled, registered, the Invite link card at 09:00 and 09:05; no caption bar', async ({ page, browser }) => {
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    for (const width of WIDTHS) expect(shots(run, width), `[${width}] the journey took a picture at each of the seven steps`).toHaveLength(PICTURES.length);
    // The references are taken here and checked against the card first
    // (support/help-04.ts addsAnEmployeeReference): 01 step 1 filled with
    // Personal information current, Middle name and ID number empty; 02 step 2
    // filled (Operations, Junior baker, 16 Mar 2026); 03 Pieter van Wyk chosen,
    // Staff ID HR-001; 04 the three Confirmation cards with no ID number row;
    // 05 "A welcome email was sent to thandi@example.com."; 06 the Invite link
    // card at 09:00; 07 the same card at 09:05. On the phone the parts below
    // the fold of 01, 02 and 04 are left to the desktop picture (AC-8 keeps
    // the heading in the top third there).
    await expectLikeReference(page, browser, run);
    // Whatever the scroll: no ID number row on the page at any picture, and the
    // page at each picture is the step's page.
    for (const width of WIDTHS) {
      const f = facts(run, width);
      expect(f.map((x) => x.path), `[${width}] the page at each picture`).toEqual([...Array(5).fill('/hr/employees/new'), `/hr/employees/${ID}`, `/hr/employees/${ID}`]);
      expect(f.slice(0, 5).map((x) => x.heading), `[${width}] the page heading at pictures 01 to 05`).toEqual([FORM_HEADING, FORM_HEADING, FORM_HEADING, FORM_HEADING, REGISTERED_HEADING]);
      expect(f.filter((x) => x.idRow), `[${width}] no ID number row at any picture`).toEqual([]);
    }
  });

  test('AC-4 No email leaves, no AI: only the app, Cognito, the card\'s nine API calls with a token, and fonts; anything else fails the journey', async () => {
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    const allowed = [
      'employees GET /v1/employees',
      'employees GET /v1/employees/email-check',
      'employees GET /v1/hr-partners',
      'employees POST /v1/employees',
      `documents GET /v1/employees/${ID}/verifications`,
      `employees GET /v1/employees/${ID}/invite`,
      `employees POST /v1/employees/${ID}/invite`,
    ];
    for (const width of WIDTHS) {
      const seen = calls(run, width);
      expect(seen.length, `[${width}] the watcher saw the page's requests`).toBeGreaterThan(0);
      const unexpected: string[] = [];
      const api: string[] = [];
      for (const c of seen) {
        const u = new URL(c.u);
        if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(u.host)) continue; // the app itself
        if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.host)) continue; // the web fonts
        if (/^cognito-idp\.[a-z0-9-]+\.amazonaws\.com$/.test(u.host)) continue; // the Cognito fake
        const name = apiCall(c);
        if (!name) {
          unexpected.push(`${c.m} ${c.u}`);
          continue;
        }
        if (!c.auth) unexpected.push(`${c.m} ${c.u} without a Bearer token`);
        api.push(name);
      }
      expect(unexpected, `[${width}] the page asks nothing else, and every API call carries a Bearer token`).toEqual([]);
      // MOD-02: the app shell asks which modules the company has, on every page. Only that GET is allowed besides the card's routes.
      const shell = ['employees GET /v1/company/modules'];
      expect(api.filter((a) => !allowed.includes(a) && !shell.includes(a)), `[${width}] the APIs are asked only the card's routes (and the shell's modules GET)`).toEqual([]);
      for (const a of allowed) expect(api.includes(a), `[${width}] the page made the call ${a}`).toBe(true);
      expect(api.filter((a) => a === 'employees POST /v1/employees'), `[${width}] exactly one POST /v1/employees`).toHaveLength(1);
      expect(api.filter((a) => a === `employees POST /v1/employees/${ID}/invite`), `[${width}] exactly one Resend link`).toHaveLength(1);

      // The email check was made for Thandi's address and said it is free.
      const checks = seen.filter((c) => apiCall(c) === 'employees GET /v1/employees/email-check').map((c) => new URL(c.u).searchParams.get('email'));
      expect(checks.length, `[${width}] the email check was made`).toBeGreaterThan(0);
      expect(checks.every((e) => e === CARD.employee.email), `[${width}] the email check asked about ${CARD.employee.email}: ${checks.join(', ')}`).toBe(true);
      const checked = answers(run, width).filter((a) => apiCall(a) === 'employees GET /v1/employees/email-check');
      expect(checked.map((a) => [a.status, JSON.parse(a.body || '{}').inUse]), `[${width}] the email check answered { inUse: false }`).toEqual(checks.map(() => [200, false]));
    }

    // A request to any other host or route fails the journey on both widths.
    const plain = (await normalRun()).run;
    expectPassed(plain, 'normal run');
    for (const [i, [what, url]] of ESCAPES.entries()) {
      const r = await escapeRuns[i]!();
      expect(failedOnBoth(r), `when the page asks ${what} (${url}), the journey fails on desktop and phone\n${r.results.map((x) => `[${x.project}] ${x.status}`).join(', ')}`).toBe(true);
    }
  });

  test('AC-5 Only Sunbird Bakery, nothing private: data from help-company.ts, the locked lists unchanged, no ID number, only 000 000 0000', async () => {
    expect(company.HELP_PEOPLE, 'HELP_PEOPLE is exactly as HELP-01 locked it').toEqual(LOCKED_PEOPLE);
    expect(company.HELP_NEW_EMPLOYEES, 'HELP_NEW_EMPLOYEES is exactly as HELP-01.2 locked it').toEqual(LOCKED_NEW_EMPLOYEES);
    expect(company.HELP_NEW_EMPLOYEE_STEPS, 'HELP_NEW_EMPLOYEE_STEPS is exactly as ONB-09 left it').toEqual(LOCKED_STEPS);
    expect(company.HELP_JOHAN_DETAIL, 'HELP_JOHAN_DETAIL is exactly as HELP-02 left it').toEqual(LOCKED_JOHAN_DETAIL);

    // The card's sample values are written in help-company.ts, and not in the journey or in help.ts.
    const fixture = codeOnly(readFileSync(FIXTURE, 'utf8'));
    const helpTs = codeOnly(readFileSync(HELP_TS, 'utf8'));
    const samples = [CARD.phone, CARD.department, CARD.jobTitle, CARD.partner.staffId];
    for (const s of samples) expect(fixture, `help-company.ts holds "${s}"`).toMatch(new RegExp(`['"\`]${esc(s)}['"\`]`));

    const src = source();
    expect(src, `${FILE} exists`).not.toBe('');
    expect(src, 'people and data come from e2e/fixtures/help-company.ts').toMatch(/from\s+['"]\.\.\/fixtures\/help-company(\.js|\.ts)?['"]/);
    const code = codeOnly(src);
    for (const [where, text] of [[FILE, code], ['e2e/support/help.ts', helpTs]] as const) {
      expect(text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [], `no email address is written in ${where}`).toEqual([]);
      expect(peopleNames().filter((n) => new RegExp(`\\b${n}\\b`).test(text)), `no person's name is written in ${where}`).toEqual([]);
      expect(samples.filter((s) => text.includes(s)), `no phone, department, job title or staff ID is written in ${where}`).toEqual([]);
      expect(text.match(new RegExp(PHONE.source, 'g')) ?? [], `no phone number is written in ${where}`).toEqual([]);
    }
    expect(code.match(/(?<!\d)0{3}(?!\d)|\d{6,}/g) ?? [], 'no phone or ID digits are written in the journey').toEqual([]);
    expect(code.match(/\d{4}-\d{2}-\d{2}|\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}/g) ?? [], 'no date is written in the journey').toEqual([]);
    expect(code, 'the journey never names the ID number field').not.toMatch(/['"`]ID number['"`]/);
    expect(code, 'the journey types no title from HELP_PEOPLE').not.toMatch(/baker|Owner|payroll|assistant|driver/i);

    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    const emails = new Set<string>(LOCKED_PEOPLE.map((p) => p.email));
    for (const width of WIDTHS) {
      const events = eventsFor(run, width);
      const text = events.filter((e) => e.type === 'text');
      expect(events.filter((e) => e.type === 'scroll').length, `[${width}] the watcher watched the page`).toBeGreaterThan(0);
      expect(text.filter((e) => e.name.startsWith('email:') && !emails.has(e.name.slice(6))), `[${width}] every email on the page is a Sunbird Bakery person's`).toEqual([]);
      expect(text.filter((e) => e.name.startsWith('phone:')).map((e) => e.name.slice(6)), `[${width}] the only phone number on the page is ${CARD.phone}`).toEqual([CARD.phone]);
      expect(events.filter((e) => e.type === 'input' && /^ID number$/i.test(e.name)), `[${width}] the ID number field is never typed in`).toEqual([]);
      const f = facts(run, width);
      expect(f, `[${width}] the watcher saw the page at every picture`).toHaveLength(PICTURES.length);
      expect(f.filter((x) => x.idDigits || x.idRow), `[${width}] no ID number in the page text at any picture`).toEqual([]);

      // What was sent: exactly the card's values, the partner the page was given, no ID number.
      const partners = answers(run, width).filter((a) => apiCall(a) === 'employees GET /v1/hr-partners');
      expect(partners.length, `[${width}] the page read the HR partners`).toBeGreaterThan(0);
      const items = (JSON.parse(partners[0]!.body) as { items?: { id: string; name: string; staffId: string; email: string }[] }).items ?? [];
      expect(items.map(({ name, staffId, email }) => ({ name, staffId, email })), `[${width}] the HR partner list is Pieter van Wyk, HR-001, only`).toEqual([CARD.partner]);
      const posted = calls(run, width).filter((c) => apiCall(c) === 'employees POST /v1/employees');
      expect(posted, `[${width}] one registration was sent`).toHaveLength(1);
      expect(JSON.parse(posted[0]!.body || '{}'), `[${width}] the registration holds exactly the card's values and no ID number`).toEqual(expectedBody(items[0]?.id ?? ''));

      // What came back: the card's answers.
      const got = answers(run, width);
      const one = (name: string) => got.filter((a) => apiCall(a) === name).map((a) => ({ status: a.status, body: JSON.parse(a.body || '{}') as Record<string, any> }));
      const created = one('employees POST /v1/employees');
      expect(created.map((a) => [a.status, a.body['employee']?.['employee_id'], a.body['email']?.['sent']]), `[${width}] the registration answered 201, ${ID}, email sent`).toEqual([[201, ID, true]]);
      const detail = one(`documents GET /v1/employees/${ID}/verifications`);
      expect(detail.length, `[${width}] Thandi's page was read`).toBeGreaterThan(0);
      const e = detail[0]!.body['employee'] ?? {};
      expect(
        [e.employee_id, e.first_name, e.last_name, e.email, e.phone, e.department, e.job_title, e.step, e.planned_start_date, e.hr_staff_name],
        `[${width}] Thandi's page is as on the card`,
      ).toEqual([ID, CARD.employee.first, CARD.employee.last, CARD.employee.email, CARD.phone, CARD.department, CARD.jobTitle, 'INVITED', CARD.start, CARD.partner.name]);
      expect(detail[0]!.body['documents'] ?? [], `[${width}] no document uploaded yet`).toEqual([]);
      // The times are compared as moments, not as text: "2026-03-02T09:00+02:00" and "2026-03-02T07:00:00Z" are the same answer.
      const moment = (b: Record<string, any>) => ({ ...b, sentAt: Date.parse(String(b['sentAt'])), expiresAt: Date.parse(String(b['expiresAt'])) });
      expect(one(`employees GET /v1/employees/${ID}/invite`).map((a) => moment(a.body)), `[${width}] the invite link as on the card`).toContainEqual(moment(CARD.invite.sent));
      expect(one(`employees POST /v1/employees/${ID}/invite`).map((a) => moment(a.body)), `[${width}] the resent link as on the card`).toEqual([moment(CARD.invite.resent)]);
    }
  });

  test('AC-6 One silent video per width, from HR home to the Invite link card at 09:05, under 60 seconds', async ({ page, browser }) => {
    expect(missingTools('ffmpeg', 'ffprobe'), 'ffmpeg and ffprobe are installed (the help run trims videos with them)').toEqual([]);
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    for (const width of WIDTHS) {
      const folder = join(run.dir, width, FOLDER);
      const videos = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.webm')) : [];
      expect(videos, `help/media/${width}/${FOLDER}/ holds exactly one video`).toEqual([`${VIDEO}.webm`]);
      const file = video(run, width);
      const info = videoInfo(file);
      expect(info.streams, `[${width}] the video has a picture and no sound`).toEqual(['video']);
      expect(info.seconds, `[${width}] the video runs under 60 seconds`).toBeLessThan(60);

      const ref = await reference(browser, run, width);
      // Lossy video: compare only what the reference shows, with a wide margin.
      const first = await pictureDiff(page, videoFrame(file, 'first'), ref.home, { threshold: 48, content: true });
      expect(first, `[${width}] the first frame is HR home, not the sign-in page, a blank or a loading screen`).toBeLessThanOrEqual(0.25);
      const last = await pictureDiff(page, videoFrame(file, 'last'), ref.pictures[6]!, { threshold: 48, content: true });
      expect(last, `[${width}] the last frame is the Invite link card with the 09:05 times`).toBeLessThanOrEqual(0.25);
      // The two rows decide 09:05 against 09:00: each sits closer to picture 07 (09:05) than to picture 06 (09:00).
      const frame = videoFrame(file, 'last');
      for (const row of ['Link sent', 'Link expires']) {
        const region = ref.regions[6]![row]!;
        const opts = { region, cssWidth: ref.cssWidth, threshold: 48 };
        const to0905 = await pictureDiff(page, frame, ref.pictures[6]!, opts);
        const to0900 = await pictureDiff(page, frame, ref.pictures[5]!, opts);
        expect(to0905, `[${width}] the last frame's ${row} row shows the 09:05 time (diff to 09:05 ${to0905.toFixed(4)}, to 09:00 ${to0900.toFixed(4)})`).toBeLessThan(to0900);
      }
    }
  });

  test('AC-7 Captions use the real names, in order, right before each action; a rename fails the journey', async () => {
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    for (const width of WIDTHS) {
      const want = expectedCaptions(width);
      const seen = eventsFor(run, width).filter((e) => ['caption', 'click', 'input', 'scroll'].includes(e.type));
      const story = seen.map((e) => `${e.type}:${e.name}`).join(' → ');
      const captions = seen.filter((e) => e.type === 'caption').map((e) => e.name);
      expect(captions, `[${width}] the video's captions, in order. Seen: ${story}`).toEqual(want);

      // Each caption comes right before its own action.
      const at = seen.map((e, i) => (e.type === 'caption' ? i : -1)).filter((i) => i >= 0);
      for (const [n, i] of at.entries()) {
        const caption = seen[i]!.name;
        const until = at[n + 1] ?? seen.length;
        const between = seen.slice(i + 1, until);
        const acts = between.filter((e) => e.type !== 'scroll');
        const first = acts[0] && `${acts[0].type}:${acts[0].name}`;
        if (caption.startsWith('Scroll to ')) {
          expect(acts, `[${width}] nothing is clicked or typed after "${caption}". Seen: ${story}`).toEqual([]);
          const before = seen.slice(0, i).filter((e) => e.type === 'scroll').at(-1)?.name ?? '0,0,0,0';
          expect(between.filter((e) => e.type === 'scroll').at(-1)?.name ?? before, `[${width}] "${caption}" moves the page. Seen: ${story}`).not.toBe(before);
        } else if (caption.startsWith('Enter ')) {
          expect(first, `[${width}] "${caption}" comes right before typing in that field. Seen: ${story}`).toBe(`input:${caption.slice(6)}`);
        } else if (caption.startsWith('Choose ')) {
          expect(first, `[${width}] "${caption}" comes right before choosing in that field. Seen: ${story}`).toBe(`input:${caption.slice(7)}`);
        } else {
          const name = caption.replace(/^(Click|Tap) /, '');
          expect(first, `[${width}] "${caption}" comes right before the click on it. Seen: ${story}`).toBe(`click:${name}`);
        }
      }
      // Nothing is typed or clicked without its caption: every click and every field typed in is captioned.
      const clicks = seen.slice(at[0] ?? 0).filter((e) => e.type === 'click').map((e) => e.name);
      expect(clicks, `[${width}] only the captioned controls are pressed. Seen: ${story}`).toEqual(
        want.filter((c) => /^(Click|Tap) /.test(c)).map((c) => c.replace(/^(Click|Tap) /, '')),
      );
    }

    // Renamed controls: the journey fails on both widths instead of keeping an old caption.
    const normal = (await normalRun()).run;
    expectPassed(normal, 'normal run with nothing renamed');
    for (const [i, [label]] of RENAMES.entries()) {
      const r = await renameRuns[i]!();
      expect(failedOnBoth(r), `${label}: the journey fails on desktop and phone\n${r.results.map((x) => `[${x.project}] ${x.status}`).join(', ')}`).toBe(true);
    }
  });

  test('AC-8 Phone headings visible: in every picture the page or Invite link heading is in the top third, below the top bar', async ({ browser }) => {
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    const ref = await reference(browser, run, 'phone');
    const third = projectUse('phone').viewport.height / 3;
    expect(ref.placements, '[phone] a heading was placed for each of the seven pictures').toHaveLength(PICTURES.length);
    for (const [i, p] of ref.placements.entries()) {
      const name = PICTURES[i];
      expect(p.uncovered, `[phone] ${name}: "${p.heading}" is in the picture with nothing over it`).toBe(true);
      expect(p.top, `[phone] ${name}: "${p.heading}" is below the top bar (bar ends at ${Math.round(p.barBottom)} px)`).toBeGreaterThanOrEqual(p.barBottom);
      expect(p.top, `[phone] ${name}: "${p.heading}" is in the top third (${Math.round(third)} px)`).toBeLessThanOrEqual(third);
    }
  });

  test('AC-9 Same pictures every time: two help runs, and the retake script finds no change', async () => {
    expect(missingTools('compare', 'python3'), 'ImageMagick compare and python3 are installed (the retake script needs them)').toEqual([]);
    const one = await firstHelpRun();
    expectPassed(one, 'first help run');
    const two = await secondHelpRun();
    expectPassed(two, 'second help run');

    const repo = retakeRepo('h4-retake-same');
    placeRun(one, FOLDER, repo.media);
    repo.commit('first help run');
    placeRun(two, FOLDER, repo.media);
    const out = repo.script('filter');
    expect(out.trim(), 'help-retake.py filter reports no change, so no retake PR opens').toBe('changed=false');
  });

  test('AC-10 Pictures arrive by the retake PR: this PR adds none, and the retake lists fourteen new pictures and two videos', async () => {
    const changed = prChanges('pepla-web/help/media');
    if (changed !== null && process.env['GITHUB_HEAD_REF'] !== 'help/retake' && process.env['GITHUB_BASE_REF'] !== 'main') {
      expect(changed, 'the pull request changes no file under pepla-web/help/media').toEqual([]);
    }

    expect(missingTools('python3'), 'python3 is installed').toEqual([]);
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    const repo = retakeRepo('h4-retake-new');
    const base = repo.commit('develop before the retake');
    placeRun(run, FOLDER, repo.media);
    expect(repo.script('filter').trim(), 'the retake finds a change').toBe('changed=true');
    const head = repo.commit('retake');
    const body = join(repo.root, 'body.md');
    repo.script('body', '--repo', 'obsydian-tech/hr-portal', '--base', base, '--head', head, '--out', body);
    const text = readFileSync(body, 'utf8');

    const pictures = [...text.matchAll(/^\| `([^`]+)` \| \(new\) \|/gm)].map((m) => m[1]).sort();
    const expectedPictures = WIDTHS.flatMap((w) => PICTURES.map((p) => `${w}/${FOLDER}/${p}.png`)).sort();
    expect(pictures, 'the retake PR lists the fourteen pictures as new').toEqual(expectedPictures);
    const rows = [...text.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]!);
    expect(rows.sort(), 'and no other picture').toEqual(expectedPictures);
    expect(rows.filter((r) => OTHER_FOLDERS.some((f) => r.includes(`/${f}/`))), 'nothing under sign-in/, who-is-starting/ or checks-a-document/').toEqual([]);
    const videos = [...text.matchAll(/^- (?:\[([^\]]+)\]\([^)]*\)|`([^`]+)`) \((\w+)\)$/gm)].map((m) => `${m[1] ?? m[2]} (${m[3]})`).sort();
    expect(videos, 'the retake PR lists the two videos as new, and no other video').toEqual(WIDTHS.map((w) => `${w}/${FOLDER}/${VIDEO}.webm (new)`).sort());
  });

  test('AC-11 Nothing locked moves: the three help journeys unchanged, the Cognito fake and settleFonts imported, locked fixture rules kept', async () => {
    const hash = (f: string) => createHash('sha256').update(existsSync(f) ? readFileSync(f) : Buffer.from('')).digest('hex');
    for (const [file, sha] of Object.entries(LOCKED_JOURNEYS)) expect(hash(join(WEB, 'e2e', 'journeys', file)), `${file} is unchanged`).toBe(sha);

    const src = source();
    expect(src, `${FILE} exists`).not.toBe('');
    expect(src, 'imports the fake from e2e/acceptance/support/cognito-fake.ts').toMatch(/from\s+['"]\.\.\/acceptance\/support\/cognito-fake(\.js|\.ts)?['"]/);
    expect(src, 'takes its pictures with e2e/support/help.ts').toMatch(/from\s+['"]\.\.\/support\/help(\.js|\.ts)?['"]/);
    const helpTs = readFileSync(HELP_TS, 'utf8');
    expect(helpTs, 'help pictures still wait for the fonts with the locked settleFonts').toMatch(/import\s*\{[^}]*\bsettleFonts\b[^}]*\}\s*from\s+['"]\.\.\/acceptance\/support\/fonts(\.js|\.ts)?['"]/);
    expect(codeOnly(helpTs), 'help.shot calls settleFonts').toMatch(/await\s+settleFonts\(\s*this\.page\s*\)/);
    const outside = readdirSync(join(WEB, 'e2e'), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.startsWith('acceptance') && !f.includes('node_modules'));
    const copies = outside.filter((f) => /class\s+CognitoFake\b|function\s+settleFonts\b|settleFonts\s*=/.test(readFileSync(join(WEB, 'e2e', f), 'utf8')));
    expect(copies, 'no copy of the Cognito fake or of settleFonts outside e2e/acceptance/').toEqual([]);

    // HELP-02 and HELP-03 AC-5 (locked): the fixture's exported strings hold no phone number and no
    // run of 7 or more digits but the one made-up ID number, so the new phone stays out of them.
    const strings = fixtureStrings();
    expect(strings.filter((s) => PHONE.test(s)), 'help-company.ts exports no phone number as a string (HELP-02, HELP-03 AC-5)').toEqual([]);
    const ids = fixtureIdNumbers();
    expect(ids, 'help-company.ts still holds exactly one 13-digit ID number (HELP-02 AC-5)').toHaveLength(1);
    const digits = strings.flatMap((s) => s.replace(/\s/g, '').match(/\d{7,}/g) ?? []).filter((d) => d !== ids[0]);
    expect(digits, 'help-company.ts exports no other run of 7 or more digits (HELP-03 AC-5)').toEqual([]);

    // The locked HELP-01, HELP-02, HELP-03, ONB-03 and ONB-18 tests run in this same
    // acceptance run and must stay green; the "Acceptance tests locked" check,
    // green on the PR, is what proves no file in this folder changed
    // (journey-harness.ts included).
    for (const f of ['help-01.spec.ts', 'help-02.spec.ts', 'help-03.spec.ts', 'onb-03.spec.ts', 'onb-18.spec.ts']) expect(existsSync(join(__dirname, f)), `${f} is still here`).toBe(true);
    const lock = readFileSync(join(WEB, '..', '.github', 'workflows', 'acceptance-lock.yml'), 'utf8');
    expect(lock).toMatch(/name: Acceptance tests locked/);
    expect(lock).toMatch(/pepla-web\/e2e\/acceptance\//);
  });
});
