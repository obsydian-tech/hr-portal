import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser } from '@playwright/test';
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
import {
  JOHAN,
  LOCKED_NEW_EMPLOYEES,
  PHONE,
  codeOnly,
  fixtureIdNumbers,
  fixtureStrings,
  idCheckDigitHolds,
  peopleNames,
  watcher,
  whoIsStartingReference,
  type WhoIsStartingReference,
} from './support/help-02';

/**
 * HELP-02 · Help pictures: HR sees who is starting (Jira NH-159, epic NH-150).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/HELP-02.md (approved 13 Nov 2026).
 *
 * The card's work is a journey, e2e/journeys/who-is-starting.e2e.ts: Pieter van
 * Wyk (HR at the fake company Sunbird Bakery) on HR home opens Johan Botha and
 * scrolls to his documents. These tests run that journey the way CI does
 * (normal run: `npm run e2e`; help run: `npm run e2e:help`) through
 * support/journey-harness.ts, and check what it does and what it writes. The
 * help run goes through the recorder with support/help-02.ts `watcher`, which
 * also sees the scroll position, a shown ID number, emails and phone numbers.
 * They run once, in the desktop-1280 project, and check the journey's desktop
 * and phone runs themselves. No-backend run only.
 *
 * Needs ffmpeg, ffprobe, ImageMagick (`compare`) and python3, like HELP-01.
 *
 * These files are locked once Iggie accepts them: see ./README.md.
 */

const FILE = 'who-is-starting.e2e.ts';
const JOURNEY = join(WEB, 'e2e', 'journeys', FILE);
const SIGN_IN_JOURNEY = join(WEB, 'e2e', 'journeys', 'sign-in.e2e.ts');
/** sign-in.e2e.ts as HELP-01 locked it (develop d2ee800). It must not change. */
const SIGN_IN_SHA256 = '83035aeeb9bfc145595006d382883dc72b52c1b0ba5d69b783acd229bdb6b6be';
const FOLDER = 'who-is-starting';
const PICTURES = ['01-hr-home', '02-employee-page', '03-documents'] as const;
const VIDEO = 'hr-opens-new-employee';

// ---------------------------------------------------------------- the fixture's made-up ID number

/** The one 13-digit ID number in help-company.ts (empty when there is not exactly one). */
const idNumber = (): string => {
  const ids = fixtureIdNumbers();
  return ids.length === 1 ? ids[0]! : '';
};

// ---------------------------------------------------------------- each run happens once, shared by the tests

const once = <T>(make: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => (p ??= make());
};

const normalRun = once(async () => {
  const front = await startFront({ kind: 'plain' });
  const before = mediaSnapshot();
  try {
    const run = await runJourney(FILE, { help: false, base: front.url, tag: 'h2-normal' });
    return { run, wrote: diffSnapshots(before, mediaSnapshot()) };
  } finally {
    await front.close();
  }
});
const firstHelpRun = once(() => helpRun(FILE, FOLDER, 'h2-help-1', watcher(idNumber())));
const secondHelpRun = once(async () => {
  await firstHelpRun();
  return helpRun(FILE, FOLDER, 'h2-help-2', watcher(idNumber()));
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

/** The document upload API's address in the no-backend build (src/environments/environment.ts). */
const documentApi = (): string => {
  const env = readFileSync(join(WEB, 'src', 'environments', 'environment.ts'), 'utf8');
  return /documentUploadApiUrl:\s*'([^']+)'/.exec(env)?.[1] ?? 'https://document-api.invalid';
};
const escapeRun = probeRun('h2-escape', { kind: 'escape' });
const otherPersonRun = probeRun('h2-other-person', { kind: 'escape', url: `${documentApi()}/v1/employees/sunbird-thandi-mahlangu/verifications` });
const renamedHeadingRun = probeRun('h2-rename-heading', { kind: 'rename', words: { Documents: 'Files' }, selector: 'h1, h2, h3' });
const renamedLinkRun = probeRun('h2-rename-link', { kind: 'rename', words: { [JOHAN.name]: 'J. Botha' }, selector: 'a' });

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

/** Where the window was at the end of the journey (its last scroll position), so at picture 03. */
function lastScroll(run: HelpRun, width: Width): { x: number; y: number } {
  const at = eventsFor(run, width).filter((e) => e.type === 'scroll').at(-1)?.name ?? '0,0';
  const [x, y] = at.split(',').map(Number);
  return { x: x ?? 0, y: y ?? 0 };
}

const references = new Map<Width, Promise<WhoIsStartingReference>>();
function reference(browser: Browser, run: HelpRun, width: Width): Promise<WhoIsStartingReference> {
  if (!references.has(width)) references.set(width, whoIsStartingReference(browser, width, idNumber(), lastScroll(run, width)));
  return references.get(width)!;
}

/** Each picture is its reference: the important parts, the whole picture, and no caption bar. */
async function expectLikeReference(page: import('@playwright/test').Page, browser: Browser, run: HelpRun): Promise<void> {
  for (const width of WIDTHS) {
    const ref = await reference(browser, run, width);
    const use = projectUse(width);
    const captionZone = { x: 0, y: use.viewport.height - 110, width: use.viewport.width, height: 110 };
    for (const [i, name] of PICTURES.entries()) {
      const shot = readFileSync(picture(run, width, name));
      const opts = { cssWidth: ref.cssWidth };
      for (const [part, region] of Object.entries(ref.regions[i]!)) {
        const d = await pictureDiff(page, shot, ref.pictures[i]!, { ...opts, region });
        expect(d, `[${width}] ${name}: ${part} looks as on the card`).toBeLessThanOrEqual(0.01);
      }
      const whole = await pictureDiff(page, shot, ref.pictures[i]!, { content: true });
      expect(whole, `[${width}] ${name}: the whole picture is this step`).toBeLessThanOrEqual(0.01);
      const caption = await pictureDiff(page, shot, ref.pictures[i]!, { ...opts, region: captionZone });
      expect(caption, `[${width}] ${name}: no caption bar`).toBeLessThanOrEqual(0.002);
    }
  }
}

// ---------------------------------------------------------------- tests

test.describe('HELP-02 Help pictures: HR sees who is starting', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(ON_DEV, 'No-backend run only: the journey answers Cognito and both APIs in the browser.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs the journey once; it checks the desktop and phone runs itself.');
    testInfo.setTimeout(15 * 60_000);
  });

  test('AC-1 The journey passes in the normal run on desktop and phone and writes nothing to help/media', async () => {
    const { run, wrote } = await normalRun();
    expectPassed(run, 'normal run (npm run e2e)');
    expect(wrote, 'the normal run writes nothing to help/media').toEqual([]);
  });

  test('AC-2 Exactly three pictures per width, at the journeys\' desktop and phone sizes', async () => {
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    for (const width of WIDTHS) {
      const folder = join(run.dir, width, FOLDER);
      const pngs = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith('.png')).sort() : [];
      expect(pngs, `help/media/${width}/${FOLDER}/ holds exactly these pictures`).toEqual(PICTURES.map((p) => `${p}.png`));
      const use = projectUse(width);
      for (const name of PICTURES) {
        expect(pngSize(picture(run, width, name)), `[${width}] ${name}.png size`).toEqual({
          width: use.viewport.width * use.deviceScaleFactor,
          height: use.viewport.height * use.deviceScaleFactor,
        });
      }
    }
  });

  test('AC-3 Each picture shows its step: HR home with counts, Johan Botha\'s header, his documents; no caption bar', async ({ page, browser }) => {
    expect(idNumber(), 'help-company.ts holds exactly one made-up 13-digit ID number (for Johan\'s National ID)').not.toBe('');
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    // The references are taken here and checked against the card first
    // (support/help-02.ts whoIsStartingReference): 01 HR home, the four
    // Sunbird Bakery people, 1 per step; 02 Johan's header as in the card's
    // table, no phone; 03 the Documents heading in the top third with nothing
    // over it, National ID and Bank confirmation with check and decision, the
    // ID number masked to its last four.
    await expectLikeReference(page, browser, run);
  });

  test('AC-4 Only Sunbird Bakery: people and data from help-company.ts, HELP_NEW_EMPLOYEES unchanged, no phone number', async ({ page, browser }) => {
    expect(company.HELP_NEW_EMPLOYEES, 'HELP_NEW_EMPLOYEES is exactly as HELP-01.2 locked it').toEqual(LOCKED_NEW_EMPLOYEES);

    const src = source();
    expect(src, `${FILE} exists`).not.toBe('');
    expect(src, 'people and data come from e2e/fixtures/help-company.ts').toMatch(/from\s+['"]\.\.\/fixtures\/help-company(\.js|\.ts)?['"]/);
    const code = codeOnly(src);
    expect(code.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [], 'no email address is written in the journey').toEqual([]);
    const names = peopleNames().filter((n) => new RegExp(`\\b${n}\\b`).test(code));
    expect(names, 'no person\'s name is written in the journey; names come from help-company.ts').toEqual([]);
    expect(code.match(/\d{4}-\d{2}-\d{2}|\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}/g) ?? [], 'no date is written in the journey').toEqual([]);
    expect(code.match(/[\w-]+\.pdf\b/g) ?? [], 'no document is written in the journey').toEqual([]);
    expect(code.match(/\d{6,}/g) ?? [], 'no ID or phone digits are written in the journey').toEqual([]);

    const strings = fixtureStrings();
    for (const d of JOHAN.documents) expect(strings, `help-company.ts holds Johan's ${d.type} document (${d.file})`).toContain(d.file);
    expect(strings.filter((s) => PHONE.test(s)), 'help-company.ts holds no phone number').toEqual([]);

    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    const emails = new Set<string>(company.HELP_PEOPLE.map((p) => p.email));
    for (const width of WIDTHS) {
      const seen = eventsFor(run, width).filter((e) => e.type === 'text');
      expect(seen.filter((e) => e.name.startsWith('email:') && !emails.has(e.name.slice(6))), `[${width}] every email on the page is a Sunbird Bakery person's`).toEqual([]);
      expect(seen.filter((e) => e.name.startsWith('phone:')), `[${width}] no phone number on the page`).toEqual([]);
    }
    // Nothing on any picture differs from the help company's own pages (the references, AC-3).
    for (const width of WIDTHS) {
      const ref = await reference(browser, run, width);
      for (const [i, name] of PICTURES.entries()) {
        const all = await pictureDiff(page, readFileSync(picture(run, width, name)), ref.pictures[i]!, { content: true });
        expect(all, `[${width}] ${name}: shows only what the help company's page shows`).toBeLessThanOrEqual(0.01);
      }
    }
  });

  test('AC-5 The ID number is never shown in full: Show never pressed, never in page text, made up so it can never be real', async ({ page, browser }) => {
    const id = idNumber();
    expect(fixtureIdNumbers(), 'help-company.ts holds exactly one 13-digit ID number').toHaveLength(1);
    expect(id.slice(2, 4), `the made-up ID number ${id.slice(0, 6)}... has birth month 00`).toBe('00');
    expect(idCheckDigitHolds(id), 'the made-up ID number fails the ID check digit').toBe(false);

    const src = source();
    expect(src, `${FILE} exists`).not.toBe('');
    expect(codeOnly(src), 'the journey never names a Show or Hide control').not.toMatch(/['"`](Show|Hide)\b/);

    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    for (const width of WIDTHS) {
      const events = eventsFor(run, width);
      expect(events.filter((e) => e.type === 'click' && /^(show|hide|try again)\b/i.test(e.name)), `[${width}] Show is never pressed`).toEqual([]);
      expect(events.filter((e) => e.type === 'reveal'), `[${width}] no masked value is ever shown`).toEqual([]);
      expect(events.filter((e) => e.type === 'text' && e.name === 'id'), `[${width}] the full ID number is never in the page text`).toEqual([]);
      expect(events.filter((e) => e.type === 'scroll').length, `[${width}] the recorder watched the page`).toBeGreaterThan(0);
      // The masked number on picture 03 is the reference's: dots and the last four digits.
      const ref = await reference(browser, run, width);
      const d = await pictureDiff(page, readFileSync(picture(run, width, PICTURES[2])), ref.pictures[2], { cssWidth: ref.cssWidth, region: ref.regions[2]['id'] });
      expect(d, `[${width}] ${PICTURES[2]}: the ID number shows only its last four digits`).toBeLessThanOrEqual(0.01);
    }
  });

  test('AC-6 One silent video per width, from HR home to the Documents section, under 25 seconds', async ({ page, browser }) => {
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
      expect(info.seconds, `[${width}] the video runs under 25 seconds`).toBeLessThan(25);

      const ref = await reference(browser, run, width);
      const [hrHome, , documents] = ref.pictures;
      // Lossy video: compare only what the reference shows, with a wide margin.
      const first = await pictureDiff(page, videoFrame(file, 'first'), hrHome, { threshold: 48, content: true });
      expect(first, `[${width}] the first frame is HR home, not the sign-in page, a blank or a loading screen`).toBeLessThanOrEqual(0.25);
      const last = await pictureDiff(page, videoFrame(file, 'last'), documents, { threshold: 48, content: true });
      expect(last, `[${width}] the last frame is the Documents section`).toBeLessThanOrEqual(0.25);
    }
  });

  test('AC-7 Captions use the real names: Click/Tap Johan Botha, Scroll to Documents, and a rename fails the journey', async () => {
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    for (const width of WIDTHS) {
      const open = `${width === 'phone' ? 'Tap' : 'Click'} ${JOHAN.name}`;
      const seen = eventsFor(run, width).filter((e) => e.type === 'caption' || e.type === 'click' || e.type === 'scroll');
      const story = seen.map((e) => `${e.type}:${e.name}`).join(' → ');
      const captions = seen.filter((e) => e.type === 'caption').map((e) => e.name);
      expect(captions, `[${width}] the video's captions, in order. Seen: ${story}`).toEqual([open, 'Scroll to Documents']);

      const c1 = seen.findIndex((e) => e.type === 'caption' && e.name === open);
      const next1 = seen.slice(c1 + 1).find((e) => e.type !== 'scroll');
      expect(next1 && `${next1.type}:${next1.name}`, `[${width}] "${open}" comes right before the click on that link. Seen: ${story}`).toBe(`click:${JOHAN.name}`);

      const c2 = seen.findIndex((e) => e.type === 'caption' && e.name === 'Scroll to Documents');
      const before = seen.slice(c1 + 1, c2).filter((e) => e.type === 'scroll').at(-1)?.name;
      const after = seen.slice(c2 + 1);
      expect(after.filter((e) => e.type !== 'scroll'), `[${width}] nothing is clicked after "Scroll to Documents". Seen: ${story}`).toEqual([]);
      expect(after.filter((e) => e.type === 'scroll').length, `[${width}] the page scrolls after "Scroll to Documents". Seen: ${story}`).toBeGreaterThan(0);
      expect(after.at(-1)?.name, `[${width}] the scroll moves the page. Seen: ${story}`).not.toBe(before ?? '0,0');
    }

    // Renamed heading or link: the journey fails instead of keeping an old caption.
    const normal = (await normalRun()).run;
    expectPassed(normal, 'normal run with nothing renamed');
    for (const [label, renamed] of [
      ['Documents heading renamed', renamedHeadingRun],
      [`${JOHAN.name} link renamed`, renamedLinkRun],
    ] as const) {
      const r = await renamed();
      expect(failedOnBoth(r), `${label}: the journey fails on desktop and phone\n${r.results.map((x) => `[${x.project}] ${x.status}`).join(', ')}`).toBe(true);
    }
  });

  test('AC-8 Same pictures every time: two help runs, and the retake script finds no change', async () => {
    expect(missingTools('compare', 'python3'), 'ImageMagick compare and python3 are installed (the retake script needs them)').toEqual([]);
    const one = await firstHelpRun();
    expectPassed(one, 'first help run');
    const two = await secondHelpRun();
    expectPassed(two, 'second help run');

    const repo = retakeRepo('h2-retake-same');
    placeRun(one, FOLDER, repo.media);
    repo.commit('first help run');
    placeRun(two, FOLDER, repo.media);
    const out = repo.script('filter');
    expect(out.trim(), 'help-retake.py filter reports no change, so no retake PR opens').toBe('changed=false');
  });

  test('AC-9 No backend, no AI: a request to any other host, or for another person, fails the journey', async () => {
    const plain = (await normalRun()).run;
    expectPassed(plain, 'normal run');
    for (const [what, probe] of [
      [`the page asks ${ESCAPE_URL}`, escapeRun],
      ['the page asks the document API for another person (sunbird-thandi-mahlangu)', otherPersonRun],
    ] as const) {
      const r = await probe();
      expect(failedOnBoth(r), `when ${what}, the journey fails on desktop and phone\n${r.results.map((x) => `[${x.project}] ${x.status}`).join(', ')}`).toBe(true);
    }
  });

  test('AC-10 Pictures arrive by the retake PR: this PR adds none, and the retake lists six new pictures and two videos', async () => {
    const changed = prChanges('pepla-web/help/media');
    if (changed !== null && process.env['GITHUB_HEAD_REF'] !== 'help/retake' && process.env['GITHUB_BASE_REF'] !== 'main') {
      expect(changed, 'the pull request changes no file under pepla-web/help/media').toEqual([]);
    }

    expect(missingTools('python3'), 'python3 is installed').toEqual([]);
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    const repo = retakeRepo('h2-retake-new');
    const base = repo.commit('develop before the retake');
    placeRun(run, FOLDER, repo.media);
    expect(repo.script('filter').trim(), 'the retake finds a change').toBe('changed=true');
    const head = repo.commit('retake');
    const body = join(repo.root, 'body.md');
    repo.script('body', '--repo', 'obsydian-tech/hr-portal', '--base', base, '--head', head, '--out', body);
    const text = readFileSync(body, 'utf8');

    const pictures = [...text.matchAll(/^\| `([^`]+)` \| \(new\) \|/gm)].map((m) => m[1]).sort();
    const expectedPictures = WIDTHS.flatMap((w) => PICTURES.map((p) => `${w}/${FOLDER}/${p}.png`)).sort();
    expect(pictures, 'the retake PR lists the six pictures as new').toEqual(expectedPictures);
    const rows = [...text.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
    expect(rows.sort(), 'and no other picture').toEqual(expectedPictures);
    const videos = [...text.matchAll(/^- \[([^\]]+)\]\([^)]*\) \(new\)$/gm)].map((m) => m[1]).sort();
    expect(videos, 'the retake PR lists the two videos as new').toEqual(WIDTHS.map((w) => `${w}/${FOLDER}/${VIDEO}.webm`).sort());
  });

  test('AC-11 Nothing locked moves: sign-in.e2e.ts unchanged, the locked Cognito fake imported, not copied', async () => {
    const signIn = existsSync(SIGN_IN_JOURNEY) ? readFileSync(SIGN_IN_JOURNEY) : Buffer.from('');
    expect(createHash('sha256').update(signIn).digest('hex'), 'sign-in.e2e.ts is exactly as HELP-01 locked it').toBe(SIGN_IN_SHA256);

    const src = source();
    expect(src, `${FILE} exists`).not.toBe('');
    expect(src, 'imports the fake from e2e/acceptance/support/cognito-fake.ts').toMatch(/from\s+['"]\.\.\/acceptance\/support\/cognito-fake(\.js|\.ts)?['"]/);
    const copies = readdirSync(join(WEB, 'e2e'), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.startsWith('acceptance') && !f.includes('node_modules'))
      .filter((f) => /class\s+CognitoFake\b/.test(readFileSync(join(WEB, 'e2e', f), 'utf8')));
    expect(copies, 'no copy of the fake outside e2e/acceptance/').toEqual([]);

    // The locked HELP-01, ONB-02 and ONB-12 tests run in this same acceptance
    // run and must stay green; the "Acceptance tests locked" check, green on the
    // PR, is what proves no file in this folder changed.
    for (const f of ['help-01.spec.ts', 'onb-02.spec.ts', 'onb-12.spec.ts']) expect(existsSync(join(__dirname, f)), `${f} is still here`).toBe(true);
    const lock = readFileSync(join(WEB, '..', '.github', 'workflows', 'acceptance-lock.yml'), 'utf8');
    expect(lock).toMatch(/name: Acceptance tests locked/);
    expect(lock).toMatch(/pepla-web\/e2e\/acceptance\//);
  });
});
