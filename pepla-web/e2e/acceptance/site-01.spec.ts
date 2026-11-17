import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Locator, Page, Request } from '@playwright/test';
import { ON_SIGN_IN, expect, test } from './support/fixtures';
import { forgetSignIn } from './support/sign-in-again';
import { KIT_DIR, loadCompareToKit, plantLinkName, plantShift, type KitOnly, type KitParityResult } from './support/site-01/kit-parity-contract';
import {
  ALLOWED_WORDS,
  CHROME,
  COGNITO,
  NOT_FOUND_PATHS,
  PEPLA_WEB,
  SIGNED_IN_MARKERS,
  apiPatterns,
  isVisuallyHidden,
  logIn,
  pathOf,
  run,
  visibleTexts,
  walk,
} from './support/site-01/public-site';

/**
 * SITE-01 · Public routes and prerender in pepla-web, latest design system, no "pepla" visible
 * (Jira NH-203, epic NH-202). One test per acceptance criterion, written from the card before any code.
 * Spec: /mnt/project-files/onboarding-cards/specs/SITE-01.md (NH-203). Notes: ./cards/site-01.md.
 *
 * `/` is the public page for everyone, unknown paths show a not-found page, "Log in" goes to the one sign-in
 * page, the design system is the newest, no "pepla" reaches public output, and a harness compares an Angular
 * page with its design system kit screen.
 *
 * Each test runs at 1280 and 390 wide unless it says why not. AC-1 and AC-3 also run on pepla-dev.
 * Nothing here calls an AI service. These files are locked once accepted: see ./README.md.
 */

const ON_DEV = process.env['ACCEPTANCE_TARGET'] === 'pepla-dev';
const noBackendOnly = () => test.skip(ON_DEV, 'Runs in the no-backend run only: AC-1 and AC-3 are the pepla-dev checks.');
const once = (why: string) => test.skip(test.info().project.name !== 'desktop-1280', `Runs once, in desktop-1280: ${why}`);
const phoneOnly = () => test.skip(test.info().project.name !== 'phone-390', 'The criterion is about 390 wide: runs in phone-390.');
const isPhone = () => test.info().project.name === 'phone-390';

const TITLE = 'Naleko People';
const DS = join(PEPLA_WEB, 'src', 'styles', 'design-system');
const BROWSER_OUT = join(PEPLA_WEB, 'dist', 'pepla-web', 'browser');
/** Classes that first came to the design system in 6c63ab0 (#40, page endings): a sync at or after it has them. */
const SINCE_6C63AB0 = ['.pp-site-strip', '.pp-site-related'];
/**
 * AC-6 sample (BA, 16 Nov): kit site-header.html "Header at the top" against SITE-01's own `/`, compared only on the
 * brand link. The kit's desktop "Log in" sits left of "Get started" and "Book a demo", which SITE-02 brings, so it is
 * compared from SITE-02 on; on phones the kit moves "Log in" into the menu sheet (SITE-02).
 */
const BRAND: KitOnly = { role: 'link', name: 'Naleko People home' };
const PARITY_SAMPLE = {
  kitFile: 'site-header.html',
  path: NOT_FOUND_PATHS[0], // SITE-04: `/` is the landing page now, with the pilot bar above the header; the not-found page is still the bare header
  screens: [
    { screen: 'Header at the top (desktop)', width: 1440, only: [BRAND] },
    { screen: 'Header at the top (phone)', width: 390, only: [BRAND] },
  ],
} as const;
const AI_SOURCE = /bedrock|anthropic|openai|textract|comprehend|generativelanguage|@aws-sdk\/client-(bedrock|textract|comprehend)/i;
const AI_URL = /bedrock|anthropic|openai|textract|comprehend|generativelanguage|\/agent\/v1\//i;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactly = (pathAndQuery: string) => new RegExp(`^[a-z]+://[^/]+${escapeRe(pathAndQuery)}$`);
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Opens a public address and checks it stayed there and shows the header with "Log in" (the page exists). */
async function openPublic(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(logIn(page), `${path} shows the link "Log in"`).toBeVisible({ timeout: 20_000 });
  expect(pathOf(page), `${path} is not a redirect: the address stays as typed`).toBe(path);
}

async function tapOrClick(page: Page): Promise<void> {
  if (isPhone()) await logIn(page).tap();
  else await logIn(page).click();
}

/**
 * AC-2: every "Naleko People home" link in a signed-in shell points at that person's home, hidden ones included
 * (the shell shows it on phones only), and the visible one lands there.
 */
async function expectBrandLink(page: Page, home: '/hr' | '/start', shell: string, homePage: Locator): Promise<void> {
  const links = page.getByRole('link', { name: 'Naleko People home', exact: true, includeHidden: true });
  await expect(links.first(), `${shell}: has a "Naleko People home" link`).toBeAttached();
  const hrefs = await links.evaluateAll((all) => all.map((a) => (a as HTMLAnchorElement).href));
  expect(hrefs.map((h) => new URL(h).pathname), `${shell}: "Naleko People home" links to ${home}, not to the public page`).toEqual(hrefs.map(() => home));
  const visible = links.filter({ visible: true });
  if (await visible.count()) {
    await visible.first().click();
    await expect(page, `${shell}: "Naleko People home" lands on ${home}`).toHaveURL(new RegExp(`${escapeRe(home)}$`));
    await expect(homePage, `${shell}: the home page shows`).toBeVisible();
  }
}

function syncJson(): { repo: string; ref: string; files: Record<string, string> } {
  return JSON.parse(readFileSync(join(DS, 'sync.json'), 'utf8'));
}

test.describe('SITE-01 Public routes and prerender, latest design system, no "pepla" visible', () => {
  // -------------------------------------------------------------- AC-1
  test('AC-1 / is prerendered and light: its HTML holds the header and <main> without scripts, and it loads no Cognito, API or signed-in code @pepla-dev', async ({ page, browser, request, baseURL }) => {
    // The HTML served for `/`, as text, and with JavaScript off.
    const res = await request.get('/');
    expect(res.status(), 'GET / answers 200').toBe(200);
    expect(new URL(res.url()).pathname, 'GET / is not redirected').toBe('/');
    const html = await res.text();
    expect(html, 'the served HTML holds a <main> element').toMatch(/<main[\s>]/);
    expect(html, 'the served HTML holds the words "Log in"').toMatch(/>\s*Log in\s*</);
    expect(html, 'the served HTML has the tab title').toMatch(/<title>\s*Naleko People\s*<\/title>/);

    const noJs = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: page.viewportSize() });
    try {
      const p = await noJs.newPage();
      await p.goto('/');
      expect(pathOf(p)).toBe('/');
      await expect(p.getByRole('link', { name: 'Log in', exact: true }).first(), 'JavaScript off: the link "Log in" is there').toBeVisible();
      await expect(p.getByRole('banner').first(), 'JavaScript off: the header is there').toBeVisible();
      await expect(p.locator('main'), 'JavaScript off: one <main>').toHaveCount(1);
    } finally {
      await noJs.close();
    }

    // A signed-out browser opens `/`. Cognito and our APIs are refused so nothing leaves the machine; the
    // request is still seen.
    const apis = apiPatterns();
    const requests: string[] = [];
    const scripts: Array<Promise<{ url: string; text: string }>> = [];
    await page.context().route((u) => COGNITO.test(u.href) || apis.some((r) => r.test(u.href)), (route) => route.abort('blockedbyclient'));
    page.context().on('request', (r) => requests.push(r.url()));
    page.context().on('response', (r) => {
      const type = r.request().resourceType();
      const js = /javascript|ecmascript/.test(r.headers()['content-type'] ?? '') || /\.m?js(\?|$)/.test(new URL(r.url()).pathname);
      if (type === 'script' || js) scripts.push(r.text().then((text) => ({ url: r.url(), text }), () => ({ url: r.url(), text: '' })));
    });
    await openPublic(page, '/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveTitle(TITLE);
    expect(pathOf(page), '/ stays on /').toBe('/');

    expect(requests.filter((u) => COGNITO.test(u)), 'no request to a Cognito host').toEqual([]);
    expect(requests.filter((u) => apis.some((r) => r.test(u))), 'no request to the employees or document APIs').toEqual([]);
    const loaded = await Promise.all(scripts);
    expect(loaded.length, 'the page loaded its scripts').toBeGreaterThan(0);
    const carriers = loaded.flatMap((s) => SIGNED_IN_MARKERS.filter((m) => m !== 'Privacy notice' /* SITE-04: the landing's Trust section uses these words */).filter((m) => s.text.includes(m)).map((m) => `${new URL(s.url).pathname} holds "${m}"`));
    expect(carriers, 'no script that / loads holds a signed-in feature marker').toEqual([]);
  });

  // -------------------------------------------------------------- AC-2
  test('AC-2 Signed-in routes behave as before, and "Naleko People home" in the signed-in shells goes to /hr for HR and /start for an employee', async ({ page, signIn, hr, employee }) => {
    noBackendOnly();
    // Signed out: exactly where develop 5d36c1f sends each address today.
    const signedOut: Array<[string, string]> = [
      ['/hr', '/sign-in?returnUrl=%2Fhr'],
      ['/hr/documents', '/sign-in?returnUrl=%2Fhr%2Fdocuments'],
      ['/hr/documents/x', '/sign-in?returnUrl=%2Fhr%2Fdocuments%2Fx'],
      ['/hr/employees/new', '/sign-in?returnUrl=%2Fhr%2Femployees%2Fnew'],
      ['/hr/employees/x', '/sign-in?returnUrl=%2Fhr%2Femployees%2Fx'],
      ['/start', '/sign-in'],
      ['/start/privacy-notice', '/sign-in'],
    ];
    for (const [from, to] of signedOut) {
      await page.goto(from);
      await expect(page, `signed out, ${from} ends on ${to}`).toHaveURL(exactly(to), { timeout: 20_000 });
      await expect(signIn.heading).toBeVisible();
    }
    await page.goto('/sign-in');
    await expect(signIn.heading, '/sign-in opens').toBeVisible();
    await page.goto('/set-password');
    await expect(page.locator('h1').first(), '/set-password opens').toBeVisible();
    expect(new URL(page.url()).pathname, '/set-password stays').toBe('/set-password');

    // HR: the pages open as before, and the brand link is HR home.
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(/\/hr$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: `Welcome back, ${hr.givenName}`, exact: true })).toBeVisible();
    for (const [path, heading] of [['/hr/documents', 'Documents to check'], ['/hr/employees/new', 'Register a new employee']] as const) {
      await page.goto(path);
      await expect(page, `${path} opens for HR`).toHaveURL(new RegExp(`${escapeRe(path)}$`));
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    }
    await expectBrandLink(page, '/hr', 'HR shell', page.getByRole('heading', { name: `Welcome back, ${hr.givenName}`, exact: true }));

    // Employee: same, with /start.
    await forgetSignIn(page);
    await signIn.open();
    await signIn.signInAs(employee);
    await expect(page).toHaveURL(/\/start$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: `Welcome, ${employee.givenName}`, exact: true })).toBeVisible();
    await page.goto('/start/privacy-notice');
    await expect(page, '/start/privacy-notice opens for the employee').toHaveURL(/\/start\/privacy-notice$/);
    await expect(page.locator('h1').first()).toBeVisible();
    await expectBrandLink(page, '/start', 'employee shell', page.getByRole('heading', { name: `Welcome, ${employee.givenName}`, exact: true }));
  });

  // -------------------------------------------------------------- AC-3
  test('AC-3 "Log in" on / is a real link to the sign-in page; a signed-in HR person still sees / and "Log in" takes them on to HR home @pepla-dev', async ({ page, signIn, hr }) => {
    await openPublic(page, '/');
    const link = logIn(page);
    expect(await link.evaluate((a) => a.tagName), '"Log in" is an <a>').toBe('A');
    const href = await link.getAttribute('href');
    expect(href, '"Log in" has an href').toBeTruthy();
    expect(new URL(href!, page.url()).pathname, '"Log in" links to /sign-in').toBe('/sign-in');
    await tapOrClick(page);
    await expect(page, '"Log in" ends on the sign-in page').toHaveURL(ON_SIGN_IN, { timeout: 20_000 });
    await expect(signIn.heading).toBeVisible();

    // Signed in as HR, `/` is still the public page.
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(/\/hr$/, { timeout: 20_000 });
    await openPublic(page, '/');
    await page.waitForLoadState('networkidle');
    expect(pathOf(page), 'signed in, / is not redirected').toBe('/');
    await expect(logIn(page)).toBeVisible();
    await tapOrClick(page);
    await expect(page, 'signed in, "Log in" goes on to HR home').toHaveURL(/\/hr$/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: `Welcome back, ${hr.givenName}`, exact: true })).toBeVisible();
  });

  // -------------------------------------------------------------- AC-4
  test('AC-4 No "pepla" in public output: verify-public-names fails on every planted name and text, passes the real build, and runs after npm run build', async () => {
    noBackendOnly();
    once('it builds the app; the output does not depend on the window width.');
    test.setTimeout(20 * 60_000);
    const script = join(PEPLA_WEB, 'scripts', 'verify-public-names.mjs');
    expect(existsSync(script), 'scripts/verify-public-names.mjs exists').toBe(true);
    const pkg = JSON.parse(readFileSync(join(PEPLA_WEB, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['postbuild'], 'package.json has a postbuild script').toBeTruthy();

    // The real production build, with its postbuild check.
    const build = run('npm', ['run', 'build'], { timeout: 15 * 60_000 });
    expect(build.code, `npm run build passes:\n${build.out.slice(-3000)}`).toBe(0);
    const afterPost = build.out.split(/>\s*\S+\s+postbuild\b/)[1];
    expect(afterPost, 'npm run build ran postbuild').toBeTruthy();
    expect(afterPost!, 'postbuild says how many files it scanned').toMatch(/\b[1-9]\d*\s+(?:\w+\s+)?files?\b/i);
    expect(existsSync(join(BROWSER_OUT, 'index.html')), 'the production browser output has index.html').toBe(true);
    expect(walk(BROWSER_OUT).filter((e) => /(^|\/)pepla-app-icon\.svg$/.test(e.rel)).map((e) => e.rel), 'no file named pepla-app-icon.svg in the build').toEqual([]);

    const real = run('node', [script]);
    expect(real.code, `the real build passes (default folder):\n${real.out}`).toBe(0);
    expect(real.out, 'it says how many files it scanned').toMatch(/\b[1-9]\d*\s+(?:\w+\s+)?files?\b/i);

    // A fault in the real output fails postbuild itself, so the build check cannot pass over a hit.
    const plantedReal = join(BROWSER_OUT, 'site-01-planted.html');
    writeFileSync(plantedReal, '<!doctype html><title>pepla</title>');
    try {
      const post = run('npm', ['run', 'postbuild']);
      expect(post.code, `postbuild fails on a planted page in the real output:\n${post.out}`).not.toBe(0);
    } finally {
      rmSync(plantedReal, { force: true });
    }

    // Copies of the real build, one fault each.
    const work = mkdtempSync(join(tmpdir(), 'site-01-ac4-'));
    try {
      const copy = (name: string) => {
        const dir = join(work, name);
        cpSync(BROWSER_OUT, dir, { recursive: true });
        return dir;
      };
      const clean = copy('clean');
      const ok = run('node', [script, clean]);
      expect(ok.code, `the unplanted copy passes:\n${ok.out}`).toBe(0);
      expect(ok.out).toMatch(/\b[1-9]\d*\s+(?:\w+\s+)?files?\b/i);

      const index = readFileSync(join(clean, 'index.html'), 'utf8');
      expect(index, 'index.html has a <title> to plant into').toMatch(/<title>[^<]*<\/title>/);
      const inBody = (html: string, add: string) => html.replace(/<\/body>/i, `${add}</body>`);
      const inHead = (html: string, add: string) => html.replace(/<\/head>/i, `${add}</head>`);
      const plants: Array<{ name: string; plant: (dir: string) => void; file: string; text: string }> = [
        { name: 'text in a public page', file: 'index.html', text: 'pepla', plant: (d) => writeFileSync(join(d, 'index.html'), inBody(index, '<p>Ask pepla about it</p>')) },
        { name: 'a folder named pepla', file: 'pepla', text: 'pepla', plant: (d) => { mkdirSync(join(d, 'pepla')); writeFileSync(join(d, 'pepla', 'notes.txt'), 'nothing'); } },
        { name: 'a <title>', file: 'index.html', text: 'Pepla', plant: (d) => writeFileSync(join(d, 'index.html'), index.replace(/<title>[^<]*<\/title>/, '<title>Pepla People</title>')) },
        { name: 'a meta content', file: 'index.html', text: 'pepla', plant: (d) => writeFileSync(join(d, 'index.html'), inHead(index, '<meta name="description" content="HR by pepla">')) },
        { name: 'a link href', file: 'index.html', text: 'pepla', plant: (d) => writeFileSync(join(d, 'index.html'), inHead(index, '<link rel="icon" type="image/svg+xml" href="pepla-app-icon.svg">')) },
        { name: 'an <a href>', file: 'index.html', text: 'pepla', plant: (d) => writeFileSync(join(d, 'index.html'), inBody(index, '<a href="/pepla/about">About</a>')) },
        { name: '"PEPLA" in capitals', file: 'index.html', text: 'PEPLA', plant: (d) => writeFileSync(join(d, 'index.html'), inBody(index, '<p>PEPLA</p>')) },
      ];
      for (const p of plants) {
        const dir = copy(p.name.replace(/[^a-z]+/gi, '-'));
        p.plant(dir);
        const r = run('node', [script, dir]);
        expect(r.code, `${p.name}: exits 1\n${r.out}`).toBe(1);
        expect(r.out, `${p.name}: names the file`).toContain(p.file);
        expect(r.out, `${p.name}: names the text`).toContain(p.text);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------- AC-5
  test('AC-5 The design system is synced at or after 6c63ab0 (full sha), every synced file matches its hash, verify:design passes, and it holds the site classes', async () => {
    noBackendOnly();
    once('it reads files; the window width does not matter.');
    const sync = syncJson();
    expect(sync.repo).toBe('obsydian-tech/pepla-design-system');
    expect(sync.ref, 'sync.json names the design system commit in full (40 hex)').toMatch(/^[0-9a-f]{40}$/);

    const files = sync.files ?? {};
    expect(Object.keys(files).length, 'sync.json lists the synced files').toBeGreaterThan(0);
    const wrong = Object.entries(files).filter(([f, hash]) => !existsSync(join(DS, f)) || sha256(readFileSync(join(DS, f))) !== hash).map(([f]) => f);
    expect(wrong, 'every file in sync.json matches its hash').toEqual([]);
    const extra = walk(DS).filter((e) => !e.dir && e.rel !== 'sync.json' && !(e.rel in files)).map((e) => e.rel);
    expect(extra, 'nothing under src/styles/design-system/ is outside the sync').toEqual([]);

    // SITE-07: the site rules live in site.css, split out of components.css.
    const css = readFileSync(join(DS, 'site.css'), 'utf8');
    expect(css, 'site.css holds the site classes').toContain('pp-site-header');
    for (const cls of SINCE_6C63AB0) expect(css, `site.css holds ${cls}, added in 6c63ab0`).toContain(cls);

    const verify = run('npm', ['run', 'verify:design']);
    expect(verify.code, `npm run verify:design exits 0:\n${verify.out.slice(-3000)}`).toBe(0);
  });

  // -------------------------------------------------------------- AC-6
  test('AC-6 The kit parity harness matches the brand link of kit site-header "Header at the top" on the not-found page at 1440 and 390, and fails on a 4px shift and on a changed link name', async ({ browser, baseURL }) => {
    noBackendOnly();
    once('the harness sets its own widths (1440 and 390).');
    test.setTimeout(10 * 60_000);
    const compareToKit = await loadCompareToKit();

    // The kit file comes from the design system ref in sync.json, fetched by a script into a git-ignored folder.
    const pkg = JSON.parse(readFileSync(join(PEPLA_WEB, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['parity:kit'], 'package.json has a parity:kit script').toBeTruthy();
    rmSync(KIT_DIR, { recursive: true, force: true });
    const fetched = run('npm', ['run', 'parity:kit'], { timeout: 5 * 60_000 });
    expect(fetched.code, `npm run parity:kit passes:\n${fetched.out.slice(-2000)}`).toBe(0);
    expect(existsSync(KIT_DIR), 'parity:kit wrote e2e/parity/.kit/').toBe(true);
    expect(run('git', ['check-ignore', '-q', 'e2e/parity/.kit/']).code, 'git ignores e2e/parity/.kit/').toBe(0);
    expect(run('git', ['ls-files', 'e2e/parity/.kit']).out.trim(), 'nothing under e2e/parity/.kit/ is committed').toBe('');

    // The harness and the script it runs name no AI service.
    const sources = walk(join(PEPLA_WEB, 'e2e', 'parity'))
      .filter((e) => !e.dir && !e.rel.startsWith('.kit/') && /\.(ts|mts|cts|js|mjs|cjs)$/.test(e.rel))
      .map((e) => join(PEPLA_WEB, 'e2e', 'parity', e.rel));
    for (const m of pkg.scripts['parity:kit']!.matchAll(/([\w./-]+\.(?:mjs|cjs|js|ts))/g)) sources.push(join(PEPLA_WEB, m[1]));
    const ai = sources.filter((f) => existsSync(f) && AI_SOURCE.test(readFileSync(f, 'utf8'))).map((f) => relative(PEPLA_WEB, f).split(sep).join('/'));
    expect(ai, 'no harness file names an AI service').toEqual([]);

    const appOrigin = new URL(baseURL!).origin;
    const seen: string[] = [];
    const contexts: BrowserContext[] = [];
    const fresh = async (plant?: string): Promise<Page> => {
      const ctx = await browser.newContext({ baseURL, locale: 'en-ZA', timezoneId: 'Africa/Johannesburg', colorScheme: 'light' });
      contexts.push(ctx);
      ctx.on('request', (r: Request) => seen.push(r.url()));
      await ctx.route((u) => AI_URL.test(u.href), (route) => route.abort('blockedbyclient'));
      if (plant) await ctx.addInitScript({ content: plant });
      return ctx.newPage();
    };
    const sync = syncJson();
    const describe = (r: KitParityResult) => JSON.stringify({ ...r, unmatched: r.unmatched.slice(0, 10), moved: r.moved.slice(0, 10) }, null, 1);

    try {
      for (const { screen, width, only } of PARITY_SAMPLE.screens) {
        const opts = { kitFile: PARITY_SAMPLE.kitFile, screen, path: PARITY_SAMPLE.path, width, only: [...only] };

        const clean = await compareToKit({ page: await fresh(), ...opts });
        expect(clean.kitRef, `${screen}: the kit came from the synced ref`).toBe(sync.ref);
        expect(relative(KIT_DIR, clean.kitPath).startsWith('..'), `${screen}: the kit file is inside e2e/parity/.kit/`).toBe(false);
        expect(existsSync(clean.kitPath), `${screen}: the kit file exists`).toBe(true);
        expect(readFileSync(clean.kitPath, 'utf8'), `${screen}: the kit file holds the screen`).toContain(`data-screen="${screen}"`);
        expect(clean.width, `${screen}: opened at ${width}`).toBe(width);
        expect(clean.kitElements, `${screen}: compared the brand link and what is inside it`).toBeGreaterThanOrEqual(3);
        expect(clean.unmatched, `${screen}: every kit element is on the page\n${describe(clean)}`).toEqual([]);
        expect(clean.moved, `${screen}: every element within 1px\n${describe(clean)}`).toEqual([]);
        expect(clean.pixelRatio, `${screen}: at most 1% of pixels differ`).toBeLessThanOrEqual(0.01);
        expect(clean.pass, `${screen}: passes\n${describe(clean)}`).toBe(true);

        const shifted = await compareToKit({ page: await fresh(plantShift(PARITY_SAMPLE.path, BRAND.name, 4)), ...opts });
        expect(shifted.pass, `${screen}: the brand link moved 4px down fails\n${describe(shifted)}`).toBe(false);
        expect(shifted.moved.length, `${screen}: the planted shift moves boxes`).toBeGreaterThan(0);
        expect(shifted.pixelRatio, `${screen}: the planted shift changes pixels`).toBeGreaterThan(0);

        const renamed = await compareToKit({ page: await fresh(plantLinkName(PARITY_SAMPLE.path, BRAND.name, 'Naleko People start')), ...opts });
        expect(renamed.pass, `${screen}: a changed link name fails\n${describe(renamed)}`).toBe(false);
        expect(renamed.unmatched.length, `${screen}: the renamed link leaves the kit's brand link unmatched`).toBeGreaterThan(0);
      }
    } finally {
      for (const c of contexts) await c.close();
    }

    const outside = seen.filter((u) => {
      const url = new URL(u);
      if (/^(data|blob|about):$/.test(url.protocol)) return false;
      if (url.origin === appOrigin) return false;
      return !/(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
    });
    expect(outside, 'the harness calls nothing but the app and Google Fonts (no AI service)').toEqual([]);
  });

  // -------------------------------------------------------------- AC-7
  test('AC-7 At 390x844 / and the not-found page have no sideways scroll, and the header and "Log in" are visible and not under another bar', async ({ page }) => {
    noBackendOnly();
    phoneOnly();
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ['/', NOT_FOUND_PATHS[0]]) {
      await openPublic(page, path);
      await page.waitForLoadState('networkidle');
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(scrollWidth, `${path}: no sideways scroll (scrollWidth ${scrollWidth}, clientWidth ${clientWidth})`).toBeLessThanOrEqual(clientWidth);
      await expect(page.getByRole('banner').first(), `${path}: the header is visible`).toBeVisible();
      await expect(page.getByRole('banner').first()).toBeInViewport();
      if (path === '/') {
        // SITE-04: on the landing page the phone header keeps "Log in" in the menu sheet (as the kit does); the burger opens it.
        await page.getByRole('button', { name: 'Open menu', exact: true }).click();
        const inSheet = page.getByRole('dialog').getByRole('link', { name: 'Log in', exact: true });
        await expect(inSheet, '/: "Log in" is in the menu sheet').toBeVisible();
        await page.waitForTimeout(800); // the sheet slides in
        await inSheet.scrollIntoViewIfNeeded(); // the sheet lists the menu first and scrolls
        await expect(inSheet, '/: "Log in" is in the window once the sheet is scrolled to it').toBeInViewport({ ratio: 1 });
        await expect(inSheet, '/: "Log in" goes to the sign-in page').toHaveAttribute('href', '/sign-in');
        // Lock check: the "not under another bar" half of the criterion still holds for the link in the sheet.
        const under = await inSheet.evaluate((a) => { const r = a.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; return [[cx, cy], [r.left + r.width / 4, cy], [r.right - r.width / 4, cy]].filter(([x, y]) => { const hit = document.elementFromPoint(x!, y!); return !hit || !(hit === a || a.contains(hit)); }).length; });
        expect(under, '/: nothing lies over "Log in" in the sheet').toBe(0);
        await page.keyboard.press('Escape');
        continue;
      }
      const link = logIn(page);
      await expect(link, `${path}: "Log in" is visible`).toBeVisible();
      await expect(link, `${path}: "Log in" is in the window`).toBeInViewport({ ratio: 1 });
      const covered = await link.evaluate((a) => {
        const r = a.getBoundingClientRect();
        // The middle and four points a quarter in from each edge: inside the link even when its corners are rounded.
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const points = [[cx, cy], [r.left + r.width / 4, cy], [r.right - r.width / 4, cy], [cx, r.top + r.height / 4], [cx, r.bottom - r.height / 4]];
        return points.filter(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return !hit || !(hit === a || a.contains(hit));
        }).map(([x, y]) => `${Math.round(x)},${Math.round(y)}: ${document.elementFromPoint(x, y)?.outerHTML.slice(0, 80) ?? 'nothing'}`);
      });
      expect(covered, `${path}: nothing lies over "Log in"`).toEqual([]);
    }
  });

  // -------------------------------------------------------------- AC-8
  test('AC-8 An unknown path shows the not-found page without sign-in, with the header, <main> and the tab title, and known paths are not caught by it', async ({ page, signIn }) => {
    noBackendOnly();
    for (const path of NOT_FOUND_PATHS) {
      const res = await page.goto(path);
      expect(res?.status(), `${path}: HTTP 200`).toBe(200);
      await expect(logIn(page), `${path}: the header with "Log in"`).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState('networkidle');
      expect(pathOf(page), `${path}: not a redirect, the address stays as typed`).toBe(path);
      await expect(page.getByRole('banner').first()).toBeVisible();
      await expect(page.locator('main'), `${path}: one <main>`).toHaveCount(1);
      await expect(page, `${path}: tab title`).toHaveTitle(TITLE);
      await expect(signIn.email, `${path}: not the sign-in form`).toHaveCount(0);
    }

    // Known paths keep their own pages.
    await page.goto('/hr');
    await expect(page, '/hr still goes to sign-in').toHaveURL(exactly('/sign-in?returnUrl=%2Fhr'), { timeout: 20_000 });
    await expect(signIn.heading).toBeVisible();
    await page.goto('/start');
    await expect(page, '/start still goes to sign-in').toHaveURL(exactly('/sign-in'), { timeout: 20_000 });
    await page.goto('/sign-in');
    await expect(signIn.heading, '/sign-in is the sign-in page').toBeVisible();
    await page.goto('/set-password');
    await expect(page.locator('h1').first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/set-password');
    await expect(page.getByRole('heading', { name: TITLE, exact: true }), '/set-password is not the not-found page').toHaveCount(0);
  });

  // -------------------------------------------------------------- AC-9
  test('AC-9 Nothing visible is invented on / and the not-found page: only "Log in" and "Naleko People", one visually hidden h1', async ({ page }) => {
    noBackendOnly();
    for (const path of ['/', NOT_FOUND_PATHS[0]]) {
      await openPublic(page, path);
      await page.waitForLoadState('networkidle');
      if (path === '/') {
        // SITE-04: `/` is the landing page, whose words are the kit's (judged in SITE-04 AC-1 and AC-2). Here: one h1, and nothing invented.
        await expect(page.locator('h1'), '/: one h1').toHaveCount(1);
        expect(await page.locator('h1').innerText(), '/: the h1 is the hero title').toMatch(/Every\s+employee/);
        const all = await page.evaluate(() => document.body.textContent ?? '');
        expect(all, '/: no lorem or placeholder text').not.toMatch(/lorem|ipsum|placeholder|\bTODO\b|\bTBD\b/i);
        await expect(page.locator('[placeholder]'), '/: no placeholder attributes').toHaveCount(0);
        expect(all, '/: no "pepla"').not.toMatch(/pepla/i);
        continue;
      }

      const headings = page.locator('h1, h2, h3, h4, h5, h6, [role="heading"]');
      await expect(headings, `${path}: exactly one heading`).toHaveCount(1);
      const h1 = page.locator('h1');
      await expect(h1, `${path}: the heading is an h1`).toHaveCount(1);
      expect((await h1.textContent())?.replace(/\s+/g, ' ').trim(), `${path}: the h1 reads "Naleko People"`).toBe(TITLE);
      expect(await isVisuallyHidden(h1), `${path}: the h1 is visually hidden`).toBe(true);

      const texts = await visibleTexts(page);
      const invented = texts
        .filter((t) => {
          if (t.chrome) return !CHROME.find((c) => c.selector === t.chrome)!.words.includes(t.text);
          return !(ALLOWED_WORDS as readonly string[]).includes(t.text);
        })
        .map((t) => (t.chrome ? `${t.text} (in ${t.chrome})` : t.text));
      expect(invented, `${path}: no visible words beyond "Log in" and "Naleko People"`).toEqual([]);
      expect(texts.some((t) => t.text === 'Log in'), `${path}: "Log in" is among the visible words`).toBe(true);

      const names = await page.getByRole('link').evaluateAll((links) => links.map((a) => (a.getAttribute('aria-label') ?? a.textContent ?? '').replace(/\s+/g, ' ').trim()));
      const otherNames = names.filter((n) => !['Log in', 'Naleko People home', 'Skip to content'].includes(n));
      expect(otherNames, `${path}: links are only "Log in", "Naleko People home" and the skip link`).toEqual([]);

      const all = await page.evaluate(() => document.body.textContent ?? '');
      expect(all, `${path}: no lorem or placeholder text`).not.toMatch(/lorem|ipsum|placeholder|\bTODO\b|\bTBD\b/i);
      await expect(page.locator('[placeholder]'), `${path}: no placeholder attributes`).toHaveCount(0);
    }
  });

  // -------------------------------------------------------------- AC-10
  test('AC-10 axe (wcag2a, wcag2aa) finds no violations on / and the not-found page', async ({ page }) => {
    noBackendOnly();
    for (const path of ['/', NOT_FOUND_PATHS[0]]) {
      await openPublic(page, path);
      await page.waitForLoadState('networkidle');
      // Lock check (SITE-04 re-lock): `/` is the landing page now and its sections fade in after load; axe read the text half faded (160
      // colour-contrast nodes at networkidle, none once settled). Wait until every animation that ends has ended (loops keep running).
      if (path === '/') await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Infinity), undefined, { timeout: 15_000 });
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const found = results.violations.map((v) => `${v.impact}: ${v.id} (${v.nodes.length}) ${v.help} :: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
      expect(found, `axe on ${path}`).toEqual([]);
    }
  });
});

