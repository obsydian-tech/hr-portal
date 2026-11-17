# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: site-07.spec.ts >> SITE-07 Site styles split out and loaded only on public routes >> AC-1 the design system is synced in two files: components.css has no site rules, site.css has them, index.css and platform.css import the right parts, verify:design knows site classes
- Location: e2e/acceptance/site-07.spec.ts:45:7

# Error details

```
Error: the ref moved on from the one before the split (6c63ab0)

expect(received).not.toMatch(expected)

Expected pattern: not /^6c63ab0/
Received string:      "6c63ab0b571e2ad377517f9eaf6cebe11cf8fb7d"
```

# Test source

```ts
  1   | import { createHash } from 'node:crypto';
  2   | import { existsSync, readFileSync } from 'node:fs';
  3   | import { join } from 'node:path';
  4   | import type { Page, Request, Response } from '@playwright/test';
  5   | import { expect, test } from './support/fixtures';
  6   | import { forgetSignIn } from './support/sign-in-again';
  7   | import { BROWSER_OUT, DS, PEPLA_WEB, changedFiles, dsFile, imports, isSiteCss, linkedStyles, plant, productionBuild, read, rel, run, siteStyleState, stripComments, walk } from './support/site-07/css-split';
  8   | 
  9   | /**
  10  |  * SITE-07 · Site styles split out of the design system's component CSS and loaded only on public routes (Jira NH-209, epic NH-202).
  11  |  * One test per acceptance criterion, written from the card before any code. Spec: /mnt/project-files/onboarding-cards/specs/SITE-07.md.
  12  |  * Notes and the SITE-01 re-lock: ./cards/site-07.md. No backend: the signed-in pages run on the Cognito fake.
  13  |  *
  14  |  * Criteria that read files or the production build run once, in desktop-1280. AC-2, AC-4 (its prerender part) and AC-7 share one
  15  |  * `npm run build` (a few minutes). Run with `E2E_BASE_URL` pointing at a running `ng serve`.
  16  |  */
  17  | 
  18  | const once = (why: string) => test.skip(test.info().project.name !== 'desktop-1280', `Runs once, in desktop-1280: ${why}`);
  19  | const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  20  | const SITE_HEADER_BOX = '.pp-site-header, [role="banner"] a[href="/sign-in"]';
  21  | 
  22  | /** Every request a page makes, and the text of every stylesheet it receives, from the moment `watch` is called. */
  23  | function watch(page: Page): { requests: string[]; sheets: Array<{ url: string; text: string }>; reset: () => void } {
  24  |   const requests: string[] = [];
  25  |   const sheets: Array<{ url: string; text: string }> = [];
  26  |   const pending: Array<Promise<void>> = [];
  27  |   page.context().on('request', (r: Request) => requests.push(r.url()));
  28  |   page.context().on('response', (r: Response) => {
  29  |     const type = r.request().resourceType();
  30  |     const css = type === 'stylesheet' || /text\/css/.test(r.headers()['content-type'] ?? '') || /\.css(\?|$)/.test(new URL(r.url()).pathname);
  31  |     if (css) pending.push(r.text().then((text) => { sheets.push({ url: r.url(), text }); }, () => undefined));
  32  |   });
  33  |   return { requests, sheets, reset: () => { requests.length = 0; sheets.length = 0; pending.length = 0; } };
  34  | }
  35  | const siteRequests = (urls: string[]) => urls.filter((u) => isSiteCss(new URL(u).pathname));
  36  | 
  37  | async function settle(page: Page): Promise<void> {
  38  |   await page.waitForLoadState('load');
  39  |   await page.waitForLoadState('networkidle');
  40  |   await page.waitForTimeout(500);
  41  | }
  42  | 
  43  | test.describe('SITE-07 Site styles split out and loaded only on public routes', () => {
  44  |   // ---------------------------------------------------------------- AC-1
  45  |   test('AC-1 the design system is synced in two files: components.css has no site rules, site.css has them, index.css and platform.css import the right parts, verify:design knows site classes', async () => {
  46  |     once('it reads files and runs verify:design');
  47  |     test.setTimeout(6 * 60_000);
  48  |     const sync = JSON.parse(dsFile('sync.json')) as { repo: string; ref: string; files: Record<string, string> };
  49  |     expect(sync.ref, 'sync.json names the design system commit in full (40 hex)').toMatch(/^[0-9a-f]{40}$/);
  50  |     // The split is a design system commit after the one SITE-01 and SITE-04 synced (6c63ab0 and c0de954), so the ref has moved on.
  51  |     expect(sync.ref, 'the ref moved on from the one before the split (c0de954)').not.toMatch(/^c0de954/);
> 52  |     expect(sync.ref, 'the ref moved on from the one before the split (6c63ab0)').not.toMatch(/^6c63ab0/);
      |                                                                                      ^ Error: the ref moved on from the one before the split (6c63ab0)
  53  |     for (const f of ['site.css', 'platform.css', 'components.css', 'index.css']) {
  54  |       expect(Object.keys(sync.files), `sync.json lists ${f}`).toContain(f);
  55  |       expect(existsSync(join(DS, f)), `${f} exists`).toBe(true);
  56  |       expect(sha256(readFileSync(join(DS, f))), `the hash of ${f} in sync.json matches the file`).toBe(sync.files[f]);
  57  |     }
  58  |     const components = dsFile('components.css');
  59  |     const site = dsFile('site.css');
  60  |     expect(components, 'components.css holds no "pp-site" text at all, in any case').not.toMatch(/pp-site/i);
  61  |     expect(components, 'components.css still holds the shared parts (pp-button)').toContain('.pp-button');
  62  |     for (const cls of ['pp-site-header', '.pp-site-strip', '.pp-site-related']) expect(site, `site.css holds ${cls}`).toContain(cls);
  63  |     expect(site, 'site.css holds no signed-in component (pp-button is defined only in components.css)').not.toMatch(/^\.pp-button\s*\{/m);
  64  |     const tokens = ['tokens/palette.css', 'tokens/colors.css', 'tokens/typography.css', 'tokens/spacing.css', 'tokens/shape.css', 'tokens/motion.css', 'tokens/layers.css', 'tokens/base.css'];
  65  |     expect(imports(dsFile('index.css')), 'index.css imports the tokens, components.css, then site.css').toEqual([...tokens, 'components.css', 'site.css']);
  66  |     expect(imports(dsFile('platform.css')), 'platform.css imports the tokens and components.css, and not site.css').toEqual([...tokens, 'components.css']);
  67  |     const styles = stripComments(read(join(PEPLA_WEB, 'src', 'styles.css')));
  68  |     expect(styles, 'src/styles.css imports platform.css').toMatch(/platform\.css/);
  69  |     expect(styles, 'src/styles.css imports neither index.css nor site.css').not.toMatch(/index\.css|site\.css/);
  70  | 
  71  |     const verify = run('npm', ['run', 'verify:design']);
  72  |     expect(verify.code, `npm run verify:design exits 0:\n${verify.out.slice(-3000)}`).toBe(0);
  73  |     const gallery = join(PEPLA_WEB, 'src', 'app', 'ds', 'site', 'gallery.page.html');
  74  |     const madeUp = plant(gallery, `${read(gallery)}\n<span class="pp-site-made-up"></span>\n`, () => run('npm', ['run', 'verify:design']));
  75  |     expect(madeUp.code, `verify:design fails on a made-up site class:\n${madeUp.out.slice(-1500)}`).not.toBe(0);
  76  |     expect(madeUp.out, 'it names the made-up class').toContain('pp-site-made-up');
  77  |     const handEdit = plant(join(DS, 'site.css'), `${site}\n.pp-site-hand-edit { margin: 0; }\n`, () => run('npm', ['run', 'verify:design']));
  78  |     expect(handEdit.code, `verify:design fails on a hand edit to site.css:\n${handEdit.out.slice(-1500)}`).not.toBe(0);
  79  |     expect(run('npm', ['run', 'verify:design']).code, 'and passes again once the plants are put back').toBe(0);
  80  |   });
  81  | 
  82  |   // ---------------------------------------------------------------- AC-2
  83  |   test('AC-2 smaller first load for the app: no initial stylesheet holds site rules, the initial total is at most 548 kB, site.css is in the output, the budgets are unchanged', async () => {
  84  |     once('it builds the app once');
  85  |     test.setTimeout(20 * 60_000);
  86  |     const build = productionBuild();
  87  |     console.log(`SITE-07 initial total: ${build.initialKb} kB`);
  88  |     expect(build.initialKb, `the "Initial total" is at most 548 kB (it is ${build.initialKb} kB)`).toBeLessThanOrEqual(548);
  89  |     const css = walk(BROWSER_OUT).filter((f) => f.endsWith('.css'));
  90  |     const names = css.map((f) => rel(BROWSER_OUT, f));
  91  |     expect(names.filter((n) => /(^|\/)site\.css$/.test(n)), 'the output holds site.css').toHaveLength(1);
  92  |     expect(read(join(BROWSER_OUT, 'site.css')), 'site.css holds pp-site-header').toContain('pp-site-header');
  93  |     const linked = linkedStyles(build.indexHtml).filter((h) => !isSiteCss(h));
  94  |     expect(linked.length, 'index.html links the initial stylesheet(s) other than site.css').toBeGreaterThan(0);
  95  |     for (const href of linked) {
  96  |       const file = join(BROWSER_OUT, href.replace(/^\//, '').split(/[?#]/)[0]!);
  97  |       expect(existsSync(file), `${href} is in the output`).toBe(true);
  98  |       expect(read(file), `the initial stylesheet ${href} holds no site rule`).not.toMatch(/pp-site/);
  99  |     }
  100 |     const angular = JSON.parse(read(join(PEPLA_WEB, 'angular.json'))) as { projects: Record<string, { architect: { build: { configurations: { production: { budgets: unknown } } } } }> };
  101 |     const budgets = Object.values(angular.projects)[0]!.architect.build.configurations.production.budgets;
  102 |     expect(budgets, 'the budgets block of angular.json is unchanged').toEqual([
  103 |       { type: 'initial', maximumWarning: '500kB', maximumError: '1MB' },
  104 |       { type: 'anyComponentStyle', maximumWarning: '4kB', maximumError: '8kB' },
  105 |     ]);
  106 |   });
  107 | 
  108 |   // ---------------------------------------------------------------- AC-3
  109 |   test('AC-3 signed-in pages never ask for site.css: sign-in, forgot password, set password, HR home, documents and the employee start make no request for it and carry no site rule', async ({ page, signIn, hr, employee }) => {
  110 |     const w = watch(page);
  111 |     const check = async (path: string, label: string) => {
  112 |       w.reset();
  113 |       await page.goto(path);
  114 |       await settle(page);
  115 |       expect(siteRequests(w.requests), `${label}: no request for site.css`).toEqual([]);
  116 |       expect(w.sheets.filter((s) => /pp-site/.test(s.text)).map((s) => s.url), `${label}: no stylesheet it receives holds a site rule`).toEqual([]);
  117 |       const state = await siteStyleState(page);
  118 |       expect(state.links, `${label}: no <link> to site.css after it settles`).toBe(0);
  119 |       expect(state.sheets, `${label}: no site.css among the page's stylesheets`).toBe(0);
  120 |     };
  121 |     for (const path of ['/sign-in', '/forgot-password', '/set-password']) await check(path, `${path} signed out`);
  122 |     await signIn.open();
  123 |     await signIn.signInAs(hr);
  124 |     await expect(page).toHaveURL(/\/hr$/, { timeout: 20_000 });
  125 |     for (const path of ['/hr', '/hr/documents']) await check(path, `${path} as HR`);
  126 |     await forgetSignIn(page);
  127 |     await signIn.open();
  128 |     await signIn.signInAs(employee);
  129 |     await expect(page).toHaveURL(/\/start$/, { timeout: 20_000 });
  130 |     await check('/start', '/start as an employee');
  131 |   });
  132 | 
  133 |   // ---------------------------------------------------------------- AC-4
  134 |   test('AC-4 public pages ask for site.css once, before first paint: one request and one link on / and the not-found page, the prerendered HTML has the link in <head>, and with JavaScript off the header has the same boxes', async ({ page, browser, baseURL }) => {
  135 |     const w = watch(page);
  136 |     for (const path of ['/', '/nothing-here']) {
  137 |       w.reset();
  138 |       await page.goto(path);
  139 |       await settle(page);
  140 |       expect(siteRequests(w.requests), `${path}: site.css is requested exactly once`).toHaveLength(1);
  141 |       expect((await siteStyleState(page)).links, `${path}: exactly one <link rel="stylesheet"> to site.css`).toBe(1);
  142 |     }
  143 |     // With JavaScript off, the header (and "Log in") sit where they sit with JavaScript on.
  144 |     const boxes = async (p: Page) => p.evaluate((sel) => {
  145 |       const pick = (el: Element | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10); };
  146 |       return { header: pick(document.querySelector('.pp-site-header')), login: pick([...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Log in' && a.getBoundingClientRect().width > 0) ?? null), sel };
  147 |     }, SITE_HEADER_BOX);
  148 |     await page.goto('/');
  149 |     await settle(page);
  150 |     const withJs = await boxes(page);
  151 |     const noJs = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: page.viewportSize() });
  152 |     try {
```