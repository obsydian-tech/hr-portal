import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { freezeTimers, loopsIn, tiltCompare, transitionsIn } from './reduced-motion';
import { FREEZE_VIEW, GATED_VIEW, MODULE_SCRIPTS, compareScopes, deviceOf, fire, fromFirstChange, gotoLearn, kitDocument, openKitDocument, sameTimeline, screens, settle, settled, sleep, timeline, wordsOf, TOL, type Device, type Step } from './kit';

/**
 * SITE-08 AC-12: the page-level checks of a whole Learn more page, for SITE-09 to SITE-14 to import and never edit
 * (a needed change is a child lock, acceptance-lock/site-08.N). The reference is always the kit page `site-pages.html` for that page
 * (its markup and its preview scripts, at the kit ref), driven the same way as the page under test. Each check opens its own browser
 * context, runs, and closes it. `plant` (optional) edits the page after it has loaded and before the check, so a check can be shown to fail.
 * Each export is documented in cards/site-08.md.
 */

export type LearnPageSpec = {
  /** Shown in messages. */
  name: string;
  /** The kit screen of the page without its device, for example "Leave page" or "Recruitment page". */
  kitPage: string;
  device: Device;
  /** Kit `data-demo` values the page holds; the kit page is cut down to these (a gallery sample holds a few). Default: all of them. */
  onlyDemos?: string[];
  /** Selector of parts left out on both sides (the sample leaves out the closing band and the hero card). Default: nothing. */
  omit?: string;
  /** Opens the page on the app (a route, or the gallery's sample). */
  open: (page: Page) => Promise<void>;
};
export type Env = { browser: Browser; baseURL: string; /** the test's own page: its window size and device */ page: Page };
export type Plant = (page: Page) => Promise<void>;
export type Opts = { plant?: Plant; /** a view that never reports: demos never start */ deaf?: boolean };

/** The kit's ids carry the page and width (`hiring-board-recd`); the site's do not (SITE-08 decision 6). */
export const normId = (id: string): string => id.replace(/-[a-z0-9]{4}$/, '');
export const SAMPLE_OMIT = '.pp-site-hcard, .pp-site-band';
const DEAF_VIEW = () => { (window as unknown as { __fireView: () => void }).__fireView = () => undefined; };

function kitPageDocument(spec: LearnPageSpec, stageWidth?: number): string {
  const s = screens('pages').find((x) => x.name === spec.kitPage && x.device === spec.device);
  if (!s) throw new Error(`site-08: the kit has no "${spec.kitPage} (${spec.device})"`);
  const prep = `var st=document.querySelector('.pp-site-stage');var om=${JSON.stringify(spec.omit ?? '')};if(om)st.querySelectorAll(om).forEach(function(e){e.remove();});var only=${JSON.stringify(spec.onlyDemos ?? null)};if(only)st.querySelectorAll('section.pp-site-demo[data-demo]').forEach(function(x){if(only.indexOf(x.getAttribute('data-demo'))<0)x.remove();});st.querySelectorAll('.pp-site-subnav__link').forEach(function(a){if(!document.getElementById(a.getAttribute('href').slice(1)))a.remove();});var h=st.querySelector('.pp-site-form-page--learn');if(h&&h.parentElement)h.parentElement.setAttribute('data-s8-root','');`;
  return kitDocument(s.stage, ['site-pages.js', 'site-demos.js', ...MODULE_SCRIPTS], { device: spec.device, stageWidth, prep });
}

type Pair = { ctx: BrowserContext; app: Page; kit: Page };
type Mode = 'frozen' | 'gated' | 'live';
/** The page under test and the kit page, in one fresh context. `spacer` adds room after the page so the last section can reach the sub-menu (the closing band and footer do on a real page). */
/** A 3000px spacer in the page from the first paint, so a demo starts below the fold (lock check T8). */
const SPACER_FIRST = () => {
  const add = (): boolean => { if (!document.body) return false; const sp = document.createElement('div'); sp.style.height = '3000px'; sp.setAttribute('data-s8-spacer', ''); document.body.insertBefore(sp, document.body.firstChild); return true; };
  if (!add()) new MutationObserver((_, o) => { if (add()) o.disconnect(); }).observe(document, { childList: true, subtree: true });
};
async function openPair(env: Env, spec: LearnPageSpec, mode: Mode, opts: Opts = {}, ctxOpts: object = {}, spacer = false, spaceFirst = false): Promise<Pair> {
  const d = spec.device;
  const vp = env.page.viewportSize()!;
  const ctx = await env.browser.newContext({ baseURL: env.baseURL, viewport: vp, hasTouch: d === 'phone', isMobile: d === 'phone', ...ctxOpts });
  try {
    if (spaceFirst) await ctx.addInitScript(SPACER_FIRST);
    if (mode === 'live' && opts.deaf) await ctx.addInitScript(FREEZE_VIEW);
    if (mode === 'frozen') await ctx.addInitScript(FREEZE_VIEW);
    if (mode === 'gated') { await ctx.addInitScript(GATED_VIEW); if (opts.deaf) await ctx.addInitScript(DEAF_VIEW); }
    const app = await ctx.newPage();
    await spec.open(app);
    const marked = await app.evaluate(() => { const r = document.querySelector('.pp-site-form-page--learn')?.parentElement; r?.setAttribute('data-s8-root', ''); return !!r; });
    if (!marked) throw new Error(`${spec.name}: the page has no Learn more page top (.pp-site-form-page--learn)`);
    if (opts.plant) await opts.plant(app);
    const kit = await ctx.newPage();
    await kit.setViewportSize(vp);
    const w = await app.locator('.pp-site-stage').first().evaluate((el) => el.getBoundingClientRect().width).catch(() => undefined);
    await openKitDocument(kit, new URL(env.baseURL).origin, kitPageDocument(spec, w));
    if (spacer) for (const p of [app, kit]) await p.evaluate(() => { const s = document.createElement('div'); s.setAttribute('data-s8-spacer', ''); s.style.height = '1400px'; document.body.appendChild(s); });
    return { ctx, app, kit };
  } catch (e) { await ctx.close(); throw e; }
}
async function using<T>(pair: Promise<Pair>, run: (p: Pair) => Promise<T>): Promise<T> {
  const p = await pair;
  try { return await run(p); } finally { await p.ctx.close(); }
}

// ------------------------------------------------------------------------------------------------ page parity, words

/** Every kit item of the page (hero to ending, and the closing band when the page has one) is on the page, in order, within 1px. Pixels are judged per example by AC-2. */
export async function checkPageParity(env: Env, spec: LearnPageSpec, opts: Opts = {}): Promise<void> {
  await using(openPair(env, spec, 'frozen', opts), async ({ app, kit }) => {
    // Lock check T3: the sub-menu's "active" class is written by a scroll handler from where the page sits when the handler last ran
    // (the kit page at load, the page under test wherever its first scroll happened). Both pages scroll one pixel and back, so both
    // handlers have run at the same place before the boxes are compared.
    // Lock check .1: the kit's sub-menu script measures its links when it first runs, before the web font has loaded (113px on the page against 117px in the kit
    // on CI). Both pages wait for document.fonts.ready and then get a resize event, so every script that measures runs again on the same fonts.
    for (const p of [app, kit]) { await p.evaluate(async () => { await document.fonts.ready; window.dispatchEvent(new Event('resize')); }); await sleep(150); }
    for (const p of [app, kit]) { await p.evaluate(() => window.scrollTo(0, 1)); await sleep(150); await p.evaluate(() => window.scrollTo(0, 0)); await sleep(150); }
    await settle(kit); await settle(app);
    const r = await compareScopes(app, kit, spec.name, '[data-s8-root]', '[data-s8-root]', spec.omit ?? '', false, true);
    expect(r.kitElements, `${spec.name}: the kit page has elements`).toBeGreaterThanOrEqual(30);
    expect(r.unmatched.slice(0, 15), `${spec.name}: every kit item is on the page, in order`).toEqual([]);
    expect(r.moved.slice(0, 15), `${spec.name}: every box is within 1px of the kit`).toEqual([]);
  });
}

/** The words (every text node and accessible name) of the page and of the kit page are the same set, both ways. No "Masked", "Claude", "pepla" or placeholder text. */
export async function checkPageWords(env: Env, spec: LearnPageSpec, opts: Opts = {}): Promise<void> {
  await using(openPair(env, spec, 'frozen', opts), async ({ app, kit }) => {
    const args = ['[data-s8-root]', spec.omit ?? ''] as [string, string];
    const a = await app.evaluate(wordsOf, args), k = await kit.evaluate(wordsOf, args);
    expect(a.texts, `${spec.name}: the words on the page are the kit's words`).toEqual(k.texts);
    expect(a.names, `${spec.name}: the accessible names are the kit's names`).toEqual(k.names);
    expect([...a.texts, ...a.names].join(' | '), `${spec.name}: no banned word`).not.toMatch(/masked|claude|pepla|lorem|placeholder/i);
  });
}

// ------------------------------------------------------------------------------------------------ page top

function topFacts() {
  const q = (s: string, r: ParentNode = document) => r.querySelector(s);
  const vis = (e: Element | null): string => { if (!e) return ''; let t = ''; const w = (n: Node) => { if (n.nodeType === 3) t += n.textContent; else if (n.nodeType === 1 && (n as Element).getAttribute('aria-hidden') !== 'true' && !['SCRIPT', 'STYLE'].includes((n as Element).tagName)) n.childNodes.forEach(w); }; w(e); return t.replace(/\s+/g, ' ').trim(); };
  const crumb = q('nav[aria-label="Breadcrumb"]');
  const items = crumb ? Array.from(crumb.querySelectorAll('li')) : [];
  return {
    h1s: document.querySelectorAll('h1').length,
    h1: vis(q('h1')),
    h1Shine: vis(q('h1 .pp-site-shine')),
    crumb: items.map((li) => vis(li)),
    crumbCurrent: items.map((li) => (li.querySelector('[aria-current="page"]') ? 1 : 0)).join(''),
    crumbLinks: items.map((li) => (li.querySelector('a') ? 1 : 0)).join(''),
    buttons: Array.from(document.querySelectorAll('.pp-site-form-page--learn .pp-site-hero__actions > *')).map((b) => `${b.tagName.toLowerCase()}:${/pp-site-button--dark/.test(b.className) ? 'dark' : /pp-site-button--line/.test(b.className) ? 'line' : '?'}:${vis(b)}`),
    pills: Array.from(document.querySelectorAll('ul.pp-site-hero__chips[aria-label="Built for"] > li')).map((li) => vis(li)),
    rings: document.querySelectorAll('.pp-site-form-page--learn .pp-site-rings').length,
  };
}

/** Page top: one h1 with its shine line, the Breadcrumb nav, the two site buttons, the Built for list, rings as the kit has them (turning on the compositor), the card slot beside or below the words, nothing under the header on a phone. */
export async function checkTop(env: Env, spec: LearnPageSpec, opts: Opts = {}): Promise<void> {
  await using(openPair(env, spec, 'frozen', opts), async ({ app, kit }) => judgeTop(app, kit, spec.name));
}
/** The page-top judgement on any two pages that hold a Learn more page top: the page under test and the kit. */
export async function judgeTop(app: Page, kit: Page, label: string): Promise<void> {
  {
    const a = await app.evaluate(topFacts), k = await kit.evaluate(topFacts);
    expect(a.h1s, `${label}: one h1 on the page`).toBe(1);
    expect(a, `${label}: breadcrumb, headline with its shine line, buttons, pills and rings are the kit's`).toEqual(k);
    expect(a.h1Shine.length, `${label}: the h1 holds its shine line`).toBeGreaterThan(0);
    expect(a.buttons.map((b) => b.split(':').slice(0, 2).join(':')), `${label}: Book a demo and Get started are site buttons (dark, line)`).toEqual(['a:dark', 'a:line']);
    // The card slot sits beside the words from a 1024 top (the hero's own width) and below them under it.
    const lay = await app.evaluate(() => {
      const hero = document.querySelector('.pp-site-form-page--learn')!.getBoundingClientRect();
      const i = document.querySelector('.pp-site-form-page__intro')?.getBoundingClientRect();
      const c = document.querySelector('.pp-site-form-page__card')?.getBoundingClientRect();
      return i && c ? { hero: hero.width, iRight: i.right, iBottom: i.bottom, cLeft: c.left, cTop: c.top } : null;
    });
    expect(lay, `${label}: the page top has an intro and a card slot`).not.toBeNull();
    if (lay!.hero >= 1024) expect(lay!.cLeft, `${label}: the card slot sits beside the intro`).toBeGreaterThanOrEqual(lay!.iRight - 1);
    else expect(lay!.cTop, `${label}: the card slot sits below the intro`).toBeGreaterThanOrEqual(lay!.iBottom - 1);
    // Rings turn on the compositor, and only where the kit has them.
    await sleep(500);
    const spin = await app.evaluate(() => document.getAnimations().filter((x) => (x.effect as KeyframeEffect | null)?.target?.closest?.('.pp-site-rings')).map((x) => Object.keys((x.effect as KeyframeEffect).getKeyframes()[0] ?? {}).filter((p) => !['offset', 'easing', 'composite', 'computedOffset'].includes(p)).join('+')));
    if (k.rings) { expect(spin.length, `${label}: the rings turn`).toBeGreaterThan(0); expect([...new Set(spin)], `${label}: the rings animate transform only`).toEqual(['transform']); } else expect(spin, `${label}: no rings`).toEqual([]);
    // Every heading and button is visible and nothing lies over it.
    const hidden = await app.evaluate(async () => {
      const bad: string[] = [];
      for (const el of Array.from(document.querySelectorAll('.pp-site-form-page--learn h1, .pp-site-form-page--learn .pp-site-hero__actions > *'))) {
        (el as HTMLElement).scrollIntoView({ block: 'center' });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20));
        if (r.width === 0 || r.left < -1 || r.right > innerWidth + 1 || !at || !(el === at || el.contains(at))) bad.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 24)}"`);
      }
      return bad;
    });
    expect(hidden, `${label}: every heading and button is visible, inside the window and not covered`).toEqual([]);
  }
}

// ------------------------------------------------------------------------------------------------ sub-menu

async function tabs(p: Page) {
  return p.evaluate(() => Array.from(document.querySelectorAll('nav[aria-label="On this page"] .pp-site-subnav__link')).map((a) => `${(a.textContent ?? '').trim()}>${(a.getAttribute('href') ?? '')}`));
}
const forbiddenStyle = /^(width|height|left|top|right|bottom|inset.*|margin.*|padding.*|inline-size|block-size)$/;

/** Sub-menu: nav "On this page", sticky, 56 tall, tabs in the kit's order, aria-current on one tab, the highlight moved by transform only (--_x, --_sx), a tap lands the section's top under header and sub-menu, a phone scrolls the tabs, the header's open menu covers it. */
export async function checkSubmenu(env: Env, spec: LearnPageSpec, opts: Opts = {}): Promise<void> {
  await using(openPair(env, spec, 'live', opts, {}, true), async ({ app, kit }) => {
    const want = (await tabs(kit)).map((t) => t.replace(/#.*$/, `#${normId(t.split('#')[1]!)}`));
    const got = await tabs(app);
    expect(got, `${spec.name}: one tab per section in the kit's order (names and targets)`).toEqual(want);
    expect(await app.locator('nav[aria-label="On this page"]').count(), `${spec.name}: one nav named "On this page"`).toBe(1);
    const px = await app.evaluate(() => { const m = (v: string) => { const e = document.createElement('div'); e.style.cssText = `position:absolute;visibility:hidden;height:var(${v})`; document.body.appendChild(e); const h = e.getBoundingClientRect().height; e.remove(); return h; }; return { head: m('--layout-site-header-height-shrunk'), sub: m('--layout-site-subnav-height') }; });
    expect(px.head, 'the shrunk header token resolves').toBeGreaterThan(0);
    const nav = app.locator('nav[aria-label="On this page"]');
    expect(await nav.evaluate((el) => getComputedStyle(el).position), `${spec.name}: the sub-menu is sticky`).toBe('sticky');
    expect(Math.abs((await nav.boundingBox())!.height - 56), `${spec.name}: 56 tall`).toBeLessThanOrEqual(1);
    const title = async (p: Page) => p.evaluate(() => { const t = document.querySelector('.pp-site-subnav__title'); return t ? getComputedStyle(t).display !== 'none' : false; });
    expect(await title(app), `${spec.name}: the page name shows from 1280 wide only, as in the kit`).toBe(await title(kit));
    const hrefs = got.map((t) => t.split('>')[1]!);
    const state = () => app.evaluate(() => { const n = document.querySelector('nav[aria-label="On this page"]')!; const pill = n.querySelector('.pp-site-subnav__pill') as HTMLElement; const links = Array.from(n.querySelectorAll('.pp-site-subnav__link')); return { cur: links.map((l, i) => (l.getAttribute('aria-current') === 'true' ? i : -1)).filter((i) => i >= 0), top: Math.round(n.getBoundingClientRect().top * 10) / 10, x: pill.style.getPropertyValue('--_x'), sx: pill.style.getPropertyValue('--_sx'), inline: Array.from({ length: pill.style.length }, (_, i) => pill.style.item(i)) }; });
    for (let i = 0; i < hrefs.length; i++) {
      const id = hrefs[i]!.slice(1);
      await app.evaluate((id) => { const s = document.getElementById(id)!; const n = document.querySelector('nav[aria-label="On this page"]') as HTMLElement; const top = parseFloat(getComputedStyle(n).top) || 0; window.scrollTo(0, s.getBoundingClientRect().top + scrollY - top - n.offsetHeight + 10); }, id);
      await expect.poll(async () => (await state()).cur, { message: `${spec.name}: scrolling "${got[i]}" into view makes that tab current, and only that one`, timeout: 4000 }).toEqual([i]);
      const s = await state();
      expect(Math.abs(s.top - px.head), `${spec.name}: the sub-menu stays ${px.head}px from the top while the page scrolls`).toBeLessThanOrEqual(1);
      expect(s.x !== '' && s.sx !== '', `${spec.name}: the highlight is placed with --_x and --_sx`).toBe(true);
      expect(s.inline.filter((n) => forbiddenStyle.test(n)), `${spec.name}: no width, height, left or top is written on the highlight`).toEqual([]);
      const seen = await app.evaluate(() => document.querySelector('.pp-site-subnav__pill')!.getAnimations().flatMap((a) => (a as CSSTransition).transitionProperty ?? Object.keys((a.effect as KeyframeEffect).getKeyframes()[0] ?? {})));
      expect(seen.filter((n) => !['transform', 'opacity'].includes(n)), `${spec.name}: the highlight moves with transform and opacity only`).toEqual([]);
      await expect.poll(() => app.evaluate(() => { const pill = document.querySelector('.pp-site-subnav__pill') as HTMLElement; const cur = document.querySelector('.pp-site-subnav__link[aria-current="true"]') as HTMLElement; const m = new DOMMatrix(getComputedStyle(pill).transform); return Math.abs(m.m41 - cur.offsetLeft) <= 1.5 && Math.abs(m.a - cur.offsetWidth / pill.offsetWidth) <= 0.02; }), { message: `${spec.name}: the highlight ends under the current tab`, timeout: 4000 }).toBe(true);
    }
    // A tap lands the section's top just below header plus sub-menu (the kit script decides; +-4px), or at the end of the page.
    for (let i = hrefs.length - 1; i >= 0; i--) {
      await app.evaluate(() => window.scrollTo(0, 0));
      await sleep(150);
      await app.locator('nav[aria-label="On this page"] .pp-site-subnav__link').nth(i).scrollIntoViewIfNeeded();
      await app.evaluate(() => window.scrollTo(0, 0)); // the tab strip may have scrolled sideways, the page is back at the top
      await app.locator('nav[aria-label="On this page"] .pp-site-subnav__link').nth(i).evaluate((el) => (el as HTMLElement).click());
      let last = -1, still = 0;
      for (let k = 0; k < 40 && still < 4; k++) { await sleep(100); const y = await app.evaluate(() => scrollY); still = y === last ? still + 1 : 0; last = y; }
      const r = await app.evaluate((id) => ({ top: document.getElementById(id)!.getBoundingClientRect().top, end: scrollY >= document.documentElement.scrollHeight - innerHeight - 1 }), hrefs[i]!.slice(1));
      const want2 = px.head + 56;
      expect(r.end ? r.top >= want2 - 4 : Math.abs(r.top - want2) <= 4, `${spec.name}: a tap on "${got[i]}" puts the section's top ${want2}px from the top (got ${r.top.toFixed(1)})`).toBe(true);
      await expect.poll(async () => (await state()).cur, { message: `${spec.name}: "${got[i]}" is current after the tap`, timeout: 4000 }).toEqual([i]);
    }
    // The tab strip scrolls sideways, and the current tab is scrolled into view (made narrow so it overflows).
    expect(await app.locator('.pp-site-subnav__tabs').evaluate((el) => getComputedStyle(el).overflowX), `${spec.name}: the tabs scroll sideways`).toMatch(/auto|scroll/);
    await app.evaluate(() => { (document.querySelector('nav[aria-label="On this page"]') as HTMLElement).style.width = '170px'; window.scrollTo(0, 0); });
    const last = hrefs.length - 1;
    await app.evaluate((id) => { const s = document.getElementById(id)!; const n = document.querySelector('nav[aria-label="On this page"]') as HTMLElement; window.scrollTo(0, s.getBoundingClientRect().top + scrollY - n.offsetHeight - 66); }, hrefs[last]!.slice(1));
    await expect.poll(() => app.evaluate(() => { const t = document.querySelector('.pp-site-subnav__tabs')!.getBoundingClientRect(); const c = document.querySelector('.pp-site-subnav__link[aria-current="true"]')?.getBoundingClientRect(); return !!c && c.left >= t.left - 1 && c.right <= t.right + 1; }), { message: `${spec.name}: the current tab is scrolled into view`, timeout: 4000 }).toBe(true);
    // An open menu list covers the sub-menu: the header sits on a higher layer.
    const z = await app.evaluate(() => { const h = document.createElement('header'); h.className = 'pp-site-header'; document.body.appendChild(h); const zh = parseInt(getComputedStyle(h).zIndex, 10); h.remove(); return { nav: parseInt(getComputedStyle(document.querySelector('nav[aria-label="On this page"]')!).zIndex, 10), header: zh }; });
    expect(z.nav < z.header, `${spec.name}: the header (z ${z.header}) is above the sub-menu (z ${z.nav})`).toBe(true);
  });
}

// ------------------------------------------------------------------------------------------------ demo sections

function sectionFacts() {
  const txt = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return Array.from(document.querySelectorAll('section.pp-site-demo')).map((s) => {
    const again = s.querySelector('.pp-site-demo__again');
    const panel = s.querySelector('.pp-site-demo__panel, .pp-site-demo__wide');
    const by = s.getAttribute('aria-labelledby');
    return { id: s.id, cream: s.classList.contains('pp-site-demo--cream'), flip: s.classList.contains('pp-site-demo--flip'), title: txt(by ? document.getElementById(by) : null), again: again ? again.tagName.toLowerCase() : '-', panel: panel?.getAttribute('aria-label') ?? '' };
  });
}

/** Demo sections: in the kit's order with the kit's ids, white, cream and flipped as the kit, a Play again button; every demo waits for its view, then plays; Play again restarts it and keeps focus. */
export async function checkSections(env: Env, spec: LearnPageSpec, opts: Opts = {}): Promise<void> {
  const kitFacts = await using(openPair(env, spec, 'frozen'), async ({ kit }) => (await kit.evaluate(sectionFacts)).map((f) => ({ ...f, id: normId(f.id) })));
  await using(openPair(env, spec, 'gated', opts), async ({ app }) => {
    const a = await app.evaluate(sectionFacts);
    expect(a, `${spec.name}: the demo sections, in order, with the kit's ids, grounds, headlines and Play again`).toEqual(kitFacts);
    expect(a.length, `${spec.name}: the page has demo sections`).toBeGreaterThan(0);
    const ids = a.filter((f) => f.again === 'button').map((f) => f.id);
    expect(ids.length, `${spec.name}: at least one demo with a Play again button`).toBeGreaterThan(0);
    // Not started before its view: the first change comes after the view fires (at 900ms), and every demo then plays.
    const rec = Promise.all(ids.map((id) => timeline(app, `[id="${id}"]`, 3200)));
    await sleep(900);
    await fire(app);
    const all = await rec;
    all.forEach((steps, i) => {
      expect(steps.length, `${spec.name}: demo ${ids[i]} plays once its view is reported`).toBeGreaterThanOrEqual(2);
      expect(steps[1]!.t, `${spec.name}: demo ${ids[i]} does not play before its view is reported`).toBeGreaterThanOrEqual(700);
    });
    // Play again: restart from the first step, focus stays on the button.
    const sel = `[id="${ids[0]}"] .pp-site-demo__again`;
    await sleep(5500);
    await app.locator(sel).focus();
    const again = timeline(app, `[id="${ids[0]}"]`, 1800);
    await app.keyboard.press('Enter');
    expect((await again).length, `${spec.name}: Play again restarts the demo`).toBeGreaterThanOrEqual(2);
    expect(await app.evaluate((s) => document.activeElement === document.querySelector(s), sel), `${spec.name}: Play again keeps focus after the restart`).toBe(true);
  });
}

/**
 * Lock check T9: a demo plays only once it is in view, judged with the real view observer, on the page's first demo that plays by itself.
 * (Before, AC-5 judged this on the kit's "Demo section (phone)" example, which is not `data-live` and never plays on its own, so no page could pass it on a phone.)
 * Both pages load with the demo 3000px below the fold (T8). Below 15% nothing has started; at 60% it plays; scrolled away it goes on and is in place when back.
 */
export async function checkDemoView(env: Env, spec: LearnPageSpec, opts: Opts = {}): Promise<void> {
  await using(openPair(env, spec, 'live', opts, {}, false, true), async ({ app, kit }) => {
    const kitIds = await kit.evaluate(() => Array.from(document.querySelectorAll('section.pp-site-demo[data-live]')).map((s) => s.id));
    expect(kitIds.length, `${spec.name}: the kit page has a demo that plays when it is in view`).toBeGreaterThan(0);
    const kid = kitIds[0]!, aid = normId(kid);
    const flow = async (p: Page, id: string) => {
      const live = () => p.evaluate((x) => document.getElementById(x)!.hasAttribute('data-site-live'), id);
      const show = (f: number) => p.evaluate(([x, fr]) => { const sec = document.getElementById(x as string)!; const r = sec.getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - (innerHeight - (fr as number) * r.height)); }, [id, f] as const);
      const out: Record<string, unknown> = {};
      await show(0.06); await sleep(1500); out['startedAt6'] = await live();
      await show(0.6); await sleep(900); out['startedAt60'] = await live();
      await sleep(300); await p.evaluate(() => window.scrollTo(0, 0)); await sleep(6000); await show(0.6); await sleep(300);
      out['backIn'] = (await timeline(p, `[id="${id}"]`, 200)).at(-1)!.sig.split(' ')[0]; out['liveBack'] = await live();
      return out;
    };
    for (const p of [app, kit]) expect(await p.evaluate(() => document.querySelectorAll('[data-s8-spacer]').length), `${spec.name}: the spacer is in the page`).toBe(1);
    const [a, k] = await Promise.all([flow(app, aid), flow(kit, kid)]);
    if (!opts.deaf) expect(k['startedAt6'], `${spec.name}: the kit demo has not started at 6% in view`).toBe(false);
    expect(a['startedAt6'], `${spec.name}: the demo has not started below 15% in view`).toBe(false);
    expect(a['startedAt60'], `${spec.name}: the demo plays once 40% or more is in view`).toBe(true);
    expect(a['liveBack'], `${spec.name}: scrolled away it keeps its place, it is not reset`).toBe(true);
    expect(a['backIn'], `${spec.name}: back in view the demo is where the kit demo is (finished, nothing restarted)`).toBe(k['backIn']);
  });
}

// ------------------------------------------------------------------------------------------------ ending

function endingFacts() {
  const txt = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const q = (b: Element) => `${txt(b.querySelector('span'))}|${b.getAttribute('aria-expanded')}|${b.closest('li')?.classList.contains('pp-site-faq__item--open') ? 'o' : 'c'}`;
  return {
    chips: Array.from(document.querySelectorAll('.pp-site-ask__chip')).map((b) => `${b.tagName.toLowerCase()}:${txt(b.querySelector('.pp-site-ask__label'))}`),
    strip: Array.from(document.querySelectorAll('.pp-site-strip .pp-site-strip__item, .pp-site-strip a')).map((e) => txt(e)),
    stripLinks: document.querySelectorAll('.pp-site-strip a').length,
    related: Array.from(document.querySelectorAll('.pp-site-related__list a.pp-site-tile')).map((a) => txt(a.querySelector('.pp-site-tile__title'))),
    faq: Array.from(document.querySelectorAll('.pp-site-faq__q')).map(q),
  };
}

/** Ending: the Ask Batsi chips are buttons and press as the kit does, the strip and "Works together with" are the kit's, the questions are disclosure buttons (aria-expanded, aria-controls, region), the first open, one opens at a time as the kit does, Enter and Space toggle. */
export async function checkEnding(env: Env, spec: LearnPageSpec, opts: Opts = {}): Promise<void> {
  await using(openPair(env, spec, 'frozen', opts, {}, true), async ({ app, kit }) => judgeEnding(app, kit, spec.name, [0]));
}
/** The ending judgement on any two pages that hold a Learn more ending: the page under test and the kit. `chips` are the Ask Batsi questions pressed, in turn. */
export async function judgeEnding(app: Page, kit: Page, label: string, chips: number[]): Promise<void> {
  {
    const a0 = await app.evaluate(endingFacts), k0 = await kit.evaluate(endingFacts);
    expect(a0, `${label}: chips, strip, related cards and questions are the kit's`).toEqual(k0);
    expect(a0.chips.length, `${label}: three questions for Batsi`).toBe(3);
    expect(a0.faq[0]!.endsWith('|true|o'), `${label}: the first question starts open`).toBe(true);
    const wired = await app.evaluate(() => Array.from(document.querySelectorAll('.pp-site-faq__q')).map((b) => { const r = document.getElementById(b.getAttribute('aria-controls') ?? ''); return !!r && r.getAttribute('role') === 'region' && r.getAttribute('aria-labelledby') === b.id && b.tagName === 'BUTTON'; }));
    expect(wired.every(Boolean) && wired.length > 0, `${label}: every question is a button that controls a region named by it`).toBe(true);
    // The same clicks on both pages leave the same questions open (the kit closes the others).
    const n = k0.faq.length;
    for (const i of [Math.min(2, n - 1), 0, 0]) {
      await Promise.all([app, kit].map((p) => p.locator('.pp-site-faq__q').nth(i).evaluate((el) => (el as HTMLElement).click())));
      await sleep(150);
      expect(await app.evaluate(endingFacts).then((f) => f.faq), `${label}: after a click on question ${i + 1} the questions are as in the kit`).toEqual((await kit.evaluate(endingFacts)).faq);
    }
    const open = async () => (await app.evaluate(endingFacts)).faq.map((f) => f.split('|')[1]);
    const before = await open();
    const q = app.locator('.pp-site-faq__q').nth(1);
    await q.focus(); await app.keyboard.press('Enter'); await sleep(150);
    const afterEnter = await open();
    expect(afterEnter[1], `${label}: Enter opens a question`).toBe('true');
    await app.keyboard.press('Space'); await sleep(150);
    expect((await open())[1], `${label}: Space closes it`).toBe('false');
    void before;
    // Ask Batsi: each chip played by hand shows the same states, in the same order and time, as the kit.
    for (const c of chips) {
      const go = async (p: Page) => { const rec = timeline(p, '.pp-site-batsi', 9500); await sleep(100); await p.locator('.pp-site-ask__chip').nth(c).evaluate((el) => (el as HTMLElement).click()); return rec; };
      const [as, ks] = await Promise.all([go(app), go(kit)]);
      const A = settled(fromFirstChange(as)), K = settled(fromFirstChange(ks));
      expect(K.length, 'the kit band moved').toBeGreaterThan(1);
      const h = (s: { sig: string }) => s.sig.split(' ')[0];
      expect(A.map(h), `${label}: question ${c + 1} passes through the kit's states (answer, waiting for a person, approved and logged) in order`).toEqual(K.map(h));
      expect(sameTimeline(A, K, TOL).late, `${label}: question ${c + 1}, each state within ${TOL}ms`).toEqual([]);
    }
    // "Works together with": a card's icon fills on hover as in the kit.
    const glyph = (p: Page) => p.evaluate(async () => { const t = document.querySelector('.pp-site-related__list a.pp-site-tile') as HTMLElement; const g = t.querySelector('.pp-site-tile__glyph--on') as HTMLElement; const rest = getComputedStyle(g).opacity; t.scrollIntoView({ block: 'center' }); return rest; });
    const rest = [await glyph(app), await glyph(kit)];
    const hov = async (p: Page) => { await p.locator('.pp-site-related__list a.pp-site-tile').first().hover(); await sleep(700); return p.evaluate(() => getComputedStyle(document.querySelector('.pp-site-related__list a.pp-site-tile .pp-site-tile__glyph--on')!).opacity); };
    const hv = [await hov(app), await hov(kit)];
    expect(rest[0], `${label}: at rest the filled icon is as in the kit`).toBe(rest[1]);
    expect(hv[0], `${label}: on hover the icon fills as in the kit`).toBe(hv[1]);
    expect(Number(hv[0]), `${label}: on hover the icon is filled`).toBeGreaterThan(0.9);
  }
}

// ------------------------------------------------------------------------------------------------ motion

const ALLOWED = new Set(['transform', 'opacity', 'clip-path', 'clipPath', 'stroke-dashoffset', 'strokeDashoffset', 'offset', 'easing', 'composite', 'computedOffset']);

/**
 * Reduced motion, page side (child lock .2, the rule of design system PR #49): records every SCRIPT-driven animation that moves something by transform,
 * translate, rotate, scale or an offset path, on any element: the flying board card, a step that slides in by `element.animate`, a tilt made with the
 * Web Animations API. Under reduced motion there must be none (the kit stops its flight; the demos otherwise keep playing, so a step's CSS fade and the
 * design system's own `.pp-site-step` pop are not "large movement" and are not recorded here: they are the kit's own and are judged by the timeline
 * compare). Both `Element.prototype.animate` calls (any length) and the running animations that nobody has a call for (polled every 30ms) are seen.
 * CSS loops are judged by `loopsIn` (same names and lengths as the kit), pointer tilt by `tiltCompare`. The name and the signature are unchanged
 * (SITE-09 imports this file); before .2 it recorded only `.pp-site-step` and `.pp-site-timeline` slides and ignored CSS transitions.
 */
export const SLID_PROBE = () => {
  const w = window as unknown as { __slid: Set<string>; __slidOn?: boolean };
  w.__slid = new Set();
  const MOVES = /^(transform|translate|rotate|scale|offsetPath|offsetDistance|offsetRotate)$/;
  const name = (t: Element | null | undefined) => (t ? `${t.tagName.toLowerCase()}.${String(t.className).slice(0, 40)}` : '?');
  if (!w.__slidOn) {
    w.__slidOn = true;
    const real = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, kf: Keyframe[] | PropertyIndexedKeyframes | null, o?: number | KeyframeAnimationOptions) {
      const keys = Array.isArray(kf) ? kf.flatMap((k) => Object.keys(k)) : Object.keys(kf ?? {});
      if (keys.some((k) => MOVES.test(k))) w.__slid.add(name(this));
      return real.call(this, kf, o);
    } as typeof Element.prototype.animate;
  }
  // Child lock .2 (lock check T-flight-css): a LARGE move made by a CSS transition (a card that flies by a class and a transition) is not a script slide, but it is the same
  // movement. Recorded apart (`__slidCss`) and compared with the kit's by the caller (the design system's own pop, 8px, and hover lifts are small and are the kit's too).
  const w2 = w as unknown as { __slidCss: Set<string> };
  w2.__slidCss = new Set();
  const big = (kf: Keyframe) => {
    const k = kf as Record<string, unknown>;
    try {
      if (typeof k['transform'] === 'string' && k['transform'] !== 'none') { const m = new DOMMatrix(k['transform']); if (Math.hypot(m.e, m.f) > 16 || Math.abs(m.b) > 0.05) return true; }
      if (typeof k['translate'] === 'string' && (k['translate'].match(/-?\d+(\.\d+)?/g) ?? []).some((n) => Math.abs(Number(n)) > 16)) return true;
      if (typeof k['rotate'] === 'string' && (k['rotate'].match(/-?\d+(\.\d+)?/g) ?? []).some((n) => Number(n) !== 0)) return true;
    } catch { /* an unreadable value is not recorded */ }
    return false;
  };
  // A hover lift (a button, a card) is a CSS transition too, and it comes and goes with the pointer: whatever the pointer causes is judged by `tiltCompare`, so nothing is recorded
  // for 1.2s after a pointer event (the transition back runs after the pointer has left).
  let lastPtr = -1e9;
  for (const ev of ['pointermove', 'mousemove', 'pointerdown', 'mouseover']) document.addEventListener(ev, () => { lastPtr = performance.now(); }, true);
  setInterval(() => {
    for (const a of document.getAnimations()) {
      if (a instanceof CSSTransition) {
        const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
        if (performance.now() - lastPtr < 1200) continue;
        if (t && /^(transform|translate|rotate|scale)$/.test(a.transitionProperty) && (a.effect as KeyframeEffect).getKeyframes().some(big)) w2.__slidCss.add(`${name(t)} transitions ${a.transitionProperty}`);
        continue;
      }
      if (a instanceof CSSAnimation) continue;
      const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
      if (t && (a.effect as KeyframeEffect).getKeyframes().some((k) => Object.keys(k).some((x) => MOVES.test(x)))) w.__slid.add(name(t));
    }
  }, 30);
};

/** What SLID_PROBE recorded of large moves made by CSS transitions (child lock .2). The page's list must be the kit's. */
export const slidCssOf = (p: Page): Promise<string[]> => p.evaluate(() => [...((window as unknown as { __slidCss?: Set<string> }).__slidCss ?? [])].sort());

/** Control for SLID_PROBE: put a script slide on a step by hand and say whether the probe recorded it. */
export async function slidControlSees(p: Page): Promise<boolean> {
  await p.evaluate(() => { (document.querySelector('.pp-site-step') as HTMLElement).animate([{ transform: 'translateY(8px)' }, { transform: 'none' }], { duration: 600 }); });
  await sleep(150);
  return p.evaluate(() => (window as unknown as { __slid: Set<string> }).__slid.size > 0);
}

/** Two timelines of one demo are the same: the same states in the same order, each within `TOL`, states under 45ms not compared. Used under reduced motion, where the kit plays as it does in normal motion. */
export function expectSameRun(label: string, app: Step[], kit: Step[], gap = 45): void {
  const a = settled(fromFirstChange(app), gap), k = settled(fromFirstChange(kit), gap);
  expect(kit.length, `${label}: the kit page moved at all`).toBeGreaterThan(1);
  const h = (x: Step) => x.sig.split(' ')[0];
  const at = a.findIndex((x, i) => !k[i] || h(x) !== h(k[i]!));
  expect(a.map(h), `${label}: the page passes through the same states, in the same order, as the kit${at < 0 ? '' : ` (first difference at #${at}: page "${a[at]?.sig.slice(0, 200) ?? 'none'}", kit "${k[at]?.sig.slice(0, 200) ?? 'none'}")`}`).toEqual(k.map(h));
  expect(sameTimeline(a, k, TOL).late, `${label}: each state shows within ${TOL}ms of when the kit shows it`).toEqual([]);
}

export const MOTION_PROBE = () => {
  const w = window as unknown as { __s8: { anim: Set<string>; style: Set<string> } };
  w.__s8 = { anim: new Set(), style: new Set() };
  const FORB = /^(width|height|left|top|right|bottom|inline-size|block-size|inset(-.*)?|min-(width|height|inline-size|block-size)|max-(width|height|inline-size|block-size)|margin(-.*)?|padding(-.*)?)$/;
  const scan = (el: Element) => { const st = (el as HTMLElement).style; if (!st) return; for (let i = 0; i < st.length; i++) { const n = st.item(i); if (FORB.test(n)) w.__s8.style.add(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} sets ${n}`); } };
  const start = () => {
    new MutationObserver((ms) => { for (const m of ms) { if (m.type === 'attributes') scan(m.target as Element); else m.addedNodes.forEach((n) => { if (n.nodeType === 1) { scan(n as Element); (n as Element).querySelectorAll('[style]').forEach(scan); } }); } }).observe(document, { attributes: true, attributeFilter: ['style'], subtree: true, childList: true });
    setInterval(() => {
      for (const a of document.getAnimations()) {
        const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
        if (!t) continue;
        const where = `${t.tagName.toLowerCase()}.${String(t.className).slice(0, 40)}${t.closest('.pp-site-faq__a') ? ' @faq' : ''}`;
        const tp = (a as unknown as { transitionProperty?: string }).transitionProperty;
        if (tp) w.__s8.anim.add(`${where} transitions ${tp}`);
        else for (const kf of (a.effect as KeyframeEffect).getKeyframes()) for (const key of Object.keys(kf)) w.__s8.anim.add(`${where} animates ${key}`);
      }
    }, 30);
  };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
    };

/** What MOTION_PROBE saw, as a list of problems: an animation of anything but transform and opacity (the kit's FAQ row height and the design system's button colours aside), or an inline width, height, left, top, inset, margin or padding. */
export async function motionProblems(app: Page): Promise<string[]> {
  const seen = await app.evaluate(() => { const r = (window as unknown as { __s8: { anim: Set<string>; style: Set<string> } }).__s8; return { anim: [...r.anim], style: [...r.style] }; });
  const dsColour = (x: string) => /^(button|input)\.pp-(button|toggle)\S*.* transitions (background-color|color|border-color|box-shadow|outline-color)$/.test(x);
  const bad = seen.anim.filter((x) => !ALLOWED.has(x.split(' ').at(-1)!) && !/transitions (transform|opacity|clip-path|stroke-dashoffset)/.test(x) && !dsColour(x) && !(/@faq/.test(x) && /grid-template-rows/.test(x)));
  const left = await app.evaluate((re) => { const rx = new RegExp(re); const out: string[] = []; document.querySelectorAll('[style]').forEach((el) => { if ((el as HTMLElement).hasAttribute('data-s8-spacer')) return; const st = (el as HTMLElement).style; for (let i = 0; i < st.length; i++) if (rx.test(st.item(i))) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} has inline ${st.item(i)}`); }); return out; }, forbiddenStyle.source);
  return [...bad, ...seen.style, ...left];
}

/**
 * Motion: only transform and opacity animate (the kit's FAQ row height and the design system's button colours aside) and no inline width, height, left, top, inset, margin or padding is written;
 * under reduced motion every demo still plays at the kit's timings (the rule of design system PR #49: only grain, the flying board card, pointer tilt and other large movement stop), nothing is
 * moved by a script, the CSS loops are the kit's, the pointer tilts nothing; `data-site-still` shows every demo's end at once and nothing loops, with or without reduced motion.
 */
export async function checkMotion(env: Env, spec: LearnPageSpec, opts: Opts = {}): Promise<void> {
  const d = spec.device;
  const vp = env.page.viewportSize()!;
  const ctx = await env.browser.newContext({ baseURL: env.baseURL, viewport: vp, hasTouch: d === 'phone', isMobile: d === 'phone' });
  try {
    await ctx.addInitScript(MOTION_PROBE);
    const app = await ctx.newPage();
    await spec.open(app);
    if (opts.plant) await opts.plant(app);
    // Walk down the page: each demo and the ending come into view and play, a question is opened, a chip is pressed.
    const ids = await app.evaluate(() => Array.from(document.querySelectorAll('section.pp-site-demo, .pp-site-batsi')).map((s, i) => { (s as HTMLElement).setAttribute('data-s8-walk', String(i)); return i; }));
    for (const i of ids) { await app.locator(`[data-s8-walk="${i}"]`).evaluate((el) => (el as HTMLElement).scrollIntoView({ block: 'center' })); await sleep(2200); }
    await app.locator('.pp-site-ask__chip').nth(1).evaluate((el) => (el as HTMLElement).click());
    await app.locator('.pp-site-faq__q').nth(1).evaluate((el) => { (el as HTMLElement).scrollIntoView({ block: 'center' }); (el as HTMLElement).click(); });
    await sleep(1500);
    expect(await motionProblems(app), `${spec.name}: only transform and opacity animate; no inline width, height, left, top, inset, margin or padding`).toEqual([]);
  } finally { await ctx.close(); }
  // Reduced motion: the demos keep playing at the kit's timings. Nothing is moved by a script, the loops are the kit's, the pointer tilts nothing.
  const kitIds = await using(openPair(env, spec, 'frozen'), async ({ kit }) => kit.evaluate(() => Array.from(document.querySelectorAll('section.pp-site-demo[data-live]')).map((s) => s.id)));
  expect(kitIds.length, 'the kit page has a demo that plays').toBeGreaterThan(0);
  const appIds = kitIds.map(normId);
  await using(openPair(env, spec, 'gated', opts, { reducedMotion: 'reduce' }), async ({ app, kit }) => {
    for (const p of [app, kit]) await p.evaluate(SLID_PROBE);
    // Nothing has started (the views are gated): the pointer goes over the page.
    expect(await transitionsIn(app, '[data-s8-root]'), `${spec.name}: under reduced motion every transition has the kit's property, length and delay (none removed, none slowed)`).toEqual(await transitionsIn(kit, '[data-s8-root]'));
    const tilt = await tiltCompare(app, kit, '[data-s8-root]', '[data-s8-root]');
    expect(tilt.app.filter((m) => !tilt.kit.includes(m)), `${spec.name}: under reduced motion the pointer tilts nothing (what moves is what the kit's hover rules move)`).toEqual([]);
    const run = async (p: Page, list: string[]) => { const rec = Promise.all(list.map((id) => timeline(p, `[id="${id}"]`, 10_500))); await sleep(300); await fire(p); return rec; };
    const [a, k] = await Promise.all([run(app, appIds), run(kit, kitIds)]);
    appIds.forEach((id, i) => expectSameRun(`${spec.name}: under reduced motion demo ${id} still plays at the kit's timings`, a[i]!, k[i]!));
    const slid = (p: Page) => p.evaluate(() => [...(window as unknown as { __slid: Set<string> }).__slid]);
    expect(await slid(kit), 'the kit moves nothing by script under reduced motion (the rule of design system PR #49)').toEqual([]);
    expect(await slid(app), `${spec.name}: under reduced motion nothing moves by script (no flying card, no sliding step)`).toEqual([]);
    expect(await slidCssOf(app), `${spec.name}: under reduced motion no large move is made by a CSS transition that the kit does not make (no flying card)`).toEqual(await slidCssOf(kit));
    expect(await loopsIn(app, ['[data-s8-root]']), `${spec.name}: under reduced motion the CSS loops are the kit's, at the kit's lengths (no grain)`).toEqual(await loopsIn(kit, ['[data-s8-root]']));
    expect(await slidControlSees(app), `${spec.name}: control: the probe records a script slide put on a step (so the checks above cannot pass by seeing nothing)`).toBe(true);
  });
  // Still mode: every demo shows its end at once, and nothing loops, with and without reduced motion.
  for (const motion of ['no-preference', 'reduce'] as const) {
    const still = await env.browser.newContext({ baseURL: env.baseURL, viewport: vp, hasTouch: d === 'phone', isMobile: d === 'phone', reducedMotion: motion });
    try {
      await still.addInitScript(GATED_VIEW);
      await still.addInitScript(() => { const set = () => document.documentElement?.setAttribute('data-site-still', ''); set(); new MutationObserver(set).observe(document, { childList: true }); });
      const app = await still.newPage();
      await spec.open(app);
      if (opts.plant) await opts.plant(app);
      await fire(app);
      await sleep(400);
      const r = await app.evaluate(() => ({
        hidden: Array.from(document.querySelectorAll('section.pp-site-demo .pp-site-step')).filter((e) => getComputedStyle(e).opacity !== '1').length,
        loops: document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity && (a as CSSAnimation).animationName !== 'pp-site-blink').map((a) => String(((a.effect as KeyframeEffect).target as Element | null)?.className).slice(0, 40)),
      }));
      expect(r.hidden, `${spec.name} (${motion}): data-site-still shows every step of every demo at once`).toBe(0);
      expect(r.loops, `${spec.name} (${motion}): data-site-still stops every loop`).toEqual([]);
    } finally { await still.close(); }
  }
}

// ------------------------------------------------------------------------------------------------ accessibility

/**
 * Accessibility: axe (wcag2a, wcag2aa) finds nothing on the page, and no element that Tab reaches sits inside an aria-hidden container (use inert).
 * Read twice (child lock .2): on the first step of every demo (views never report), and after every demo has played to its end under reduced
 * motion (the demos play there, so they are read where they stop: views fired, 11s, timers cancelled, animations stilled).
 */
export async function checkAccessibility(env: Env, spec: LearnPageSpec, opts: Opts = {}): Promise<void> {
  const read = async (app: Page, what: string) => {
    await app.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}.pp-site-reveal{opacity:1!important;transform:none!important}' });
    for (let i = 0; i < 2; i++) await app.evaluate(async () => { await Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))); });
    const axe = await new AxeBuilder({ page: app }).exclude('.pp-site-shine__copy').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(axe.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`), `${spec.name} (${what}): axe finds nothing`).toEqual([]);
    expect(await hiddenFocusables(app), `${spec.name} (${what}): nothing Tab can reach sits inside an aria-hidden container`).toEqual([]);
  };
  await using(openPair(env, spec, 'frozen', opts), async ({ app }) => read(app, 'first step'));
  await using(openPair(env, spec, 'gated', opts, { reducedMotion: 'reduce' }), async ({ app }) => {
    await fire(app);
    await sleep(11_000);
    await freezeTimers(app);
    await read(app, 'every demo played to its end, reduced motion');
  });
}
/** The focusable elements (reached by Tab) that have an aria-hidden ancestor and no inert one. */
export async function hiddenFocusables(p: Page): Promise<string[]> {
  return p.evaluate(() => Array.from(document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')).filter((e) => {
    const el = e as HTMLElement;
    if ((el as HTMLButtonElement).disabled || el.tabIndex < 0 || !el.closest('[aria-hidden="true"]') || el.closest('[inert]')) return false;
    return getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
  }).map((e) => `${e.tagName.toLowerCase()} "${(e.textContent ?? '').trim().slice(0, 20)}"`));
}

// ------------------------------------------------------------------------------------------------ all of it

export const LEARN_CHECKS = { checkPageParity, checkPageWords, checkTop, checkSubmenu, checkSections, checkDemoView, checkEnding, checkMotion, checkAccessibility } as const;
/** Every check above, one after another. SITE-09 to SITE-14 call this with their own spec and add only what is their own (hero card, demo detail). */
export async function checkLearnPage(env: Env, spec: LearnPageSpec): Promise<void> {
  for (const check of Object.values(LEARN_CHECKS)) await check(env, spec);
}
/** The gallery's assembled sample page (made only of kit examples, from the Leave page): AC-12's self-test runs the checks on it. */
export function learnSampleSpec(device: Device): LearnPageSpec {
  return { name: `learn-sample-${device}`, kitPage: 'Leave page', device, onlyDemos: ['types'], omit: SAMPLE_OMIT, open: (p) => gotoLearn(p, [`learn-sample-${device}`]) };
}
export { deviceOf };
