import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAMBDA, REPO, httpEvent, type Failure, type ModelScript, type Row, type Run, type Tables } from '../chat-02/lambda-harness';

/**
 * CHAT-05: runs the real Lambdas, each call in its own fresh Node process (a cold Lambda), against a fake AWS (./fake-aws, copied
 * from CHAT-02's with code added only): the Agent API is a fake too (fetch.mjs, answers written by the test, every call recorded),
 * and a Query on an index pages the way DynamoDB does. Bedrock answers from a script the test wrote; a call with no script is
 * refused and recorded. Nothing reaches AWS, an outside host or any AI service.
 */
export { LAMBDA, REPO, httpEvent };
export type { Failure, ModelScript, Row, Run, Tables };

const FAKE_AWS = join(__dirname, 'fake-aws');

/** The Agent API as the chat Lambda sees it: the keys it accepts, and the answers by URL text (first match wins). */
export type FetchScript = {
  keys?: string[];
  rules?: { method?: string; url?: string; status?: number; json?: unknown }[];
  default?: { status?: number; json?: unknown };
};

/** The global secondary indexes Terraform declares, name -> key attributes, so a handler that Queries one still runs. */
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

export type RunOpts = {
  tables?: Tables;
  secrets?: Record<string, Record<string, string>>;
  env?: Record<string, string | undefined>;
  fail?: Failure;
  bedrock?: ModelScript;
  fetch?: FetchScript;
  /** Rows a Scan or Query reads in one page (default 4). */
  pageSize?: number;
};

/** Calls `handler` once with `event` in a fresh process. Only the settings given in `env` are set. */
export function runHandler(handler: string, event: unknown, opts: RunOpts = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'chat-05-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  const world = {
    indexes: INDEXES,
    tables: structuredClone(opts.tables ?? {}),
    secrets: opts.secrets ?? {},
    pageSize: opts.pageSize ?? 4,
    cognito: { users: [] },
    ...(opts.fail ? { fail: opts.fail } : {}),
    ...(opts.bedrock ? { bedrock: structuredClone(opts.bedrock) } : {}),
    ...(opts.fetch ? { fetch: structuredClone(opts.fetch) } : {}),
  };
  writeFileSync(worldFile, JSON.stringify(world));
  writeFileSync(eventFile, JSON.stringify(event));
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.env ?? {})) if (v !== undefined) clean[k] = v;
  const out = execFileSync(process.execPath, ['--no-warnings', '--require', join(FAKE_AWS, 'cjs-hook.cjs'), '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env['PATH'] ?? '',
      TEN03_WORLD: worldFile,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'chat05-fake',
      AWS_SECRET_ACCESS_KEY: 'chat05-fake',
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
      ...clean,
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@TEN03@@'));
  if (!line) throw new Error(`the run printed no result:\n${out.slice(-2000)}`);
  const r = JSON.parse(line.slice('@@TEN03@@'.length));
  return { response: r.response, error: r.error, calls: r.calls, tables: r.tables };
}
