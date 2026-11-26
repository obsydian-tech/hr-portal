import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PoolUser, Row, Run, Tables } from '../rec-14/lambda-harness';
import { REPO, type S3World } from '../rec-05/lambda-harness';

/**
 * REC-06: runs the real code in a fresh Node process per call (a cold Lambda) against this card's fake AWS (./fake-aws, copied from
 * ../rec-05/fake-aws with code added only: a transaction can be cancelled at a chosen item (world.failTransactItem), another request's
 * whole write can land just before this caller's transaction (world.landBeforeTransact), and a cancelled transaction carries its
 * reasons). Everything else is ../rec-05/lambda-harness.ts's way of running (same world file, same result line).
 */
export { REPO };
const FAKE_AWS = join(__dirname, 'fake-aws');

/** The global secondary indexes Terraform declares (any table), name -> key attributes, as ../rec-05/lambda-harness.ts reads them. */
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

/** world.fail: every matching call of that service throws after it is recorded (nth: only the nth one). */
export type Fail = { service: 'dynamodb' | 'events' | 's3'; ops?: string[]; message: string; name?: string; nth?: number };
export type Extra = {
  fail?: Fail;
  cognito?: { users: PoolUser[] };
  s3?: S3World;
  raceBeforeWrite?: { table: string; match: Row; replace: Row };
  /** Cancel the first transaction at item `index` (0 = the first item of TransactItems). */
  failTransactItem?: { index: number; times?: number };
  /** Another request's write lands just before this caller's first transaction: these tables' rows replace the world's. */
  landBeforeTransact?: { tables: Tables };
};

function worldOf(tables: Tables, extra: Extra) {
  return {
    indexes: INDEXES, tables: structuredClone(tables), secrets: {}, pageSize: 4, cognito: structuredClone(extra.cognito ?? { users: [] }),
    ...(extra.fail ? { fail: extra.fail } : {}), ...(extra.s3 ? { s3: structuredClone(extra.s3) } : {}),
    ...(extra.raceBeforeWrite ? { raceBeforeWrite: structuredClone(extra.raceBeforeWrite) } : {}),
    ...(extra.failTransactItem ? { failTransactItem: { ...extra.failTransactItem } } : {}),
    ...(extra.landBeforeTransact ? { landBeforeTransact: structuredClone(extra.landBeforeTransact) } : {}),
  };
}
const clean = (env: Record<string, string | undefined>) => Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as Record<string, string>;

/** Calls `handler` once with `event` in a fresh process. Only the settings given in `env` are set. */
export function runHandler(handler: string, event: unknown, tables: Tables, env: Record<string, string | undefined>, extra: Extra = {}): Run & { cognito?: { users: PoolUser[] } } {
  const dir = mkdtempSync(join(tmpdir(), 'rec-06-'));
  const worldFile = join(dir, 'world.json');
  writeFileSync(worldFile, JSON.stringify(worldOf(tables, extra)));
  const eventFile = join(dir, 'event.json');
  writeFileSync(eventFile, JSON.stringify(event));
  const out = execFileSync(process.execPath, ['--no-warnings', '--require', join(FAKE_AWS, 'cjs-hook.cjs'), '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir, encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
    env: { PATH: process.env['PATH'] ?? '', TEN03_WORLD: worldFile, AWS_REGION: 'af-south-1', AWS_ACCESS_KEY_ID: 'rec06-fake', AWS_SECRET_ACCESS_KEY: 'rec06-fake', POWERTOOLS_DEV: 'false', POWERTOOLS_TRACE_ENABLED: 'false', ...clean(env) },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@TEN03@@'));
  if (!line) throw new Error(`the run printed no result:\n${out.slice(-2000)}`);
  const r = JSON.parse(line.slice('@@TEN03@@'.length));
  return { response: r.response, error: r.error, calls: r.calls, tables: r.tables, cognito: r.cognito };
}
