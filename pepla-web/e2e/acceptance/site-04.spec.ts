import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { PEPLA_WEB, KEYS, SECTION, STILL, FREEZE_VIEW, GATED_VIEW, bodyOf, compareSection, comparePage, dsFile, deviceOf, exampleName, fromFirstChange, galleryId, gotoLanding, kitMarkup, openKit, sameTimeline, sec, settle, sleep, timeline, wordsOf, type Device, type Key, type Step } from './support/site-04/landing2';

/**
 * SITE-04 · Landing sections part 2: Compliance, Leave, Trust and POPIA, Integrations, Platform, About, the closing band, the assembled page.
 * No backend. Runs against `ng serve` through E2E_BASE_URL. See cards/site-04.md for the contract (it builds on cards/site-03.md).
 * The desktop device is read in a 1456 wide window (the stage is then the kit's 1440), the phone device at 390.
 * Both sides are driven by the same actions: the kit page (its markup and its preview scripts, at the ref in sync.json) is the oracle.
 */

const once = (why: string) => test.skip(test.info().project.name === 'phone-390', why);
const isPhone = (page: Page) => deviceOf(page) === 'phone';
const WIDE = { width: 1456, height: 900 };

const APP = (k: Key, d: Device) => `section[data-example="${exampleName(k, d)}"] [data-example-body] ${SECTION[k].app}`;
const KIT = (k: Key, d: Device) => SECTION[k].kit(d);
const ID = (k: Key, d: Device) => galleryId(k, d);

type World = { ctx: BrowserContext; app: Page; kit: Page; d: Device; a: string; k: string };

/** A fresh browser context with one Angular page (only section `k`) and one kit page, both with views gated until `fire` is called. */
async function world(browser: Browser, baseURL: string, page: Page, k: Key, extra: object = {}, gated = true): Promise<World> {
  const d = deviceOf(page);
  const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone', ...extra });
  if (gated) await ctx.addInitScript(GATED_VIEW);
  const app = await ctx.newPage();
  await gotoLanding(app, [ID(k, d)]);
  const kit = await ctx.newPage();
  await kit.setViewportSize(page.viewportSize()!);
  const w = await app.locator('.pp-site-stage').first().evaluate((el) => el.getBoundingClientRect().width);
  await openKit(kit, new URL(baseURL).origin, d, true, w);
  return { ctx, app, kit, d, a: APP(k, d), k: KIT(k, d) };
}

const fire = async (p: Page) => { await p.evaluate(() => (window as unknown as { __fireView: () => void }).__fireView()); };
/** Click the moment the element exists (no waiting for it to be stable: that wait differs from page to page and would move the timings). */
const hit = async (p: Page, css: string, timeout = 20_000): Promise<void> => { await p.locator(css).first().waitFor({ state: 'attached', timeout }); await p.locator(css).first().evaluate((el) => (el as HTMLElement).click()); };

/** A state that lasts under 45ms (one frame between a class and its text) is dropped: the order of the states that stay is what is judged. */
const settled = (steps: Step[], gap = 45): Step[] => steps.filter((s, i) => i === steps.length - 1 || steps[i + 1]!.t - s.t >= gap);

async function expectSame(label: string, app: Step[], kit: Step[], tol: number, gap = 45): Promise<void> {
  const a = settled(fromFirstChange(app), gap), k = settled(fromFirstChange(kit), gap);
  // Lock check: counted on the raw timeline (first state plus at least one change); a switch turned off makes one change only.
  expect(kit.length, `${label}: the kit page moved at all`).toBeGreaterThan(1);
  const r = sameTimeline(a, k, tol);
  // Lock check: the states are compared by their fingerprint (the hash). The text after it lists the changes since the sample before, which
  // differs when a sub-45ms state was sampled on one page only, though both pages then show the same state; it stays as the diagnostic.
  const h = (s: Step) => s.sig.split(' ')[0];
  const at = a.findIndex((s, i) => !k[i] || h(s) !== h(k[i]!));
  expect(a.map(h), `${label}: the page passes through the same states, in the same order, as the kit${at < 0 ? '' : ` (first difference at #${at}: page "${a[at]?.sig.slice(0, 200) ?? 'none'}", kit "${k[at]?.sig.slice(0, 200) ?? 'none'}")`}`).toEqual(k.map(h));
  expect(r.late, `${label}: each state shows within ${tol}ms of when the kit shows it`).toEqual([]);
}

type Act = (p: Page, scope: string, isKit: boolean) => Promise<void>;
/**
 * Both pages are watched for `ms` at the same moment; 100ms in, the views are fired and `act` runs on each, with the same actions.
 * `skip` is a selector of live typing, left out of the states.
 */
async function both(w: World, ms: number, act?: Act, skip = '', start = true): Promise<{ app: Step[]; kit: Step[] }> {
  const go = async (p: Page, scope: string, isKit: boolean) => {
    const rec = timeline(p, scope, ms, skip);
    await sleep(100);
    if (start) await fire(p);
    if (act) await act(p, scope, isKit);
    return rec;
  };
  const [app, kit] = await Promise.all([go(w.app, w.a, false), go(w.kit, w.k, true)]);
  return { app, kit };
}

// Both pages are drawn the same way on every machine: no sub-pixel (LCD) text and no font hinting (the lesson of SITE-02 AC-2).
test.use({ launchOptions: { args: ['--disable-lcd-text', '--font-render-hinting=none'] } });

// Lock check: 500ms (650 for Integrations) was 5 to 7 times the largest page/kit gap measured over both widths (96ms), so a demo
// retimed by 300ms passed. 250ms is still 2.6 times that gap.
const TOL = 250;

test.describe('SITE-04 Landing sections, part 2, and the assembled page', () => {
  test.beforeEach(async ({ page }) => {
    if (!isPhone(page)) await page.setViewportSize(WIDE);
  });

  // ---------------------------------------------------------------- AC-1
  test('AC-1 one gallery section per landing section, with the kit words and none of the old names; the closing band has the kit words', async ({ page, context, baseURL }) => {
    test.setTimeout(180_000);
    const d = deviceOf(page);
    await context.addInitScript(FREEZE_VIEW);
    await gotoLanding(page);
    const names = await page.locator('section[data-example]').evaluateAll((all) => all.map((s) => (s as HTMLElement).dataset['example']!));
    const mine = KEYS.map((k) => exampleName(k, d));
    const idx = mine.map((n) => names.indexOf(n));
    expect(idx.filter((i) => i < 0), `/dev/site-landing has a section for each of ${mine.join(', ')}`).toEqual([]);
    expect([...idx].sort((a, b) => a - b), 'the sections come in the kit order').toEqual(idx);
    for (const k of KEYS) {
      const s = sec(page, k, d);
      await expect(s.locator('h2').first(), `${k}: the section's own h2 names it`).toHaveText(exampleName(k, d));
      await expect(s, `${k}: id`).toHaveAttribute('id', galleryId(k, d));
      expect(await s.locator('[data-example-body]').count(), `${k}: one body`).toBe(1);
    }
    const kitPage = await context.newPage();
    try {
      await kitPage.setViewportSize(page.viewportSize()!);
      const stageW = await page.locator('.pp-site-stage').first().evaluate((el) => el.getBoundingClientRect().width);
      await openKit(kitPage, new URL(page.url()).origin, d, false, stageW);
      for (const k of KEYS) {
        const kit = await kitPage.evaluate(wordsOf, [KIT(k, d), ''] as [string, string]);
        const app = await page.evaluate(wordsOf, [APP(k, d), ''] as [string, string]);
        expect(app.texts, `${k}: the words on the page are the kit's words`).toEqual(kit.texts);
        expect(app.names, `${k}: the accessible names are the kit's names`).toEqual(kit.names);
        const all = [...app.texts, ...app.names].join(' | ');
        expect(all, `${k}: no "Masked"`).not.toMatch(/masked/i);
        expect(all, `${k}: no "pepla"`).not.toMatch(/pepla/i);
      }
      // The closing band lives on the landing route: its words are the kit's (#demo-d / #demo-p).
      const kitBand = await kitPage.evaluate(wordsOf, [`#demo-${d === 'desktop' ? 'd' : 'p'}`, ''] as [string, string]);
      const route = await context.newPage();
      await route.setViewportSize(page.viewportSize()!);
      await route.goto(new URL('/', baseURL!).toString());
      await route.waitForLoadState('networkidle');
      const band = await route.evaluate(wordsOf, ['section#demo', ''] as [string, string]);
      expect(band.texts, 'the closing band shows the kit words').toEqual(kitBand.texts);
      expect(band.names, 'and the kit names').toEqual(kitBand.names);
      await expect(route.locator('section#demo').getByRole('link', { name: 'Book a demo', exact: true })).toBeVisible();
      await expect(route.locator('section#demo').getByRole('link', { name: 'Get started', exact: true })).toBeVisible();
    } finally {
      await kitPage.close();
    }
    expect(await page.content(), 'the gallery holds no "pepla" in text, attribute, class or href').not.toMatch(/pepla/i);
  });

  // ---------------------------------------------------------------- AC-2
  test('AC-2 each section, the closing band and the whole page match the kit at their first step; the sections match again at their last step', async ({ page, browser, baseURL }) => {
    test.setTimeout(14 * 60_000);
    const d = deviceOf(page);
    const origin = new URL(baseURL!).origin;
    const stageWidth = async (p: Page) => p.locator('.pp-site-stage').first().evaluate((el) => el.getBoundingClientRect().width);
    // First step: nothing is ever "in view", so no demo starts. Last step: the demos have played to their end (the kit's own script ignores reduced
    // motion for Trust, Integrations and Platform, so both pages play for real and both are read after the end of the longest demo).
    const run = async (label: string, last: boolean) => {
      for (const k of KEYS) {
        if (last && k === 'integrations') continue; // its cycle never ends: each tab's end is judged in AC-6
        const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone' });
        try {
          await ctx.addInitScript(last ? GATED_VIEW : FREEZE_VIEW);
          const p = await ctx.newPage();
          await gotoLanding(p, [ID(k, d)]);
          const kp = await ctx.newPage();
          await kp.setViewportSize(page.viewportSize()!);
          await openKit(kp, origin, d, true, await stageWidth(p));
          if (last) { await Promise.all([fire(p), fire(kp)]); await sleep(k === 'about' ? 300 : k === 'trust' ? 12_500 : k === 'compliance' ? 14_000 : k === 'leave' ? 11_000 : 7_500); }
          await settle(kp);
          await settle(p);
          const r = await compareSection(p, kp, k, d, last ? '.pp-site-editor__code' : '');
          expect(r.kitElements, `${label} ${k}: the kit section has elements`).toBeGreaterThanOrEqual(10);
          expect(r.unmatched, `${label} ${r.name}: every kit element is on the page`).toEqual([]);
          expect(r.moved, `${label} ${r.name}: every box is within 1px`).toEqual([]);
          expect(r.pixelRatio, `${label} ${r.name}: at most 1% of pixels differ`).toBeLessThanOrEqual(0.01);
        } finally { await ctx.close(); }
      }
    };
    await run('first step', false);
    await run('last step', true);
    // The whole assembled page and the closing band against the kit's landing page, every box within 1px (pixels are judged per section above).
    const ctx = await browser.newContext({ baseURL, viewport: { width: d === 'phone' ? 390 : 1440, height: 900 }, hasTouch: d === 'phone', isMobile: d === 'phone' });
    try {
      await ctx.addInitScript(FREEZE_VIEW);
      const p = await ctx.newPage();
      await p.goto('/');
      await p.waitForLoadState('networkidle');
      await settle(p);
      const kp = await ctx.newPage();
      await kp.setViewportSize(p.viewportSize()!);
      await openKit(kp, origin, d, true, d === 'phone' ? 390 : 1440);
      await settle(kp);
      const r = await comparePage(p, kp, d);
      expect(r.unmatched, 'the page holds every item of the kit landing page').toEqual([]);
      expect(r.moved, 'every box of the page is within 1px of the kit').toEqual([]);
    } finally { await ctx.close(); }
  });

  // ---------------------------------------------------------------- AC-3
  test('AC-3 Compliance: the register counts down, reminders go out, the radar shows the overdue licence, Batsi reads the renewal, Jane Smith approves; Replay and Accept by hand work', async ({ browser, baseURL, page }) => {
    test.setTimeout(6 * 60_000);
    // The whole run, as the kit plays it.
    {
      const w = await world(browser, baseURL!, page, 'compliance');
      try {
        const r = await both(w, 14_500);
        await expectSame('Compliance, the run', r.app, r.kit, TOL);
        const last = fromFirstChange(r.app).at(-1)!;
        expect(await w.app.locator(`${w.a} .pp-site-read__decide--done`).count(), 'it ends with the renewal accepted').toBe(1);
        expect(await w.app.locator(`${w.a} .pp-site-ledger__row--renewed`).count(), 'and the licence renewed').toBe(1);
        void last;
        // Replay resets and plays the run again.
        // 6.5s: Batsi's first line shows 5.87s after the press, so a 6s window ended 30ms after it and cut it on one page only (lock check).
        const again = await both(w, 6_500, async (p, scope) => { await hit(p, `${scope} .pp-site-replay`); }, '', false);
        await expectSame('Compliance, Replay', again.app, again.kit, TOL);
      } finally { await w.ctx.close(); }
    }
    // Accept by hand, early: the read finishes at once and the licence is renewed.
    {
      const w = await world(browser, baseURL!, page, 'compliance');
      try {
        // Pressed at 6.3s, while Batsi waits for the upload: 430ms from any change on either page. (Lock check: at 1.5s the press fell within
        // 60ms of the end of a reminder pulse, so whether that pulse ended before the press was a race between the two pages.)
        const r = await both(w, 8_000, async (p, scope) => { await sleep(6300); await hit(p, `${scope} .pp-site-read__decide .pp-button`); });
        await expectSame('Compliance, Accept by hand', r.app, r.kit, TOL);
        expect(await w.app.locator(`${w.a} .pp-site-read__decide--done`).count(), 'Accept by hand finishes the decision').toBe(1);
      } finally { await w.ctx.close(); }
    }
  });

  // ---------------------------------------------------------------- AC-4
  test('AC-4 Leave: the request is typed in on the phone, the calendar marks the days, the approval card appears and is approved, the balance counts down; Replay, Submit, Approve and Decline by hand work', async ({ browser, baseURL, page }) => {
    test.setTimeout(6 * 60_000);
    {
      const w = await world(browser, baseURL!, page, 'leave');
      try {
        const r = await both(w, 11_500);
        await expectSame('Leave, the run', r.app, r.kit, TOL);
        expect(await w.app.locator(`${w.a} .pp-site-approval__decide--done`).count(), 'the run ends with the request approved').toBe(1);
        expect((await w.app.locator(`${w.a} .pp-site-balance__num`).first().innerText()).replace(/\s+/g, ' '), 'and the balance at 11 days').toContain('11 days');
        // 5.5s: the calendar marks its days 4.17s, 4.33s and 4.49s after the press, so a 4.5s window ended inside that run and cut it on one
        // page only (lock check). The next change after the last day is the suggestion, 6.1s after the press.
        const again = await both(w, 5_500, async (p, scope) => { await hit(p, `${scope} .pp-site-replay`); }, '', false);
        await expectSame('Leave, Replay', again.app, again.kit, TOL);
      } finally { await w.ctx.close(); }
    }
    // By hand: Submit, then Approve.
    {
      const w = await world(browser, baseURL!, page, 'leave');
      try {
        const r = await both(w, 5_000, async (p, scope) => { await sleep(800); await hit(p, `${scope} .pp-site-request__submit`); await sleep(1200); await hit(p, `${scope} .pp-site-approval__decide .pp-button--primary`); });
        await expectSame('Leave, Submit and Approve by hand', r.app, r.kit, TOL);
      } finally { await w.ctx.close(); }
    }
    // By hand: Submit, then Decline.
    {
      const w = await world(browser, baseURL!, page, 'leave');
      try {
        const r = await both(w, 4_000, async (p, scope) => { await sleep(800); await hit(p, `${scope} .pp-site-request__submit`); await sleep(1200); await hit(p, `${scope} .pp-site-approval__decide .pp-button--default`); });
        await expectSame('Leave, Submit and Decline by hand', r.app, r.kit, TOL);
      } finally { await w.ctx.close(); }
    }
  });

  // ---------------------------------------------------------------- AC-5
  test('AC-5 Trust and POPIA: audit lines arrive with Agent and Person tags, ID, bank and salary are hidden, Show reveals the sample value, logs a line and hides it again; Approve by hand works', async ({ browser, baseURL, page }) => {
    test.setTimeout(6 * 60_000);
    {
      const w = await world(browser, baseURL!, page, 'trust');
      try {
        const r = await both(w, 13_000);
        await expectSame('Trust, the run', r.app, r.kit, TOL);
        const tags = await w.app.locator(`${w.a} .pp-site-audit__row`).evaluateAll((rows) => rows.map((x) => (x.textContent ?? '').replace(/\s+/g, ' ')));
        expect(tags.filter((t) => /Agent/.test(t)).length, 'audit lines carry the Agent tag').toBeGreaterThan(0);
        expect(tags.filter((t) => /Person/.test(t)).length, 'and the Person tag').toBeGreaterThan(0);
        const hidden = await w.app.locator(`${w.a} .pp-site-hidden`).evaluate((el) => (el.textContent ?? '').replace(/\s+/g, ' '));
        expect(hidden, 'ID, bank and salary are listed').toMatch(/ID/);
        expect(hidden).toMatch(/[Bb]ank/);
        expect(hidden).toMatch(/[Ss]alary/);
        expect(hidden, 'and they are hidden again at the end').toContain('Hidden again.');
        // Show by hand, after the run: the value shows, a line is logged, and it hides again as the kit hides it.
        const show = await both(w, 5_000, async (p, scope) => { await hit(p, `${scope} .pp-site-hidden .pp-button`); }, '', false);
        await expectSame('Trust, Show by hand', show.app, show.kit, TOL);
        const logged = await w.app.locator(`${w.a} .pp-site-audit__row`).count();
        expect(logged, 'each Show is logged as one more line').toBeGreaterThanOrEqual(8);
        // The note's words are the kit's: "Hidden again. Each Show is logged. Values hide again after 2 minutes."
        expect((await w.app.locator(`${w.a} .pp-site-hidden__note`).innerText()).replace(/\s+/g, ' ')).toBe('Hidden again. Each Show is logged. Values hide again after 2 minutes.');
      } finally { await w.ctx.close(); }
    }
    // Approve by hand while the reminder waits.
    {
      const w = await world(browser, baseURL!, page, 'trust');
      try {
        const r = await both(w, 8_000, async (p, scope) => { await sleep(4600); await hit(p, `${scope} .pp-site-audit__row--waiting .pp-button`); });
        await expectSame('Trust, Approve by hand', r.app, r.kit, TOL);
      } finally { await w.ctx.close(); }
    }
  });

  // ---------------------------------------------------------------- AC-6
  test('AC-6 Integrations: three tabs play in order and the panel reacts, a pressed tab plays alone and stops the cycle, arrow keys move between tabs, the light follows a mouse and ignores touch', async ({ browser, baseURL, page, isMobile }) => {
    test.setTimeout(10 * 60_000);
    const CODE = '.pp-site-editor__code';
    // The cycle: REST API, then MCP server, then Events, as the kit plays it (the typing is judged by its end).
    {
      const w = await world(browser, baseURL!, page, 'integrations');
      try {
        const r = await both(w, 46_000, undefined, CODE);
        await expectSame('Integrations, the cycle', r.app, r.kit, TOL);
        const tabs = await w.app.locator(`${w.a} [role="tab"]`).evaluateAll((all) => all.map((t) => `${Array.from(t.childNodes).filter((n) => !(n instanceof Element && n.getAttribute('aria-hidden') === 'true')).map((n) => n.textContent ?? '').join('').trim()}:${t.getAttribute('aria-selected')}`));
        expect(tabs, 'three tabs: REST API, MCP server, Events, in that order').toEqual(['REST API:false', 'MCP server:false', 'Events:true']);
        const code = async (p: Page, scope: string) => (await p.locator(`${scope} ${CODE}`).innerText()).replace(/\s+/g, ' ').trim();
        expect(await code(w.app, w.a), 'the Events code is typed in full, the kit text').toBe(await code(w.kit, w.k));
      } finally { await w.ctx.close(); }
    }
    // Pressing a tab plays that one alone and the cycle stops for good; the code of each tab is the kit's.
    for (const [i, name, ms] of [[1, 'MCP server', 12_000], [2, 'Events', 9_000], [0, 'REST API', 15_000]] as const) {
      const w = await world(browser, baseURL!, page, 'integrations');
      try {
        const r = await both(w, ms, async (p, scope) => { await sleep(400); await hit(p, `${scope} [role="tab"] >> nth=${i}`); }, CODE);
        await expectSame(`Integrations, ${name} pressed`, r.app, r.kit, TOL);
        const code = async (p: Page, scope: string) => (await p.locator(`${scope} ${CODE}`).innerText()).replace(/\s+/g, ' ').trim();
        expect(await code(w.app, w.a), `${name}: the typed code is the kit's`).toBe(await code(w.kit, w.k));
        // Pressed, so the cycle never moves on: the selected tab is still the pressed one.
        await expect(w.app.locator(`${w.a} [role="tab"][aria-selected="true"]`), `${name}: the cycle stopped`).toHaveAccessibleName(name);
      } finally { await w.ctx.close(); }
    }
    // The keyboard: the arrow keys move between tabs (and play that tab), a real tablist.
    {
      const w = await world(browser, baseURL!, page, 'integrations');
      try {
        // Lock check: 400ms after the start, as the tab presses: a key pressed at once landed within a sample of the REST API start on one page only.
        const r = await both(w, 8_000, async (p, scope) => { await sleep(400); await p.locator(`${scope} [role="tab"]`).first().focus(); await p.keyboard.press('ArrowRight'); await sleep(300); await p.keyboard.press('ArrowRight'); }, CODE);
        await expectSame('Integrations, arrow keys', r.app, r.kit, TOL);
        await expect(w.app.locator(`${w.a} [role="tab"][aria-selected="true"]`)).toHaveAccessibleName('Events');
        const tab = w.app.locator(`${w.a} [role="tab"]`).first();
        expect(await tab.getAttribute('aria-controls'), 'a tab names its panel (aria-controls)').toBeTruthy();
        expect(await w.app.locator(`${w.a} [role="tablist"]`).count(), 'there is a tablist').toBe(1);
      } finally { await w.ctx.close(); }
    }
    // The light: a mouse pointer moves it and the graph paper the other way; touch does nothing; reduced motion drifts at half the speed.
    {
      const pos = async (p: Page, scope: string) => p.evaluate((sc) => { const root = document.querySelector(sc)!; const t = (s: string) => (root.querySelector(s) as HTMLElement | null)?.style.transform ?? ''; return { light: t('.pp-site-glow'), grid: t('.pp-site-glow__grid') }; }, scope);
      const w = await world(browser, baseURL!, page, 'integrations', {}, false);
      try {
        if (!isMobile) {
          for (const p of [w.app, w.kit]) { const scope = p === w.app ? w.a : w.k; await p.locator(scope).scrollIntoViewIfNeeded(); }
          const at = async (p: Page, scope: string) => { const b = (await p.locator(scope).boundingBox())!; await p.mouse.move(b.x + 300, b.y + 200, { steps: 4 }); await p.mouse.move(b.x + 420, b.y + 260, { steps: 4 }); await sleep(250); return pos(p, scope); };
          const a = await at(w.app, w.a), k = await at(w.kit, w.k);
          const nums = (s: string) => (s.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
          expect(nums(a.light).map(Math.round), 'a mouse pointer moves the light as it moves in the kit').toEqual(nums(k.light).map(Math.round));
          expect(nums(a.grid).map(Math.round), 'and the graph paper the other way').toEqual(nums(k.grid).map(Math.round));
          expect(a.light, 'the light is moved by transform').toMatch(/translate/);
        } else {
          // Touch: a touch pointer is ignored (the light keeps drifting on its own, so only the pointer's own place is judged).
          const before = await pos(w.app, w.a);
          // Lock check: the transform is read 200ms after the touch (a light moved in the next frame was missed when read at once), and both axes count.
          void before;
          await w.app.locator(w.a).scrollIntoViewIfNeeded();
          await w.app.evaluate((sc) => { const root = document.querySelector(sc)!; const r = root.getBoundingClientRect(); for (let i = 0; i < 3; i++) root.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: r.left + 5, clientY: r.top + 5, bubbles: true })); }, w.a);
          await sleep(200);
          const dragged = (await pos(w.app, w.a)).light;
          const m = dragged.match(/translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/);
          expect(m, `the light is placed by translate (${dragged})`).not.toBeNull();
          expect(Math.hypot(Number(m![1]) + 545, Number(m![2]) + 545), 'the light did not jump to the touch point').toBeGreaterThan(2);
        }
      } finally { await w.ctx.close(); }
    }
    {
      // Drift: with no pointer the light drifts on its own; under reduced motion at half the speed (the kit's rule).
      const speed = async (p: Page, scope: string) => {
        const read = () => p.evaluate((sc) => (document.querySelector(sc + ' .pp-site-glow') as HTMLElement).style.transform, scope);
        await p.locator(scope).scrollIntoViewIfNeeded();
        await sleep(300);
        const nums = (s: string) => (s.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
        const a = nums(await read());
        await sleep(2000);
        const b = nums(await read());
        return Math.hypot((b[0] ?? 0) - (a[0] ?? 0), (b[1] ?? 0) - (a[1] ?? 0));
      };
      const run = async (reduced: boolean) => {
        const w = await world(browser, baseURL!, page, 'integrations', { reducedMotion: reduced ? 'reduce' : 'no-preference' }, false);
        try { return { app: await speed(w.app, w.a), kit: await speed(w.kit, w.k) }; } finally { await w.ctx.close(); }
      };
      const normal = await run(false);
      const reduced = await run(true);
      expect(normal.app, 'the light drifts on its own').toBeGreaterThan(1);
      expect(Math.abs(normal.app - normal.kit), `the drift is as far as the kit's (${normal.app.toFixed(1)}px against ${normal.kit.toFixed(1)}px in 2s)`).toBeLessThan(Math.max(6, normal.kit * 0.35));
      expect(reduced.app, 'under reduced motion it still drifts, slower').toBeLessThan(normal.app * 0.8);
      expect(Math.abs(reduced.app - reduced.kit), `and as far as the kit's (${reduced.app.toFixed(1)}px against ${reduced.kit.toFixed(1)}px)`).toBeLessThan(Math.max(6, reduced.kit * 0.35));
    }
    // The menu's "MCP server" and "Events" links scroll to Integrations and switch the tab, on the landing route.
    // (Lock check: on `/` the first selected tab is Ask Batsi's question tab, so the tab is looked for in the editor.)
    {
      const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: isMobile, isMobile });
      try {
        for (const [hash, tab] of [['mcp', 'MCP server'], ['events', 'Events']] as const) {
          const p = await ctx.newPage();
          await p.goto(`/#${hash}`);
          await p.waitForLoadState('networkidle');
          await expect(p.locator('.pp-site-editor__tab[role="tab"][aria-selected="true"]').first(), `/#${hash} opens Integrations on ${tab}`).toHaveAccessibleName(tab, { timeout: 15_000 });
          await p.close();
        }
        const p = await ctx.newPage();
        await p.goto('/');
        await p.waitForLoadState('networkidle');
        for (const [hash, tab] of [['mcp', 'MCP server'], ['events', 'Events']] as const) {
          const link = p.locator(`a[href="#${hash}"]`).first();
          expect(await link.count(), `the menu has a link to #${hash}`).toBe(1);
          await link.evaluate((el) => (el as HTMLElement).click());
          await expect(p.locator('.pp-site-editor__tab[role="tab"][aria-selected="true"]').first(), `the ${hash} link switches the tab to ${tab}`).toHaveAccessibleName(tab, { timeout: 15_000 });
          expect(await p.locator(`.pp-site-editor__tab[role="tab"][aria-selected="true"]`).first().evaluate((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; }), `and scrolls Integrations into view`).toBe(true);
        }
      } finally { await ctx.close(); }
    }
  });

  // ---------------------------------------------------------------- AC-7
  test('AC-7 Platform: the module switches turn on one by one, the app frame follows, and a switch by hand does the same; the frame words are the kit\'s', async ({ browser, baseURL, page }) => {
    test.setTimeout(6 * 60_000);
    const w = await world(browser, baseURL!, page, 'platform');
    try {
      const r = await both(w, 8_000);
      // Every state counts here (gap 0): a module's tint ends 1.4s after it turns on, 50ms before the next module's Today item arrives (the kit's
      // own timings), so that state lasts 44 to 53ms and the 45ms filter dropped it on one page and not the other (lock check).
      await expectSame('Platform, the run', r.app, r.kit, TOL, 0);
      const items = await w.app.locator(`${w.a} .pp-site-app__item--in`).count();
      expect(items, 'every module is on and the frame shows its item').toBeGreaterThanOrEqual(4);
      // By hand, once the run is over: switch each module off and on, the frame follows as in the kit.
      const toggles = await w.app.locator(`${w.a} .pp-site-modules__row .pp-toggle__input:not([disabled])`).count();
      expect(toggles, 'one switch per module').toBeGreaterThanOrEqual(4);
      // Lock check: the first switch (Employee Records) is disabled in the kit and on the page, so pressing it moved neither page; the
      // switches pressed are the four modules that can be switched (and the same in AC-11).
      for (const i of [0, 2, 0, 3]) {
        const r2 = await both(w, 2_500, async (p, scope) => { await hit(p, `${scope} .pp-site-modules__row .pp-toggle__input:not([disabled]) >> nth=${i}`); }, '', false);
        await expectSame(`Platform, switch ${i + 1} by hand`, r2.app, r2.kit, TOL);
      }
      // Play again.
      const again = await both(w, 7_000, async (p, scope) => { await hit(p, `${scope} .pp-site-platform__again, ${scope} .pp-site-demo__again`); }, '', false);
      await expectSame('Platform, Play again', again.app, again.kit, TOL, 0);
    } finally { await w.ctx.close(); }
  });

  // ---------------------------------------------------------------- AC-8
  test('AC-8 About shows the company name with the flowing gradient; the closing band shows the kit words with its two buttons', async ({ browser, baseURL, page }) => {
    test.setTimeout(3 * 60_000);
    const d = deviceOf(page);
    // Lock check: CSS animations only. The reveal transitions (700ms, no name) are still running on one page and not the other on the phone.
    const flows = async (p: Page, scope: string) => p.evaluate((sc) => document.getAnimations().filter((a) => a instanceof CSSAnimation && a.playState === 'running' && !!(a.effect as KeyframeEffect | null)?.target && (document.querySelector(sc)?.contains((a.effect as KeyframeEffect).target as Element) ?? false)).map((a) => `${(a as CSSAnimation).animationName ?? ''}:${a.effect!.getTiming().duration}`).sort(), scope);
    const w = await world(browser, baseURL!, page, 'about', {}, false);
    try {
      await Promise.all([w.app.locator(w.a).scrollIntoViewIfNeeded(), w.kit.locator(w.k).scrollIntoViewIfNeeded()]);
      await sleep(900);
      const a = await flows(w.app, w.a), k = await flows(w.kit, w.k);
      expect(k.length, 'the kit page has a gradient that flows').toBeGreaterThan(0);
      expect(a, 'the page flows the same animations at the same speed').toEqual(k);
      const name = await w.app.locator(`${w.a} h2, ${w.a} h1`).first().innerText();
      expect(name.replace(/\s+/g, ' ').trim().length, 'About names the company').toBeGreaterThan(0);
    } finally { await w.ctx.close(); }
    // The band on the landing route: two buttons, one dark and one outlined, both large, the kit sizes (44 and 58 tall).
    const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone' });
    try {
      const p = await ctx.newPage();
      await p.goto('/');
      await p.waitForLoadState('networkidle');
      const band = p.locator('section#demo');
      await band.scrollIntoViewIfNeeded();
      const book = band.getByRole('link', { name: 'Book a demo', exact: true });
      const start = band.getByRole('link', { name: 'Get started', exact: true });
      await expect(book).toBeVisible();
      await expect(start).toBeVisible();
      expect((await book.boundingBox())!.height, 'the band buttons are the large size').toBeGreaterThanOrEqual(56);
      expect((await start.boundingBox())!.height).toBeGreaterThanOrEqual(56);
      await expect(book).toHaveClass(/pp-site-button--dark/);
      await expect(start).toHaveClass(/pp-site-button--line/);
    } finally { await ctx.close(); }
  });

  // ---------------------------------------------------------------- AC-9
  test('AC-9 the landing route holds every section once, in the approved order, with one main, one h1 and unique ids; header, sheet and footer are there; the pilot bar scrolls away', async ({ browser, baseURL, page }) => {
    test.setTimeout(3 * 60_000);
    const d = deviceOf(page);
    const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone' });
    try {
      await ctx.addInitScript(FREEZE_VIEW);
      const p = await ctx.newPage();
      await p.goto('/');
      await p.waitForLoadState('networkidle');
      // The kit's own section titles, in the kit's own order, found once each and in that order on the page.
      const kit = kitMarkup(dsFile('project/ui_kits/site-landing.html'));
      const stage = kit.slice(kit.indexOf(`id="top-${d === 'desktop' ? 'd' : 'p'}"`));
      const ids = ['main-' + (d === 'desktop' ? 'lpd' : 's4'), ...['modules', 'batsi', 'recruitment', 'onboarding', 'compliance', 'leave', 'trust', 'api', 'platform', 'about', 'demo'].map((s) => `${s}-${d === 'desktop' ? 'd' : 'p'}`)];
      const titles: string[] = [];
      for (const id of ids) {
        const at = stage.indexOf(`id="${id}"`);
        expect(at, `the kit has ${id}`).toBeGreaterThan(-1);
        const m = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/.exec(stage.slice(at));
        titles.push((m?.[1] ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ''));
      }
      const heads = await p.locator('h1, h2').evaluateAll((all) => all.map((h) => (h.textContent ?? '').replace(/\s+/g, '')));
      const at = titles.map((t) => heads.filter((h) => h === t).length);
      expect(at, 'every section title is on the page exactly once').toEqual(titles.map(() => 1));
      const order = titles.map((t) => heads.indexOf(t));
      expect([...order].sort((a, b) => a - b), 'in the approved order').toEqual(order);
      expect(await p.locator('main').count(), 'one main').toBe(1);
      expect(await p.locator('h1').count(), 'one h1').toBe(1);
      const dup = await p.evaluate(() => { const seen = new Map<string, number>(); document.querySelectorAll('[id]').forEach((e) => seen.set(e.id, (seen.get(e.id) ?? 0) + 1)); return [...seen].filter(([, n]) => n > 1).map(([id]) => id); });
      expect(dup, 'no id is used twice').toEqual([]);
      await expect(p.locator('header').first(), 'the header').toBeVisible();
      expect(await p.locator('footer').count(), 'the footer').toBe(1);
      expect(await p.getByRole('link', { name: 'Log in', exact: true }).count(), '"Log in" is a link to the sign-in page').toBeGreaterThan(0);
      await expect(p.getByRole('link', { name: 'Log in', exact: true }).first()).toHaveAttribute('href', '/sign-in');
      expect(await p.locator('.pp-site-pilot').count(), 'the pilot bar').toBe(1);
      // The pilot bar scrolls away with the page: it is not pinned, and after a scroll it is above the window.
      expect(await p.locator('.pp-site-pilot').evaluate((el) => getComputedStyle(el).position), 'not pinned').not.toMatch(/fixed|sticky/);
      await p.evaluate(() => window.scrollTo(0, 900));
      await sleep(300);
      expect(await p.locator('.pp-site-pilot').evaluate((el) => el.getBoundingClientRect().bottom), 'scrolled away').toBeLessThan(0);
      // The skip link still goes to the main content.
      expect(await p.locator('a[href="#main"], a.pp-site-skip, a[href^="#main"]').count(), 'the skip link is still there').toBeGreaterThan(0);
    } finally { await ctx.close(); }
  });

  // ---------------------------------------------------------------- AC-10
  test('AC-10 under reduced motion every demo shows its end at once and leaves no timer; data-site-still stops every loop; only transform, opacity, clip-path and stroke-dashoffset animate; replay, tab and route leave clean up', async ({ browser, baseURL, page }) => {
    test.setTimeout(14 * 60_000);
    const d = deviceOf(page);
    const hook = (p: Page) => p.evaluate(() => { const c = (window as unknown as { __ppSiteClock?: { pending(): number; observers(): number } }).__ppSiteClock; return c ? { pending: c.pending(), observers: c.observers() } : null; });
    // Reduced motion: Compliance and Leave show the kit's end state (the kit honours reduced motion for these two) at once; Trust, Platform and
    // Integrations show the end of the run (every row in, every switch on, the last tab typed): there at once, and no timer is left.
    for (const k of ['compliance', 'leave'] as const) {
      const run = async (isKit: boolean) => {
        const w = await world(browser, baseURL!, page, k, { reducedMotion: 'reduce' }, false);
        try {
          const p = isKit ? w.kit : w.app;
          const scope = isKit ? w.k : w.a;
          await p.locator(scope).scrollIntoViewIfNeeded();
          await sleep(900);
          const steps = await timeline(p, scope, 900);
          return { last: steps.at(-1)!.sig.split(' ')[0], pending: isKit ? 0 : (await hook(p))?.pending ?? -1 };
        } finally { await w.ctx.close(); }
      };
      const app = await run(false);
      const kit = await run(true);
      expect(app.last, `${k}: reduced motion shows the kit's end state at once`).toBe(kit.last);
      expect(app.pending, `${k}: no timer is left (window.__ppSiteClock.pending() is 0)`).toBe(0);
    }
    {
      // The end state of the kit's own run, in normal motion, is what the others show under reduced motion.
      const endOf = async (k: Key, wait: number, skip: string) => {
        const w = await world(browser, baseURL!, page, k, {}, true);
        try { await Promise.all([fire(w.kit), fire(w.app)]); await sleep(wait); const [k1] = await Promise.all([timeline(w.kit, w.k, 400, skip)]); return k1.at(-1)!.sig.split(' ')[0]; } finally { await w.ctx.close(); }
      };
      const reducedEnd = async (k: Key, skip: string) => {
        const w = await world(browser, baseURL!, page, k, { reducedMotion: 'reduce' }, false);
        try { await w.app.locator(w.a).scrollIntoViewIfNeeded(); await sleep(1500); const s = await timeline(w.app, w.a, 400, skip); return { last: s.at(-1)!.sig.split(' ')[0], pending: (await hook(w.app))?.pending ?? -1 }; } finally { await w.ctx.close(); }
      };
      for (const [k, wait, skip] of [['trust', 13_000, ''], ['platform', 8_000, ''], ['integrations', 46_000, '.pp-site-editor__code']] as const) {
        const kitEnd = await endOf(k, wait, skip);
        const r = await reducedEnd(k, skip);
        expect(r.last, `${k}: under reduced motion the end state shows at once`).toBe(kitEnd);
        expect(r.pending, `${k}: no timer is left`).toBe(0);
      }
    }
    // Still mode: with and without it, count the loops that run in the six sections.
    const loops = async (still: boolean) => {
      const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone' });
      try {
        if (still) await ctx.addInitScript(() => { const set = () => document.documentElement?.setAttribute('data-site-still', ''); set(); new MutationObserver(set).observe(document, { childList: true }); });
        const p = await ctx.newPage();
        await gotoLanding(p, KEYS.map((k) => ID(k, d)));
        await sleep(1500);
        return p.evaluate(() => document.getAnimations().filter((a) => { const t = a.effect?.getTiming(); return a.playState === 'running' && t?.iterations === Infinity && (a as CSSAnimation).animationName !== 'pp-site-blink'; }).map((a) => { const tg = (a.effect as KeyframeEffect).target as Element; return `${tg.tagName.toLowerCase()}.${String(tg.className).slice(0, 50)} ${(a as CSSAnimation).animationName ?? ''}`; }));
      } finally { await ctx.close(); }
    };
    expect((await loops(false)).length, 'in normal motion the sections have loops that run').toBeGreaterThan(0);
    expect(await loops(true), 'with data-site-still no loop runs').toEqual([]);

    // Only transform, opacity, clip-path and stroke-dashoffset animate while the demos play, and no width, height, left or top is written.
    const ALLOWED = new Set(['transform', 'opacity', 'clip-path', 'clipPath', 'stroke-dashoffset', 'strokeDashoffset', 'offset', 'easing', 'composite', 'computedOffset']);
    const FORBIDDEN = /^(width|height|left|top|right|bottom|inline-size|block-size|inset(-.*)?|min-(width|height|inline-size|block-size)|max-(width|height|inline-size|block-size)|margin(-.*)?|padding(-.*)?)$/;
    const problems: string[] = [];
    for (const [k, wait] of [['compliance', 14_000], ['leave', 11_000], ['trust', 13_000], ['integrations', 20_000], ['platform', 8_000], ['about', 1_500]] as const) {
      const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone' });
      try {
        await ctx.addInitScript(() => {
          const w = window as unknown as { __s4: { anim: Set<string>; style: Set<string> } };
          w.__s4 = { anim: new Set(), style: new Set() };
          const FORB = /^(width|height|left|top|right|bottom|inline-size|block-size|inset(-.*)?|min-(width|height|inline-size|block-size)|max-(width|height|inline-size|block-size)|margin(-.*)?|padding(-.*)?)$/;
          const scan = (el: Element) => { const st = (el as HTMLElement).style; if (!st) return; for (let i = 0; i < st.length; i++) { const n = st.item(i); if (FORB.test(n)) w.__s4.style.add(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} sets ${n}`); } };
          const start = () => {
            new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'attributes') scan(m.target as Element); else m.addedNodes.forEach((n) => { if (n.nodeType === 1) { scan(n as Element); (n as Element).querySelectorAll('[style]').forEach(scan); } }); } }).observe(document, { attributes: true, attributeFilter: ['style'], subtree: true, childList: true });
            setInterval(() => {
              for (const a of document.getAnimations()) {
                const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
                if (!t || !t.closest('[data-example-body], .pp-site-stage')) continue;
                const eff = a.effect as KeyframeEffect;
                if ((a as unknown as { transitionProperty?: string }).transitionProperty) w.__s4.anim.add(`${t.tagName.toLowerCase()}.${String(t.className).slice(0, 40)} transitions ${(a as unknown as { transitionProperty: string }).transitionProperty}`);
                else for (const kf of eff.getKeyframes()) for (const key of Object.keys(kf)) w.__s4.anim.add(`${t.tagName.toLowerCase()}.${String(t.className).slice(0, 40)} animates ${key}`);
              }
            }, 30);
          };
          if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
        });
        const p = await ctx.newPage();
        await gotoLanding(p, [ID(k, d)]);
        const root = p.locator(APP(k, d));
        await root.scrollIntoViewIfNeeded();
        if (k === 'integrations') { await sleep(1000); const b = (await root.boundingBox())!; await p.mouse.move(b.x + 200, b.y + 200, { steps: 6 }); await p.mouse.move(b.x + 500, b.y + 300, { steps: 6 }); }
        await sleep(wait);
        const seen = await p.evaluate(() => { const r = (window as unknown as { __s4: { anim: Set<string>; style: Set<string> } }).__s4; return { anim: [...r.anim], style: [...r.style] }; });
        // Lock check: the design system's own button and switch colour transitions (the same on the kit page) are not demo motion and are let through.
        const dsColour = (x: string) => /^(button|input)\.pp-(button|toggle)\S*.* transitions (background-color|color|border-color|box-shadow|outline-color)$/.test(x);
        const bad = seen.anim.filter((x) => !ALLOWED.has(x.split(' ').at(-1)!) && !/transitions (transform|opacity|clip-path|stroke-dashoffset)/.test(x) && !dsColour(x));
        problems.push(...bad.map((x) => `${k}: ${x}`), ...seen.style.map((x) => `${k}: ${x}`));
        const left = await p.evaluate((re) => { const rx = new RegExp(re); const out: string[] = []; document.querySelectorAll('[style]').forEach((el) => { const st = (el as HTMLElement).style; for (let i = 0; i < st.length; i++) if (rx.test(st.item(i))) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} has inline ${st.item(i)}`); }); return out; }, FORBIDDEN.source);
        problems.push(...left.map((x) => `${k}: ${x}`));
      } finally { await ctx.close(); }
    }
    expect(problems, 'nothing but transform, opacity, clip-path and stroke-dashoffset animates; no inline width, height, left, top (or insets, margins, paddings) is written').toEqual([]);

    // Replaying, changing tab, hiding the tab and leaving the page clean up.
    const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone' });
    try {
      await ctx.addInitScript(() => {
        const Real = window.IntersectionObserver;
        const targets = new Map<unknown, Set<Element>>();
        class Counted extends Real {
          constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) { super(cb, opts); targets.set(this, new Set()); }
          observe(el: Element): void { targets.get(this)!.add(el); super.observe(el); }
          disconnect(): void { targets.get(this)!.clear(); super.disconnect(); }
          unobserve(el: Element): void { targets.get(this)!.delete(el); super.unobserve(el); }
        }
        (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Counted;
        (window as unknown as { __liveObservers: () => number }).__liveObservers = () => [...targets.values()].filter((t) => t.size > 0).length;
      });
      const p = await ctx.newPage();
      // Lock check: the hook adds up every clock on the page, so Replay is counted with Compliance alone and the tabs with Integrations
      // alone (other demos queue and fire timers in the same moments). And the tabs type different code, so each tab is pressed twice
      // and compared with its own first press: a tab change that leaves the old tab's timers makes the second count larger.
      await gotoLanding(p, [ID('compliance', d)]);
      expect(await hook(p), 'the page offers window.__ppSiteClock with pending() and observers() (see cards/site-03.md)').not.toBeNull();
      await p.locator(APP('compliance', d)).scrollIntoViewIfNeeded();
      await sleep(1500);
      expect((await hook(p))!.pending, 'a demo is playing, so timers are queued').toBeGreaterThan(0);
      const counts: number[] = [];
      for (let i = 0; i < 3; i++) { await hit(p, `${APP('compliance', d)} .pp-site-replay`); await sleep(150); counts.push((await hook(p))!.pending); }
      expect(Math.max(...counts) - Math.min(...counts), `after each Replay the same timers are queued (${counts.join(', ')})`).toBeLessThanOrEqual(1);
      await gotoLanding(p, [ID('integrations', d)]);
      await p.locator(APP('integrations', d)).scrollIntoViewIfNeeded();
      await sleep(800);
      const tabCounts: number[] = [];
      for (const i of [1, 2, 0, 1, 2, 0]) { await hit(p, `${APP('integrations', d)} [role="tab"] >> nth=${i}`); await sleep(200); tabCounts.push((await hook(p))!.pending); }
      const drift = [0, 1, 2].map((i) => Math.abs(tabCounts[i + 3]! - tabCounts[i]!));
      expect(Math.max(...drift), `after each tab press the same timers are queued as the last time that tab was pressed (${tabCounts.join(', ')})`).toBeLessThanOrEqual(3);
      await gotoLanding(p, ['compliance', 'leave', 'trust', 'integrations', 'platform'].map((k) => ID(k as Key, d)));
      const cmp = p.locator(APP('compliance', d));
      await cmp.scrollIntoViewIfNeeded();
      await sleep(800);
      expect((await hook(p))!.pending, 'demos are playing before the tab is hidden').toBeGreaterThan(0);
      await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(400);
      expect((await hook(p))!.pending, 'a hidden tab holds no timer').toBe(0);
      await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      await cmp.scrollIntoViewIfNeeded();
      await sleep(600);
      await p.evaluate(() => { history.pushState({}, '', '/sign-in'); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); });
      await expect(p.getByRole('heading', { name: 'Sign in', exact: true }), 'the router left the gallery').toBeVisible({ timeout: 15_000 });
      await sleep(600);
      expect(await hook(p), 'after leaving, no clock timer and no clock observer is left').toEqual({ pending: 0, observers: 0 });
      expect(await p.evaluate(() => (window as unknown as { __liveObservers: () => number }).__liveObservers()), 'and no IntersectionObserver is still watching anything').toBe(0);
    } finally { await ctx.close(); }
  });

  // ---------------------------------------------------------------- AC-11
  test('AC-11 sections follow their own width, every control works from the keyboard with a visible focus ring, and axe finds nothing serious on any section or on the page', async ({ browser, baseURL, page }) => {
    test.setTimeout(12 * 60_000);
    const d = deviceOf(page);
    const origin = new URL(baseURL!).origin;
    // A phone section laid out at 800px wide, and a desktop section at 800px, each match the kit at the same width.
    if (d === 'phone') {
      /* at 390 the sections run as the phone device above; the 800px width is read in the desktop project */
    } else {
      // Lock check: the desktop stage keeps min-width 1280 (so "800px" left it 1280), and a phone stage at 800 in an 800 window cannot tell a
      // container query from a window media query. So: the desktop stage in an 800 window (container 1280, window 800), and the phone stage at
      // 800 and at 390 in a 1456 window (container narrower than the window), each asserted to have the width it was given.
      for (const [device, win, width] of [['desktop', 800, 800], ['phone', 1456, 800], ['phone', 1456, 390]] as const) {
        for (const k of KEYS) {
          const ctx = await browser.newContext({ baseURL, viewport: { width: win, height: 900 } });
          try {
            await ctx.addInitScript(FREEZE_VIEW);
            const p = await ctx.newPage();
            await gotoLanding(p, [ID(k, device)]);
            await p.evaluate((w) => { const st = document.querySelector('.pp-site-stage') as HTMLElement; st.style.width = `${w}px`; }, width);
            const kp = await ctx.newPage();
            await kp.setViewportSize({ width: win, height: 900 });
            await openKit(kp, origin, device, true, width);
            await settle(kp);
            await settle(p);
            const at = `${k} (${device} layout, stage ${width} in a ${win} window)`;
            const stage = await p.locator('.pp-site-stage').first().evaluate((el) => Math.round(el.getBoundingClientRect().width));
            expect(stage, `${at}: the stage is ${device === 'desktop' ? 1280 : width} wide`).toBe(device === 'desktop' ? 1280 : width);
            const r = await compareSection(p, kp, k, device, '');
            expect(r.unmatched, `${at}: every kit element is on the page`).toEqual([]);
            expect(r.moved, `${at}: every box is within 1px of the kit`).toEqual([]);
            expect(r.pixelRatio, `${at}: at most 1% of pixels differ`).toBeLessThanOrEqual(0.01);
          } finally { await ctx.close(); }
        }
      }
    }
    // The keyboard and axe, on every section, with motion reduced so every demo sits in its end state and no control comes or goes while Tab walks.
    const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone', reducedMotion: 'reduce' });
    try {
      const p = await ctx.newPage();
      await gotoLanding(p, KEYS.map((k) => ID(k, d)));
      await p.addStyleTag({ content: STILL });
      const problems: string[] = [];
      for (const k of KEYS) {
        const scope = APP(k, d);
        const root = p.locator(scope);
        await root.scrollIntoViewIfNeeded();
        const wanted = await root.evaluate((el) => Array.from(el.querySelectorAll('button, a[href], [role="tab"], input:not([type="hidden"])')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !(e as HTMLInputElement).disabled && !e.closest('[inert], [hidden], [aria-hidden="true"]') && getComputedStyle(e).visibility !== 'hidden' && (e as HTMLElement).tabIndex >= 0; }).map((e) => `${e.tagName.toLowerCase()}:${(e.textContent || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 14)}`));
        await p.evaluate((sc) => { const first = document.querySelector(sc)!; (document.activeElement as HTMLElement | null)?.blur(); const probe = document.createElement('button'); probe.id = 's4-probe'; probe.textContent = 'probe'; probe.style.cssText = 'position:fixed;left:0;top:0;opacity:0'; first.parentElement!.insertBefore(probe, first); probe.focus(); }, scope);
        const reached = new Set<string>();
        for (let i = 0; i < wanted.length + 30; i++) {
          await p.keyboard.press('Tab');
          const at = await p.evaluate((sc) => {
            const a = document.activeElement as HTMLElement | null;
            if (!a || !a.closest(sc)) return null;
            const cs = getComputedStyle(a);
            const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
            return { id: `${a.tagName.toLowerCase()}:${(a.textContent || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 14)}`, ring, visible: a.matches(':focus-visible') };
          }, scope);
          if (at) { reached.add(at.id); if (!at.ring || !at.visible) problems.push(`${k}: ${at.id} takes focus without a visible ring`); } else if (reached.size >= wanted.length) break;
        }
        await p.evaluate(() => document.getElementById('s4-probe')?.remove());
        const missing = wanted.filter((x) => ![...reached].includes(x));
        if (missing.length) problems.push(`${k}: the keyboard never reaches ${missing.join(', ')}`);
        const axe = await new AxeBuilder({ page: p }).include(scope).exclude('.pp-site-shine__copy').withTags(['wcag2a', 'wcag2aa']).analyze();
        for (const v of axe.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) problems.push(`${k}: axe ${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
      }
      expect(problems, 'every control is reached with Tab and shows a focus ring; axe finds no serious or critical issue in any section').toEqual([]);
      // Operable by key: Enter on a tab, Space on a switch, Enter on Replay.
      const integ = p.locator(APP('integrations', d));
      await integ.getByRole('tab').nth(1).focus();
      await p.keyboard.press('Enter');
      await sleep(300);
      await expect(integ.getByRole('tab').nth(1), 'Enter on a tab selects it').toHaveAttribute('aria-selected', 'true');
      const toggle = p.locator(`${APP('platform', d)} .pp-site-modules__row .pp-toggle__input:not([disabled])`).first();
      const was = await toggle.isChecked();
      await toggle.focus();
      await p.keyboard.press('Space');
      await sleep(300);
      expect(await toggle.isChecked(), 'Space on a module switch flips it').toBe(!was);
      // Lock check: under reduced motion Replay ends where it started, and the old check (done count <= 1) could not fail. In normal motion,
      // with Compliance alone: 3s into the run the register has moved on from 3 Nov, and Enter on Replay takes it back to 3 Nov.
      await p.emulateMedia({ reducedMotion: 'no-preference' });
      await gotoLanding(p, [ID('compliance', d)]);
      const cmpRoot = p.locator(APP('compliance', d));
      await cmpRoot.scrollIntoViewIfNeeded();
      await sleep(3000);
      const today = async () => (await cmpRoot.locator('.pp-site-ledger__today').innerText()).replace(/\s+/g, ' ');
      expect(await today(), 'the run has moved on from 3 Nov').not.toContain('3 Nov');
      await cmpRoot.locator('.pp-site-replay').first().focus();
      await p.keyboard.press('Enter');
      await sleep(300);
      expect(await today(), 'Enter on Replay plays the run again from 3 Nov').toContain('3 Nov');
    } finally { await ctx.close(); }
    // The whole page: axe finds nothing serious or critical.
    const full = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone', reducedMotion: 'reduce' });
    try {
      const p = await full.newPage();
      await p.goto('/');
      await p.waitForLoadState('networkidle');
      await p.addStyleTag({ content: STILL });
      const axe = await new AxeBuilder({ page: p }).exclude('.pp-site-shine__copy').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(axe.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), 'axe finds no serious or critical issue on the page').toEqual([]);
    } finally { await full.close(); }
  });

  // ---------------------------------------------------------------- AC-12
  test('AC-12 nothing outside the site changes: no signed-in file, no generated list, no site code on the signed-in pages', async ({ page, signIn, hr }) => {
    once('reads the repository and the pages once');
    test.setTimeout(3 * 60_000);
    const git = (...a: string[]) => execFileSync('git', a, { cwd: PEPLA_WEB, encoding: 'utf8' }).trim();
    let base = '';
    for (const ref of ['origin/develop', 'develop']) { try { base = git('merge-base', 'HEAD', ref); break; } catch { /* next */ } }
    expect(base, 'develop is known (git merge-base HEAD origin/develop)').not.toBe('');
    const changed = git('diff', '--name-only', base, 'HEAD', '--', '.').split('\n').filter(Boolean).map((f) => f.replace(/^pepla-web\//, ''));
    // A pull request that changes no site file (a different card) has nothing to judge here.
    test.skip(!changed.some((f) => /^src\/app\/ds\/site\//.test(f) || /^src\/app\/features\/public\//.test(f) || /^e2e\/acceptance\/(site-0[1-9]\.spec\.ts|support\/site-0[1-9]\/|cards\/site-0[1-9]\.md)/.test(f)), 'this pull request changes no site file');
    const allowed = (f: string) => /^src\/app\/ds\/site\//.test(f) || /^src\/app\/features\/public\//.test(f) || /^src\/app\/(app\.routes|app\.routes\.server|site\.routes)\.ts$/.test(f) || /^e2e\/acceptance\/(site-0[1-9]\.spec\.ts|onb-09\.spec\.ts|support\/site-0[1-9]\/|cards\/site-0[1-9]\.md)/.test(f) || /^e2e\/parity\//.test(f);
    expect(changed.filter((f) => !allowed(f)), 'this card changes only the site, the public pages, the route files and the site tests').toEqual([]);
    expect(changed.filter((f) => f === 'src/app/ds/all.ts' || (f.startsWith('src/app/features/') && !f.startsWith('src/app/features/public/'))), 'ds/all.ts and the signed-in features are untouched').toEqual([]);
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
  });

  // ---------------------------------------------------------------- AC-13
  test('AC-13 the build prerenders the landing route without a browser API, every demo in its first state, with no "pepla" anywhere in it', async () => {
    once('builds the app once');
    test.setTimeout(20 * 60_000);
    const out = execFileSync('npm', ['run', 'build'], { cwd: PEPLA_WEB, encoding: 'utf8', timeout: 15 * 60_000, env: { ...process.env, NG_CLI_ANALYTICS: 'false', FORCE_COLOR: '0', NO_COLOR: '1' }, maxBuffer: 64 * 1024 * 1024 });
    expect(out, 'the build prints no browser-API error (window, document, localStorage, IntersectionObserver is not defined)').not.toMatch(/(window|document|localStorage|navigator|IntersectionObserver|matchMedia|requestAnimationFrame) is not defined/);
    const browserOut = join(PEPLA_WEB, 'dist', 'pepla-web', 'browser');
    const index = [join(browserOut, 'index.html'), join(browserOut, 'index', 'index.html')].find((f) => existsSync(f));
    expect(index, 'the landing route is prerendered (dist/pepla-web/browser/index.html)').toBeTruthy();
    const html = readFileSync(index!, 'utf8');
    const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
    // Every demo shows its first state: the words of each kit section at its first step are in the prerendered HTML.
    const kit = kitMarkup(dsFile('project/ui_kits/site-landing.html'));
    const stage = kit.slice(kit.indexOf('id="top-d"'), kit.indexOf('id="top-p"'));
    for (const id of ['compliance-d', 'leave-d', 'trust-d', 'api-d', 'platform-d', 'about-d', 'demo-d']) {
      const at = stage.indexOf(`id="${id}"`);
      expect(at, `the kit has ${id}`).toBeGreaterThan(-1);
      const next = stage.indexOf('<section', at + 10);
      const piece = stage.slice(at, next > 0 ? next : undefined);
      const title = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/.exec(piece)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, '’').replace(/\s+/g, ' ').trim();
      expect(title, `${id} has a title in the kit`).toBeTruthy();
      expect(text, `the prerendered page holds the title of ${id}`).toContain(title!);
    }
    // No demo has started in the prerendered HTML: nothing has arrived and no step is "in" beyond what the kit's own first state holds.
    const started = ['pp-site-reveal--in', 'pp-site-step--in', 'pp-site-read__value--in', 'pp-site-approval__decide--done', 'pp-site-read__decide--done', 'pp-site-ledger__row--renewed', 'pp-site-request__field--set', 'pp-site-calendar__day--approved'].filter((c) => !kit.includes(c) && html.includes(c));
    expect(started, 'no demo has started in the prerendered HTML (these classes are not in the kit first state)').toEqual([]);
    expect(html.match(/\bwindow\b[^.]{0,20}is not defined/g) ?? [], 'no server error text in the HTML').toEqual([]);
    expect(html, 'no "pepla" in the prerendered landing page, its meta tags or its links, in any case').not.toMatch(/pepla/i);
    // No built script with site code carries the old name, or the old word "Masked".
    const files = (function all(dir: string): string[] { return readdirSync(dir).flatMap((e) => { const f = join(dir, e); return statSync(f).isDirectory() ? all(f) : [f]; }); })(browserOut);
    const MARK = /Not cleared|Where the data is kept|check-new-hire|pp-site-platform|pp-site-leave/;
    const holders = files.filter((f) => /\.(m?js|html)$/.test(f) && MARK.test(readFileSync(f, 'utf8')));
    expect(holders.length, 'the build holds the part 2 sections').toBeGreaterThan(0);
    expect(holders.filter((f) => /pepla/i.test(readFileSync(f, 'utf8'))).map((f) => relative(browserOut, f)), 'no built file with site sections carries the old name, in any case').toEqual([]);
    expect(holders.filter((f) => /\bMasked\b/.test(readFileSync(f, 'utf8'))).map((f) => relative(browserOut, f)), 'none says "Masked"').toEqual([]);
  });
});
