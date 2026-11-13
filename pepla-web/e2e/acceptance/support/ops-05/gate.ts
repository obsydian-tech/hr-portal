import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO } from './hcl';

/**
 * The apply guard (scripts/ci/tf-gate.py) run on made-up plans, the way
 * `terraform show -json` prints them. No Terraform, no AWS.
 *
 * Contract these tests hold the guard to (python3, standard library only):
 *
 *   tf-gate.py list PLAN_JSON
 *       One line per resource that changes: "<action>\t<address>", where action
 *       is create, update, delete, replace, import, import+update or forget.
 *       Unchanged resources and data reads are left out. Exit 0.
 *   tf-gate.py destroys PLAN_JSON
 *       Only the delete and replace lines, same format. Exit 0 when there are
 *       none, exit 3 when there are some, anything else on error.
 *   tf-gate.py compare APPROVED_LIST PLAN_JSON
 *       APPROVED_LIST is a file `list` wrote. Exit 0 when the plan's list is the
 *       same set of lines, otherwise non-zero and every differing address printed.
 *   tf-gate.py summary ROOT PLAN_JSON
 *       Markdown for the run summary: the root's name, a table of address,
 *       action and (for updates) changed attribute names, and the warning lines
 *       "IAM change", "Lambda environment change", "Protected resource change"
 *       when they apply. Never a value.
 */

export const GATE = join(REPO, 'scripts', 'ci', 'tf-gate.py');
const SCRATCH = mkdtempSync(join(tmpdir(), 'ops05-gate-'));
let n = 0;

export type GateRun = { status: number | null; stdout: string; stderr: string; out: string };

export function gate(args: string[], files: Record<string, unknown> = {}): GateRun {
  const dir = mkdtempSync(join(SCRATCH, `run${n++}-`));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  if (!existsSync(GATE)) return { status: -1, stdout: '', stderr: `${GATE} does not exist`, out: `${GATE} does not exist` };
  // -I: isolated (no user site, no cwd on sys.path); -B: no __pycache__.
  const r = spawnSync('python3', ['-I', '-B', GATE, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: dir, LANG: 'C.UTF-8' },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', out: `${r.stdout ?? ''}\n${r.stderr ?? ''}` };
}

// ---------------------------------------------------------------- made-up plans

export const SECRET = 'SENTINEL-value-never-printed';
export const SECRET2 = 'arn:aws:iam::937137806477:role/SENTINEL';

type Change = {
  address: string;
  actions: string[];
  importing?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export function rc(c: Change) {
  const [type, ...rest] = c.address.replace(/^module\.[^.]+(\[[^\]]*\])?\./, '').split('.');
  return {
    address: c.address,
    mode: c.address.startsWith('data.') ? 'data' : 'managed',
    type: c.address.startsWith('data.') ? rest[0] : type,
    name: (c.address.startsWith('data.') ? rest[1] : rest[0])?.replace(/\[.*$/, ''),
    change: {
      actions: c.actions,
      before: c.before === undefined ? { description: SECRET } : c.before,
      after: c.after === undefined ? { description: SECRET } : c.after,
      after_unknown: {},
      before_sensitive: {},
      after_sensitive: {},
      ...(c.importing ? { importing: { id: c.importing } } : {}),
    },
  };
}

export const plan = (...changes: Change[]) => ({ format_version: '1.2', terraform_version: '1.10.5', resource_changes: changes.map(rc) });

/** Lines "<action>\t<address>" as printed, sorted. */
export const lines = (out: string) =>
  out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .sort();

export const line = (action: string, address: string) => `${action}\t${address}`;
