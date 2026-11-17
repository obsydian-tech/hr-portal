import { createHash } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';

/**
 * What a person sees around the page, read the same way before and after MOD-02: the sidebar (every item's
 * words, link and icon), the top bar (every button and link and the account name) and where they sit.
 * baseline.json holds this as develop (06201c3) draws it; AC-5 and AC-9 compare against it.
 */

export type NavItemSnapshot = { label: string; href: string; icon: string; count: string | null; current: string | null };
export type ShellSnapshot = {
  path: string;
  title: string;
  h1: string;
  product: { wordmark: string; area: string };
  headings: string[];
  items: NavItemSnapshot[];
  topBar: { buttons: Array<{ label: string; icon: string }>; links: Array<{ label: string; href: string }>; search: string | null; account: string | null };
};
export type Box = { x: number; y: number; width: number; height: number };
export type Geometry = { topBar: Box; items: Box[] };

const sha = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 10);

/** The phone drawer is shut until the menu button opens it; nothing to do at desktop width. */
export async function openNav(page: Page): Promise<void> {
  await page.locator('pp-top-navigation').waitFor({ state: 'visible' });
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) {
    await menu.click();
    await page.locator('pp-side-navigation').getByRole('link').first().waitFor({ state: 'visible' });
  }
}

export async function closeNav(page: Page): Promise<void> {
  const nav = page.locator('pp-side-navigation');
  if ((await nav.getAttribute('data-open')) === 'true') {
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('pp-side-navigation')?.getAttribute('data-open') !== 'true');
  }
}

export const navItems = (page: Page): Locator => page.locator('pp-side-navigation a.pp-side-navigation__item');

/** The words on every sidebar item, in the order they are drawn (hidden ones too: a closed drawer still holds them). */
export async function navLabels(page: Page): Promise<string[]> {
  return navItems(page).evaluateAll((as) => as.map((a) => (a.querySelector('.pp-side-navigation__label')?.textContent ?? '').replace(/\s+/g, ' ').trim()));
}

export async function navHeadings(page: Page): Promise<string[]> {
  return page.locator('pp-side-navigation .pp-side-navigation__heading').evaluateAll((hs) => hs.map((h) => (h.textContent ?? '').replace(/\s+/g, ' ').trim()));
}

export async function snapshot(page: Page): Promise<ShellSnapshot> {
  const url = new URL(page.url());
  const body = await page.evaluate(() => {
    const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    const svgOf = (el: Element | null) => (el?.querySelector('svg') ? el.querySelector('svg')!.innerHTML : '');
    const nav = document.querySelector('pp-side-navigation');
    const top = document.querySelector('pp-top-navigation');
    return {
      title: document.title,
      h1: clean(document.querySelector('main h1')?.textContent),
      wordmark: clean(nav?.querySelector('.pp-side-navigation__wordmark')?.textContent),
      area: clean(nav?.querySelector('.pp-side-navigation__product-area')?.textContent),
      headings: [...(nav?.querySelectorAll('.pp-side-navigation__heading') ?? [])].map((h) => clean(h.textContent)),
      items: [...(nav?.querySelectorAll('a.pp-side-navigation__item') ?? [])].map((a) => ({
        label: clean(a.querySelector('.pp-side-navigation__label')?.textContent),
        href: a.getAttribute('href') ?? '',
        svg: svgOf(a),
        count: a.querySelector('.pp-side-navigation__count') ? clean(a.querySelector('.pp-side-navigation__count')!.textContent) : null,
        current: a.getAttribute('aria-current'),
      })),
      buttons: [...(top?.querySelectorAll('button') ?? [])].map((b) => ({ label: b.getAttribute('aria-label') ?? clean(b.textContent), svg: svgOf(b), avatar: b.classList.contains('pp-top-navigation__avatar') })),
      links: [...(top?.querySelectorAll('a') ?? [])].map((a) => ({ label: a.getAttribute('aria-label') ?? clean(a.textContent), href: a.getAttribute('href') ?? '' })),
      search: top?.querySelector('input[type="search"]')?.getAttribute('placeholder') ?? null,
    };
  });
  return {
    path: url.pathname + url.search,
    title: body.title,
    h1: body.h1,
    product: { wordmark: body.wordmark, area: body.area },
    headings: body.headings,
    items: body.items.map((i) => ({ label: i.label, href: i.href, icon: i.svg ? sha(i.svg) : '', count: i.count, current: i.current })),
    topBar: {
      buttons: body.buttons.map((b) => ({ label: b.label, icon: b.svg ? sha(b.svg) : '' })),
      links: body.links,
      search: body.search,
      account: body.buttons.find((b) => b.avatar)?.label ?? null,
    },
  };
}

/** Where the top bar and every sidebar item sit (the drawer open on a phone). Rounded to whole pixels. */
export async function geometry(page: Page): Promise<Geometry> {
  await openNav(page);
  const read = () =>
    page.evaluate(() => {
      const box = (el: Element): { x: number; y: number; width: number; height: number } => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      };
      return {
        topBar: box(document.querySelector('pp-top-navigation')!),
        items: [...document.querySelectorAll('pp-side-navigation a.pp-side-navigation__item')].map(box),
      };
    });
  // The drawer slides in: wait until two reads 150 ms apart agree.
  let last = JSON.stringify(await read());
  for (let n = 0; n < 20; n++) {
    await page.waitForTimeout(150);
    const now = JSON.stringify(await read());
    if (now === last) break;
    last = now;
  }
  const g = JSON.parse(last) as Geometry;
  await closeNav(page);
  return g;
}
