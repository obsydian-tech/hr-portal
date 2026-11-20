import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { FREEZE_VIEW, GATED_VIEW, compareScopes, deviceOf, fire, fromFirstChange, hit, kitDocument, openKitDocument, sameTimeline, screens, settle, settled, sleep, timeline, wordsOf, TOL, type Device, type Step } from '../site-08/kit';
import { normId, type Env, type LearnPageSpec, type Plant } from '../site-08/learn-page';

/**
 * SITE-09 helpers: the Recruitment Learn more page (`/product/recruitment`) against the kit screen "Recruitment page" of the design system.
 * Everything that a whole Learn more page shares is the SITE-08 helper's (`support/site-08/learn-page.ts`, imported, never edited). What is here is
 * what only this page has: its route, its four demos, its hero card, the board flight under reduced motion, a pixel check for a whole page that is
 * not in a `.pp-site-stage`, the page-wide words, the prerendered output and the file rule.
 *
 * The kit is the oracle: its markup and its preview scripts (`site-pages.js`, `site-demos.js`, `site-recruitment.js`, `site-page-heroes.js`) at KIT_REF.
 */

/**
 * The design system ref the kit is read at. At or after 8dc3091 (DS #47: no closing band note, which SITE-08 removes from the app) and at or after
 * c3788a5 (DS #49: demos keep playing under reduced motion). This is 03df8e2, the ref in `sync.json` after the 18 Nov design system sync. It holds DS #54 (dee75b0, 18 Nov: the two Recruitment claims are removed from the kit; the scripts are the same as at dc593c4); after dee75b0 no site kit file changed. The SITE-08 helper's own default,
 * the ref in `sync.json` (e9a352f), has the closing band note and the older reduced motion scripts, so SITE-09 sets `SITE_KIT_REF` for its own tests
 * (`useKitRef`, put back afterwards so no other spec in the run sees it). `SITE_09_KIT_REF` overrides this one.
 */
export const KIT_REF = process.env['SITE_09_KIT_REF'] || '03df8e2aa41ed09dc7a1571f074b3d8c82ffde9a';
let savedRef: string | undefined;
export function useKitRef(): void { savedRef = process.env['SITE_KIT_REF']; process.env['SITE_KIT_REF'] = KIT_REF; }
export function restoreKitRef(): void { if (savedRef === undefined) delete process.env['SITE_KIT_REF']; else process.env['SITE_KIT_REF'] = savedRef; }

export const ROUTE = '/product/recruitment';
export const TABS = ['Hiring board', 'Interview panels', 'Reminders and follow-ups', 'Candidate risk', 'Questions'] as const;
export const TAB_IDS = ['hiring-board', 'panels', 'follow-ups', 'risk', 'questions'] as const;
export const OMIT = '.pp-site-footer';
const KIT_SCRIPTS = ['site-pages.js', 'site-demos.js', 'site-recruitment.js', 'site-page-heroes.js'];

/** The four demos in page order (the Offer demo is no longer in the kit: DS #54). `run` is how long each takes to finish (the kit script's last timer, plus 1.5s), `cream` the ground. */
export const DEMOS = [
  { ac: 6, id: 'hiring-board', key: 'board', run: 5_600, cream: false },
  { ac: 7, id: 'panels', key: 'score', run: 9_800, cream: true },
  { ac: 8, id: 'follow-ups', key: 'follow', run: 7_800, cream: false },
  { ac: 9, id: 'risk', key: 'risk', run: 7_600, cream: true },
] as const;
export type Demo = (typeof DEMOS)[number];

// ------------------------------------------------------------------------------------------------ opening the page

/**
 * Opens the page on the app. The SITE-08 helper asks the page under test for its `.pp-site-stage` width (a gallery example sits in one, a real page does not):
 * with no such element that question must fail fast and be let through, so the page's default timeout is short once it is open.
 */
export async function openRecruitment(page: Page, path = ROUTE): Promise<void> {
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
export function recruitmentSpec(device: Device, open: (page: Page) => Promise<void> = openRecruitment): LearnPageSpec {
  return { name: `recruitment-${device}`, kitPage: 'Recruitment page', device, omit: OMIT, open };
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
  const add = (): boolean => { if (!document.body) return false; const sp = document.createElement('div'); sp.style.height = '3000px'; sp.setAttribute('data-s9-spacer', ''); document.body.insertBefore(sp, document.body.firstChild); return true; };
  if (!add()) new MutationObserver((_, o) => { if (add()) o.disconnect(); }).observe(document, { childList: true, subtree: true });
};
const STILL_ATTR = () => { const set = () => document.documentElement?.setAttribute('data-site-still', ''); set(); new MutationObserver(set).observe(document, { childList: true }); };
const DEAF = () => { (window as unknown as { __fireView: () => void }).__fireView = () => undefined; };

function kitDoc(spec: LearnPageSpec, keepOmit: boolean): string {
  const s = screens('pages').find((x) => x.name === spec.kitPage && x.device === spec.device);
  if (!s) throw new Error(`site-09: the kit has no "${spec.kitPage} (${spec.device})"`);
  const omit = keepOmit ? '' : spec.omit ?? '';
  const prep = `var st=document.querySelector('.pp-site-stage');var om=${JSON.stringify(omit)};if(om)st.querySelectorAll(om).forEach(function(e){e.remove();});st.querySelectorAll('.pp-site-subnav__link').forEach(function(a){if(!document.getElementById(a.getAttribute('href').slice(1)))a.remove();});var h=st.querySelector('.pp-site-form-page--learn');if(h&&h.parentElement)h.parentElement.setAttribute('data-s9-root','');`;
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
    const app = await ctx.newPage();
    await spec.open(app);
    const marked = await app.evaluate(() => { const r = document.querySelector('.pp-site-form-page--learn')?.parentElement; r?.setAttribute('data-s9-root', ''); return !!r; });
    if (!marked) throw new Error(`${spec.name}: the page has no Learn more page top (.pp-site-form-page--learn)`);
    if (o.plant) await o.plant(app);
    const kit = await ctx.newPage();
    await kit.setViewportSize(vp);
    await openKitDocument(kit, new URL(env.baseURL).origin, kitDoc(spec, !!o.keepOmit));
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
export async function timeline9(page: Page, scope: string, ms: number): Promise<Step[]> {
  return page.evaluate(([scope, ms]) => new Promise<Step[]>((resolve) => {
    const root = document.querySelector(scope as string);
    if (!root) return resolve([{ t: 0, sig: `NO ELEMENT ${scope}` }]);
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

/** The two timelines pass through the same states in the same order, each within TOL of the kit's time. */
export function expectSame(label: string, app: Step[], kit: Step[], gap = 45): void {
  const a = settled(fromFirstChange(app), gap), k = settled(fromFirstChange(kit), gap);
  expect(kit.length, `${label}: the kit page moved at all`).toBeGreaterThan(1);
  const h = (s: Step) => s.sig.split(' ')[0];
  const at = a.findIndex((s, i) => !k[i] || h(s) !== h(k[i]!));
  expect(a.map(h), `${label}: the page passes through the same states, in the same order, as the kit${at < 0 ? '' : ` (first difference at #${at}: page "${a[at]?.sig.slice(0, 200) ?? 'none'}", kit "${k[at]?.sig.slice(0, 200) ?? 'none'}")`}`).toEqual(k.map(h));
  expect(sameTimeline(a, k, TOL).late, `${label}: each state shows within ${TOL}ms of when the kit shows it`).toEqual([]);
}
/** Both pages watched for `ms` at the same moment; 100ms in, `act` runs on each (the views are fired by `fire` when `start`). */
export async function both(p: Pair, scopes: { app: string; kit: string }, ms: number, act?: (page: Page, isKit: boolean) => Promise<void>, start = true, fn: typeof timeline = timeline): Promise<{ app: Step[]; kit: Step[] }> {
  const go = async (pg: Page, scope: string, isKit: boolean) => {
    const rec = fn(pg, scope, ms);
    await sleep(100);
    if (start) await fire(pg);
    if (act) await act(pg, isKit);
    return rec;
  };
  const [app, kit] = await Promise.all([go(p.app, scopes.app, false), go(p.kit, scopes.kit, true)]);
  return { app, kit };
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

/** Lock check .1 (same as SITE-08 .1): the kit's sub-menu script measures its pills when it first runs, before the web font has loaded (pill 119px in the kit against 115px on the page on CI). Both pages wait for document.fonts.ready and get a resize event, so every script that measures runs again on the same fonts. */
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

/** A demo plays only once it is in view, judged with the real view observer (3000px of spacer first). Not started at 6% in view, started at 60%. */
export async function checkDemoStart(env: Env, spec: LearnPageSpec, d: Demo, o: PairOpts = {}): Promise<void> {
  await using(openPair(env, spec, 'live', { spacerFirst: true, ...o }), async ({ app, kit }) => {
    const kid = await kitId(kit, d.id);
    const flow = async (p: Page, id: string) => {
      const live = () => p.evaluate((x) => document.getElementById(x)!.hasAttribute('data-site-live'), id);
      const show = (f: number) => p.evaluate(([x, fr]) => { const sec = document.getElementById(x as string)!; const r = sec.getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - (innerHeight - (fr as number) * r.height)); }, [id, f] as const);
      const out: Record<string, boolean> = {};
      await show(0.06); await sleep(1500); out['at6'] = await live();
      await show(0.6); await sleep(1000); out['at60'] = await live();
      return out;
    };
    expect(await app.evaluate(() => document.querySelectorAll('[data-s9-spacer]').length), `${spec.name}: the spacer is in the page`).toBe(1);
    const [a, k] = await Promise.all([flow(app, d.id), flow(kit, kid)]);
    expect(k['at6'], `${d.id}: the kit demo has not started at 6% in view`).toBe(false);
    expect(a['at6'], `${d.id}: the demo has not started below 15% in view`).toBe(false);
    expect(a['at60'], `${d.id}: the demo starts once 15% or more of it is in view (here 60%)`).toBe(true);
  });
}

/**
 * One demo, against the kit: the run (states in order, each within 250ms), the last step and the first step as the kit draws them (boxes within 1px, 1% of pixels),
 * and Play again (the same run again from the first step, focus kept on the button). `byHand` runs a click at `at` ms on both pages and compares that run too.
 */
export async function checkDemo(env: Env, spec: LearnPageSpec, d: Demo, o: PairOpts & { byHand?: { at: number; sel: string; ms: number; label: string }; after?: (app: Page) => Promise<void> } = {}): Promise<void> {
  await using(openPair(env, spec, 'gated', o), async (p) => {
    const kid = await kitId(p.kit, d.id);
    const scopes = { app: `[id="${d.id}"]`, kit: `[id="${kid}"]` };
    // The run.
    const r = await both(p, scopes, d.run);
    expectSame(`${d.id}, the run`, r.app, r.kit);
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
      expectSame(`${d.id}, ${h.label}`, w.app, w.kit);
    }
    // Play again by click: the first step, drawn as the kit draws it, 280ms after the click. The pages are compared one after the other,
    // so every timer on both is cleared at the 280ms mark: what is drawn is the state both were in then, not whatever the demo reached while the pictures were taken.
    await sleep(d.run);
    await Promise.all([p.app, p.kit].map((pg, i) => hit(pg, `${i ? scopes.kit : scopes.app} .pp-site-demo__again`)));
    await sleep(280);
    await Promise.all([p.app, p.kit].map(stopTimers));
    await compareRegion(p, `${d.id}, first step`, scopes.app, scopes.kit);
  });
  await checkDemoStart(env, spec, d, o);
}

/** Clear every pending timer and animation frame of the page: it stays as it is, so it can be photographed. */
async function stopTimers(p: Page): Promise<void> {
  await p.evaluate(() => { const t = window.setTimeout(() => undefined, 0), r = window.requestAnimationFrame(() => undefined); for (let i = 0; i <= t + 50; i++) { clearTimeout(i); clearInterval(i); } for (let i = 0; i <= r + 50; i++) cancelAnimationFrame(i); });
}

/** The end-of-run state of a demo (what a viewer is left with): the fingerprint of the section after the run, on both pages. */
export async function endState(env: Env, spec: LearnPageSpec, ids: readonly string[], o: PairOpts = {}): Promise<Record<string, { app: string; kit: string }>> {
  return using(openPair(env, spec, 'gated', o), async (p) => {
    const kids = await Promise.all(ids.map((i) => kitId(p.kit, i)));
    await Promise.all([p.app, p.kit].map(async (pg) => { await sleep(100); await fire(pg); }));
    await sleep(10_500);
    const snap = async (pg: Page, sel: string) => (await timeline(pg, sel, 40)).at(-1)!.sig.split(' ')[0]!;
    const out: Record<string, { app: string; kit: string }> = {};
    for (let i = 0; i < ids.length; i++) out[ids[i]!] = { app: await snap(p.app, `[id="${ids[i]}"]`), kit: await snap(p.kit, `[id="${kids[i]}"]`) };
    return out;
  });
}

// ------------------------------------------------------------------------------------------------ the hero card

export const HCARD = '.pp-site-hcard[data-demo="hcard-recruitment"]';
/** The hero card loops as the kit's preview script does: every step within 250ms, a jump-free loop (same states, same box), under data-site-still its last step. */
export async function checkHeroCard(env: Env, spec: LearnPageSpec, o: PairOpts = {}): Promise<void> {
  const want = await using(openPair(env, spec, 'gated', o), async (p) => {
    expect(await p.app.locator(HCARD).count(), `${spec.name}: the page's hero card is the Recruitment one (${HCARD})`).toBe(1);
    const heights = (pg: Page) => pg.evaluate((s) => new Promise<number[]>((resolve) => { const out: number[] = []; const t0 = performance.now(); const tick = () => { out.push(Math.round(document.querySelector(s)!.getBoundingClientRect().height * 10) / 10); if (performance.now() - t0 > 15_000) return resolve(out); setTimeout(tick, 100); }; tick(); }), HCARD);
    const hp = Promise.all([heights(p.app), heights(p.kit)]);
    const r = await both(p, { app: HCARD, kit: HCARD }, 15_500, undefined, true, timeline9);
    expectSame('hero card, the loop (every step, and the return to the first step)', r.app, r.kit);
    const [ha, hk] = await hp;
    expect(Math.max(...ha) - Math.min(...ha), `hero card: the box never jumps while it loops (heights ${[...new Set(ha)].join(', ')})`).toBeLessThanOrEqual(1);
    expect(Math.abs(ha[0]! - hk[0]!), 'hero card: the box is the kit\'s').toBeLessThanOrEqual(1);
    // The loop came round: after the last step the first one shows again.
    const first = r.app[0]!.sig.split(' ')[0];
    expect(r.app.filter((s) => s.sig.split(' ')[0] === first).length, 'hero card: the loop returns to the state it began in').toBeGreaterThanOrEqual(2);
    // The kit's last step, held from the last step to the restart (8.7s to 13.7s): what data-site-still must show.
    const hold = settled(r.kit).filter((s) => s.t > 9_800 && s.t < 13_000).at(-1) ?? r.kit.filter((s) => s.t < 13_000).at(-1)!;
    return hold.sig.split(' ')[0];
  });
  // Under data-site-still: the last step, at once, and nothing moves on (a fresh context, so nothing of the first run is left in memory).
  await using(openPair(env, spec, 'gated', { ...o, still: true }), async (q) => {
    await fire(q.app); await sleep(900);
    const got = (await timeline9(q.app, HCARD, 40)).at(-1)!.sig.split(' ')[0];
    expect(got, 'hero card: under data-site-still it shows its last step (the state the kit holds before it loops)').toBe(want);
    await sleep(4_000);
    expect((await timeline9(q.app, HCARD, 40)).at(-1)!.sig.split(' ')[0], 'hero card: under data-site-still nothing moves on').toBe(want);
  });
}

// ------------------------------------------------------------------------------------------------ motion: the board flight under reduced motion

/** Records every script animation (element.animate) of a board card itself that moves it by transform: the flight of a card between two columns. */
export const FLIGHT_PROBE = () => {
  const w = window as unknown as { __flight: Set<string>; __flightMs: Record<string, number> };
  w.__flight = new Set();
  w.__flightMs = {};
  setInterval(() => {
    for (const a of document.getAnimations()) {
      if (a instanceof CSSTransition || a instanceof CSSAnimation) continue; // the flight is the card's own element.animate
      const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
      if (t?.classList.contains('pp-site-board__card') && Object.keys((a.effect as KeyframeEffect).getKeyframes()[0] ?? {}).includes('transform')) {
        const id = String(t.getAttribute('data-card') ?? t.className);
        w.__flight.add(id);
        w.__flightMs[id] = Number(a.effect!.getComputedTiming().duration);
      }
    }
  }, 20);
};
export type Flight = { app: string[]; kit: string[]; ms: { app: Record<string, number>; kit: Record<string, number> }; steps: { app: Step[]; kit: Step[] } };
/** Plays the hiring board on both pages with the motion preference given, and says which cards flew. */
export async function boardFlight(env: Env, spec: LearnPageSpec, reduce: boolean, o: PairOpts = {}): Promise<Flight> {
  return using(openPair(env, spec, 'gated', { ...o, ctx: { reducedMotion: reduce ? 'reduce' : 'no-preference' }, probe: FLIGHT_PROBE }), async (p) => {
    const kid = await kitId(p.kit, 'hiring-board');
    const steps = await both(p, { app: '[id="hiring-board"]', kit: `[id="${kid}"]` }, 5_600);
    const seen = (pg: Page) => pg.evaluate(() => [...(window as unknown as { __flight: Set<string> }).__flight]);
    const took = (pg: Page) => pg.evaluate(() => (window as unknown as { __flightMs: Record<string, number> }).__flightMs);
    return { app: await seen(p.app), kit: await seen(p.kit), ms: { app: await took(p.app), kit: await took(p.kit) }, steps };
  });
}
/**
 * Under prefers-reduced-motion every demo keeps playing at the kit's timings: the design system (DS #49, c3788a5) stops only the board's flying card, not the steps
 * (lock check T3: the board alone was judged, so three of the four demos could skip their steps under reduced motion). All four run together, on both pages.
 */
export async function reducedDemos(env: Env, spec: LearnPageSpec): Promise<void> {
  await using(openPair(env, spec, 'gated', { ctx: { reducedMotion: 'reduce' } }), async ({ app, kit }) => {
    const kids = await Promise.all(DEMOS.map((d) => kitId(kit, d.id)));
    const ms = Math.max(...DEMOS.map((d) => d.run)) + 300;
    const run = async (pg: Page, scopes: string[]) => { const rec = Promise.all(scopes.map((s) => timeline(pg, s, ms))); await sleep(100); await fire(pg); return rec; };
    const [a, k] = await Promise.all([run(app, DEMOS.map((d) => `[id="${d.id}"]`)), run(kit, kids.map((i) => `[id="${i}"]`))]);
    DEMOS.forEach((d, i) => expectSame(`reduced motion, ${d.id} still plays at the kit's timings`, a[i]!, k[i]!));
  });
}

/**
 * Under data-site-still every demo shows what it shows at the end of its run, at once (SITE-08 AC-8 rule, spec AC-11). SITE-08's `checkMotion` only counts steps whose
 * opacity is not 1, which the board and the scorecard (no `.pp-site-step`) never show, so each demo's end-state facts are read here (lock check T4).
 */
export async function stillDemos(env: Env, spec: LearnPageSpec, check: (app: Page, d: Demo) => Promise<void>): Promise<void> {
  await using(openPair(env, spec, 'gated', { still: true }), async ({ app }) => {
    await fire(app);
    await sleep(1500);
    for (const d of DEMOS) await check(app, d);
  });
}

// ------------------------------------------------------------------------------------------------ phone: nothing under the header, no sideways scroll

/** Every heading and button of the page, scrolled in turn to just under header and sub-menu: visible, inside the window and not covered. */
export async function visibleUnderBars(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = document.querySelector('[data-s9-root]')!;
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
export const sidewaysScroll = (page: Page) => page.evaluate(() => ({ doc: document.documentElement.scrollWidth - innerWidth, body: document.body.scrollWidth - innerWidth }));

// ------------------------------------------------------------------------------------------------ axe on the demos' first and last steps

/** axe (wcag2a, wcag2aa) on the page with every demo on its first step (views frozen) and on its last step (run to the end), and one question open. */
export async function axeStates(env: Env, spec: LearnPageSpec): Promise<{ first: string[]; last: string[]; open: number }> {
  const run = async (pg: Page) => {
    await pg.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}.pp-site-reveal{opacity:1!important;transform:none!important}' });
    const axe = await new AxeBuilder({ page: pg }).exclude('.pp-site-shine__copy').withTags(['wcag2a', 'wcag2aa']).analyze();
    return axe.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  };
  const first = await using(openPair(env, spec, 'frozen', { ctx: { reducedMotion: 'reduce' } }), async ({ app }) => {
    await app.locator('.pp-site-faq__q').nth(1).evaluate((el) => (el as HTMLElement).click());
    return run(app);
  });
  let open = 0;
  const last = await using(openPair(env, spec, 'gated'), async ({ app }) => {
    await fire(app);
    await sleep(10_500);
    await app.locator('.pp-site-faq__q').nth(2).evaluate((el) => (el as HTMLElement).click());
    open = await app.locator('.pp-site-faq__q[aria-expanded="true"]').count();
    return run(app);
  });
  return { first, last, open };
}

// ------------------------------------------------------------------------------------------------ the two claims that are removed (DS #54)

/**
 * Iggie, 18 Nov, approved hiding two Recruitment claims until the code behind them is built. The design system removed them from the kit (PR #54, dee75b0), so the kit
 * is the oracle for their absence, and these checks also name each removed piece: a page that still holds one fails with its name, not as a word difference.
 * No new wording was written: the hero lead is the kit's, shorter.
 */
export const NEW_LEAD = 'Naleko People keeps one hiring board per role. Panels score candidates against the same criteria, and Batsi watches each stage for candidates who go quiet.';
/** Each removed sentence on its own, as the words stood in the kit at dc593c4. Matched without regard to case, white space or comments between words. */
export const REMOVED = {
  'hero lead clause': ', and a signed offer starts onboarding with no retyping',
  'offer demo title': 'A signed offer starts onboarding with no retyping.',
  'offer demo lead': 'When an offer is signed, the candidate moves to Hired and an employee record is created with the details already captured.',
  'offer demo eyebrow or sub-menu link': 'Offer to onboarding',
  'link under the offer demo': 'Learn more about Onboarding and Offboarding',
  'offer demo panel line': 'Onboarding opened for John Doe. Jane Smith notified.',
  'trust strip item': 'A person makes every hiring decision',
} as const;
const flat = (s: string): string => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').toLowerCase();
const noCode = (s: string): string => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
/** Which removed sentences are in this markup (the live page's outerHTML or the prerendered file): in its text, or in an attribute such as aria-label. Empty when none is. */
export function removedIn(markup: string): string[] {
  const raw = flat(noCode(markup));
  const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  return Object.entries(REMOVED).filter(([, w]) => { const k = flat(w); return text.includes(k) || raw.includes(k); }).map(([name]) => name);
}
/** What only the Offer demo leaves in markup: its `data-demo`, its id, a link to it, its panel classes. */
export function offerMarkupIn(markup: string): string[] {
  const m = noCode(markup);
  const out: string[] = [];
  if (/data-demo=["']offer["']/.test(m)) out.push('a section with data-demo="offer"');
  if (/\sid=["']offer(-[a-z0-9]+)?["']/.test(m)) out.push('an element with the id "offer"');
  if (/href=["']#offer/.test(m)) out.push('a link to #offer');
  if (/pp-site-offer__/.test(m)) out.push('the offer panel (pp-site-offer__ classes)');
  return out;
}
export type RemovalFacts = { markup: string; lead: string; tabs: string[]; strip: string[]; demos: string[]; offerSections: number; offerLinks: number };
/** What a page holds that the removal is about (`root` is 'body' on the app and '.pp-site-stage' on the kit screen): the lead, the sub-menu pills, the trust strip, the demo list. */
export function removalFacts(root: string): RemovalFacts {
  const r = document.querySelector(root)!;
  const txt = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const strip = r.querySelector('section.pp-site-strip');
  return {
    markup: r.outerHTML,
    lead: txt(r.querySelector('.pp-site-form-page__lead')),
    tabs: Array.from(r.querySelectorAll('nav[aria-label="On this page"] .pp-site-subnav__link')).map((a) => `${txt(a)}>${(a.getAttribute('href') ?? '').replace(/-[a-z0-9]{4}$/, '')}`),
    strip: Array.from(strip?.querySelectorAll('.pp-site-strip__item') ?? []).map((e) => txt(e)),
    demos: Array.from(r.querySelectorAll('section.pp-site-demo')).map((s) => s.id.replace(/-[a-z0-9]{4}$/, '')),
    offerSections: r.querySelectorAll('[data-demo="offer"], section[id^="offer"]').length,
    offerLinks: Array.from(r.querySelectorAll('a')).filter((a) => /^#offer/.test(a.getAttribute('href') ?? '') || /offer to onboarding/i.test(txt(a)) || /learn more about onboarding and offboarding/i.test(txt(a))).length,
  };
}
/**
 * The removal read on a page against the kit: every problem as a sentence, empty when the page is as the kit is. The kit's own words are read too (a kit ref from before
 * DS #54 would hold the claims and fails loudly), then the page's: no removed sentence, no Offer demo, no link to it or under it, and the hero lead, sub-menu pills,
 * trust strip items and demo list equal the kit's.
 */
export function removalProblems(app: RemovalFacts, kit: RemovalFacts): string[] {
  const p: string[] = [];
  for (const k of removedIn(kit.markup)) p.push(`the kit screen still holds "${k}" (the kit ref is from before DS #54)`);
  if (kit.lead !== NEW_LEAD) p.push(`the kit's hero lead is not the one without the offer clause: "${kit.lead}"`);
  for (const k of removedIn(app.markup)) p.push(`the page holds the removed ${k}`);
  for (const k of offerMarkupIn(app.markup)) p.push(`the page holds ${k}`);
  if (app.lead !== NEW_LEAD) p.push(`the hero lead is "${app.lead}", not "${NEW_LEAD}"`);
  if (app.offerSections) p.push(`the page holds ${app.offerSections} Offer demo section(s)`);
  if (app.offerLinks) p.push(`the page holds ${app.offerLinks} link(s) to the Offer demo or under it`);
  if (JSON.stringify(app.tabs) !== JSON.stringify(kit.tabs)) p.push(`the sub-menu pills are ${JSON.stringify(app.tabs)}, the kit's are ${JSON.stringify(kit.tabs)}`);
  if (JSON.stringify(app.strip) !== JSON.stringify(kit.strip)) p.push(`the trust strip items are ${JSON.stringify(app.strip)}, the kit's are ${JSON.stringify(kit.strip)}`);
  if (JSON.stringify(app.demos) !== JSON.stringify(kit.demos)) p.push(`the demo sections are ${JSON.stringify(app.demos)}, the kit's are ${JSON.stringify(kit.demos)}`);
  return p;
}
/** Both pages' removal facts, read once the pair is open. */
export async function removalOf(p: Pair): Promise<{ app: RemovalFacts; kit: RemovalFacts }> {
  return { app: await p.app.evaluate(removalFacts, 'body'), kit: await p.kit.evaluate(removalFacts, '.pp-site-stage') };
}

export { deviceOf };
export type { Browser };
