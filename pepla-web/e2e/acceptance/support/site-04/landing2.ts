import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { icons as LUCIDE } from 'lucide';
import type { Locator, Page } from '@playwright/test';

/**
 * SITE-04 helpers: the landing sections gallery, part 2, (/dev/site-landing) and the design system's landing page kit
 * (project/ui_kits/site-landing.html with its three preview scripts) as the reference the tests compare against.
 */

export const PEPLA_WEB = join(__dirname, '..', '..', '..', '..');
const DS = join(PEPLA_WEB, 'src', 'styles', 'design-system');
const PREFIX = '/__site-04-kit__/';
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@700;800&display=swap';
export const STILL = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}.pp-site-reveal{opacity:1!important;transform:none!important}.pp-site-stage{border-radius:0!important;box-shadow:none!important}';
const TYPES: Record<string, string> = { '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

export type Device = 'desktop' | 'phone';
export type Key = 'compliance' | 'leave' | 'trust' | 'integrations' | 'platform' | 'about';
export const KEYS: Key[] = ['compliance', 'leave', 'trust', 'integrations', 'platform', 'about'];

/** The six sections of this card, in the kit's order. `kit` is the section's element in the kit page, `app` the same in the gallery. */
export const SECTION: Record<Key, { name: string; app: string; kit: (d: Device) => string }> = {
  compliance: { name: 'Compliance Management', app: '.pp-site-section', kit: (d) => `#compliance-${d === 'desktop' ? 'd' : 'p'}` },
  leave: { name: 'Leave Management', app: '.pp-site-section', kit: (d) => `#leave-${d === 'desktop' ? 'd' : 'p'}` },
  trust: { name: 'Trust and POPIA', app: '.pp-site-section', kit: (d) => `#trust-${d === 'desktop' ? 'd' : 'p'}` },
  integrations: { name: 'Integrations', app: '.pp-site-section', kit: (d) => `#api-${d === 'desktop' ? 'd' : 'p'}` },
  platform: { name: 'Platform', app: '.pp-site-section', kit: (d) => `#platform-${d === 'desktop' ? 'd' : 'p'}` },
  about: { name: 'About', app: '.pp-site-section', kit: (d) => `#about-${d === 'desktop' ? 'd' : 'p'}` },
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
/** The design system ref the landing kit is compared at: PR #47 removed the closing band note from the landing and every Learn more kit. */
export const LANDING_KIT_REF = '8dc3091b48774490fa3d0e0bb0fcd7825aac3d9a';
/** A file of the design system repo at the ref the app is synced to (or at pinnedRef), cached in the OS temp folder. */
export function dsFile(path: string, pinnedRef?: string): string {
  const { repo, ref: syncRef } = syncJson();
  const ref = pinnedRef ?? syncRef;
  const dir = join(tmpdir(), 'site-04-kit', ref);
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
  if (!node) throw new Error(`site-04 parity: unknown Lucide icon "${name}" in the kit`);
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
  const body = kitMarkup(dsFile('project/ui_kits/site-landing.html', LANDING_KIT_REF));
  // Lock check: the part-1 preview scripts (SITE-03's list) run too, so the hero, Modules, Ask Batsi, Recruitment and Onboarding on the kit
  // page behave as the site's do in the whole-page compare (without them the kit's Onboarding never went live and its hidden read view sat
  // 6 to 8px off the site's).
  const js = ['site-landing-parts.js', 'site-landing-sections.js', 'site-onboarding-story.js', 'site-landing-compliance-leave.js', 'site-security.js', 'site-integrations.js', 'site-platform.js', 'site-landing.js'].map((f) => `<script>${dsFile(`scripts/preview/${f}`, LANDING_KIT_REF)}</script>`).join('');
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
  if (!kk) throw new Error(`site-04 parity: the kit has no element ${kit}`);
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
  // Lock check: on the phone (2 device pixels per CSS pixel) the kit's sections sit 8000+ CSS px down the kit page, past Chrome's 16384
  // device-pixel capture limit, and the full-page shot of them came out 1 CSS px off (Compliance: 1.42% of pixels on the phone, 0.00% with
  // this). The boxes are measured above; for the picture, everything before the kit section is taken out of the layout.
  await kitPage.evaluate((sc) => { let e: Element | null = document.querySelector(sc); while (e && e.parentElement) { let s = e.previousElementSibling; while (s) { (s as HTMLElement).style.display = 'none'; s = s.previousElementSibling; } e = e.parentElement; } }, kit);
  await page.evaluate(() => window.scrollTo(0, 0));
  await kitPage.evaluate(() => window.scrollTo(0, 0));
  const sk = await shoot(kitPage, kit, (await kitPage.evaluate(measure, [kit, ''] as [string, string]))!.box);
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

export type Step = { t: number; sig: string };

/**
 * In the page: watch `scope` every 20ms for `ms` and return each distinct state with the time it first showed.
 * A state is written down as a short fingerprint of everything that can show a step: every element's classes (the `reveal` classes
 * left out), the disabled, selected, pressed, expanded and hidden flags, a `--_fill` style and every piece of text, except what
 * `skip` names (live typing, which is judged by its end). After the fingerprint come the class changes since the last state,
 * so a failure says what moved. The same function runs on the Angular page and on the kit page.
 */
export async function timeline(page: Page, scope: string, ms: number, skip = ''): Promise<Step[]> {
  return page.evaluate(([scope, ms, skip]) => new Promise<Step[]>((resolve) => {
    const root = document.querySelector(scope as string);
    if (!root) return resolve([{ t: 0, sig: `NO ELEMENT ${scope}` }]);
    let prev = new Map<number, string>();
    const sample = (): string => {
      const now = new Map<number, string>();
      let all = '';
      let i = 0;
      const walk = (el: Element) => {
        if (el.tagName.toLowerCase() === 'svg' || (skip && el.matches(skip as string))) { i++; return; }
        const cls = Array.from(el.classList).filter((c) => c.startsWith('pp-') && !/^pp-icon/.test(c) && !/^pp-site-reveal/.test(c)).sort().join('.');
        const at = ['disabled', 'aria-selected', 'aria-pressed', 'aria-expanded', 'aria-hidden'].map((a) => (el.hasAttribute(a) ? `${a[0] === 'd' ? 'd' : a.slice(5, 7)}=${el.getAttribute(a)}` : '')).join('');
        const fill = (el as HTMLElement).style?.getPropertyValue('--_fill') ?? '';
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
  }), [scope, ms, skip] as const);
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

/**
 * The whole landing page against the kit's whole landing page for one device: every item of the kit page (below the stage) is on the page,
 * in the same order, with its box within 1px. The root of each is the parent of the pilot bar. (Pixels are judged per section.)
 */
export async function comparePage(page: Page, kitPage: Page, _d: Device): Promise<{ unmatched: string[]; moved: string[] }> {
  const mark = (p: Page) => p.evaluate(() => { const root = document.querySelector('.pp-site-pilot')?.parentElement; root?.setAttribute('data-s4-root', ''); window.scrollTo(0, 0); return !!root; });
  if (!(await mark(page))) return { unmatched: ['the page has no pilot bar'], moved: [] };
  if (!(await mark(kitPage))) throw new Error('site-04 parity: the kit page has no pilot bar');
  // Lock check: three things the kit stage cannot show as the site does are left out. The menu sheet (a hidden overlay, judged by SITE-02)
  // sits right after the header in the kit and after the footer in SITE-02's page part, so in-order matching skipped the whole page on the
  // phone. The Ask Batsi peek is position: fixed, which the kit stage (contain: paint) pins to the stage's bottom, 22000px down, and the
  // site to the window. The closed menu panels are placed by the header's own script, which the kit page here does not load (SITE-02
  // judges them). And the kit wraps the page in <div data-site-main> where the site has its one <main>: the wrapper is taken out.
  await kitPage.evaluate(() => document.querySelectorAll('[data-site-main]').forEach((el) => el.replaceWith(...Array.from(el.childNodes))));
  const a = await page.evaluate(measure, ['[data-s4-root]', '.pp-site-sheet, .pp-site-peek, .pp-site-menu__panel'] as [string, string]);
  const k = await kitPage.evaluate(measure, ['[data-s4-root]', '.pp-site-sheet, .pp-site-peek, .pp-site-menu__panel'] as [string, string]);
  const unmatched: string[] = [];
  const moved: string[] = [];
  const pool = a!.items.slice(1);
  for (const it of k!.items.slice(1)) {
    const at = pool.findIndex((p) => p.sig === it.sig);
    if (at < 0) { unmatched.push(it.sig); continue; }
    const p = pool.splice(0, at + 1)[at]!;
    const off = (['x', 'y', 'width', 'height'] as const).filter((key) => Math.abs(p.box[key] - it.box[key]) > 1);
    if (off.length) moved.push(`${it.sig}: ${off.map((key) => `${key} kit ${it.box[key].toFixed(1)} page ${p.box[key].toFixed(1)}`).join(', ')}`);
  }
  return { unmatched: unmatched.slice(0, 20), moved: moved.slice(0, 20) };
}
