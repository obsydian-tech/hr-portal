import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * SITE-15 AC-7: the production build, read for pages it must NOT hold. `npm run build` runs once per test run (it also runs `verify:design`
 * before and `verify-public-names` after, so a build that fails either fails here). `SITE_15_BUILD_DIR` points at an existing output instead of
 * building (for trying a changed output by hand; CI does not set it).
 */
export const PEPLA_WEB = join(__dirname, '..', '..', '..', '..');
export const BROWSER_OUT = join(PEPLA_WEB, 'dist', 'pepla-web', 'browser');

let built: string | undefined;
export function builtSite(): string {
  if (built) return built;
  const fixed = process.env['SITE_15_BUILD_DIR'];
  if (fixed) { built = fixed; return built; }
  const r = spawnSync('npm', ['run', 'build'], { cwd: PEPLA_WEB, encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NG_CLI_ANALYTICS: 'false' } });
  const log = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) throw new Error(`npm run build failed (it runs verify:design and verify-public-names):\n${log.slice(-4000)}`);
  built = BROWSER_OUT;
  return built;
}

/** Every file of the build output, as paths relative to it. */
export function filesOf(dir: string): string[] {
  return existsSync(dir) ? (readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[]).map((f) => f.split('\\').join('/')) : [];
}
