import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { FREEZE_VIEW, GATED_VIEW, compareScopes, deviceOf, fromFirstChange, hit, kitDocument, openKitDocument, sameTimeline, screens, settle, settled, sleep, wordsOf, TOL, type Device, type Step } from '../site-08/kit';
import { type Env, type LearnPageSpec, type Plant } from '../site-08/learn-page';

/**
 * SITE-11 helpers: the Compliance Management Learn more page (`/product/compliance`) against the kit screen "Compliance page" of the design system.
 * Everything that a whole Learn more page shares is the SITE-08 helper's (`support/site-08/learn-page.ts`, imported, never edited). What is here is
 * what only this page has: its route, its five demos (the certificate register cycles its filters on its own and has no Play again), its hero card, reduced motion and
 * `data-site-still` judged for every demo, a pixel check for a whole page that is not in a `.pp-site-stage` (and for its parts, so a small fault is not
 * lost in the whole page's 1%), the page-wide words, the prerendered output and the file rule.
 *
 * The kit is the oracle: its markup and its preview scripts (`site-pages.js`, `site-demos.js`, `site-compliance.js`, `site-page-heroes.js`) at KIT_REF.
 */

/**
 * The design system ref the kit is read at. At or after 8dc3091 (DS #47: no closing band note, which SITE-08 removes from the app) and at or after
 * c3788a5 (DS #49: demos keep playing under reduced motion). This is dc593c4, the design system main head on 17 Nov. The SITE-08 helper's own default,
 * the ref in `sync.json` (e9a352f), has the closing band note and the older reduced motion scripts, so SITE-11 sets `SITE_KIT_REF` for its own tests
 * (`useKitRef`, put back afterwards so no other spec in the run sees it). `SITE_11_KIT_REF` overrides this one.
 */
export const KIT_REF = process.env['SITE_11_KIT_REF'] || 'dc593c47c7d8fb79c7ccf29311392ad166506114';
let savedRef: string | undefined;
export function useKitRef(): void { savedRef = process.env['SITE_KIT_REF']; process.env['SITE_KIT_REF'] = KIT_REF; }
export function restoreKitRef(): void { if (savedRef === undefined) delete process.env['SITE_KIT_REF']; else process.env['SITE_KIT_REF'] = savedRef; }

export const ROUTE = '/product/compliance';
export const TABS = ['Requirements per role', 'Certificate register', 'Reminders', 'Renewals read', 'Not cleared to work', 'Questions'] as const;
export const TAB_IDS = ['requirements', 'register', 'reminders', 'renewals', 'not-cleared', 'questions'] as const;
export const OMIT = '.pp-site-footer';
const KIT_SCRIPTS = ['site-pages.js', 'site-demos.js', 'site-compliance.js', 'site-page-heroes.js'];

/**
 * The five demos in page order. `run` is how long each takes to finish (the kit script's last timer, plus 1.5s). `again` says whether the demo has a Play again button:
 * four have one; the certificate register has none in the kit (its filters cycle on their own, 2.6s after it is in view and every 3.2s after that, until a click, which stops the cycle),
 * and the tests follow the kit.
 */
export const DEMOS = [
  { ac: 6, id: 'requirements', key: 'req', run: 6_500, again: true },
  { ac: 7, id: 'register', key: 'reg', run: 0, again: false },
  { ac: 8, id: 'reminders', key: 'rem', run: 7_800, again: true },
  { ac: 9, id: 'renewals', key: 'read', run: 7_800, again: true },
  { ac: 10, id: 'not-cleared', key: 'nc', run: 6_700, again: true },
] as const;
/** The demos that run once and have a Play again. */
export const RUN_DEMOS = DEMOS.filter((d) => d.again);
/** The longest any demo of the page runs before it is on its last step (the register cycles for ever and is judged apart). */
export const LONGEST = 7_800;
export type Demo = (typeof DEMOS)[number];

// ------------------------------------------------------------------------------------------------ opening the page

/**
 * Opens the page on the app. The SITE-08 helper asks the page under test for its `.pp-site-stage` width (a gallery example sits in one, a real page does not):
 * with no such element that question must fail fast and be let through, so the page's default timeout is short once it is open.
 */
export async function openCompliance(page: Page, path = ROUTE): Promise<void> {
  const res = await page.goto(path);
  if (!res || res.status() >= 400) throw new Error(`${path} answered ${res?.status()}`);
  try { await page.locator('.pp-site-form-page--learn').first().waitFor({ state: 'attached', timeout: 15_000 }); } catch {
    throw new Error(`${path} has no Learn more page top (.pp-site-form-page--learn): the page shows the title "${await page.title()}" and ${(await page.locator('h1').count())} h1`);
  }
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForLoadState('networkidle');
  page.setDefaultTimeout(4_000);
}
/** The page as the SITE-08 helper's checks take it. The footer is judged apart (it sits outside the page's own box on some builds). */
export function complianceSpec(device: Device, open: (page: Page) => Promise<void> = openCompliance): LearnPageSpec {
  return { name: `compliance-${device}`, kitPage: 'Compliance page', device, omit: OMIT, open };
}

// ------------------------------------------------------------------------------------------------ the app page and the kit page, side by side

export type Mode = 'frozen' | 'gated' | 'live';
export type PairOpts = {
  ctx?: object;
  /** 3000px above the page from the first paint, so a demo starts below the fold (SITE-08 lock check T8). */
  spacerFirst?: boolean;
  /** data-site-still on the html element from the first paint. */
  still?: boolean;
  /** Keep the footer on the kit side (the footer check). */
  keepOmit?: boolean;
  /** A script that runs on both pages before the page's own scripts. */
  probe?: () => void;
  plant?: Plant;
  deaf?: boolean;
};
export type Pair = { ctx: BrowserContext; app: Page; kit: Page };

const SPACER_FIRST = () => {
  const add = (): boolean => { if (!document.body) return false; const sp = document.createElement('div'); sp.style.height = '3000px'; sp.setAttribute('data-s11-spacer', ''); document.body.insertBefore(sp, document.body.firstChild); return true; };
  if (!add()) new MutationObserver((_, o) => { if (add()) o.disconnect(); }).observe(document, { childList: true, subtree: true });
};
const STILL_ATTR = () => { const set = () => document.documentElement?.setAttribute('data-site-still', ''); set(); new MutationObserver(set).observe(document, { childList: true }); };
/** The page's own clock at its last click (lock check T5): the first-step picture is taken only when this much time, on the page's clock, has not passed the demo's first change. */
const CLICK_CLOCK = () => { addEventListener('click', () => { (window as unknown as { __t0: number }).__t0 = performance.now(); }, true); };
const DEAF = () => { (window as unknown as { __fireView: () => void }).__fireView = () => undefined; };

function kitDoc(spec: LearnPageSpec, keepOmit: boolean): string {
  const s = screens('pages').find((x) => x.name === spec.kitPage && x.device === spec.device);
  if (!s) throw new Error(`site-11: the kit has no "${spec.kitPage} (${spec.device})"`);
  const omit = keepOmit ? '' : spec.omit ?? '';
  const prep = `var st=document.querySelector('.pp-site-stage');var om=${JSON.stringify(omit)};if(om)st.querySelectorAll(om).forEach(function(e){e.remove();});st.querySelectorAll('.pp-site-subnav__link').forEach(function(a){if(!document.getElementById(a.getAttribute('href').slice(1)))a.remove();});var h=st.querySelector('.pp-site-form-page--learn');if(h&&h.parentElement)h.parentElement.setAttribute('data-s11-root','');`;
  return kitDocument(s.stage, KIT_SCRIPTS, { device: spec.device, prep });
}

/** One fresh context holding the page under test and the kit page, both driven the same way. */
export async function openPair(env: Env, spec: LearnPageSpec, mode: Mode, o: PairOpts = {}): Promise<Pair> {
  const d = spec.device;
  const vp = env.page.viewportSize()!;
  const ctx = await env.browser.newContext({ baseURL: env.baseURL, viewport: vp, hasTouch: d === 'phone', isMobile: d === 'phone', ...(o.ctx ?? {}) });
  try {
    if (o.spacerFirst) await ctx.addInitScript(SPACER_FIRST);
    if (o.still) await ctx.addInitScript(STILL_ATTR);
    if (mode === 'frozen') await ctx.addInitScript(FREEZE_VIEW);
    if (mode === 'gated') { await ctx.addInitScript(GATED_VIEW); if (o.deaf) await ctx.addInitScript(DEAF); }
    if (mode === 'live' && o.deaf) await ctx.addInitScript(FREEZE_VIEW);
    if (o.probe) await ctx.addInitScript(o.probe);
    await ctx.addInitScript(CLICK_CLOCK);
    const app = await ctx.newPage();
    await spec.open(app);
    const marked = await app.evaluate(() => { const r = document.querySelector('.pp-site-form-page--learn')?.parentElement; r?.setAttribute('data-s11-root', ''); return !!r; });
    if (!marked) throw new Error(`${spec.name}: the page has no Learn more page top (.pp-site-form-page--learn)`);
    if (o.plant) await o.plant(app);
    const kit = await ctx.newPage();
    await kit.setViewportSize(vp);
    await openKitDocument(kit, new URL(env.baseURL).origin, kitDoc(spec, !!o.keepOmit));
    // The pointer is parked outside the window: a pointer that rests over a button when the page moves under it draws the button's hover (a colour and an arrow that fade in)
    // on one page and not on the other, which a picture or the set of transitions then reads as a difference (seen on the phone, 1 run in 4, with the pointer at the left edge).
    for (const pg of [app, kit]) await pg.mouse.move(-1, -1);
    return { ctx, app, kit };
  } catch (e) { await ctx.close(); throw e; }
}
export async function using<T>(pair: Promise<Pair>, run: (p: Pair) => Promise<T>): Promise<T> {
  const p = await pair;
  try { return await run(p); } finally { await p.ctx.close(); }
}
/** The id of a section on the kit page (the kit's ids carry the page and width). */
export const kitId = (p: Page, id: string): Promise<string> => p.evaluate((x) => Array.from(document.querySelectorAll('[id]')).map((e) => e.id).find((i) => i.replace(/-[a-z0-9]{4}$/, '') === x) ?? x, id);

// ------------------------------------------------------------------------------------------------ timelines

/**
 * The SITE-08 `timeline`, with the inline `--_p` of the hero card's bars added to what a state is, so a bar that does not grow is a different state.
 * Same sampler (every 20ms), same fingerprint otherwise.
 */
export async function timeline9(page: Page, scope: string, ms: number, _skip = ''): Promise<Step[]> {
  return page.evaluate(([scope, ms]) => new Promise<Step[]>((resolve) => {
    const root = document.querySelector(scope as string);
    if (!root) return resolve([{ t: 0, sig: `NO ELEMENT ${scope}` }]);
    const w = window as unknown as { __tl0?: number };
    if (w.__tl0 === undefined) w.__tl0 = performance.now();
    let prev = new Map<number, string>();
    const sample = (): string => {
      const now = new Map<number, string>();
      let all = '';
      let i = 0;
      const walk = (el: Element) => {
        if (el.tagName.toLowerCase() === 'svg') { i++; return; }
        const cls = Array.from(el.classList).filter((c) => c.startsWith('pp-') && !/^pp-icon/.test(c) && !/^pp-site-reveal/.test(c)).sort().join('.');
        const at = ['disabled', 'aria-selected', 'aria-pressed', 'aria-expanded', 'aria-hidden'].map((a) => (el.hasAttribute(a) ? `${a[0] === 'd' ? 'd' : a.slice(5, 7)}=${el.getAttribute(a)}` : '')).join('');
        const st = (el as HTMLElement).style;
        const fill = `${st?.getPropertyValue('--_fill') ?? ''}/${st?.getPropertyValue('--_p') ?? ''}`;
        const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
        const key = `${el.tagName[0]}.${cls}|${at}|${fill}|${own}`;
        now.set(i, key);
        all += key + '\n';
        i++;
        for (const c of Array.from(el.children)) walk(c);
      };
      walk(root);
      let h = 5381;
      for (let k = 0; k < all.length; k++) h = ((h << 5) + h + all.charCodeAt(k)) | 0;
      const changed: string[] = [];
      for (const [n, v] of now) { const p = prev.get(n); if (p !== undefined && p !== v) changed.push(v.slice(0, 70)); }
      prev = now;
      return `${(h >>> 0).toString(36)} ${changed.slice(0, 4).join(' ; ')}`;
    };
    const out: Step[] = [];
    const t0 = performance.now();
    let last = '';
    const tick = () => {
      const s = sample();
      const key = s.split(' ')[0]!;
      if (key !== last) { out.push({ t: Math.round(performance.now() - t0), sig: s }); last = key; }
      if (performance.now() - t0 >= (ms as number)) return resolve(out);
      setTimeout(tick, 20);
    };
    tick();
  }), [scope, ms] as const);
}

/**
 * Firing the views, with the page's own clock: the moment the views were fired and the moment the first recording of the run began, both on the page's `performance.now()`.
 * A first change is judged by its distance from the page's own fire, so a stalled runner or page (load 5 and more) that delivers the fire late to one of the two pages does not read as a
 * demo that starts late (the first check of this kind flaked once in three runs under load, with the kit 800ms late).
 */
export const fire = async (p: Page): Promise<void> => { await p.evaluate(() => { const w = window as unknown as { __fireAt?: number; __fireView: () => void }; w.__fireAt = performance.now(); w.__fireView(); }); };
export const resetClock = (p: Page): Promise<void> => p.evaluate(() => { const w = window as unknown as { __fireAt?: number; __tl0?: number }; delete w.__fireAt; delete w.__tl0; });
export const fireOffset = (p: Page): Promise<number | null> => p.evaluate(() => { const w = window as unknown as { __fireAt?: number; __tl0?: number }; return w.__fireAt !== undefined && w.__tl0 !== undefined ? w.__fireAt - w.__tl0 : null; });
export type Off = { app: number | null; kit: number | null } | undefined;

/** The two timelines pass through the same states in the same order, each within TOL of the kit's time. */
export function expectSame(label: string, app: Step[], kit: Step[], off?: Off, gap = 45): void {
  const a = settled(fromFirstChange(app), gap), k = settled(fromFirstChange(kit), gap);
  expect(kit.length, `${label}: the kit page moved at all`).toBeGreaterThan(1);
  const h = (s: Step) => s.sig.split(' ')[0];
  const at = a.findIndex((s, i) => !k[i] || h(s) !== h(k[i]!));
  expect(a.map(h), `${label}: the page passes through the same states, in the same order, as the kit${at < 0 ? '' : ` (first difference at #${at}: page "${a[at]?.sig.slice(0, 200) ?? 'none'}", kit "${k[at]?.sig.slice(0, 200) ?? 'none'}")`}`).toEqual(k.map(h));
  expect(sameTimeline(a, k, TOL).late, `${label}: each state shows within ${TOL}ms of when the kit shows it`).toEqual([]);
  // Times above count from each page's own first change, so a page that starts its run late as a whole would pass them. Both pages are fired together: the first change is
  // judged by its distance from the page's own fire as well (a demo that waits a second before it starts, or one that starts before its view reports, is not the kit's).
  const t0 = (x: Step[]) => settled(x, gap)[1]?.t ?? -1;
  if (off && off.app !== null && off.kit !== null) {
    const da = t0(app) - off.app, dk = t0(kit) - off.kit;
    expect(Math.abs(da - dk), `${label}: the first change comes within ${TOL}ms of the kit's after the views are fired (page ${Math.round(da)}ms, kit ${Math.round(dk)}ms)`).toBeLessThanOrEqual(TOL);
  }
}
/** Both pages watched for `ms` at the same moment; 100ms in, `act` runs on each (the views are fired by `fire` when `start`). */
export async function both(p: Pair, scopes: { app: string; kit: string }, ms: number, act?: (page: Page, isKit: boolean) => Promise<void>, start = true, fn: typeof timeline9 = timeline9): Promise<{ app: Step[]; kit: Step[]; off: Off }> {
  const go = async (pg: Page, scope: string, isKit: boolean) => {
    await resetClock(pg);
    const rec = fn(pg, scope, ms);
    await sleep(100);
    if (start) await fire(pg);
    if (act) await act(pg, isKit);
    return rec;
  };
  const [app, kit] = await Promise.all([go(p.app, scopes.app, false), go(p.kit, scopes.kit, true)]);
  return { app, kit, off: start ? { app: await fireOffset(p.app), kit: await fireOffset(p.kit) } : undefined };
}

// ------------------------------------------------------------------------------------------------ boxes and pixels of a part of the page

async function diffRatio(p: Page, a: Buffer, b: Buffer): Promise<{ bad: number; all: number }> {
  return p.evaluate(async ([a, b]) => {
    const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const [A, B] = await Promise.all([load(a!), load(b!)]);
    const w = Math.max(A.width, B.width), h = Math.max(A.height, B.height);
    const data = (img: HTMLImageElement) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!; x.fillStyle = '#f0f'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = data(A), db = data(B);
    // As the SITE-08 diff: a pixel counts when it differs from the other page's pixel at the same place and from the ones just above and below it.
    const far = (i: number, j: number) => Math.abs(da[i]! - db[j]!) > 24 || Math.abs(da[i + 1]! - db[j + 1]!) > 24 || Math.abs(da[i + 2]! - db[j + 2]!) > 24;
    const far2 = (i: number, j: number) => Math.abs(db[i]! - da[j]!) > 24 || Math.abs(db[i + 1]! - da[j + 1]!) > 24 || Math.abs(db[i + 2]! - da[j + 2]!) > 24;
    let bad = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, up = y > 0 ? i - w * 4 : i, down = y < h - 1 ? i + w * 4 : i;
      if (far(i, i) && far(i, up) && far(i, down) && far2(i, up) && far2(i, down)) bad++;
    }
    return { bad, all: w * h };
  }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]);
}
const boxOf = (p: Page, sel: string) => p.evaluate((s) => { const r = document.querySelector(s)!.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; }, sel);

/** The share of pixels that differ between the same region of the two pages, taken in slices so a tall page stays under the screenshot limit. */
export async function pixelRatio(p: Pair, appSel: string, kitSel: string, slice = 2400): Promise<number> {
  // Both pages at the top: the header and the sub-menu stick there, over the hero, not over the region that is photographed.
  for (const pg of [p.app, p.kit]) await pg.evaluate(() => window.scrollTo(0, 0));
  await sleep(250);
  let bad = 0, all = 0, W = 0;
  const same = (x: { y: number; height: number }, y: { y: number; height: number }) => Math.abs(x.y - y.y) < 0.5 && Math.abs(x.height - y.height) < 0.5;
  // A demo elsewhere on the page may still be changing height while the pictures are taken: each picture counts only when the region sat still before and after it.
  const shoot = async (pg: Page, sel: string, y: number, slice: number, hAll: number) => {
    for (let t = 0; t < 12; t++) {
      const b0 = await boxOf(pg, sel);
      const clip = { x: Math.max(0, Math.round(b0.x)), y: Math.round(b0.y) + y, width: W, height: Math.min(slice, hAll - y) };
      const shot = await pg.screenshot({ clip, fullPage: true, animations: 'disabled' });
      if (same(b0, await boxOf(pg, sel))) return { shot, b: b0 };
      await sleep(200);
    }
    throw new Error(`${sel}: the region keeps moving, so it cannot be photographed`);
  };
  const a0 = await boxOf(p.app, appSel), k0 = await boxOf(p.kit, kitSel);
  const h = Math.round(Math.max(a0.height, k0.height));
  W = Math.round(Math.max(a0.width, k0.width));
  for (let y = 0; y < h; y += slice) {
    const hh = Math.min(slice, h - y);
    const A = await shoot(p.app, appSel, y, hh, y + hh), K = await shoot(p.kit, kitSel, y, hh, y + hh);
    const r = await diffRatio(p.kit, K.shot, A.shot);
    bad += r.bad; all += r.all;
  }
  return all ? bad / all : 1;
}

/** Both pages wait for document.fonts.ready and get a resize event, then 150ms: the kit's scripts measure (sub-menu pills, for one) when they first run, before the web font has loaded, so every measuring script runs again on the same fonts before a box is compared. */
export async function fontsAndResize(p: Pair): Promise<void> {
  for (const page of [p.app, p.kit]) { await page.evaluate(async () => { await document.fonts.ready; window.dispatchEvent(new Event('resize')); }); await sleep(150); }
}

/** A region of the app page against the same region of the kit page: every kit item in order and within 1px, and at most 1% of pixels different. */
export async function compareRegion(p: Pair, label: string, appSel: string, kitSel: string, o: { skip?: string; hide?: string; skipRoot?: boolean } = {}): Promise<void> {
  await fontsAndResize(p);
  await settle(p.kit); await settle(p.app);
  const r = await compareScopes(p.app, p.kit, label, appSel, kitSel, o.skip ?? '', false, o.skipRoot ?? false);
  expect(r.kitElements, `${label}: the kit region has elements`).toBeGreaterThanOrEqual(3);
  expect(r.unmatched.slice(0, 12), `${label}: every kit item is on the page, in order`).toEqual([]);
  expect(r.moved.slice(0, 12), `${label}: every box is within 1px of the kit`).toEqual([]);
  if (o.hide) await p.app.evaluate((s) => document.querySelectorAll(s).forEach((e) => ((e as HTMLElement).style.display = 'none')), o.hide);
  const ratio = await pixelRatio(p, appSel, kitSel);
  expect(ratio, `${label}: at most 1% of pixels differ (${(ratio * 100).toFixed(2)}%)`).toBeLessThanOrEqual(0.01);
}

// ------------------------------------------------------------------------------------------------ words, banned words

const BANNED = /lorem|placeholder|masked|claude|pepla/gi;
/** Every text node and accessible name on the whole page (header, page, footer; the phone sheet aside) and on the kit screen, as two sets. */
export async function wholePageWords(p: Pair): Promise<{ app: ReturnType<typeof wordsOf>; kit: ReturnType<typeof wordsOf> }> {
  const skip = '.pp-site-sheet';
  const app = await p.app.evaluate(wordsOf, ['body', skip] as [string, string]);
  const kit = await p.kit.evaluate(wordsOf, ['.pp-site-stage', skip] as [string, string]);
  return { app, kit };
}
/** The banned words found in the rendered page: text, attributes (href included), classes and the title. */
export async function bannedIn(page: Page): Promise<string[]> {
  const html = await page.evaluate(() => { const c = document.documentElement.cloneNode(true) as HTMLElement; c.querySelectorAll('script, style, noscript').forEach((n) => n.remove()); return c.outerHTML; });
  return html.match(BANNED) ?? [];
}
export { BANNED };

// ------------------------------------------------------------------------------------------------ the page's own facts

/** In the page: the visible words of every h1 and h2 inside `sel` (a heading's shine copy and other aria-hidden parts left out). */
export function headingTexts(sel: string): string[] {
  const r = document.querySelector(sel)!;
  const vis = (e: Element) => { let t = ''; const w = (n: Node) => { if (n.nodeType === 3) t += n.textContent; else if (n.nodeType === 1 && (n as Element).getAttribute('aria-hidden') !== 'true' && !['SCRIPT', 'STYLE'].includes((n as Element).tagName)) n.childNodes.forEach(w); }; w(e); return t.replace(/\s+/g, ' ').trim(); };
  return Array.from(r.querySelectorAll('h1,h2')).map((h) => vis(h)).filter(Boolean);
}
/** The h1 and h2 texts of the kit screen of the page (the words the prerendered page must hold). */
export async function kitHeadings(env: Env, spec: LearnPageSpec): Promise<string[]> {
  const ctx = await env.browser.newContext({ baseURL: env.baseURL, viewport: env.page.viewportSize()! });
  try {
    const kit = await ctx.newPage();
    const s = screens('pages').find((x) => x.name === spec.kitPage && x.device === spec.device)!;
    await openKitDocument(kit, new URL(env.baseURL).origin, kitDocument(s.stage, [], { device: spec.device }));
    return await kit.evaluate(headingTexts, '.pp-site-stage');
  } finally { await ctx.close(); }
}

/** Landmarks of the page in document order, by class: what comes after what (the page's order, ending, closing band, footer). */
export function orderFacts() {
  const sel = 'section.pp-site-hero, nav.pp-site-subnav, section.pp-site-demo, section.pp-site-batsi, section.pp-site-strip, section.pp-site-related, section.pp-site-faq, section.pp-site-band, footer.pp-site-footer';
  return Array.from(document.querySelectorAll(sel)).map((e) => `${e.tagName.toLowerCase()}.${Array.from(e.classList).filter((c) => /^pp-site-(hero|subnav|demo|batsi|strip|related|faq|band|footer)$/.test(c)).join('.')}#${e.id.replace(/-[a-z0-9]{4}$/, '')}`);
}
/** Facts about each named section: its id once, its accessible name (the heading it points at, inside it), the ground. */
export function sectionFacts(ids: readonly string[]) {
  const txt = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return ids.map((id) => {
    const all = document.querySelectorAll(`[id="${id}"]`);
    const el = all[0] ?? null;
    const by = el?.getAttribute('aria-labelledby') ?? '';
    const h = by ? document.getElementById(by) : null;
    return { id, count: all.length, tag: el?.tagName.toLowerCase() ?? '', named: !!h && /^H[1-6]$/.test(h.tagName) && !!el && el.contains(h), name: txt(h) };
  });
}

// ------------------------------------------------------------------------------------------------ the five demos

/** A demo plays only once it is in view, judged with the real view observer (3000px of spacer first). Not started at 12% in view (the card says 15%, the kit 35%: lock check T9, 6% let a 10% threshold through), started at 60%. */
export async function checkDemoStart(env: Env, spec: LearnPageSpec, d: Demo, o: PairOpts = {}): Promise<void> {
  await using(openPair(env, spec, 'live', { spacerFirst: true, ...o }), async ({ app, kit }) => {
    const kid = await kitId(kit, d.id);
    const flow = async (p: Page, id: string) => {
      const live = () => p.evaluate((x) => document.getElementById(x)!.hasAttribute('data-site-live'), id);
      const show = (f: number) => p.evaluate(([x, fr]) => { const sec = document.getElementById(x as string)!; const r = sec.getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - (innerHeight - (fr as number) * r.height)); }, [id, f] as const);
      const out: Record<string, boolean> = {};
      await show(0.12); await sleep(1500); out['at12'] = await live();
      await show(0.6); await sleep(1000); out['at60'] = await live();
      return out;
    };
    expect(await app.evaluate(() => document.querySelectorAll('[data-s11-spacer]').length), `${spec.name}: the spacer is in the page`).toBe(1);
    const [a, k] = await Promise.all([flow(app, d.id), flow(kit, kid)]);
    expect(k['at12'], `${d.id}: the kit demo has not started at 12% in view`).toBe(false);
    expect(a['at12'], `${d.id}: the demo has not started below 15% in view (here 12%)`).toBe(false);
    expect(a['at60'], `${d.id}: the demo starts once 15% or more of it is in view (here 60%)`).toBe(true);
  });
}

/**
 * One demo, against the kit: the run (states in order, each within 250ms), the last step and the first step as the kit draws them (boxes within 1px, 1% of pixels),
 * and Play again (the same run again from the first step, focus kept on the button). `byHand` runs a click at `at` ms on both pages and compares that run too.
 * The certificate register has no Play again and no end: it is `checkRegister`.
 */
export async function checkDemo(env: Env, spec: LearnPageSpec, d: Demo, o: PairOpts & { byHand?: { at: number; sel: string; ms: number; label: string }; after?: (app: Page) => Promise<void> } = {}): Promise<void> {
  if (!d.again) { await checkRegister(env, spec, d, o); return; }
  await using(openPair(env, spec, 'gated', o), async (p) => {
    const kid = await kitId(p.kit, d.id);
    const scopes = { app: `[id="${d.id}"]`, kit: `[id="${kid}"]` };
    // The kit's demo has one Play again (counted on the kit too, so the expectation is the kit's and not a guess); a page with two, or none, is judged here by name and not by a strict-mode error below.
    expect(await p.kit.locator(`${scopes.kit} .pp-site-demo__again`).count(), `${d.id}: control: the kit demo has one Play again`).toBe(1);
    expect(await p.app.locator(`${scopes.app} .pp-site-demo__again`).count(), `${d.id}: the demo has exactly one Play again, as the kit's (lock check SITE-11 T1)`).toBe(1);
    // The run.
    const r = await both(p, scopes, d.run);
    expectSame(`${d.id}, the run`, r.app, r.kit, r.off);
    // The last step (the demo has finished on both pages).
    await compareRegion(p, `${d.id}, last step`, scopes.app, scopes.kit, { skipRoot: false });
    if (o.after) await o.after(p.app);
    // Play again by key: the same run again, from the first step, and focus stays on the button.
    await p.app.locator(`${scopes.app} .pp-site-demo__again`).focus();
    const again = await both(p, scopes, d.run, async (pg, isKit) => { if (isKit) await hit(pg, `${scopes.kit} .pp-site-demo__again`); else await pg.keyboard.press('Enter'); }, false);
    expectSame(`${d.id}, Play again`, again.app, again.kit);
    expect(await p.app.evaluate((s) => document.activeElement === document.querySelector(s + ' .pp-site-demo__again'), scopes.app), `${d.id}: Play again keeps focus after the restart`).toBe(true);
    expect(await p.app.locator(`${scopes.app} button.pp-site-demo__again`).count(), `${d.id}: Play again is a button`).toBe(1);
    if (o.byHand) {
      const h = o.byHand;
      await sleep(d.run);
      const w = await both(p, scopes, h.ms, async (pg, isKit) => { await hit(pg, `${isKit ? scopes.kit : scopes.app} .pp-site-demo__again`); await sleep(h.at); await hit(pg, `${isKit ? scopes.kit : scopes.app} ${h.sel}`); }, false);
      expectSame(`${d.id}, ${h.label}`, w.app, w.kit, w.off);
    }
    // Play again by click: the first step, drawn as the kit draws it, 80ms after the click. The pages are compared one after the other, so every timer on both is cleared at the
    // 80ms mark: what is drawn is the state both were in then, not whatever the demo reached while the pictures were taken.
    // Lock check SITE-10 T3: "120ms after the click" is a wait on the test runner's clock; a stalled page or runner (load 6 and more) lets the demo's first change
    // come before the timers are cleared, and the picture is then the second step. Each page reports its own time between the click and the clearing; the picture is taken only
    // when that was under 250ms on both (the first change of these demos is 300ms or more after the click), else the demo is run again.
    let took = [Infinity, Infinity];
    for (let attempt = 0; attempt < 6 && Math.max(...took) >= 250; attempt++) {
      await sleep(d.run);
      await Promise.all([p.app, p.kit].map((pg, i) => hit(pg, `${i ? scopes.kit : scopes.app} .pp-site-demo__again`)));
      await sleep(80);
      took = await Promise.all([p.app, p.kit].map(stopTimers));
    }
    expect(Math.max(...took), `${d.id}: the first step could be photographed within 250ms of Play again (page ${Math.round(took[0]!)}ms, kit ${Math.round(took[1]!)}ms)`).toBeLessThan(250);
    await compareRegion(p, `${d.id}, first step`, scopes.app, scopes.kit);
  });
  await checkDemoStart(env, spec, d, o);
}

// ------------------------------------------------------------------------------------------------ the certificate register

/** Counts every change of a filter button's `aria-pressed` anywhere in the register, from the first paint: a cycle that has started shows here, a page that only draws its first state does not. */
export const FILTER_PROBE = () => {
  const w = window as unknown as { __filt: { n: number; log: string[] } };
  w.__filt = { n: 0, log: [] };
  const start = () => new MutationObserver((ms) => {
    for (const m of ms) {
      const t = m.target as Element;
      if (m.attributeName === 'aria-pressed' && t.getAttribute('aria-pressed') !== m.oldValue && t.closest?.('[id^="register"]')) { w.__filt.n++; w.__filt.log.push(`${(t.textContent ?? '').slice(0, 12)}=${t.getAttribute('aria-pressed')}`); }
    }
  }).observe(document, { attributes: true, attributeOldValue: true, attributeFilter: ['aria-pressed'], subtree: true });
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
};
const filterChanges = (p: Page) => p.evaluate(() => (window as unknown as { __filt: { n: number } }).__filt.n);
/** A click on the register's filter by position (all, expiring, overdue). */
const clickFilter = (p: Page, scope: string, n: number) => p.locator(`${scope} .pp-site-register__filter`).nth(n).evaluate((el) => (el as HTMLElement).click());

/**
 * The certificate register: no Play again and no end. The kit cycles its filters by itself, the first change 2.6s after it is in view and one every 3.2s after that (all, expiring in
 * 30 days, overdue, all, ...), and a click on a filter answers at once and stops the cycle for good. Four fresh pages:
 * 1. the cycle: four changes inside 14s, each within 250ms of the kit's, the first on the recording's clock too (the cycle begins when the view reports);
 * 2. a click on "Expiring in 30 days" 1s in (before the first cycle change) and 3. a click on "Overdue" 4s in (after one): the page does what the kit does and the cycle stays stopped (8s);
 * 4. the three filters as pictures (boxes within 1px, 1% of pixels) after a click on each, in the order expiring, overdue, all.
 * The start is judged with the real view observer: no change at 12% in view in 3.6s (the cycle's first change is due at 2.6s), a change at 60%.
 */
export async function checkRegister(env: Env, spec: LearnPageSpec, d: Demo, o: PairOpts = {}): Promise<void> {
  const scopesOf = async (p: Pair) => ({ app: `[id="${d.id}"]`, kit: `[id="${await kitId(p.kit, d.id)}"]` });
  await using(openPair(env, spec, 'gated', o), async (p) => {
    const scopes = await scopesOf(p);
    // The register has no Play again in the kit (counted on the kit here, so the rule is the kit's): a page that adds one, as the card's AC-7 reads, is not the kit's (lock check SITE-11 T1).
    expect(await p.kit.locator(`${scopes.kit} .pp-site-demo__again`).count(), `${d.id}: control: the kit register has no Play again`).toBe(0);
    expect(await p.app.locator(`${scopes.app} .pp-site-demo__again`).count(), `${d.id}: the register has no Play again, as the kit's (it cycles its filters and answers a click)`).toBe(0);
    const r = await both(p, scopes, 14_000);
    expect(settled(fromFirstChange(r.kit)).length, `${d.id}: control: the kit register cycles its filters four times in 14s`).toBeGreaterThanOrEqual(4);
    expectSame(`${d.id}, the filters cycle by themselves`, r.app, r.kit, r.off);
  });
  for (const [n, at, label] of [[1, 1_000, 'a click on "Expiring in 30 days" 1s in (before the cycle has changed anything)'], [2, 4_000, 'a click on "Overdue" 4s in (after one cycle change)']] as const) {
    await using(openPair(env, spec, 'gated', o), async (p) => {
      const scopes = await scopesOf(p);
      // The first change here is the click, made on the runner's clock on each page, so it is judged by the order and spacing of the states (each within 250ms of the kit's from the first change) and not by its distance from the fire.
      const w = await both(p, scopes, 8_000, async (pg, isKit) => { await sleep(at); await clickFilter(pg, isKit ? scopes.kit : scopes.app, n); });
      expect(settled(fromFirstChange(w.kit)).length, `${d.id}: control: the kit answers ${label}`).toBeGreaterThanOrEqual(1);
      expectSame(`${d.id}, ${label}: the filter answers at once and the cycle stays stopped`, w.app, w.kit);
    });
  }
  await using(openPair(env, spec, 'frozen', o), async (p) => {
    const scopes = await scopesOf(p);
    for (const [n, name] of [[1, 'Expiring in 30 days'], [2, 'Overdue'], [0, 'All']] as const) {
      await Promise.all([p.app, p.kit].map((pg, i) => clickFilter(pg, i ? scopes.kit : scopes.app, n)));
      await sleep(400);
      await compareRegion(p, `${d.id}, filter "${name}"`, scopes.app, scopes.kit, { skipRoot: false });
    }
  });
  await checkRegisterStart(env, spec, d, o);
}

/** The cycle starts once the register is in view: not with 12% of it in view (3.6s: the kit's first change comes 2.6s after it starts), yes with 60% (4.5s). */
async function checkRegisterStart(env: Env, spec: LearnPageSpec, d: Demo, o: PairOpts = {}): Promise<void> {
  await using(openPair(env, spec, 'live', { spacerFirst: true, ...o, probe: FILTER_PROBE }), async ({ app, kit }) => {
    const kid = await kitId(kit, d.id);
    const flow = async (p: Page, id: string) => {
      const show = (f: number) => p.evaluate(([x, fr]) => { const sec = document.getElementById(x as string)!; const r = sec.getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - (innerHeight - (fr as number) * r.height)); }, [id, f] as const);
      const out: Record<string, number> = {};
      await show(0.12); await sleep(3_600); out['at12'] = await filterChanges(p);
      await show(0.6); await sleep(4_500); out['at60'] = await filterChanges(p);
      return out;
    };
    expect(await app.evaluate(() => document.querySelectorAll('[data-s11-spacer]').length), `${spec.name}: the spacer is in the page`).toBe(1);
    const [a, k] = await Promise.all([flow(app, d.id), flow(kit, kid)]);
    expect(k['at12'], `${d.id}: the kit register has not started cycling at 12% in view`).toBe(0);
    expect(k['at60'], `${d.id}: the kit register cycles once 60% is in view`).toBeGreaterThanOrEqual(1);
    expect(a['at12'], `${d.id}: the register does not cycle its filters below 15% in view (here 12%, 3.6s)`).toBe(0);
    expect(a['at60'], `${d.id}: the register starts cycling its filters once 15% or more of it is in view (here 60%, 4.5s)`).toBeGreaterThanOrEqual(1);
  });
}

/** Clear every pending timer and animation frame of the page: it stays as it is, so it can be photographed. */
async function stopTimers(p: Page): Promise<number> {
  return p.evaluate(() => { const t0 = (window as unknown as { __t0?: number }).__t0 ?? performance.now(); const t = window.setTimeout(() => undefined, 0), r = window.requestAnimationFrame(() => undefined); for (let i = 0; i <= t + 50; i++) { clearTimeout(i); clearInterval(i); } for (let i = 0; i <= r + 50; i++) cancelAnimationFrame(i); return performance.now() - t0; });
}

// ------------------------------------------------------------------------------------------------ the hero card

export const HCARD = '.pp-site-hcard[data-demo="hcard-compliance"]';
/** The hero card loops as the kit's preview script does: every step within 250ms, a loop with no jump of its own (same states, same box heights as the kit's), under data-site-still its last step. */
export async function checkHeroCard(env: Env, spec: LearnPageSpec, o: PairOpts = {}): Promise<void> {
  const want = await using(openPair(env, spec, 'gated', o), async (p) => {
    expect(await p.app.locator(HCARD).count(), `${spec.name}: the page's hero card is the Compliance one (${HCARD})`).toBe(1);
    const heights = (pg: Page) => pg.evaluate((s) => new Promise<number[]>((resolve) => { const out: number[] = []; const t0 = performance.now(); const tick = () => { out.push(Math.round(document.querySelector(s)!.getBoundingClientRect().height * 10) / 10); if (performance.now() - t0 > 15_000) return resolve(out); setTimeout(tick, 100); }; tick(); }), HCARD);
    const hp = Promise.all([heights(p.app), heights(p.kit)]);
    const r = await both(p, { app: HCARD, kit: HCARD }, 16_000, undefined, true, timeline9);
    expectSame('hero card, the loop (every step, and the return to the first step)', r.app, r.kit, r.off);
    const [ha, hk] = await hp;
    // The box changes as the kit's does and no more: the same heights in the same number (on a phone the kit's card is taller for the longer note, 54px, and falls back with the loop; on a desktop it never moves),
    // so a page whose card jumps where the kit's does not, or that jumps by another amount, fails. The card's first height is the kit's.
    const distinct = (hs: number[]) => [...new Set(hs.map((h) => Math.round(h)))].sort((x, y) => x - y);
    const da = distinct(ha), dk = distinct(hk);
    expect(da.length, `hero card: the box takes the kit's number of heights while it loops (page ${da.join(', ')}, kit ${dk.join(', ')})`).toBe(dk.length);
    expect(da.map((h, i) => Math.abs(h - dk[i]!)).filter((x) => x > 1), `hero card: the box takes the kit's heights while it loops (page ${da.join(', ')}, kit ${dk.join(', ')})`).toEqual([]);
    expect(Math.abs(ha[0]! - hk[0]!), 'hero card: the box is the kit\'s').toBeLessThanOrEqual(1);
    // The loop came round: after the last step the first one shows again.
    const first = fromFirstChange(r.app)[0]!.sig.split(' ')[0];
    expect(r.app.filter((s) => s.sig.split(' ')[0] === first).length, 'hero card: the loop returns to the state it began in').toBeGreaterThanOrEqual(2);
    // The kit's last step, held from the last step to the restart (7.6s to 11.8s after the card started): what data-site-still must show. Times here count
    // from the start of the recording, 100ms before the views are fired, so the kit's three steps come at 2.5, 4.7 and 7.7s and its restart at 11.9s.
    const hold = settled(r.kit).filter((s) => s.t > 7_000 && s.t < 11_500).at(-1) ?? r.kit.filter((s) => s.t < 11_500).at(-1)!;
    return hold.sig.split(' ')[0];
  });
  // Under data-site-still: the last step, at once, and nothing moves on (a fresh context, so nothing of the first run is left in memory).
  await using(openPair(env, spec, 'gated', { ...o, still: true }), async (q) => {
    await fire(q.app); await sleep(900);
    const got = (await timeline9(q.app, HCARD, 40)).at(-1)!.sig.split(' ')[0];
    expect(got, 'hero card: under data-site-still it shows its last step (the state the kit holds before it loops)').toBe(want);
    // The kit's card restarts 11.8s after it began: a card that still loops would be back at its first step by now.
    await sleep(12_500);
    expect((await timeline9(q.app, HCARD, 40)).at(-1)!.sig.split(' ')[0], 'hero card: under data-site-still nothing moves on and nothing loops').toBe(want);
  });
}

// ------------------------------------------------------------------------------------------------ motion: reduced motion and data-site-still, every demo

/**
 * Records every script animation (`element.animate`) that moves something by transform, anywhere on the page: a card flying, a step sliding in. The Compliance page has
 * none in the kit (its movement is CSS: transitions and loops), so under reduced motion the set must stay empty (the rule: grain, flying cards, tilt and other large
 * movement stop; CSS loops at their slower reduced-motion durations are allowed, so a CSSAnimation or CSSTransition is not counted).
 */
export const SLIDE_PROBE = () => {
  const w = window as unknown as { __slide: Set<string> };
  w.__slide = new Set();
  setInterval(() => {
    for (const a of document.getAnimations()) {
      if (a instanceof CSSTransition || a instanceof CSSAnimation) continue;
      const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
      if (t && Object.keys((a.effect as KeyframeEffect).getKeyframes()[0] ?? {}).some((k) => /^(transform|translate|scale|rotate)$/.test(k))) w.__slide.add(`${t.tagName.toLowerCase()}.${String(t.className).slice(0, 40)}`);
    }
  }, 20);
};
/**
 * Under prefers-reduced-motion every demo keeps playing at the kit's timings (the Iggie rule, design system #49): the five demos, the hero card and the Ask Batsi band run
 * together on both pages and each is compared to the kit within 250ms (lock check SITE-09 T2: one demo judged let the others stop); a question put to Ask Batsi plays its
 * three states at the kit's timings too. No script animation slides anything (the control: a slide put on the page by hand is seen by the probe). Nothing is judged for a flying card: the Compliance kit has none.
 */
export async function reducedDemos(env: Env, spec: LearnPageSpec): Promise<void> {
  // Seven recordings run at once on each page, and on a loaded machine (load 6 and more) the sampler or a timer on one page stalls by more than 250ms, a state shows late and the same
  // correct page fails (lock check SITE-11 T3: three plants that touch nothing of this run failed here, each on another demo, at load 6 to 8). The run is judged up to three times, each on fresh
  // pages: a page whose timings are wrong is wrong on every one, a stall is not.
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await reducedDemosOnce(env, spec); last = undefined; break; } catch (e) { last = e; }
  }
  if (last) throw last;
  // Ask Batsi, a question put by hand (the band answers, waits for a person, is approved and logged), under reduced motion: the kit's states at the kit's times.
  await using(openPair(env, spec, 'frozen', { ctx: { reducedMotion: 'reduce' } }), async ({ app, kit }) => {
    const go = async (p: Page) => { await resetClock(p); const rec = timeline9(p, 'section.pp-site-batsi', 9_500); await sleep(100); await p.locator('.pp-site-ask__chip').nth(1).evaluate((el) => { (window as unknown as { __fireAt?: number }).__fireAt = performance.now(); (el as HTMLElement).click(); }); return rec; };
    const [a, k] = await Promise.all([go(app), go(kit)]);
    expectSame('reduced motion, Ask Batsi still plays at the kit\'s timings', a, k, { app: await fireOffset(app), kit: await fireOffset(kit) });
  });
}
async function reducedDemosOnce(env: Env, spec: LearnPageSpec): Promise<void> {
  await using(openPair(env, spec, 'gated', { ctx: { reducedMotion: 'reduce' }, probe: SLIDE_PROBE }), async ({ app, kit }) => {
    const kids = await Promise.all(DEMOS.map((d) => kitId(kit, d.id)));
    // 13.5s: the register's fourth filter change is at 12.4s and its next at 15.6s, the hero card's restart at 12s and its next step at 14.4s: the window ends on no kit state.
    const ms = 13_500;
    const scopes = (ids: string[]) => [...ids.map((i) => `[id="${i}"]`), HCARD];
    const run = async (pg: Page, list: string[]) => { await resetClock(pg); const rec = Promise.all(list.map((s) => timeline9(pg, s, ms))); await sleep(100); await fire(pg); return rec; };
    const [a, k] = await Promise.all([run(app, scopes(DEMOS.map((d) => d.id))), run(kit, scopes(kids))]);
    // The first change is not judged against the fire here: with seven recordings running on each page the sampler can see a change 250ms after it was made (seen on the phone: the kit 37ms, the page 307ms,
    // the same script on both). The start is judged by the single-demo runs; here every step is judged within 250ms of the kit's, from the first change.
    const names = [...DEMOS.map((d) => d.id), 'hero card'];
    names.forEach((n, i) => expectSame(`reduced motion, ${n} still plays at the kit's timings`, a[i]!, k[i]!));
    expect(await app.evaluate(() => [...(window as unknown as { __slide: Set<string> }).__slide]), 'under reduced motion no script animation slides anything on the page').toEqual([]);
    await app.evaluate(() => { (document.querySelector('.pp-site-demo') as HTMLElement).animate([{ transform: 'translateY(8px)' }, { transform: 'none' }], { duration: 600 }); });
    await sleep(150);
    expect(await app.evaluate(() => (window as unknown as { __slide: Set<string> }).__slide.size), 'control: the probe records a script slide put on the page by hand (so the check above cannot pass by seeing nothing)').toBeGreaterThan(0);
  });
}

/** The end state of a demo as the kit leaves it after its run (the four demos that run): the fingerprint of each demo's section on a live kit page. */
async function kitEndSigs(env: Env, spec: LearnPageSpec): Promise<Record<string, string>> {
  return using(openPair(env, spec, 'gated'), async ({ kit }) => {
    await sleep(100); await fire(kit);
    await sleep(LONGEST + 1_200);
    const out: Record<string, string> = {};
    for (const d of RUN_DEMOS) out[d.id] = (await timeline9(kit, `[id="${await kitId(kit, d.id)}"]`, 40)).at(-1)!.sig.split(' ')[0]!;
    return out;
  });
}
/**
 * Under data-site-still every demo shows what it shows at the end of its run, at once, and nothing loops (SITE-08 AC-8 rule, spec AC-11). SITE-08's `checkMotion` only counts
 * steps whose opacity is not 1, which a demo without `.pp-site-step`s never shows; here each demo's end-state facts are read (lock check SITE-09 T3), the fingerprint of each
 * demo equals the kit's end state, and after 16.5s (the hero card restarts at 11.9s) every demo is still where it was. The certificate register has no end (the kit's script ignores
 * the attribute and cycles for ever): under the attribute it must not cycle, so it shows one state, whichever, and not one change of a filter happens between 1.5s and 18s.
 */
export async function stillDemos(env: Env, spec: LearnPageSpec, check: (app: Page, d: Demo) => Promise<void>): Promise<void> {
  const want = await kitEndSigs(env, spec);
  await using(openPair(env, spec, 'gated', { still: true, probe: FILTER_PROBE }), async ({ app }) => {
    await fire(app);
    await sleep(1500);
    const sig = async (d: Demo) => (await timeline9(app, `[id="${d.id}"]`, 40)).at(-1)!.sig.split(' ')[0]!;
    for (const d of RUN_DEMOS) await check(app, d);
    for (const d of RUN_DEMOS) expect(await sig(d), `data-site-still: ${d.id} shows the end state of its run, as the kit leaves it`).toBe(want[d.id]);
    const regSig = await sig(DEMOS[1]);
    const regN = await filterChanges(app);
    await sleep(16_500);
    for (const d of RUN_DEMOS) await check(app, d);
    for (const d of RUN_DEMOS) expect(await sig(d), `data-site-still: ${d.id} is where it was 18s later (no loop, no restart)`).toBe(want[d.id]);
    expect(await filterChanges(app), `data-site-still: the register's filters do not cycle (no change of a filter between 1.5s and 18s)`).toBe(regN);
    expect(await sig(DEMOS[1]), 'data-site-still: the register is in the same state 18s later').toBe(regSig);
  });
}

// ------------------------------------------------------------------------------------------------ phone: nothing under the header, no sideways scroll

/** Every heading and button of the page, scrolled in turn to just under header and sub-menu: visible, inside the window and not covered. */
export async function visibleUnderBars(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = document.querySelector('[data-s11-root]')!;
    const bars = () => {
      const h = document.querySelector('header.pp-site-header, .pp-site-header') as HTMLElement | null;
      const n = document.querySelector('nav[aria-label="On this page"]') as HTMLElement | null;
      return (h ? h.getBoundingClientRect().bottom : 0) + (n ? n.getBoundingClientRect().height : 0);
    };
    const bad: string[] = [];
    const items = Array.from(root.querySelectorAll('h1, h2, h3, button, a.pp-site-button, .pp-button')).filter((e) => {
      const el = e as HTMLElement;
      if (el.closest('[inert]') || el.closest('[aria-hidden="true"]') || (el as HTMLButtonElement).disabled) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
    });
    for (const el of items) {
      const e = el as HTMLElement;
      e.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -(bars() + 8));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = e.getBoundingClientRect();
      const at = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1), Math.min(r.top + Math.min(r.height / 2, 20), innerHeight - 1));
      if (r.left < -1 || r.right > innerWidth + 1 || r.top < bars() - 2 || !at || !(e === at || e.contains(at) || at.contains(e))) bad.push(`${e.tagName.toLowerCase()} "${(e.textContent ?? '').trim().slice(0, 28)}" top ${r.top.toFixed(0)} under ${bars().toFixed(0)}`);
    }
    return bad;
  });
}
/** Measured against the width the context was opened with, not innerWidth: a phone context (isMobile) widens its layout viewport to fit what overflows, and innerWidth then grows with it, so an overflow would read as none. */
export const sidewaysScroll = (page: Page, width: number) => page.evaluate((w) => ({ doc: document.documentElement.scrollWidth - w, body: document.body.scrollWidth - w }), width);

// ------------------------------------------------------------------------------------------------ axe on the demos' first and last steps

/** axe (wcag2a, wcag2aa) on the page with every demo on its first step (views frozen) and on its last step (run to the end), and one question open. */
export async function axeStates(env: Env, spec: LearnPageSpec): Promise<{ first: string[]; last: string[]; open: number; filters: string[] }> {
  const run = async (pg: Page) => {
    await pg.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}.pp-site-reveal{opacity:1!important;transform:none!important}' });
    const axe = await new AxeBuilder({ page: pg }).exclude('.pp-site-shine__copy').withTags(['wcag2a', 'wcag2aa']).analyze();
    return axe.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  };
  const filters: string[] = [];
  const first = await using(openPair(env, spec, 'frozen', { ctx: { reducedMotion: 'reduce' } }), async ({ app }) => {
    await app.locator('.pp-site-faq__q').nth(1).evaluate((el) => (el as HTMLElement).click());
    const out = await run(app);
    // The register's other two looks (a click on each of its filters, the view the cycle shows in turn): axe on them too.
    for (const n of [1, 2]) {
      await app.locator('[id="register"] .pp-site-register__filter').nth(n).evaluate((el) => (el as HTMLElement).click());
      filters.push(...(await run(app)).map((v) => `filter ${n}: ${v}`));
    }
    return out;
  });
  let open = 0;
  const last = await using(openPair(env, spec, 'gated'), async ({ app }) => {
    await fire(app);
    // The four demos that run are on their last step 6.7s in (the register cycles, and is on one of its three looks).
    await sleep(LONGEST + 1_200);
    await app.locator('.pp-site-faq__q').nth(2).evaluate((el) => (el as HTMLElement).click());
    open = await app.locator('.pp-site-faq__q[aria-expanded="true"]').count();
    return run(app);
  });
  return { first, last, open, filters };
}


// ------------------------------------------------------------------------------------------------ transitions and animations (lock check SITE-10 T1)

/**
 * Records every CSS transition and animation that starts inside the page's own content (the page top with its hero card, the five demos, Ask Batsi): what it is made of (the element's
 * own `pp-` class, the property or keyframes name), its duration, delay and iterations. The state timelines above see only class changes, not how long a fade, a bar or the slow light
 * takes, and not whether a rule written for `prefers-reduced-motion` has stopped them (lock check SITE-10 T1: a page that sets `transition: none; animation: none` under reduced
 * motion, or a fade of 1.6s, passed every timing test). Events, not polling, so a short transition is not missed.
 */
export const ANIM_PROBE = () => {
  const w = window as unknown as { __anims: Set<string> };
  w.__anims = new Set();
  const base = (t: Element) => Array.from(t.classList).filter((c) => /^pp-/.test(c) && !c.includes('--')).sort()[0] ?? t.tagName.toLowerCase();
  const note = (e: Event) => {
    const t = e.target as Element | null;
    // The page's own content from top to closing band: page top, hero card, sub-menu, five demos, Ask Batsi, the questions and the closing band (lock check SITE-11 T2: the questions, the closing band's
    // wash, light and shine, and the sub-menu pill were outside this list, and a page that slowed or removed them passed). The shared header and footer are SITE-01 to SITE-04's.
    if (!t || typeof t.closest !== 'function' || !t.closest('section.pp-site-demo, .pp-site-hcard, .pp-site-batsi, .pp-site-rings, section.pp-site-hero, .pp-site-form-page--learn, nav.pp-site-subnav, section.pp-site-faq, section.pp-site-band')) return;
    const pseudo = (e as TransitionEvent).pseudoElement || '';
    const tr = e.type === 'transitionrun';
    const cs = getComputedStyle(t, pseudo || null);
    if (tr) {
      // The length and delay the style gives that property, not the running transition's own (a transition that reverses another is shortened, 448ms for 450ms: noise).
      const prop = (e as TransitionEvent).propertyName;
      const props = cs.transitionProperty.split(',').map((x) => x.trim()), durs = cs.transitionDuration.split(',').map((x) => x.trim()), delays = cs.transitionDelay.split(',').map((x) => x.trim());
      const at = props.indexOf(prop) >= 0 ? props.indexOf(prop) : props.indexOf('all');
      if (at < 0) return;
      w.__anims.add(`${base(t)}${pseudo}|transition ${prop}|${durs[at % durs.length]} +${delays[at % delays.length]}`);
      return;
    }
    const name = (e as AnimationEvent).animationName;
    const names = cs.animationName.split(',').map((x) => x.trim()), durs = cs.animationDuration.split(',').map((x) => x.trim()), counts = cs.animationIterationCount.split(',').map((x) => x.trim());
    const at = names.indexOf(name);
    if (at < 0) return;
    w.__anims.add(`${base(t)}${pseudo}|animation ${name}|${durs[at % durs.length]} x${counts[at % counts.length]}`);
  };
  addEventListener('transitionrun', note, true);
  addEventListener('animationstart', note, true);
};

/**
 * Every transition and animation the kit starts on its page while the five demos, the hero card and a question to Ask Batsi run, the page starts too, with the same duration, delay and
 * iterations, and the page starts none that the kit does not. Run in normal motion and under `prefers-reduced-motion` (Iggie's rule: demos keep their fades, colour changes, slow light
 * and drift at normal timings; only grain, the flying card, tilt and large movement stop).
 */
export async function animationParity(env: Env, spec: LearnPageSpec, reduced: boolean): Promise<void> {
  // Up to three tries on fresh pages (lock check SITE-11 T3): on a loaded machine a page's scroll or timer stalls and one transition is not started inside the window (a correct page failed this
  // once in nine runs at load 7 to 10). A page that slows, removes or adds a transition does so on every try.
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await animationParityOnce(env, spec, reduced); return; } catch (e) { last = e; }
  }
  throw last;
}
async function animationParityOnce(env: Env, spec: LearnPageSpec, reduced: boolean): Promise<void> {
  await using(openPair(env, spec, 'gated', { probe: ANIM_PROBE, ...(reduced ? { ctx: { reducedMotion: 'reduce' } } : {}) }), async ({ app, kit }) => {
    await Promise.all([app, kit].map(async (pg) => { await sleep(100); await fire(pg); await pg.locator('.pp-site-ask__chip').nth(1).evaluate((el) => (el as HTMLElement).click()); }));
    // The four demos that run end by 7.8s; the register changes its filter at 2.7s and 5.9s, and the 8.6s window holds both.
    await sleep(LONGEST + 800);
    // A question opened and another opened after it (the questions' rows, marks and bars), and the sub-menu's pill moved by a scroll to the last demo and back (its fade and slide).
    for (const pg of [app, kit]) {
      for (const n of [2, 0]) { await pg.locator('.pp-site-faq__q').nth(n).evaluate((el) => (el as HTMLElement).click()); await sleep(700); }
      await pg.evaluate(() => { const r = document.querySelector('[id^="not-cleared"]')!.getBoundingClientRect(); window.scrollTo({ top: scrollY + r.top - 40, behavior: 'instant' }); });
      await sleep(900);
      await pg.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await sleep(900);
    }
    const seen = (pg: Page) => pg.evaluate(() => [...(window as unknown as { __anims: Set<string> }).__anims].sort());
    const [a, k] = await Promise.all([seen(app), seen(kit)]);
    const when = reduced ? 'under reduced motion' : 'in normal motion';
    expect(k.length, `${when}: the kit starts transitions and animations in these sections (control: the probe sees some)`).toBeGreaterThan(6);
    expect(k.filter((x) => !a.includes(x)), `${when}: every transition and animation the kit starts (element, property or keyframes, duration) the page starts too`).toEqual([]);
    expect(a.filter((x) => !k.includes(x)), `${when}: the page starts no transition or animation that the kit does not`).toEqual([]);
  });
}

// ------------------------------------------------------------------------------------------------ a tab tap in normal motion (lock check SITE-10 T2)

/**
 * AC-5 opens the page under reduced motion so the sub-menu's scroll is instant (a smooth scroll that starts late is re-aimed by the kit's 180ms settle under load). That leaves the
 * smooth path, the one every visitor without the setting takes, unjudged on this page (lock check SITE-10 T2: a page whose tap lands 100px low in normal motion passed). Here, in normal motion,
 * a tap on two tabs far from the top must put the section's top just under the header and the sub-menu (spec: the kit's rule, +-4px). A smooth scroll that the kit's own script
 * re-aims on a loaded machine is given up to three taps: it lands right on one of them, and a page that lands wrong does so on every one.
 */
export async function tapInNormalMotion(env: Env, spec: LearnPageSpec): Promise<void> {
  await using(openPair(env, spec, 'frozen'), async ({ app }) => {
    const want = await app.evaluate(() => { const m = (v: string) => { const e = document.createElement('div'); e.style.cssText = `position:absolute;visibility:hidden;height:var(${v})`; document.body.appendChild(e); const h = e.getBoundingClientRect().height; e.remove(); return h; }; return m('--layout-site-header-height-shrunk') + 56; });
    expect(want, 'the shrunk header token resolves').toBeGreaterThan(56);
    for (const id of ['renewals', 'not-cleared']) {
      const tops: number[] = [];
      let passed = false;
      for (let attempt = 0; attempt < 3 && !passed; attempt++) {
        await app.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await sleep(300);
        await app.locator(`nav[aria-label="On this page"] .pp-site-subnav__link[href="#${id}"]`).evaluate((el) => (el as HTMLElement).click());
        let last = -1, still = 0;
        for (let k = 0; k < 120 && still < 6; k++) { await sleep(100); const y = await app.evaluate(() => scrollY); still = y === last ? still + 1 : 0; last = y; }
        const r = await app.evaluate((x) => ({ top: document.getElementById(x)!.getBoundingClientRect().top, end: scrollY >= document.documentElement.scrollHeight - innerHeight - 1 }), id);
        tops.push(Math.round(r.top));
        passed = r.end ? r.top >= want - 4 : Math.abs(r.top - want) <= 4;
      }
      expect(passed, `in normal motion a tap on the tab for #${id} puts the section's top ${want}px from the top (taps landed at ${tops.join(', ')}px)`).toBe(true);
    }
  });
}

export { deviceOf };
export type { Browser };
