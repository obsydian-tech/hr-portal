import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';

/**
 * SITE-02 · what the locked tests share: the design system kit examples (fetched at the ref in sync.json), the
 * gallery contract, and the small helpers every criterion uses. Notes: ../../cards/site-02.md.
 * Nothing here calls an AI service.
 */

export const PEPLA_WEB = join(__dirname, '..', '..', '..', '..');
const DS = join(PEPLA_WEB, 'src', 'styles', 'design-system');

/** The 13 shared parts and the kit file of each (project/components/site/<file>.examples.html). */
export const PARTS = ['button', 'motion', 'lights', 'shine', 'gradient', 'header', 'menu', 'sheet', 'footer', 'hero', 'section', 'caps', 'band'] as const;
export type Part = (typeof PARTS)[number];

/** The extra, last example the gallery adds (not a kit example). */
export const ARRIVAL = 'Arrival on scroll';
export const ARRIVAL_ID = 'arrival-live';

export const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const exampleId = (part: Part, name: string): string => `${part}-${slug(name)}`;

export type KitExample = { part: Part; name: string; id: string; html: string };

function curl(url: string): string {
  return execFileSync('curl', ['-fsSL', '--retry', '3', url], { maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
}

export function syncJson(): { repo: string; ref: string } {
  return JSON.parse(readFileSync(join(DS, 'sync.json'), 'utf8'));
}

/** A file of the design system repo at the ref the app is synced to, cached in the OS temp folder. */
export function dsFile(path: string): string {
  const { repo, ref } = syncJson();
  const dir = join(tmpdir(), 'site-02-kit', ref);
  const file = join(dir, path.replace(/\//g, '__'));
  if (existsSync(file)) return readFileSync(file, 'utf8');
  const text = curl(`https://raw.githubusercontent.com/${repo}/${ref}/${path}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, text);
  return text;
}

/** Every `<section data-example>` of the 13 kit example files, in file order. */
export function kitExamples(): KitExample[] {
  const out: KitExample[] = [];
  for (const part of PARTS) {
    const text = dsFile(`project/components/site/site-${part}.examples.html`);
    for (const m of text.matchAll(/<section data-example="([^"]+)">([\s\S]*?)\n<\/section>/g)) {
      out.push({ part, name: m[1]!.replace(/&amp;/g, '&'), id: exampleId(part, m[1]!), html: m[0] });
    }
  }
  return out;
}

/** The page-side function that lists the words of an element: every text node and every accessible name. */
export function wordsOf(root: Element): { texts: string[]; names: string[] } {
  const clean = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();
  const texts = new Set<string>();
  const names = new Set<string>();
  const walk = (el: Element) => {
    if (['SCRIPT', 'STYLE', 'TEMPLATE'].includes(el.tagName)) return;
    for (const a of ['aria-label', 'alt', 'title', 'placeholder', 'data-text']) {
      const v = clean(el.getAttribute(a));
      if (v) names.add(v);
    }
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const v = clean(by.split(/\s+/).map((id) => root.ownerDocument.getElementById(id)?.textContent ?? '').join(' '));
      if (v) names.add(v);
    }
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) {
        const v = clean(n.textContent);
        if (v) texts.add(v);
      } else if (n.nodeType === 1) walk(n as Element);
    }
  };
  walk(root);
  return { texts: [...texts], names: [...names] };
}

export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1280) < 600;

/**
 * Opens /dev/site. With `only` (section ids), every other example is taken out of the page after it has loaded: the
 * 1280-wide desktop frames would otherwise make a phone window zoom out (innerWidth 1288), which is not what 390 means.
 */
export async function gotoGallery(page: Page, only?: string[]): Promise<void> {
  const res = await page.goto('/dev/site');
  if (!res || res.status() >= 400) throw new Error(`/dev/site answered ${res?.status()}`);
  await page.locator('section[data-example]').first().waitFor({ state: 'attached', timeout: 20_000 });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.waitForLoadState('networkidle');
  if (only) {
    await page.evaluate((keep) => document.querySelectorAll('section[data-example]').forEach((s) => { if (!keep.includes(s.id)) s.remove(); }), only);
    // A phone window that has seen the wide frames stays zoomed out until it is resized: nudge it so 390 means 390 again.
    const v = page.viewportSize();
    if (v && v.width < 600) {
      await page.setViewportSize({ width: v.width + 1, height: v.height });
      await page.setViewportSize(v);
    }
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  }
}

export const section = (page: Page, part: Part, name: string): Locator => page.locator(`section[data-example][id="${exampleId(part, name)}"]`);
export const body = (page: Page, part: Part, name: string): Locator => section(page, part, name).locator('[data-example-body]');

/** Scrolls the thing that scrolls for this example: the frame's own page when there is a frame, else the window. */
export async function scrollExample(frame: Locator, to: number): Promise<void> {
  await frame.evaluate((el, y) => {
    const page = el.classList.contains('pp-site-frame') ? el.querySelector('.pp-site-frame__page')! : null;
    if (page) page.scrollTop = y; else window.scrollTo(0, y);
  }, to);
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A short pause that lets a script and a frame of rendering catch up. */
export async function frames(page: Page, n = 3): Promise<void> {
  await page.evaluate(async (k) => { for (let i = 0; i < k; i++) await new Promise((r) => requestAnimationFrame(r)); }, n);
}
