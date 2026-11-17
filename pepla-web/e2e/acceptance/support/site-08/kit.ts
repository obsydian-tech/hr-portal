import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { icons as LUCIDE } from 'lucide';
import type { Page } from '@playwright/test';

/**
 * SITE-08 helpers, part 1: the design system kit as the oracle (its fragments, its preview scripts) and the page-side functions that
 * measure, list words and sample timelines. Everything here is read-only for the other cards: SITE-09 to SITE-14 import it through
 * learn-page.ts and never edit it (a change is a child lock, acceptance-lock/site-08.N).
 *
 * Copied, not imported, from the SITE-03 and SITE-04 helpers (landing.ts, landing2.ts), so nothing locked changes.
 * The lock-check lessons of those two cards are kept: boxes within 1px, 1% of pixels, states compared by hash, timing 250ms,
 * no-LCD launch args (set in the spec), gated IntersectionObserver, kit served from the app origin, and the kit shot taken without
 * its preceding siblings.
 */

export const PEPLA_WEB = join(__dirname, '..', '..', '..', '..');
const DS = join(PEPLA_WEB, 'src', 'styles', 'design-system');
const PREFIX = '/__site-08-kit__/';
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@700;800&display=swap';
export const STILL = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}.pp-site-reveal{opacity:1!important;transform:none!important}.pp-site-stage{border-radius:0!important;box-shadow:none!important}';
const TYPES: Record<string, string> = { '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

export type Device = 'desktop' | 'phone';
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const deviceOf = (page: Page): Device => ((page.viewportSize()?.width ?? 1280) < 600 ? 'phone' : 'desktop');

// ------------------------------------------------------------------------------------------------ the kit files

function curl(url: string): string {
  return execFileSync('curl', ['-fsSL', '--retry', '3', url], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8');
}
export function syncJson(): { repo: string; ref: string } {
  return JSON.parse(readFileSync(join(DS, 'sync.json'), 'utf8'));
}
/**
 * The design system ref the tests read the kit at: the ref in sync.json, or `SITE_KIT_REF` when set. (develop's sync.json ref lacks
 * `project/ui_kits/site-pages.html`; it is in c0de954 and after, and SITE-07 moves the ref to at least that. Develop and test with
 * SITE_KIT_REF=c0de954c2b1d60f5b65d894a2664cfa6ffeda2d0 until then.)
 */
export function kitRef(): string {
  return process.env['SITE_KIT_REF'] || syncJson().ref;
}
/** A file of the design system repo at the kit ref, cached by ref in the OS temp folder. A missing file fails with the reason. */
export function dsFile(path: string): string {
  const { repo } = syncJson();
  const ref = kitRef();
  const dir = join(tmpdir(), 'site-08-kit', ref);
  const file = join(dir, path.replace(/\//g, '__'));
  if (existsSync(file)) return readFileSync(file, 'utf8');
  let text: string;
  try { text = curl(`https://raw.githubusercontent.com/${repo}/${ref}/${path}`); } catch {
    throw new Error(`site-08: the design system has no ${path} at ${ref} (or it could not be fetched). Set SITE_KIT_REF to a ref that has it, for example c0de954c2b1d60f5b65d894a2664cfa6ffeda2d0.`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, text);
  return text;
}

const pascal = (n: string) => n.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
function lucide(name: string, attrs: string): string {
  const node = (LUCIDE as Record<string, Array<[string, Record<string, string>]>>)[pascal(name)];
  if (!node) throw new Error(`site-08 parity: unknown Lucide icon "${name}" in the kit`);
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

export const KIT_FILE = {
  demos: 'project/ui_kits/site-demos.html',
  endings: 'project/ui_kits/site-page-endings.html',
  heroes: 'project/ui_kits/site-page-heroes.html',
  pages: 'project/ui_kits/site-pages.html',
} as const;
const SCRIPT = (f: string) => dsFile(`scripts/preview/${f}`);
export const MODULE_SCRIPTS = ['site-recruitment.js', 'site-onboarding.js', 'site-compliance.js', 'site-leave.js', 'site-security.js', 'site-platform.js'];

export type Screen = { name: string; device: Device; screen: string; stage: string };
/** The screens of one kit fragment page: `data-screen="<name> (<device>)"`, each holding one `.pp-site-stage`. */
export function screens(file: keyof typeof KIT_FILE): Screen[] {
  const text = dsFile(KIT_FILE[file]);
  const out: Screen[] = [];
  for (const part of text.split(/(?=<section data-screen=")/)) {
    const m = /^<section data-screen="([^"]+)" data-device="(desktop|phone)">\s*([\s\S]*?)\s*<\/section>\s*$/.exec(part);
    if (!m) continue;
    out.push({ name: m[1]!.replace(/\s*\((desktop|phone)\)$/, ''), device: m[2] as Device, screen: m[1]!, stage: kitMarkup(m[3]!) });
  }
  if (!out.length) throw new Error(`site-08: no screens found in ${KIT_FILE[file]}`);
  return out;
}

const SEC = /<section\b|<\/section>/g;
/** The section element that starts at `from` in `html`, through its matching end tag. */
export function sliceSection(html: string, from: number): string {
  SEC.lastIndex = from;
  let depth = 0;
  for (let m = SEC.exec(html); m; m = SEC.exec(html)) {
    depth += m[0] === '</section>' ? -1 : 1;
    if (depth === 0) return html.slice(from, m.index + m[0].length);
  }
  throw new Error('site-08: a kit section has no end tag');
}

// ------------------------------------------------------------------------------------------------ the examples

export type Family = 'demo' | 'top' | 'ending' | 'piece' | 'sample';
export type Example = { family: Family; name: string; device: Device; screen: string; id: string };

export const kebab = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** `learn-` + the kebab-case of the name, unless the name already starts with "learn"; then `-<device>`. The sample is `learn-sample-<device>`. */
export function exampleId(name: string, device: Device): string {
  if (name === 'Sample') return `learn-sample-${device}`;
  const k = kebab(name);
  return `${k.startsWith('learn-') ? k : `learn-${k}`}-${device}`;
}

/**
 * The shared demo pieces of SITE-08 (decision 5), each with the kit demo that stands for it. The rule: the first demo of the kit page set
 * (site-pages.html, pages in the order Recruitment, Onboarding, Compliance, Leave, Security, Platform) that uses the piece and holds
 * nothing but the demo shell and shared pieces; a demo is never used for two pieces (the first not yet taken). See cards/site-08.md.
 */
export type Piece = { name: string; page: string; module: string; demo: string; script: string };
export const PIECES: Piece[] = [
  { name: 'timeline', page: 'Recruitment', module: 'recruitment', demo: 'follow', script: 'site-recruitment.js' },
  { name: 'document read', page: 'Onboarding', module: 'onboarding', demo: 'read', script: 'site-onboarding.js' },
  { name: 'suggestion', page: 'Leave', module: 'leave', demo: 'appr', script: 'site-leave.js' },
  { name: 'live status', page: 'Onboarding', module: 'onboarding', demo: 'follow', script: 'site-onboarding.js' },
  { name: 'approval decision and log line', page: 'Security', module: 'security', demo: 'sec-appr', script: 'site-security.js' },
  { name: 'choices and slots', page: 'Platform', module: 'platform', demo: 'plat-roles', script: 'site-platform.js' },
];
export const pieceByName = (example: string): Piece => PIECES.find((p) => `Piece: ${p.name}` === example)!;

/** Every example of the gallery for one device (or both), in the kit's order, then the pieces, then the sample page. */
export function examples(device?: Device): Example[] {
  const out: Example[] = [];
  const push = (family: Family, name: string, d: Device) => out.push({ family, name, device: d, screen: `${name} (${d})`, id: exampleId(name, d) });
  for (const s of screens('demos')) push('demo', s.name, s.device);
  for (const s of screens('heroes')) push('top', s.name, s.device);
  for (const s of screens('endings')) push('ending', s.name, s.device);
  for (const d of ['desktop', 'phone'] as Device[]) for (const p of PIECES) push('piece', `Piece: ${p.name}`, d);
  for (const d of ['desktop', 'phone'] as Device[]) push('sample', 'Sample', d);
  return device ? out.filter((e) => e.device === device) : out;
}

/** The stage markup of one kit example (the sample is built from the Leave page by learn-page.ts). */
export function exampleStage(ex: Example): string {
  if (ex.family === 'piece') {
    const piece = pieceByName(ex.name);
    const page = screens('pages').find((s) => s.name === `${piece.page} page` && s.device === ex.device);
    if (!page) throw new Error(`site-08: the kit has no "${piece.page} page (${ex.device})"`);
    const at = page.stage.indexOf(`data-demo="${piece.demo}"`);
    if (at < 0) throw new Error(`site-08: the kit ${piece.page} page has no demo ${piece.demo}`);
    const section = sliceSection(page.stage, page.stage.lastIndexOf('<section', at));
    return `<div class="pp-site-stage pp-site-stage--${ex.device}" data-theme="light" data-site-module="${piece.module}">${section}</div>`;
  }
  const file = ex.family === 'demo' ? 'demos' : ex.family === 'top' ? 'heroes' : 'endings';
  const s = screens(file).find((x) => x.screen === ex.screen);
  if (!s) throw new Error(`site-08: the kit has no example "${ex.screen}"`);
  return s.stage;
}
/** The kit preview scripts that drive an example (every kit example is static without them). */
export function exampleScripts(ex: Example): string[] {
  if (ex.family === 'piece') return [pieceByName(ex.name).script];
  if (ex.family === 'demo' || ex.family === 'ending') return ['site-demos.js'];
  return [];
}

/** The full kit page document: the stage, an optional page-side `prep` that runs before the preview scripts, then the scripts. */
export function kitDocument(stage: string, scripts: string[], opts: { device: Device; stageWidth?: number; prep?: string }): string {
  const js = scripts.map((f) => `<script>${SCRIPT(f)}</script>`).join('');
  const width = opts.stageWidth ? `document.querySelector('.pp-site-stage').style.width='${opts.stageWidth}px';` : '';
  const prep = `<script>${width}${opts.prep ?? ''}</script>`;
  return `<!doctype html><html lang="en-ZA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${FONTS}"><link rel="stylesheet" href="ds/index.css"><style>body{margin:0}</style></head><body>${stage}${prep}${js}</body></html>`;
}

/** Opens a kit document in `kitPage`, served from the app's own origin under a path the app never uses (so the page behaves as on the app). */
export async function openKitDocument(kitPage: Page, origin: string, html: string): Promise<void> {
  await kitPage.route(`${origin}${PREFIX}**`, async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.slice(PREFIX.length));
    if (rel === 'kit.html') return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    const file = normalize(join(DS, rel.replace(/^ds\//, '')));
    if (!rel.startsWith('ds/') || !file.startsWith(DS + sep) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  await kitPage.goto(`${origin}${PREFIX}kit.html`);
  await kitPage.waitForLoadState('networkidle');
  await kitPage.evaluate(async () => { await document.fonts.ready; });
}

/** Opens one kit example. `scripts` false leaves the page static. The hero card of a page top is taken out (an empty slot is what the gallery shows). */
export async function openKitExample(kitPage: Page, origin: string, ex: Example, scripts: boolean, stageWidth?: number): Promise<void> {
  const prep = ex.family === 'top' ? `document.querySelectorAll('.pp-site-hcard').forEach(function(e){e.remove();});` : '';
  await openKitDocument(kitPage, origin, kitDocument(exampleStage(ex), scripts ? exampleScripts(ex) : [], { device: ex.device, stageWidth, prep }));
}

// ------------------------------------------------------------------------------------------------ the gallery

export const sectionOf = (page: Page, ex: Pick<Example, 'screen'>) => page.locator(`section[data-example="${ex.screen}"]`);
/** Opens /dev/site-learn. With `only` (section ids), every other section is taken out so a phone window is not zoomed out by the wide desktop stages. */
export async function gotoLearn(page: Page, only?: string[]): Promise<void> {
  const res = await page.goto('/dev/site-learn');
  if (!res || res.status() >= 400) throw new Error(`/dev/site-learn answered ${res?.status()}`);
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

// ------------------------------------------------------------------------------------------------ views, gating

/** An IntersectionObserver that never reports: every demo and every arrival stays on its first step. */
export const FREEZE_VIEW = () => {
  class Never { observe(): void {} unobserve(): void {} disconnect(): void {} takeRecords(): [] { return []; } }
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = Never;
};
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
export const fire = async (p: Page): Promise<void> => { await p.evaluate(() => (window as unknown as { __fireView: () => void }).__fireView()); };
/** Click the moment the element exists (no waiting for it to be stable: that wait differs from page to page and would move the timings). */
export const hit = async (p: Page, css: string, timeout = 20_000): Promise<void> => { await p.locator(css).first().waitFor({ state: 'attached', timeout }); await p.locator(css).first().evaluate((el) => (el as HTMLElement).click()); };

// ------------------------------------------------------------------------------------------------ measure and compare

type Box = { x: number; y: number; width: number; height: number };
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
 * Compares `appScope` on the Angular page with `kitScope` on the kit page. Both pages are open and settled.
 * Boxes within 1px, items matched by tag, pp- classes and own text (in order, extra items on the page side are let through), at most 1%
 * of pixels differ (channel difference over 24). `skip` leaves out elements whose content is a live loop.
 * `skipRoot` leaves the two root items out (a page's root is a div in the kit and the one main on the site).
 * The scopes must each be inside a `.pp-site-stage` (the shot pads the stage's parent so both pictures start on a whole pixel).
 */
export async function compareScopes(page: Page, kitPage: Page, name: string, appScope: string, kitScope: string, skip = '', pixels = true, skipRoot = false): Promise<Result> {
  await page.locator(appScope).first().scrollIntoViewIfNeeded();
  const a = await page.evaluate(measure, [appScope, skip] as [string, string]);
  const kk = await kitPage.evaluate(measure, [kitScope, skip] as [string, string]);
  if (!kk) throw new Error(`site-08 parity: the kit has no element ${kitScope}`);
  if (!a) return { name, pass: false, unmatched: ['the gallery has no element ' + appScope], moved: [], pixelRatio: 1, kitElements: kk.items.length };
  const unmatched: string[] = [];
  const moved: string[] = [];
  // `skipRoot`: the roots are not the same element on the two pages (the kit's div, the site's main), so only what is inside them is judged.
  const pool = a.items.slice(skipRoot ? 1 : 0);
  for (const it of kk.items.slice(skipRoot ? 1 : 0)) {
    const at = pool.findIndex((p) => p.sig === it.sig);
    if (at < 0) { unmatched.push(it.sig); continue; }
    const p = pool.splice(0, at + 1)[at]!;
    const off = (['x', 'y', 'width', 'height'] as const).filter((key) => Math.abs(p.box[key] - it.box[key]) > 1);
    if (off.length) moved.push(`${it.sig}: ${off.map((key) => `${key} kit ${it.box[key].toFixed(1)} page ${p.box[key].toFixed(1)}`).join(', ')}`);
  }
  let pixelRatio = 0;
  if (pixels) {
    const clip = (b: Box) => ({ x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)), width: Math.round(b.width), height: Math.round(b.height) });
    const shoot = async (p: Page, scope: string, b: Box) => {
      const dx = Math.ceil(b.x) - b.x, dy = Math.ceil(b.y) - b.y;
      await p.evaluate(([s, x, y]) => { const host = (document.querySelector(s as string) as HTMLElement).closest('.pp-site-stage')!.parentElement as HTMLElement; host.style.boxSizing = 'content-box'; host.style.paddingTop = `${(parseFloat(host.style.paddingTop) || 0) + (y as number)}px`; host.style.paddingLeft = `${(parseFloat(host.style.paddingLeft) || 0) + (x as number)}px`; }, [scope, dx, dy] as const);
      const m = await p.evaluate(measure, [scope, ''] as [string, string]);
      return { m, c: clip(m!.box) };
    };
    // Lock check (SITE-04 T15): on the phone the kit shot can sit past Chrome's 16384 device-pixel capture limit, so everything before the
    // kit scope is taken out of the layout for the picture only.
    await kitPage.evaluate((sc) => { let e: Element | null = document.querySelector(sc); while (e && e.parentElement) { let s = e.previousElementSibling; while (s) { (s as HTMLElement).style.display = 'none'; s = s.previousElementSibling; } e = e.parentElement; } }, kitScope);
    await page.evaluate(() => window.scrollTo(0, 0));
    await kitPage.evaluate(() => window.scrollTo(0, 0));
    const sk = await shoot(kitPage, kitScope, (await kitPage.evaluate(measure, [kitScope, ''] as [string, string]))!.box);
    const sa = await shoot(page, appScope, a.box);
    pixelRatio = 1;
    const c = { ...sa.c, width: sk.c.width, height: sk.c.height };
    if (sk.c.width > 0 && sk.c.height > 0) {
      const shotK = await kitPage.screenshot({ clip: sk.c, fullPage: true, animations: 'disabled' });
      const shotA = await page.screenshot({ clip: c, fullPage: true, animations: 'disabled' });
      pixelRatio = await diff(kitPage, shotK, shotA);
    }
  }
  return { name, pass: !unmatched.length && !moved.length && pixelRatio <= 0.01, unmatched, moved, pixelRatio, kitElements: kk.items.length };
}

/** One gallery example against the same kit example: scope is the example's stage on both sides. */
export function compareExample(page: Page, kitPage: Page, ex: Example, skip = '', pixels = true): Promise<Result> {
  return compareScopes(page, kitPage, ex.screen, `section[data-example="${ex.screen}"] [data-example-body] .pp-site-stage`, '.pp-site-stage', skip, pixels);
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
 * A state is written down as a short fingerprint of everything that can show a step: every element's classes (the `reveal` classes left
 * out), the disabled, selected, pressed, expanded and hidden flags, a `--_fill` style and every piece of text, except what `skip` names
 * (live typing, judged by its end). After the fingerprint come the class changes since the last state, so a failure says what moved.
 * The same function runs on the Angular page and on the kit page. States are compared by the fingerprint only (lock check T5).
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
/** A state that lasts under 45ms (one frame between a class and its text) is dropped: the order of the states that stay is what is judged. */
export const settled = (steps: Step[], gap = 45): Step[] => steps.filter((s, i) => i === steps.length - 1 || steps[i + 1]!.t - s.t >= gap);
/** Two timelines are the same when they pass through the same states in the same order, each within `tol` ms of the other. */
export function sameTimeline(app: Step[], kit: Step[], tol: number): { states: boolean; late: string[] } {
  const states = JSON.stringify(app.map((s) => s.sig)) === JSON.stringify(kit.map((s) => s.sig));
  const late = app.map((s, i) => (kit[i] && Math.abs(s.t - kit[i]!.t) > tol ? `#${i} app ${s.t}ms kit ${kit[i]!.t}ms: ${s.sig.slice(0, 80)}` : '')).filter(Boolean);
  return { states, late };
}
/** The timing tolerance: 250ms (SITE-04 lock check: 2.4 times the largest page/kit gap measured; a 300ms retime must fail). */
export const TOL = 250;
