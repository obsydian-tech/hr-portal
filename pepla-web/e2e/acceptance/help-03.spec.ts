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
import {
  CARD,
  LOCKED_JOHAN_DETAIL,
  LOCKED_STEPS,
  PICTURES,
  REASON,
  checksADocumentReference,
  docName,
  watcher,
  type Call,
  type ChecksADocumentReference,
  type Scroll,
} from './support/help-03';

/**
 * HELP-03 · Help pictures: HR checks a document (Jira NH-167, epic NH-150).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/HELP-03.md (15 Nov 2026).
 *
 * The card's work is a journey, e2e/journeys/hr-checks-a-document.e2e.ts:
 * Pieter van Wyk (HR at the fake company Sunbird Bakery) opens Documents to
 * check, accepts Johan Botha's National ID, goes back by the breadcrumb and
 * asks Johan for a new bank letter with a reason. These tests run that
 * journey the way CI does (normal run: `npm run e2e`; help run:
 * `npm run e2e:help`) through support/journey-harness.ts, and check what it
 * does and what it writes. The help run goes through the recorder with
 * support/help-03.ts `watcher`, which also sees each picture's scroll
 * position, every request the page makes and every document API answer.
 * They run once, in the desktop-1280 project, and check the journey's desktop
 * and phone runs themselves. No-backend run only.
 *
 * Needs ffmpeg, ffprobe, ImageMagick (`compare`) and python3, like HELP-01.
 *
 * These files are locked once accepted: see ./README.md and cards/help-03.md.
 */

const FILE = 'hr-checks-a-document.e2e.ts';
const JOURNEY = join(WEB, 'e2e', 'journeys', FILE);
const SIGN_IN_JOURNEY = join(WEB, 'e2e', 'journeys', 'sign-in.e2e.ts');
const WHO_IS_STARTING_JOURNEY = join(WEB, 'e2e', 'journeys', 'who-is-starting.e2e.ts');
/** sign-in.e2e.ts as HELP-02.3 re-locked it. */
const SIGN_IN_SHA256 = '5c8e0cb4b4e4cfab5737c7b1c578e1f728cb266db5fa3f69d4e8feba0cd48e21';
/** who-is-starting.e2e.ts as HELP-02 (#314) and HELP-02.3 (#322) left it, develop 7f719d9. */
const WHO_IS_STARTING_SHA256 = '33b516bb8656043498a687991c82ac267ed0ad277e3510171049dc808e09c2b6';
const FOLDER = 'checks-a-document';
const VIDEO = 'hr-checks-a-document';

// ---------------------------------------------------------------- the fixture's made-up ID number, the APIs

/** The one 13-digit ID number in help-company.ts (empty when there is not exactly one). */
const idNumber = (): string => {
  const ids = fixtureIdNumbers();
  return ids.length === 1 ? ids[0]! : '';
};

/** An API address of the no-backend build (src/environments/environment.ts). */
const apiUrl = (key: 'documentUploadApiUrl' | 'employeesApiUrl'): string => {
  const env = readFileSync(join(WEB, 'src', 'environments', 'environment.ts'), 'utf8');
  return new RegExp(`${key}:\\s*'([^']+)'`).exec(env)?.[1] ?? `https://${key}.invalid`;
};
const DOC_API = apiUrl('documentUploadApiUrl');
const EMPLOYEES_API = apiUrl('employeesApiUrl');

// ---------------------------------------------------------------- each run happens once, shared by the tests

const once = <T>(make: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => (p ??= make());
};

const normalRun = once(async () => {
  const front = await startFront({ kind: 'plain' });
  const before = mediaSnapshot();
  try {
    const run = await runJourney(FILE, { help: false, base: front.url, tag: 'h3-normal' });
    return { run, wrote: diffSnapshots(before, mediaSnapshot()) };
  } finally {
    await front.close();
  }
});
const firstHelpRun = once(() => helpRun(FILE, FOLDER, 'h3-help-1', watcher(idNumber(), DOC_API)));
const secondHelpRun = once(async () => {
  await firstHelpRun();
  return helpRun(FILE, FOLDER, 'h3-help-2', watcher(idNumber(), DOC_API));
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

/** Requests the journey must not let through (AC-4): another host, the file link, a Batsi summary, another document. */
const ESCAPES = [
  ['another host', ESCAPE_URL],
  ['the file link (Open document)', `${DOC_API}/v1/documents/${CARD.id.id}/url`],
  ['a Batsi summary of the document', `${DOC_API}/v1/verifications/${CARD.id.id}/summary`],
  ['another document', `${DOC_API}/v1/verifications/sunbird-thandi-id`],
] as const;
const escapeRuns = ESCAPES.map(([, url], i) => probeRun(`h3-escape-${i}`, { kind: 'escape', url }));

/** Renamed controls (AC-7): the journey must fail instead of keeping an old caption. */
const RENAMES = [
  ['"Accept document" renamed', { kind: 'rename', words: { 'Accept document': 'Approve' }, selector: 'button' }],
  ['"Ask for a new one" renamed', { kind: 'rename', words: { 'Ask for a new one': 'Request another' }, selector: 'button' }],
  ['the "Reason" label renamed', { kind: 'rename', words: { Reason: 'Why' }, selector: 'label, .pp-field__label' }],
  ['the "Your decision" heading renamed', { kind: 'rename', words: { 'Your decision': 'Decide' }, selector: 'h1, h2, h3' }],
] as const;
const renameRuns = RENAMES.map(([, mode], i) => probeRun(`h3-rename-${i}`, mode));

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

/** Where the window was at each picture (the watcher's "shot" events). */
function shots(run: HelpRun, width: Width): Scroll[] {
  return eventsFor(run, width)
    .filter((e) => e.type === ('shot' as PageEvent['type']))
    .map((e) => {
      const [x = 0, y = 0, mx = 0, my = 0] = e.name.split(',').map(Number);
      return { x, y, mx, my };
    });
}

/** Every request the page made, from the watcher. */
function calls(run: HelpRun, width: Width): Call[] {
  return eventsFor(run, width)
    .filter((e) => e.type === ('call' as PageEvent['type']))
    .map((e) => JSON.parse(e.name) as Call);
}
function answers(run: HelpRun, width: Width): { u: string; body: string }[] {
  return eventsFor(run, width)
    .filter((e) => e.type === ('answer' as PageEvent['type']))
    .map((e) => JSON.parse(e.name) as { u: string; body: string });
}

const references = new Map<Width, Promise<ChecksADocumentReference>>();
function reference(browser: Browser, run: HelpRun, width: Width): Promise<ChecksADocumentReference> {
  if (!references.has(width)) references.set(width, checksADocumentReference(browser, width, idNumber(), shots(run, width)));
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
    ...(width === 'phone' ? ['Tap Open menu'] : []),
    `${act} Documents to check`,
    `${act} ${docName(CARD.id)}`,
    'Scroll to Your decision',
    `${act} Accept document`,
    `${act} Documents to check`,
    `${act} ${docName(CARD.bank)}`,
    'Scroll to Your decision',
    `${act} Ask for a new one`,
    'Enter Reason',
    `${act} Ask for a new one`,
  ];
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------- tests

test.describe('HELP-03 Help pictures: HR checks a document', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(ON_DEV, 'No-backend run only: the journey answers Cognito and both APIs in the browser.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs the journey once; it checks the desktop and phone runs itself.');
    testInfo.setTimeout(20 * 60_000);
  });

  test('AC-1 The journey passes in the normal run on desktop and phone and writes nothing to help/media', async () => {
    const { run, wrote } = await normalRun();
    expectPassed(run, 'normal run (npm run e2e)');
    expect(wrote, 'the normal run writes nothing to help/media').toEqual([]);
  });

  test('AC-2 Exactly five pictures per width, at 1440x900 and 390x844', async () => {
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

  test('AC-3 Each picture shows its step: the list, the ID page, Accepted, the reason, New one asked for; no caption bar', async ({ page, browser }) => {
    expect(idNumber(), 'help-company.ts holds exactly one made-up 13-digit ID number (Johan\'s National ID)').not.toBe('');
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    for (const width of WIDTHS) expect(shots(run, width), `[${width}] the journey took a picture at each of the five steps`).toHaveLength(PICTURES.length);
    // The references are taken here and checked against the card first
    // (support/help-03.ts checksADocumentReference): 01 Waiting 2, Needs a look 1,
    // Matches 1, Doesn't match 0 and Johan's two rows; 02 the National ID page
    // heading and What Batsi found: Matches; 03 the Decision card Accepted by
    // Pieter van Wyk on 2 Mar 2026 at 09:00 with the saved notice; 04 the Reason
    // box holding the reason, Ask for a new one and Cancel; 05 New one asked
    // for, at 09:05, with the reason.
    await expectLikeReference(page, browser, run);
  });

  test('AC-4 Check is the stand-in, no AI: only the app, Cognito, the five document calls and fonts; anything else fails the journey', async () => {
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    const doc = new URL(DOC_API);
    const employees = new URL(EMPLOYEES_API);
    for (const width of WIDTHS) {
      const seen = calls(run, width);
      expect(seen.length, `[${width}] the watcher saw the page's requests`).toBeGreaterThan(0);
      const unexpected: string[] = [];
      const documentCalls: string[] = [];
      for (const c of seen) {
        const u = new URL(c.u);
        if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(u.host)) continue; // the app itself
        if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.host)) continue; // the web fonts
        if (/^cognito-idp\.[a-z0-9-]+\.amazonaws\.com$/.test(u.host)) continue; // the Cognito fake
        if (c.m === 'GET' && /\/v1\/company\/modules$/.test(u.pathname)) continue; // MOD-02: the shell asks which modules are on
        if (u.origin === employees.origin && c.m === 'GET' && u.pathname === '/v1/employees') continue; // HR home's list (HELP-01, HELP-02)
        if (u.origin === doc.origin) {
          documentCalls.push(`${c.m} ${u.pathname}${u.search}`);
          if (!c.auth) unexpected.push(`${c.m} ${c.u} without a Bearer token`);
          continue;
        }
        unexpected.push(`${c.m} ${c.u}`);
      }
      expect(unexpected, `[${width}] the page asks nothing else`).toEqual([]);
      const allowed = [
        /^GET \/v1\/verifications\?waiting=true$/,
        new RegExp(`^GET /v1/verifications/${CARD.id.id}(\\?employee_id=${CARD.employee.id})?$`),
        new RegExp(`^GET /v1/verifications/${CARD.bank.id}(\\?employee_id=${CARD.employee.id})?$`),
        new RegExp(`^PATCH /v1/verifications/${CARD.id.id}/review$`),
        new RegExp(`^PATCH /v1/verifications/${CARD.bank.id}/review$`),
      ];
      expect(documentCalls.filter((c) => !allowed.some((a) => a.test(c))), `[${width}] the document API is asked only for the list, the two documents and the two decisions`).toEqual([]);
      for (const a of allowed) expect(documentCalls.some((c) => a.test(c)), `[${width}] the page made the call ${a.source}`).toBe(true);
      expect(documentCalls.filter((c) => c.startsWith('PATCH')), `[${width}] exactly two decisions are sent`).toHaveLength(2);
    }

    // What Batsi found comes from the fixture: the answers the page got hold the card's check, comparisons and confidence.
    for (const width of WIDTHS) {
      const got = answers(run, width).filter((a) => /\/v1\/verifications\/[^/?]+(\?|$)/.test(new URL(a.u).pathname + '?'));
      for (const d of [CARD.id, CARD.bank]) {
        const mine = got.filter((a) => new URL(a.u).pathname === `/v1/verifications/${d.id}`);
        expect(mine.length, `[${width}] the page read ${d.typeName}`).toBeGreaterThan(0);
        const body = JSON.parse(mine[0]!.body) as { check?: string; comparisons?: { field: string; result: string }[]; verification?: { confidence?: number } };
        expect(body.check, `[${width}] ${d.typeName}: the check is the card's`).toBe(d.check);
        expect(body.comparisons, `[${width}] ${d.typeName}: the comparisons are the card's`).toEqual(d.comparisons.map(({ field, result }) => ({ field, result })));
        expect(Number(body.verification?.confidence), `[${width}] ${d.typeName}: how sure Batsi is comes from the fixture`).toBe(d.confidence);
      }
    }

    // A request to any other host or route fails the journey on both widths.
    const plain = (await normalRun()).run;
    expectPassed(plain, 'normal run');
    for (const [i, [what, url]] of ESCAPES.entries()) {
      const r = await escapeRuns[i]!();
      expect(failedOnBoth(r), `when the page asks ${what} (${url}), the journey fails on desktop and phone\n${r.results.map((x) => `[${x.project}] ${x.status}`).join(', ')}`).toBe(true);
    }
  });

  test('AC-5 Only Sunbird Bakery, nothing revealed: data from help-company.ts, Show never pressed, no full ID, no account number', async ({ page, browser }) => {
    expect(company.HELP_NEW_EMPLOYEES, 'HELP_NEW_EMPLOYEES is exactly as HELP-01.2 locked it').toEqual(LOCKED_NEW_EMPLOYEES);
    expect(company.HELP_NEW_EMPLOYEE_STEPS, 'HELP_NEW_EMPLOYEE_STEPS is exactly as ONB-09 left it').toEqual(LOCKED_STEPS);
    expect(company.HELP_JOHAN_DETAIL, 'HELP_JOHAN_DETAIL is exactly as HELP-02 left it').toEqual(LOCKED_JOHAN_DETAIL);

    const strings = fixtureStrings();
    expect(strings, 'help-company.ts holds the reason (sample data, Decision 3)').toContain(REASON);
    expect(strings.filter((s) => PHONE.test(s)), 'help-company.ts holds no phone number').toEqual([]);
    const id = idNumber();
    const digits = strings.flatMap((s) => s.replace(/\s/g, '').match(/\d{7,}/g) ?? []).filter((d) => d !== id);
    expect(digits, 'help-company.ts holds no account number (no run of 7 or more digits but the one ID number)').toEqual([]);

    const src = source();
    expect(src, `${FILE} exists`).not.toBe('');
    expect(src, 'people and data come from e2e/fixtures/help-company.ts').toMatch(/from\s+['"]\.\.\/fixtures\/help-company(\.js|\.ts)?['"]/);
    const code = codeOnly(src);
    expect(code.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [], 'no email address is written in the journey').toEqual([]);
    const names = peopleNames().filter((n) => new RegExp(`\\b${n}\\b`).test(code));
    expect(names, 'no person\'s name is written in the journey; names come from help-company.ts').toEqual([]);
    expect(code.match(/\d{4}-\d{2}-\d{2}|\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}/g) ?? [], 'no date is written in the journey').toEqual([]);
    expect(code.match(/[\w-]+\.pdf\b/g) ?? [], 'no document file name is written in the journey').toEqual([]);
    expect(code.match(/\d{6,}/g) ?? [], 'no ID, account or phone digits are written in the journey').toEqual([]);
    const reasonWords = words(REASON);
    const codeWords = words(code).join(' ');
    const typed = reasonWords.slice(0, -2).map((_, i) => reasonWords.slice(i, i + 3).join(' ')).filter((w) => codeWords.includes(w));
    expect(typed, 'the reason is not written in the journey; it comes from help-company.ts').toEqual([]);
    expect(codeOnly(src), 'the journey never names a Show or Hide control').not.toMatch(/['"`](Show|Hide)\b/);

    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    const emails = new Set<string>(company.HELP_PEOPLE.map((p) => p.email));
    for (const width of WIDTHS) {
      const events = eventsFor(run, width);
      const text = events.filter((e) => e.type === 'text');
      expect(text.filter((e) => e.name.startsWith('email:') && !emails.has(e.name.slice(6))), `[${width}] every email on the page is a Sunbird Bakery person's`).toEqual([]);
      expect(text.filter((e) => e.name.startsWith('phone:')), `[${width}] no phone number on the page`).toEqual([]);
      expect(events.filter((e) => e.type === 'click' && /^(show|hide)\b/i.test(e.name)), `[${width}] Show is never pressed`).toEqual([]);
      expect(events.filter((e) => e.type === 'reveal'), `[${width}] no hidden value is ever shown`).toEqual([]);
      expect(text.filter((e) => e.name === 'id'), `[${width}] the full ID number is never in the page text`).toEqual([]);
      expect(events.filter((e) => e.type === 'scroll').length, `[${width}] the watcher watched the page`).toBeGreaterThan(0);

      // No account number, bank name or branch code in anything the document API answered.
      const got = answers(run, width);
      expect(got.length, `[${width}] the watcher saw the document API's answers`).toBeGreaterThan(0);
      const leaks: string[] = [];
      const walk = (v: unknown, path: string) => {
        if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${path}.${k}`);
        else if (/\.(account_number|bank_name|branch_code)$/.test(path) && v !== null && v !== undefined && String(v).trim() !== '' && String(v).trim().toUpperCase() !== 'NOT_FOUND') leaks.push(`${path}=${String(v)}`);
        else if (typeof v === 'string' && /\d{7,}/.test(v.replace(/\s/g, '')) && !v.replace(/\s/g, '').includes(id)) leaks.push(`${path}=${v}`);
      };
      for (const a of got) {
        try {
          walk(JSON.parse(a.body), new URL(a.u).pathname);
        } catch {
          /* not JSON: nothing read */
        }
      }
      expect(leaks, `[${width}] no account number, bank name or branch code reached the page`).toEqual([]);
    }
    // Nothing on any picture differs from the help company's own pages (the references, AC-3).
    for (const width of WIDTHS) {
      const ref = await reference(browser, run, width);
      for (const [i, name] of PICTURES.entries()) {
        const all = await pictureDiff(page, readFileSync(picture(run, width, name)), ref.pictures[i]!, { content: true });
        expect(all, `[${width}] ${name}: shows only what the help company's page shows`).toBeLessThanOrEqual(0.03);
      }
    }
  });

  test('AC-6 One silent video per width, from HR home to New one asked for, under 45 seconds', async ({ page, browser }) => {
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
      expect(info.seconds, `[${width}] the video runs under 45 seconds`).toBeLessThan(45);

      const ref = await reference(browser, run, width);
      // Lossy video: compare only what the reference shows, with a wide margin.
      const first = await pictureDiff(page, videoFrame(file, 'first'), ref.home, { threshold: 48, content: true });
      expect(first, `[${width}] the first frame is HR home, not the sign-in page, a blank or a loading screen`).toBeLessThanOrEqual(0.25);
      const last = await pictureDiff(page, videoFrame(file, 'last'), ref.pictures[4], { threshold: 48, content: true });
      expect(last, `[${width}] the last frame is the Decision card New one asked for`).toBeLessThanOrEqual(0.25);
    }
  });

  test('AC-7 Captions use the real names, in order, right before each action; the reason is sent, never empty; a rename fails the journey', async () => {
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
        if (caption.startsWith('Scroll to ')) {
          expect(acts, `[${width}] nothing is clicked or typed after "${caption}". Seen: ${story}`).toEqual([]);
          const before = seen.slice(0, i).filter((e) => e.type === 'scroll').at(-1)?.name ?? '0,0,0,0';
          expect(between.filter((e) => e.type === 'scroll').at(-1)?.name ?? before, `[${width}] "${caption}" moves the page. Seen: ${story}`).not.toBe(before);
        } else if (caption.startsWith('Enter ')) {
          expect(acts[0] && `${acts[0].type}:${acts[0].name}`, `[${width}] "${caption}" comes right before typing in that field. Seen: ${story}`).toBe(`input:${caption.slice(6)}`);
        } else {
          const name = caption.replace(/^(Click|Tap) /, '');
          expect(acts[0] && `${acts[0].type}:${acts[0].name}`, `[${width}] "${caption}" comes right before the click on it. Seen: ${story}`).toBe(`click:${name}`);
        }
      }

      // The decisions sent: Accept on the ID, then Ask for a new one on the bank letter, with the reason. Never an empty reason.
      const decisions = calls(run, width)
        .filter((c) => c.m === 'PATCH')
        .map((c) => ({ path: new URL(c.u).pathname, body: JSON.parse(c.body || '{}') as { decision?: string; notes?: string; employee_id?: string } }));
      expect(decisions.filter((d) => d.body.decision === 'FAILED' && !String(d.body.notes ?? '').trim()), `[${width}] an empty reason is never sent`).toEqual([]);
      expect(decisions.map((d) => [d.path, d.body.decision, d.body.decision === 'FAILED' ? d.body.notes : '', d.body.employee_id]), `[${width}] the two decisions sent`).toEqual([
        [`/v1/verifications/${CARD.id.id}/review`, 'PASSED', '', CARD.employee.id],
        [`/v1/verifications/${CARD.bank.id}/review`, 'FAILED', REASON, CARD.employee.id],
      ]);
    }

    // Renamed controls: the journey fails on both widths instead of keeping an old caption.
    const normal = (await normalRun()).run;
    expectPassed(normal, 'normal run with nothing renamed');
    for (const [i, [label]] of RENAMES.entries()) {
      const r = await renameRuns[i]!();
      expect(failedOnBoth(r), `${label}: the journey fails on desktop and phone\n${r.results.map((x) => `[${x.project}] ${x.status}`).join(', ')}`).toBe(true);
    }
  });

  test('AC-8 Phone headings visible: in pictures 02 to 05 the heading is in the top third, below the top bar', async ({ browser }) => {
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    const ref = await reference(browser, run, 'phone');
    const third = projectUse('phone').viewport.height / 3;
    for (const [i, p] of ref.placements.entries()) {
      const name = PICTURES[i + 1];
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

    const repo = retakeRepo('h3-retake-same');
    placeRun(one, FOLDER, repo.media);
    repo.commit('first help run');
    placeRun(two, FOLDER, repo.media);
    const out = repo.script('filter');
    expect(out.trim(), 'help-retake.py filter reports no change, so no retake PR opens').toBe('changed=false');
  });

  test('AC-10 Pictures arrive by the retake PR: this PR adds none, and the retake lists ten new pictures and two videos', async () => {
    const changed = prChanges('pepla-web/help/media');
    if (changed !== null && process.env['GITHUB_HEAD_REF'] !== 'help/retake' && process.env['GITHUB_BASE_REF'] !== 'main') {
      expect(changed, 'the pull request changes no file under pepla-web/help/media').toEqual([]);
    }

    expect(missingTools('python3'), 'python3 is installed').toEqual([]);
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    const repo = retakeRepo('h3-retake-new');
    const base = repo.commit('develop before the retake');
    placeRun(run, FOLDER, repo.media);
    expect(repo.script('filter').trim(), 'the retake finds a change').toBe('changed=true');
    const head = repo.commit('retake');
    const body = join(repo.root, 'body.md');
    repo.script('body', '--repo', 'obsydian-tech/hr-portal', '--base', base, '--head', head, '--out', body);
    const text = readFileSync(body, 'utf8');

    const pictures = [...text.matchAll(/^\| `([^`]+)` \| \(new\) \|/gm)].map((m) => m[1]).sort();
    const expectedPictures = WIDTHS.flatMap((w) => PICTURES.map((p) => `${w}/${FOLDER}/${p}.png`)).sort();
    expect(pictures, 'the retake PR lists the ten pictures as new').toEqual(expectedPictures);
    const rows = [...text.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
    expect(rows.sort(), 'and no other picture (nothing under sign-in/ or who-is-starting/)').toEqual(expectedPictures);
    const videos = [...text.matchAll(/^- (?:\[([^\]]+)\]\([^)]*\)|`([^`]+)`) \((\w+)\)$/gm)].map((m) => `${m[1] ?? m[2]} (${m[3]})`).sort();
    expect(videos, 'the retake PR lists the two videos as new, and no other video').toEqual(WIDTHS.map((w) => `${w}/${FOLDER}/${VIDEO}.webm (new)`).sort());
  });

  test('AC-11 Nothing locked moves: the two help journeys unchanged, the Cognito fake and settleFonts imported, not copied', async () => {
    const hash = (f: string) => createHash('sha256').update(existsSync(f) ? readFileSync(f) : Buffer.from('')).digest('hex');
    expect(hash(SIGN_IN_JOURNEY), 'sign-in.e2e.ts is exactly as HELP-02.3 locked it').toBe(SIGN_IN_SHA256);
    expect(hash(WHO_IS_STARTING_JOURNEY), 'who-is-starting.e2e.ts is exactly as HELP-02 left it').toBe(WHO_IS_STARTING_SHA256);

    const src = source();
    expect(src, `${FILE} exists`).not.toBe('');
    expect(src, 'imports the fake from e2e/acceptance/support/cognito-fake.ts').toMatch(/from\s+['"]\.\.\/acceptance\/support\/cognito-fake(\.js|\.ts)?['"]/);
    expect(src, 'takes its pictures with e2e/support/help.ts').toMatch(/from\s+['"]\.\.\/support\/help(\.js|\.ts)?['"]/);
    const helpTs = readFileSync(join(WEB, 'e2e', 'support', 'help.ts'), 'utf8');
    expect(helpTs, 'help pictures still wait for the fonts with the locked settleFonts').toMatch(/import\s*\{[^}]*\bsettleFonts\b[^}]*\}\s*from\s+['"]\.\.\/acceptance\/support\/fonts(\.js|\.ts)?['"]/);
    expect(codeOnly(helpTs), 'help.shot calls settleFonts').toMatch(/await\s+settleFonts\(\s*this\.page\s*\)/);
    const outside = readdirSync(join(WEB, 'e2e'), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.startsWith('acceptance') && !f.includes('node_modules'));
    const copies = outside.filter((f) => /class\s+CognitoFake\b|function\s+settleFonts\b|settleFonts\s*=/.test(readFileSync(join(WEB, 'e2e', f), 'utf8')));
    expect(copies, 'no copy of the Cognito fake or of settleFonts outside e2e/acceptance/').toEqual([]);

    // The locked HELP-01, HELP-02, ONB-13 and ONB-15 tests run in this same
    // acceptance run and must stay green; the "Acceptance tests locked" check,
    // green on the PR, is what proves no file in this folder changed
    // (journey-harness.ts included).
    for (const f of ['help-01.spec.ts', 'help-02.spec.ts', 'onb-13.spec.ts', 'onb-15.spec.ts']) expect(existsSync(join(__dirname, f)), `${f} is still here`).toBe(true);
    const lock = readFileSync(join(WEB, '..', '.github', 'workflows', 'acceptance-lock.yml'), 'utf8');
    expect(lock).toMatch(/name: Acceptance tests locked/);
    expect(lock).toMatch(/pepla-web\/e2e\/acceptance\//);
  });
});
