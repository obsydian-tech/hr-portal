import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * ONB-21: runs functions of one shared module (lambda/shared/<name>.mjs) in a fresh Node process. These modules import no
 * AWS package, so nothing is faked. A call that throws is reported as `{ threw }`, never raised. `tz` sets the process's own
 * time zone, to show the answer does not depend on it.
 */
export const REPO = join(__dirname, '..', '..', '..', '..', '..');
export const sharedModule = (name: string) => join(REPO, 'lambda', 'shared', `${name}.mjs`);

export type Call = { fn: string; args: unknown[] };
export type Result = { value?: unknown; threw?: string };

export function runModule(file: string, calls: Call[], tz = 'UTC'): { exports: Record<string, string>; results: Result[]; importError?: string } {
  const script = `
    import { pathToFileURL } from 'node:url';
    const out = { exports: {}, results: [] };
    try {
      const mod = await import(pathToFileURL(process.argv[1]).href);
      for (const [k, v] of Object.entries(mod)) out.exports[k] = typeof v === 'function' ? 'function' : JSON.stringify(v);
      for (const c of JSON.parse(process.argv[2])) {
        try {
          const args = c.args.map((a) => (a && typeof a === 'object' && '__undefined' in a ? undefined : a && typeof a === 'object' && '__date' in a ? new Date(a.__date) : a));
          const f = mod[c.fn];
          if (typeof f !== 'function') { out.results.push({ threw: c.fn + ' is not exported' }); continue; }
          const v = f(...args);
          out.results.push({ value: v === undefined ? { __undefined: true } : v });
        } catch (e) { out.results.push({ threw: String((e && e.message) || e) }); }
      }
    } catch (e) { out.importError = String((e && e.message) || e); }
    process.stdout.write('@@MOD@@' + JSON.stringify(out) + '\\n');
  `;
  const stdout = execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script, file, JSON.stringify(calls)], {
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env['PATH'] ?? '', TZ: tz },
  });
  const line = stdout.split('\n').find((l) => l.startsWith('@@MOD@@'))!;
  const parsed = JSON.parse(line.slice('@@MOD@@'.length)) as { exports: Record<string, string>; results: Array<{ value?: any; threw?: string }>; importError?: string };
  return {
    exports: parsed.exports,
    importError: parsed.importError,
    results: parsed.results.map((r) => (r.threw !== undefined ? { threw: r.threw } : { value: r.value && typeof r.value === 'object' && '__undefined' in r.value ? undefined : r.value })),
  };
}

/** The undefined value, as an argument (JSON cannot carry it). */
export const UNDEFINED = { __undefined: true };
/** A Date, as an argument: the module gets `new Date(iso)`. */
export const date = (iso: string) => ({ __date: iso });
