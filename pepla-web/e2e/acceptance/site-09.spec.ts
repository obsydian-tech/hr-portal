import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { COGNITO, SIGNED_IN_MARKERS, apiPatterns, logIn, pathOf } from './support/site-01/public-site';
import { deviceOf, sleep } from './support/site-08/kit';
import { checkMotion, checkPageParity, checkPageWords, checkSections, checkSubmenu, checkTop, type Env } from './support/site-08/learn-page';
import { BANNED, DEMOS, KIT_REF, ROUTE, TABS, TAB_IDS, axeStates, bannedIn, boardFlight, checkDemo, checkHeroCard, compareRegion, expectSame, headingTexts, kitHeadings, openPair, openRecruitment, orderFacts, recruitmentSpec, reducedDemos, restoreKitRef, sectionFacts, sidewaysScroll, stillDemos, useKitRef, using, visibleUnderBars, wholePageWords, OMIT } from './support/site-09/page';
import { builtSite, htmlText, prerenderedFile, readText, serveStatic, stop } from './support/site-09/build';
import { allowed, changedFiles, isThisCard, outside, refused, stripComments } from './support/site-09/files';

/**
 * SITE-09 · Learn more page: Recruitment (Jira NH-214, epic NH-202). One test per acceptance criterion, written from the card before the code.
 * Spec: /mnt/project-files/onboarding-cards/specs/SITE-09.md. Notes: ./cards/site-09.md. No backend.
 *
 * The page is `/product/recruitment`. It is judged against the design system kit screen "Recruitment page" (markup and preview scripts at KIT_REF,
 * see support/site-09/page.ts), through the SITE-08 page helper (support/site-08/learn-page.ts, imported and never edited) and the checks that are this page's own.
 * Each test runs at 1280 and 390 wide (AC-3 at 1440 and 390); the build is read once per run. Run with `E2E_BASE_URL` pointing at a running `ng serve`.
 */

const once = (why: string) => test.skip(test.info().project.name === 'phone-390', `Runs once, in desktop-1280: ${why}`);
/** Iggie, 18 Nov: the tab title is the page name from the kit's breadcrumb, then a middle dot, then the brand. */
const TITLE = 'Recruitment · Naleko People';

// Both pages are drawn the same way on every machine: no sub-pixel (LCD) text and no font hinting (SITE-02 AC-2).
test.use({ launchOptions: { args: ['--disable-lcd-text', '--font-render-hinting=none'] } });
test.beforeAll(() => { useKitRef(); });
test.afterAll(() => { restoreKitRef(); });

const envOf = (page: Page, browser: Env['browser'], baseURL: string | undefined): Env => ({ browser, baseURL: baseURL!, page });

test.describe('SITE-09 Learn more page: Recruitment', () => {
  test.beforeEach(async ({ page }) => { if (deviceOf(page) === 'desktop') await page.setViewportSize({ width: 1280, height: 900 }); });

  // ---------------------------------------------------------------- AC-1
  test('AC-1 the page is public and prerendered: 200 with no redirect, the title, no Cognito or API, site.css once, the build holds the page for JavaScript off; the other routes behave as before', async ({ page, browser, request, baseURL, signIn }) => {
    test.setTimeout(25 * 60_000);
    const env = envOf(page, browser, baseURL);
    const spec = recruitmentSpec(deviceOf(page));
    const res = await request.get(ROUTE, { maxRedirects: 0 });
    expect(res.status(), `GET ${ROUTE} answers 200`).toBe(200);
    expect(new URL(res.url()).pathname, `GET ${ROUTE} is not redirected`).toBe(ROUTE);

    // A signed-out browser opens the page. Cognito and our APIs are refused so nothing leaves the machine; the request is still seen.
    const apis = apiPatterns();
    const requests: string[] = [];
    const scripts: Array<Promise<{ url: string; text: string }>> = [];
    await page.context().route((u) => COGNITO.test(u.href) || apis.some((r) => r.test(u.href)), (route) => route.abort('blockedbyclient'));
    page.context().on('request', (r) => requests.push(r.url()));
    page.context().on('response', (r) => {
      const js = /javascript|ecmascript/.test(r.headers()['content-type'] ?? '') || /\.m?js(\?|$)/.test(new URL(r.url()).pathname);
      if (r.request().resourceType() === 'script' || js) scripts.push(r.text().then((text) => ({ url: r.url(), text }), () => ({ url: r.url(), text: '' })));
    });
    await openRecruitment(page);
    await page.waitForLoadState('networkidle');
    // openRecruitment leaves a 4s default on the page (the SITE-08 helper's stage-width probe must fail fast). Here the same page goes on to load `/` and `/nothing-here`
    // and the sign-in page, whose lazy chunks can take longer than 4s on a busy machine (lock check T1: `page.goto` timed out at 4000ms on a correct build).
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(30_000);
    expect(pathOf(page), `${ROUTE} stays where it is, no redirect`).toBe(ROUTE);
    await expect(page, 'the tab title').toHaveTitle(TITLE);
    expect(await page.title(), 'document.title').toBe(TITLE);
    expect(await page.locator('h1').count(), 'one h1').toBe(1);
    expect(requests.filter((u) => COGNITO.test(u)), 'no request to a Cognito host').toEqual([]);
    expect(requests.filter((u) => apis.some((r) => r.test(u))), 'no request to the employees or document APIs').toEqual([]);
    expect(requests.filter((u) => /(^|\/)site\.css(\?|#|$)/.test(new URL(u).pathname)), 'site.css is requested once').toHaveLength(1);
    expect(await page.evaluate(() => Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter((l) => /(^|\/)site\.css(\?|#|$)/.test(new URL((l as HTMLLinkElement).href).pathname)).length), 'one link to site.css').toBe(1);
    const loaded = await Promise.all(scripts);
    expect(loaded.length, 'the page loaded its scripts').toBeGreaterThan(0);
    const carriers = loaded.flatMap((s) => SIGNED_IN_MARKERS.filter((m) => m !== 'Privacy notice' /* the footer's legal links use these words */).filter((m) => s.text.includes(m)).map((m) => `${new URL(s.url).pathname} holds "${m}"`));
    expect(carriers, 'no script that the page loads holds a signed-in feature marker').toEqual([]);

    // The other public routes behave as before.
    for (const path of ['/', '/nothing-here']) {
      await page.goto(path);
      await expect(logIn(page), `${path} shows the link "Log in"`).toBeVisible({ timeout: 20_000 });
      expect(pathOf(page), `${path} stays where it is`).toBe(path);
      expect(await page.locator('.pp-site-form-page--learn').count(), `${path} is not the Recruitment page`).toBe(0);
    }
    await signIn.open();
    await expect(signIn.heading, '/sign-in opens').toBeVisible();

    // The production build holds the page: header, one main, the h1 words and every section heading, readable with JavaScript off.
    const out = builtSite();
    const file = prerenderedFile(out.dir);
    expect(file, 'the build output holds product/recruitment/index.html (or product/recruitment.html)').toBeTruthy();
    const html = readText(file!);
    expect(html, 'the prerendered page has the tab title').toMatch(new RegExp('<title>\\s*' + TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*</title>'));
    expect(html, 'the prerendered page holds the header').toMatch(/<header[\s>]/);
    expect((html.match(/<main[\s>]/g) ?? []).length, 'the prerendered page holds one main').toBe(1);
    const words = htmlText(html);
    const heads = await kitHeadings(env, spec);
    expect(heads.length, 'the kit page has headings').toBeGreaterThan(8);
    expect(heads.filter((h) => !words.includes(h)), 'the prerendered HTML holds the h1 words and every section heading of the kit page').toEqual([]);
    const { server, origin } = await serveStatic(out.dir);
    const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: page.viewportSize() });
    try {
      const p = await noJs.newPage();
      const r = await p.goto(`${origin}${ROUTE}`);
      expect(r?.status(), `JavaScript off: ${ROUTE} is served as a file of the build (200)`).toBe(200);
      await expect(p.locator('header').first(), 'JavaScript off: the header is there').toBeVisible();
      await expect(p.locator('main'), 'JavaScript off: one main').toHaveCount(1);
      await expect(p.locator('h1'), 'JavaScript off: one h1').toHaveCount(1);
      const seen = await p.evaluate(headingTexts, 'body');
      expect(heads.filter((h) => !seen.includes(h)), 'JavaScript off: the h1 words and every section heading are there').toEqual([]);
    } finally { await noJs.close(); await stop(server); }
    void env;
  });

  // ---------------------------------------------------------------- AC-2
  test('AC-2 every word is the kit\'s, both ways: the page and the kit screen have the same text nodes and accessible names; no lorem, placeholder, Masked, Claude or pepla anywhere', async ({ page, browser, baseURL }) => {
    test.setTimeout(8 * 60_000);
    const env = envOf(page, browser, baseURL);
    const spec = recruitmentSpec(deviceOf(page));
    await checkPageWords(env, spec);
    await using(openPair(env, spec, 'frozen', { keepOmit: true }), async (p) => {
      const w = await wholePageWords(p);
      expect(w.app.texts.length, 'the page has text').toBeGreaterThan(80);
      expect(w.app.texts.filter((t) => !w.kit.texts.includes(t)), 'text on the page that is not on the kit screen').toEqual([]);
      expect(w.kit.texts.filter((t) => !w.app.texts.includes(t)), 'text on the kit screen that is not on the page').toEqual([]);
      expect(w.app.names.filter((t) => !w.kit.names.includes(t)), 'accessible names on the page that are not on the kit screen').toEqual([]);
      expect(w.kit.names.filter((t) => !w.app.names.includes(t)), 'accessible names on the kit screen that are not on the page').toEqual([]);
      expect(await bannedIn(p.app), 'no lorem, placeholder, "Masked", "Claude" or "pepla" in text, attribute, class, href or the title').toEqual([]);
      expect(await p.app.title(), 'the tab title').toBe(TITLE);
    });
    // The prerendered file too: title, attributes and text.
    if (deviceOf(page) === 'desktop') {
      const file = prerenderedFile(builtSite().dir);
      expect(file, 'the build holds the prerendered page').toBeTruthy();
      const html = readText(file!).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, '');
      expect(html.match(BANNED) ?? [], 'no lorem, placeholder, "Masked", "Claude" or "pepla" in the prerendered page').toEqual([]);
    }
  });

  // ---------------------------------------------------------------- AC-3
  test('AC-3 parity with the kit page: the whole page and the footer, motion frozen, demos on their first step: every box within 1px, at most 1% of pixels differ', async ({ page, browser, baseURL }) => {
    test.setTimeout(10 * 60_000);
    const d = deviceOf(page);
    if (d === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
    const env = envOf(page, browser, baseURL);
    const spec = recruitmentSpec(d);
    await checkPageParity(env, spec);
    await using(openPair(env, spec, 'frozen'), (p) => compareRegion(p, `${spec.name}, whole page`, '[data-s9-root]', '[data-s9-root]', { skip: OMIT, hide: OMIT, skipRoot: true }));
    await using(openPair(env, spec, 'frozen', { keepOmit: true }), (p) => compareRegion(p, `${spec.name}, footer`, 'footer.pp-site-footer', 'footer.pp-site-footer'));
  });

  // ---------------------------------------------------------------- AC-4
  test('AC-4 page top and hero card: breadcrumb, h1 with its shine line, lead, buttons, pills and rings as the kit; the hero card loops as the kit does, every step within 250ms, without a jump, last step under data-site-still', async ({ page, browser, baseURL }) => {
    test.setTimeout(8 * 60_000);
    const env = envOf(page, browser, baseURL);
    const spec = recruitmentSpec(deviceOf(page));
    await checkTop(env, spec);
    await checkHeroCard(env, spec);
  });

  // ---------------------------------------------------------------- AC-5
  test('AC-5 sub-menu and sections: six tabs in order, each scrolls to its section, scrolling sets the current tab; the ids are as listed; the ending, closing band and footer follow in the kit\'s order', async ({ page, browser, baseURL }) => {
    test.setTimeout(10 * 60_000);
    const env = envOf(page, browser, baseURL);
    const spec = recruitmentSpec(deviceOf(page));
    // Demos stay on their first step (a view that never reports): the tap check below scrolls smoothly past all five, and a page busy playing them can start the scroll late.
    await checkSubmenu(env, spec, { deaf: true });
    await checkSections(env, spec);
    await using(openPair(env, spec, 'frozen', { keepOmit: true }), async ({ app, kit }) => {
      const tabs = await app.evaluate(() => Array.from(document.querySelectorAll('nav[aria-label="On this page"] .pp-site-subnav__link')).map((a) => `${(a.textContent ?? '').trim()}>${a.getAttribute('href')}`));
      expect(tabs, 'the tabs, in order, each pointing at its section').toEqual(TABS.map((t, i) => `${t}>#${TAB_IDS[i]}`));
      const facts = await app.evaluate(sectionFacts, [...TAB_IDS, 'demo']);
      expect(facts.filter((f) => f.count !== 1), 'each section id is on the page once, exactly as listed').toEqual([]);
      expect(facts.filter((f) => !f.named || !f.name), 'each section is named by a heading inside it').toEqual([]);
      expect(facts.map((f) => f.id), 'the section ids').toEqual([...TAB_IDS, 'demo']);
      expect(facts.at(-1)!.tag, 'the closing band #demo is a section').toBe('section');
      const appOrder = await app.evaluate(orderFacts), kitOrder = await kit.evaluate(orderFacts);
      expect(appOrder.map((o) => o.replace(/#.*$/, '')), 'page top, sub-menu, five demos, Ask Batsi, strip, related, questions, closing band, footer follow in the kit\'s order').toEqual(kitOrder.map((o) => o.replace(/#.*$/, '')));
      expect(appOrder.filter((o) => /#/.test(o) && o.split('#')[1]).map((o) => o.split('#')[1]), 'the ids of the sections in that order').toEqual(kitOrder.filter((o) => o.split('#')[1]).map((o) => o.split('#')[1]));
    });
  });

  // ---------------------------------------------------------------- AC-6 to AC-10
  // The shape of a hiring board, as laid out: the words and the list side by side from 1024, the board below them at full width (stacked on a phone).
  const boardLayout = (p: Page) => p.evaluate(() => {
    const head = document.querySelector('[id="hiring-board"] .pp-site-demo__head')!.getBoundingClientRect();
    const text = document.querySelector('[id="hiring-board"] .pp-site-demo__text')!.getBoundingClientRect();
    const list = document.querySelector('[id="hiring-board"] .pp-site-demo__list')!.getBoundingClientRect();
    const wide = document.querySelector('[id="hiring-board"] .pp-site-demo__wide')!.getBoundingClientRect();
    return { side: list.left >= text.right - 1 && Math.abs(list.top - text.top) < 120, stacked: list.top >= text.bottom - 1, below: wide.top >= head.bottom - 1, full: Math.abs(wide.width - head.width) <= 2 };
  });
  const sec = (id: string) => `[id="${id}"]`;
  const onTexts = (p: Page, id: string) => p.evaluate((s) => Array.from(document.querySelectorAll(`${s} .pp-site-state__item--on`)).map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()), sec(id));
  const count = (p: Page, css: string) => p.evaluate((c) => document.querySelectorAll(c).length, css);

  const demoTest: Record<string, (p: Page, device: string) => Promise<void>> = {
    board: async (p, device) => {
      const cols = await p.evaluate(() => Array.from(document.querySelectorAll('[id="hiring-board"] .pp-site-board__col')).map((c) => ({ name: (c.querySelector('.pp-site-board__head')?.firstChild?.textContent ?? '').trim(), n: (c.querySelector('.pp-site-board__count')?.textContent ?? '').trim(), cards: c.querySelectorAll('.pp-site-board__card').length })));
      expect(cols.map((c) => c.name), 'six stage columns').toEqual(['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Not hired']);
      expect(cols.map((c) => c.n), 'the counts follow the three moves').toEqual(['2', '0', '3', '0', '1', '2']);
      expect(cols.map((c) => String(c.cards)), 'the count of each column is the number of its cards').toEqual(cols.map((c) => c.n));
      const why = await p.evaluate(() => Array.from(document.querySelectorAll('[id="hiring-board"] .pp-site-board__card--moved')).map((c) => `${c.querySelector('.pp-site-board__name')?.textContent}: ${(c.querySelector('.pp-site-board__why')?.textContent ?? '').trim()}`));
      expect(why, 'three candidates moved, a reason each').toEqual(['Candidate 4: Moved by Jane Smith', 'Candidate 1: Offer signed', 'Candidate 5: Reason: another candidate selected']);
      expect(await p.evaluate(() => document.querySelector('[id="hiring-board"] .pp-site-board__log')?.textContent?.trim()), 'a line says what was logged').toMatch(/^Logged: .*Candidate 5.*Not hired/);
      expect(await count(p, '[id="hiring-board"] .pp-site-board__log--in'), 'the log line shows').toBe(1);
      expect(await p.evaluate(() => document.querySelector('[id="hiring-board"]')!.textContent), 'the board is for a Sales Consultant role').toContain('Sales Consultant');
      const lay = await boardLayout(p);
      if (device === 'desktop') { expect(lay.side, 'the words and the list sit side by side').toBe(true); } else { expect(lay.stacked, 'on a phone the list sits under the words').toBe(true); }
      expect(lay.below, 'the board sits below the words and the list').toBe(true);
      expect(lay.full, 'the board is as wide as the words and the list together').toBe(true);
    },
    score: async (p) => {
      expect(await count(p, '[id="panels"] .pp-site-score__v'), 'the scorecard has its scores').toBeGreaterThanOrEqual(12);
      expect(await count(p, '[id="panels"] .pp-site-score__v:not(.pp-site-score__v--in)'), 'every score has arrived, panel by panel').toBe(0);
      expect(await count(p, '[id="panels"] .pp-site-score__decide--done'), 'Jane Smith has moved the candidate').toBe(1);
      expect((await onTexts(p, 'panels')).join(' | '), 'the candidate is shown moved to Offer').toContain('Moved to Offer');
      expect(await p.evaluate(() => document.querySelector('[id="panels"]')!.textContent), 'the averages and the person who decides').toMatch(/Average[\s\S]*4\.4[\s\S]*Jane Smith decides/);
    },
    follow: async (p) => {
      expect(await count(p, '[id="follow-ups"] .pp-site-timeline__item'), 'five timeline items').toBe(5);
      expect(await count(p, '[id="follow-ups"] .pp-site-timeline__item:not(.pp-site-step--in)'), 'every timeline item has arrived').toBe(0);
      expect(await count(p, '[id="follow-ups"] .pp-site-suggest.pp-site-step--in'), 'the reminder is drafted for a candidate who has gone quiet').toBe(1);
      expect((await onTexts(p, 'follow-ups')).join(' | '), 'the candidate shows as reminded').toContain('Reminder sent');
      expect(Number(await p.evaluate(() => (document.querySelector('[id="follow-ups"] .pp-site-timeline__fill') as HTMLElement).style.getPropertyValue('--_fill'))), 'the line has filled').toBeGreaterThan(0.5);
    },
    risk: async (p) => {
      expect(await count(p, '[id="risk"] .pp-site-risk__item.pp-site-step--in'), 'three flags have arrived').toBe(3);
      expect(await count(p, '[id="risk"] .pp-site-suggest.pp-site-step--in'), 'Batsi suggests').toBe(1);
      expect(await count(p, '[id="risk"] [data-offer].pp-site-risk__item--fix'), 'the expiring offer is signed').toBe(1);
      const on = (await onTexts(p, 'risk')).join(' | ');
      expect(on, 'the offer shows Signed').toContain('Signed');
      expect(on, 'the count drops to 2 flagged').toContain('2 flagged');
    },
    offer: async (p) => {
      expect(await count(p, '[id="offer"] .pp-site-offer__card--live'), 'the offer and the employee record are both live').toBe(2);
      expect(await count(p, '[id="offer"] .pp-site-offer__value:not(.pp-site-offer__value--in)'), 'the details have been carried to the employee record').toBe(0);
      expect(await count(p, '[id="offer"] .pp-site-suggest.pp-site-step--in'), 'onboarding opens and HR is told').toBe(1);
      expect((await onTexts(p, 'offer')).join(' | '), 'the offer is signed and the employee record created').toMatch(/Signed[\s\S]*(Created|Active)|(Created|Active)[\s\S]*Signed/);
    },
  };
  const hand = { score: { at: 3_000, sel: '.pp-site-score__decide .pp-button--primary', ms: 5_000, label: 'Move to Offer by hand' } } as const;

  for (const d of DEMOS) {
    test(`AC-${d.ac} ${d.id}: words and list, the visible states in the kit script's sequence each within 250ms, starts once in view, Play again replays from the first step, first and last step match the kit's markup`, async ({ page, browser, baseURL }) => {
      test.setTimeout(8 * 60_000);
      const env = envOf(page, browser, baseURL);
      const spec = recruitmentSpec(deviceOf(page));
      const byHand = (hand as Record<string, { at: number; sel: string; ms: number; label: string } | undefined>)[d.key];
      await checkDemo(env, spec, d, { byHand, after: (app) => demoTest[d.key]!(app, deviceOf(page)) });
    });
  }

  // ---------------------------------------------------------------- AC-11
  test('AC-11 motion, phone, accessibility: the SITE-08 motion rules hold on the page, the board flight stops under reduced motion while the demos keep their timings; at 390 nothing is under the header or sub-menu and nothing scrolls sideways; axe finds nothing with each demo on its first and last step and one question open; one h1', async ({ page, browser, baseURL }) => {
    test.setTimeout(15 * 60_000);
    const d = deviceOf(page);
    const env = envOf(page, browser, baseURL);
    const spec = recruitmentSpec(d);
    // The phone header's menu button (the shared site header, not this page) changes its colour with a transition when the header changes state, from the first paint;
    // SITE-08's colour allowance names `pp-button` first and the burger's first class is its own, so the helper counts it. It is switched off in this one check, in the
    // page's open step: this card does not own the header. (Raised in the notes: the helper's allowance should take the burger.)
    const noBurgerFade = recruitmentSpec(d, async (pg) => {
      await pg.addInitScript(() => { const add = () => { const st = document.createElement('style'); st.textContent = '.pp-site-header__burger{transition:none!important}'; (document.head ?? document.documentElement).appendChild(st); }; if (document.documentElement) add(); else document.addEventListener('readystatechange', add, { once: true }); });
      await openRecruitment(pg);
    });
    await checkMotion(env, noBurgerFade);
    // The board flight: a card slides between columns by transform in normal motion (the control: the kit flies it, and so does the page, the same three cards), and does not under reduced motion.
    const normal = await boardFlight(env, spec, false);
    expect(normal.kit.length, 'control: in normal motion the kit board flies cards (so the reduced motion check below cannot pass by seeing nothing)').toBeGreaterThan(0);
    expect([...normal.app].sort(), 'in normal motion the page flies the same cards as the kit').toEqual([...normal.kit].sort());
    // How long each flight takes is the kit's too (700ms): a flight of 5s or of 50ms is not the approved motion (lock check T5).
    for (const c of normal.kit) expect(Math.abs((normal.ms.app[c] ?? -1) - normal.ms.kit[c]!), `the flight of ${c} takes the kit's time (kit ${normal.ms.kit[c]}ms, page ${normal.ms.app[c]}ms)`).toBeLessThanOrEqual(100);
    const reduced = await boardFlight(env, spec, true);
    expect(reduced.kit, 'the kit board flies nothing under reduced motion').toEqual([]);
    expect(reduced.app, 'under reduced motion no board card flies').toEqual([]);
    expectSame('reduced motion, the hiring board still plays at the kit\'s timings', reduced.steps.app, reduced.steps.kit);
    // Every other demo too (lock check T3), and every demo under data-site-still (lock check T4).
    await reducedDemos(env, spec);
    await stillDemos(env, spec, (app, demo) => demoTest[demo.key]!(app, d));
    // No sideways scroll at either width; at 390 every heading and button is visible and not under the header or the sub-menu.
    await using(openPair(env, spec, 'frozen'), async ({ app }) => {
      const s = await sidewaysScroll(app);
      expect(s.doc, 'the page has no sideways scroll').toBeLessThanOrEqual(0);
      expect(s.body, 'the body has no sideways scroll').toBeLessThanOrEqual(0);
      expect(await app.locator('h1').count(), 'one h1').toBe(1);
      if (d === 'phone') expect(await visibleUnderBars(app), 'every heading and button is visible and not under the header or the sub-menu').toEqual([]);
    });
    const ax = await axeStates(env, spec);
    expect(ax.first, 'axe (wcag2a, wcag2aa) finds no violation with every demo on its first step and one question open').toEqual([]);
    expect(ax.open, 'one question is open').toBe(1);
    expect(ax.last, 'axe (wcag2a, wcag2aa) finds no violation with every demo on its last step and one question open').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-12
  test('AC-12 nothing else changes: only the site, the public pages, the two route files and the site tests; /sign-in and /hr load no site code; verify-public-names passes on the build', async ({ page, signIn, hr }) => {
    once('reads the repository, the build and the pages once');
    test.setTimeout(20 * 60_000);
    // The rule itself, on tables: what a builder's pull request may change, and what is always refused.
    const builder = ['src/app/ds/site/learn/recruitment/page.ts', 'src/app/ds/site/learn/recruitment/hiring-board.ts', 'src/app/ds/site/learn/content/recruitment.ts', 'src/app/ds/site/learn/recruitment/recruitment.spec.ts', 'src/app/features/public/recruitment-page.ts', 'src/app/site.routes.ts', 'src/app/app.routes.server.ts', 'e2e/acceptance/site-09.spec.ts', 'e2e/acceptance/support/site-09/page.ts', 'e2e/acceptance/cards/site-09.md', 'e2e/acceptance/site-10.spec.ts'];
    expect(outside(builder), 'the rule accepts a plausible builder file set').toEqual([]);
    const never = ['src/app/ds/all.ts', 'src/app/features/hr/hr-shell.ts', 'src/app/features/sign-in/sign-in.ts', 'src/app/core/auth.ts', 'src/app/app.routes.ts', 'src/app/ds/README.md', 'src/app/ds/site/../../core/auth.ts', 'src/app/site.routes.tsx', 'package.json', 'angular.json', 'src/styles.css', 'src/styles/design-system/site.css', 'scripts/verify-public-names.mjs', 'e2e/acceptance/onb-09.spec.ts', 'e2e/acceptance/.output/.last-run.json', 'e2e/acceptance/support/site-09', 'e2e/acceptance/site-9.spec.ts', 'e2e/acceptance/site-009.spec.ts', 'e2e/acceptance/cards/site-09.md.bak', 'src/app/features/publicity/x.ts'];
    expect(outside(never).length, 'the rule refuses every path of the must-reject table').toBe(never.length);
    expect(never.filter((f) => allowed(f) && !refused(f) && !/\.\./.test(f)), 'none of them is in the allow-list unless a refusal catches it').toEqual([]);
    // The state of the repository, whatever the diff: the page is built (no skip here, so develop fails this).
    const web = join(__dirname, '..', '..');
    const dir = join(web, 'src', 'app', 'ds', 'site', 'learn', 'recruitment');
    const built = existsSync(dir) ? readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.ts$/.test(f) && !/\.spec\.ts$/.test(f)) : [];
    expect(built.length, 'src/app/ds/site/learn/recruitment/ holds at least one .ts file that is not a spec (the page is built there)').toBeGreaterThan(0);
    const routes = stripComments(readFileSync(join(web, 'src', 'app', 'site.routes.ts'), 'utf8'));
    expect(routes, 'site.routes.ts holds a lazy product/recruitment route that loads the site stylesheet').toMatch(/path:\s*'product\/recruitment'[^}]*loadComponent[^}]*canActivate:\s*\[\s*siteStyles\s*\]|path:\s*'product\/recruitment'[^}]*canActivate:\s*\[\s*siteStyles\s*\][^}]*loadComponent/);
    const server = stripComments(readFileSync(join(web, 'src', 'app', 'app.routes.server.ts'), 'utf8'));
    expect(server, 'app.routes.server.ts prerenders product/recruitment').toMatch(/path:\s*'product\/recruitment'\s*,\s*renderMode:\s*RenderMode\.Prerender/);
    // Signed-in pages load no site code.
    const loaded: Array<Promise<{ url: string; text: string }>> = [];
    page.context().on('response', (r) => {
      const js = /javascript|ecmascript/.test(r.headers()['content-type'] ?? '') || /\.m?js(\?|$)/.test(new URL(r.url()).pathname);
      if (r.request().resourceType() === 'script' || js) loaded.push(r.text().then((text) => ({ url: r.url(), text }), () => ({ url: r.url(), text: '' })));
    });
    const carriers = async (where: string) => (await Promise.all(loaded.splice(0))).filter((x) => /pp-site-|ppSite|PpSite|DemoClock/.test(x.text)).map((x) => `${where}: ${new URL(x.url).pathname}`);
    await signIn.open();
    await page.waitForLoadState('networkidle');
    expect(await carriers('/sign-in'), 'no script that /sign-in loads holds site code').toEqual([]);
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(/\/hr$/, { timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    expect(await carriers('/hr'), 'no script that /hr loads holds site code').toEqual([]);
    // verify-public-names on the build (it also ran as the postbuild step).
    const out = builtSite();
    const v = spawnSync('node', ['scripts/verify-public-names.mjs', out.dir], { cwd: web, encoding: 'utf8' });
    expect(v.status, `verify-public-names passes on the build: ${v.stdout}${v.stderr}`).toBe(0);
    expect(prerenderedFile(out.dir), 'and the build it checked holds the Recruitment page').toBeTruthy();
    // The file rule: only when this pull request changes a file of this card (another card's pull request has nothing to judge here).
    const changed = changedFiles();
    test.skip(!changed.some(isThisCard), 'this pull request changes none of the Recruitment page\'s files');
    expect(outside(changed), 'this card changes only the site, the public pages, the two route files and the site tests').toEqual([]);
    expect(changed.filter(refused), 'ds/all.ts and the signed-in features are untouched').toEqual([]);
  });
});
void sleep; void KIT_REF; void TITLE;
