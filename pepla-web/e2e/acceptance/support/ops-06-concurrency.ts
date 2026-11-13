import { readdirSync } from 'node:fs';
import { WORKFLOWS, workflow as parse, type Yaml } from './ops-02-workflows';

const parsed = new Map<string, Yaml>();
/** A workflow file, parsed once per test run (each parse starts python3). */
export function workflow(file: string): Yaml {
  if (!parsed.has(file)) parsed.set(file, parse(file));
  return parsed.get(file);
}

/**
 * Helpers for the OPS-06 acceptance tests (ops-06.spec.ts). OPS-06 changes how
 * GitHub queues the pepla-dev test runs, so these tests read the workflow files
 * and work out, for sample runs, which concurrency group each run lands in and
 * whether a later run can cancel an earlier one:
 *
 *   - evaluate(): a small reader for GitHub `${{ }}` expressions (contexts,
 *     literals, == != < > <= >=, && || !, brackets, and the functions format,
 *     contains, startsWith, endsWith, join, toJSON, fromJSON).
 *   - concurrencyOf(): a concurrency block (workflow or job level) for one run:
 *     group name, cancel-in-progress and queue, with expressions worked out.
 *   - canCancel(): GitHub's rules, from "Control the concurrency of workflows and
 *     jobs" (docs.github.com, read 13 Nov 2026):
 *       - same group and the newer run has cancel-in-progress true: the older run
 *         is cancelled, waiting or running;
 *       - same group and queue `single` (the default): "any existing pending job
 *         or workflow run in the same concurrency group is canceled and replaced";
 *       - same group and `queue: max`: up to 100 wait, first in first out, none
 *         replaced. `queue: max` with cancel-in-progress true is a validation error.
 *     Group names are compared without case, as GitHub does.
 *
 * Nothing here talks to GitHub, AWS or any AI service.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ------------------------------------------------------------------ sample runs

export type Run = {
  /** Short name used in test messages. */
  label: string;
  kind: 'after-merge' | 'pr' | 'monday' | 'by-hand';
  /** PR number for PR runs. */
  pr?: number;
  /** The run's `github` context. A called workflow sees its caller's. */
  github: Record<string, any>;
  /** The run's `inputs` context. */
  inputs: Record<string, any>;
  /** Set when this run of app-e2e-dev.yml is called from deploy-lambdas.yml. */
  calledFromDeploy?: boolean;
};

let runId = 43_500_000_000;

function develop(event: string, workflowName: string, sha: string): Record<string, any> {
  runId += 1;
  return {
    event_name: event,
    ref: 'refs/heads/develop',
    ref_name: 'develop',
    ref_type: 'branch',
    base_ref: '',
    head_ref: '',
    sha,
    run_id: String(runId),
    run_number: String(runId % 1000),
    run_attempt: '1',
    workflow: workflowName,
    repository: 'obsydian-tech/hr-portal',
    event: event === 'push' ? { before: 'a'.repeat(40), after: sha } : {},
  };
}

/** A merge into develop: the push run of "App tests on dev". */
export function pushRun(label: string, sha: string): Run {
  return { label, kind: 'after-merge', github: develop('push', 'App tests on dev', sha), inputs: {} };
}

/** A merge into develop: Deploy Lambdas calling app-e2e-dev.yml after the deploy. */
export function deployCall(label: string, sha: string): Run {
  return { label, kind: 'after-merge', github: develop('push', 'Deploy Lambdas', sha), inputs: { full: true }, calledFromDeploy: true };
}

export function mondayRun(label: string): Run {
  return { label, kind: 'monday', github: develop('schedule', 'App tests on dev', 'c'.repeat(40)), inputs: {} };
}

export function byHandRun(label: string): Run {
  return { label, kind: 'by-hand', github: develop('workflow_dispatch', 'App tests on dev', 'd'.repeat(40)), inputs: {} };
}

/** One push to a PR into develop. */
export function prRun(label: string, pr: number, branch: string, sha: string): Run {
  runId += 1;
  return {
    label,
    kind: 'pr',
    pr,
    inputs: {},
    github: {
      event_name: 'pull_request',
      ref: `refs/pull/${pr}/merge`,
      ref_name: `${pr}/merge`,
      ref_type: 'branch',
      base_ref: 'develop',
      head_ref: branch,
      sha,
      run_id: String(runId),
      run_number: String(runId % 1000),
      run_attempt: '1',
      workflow: 'App tests on dev',
      repository: 'obsydian-tech/hr-portal',
      event: {
        number: pr,
        action: 'synchronize',
        pull_request: { number: pr, head: { ref: branch, sha, repo: { full_name: 'obsydian-tech/hr-portal' } }, base: { ref: 'develop' } },
      },
    },
  };
}

// ------------------------------------------------------------------ expressions

type Tok = { t: 'str' | 'num' | 'id' | 'op' | 'end'; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      let s = '';
      i++;
      for (;;) {
        if (i >= src.length) throw new Error(`unclosed string in expression: ${src}`);
        if (src[i] === "'" && src[i + 1] === "'") { s += "'"; i += 2; continue; }
        if (src[i] === "'") { i++; break; }
        s += src[i++];
      }
      out.push({ t: 'str', v: s });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('()[],.!<>'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    const num = /^-?(0x[0-9a-f]+|\d+(\.\d+)?(e[+-]?\d+)?)/i.exec(src.slice(i));
    if (num && (out.length === 0 || out[out.length - 1].t === 'op' && out[out.length - 1].v !== ')' && out[out.length - 1].v !== ']')) {
      out.push({ t: 'num', v: num[0] });
      i += num[0].length;
      continue;
    }
    const id = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    if (c === '*') { out.push({ t: 'id', v: '*' }); i++; continue; }
    throw new Error(`cannot read "${c}" in expression: ${src}`);
  }
  out.push({ t: 'end', v: '' });
  return out;
}

function truthy(v: any): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  return true;
}

function toNum(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return v.trim() === '' ? 0 : Number(v);
  return NaN;
}

function toStr(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** GitHub's loose equality: strings without case; otherwise both sides as numbers. */
function looseEq(a: any, b: any): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if (typeof a === 'object' && a !== null || typeof b === 'object' && b !== null) return a === b;
  return toNum(a) === toNum(b);
}

const FUNCTIONS: Record<string, (...a: any[]) => any> = {
  format: (f: any, ...args: any[]) =>
    toStr(f).replace(/\{\{|\}\}|\{(\d+)\}/g, (m, n) => (m === '{{' ? '{' : m === '}}' ? '}' : toStr(args[Number(n)]))),
  contains: (hay: any, needle: any) =>
    Array.isArray(hay) ? hay.some((x) => looseEq(x, needle)) : toStr(hay).toLowerCase().includes(toStr(needle).toLowerCase()),
  startswith: (s: any, p: any) => toStr(s).toLowerCase().startsWith(toStr(p).toLowerCase()),
  endswith: (s: any, p: any) => toStr(s).toLowerCase().endsWith(toStr(p).toLowerCase()),
  join: (a: any, sep: any = ',') => (Array.isArray(a) ? a.map(toStr).join(toStr(sep)) : toStr(a)),
  tojson: (v: any) => JSON.stringify(v, null, 2),
  fromjson: (v: any) => JSON.parse(toStr(v)),
};

/** Works out one GitHub expression (the part inside `${{ }}`) against the given contexts. */
export function evaluate(expr: string, contexts: Record<string, any>): any {
  const toks = lex(expr);
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string) => {
    const tk = toks[p];
    if (v !== undefined && tk.v !== v) throw new Error(`expected "${v}" in expression: ${expr}`);
    p++;
    return tk;
  };

  const primary = (): any => {
    const tk = eat();
    let val: any;
    if (tk.t === 'str') val = tk.v;
    else if (tk.t === 'num') val = Number(tk.v);
    else if (tk.t === 'op' && tk.v === '(') { val = or(); eat(')'); }
    else if (tk.t === 'id') {
      const name = tk.v.toLowerCase();
      if (name === 'true') return true;
      if (name === 'false') return false;
      if (name === 'null') return null;
      if (peek().v === '(') {
        const fn = FUNCTIONS[name];
        if (!fn) throw new Error(`function ${tk.v}() is not one these checks read (${Object.keys(FUNCTIONS).join(', ')}): ${expr}`);
        eat('(');
        const args: any[] = [];
        if (peek().v !== ')') {
          args.push(or());
          while (peek().v === ',') { eat(','); args.push(or()); }
        }
        eat(')');
        val = fn(...args);
      } else {
        if (!(tk.v in contexts)) throw new Error(`context "${tk.v}" is not one a concurrency block can use: ${expr}`);
        val = contexts[tk.v];
      }
    } else throw new Error(`unexpected "${tk.v}" in expression: ${expr}`);

    for (;;) {
      if (peek().v === '.') {
        eat('.');
        const key = eat().v;
        val = val === null || val === undefined ? null : val[key] ?? null;
      } else if (peek().v === '[') {
        eat('[');
        const key = or();
        eat(']');
        val = val === null || val === undefined ? null : val[toStr(key)] ?? null;
      } else break;
    }
    return val;
  };
  const unary = (): any => {
    if (peek().v === '!') { eat('!'); return !truthy(unary()); }
    return primary();
  };
  const compare = (): any => {
    let left = unary();
    while (['==', '!=', '<', '>', '<=', '>='].includes(peek().v)) {
      const op = eat().v;
      const right = unary();
      if (op === '==') left = looseEq(left, right);
      else if (op === '!=') left = !looseEq(left, right);
      else {
        const [a, b] = typeof left === 'string' && typeof right === 'string' ? [left.toLowerCase(), right.toLowerCase()] : [toNum(left), toNum(right)];
        left = op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
      }
    }
    return left;
  };
  const and = (): any => {
    let left = compare();
    while (peek().v === '&&') { eat('&&'); const right = compare(); left = truthy(left) ? right : left; }
    return left;
  };
  const or = (): any => {
    let left = and();
    while (peek().v === '||') { eat('||'); const right = and(); left = truthy(left) ? left : right; }
    return left;
  };

  const value = or();
  if (peek().t !== 'end') throw new Error(`could not read the rest of expression: ${expr}`);
  return value;
}

/** A YAML value that may hold `${{ }}`: a whole-expression value keeps its type, mixed text becomes a string. */
export function resolve(value: any, contexts: Record<string, any>): any {
  if (typeof value !== 'string') return value;
  const whole = /^\s*\$\{\{([\s\S]*?)\}\}\s*$/.exec(value);
  if (whole) return evaluate(whole[1], contexts);
  return value.replace(/\$\{\{([\s\S]*?)\}\}/g, (_m, e) => toStr(evaluate(e, contexts)));
}

// ------------------------------------------------------------------ concurrency

export type Block = { group: string; cancel: boolean; queue: string; where: string };

/** A concurrency block worked out for one run. A plain string is a group with the defaults. */
export function concurrencyOf(raw: any, run: Run, where: string): Block | null {
  if (raw === undefined || raw === null) return null;
  const ctx = { github: run.github, inputs: run.inputs, vars: {}, needs: {}, strategy: {}, matrix: {} };
  if (typeof raw === 'string') return { group: toStr(resolve(raw, ctx)), cancel: false, queue: 'single', where };
  const cancelRaw = raw['cancel-in-progress'];
  const cancelVal = cancelRaw === undefined ? false : resolve(cancelRaw, ctx);
  return {
    group: toStr(resolve(raw.group, ctx)),
    cancel: typeof cancelVal === 'string' ? cancelVal.toLowerCase() === 'true' : truthy(cancelVal),
    queue: toStr(resolve(raw.queue ?? 'single', ctx)).toLowerCase(),
    where,
  };
}

export const APP_TESTS = 'app-e2e-dev.yml';
export const DEPLOY = 'deploy-lambdas.yml';

/** The job in app-e2e-dev.yml that seeds pepla-dev and runs the tests against it. */
export function seedingJob(): [string, Yaml] {
  const found = Object.entries(workflow(APP_TESTS).jobs ?? {}).filter(([, j]: [string, any]) =>
    (j.steps ?? []).some((s: { run?: string }) => /seed-dev\.py/.test(s.run ?? '')),
  );
  if (found.length !== 1) throw new Error(`expected one job in ${APP_TESTS} that runs seed-dev.py, found ${found.length}`);
  return found[0] as [string, Yaml];
}

/** Every level that can hold or cancel this run of the pepla-dev tests, outermost first. */
export function levels(run: Run): Block[] {
  const out: Block[] = [];
  if (run.calledFromDeploy) {
    const deploy = workflow(DEPLOY);
    const caller = Object.entries(deploy.jobs ?? {}).find(([, j]: [string, any]) => /app-e2e-dev\.yml$/.test(String(j.uses ?? '')));
    const top = concurrencyOf(deploy.concurrency, run, `${DEPLOY} (workflow)`);
    if (top) out.push(top);
    if (caller) {
      const callerJob = concurrencyOf((caller[1] as any).concurrency, run, `${DEPLOY} job ${caller[0]}`);
      if (callerJob) out.push(callerJob);
    }
  }
  const app = workflow(APP_TESTS);
  const top = concurrencyOf(app.concurrency, run, `${APP_TESTS} (workflow)`);
  if (top) out.push(top);
  const [key, job] = seedingJob();
  const jobLevel = concurrencyOf(job.concurrency, run, `${APP_TESTS} job ${key}`);
  if (jobLevel) out.push(jobLevel);
  return out;
}

const same = (a: Block, b: Block) => a.group.toLowerCase() === b.group.toLowerCase();

/**
 * How the later run can cancel the earlier one, or null when it cannot.
 * "cancels" = the earlier run is cancelled whether waiting or running;
 * "replaces" = the earlier run is cancelled while it waits. It can only be
 * waiting in a group when some other run holds that group, so a replace counts
 * only when one of `others` lands in the same group too.
 */
export function canCancel(
  earlier: Run,
  later: Run,
  others: Run[],
): { how: 'cancels' | 'replaces'; where: string; group: string } | null {
  const a = levels(earlier);
  const b = levels(later);
  for (const lb of b) {
    if (a.some((x) => same(x, lb)) && lb.cancel) return { how: 'cancels', where: lb.where, group: lb.group };
  }
  const third = others.filter((r) => r !== earlier && r !== later).map(levels);
  for (const lb of b) {
    if (!a.some((x) => same(x, lb)) || lb.queue === 'max') continue;
    if (third.some((ls) => ls.some((x) => same(x, lb)))) return { how: 'replaces', where: lb.where, group: lb.group };
  }
  return null;
}

/** Every concurrency block in every workflow file, raw (job blocks included). */
export function allBlocks(): { file: string; where: string; raw: any }[] {
  const out: { file: string; where: string; raw: any }[] = [];
  for (const file of readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort()) {
    const wf = workflow(file);
    if (wf.concurrency !== undefined) out.push({ file, where: `${file} (workflow)`, raw: wf.concurrency });
    for (const [key, j] of Object.entries(wf.jobs ?? {}) as [string, any][]) {
      if (j.concurrency !== undefined) out.push({ file, where: `${file} job ${key}`, raw: j.concurrency });
    }
  }
  return out;
}
