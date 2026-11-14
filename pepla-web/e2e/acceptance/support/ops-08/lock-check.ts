import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Helpers for the OPS-08 acceptance tests (ops-08.spec.ts).
 *
 * OPS-08 changes the "Acceptance tests locked" rule, so these helpers run that
 * rule for real, the way GitHub runs it, against small throwaway git repos:
 *
 *   - lockWorkflow(): reads .github/workflows/acceptance-lock.yml with python3 +
 *     PyYAML (as GitHub reads it) and finds its one job and that job's run steps.
 *   - Sandbox: a bare "origin" (the GitHub repo) and a working clone. Tests make
 *     commits, push lock branches (acceptance-lock/<name>) and tags
 *     (acceptance/<name>) to it, then check() clones origin the way
 *     actions/checkout does (fetch-depth 0, head commit checked out) and runs
 *     every run step of the job with bash -eo pipefail, with the step's env and
 *     the pull request's base and head commits.
 *
 * Only git, bash and python3 are started. Nothing reaches GitHub, AWS or any AI
 * service: "origin" is a folder on this machine.
 */

export const REPO = resolve(__dirname, '..', '..', '..', '..', '..');
export const LOCK_WORKFLOW = join(REPO, '.github', 'workflows', 'acceptance-lock.yml');
export const ACCEPTANCE = join(REPO, 'pepla-web', 'e2e', 'acceptance');
export const CARDS = join(ACCEPTANCE, 'cards');
export const BASELINE_WORKFLOW = join(__dirname, 'acceptance-lock.b9dda84.yml');
export const BASELINE_README = join(__dirname, 'README.b9dda84.txt');

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Yaml = any;

const PARSE = `
import json, sys, yaml
doc = yaml.safe_load(open(sys.argv[1]))
# YAML 1.1 reads the key "on" as true; GitHub reads it as "on".
if isinstance(doc, dict) and True in doc:
    doc["on"] = doc.pop(True)
print(json.dumps(doc))
`;

export function parseWorkflow(path: string): Yaml {
  if (!existsSync(path)) throw new Error(`${path} is missing`);
  const out = spawnSync('python3', ['-c', PARSE, path], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`${path} does not parse as YAML (needs python3 with PyYAML):\n${out.stderr}`);
  return JSON.parse(out.stdout);
}

/** The workflow's single job (the lock check has one job). */
export function lockJob(wf: Yaml): { id: string; job: Yaml } {
  const ids = Object.keys(wf?.jobs ?? {});
  if (ids.length !== 1) throw new Error(`acceptance-lock.yml should have one job, found: ${ids.join(', ') || 'none'}`);
  return { id: ids[0], job: wf.jobs[ids[0]] };
}

export function checkoutStep(job: Yaml): Yaml {
  const found = (job.steps ?? []).filter((s: Yaml) => typeof s.uses === 'string' && s.uses.startsWith('actions/checkout@'));
  if (found.length !== 1) throw new Error(`the lock job should check out once, found ${found.length} checkout steps`);
  return found[0];
}

export type PullRequest = { base: string; head: string; baseRef: string; headRef: string };

/** Fills in the ${{ }} expressions a lock step may use. Anything else is refused, so a test never guesses. */
function expand(text: string, pr: PullRequest): string {
  return text.replace(/\$\{\{\s*([^}]*?)\s*\}\}/g, (_all, expr: string) => {
    switch (expr) {
      case 'github.event.pull_request.base.sha':
        return pr.base;
      case 'github.event.pull_request.head.sha':
        return pr.head;
      case 'github.event.pull_request.base.ref':
      case 'github.base_ref':
        return pr.baseRef;
      case 'github.event.pull_request.head.ref':
      case 'github.head_ref':
        return pr.headRef;
      case 'github.repository':
        return 'obsydian-tech/hr-portal';
      case 'github.workspace':
        return '.';
      default:
        throw new Error(`the OPS-08 harness does not know the expression \${{ ${expr} }} in the lock step`);
    }
  });
}

// ------------------------------------------------------------------ sandbox repos

export type CheckResult = { code: number; out: string };

const RUNS: string[] = [];

export class Sandbox {
  readonly root: string;
  readonly home: string;
  readonly origin: string;
  readonly work: string;
  private n = 0;

  /**
   * A repo whose develop holds `files` (path → text) and the lock workflow under
   * test at .github/workflows/acceptance-lock.yml.
   */
  constructor(files: Record<string, string>, workflowPath = LOCK_WORKFLOW) {
    this.root = mkdtempSync(join(tmpdir(), 'ops-08-'));
    RUNS.push(this.root);
    this.home = join(this.root, 'home');
    mkdirSync(this.home);
    writeFileSync(
      join(this.home, '.gitconfig'),
      [
        '[user]',
        '  name = Lock Test',
        '  email = lock-test@example.invalid',
        '[init]',
        '  defaultBranch = develop',
        '[commit]',
        '  gpgsign = false',
        '[tag]',
        '  gpgsign = false',
        '[advice]',
        '  detachedHead = false',
        '[merge]',
        '  conflictstyle = merge',
        '',
      ].join('\n'),
    );
    this.origin = join(this.root, 'origin.git');
    this.work = join(this.root, 'work');
    this.git(this.root, 'init', '-q', '--bare', '-b', 'develop', this.origin);
    this.git(this.root, 'init', '-q', '-b', 'develop', this.work);
    this.git(this.work, 'remote', 'add', 'origin', this.origin);
    this.write({ ...files, '.github/workflows/acceptance-lock.yml': readFileSync(workflowPath, 'utf8') });
    this.commit('base');
    this.git(this.work, 'push', '-q', 'origin', 'develop');
  }

  private env(): NodeJS.ProcessEnv {
    return {
      PATH: process.env['PATH'],
      HOME: this.home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      LANG: 'C.UTF-8',
    };
  }

  git(cwd: string, ...args: string[]): string {
    const r = spawnSync('git', args, { cwd, env: this.env(), encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${r.stdout}${r.stderr}`);
    return r.stdout.trim();
  }

  /** Writes files (null deletes one) in the working clone. */
  write(files: Record<string, string | null>): void {
    for (const [path, text] of Object.entries(files)) {
      const full = join(this.work, path);
      if (text === null) rmSync(full, { force: true });
      else {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, text);
      }
    }
  }

  /** Commits everything in the working clone and returns the commit. */
  commit(message: string, files?: Record<string, string | null>): string {
    if (files) this.write(files);
    this.git(this.work, 'add', '-A');
    this.n += 1;
    // Distinct, increasing dates so every commit is a new object.
    const date = `2026-11-14T08:${String(this.n).padStart(2, '0')}:00Z`;
    const r = spawnSync('git', ['commit', '-q', '--allow-empty', '-m', message], {
      cwd: this.work,
      env: { ...this.env(), GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`git commit failed:\n${r.stdout}${r.stderr}`);
    return this.git(this.work, 'rev-parse', 'HEAD');
  }

  /** Checks out a branch, making it from `from` if it does not exist. */
  branch(name: string, from?: string): void {
    const exists = spawnSync('git', ['rev-parse', '--verify', '-q', `refs/heads/${name}`], { cwd: this.work, env: this.env() }).status === 0;
    if (exists) this.git(this.work, 'checkout', '-q', name);
    else this.git(this.work, 'checkout', '-q', '-b', name, ...(from ? [from] : []));
  }

  /** Pushes a lock branch acceptance-lock/<name> at a commit (default: HEAD). */
  lock(name: string, sha = 'HEAD'): void {
    this.git(this.work, 'push', '-q', '-f', 'origin', `${this.git(this.work, 'rev-parse', sha)}:refs/heads/acceptance-lock/${name}`);
  }

  /** Pushes a tag acceptance/<name> at a commit (default: HEAD). */
  tag(name: string, sha = 'HEAD'): void {
    this.git(this.work, 'tag', '-f', `acceptance/${name}`, sha);
    this.git(this.work, 'push', '-q', '-f', 'origin', `refs/tags/acceptance/${name}`);
  }

  /** Pushes develop to origin (another card merged there). */
  pushDevelop(): void {
    this.git(this.work, 'push', '-q', '-f', 'origin', 'develop:develop');
  }

  /**
   * Merges `ref` into the current branch. `files` are written into the merge
   * result before it is committed (to resolve a conflict, or to plant a change).
   */
  merge(ref: string, files?: Record<string, string | null>, strategy?: 'ours'): string {
    const r = spawnSync('git', ['merge', '-q', '--no-ff', '--no-commit', ...(strategy ? ['-s', strategy] : []), ref], {
      cwd: this.work,
      env: this.env(),
      encoding: 'utf8',
    });
    if (r.status !== 0 && !files) throw new Error(`merge of ${ref} did not go through cleanly:\n${r.stdout}${r.stderr}`);
    if (files) this.write(files);
    this.git(this.work, 'add', '-A');
    this.n += 1;
    const date = `2026-11-14T09:${String(this.n).padStart(2, '0')}:00Z`;
    const c = spawnSync('git', ['commit', '-q', '--no-edit', '-m', `Merge ${ref}`], {
      cwd: this.work,
      env: { ...this.env(), GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      encoding: 'utf8',
    });
    if (c.status !== 0) throw new Error(`merge commit failed:\n${c.stdout}${c.stderr}`);
    return this.git(this.work, 'rev-parse', 'HEAD');
  }

  /**
   * Runs the lock check for a pull request from `branch` into develop, as GitHub
   * would on pull_request_target: the branch is pushed, origin is cloned with all
   * history, the head commit is checked out, and every run step of the job runs
   * in order with bash -eo pipefail. The first failing step ends the job.
   */
  check(branch: string): CheckResult {
    this.git(this.work, 'push', '-q', '-f', 'origin', `${branch}:refs/heads/${branch}`);
    const pr: PullRequest = {
      base: this.git(this.origin, 'rev-parse', 'refs/heads/develop'),
      head: this.git(this.origin, 'rev-parse', `refs/heads/${branch}`),
      baseRef: 'develop',
      headRef: branch,
    };
    // The rule always comes from the target branch (pull_request_target).
    const wfText = this.git(this.origin, 'show', `${pr.base}:.github/workflows/acceptance-lock.yml`);
    const wfFile = join(this.root, `rule-${pr.base.slice(0, 8)}.yml`);
    writeFileSync(wfFile, wfText);
    const { job } = lockJob(parseWorkflow(wfFile));

    const runner = join(this.root, `runner-${pr.head.slice(0, 8)}-${Date.now()}`);
    this.git(this.root, 'clone', '-q', '--no-checkout', this.origin, runner);
    this.git(runner, 'checkout', '-q', '--detach', pr.head);

    let out = '';
    for (const step of job.steps ?? []) {
      if (typeof step.run !== 'string') continue;
      const stepEnv: Record<string, string> = {};
      for (const [k, v] of Object.entries(step.env ?? {})) stepEnv[k] = expand(String(v), pr);
      for (const [k, v] of Object.entries(job.env ?? {})) stepEnv[k] ??= expand(String(v), pr);
      const script = join(this.root, `step-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
      writeFileSync(script, expand(step.run, pr));
      const shell = typeof step.shell === 'string' ? step.shell : 'bash';
      if (shell !== 'bash') throw new Error(`the lock step uses shell "${shell}"; the OPS-08 harness runs bash steps only`);
      const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', script], {
        cwd: runner,
        env: { ...this.env(), ...stepEnv, GITHUB_ACTIONS: 'true', CI: 'true', GITHUB_EVENT_NAME: 'pull_request_target' },
        encoding: 'utf8',
        timeout: 60_000,
      });
      out += `${r.stdout ?? ''}${r.stderr ?? ''}`;
      if (r.status !== 0) return { code: r.status ?? 1, out };
    }
    return { code: 0, out };
  }
}

/** Removes every throwaway repo made in this run. */
export function cleanUp(): void {
  for (const dir of RUNS.splice(0)) rmSync(dir, { recursive: true, force: true });
}

// ------------------------------------------------------------------ card files

/** The 12 cards in the README table at b9dda84, in table order, with their file names. */
export const TABLE_CARDS = [
  'onb-01',
  'onb-01.1',
  'help-01',
  'ops-02',
  'be-16',
  'help-01.2',
  'onb-02',
  'onb-12',
  'help-01.3',
  'ops-06',
  'ops-07',
  'help-02',
] as const;

/** Cards with locked tests but no table row at b9dda84. */
export const EXTRA_CARDS = ['ops-05', 'ops-08'] as const;

/** Lock branches on origin on 14 Nov 2026 (plus this card's own), and which card file names each. */
export const LOCKS_TODAY: Record<string, string[] | null> = {
  'be-16': ['be-16'],
  'help-01': ['help-01'],
  'help-01.2': ['help-01.2'],
  'help-01.3': ['help-01.3'],
  'help-02': ['help-02'],
  'help-02.2': ['help-02'],
  'onb-01': ['onb-01'],
  // onb-01.2 to .4 changed the ONB-01 tests for the ONB-01.1 card; either file may name them.
  'onb-01.2': ['onb-01', 'onb-01.1'],
  'onb-01.3': ['onb-01', 'onb-01.1'],
  'onb-01.4': ['onb-01', 'onb-01.1'],
  'onb-02': ['onb-02'],
  'onb-12': ['onb-12'],
  'onb-12.2': ['onb-12'],
  'ops-02': ['ops-02'],
  'ops-02.2': ['ops-02'],
  'ops-02.3': ['ops-02'],
  'ops-05': ['ops-05'],
  'ops-05.2': ['ops-05'],
  'ops-05.3': ['ops-05'],
  'ops-05.4': ['ops-05'],
  'ops-06': ['ops-06'],
  'ops-07': ['ops-07'],
  'ops-08': ['ops-08'],
  // Own no card: no card file names them.
  'lock-check': null,
  'lock-check.2': null,
  'zz-ruleset-test': null,
};

/** The lock names a card file's `Locks:` line gives (acceptance-lock/<name>, comma or space separated). */
export function locksLine(text: string): string[] | null {
  const line = text.split('\n').find((l) => /^\W*Locks:/.test(l));
  if (!line) return null;
  return [...line.matchAll(/acceptance-lock\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)/gi)].map((m) => m[1]);
}

/** Whitespace folded and Markdown line breaks ignored, so a moved paragraph can be found word for word. */
export function fold(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The cells of a Markdown table row. */
export function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/** Paragraphs (blank-line separated blocks) of a Markdown text. */
export function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
