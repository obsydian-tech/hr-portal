import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PoolUser, Row, Run, Tables } from '../rec-14/lambda-harness';
import { REPO } from '../rec-06/lambda-harness';
import type { Extra as Extra06 } from '../rec-06/lambda-harness';

/**
 * REC-06.1: runs the real code in a fresh Node process per call (a cold Lambda) against this card's fake AWS (./fake-aws, copied from
 * ../rec-06/fake-aws with code added only, each piece marked "REC-06.1"):
 *  - world.cancelTransactItem { index, code }: the transaction is cancelled at that item with that reason (TransactionConflict, say);
 *  - world.cancelUnreadable { reasons? }: cancelled with no reasons, or a list that cannot be read by position;
 *  - world.staleIndex { index, hide }: an index that has not caught up with a write yet (email-index is a global index);
 *  - world.landBeforeOp { op, table?, nth?, tables }: another call's finished writes land just before this run's nth `op`;
 *  - world.failUpdate [{ sets?, removes? }]: an UpdateItem that SETs or REMOVEs that path fails;
 *  - world.eventsPartial { failIndex }: PutEvents takes every entry but one (that one is recorded as service 'events-failed').
 * REC-06's own fake (../rec-06/fake-aws) is not touched. Everything else is ../rec-06/lambda-harness.ts's way of running.
 */
export { REPO };
const FAKE_AWS = join(__dirname, 'fake-aws');

function terraformIndexes(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const dir of [join(REPO, 'infra'), join(REPO, 'talent-flow-infra')]) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tf'))) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const m of text.matchAll(/global_secondary_index\s*\{([^}]*)\}/g)) {
        const name = /name\s*=\s*"([^"]+)"/.exec(m[1]!)?.[1];
        const hash = /hash_key\s*=\s*"([^"]+)"/.exec(m[1]!)?.[1];
        const range = /range_key\s*=\s*"([^"]+)"/.exec(m[1]!)?.[1];
        if (name && hash) out[name] = range ? [hash, range] : [hash];
      }
    }
  }
  return out;
}
const INDEXES = terraformIndexes();

export type Extra = Extra06 & {
  cancelTransactItem?: { index: number; code: string; times?: number };
  cancelUnreadable?: { reasons?: string[]; times?: number };
  staleIndex?: { index: string; hide: Row[] };
  landBeforeOp?: { op: string; table?: string; nth?: number; tables: Tables };
  failUpdate?: { sets?: string; removes?: string; name?: string; times?: number }[];
  eventsPartial?: { failIndex: number; times?: number };
};

function worldOf(tables: Tables, extra: Extra) {
  const { cognito, ...rest } = extra;
  return { indexes: INDEXES, tables: structuredClone(tables), secrets: {}, pageSize: 4, cognito: structuredClone(cognito ?? { users: [] }), ...structuredClone(rest) };
}
const clean = (env: Record<string, string | undefined>) => Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as Record<string, string>;

/** Calls `handler` once with `event` in a fresh process. Only the settings given in `env` are set. */
export function runHandler(handler: string, event: unknown, tables: Tables, env: Record<string, string | undefined>, extra: Extra = {}): Run & { cognito?: { users: PoolUser[] } } {
  const dir = mkdtempSync(join(tmpdir(), 'rec-06.1-'));
  const worldFile = join(dir, 'world.json');
  writeFileSync(worldFile, JSON.stringify(worldOf(tables, extra)));
  const eventFile = join(dir, 'event.json');
  writeFileSync(eventFile, JSON.stringify(event));
  const out = execFileSync(process.execPath, ['--no-warnings', '--require', join(FAKE_AWS, 'cjs-hook.cjs'), '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir, encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
    env: { PATH: process.env['PATH'] ?? '', TEN03_WORLD: worldFile, AWS_REGION: 'af-south-1', AWS_ACCESS_KEY_ID: 'rec061-fake', AWS_SECRET_ACCESS_KEY: 'rec061-fake', POWERTOOLS_DEV: 'false', POWERTOOLS_TRACE_ENABLED: 'false', ...clean(env) },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@TEN03@@'));
  if (!line) throw new Error(`the run printed no result:\n${out.slice(-2000)}`);
  const r = JSON.parse(line.slice('@@TEN03@@'.length));
  return { response: r.response, error: r.error, calls: r.calls, tables: r.tables, cognito: r.cognito };
}

/** The back-fill script's run (AC-8): the real Python file, with ./fake-boto3 in place of boto3, over `tables`. */
export type ScriptRun = { code: number; stdout: string; stderr: string; tables: Tables; calls: { op: string; params: any; error: string | null }[] };
export const BACKFILL = join(REPO, 'scripts', 'backfill', 'lowercase-employee-emails.py');
/** AC-10: calls one function of scripts/ci/seed-dev.py (the real file, its main() not run) with a fake DynamoDB client that lets
 * conditional put_item and delete_item run, over `tables`. */
export const SEED = join(REPO, 'scripts', 'ci', 'seed-dev.py');
export const runSeed = (tables: Tables, fn: string, args: string[]): ScriptRun => runPython(SEED, tables, args, { allowWrites: true }, { REC061_CALL: fn });
export function runBackfill(tables: Tables, args: string[], fake: { race?: { employee_id: string; set: Row }[]; pageSize?: number; account?: string } = {}): ScriptRun {
  return runPython(BACKFILL, tables, args, { race: fake.race ?? [], pageSize: fake.pageSize ?? 3, account: fake.account ?? '000000000000' }, {});
}
function runPython(script: string, tables: Tables, args: string[], world: Record<string, unknown>, more: Record<string, string>): ScriptRun {
  const dir = mkdtempSync(join(tmpdir(), 'rec-06.1-py-'));
  const worldFile = join(dir, 'world.json');
  writeFileSync(worldFile, JSON.stringify({ tables, ...world }));
  const outFile = join(dir, 'out.json');
  let code = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync('python3', [join(__dirname, 'fake-boto3', 'run-script.py'), script, ...args], {
      cwd: dir, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env['PATH'] ?? '', REC061_WORLD: worldFile, REC061_OUT: outFile, AWS_REGION: 'af-south-1', AWS_DEFAULT_REGION: 'af-south-1', AWS_ACCESS_KEY_ID: 'rec061-fake', AWS_SECRET_ACCESS_KEY: 'rec061-fake', PYTHONDONTWRITEBYTECODE: '1', ...more },
    });
  } catch (e: any) {
    code = typeof e.status === 'number' ? e.status : 1;
    stdout = String(e.stdout ?? '');
    stderr = String(e.stderr ?? e.message ?? '');
  }
  let after: { tables: Tables; calls: ScriptRun['calls']; stderr?: string } = { tables, calls: [] };
  try { after = JSON.parse(readFileSync(outFile, 'utf8')); } catch { /* the runner wrote nothing: the script was not found or crashed first */ }
  return { code, stdout, stderr: stderr + (after.stderr ?? ''), tables: after.tables, calls: after.calls };
}
