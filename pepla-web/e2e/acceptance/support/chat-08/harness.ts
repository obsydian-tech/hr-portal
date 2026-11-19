import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LAMBDA, REPO, httpEvent, type ModelScript, type Run, type Tables } from '../chat-02/lambda-harness';
import type { FetchScript } from '../chat-05/harness';

/**
 * CHAT-08: CHAT-09's harness (../chat-09/harness.ts, locked) copied with one change: the model is this folder's
 * fake-aws/bedrock-turns.mjs (CHAT-02's scripted model plus a message that holds text and several lookups at once).
 * The run (../chat-09/fake-aws/run.mjs: a fixed clock and a fetch that can fail) and CHAT-05's fake AWS are used as they are.
 *
 * CHAT-09's text follows. CHAT-09: runs the real Lambdas, each call in its own fresh Node process (a cold Lambda), against CHAT-05's fake AWS
 * (../chat-05/fake-aws, used as it is) with this folder's run.mjs (a fixed clock) and fetch.mjs (a call can fail as a network
 * failure). The Agent API is a fake: the answers are the ones the test wrote, every call is recorded. Bedrock answers from a script
 * the test wrote; a call with no script is refused and recorded. Nothing reaches AWS, an outside host or any AI service.
 */
export { LAMBDA, REPO, httpEvent };
export type { ModelScript, Run, Tables };

const CHAT05_AWS = join(__dirname, '..', 'chat-05', 'fake-aws');
const CHAT09_AWS = join(__dirname, '..', 'chat-09', 'fake-aws');
const HERE_AWS = join(__dirname, 'fake-aws');

/** One Agent API rule. `fail: true` makes the call fail as a network failure. */
export type FetchRule = { method?: string; url?: string; status?: number; json?: unknown; fail?: boolean };
export type Fetch = Omit<FetchScript, 'rules'> & { rules?: FetchRule[] };

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
  bedrock?: ModelScript;
  fetch?: Fetch;
  /** The fixed clock of the run, an ISO time. */
  now?: string;
  /** Rows a Scan or Query reads in one page (default 4). */
  pageSize?: number;
};

/** Calls `handler` once with `event` in a fresh process. Only the settings given in `env` are set. */
export function runHandler(handler: string, event: unknown, opts: RunOpts = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'chat-08-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  const world = {
    indexes: INDEXES,
    tables: structuredClone(opts.tables ?? {}),
    secrets: opts.secrets ?? {},
    pageSize: opts.pageSize ?? 4,
    cognito: { users: [] },
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.bedrock ? { bedrock: structuredClone(opts.bedrock) } : {}),
    ...(opts.fetch ? { fetch: structuredClone(opts.fetch) } : {}),
  };
  writeFileSync(worldFile, JSON.stringify(world));
  writeFileSync(eventFile, JSON.stringify(event));
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.env ?? {})) if (v !== undefined) clean[k] = v;
  const out = execFileSync(process.execPath, ['--no-warnings', '--require', join(CHAT05_AWS, 'cjs-hook.cjs'), '--import', join(HERE_AWS, 'register.mjs'), join(CHAT09_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      PATH: process.env['PATH'] ?? '',
      TEN03_WORLD: worldFile,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'chat08-fake',
      AWS_SECRET_ACCESS_KEY: 'chat08-fake',
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
      TZ: 'UTC',
      ...clean,
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@TEN03@@'));
  if (!line) throw new Error(`the run printed no result:\n${out.slice(-2000)}`);
  const r = JSON.parse(line.slice('@@TEN03@@'.length));
  return { response: r.response, error: r.error, calls: r.calls, tables: r.tables };
}
