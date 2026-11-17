import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * TEN-05: copied from ../ten-03/lambda-harness.ts. Runs the real code, each call in its own fresh Node process (a cold
 * Lambda), against a fake AWS (./fake-aws, copied from TEN-03's with code added only: Cognito's
 * AdminRemoveUserFromGroup and AdminDisableUser, and the pool's group list). Bedrock and any other AI client fail the
 * import or the call; outbound HTTP is recorded and refused. Nothing reaches AWS.
 *
 * Added here: runModule, which imports one shared module (lambda/shared/roles.mjs, hr-group.mjs, document-check.mjs)
 * in a fresh process and runs its exports step by step.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
export const LAMBDA = join(REPO, 'lambda');
const FAKE_AWS = join(__dirname, 'fake-aws');

export const ROLES_HELPER = join(LAMBDA, 'shared', 'roles.mjs');
export const HR_GROUP_HELPER = join(LAMBDA, 'shared', 'hr-group.mjs');
export const DOCUMENT_CHECK = join(LAMBDA, 'shared', 'document-check.mjs');

/** A row as DynamoDB stores it: attribute name -> AttributeValue. */
export type Row = Record<string, Record<string, unknown>>;
export type Tables = Record<string, Row[]>;
export type Call =
  | { service: 'dynamodb'; op: string; table?: string; input: any }
  | { service: 'cognito'; op: string; input: any }
  | { service: 'log'; level: string; message: string; extra?: unknown }
  | { service: string; op: string; input?: any };
export type PoolUser = { username: string; sub: string; enabled?: boolean; status?: string; attributes: Record<string, string>; groups: string[] };
export type Pool = { users: PoolUser[]; groups?: string[] };
export type Run = { response: any; error?: { name: string; message: string; stack: string }; calls: Call[]; tables: Tables; cognito: Pool };

/** The global secondary indexes Terraform declares (any table), so a Query on an index Terraform lacks fails. */
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

function node(args: string[], world: unknown, files: Record<string, unknown>, env: Record<string, string | undefined>) {
  const dir = mkdtempSync(join(tmpdir(), 'ten-05-'));
  const worldFile = join(dir, 'world.json');
  writeFileSync(worldFile, JSON.stringify(world));
  const paths: string[] = [];
  for (const [name, value] of Object.entries(files)) {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(value));
    paths.push(p);
  }
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  const out = execFileSync(process.execPath, ['--no-warnings', '--require', join(FAKE_AWS, 'cjs-hook.cjs'), '--import', join(FAKE_AWS, 'register.mjs'), ...args, ...paths], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env['PATH'] ?? '',
      TEN03_WORLD: worldFile,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'ten05-fake',
      AWS_SECRET_ACCESS_KEY: 'ten05-fake',
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
      ...clean,
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@TEN03@@'));
  if (!line) throw new Error(`the run printed no result:\n${out.slice(-2000)}`);
  return JSON.parse(line.slice('@@TEN03@@'.length));
}

/** Calls `handler` once with `event` in a fresh process. Only the settings given in `env` are set. */
export type Fail = { service: 'cognito' | 'dynamodb'; ops?: string[]; name?: string; message: string };
export function runHandler(handler: string, event: unknown, opts: { tables?: Tables; env?: Record<string, string | undefined>; cognito?: Pool; fail?: Fail } = {}): Run {
  const world = { indexes: INDEXES, tables: structuredClone(opts.tables ?? {}), secrets: {}, pageSize: 4, cognito: structuredClone(opts.cognito ?? { users: [] }), ...(opts.fail ? { fail: opts.fail } : {}) };
  const r = node([join(FAKE_AWS, 'run.mjs'), handler], world, { 'event.json': event }, opts.env ?? {});
  return { response: r.response, error: r.error, calls: r.calls, tables: r.tables, cognito: r.cognito };
}

export type Step = { fn: string; args?: unknown[] } | { get: string };
export type StepResult = { ok: boolean; value?: any; undefined?: boolean; type?: string; error?: { name: string; ctor: string; message: string } };
export type ModuleRun = { results: StepResult[]; exports: string[]; calls: Call[]; importError?: { name: string; message: string } };

/** Imports one shared module in a fresh process with exactly these settings, and runs the steps in order. */
export function runModule(file: string, steps: Step[], env: Record<string, string | undefined> = {}): ModuleRun {
  return node([join(FAKE_AWS, 'helper-run.mjs'), file], { tables: {} }, { 'steps.json': steps }, env);
}

/** Every call to an outside service; log lines left out. */
export function awsCalls(calls: Call[]): string[] {
  return calls.filter((c) => c.service !== 'log').map((c) => `${c.service} ${'op' in c ? c.op : ''}${'table' in c && c.table ? ' ' + c.table : ''}`);
}

/** An HTTP API (payload 2.0) event, with an authorizer as API Gateway hands it over. */
export function httpEvent(opts: { authorizer?: unknown; method?: string; query?: Record<string, string>; path?: Record<string, string>; headers?: Record<string, string>; body?: unknown }): any {
  const query = opts.query ?? {};
  const method = opts.method ?? 'GET';
  return {
    version: '2.0',
    routeKey: `${method} /v1/ten-05`,
    rawPath: '/v1/ten-05',
    rawQueryString: new URLSearchParams(query).toString(),
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    ...(Object.keys(query).length ? { queryStringParameters: query } : {}),
    ...(opts.path ? { pathParameters: opts.path } : {}),
    requestContext: {
      http: { method, path: '/v1/ten-05', protocol: 'HTTP/1.1', sourceIp: '198.51.100.17', userAgent: 'ten-05-acceptance' },
      routeKey: `${method} /v1/ten-05`,
      stage: '$default',
      ...(opts.authorizer === undefined ? {} : { authorizer: opts.authorizer }),
    },
    ...(opts.body === undefined ? {} : { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) }),
    isBase64Encoded: false,
  };
}
