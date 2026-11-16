import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { PEPLA_WEB } from './public-site';

/**
 * SITE-01 AC-6 · The contract between this locked test and the kit parity harness the builder writes.
 * The harness lives outside the locked folder, in `e2e/parity/`, so SITE-03 to SITE-05 can import it.
 * This file fixes only how the test calls it and what it must answer. cards/site-01.md says the same in words.
 *
 * Module: pepla-web/e2e/parity/kit-parity.ts
 * Export: compareToKit(options: KitParityOptions): Promise<KitParityResult>
 */

export const HARNESS_MODULE = 'e2e/parity/kit-parity.ts';
/** The folder `npm run parity:kit` fetches the design system kit files into. Git ignores it. */
export const KIT_DIR = join(PEPLA_WEB, 'e2e', 'parity', '.kit');

export type KitParityOptions = {
  /**
   * A Playwright page. The harness opens the Angular page in this page or in another page of
   * `page.context()` (never a new browser or context), so scripts the test adds to the context reach it.
   * It may open the kit screen anywhere in that context, but never at `path`.
   */
  page: Page;
  /** A kit file name as in the design system's project/ui_kits/, e.g. "sign-in-and-invite.html". */
  kitFile: string;
  /** The kit screen's data-screen name, e.g. "Sign in (desktop)". */
  screen: string;
  /** The Angular page's path on the app the test runs against, e.g. "/sign-in". */
  path: string;
  /** Window width for both: 1440 for desktop screens, 390 for phone screens. */
  width: number;
  /**
   * Optional. Compare only these elements, each found by role and exact accessible name among the visible
   * elements, on the kit screen and on the page. Each one and everything inside it is matched and measured as
   * below, and pixels are counted only inside those elements' kit boxes. One that is missing on the page is
   * listed in `unmatched`; one missing on the kit screen is an error. Without `only`, the whole screen.
   */
  only?: KitOnly[];
};

/** An element to compare, by role and exact accessible name, e.g. { role: 'link', name: 'Naleko People home' }. */
export type KitOnly = { role: 'link' | 'button' | 'heading' | 'navigation' | 'banner' | 'img'; name: string };

export type KitParityResult = {
  /** True only when `unmatched` and `moved` are empty and `pixelRatio` is at most 0.01. */
  pass: boolean;
  /** The design system ref the kit file came from: `ref` in src/styles/design-system/sync.json. */
  kitRef: string;
  /** Absolute path of the kit file the harness read, inside e2e/parity/.kit/. */
  kitPath: string;
  /** The window width both were opened at. */
  width: number;
  /** How many kit elements were compared. */
  kitElements: number;
  /** Kit elements with no page element of the same tag, pp- classes and own text, one line each. */
  unmatched: string[];
  /** Matched elements whose box (x, y, width or height) differs by more than 1px, one line each. */
  moved: string[];
  /** Share of pixels that differ between the two screenshots, 0 to 1. */
  pixelRatio: number;
};

export type CompareToKit = (options: KitParityOptions) => Promise<KitParityResult>;

/** Loads the builder's harness. Fails with a plain message while it does not exist. */
export async function loadCompareToKit(): Promise<CompareToKit> {
  const file = join(PEPLA_WEB, HARNESS_MODULE);
  if (!existsSync(file)) throw new Error(`SITE-01 AC-6: ${HARNESS_MODULE} does not exist yet (the builder writes it; see cards/site-01.md).`);
  const mod = (await import(file)) as { compareToKit?: unknown; default?: { compareToKit?: unknown } };
  const fn = mod.compareToKit ?? mod.default?.compareToKit;
  if (typeof fn !== 'function') throw new Error(`SITE-01 AC-6: ${HARNESS_MODULE} must export a function compareToKit(options).`);
  return fn as CompareToKit;
}

/**
 * Planted faults, added to the browser context before the harness runs. They act only on the Angular page
 * at `path`, never on the kit screen, so the harness cannot tell a planted run from a clean one.
 */
const FIND_LINK = `(name) => Array.from(document.querySelectorAll('a')).find((a) => (a.getAttribute('aria-label') || a.textContent || '').replace(/\\s+/g, ' ').trim() === name)`;

/** Moves the link named `name` down by `px` (CSS translate, so its box moves exactly that far). */
export function plantShift(path: string, name: string, px: number): string {
  return `(() => {
    if (location.pathname !== ${JSON.stringify(path)}) return;
    const find = ${FIND_LINK};
    const apply = () => {
      const a = find(${JSON.stringify(name)});
      if (a && a.style.getPropertyValue('translate') !== '0px ${px}px') a.style.setProperty('translate', '0px ${px}px', 'important');
    };
    new MutationObserver(apply).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'aria-label'] });
  })();`;
}

/** Renames the link named `from` to `to` (its aria-label, or its words when it has none). */
export function plantLinkName(path: string, from: string, to: string): string {
  return `(() => {
    if (location.pathname !== ${JSON.stringify(path)}) return;
    const find = ${FIND_LINK};
    const apply = () => {
      const a = find(${JSON.stringify(from)});
      if (!a) return;
      if (a.hasAttribute('aria-label')) a.setAttribute('aria-label', ${JSON.stringify(to)});
      else a.textContent = ${JSON.stringify(to)};
    };
    new MutationObserver(apply).observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label'] });
  })();`;
}
