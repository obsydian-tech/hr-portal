import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, sep } from 'node:path';

/**
 * SITE-10 AC-1 and AC-2: the production build and what it holds for `/product/onboarding`.
 * `npm run build` runs once per test run (it also runs `verify:design` before and `verify-public-names` after, so a build that fails either fails here).
 * The static output is served by a small server that answers as static hosting does (a path, `path/index.html`, `path.html`, else 404, no fallback to
 * the app shell), so a page that was not prerendered is a 404 and not an empty shell. `SITE_10_BUILD_DIR` points at an existing output instead of building
 * (for trying a changed output by hand; CI does not set it).
 */
export const PEPLA_WEB = join(__dirname, '..', '..', '..', '..');
export const BROWSER_OUT = join(PEPLA_WEB, 'dist', 'pepla-web', 'browser');
export const ROUTE_DIR = ['product', 'onboarding'];

export type Built = { dir: string; log: string };
let built: Built | undefined;
export function builtSite(): Built {
  if (built) return built;
  const fixed = process.env['SITE_10_BUILD_DIR'];
  if (fixed) { built = { dir: fixed, log: '' }; return built; }
  const r = spawnSync('npm', ['run', 'build'], { cwd: PEPLA_WEB, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NG_CLI_ANALYTICS: 'false' } });
  const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) throw new Error(`npm run build failed (it runs verify:design and verify-public-names):\n${log.slice(-4000)}`);
  built = { dir: BROWSER_OUT, log };
  return built;
}
/** The prerendered file for the route, as static hosting finds it: `product/onboarding/index.html` or `product/onboarding.html`. */
export function prerenderedFile(dir: string): string | undefined {
  const base = join(dir, ...ROUTE_DIR);
  return [join(base, 'index.html'), `${base}.html`].find((f) => existsSync(f) && statSync(f).isFile());
}
export const readText = (f: string): string => readFileSync(f, 'utf8');

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain' };
/** Serves `dir` as static hosting does. Resolves with the server and its origin. */
export async function serveStatic(dir: string): Promise<{ server: Server; origin: string }> {
  const root = normalize(dir);
  const server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]!.split('#')[0]!);
    const target = normalize(join(root, path));
    const candidates = [target, join(target, 'index.html'), `${target}.html`];
    const file = target.startsWith(root + sep) || target === root ? candidates.find((f) => existsSync(f) && statSync(f).isFile()) : undefined;
    if (!file) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
export const stop = (s: Server): Promise<void> => new Promise((ok) => s.close(() => ok()));

/** The words of an HTML text: tags out, entities decoded, white space collapsed. */
export function htmlText(html: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—' };
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : named[e.toLowerCase()] ?? m))
    .replace(/\s+/g, ' ').trim();
}
