import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO } from './hcl';
import { asList, isMap, parseYaml, str, type Yaml } from './yaml-lite';

/** GitHub workflow files read as data, for the OPS-05 checks. Nothing is run. */

export const WORKFLOWS = join(REPO, '.github', 'workflows');

export type Step = { index: number; name: string; uses: string; run: string; if: string; with: Record<string, string>; env: Record<string, string>; text: string };
export type Job = {
  workflow: string;
  id: string;
  environment: string;
  needs: string[];
  if: string;
  uses: string;
  steps: Step[];
  concurrency: { group: string; cancel: string } | undefined;
  /** Everything in the job as text: run scripts, with:, env:, if:. */
  text: string;
  raw: { [k: string]: Yaml };
};
export type Workflow = {
  file: string;
  text: string;
  on: { [k: string]: Yaml };
  jobs: Job[];
  concurrency: { group: string; cancel: string } | undefined;
  env: Record<string, string>;
};

const record = (v: Yaml | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  if (isMap(v)) for (const [k, x] of Object.entries(v)) out[k] = str(x);
  return out;
};

function concurrencyOf(v: Yaml | undefined): { group: string; cancel: string } | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return { group: v, cancel: 'false' };
  if (isMap(v)) return { group: str(v['group']), cancel: str(v['cancel-in-progress'] ?? 'false') };
  return undefined;
}

export function loadWorkflow(file: string): Workflow {
  const text = readFileSync(join(WORKFLOWS, file), 'utf8');
  const doc = parseYaml(text);
  if (!isMap(doc)) throw new Error(`${file}: not a mapping`);
  const onRaw = doc['on'];
  const on: { [k: string]: Yaml } = {};
  if (typeof onRaw === 'string') on[onRaw] = null;
  else if (Array.isArray(onRaw)) for (const e of onRaw) on[str(e)] = null;
  else if (isMap(onRaw)) Object.assign(on, onRaw);
  const jobs: Job[] = [];
  if (isMap(doc['jobs'])) {
    for (const [id, j] of Object.entries(doc['jobs'])) {
      if (!isMap(j)) continue;
      const env = j['environment'];
      const steps = asList(j['steps']).map((s, index): Step => {
        const m = isMap(s) ? s : {};
        const step = {
          index,
          name: str(m['name']),
          uses: str(m['uses']),
          run: str(m['run']),
          if: str(m['if']),
          with: record(m['with']),
          env: record(m['env']),
          text: '',
        };
        step.text = [step.name, step.uses, step.if, step.run, ...Object.values(step.with), ...Object.values(step.env)].join('\n');
        return step;
      });
      const job: Job = {
        workflow: file,
        id,
        environment: isMap(env) ? str(env['name']) : str(env),
        needs: asList(j['needs']).map(str),
        if: str(j['if']),
        uses: str(j['uses']),
        steps,
        concurrency: concurrencyOf(j['concurrency']),
        text: '',
        raw: j,
      };
      job.text = [job.if, job.uses, JSON.stringify(j['with'] ?? ''), JSON.stringify(j['env'] ?? ''), JSON.stringify(j['strategy'] ?? ''), ...steps.map((s) => s.text)].join('\n');
      jobs.push(job);
    }
  }
  return { file, text, on, jobs, concurrency: concurrencyOf(doc['concurrency']), env: record(doc['env']) };
}

export function loadWorkflows(): Workflow[] {
  if (!existsSync(WORKFLOWS)) return [];
  return readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map(loadWorkflow);
}

/** Branches a `push` trigger runs on ([] when the workflow has no push trigger). */
export function pushBranches(w: Workflow): string[] {
  if (!('push' in w.on)) return [];
  const p = w.on['push'];
  return isMap(p) ? asList(p['branches']).map(str) : ['*'];
}

export function pushPaths(w: Workflow): string[] {
  const p = w.on['push'];
  return isMap(p) ? asList(p['paths']).map(str) : [];
}

export function prPaths(w: Workflow): string[] {
  const p = w.on['pull_request'];
  return isMap(p) ? asList(p['paths']).map(str) : [];
}

/** `${{ env.X }}` and `${{ X }}`-free text: job and workflow env values substituted, so a role ARN kept in env still counts. */
export function expand(text: string, w: Workflow, j?: Job): string {
  const env: Record<string, string> = { ...w.env, ...(j ? record(j.raw['env']) : {}) };
  return text.replace(/\$\{\{\s*env\.([A-Za-z0-9_]+)\s*\}\}/g, (all, k: string) => env[k] ?? all);
}

/** Every role ARN a job assumes through aws-actions/configure-aws-credentials. */
export function rolesAssumed(w: Workflow, j: Job): string[] {
  return j.steps
    .filter((s) => s.uses.startsWith('aws-actions/configure-aws-credentials'))
    .map((s) => expand(s.with['role-to-assume'] ?? '', w, j));
}

export const sameEnv = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Job ids a job waits for, directly or through other jobs in the same workflow. */
export function allNeeds(w: Workflow, j: Job): Set<string> {
  const seen = new Set<string>();
  const walk = (id: string) => {
    const job = w.jobs.find((x) => x.id === id);
    for (const n of job?.needs ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        walk(n);
      }
    }
  };
  walk(j.id);
  return seen;
}

/** Lines of a step's script that run the given command (continuation lines joined). */
export function commandLines(script: string, command: RegExp): string[] {
  const joined = script.replace(/\\\n\s*/g, ' ');
  // Quoted text is not a command: `echo "terraform plan failed"` does not count.
  return joined.split('\n').filter((l) => command.test(l.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""')));
}
