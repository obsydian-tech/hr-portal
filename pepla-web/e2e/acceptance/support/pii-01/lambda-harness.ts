import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * PII-01 · Runs the real `lambda/summariseVerification` handler in a fresh Node process (a cold Lambda) against a fake
 * AWS (./fake-aws, copied from ONB-11's): DynamoDB with condition expressions honoured, and a recording Bedrock whose
 * InvokeModel body the test reads. Every call is recorded, every console line is a recorded log line, and every outside
 * HTTP call is recorded and refused. Nothing reaches AWS or any AI service. Needs nothing installed.
 *
 * Two additions to ONB-11's copy:
 *  - `redactor`: swaps `lambda/shared/pii-redact.mjs` for a broken stand-in (throws, misses 12-digit runs, does nothing,
 *    or a last check that throws), only inside the harness, to prove the handler fails closed (AC-6).
 *  - `world.modelFailMessage`: the service text of a Bedrock error, so a test can plant a number in it (AC-9).
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
const LAMBDA = join(REPO, 'lambda');
export const SUMMARY = join(LAMBDA, 'summariseVerification', 'index.mjs');
export const SHARED = join(LAMBDA, 'shared');
export const REDACT = join(SHARED, 'pii-redact.mjs');
const FAKE_AWS = join(__dirname, 'fake-aws');

export const COMPANY_A = 'ten_' + 'a'.repeat(26);
export const COMPANY_B = 'ten_' + 'b'.repeat(26);

/** A row as DynamoDB stores it: attribute name -> AttributeValue. */
export type Row = Record<string, Record<string, unknown>>;

/** Plain values to a stored row (strings, numbers, booleans; `{ N: '...' }` objects are kept as they are). */
export function row(values: Record<string, string | number | boolean | undefined | { N: string }>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'object' ? v : typeof v === 'number' ? { N: String(v) } : typeof v === 'boolean' ? { BOOL: v } : { S: v };
  }
  return out;
}

export type World = {
  tables: { employees: Row[]; documents: Row[]; 'document-verification': Row[] };
  /** What the model answers (the text itself). */
  model?: string;
  /** The model fails with this error name (Bedrock unavailable, throttled, ...). */
  modelFails?: string;
  /** The service text of that error. */
  modelFailMessage?: string;
};

export type Call =
  | { service: 'dynamodb'; op: string; table?: string; input: any }
  | { service: 'textract' | 'bedrock'; op: string; reached: boolean; input: any }
  | { service: 's3' | 'sfn' | 'events' | 'postmark' | 'cloudwatch' | 'kms'; op: string }
  | { service: 'http'; op: string }
  | { service: 'log'; level: string; message: string; extra?: unknown };

export type Redactor = 'throw' | 'miss12' | 'identity' | 'check-throws' | 'old-separators';

export type Run = {
  status: number;
  body: any;
  raw: string;
  error?: { name: string; message: string; stack: string };
  calls: Call[];
};

export const ENV = {
  VERIFICATIONS_TABLE: 'document-verification',
  ENVIRONMENT: 'dev',
  AI_CALLS_ENABLED: 'true',
  BEDROCK_MODEL_ID: 'fake-model',
};

/** The world with one table of verification rows and the other two empty. */
export function worldOf(rows: Row[], extra: Partial<World> = {}): World {
  return { tables: { employees: [], documents: [], 'document-verification': rows }, model: 'The fake model answers this.', ...extra };
}

/** Calls the handler once with `event` in a fresh process against `world`. `env` entries set to undefined are removed. */
export function runSummary(world: World, event: unknown, opts: { env?: Record<string, string | undefined>; redactor?: Redactor } = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'pii-01-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify({ pageSize: 4, ...structuredClone(world) }));
  writeFileSync(eventFile, JSON.stringify(event));
  const settings: Record<string, string | undefined> = {
    PATH: process.env['PATH'] ?? '',
    PII01_WORLD: worldFile,
    PII01_REAL_REDACTOR: pathToFileURL(REDACT).href,
    PII01_REDACTOR: opts.redactor,
    AWS_REGION: 'af-south-1',
    AWS_ACCESS_KEY_ID: 'pii01-fake',
    AWS_SECRET_ACCESS_KEY: 'pii01-fake',
    POWERTOOLS_DEV: 'false',
    POWERTOOLS_TRACE_ENABLED: 'false',
    ...ENV,
    ...(opts.env ?? {}),
  };
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) if (v !== undefined) clean[k] = v;
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), SUMMARY, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    env: clean,
  });
  const line = out.split('\n').find((l) => l.startsWith('@@PII01@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  const result = JSON.parse(line.slice('@@PII01@@'.length)) as { response?: any; error?: Run['error']; calls: Call[] };
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
  return { status: Number(r?.statusCode), body, raw, error: result.error, calls: result.calls };
}

// ---------------------------------------------------------------- events

export type Caller =
  | { kind: 'jwt'; email: string; groups: string[]; tenant?: string; tokenUse?: string }
  | { kind: 'agent'; tenant: string };

function token(claims: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'RS256', kid: 'pii-01' })}.${b(claims)}.c2lnbmF0dXJl`;
}

/** GET /v1/verifications/{id}/summary (HR, through the JWT authorizer) or GET /agent/v1/verifications/{id}/summary (the Agent API). */
export function summaryEvent(id: string, caller: Caller): Record<string, any> {
  const agent = caller.kind === 'agent';
  const route = agent ? '/agent/v1/verifications/{id}/summary' : '/v1/verifications/{id}/summary';
  const path = (agent ? '/agent/v1/verifications/' : '/v1/verifications/') + encodeURIComponent(id) + '/summary';
  let authorizer: unknown;
  let authorization: string | undefined;
  if (caller.kind === 'jwt') {
    const claims: Record<string, unknown> = {
      sub: 'sub-' + caller.email.toLowerCase().replace(/[^a-z]/g, ''),
      email: caller.email,
      email_verified: 'true',
      token_use: caller.tokenUse ?? 'id',
      iss: 'https://cognito-idp.af-south-1.amazonaws.com/af-south-1_Pii01Fake',
      ...(caller.tenant ? { tenant_id: caller.tenant } : {}),
    };
    if (caller.groups.length) claims['cognito:groups'] = `[${caller.groups.join(' ')}]`;
    authorizer = { jwt: { claims, scopes: null } };
    authorization = `Bearer ${token(claims)}`;
  } else {
    authorizer = { lambda: { actor: 'AGENT', tenant_id: caller.tenant } };
  }
  return {
    version: '2.0',
    routeKey: `GET ${route}`,
    rawPath: path,
    rawQueryString: '',
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
    pathParameters: { id },
    requestContext: {
      http: { method: 'GET', path, protocol: 'HTTP/1.1', sourceIp: '198.51.100.15', userAgent: 'pii-01-acceptance' },
      routeKey: `GET ${route}`,
      stage: '$default',
      authorizer,
    },
    isBase64Encoded: false,
  };
}

// ---------------------------------------------------------------- what a run did

/** Every attempt at the model, even one the guard then refused. */
export function bedrockAttempts(run: Run): Array<Extract<Call, { service: 'bedrock' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'bedrock' }> => c.service === 'bedrock');
}

/** Every call that reached the (fake) model past the guard. */
export function modelCalls(run: Run): Array<Extract<Call, { service: 'bedrock' }>> {
  return bedrockAttempts(run).filter((c) => c.reached);
}

/** Every call to any AI service other than Bedrock (Textract) and every outside HTTP call: always none. */
export function strayCalls(run: Run): string[] {
  return run.calls.filter((c) => c.service === 'textract' || c.service === 'http').map((c) => `${c.service} ${(c as any).op}`);
}

/** The prompt the model was given, as text (the user message of the InvokeModel body). */
export function promptOf(call: Extract<Call, { service: 'bedrock' }>): string {
  const body = typeof call.input?.body === 'string' ? JSON.parse(call.input.body) : call.input?.body;
  const m = body?.messages?.[0]?.content;
  return typeof m === 'string' ? m : JSON.stringify(m ?? '');
}

/** Every prompt any attempt carried (a retry or a second call is one more entry). */
export function allPrompts(run: Run): string[] {
  return bedrockAttempts(run).map(promptOf);
}

/** Every log line, console lines and logger lines, with the extra values the logger was given. */
export function logText(run: Run): string {
  return run.calls
    .filter((c): c is Extract<Call, { service: 'log' }> => c.service === 'log')
    .map((c) => `${c.level} ${c.message} ${c.extra === undefined ? '' : JSON.stringify(c.extra)}`)
    .join('\n');
}

export function errorLines(run: Run): string[] {
  return run.calls
    .filter((c): c is Extract<Call, { service: 'log' }> => c.service === 'log' && /error/i.test(c.level))
    .map((c) => `${c.message} ${c.extra === undefined ? '' : JSON.stringify(c.extra)}`);
}

export function dynamoCalls(run: Run): Array<Extract<Call, { service: 'dynamodb' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb');
}
