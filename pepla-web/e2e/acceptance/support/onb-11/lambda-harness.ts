import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ONB-11 · Runs the real Lambdas this card changes (classifyOnboardingRisk, processDocumentOCR,
 * getEmployeeDocumentVerifications, getEmployee), each in its own fresh Node process (a cold Lambda), against a fake
 * AWS (./fake-aws, copied from ONB-09's): DynamoDB with writes and condition expressions honoured, a Query on the
 * `employeeId-index` that answers in pages, S3, EventBridge, KMS, Textract and Bedrock as recording fakes, and Step
 * Functions that records each task-token call with its token and refuses a token already spent.
 *
 * Every call is recorded, every console line is a recorded log line, and every outside HTTP call is recorded and
 * refused. Nothing reaches AWS or any AI service. The world (tables, files, what the model answers) is given as
 * data; after each run the tables are taken back with the handler's writes, so the next run starts where the last
 * one stopped. Needs nothing installed.
 *
 * Unlike ONB-09's copy, no company is added for the test: each event carries its own `tenant_id` claim (or none, as
 * the Step Functions event has none) and each test sets LEGACY_TENANT_ID itself.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
const LAMBDA = join(REPO, 'lambda');
export const CLASSIFY = join(LAMBDA, 'classifyOnboardingRisk', 'index.mjs');
export const OCR = join(LAMBDA, 'processDocumentOCR', 'index.mjs');
export const PERSON = join(LAMBDA, 'getEmployeeDocumentVerifications', 'index.mjs');
export const GET_EMPLOYEE = join(LAMBDA, 'getEmployee', 'index.mjs');
export const BATCH_REPORT = join(LAMBDA, 'getBatchRiskReport', 'index.mjs');
export const RISK_SUMMARY = join(LAMBDA, 'shared', 'risk-summary.mjs');
const FAKE_AWS = join(__dirname, 'fake-aws');

/** Companies: ids as TEN-01 makes them (`ten_` and 26 lower-case letters or digits). */
export const COMPANY_A = 'ten_' + 'a'.repeat(26);
export const COMPANY_B = 'ten_' + 'b'.repeat(26);
/** The founding company, as LEGACY_TENANT_ID names it while the legacy rule is on. */
export const FOUNDING = 'ten_founding000000000000000000';

/** A row as DynamoDB stores it: attribute name -> AttributeValue. */
export type Row = Record<string, Record<string, unknown>>;

/** Plain values to a stored row (strings, numbers, booleans; undefined left out). */
export function row(values: Record<string, string | number | boolean | undefined | null>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    out[k] = v === null ? { NULL: true } : typeof v === 'number' ? { N: String(v) } : typeof v === 'boolean' ? { BOOL: v } : { S: v };
  }
  return out;
}

/** Plain values of a stored row. */
export function plain(r: Row | undefined): Record<string, unknown> | undefined {
  if (!r) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, a] of Object.entries(r)) out[k] = 'S' in a ? a['S'] : 'N' in a ? Number(a['N']) : 'BOOL' in a ? a['BOOL'] : 'NULL' in a ? null : a;
  return out;
}

export type Tables = { employees: Row[]; documents: Row[]; 'document-verification': Row[] };
export type Failure = { op: string; table: string; mentions?: string };
export type World = {
  tables: Tables;
  /** "bucket/key" -> the file, base64. */
  s3?: Record<string, string>;
  /** What Textract reads: lines of text, or the name of the error it throws for an unreadable file. */
  textract?: { lines?: string[]; error?: string };
  /** What the model answers (an object, or the text itself). */
  model?: unknown;
  /** The model fails with this error name (Bedrock unavailable, use case form missing, ...). */
  modelFails?: string;
  /** Rows per Query page. */
  pageSize?: number;
  /** Task tokens already used or timed out: Step Functions refuses them. */
  spentTokens?: string[];
  /** DynamoDB calls that fail with a 500. */
  fail?: Failure[];
};

export type Call =
  | { service: 'dynamodb'; op: string; table?: string; input: any }
  | { service: 'textract' | 'bedrock'; op: string; reached: boolean; input: any }
  | { service: 's3'; op: string; key: string }
  | { service: 'events'; op: 'PutEvents'; bus?: string; source: string; detailType: string; detail: any }
  | { service: 'sfn'; op: string; token?: string; output?: any; input?: any }
  | { service: 'postmark'; op: string; message: unknown }
  | { service: 'http'; op: string }
  | { service: 'cloudwatch' | 'kms'; op: string }
  | { service: 'log'; level: string; message: string; extra?: unknown };

export type Run = {
  /** What the handler returned. */
  response: any;
  /** response.statusCode, when there is one. */
  status: number;
  /** The response body, parsed when it is JSON text. */
  body: any;
  raw: string;
  /** What the handler threw (a flow call that fails throws, so Step Functions can retry or catch it). */
  error?: { name: string; message: string; stack: string };
  calls: Call[];
  /** The world after the run (tables with the handler's writes). */
  world: World;
};

export const ENV = {
  EVENT_BUS_NAME: 'naleko-onboarding',
  HR_EMAIL: 'people-team@kestrel-foods.co.za',
  UPLOAD_BUCKET: 'document-ocr-verification-uploads-onb11',
  ENVIRONMENT: 'dev',
  AI_CALLS_ENABLED: 'true',
};

/** Calls `handler` once with `event` in a fresh process against `world`. `env` entries set to undefined are removed. */
export function runHandler(handler: string, world: World, event: unknown, env: Record<string, string | undefined> = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'onb-11-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify({ pageSize: 4, ...structuredClone(world) }));
  writeFileSync(eventFile, JSON.stringify(event));
  const settings: Record<string, string | undefined> = {
    PATH: process.env['PATH'] ?? '',
    ONB11_WORLD: worldFile,
    AWS_REGION: 'af-south-1',
    AWS_ACCESS_KEY_ID: 'onb11-fake',
    AWS_SECRET_ACCESS_KEY: 'onb11-fake',
    KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/onb-11-fake',
    KMS_KEY_ID: 'arn:aws:kms:af-south-1:000000000000:key/onb-11-fake',
    EMPLOYEES_TABLE: 'employees',
    DOCUMENTS_TABLE: 'documents',
    VERIFICATION_TABLE: 'document-verification',
    VERIFICATIONS_TABLE: 'document-verification',
    POSTMARK_API_TOKEN: 'onb11-fake-postmark-token',
    POWERTOOLS_DEV: 'false',
    POWERTOOLS_TRACE_ENABLED: 'false',
    ...ENV,
    ...env,
  };
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) if (v !== undefined) clean[k] = v;
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    env: clean,
  });
  const line = out.split('\n').find((l) => l.startsWith('@@ONB11@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  const result = JSON.parse(line.slice('@@ONB11@@'.length)) as { response?: any; error?: Run['error']; calls: Call[]; tables: Tables; spentTokens: string[] };
  const r = result.response;
  const rawBody = r && typeof r === 'object' && 'body' in r ? r.body : undefined;
  const raw = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody ?? null);
  let body: unknown = rawBody ?? null;
  if (typeof rawBody === 'string') {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = rawBody;
    }
  }
  return { response: r, status: Number(r?.statusCode), body, raw, error: result.error, calls: result.calls, world: { ...world, tables: result.tables, spentTokens: result.spentTokens }, };
}

// ---------------------------------------------------------------- events

/**
 * Who calls through API Gateway: a signed-in person (the ID token claims the JWT authorizer hands over, with the
 * company the pre-token trigger puts in `tenant_id`), or the Agent API (the Lambda authorizer's context).
 */
export type Caller =
  | { kind: 'jwt'; email: string; groups: string[]; tenant?: string; sub?: string; emailVerified?: boolean }
  | { kind: 'agent'; tenant: string };

function token(claims: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'RS256', kid: 'onb-11' })}.${b(claims)}.c2lnbmF0dXJl`;
}

/** An HTTP API (payload 2.0) event, as API Gateway hands it over. `extra` is merged into the event after it is built. */
export function webEvent(opts: {
  method: 'GET' | 'POST';
  route: string;
  path: string;
  id: string;
  caller: Caller;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  extra?: Record<string, unknown>;
}): Record<string, any> {
  const { caller } = opts;
  let authorizer: unknown;
  let authorization: string | undefined;
  if (caller.kind === 'jwt') {
    const claims: Record<string, unknown> = {
      sub: caller.sub ?? 'sub-' + caller.email.toLowerCase().replace(/[^a-z]/g, ''),
      email: caller.email,
      email_verified: caller.emailVerified === false ? 'false' : 'true',
      token_use: 'id',
      iss: 'https://cognito-idp.af-south-1.amazonaws.com/af-south-1_Onb11Fake',
      ...(caller.tenant ? { tenant_id: caller.tenant } : {}),
    };
    if (caller.groups.length) claims['cognito:groups'] = `[${caller.groups.join(' ')}]`;
    authorizer = { jwt: { claims, scopes: null } };
    authorization = `Bearer ${token(claims)}`;
  } else {
    authorizer = { lambda: { actor: 'AGENT', tenant_id: caller.tenant } };
  }
  const routeKey = `${opts.method} ${opts.route}`;
  const query = opts.query ?? {};
  const rawQueryString = new URLSearchParams(query).toString();
  return {
    version: '2.0',
    routeKey,
    rawPath: opts.path,
    rawQueryString,
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}), ...(opts.headers ?? {}) },
    ...(rawQueryString ? { queryStringParameters: query } : {}),
    pathParameters: { id: opts.id },
    requestContext: {
      http: { method: opts.method, path: opts.path, protocol: 'HTTP/1.1', sourceIp: '198.51.100.15', userAgent: 'onb-11-acceptance' },
      routeKey,
      stage: '$default',
      authorizer,
    },
    ...(opts.body === undefined ? {} : { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) }),
    isBase64Encoded: false,
    ...(opts.extra ?? {}),
  };
}

/** POST /v1/employees/{id}/assess-risk (the web route, and the Agent API's route for the same Lambda). */
export function assessEvent(id: string, caller: Caller, opts: { body?: unknown; headers?: Record<string, string>; query?: Record<string, string>; extra?: Record<string, unknown> } = {}): Record<string, any> {
  return webEvent({ method: 'POST', route: '/v1/employees/{id}/assess-risk', path: `/v1/employees/${encodeURIComponent(id)}/assess-risk`, id, caller, ...opts });
}

/** GET /v1/employees/{id}/verifications through the real getEmployeeDocumentVerifications. */
export function personEvent(id: string, caller: Caller): Record<string, any> {
  return webEvent({ method: 'GET', route: '/v1/employees/{id}/verifications', path: `/v1/employees/${encodeURIComponent(id)}/verifications`, id, caller });
}

/** GET /agent/v1/employees/{id} through the real getEmployee. */
export function agentEmployeeEvent(id: string, caller: Caller): Record<string, any> {
  return webEvent({ method: 'GET', route: '/agent/v1/employees/{id}', path: `/agent/v1/employees/${encodeURIComponent(id)}`, id, caller });
}

/** The marker the state machine sends: what Step Functions' Lambda task hands the Lambda (no requestContext). */
export const FLOW_SOURCE = 'naleko.onboarding-flow';

/** Exactly what the state machine sends: `{ source, employeeId }`. Extra keys are added only by a test about them. */
export function flowEvent(employeeId: unknown, extra: Record<string, unknown> = {}): Record<string, any> {
  return { source: FLOW_SOURCE, employeeId, ...extra };
}

/** The S3 ObjectCreated:Put event the upload bucket sends processDocumentOCR (key URL-encoded, as S3 does). */
export function s3Event(key: string, bucket = ENV.UPLOAD_BUCKET): unknown {
  return {
    Records: [{
      eventVersion: '2.1',
      eventSource: 'aws:s3',
      awsRegion: 'af-south-1',
      eventTime: '2026-11-18T08:00:00.000Z',
      eventName: 'ObjectCreated:Put',
      s3: {
        s3SchemaVersion: '1.0',
        bucket: { name: bucket, arn: `arn:aws:s3:::${bucket}` },
        object: { key: encodeURIComponent(key).replace(/%2F/g, '/').replace(/%20/g, '+'), size: 1024, eTag: 'onb11' },
      },
    }],
  };
}

// ---------------------------------------------------------------- what a run did

export const WRITE_OPS = ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'];

export function dynamoCalls(run: Run): Array<Extract<Call, { service: 'dynamodb' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb');
}

/** Every write the run asked for on a table (succeeded or refused by its condition), TransactWriteItems unpacked. */
export function writesTo(run: Run, tableName: string): Array<{ op: string; input: any }> {
  const out: Array<{ op: string; input: any }> = [];
  for (const c of dynamoCalls(run)) {
    if (!WRITE_OPS.includes(c.op)) continue;
    if (c.op === 'TransactWriteItems') {
      for (const t of c.input.TransactItems ?? []) {
        const [kind, i] = Object.entries(t)[0] as [string, any];
        if (i.TableName === tableName && kind !== 'ConditionCheck') out.push({ op: kind, input: i });
      }
    } else if (c.op === 'BatchWriteItem') {
      for (const r of c.input.RequestItems?.[tableName] ?? []) out.push({ op: r.PutRequest ? 'Put' : 'Delete', input: r });
    } else if (c.table === tableName) out.push({ op: c.op, input: c.input });
  }
  return out;
}

export function published(run: Run, detailType?: string): Array<Extract<Call, { service: 'events' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'events' }> => c.service === 'events' && (!detailType || c.detailType === detailType));
}

/** Every call that reached a (fake) AI service past the guard. */
export function aiReached(run: Run): string[] {
  return run.calls.filter((c): c is Extract<Call, { service: 'textract' | 'bedrock' }> => (c.service === 'textract' || c.service === 'bedrock') && c.reached).map((c) => c.service);
}

/** Every attempt at an AI service, even one the guard then refused. */
export function aiAttempts(run: Run): Array<Extract<Call, { service: 'textract' | 'bedrock' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'textract' | 'bedrock' }> => c.service === 'textract' || c.service === 'bedrock');
}

export function modelCalls(run: Run): Array<Extract<Call, { service: 'bedrock' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'bedrock' }> => c.service === 'bedrock' && c.reached);
}

/** The prompt the model was given, as text (the user message of the InvokeModel body). */
export function promptOf(call: Extract<Call, { service: 'bedrock' }>): string {
  const body = typeof call.input?.body === 'string' ? JSON.parse(call.input.body) : call.input?.body;
  const m = body?.messages?.[0]?.content;
  return typeof m === 'string' ? m : JSON.stringify(m ?? '');
}

export function sfnCalls(run: Run): Array<Extract<Call, { service: 'sfn' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'sfn' }> => c.service === 'sfn');
}

export function logText(run: Run): string {
  return run.calls.filter((c): c is Extract<Call, { service: 'log' }> => c.service === 'log').map((c) => `${c.message} ${c.extra === undefined ? '' : JSON.stringify(c.extra)}`).join('\n');
}

export function httpCalls(run: Run): string[] {
  return run.calls.filter((c): c is Extract<Call, { service: 'http' }> => c.service === 'http').map((c) => c.op);
}

/** The stored employees row, plain. */
export function personOf(world: World, id: string): Record<string, unknown> | undefined {
  return plain(world.tables.employees.find((r) => (r['employee_id'] as { S?: string })?.S === id));
}
