import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { ON_DEV } from './support/fixtures';
import {
  ESCAPE_URL,
  HELP_HR,
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
  signInReference,
  startFront,
  videoFrame,
  videoInfo,
  type HelpRun,
  type PageEvent,
  type Run,
  type SignInReference,
  type Width,
} from './support/journey-harness';

/**
 * HELP-01 · Help pictures and video: HR signs in (Jira NH-149).
 * One test per acceptance criterion, written from the card before any code.
 * Spec: https://claude.ai/artifact/2ymwurnoSSuNJZFDZi4VUN
 *
 * The card's work is a journey, e2e/journeys/sign-in.e2e.ts, and the help
 * pictures and video it takes. These tests run that journey the way CI does
 * (normal run: `npm run e2e`; help run: `npm run e2e:help`), through
 * support/journey-harness.ts, and check what it does and what it writes.
 * They run once, in the desktop-1280 project, and check the journey's desktop
 * and phone runs themselves. No-backend run only.
 *
 * Needs ffmpeg, ffprobe, ImageMagick (`compare`) and python3 on the machine,
 * like the help retake workflow.
 *
 * These files are locked once Iggie accepts them: see ./README.md.
 */

const FILE = 'sign-in.e2e.ts';
const JOURNEY = join(WEB, 'e2e', 'journeys', FILE);
const FOLDER = 'sign-in';
const PICTURES = ['01-sign-in-page', '02-filled-in', '03-hr-home'] as const;
const VIDEO = 'hr-signs-in';
const TOOLS = ['ffmpeg', 'ffprobe', 'compare', 'python3'];

// ---------------------------------------------------------------- each run happens once, shared by the tests

const once = <T>(make: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => (p ??= make());
};

const normalRun = once(async () => {
  const front = await startFront({ kind: 'plain' });
  const before = mediaSnapshot();
  try {
    const run = await runJourney(FILE, { help: false, base: front.url, tag: 'normal' });
    return { run, wrote: diffSnapshots(before, mediaSnapshot()) };
  } finally {
    await front.close();
  }
});
const firstHelpRun = once(() => helpRun(FILE, FOLDER, 'help-1'));
const secondHelpRun = once(async () => {
  await firstHelpRun();
  return helpRun(FILE, FOLDER, 'help-2');
});
const probeRun = (tag: string, mode: Parameters<typeof startFront>[0]) =>
  once(async () => {
    const front = await startFront(mode);
    try {
      return await runJourney(FILE, { help: false, base: front.url, tag });
    } finally {
      await front.close();
    }
  });
const escapeRun = probeRun('escape', { kind: 'escape' });
const renamedEmailRun = probeRun('rename-email', { kind: 'rename', words: { Email: 'Email address' } });
const renamedPasswordRun = probeRun('rename-password', { kind: 'rename', words: { Password: 'Your password' } });
const renamedButtonRun = probeRun('rename-button', { kind: 'rename', words: { 'Sign in': 'Continue' } });

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

function typedPasswordLength(run: HelpRun, width: Width): number {
  const lengths = eventsFor(run, width).filter((e) => e.type === 'length');
  return Number(lengths.at(-1)?.name ?? 0);
}

const references = new Map<Width, Promise<SignInReference>>();
function reference(browser: import('@playwright/test').Browser, run: HelpRun, width: Width): Promise<SignInReference> {
  if (!references.has(width)) references.set(width, signInReference(browser, width, typedPasswordLength(run, width)));
  return references.get(width)!;
}

// ---------------------------------------------------------------- tests

test.describe('HELP-01 Help pictures and video: HR signs in', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(ON_DEV, 'No-backend run only: the journey answers Cognito with the fake.');
    test.skip(testInfo.project.name !== 'desktop-1280', 'Runs the journey once; it checks the desktop and phone runs itself.');
    testInfo.setTimeout(15 * 60_000);
  });

  test('AC-1 The journey passes in the normal run on desktop and phone and writes nothing to help/media', async () => {
    const { run, wrote } = await normalRun();
    expectPassed(run, 'normal run (npm run e2e)');
    expect(wrote, 'the normal run writes nothing to help/media').toEqual([]);
  });

  test('AC-2 Only the fake company: Pieter van Wyk, from help-company.ts, and "Welcome back, Pieter"', async ({ page, browser }) => {
    const src = source();
    expect(src, `${FILE} exists`).not.toBe('');
    expect(src, 'the person comes from e2e/fixtures/help-company.ts').toMatch(/from\s+['"]\.\.\/fixtures\/help-company(\.js|\.ts)?['"]/);
    expect(src, 'the HR person of the help company is used').toMatch(/HELP_PEOPLE/);
    expect(src.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [], 'no email address is written in the journey; it is read from help-company.ts').toEqual([]);

    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    for (const width of WIDTHS) {
      const ref = await reference(browser, run, width);
      const [, filled, home] = PICTURES;
      const opts = { cssWidth: ref.cssWidth };
      // The email field shows pieter@example.com, and HR home greets Pieter.
      const email = await pictureDiff(page, readFileSync(picture(run, width, filled)), ref.pictures[1], { ...opts, region: ref.regions[1]['email'] });
      expect(email, `[${width}] ${filled}: the email field shows ${HELP_HR.email}`).toBeLessThanOrEqual(0.01);
      const greeting = await pictureDiff(page, readFileSync(picture(run, width, home)), ref.pictures[2], { ...opts, region: ref.regions[2]['greeting'] });
      expect(greeting, `[${width}] ${home}: the page says "Welcome back, ${HELP_HR.givenName}"`).toBeLessThanOrEqual(0.01);
      // Nothing else on any picture differs from the help company's own pages.
      for (const [i, name] of PICTURES.entries()) {
        const all = await pictureDiff(page, readFileSync(picture(run, width, name)), ref.pictures[i]!, { content: true });
        expect(all, `[${width}] ${name}: shows only what the help company's page shows`).toBeLessThanOrEqual(0.01);
      }
    }
  });

  test('AC-3 Exactly three pictures per width, at the journeys\' desktop and phone sizes', async () => {
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

  test('AC-4 Each picture shows its step: empty sign-in page, filled in with dots and no error, HR home; no caption bar', async ({ page, browser }) => {
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    // The references are taken here and checked against the card first
    // (support/journey-harness.ts signInReference): 01 mark, empty Email and
    // Password, Sign in, Forgot your password line; 02 filled in, password as
    // dots, no message; 03 HR home with "Welcome back, Pieter".
    const parts: Record<string, string[]> = {
      '01-sign-in-page': ['mark', 'email', 'password', 'submit', 'forgot'],
      '02-filled-in': ['email', 'password', 'submit'],
      '03-hr-home': ['greeting'],
    };
    for (const width of WIDTHS) {
      const ref = await reference(browser, run, width);
      const use = projectUse(width);
      const captionZone = { x: 0, y: use.viewport.height - 110, width: use.viewport.width, height: 110 };
      for (const [i, name] of PICTURES.entries()) {
        const shot = readFileSync(picture(run, width, name));
        const opts = { cssWidth: ref.cssWidth };
        for (const part of parts[name]!) {
          const d = await pictureDiff(page, shot, ref.pictures[i]!, { ...opts, region: ref.regions[i]![part] });
          expect(d, `[${width}] ${name}: ${part} looks as on the card`).toBeLessThanOrEqual(0.01);
        }
        const whole = await pictureDiff(page, shot, ref.pictures[i]!, { content: true });
        expect(whole, `[${width}] ${name}: the whole picture is this step`).toBeLessThanOrEqual(0.01);
        const caption = await pictureDiff(page, shot, ref.pictures[i]!, { ...opts, region: captionZone });
        expect(caption, `[${width}] ${name}: no caption bar`).toBeLessThanOrEqual(0.002);
      }
    }
  });

  test('AC-5 One silent video per width, from the sign-in page to HR home, under 20 seconds', async ({ page, browser }) => {
    expect(missingTools('ffmpeg', 'ffprobe'), 'ffmpeg and ffprobe are installed (the help run trims videos with them)').toEqual([]);
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    for (const width of WIDTHS) {
      const file = video(run, width);
      expect(existsSync(file), `help/media/${width}/${FOLDER}/${VIDEO}.webm exists`).toBe(true);
      const info = videoInfo(file);
      expect(info.streams, `[${width}] the video has a picture and no sound`).toEqual(['video']);
      expect(info.seconds, `[${width}] the video runs under 20 seconds`).toBeLessThan(20);

      const ref = await reference(browser, run, width);
      const [signInPage, , hrHome] = ref.pictures;
      // Lossy video: compare only what the reference shows, with a wide margin.
      const first = videoFrame(file, 'first');
      const firstMissing = await pictureDiff(page, first, signInPage, { threshold: 48, content: true });
      expect(firstMissing, `[${width}] the first frame is the sign-in page, not a blank or loading screen`).toBeLessThanOrEqual(0.25);
      const last = videoFrame(file, 'last');
      const lastMissing = await pictureDiff(page, last, hrHome, { threshold: 48, content: true });
      expect(lastMissing, `[${width}] the last frame is HR home`).toBeLessThanOrEqual(0.25);
    }
  });

  test('AC-6 Captions use the real names: Enter Email, Enter Password, Click/Tap Sign in, and a rename fails the journey', async () => {
    const src = source();
    expect(src, 'captions come from help.fill("Email", ...)').toMatch(/help\.fill\(\s*['"]Email['"]/);
    expect(src, 'captions come from help.fill("Password", ...)').toMatch(/help\.fill\(\s*['"]Password['"]/);
    expect(src, 'captions come from help.tap("Sign in")').toMatch(/help\.tap\(\s*['"]Sign in['"]/);

    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    for (const width of WIDTHS) {
      const click = width === 'phone' ? 'Tap Sign in' : 'Click Sign in';
      const seen = eventsFor(run, width).filter((e) => e.type !== 'length' && e.type !== 'reveal');
      const at = (type: PageEvent['type'], name: string) => seen.findIndex((e) => e.type === type && e.name === name);
      const order = [at('caption', 'Enter Email'), at('input', 'Email'), at('caption', 'Enter Password'), at('input', 'Password'), at('caption', click), at('click', 'Sign in')];
      const story = seen.map((e) => `${e.type}:${e.name}`).join(' → ');
      expect(order.every((i) => i >= 0), `[${width}] the video shows Enter Email, Enter Password and ${click}, each before its action. Seen: ${story}`).toBe(true);
      expect(order, `[${width}] each caption comes right before its action, in this order. Seen: ${story}`).toEqual([...order].sort((a, b) => a - b));
    }

    // Renamed field or button: the journey fails instead of keeping an old caption.
    const normal = (await normalRun()).run;
    expectPassed(normal, 'normal run with nothing renamed');
    for (const [label, renamed] of [
      ['Email renamed', renamedEmailRun],
      ['Password renamed', renamedPasswordRun],
      ['Sign in renamed', renamedButtonRun],
    ] as const) {
      const r = await renamed();
      expect(failedOnBoth(r), `${label}: the journey fails on desktop and phone\n${r.results.map((x) => `[${x.project}] ${x.status}`).join(', ')}`).toBe(true);
    }
  });

  test('AC-7 The password is never readable: dots only, Show password never used, a made-up value in the test file', async ({ page, browser }) => {
    const src = source();
    expect(src, `${FILE} exists`).not.toBe('');
    expect(src, 'the password does not come from the environment').not.toMatch(/process\.env/);
    expect(src, 'the password does not come from a secret store').not.toMatch(/secret|SecretsManager|load-e2e-logins/i);
    expect(src, 'the journey never selects Show password').not.toMatch(/show\s*password/i);

    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    for (const width of WIDTHS) {
      const events = eventsFor(run, width);
      expect(events.filter((e) => e.type === 'reveal'), `[${width}] the password is never shown as text`).toEqual([]);
      expect(events.filter((e) => e.type === 'click' && /show|hide/i.test(e.name)), `[${width}] Show password is never selected`).toEqual([]);
      expect(typedPasswordLength(run, width), `[${width}] a password was typed`).toBeGreaterThan(0);
      const ref = await reference(browser, run, width);
      const d = await pictureDiff(page, readFileSync(picture(run, width, PICTURES[1])), ref.pictures[1], {
        cssWidth: ref.cssWidth,
        region: ref.regions[1]['password'],
      });
      expect(d, `[${width}] ${PICTURES[1]}: the password shows as dots`).toBeLessThanOrEqual(0.01);
    }
  });

  test('AC-8 Same pictures every time: two help runs, and the retake script finds no change', async () => {
    expect(missingTools('compare', 'python3'), 'ImageMagick compare and python3 are installed (the retake script needs them)').toEqual([]);
    const one = await firstHelpRun();
    expectPassed(one, 'first help run');
    const two = await secondHelpRun();
    expectPassed(two, 'second help run');

    const repo = retakeRepo('retake-same');
    placeRun(one, FOLDER, repo.media);
    repo.commit('first help run');
    placeRun(two, FOLDER, repo.media);
    const out = repo.script('filter');
    expect(out.trim(), 'help-retake.py filter reports no change, so no retake PR opens').toBe('changed=false');
  });

  test('AC-9 No backend, no AI: a request to any other host fails the journey', async () => {
    const plain = (await normalRun()).run;
    expectPassed(plain, 'normal run');
    const escaped = await escapeRun();
    expect(
      failedOnBoth(escaped),
      `when the page asks ${ESCAPE_URL}, the journey fails on desktop and phone\n${escaped.results.map((x) => `[${x.project}] ${x.status}`).join(', ')}`,
    ).toBe(true);
  });

  test('AC-10 Pictures arrive by the retake PR: this PR adds none, and the retake lists six new pictures and two videos', async () => {
    const changed = prChanges('pepla-web/help/media');
    if (changed !== null && process.env['GITHUB_HEAD_REF'] !== 'help/retake') {
      expect(changed, 'the pull request changes no file under pepla-web/help/media').toEqual([]);
    }

    expect(missingTools('python3'), 'python3 is installed').toEqual([]);
    const run = await firstHelpRun();
    expectPassed(run, 'help run (npm run e2e:help)');
    const repo = retakeRepo('retake-new');
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

  test('AC-11 Locked tests untouched: the journey uses the locked Cognito fake as it is', async () => {
    const src = source();
    expect(src, `${FILE} exists`).not.toBe('');
    expect(src, 'imports the fake from e2e/acceptance/support/cognito-fake.ts').toMatch(
      /from\s+['"]\.\.\/acceptance\/support\/cognito-fake(\.js|\.ts)?['"]/,
    );
    const copies = readdirSync(join(WEB, 'e2e'), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.startsWith('acceptance') && !f.includes('node_modules'))
      .filter((f) => /class\s+CognitoFake\b/.test(readFileSync(join(WEB, 'e2e', f), 'utf8')));
    expect(copies, 'no copy of the fake outside e2e/acceptance/').toEqual([]);

    // The "Acceptance tests locked" check still guards this folder. That check,
    // green on the PR, is what proves no file here changed.
    const lock = readFileSync(join(WEB, '..', '.github', 'workflows', 'acceptance-lock.yml'), 'utf8');
    expect(lock).toMatch(/name: Acceptance tests locked/);
    expect(lock).toMatch(/pepla-web\/e2e\/acceptance\//);
  });
});
