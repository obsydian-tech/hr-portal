import { expect, type Locator, type Page } from '@playwright/test';
import type { RevealFake } from './reveal-fake';

/**
 * ONB-14: what the two pages show around Show, and how the screen tests look at it. The words are the design system's
 * masked-field words (project/components/records/masked-field.md) and the card's own line.
 */

export const WORDS = {
  line: 'Showing this is recorded',
  failed: 'Batsi could not record the reveal, so the number stays hidden.',
  tryAgain: 'Try again',
  show: 'Show',
  hide: 'Hide',
};
/** "Shown to you, 11 Nov 2026, 14:30. Hides again in 2 minutes." */
export const SHOWN = /Shown to you, \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}\. Hides again in 2 minutes\./;
export const OLD_WORDS = [/Revealing is recorded/i, /\bMasked\b/, /Work email/i];

export const main = (page: Page) => page.locator('main');
export const showButton = (page: Page) => main(page).getByRole('button', { name: /^Show\b/ });
export const hideButton = (page: Page) => main(page).getByRole('button', { name: /^Hide\b/ });
export const tryAgainButton = (page: Page) => main(page).getByRole('button', { name: /^Try again\b/ });
export const failureLine = (page: Page) => page.getByRole('alert').filter({ hasText: WORDS.failed });
export const heading1 = (page: Page) => page.getByRole('heading', { level: 1 });

export const spaced = (full: string) => new RegExp(full.split('').join('\\s?'));
export const holds = (text: string, full: string) => text.includes(full) || text.replace(/\D/g, '').includes(full);

export async function bodyText(page: Page): Promise<string> {
  return page.locator('body').innerText();
}

/** The full number is nowhere on the page: text, accessibility tree, markup. The last four digits still show. */
export async function expectHidden(page: Page, full: string, what: string, opts: { lastFour?: boolean } = {}): Promise<void> {
  await expect(hideButton(page), `${what}: nothing is shown any more`).toHaveCount(0);
  const text = await bodyText(page);
  expect(holds(text, full), `${what}: the full number is not in the page text`).toBe(false);
  expect(text, `${what}: the first digits are not in the page text`).not.toContain(full.slice(0, full.length - 4));
  expect(await page.locator('body').ariaSnapshot(), `${what}: the full number is not in the accessibility tree`).not.toContain(full);
  expect(await page.content(), `${what}: the full number is not in the page markup`).not.toContain(full);
  if (opts.lastFour !== false) await expect(main(page), `${what}: the last four digits show`).toContainText(full.slice(-4));
}

export async function expectShown(page: Page, full: string, what: string): Promise<void> {
  await expect(main(page).getByText(spaced(full)), `${what}: the full number shows`).toBeVisible();
  await expect(main(page), `${what}: "Shown to you, <date time>. Hides again in 2 minutes."`).toContainText(SHOWN);
  await expect(hideButton(page), `${what}: the button reads Hide`).toBeVisible();
}

export const isBusy = (button: Locator) => button.evaluate((b) => b.getAttribute('aria-busy') === 'true' || (b as HTMLButtonElement).disabled || b.getAttribute('aria-disabled') === 'true');

/** Everything a page might keep: local and session storage, every IndexedDB store, history state, address, title. */
export async function keptText(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const out: string[] = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i)!; out.push(`local ${k}=${localStorage.getItem(k)}`); } } catch { /* blocked */ }
    try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i)!; out.push(`session ${k}=${sessionStorage.getItem(k)}`); } } catch { /* blocked */ }
    try { out.push(`history ${JSON.stringify(history.state)}`, `address ${location.href}`, `title ${document.title}`); } catch { /* blocked */ }
    try {
      const dbs: Array<{ name?: string }> = (await (indexedDB as any).databases?.()) ?? [];
      for (const d of dbs) {
        await new Promise<void>((done) => {
          const open = indexedDB.open(d.name!);
          open.onerror = () => done();
          open.onsuccess = () => {
            const db = open.result;
            const names = [...db.objectStoreNames];
            if (!names.length) { db.close(); done(); return; }
            const tx = db.transaction(names, 'readonly');
            let left = names.length;
            const one = () => { if (--left === 0) { db.close(); done(); } };
            for (const n of names) {
              const get = tx.objectStore(n).getAll();
              get.onsuccess = () => { out.push(`indexeddb ${d.name}/${n}=${JSON.stringify(get.result)}`); one(); };
              get.onerror = one;
            }
          };
        });
      }
    } catch { /* blocked */ }
    return out.join('\n');
  });
}

/** Records every response body (the reveal route's apart) and every console line, from now on. */
export function watch(page: Page): { bodies: string[]; reveals: string[]; console: string[]; urls: string[] } {
  const seen = { bodies: [] as string[], reveals: [] as string[], console: [] as string[], urls: [] as string[] };
  page.on('console', (m) => seen.console.push(m.text()));
  page.on('pageerror', (e) => seen.console.push(`pageerror ${e.message}`));
  page.on('response', async (r) => {
    seen.urls.push(r.url());
    const reveal = /\/v1\/verifications\/[^/]+\/reveal$/.test(new URL(r.url()).pathname);
    try { (reveal ? seen.reveals : seen.bodies).push(await r.text()); } catch { /* no body: a redirect, an aborted call */ }
  });
  return seen;
}

/** Waits until the fake has seen `n` POSTs. */
export async function waitForPosts(reveal: RevealFake, n: number, what: string): Promise<void> {
  await expect.poll(() => reveal.posts().length, { message: `${what}: ${n} POST(s) reach the reveal route`, timeout: 10_000 }).toBeGreaterThanOrEqual(n);
}

export async function noSidewaysScroll(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page ${document.documentElement.scrollWidth} > ${window.innerWidth}`);
    for (const el of document.querySelectorAll('main *')) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(`${el.tagName.toLowerCase()}.${el.className} ${el.scrollWidth} > ${el.clientWidth}`);
    }
    return out;
  });
}

/**
 * Every heading, link and button in main that a person can see: inside the screen's width, below the top bar when the page
 * is at the top, and reached by a tap at its centre once scrolled into view (the same check as ONB-13 AC-7 and ONB-15).
 */
export async function hiddenOrCovered(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    const bar = document.querySelector('.pp-top-navigation, [role="banner"]');
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    const els = [...document.querySelectorAll('main :is(h1,h2,h3,h4,h5,h6,[role="heading"],a[href],button,[role="alert"],[role="status"])')].filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 2 && r.height > 2 && s.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null;
    });
    const name = (el: Element) => `${el.tagName.toLowerCase()} "${(el as HTMLElement).innerText.replace(/\s+/g, ' ').trim().slice(0, 40)}"`;
    window.scrollTo(0, 0);
    document.querySelector('main')?.scrollTo?.(0, 0);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.top < barBottom - 1) out.push(`${name(el)} starts under the top bar (${Math.round(r.top)} < ${Math.round(barBottom)})`);
      if (r.left < -1 || r.right > window.innerWidth + 1) out.push(`${name(el)} is outside the screen's width`);
    }
    for (const el of els) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2)), r.top + r.height / 2);
      if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) out.push(`${name(el)} is covered by ${hit ? hit.tagName.toLowerCase() + '.' + hit.className : 'nothing'}`);
    }
    window.scrollTo(0, 0);
    return out;
  });
}

/** Tab until `reached` says focus is where it should be. */
export async function tabTo(page: Page, reached: () => Promise<boolean>, what: string): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  let ok = false;
  for (let i = 0; i < 80 && !ok; i++) {
    await page.keyboard.press('Tab');
    ok = await reached();
  }
  expect(ok, `Tab reaches ${what}`).toBe(true);
}
export const focusedText = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.replace(/\s+/g, ' ').trim() ?? '');
