import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Helpers for acceptance tests of infra cards (BE-16 and later): read the
 * Terraform files as text, run a CI script against a fake AWS, and run one
 * step of a GitHub workflow with a stub `terraform`.
 *
 * Nothing here calls AWS, Terraform Cloud, or any AI service. No browser.
 */

export const REPO = resolve(__dirname, '..', '..', '..', '..');
export const INFRA = join(REPO, 'infra');
const SCRATCH = mkdtempSync(join(tmpdir(), 'infra-harness-'));

// ---------------------------------------------------------------- Terraform files as text

/** HCL with # // and /* *\/ comments blanked out (same length, so offsets match the source), strings kept. */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const two = src.slice(i, i + 2);
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
    } else if (c === '#' || two === '//') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i++;
      }
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
    } else if (two === '<<') {
      // heredoc: copy verbatim up to its end marker
      const m = /^<<-?([A-Za-z_]+)\n/.exec(src.slice(i));
      if (!m) {
        out += c;
        i++;
        continue;
      }
      const endRe = new RegExp(`\\n\\s*${m[1]}\\s*(\\n|$)`);
      const rest = src.slice(i + m[0].length - 1);
      const e = endRe.exec(rest);
      const stop = e ? i + m[0].length - 1 + e.index + e[0].length : src.length;
      out += src.slice(i, stop);
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Index just after the brace that closes the one at `open`. Skips strings. */
function closeBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
    } else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('Unbalanced braces in Terraform file');
}

export type Block = { file: string; labels: string[]; body: string; start: number; raw: string; source: string };

/** Top-level blocks of one kind (`resource`, `import`, ...) in the given .tf files. */
export function blocks(files: string[], kind: string): Block[] {
  const found: Block[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const src = stripComments(source);
    const re = new RegExp(`^[ \\t]*${kind}((?:[ \\t]+"[^"]*")*)[ \\t]*\\{`, 'gm');
    for (let m = re.exec(src); m; m = re.exec(src)) {
      const open = m.index + m[0].length - 1;
      const end = closeBrace(src, open);
      const labels = [...m[1].matchAll(/"([^"]*)"/g)].map((l) => l[1]);
      found.push({ file, labels, body: src.slice(open + 1, end - 1), start: m.index, raw: src.slice(m.index, end), source });
      re.lastIndex = end;
    }
  }
  return found;
}

/** Top-level `name = value` pairs of a block body, value without whitespace. Nested blocks are left out. */
export function attributes(body: string): Map<string, string> {
  const attrs = new Map<string, string>();
  let depth = 0;
  let current: { key: string; value: string } | undefined;
  for (const line of body.split('\n')) {
    if (depth === 0) {
      if (current) attrs.set(current.key, current.value.replace(/\s+/g, ''));
      current = undefined;
      const m = /^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*=(?!=)(.*)$/.exec(line);
      if (m) current = { key: m[1], value: m[2] };
    } else if (current) current.value += line;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        i++;
        while (i < line.length && line[i] !== '"') i += line[i] === '\\' ? 2 : 1;
      } else if ('{[('.includes(c)) depth++;
      else if ('}])'.includes(c)) depth--;
    }
  }
  if (current) attrs.set(current.key, current.value.replace(/\s+/g, ''));
  return attrs;
}

export function tfFiles(dir = INFRA): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.tf'))
    .map((f) => join(dir, f));
}

/** The text in the given number of lines before a block, plus the block itself, comments kept. */
export function withLeadingLines(block: Block, lines: number): string {
  const before = block.source.slice(0, block.start).split('\n');
  return before.slice(Math.max(0, before.length - 1 - lines)).join('\n') + block.source.slice(block.start, block.start + block.raw.length);
}

export function onPath(tool: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${tool}`]).status === 0;
}

// ---------------------------------------------------------------- the seed against a fake AWS

export const FAKE_AWS = join(__dirname, 'be-16', 'fake-aws');

export type FakeAws = {
  account: string;
  password: string;
  pools: Record<string, { id: string; groups: string[] }>;
};

export type AwsCall = { service: string; op: string; params: Record<string, unknown>; error: string | null };

export type ScriptRun = { status: number | null; stdout: string; stderr: string; output: string; calls: AwsCall[] };

/** Runs a Python script from scripts/ci with the fake boto3 in place of the real one. */
export function runWithFakeAws(script: string, fake: FakeAws): ScriptRun {
  const dir = mkdtempSync(join(SCRATCH, 'seed-'));
  const cfg = join(dir, 'fake.json');
  const log = join(dir, 'calls.jsonl');
  writeFileSync(cfg, JSON.stringify(fake));
  writeFileSync(log, '');
  // -S: no site-packages, so a real boto3 can never be picked up; -B: no __pycache__.
  const r = spawnSync('python3', ['-S', '-B', join(REPO, script)], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
      HOME: dir,
      PYTHONPATH: FAKE_AWS,
      BE16_FAKE: cfg,
      BE16_CALLS: log,
      // Nothing here can reach AWS anyway; these make sure a stray real client could not either.
      AWS_ACCESS_KEY_ID: 'fake',
      AWS_SECRET_ACCESS_KEY: 'fake',
      AWS_DEFAULT_REGION: 'af-south-1',
      AWS_EC2_METADATA_DISABLED: 'true',
    },
  });
  const calls = readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AwsCall);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, output: `${r.stdout}\n${r.stderr}`, calls };
}

// ---------------------------------------------------------------- one workflow step with a stub terraform

/**
 * The `run:` script of the step in a workflow file whose script contains
 * `marker` (e.g. "terraform show -json"), dedented. `${{ matrix.root }}` becomes
 * "infra"; any other `${{ ... }}` becomes empty.
 */
export function workflowStep(workflow: string, marker: string): string {
  const lines = readFileSync(join(REPO, '.github', 'workflows', workflow), 'utf8').split('\n');
  const scripts: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:-\s+)?run:\s*\|[-+]?\s*$/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length + (lines[i].trimStart().startsWith('-') ? 2 : 0);
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === '') {
        body.push('');
        continue;
      }
      if (l.length - l.trimStart().length <= indent) break;
      body.push(l);
    }
    const strip = Math.min(...body.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
    scripts.push(body.map((l) => l.slice(strip)).join('\n'));
    i = j - 1;
  }
  const hits = scripts.filter((s) => s.includes(marker));
  if (hits.length !== 1) throw new Error(`${workflow}: expected one step containing "${marker}", found ${hits.length}`);
  return hits[0].replace(/\$\{\{\s*matrix\.root\s*\}\}/g, 'infra').replace(/\$\{\{[^}]*\}\}/g, '');
}

export type StepRun = { status: number | null; stdout: string; stderr: string; summary: string; runnerTemp: string; cwd: string };

/**
 * Runs a step script the way GitHub does (bash -e), in an empty folder, with a
 * stub `terraform` on PATH whose `show -json` prints `plan`. Returns what it
 * printed and wrote to the step summary.
 */
export function runStepWithPlan(script: string, plan: unknown): StepRun {
  const dir = mkdtempSync(join(SCRATCH, 'step-'));
  const bin = join(dir, 'bin');
  const cwd = join(dir, 'infra');
  const runnerTemp = join(dir, 'runner-temp');
  for (const d of [bin, cwd, runnerTemp]) execFileSync('mkdir', ['-p', d]);
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
  writeFileSync(join(cwd, 'plan.bin'), 'stub');
  const tf = join(bin, 'terraform');
  writeFileSync(
    tf,
    `#!/usr/bin/env bash\nif [ "$1" = "show" ]; then cat "${join(dir, 'plan.json')}"; exit 0; fi\necho "stub terraform: unexpected $*" >&2; exit 2\n`,
  );
  chmodSync(tf, 0o755);
  const summary = join(dir, 'summary.md');
  writeFileSync(summary, '');
  const file = join(dir, 'step.sh');
  writeFileSync(file, script);
  const r = spawnSync('bash', ['--noprofile', '--norc', '-e', file], {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
    env: { PATH: `${bin}:${process.env['PATH'] ?? '/usr/bin:/bin'}`, HOME: dir, GITHUB_STEP_SUMMARY: summary, RUNNER_TEMP: runnerTemp },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, summary: readFileSync(summary, 'utf8'), runnerTemp, cwd };
}

export function readIfExists(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}
