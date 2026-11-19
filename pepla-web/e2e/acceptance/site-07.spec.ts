import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Request, Response } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { forgetSignIn } from './support/sign-in-again';
import { BROWSER_OUT, DS, PEPLA_WEB, changedFiles, dsFile, imports, isSiteCss, linkedStyles, plant, productionBuild, read, rel, run, siteStyleState, stripComments, walk } from './support/site-07/css-split';

/**
 * SITE-07 · Site styles split out of the design system's component CSS and loaded only on public routes (Jira NH-209, epic NH-202).
 * One test per acceptance criterion, written from the card before any code. Spec: /mnt/project-files/onboarding-cards/specs/SITE-07.md.
 * Notes and the SITE-01 re-lock: ./cards/site-07.md. No backend: the signed-in pages run on the Cognito fake.
 *
 * Criteria that read files or the production build run once, in desktop-1280. AC-2, AC-4 (its prerender part) and AC-7 share one
 * `npm run build` (a few minutes). Run with `E2E_BASE_URL` pointing at a running `ng serve`.
 */

const once = (why: string) => test.skip(test.info().project.name !== 'desktop-1280', `Runs once, in desktop-1280: ${why}`);
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const SITE_HEADER_BOX = '.pp-site-header, [role="banner"] a[href="/sign-in"]';

/** Every request a page makes, and the text of every stylesheet it receives, from the moment `watch` is called. */
function watch(page: Page): { requests: string[]; sheets: Array<{ url: string; text: string }>; reset: () => void } {
  const requests: string[] = [];
  const sheets: Array<{ url: string; text: string }> = [];
  const pending: Array<Promise<void>> = [];
  page.context().on('request', (r: Request) => requests.push(r.url()));
  page.context().on('response', (r: Response) => {
    const type = r.request().resourceType();
    const css = type === 'stylesheet' || /text\/css/.test(r.headers()['content-type'] ?? '') || /\.css(\?|$)/.test(new URL(r.url()).pathname);
    if (css) pending.push(r.text().then((text) => { sheets.push({ url: r.url(), text }); }, () => undefined));
  });
  return { requests, sheets, reset: () => { requests.length = 0; sheets.length = 0; pending.length = 0; } };
}
const siteRequests = (urls: string[]) => urls.filter((u) => isSiteCss(new URL(u).pathname));

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
}

test.describe('SITE-07 Site styles split out and loaded only on public routes', () => {
  // ---------------------------------------------------------------- AC-1
  test('AC-1 the design system is synced in two files: components.css has no site rules, site.css has them, index.css and platform.css import the right parts, verify:design knows site classes', async () => {
    once('it reads files and runs verify:design');
    test.setTimeout(6 * 60_000);
    const sync = JSON.parse(dsFile('sync.json')) as { repo: string; ref: string; files: Record<string, string> };
    expect(sync.ref, 'sync.json names the design system commit in full (40 hex)').toMatch(/^[0-9a-f]{40}$/);
    // The split is a design system commit after the one SITE-01 and SITE-04 synced (6c63ab0 and c0de954), so the ref has moved on.
    expect(sync.ref, 'the ref moved on from the one before the split (c0de954)').not.toMatch(/^c0de954/);
    expect(sync.ref, 'the ref moved on from the one before the split (6c63ab0)').not.toMatch(/^6c63ab0/);
    for (const f of ['site.css', 'platform.css', 'components.css', 'index.css']) {
      expect(Object.keys(sync.files), `sync.json lists ${f}`).toContain(f);
      expect(existsSync(join(DS, f)), `${f} exists`).toBe(true);
      expect(sha256(readFileSync(join(DS, f))), `the hash of ${f} in sync.json matches the file`).toBe(sync.files[f]);
    }
    const components = dsFile('components.css');
    const site = dsFile('site.css');
    expect(components, 'components.css holds no "pp-site" text at all, in any case').not.toMatch(/pp-site/i);
    expect(components, 'components.css still holds the shared parts (pp-button)').toContain('.pp-button');
    for (const cls of ['pp-site-header', '.pp-site-strip', '.pp-site-related']) expect(site, `site.css holds ${cls}`).toContain(cls);
    expect(site, 'site.css holds no signed-in component (pp-button is defined only in components.css)').not.toMatch(/^\.pp-button\s*\{/m);
    const tokens = ['tokens/palette.css', 'tokens/colors.css', 'tokens/typography.css', 'tokens/spacing.css', 'tokens/shape.css', 'tokens/motion.css', 'tokens/layers.css', 'tokens/base.css'];
    expect(imports(dsFile('index.css')), 'index.css imports the tokens, components.css, then site.css').toEqual([...tokens, 'components.css', 'site.css']);
    expect(imports(dsFile('platform.css')), 'platform.css imports the tokens and components.css, and not site.css').toEqual([...tokens, 'components.css']);
    const styles = stripComments(read(join(PEPLA_WEB, 'src', 'styles.css')));
    expect(styles, 'src/styles.css imports platform.css').toMatch(/platform\.css/);
    expect(styles, 'src/styles.css imports neither index.css nor site.css').not.toMatch(/index\.css|site\.css/);

    const verify = run('npm', ['run', 'verify:design']);
    expect(verify.code, `npm run verify:design exits 0:\n${verify.out.slice(-3000)}`).toBe(0);
    const gallery = join(PEPLA_WEB, 'src', 'app', 'ds', 'site', 'gallery.page.html');
    const madeUp = plant(gallery, `${read(gallery)}\n<span class="pp-site-made-up"></span>\n`, () => run('npm', ['run', 'verify:design']));
    expect(madeUp.code, `verify:design fails on a made-up site class:\n${madeUp.out.slice(-1500)}`).not.toBe(0);
    expect(madeUp.out, 'it names the made-up class').toContain('pp-site-made-up');
    const handEdit = plant(join(DS, 'site.css'), `${site}\n.pp-site-hand-edit { margin: 0; }\n`, () => run('npm', ['run', 'verify:design']));
    expect(handEdit.code, `verify:design fails on a hand edit to site.css:\n${handEdit.out.slice(-1500)}`).not.toBe(0);
    expect(run('npm', ['run', 'verify:design']).code, 'and passes again once the plants are put back').toBe(0);
  });

  // ---------------------------------------------------------------- AC-2
  test('AC-2 smaller first load for the app: no initial stylesheet holds site rules, the initial total is at most 548 kB, site.css is in the output, the budgets are unchanged', async () => {
    once('it builds the app once');
    test.setTimeout(20 * 60_000);
    const build = productionBuild();
    console.log(`SITE-07 initial total: ${build.initialKb} kB`);
    expect(build.initialKb, `the "Initial total" is at most 548 kB (it is ${build.initialKb} kB)`).toBeLessThanOrEqual(548);
    const css = walk(BROWSER_OUT).filter((f) => f.endsWith('.css'));
    const names = css.map((f) => rel(BROWSER_OUT, f));
    expect(names.filter((n) => /(^|\/)site\.css$/.test(n)), 'the output holds site.css').toHaveLength(1);
    expect(read(join(BROWSER_OUT, 'site.css')), 'site.css holds pp-site-header').toContain('pp-site-header');
    const linked = linkedStyles(build.indexHtml).filter((h) => !isSiteCss(h));
    expect(linked.length, 'index.html links the initial stylesheet(s) other than site.css').toBeGreaterThan(0);
    for (const href of linked) {
      const file = join(BROWSER_OUT, href.replace(/^\//, '').split(/[?#]/)[0]!);
      expect(existsSync(file), `${href} is in the output`).toBe(true);
      expect(read(file), `the initial stylesheet ${href} holds no site rule`).not.toMatch(/pp-site/);
    }
    const angular = JSON.parse(read(join(PEPLA_WEB, 'angular.json'))) as { projects: Record<string, { architect: { build: { configurations: { production: { budgets: unknown } } } } }> };
    const budgets = Object.values(angular.projects)[0]!.architect.build.configurations.production.budgets;
    expect(budgets, 'the budgets block of angular.json is unchanged').toEqual([
      { type: 'initial', maximumWarning: '500kB', maximumError: '1MB' },
      { type: 'anyComponentStyle', maximumWarning: '4kB', maximumError: '8kB' },
    ]);
  });

  // ---------------------------------------------------------------- AC-3
  test('AC-3 signed-in pages never ask for site.css: sign-in, forgot password, set password, HR home, documents and the employee start make no request for it and carry no site rule', async ({ page, signIn, hr, employee }) => {
    const w = watch(page);
    const check = async (path: string, label: string) => {
      w.reset();
      await page.goto(path);
      await settle(page);
      expect(new URL(page.url()).pathname, `${label}: the page stayed on ${path} (a lost session would test the sign-in page instead)`).toBe(path);
      expect(siteRequests(w.requests), `${label}: no request for site.css`).toEqual([]);
      expect(w.sheets.filter((s) => /pp-site/.test(s.text)).map((s) => s.url), `${label}: no stylesheet it receives holds a site rule`).toEqual([]);
      const state = await siteStyleState(page);
      expect(state.links, `${label}: no <link> to site.css after it settles`).toBe(0);
      expect(state.sheets, `${label}: no site.css among the page's stylesheets`).toBe(0);
    };
    for (const path of ['/sign-in', '/forgot-password', '/set-password']) await check(path, `${path} signed out`);
    await signIn.open();
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(/\/hr$/, { timeout: 20_000 });
    for (const path of ['/hr', '/hr/documents']) await check(path, `${path} as HR`);
    await forgetSignIn(page);
    await signIn.open();
    await signIn.signInAs(employee);
    await expect(page).toHaveURL(/\/start$/, { timeout: 20_000 });
    await check('/start', '/start as an employee');
  });

  // ---------------------------------------------------------------- AC-4
  test('AC-4 public pages ask for site.css once, before first paint: one request and one link on / and the not-found page, the prerendered HTML has the link in <head>, and with JavaScript off the header has the same boxes', async ({ page, browser, baseURL }) => {
    const w = watch(page);
    for (const path of ['/', '/nothing-here']) {
      w.reset();
      await page.goto(path);
      await settle(page);
      expect(siteRequests(w.requests), `${path}: site.css is requested exactly once`).toHaveLength(1);
      expect((await siteStyleState(page)).links, `${path}: exactly one <link rel="stylesheet"> to site.css`).toBe(1);
    }
    // With JavaScript off, the header (and "Log in") sit where they sit with JavaScript on.
    const boxes = async (p: Page) => p.evaluate((sel) => {
      const pick = (el: Element | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10); };
      return { header: pick(document.querySelector('.pp-site-header')), login: pick([...document.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Log in' && a.getBoundingClientRect().width > 0) ?? null), sel };
    }, SITE_HEADER_BOX);
    await page.goto('/');
    await settle(page);
    const withJs = await boxes(page);
    const noJs = await browser.newContext({ javaScriptEnabled: false, baseURL, viewport: page.viewportSize() });
    try {
      const p = await noJs.newPage();
      await p.goto('/');
      await p.waitForLoadState('load');
      await p.waitForTimeout(800);
      const without = await boxes(p);
      expect(without.header, 'JavaScript off: the header is there').not.toBeNull();
      expect(without.login, 'JavaScript off: "Log in" is there').not.toBeNull();
      for (const k of ['header', 'login'] as const) {
        const a = withJs[k]!, b = without[k]!;
        a.forEach((v, i) => expect(Math.abs(v - b[i]!), `${k} box value #${i} is within 1px with JavaScript off (${a} against ${b})`).toBeLessThanOrEqual(1));
      }
    } finally {
      await noJs.close();
    }
    // The prerendered HTML for `/` already carries the link inside <head>.
    if (test.info().project.name === 'desktop-1280') {
      test.setTimeout(20 * 60_000);
      const html = productionBuild().indexHtml;
      const head = /<head[\s>][\s\S]*?<\/head>/i.exec(html)?.[0] ?? '';
      expect(head, 'the prerendered / has a <head>').not.toBe('');
      expect(linkedStyles(head).filter(isSiteCss), 'the prerendered <head> has exactly one link to site.css').toHaveLength(1);
      expect(linkedStyles(html).filter(isSiteCss), 'and the whole page has only that one').toHaveLength(1);
    }
  });

  // ---------------------------------------------------------------- AC-5
  test('AC-5 site parts are never unstyled: wherever a pp-site class is on the page, site.css is loaded and the header is sticky; / to "Log in" to back leaves one link', async ({ page, signIn }) => {
    const routes = ['/', '/nothing-here', '/dev/site'];
    const appRoutes = read(join(PEPLA_WEB, 'src', 'app', 'app.routes.ts'));
    if (/dev\/site-landing'/.test(appRoutes)) routes.push('/dev/site-landing');
    // The separate whole-landing dev page shows site parts too, so it must ask for the styles as well.
    if (/dev\/site-landing-page'/.test(appRoutes)) routes.push('/dev/site-landing-page');
    // At the first frame that shows a site part, site.css must already be loaded: a link added by script is not render-blocking,
    // so a part that renders first shows unstyled and measures wrong (SITE-02's header example fails that way on /dev/site).
    await page.addInitScript(() => {
      const w = window as unknown as { __siteFirst?: { loaded: boolean } };
      const isSite = (h: string | null) => !!h && /(^|\/)site\.css(\?|#|$)/.test(h);
      let waiting = false;
      // Read at the first frame after a site part exists: a stylesheet in the page's own HTML blocks that frame until it has loaded, one added later does not.
      const look = () => {
        if (waiting || w.__siteFirst || !document.querySelector('[class*="pp-site-"]')) return;
        waiting = true;
        requestAnimationFrame(() => {
          let loaded = false;
          try { loaded = [...document.styleSheets].some((s) => isSite(s.href) && s.cssRules.length > 0); } catch { loaded = false; }
          w.__siteFirst = { loaded };
        });
      };
      new MutationObserver(look).observe(document, { childList: true, subtree: true });
    });
    for (const path of routes) {
      await page.goto(path);
      await settle(page);
      const first = await page.evaluate(() => (window as unknown as { __siteFirst?: { loaded: boolean } }).__siteFirst);
      expect(first, `${path}: a site part reached the page`).toBeDefined();
      expect(first?.loaded, `${path}: site.css was already loaded at the first frame that shows a site part (not added after it)`).toBe(true);
      const s = await siteStyleState(page);
      expect(s.siteElements, `${path} shows site parts`).toBeGreaterThan(0);
      expect(s.sheets, `${path}: site.css is among the page's stylesheets`).toBe(1);
      expect(s.loaded, `${path}: site.css has loaded (its rules are readable)`).toBe(true);
      if (s.headerPosition !== null) expect(s.headerPosition, `${path}: the header is sticky, as in the kit`).toBe('sticky');
    }
    await page.goto('/');
    await settle(page);
    await page.getByRole('link', { name: 'Log in', exact: true }).filter({ visible: true }).first().click().catch(async () => {
      await page.getByRole('button', { name: /open menu/i }).click();
      await page.getByRole('link', { name: 'Log in', exact: true }).filter({ visible: true }).first().click();
    });
    await expect(signIn.heading).toBeVisible({ timeout: 20_000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await settle(page);
    const back = await siteStyleState(page);
    expect(back.links, 'back on /: one link to site.css, never two').toBe(1);
    expect(back.headerPosition, 'back on /: the header is still sticky').toBe('sticky');
  });

  // ---------------------------------------------------------------- AC-6
  test('AC-6 nothing else changes: no locked SITE-01 or SITE-02 support file is edited, and no file changes outside the split\'s own', async () => {
    once('it reads the repository once');
    test.setTimeout(3 * 60_000);
    const changed = changedFiles();
    // A pull request of another card, with none of this card's files, has nothing to judge here.
    const mine = changed.some((f) => /^src\/styles\/design-system\/(site|platform)\.css$/.test(f) || /^e2e\/acceptance\/(site-07\.spec\.ts|support\/site-07\/|cards\/site-07\.md)/.test(f));
    test.skip(!mine, 'this pull request changes none of the split\'s files');
    const allowed = (f: string) =>
      f === 'angular.json' || f === 'src/styles.css' || f === 'README.md' ||
      /^src\/styles\/design-system\//.test(f) || f === 'src/app/ds/core/icon.registry.ts' ||
      /^scripts\/(design-system-sync\.mjs|verify-design\.mjs|verify-design\.test\.mjs)$/.test(f) ||
      /^src\/app\/ds\/site\//.test(f) || /^src\/app\/features\/public\//.test(f) ||
      /^src\/app\/(app\.routes|app\.routes\.server|site\.routes)\.ts$/.test(f) ||
      /^e2e\/acceptance\/(site-07\.spec\.ts|site-01\.spec\.ts|site-03\.spec\.ts|site-04\.spec\.ts|cards\/site-07\.md)$/.test(f) || /^e2e\/acceptance\/support\/site-07\//.test(f) || f === 'e2e/acceptance/support/site-08/files.ts' ||
      /^e2e\/parity\//.test(f);
    expect(changed.filter((f) => !allowed(f)), 'this card changes only the split\'s own files').toEqual([]);
    expect(changed.filter((f) => /^e2e\/acceptance\/(site-02\.spec\.ts|support\/site-02\/|support\/site-01\/)/.test(f)), 'no locked SITE-01 or SITE-02 support file is edited').toEqual([]);
    expect(changed.filter((f) => /^src\/app\/(core|features\/(hr|employee|start|sign-in))\//.test(f) || f === 'src/app/ds/all.ts'), 'no signed-in code changes').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-7
  test('AC-7 no "pepla": the build runs verify-public-names after it and passes, and nothing this card adds to the output has the old name', async () => {
    once('it reads the build once');
    test.setTimeout(20 * 60_000);
    const build = productionBuild();
    const pkg = JSON.parse(read(join(PEPLA_WEB, 'package.json'))) as { scripts: Record<string, string> };
    expect(pkg.scripts['postbuild'], 'postbuild still runs verify-public-names').toMatch(/verify-public-names/);
    expect(pkg.scripts['build'], 'build is still ng build, with verify:design in front').toBe('ng build');
    expect(pkg.scripts['prebuild'], 'prebuild still runs verify:design').toMatch(/verify:design/);
    const names = walk(BROWSER_OUT).map((f) => rel(BROWSER_OUT, f));
    expect(names.filter((n) => /pepla/i.test(n)), 'no output file or folder name holds "pepla"').toEqual([]);
    expect(names.filter((n) => /(^|\/)(site|platform)\.css$/.test(n)).length, 'site.css is in the output').toBeGreaterThan(0);
    expect(build.indexHtml, 'the prerendered / holds no "pepla"').not.toMatch(/pepla/i);
    const siteCss = read(join(BROWSER_OUT, 'site.css'));
    expect(siteCss.match(/url\(([^)]*)\)/g)?.filter((u) => /pepla/i.test(u)) ?? [], 'no url() in site.css names "pepla"').toEqual([]);
    const links = linkedStyles(build.indexHtml).filter((h) => /pepla/i.test(h));
    expect(links, 'no stylesheet link holds "pepla"').toEqual([]);
  });
});
