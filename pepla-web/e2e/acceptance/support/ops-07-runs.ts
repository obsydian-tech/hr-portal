import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, WORKFLOWS } from './ops-02-workflows';
import { evaluate } from './ops-06-concurrency';

/**
 * Helpers for the OPS-07 acceptance tests (ops-07.spec.ts). OPS-07 changes how
 * the jobs of "Deploy Lambdas" and the Terraform workflow it calls decide to run,
 * so these tests read the two workflow files and play a sample run through them:
 *
 *   simulate(scenario) walks deploy-lambdas.yml job by job (and terraform-apply.yml
 *   where it is called), works out every job's `if` with GitHub's rules, and says
 *   which jobs run, which are skipped, which wait, and how each one ends.
 *
 * GitHub rules used (docs.github.com, "Evaluate expressions in workflows and
 * actions", "Using jobs in a workflow", "Reuse workflows"; read 13 Nov 2026), and
 * what run 43500695798 (#312, 13 Nov) showed:
 *   - A job `if` with no status function (success(), failure(), cancelled(),
 *     always()) is read as `success() && (if)`.
 *   - success() for a job: no job it depends on, directly or further up, failed,
 *     was cancelled or was skipped (a skipped job further up the chain skips the
 *     jobs below it unless they use a status function). failure(): one of them
 *     failed. cancelled(): the run was cancelled.
 *   - A job that waits for an approval (pending) holds every job that needs it,
 *     and a called workflow is not finished while any of its jobs is.
 *   - A called workflow ends: failure if any of its jobs failed, else cancelled if
 *     any was cancelled, else skipped if every job was skipped (what #312 showed),
 *     else success.
 *
 * How a job ends:
 *   - Jobs that exist at d2ee800 (develop when the card was written) do real work
 *     (Terraform, AWS, approvals). The scenario says how each ended; unnamed ones
 *     succeed, with the outputs the scenario gives.
 *   - A job that is new since d2ee800 is RUN: its `run` steps are executed with
 *     bash (expressions worked out first) in a temporary folder, so its own logic
 *     decides whether it passes. Such a job may use actions/checkout and nothing
 *     else; a new job that needs any other action cannot be judged here and the
 *     test says so.
 *
 * Nothing here talks to GitHub, AWS or any AI service.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const DEPLOY = 'deploy-lambdas.yml';
export const TF = 'terraform-apply.yml';
export const BASELINE_SHA = 'd2ee800';
const BASELINE_DIR = join(__dirname, 'ops-07');

export type Result = 'success' | 'failure' | 'cancelled' | 'skipped' | 'pending' | 'waiting';

const PARSE = `
import json, sys, yaml
doc = yaml.safe_load(open(sys.argv[1]))
if isinstance(doc, dict) and True in doc:
    doc["on"] = doc.pop(True)
print(json.dumps(doc))
`;

function parseFile(path: string): any {
  if (!existsSync(path)) throw new Error(`${path} is missing`);
  const out = spawnSync('python3', ['-c', PARSE, path], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`${path} does not parse as YAML (needs python3 with PyYAML):\n${out.stderr}`);
  return JSON.parse(out.stdout);
}

const cache = new Map<string, any>();
/** A workflow file as it is now. */
export function current(file: string): any {
  const p = join(WORKFLOWS, file);
  if (!cache.has(p)) cache.set(p, parseFile(p));
  return cache.get(p);
}
/** The same workflow file at d2ee800, kept in support/ops-07/. */
export function baseline(file: string): any {
  const p = join(BASELINE_DIR, file.replace(/\.yml$/, `.${BASELINE_SHA}.yml`));
  if (!cache.has(p)) cache.set(p, parseFile(p));
  return cache.get(p);
}
export const currentText = (file: string) => readFileSync(join(WORKFLOWS, file), 'utf8');
export const baselineText = (file: string) => readFileSync(join(BASELINE_DIR, file.replace(/\.yml$/, `.${BASELINE_SHA}.yml`)), 'utf8');

/** Job ids that exist at d2ee800 in either file. */
export function baselineJobs(file: string): string[] {
  return Object.keys(baseline(file).jobs ?? {});
}
/** Job ids added since d2ee800. */
export function newJobs(file: string): string[] {
  const old = new Set(baselineJobs(file));
  return Object.keys(current(file).jobs ?? {}).filter((j) => !old.has(j));
}

// ------------------------------------------------------------------ scenarios

export type Scenario = {
  label: string;
  branch: 'develop' | 'main';
  /** What "What changed" said. */
  infra: 'true' | 'false';
  lambda: 'true' | 'false';
  /** Repository variables. TF_AUTO_APPLY and PROD_LAMBDA_DEPLOY default to "true" (live today). */
  vars?: Record<string, string>;
  /** How existing jobs ended when they ran (default success). "pending" = waiting for an approval. */
  results?: Record<string, Result>;
  /** Outputs of existing jobs that ran. */
  outputs?: Record<string, Record<string, string>>;
};

export type JobRun = {
  file: string;
  id: string;
  result: Result;
  /** Why: "if false", "needs X", "ran", ... */
  why: string;
  /** Every job this one depends on, directly or further up (same file; a call counts as one job). */
  ancestors: string[];
  /** For a job that calls another workflow: how that workflow ended. */
  called?: Sim;
  outputs: Record<string, string>;
  /** Text printed by an executed job (new jobs only). */
  log?: string;
};

export type Sim = { file: string; jobs: Record<string, JobRun>; result: Result };

type Files = { [file: string]: any };

export function simulate(s: Scenario, files: 'current' | 'baseline' = 'current'): Sim {
  const load = files === 'current' ? current : baseline;
  const known = new Set([...baselineJobs(DEPLOY), ...baselineJobs(TF)]);
  const state = { cancelled: false };
  const sha = '3'.repeat(40);
  const github = {
    event_name: 'push',
    ref: `refs/heads/${s.branch}`,
    ref_name: s.branch,
    ref_type: 'branch',
    sha,
    repository: 'obsydian-tech/hr-portal',
    repository_owner: 'obsydian-tech',
    run_id: '43500000001',
    run_number: '1',
    run_attempt: '1',
    server_url: 'https://github.com',
    api_url: 'https://api.github.com',
    workflow: 'Deploy Lambdas',
    actor: 'Ignecious',
    token: 'fake-token',
    event: { before: '4'.repeat(40), after: sha },
  };
  const vars = { TF_AUTO_APPLY: 'true', PROD_LAMBDA_DEPLOY: 'true', ...(s.vars ?? {}) };
  const files_: Files = { [DEPLOY]: load(DEPLOY), [TF]: load(TF) };
  return runWorkflow(DEPLOY, files_, {}, { github, vars, s, known, state });
}

type Ctx = { github: any; vars: any; s: Scenario; known: Set<string>; state: { cancelled: boolean } };

const STATUS = /\b(success|failure|cancelled|always)\s*\(\s*\)/gi;

function stripExpr(raw: any): string {
  if (raw === undefined || raw === null || raw === '') return '';
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  const t = String(raw).trim();
  const whole = /^\$\{\{([\s\S]*)\}\}$/.exec(t);
  return (whole ? whole[1] : t).trim();
}

function truthy(v: any): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  return true;
}

const toStr = (v: any): string =>
  v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** Works out a condition (`if`) with the status functions given. */
function condition(raw: any, contexts: Record<string, any>, status: Record<string, boolean>, implicit = true): boolean {
  let expr = stripExpr(raw);
  if (expr === '') expr = 'success()';
  else if (implicit && !new RegExp(STATUS.source, 'i').test(expr)) expr = `success() && (${expr})`;
  const rewritten = expr.replace(STATUS, (_m, f: string) => `__status.${f.toLowerCase()}`);
  return truthy(evaluate(rewritten, { ...contexts, __status: status }));
}

/** A value that may hold `${{ }}`; text around an expression makes it a string. */
function value(raw: any, contexts: Record<string, any>): any {
  if (typeof raw !== 'string') return raw;
  const whole = /^\s*\$\{\{([\s\S]*?)\}\}\s*$/.exec(raw);
  if (whole) return evaluate(whole[1], contexts);
  return raw.replace(/\$\{\{([\s\S]*?)\}\}/g, (_m, e) => toStr(evaluate(e, contexts)));
}

function needsOf(job: any): string[] {
  const n = job?.needs;
  return n === undefined || n === null ? [] : Array.isArray(n) ? n.map(String) : [String(n)];
}

function order(jobs: Record<string, any>): string[] {
  const done: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string, path: string[]) => {
    if (seen.has(id)) return;
    if (path.includes(id)) throw new Error(`job ${id} needs itself: ${[...path, id].join(' -> ')}`);
    if (!(id in jobs)) throw new Error(`job ${path[path.length - 1]} needs ${id}, which does not exist`);
    for (const n of needsOf(jobs[id])) visit(n, [...path, id]);
    seen.add(id);
    done.push(id);
  };
  for (const id of Object.keys(jobs)) visit(id, []);
  return done;
}

function ancestorsOf(jobs: Record<string, any>, id: string): string[] {
  const out = new Set<string>();
  const walk = (j: string) => {
    for (const n of needsOf(jobs[j])) if (!out.has(n)) { out.add(n); walk(n); }
  };
  walk(id);
  return [...out];
}

function combine(results: Result[]): Result {
  if (results.some((r) => r === 'pending' || r === 'waiting')) return 'pending';
  if (results.some((r) => r === 'failure')) return 'failure';
  if (results.some((r) => r === 'cancelled')) return 'cancelled';
  if (results.every((r) => r === 'skipped')) return 'skipped';
  return 'success';
}

function runWorkflow(file: string, files: Files, inputs: Record<string, any>, ctx: Ctx): Sim {
  const wf = files[file];
  const jobs: Record<string, any> = wf.jobs ?? {};
  const runs: Record<string, JobRun> = {};
  const envTop: Record<string, any> = {};
  for (const [k, v] of Object.entries(wf.env ?? {})) envTop[k] = toStr(v);

  for (const id of order(jobs)) {
    const job = jobs[id];
    const ancestors = ancestorsOf(jobs, id);
    const direct = needsOf(job);
    const needs: Record<string, any> = {};
    for (const n of direct) needs[n] = { result: runs[n].result, outputs: runs[n].outputs };
    const base: JobRun = { file, id, result: 'skipped', why: '', ancestors, outputs: {} };

    const waitingOn = direct.filter((n) => runs[n].result === 'pending' || runs[n].result === 'waiting');
    if (waitingOn.length) {
      runs[id] = { ...base, result: 'waiting', why: `waits for ${waitingOn.join(', ')}` };
      continue;
    }

    const anc = ancestors.map((a) => runs[a].result);
    const status = {
      success: !ctx.state.cancelled && anc.every((r) => r === 'success'),
      failure: anc.some((r) => r === 'failure'),
      cancelled: ctx.state.cancelled,
      always: true,
    };
    const contexts = {
      github: ctx.github, inputs, needs, vars: ctx.vars, env: {}, secrets: {}, matrix: {}, strategy: {},
      runner: { os: 'Linux', temp: '/tmp' }, job: {}, steps: {},
    };
    if (!condition(job.if, contexts, status)) {
      runs[id] = { ...base, result: 'skipped', why: `if is false (${stripExpr(job.if) || 'success()'})` };
      continue;
    }

    let run: JobRun;
    if (typeof job.uses === 'string') {
      const called = /^\.\/\.github\/workflows\/(.+\.ya?ml)$/.exec(job.uses);
      if (called && called[1] === TF) {
        const declared = files[TF]?.on?.workflow_call?.inputs ?? {};
        const given: Record<string, any> = {};
        for (const [k, d] of Object.entries<any>(declared)) if (d && 'default' in d) given[k] = d.default;
        for (const [k, v] of Object.entries(job.with ?? {})) given[k] = value(v, contexts);
        for (const [k, d] of Object.entries<any>(declared)) {
          if (d?.type === 'string' && k in given) given[k] = toStr(given[k]);
          if (d?.type === 'boolean' && typeof given[k] === 'string') given[k] = given[k] === 'true';
        }
        const sim = runWorkflow(TF, files, given, ctx);
        run = { ...base, result: sim.result, why: `called ${TF}`, called: sim };
      } else {
        const r = ctx.s.results?.[id] ?? 'success';
        run = { ...base, result: r, why: `calls ${job.uses}` };
      }
    } else if (ctx.known.has(id) || ctx.s.results?.[id] !== undefined) {
      run = { ...base, result: ctx.s.results?.[id] ?? 'success', why: 'ran', outputs: { ...defaultOutputs(id, ctx.s), ...(ctx.s.outputs?.[id] ?? {}) } };
    } else {
      run = execute(file, id, job, { ...contexts }, envTop, base);
    }
    if (run.result === 'cancelled') ctx.state.cancelled = true;
    runs[id] = run;
  }
  return { file, jobs: runs, result: combine(Object.values(runs).map((r) => r.result)) };
}

function defaultOutputs(id: string, s: Scenario): Record<string, string> {
  if (id === 'changes') return { infra: s.infra, lambda: s.lambda };
  if (id === 'tf-dev') return { destroys: 'false', applied: 'true', infra_list: '', talent_list: '' };
  if (id === 'prod-plan') return { release: 'false', destroys: 'false', code: s.lambda, infra_list: '', talent_list: '' };
  return {};
}

/** Runs a new job's steps with bash, so its own logic decides how it ends. */
function execute(file: string, id: string, job: any, contexts: Record<string, any>, envTop: Record<string, any>, base: JobRun): JobRun {
  const dir = mkdtempSync(join(tmpdir(), 'ops-07-job-'));
  const steps: Record<string, any> = {};
  const log: string[] = [];
  let failed = false;
  try {
    const jobEnv: Record<string, string> = { ...envTop };
    for (const [k, v] of Object.entries(job.env ?? {})) jobEnv[k] = toStr(value(v, { ...contexts, env: jobEnv }));
    const list: any[] = job.steps ?? [];
    if (list.length === 0) throw new Error(`${file} job ${id} has no steps`);
    for (const [i, step] of list.entries()) {
      const stepCtx = { ...contexts, env: jobEnv, steps };
      const status = { success: !failed, failure: failed, cancelled: false, always: true };
      if (!condition(step.if, stepCtx, status)) continue;
      if (typeof step.uses === 'string') {
        if (/^actions\/checkout@/.test(step.uses)) continue;
        throw new Error(`${file} job ${id} step ${i + 1} uses ${step.uses}; these checks can only judge a new job built from run steps`);
      }
      const env: Record<string, string> = { ...jobEnv };
      for (const [k, v] of Object.entries(step.env ?? {})) env[k] = toStr(value(v, { ...stepCtx, env }));
      const script = toStr(value(String(step.run ?? ''), { ...stepCtx, env }));
      const shell = String(step.shell ?? job.defaults?.run?.shell ?? '');
      const out = join(dir, `out-${i}`);
      writeFileSync(out, '');
      const args =
        shell === '' ? ['bash', ['-e', '-c', script]]
        : shell === 'bash' ? ['bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script]]
        : shell === 'sh' ? ['sh', ['-e', '-c', script]]
        : shell === 'python' ? ['python3', ['-c', script]]
        : null;
      if (!args) throw new Error(`${file} job ${id} step ${i + 1} uses shell "${shell}", which these checks do not run`);
      const r = spawnSync(args[0] as string, args[1] as string[], {
        cwd: REPO,
        encoding: 'utf8',
        timeout: 20_000,
        env: {
          PATH: process.env['PATH'] ?? '/usr/bin:/bin',
          HOME: dir,
          CI: 'true',
          GITHUB_ACTIONS: 'true',
          GITHUB_REF: contexts['github'].ref,
          GITHUB_REF_NAME: contexts['github'].ref_name,
          GITHUB_SHA: contexts['github'].sha,
          GITHUB_EVENT_NAME: contexts['github'].event_name,
          GITHUB_REPOSITORY: contexts['github'].repository,
          GITHUB_RUN_ID: contexts['github'].run_id,
          GITHUB_SERVER_URL: contexts['github'].server_url,
          GITHUB_OUTPUT: out,
          GITHUB_STEP_SUMMARY: join(dir, 'summary'),
          GITHUB_ENV: join(dir, 'env'),
          RUNNER_TEMP: dir,
          ...env,
        },
      });
      log.push(`[step ${i + 1}${step.name ? ` ${step.name}` : ''}] exit ${r.status}\n${r.stdout}${r.stderr}`);
      const ok = r.status === 0;
      if (step.id) steps[step.id] = { outcome: ok ? 'success' : 'failure', conclusion: ok || step['continue-on-error'] ? 'success' : 'failure', outputs: readOutputs(out) };
      if (!ok && !step['continue-on-error']) failed = true;
    }
    const outputs: Record<string, string> = {};
    for (const [k, v] of Object.entries(job.outputs ?? {})) outputs[k] = toStr(value(v, { ...contexts, steps }));
    const result: Result = failed && !job['continue-on-error'] ? 'failure' : 'success';
    return { ...base, result, why: 'ran (new job, steps executed)', outputs, log: log.join('\n') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readOutputs(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = readFileSync(path, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const heredoc = /^([^=<]+)<<(.+)$/.exec(lines[i]);
    if (heredoc) {
      const body: string[] = [];
      for (i++; i < lines.length && lines[i] !== heredoc[2]; i++) body.push(lines[i]);
      out[heredoc[1]] = body.join('\n');
      continue;
    }
    const kv = /^([^=]+)=(.*)$/.exec(lines[i]);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

// ------------------------------------------------------------------ reading a run

/** Every job of a simulated run, called workflows included, as "file job". */
export function allJobs(sim: Sim): JobRun[] {
  const out: JobRun[] = [];
  for (const j of Object.values(sim.jobs)) {
    out.push(j);
    if (j.called) out.push(...allJobs(j.called));
  }
  return out;
}

export function job(sim: Sim, id: string): JobRun {
  const found = allJobs(sim).find((j) => j.id === id);
  if (!found) throw new Error(`no job ${id} in the run`);
  return found;
}

/** The job in deploy-lambdas.yml that calls terraform-apply.yml. */
export function terraformCall(sim: Sim): JobRun {
  const found = Object.values(sim.jobs).find((j) => j.called?.file === TF);
  if (!found) throw new Error(`${DEPLOY} no longer calls ${TF}`);
  return found;
}

const ran = (r: Result) => r === 'success' || r === 'failure';
export const runs = (j: JobRun) => ran(j.result);

/** One line per job: "file job: result (why)". Used in test messages. */
export function story(sim: Sim): string {
  return allJobs(sim)
    .map((j) => `${j.file} ${j.id}: ${j.result} (${j.why})${j.result === 'failure' && j.log ? `\n${j.log.trim().split('\n').slice(-6).join('\n')}` : ''}`)
    .join('\n');
}

// ------------------------------------------------------------------ static reading

/** Does this job sign in to AWS or deploy Lambda code (role, deploy script, AWS CLI)? */
export function deploysOrSignsIn(j: any): boolean {
  const text = JSON.stringify(j);
  return /role-to-assume|configure-aws-credentials|deploy-lambdas\.sh|\baws\s+(lambda|s3|sts|cloudformation)\b/.test(text);
}
