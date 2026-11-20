import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * CHAT-15: runs the real deleteLeaverChats handler once per call, each in a fresh Node process (a cold Lambda), against a fake AWS
 * (./fake-aws, copied from CHAT-02's with code added only: a Cognito pool that can fail for chosen people, deletes that DynamoDB
 * leaves behind or silently keeps, and a Lambda context that counts down the time left). Nothing here reaches AWS, Bedrock or any
 * AI service: any AI client fails its import, and outbound HTTP is refused and recorded.
 */
export const REPO = join(__dirname, '..', '..', '..', '..', '..');
export const LAMBDA = join(REPO, 'lambda');
export const HANDLER = join(LAMBDA, 'deleteLeaverChats', 'index.mjs');
const FAKE_AWS = join(__dirname, 'fake-aws');

/** A row as DynamoDB stores it: attribute name -> AttributeValue. */
export type Row = Record<string, Record<string, unknown>>;
export type Tables = Record<string, Row[]>;

export type Call =
  | { service: 'dynamodb'; op: string; table?: string; input: any }
  | { service: 'cognito'; op: string; input: any }
  | { service: 'log'; level: string; message: string; extra?: unknown }
  | { service: string; op?: string };
export type PoolUser = { username: string; sub: string; enabled?: boolean; status?: string; attributes: Record<string, string>; groups: string[] };
export type Run = { response: any; error?: { name: string; message: string; stack: string }; calls: Call[]; tables: Tables; cognito?: { users: PoolUser[] } };

/** Makes every matching fake call throw, after it is recorded. */
export type Failure = { service: 'dynamodb' | 'cognito'; ops?: string[]; message: string; name?: string };

export type Opts = {
  tables: Tables;
  users?: PoolUser[];
  env?: Record<string, string | undefined>;
  event?: unknown;
  fail?: Failure;
  /** Operation -> usernames it fails for (AdminGetUser failing for one person only). */
  failUsers?: Record<string, string[]>;
  failUsersMessage?: string;
  /** Chat partitions (pk) whose deletes DynamoDB hands back unprocessed every time. */
  stuck?: string[];
  /** Chat partitions (pk) whose deletes are answered as done and do nothing. */
  silentKeep?: string[];
  /** Milliseconds the Lambda has left, by the number of people marked so far (the last entry repeats). Default [300000]. */
  remaining?: number[];
  pageSize?: number;
};

/** One scheduled invocation, as EventBridge hands it over. */
export const scheduledEvent = () => ({
  version: '0', id: 'chat-15-event', 'detail-type': 'Scheduled Event', source: 'aws.events', account: '000000000000', time: '2026-11-19T20:00:00Z',
  region: 'af-south-1', resources: ['arn:aws:events:af-south-1:000000000000:rule/delete-leaver-chats'], detail: {},
});

export function runJob(opts: Opts): Run {
  const world = {
    indexes: {}, tables: structuredClone(opts.tables), secrets: {}, pageSize: opts.pageSize ?? 4, cognito: { users: structuredClone(opts.users ?? []) },
    ...(opts.fail ? { fail: opts.fail } : {}), ...(opts.failUsers ? { failUsers: opts.failUsers } : {}), ...(opts.failUsersMessage ? { failUsersMessage: opts.failUsersMessage } : {}),
    ...(opts.stuck ? { stuck: opts.stuck } : {}), ...(opts.silentKeep ? { silentKeep: opts.silentKeep } : {}), ...(opts.remaining ? { remaining: opts.remaining } : {}),
  };
  const dir = mkdtempSync(join(tmpdir(), 'chat-15-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify(world));
  writeFileSync(eventFile, JSON.stringify(opts.event ?? scheduledEvent()));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.env ?? {})) if (v !== undefined) env[k] = v;
  const out = execFileSync(process.execPath, ['--no-warnings', '--require', join(FAKE_AWS, 'cjs-hook.cjs'), '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), HANDLER, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
    env: {
      PATH: process.env['PATH'] ?? '',
      TEN03_WORLD: worldFile,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'chat15-fake',
      AWS_SECRET_ACCESS_KEY: 'chat15-fake',
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
      ...env,
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@TEN03@@'));
  if (!line) throw new Error(`the run printed no result:\n${out.slice(-2000)}`);
  const r = JSON.parse(line.slice('@@TEN03@@'.length));
  return { response: r.response, error: r.error, calls: r.calls, tables: r.tables, cognito: r.cognito };
}

/** Every call to an outside service, log lines left out. */
export const awsCalls = (calls: Call[]) => calls.filter((c) => c.service !== 'log') as Extract<Call, { op?: string }>[];
export function logLines(calls: Call[]): string[] {
  return calls
    .filter((c): c is Extract<Call, { service: 'log' }> => c.service === 'log')
    .map((c) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);
}
