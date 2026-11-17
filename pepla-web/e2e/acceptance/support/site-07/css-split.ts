import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Page } from '@playwright/test';
import { PEPLA_WEB } from '../site-01/public-site';

/**
 * SITE-07 · helpers for the site style split (Jira NH-209). Read-only: nothing here changes the app, except `plant`,
 * which writes one file, runs a command and always restores the file.
 */

export { PEPLA_WEB };
export const DS = join(PEPLA_WEB, 'src', 'styles', 'design-system');
export const BROWSER_OUT = join(PEPLA_WEB, 'dist', 'pepla-web', 'browser');

export const read = (f: string): string => readFileSync(f, 'utf8');
export const dsFile = (name: string): string => read(join(DS, name));

/** The `@import` targets of a CSS file, in order. */
export const imports = (css: string): string[] => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/g)].map((m) => m[1]!.replace(/^\.\//, ''));

/** The lines of a stylesheet's block comments are not rules; this strips them before any text search. */
export const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every file under `dir`, relative, with / separators. */
export function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const f = join(dir, n);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
}
export const rel = (base: string, f: string): string => relative(base, f).split(sep).join('/');

export function run(cmd: string, args: string[], opts: { timeout?: number; cwd?: string } = {}): { code: number; out: string } {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? PEPLA_WEB,
    encoding: 'utf8',
    timeout: opts.timeout ?? 180_000,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NG_CLI_ANALYTICS: 'false' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Writes `text` to `file`, runs `fn`, and puts the file back exactly as it was (also when `fn` throws). */
export function plant<T>(file: string, text: string, fn: () => T): T {
  const original = readFileSync(file);
  try {
    writeFileSync(file, text);
    return fn();
  } finally {
    writeFileSync(file, original);
  }
}

export type Build = { out: string; initialKb: number; browserOut: string; indexHtml: string };
let built: Build | undefined;
/** One production build for every criterion that reads it (the run uses one worker, so the module is shared). */
export function productionBuild(): Build {
  if (built) return built;
  const r = run('npm', ['run', 'build'], { timeout: 15 * 60_000 });
  if (r.code !== 0) throw new Error(`npm run build failed:\n${r.out.slice(-4000)}`);
  const m = /Initial total\s*\|?\s*([\d.]+)\s*(kB|MB|bytes)/i.exec(r.out);
  if (!m) throw new Error(`the build output has no "Initial total" line:\n${r.out.slice(-3000)}`);
  const n = Number(m[1]);
  const initialKb = m[2]!.toLowerCase() === 'mb' ? n * 1000 : m[2]!.toLowerCase() === 'bytes' ? n / 1000 : n;
  const index = [join(BROWSER_OUT, 'index.html'), join(BROWSER_OUT, 'index', 'index.html')].find((f) => existsSync(f));
  if (!index) throw new Error('the build has no prerendered index.html');
  built = { out: r.out, initialKb, browserOut: BROWSER_OUT, indexHtml: read(index) };
  return built;
}

/** The hrefs of the stylesheets an HTML file links. */
export function linkedStyles(html: string): string[] {
  // The production build's critical-CSS step (beasties) turns each stylesheet link into a deferred one and repeats it inside a
  // <noscript> fallback. That repeat is the same link, not a second one, so it is not counted.
  return [...html.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '').matchAll(/<link\b[^>]*>/gi)]
    .map((m) => m[0])
    .filter((tag) => /\brel\s*=\s*["']?stylesheet/i.test(tag))
    .map((tag) => /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? '')
    .filter(Boolean);
}
export const isSiteCss = (href: string): boolean => /(^|\/)site\.css(\?|#|$)/.test(href);

/** Files a pull request changed, relative to pepla-web (`git diff` against its base). Same base rules as SITE-03 and SITE-04 AC-12. */
export function changedFiles(): string[] {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: PEPLA_WEB, encoding: 'utf8' }).trim();
  let base = '';
  for (const ref of ['origin/develop', 'develop']) { try { base = git('merge-base', 'HEAD', ref); break; } catch { /* next */ } }
  // CI checks out the pull request's merge commit with no develop branch: its first parent is develop's tip.
  if (!base && process.env['GITHUB_ACTIONS'] === 'true') {
    try { git('rev-parse', '--verify', '-q', 'HEAD^1'); } catch { git('fetch', '--no-tags', '--quiet', '--depth=2', 'origin', process.env['GITHUB_SHA'] ?? git('rev-parse', 'HEAD')); }
    try { base = git('rev-parse', 'HEAD^1'); } catch { /* stays empty */ }
    // A pull request's merge commit is never its own first parent: an empty diff here would mean the base is wrong, and the test would skip silently.
    if (base && base === git('rev-parse', 'HEAD')) base = '';
  }
  if (!base) throw new Error('develop is known (git merge-base HEAD origin/develop): no base');
  return git('diff', '--name-only', '--no-renames', base, 'HEAD', '--', '.').split('\n').filter(Boolean).map((f) => f.replace(/^pepla-web\//, ''));
}

/** What a page says about its site styles, read after it has settled. */
export async function siteStyleState(page: Page): Promise<{ links: number; sheets: number; loaded: boolean; siteElements: number; headerPosition: string | null }> {
  return page.evaluate(() => {
    const isSite = (h: string | null | undefined) => !!h && /(^|\/)site\.css(\?|#|$)/.test(h);
    const links = [...document.querySelectorAll('link[rel~="stylesheet"]')].filter((l) => isSite(l.getAttribute('href'))).length;
    const sheets = [...document.styleSheets].filter((s) => isSite(s.href));
    let loaded = false;
    try { loaded = sheets.some((s) => s.cssRules.length > 0); } catch { loaded = false; }
    const header = document.querySelector('.pp-site-header');
    return {
      links,
      sheets: sheets.length,
      loaded,
      siteElements: document.querySelectorAll('[class*="pp-site-"]').length,
      headerPosition: header ? getComputedStyle(header).position : null,
    };
  });
}
