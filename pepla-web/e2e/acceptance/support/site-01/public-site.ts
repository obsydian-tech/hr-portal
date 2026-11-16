import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Locator, Page } from '@playwright/test';

/**
 * SITE-01 · helpers for the public pages (Jira NH-203). Read-only: nothing here changes the app.
 */

/** The pepla-web folder. */
export const PEPLA_WEB = join(__dirname, '..', '..', '..', '..');

/** The not-found addresses the card names (AC-7, AC-8, AC-9, AC-10). */
export const NOT_FOUND_PATHS = ['/nothing-here', '/hr-not'] as const;

/** The words the card allows on the public pages (AC-9). "Naleko People home" is the brand link's name. */
export const ALLOWED_WORDS = ['Log in', 'Naleko People'] as const;

/**
 * Page chrome the design system defines (AC-9): the logo lockup and the header's skip link. Their words are
 * fixed by the design system (kit `site-header.html`), so they are allowed only inside those parts.
 */
export const CHROME: ReadonlyArray<{ selector: string; words: readonly string[] }> = [
  { selector: '.pp-logo', words: ['Naleko', 'People', 'Naleko People', 'by Naleko', 'Naleko People by Naleko'] },
  { selector: '.pp-site-header__skip', words: ['Skip to content'] },
];

/** The signed-in features' markers (AC-1): no script that `/` loads may hold any of them. */
export const SIGNED_IN_MARKERS = ['Register a new employee', 'Documents to check', 'Set your password', 'Privacy notice', 'CognitoUserPool'] as const;

/** The visible "Log in" link. A later header may keep a second, hidden copy (a phone menu); the visible one counts. */
export function logIn(page: Page): Locator {
  return page.getByRole('link', { name: 'Log in', exact: true }).filter({ visible: true }).first();
}

/** The address's path and query, as typed or as it ended. */
export function pathOf(page: Page): string {
  const u = new URL(page.url());
  return `${u.pathname}${u.search}`;
}

/** Hosts of the employees and document APIs, read from the app's environment files, plus the API paths. */
export function apiPatterns(): RegExp[] {
  const dir = join(PEPLA_WEB, 'src', 'environments');
  const hosts = new Set<string>();
  for (const f of readdirSync(dir)) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(/(?:employeesApiUrl|documentUploadApiUrl)\s*:\s*['"`](https?:\/\/[^'"`/]+)/g)) hosts.add(new URL(m[1]).host);
  }
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    ...[...hosts].map((h) => new RegExp(`^https?://${esc(h)}(/|$)`)),
    /^https?:\/\/[^/]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com\//,
    /\/v1\/(employees|me|documents)(\/|\?|$)/,
    /\/verifications(\/|\?|$)/,
  ];
}

/** Any Cognito host: user pools, identity pools and the hosted sign-in domain. */
export const COGNITO = /^https?:\/\/(cognito-idp\.|cognito-identity\.|[^/]+\.auth\.[a-z0-9-]+\.amazoncognito\.com)/;

/**
 * Visible text on the page, one entry per text node, with whether it sits inside design system chrome.
 * Hidden means: not rendered, opacity 0 or visibility hidden (checkVisibility), or inside a visually hidden
 * box (1px or less with overflow hidden, a zero clip, or clip-path inset(50%)).
 */
export async function visibleTexts(page: Page): Promise<Array<{ text: string; chrome: string | null }>> {
  return page.evaluate((chrome) => {
    const hiddenBox = (el: Element): boolean => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const r = n.getBoundingClientRect();
        if (r.width <= 1 && r.height <= 1 && cs.overflow !== 'visible') return true;
        if (/rect\(0(px)?,?\s*0(px)?,?\s*0(px)?,?\s*0(px)?\)/.test(cs.clip)) return true;
        if (/inset\(50%\)/.test(cs.clipPath)) return true;
      }
      return false;
    };
    const out: Array<{ text: string; chrome: string | null }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const text = (t.textContent ?? '').replace(/\s+/g, ' ').trim();
      const el = t.parentElement;
      if (!text || !el || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(el.tagName)) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      if (hiddenBox(el)) continue;
      const part = chrome.find((c) => el.closest(c.selector));
      out.push({ text, chrome: part ? part.selector : null });
    }
    return out;
  }, CHROME.map((c) => ({ selector: c.selector })));
}

/** Whether an element is visually hidden (still read by screen readers): a 1px box or clipped away. */
export async function isVisuallyHidden(el: Locator): Promise<boolean> {
  return el.evaluate((node) => {
    for (let n: Element | null = node; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      if (r.width <= 1 && r.height <= 1 && cs.overflow !== 'visible') return true;
      if (/rect\(0(px)?,?\s*0(px)?,?\s*0(px)?,?\s*0(px)?\)/.test(cs.clip)) return true;
      if (/inset\(50%\)/.test(cs.clipPath)) return true;
    }
    return false;
  });
}

/** Runs a command in pepla-web without a shell. Output is stdout and stderr together. */
export function run(cmd: string, args: string[], opts: { timeout?: number; cwd?: string } = {}): { code: number; out: string } {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? PEPLA_WEB,
    encoding: 'utf8',
    timeout: opts.timeout ?? 120_000,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NG_CLI_ANALYTICS: 'false' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Every file and folder under `dir`, relative, with / separators. */
export function walk(dir: string): Array<{ rel: string; dir: boolean }> {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const rel = relative(dir, path).split(sep).join('/');
    if (!statSync(path).isDirectory()) return [{ rel, dir: false }];
    return [{ rel, dir: true }, ...walk(path).map((e) => ({ rel: `${rel}/${e.rel}`, dir: e.dir }))];
  });
}
