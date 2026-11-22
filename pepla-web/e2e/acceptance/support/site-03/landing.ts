import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { icons as LUCIDE } from 'lucide';
import type { Locator, Page } from '@playwright/test';
import { LANDING_KIT_REF } from '../site-04/landing2';

/**
 * SITE-03 helpers: the landing sections gallery (/dev/site-landing) and the design system's landing page kit
 * (project/ui_kits/site-landing.html with its three preview scripts) as the reference the tests compare against.
 */

export const PEPLA_WEB = join(__dirname, '..', '..', '..', '..');
const DS = join(PEPLA_WEB, 'src', 'styles', 'design-system');
const PREFIX = '/__site-03-kit__/';
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@700;800&display=swap';
export const STILL = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}.pp-site-reveal{opacity:1!important;transform:none!important}.pp-site-stage{border-radius:0!important;box-shadow:none!important}';
const TYPES: Record<string, string> = { '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

export type Device = 'desktop' | 'phone';
export type Key = 'pilot' | 'hero' | 'modules' | 'batsi' | 'recruitment' | 'onboarding';
export const KEYS: Key[] = ['pilot', 'hero', 'modules', 'batsi', 'recruitment', 'onboarding'];

/** The six sections of this card, in the kit's order. `kit` is the section's element in the kit page, `app` the same in the gallery. */
export const SECTION: Record<Key, { name: string; app: string; kit: (d: Device) => string }> = {
  pilot: { name: 'Pilot bar', app: '.pp-site-pilot', kit: (d) => `#top-${d === 'desktop' ? 'd' : 'p'} .pp-site-pilot` },
  hero: { name: 'Hero and Ask Batsi peek', app: '.pp-site-hero', kit: (d) => (d === 'desktop' ? '#main-lpd' : '#main-s4') },
  modules: { name: 'Modules', app: '.pp-site-section', kit: (d) => `#modules-${d === 'desktop' ? 'd' : 'p'}` },
  batsi: { name: 'Ask Batsi', app: '.pp-site-batsi', kit: (d) => `#batsi-${d === 'desktop' ? 'd' : 'p'}` },
  recruitment: { name: 'Recruitment', app: '.pp-site-section', kit: (d) => `#recruitment-${d === 'desktop' ? 'd' : 'p'}` },
  onboarding: { name: 'Onboarding and Offboarding', app: '.pp-site-section', kit: (d) => `#onboarding-${d === 'desktop' ? 'd' : 'p'}` },
};
export const exampleName = (k: Key, d: Device): string => `${SECTION[k].name}, ${d}`;
export const galleryId = (k: Key, d: Device): string => `land-${k}-${d}`;
export const sec = (page: Page, k: Key, d: Device): Locator => page.locator(`section[data-example="${exampleName(k, d)}"]`);
export const bodyOf = (page: Page, k: Key, d: Device): Locator => sec(page, k, d).locator('[data-example-body]');
export const rootOf = (page: Page, k: Key, d: Device): Locator => bodyOf(page, k, d).locator(SECTION[k].app).first();

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const deviceOf = (page: Page): Device => ((page.viewportSize()?.width ?? 1280) < 600 ? 'phone' : 'desktop');

function curl(url: string): string {
  return execFileSync('curl', ['-fsSL', '--retry', '3', url], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
}
export function syncJson(): { repo: string; ref: string } {
  return JSON.parse(readFileSync(join(DS, 'sync.json'), 'utf8'));
}
/**
 * A file of the design system repo, cached in the OS temp folder. Read at the ref SITE-04 pins for the landing kit (`LANDING_KIT_REF`, child lock
 * 04.7), not at the ref in sync.json: the kit's preview scripts play their demos under reduced motion since design system PR #49.
 */
export function dsFile(path: string, pinnedRef: string = LANDING_KIT_REF): string {
  const { repo } = syncJson();
  const ref = pinnedRef;
  const dir = join(tmpdir(), 'site-03-kit', ref);
  const file = join(dir, path.replace(/\//g, '__'));
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const text = curl(`https://raw.githubusercontent.com/${repo}/${ref}/${path}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, text);
  return text;
}

const pascal = (n: string) => n.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
function lucide(name: string, attrs: string): string {
  const node = (LUCIDE as Record<string, Array<[string, Record<string, string>]>>)[pascal(name)];
  if (!node) throw new Error(`site-03 parity: unknown Lucide icon "${name}" in the kit`);
  const inner = node.map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  const cls = attrs.match(/class="([^"]*)"/)?.[1];
  const rest = attrs.replace(/class="[^"]*"/, '').trim();
  return `<svg class="lucide${cls ? ` ${cls}` : ''}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${rest ? ` ${rest}` : ''}>${inner}</svg>`;
}
const MARK = '<svg class="pp-logo__mark" viewBox="0 0 76 64" aria-hidden="true" focusable="false"><circle class="pp-logo__coral" cx="20" cy="38" r="18"></circle><circle class="pp-logo__violet" cx="38" cy="24" r="18"></circle><circle class="pp-logo__mint" cx="56" cy="38" r="18"></circle></svg>';

/** The kit example's markup, with the mark and the icons drawn as the design system build draws them. */
export function kitMarkup(html: string): string {
  return html
    .replace(/<i data-pepla-mark><\/i>/g, MARK)
    .replace(/<i ([^>]*?)data-lucide="([a-z0-9-]+)"([^>]*)><\/i>/g, (_m, a: string, n: string, b: string) => lucide(n, `${a} ${b}`.trim()));
}

type Box = { x: number; y: number; width: number; height: number };

/** The kit's landing page for one device, with the other device's stage taken out, its icons drawn and (when `scripts`) its three preview scripts running. */
export function kitLandingHtml(device: Device, scripts: boolean, stageWidth?: number): string {
  const other = device === 'desktop' ? 'top-p' : 'top-d';
  const mine = device === 'desktop' ? 'top-d' : 'top-p';
  const body = kitMarkup(dsFile('project/ui_kits/site-landing.html'));
  const js = ['site-landing-parts.js', 'site-landing-sections.js', 'site-onboarding-story.js'].map((f) => `<script>${dsFile(`scripts/preview/${f}`)}</script>`).join('');
  const prep = `<script>document.getElementById('${other}')?.remove();${stageWidth ? `document.getElementById('${mine}').style.width='${stageWidth}px';` : ''}</script>`;
  return `<!doctype html><html lang="en-ZA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${FONTS}"><link rel="stylesheet" href="ds/index.css"><style>body{margin:0}</style></head><body>${body}${prep}${scripts ? js : ''}</body></html>`;
}

/** Opens the kit landing page in `kitPage`, served from the app's own origin under a path the app never uses. */
export async function openKit(kitPage: Page, origin: string, device: Device, scripts: boolean, stageWidth?: number): Promise<void> {
  await kitPage.route(`${origin}${PREFIX}**`, async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.slice(PREFIX.length));
    if (rel === 'landing.html') return route.fulfill({ status: 200, contentType: 'text/html', body: kitLandingHtml(device, scripts, stageWidth) });
    const file = normalize(join(DS, rel.replace(/^ds\//, '')));
    if (!rel.startsWith('ds/') || !file.startsWith(DS + sep) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  await kitPage.goto(`${origin}${PREFIX}landing.html`);
  await kitPage.waitForLoadState('networkidle');
}

/** An IntersectionObserver that never reports: every demo and every arrival stays on its first step. */
export const FREEZE_VIEW = () => {
  class Never { observe(): void {} unobserve(): void {} disconnect(): void {} takeRecords(): [] { return []; } }
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Never;
};

/**
 * No window scroll listener is ever added: the scroll-driven Onboarding story stays on the step it worked out when the gallery first
 * rendered (before any section is taken out), as the kit's story stays on its own, far down the kit page. Without it the test's own
 * scrolling (scrollIntoViewIfNeeded, scrollTo) moves the page's story and not the kit's, and whether the change lands before the
 * measure is a race. (Lock check fix.)
 */
export const FREEZE_SCROLL = () => {
  const add = window.addEventListener;
  window.addEventListener = function (this: Window, type: string, ...rest: unknown[]) { if (type === 'scroll') return; return (add as (...a: unknown[]) => void).call(this, type, ...rest); } as typeof window.addEventListener;
};

/** Opens /dev/site-landing. With `only`, every other section is taken out so a phone window is not zoomed out by the wide desktop stages. */
export async function gotoLanding(page: Page, only?: string[]): Promise<void> {
  const res = await page.goto('/dev/site-landing');
  if (!res || res.status() >= 400) throw new Error(`/dev/site-landing answered ${res?.status()}`);
  await page.locator('section[data-example]').first().waitFor({ state: 'attached', timeout: 20_000 });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForLoadState('networkidle');
  if (only) {
    await page.evaluate((keep) => document.querySelectorAll('section[data-example]').forEach((s) => { if (!keep.includes(s.id)) s.remove(); }), only);
    const v = page.viewportSize();
    if (v && v.width < 600) { await page.setViewportSize({ width: v.width + 1, height: v.height }); await page.setViewportSize(v); }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
}

export type Item = { sig: string; box: Box };

/** In the page: `root` and every element inside it, with boxes relative to the root's top-left. `skip` is a selector of elements (and their insides) left out. */
export function measure([scope, skip]: [string, string]): { items: Item[]; box: Box } | null {
  const root = document.querySelector(scope);
  if (!root) return null;
  const origin = root.getBoundingClientRect();
  const ownText = (el: Element) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
  const MEANING = new Set(['a', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'nav', 'header', 'footer', 'main', 'svg', 'img', 'strong', 'em', 'time', 'input', 'label']);
  const sig = (el: Element) => {
    const cls = Array.from(el.classList).filter((c) => c.startsWith('pp-') && !/^pp-icon(--.*)?$/.test(c) && !/^pp-site-reveal(--in)?$/.test(c)).sort().join('.');
    const t = ownText(el);
    const tag = el.tagName.toLowerCase();
    return `${MEANING.has(tag) ? tag : 'box'}${cls ? `.${cls}` : ''}${t ? ` "${t}"` : ''}`;
  };
  const items: Item[] = [];
  const walk = (el: Element, top: boolean) => {
    if (!top && getComputedStyle(el).display === 'none') return;
    if (!top && skip && el.matches(skip)) return;
    const r = el.getBoundingClientRect();
    items.push({ sig: sig(el), box: { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height } });
    for (const c of Array.from(el.children)) walk(c, false);
  };
  walk(root, true);
  return { items, box: { x: origin.x + window.scrollX, y: origin.y + window.scrollY, width: origin.width, height: origin.height } };
}

export async function settle(p: Page): Promise<void> {
  await p.addStyleTag({ content: STILL });
  await p.evaluate(async () => { await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
}

async function diff(p: Page, a: Buffer, b: Buffer): Promise<number> {
  return p.evaluate(async ([a, b]) => {
    const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const [A, B] = await Promise.all([load(a!), load(b!)]);
    const w = Math.max(A.width, B.width), h = Math.max(A.height, B.height);
    const data = (img: HTMLImageElement) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!; x.fillStyle = '#f0f'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = data(A), db = data(B);
    // A pixel counts when it differs from the other page's pixel at the same place and from the ones just above and below it:
    // the two pages rasterise text on a half pixel grid a little differently (same boxes, to 0.001px), a moved or missing thing still counts.
    const far = (i: number, j: number) => Math.abs(da[i]! - db[j]!) > 24 || Math.abs(da[i + 1]! - db[j + 1]!) > 24 || Math.abs(da[i + 2]! - db[j + 2]!) > 24;
    const far2 = (i: number, j: number) => Math.abs(db[i]! - da[j]!) > 24 || Math.abs(db[i + 1]! - da[j + 1]!) > 24 || Math.abs(db[i + 2]! - da[j + 2]!) > 24;
    let bad = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, up = y > 0 ? i - w * 4 : i, down = y < h - 1 ? i + w * 4 : i;
      if (far(i, i) && far(i, up) && far(i, down) && far2(i, up) && far2(i, down)) bad++;
    }
    return w * h ? bad / (w * h) : 1;
  }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]);
}

export type Result = { name: string; pass: boolean; unmatched: string[]; moved: string[]; pixelRatio: number; kitElements: number };

/**
 * Compares one section of the Angular gallery with the same section of the kit page. Both pages are open and settled.
 * Boxes within 1px, items matched by tag, pp- classes and own text, at most 1% of pixels differ (channel difference over 24).
 * `skip` leaves out elements whose content is a live loop (the typing question card).
 */
export async function compareSection(page: Page, kitPage: Page, k: Key, d: Device, skip = ''): Promise<Result> {
  const app = `section[data-example="${exampleName(k, d)}"] [data-example-body] ${SECTION[k].app}`;
  const kit = SECTION[k].kit(d);
  await page.locator(app).first().scrollIntoViewIfNeeded();
  const a = await page.evaluate(measure, [app, skip] as [string, string]);
  const kk = await kitPage.evaluate(measure, [kit, skip] as [string, string]);
  const name = exampleName(k, d);
  if (!kk) throw new Error(`site-03 parity: the kit has no element ${kit}`);
  if (!a) return { name, pass: false, unmatched: ['the gallery section has no element'], moved: [], pixelRatio: 1, kitElements: kk.items.length };
  const unmatched: string[] = [];
  const moved: string[] = [];
  const pool = [...a.items];
  for (const it of kk.items) {
    const at = pool.findIndex((p) => p.sig === it.sig);
    if (at < 0) { unmatched.push(it.sig); continue; }
    const p = pool.splice(0, at + 1)[at]!;
    const off = (['x', 'y', 'width', 'height'] as const).filter((key) => Math.abs(p.box[key] - it.box[key]) > 1);
    if (off.length) moved.push(`${it.sig}: ${off.map((key) => `${key} kit ${it.box[key].toFixed(1)} page ${p.box[key].toFixed(1)}`).join(', ')}`);
  }
  const clip = (b: Box) => ({ x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)), width: Math.round(b.width), height: Math.round(b.height) });
  const shoot = async (p: Page, scope: string, b: Box) => {
    const dx = Math.ceil(b.x) - b.x, dy = Math.ceil(b.y) - b.y;
    await p.evaluate(([s, x, y]) => { const host = (document.querySelector(s as string) as HTMLElement).closest('.pp-site-stage')!.parentElement as HTMLElement; host.style.boxSizing = 'content-box'; host.style.paddingTop = `${(parseFloat(host.style.paddingTop) || 0) + (y as number)}px`; host.style.paddingLeft = `${(parseFloat(host.style.paddingLeft) || 0) + (x as number)}px`; }, [scope, dx, dy] as const);
    const m = await p.evaluate(measure, [scope, ''] as [string, string]);
    return { m, c: clip(m!.box) };
  };
  await page.evaluate(() => window.scrollTo(0, 0));
  await kitPage.evaluate(() => window.scrollTo(0, 0));
  const sk = await shoot(kitPage, kit, kk.box);
  const sa = await shoot(page, app, a.box);
  let pixelRatio = 1;
  const c = { ...sa.c, width: sk.c.width, height: sk.c.height };
  if (sk.c.width > 0 && sk.c.height > 0) {
    const shotK = await kitPage.screenshot({ clip: sk.c, fullPage: true, animations: 'disabled' });
    const shotA = await page.screenshot({ clip: c, fullPage: true, animations: 'disabled' });
    pixelRatio = await diff(kitPage, shotK, shotA);
  }
  return { name, pass: !unmatched.length && !moved.length && pixelRatio <= 0.01, unmatched, moved, pixelRatio, kitElements: kk.items.length };
}

/** The page-side function that lists the words of an element: every text node and every accessible name. `skip` leaves out live loops. */
export function wordsOf([scope, skip]: [string, string]): { texts: string[]; names: string[] } {
  const root = document.querySelector(scope)!;
  const clean = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
  const texts = new Set<string>();
  const names = new Set<string>();
  const walk = (el: Element) => {
    if (['SCRIPT', 'STYLE', 'TEMPLATE'].includes(el.tagName)) return;
    if (skip && el.matches(skip)) return;
    for (const a of ['aria-label', 'alt', 'title', 'placeholder']) { const v = clean(el.getAttribute(a)); if (v) names.add(v); }
    const by = el.getAttribute('aria-labelledby');
    if (by) { const v = clean(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ')); if (v) names.add(v); }
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) { const v = clean(n.textContent); if (v) texts.add(v); } else if (n.nodeType === 1) walk(n as Element);
    }
  };
  walk(root);
  return { texts: [...texts].sort(), names: [...names].sort() };
}

// ------------------------------------------------------------------------------------------------ timelines

export type Kind = 'peek' | 'batsi' | 'rec' | 'ask' | 'read';
export type Step = { t: number; sig: string };

/**
 * In the page: watch `scope` every 20ms for `ms` and return each distinct state with the time it first showed.
 * `sig` is how a state is written down; the same function runs on the Angular page and on the kit page, so the two are compared in the same words.
 */
export async function timeline(page: Page, kind: Kind, scope: string, ms: number): Promise<Step[]> {
  return page.evaluate(([kind, scope, ms]) => new Promise<Step[]>((resolve) => {
    const root = document.querySelector(scope as string);
    if (!root) return resolve([{ t: 0, sig: `NO ELEMENT ${scope}` }]);
    // The words of an element: each text node trimmed, joined by one space (a space between an element and the next is not a word).
    const txt = (e: Element) => { const out: string[] = []; const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const v = (n.textContent ?? '').replace(/\s+/g, ' ').trim(); if (v) out.push(v); } return out.join(' '); };
    const cls = (e: Element) => Array.from(e.classList).filter((c) => !/^pp-site-reveal/.test(c)).sort().join('.');
    const sig = (): string => {
      if (kind === 'peek') {
        const body = root.querySelector('.pp-site-chat__body')!;
        return `${root.classList.contains('pp-site-peek--open') ? 'open' : 'shut'}|${Array.from(body.children).map((c) => `${cls(c)}:${txt(c)}`).join(' / ')}`;
      }
      if (kind === 'batsi') {
        const body = root.querySelector('.pp-site-chat__body')!;
        const tabs = Array.from(root.querySelectorAll('.pp-site-qtabs__tab')).map((b) => (b.getAttribute('aria-selected') === 'true' ? '1' : '0')).join('');
        const paused = root.querySelector('.pp-site-qtabs')?.classList.contains('pp-site-qtabs--paused') ? 'paused' : 'auto';
        const pressed = Array.from(root.querySelectorAll('.pp-button--pressed')).length;
        return `${tabs}|${paused}|p${pressed}|${Array.from(body.children).map((c) => `${cls(c)}:${txt(c)}`).join(' / ')}`;
      }
      if (kind === 'rec') {
        const cols = Array.from(root.querySelectorAll('.pp-site-board__col')).map((c) => `${txt(c.querySelector('.pp-site-board__count')!)}[${Array.from(c.querySelectorAll('.pp-site-board__card')).map((k) => `${k.getAttribute('data-card')}.${cls(k)}.${txt(k.querySelector('.pp-site-board__flag') ?? k)}.${txt(k.querySelector('.pp-site-board__note') ?? k)}`).join(',')}]`).join(' ');
        const draft = root.querySelector('.pp-site-hiring__draft')!;
        const body = root.querySelector('.pp-site-hiring__body')!;
        const len = (body.textContent ?? '').length;
        const send = root.querySelector('.pp-site-hiring__row .pp-button--primary')!.classList.contains('pp-button--pressed');
        return `${cols} | draft ${cls(draft)} ${len === 0 ? 'empty' : len < 100 ? 'typing' : 'full'} send${send ? 'Pressed' : ''}`;
      }
      if (kind === 'ask') return txt(root);
      const vals = Array.from(root.querySelectorAll('.pp-site-read__value')).map((b) => (b.classList.contains('pp-site-read__value--in') ? 1 : 0)).join('');
      const doc = root.querySelector('.pp-site-read__doc')!.classList.contains('pp-site-read__doc--go') ? 'go' : 'idle';
      const sg = root.querySelector('.pp-site-read__suggest')!.classList.contains('pp-site-step--in') ? 1 : 0;
      const dd = root.querySelector('.pp-site-read__decide')!;
      const fo = root.querySelector('.pp-site-person__follow')!.classList.contains('pp-site-step--in') ? 1 : 0;
      return `${doc} v${vals} s${sg} pressed${dd.querySelector('.pp-button--pressed') ? 1 : 0} done${dd.classList.contains('pp-site-read__decide--done') ? 1 : 0} f${fo}`;
    };
    const out: Step[] = [];
    const t0 = performance.now();
    let last = '';
    const tick = () => {
      const s = sig();
      if (s !== last) { out.push({ t: Math.round(performance.now() - t0), sig: s }); last = s; }
      if (performance.now() - t0 >= (ms as number)) return resolve(out);
      setTimeout(tick, 20);
    };
    tick();
  }), [kind, scope, ms] as const);
}

/** The steps with times counted from the first change after the start, so two pages that started a little apart can be compared. */
export function fromFirstChange(steps: Step[]): Step[] {
  if (steps.length < 2) return steps;
  const t0 = steps[1]!.t;
  return steps.slice(1).map((s) => ({ t: s.t - t0, sig: s.sig }));
}

/** An IntersectionObserver that reports only when the test says so (`window.__fireView()`): demos and arrivals start together, on cue. */
export const GATED_VIEW = () => {
  type Rec = { cb: (e: unknown[], o: unknown) => void; els: Element[]; off: boolean };
  const all: Rec[] = [];
  class Gated {
    private rec: Rec;
    constructor(cb: (e: unknown[], o: unknown) => void) { this.rec = { cb, els: [], off: false }; all.push(this.rec); }
    observe(el: Element): void { this.rec.els.push(el); }
    unobserve(el: Element): void { this.rec.els = this.rec.els.filter((e) => e !== el); }
    disconnect(): void { this.rec.off = true; this.rec.els = []; }
    takeRecords(): [] { return []; }
  }
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Gated;
  (window as unknown as { __fireView: () => void }).__fireView = () => {
    for (const r of [...all]) {
      if (r.off || !r.els.length) continue;
      const entries = r.els.map((target) => ({ isIntersecting: true, target, intersectionRatio: 1, boundingClientRect: target.getBoundingClientRect(), time: performance.now() }));
      r.cb(entries, r);
    }
  };
};

/** Two timelines are the same when they pass through the same states in the same order, each within `tol` ms of the other. */
export function sameTimeline(app: Step[], kit: Step[], tol: number): { states: boolean; late: string[] } {
  const states = JSON.stringify(app.map((s) => s.sig)) === JSON.stringify(kit.map((s) => s.sig));
  const late = app.map((s, i) => (kit[i] && Math.abs(s.t - kit[i]!.t) > tol ? `#${i} app ${s.t}ms kit ${kit[i]!.t}ms: ${s.sig.slice(0, 80)}` : '')).filter(Boolean);
  return { states, late };
}
