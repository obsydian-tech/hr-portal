import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Helpers for the OPS-02 acceptance tests (ops-02.spec.ts). OPS-02 changes
 * GitHub workflows, not the app, so these tests read the workflow files:
 *
 *   - workflow(): parses a workflow with python3 + PyYAML (on every GitHub
 *     runner), so YAML anchors, block scalars and comments read as GitHub reads them.
 *   - starts(): GitHub's path filter rules (paths / paths-ignore, `!` patterns in
 *     order, last match wins), so "does this set of files start this workflow?"
 *     can be answered without pushing anything.
 *   - runResultComment(): runs the real "post results" github-script step of
 *     app-e2e-dev.yml in a separate node process, with sample Playwright
 *     results and a fake GitHub API, and returns the comment it would post.
 *
 * Nothing here talks to GitHub, AWS or any AI service.
 */

export const REPO = resolve(__dirname, '..', '..', '..', '..');
export const WORKFLOWS = join(REPO, '.github', 'workflows');
const SAMPLES = join(__dirname, 'ops-02');

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

export function workflow(file: string): Yaml {
  const path = join(WORKFLOWS, file);
  if (!existsSync(path)) throw new Error(`${file} is missing from .github/workflows/`);
  const out = spawnSync('python3', ['-c', PARSE, path], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`${file} does not parse as YAML (needs python3 with PyYAML):\n${out.stderr}`);
  return JSON.parse(out.stdout);
}

/** The workflow's text with YAML comments gone (parsed and written back). */
export function workflowWithoutComments(file: string): string {
  return JSON.stringify(workflow(file));
}

// ------------------------------------------------------------------ path filters

/** GitHub filter pattern to a RegExp: `*` stays inside one folder, `**` crosses folders. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === '/';
        re += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = glob.indexOf(']', i);
      re += end > i ? glob.slice(i, end + 1) : '\\[';
      i = end > i ? end : i;
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Whether one file is picked by an ordered pattern list (a later `!pattern` removes it). */
function picked(file: string, patterns: string[]): boolean {
  let hit = false;
  for (const p of patterns) {
    const negative = p.startsWith('!');
    if (globToRegExp(negative ? p.slice(1) : p).test(file)) hit = !negative;
  }
  return hit;
}

export type Event = 'push' | 'pull_request';

/**
 * Whether a push or PR into `branch` that changed `files` starts the workflow.
 * Throws if the workflow does not listen to that event for that branch at all,
 * so a test never passes because a trigger went missing.
 */
export function starts(file: string, event: Event, files: string[], branch = 'develop'): boolean {
  const on = workflow(file).on;
  const trigger = on?.[event];
  if (on == null || !(event in on)) throw new Error(`${file} has no ${event} trigger`);
  const t = trigger ?? {};
  const branches: string[] | undefined = t.branches;
  if (branches && !branches.some((b) => picked(branch, [b]))) throw new Error(`${file} ${event} does not cover ${branch}`);
  if (t.paths && t['paths-ignore']) throw new Error(`${file} ${event} has both paths and paths-ignore`);
  if (t.paths) return files.some((f) => picked(f, t.paths));
  if (t['paths-ignore']) return files.some((f) => !picked(f, t['paths-ignore']));
  return files.length > 0;
}

// ------------------------------------------------------------------ jobs and steps

export type Step = { id?: string; name?: string; 'working-directory'?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, any>; if?: string };

export function jobs(file: string): Record<string, Yaml> {
  return workflow(file).jobs ?? {};
}

export function steps(file: string): { job: string; step: Step }[] {
  return Object.entries(jobs(file)).flatMap(([job, j]) => ((j.steps ?? []) as Step[]).map((step) => ({ job, step })));
}

// ------------------------------------------------------------------ the result comment

export type CommentRun = {
  event: Event;
  /** Files the change touched; fed to pick-e2e-tests.py the way the workflow does. */
  files: string[];
  /** Outcome of the step that runs the new app's acceptance tests. */
  newApp: 'success' | 'failure' | 'skipped';
  /** Whether the new app wrote its results file. */
  newAppResults: boolean;
};

export type Comment = { body: string; modules: string };

/** The github-script step in app-e2e-dev.yml that posts the PR comment. */
export function commentStep(): { job: string; step: Step } {
  const found = steps('app-e2e-dev.yml').filter(
    ({ step }) => (step.uses ?? '').startsWith('actions/github-script@') && /createComment/.test(String(step.with?.script ?? '')),
  );
  if (found.length !== 1) throw new Error(`expected one github-script step that posts the comment in app-e2e-dev.yml, found ${found.length}`);
  return found[0];
}

/** pick-e2e-tests.py's GITHUB_OUTPUT lines for these files. */
function pick(files: string[]): Record<string, string> {
  const out = execFileSync('python3', [join(REPO, 'scripts', 'ci', 'pick-e2e-tests.py')], {
    cwd: REPO,
    input: files.join('\n') + '\n',
    encoding: 'utf8',
  });
  return Object.fromEntries(
    out
      .split('\n')
      .filter((l) => /^[A-Za-z_-]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
}

/**
 * Resolves the `${{ ... }}` in the comment step's env the way the run would:
 * the pick step's outputs, the new app step's outcome from `run`, success for
 * any other step, and nothing for the rest (artifact links, inputs).
 */
function resolveEnv(env: Record<string, string>, run: CommentRun, outputs: Record<string, string>): Record<string, string> {
  const all = steps('app-e2e-dev.yml').map(({ step }) => step);
  const pickId = all.find((s) => /pick-e2e-tests\.py/.test(s.run ?? ''))?.id;
  const newAppId = all.find((s) => /e2e:acceptance/.test(s.run ?? ''))?.id;
  const value = (expr: string): string => {
    let m = /^steps\.([\w-]+)\.outputs\.([\w-]+)$/.exec(expr);
    if (m) return m[1] === pickId ? (outputs[m[2]] ?? '') : '';
    m = /^steps\.([\w-]+)\.(outcome|conclusion)$/.exec(expr);
    if (m) return m[1] === newAppId ? run.newApp : 'success';
    if (expr === 'github.event_name') return run.event;
    return '';
  };
  return Object.fromEntries(
    Object.entries(env ?? {}).map(([k, v]) => [k, String(v).replace(/\$\{\{\s*(.+?)\s*\}\}/g, (_, e) => value(e))]),
  );
}

const HARNESS = `
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const [script, payload] = [fs.readFileSync(process.argv[2], 'utf8'), JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))];
const posted = [];
const fromCwd = createRequire(path.join(process.cwd(), 'noop.js'));
const req = (id) => fromCwd(id.startsWith('.') ? path.resolve(id) : id);
const context = {
  eventName: payload.event, sha: 'abc1234', runId: 1, runNumber: 1, serverUrl: 'https://github.com',
  repo: { owner: 'obsydian-tech', repo: 'hr-portal' }, issue: { number: 7 },
  payload: payload.event === 'pull_request' ? { pull_request: { number: 7 } } : { before: '0123abc' },
};
const ok = (data) => Promise.resolve({ data });
const github = {
  paginate: async () => [],
  rest: {
    repos: { listPullRequestsAssociatedWithCommit: () => ok([{ number: 7, merged_at: '2026-11-13T10:00:00Z' }]) },
    issues: {
      listComments: () => ok([]),
      createComment: (a) => { posted.push(a.body); return ok({ id: 1 }); },
      updateComment: (a) => { posted.push(a.body); return ok({ id: 1 }); },
    },
  },
};
const core = new Proxy({}, { get: () => () => {} });
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
new AsyncFunction('require', '__original_require__', 'github', 'context', 'core', 'glob', 'io', 'exec', 'fetch', script)(
  req, req, github, context, core, {}, {}, {}, async () => { throw new Error('no network in this test'); },
).then(() => { fs.writeFileSync('posted.json', JSON.stringify(posted)); }, (e) => { console.error(e); process.exit(1); });
`;

/** Runs the comment step on sample results and returns the comment it posts. */
export function runResultComment(run: CommentRun): Comment {
  const { step } = commentStep();
  const outputs = pick(run.files);
  const env = resolveEnv(step.env ?? {}, run, outputs);
  const dir = mkdtempSync(join(tmpdir(), 'ops-02-comment-'));
  try {
    const place = (rel: string, sample: string) => {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      cpSync(join(SAMPLES, sample), join(dir, rel));
    };
    place('hr-portal/e2e/results/results.json', 'current-app-results.json');
    if (run.newAppResults) place('pepla-web/e2e/acceptance/.output/results.json', 'new-app-results.json');
    // A script the step loads from the repo still resolves.
    for (const shared of ['scripts', '.github']) symlinkSync(join(REPO, shared), join(dir, shared));
    writeFileSync(join(dir, 'script.js'), String(step.with?.script ?? ''));
    writeFileSync(join(dir, 'payload.json'), JSON.stringify({ event: run.event }));
    writeFileSync(join(dir, 'harness.cjs'), HARNESS);
    const out = spawnSync(process.execPath, ['harness.cjs', 'script.js', 'payload.json'], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        PATH: process.env['PATH'] ?? '',
        GITHUB_EVENT_NAME: run.event,
        GITHUB_WORKSPACE: dir,
        ...env,
      },
    });
    if (out.status !== 0) throw new Error(`the comment script failed:\n${out.stderr}`);
    const posted: string[] = JSON.parse(readFileSync(join(dir, 'posted.json'), 'utf8'));
    if (posted.length !== 1) throw new Error(`expected one comment, the script posted ${posted.length}`);
    return { body: posted[0], modules: outputs['modules'] ?? '' };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export type Row = { cells: string[]; line: string };

/** The results table of a comment: header cells and one entry per row. */
export function table(body: string): { header: string[]; rows: Row[] } {
  const lines = body.split('\n').filter((l) => l.trim().startsWith('|'));
  const cells = (l: string) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  if (lines.length < 2) return { header: [], rows: [] };
  return { header: cells(lines[0]), rows: lines.slice(2).map((line) => ({ cells: cells(line), line: line.trim() })) };
}

/** Titles and Playwright projects in a sample results file, for checking rows against. */
export function sampleTests(sample: 'new-app-results.json' | 'current-app-results.json'): { describe: string; title: string; project: string }[] {
  const data = JSON.parse(readFileSync(join(SAMPLES, sample), 'utf8'));
  const out: { describe: string; title: string; project: string }[] = [];
  const walk = (suite: Yaml, top: string) => {
    for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) out.push({ describe: top, title: spec.title, project: t.projectName });
    for (const child of suite.suites ?? []) walk(child, top || child.title);
  };
  for (const file of data.suites ?? []) walk(file, '');
  return out;
}
