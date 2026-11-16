import { icons as LUCIDE } from 'lucide';
import type { Page } from '@playwright/test';
import { PEPLA_WEB, dsFile, exampleId, type KitExample } from './site';
import { join, normalize, sep, extname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

/**
 * SITE-02 AC-2 · parity of a gallery example with its design system kit example. The SITE-01 harness
 * (e2e/parity/kit-parity.ts) compares whole kit screens (`data-screen`) at absolute positions; an example here is
 * one piece of a long gallery page, so this adapter does the same comparison relative to the example's own box:
 * the same wrapper (the app's own stylesheet, motion frozen by CSS (not by data-site-still, which hides the shine glow the planted-fault check needs), demos on their first step), the same matching of
 * elements by tag, `pp-` classes and own text, boxes within 1px, and at most 1% of pixels different (channel
 * difference over 24). It never edits the harness. The kit page also runs the design system's own preview script
 * (scripts/preview/site-header.js), so the menu's measured inputs (`--_x`, `--_sx`, ...) come from the kit's reference
 * code in the same browser and fonts, not from numbers typed into the example file.
 */

const DS = join(PEPLA_WEB, 'src', 'styles', 'design-system');
const PREFIX = '/__site-02-kit__/';
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@700;800&display=swap';
const STILL = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
const TYPES: Record<string, string> = { '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

const pascal = (n: string) => n.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
function lucide(name: string, attrs: string): string {
  const node = (LUCIDE as Record<string, Array<[string, Record<string, string>]>>)[pascal(name)];
  if (!node) throw new Error(`site-02 parity: unknown Lucide icon "${name}" in the kit`);
  const inner = node.map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  const cls = attrs.match(/class="([^"]*)"/)?.[1];
  const rest = attrs.replace(/class="[^"]*"/, '').trim();
  return `<svg class="lucide${cls ? ` ${cls}` : ''}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${rest ? ` ${rest}` : ''}>${inner}</svg>`;
}
const MARK = '<svg class="pp-logo__mark" viewBox="0 0 76 64" aria-hidden="true" focusable="false"><circle class="pp-logo__coral" cx="20" cy="38" r="18"></circle><circle class="pp-logo__violet" cx="38" cy="24" r="18"></circle><circle class="pp-logo__mint" cx="56" cy="38" r="18"></circle></svg>';

/** The kit example's markup, with the mark and the icons drawn as the design system build draws them. */
export function kitMarkup(ex: KitExample): string {
  return ex.html
    .replace(/<i data-pepla-mark><\/i>/g, MARK)
    .replace(/<i ([^>]*?)data-lucide="([a-z0-9-]+)"([^>]*)><\/i>/g, (_m, a: string, n: string, b: string) => lucide(n, `${a} ${b}`.trim()));
}

type Box = { x: number; y: number; width: number; height: number };
type Item = { sig: string; box: Box };

/** In the page: the example's root element and every element inside it, with boxes relative to the root's top-left. */
function measure(scope: string): { items: Item[]; box: Box } | null {
  const host = document.querySelector(scope);
  const root = host?.firstElementChild;
  if (!root) return null;
  const origin = root.getBoundingClientRect();
  const ownText = (el: Element) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
  // A tag counts when it carries meaning (link, button, heading, list, landmark, svg). A plain box (div, span, section,
  // article, aside, or an Angular component's own element such as pp-card) is one kind of element: what matters is its pp- classes.
  const MEANING = new Set(['a', 'button', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'nav', 'header', 'footer', 'main', 'svg', 'img', 'strong', 'em', 'time', 'input', 'label']);
  const sig = (el: Element) => {
    const cls = Array.from(el.classList).filter((c) => c.startsWith('pp-') && !/^pp-icon(--.*)?$/.test(c)).sort().join('.');
    const t = ownText(el);
    const tag = el.tagName.toLowerCase();
    return `${MEANING.has(tag) ? tag : 'box'}${cls ? `.${cls}` : ''}${t ? ` "${t}"` : ''}`;
  };
  const items: Item[] = [];
  const walk = (el: Element, top: boolean) => {
    if (!top && getComputedStyle(el).display === 'none') return;
    const r = el.getBoundingClientRect();
    items.push({ sig: sig(el), box: { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height } });
    for (const c of Array.from(el.children)) walk(c, false);
  };
  walk(root, true);
  return { items, box: { x: origin.x + window.scrollX, y: origin.y + window.scrollY, width: origin.width, height: origin.height } };
}

async function settle(p: Page): Promise<void> {
  await p.addStyleTag({ content: STILL });
  await p.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

async function diff(p: Page, a: Buffer, b: Buffer): Promise<number> {
  return p.evaluate(async ([a, b]) => {
    const load = (src: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    const [A, B] = await Promise.all([load(a!), load(b!)]);
    const w = Math.max(A.width, B.width), h = Math.max(A.height, B.height);
    const data = (img: HTMLImageElement) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d')!; x.fillStyle = '#f0f'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0); return x.getImageData(0, 0, w, h).data; };
    const da = data(A), db = data(B);
    let bad = 0;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i]! - db[i]!) > 24 || Math.abs(da[i + 1]! - db[i + 1]!) > 24 || Math.abs(da[i + 2]! - db[i + 2]!) > 24) bad++;
    return w * h ? bad / (w * h) : 1;
  }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]);
}


/** Serves one kit example (with the design system's own preview script) from the app's origin, under a path the app never uses. */
export async function serveKit(kitPage: Page, origin: string, ex: KitExample, hostWidth: number, frozen = true): Promise<string> {
  await kitPage.route(`${origin}${PREFIX}**`, async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.slice(PREFIX.length));
    if (rel === 'example.html') {
      const html = `<!doctype html><html lang="en-ZA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${FONTS}"><link rel="stylesheet" href="ds/index.css"><style>${frozen ? STILL : ''}body{margin:0}</style></head><body><div style="width:${hostWidth}px">${kitMarkup(ex)}</div><script>${dsFile('scripts/preview/site-header.js')}</script></body></html>`;
      return route.fulfill({ status: 200, contentType: 'text/html', body: html });
    }
    const file = normalize(join(DS, rel.replace(/^ds\//, '')));
    if (!rel.startsWith('ds/') || !file.startsWith(DS + sep) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  return `${origin}${PREFIX}example.html`;
}

export type ExampleResult = { name: string; pass: boolean; unmatched: string[]; moved: string[]; pixelRatio: number; kitElements: number };

/**
 * Compares one example. `page` is already on /dev/site at the right width and settled; `mutate` plants a fault on
 * the Angular side before the comparison (the planted-fault checks).
 */
export async function compareExample(page: Page, kitPage: Page, ex: KitExample, mutate?: (page: Page, scope: string) => Promise<void>): Promise<ExampleResult> {
  const app = `section[data-example][id="${exampleId(ex.part, ex.name)}"] [data-example-body]`;
  const kit = `section[data-example="${ex.name.replace(/"/g, '\\"')}"]`;
  const origin = new URL(page.url()).origin;
  await kitPage.setViewportSize(page.viewportSize()!);
  // The kit example is laid out as wide as the gallery gives its example (the gallery has side padding).
  const hostWidth = await page.locator(app).evaluate((el) => el.getBoundingClientRect().width);
  await serveKit(kitPage, origin, ex, hostWidth);
  await kitPage.goto(`${origin}${PREFIX}example.html`);
  await kitPage.waitForLoadState('networkidle');
  await settle(kitPage);
  await page.locator(app).scrollIntoViewIfNeeded();
  if (mutate) await mutate(page, app);
  await settle(page);

  const k = await kitPage.evaluate(measure, kit);
  const a = await page.evaluate(measure, app);
  if (!k) throw new Error(`site-02 parity: the kit example "${ex.name}" has no element`);
  if (!a) return { name: ex.name, pass: false, unmatched: ['the gallery example has no element'], moved: [], pixelRatio: 1, kitElements: k.items.length };

  const unmatched: string[] = [];
  const moved: string[] = [];
  const pool = [...a.items];
  for (const it of k.items) {
    const at = pool.findIndex((p) => p.sig === it.sig);
    if (at < 0) { unmatched.push(it.sig); continue; }
    const p = pool.splice(0, at + 1)[at]!;
    const off = (['x', 'y', 'width', 'height'] as const).filter((key) => Math.abs(p.box[key] - it.box[key]) > 1);
    if (off.length) moved.push(`${it.sig}: ${off.map((key) => `${key} kit ${it.box[key].toFixed(1)} page ${p.box[key].toFixed(1)}`).join(', ')}`);
  }

  // Pixels: the root element's box, as the same clip of the whole page on both pages.
  const clip = (b: Box) => ({ x: Math.max(0, Math.floor(b.x)), y: Math.max(0, Math.floor(b.y)), width: Math.ceil(b.width), height: Math.ceil(b.height) });
  // The gallery puts an example at a fractional position; the kit page at a whole one. A margin (a test-side style, applied
  // after the boxes above were measured) moves the gallery's example onto a whole pixel so the text rasterises alike.
  await page.locator(app).evaluate((el, [dx, dy]) => { const h = el as HTMLElement; h.style.paddingTop = `${dy}px`; h.style.paddingLeft = `${dx}px`; }, [Math.ceil(a.box.x) - a.box.x, Math.ceil(a.box.y) - a.box.y] as const);
  await kitPage.evaluate(([dx, dy]) => { const w = document.body.firstElementChild as HTMLElement; w.style.paddingTop = `${dy}px`; w.style.paddingLeft = `${dx}px`; w.style.boxSizing = 'content-box'; }, [Math.ceil(k.box.x) - k.box.x, Math.ceil(k.box.y) - k.box.y] as const);
  const k2 = await kitPage.evaluate(measure, kit);
  k.box = k2?.box ?? k.box;
  const a2 = await page.evaluate(measure, app);
  a.box = a2?.box ?? a.box;
  const clipK = clip(k.box);
  const clipA = { ...clip(a.box), width: clipK.width, height: clipK.height };
  let pixelRatio = 1;
  if (clipK.width > 0 && clipK.height > 0) {
    const shotK = await kitPage.screenshot({ clip: clipK, fullPage: true, animations: 'disabled' });
    const shotA = await page.screenshot({ clip: clipA, fullPage: true, animations: 'disabled' });
    pixelRatio = await diff(kitPage, shotK, shotA);
  }
  return { name: ex.name, pass: !unmatched.length && !moved.length && pixelRatio <= 0.01, unmatched, moved, pixelRatio, kitElements: k.items.length };
}
