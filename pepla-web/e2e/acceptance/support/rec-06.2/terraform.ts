import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blocks, stripComments } from '../infra-harness';
import { policyOf, type TfResource } from '../onb-15/tf-policy';
import { attributes } from '../infra-harness';
import type { Statement } from '../ops-05/iam-eval';

/**
 * REC-06.2 AC-8 and AC-9: what this card's change did, judged on the pull request's own diff and never against a fixed commit, so another card
 * merging first cannot turn a test red. Same base rule as SITE-03, SITE-04, SITE-07 to SITE-11: the base is the merge-base of HEAD with origin/develop
 * (else develop); in CI, where the pull request's merge commit is checked out with no develop branch, it is the merge commit's first parent (fetch depth
 * 2 of GITHUB_SHA when needed), never the commit itself (an empty diff there would skip the check for good). `--no-renames`.
 */
export const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const git = (...a: string[]) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

export function baseCommit(): string {
  let base = '';
  for (const ref of ['origin/develop', 'develop']) { try { base = git('merge-base', 'HEAD', ref); break; } catch { /* next */ } }
  if (!base && process.env['GITHUB_ACTIONS'] === 'true') {
    try { git('rev-parse', '--verify', '-q', 'HEAD^1'); } catch { git('fetch', '--no-tags', '--quiet', '--depth=2', 'origin', process.env['GITHUB_SHA'] ?? git('rev-parse', 'HEAD')); }
    try { base = git('rev-parse', 'HEAD^1'); } catch { /* stays empty */ }
    if (base && base === git('rev-parse', 'HEAD')) base = '';
  }
  if (!base) throw new Error('develop is known (git merge-base HEAD origin/develop): no base');
  return base;
}

/** Files (repository paths) this pull request changed, base to HEAD. A merge commit is judged against its base as a whole. */
export function changedFiles(base = baseCommit()): string[] {
  return git('diff', '--name-only', '--no-renames', base, 'HEAD').split('\n').filter(Boolean);
}

/** A file's text at the base, or null when it did not exist there. */
export function textAt(base: string, path: string): string | null {
  try { return execFileSync('git', ['show', `${base}:${path}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return null; }
}
export const textNow = (path: string): string | null => { try { return readFileSync(join(ROOT, path), 'utf8'); } catch { return null; } };

/** Every infra/*.tf as it was at the base, written to a scratch folder (so the Terraform readers can open them). Returns the file paths. */
export function baseInfra(base: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'rec-06-2-base-infra-'));
  const out: string[] = [];
  const names = git('ls-tree', '--name-only', base, 'infra/').split('\n').filter((n) => n.endsWith('.tf'));
  mkdirSync(dir, { recursive: true });
  for (const n of names) {
    const file = join(dir, n.replace(/^infra\//, ''));
    writeFileSync(file, textAt(base, n) ?? '');
    out.push(file);
  }
  return out;
}
export const nowInfra = (): string[] => readdirSync(join(ROOT, 'infra')).filter((f) => f.endsWith('.tf')).map((f) => join(ROOT, 'infra', f));

export type Res = TfResource;
export function resource(files: string[], type: string, name: string): Res | undefined {
  const b = blocks(files, 'resource').find((x) => x.labels[0] === type && x.labels[1] === name);
  return b ? { type, name, raw: b.raw, body: b.body, attrs: attributes(b.body) } : undefined;
}
export const resourceKeys = (files: string[]): string[] => blocks(files, 'resource').map((b) => `${b.labels[0]}.${b.labels[1]}`).sort();
export const squash = (s: string) => stripComments(s).replace(/\s+/g, '');

/** The statements of an inline policy, each as canonical text, with its parts spelled the way the policy writes them. */
export function statementsOf(r: Res): Statement[] {
  const s = policyOf(r).Statement;
  return Array.isArray(s) ? s : [s];
}
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => a.localeCompare(b))) : x));
export const statementKey = (s: Statement): string => canon(s);

/** `environment { variables = { KEY = value ... } }` of a function block, as key -> value text (spaces removed). */
export function envOf(r: Res): Map<string, string> {
  const m = /environment\s*\{\s*variables\s*=\s*\{([\s\S]*?)\n\s*\}\s*\n\s*\}/.exec(stripComments(r.body));
  const out = new Map<string, string>();
  if (!m) return out;
  for (const line of m[1]!.split('\n')) {
    const kv = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(line);
    if (kv) out.set(kv[1]!, kv[2]!.replace(/\s+/g, ''));
  }
  return out;
}
/** The function block with its environment block taken out, whitespace-free: everything else about it. */
export const withoutEnv = (r: Res): string => squash(r.raw.replace(/environment\s*\{\s*variables\s*=\s*\{[\s\S]*?\n\s*\}\s*\n\s*\}/, ''));
