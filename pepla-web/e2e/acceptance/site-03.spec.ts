import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { PEPLA_WEB, KEYS, SECTION, STILL, FREEZE_VIEW, FREEZE_SCROLL, GATED_VIEW, fromFirstChange, sameTimeline, timeline, type Kind, type Step, bodyOf, compareSection, deviceOf, exampleName, galleryId, gotoLanding, openKit, rootOf, sec, settle, sleep, wordsOf, type Device, type Key } from './support/site-03/landing';

/**
 * SITE-03 · Landing sections part 1: pilot bar, hero Ask Batsi peek, Modules, Ask Batsi, Recruitment, Onboarding.
 * No backend. Runs against `ng serve` through E2E_BASE_URL. See cards/site-03.md for the gallery contract.
 * The desktop device is read in a 1456 wide window (the stage is then the kit's 1440), the phone device at 390.
 */

const once = (why: string) => test.skip(((test.info().project.name === 'phone-390')), why);
const isPhone = (page: import('@playwright/test').Page) => deviceOf(page) === 'phone';
const WIDE = { width: 1456, height: 900 };


// -------------------------------------------------------------------------------------------- shared scenario helpers

const SEC_ID = (k: Key, d: Device) => galleryId(k, d);
const APP_SCOPE = (k: Key, d: Device) => `section[data-example="${exampleName(k, d)}"] [data-example-body] ${SECTION[k].app}`;
const KIT_SCOPE = (k: Key, d: Device) => SECTION[k].kit(d);

type World = { ctx: BrowserContext; app: Page; kit: Page; d: Device };

/** A fresh browser context with one Angular page (only `k`'s gallery section) and one kit page, both with views gated until the test fires them. */
async function world(browser: Browser, baseURL: string, page: Page, k: Key, extra: object = {}, gated = true): Promise<World> {
  const d = deviceOf(page);
  const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone', ...extra });
  if (gated) await ctx.addInitScript(GATED_VIEW);
  const app = await ctx.newPage();
  await gotoLanding(app, [SEC_ID(k, d)]);
  const kit = await ctx.newPage();
  await kit.setViewportSize(page.viewportSize()!);
  const w = await app.locator('.pp-site-stage').first().evaluate((el) => el.getBoundingClientRect().width);
  await openKit(kit, new URL(baseURL).origin, d, true, w);
  return { ctx, app, kit, d };
}

/** Record `kind` on one page while `act` runs in it (after 100ms). */
async function record(p: Page, kind: Kind, scope: string, ms: number, act: (p: Page) => Promise<void>): Promise<Step[]> {
  const rec = timeline(p, kind, scope, ms);
  await sleep(100);
  await act(p);
  return rec;
}
/** Click the moment the element exists, without Playwright's waiting for it to be stable (that wait differs from page to page and would move the timings). */
// Looks every 10ms: Playwright's own waitFor backs off to 500ms between looks, which alone can put the click 450ms off the kit's (lock check fix).
const present = async (l: Locator, timeout = 12_000): Promise<void> => { const end = Date.now() + timeout; while ((await l.count()) === 0) { if (Date.now() > end) throw new Error(`nothing to press after ${timeout}ms`); await sleep(10); } };
const hit = async (l: Locator, timeout = 12_000): Promise<void> => { await present(l, timeout); await l.evaluate((el) => (el as HTMLElement).click()); };
const fire = async (p: Page) => { await p.evaluate(() => (window as unknown as { __fireView: () => void }).__fireView()); };

/** Drop a state that lasts under 45ms (one frame between a class and its text moving): the order of the states that stay is what is judged. */
const settled = (steps: Step[]): Step[] => steps.filter((s, i) => i === steps.length - 1 || steps[i + 1]!.t - s.t >= 45);

async function expectSame(label: string, app: Step[], kit: Step[], tol: number): Promise<void> {
  const a = settled(fromFirstChange(app)), k = settled(fromFirstChange(kit));
  expect(k.length, `${label}: the kit page moved at all`).toBeGreaterThan(1);
  const r = sameTimeline(a, k, tol);
  expect(a.map((s) => s.sig), `${label}: the page passes through the same states, in the same order, as the kit`).toEqual(k.map((s) => s.sig));
  expect(r.late, `${label}: each state shows within ${tol}ms of when the kit shows it`).toEqual([]);
}

// Both pages are drawn the same way on every machine: no sub-pixel (LCD) text and no font hinting. A page whose text sits on a
// see-through layer is drawn with grey edges and one that does not with coloured ones on a runner whose fonts allow it, which
// shows as a few percent of "different" pixels with every box in place.
test.use({ launchOptions: { args: ['--disable-lcd-text', '--font-render-hinting=none'] } });

test.describe('SITE-03 Landing sections, part 1', () => {
  test.beforeEach(async ({ page }) => {
    if (!isPhone(page)) await page.setViewportSize(WIDE);
  });

  // ---------------------------------------------------------------- AC-1
  test('AC-1 one gallery section per landing section, in the kit order, with the kit words and none of the old names', async ({ page, context }) => {
    test.setTimeout(120_000);
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
    // The words: the kit's landing page (its markup at the first step) against the gallery section, every text node and accessible name.
    const kitPage = await context.newPage();
    try {
      await kitPage.setViewportSize(page.viewportSize()!);
      const stageW = await page.locator('.pp-site-stage').first().evaluate((el) => el.getBoundingClientRect().width);
      await openKit(kitPage, new URL(page.url()).origin, d, false, stageW);
      for (const k of KEYS) {
        const live = k === 'modules' ? '.pp-site-tile__ask' : '';
        const kit = await kitPage.evaluate(wordsOf, [SECTION[k].kit(d), live] as [string, string]);
        const app = await page.evaluate(wordsOf, [`section[data-example="${exampleName(k, d)}"] [data-example-body] ${SECTION[k].app}`, live] as [string, string]);
        expect(app.texts, `${k}: the words on the page are the kit's words`).toEqual(kit.texts);
        expect(app.names, `${k}: the accessible names are the kit's names`).toEqual(kit.names);
        const all = [...app.texts, ...app.names].join(' | ');
        expect(all, `${k}: no "Masked"`).not.toMatch(/masked/i);
        expect(all, `${k}: no "pepla"`).not.toMatch(/pepla/i);
      }
    } finally {
      await kitPage.close();
    }
    const html = await page.content();
    expect(html, 'the gallery holds no "pepla" in text, attribute, class or href').not.toMatch(/pepla/i);
  });

  // ---------------------------------------------------------------- AC-2
  test('AC-2 each section matches the kit at its first step and again at its last step', async ({ page, browser, baseURL }) => {
    test.setTimeout(10 * 60_000);
    const d = deviceOf(page);
    const origin = new URL(baseURL!).origin;
    const stageWidth = async (p: import('@playwright/test').Page) => p.locator('.pp-site-stage').first().evaluate((el) => el.getBoundingClientRect().width);

    const run = async (label: string, reduced: boolean) => {
      for (const k of KEYS) {
        const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone', reducedMotion: reduced ? 'reduce' : 'no-preference' });
        try {
          const p = await ctx.newPage();
          // First step: nothing is ever "in view", so no demo starts and nothing arrives. Last step: reduced motion, each demo shows its end at once.
          if (!reduced) await ctx.addInitScript(FREEZE_VIEW);
          await ctx.addInitScript(FREEZE_SCROLL);
          await gotoLanding(p, [galleryId(k, d)]);
          const kp = await ctx.newPage();
          await kp.setViewportSize(page.viewportSize()!);
          await openKit(kp, origin, d, true, await stageWidth(p));
          await settle(kp);
          if (k === 'onboarding' && reduced) { /* the story's last step is judged in AC-7 */ }
          if (reduced) { await sleep(1800); }
          await settle(p);
          const r = await compareSection(p, kp, k, d, k === 'modules' ? '.pp-site-tile__ask' : '');
          expect(r.kitElements, `${label} ${k}: the kit section has elements`).toBeGreaterThanOrEqual(k === 'pilot' ? 3 : 10);
          expect(r.unmatched, `${label} ${r.name}: every kit element is on the page`).toEqual([]);
          expect(r.moved, `${label} ${r.name}: every box is within 1px`).toEqual([]);
          expect(r.pixelRatio, `${label} ${r.name}: at most 1% of pixels differ`).toBeLessThanOrEqual(0.01);
        } finally {
          await ctx.close();
        }
      }
    };
    await run('first step', false);
    await run('last step', true);
  });

  // ---------------------------------------------------------------- AC-3
  test('AC-3 the pilot bar scrolls away with the page; the Ask Batsi button opens the peek, which plays the kit conversation', async ({ browser, baseURL, page }) => {
    test.setTimeout(4 * 60_000);
    const d = deviceOf(page);
    // The pilot bar: its words are the kit's (AC-1); it is part of the page flow, not pinned.
    await gotoLanding(page, [SEC_ID('pilot', d), SEC_ID('hero', d)]);
    const pilot = rootOf(page, 'pilot', d);
    const flow = await pilot.evaluate((el) => { const out: string[] = []; for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') out.push(`${n.tagName.toLowerCase()}.${n.className} is ${p}`); } return out; });
    expect(flow, 'the pilot bar and everything around it scroll with the page (nothing pinned)').toEqual([]);
    const before = await pilot.evaluate((el) => el.getBoundingClientRect().bottom);
    await page.evaluate(() => window.scrollBy(0, 30));
    await sleep(150);
    const after = await pilot.evaluate((el) => el.getBoundingClientRect().bottom);
    expect(Math.round(before - after), 'after 30px of scrolling the bar has moved up by 30px').toBe(30);
    expect(await pilot.getByRole('link', { name: 'Book a demo', exact: true }).count(), 'the bar has its "Book a demo" link').toBe(1);

    // The peek, against the kit's script: closed at first, opened by the button, the same lines at the same times.
    for (const who of ['send', 'later'] as const) {
      const run = async (isKit: boolean): Promise<Step[]> => {
        const w = await world(browser, baseURL!, page, 'hero');
        try {
          const p = isKit ? w.kit : w.app;
          const scope = isKit ? (w.d === 'desktop' ? '#lpd-peek' : '#lpp-peek') : `section[data-example="${exampleName('hero', w.d)}"] .pp-site-peek`;
          const heroRoot = isKit ? p.locator(SECTION.hero.kit(w.d)) : p.locator(APP_SCOPE('hero', w.d));
          const ask = heroRoot.getByRole('button', { name: 'Ask Batsi', exact: true });
          await expect(ask, 'the hero has an "Ask Batsi" button').toHaveAttribute('aria-expanded', 'false');
          const dialog = p.getByRole('dialog', { name: 'Ask Batsi, sample conversation', includeHidden: true });
          expect(await dialog.getAttribute('aria-hidden'), 'the peek starts hidden').toBe('true');
          return await record(p, 'peek', scope, 6600, async () => {
            await ask.click();
            await expect(ask).toHaveAttribute('aria-expanded', 'true');
            await expect(dialog).not.toHaveAttribute('aria-hidden', 'true');
            await sleep(3900);
            await hit(dialog.getByRole('button', { name: who === 'send' ? 'Send reminder' : 'Not now', exact: true }));
          });
        } finally {
          await w.ctx.close();
        }
      };
      const app = await run(false);
      const kit = await run(true);
      await expectSame(`peek (${who})`, app, kit, 400);
      const last = fromFirstChange(app).at(-1)!.sig;
      expect(last, `peek (${who}): ends with Batsi's answer`).toContain(who === 'send' ? 'Sent to John Doe at 09:42. Logged as approved by you.' : 'Okay. I’ll remind you tomorrow at 09:00.');
    }
    // Close gives focus back to the button.
    const w = await world(browser, baseURL!, page, 'hero');
    try {
      const ask = w.app.locator(APP_SCOPE('hero', w.d)).getByRole('button', { name: 'Ask Batsi', exact: true });
      await ask.click();
      const dialog = w.app.getByRole('dialog', { name: 'Ask Batsi, sample conversation' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(ask).toHaveAttribute('aria-expanded', 'false');
      await expect(w.app.getByRole('dialog', { name: 'Ask Batsi, sample conversation', includeHidden: true })).toHaveAttribute('aria-hidden', 'true');
      await expect(ask, 'closing the peek returns focus to the Ask Batsi button').toBeFocused();
    } finally {
      await w.ctx.close();
    }
  });

  // ---------------------------------------------------------------- AC-4
  test('AC-4 the Modules row: seven module cards and the Ask Batsi card, which types the kit questions at the kit pace without moving the layout', async ({ browser, baseURL, page }) => {
    test.setTimeout(3 * 60_000);
    const d = deviceOf(page);
    await gotoLanding(page, [SEC_ID('modules', d)]);
    const tiles = bodyOf(page, 'modules', d).locator('.pp-site-tiles > *');
    expect(await tiles.count(), 'seven module cards and the Ask Batsi card').toBe(8);
    expect(await bodyOf(page, 'modules', d).locator('a.pp-site-tile').count(), 'every card is a link (the Ask Batsi card too)').toBe(8);
    expect(await bodyOf(page, 'modules', d).locator('.pp-site-tile__ask').count(), 'one asks').toBe(1);

    const run = async (isKit: boolean): Promise<{ steps: Step[]; heights: number[] }> => {
      const w = await world(browser, baseURL!, page, 'modules');
      try {
        const p = isKit ? w.kit : w.app;
        const sectionSel = isKit ? KIT_SCOPE('modules', w.d) : APP_SCOPE('modules', w.d);
        const ask = `${sectionSel} .pp-site-tile__ask`;
        const heights = p.evaluate((sel) => new Promise<number[]>((res) => { const out: number[] = []; const el = document.querySelector(sel as string)!; const t0 = performance.now(); const tick = () => { out.push(Math.round(el.getBoundingClientRect().height * 10) / 10); if (performance.now() - t0 > 9500) return res(out); setTimeout(tick, 25); }; tick(); }), sectionSel);
        const steps = await record(p, 'ask', ask, 9500, async () => { await fire(p); });
        return { steps, heights: await heights };
      } finally {
        await w.ctx.close();
      }
    };
    const app = await run(false);
    const kit = await run(true);
    expect(new Set(app.heights).size, 'while it types the Modules section keeps one height').toBe(1);
    const QS = ['Who hasn’t sent their documents?', 'Which certificates expire this month?'];
    const texts = fromFirstChange(app.steps).map((s) => s.sig);
    for (const q of QS) expect(texts, `it types the whole of "${q}"`).toContain(q);
    expect(texts.every((t) => QS.concat('Who is on leave next week?', 'Which candidates are waiting on feedback?').some((q) => q.startsWith(t) || t === '')), 'every state is the start of one of the four questions').toBe(true);
    // Every letter is a state, and a 20ms look can miss one on either page, so the two are compared by the whole questions and the empty line.
    const milestones = (steps: Step[]) => fromFirstChange(steps).filter((x) => x.sig === '' || QS.concat('Who is on leave next week?', 'Which candidates are waiting on feedback?').includes(x.sig));
    expect(texts.filter((t) => t !== '' && !QS.includes(t)).length, 'it types letter by letter (many partial states)').toBeGreaterThan(30);
    const am = milestones(app.steps), km = milestones(kit.steps);
    expect(am.map((x) => x.sig), 'the full questions and the empty line come in the kit order').toEqual(km.map((x) => x.sig));
    expect(am.map((x, i) => Math.abs(x.t - km[i]!.t)).filter((v) => v > 450), 'each question is whole, and the line empty, within 450ms of the kit').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-5
  test('AC-5 Ask Batsi: three questions of 11s, the action pressed after 2.6s; pressing a question stops the cycle for good; the buttons end as the kit ends', async ({ browser, baseURL, page }) => {
    test.setTimeout(6 * 60_000);
    const d = deviceOf(page);
    // The automatic run, against the kit: the first question, its rows, its action pressed, then the second question at 11s.
    const auto = async (isKit: boolean) => {
      const w = await world(browser, baseURL!, page, 'batsi');
      try {
        const p = isKit ? w.kit : w.app;
        return await record(p, 'batsi', isKit ? KIT_SCOPE('batsi', w.d) : APP_SCOPE('batsi', w.d), 13_500, async () => { await fire(p); });
      } finally { await w.ctx.close(); }
    };
    const a = await auto(false);
    const k = await auto(true);
    await expectSame('the automatic run', a, k, 450);
    const sigs = fromFirstChange(a).map((s) => s.sig);
    expect(sigs.some((s) => s.includes('Request sent to John Doe. Approved by Jane Smith, 09:42')), 'the automatic run ends the first question with the action approved').toBe(true);
    expect(sigs.at(-1)!.startsWith('010'), 'after 11s the second tab is the selected one').toBe(true);

    // A person pressing: the cycle stops for good and the chosen question plays; the buttons end as the kit's do.
    for (const press of [{ tab: 1, button: 'Send reminders', end: 'Reminders sent to 2 new employees. Approved by Jane Smith, 09:42' }, { tab: 2, button: 'Not now', end: 'Nothing sent. Batsi will ask again tomorrow at 09:00.' }]) {
      const run = async (isKit: boolean) => {
        const w = await world(browser, baseURL!, page, 'batsi');
        try {
          const p = isKit ? w.kit : w.app;
          const root = p.locator(isKit ? KIT_SCOPE('batsi', w.d) : APP_SCOPE('batsi', w.d));
          const scope = isKit ? KIT_SCOPE('batsi', w.d) : APP_SCOPE('batsi', w.d);
          await fire(p);
          // Let the automatic run show its first question (at 100ms) before the recording starts, so the press (about 130ms after the
          // recording starts) never races it; the typing comes at 700ms (lock check fix).
          await sleep(250);
          return await record(p, 'batsi', scope, 17_000, async () => {
            await hit(root.getByRole('tab').nth(press.tab));
            // The action shows for 300ms before it is pressed, on both pages, so that state is long enough to be compared (lock check fix).
            const action = root.getByRole('button', { name: press.button, exact: true });
            await present(action);
            await sleep(300);
            await hit(action);
          });
        } finally { await w.ctx.close(); }
      };
      const app = await run(false);
      const kit = await run(true);
      const sg = fromFirstChange(app).map((s) => s.sig);
      expect(sg.every((s) => s.split('|')[1] === 'paused' || s.split('|')[1] === 'auto'), 'states carry the paused flag').toBe(true);
      expect(sg.at(-1)!, `after pressing question ${press.tab + 1} the tab list is paused, and 17s later it is still on that question`).toMatch(new RegExp(`^${'0'.repeat(press.tab)}1${'0'.repeat(2 - press.tab)}\\|paused`));
      expect(sg.at(-1)!, `"${press.button}" ends with "${press.end}"`).toContain(press.end);
      await expectSame(`pressing question ${press.tab + 1} then "${press.button}"`, app, kit, 450);
    }
  });

  // ---------------------------------------------------------------- AC-6
  test('AC-6 Recruitment: Candidate 4 to Interview, Candidate 1 to Hired, Candidate 3 at risk, the draft types and is sent; Replay, Send and Edit work', async ({ browser, baseURL, page }) => {
    test.setTimeout(6 * 60_000);
    const d = deviceOf(page);
    const scopeOf = (isKit: boolean, dev: Device) => (isKit ? KIT_SCOPE('recruitment', dev) : APP_SCOPE('recruitment', dev));
    const run = async (isKit: boolean, how: 'auto' | 'send' | 'replay') => {
      const w = await world(browser, baseURL!, page, 'recruitment');
      try {
        const p = isKit ? w.kit : w.app;
        const root = p.locator(scopeOf(isKit, w.d));
        return await record(p, 'rec', scopeOf(isKit, w.d), how === 'auto' ? 10_000 : how === 'send' ? 7000 : 15_000, async () => {
          await fire(p);
          if (how === 'send') { await sleep(4700); await hit(root.locator('.pp-site-hiring__row .pp-button--primary')); }
          if (how === 'replay') { await sleep(9500); await hit(root.locator('.pp-site-replay')); }
        });
      } finally { await w.ctx.close(); }
    };
    for (const how of ['auto', 'send', 'replay'] as const) {
      const app = await run(false, how);
      const kit = await run(true, how);
      await expectSame(`the ${how} run`, app, kit, 450);
      const sigs = fromFirstChange(app).map((x) => x.sig);
      if (how === 'auto') {
        // What the card says: moves, a count in each column head, the draft typed and then sent.
        expect(sigs.some((x) => /^\d.*\|/.test(x)), 'the board has counts').toBe(true);
        expect(sigs.at(-1)!, 'the run ends with the draft sent and Candidate 3 done').toMatch(/pp-site-hiring__draft--sent/);
        expect(sigs.at(-1)!, 'Candidate 3 shows "Reminder sent"').toContain('Reminder sent');
        expect(sigs.some((x) => x.includes('Offer signed · starts 1 Dec')), 'Candidate 1 note changes to "Offer signed · starts 1 Dec"').toBe(true);
        expect(sigs.some((x) => /draft [^|]*empty|draft pp-site-hiring__draft typing/.test(x) || x.includes('typing')), 'the draft types out').toBe(true);
      }
      if (how === 'send') expect(sigs.at(-1)!, 'Send by hand ends with the draft sent at once').toMatch(/pp-site-hiring__draft--sent/);
    }
    // Edit makes the draft editable and puts the caret in it.
    const w = await world(browser, baseURL!, page, 'recruitment');
    try {
      const root = w.app.locator(APP_SCOPE('recruitment', w.d));
      await fire(w.app);
      await sleep(4800);
      await hit(root.getByRole('button', { name: 'Edit', exact: true }));
      const body = root.locator('.pp-site-hiring__body');
      await expect(body, 'Edit makes the draft editable').toHaveAttribute('contenteditable', 'true');
      await expect(body, 'and moves the cursor into it').toBeFocused();
    } finally { await w.ctx.close(); }
  });

  // ---------------------------------------------------------------- AC-7
  test('AC-7 Onboarding story: six steps, the pinned John Doe card follows the step in view, the ID document is read and accepted, as the kit does', async ({ browser, baseURL, page }) => {
    test.setTimeout(6 * 60_000);
    const d = deviceOf(page);
    const storySig = (p: Page, scope: string): Promise<string> => p.evaluate((sc) => {
      const sec = document.querySelector(sc)!;
      const cls = (e: Element) => Array.from(e.classList).filter((c) => !/^pp-site-reveal/.test(c)).sort().join('.');
      const t = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
      return JSON.stringify({
        steps: Array.from(sec.querySelectorAll('.pp-site-story__step')).map((e) => cls(e).replace('pp-site-story__step', '').replace(/^\./, '') || '-'),
        count: t(sec.querySelector('.pp-site-person__count span:last-child')),
        now: t(sec.querySelector('.pp-site-person__now')),
        fill: (sec.querySelector('.pp-site-person__fill') as HTMLElement | null)?.style.getPropertyValue('--_p'),
        views: Array.from(sec.querySelectorAll('.pp-site-person__view')).map((e) => (e.classList.contains('pp-site-person__view--on') ? 'on' : 'off') + (e.getAttribute('aria-hidden') ?? '')),
        state: Array.from(sec.querySelectorAll('.pp-site-person__head .pp-site-state__item')).map((e) => (e.classList.contains('pp-site-state__item--on') ? 'on' : 'off') + (e.getAttribute('aria-hidden') ?? '')),
      });
    }, scope);
    const goTo = async (p: Page, scope: string, i: number) => {
      await p.evaluate(([sc, n]) => {
        const steps = Array.from(document.querySelector(sc as string)!.querySelectorAll('.pp-site-story__step'));
        const top = steps[n as number]!.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.45;
        window.scrollTo(0, Math.max(0, top));
      }, [scope, i] as const);
      await sleep(350);
    };
    const run = async (isKit: boolean) => {
      const w = await world(browser, baseURL!, page, 'onboarding', {}, false);
      try {
        const p = isKit ? w.kit : w.app;
        const scope = isKit ? KIT_SCOPE('onboarding', w.d) : APP_SCOPE('onboarding', w.d);
        const n = await p.locator(`${scope} .pp-site-story__step`).count();
        const seen: string[] = [];
        for (let i = 0; i < n; i++) { await goTo(p, scope, i); seen.push(await storySig(p, scope)); }
        await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await sleep(350);
        seen.push(await storySig(p, scope));
        // The ID document step: one step above, then onto it, and the read plays from there.
        await goTo(p, scope, 1);
        const read = await record(p, 'read', scope, 6200, async () => { await goTo(p, scope, 2); });
        return { n, seen, read };
      } finally { await w.ctx.close(); }
    };
    const app = await run(false);
    const kit = await run(true);
    expect(app.n, 'the story has six steps').toBe(6);
    expect(app.seen, 'at each step, the card, the count, the line, the stage and the view are the kit’s').toEqual(kit.seen);
    expect(new Set(app.seen).size, 'the card changes as the steps change').toBeGreaterThanOrEqual(5);
    await expectSame('the ID document read (fields, suggestion, Accept pressed, follow-up)', app.read, kit.read, 450);
    const last = fromFirstChange(app.read).at(-1)!.sig;
    expect(last, 'the read ends with every field in, the suggestion shown, the decision done and the follow-up shown').toBe('go v1111 s1 pressed1 done1 f1');
    // Accept by hand finishes the read at once. On the phone the kit hides the person card (display none), so there is nothing to press.
    if (d === 'phone') return;
    const w = await world(browser, baseURL!, page, 'onboarding', {}, false);
    try {
      const scope = APP_SCOPE('onboarding', w.d);
      await goTo(w.app, scope, 1);
      await goTo(w.app, scope, 2);
      await sleep(600);
      await hit(w.app.locator(scope).getByRole('button', { name: 'Accept document', exact: true }));
      await sleep(150);
      const done = await timeline(w.app, 'read', scope, 60);
      expect(done.at(-1)!.sig, 'Accept document finishes the read at once').toMatch(/v1111 s1 .*done1 f1$/);
    } finally { await w.ctx.close(); }
    void d;
  });

  // ---------------------------------------------------------------- AC-8
  test('AC-8 under reduced motion every demo shows its end at once and leaves no timer; data-site-still stops every loop', async ({ browser, baseURL, page }) => {
    test.setTimeout(5 * 60_000);
    const d = deviceOf(page);
    const pending = (p: Page) => p.evaluate(() => (window as unknown as { __ppSiteClock?: { pending(): number } }).__ppSiteClock?.pending() ?? -1);
    // Ask Batsi and Recruitment: the last state is the kit's last state under reduced motion, there at once, and no timer is left.
    for (const k of ['batsi', 'recruitment'] as const) {
      const run = async (isKit: boolean) => {
        const w = await world(browser, baseURL!, page, k, { reducedMotion: 'reduce' }, false);
        try {
          const p = isKit ? w.kit : w.app;
          const scope = isKit ? KIT_SCOPE(k, w.d) : APP_SCOPE(k, w.d);
          await p.locator(scope).scrollIntoViewIfNeeded();
          const steps = await timeline(p, k === 'batsi' ? 'batsi' : 'rec', scope, 900);
          return { last: steps.at(-1)!.sig, pending: isKit ? 0 : await pending(p) };
        } finally { await w.ctx.close(); }
      };
      const app = await run(false);
      const kit = await run(true);
      expect(app.last, `${k}: reduced motion shows the kit's last state`).toBe(kit.last);
      expect(app.pending, `${k}: no timer is left pending (window.__ppSiteClock.pending() is 0)`).toBe(0);
    }
    // The peek: opened, it shows the whole conversation and its action at once.
    {
      const w = await world(browser, baseURL!, page, 'hero', { reducedMotion: 'reduce' }, false);
      try {
        await w.app.locator(APP_SCOPE('hero', w.d)).getByRole('button', { name: 'Ask Batsi', exact: true }).click();
        await sleep(300);
        const dialog = w.app.getByRole('dialog', { name: 'Ask Batsi, sample conversation' });
        expect(await dialog.locator('.pp-site-chat__msg').count(), 'the whole peek conversation is there at once (question, answer, offer)').toBe(3);
        expect(await dialog.locator('.pp-site-chat__typing').count(), 'nothing is still typing').toBe(0);
        expect(await dialog.getByRole('button', { name: 'Send reminder', exact: true }).count(), 'and the action is offered').toBe(1);
        expect(await pending(w.app), 'no timer is left pending').toBe(0);
      } finally { await w.ctx.close(); }
    }
    // The Modules card shows one whole question and does not type.
    {
      const w = await world(browser, baseURL!, page, 'modules', { reducedMotion: 'reduce' }, false);
      try {
        const ask = w.app.locator(`${APP_SCOPE('modules', w.d)} .pp-site-tile__ask`);
        const seen = await timeline(w.app, 'ask', `${APP_SCOPE('modules', w.d)} .pp-site-tile__ask`, 2500);
        expect(seen.length, 'the question never changes').toBe(1);
        expect(['Who hasn’t sent their documents?', 'Which certificates expire this month?', 'Who is on leave next week?', 'Which candidates are waiting on feedback?'], 'it is one whole question').toContain(await ask.innerText());
        expect(await pending(w.app), 'no timer is left pending').toBe(0);
      } finally { await w.ctx.close(); }
    }
    // The story: at the ID document step the read is done at once.
    {
      const w = await world(browser, baseURL!, page, 'onboarding', { reducedMotion: 'reduce' }, false);
      try {
        const scope = APP_SCOPE('onboarding', w.d);
        for (const i of [1, 2]) {
          await w.app.evaluate(([sc, n]) => { const st = Array.from(document.querySelector(sc as string)!.querySelectorAll('.pp-site-story__step')); window.scrollTo(0, Math.max(0, st[n as number]!.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.45)); }, [scope, i] as const);
          await sleep(300);
        }
        const now = await timeline(w.app, 'read', scope, 40);
        expect(now.at(-1)!.sig, 'the ID document read shows its end (fields, suggestion, decision, follow-up) at once').toMatch(/v1111 s1 .*done1 f1$/);
        expect(await pending(w.app), 'no timer is left pending').toBe(0);
      } finally { await w.ctx.close(); }
    }
    // Still mode: with and without it, count the loops that run in the six sections. (The typing caret's blink, `pp-site-blink` on
    // `.pp-site-tile__ask::after`, is left out: the design system has no still rule for it, a finding for the kit, see cards/site-03.md.)
    const loops = async (still: boolean) => {
      const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone' });
      try {
        if (still) await ctx.addInitScript(() => { const set = () => document.documentElement?.setAttribute('data-site-still', ''); set(); new MutationObserver(set).observe(document, { childList: true }); });
        const p = await ctx.newPage();
        await gotoLanding(p, KEYS.map((k) => SEC_ID(k, d)));
        await sleep(1200);
        return p.evaluate(() => document.getAnimations().filter((a) => { const t = a.effect?.getTiming(); return a.playState === 'running' && t?.iterations === Infinity && (a as CSSAnimation).animationName !== 'pp-site-blink'; }).map((a) => { const tg = (a.effect as KeyframeEffect).target as Element; return `${tg.tagName.toLowerCase()}.${String(tg.className).slice(0, 50)} ${(a as CSSAnimation).animationName ?? ''}`; }));
      } finally { await ctx.close(); }
    };
    expect((await loops(false)).length, 'in normal motion the sections have loops that run').toBeGreaterThan(0);
    expect(await loops(true), 'with data-site-still no loop runs').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-9
  test('AC-9 while the demos play, only transform, opacity, clip-path and stroke-dashoffset animate, and no width, height, left or top is ever written', async ({ browser, baseURL, page }) => {
    test.setTimeout(8 * 60_000);
    const d = deviceOf(page);
    const ALLOWED = new Set(['transform', 'opacity', 'clip-path', 'clipPath', 'stroke-dashoffset', 'strokeDashoffset', 'offset', 'easing', 'composite', 'computedOffset']);
    const FORBIDDEN = /^(width|height|left|top|right|bottom|inline-size|block-size|inset(-.*)?|min-(width|height|inline-size|block-size)|max-(width|height|inline-size|block-size)|margin(-.*)?|padding(-.*)?)$/;
    const problems: string[] = [];
    for (const k of KEYS) {
      const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone' });
      try {
        await ctx.addInitScript(() => {
          const w = window as unknown as { __s3: { anim: Set<string>; style: Set<string> } };
          w.__s3 = { anim: new Set(), style: new Set() };
          const FORB = /^(width|height|left|top|right|bottom|inline-size|block-size|inset(-.*)?|min-(width|height|inline-size|block-size)|max-(width|height|inline-size|block-size)|margin(-.*)?|padding(-.*)?)$/;
          const scan = (el: Element) => { const st = (el as HTMLElement).style; if (!st) return; for (let i = 0; i < st.length; i++) { const n = st.item(i); if (FORB.test(n)) w.__s3.style.add(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} sets ${n}`); } };
          const start = () => {
            new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'attributes') scan(m.target as Element); else m.addedNodes.forEach((n) => { if (n.nodeType === 1) { scan(n as Element); (n as Element).querySelectorAll('[style]').forEach(scan); } }); } }).observe(document, { attributes: true, attributeFilter: ['style'], subtree: true, childList: true });
            setInterval(() => {
              for (const a of document.getAnimations()) {
                const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
                if (!t || !t.closest('[data-example-body], .pp-site-stage')) continue;
                const eff = a.effect as KeyframeEffect;
                if ((a as unknown as { transitionProperty?: string }).transitionProperty) w.__s3.anim.add(`${t.tagName.toLowerCase()}.${String(t.className).slice(0, 40)} transitions ${(a as unknown as { transitionProperty: string }).transitionProperty}`);
                else for (const kf of eff.getKeyframes()) for (const key of Object.keys(kf)) w.__s3.anim.add(`${t.tagName.toLowerCase()}.${String(t.className).slice(0, 40)} animates ${key}`);
              }
            }, 30);
          };
          if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
        });
        const p = await ctx.newPage();
        await gotoLanding(p, [SEC_ID(k, d)]);
        const root = p.locator(APP_SCOPE(k, d));
        await root.scrollIntoViewIfNeeded();
        if (k === 'hero') {
          await hit(root.getByRole('button', { name: 'Ask Batsi', exact: true }));
          await sleep(5200);
          await hit(p.getByRole('dialog', { name: 'Ask Batsi, sample conversation' }).getByRole('button', { name: 'Send reminder', exact: true }));
          await sleep(1200);
        } else if (k === 'batsi') {
          await sleep(7600);
          await hit(root.getByRole('tab').nth(1));
          await sleep(7200);
        } else if (k === 'recruitment') {
          await sleep(9000);
          await hit(root.locator('.pp-site-replay'));
          await sleep(9000);
        } else if (k === 'onboarding') {
          for (let i = 0; i < 6; i++) {
            await p.evaluate(([sc, n]) => { const st = Array.from(document.querySelector(sc as string)!.querySelectorAll('.pp-site-story__step')); window.scrollTo(0, Math.max(0, st[n as number]!.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.45)); }, [APP_SCOPE(k, d), i] as const);
            await sleep(i === 2 ? 5600 : 900);
          }
        } else await sleep(k === 'modules' ? 6000 : 1500);
        const seen = await p.evaluate(() => { const r = (window as unknown as { __s3: { anim: Set<string>; style: Set<string> } }).__s3; return { anim: [...r.anim], style: [...r.style] }; });
        const bad = seen.anim.filter((x) => !ALLOWED.has(x.split(' ').at(-1)!) && !x.includes('transitions transform') && !x.includes('transitions opacity') && !/transitions (transform|opacity|clip-path|stroke-dashoffset)/.test(x));
        problems.push(...bad.map((x) => `${k}: ${x}`), ...seen.style.map((x) => `${k}: ${x}`));
        // Whatever is left in the page: no inline width, height, left or top on any element.
        const left = await p.evaluate((re) => { const rx = new RegExp(re); const out: string[] = []; document.querySelectorAll('[style]').forEach((el) => { const st = (el as HTMLElement).style; for (let i = 0; i < st.length; i++) if (rx.test(st.item(i))) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} has inline ${st.item(i)}`); }); return out; }, FORBIDDEN.source);
        problems.push(...left.map((x) => `${k}: ${x}`));
      } finally { await ctx.close(); }
    }
    expect(problems, 'nothing but transform, opacity, clip-path and stroke-dashoffset animates; no inline width, height, left, top (or insets, margins, paddings) is written').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-10
  test('AC-10 replaying, changing tab and leaving the page cancel every clock timer and observer', async ({ browser, baseURL, page }) => {
    test.setTimeout(4 * 60_000);
    const d = deviceOf(page);
    const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, hasTouch: d === 'phone', isMobile: d === 'phone' });
    try {
      // Every IntersectionObserver the page makes is counted while it still watches something.
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
        const live = { get size() { return [...targets.values()].filter((t) => t.size > 0).length; } };
        (window as unknown as { __liveObservers: () => number }).__liveObservers = () => live.size;
      });
      const p = await ctx.newPage();
      // One demo on the page while its timers are counted: the hook sums every live clock, and a neighbour's timers firing or queueing
      // in the same 150ms would move the count (lock check fix).
      await gotoLanding(p, ['land-recruitment-' + d]);
      const hook = () => p.evaluate(() => { const c = (window as unknown as { __ppSiteClock?: { pending(): number; observers(): number } }).__ppSiteClock; return c ? { pending: c.pending(), observers: c.observers() } : null; });
      expect(await hook(), 'the page offers window.__ppSiteClock with pending() and observers() (see cards/site-03.md)').not.toBeNull();
      const rec = p.locator(APP_SCOPE('recruitment', d));
      await rec.scrollIntoViewIfNeeded();
      await sleep(1200);
      const first = (await hook())!.pending;
      expect(first, 'a demo is playing, so timers are queued').toBeGreaterThan(0);
      // Replay three times quickly: the timers of the run it replaces are gone, so the number does not grow.
      const counts: number[] = [];
      for (let i = 0; i < 3; i++) { await hit(rec.locator('.pp-site-replay')); await sleep(150); counts.push((await hook())!.pending); }
      expect(Math.max(...counts) - Math.min(...counts), `after each Replay the same timers are queued (${counts.join(', ')})`).toBeLessThanOrEqual(1);
      // Changing the Ask Batsi tab also replaces its timers.
      await gotoLanding(p, ['land-batsi-' + d]);
      const batsi = p.locator(APP_SCOPE('batsi', d));
      await batsi.scrollIntoViewIfNeeded();
      await sleep(800);
      const tabCounts: number[] = [];
      for (const i of [1, 2, 0, 1]) { await hit(batsi.getByRole('tab').nth(i)); await sleep(150); tabCounts.push((await hook())!.pending); }
      expect(Math.max(...tabCounts) - Math.min(...tabCounts), `after each tab press the same timers are queued (${tabCounts.join(', ')})`).toBeLessThanOrEqual(2);
      // The tab goes to the background: every timer is cancelled.
      await gotoLanding(p, ['land-batsi-' + d, 'land-recruitment-' + d, 'land-hero-' + d, 'land-modules-' + d]);
      await rec.scrollIntoViewIfNeeded();
      await sleep(800);
      expect((await hook())!.pending, 'demos are playing before the tab is hidden').toBeGreaterThan(0);
      await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
      await sleep(300);
      expect((await hook())!.pending, 'a hidden tab holds no timer').toBe(0);
      await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
      // Leave the page (a client-side navigation to the sign-in page): nothing is left running or watching.
      await rec.scrollIntoViewIfNeeded();
      await sleep(600);
      await p.evaluate(() => { history.pushState({}, '', '/sign-in'); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); });
      await expect(p.getByRole('heading', { name: 'Sign in', exact: true }), 'the router left the gallery').toBeVisible({ timeout: 15_000 });
      await sleep(500);
      expect(await hook(), 'after leaving, no clock timer and no clock observer is left').toEqual({ pending: 0, observers: 0 });
      expect(await p.evaluate(() => (window as unknown as { __liveObservers: () => number }).__liveObservers()), 'and no IntersectionObserver is still watching anything').toBe(0);
    } finally { await ctx.close(); }
  });

  // ---------------------------------------------------------------- AC-11
  test('AC-11 sections follow their own width, every control works from the keyboard with a visible focus ring, and axe finds nothing serious', async ({ browser, baseURL, page }) => {
    test.setTimeout(10 * 60_000);
    const d = deviceOf(page);
    const origin = new URL(baseURL!).origin;
    // Own width: a middle width (800), in a window as wide as the desktop one, laid out as the kit lays the same section out.
    if (d === 'desktop') {
      for (const k of KEYS.filter((x) => x !== 'pilot')) {
        const ctx = await browser.newContext({ baseURL, viewport: page.viewportSize()!, reducedMotion: 'no-preference' });
        try {
          await ctx.addInitScript(FREEZE_VIEW);
          await ctx.addInitScript(FREEZE_SCROLL);
          const p = await ctx.newPage();
          // The phone stage, widened to 800: the desktop stage has min-width 1280 (above every site breakpoint), so at "800" it stayed
          // 1280 wide and a section that followed the 1456 window instead of its own width passed (lock check fix).
          await gotoLanding(p, [SEC_ID(k, 'phone')]);
          await p.locator('.pp-site-stage').first().evaluate((el) => { (el as HTMLElement).style.width = '800px'; });
          const kp = await ctx.newPage();
          await kp.setViewportSize(page.viewportSize()!);
          await openKit(kp, origin, 'phone', true, 800);
          await settle(kp);
          // The kit's sticky header is drawn over its hero but is not part of it (SITE-02's part, not in this gallery section): at 800 it
          // alone is over 1% of the hero's pixels (lock check fix).
          if (k === 'hero') await kp.addStyleTag({ content: '.pp-site-header{visibility:hidden!important}' });
          await settle(p);
          expect(await p.locator('.pp-site-stage').first().evaluate((el) => Math.round(el.getBoundingClientRect().width)), `${k}: the stage is 800 wide`).toBe(800);
          const r = await compareSection(p, kp, k, 'phone', k === 'modules' ? '.pp-site-tile__ask' : '');
          expect(r.unmatched, `${k} at 800 wide: every kit element is on the page`).toEqual([]);
          expect(r.moved, `${k} at 800 wide: every box is within 1px of the kit`).toEqual([]);
          expect(r.pixelRatio, `${k} at 800 wide: at most 1% of pixels differ`).toBeLessThanOrEqual(0.01);
        } finally { await ctx.close(); }
      }
    }
    // Keyboard and axe, on all six sections, with motion reduced so every demo sits in its end state and no control comes or goes while Tab walks.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoLanding(page, KEYS.map((k) => SEC_ID(k, d)));
    await page.addStyleTag({ content: STILL });
    const problems: string[] = [];
    for (const k of KEYS) {
      const scope = APP_SCOPE(k, d);
      const root = page.locator(scope);
      await root.scrollIntoViewIfNeeded();
      // Everything a person can press in the section.
      const wanted = await root.evaluate((el) => Array.from(el.querySelectorAll('button, a[href], [role="tab"], [contenteditable="true"]')).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[inert], [hidden], [aria-hidden="true"]') && getComputedStyle(e).visibility !== 'hidden'; }).map((e) => `${e.tagName.toLowerCase()}:${(e.textContent ?? e.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim().slice(0, 14)}`));
      expect(wanted.length, `${k}: has controls`).toBeGreaterThan(0);
      await page.evaluate((sc) => { const first = document.querySelector(sc)!; (document.activeElement as HTMLElement | null)?.blur(); const probe = document.createElement('button'); probe.id = 's3-probe'; probe.textContent = 'probe'; probe.style.cssText = 'position:fixed;left:0;top:0;opacity:0'; first.parentElement!.insertBefore(probe, first); probe.focus(); }, scope);
      const reached = new Set<string>();
      for (let i = 0; i < wanted.length + 25; i++) {
        await page.keyboard.press('Tab');
        const at = await page.evaluate((sc) => {
          const a = document.activeElement as HTMLElement | null;
          if (!a || !a.closest(sc)) return null;
          const cs = getComputedStyle(a);
          const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
          return { id: `${a.tagName.toLowerCase()}:${(a.textContent ?? a.getAttribute('aria-label') ?? '').replace(/\s+/g, ' ').trim().slice(0, 14)}`, ring, visibleFocus: a.matches(':focus-visible') };
        }, scope);
        if (at) { reached.add(at.id); if (!at.ring || !at.visibleFocus) problems.push(`${k}: ${at.id} takes focus without a visible ring`); }
        else if (reached.size >= wanted.length) break;
      }
      await page.evaluate(() => document.getElementById('s3-probe')?.remove());
      const missing = wanted.filter((w) => ![...reached].includes(w));
      if (missing.length) problems.push(`${k}: the keyboard never reaches ${missing.join(', ')}`);
      // No serious or critical issue.
      const axe = await new AxeBuilder({ page }).include(scope).exclude('.pp-site-shine__copy').withTags(['wcag2a', 'wcag2aa']).analyze();
      for (const v of axe.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) problems.push(`${k}: axe ${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
    }
    expect(problems, 'every control is reached with Tab and shows a focus ring; axe finds no serious or critical issue').toEqual([]);
    // Operable by key: Enter on a question tab, on Replay, and on the Ask Batsi button.
    const batsi = page.locator(APP_SCOPE('batsi', d));
    await batsi.getByRole('tab').nth(2).focus();
    await page.keyboard.press('Enter');
    await expect(batsi.getByRole('tab').nth(2), 'Enter on a question tab selects it').toHaveAttribute('aria-selected', 'true');
    const hero = page.locator(APP_SCOPE('hero', d));
    await hero.getByRole('button', { name: 'Ask Batsi', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(hero.getByRole('button', { name: 'Ask Batsi', exact: true }), 'Enter on Ask Batsi opens the peek').toHaveAttribute('aria-expanded', 'true');
    // Replay in normal motion: under reduced motion a replay ends sent at once (lock check fix).
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await gotoLanding(page, [SEC_ID('recruitment', d)]);
    const rec = page.locator(APP_SCOPE('recruitment', d));
    await rec.locator('.pp-site-replay').focus();
    await sleep(9000);
    await page.keyboard.press('Space');
    await sleep(900);
    expect(await rec.locator('.pp-site-hiring__draft--sent').count(), 'Space on Replay starts the run again (the draft is no longer sent)').toBe(0);
  });

  // ---------------------------------------------------------------- AC-12
  test('AC-12 nothing outside the site changes: no signed-in file, no generated list, no site code on the signed-in pages', async ({ page, signIn, hr }) => {
    once('reads the repository and the pages once');
    test.setTimeout(3 * 60_000);
    const git = (...a: string[]) => execFileSync('git', a, { cwd: PEPLA_WEB, encoding: 'utf8' }).trim();
    let base = '';
    for (const ref of ['origin/develop', 'develop']) { try { base = git('merge-base', 'HEAD', ref); break; } catch { /* next */ } }
    // CI checks out the pull request's merge commit with no develop branch: its first parent is develop's tip.
    if (!base && process.env['GITHUB_ACTIONS'] === 'true') {
      try { git('rev-parse', '--verify', '-q', 'HEAD^1'); } catch { git('fetch', '--no-tags', '--quiet', '--depth=2', 'origin', process.env['GITHUB_SHA'] ?? git('rev-parse', 'HEAD')); }
      try { base = git('rev-parse', 'HEAD^1'); } catch { /* stays empty */ }
    }
    expect(base, 'develop is known (git merge-base HEAD origin/develop)').not.toBe('');
    const changed = git('diff', '--name-only', base, 'HEAD', '--', '.').split('\n').filter(Boolean).map((f) => f.replace(/^pepla-web\//, ''));
    const root = git('rev-parse', '--show-prefix');
    void root;
    const allowed = (f: string) => /^src\/app\/ds\/site\//.test(f) || /^src\/app\/features\/public\//.test(f) || /^src\/app\/(app\.routes|app\.routes\.server|site\.routes)\.ts$/.test(f) || /^e2e\/acceptance\/(site-\d{2}\.spec\.ts|onb-09\.spec\.ts|cards\/site-\d{2}\.md)$/.test(f) || /^e2e\/acceptance\/support\/site-\d{2}\//.test(f) || /^e2e\/parity\//.test(f) || f === 'angular.json' || f === 'src/styles.css' || f === 'README.md' || /^src\/styles\/design-system\//.test(f) || /^scripts\/(design-system-sync\.mjs|verify-design\.mjs|verify-design\.test\.mjs)$/.test(f);
    // SITE-03.1: the file rule holds for a site change only. Another card's pull request (no site file, no site
    // test) changes files outside the site by design, so the rule is not applied to it. app.routes.ts is left out
    // of the trigger because other cards add routes there too.
    const siteChange = changed.some((f) => /^src\/app\/ds\/site\//.test(f) || /^src\/app\/features\/public\//.test(f) || /^src\/app\/(site\.routes|app\.routes\.server)\.ts$/.test(f) || /^e2e\/parity\//.test(f) || /^e2e\/acceptance\/(site-\d{2}\.spec\.ts|support\/site-\d{2}\/|cards\/site-\d{2}\.md)/.test(f));
    if (siteChange) {
      expect(changed.filter((f) => !allowed(f)), 'this card changes only the site, the public pages, the route files and its own tests').toEqual([]);
      expect(changed.filter((f) => f === 'src/app/ds/all.ts' || f.startsWith('src/app/features/') && !f.startsWith('src/app/features/public/')), 'ds/all.ts and the signed-in features are untouched').toEqual([]);
    }
    // No site code reaches a signed-in page.
    const loaded: Array<Promise<{ url: string; text: string }>> = [];
    page.context().on('response', (r) => {
      const js = /javascript|ecmascript/.test(r.headers()['content-type'] ?? '') || /\.m?js(\?|$)/.test(new URL(r.url()).pathname);
      if (r.request().resourceType() === 'script' || js) loaded.push(r.text().then((text) => ({ url: r.url(), text }), () => ({ url: r.url(), text: '' })));
    });
    const carriers = async (where: string) => (await Promise.all(loaded.splice(0))).filter((x) => /pp-site-|ppSite|PpSite|DemoClock/.test(x.text)).map((x) => `${where}: ${new URL(x.url).pathname}`);
    await signIn.open();
    await page.waitForLoadState('networkidle');
    expect(await carriers('/sign-in'), 'no script that /sign-in loads holds landing code').toEqual([]);
    await signIn.signInAs(hr);
    await expect(page).toHaveURL(/\/hr$/, { timeout: 20_000 });
    await page.waitForLoadState('networkidle');
    expect(await carriers('/hr'), 'no script that /hr loads holds landing code').toEqual([]);
  });

  // ---------------------------------------------------------------- AC-13
  test('AC-13 the built app and the gallery carry no "pepla" in the landing sections, and none of the old word "Masked"', async ({ page }) => {
    once('builds the app once');
    test.setTimeout(20 * 60_000);
    execFileSync('npm', ['run', 'build'], { cwd: PEPLA_WEB, encoding: 'utf8', timeout: 15 * 60_000, env: { ...process.env, NG_CLI_ANALYTICS: 'false', FORCE_COLOR: '0', NO_COLOR: '1' } });
    const out = join(PEPLA_WEB, 'dist', 'pepla-web', 'browser');
    const files = (function all(dir: string): string[] { return readdirSync(dir).flatMap((e) => { const f = join(dir, e); return statSync(f).isDirectory() ? all(f) : [f]; }); })(out);
    const MARK = /Every module\.|Ask Batsi about any employee or candidate|Candidate 4|Sample questions|pp-site-batsi/;
    const holders = files.filter((f) => /\.(m?js|html)$/.test(f) && MARK.test(readFileSync(f, 'utf8')));
    expect(holders.length, 'the build holds the landing sections (their words are in a built script)').toBeGreaterThan(0);
    const named = holders.filter((f) => /pepla/i.test(readFileSync(f, 'utf8'))).map((f) => relative(out, f));
    expect(named, 'no built file with landing sections carries the old name, in any case').toEqual([]);
    const masked = holders.filter((f) => /\bMasked\b/.test(readFileSync(f, 'utf8'))).map((f) => relative(out, f));
    expect(masked, 'no built file with landing sections says "Masked"').toEqual([]);
    const css = files.filter((f) => /\.css$/.test(f)).filter((f) => readFileSync(f, 'utf8').split('}').some((rule) => /pp-site/i.test(rule) && /pepla/i.test(rule)));
    expect(css.map((f) => relative(out, f)), 'no style rule for a site class carries the old name').toEqual([]);
    await gotoLanding(page);
    expect(await page.content(), 'the rendered gallery holds no "pepla"').not.toMatch(/pepla/i);
  });
});
