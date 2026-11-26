import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PoolUser, Row, Tables } from '../rec-14/lambda-harness';
import { REPO } from '../rec-05/lambda-harness';

/**
 * REC-16: runs the new Lambda (lambda/notifyHiringManagerOnHire) in a fresh Node process per call (a cold Lambda) against this card's
 * fake AWS (./fake-aws, copied from ../rec-06/fake-aws with code added only: Postmark answers the way the real postmark 4.0.5 client
 * does on a sent email, a refused one, a timeout, a dropped connection and an answer with no MessageID (world.postmark), another run's
 * guard row can land just before this run's first write (world.landBeforeWrite), and load.mjs loads a handler without calling it).
 * Nothing reaches AWS, Postmark or any AI.
 */
export { REPO };
const FAKE_AWS = join(__dirname, 'fake-aws');
export const LAMBDA_DIR = join(REPO, 'lambda', 'notifyHiringManagerOnHire');
/** The handler file (index.mjs, or index.js), or the place index.mjs would be when the folder does not exist yet. */
export function handlerFile(): string {
  for (const f of ['index.mjs', 'index.js']) if (existsSync(join(LAMBDA_DIR, f))) return join(LAMBDA_DIR, f);
  return join(LAMBDA_DIR, 'index.mjs');
}

export type PostmarkMode = 'ok' | 'answered' | 'answered401' | 'timeout' | 'dropped' | 'noMessageId';
export type Fail = { service: 'dynamodb' | 'cognito'; ops?: string[]; message: string; name?: string; nth?: number };
export type Extra = {
  /** Postmark's answer to the 1st, 2nd ... send ('ok' after the list). */
  postmark?: PostmarkMode[];
  fail?: Fail;
  /** Rows another run writes just before this run's first write to `table`. */
  landBeforeWrite?: { table: string; rows: Row[] };
  cognitoFail?: string[];
};
export type Run = { response?: unknown; error?: { name?: string; message: string; stack?: string }; calls: any[]; tables: Tables };

const clean = (env: Record<string, string | undefined>) => Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as Record<string, string>;
function exec(script: string, args: (string | object)[], world: unknown, env: Record<string, string | undefined>) {
  const dir = mkdtempSync(join(tmpdir(), 'rec-16-'));
  const worldFile = join(dir, 'world.json');
  writeFileSync(worldFile, JSON.stringify(world));
  const files = args.map((a, i) => {
    if (typeof a === 'string') return a;
    const f = join(dir, `arg${i}.json`);
    writeFileSync(f, JSON.stringify(a));
    return f;
  });
  const out = execFileSync(process.execPath, ['--no-warnings', '--require', join(FAKE_AWS, 'cjs-hook.cjs'), '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, script), ...files], {
    cwd: dir, encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
    env: { PATH: process.env['PATH'] ?? '', TEN03_WORLD: worldFile, AWS_REGION: 'af-south-1', AWS_ACCESS_KEY_ID: 'rec16-fake', AWS_SECRET_ACCESS_KEY: 'rec16-fake', POWERTOOLS_DEV: 'false', POWERTOOLS_TRACE_ENABLED: 'false', ...clean(env) },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@TEN03@@'));
  if (!line) throw new Error(`the run printed no result:\n${out.slice(-2000)}`);
  return JSON.parse(line.slice('@@TEN03@@'.length));
}

/** Calls the handler once with `event` in a fresh process. Only the settings given in `env` are set. */
export function runHandler(event: unknown, tables: Tables, env: Record<string, string | undefined>, users: PoolUser[], extra: Extra = {}): Run {
  const world = {
    tables: structuredClone(tables), secrets: {}, pageSize: 4, cognito: { users: structuredClone(users) },
    postmark: { modes: extra.postmark ?? [] },
    ...(extra.fail ? { fail: extra.fail } : {}), ...(extra.cognitoFail ? { cognitoFail: extra.cognitoFail } : {}),
    ...(extra.landBeforeWrite ? { landBeforeWrite: structuredClone(extra.landBeforeWrite) } : {}),
  };
  const r = exec('run.mjs', [handlerFile(), event as object], world, env);
  return { response: r.response, error: r.error, calls: r.calls, tables: r.tables };
}

/** Loads the handler file once with these settings and calls nothing. */
export function loadOnly(tables: Tables, env: Record<string, string | undefined>): { loaded?: boolean; error?: { name?: string; message: string }; calls: any[] } {
  return exec('load.mjs', [handlerFile()], { tables: structuredClone(tables), secrets: {}, cognito: { users: [] }, postmark: { modes: [] } }, env);
}
