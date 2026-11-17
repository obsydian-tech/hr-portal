import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

/**
 * TEN-01 AC-6: the list of Lambdas without the company check can only shrink.
 *
 * `scan()` is this card's own reading of the rule: a Lambda folder "touches the onboarding tables" when its source
 * (tests left out) names a setting EMPLOYEES_TABLE, DOCUMENTS_TABLE, INVITES_TABLE or VERIFICATION_TABLE, or one
 * of the tables `employees`, `documents`, `employee_invites`, `document-verification` as a quoted string. It
 * "uses the helper" when its source imports `shared/tenant.mjs`.
 *
 * `ciCopy()` copies lambda/ (no node_modules) to a scratch folder and installs lambda/shared's own packages
 * there (`npm ci`, as the "Lambda unit tests" job does), so `npm test` can be run on planted folders without
 * touching the repo.
 */

export const TABLE_SETTINGS = ['EMPLOYEES_TABLE', 'DOCUMENTS_TABLE', 'INVITES_TABLE', 'VERIFICATION_TABLE'];
export const TABLE_NAMES = ['employees', 'documents', 'employee_invites', 'document-verification'];
const NAMES_TABLE = new RegExp(`\\b(${TABLE_SETTINGS.join('|')})\\b|['"\`](${TABLE_NAMES.join('|')})['"\`]`);
export const IMPORTS_HELPER = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](?:\.{1,2}\/)+(?:shared\/)?tenant\.mjs['"]/;
const SKIP_DIRS = new Set(['node_modules', 'coverage', '__tests__', 'tests', 'test', 'dist', '.git']);
const TEST_FILE = /\.(test|spec)\.[cm]?js$/;

/** Source files of one Lambda folder: .js, .mjs and .cjs, tests and node_modules left out. */
export function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(join(d, e.name));
      } else if (/\.[cm]?js$/.test(e.name) && !TEST_FILE.test(e.name)) out.push(join(d, e.name));
    }
  };
  walk(dir);
  return out.sort();
}

export type Folder = { name: string; touches: boolean; usesHelper: boolean; files: string[] };

/** Every Lambda folder under `lambdaDir` (shared left out), with whether it touches the tables and uses the helper. */
export function scan(lambdaDir: string): Folder[] {
  return readdirSync(lambdaDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'shared' && e.name !== 'node_modules')
    .map((e) => {
      const files = sourceFiles(join(lambdaDir, e.name));
      const texts = files.map((f) => readFileSync(f, 'utf8'));
      return {
        name: e.name,
        files: files.map((f) => relative(lambdaDir, f)),
        touches: texts.some((t) => NAMES_TABLE.test(t)),
        usesHelper: texts.some((t) => IMPORTS_HELPER.test(t)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The names in lambda/shared/tenant-retrofit.json: a JSON list of folder names (or one list inside an object). */
export function readList(file: string): string[] {
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
  const lists = Array.isArray(parsed) ? [parsed] : Object.values(parsed as Record<string, unknown>).filter(Array.isArray);
  if (lists.length !== 1) throw new Error(`${file}: expected one list of Lambda folder names`);
  const names = lists[0] as unknown[];
  for (const n of names) if (typeof n !== 'string') throw new Error(`${file}: every entry is a folder name (got ${JSON.stringify(n)})`);
  return names as string[];
}

/** What is wrong with a list against the locked copy: names added (not allowed), and repeats. Removals are fine. */
export function listProblems(names: string[], allowed: string[]): string[] {
  const problems: string[] = [];
  for (const n of names) if (!allowed.includes(n)) problems.push(`${n} was added to the list (only removals are allowed)`);
  const seen = new Set<string>();
  for (const n of names) {
    if (seen.has(n)) problems.push(`${n} is on the list twice`);
    seen.add(n);
  }
  return problems;
}

// ---------------------------------------------------------------- running the CI test on a copy

export type CiRun = { status: number | null; output: string };

export function ciCopy(repoLambda: string): string {
  const root = mkdtempSync(join(tmpdir(), 'ten-01-ci-'));
  const lambda = join(root, 'lambda');
  cpSync(repoLambda, lambda, {
    recursive: true,
    filter: (src) => !/[\\/](node_modules|coverage|dist)([\\/]|$)/.test(relative(repoLambda, src)) && !/\.zip$/.test(src),
  });
  const shared = join(lambda, 'shared');
  if (existsSync(join(shared, 'package-lock.json'))) {
    const ci = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: shared, encoding: 'utf8', timeout: 300_000, env: process.env });
    if (ci.status !== 0) throw new Error(`npm ci in a copy of lambda/shared failed:\n${(ci.stdout + ci.stderr).slice(-3000)}`);
  }
  return lambda;
}

/** `npm test` in the copy's lambda/shared, as the "Lambda unit tests" job runs it (CI=true). */
export function npmTest(lambda: string): CiRun {
  const r = spawnSync('npm', ['test'], { cwd: join(lambda, 'shared'), encoding: 'utf8', timeout: 300_000, env: { ...process.env, CI: 'true' } });
  return { status: r.status, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

export function plant(lambda: string, name: string, files: Record<string, string>): void {
  const dir = join(lambda, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
}

export function unplant(lambda: string, name: string): void {
  rmSync(join(lambda, name), { recursive: true, force: true });
}

/** JavaScript with // and /* *\/ comments blanked out; strings ('', "", ``) kept. Good enough for text checks. */
export function stripJs(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const two = src.slice(i, i + 2);
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (two === '//') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else { out += c; i++; }
  }
  return out;
}

export const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();
