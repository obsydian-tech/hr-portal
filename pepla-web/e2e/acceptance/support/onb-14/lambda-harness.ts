import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO, encrypted, openapiRoute, plain, row, type Row } from '../onb-15/lambda-harness';

/**
 * ONB-14: runs the real Lambdas of the card, each in its own fresh Node process (a cold Lambda), against a fake AWS
 * (./fake-aws, copied from ONB-15's): DynamoDB with writes and condition expressions honoured, KMS, EventBridge, CloudWatch
 * and Powertools. The fake bus can fail the ways the real one does (throw, FailedEntryCount, an ErrorCode, never answer),
 * the fake key can refuse a Decrypt, and every call is recorded in the order it happened, with a `response` marker where the
 * handler returned. The tables are given row by row as DynamoDB stores them and handed back after each run.
 *
 * Nothing reaches AWS; an AI client import fails the run. Needs nothing installed.
 */

export { REPO, encrypted, openapiRoute, plain, row };
export type { Row };
const LAMBDA = join(REPO, 'lambda');
export const REVEAL = join(LAMBDA, 'revealDocumentField', 'index.mjs');
export const GET_ONE = join(LAMBDA, 'getSingleDocumentVerification', 'index.mjs');
export const GET_PERSON = join(LAMBDA, 'getEmployeeDocumentVerifications', 'index.mjs');
export const AUDIT = join(LAMBDA, 'auditLogConsumer', 'index.mjs');
const FAKE_AWS = join(__dirname, 'fake-aws');

export type Tables = {
  employees: Row[];
  documents: Row[];
  'document-verification': Row[];
  'onboarding-events': Row[];
  'naleko-idempotency': Row[];
};

export type Call =
  | { service: 'dynamodb'; op: string; table?: string; input: any }
  | { service: 'events'; op: 'PutEvents'; accepted: boolean; bus?: string; source: string; detailType: string; detail: any }
  | { service: 'events'; op: 'ClientCreated'; requestTimeoutMs: number | null; maxAttempts: number | null }
  | { service: 'kms'; op: string; keyId?: string }
  | { service: 'cloudwatch'; op: string }
  | { service: 'response' }
  | { service: 'log'; level: string; message: string; extra?: unknown };

export type Run = {
  status: number;
  body: any;
  raw: string;
  headers: Record<string, string>;
  /** The handler printed no result: it never answered (killed at the run's time limit). */
  hung: boolean;
  elapsedMs: number;
  error?: { name: string; message: string; stack: string };
  calls: Call[];
  tables: Tables;
};

export type BusMode = 'ok' | 'throw' | 'failedCount' | 'failedCountOnly' | 'errorCodeOnly' | 'hang';

/** Two companies (TEN-01's id shape: ten_ and 26 lowercase letters or digits). */
export const TENANT_A = 'ten_01jcompanyaaaaaaaaaaaaaaaa';
export const TENANT_B = 'ten_01jcompanybbbbbbbbbbbbbbbb';

/**
 * Who calls. `jwt`: a signed-in person, with the claims the JWT authorizer hands over (`tenantId` null leaves the company
 * claim out; `tokenUse` 'access' is an access token). `agent`: the Agent API's authorizer, no token. `none`: no authorizer at all.
 */
export type Caller =
  | { kind: 'jwt'; email: string; groups: string[]; givenName?: string; familyName?: string; sub?: string; tenantId?: string | null; tokenUse?: string }
  | { kind: 'agent'; tenantId?: string }
  | { kind: 'none' };

export const ENV = {
  EVENT_BUS_NAME: 'naleko-onboarding',
  ENVIRONMENT: 'dev',
};

function token(claims: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'RS256', kid: 'onb-14' })}.${b(claims)}.c2lnbmF0dXJl`;
}

/** An HTTP API (payload 2.0) event, as API Gateway hands it over. */
export function eventFor(opts: {
  method: 'GET' | 'POST';
  route: string;
  path: string;
  id: string;
  caller: Caller;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
}): unknown {
  const { caller } = opts;
  const query = opts.query ?? {};
  const rawQueryString = new URLSearchParams(query).toString();
  let authorizer: unknown;
  let authorization: string | undefined;
  if (caller.kind === 'jwt') {
    const claims: Record<string, unknown> = {
      sub: caller.sub ?? 'sub-' + caller.email.toLowerCase().replace(/[^a-z]/g, ''),
      email: caller.email,
      email_verified: 'true',
      token_use: caller.tokenUse ?? 'id',
      iss: 'https://cognito-idp.af-south-1.amazonaws.com/af-south-1_Onb14Fake',
    };
    if (caller.tenantId !== null) claims['tenant_id'] = caller.tenantId ?? TENANT_A;
    if (caller.givenName !== undefined) claims['given_name'] = caller.givenName;
    if (caller.familyName !== undefined) claims['family_name'] = caller.familyName;
    // API Gateway passes a list claim as one string: "[hr_staff naleko-onboarding-hr]"
    if (caller.groups.length) claims['cognito:groups'] = `[${caller.groups.join(' ')}]`;
    authorizer = { jwt: { claims, scopes: null } };
    authorization = `Bearer ${token(claims)}`;
  } else if (caller.kind === 'agent') {
    authorizer = { lambda: { actor: 'AGENT', tenant_id: caller.tenantId ?? TENANT_A, keyId: 'agent-key-1' } };
  }
  const routeKey = `${opts.method} ${opts.route}`;
  return {
    version: '2.0',
    routeKey,
    rawPath: opts.path,
    rawQueryString,
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}), ...(opts.headers ?? {}) },
    ...(rawQueryString ? { queryStringParameters: query } : {}),
    pathParameters: { id: opts.id },
    requestContext: {
      http: { method: opts.method, path: opts.path, protocol: 'HTTP/1.1', sourceIp: '198.51.100.15', userAgent: 'onb-14-acceptance' },
      routeKey,
      stage: '$default',
      ...(authorizer ? { authorizer } : {}),
    },
    ...(opts.body === undefined ? {} : { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) }),
    isBase64Encoded: false,
  };
}

export type RunOptions = {
  /** Settings of the Lambda; undefined removes one of the defaults. */
  env?: Record<string, string | undefined>;
  bus?: BusMode;
  key?: 'ok' | 'fail';
  /** Wall-clock limit; a handler still running then counts as hung. */
  timeoutMs?: number;
};

/** Calls `handler` once with `event` in a fresh process against `tables`. */
export function runHandler(handler: string, tables: Partial<Tables>, event: unknown, opts: RunOptions = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'onb-14-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  const full: Tables = {
    employees: [], documents: [], 'document-verification': [], 'onboarding-events': [], 'naleko-idempotency': [],
    ...structuredClone(tables),
  };
  writeFileSync(worldFile, JSON.stringify({ tables: full, pageSize: 4, bus: opts.bus ?? 'ok', key: opts.key ?? 'ok' }));
  writeFileSync(eventFile, JSON.stringify(event));
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    ONB14_WORLD: worldFile,
    AWS_REGION: 'af-south-1',
    AWS_ACCESS_KEY_ID: 'onb14-fake',
    AWS_SECRET_ACCESS_KEY: 'onb14-fake',
    KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/onb-14-fake',
    KMS_KEY_ID: 'arn:aws:kms:af-south-1:000000000000:key/onb-14-fake',
    EMPLOYEES_TABLE: 'employees',
    DOCUMENTS_TABLE: 'documents',
    VERIFICATION_TABLE: 'document-verification',
    VERIFICATIONS_TABLE: 'document-verification',
    IDEMPOTENCY_TABLE: 'naleko-idempotency',
    LEGACY_TENANT_ID: TENANT_A,
    POWERTOOLS_DEV: 'false',
    POWERTOOLS_TRACE_ENABLED: 'false',
  };
  for (const [k, v] of Object.entries({ ...ENV, ...(opts.env ?? {}) })) if (v !== undefined) env[k] = v;
  const started = Date.now();
  const r = spawnSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 30_000,
    maxBuffer: 32 * 1024 * 1024,
    env,
  });
  const elapsedMs = Date.now() - started;
  const out = r.stdout ?? '';
  const line = out.split('\n').find((l) => l.startsWith('@@ONB14@@'));
  if (!line) {
    if (r.error || r.signal) {
      return { status: 0, body: null, raw: '', headers: {}, hung: true, elapsedMs, calls: [], tables: full };
    }
    throw new Error(`the handler printed no result:\n${out.slice(-2000)}\n${(r.stderr ?? '').slice(-2000)}`);
  }
  const result = JSON.parse(line.slice('@@ONB14@@'.length)) as { response?: any; error?: Run['error']; calls: Call[]; tables: Tables };
  const raw = typeof result.response?.body === 'string' ? result.response.body : JSON.stringify(result.response?.body ?? null);
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(result.response?.headers ?? {})) headers[k.toLowerCase()] = String(v);
  return { status: Number(result.response?.statusCode), body, raw, headers, hung: false, elapsedMs, error: result.error, calls: result.calls, tables: result.tables };
}

// ---------------------------------------------------------------- the routes

export type RevealBody = { field?: unknown; employee_id?: unknown; [extra: string]: unknown };

/** POST /v1/verifications/{id}/reveal. `body` is an object, or a raw string. */
export function reveal(tables: Partial<Tables>, documentId: string, caller: Caller, body: unknown, opts: RunOptions & { headers?: Record<string, string>; query?: Record<string, string> } = {}): Run {
  const { headers, query, ...rest } = opts;
  return runHandler(REVEAL, tables, eventFor({
    method: 'POST', route: '/v1/verifications/{id}/reveal', path: `/v1/verifications/${documentId}/reveal`, id: documentId, caller, body, headers, query,
  }), rest);
}

/** GET /v1/verifications/{id} (with ?employee_id= when given). */
export function getOne(tables: Partial<Tables>, documentId: string, caller: Caller, employeeId?: string, opts: RunOptions = {}): Run {
  return runHandler(GET_ONE, tables, eventFor({
    method: 'GET', route: '/v1/verifications/{id}', path: `/v1/verifications/${documentId}`, id: documentId, caller,
    query: employeeId ? { employee_id: employeeId } : undefined,
  }), opts);
}

/** GET /v1/employees/{id}/verifications. */
export function getPerson(tables: Partial<Tables>, employeeId: string, caller: Caller, opts: RunOptions = {}): Run {
  return runHandler(GET_PERSON, tables, eventFor({
    method: 'GET', route: '/v1/employees/{id}/verifications', path: `/v1/employees/${employeeId}/verifications`, id: employeeId, caller,
  }), opts);
}

/** The audit consumer, handed an event as EventBridge delivers it (the shape of one entry the Lambda put on the bus). */
export function audit(tables: Partial<Tables>, put: { source: string; detailType: string; detail: unknown }, opts: RunOptions = {}): Run {
  return runHandler(AUDIT, tables, {
    version: '0',
    id: 'a7c1d9f0-0000-4000-8000-0000000000e1',
    'detail-type': put.detailType,
    source: put.source,
    account: '000000000000',
    time: '2026-11-18T10:15:00Z',
    region: 'af-south-1',
    'event-bus-name': 'naleko-onboarding',
    resources: [],
    detail: put.detail,
  }, opts);
}

// ---------------------------------------------------------------- what a run did

export const WRITE_OPS = ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'];

export function dynamoCalls(run: Run): Array<Extract<Call, { service: 'dynamodb' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb');
}
export function writes(run: Run): string[] {
  return dynamoCalls(run).filter((c) => WRITE_OPS.includes(c.op)).map((c) => `${c.op} ${c.table}`);
}
/** The entries the bus accepted. */
export function published(run: Run, detailType?: string): Array<Extract<Call, { service: 'events'; op: 'PutEvents' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'events'; op: 'PutEvents' }> => c.service === 'events' && c.op === 'PutEvents' && c.accepted && (!detailType || c.detailType === detailType));
}
/** Every entry the handler tried to put, accepted or not. */
export function attempted(run: Run): Array<Extract<Call, { service: 'events'; op: 'PutEvents' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'events'; op: 'PutEvents' }> => c.service === 'events' && c.op === 'PutEvents');
}
export function kmsOps(run: Run): string[] {
  return run.calls.flatMap((c) => (c.service === 'kms' ? [c.op] : []));
}
/** Every call to an AWS service, in order; log lines, the client set-up and the response marker left out. */
export function awsCalls(run: Run): string[] {
  return run.calls.flatMap((c) => {
    if (c.service === 'log' || c.service === 'response') return [];
    if (c.service === 'events' && c.op === 'ClientCreated') return [];
    return [`${c.service} ${c.op}${'table' in c && c.table ? ' ' + c.table : ''}`];
  });
}
export function logLines(run: Run): string[] {
  return run.calls.flatMap((c) => (c.service === 'log' ? [`${c.message} ${c.extra === undefined ? '' : JSON.stringify(c.extra)}`] : []));
}
/** Position of the first call matching `pick` among all calls, or -1. */
export function at(run: Run, pick: (c: Call) => boolean): number {
  return run.calls.findIndex(pick);
}

/** The timeout the handler gave its bus client, in milliseconds (null when it gave none). */
export function busClientTimeout(run: Run): number | null {
  const c = run.calls.find((x) => x.service === 'events' && x.op === 'ClientCreated') as Extract<Call, { op: 'ClientCreated' }> | undefined;
  return c ? c.requestTimeoutMs : null;
}

/** What api/openapi.yaml says about one route (python3 + PyYAML): found, operation (x-tenant, x-roles, security, servers), responses, fields, keys, request. */
export function openapi14(path: string, method: string): {
  found: boolean;
  operation: { 'x-tenant'?: unknown; 'x-roles'?: string[]; security?: unknown; servers?: unknown[] };
  responses: string[];
  /** Every property name reachable from each response's schema, by status code. */
  fields: Record<string, string[]>;
  /** The same, with the path of properties above each name ("verification.extracted_data.id_number"). */
  keys: Record<string, string[]>;
  request: string[];
} {
  return JSON.parse(execFileSync('python3', ['-I', join(__dirname, 'openapi_route.py'), join(REPO, 'api', 'openapi.yaml'), path, method], { encoding: 'utf8' }));
}
