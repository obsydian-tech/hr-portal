import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { Page } from '@playwright/test';
import { icons as LUCIDE } from 'lucide';

/**
 * Kit parity harness (SITE-01, NH-203): compares an Angular page with a design system kit screen.
 * The kit file comes from `npm run parity:kit` (e2e/parity/.kit/<ref>/), the ref in sync.json.
 * The kit fragment is wrapped in the app's own synced stylesheet and served under the app's origin at
 * /__kit-parity__/, so it calls nothing but the app and Google Fonts. No AI service.
 */

const PEPLA_WEB = join(__dirname, '..', '..');
const DS = join(PEPLA_WEB, 'src', 'styles', 'design-system');
const KIT_DIR = join(PEPLA_WEB, 'e2e', 'parity', '.kit');
const PREFIX = '/__kit-parity__/';
const FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@700;800&display=swap';
const STILL = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';
/** The kit's preview frame shows the screen at window width: no scale, clip, radius or fixed height. */
const FRAME = 'body{margin:0}.pp-site-frame,.pp-site-frame--desktop,.pp-site-frame--phone{transform:none!important;width:auto!important;max-width:none!important;height:auto!important;margin:0!important;border-radius:0!important;overflow:visible!important;contain:none!important}.pp-site-frame__page{height:auto!important;overflow:visible!important}';
const HEIGHT = 900;

export type KitOnly = { role: 'link' | 'button' | 'heading' | 'navigation' | 'banner' | 'img'; name: string };
export type KitParityOptions = { page: Page; kitFile: string; screen: string; path: string; width: number; only?: KitOnly[] };
export type KitParityResult = {
  pass: boolean; kitRef: string; kitPath: string; width: number; kitElements: number;
  unmatched: string[]; moved: string[]; pixelRatio: number;
};

type Box = { x: number; y: number; width: number; height: number };
type Item = { sig: string; box: Box; root: boolean };
type Measured = { items: Item[][]; boxes: Box[]; missing: number[] };

const pascal = (n: string) => n.split('-').map((w) => w[0]!.toUpperCase() + w.slice(1)).join('');
function lucide(name: string, attrs: string): string {
  const node = (LUCIDE as Record<string, Array<[string, Record<string, string>]>>)[pascal(name)];
  if (!node) throw new Error(`kit-parity: unknown Lucide icon "${name}" in the kit`);
  const inner = node.map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  const cls = attrs.match(/class="([^"]*)"/)?.[1];
  const rest = attrs.replace(/class="[^"]*"/, '').trim();
  return `<svg class="lucide${cls ? ` ${cls}` : ''}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${rest ? ` ${rest}` : ''}>${inner}</svg>`;
}
const MARK = '<svg class="pp-logo__mark" viewBox="0 0 76 64" aria-hidden="true" focusable="false"><circle class="pp-logo__coral" cx="20" cy="38" r="18"></circle><circle class="pp-logo__violet" cx="38" cy="24" r="18"></circle><circle class="pp-logo__mint" cx="56" cy="38" r="18"></circle></svg>';

/** The screen's fragment from the kit file, with the mark and the icons drawn as the design system build draws them. */
function fragment(kitHtml: string, screen: string): string {
  const open = kitHtml.indexOf(`<section data-screen="${screen}"`);
  if (open < 0) throw new Error(`kit-parity: no screen "${screen}" in the kit file`);
  const close = kitHtml.indexOf('</section>', open);
  return kitHtml
    .slice(open, close + '</section>'.length)
    .replace(/<i data-pepla-mark><\/i>/g, MARK)
    .replace(/<i ([^>]*?)data-lucide="([a-z0-9-]+)"([^>]*)><\/i>/g, (_m, a: string, n: string, b: string) => lucide(n, `${a} ${b}`.trim()));
}

const TYPES: Record<string, string> = { '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

/** In the page: the elements to compare (each `only` target, or the screen's outer element) and what is inside. */
function measure(args: { only: KitOnly[] | null; scope: string | null }): Measured {
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    return (el as HTMLElement).checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) !== false && r.width > 0 && r.height > 0;
  };
  const nameOf = (el: Element): string => {
    const label = el.getAttribute('aria-label');
    if (label) return label.trim();
    const by = el.getAttribute('aria-labelledby');
    if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
    if (el.tagName === 'IMG') return (el.getAttribute('alt') ?? '').trim();
    return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  };
  const ROLE: Record<string, string> = {
    link: 'a[href],[role="link"]', button: 'button,[role="button"]', heading: 'h1,h2,h3,h4,h5,h6,[role="heading"]',
    navigation: 'nav,[role="navigation"]', banner: 'header,[role="banner"]', img: 'img,svg[role="img"],[role="img"]',
  };
  const base: ParentNode = args.scope ? document.querySelector(args.scope)! : document;
  const roots: Array<Element | null> = args.only
    ? args.only.map((o) => Array.from(base.querySelectorAll(ROLE[o.role]!)).find((el) => visible(el) && nameOf(el) === o.name) ?? null)
    : [base instanceof Document ? null : (base as Element).firstElementChild];
  const ownText = (el: Element) => Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim();
  const sig = (el: Element) => {
    const cls = Array.from(el.classList).filter((c) => c.startsWith('pp-')).sort().join('.');
    const t = ownText(el);
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}${t ? ` "${t}"` : ''}`;
  };
  const boxOf = (el: Element) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + window.scrollY, width: r.width, height: r.height }; };
  const items: Item[][] = [];
  const boxes: Box[] = [];
  const missing: number[] = [];
  roots.forEach((root, i) => {
    if (!root) { missing.push(i); items.push([]); boxes.push({ x: 0, y: 0, width: 0, height: 0 }); return; }
    const list: Item[] = [];
    const walk = (el: Element, isRoot: boolean) => {
      if (!isRoot && getComputedStyle(el).display === 'none') return;
      list.push({ sig: sig(el), box: boxOf(el), root: isRoot });
      for (const c of Array.from(el.children)) walk(c, false);
    };
    walk(root, true);
    items.push(list);
    boxes.push(boxOf(root));
  });
  return { items, boxes, missing };
}

async function settle(p: Page): Promise<void> {
  await p.evaluate(async () => {
    document.documentElement.setAttribute('data-site-still', '');
    await document.fonts.ready;
    window.scrollTo(0, 0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

/** Share of pixels that differ by more than 24 in any channel, computed in a browser canvas. */
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

export async function compareToKit(options: KitParityOptions): Promise<KitParityResult> {
  const { page, kitFile, screen, path, width } = options;
  const only = options.only?.length ? options.only : null;
  const sync = JSON.parse(readFileSync(join(DS, 'sync.json'), 'utf8')) as { ref: string };
  const kitPath = join(KIT_DIR, sync.ref, kitFile);
  if (!existsSync(kitPath)) throw new Error(`kit-parity: ${kitPath} is missing; run npm run parity:kit`);
  const body = fragment(readFileSync(kitPath, 'utf8'), screen);

  // The Angular page, in the page the caller gave.
  await page.setViewportSize({ width, height: HEIGHT });
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.addStyleTag({ content: STILL });
  await settle(page);

  // The kit screen, in another page of the same context, under the app's origin but never at `path`.
  const origin = new URL(page.url()).origin;
  const kitPage = await page.context().newPage();
  try {
    await kitPage.setViewportSize({ width, height: HEIGHT });
    const kitUrl = `${origin}${PREFIX}screen.html`;
    await kitPage.route(`${origin}${PREFIX}**`, async (route) => {
      const rel = decodeURIComponent(new URL(route.request().url()).pathname.slice(PREFIX.length));
      if (rel === 'screen.html') {
        const html = `<!doctype html><html lang="en-ZA" data-site-still><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${FONTS}"><link rel="stylesheet" href="ds/index.css"><style>${STILL}${FRAME}</style></head><body>${body}</body></html>`;
        return route.fulfill({ status: 200, contentType: 'text/html', body: html });
      }
      const file = normalize(join(DS, rel.replace(/^ds\//, '')));
      if (!rel.startsWith('ds/') || !file.startsWith(DS + sep) || !existsSync(file)) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
    });
    await kitPage.goto(kitUrl);
    await kitPage.waitForLoadState('networkidle');
    await settle(kitPage);

    const kit = await kitPage.evaluate(measure, { only, scope: `section[data-screen="${screen.replace(/"/g, '\\"')}"]` });
    if (kit.missing.length) throw new Error(`kit-parity: ${kit.missing.map((i) => `${only![i]!.role} "${only![i]!.name}"`).join(', ')} not on the kit screen "${screen}"`);
    const app = await page.evaluate(measure, { only, scope: only ? null : 'body' });

    const unmatched: string[] = [];
    const moved: string[] = [];
    let kitElements = 0;
    kit.items.forEach((list, i) => {
      kitElements += list.length;
      const label = only ? `${only[i]!.role} "${only[i]!.name}"` : screen;
      if (app.missing.includes(i)) { unmatched.push(`${label}: not on the page`); return; }
      const pool = [...(app.items[i] ?? [])];
      for (const k of list) {
        const at = pool.findIndex((p) => p.sig === k.sig);
        if (at < 0) { unmatched.push(`${label} > ${k.sig}`); continue; }
        const p = pool.splice(0, at + 1)[at]!;
        const keys: Array<keyof Box> = k.root && !only ? ['x', 'y', 'width'] : ['x', 'y', 'width', 'height'];
        const off = keys.filter((key) => Math.abs(p.box[key] - k.box[key]) > 1);
        if (off.length) moved.push(`${label} > ${k.sig}: ${off.map((key) => `${key} kit ${k.box[key].toFixed(1)} page ${p.box[key].toFixed(1)}`).join(', ')}`);
      }
    });

    // Pixels: inside each compared kit box (or the whole window without `only`), the same clip on both.
    const clips = only ? kit.boxes : [{ x: 0, y: 0, width, height: HEIGHT }];
    let bad = 0, total = 0;
    for (const c of clips) {
      const clip = { x: Math.max(0, Math.floor(c.x)), y: Math.max(0, Math.floor(c.y)), width: Math.ceil(c.width), height: Math.ceil(c.height) };
      if (clip.width <= 0 || clip.height <= 0) continue;
      const [a, b] = await Promise.all([kitPage.screenshot({ clip, animations: 'disabled' }), page.screenshot({ clip, animations: 'disabled' })]);
      const r = await diff(kitPage, a, b);
      bad += r * clip.width * clip.height;
      total += clip.width * clip.height;
    }
    const pixelRatio = total ? bad / total : 1;
    return { pass: !unmatched.length && !moved.length && pixelRatio <= 0.01, kitRef: sync.ref, kitPath, width, kitElements, unmatched, moved, pixelRatio };
  } finally {
    await kitPage.close();
  }
}
