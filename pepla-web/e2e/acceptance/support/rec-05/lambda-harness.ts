import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Failure, PoolUser, Row, Run, Tables } from '../rec-14/lambda-harness';

/**
 * REC-05: runs the real code in a fresh Node process per call (a cold Lambda) against this card's fake AWS (./fake-aws, copied from
 * ../rec-14/fake-aws with code added only: S3 HeadObject answers from world.s3, the URL signer records what an upload link is held to,
 * DynamoDB can refuse a caller's reads (world.denyReads) and can let another request win between a read and a write
 * (world.raceBeforeWrite)). The rest is ../rec-14/lambda-harness.ts's way of running (same world file, same result line).
 */
export const REPO = join(__dirname, '..', '..', '..', '..', '..');
export const LAMBDA = join(REPO, 'lambda');
const FAKE_AWS = join(__dirname, 'fake-aws');

/** The global secondary indexes Terraform declares (any table), name -> key attributes, as ../rec-14/lambda-harness.ts reads them. */
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

export type S3World = { bucket: string; objects: Record<string, { size: number; contentType: string }> };
export type Extra = {
  fail?: Failure;
  cognito?: { users: PoolUser[] };
  s3?: S3World;
  denyReads?: { table: string; pk?: string; sk?: string }[];
  raceBeforeWrite?: { table: string; match: Row; replace: Row };
  sts?: { Account: string; Arn: string; UserId?: string };
};

function worldOf(tables: Tables, extra: Extra) {
  return {
    indexes: INDEXES, tables: structuredClone(tables), secrets: {}, pageSize: 4, cognito: structuredClone(extra.cognito ?? { users: [] }),
    ...(extra.fail ? { fail: extra.fail } : {}), ...(extra.s3 ? { s3: structuredClone(extra.s3) } : {}), ...(extra.denyReads ? { denyReads: extra.denyReads } : {}),
    ...(extra.raceBeforeWrite ? { raceBeforeWrite: structuredClone(extra.raceBeforeWrite) } : {}), ...(extra.sts ? { sts: extra.sts } : {}),
  };
}
const clean = (env: Record<string, string | undefined>) => Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as Record<string, string>;

/** Calls `handler` once with `event` in a fresh process. Only the settings given in `env` are set. */
export function runHandler(handler: string, event: unknown, tables: Tables, env: Record<string, string | undefined>, extra: Extra = {}): Run & { cognito?: { users: PoolUser[] } } {
  const dir = mkdtempSync(join(tmpdir(), 'rec-05-'));
  const worldFile = join(dir, 'world.json');
  writeFileSync(worldFile, JSON.stringify(worldOf(tables, extra)));
  const eventFile = join(dir, 'event.json');
  writeFileSync(eventFile, JSON.stringify(event));
  const out = execFileSync(process.execPath, ['--no-warnings', '--require', join(FAKE_AWS, 'cjs-hook.cjs'), '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir, encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
    env: { PATH: process.env['PATH'] ?? '', TEN03_WORLD: worldFile, AWS_REGION: 'af-south-1', AWS_ACCESS_KEY_ID: 'rec05-fake', AWS_SECRET_ACCESS_KEY: 'rec05-fake', POWERTOOLS_DEV: 'false', POWERTOOLS_TRACE_ENABLED: 'false', ...clean(env) },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@TEN03@@'));
  if (!line) throw new Error(`the run printed no result:\n${out.slice(-2000)}`);
  const r = JSON.parse(line.slice('@@TEN03@@'.length));
  return { response: r.response, error: r.error, calls: r.calls, tables: r.tables, cognito: r.cognito };
}

/** Runs a Node script (scripts/recruitment/migrate-offers.mjs) once against the fake AWS: exit code, output, calls, writes, the tables after. */
export function runScript(script: string, args: string[], tables: Tables, extra: Extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rec-05-script-'));
  const worldFile = join(dir, 'world.json');
  writeFileSync(worldFile, JSON.stringify({ ...worldOf(tables, extra), pageSize: 3, queryPageSize: 2 }));
  let code = 0;
  let stdout = '';
  let stderr = '';
  try {
    stdout = execFileSync(process.execPath, ['--no-warnings', '--require', join(FAKE_AWS, 'cjs-hook.cjs'), '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'script-run.mjs'), script, ...args], {
      cwd: dir, encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024,
      env: { PATH: `${join(FAKE_AWS, 'bin')}:${process.env['PATH'] ?? ''}`, TEN03_WORLD: worldFile, TEN03_WORLD_OUT: join(dir, 'after.json'), AWS_REGION: 'af-south-1', AWS_ACCESS_KEY_ID: 'rec05-fake', AWS_SECRET_ACCESS_KEY: 'rec05-fake' },
    });
  } catch (e: any) {
    code = e.status ?? 1;
    stdout = String(e.stdout ?? '');
    stderr = String(e.stderr ?? '');
  }
  const after = existsSync(join(dir, 'after.json')) ? JSON.parse(readFileSync(join(dir, 'after.json'), 'utf8')) : { tables, calls: [] };
  const calls = (after.calls ?? []) as any[];
  const writes = calls.filter((c) => c.service === 'dynamodb' && /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems/.test(c.op));
  return { code, stdout, stderr, tables: after.tables as Tables, calls, writes };
}
