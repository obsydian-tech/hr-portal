import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { FREEZE_VIEW, GATED_VIEW, PEPLA_WEB, PIECES, STILL, TOL, compareExample, examples, exampleId, fire, fromFirstChange, gotoLearn, hit, openKitExample, pieceByName, sameTimeline, settle, settled, sleep, timeline, wordsOf, deviceOf, type Device, type Example, type Step } from './support/site-08/kit';
import { MOTION_PROBE, SLID_PROBE, checkAccessibility, checkDemoView, slidControlSees, checkEnding, checkMotion, checkPageParity, checkPageWords, checkSections, checkSubmenu, checkTop, hiddenFocusables, judgeEnding, judgeTop, learnSampleSpec, motionProblems } from './support/site-08/learn-page';
import { allowed, changedFiles, isThisCard, outside, refused } from './support/site-08/files';

/**
 * SITE-08 · Learn more page frame: page top, sub-menu, demo section shell, page ending, shared demo pieces, the page helper.
 * No backend. Runs against `ng serve` through E2E_BASE_URL, with the design system kit read at SITE_KIT_REF (default: the ref in sync.json;
 * develop's ref lacks site-pages.html, so use SITE_KIT_REF=c0de954c2b1d60f5b65d894a2664cfa6ffeda2d0 until SITE-07 moves the ref). See cards/site-08.md.
 * The desktop device is read in a 1456 wide window (the stage is then the kit's 1440), the phone device at 390.
 * Both sides are driven by the same actions: the kit (its markup and its preview scripts) is the oracle.
 */

const once = (why: string) => test.skip(test.info().project.name === 'phone-390', why);
const isPhone = (page: Page) => deviceOf(page) === 'phone';
const WIDE = { width: 1456, height: 900 };

// Both pages are drawn the same way on every machine: no sub-pixel (LCD) text and no font hinting (the lesson of SITE-02 AC-2).
test.use({ launchOptions: { args: ['--disable-lcd-text', '--font-render-hinting=none'] } });

const stageWidth = (p: Page) => p.locator('.pp-site-stage').first().evaluate((el) => el.getBoundingClientRect().width);
type World = { ctx: BrowserContext; app: Page; kit: Page; ex: Example; a: string; k: string };
/** A fresh context with the gallery (only this example) and the kit example, both views frozen, gated (fired by the test) or live. */
// Lock check T8: a 3000px spacer that is in the page from the first paint, so a demo starts below the fold (see AC-5).
const SPACER_FIRST = () => {
  const add = (): boolean => { if (!document.body) return false; const sp = document.createElement('div'); sp.style.height = '3000px'; sp.setAttribute('data-s8-spacer', ''); document.body.insertBefore(sp, document.body.firstChild); return true; };
  if (!add()) new MutationObserver((_, o) => { if (add()) o.disconnect(); }).observe(document, { childList: true, subtree: true });
};
async function world(browser: Browser, baseURL: string, page: Page, ex: Example, mode: 'frozen' | 'gated' | 'live', extra: object = {}, spaced = false): Promise<World> {
  const d = ex.device;
  const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone', ...extra });
  if (spaced) await ctx.addInitScript(SPACER_FIRST);
  if (mode === 'frozen') await ctx.addInitScript(FREEZE_VIEW);
  if (mode === 'gated') await ctx.addInitScript(GATED_VIEW);
  const app = await ctx.newPage();
  await gotoLearn(app, [ex.id]);
  const kit = await ctx.newPage();
  await kit.setViewportSize(page.viewportSize()!);
  await openKitExample(kit, new URL(baseURL).origin, ex, true, await stageWidth(app));
  return { ctx, app, kit, ex, a: `section[data-example="${ex.screen}"] [data-example-body] .pp-site-stage`, k: '.pp-site-stage' };
}
const byName = (d: Device, name: string): Example => examples(d).find((e) => e.name === name)!;

async function expectSame(label: string, app: Step[], kit: Step[], gap = 45): Promise<void> {
  const a = settled(fromFirstChange(app), gap), k = settled(fromFirstChange(kit), gap);
  expect(kit.length, `${label}: the kit page moved at all`).toBeGreaterThan(1);
  const r = sameTimeline(a, k, TOL);
  const h = (s: Step) => s.sig.split(' ')[0];
  const at = a.findIndex((s, i) => !k[i] || h(s) !== h(k[i]!));
  expect(a.map(h), `${label}: the page passes through the same states, in the same order, as the kit${at < 0 ? '' : ` (first difference at #${at}: page "${a[at]?.sig.slice(0, 200) ?? 'none'}", kit "${k[at]?.sig.slice(0, 200) ?? 'none'}")`}`).toEqual(k.map(h));
  expect(r.late, `${label}: each state shows within ${TOL}ms of when the kit shows it`).toEqual([]);
}
type Act = (p: Page, scope: string, isKit: boolean) => Promise<void>;
/** Both pages are watched for `ms` at the same moment; 100ms in, the views are fired and `act` runs on each, with the same actions. */
async function both(w: World, ms: number, act?: Act, start = true, skip = ''): Promise<{ app: Step[]; kit: Step[] }> {
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
const inner = (ex: Example, sel: string) => (ex.family === 'piece' ? sel : sel);

test.describe('SITE-08 Learn more page frame', () => {
  test.beforeEach(async ({ page }) => { if (!isPhone(page)) await page.setViewportSize(WIDE); });

  // ---------------------------------------------------------------- AC-1
  test('AC-1 one gallery section per example, with the kit words both ways and no invented ones', async ({ page, context, baseURL }) => {
    test.setTimeout(8 * 60_000);
    const d = deviceOf(page);
    await context.addInitScript(FREEZE_VIEW);
    await gotoLearn(page);
    const found = await page.locator('section[data-example]').evaluateAll((all) => all.map((s) => ({ name: (s as HTMLElement).dataset['example']!, id: s.id, bodies: s.querySelectorAll('[data-example-body]').length, stages: s.querySelectorAll('[data-example-body] .pp-site-stage').length })));
    const mine = examples(d);
    expect(mine.map((e) => e.screen).filter((n) => !found.some((f) => f.name === n)), `/dev/site-learn has a section for every example of cards/site-08.md (${d})`).toEqual([]);
    for (const e of mine) {
      const f = found.find((x) => x.name === e.screen)!;
      expect(f.id, `${e.screen}: id`).toBe(e.id);
      expect(f.bodies, `${e.screen}: one [data-example-body]`).toBe(1);
      expect(f.stages, `${e.screen}: a .pp-site-stage inside it`).toBe(1);
    }
    expect(new Set(found.map((f) => f.id)).size, 'section ids are unique').toBe(found.length);
    // The words of each example, both ways, against the kit example of the same name (the hero card of a page top is a page card's: out on both sides).
    const origin = new URL(baseURL!).origin;
    const problems: string[] = [];
    for (const e of mine.filter((x) => x.family !== 'sample')) {
      const kitPage = await context.newPage();
      try {
        await kitPage.setViewportSize(page.viewportSize()!);
        await openKitExample(kitPage, origin, e, false, await stageWidth(page));
        const kit = await kitPage.evaluate(wordsOf, ['.pp-site-stage', '.pp-site-hcard'] as [string, string]);
        const app = await page.evaluate(wordsOf, [`section[data-example="${e.screen}"] [data-example-body] .pp-site-stage`, '.pp-site-hcard'] as [string, string]);
        const miss = (x: string[], y: string[]) => x.filter((t) => !y.includes(t));
        for (const [what, a, k] of [['text', app.texts, kit.texts], ['name', app.names, kit.names]] as const) {
          if (miss(a, k).length) problems.push(`${e.screen}: ${what} on the page and not in the kit: ${miss(a, k).slice(0, 3).join(' | ')}`);
          if (miss(k, a).length) problems.push(`${e.screen}: ${what} in the kit and not on the page: ${miss(k, a).slice(0, 3).join(' | ')}`);
        }
      } finally { await kitPage.close(); }
    }
    expect(problems, 'the words of every example are the kit example\'s words, both ways').toEqual([]);
    const html = await page.evaluate(() => { const c = document.documentElement.cloneNode(true) as HTMLElement; c.querySelectorAll('script, style, noscript').forEach((n) => n.remove()); return c.outerHTML; });
    expect(html.match(/lorem|placeholder|masked|claude|pepla/gi) ?? [], 'no lorem, placeholder, "Masked", "Claude" or "pepla" in text, attribute, class, title or href').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-2
  test('AC-2 every example matches the kit: every box within 1px, at most 1% of pixels differ', async ({ page, browser, baseURL }) => {
    test.setTimeout(30 * 60_000);
    for (const ex of examples(deviceOf(page)).filter((e) => e.family !== 'sample')) {
      const w = await world(browser, baseURL!, page, ex, 'frozen');
      try {
        await settle(w.kit); await settle(w.app);
        const r = await compareExample(w.app, w.kit, ex);
        expect(r.kitElements, `${ex.screen}: the kit example has elements`).toBeGreaterThanOrEqual(8);
        expect(r.unmatched, `${ex.screen}: every kit element is on the page`).toEqual([]);
        expect(r.moved, `${ex.screen}: every box is within 1px`).toEqual([]);
        expect(r.pixelRatio, `${ex.screen}: at most 1% of pixels differ`).toBeLessThanOrEqual(0.01);
      } finally { await w.ctx.close(); }
    }
  });

  // ---------------------------------------------------------------- AC-3
  test('AC-3 page tops: breadcrumb, one h1 with its shine line, two site buttons, Built for list, card slot, rings only where the kit has them; links with no target do not move the page', async ({ page, browser, baseURL }) => {
    test.setTimeout(10 * 60_000);
    const tops = examples(deviceOf(page)).filter((e) => e.family === 'top');
    expect(tops.length, 'six page tops').toBe(6);
    for (const ex of tops) {
      const w = await world(browser, baseURL!, page, ex, 'frozen');
      try {
        await judgeTop(w.app, w.kit, ex.screen);
        // A link with no real target leaves the window and the address as they were.
        await w.app.evaluate(() => window.scrollTo(0, 60));
        const before = await w.app.evaluate(() => ({ y: scrollY, url: location.href }));
        const n = await w.app.locator(`${w.a} a`).count();
        expect(n, `${ex.screen}: the page top has links to try`).toBeGreaterThan(0);
        // Lock check T4: a link that leaves the page (a "#" under <base href="/"> goes to the home page) used to hang the test for its whole 10 minutes; it now fails at once.
        const left: string[] = [];
        w.app.on('framenavigated', (f) => { if (f === w.app.mainFrame()) left.push(f.url()); });
        for (let i = 0; i < n && !left.length; i++) { await Promise.race([w.app.locator(`${w.a} a`).nth(i).evaluate((el) => (el as HTMLElement).click(), undefined, { timeout: 1500 }).catch(() => undefined), sleep(1500)]); await sleep(120); }
        expect(left, `${ex.screen}: no link leaves the page`).toEqual([]);
        expect(await w.app.evaluate(() => ({ y: scrollY, url: location.href })), `${ex.screen}: no link moves the page or the address`).toEqual(before);
      } finally { await w.ctx.close(); }
    }
  });

  // ---------------------------------------------------------------- AC-4
  test('AC-4 sub-menu: "On this page", sticky under the shrunk header, 56 tall, current tab by scroll, highlight by transform, a tap lands the section, tabs scroll sideways', async ({ browser, baseURL, page }) => {
    test.setTimeout(5 * 60_000);
    await checkSubmenu({ browser, baseURL: baseURL!, page }, learnSampleSpec(deviceOf(page)));
  });

  // ---------------------------------------------------------------- AC-5
  test('AC-5 demo section shell: white, cream and flipped as the kit; plays only once in view, keeps its place; Play again restarts and keeps focus; the Leave types rows step as the kit steps them', async ({ browser, baseURL, page }) => {
    test.setTimeout(8 * 60_000);
    const d = deviceOf(page);
    const white = d === 'desktop' ? byName(d, 'Demo section, white') : byName(d, 'Demo section');
    // Layout: the cream and flipped one puts the panel first from 1024, a phone puts it after the words, as the kit does.
    const geo = (p: Page, sc: string) => p.evaluate((s) => { const sec = document.querySelector(s + ' .pp-site-demo')!; const t = sec.querySelector('.pp-site-demo__text')!.getBoundingClientRect(); const v = sec.querySelector('.pp-site-demo__vis')!.getBoundingClientRect(); return { cream: sec.classList.contains('pp-site-demo--cream'), flip: sec.classList.contains('pp-site-demo--flip'), bg: getComputedStyle(sec).backgroundColor, panelFirst: v.left < t.left - 1, panelAfter: v.top >= t.bottom - 1 }; }, sc);
    for (const ex of d === 'desktop' ? [white, byName(d, 'Demo section, cream and flipped')] : [white]) {
      const w = await world(browser, baseURL!, page, ex, 'frozen');
      try {
        const a = await geo(w.app, w.a), k = await geo(w.kit, w.k);
        expect(a, `${ex.screen}: ground, flip and panel side are the kit's`).toEqual(k);
        if (d === 'desktop') expect(a.panelFirst, `${ex.screen}: the panel is ${a.flip ? 'first' : 'second'} from 1024`).toBe(a.flip);
        else expect(a.panelAfter, `${ex.screen}: on a phone the panel comes after the words`).toBe(true);
      } finally { await w.ctx.close(); }
    }
    // Plays only once in view (real observers), on the page's own demo that plays by itself: the sample page's (T9, see checkDemoView).
    await checkDemoView({ browser, baseURL: baseURL!, page }, learnSampleSpec(d));
    // The run, Play again by hand and by key (focus stays), as the kit steps them (the Leave types rows at 0.5, 1, 1.5, 2 and 3.2s, Play again at 4.2s).
    const g = await world(browser, baseURL!, page, white, 'gated');
    try {
      // The kit's phone example is not `data-live` (it never starts on its own): on a phone the run starts with Play again, on both pages (T9).
      const byClick: Act | undefined = d === 'phone' ? async (p, scope) => { await hit(p, `${scope} .pp-site-demo__again`); } : undefined;
      const r = await both(g, 5_200, byClick, d !== 'phone');
      await expectSame('Leave types, the run', r.app, r.kit);
      const rows = await g.app.locator(`${g.a} .pp-site-demo__row`).evaluateAll((all) => all.map((x) => (x.querySelector('.pp-site-demo__row-name')?.textContent ?? '').trim()));
      expect(rows, 'five rows, in the kit\'s order').toEqual(['Annual leave', 'Sick leave', 'Family responsibility leave', 'Maternity leave', 'Study leave']);
      const again = g.app.locator(`${g.a} button.pp-site-demo__again`);
      expect(await again.count(), 'Play again is a button').toBe(1);
      const r2 = await both(g, 5_200, async (p, scope) => { await hit(p, `${scope} .pp-site-demo__again`); }, false);
      await expectSame('Leave types, Play again', r2.app, r2.kit);
      expect(await g.app.evaluate((s) => document.activeElement === document.querySelector(s + ' .pp-site-demo__again'), g.a), 'Play again has focus again after the restart').toBe(true);
      await sleep(1000);
      await g.app.locator(`${g.a} .pp-site-demo__again`).focus();
      const r3 = timeline(g.app, g.a, 1800);
      await g.app.keyboard.press('Enter');
      expect((await r3).length, 'Enter on Play again restarts the demo').toBeGreaterThanOrEqual(2);
    } finally { await g.ctx.close(); }
  });

  // ---------------------------------------------------------------- AC-6
  test('AC-6 shared demo pieces play like the kit: timeline, document read, suggestion, live status, approval and log line, choices and slots', async ({ browser, baseURL, page }) => {
    test.setTimeout(12 * 60_000);
    const d = deviceOf(page);
    const MS: Record<string, number> = { timeline: 7_000, 'document read': 9_000, suggestion: 6_500, 'live status': 7_000, 'approval decision and log line': 6_500, 'choices and slots': 10_500 };
    for (const p of PIECES) {
      const ex = byName(d, `Piece: ${p.name}`);
      const w = await world(browser, baseURL!, page, ex, 'gated');
      try {
        const r = await both(w, MS[p.name]!);
        await expectSame(`${p.name}, the run`, r.app, r.kit);
        if (p.name === 'choices and slots') {
          const st = (pg: Page, sc: string) => pg.evaluate((s) => Array.from(document.querySelectorAll(s + ' .pp-site-slot')).map((b) => b.getAttribute('aria-pressed')).join(''), sc);
          // Lock check T6: this used to assert "at most 5 slots pressed" (every row has five, so it could not fail). The end of the run is the kit's end of the run.
          const endApp = await st(w.app, w.a), endKit = await st(w.kit, w.k);
          expect(endApp.length, 'the choices and slots example has slots').toBeGreaterThan(0);
          expect(endApp, 'the slots are pressed as the kit has them at the end of the run').toBe(endKit);
        }
      } finally { await w.ctx.close(); }
      // By hand, as the kit does it.
      const hand: Record<string, { at: number; ms: number; sel: string } | undefined> = {
        'document read': { at: 5_800, ms: 7_000, sel: '.pp-site-read__decide .pp-button--primary' },
        suggestion: { at: 3_000, ms: 5_000, sel: '.pp-site-approval__decide .pp-button--primary' },
        'approval decision and log line': { at: 3_400, ms: 5_000, sel: '.pp-site-approval__decide .pp-button--primary' },
        'choices and slots': { at: 1_000, ms: 7_000, sel: '.pp-site-slot[data-r="3"]' },
      };
      const h = hand[p.name];
      if (h) {
        const w2 = await world(browser, baseURL!, page, ex, 'gated');
        try {
          const r = await both(w2, h.ms, async (pg, scope) => { await sleep(h.at); await hit(pg, `${scope} ${h.sel}`); });
          await expectSame(`${p.name}, by hand`, r.app, r.kit);
          if (p.name === 'choices and slots') {
            // The pressed one shows it, only one is pressed, and the kit's cycling has stopped (it would have moved on at 2.6s and 5.8s).
            const look = (pg: Page, sc: string) => pg.evaluate((s) => Array.from(document.querySelectorAll(s + ' .pp-site-slot')).map((b) => `${b.getAttribute('aria-pressed')}:${getComputedStyle(b.querySelector('.pp-site-slot__label--on')!).opacity}:${getComputedStyle(b.querySelector('.pp-site-slot__label')!).fontWeight}`), sc);
            const a = await look(w2.app, w2.a), k = await look(w2.kit, w2.k);
            expect(a, 'the pressed slot shows its state as the kit shows it').toEqual(k);
            expect(a.filter((x) => x.startsWith('true')).length, 'exactly one is pressed').toBe(1);
            expect(a[3]!.startsWith('true'), 'it is the one that was pressed, the cycle did not move on').toBe(true);
            expect(await w2.app.locator(`${w2.a} .pp-site-slots__row`).getAttribute('aria-label'), 'the row is a named group').toBeTruthy();
          }
        } finally { await w2.ctx.close(); }
      }
      if (p.name === 'suggestion') {
        const w3 = await world(browser, baseURL!, page, ex, 'gated');
        try {
          const r = await both(w3, 5_000, async (pg, scope) => { await sleep(3_000); await hit(pg, `${scope} .pp-site-approval__decide .pp-button--default`); });
          await expectSame(`${p.name}, Decline by hand`, r.app, r.kit);
        } finally { await w3.ctx.close(); }
      }
    }
  });

  // ---------------------------------------------------------------- AC-7
  test('AC-7 page endings: Ask Batsi plays answer, waiting and approved as the kit; strip, related cards, questions are the kit\'s and work', async ({ browser, baseURL, page }) => {
    test.setTimeout(20 * 60_000);
    const endings = examples(deviceOf(page)).filter((e) => e.family === 'ending');
    expect(endings.length, 'six endings').toBe(6);
    for (const ex of endings) {
      const w = await world(browser, baseURL!, page, ex, 'frozen');
      try {
        await w.app.evaluate(() => { const s = document.createElement('div'); s.style.height = '1400px'; s.setAttribute('data-s8-spacer', ''); document.body.appendChild(s); });
        await judgeEnding(w.app, w.kit, ex.screen, [0, 1, 2]);
        const facts = await w.app.evaluate(() => document.querySelectorAll('.pp-site-strip a').length);
        expect(facts, `${ex.screen}: the strip link is there on every page but Security`).toBe(/Security/.test(ex.name) ? 0 : 1);
      } finally { await w.ctx.close(); }
    }
  });

  // ---------------------------------------------------------------- AC-8
  test('AC-8 motion: only transform and opacity animate; reduced motion still steps and nothing slides; data-site-still shows the last step and nothing loops', async ({ browser, baseURL, page }) => {
    test.setTimeout(12 * 60_000);
    const d = deviceOf(page);
    const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone' });
    try {
      await ctx.addInitScript(MOTION_PROBE);
      const p = await ctx.newPage();
      await gotoLearn(p);
      const ids = await p.evaluate(() => Array.from(document.querySelectorAll('section[data-example]')).map((s) => s.id));
      for (const id of ids) {
        await p.locator(`[id="${id}"]`).evaluate((el) => (el as HTMLElement).scrollIntoView({ block: 'center' }));
        await sleep(id.includes('piece') || id.includes('demo') ? 2600 : 1800);
        if (id.includes('ending')) { await p.locator(`[id="${id}"] .pp-site-ask__chip`).nth(1).evaluate((el) => (el as HTMLElement).click()); await p.locator(`[id="${id}"] .pp-site-faq__q`).nth(1).evaluate((el) => (el as HTMLElement).click()); await sleep(1200); }
      }
      expect(await motionProblems(p), 'only transform and opacity animate (the kit\'s FAQ row height and the design system\'s button colours aside); no inline width, height, left, top, inset, margin or padding').toEqual([]);
    } finally { await ctx.close(); }
    const white = d === 'desktop' ? byName(d, 'Demo section, white') : byName(d, 'Demo section');
    // Reduced motion: the demo still steps, and no step slides.
    {
      const w = await world(browser, baseURL!, page, white, 'gated', { reducedMotion: 'reduce' });
      try {
        for (const p of [w.app, w.kit]) await p.evaluate(SLID_PROBE);
        const r = await both(w, 5_200, d === 'phone' ? async (p, scope) => { await hit(p, `${scope} .pp-site-demo__again`); } : undefined, d !== 'phone');
        await expectSame('reduced motion, the demo steps', r.app, r.kit);
        expect(await w.app.evaluate(() => [...(window as unknown as { __slid: Set<string> }).__slid]), 'reduced motion: no step slides').toEqual([]);
      } finally { await w.ctx.close(); }
    }
    // Lock check T2 (control): none of the gallery's kit demos slides by script (only the Recruitment hiring board does, and it is not a shared piece), so the
    // block above could pass by seeing nothing. The probe is shown to be alive: a script slide put on a step by hand is recorded.
    {
      const w = await world(browser, baseURL!, page, white, 'gated', { reducedMotion: 'reduce' });
      try {
        await w.app.evaluate(SLID_PROBE);
        expect(await slidControlSees(w.app), 'control: the reduced-motion probe records a script slide put on a step').toBe(true);
      } finally { await w.ctx.close(); }
    }
    // Still mode: every step shows at once; nothing loops.
    {
      const ctx2 = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone' });
      try {
        await ctx2.addInitScript(GATED_VIEW);
        await ctx2.addInitScript(() => { const set = () => document.documentElement?.setAttribute('data-site-still', ''); set(); new MutationObserver(set).observe(document, { childList: true }); });
        const p = await ctx2.newPage();
        await gotoLearn(p);
        await fire(p);
        await sleep(500);
        const r = await p.evaluate(() => ({
          hidden: Array.from(document.querySelectorAll('.pp-site-demo .pp-site-step')).filter((e) => getComputedStyle(e).opacity !== '1').length,
          loops: document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity && (a as CSSAnimation).animationName !== 'pp-site-blink').map((a) => String(((a.effect as KeyframeEffect).target as Element | null)?.className).slice(0, 40)),
        }));
        expect(r.hidden, 'data-site-still: every step of every demo shows at once').toBe(0);
        expect(r.loops, 'data-site-still: nothing loops').toEqual([]);
        const pending = await p.evaluate(() => (window as unknown as { __ppSiteClock?: { pending(): number } }).__ppSiteClock?.pending() ?? -1);
        expect(pending, 'data-site-still leaves no timer (window.__ppSiteClock.pending() is 0; the hook is on every /dev page, see cards/site-08.md)').toBe(0);
      } finally { await ctx2.close(); }
    }
    // Replay and leaving the route clean up: after Play again the same timers are queued, and after leaving none is left.
    {
      const w = await world(browser, baseURL!, page, white, 'live');
      try {
        const hook = () => w.app.evaluate(() => { const c = (window as unknown as { __ppSiteClock?: { pending(): number; observers(): number } }).__ppSiteClock; return c ? { pending: c.pending(), observers: c.observers() } : null; });
        expect(await hook(), 'the page offers window.__ppSiteClock with pending() and observers()').not.toBeNull();
        await w.app.locator(w.a).scrollIntoViewIfNeeded();
        if (d === 'phone') await hit(w.app, `${w.a} .pp-site-demo__again`); // the kit's phone example does not start by itself (T9)
        await sleep(1500);
        expect((await hook())!.pending, 'a demo is playing, so timers are queued').toBeGreaterThan(0);
        const counts: number[] = [];
        for (let i = 0; i < 3; i++) { await hit(w.app, `${w.a} .pp-site-demo__again`); await sleep(150); counts.push((await hook())!.pending); }
        expect(Math.max(...counts) - Math.min(...counts), `after each Play again the same timers are queued (${counts.join(', ')})`).toBeLessThanOrEqual(1);
        await w.app.evaluate(() => { history.pushState({}, '', '/sign-in'); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); });
        await expect(w.app.getByRole('heading', { name: 'Sign in', exact: true }), 'the router left the gallery').toBeVisible({ timeout: 15_000 });
        await sleep(600);
        expect(await hook(), 'after leaving, no clock timer and no clock observer is left').toEqual({ pending: 0, observers: 0 });
      } finally { await w.ctx.close(); }
    }
  });

  // ---------------------------------------------------------------- AC-9
  test('AC-9 server render: learn.ssr.spec.ts exists, renders a full ppSiteLearnPage with all six endings on the server, and passes', async () => {
    once('reads a file and runs the unit spec once');
    test.setTimeout(8 * 60_000);
    const ssr = join(PEPLA_WEB, 'src', 'app', 'ds', 'site', 'learn', 'learn.ssr.spec.ts');
    expect(existsSync(ssr), 'src/app/ds/site/learn/learn.ssr.spec.ts exists (the server render of a Learn more page, see cards/site-08.md)').toBe(true);
    // Lock check T7: the words are looked for in the code, not in comments (a comment holding the names used to satisfy every check below).
    const src = readFileSync(ssr, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    expect(src, 'it renders on the server (platform-server)').toMatch(/platform-server/);
    expect(src, 'it really renders (renderApplication)').toMatch(/renderApplication\(/);
    expect(src, 'it renders ppSiteLearnPage').toMatch(/ppSiteLearnPage/);
    expect(src, 'it asserts no item has arrived or hides').toMatch(/not\.(toContain|toMatch)\([^)]*pp-site-reveal--in/);
    expect(src, 'it asserts the questions of the page are in the HTML').toMatch(/pp-site-faq__q|faq/i);
    for (const page of ['Recruitment', 'Onboarding', 'Compliance', 'Leave', 'Security', 'Platform']) expect(src, `it renders the ${page} ending`).toMatch(new RegExp(page, 'i'));
    const r = execFileSync('npx', ['ng', 'test', '--watch=false', '--include', 'src/app/ds/site/learn/learn.ssr.spec.ts'], { cwd: PEPLA_WEB, encoding: 'utf8', timeout: 6 * 60_000, env: { ...process.env, CI: '1', NG_CLI_ANALYTICS: 'false', FORCE_COLOR: '0' } });
    // Lock check T11: "passed" was enough, and `Test Files 1 passed` is printed for a spec whose tests are all skipped or that holds none that ran. At least one test ran and passed, none was skipped.
    const out = r.replace(/\x1b\[[0-9;]*m/g, '');
    expect(out, 'the SSR spec ran and at least one test passed').toMatch(/Tests\s+(\d+ failed \| )?[1-9]\d* passed/);
    expect(out, 'no test of the SSR spec failed, was skipped or is a todo').not.toMatch(/\d+ (failed|skipped|todo)/i);
    expect(src, 'the SSR spec skips nothing').not.toMatch(/\b(it|test|describe)\.(skip|todo)\b|\bx(it|describe)\(/);
  });

  // ---------------------------------------------------------------- AC-10
  test('AC-10 accessibility: axe finds nothing on the gallery, with a question open and Ask Batsi in each of its three states; nothing reachable by Tab sits inside an aria-hidden container', async ({ browser, baseURL, page }) => {
    test.setTimeout(6 * 60_000);
    const d = deviceOf(page);
    const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone', reducedMotion: 'reduce' });
    try {
      await ctx.addInitScript(FREEZE_VIEW);
      const p = await ctx.newPage();
      await gotoLearn(p);
      await p.addStyleTag({ content: STILL });
      for (let i = 0; i < 2; i++) await p.evaluate(async () => { await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))); });
      const batsi = await p.evaluate(() => Array.from(document.querySelectorAll('section[data-example^="Ask Batsi"]')).map((s) => (s as HTMLElement).dataset['example']));
      expect(batsi.length, 'the gallery shows Ask Batsi answered, waiting and approved').toBeGreaterThanOrEqual(3);
      expect(await p.locator('.pp-site-faq__item--open').count(), 'a question is open').toBeGreaterThan(0);
      const axe = await new AxeBuilder({ page: p }).exclude('.pp-site-shine__copy').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(axe.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), 'axe (wcag2a, wcag2aa) finds no violation').toEqual([]);
      expect(await hiddenFocusables(p), 'no element Tab reaches sits inside an aria-hidden container (use inert)').toEqual([]);
    } finally { await ctx.close(); }
  });

  // ---------------------------------------------------------------- AC-11
  test('AC-11 signed-in code untouched: no site script on /sign-in or /hr; ds/all.ts and the signed-in features unchanged; the file rule', async ({ page, signIn, hr }) => {
    once('reads the repository and the pages once');
    test.setTimeout(3 * 60_000);
    // The rule itself, on tables: what a builder's pull request may change, and what is always refused.
    const builder = ['src/app/ds/site/learn/page.ts', 'src/app/ds/site/learn/content/leave.ts', 'src/app/ds/site/learn/parts/timeline.ts', 'src/app/ds/site/learn/learn.ssr.spec.ts', 'src/app/ds/site/index.ts', 'src/app/app.routes.ts', 'src/app/ds/README.md', 'e2e/acceptance/site-08.spec.ts', 'e2e/acceptance/support/site-08/learn-page.ts', 'e2e/acceptance/cards/site-08.md', 'e2e/acceptance/site-10.spec.ts', 'src/app/features/public/learn/page.ts'];
    expect(outside(builder), 'the rule accepts a plausible builder file set').toEqual([]);
    const never = ['src/app/ds/all.ts', 'src/app/features/hr/hr-shell.ts', 'src/app/features/sign-in/sign-in.ts', 'src/app/core/auth.ts', 'src/app/ds/README.md.bak', 'src/app/ds/site/../../core/auth.ts', 'src/app/app.routes.tsx', 'package.json', 'angular.json', 'src/styles.css', 'e2e/acceptance/onb-09.spec.ts', 'e2e/acceptance/.output/.last-run.json', 'e2e/acceptance/support/site-08', 'e2e/acceptance/site-8.spec.ts'];
    expect(outside(never).length, 'the rule refuses every path of the must-reject table').toBe(never.length);
    expect(never.filter((f) => allowed(f) && !refused(f) && !/\.\./.test(f)), 'none of them is in the allow-list unless a refusal catches it').toEqual([]);
    // The state of the repository, whatever the diff: the card is built (no skip here, so develop fails this).
    const learnDir = join(PEPLA_WEB, 'src', 'app', 'ds', 'site', 'learn');
    const built = existsSync(learnDir) ? readdirSync(learnDir, { recursive: true, encoding: 'utf8' }).filter((f) => /\.ts$/.test(f) && !/\.spec\.ts$/.test(f)) : [];
    expect(built.length, 'src/app/ds/site/learn/ holds at least one .ts file that is not a spec (the Learn more frame is built)').toBeGreaterThan(0);
    const routes = join(PEPLA_WEB, 'src', 'app', 'app.routes.ts');
    expect(existsSync(routes) && /dev\/site-learn/.test(readFileSync(routes, 'utf8')), 'src/app/app.routes.ts holds a dev/site-learn route').toBe(true);
    const changed = changedFiles();
    test.skip(!changed.some(isThisCard), 'this pull request changes none of the Learn more frame\'s files');
    expect(outside(changed), 'this card changes only the site, the public pages, the route files, the design system README and the site tests').toEqual([]);
    expect(changed.filter(refused), 'ds/all.ts and the signed-in features are untouched').toEqual([]);
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

  // ---------------------------------------------------------------- AC-12
  test('AC-12 the page helper: every check passes on the gallery\'s sample page and fails on a planted fault', async ({ browser, baseURL, page }) => {
    test.setTimeout(25 * 60_000);
    const env = { browser, baseURL: baseURL!, page };
    const spec = learnSampleSpec(deviceOf(page));
    expect(existsSync(join(PEPLA_WEB, 'e2e', 'acceptance', 'support', 'site-08', 'learn-page.ts')), 'support/site-08/learn-page.ts exists').toBe(true);
    // The sample page passes every check.
    await checkPageParity(env, spec);
    await checkPageWords(env, spec);
    await checkTop(env, spec);
    await checkSubmenu(env, spec);
    await checkSections(env, spec);
    await checkDemoView(env, spec);
    await checkEnding(env, spec);
    await checkAccessibility(env, spec);
    await checkMotion(env, spec); // lock check T5: the motion check was never run on the sample, so SITE-09 to SITE-14 would have been its first user
    // Planted faults, edited into the page after it has loaded, each caught by the check that names it.
    await expect(checkSubmenu(env, spec, { plant: (p) => p.evaluate(() => { const t = document.querySelector('.pp-site-subnav__tabs')!; const l = t.querySelectorAll('.pp-site-subnav__link'); t.insertBefore(l[1]!, l[0]!); }) }), 'a wrong tab order fails the sub-menu check').rejects.toThrow();
    await expect(checkEnding(env, spec, { plant: (p) => p.evaluate(() => document.querySelector('.pp-site-faq__item:nth-child(2)')!.remove()) }), 'a missing question fails the ending check').rejects.toThrow();
    await expect(checkSections(env, spec, { deaf: true }), 'a demo that never plays fails the sections check').rejects.toThrow();
    await expect(checkDemoView(env, spec, { deaf: true }), 'a demo that never starts when it is in view fails the view check').rejects.toThrow();
    await expect(checkTop(env, spec, { plant: (p) => p.evaluate(() => { const h = document.createElement('h1'); h.textContent = 'A second headline'; document.querySelector('.pp-site-form-page__intro')!.appendChild(h); }) }), 'two h1 fail the page top check').rejects.toThrow();
    await expect(checkPageWords(env, spec, { plant: (p) => p.evaluate(() => { const e = document.querySelector('.pp-site-faq__a-text')!; e.textContent = (e.textContent ?? '') + ' Extra.'; }) }), 'a changed word fails the words check').rejects.toThrow();
    await expect(checkMotion(env, spec, { plant: (p) => p.evaluate(() => { (document.querySelector('nav[aria-label="On this page"]') as HTMLElement).style.width = '300px'; }) }), 'an inline width fails the motion check').rejects.toThrow();
    await expect(checkAccessibility(env, spec, { plant: (p) => p.evaluate(() => { document.querySelector('.pp-site-faq__list')!.insertAdjacentHTML('beforeend', '<div aria-hidden="true"><button type="button">Hidden</button></div>'); }) }), 'a focusable control inside an aria-hidden container fails the accessibility check').rejects.toThrow();
    await expect(checkPageParity(env, spec, { plant: (p) => p.evaluate(() => { (document.querySelector('.pp-site-form-page__lead') as HTMLElement).style.paddingTop = '4px'; }) }), 'four more pixels above the lead fail the parity check').rejects.toThrow();
    // Lock check T10: the planted fault used to be `margin-top: 4px`, which does not move anything (it collapses into the 24px margin of the headline above), so the plant passed the check
    // it was meant to fail. Four real pixels are planted instead.
    // (margin-top: 4px alone changes nothing on the page, so it is no fault: it is not planted.)
  });
});
void inner; void exampleId; void pieceByName; void checkPageParity;
