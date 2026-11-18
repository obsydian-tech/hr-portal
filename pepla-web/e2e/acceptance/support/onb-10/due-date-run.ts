import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * ONB-10: runs lambda/shared/due-date.mjs, the one place the rule lives, in a fresh Node process.
 * The module is pure (no AWS call), so nothing is faked. A call that throws is reported as `{ threw }`, never raised.
 */
export const REPO = join(__dirname, '..', '..', '..', '..', '..');
export const DUE_DATE_MODULE = join(REPO, 'lambda', 'shared', 'due-date.mjs');

export type Call = { fn: 'documentsDueDate' | 'dueDaysFor'; args: unknown[] };
export type Result = { value?: unknown; threw?: string };

export function runDueDate(calls: Call[]): { exports: Record<string, unknown>; results: Result[]; importError?: string } {
  const script = `
    import { pathToFileURL } from 'node:url';
    const out = { exports: {}, results: [] };
    try {
      const mod = await import(pathToFileURL(process.argv[1]).href);
      for (const [k, v] of Object.entries(mod)) if (typeof v !== 'function') out.exports[k] = v; else out.exports[k] = 'function';
      for (const c of JSON.parse(process.argv[2])) {
        try {
          const args = c.args.map((a) => (a && typeof a === 'object' && '__undefined' in a ? undefined : a));
          const f = mod[c.fn];
          if (typeof f !== 'function') { out.results.push({ threw: c.fn + ' is not exported' }); continue; }
          const v = f(...args);
          out.results.push({ value: v === undefined ? { __undefined: true } : v });
        } catch (e) { out.results.push({ threw: String(e && e.message || e) }); }
      }
    } catch (e) { out.importError = String(e && e.message || e); }
    process.stdout.write('@@DUE@@' + JSON.stringify(out) + '\\n');
  `;
  const stdout = execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', script, DUE_DATE_MODULE, JSON.stringify(calls)], {
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env['PATH'] ?? '', TZ: 'UTC' },
  });
  const line = stdout.split('\n').find((l) => l.startsWith('@@DUE@@'))!;
  const parsed = JSON.parse(line.slice('@@DUE@@'.length)) as { exports: Record<string, unknown>; results: Array<{ value?: any; threw?: string }>; importError?: string };
  return {
    exports: parsed.exports,
    importError: parsed.importError,
    results: parsed.results.map((r) => (r.threw !== undefined ? { threw: r.threw } : { value: r.value && typeof r.value === 'object' && '__undefined' in r.value ? undefined : r.value })),
  };
}

/** The undefined value, as an argument (JSON cannot carry it). */
export const UNDEFINED = { __undefined: true };
