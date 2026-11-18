import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Runs the real BE-17 Lambdas, each call in its own fresh Node process (a cold Lambda), against a fake
 * AWS (./fake-aws, copied from ONB-15's with code added only): DynamoDB with writes, condition
 * expressions and the three indexes the routes query, KMS, the S3 URL signer, EventBridge, CloudWatch
 * and Powertools. Bedrock, Secrets Manager, Cognito and outbound HTTP are recorded and refused, so a
 * model call, a secret read or an Agent API call shows up in `calls` and fails the handler.
 *
 * The tables are given row by row, as DynamoDB stores them. Nothing reaches AWS. Needs nothing installed.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
export const LAMBDA = join(REPO, 'lambda');
const FAKE_AWS = join(__dirname, 'fake-aws');

/** The ten handlers this card is about, by route. */
export const HANDLER = {
  summary: join(LAMBDA, 'summariseVerification', 'index.mjs'),
  external: join(LAMBDA, 'triggerExternalVerification', 'index.mjs'),
  uploadUrl: join(LAMBDA, 'generateDocumentUploadUrl', 'index.mjs'),
  assessRisk: join(LAMBDA, 'classifyOnboardingRisk', 'index.mjs'),
  byEmail: join(LAMBDA, 'getEmployeeByEmail', 'index.mjs'),
  employees: join(LAMBDA, 'getEmployees', 'index.mjs'),
  aiChat: join(LAMBDA, 'nalekoAiChat', 'index.mjs'),
  pending: join(LAMBDA, 'talentFlowApproveAction', 'index.mjs'),
  fileUrl: join(LAMBDA, 'getDocumentPresignedUrl', 'index.mjs'),
  getOne: join(LAMBDA, 'getSingleDocumentVerification', 'index.mjs'),
} as const;
export type RouteName = keyof typeof HANDLER;

/** A row as DynamoDB stores it: attribute name -> AttributeValue. */
export type Row = Record<string, Record<string, unknown>>;
export type Tables = Record<string, Row[]>;

export type Call =
  | { service: 'dynamodb'; op: string; table?: string; input: any }
  | { service: 's3'; op: string; key?: string; bucket?: string; expiresIn?: number }
  | { service: 'events'; op: 'PutEvents'; bus?: string; source: string; detailType: string; detail: any }
  | { service: 'kms' | 'cloudwatch' | 'bedrock' | 'secretsmanager' | 'cognito' | 'http'; op: string }
  | { service: 'log'; level: string; message: string; extra?: unknown };

export type Run = {
  status: number;
  headers: Record<string, string>;
  body: any;
  raw: string;
  error?: { name: string; message: string; stack: string };
  calls: Call[];
  tables: Tables;
};

/**
 * Who calls. `jwt`: a signed-in person, with the ID token claims the JWT authorizer hands over.
 * `agent`: the Agent API's key authorizer (`authorizer.lambda.actor` AGENT, no JWT). `none`: no authorizer.
 */
export type Caller =
  | { kind: 'jwt'; email: string; groups: string[]; sub?: string; staffId?: string; givenName?: string; familyName?: string }
  | { kind: 'agent' }
  | { kind: 'actor'; actor: string }
  | { kind: 'none' };

/** What a stored-row test gives: plain values. */
export function row(values: Record<string, string | number | boolean | undefined | null>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    out[k] = v === null ? { NULL: true } : typeof v === 'number' ? { N: String(v) } : typeof v === 'boolean' ? { BOOL: v } : { S: v };
  }
  return out;
}

export function plain(r: Row | undefined): Record<string, unknown> | undefined {
  if (!r) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, a] of Object.entries(r)) out[k] = 'S' in a ? a['S'] : 'N' in a ? Number(a['N']) : 'BOOL' in a ? a['BOOL'] : 'NULL' in a ? null : a;
  return out;
}

/** KMS ciphertext as the fake KMS makes it ("kms:" + the plain text), base64. */
export const encrypted = (plainText: string) => Buffer.from(`kms:${plainText}`).toString('base64');

function token(claims: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'RS256', kid: 'be-17' })}.${b(claims)}.c2lnbmF0dXJl`;
}

/** An HTTP API (payload 2.0) event, as API Gateway hands it over. */
export function eventFor(opts: {
  method: 'GET' | 'POST' | 'PATCH';
  route: string;
  path: string;
  caller: Caller;
  pathParameters?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}): unknown {
  const { caller } = opts;
  const query = opts.query ?? {};
  const rawQueryString = new URLSearchParams(query).toString();
  let authorizer: unknown;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (caller.kind === 'jwt') {
    const claims: Record<string, unknown> = {
      sub: caller.sub ?? 'sub-' + (caller.email.toLowerCase().replace(/[^a-z]/g, '') || 'noemail'),
      email: caller.email,
      email_verified: 'true',
      token_use: 'id',
      iss: 'https://cognito-idp.af-south-1.amazonaws.com/af-south-1_Be17Fake',
    };
    if (caller.staffId !== undefined) claims['custom:staff_id'] = caller.staffId;
    if (/^\/agent\/v1\/actions/.test(String(opts.path ?? opts.route))) claims['tenant_id'] = 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa'; // TEN-03: on the pending-actions routes a signed-in person belongs to the founding company
    if (caller.givenName !== undefined) claims['given_name'] = caller.givenName;
    if (caller.familyName !== undefined) claims['family_name'] = caller.familyName;
    // API Gateway passes a list claim as one string: "[hr_staff naleko-onboarding-hr]"
    if (caller.groups.length) claims['cognito:groups'] = `[${caller.groups.join(' ')}]`;
    authorizer = { jwt: { claims, scopes: null } };
    headers['authorization'] = `Bearer ${token(claims)}`;
  } else if (caller.kind === 'agent') {
    authorizer = { lambda: { actor: 'AGENT', ...(/^\/agent\/v1\/actions/.test(opts.path) ? { tenant_id: 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa' } : {}) } }; // TEN-03: the agent authorizer passes the founding company
    headers['x-api-key'] = 'be17-fake-agent-key';
  } else if (caller.kind === 'actor') {
    // A Lambda authorizer that names another actor (no JWT): not the Agent API, so not trusted.
    authorizer = { lambda: { actor: caller.actor } };
  }
  const routeKey = `${opts.method} ${opts.route}`;
  return {
    version: '2.0',
    routeKey,
    rawPath: opts.path,
    rawQueryString,
    headers,
    ...(rawQueryString ? { queryStringParameters: query } : {}),
    ...(opts.pathParameters ? { pathParameters: opts.pathParameters } : {}),
    requestContext: {
      http: { method: opts.method, path: opts.path, protocol: 'HTTP/1.1', sourceIp: '198.51.100.17', userAgent: 'be-17-acceptance' },
      routeKey,
      stage: '$default',
      ...(authorizer ? { authorizer } : {}),
    },
    ...(opts.body === undefined ? {} : { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) }),
    isBase64Encoded: false,
  };
}

/** Lambda settings, as Terraform gives them (made-up model ids; the fake refuses any model call). */
export const ENV: Record<string, string> = {
  EMPLOYEES_TABLE: 'employees',
  DOCUMENTS_TABLE: 'documents',
  VERIFICATION_TABLE: 'document-verification',
  VERIFICATIONS_TABLE: 'document-verification',
  PENDING_ACTIONS_TABLE_NAME: 'talent-flow-pending-actions',
  EVENTBRIDGE_BUS_NAME: 'talent-flow-bus',
  EVENT_BUS_NAME: 'naleko-onboarding',
  RATE_LIMIT_TABLE: 'NalekoAiRateLimit',
  AGENT_AUDIT_TABLE: 'naleko-agent-audit',
  PROMPT_CACHE_TABLE: 'naleko-prompt-cache',
  PENDING_ACTIONS_TABLE: 'naleko-pending-actions',
  AGENT_API_BASE_URL: 'https://agent-api.be17.invalid',
  AGENT_API_KEY_SECRET_NAME: 'be17/fake/agent-key',
  BEDROCK_MODEL_ID: 'be17-fake-model',
  MODEL_SMART: 'be17-fake-model',
  MODEL_FAST: 'be17-fake-model',
  UPLOAD_BUCKET: 'document-ocr-verification-uploads-be17',
  ENVIRONMENT: 'dev',
  KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/be-17-fake',
  KMS_KEY_ID: 'arn:aws:kms:af-south-1:000000000000:key/be-17-fake',
};

/** Makes every matching fake call throw an Error carrying `message` (after it is recorded). */
export type Failure = { service: 'dynamodb'; ops?: string[]; message: string; name?: string };

const MOD01_TENANTS = 'naleko-people-dev-tenants';
const MOD01_FOUNDING: Row = { pk: { S: 'TENANT#ten_aaaaaaaaaaaaaaaaaaaaaaaaaa' }, sk: { S: 'PROFILE' }, tenant_id: { S: 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa' }, status: { S: 'ACTIVE' }, founding: { BOOL: true } };

/** Calls `handler` once with `event` in a fresh process against `tables`. */
export function runHandler(handler: string, tables: Tables, event: unknown, opts: { env?: Record<string, string>; fail?: Failure } = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'be-17-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  // MOD-01 (re-locked by acceptance-lock/mod-01): talentFlowApproveAction asks the module check, which reads the founding
  // company's row (founding, so both modules on) from the tenants table.
  if (handler === HANDLER.pending) {
    tables = { [MOD01_TENANTS]: [MOD01_FOUNDING], ...tables };
    opts = { ...opts, env: { TENANTS_TABLE: MOD01_TENANTS, ...(opts.env ?? {}) } };
  }
  writeFileSync(worldFile, JSON.stringify({ tables: structuredClone(tables), pageSize: 4, ...(opts.fail ? { fail: opts.fail } : {}) }));
  writeFileSync(eventFile, JSON.stringify(event));
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env['PATH'] ?? '',
      BE17_WORLD: worldFile,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'be17-fake',
      AWS_SECRET_ACCESS_KEY: 'be17-fake',
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
      ...ENV,
      ...(opts.env ?? {}),
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@BE17@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  const result = JSON.parse(line.slice('@@BE17@@'.length)) as { response?: any; error?: Run['error']; calls: Call[]; tables: Tables };
  const raw = typeof result.response?.body === 'string' ? result.response.body : JSON.stringify(result.response?.body ?? null);
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(result.response?.headers ?? {})) headers[k.toLowerCase()] = String(v);
  return { status: Number(result.response?.statusCode), headers, body, raw, error: result.error, calls: result.calls, tables: result.tables };
}

// ---------------------------------------------------------------- what a run did

export const WRITE_OPS = ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'];
export const READ_OPS = ['GetItem', 'Query', 'Scan', 'BatchGetItem'];

export function dynamoCalls(run: Run): Array<Extract<Call, { service: 'dynamodb' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb');
}
export function writes(run: Run): string[] {
  return dynamoCalls(run).filter((c) => WRITE_OPS.includes(c.op)).map((c) => `${c.op} ${c.table}`);
}
/** Every call to an outside service (DynamoDB, S3, KMS, EventBridge, CloudWatch, Bedrock, Secrets Manager, Cognito, HTTP); log lines left out. */
export function awsCalls(run: Run): string[] {
  return run.calls.filter((c) => c.service !== 'log').map((c) => `${c.service} ${c.op}${'table' in c && c.table ? ' ' + c.table : ''}`);
}
export function s3Calls(run: Run): string[] {
  return run.calls.filter((c) => c.service === 's3').map((c) => `${c.service} ${c.op}`);
}
export function modelCalls(run: Run): string[] {
  return run.calls.filter((c) => c.service === 'bedrock' || c.service === 'http' || c.service === 'secretsmanager').map((c) => `${c.service} ${c.op}`);
}

/** What an OpenAPI file says about one route (python3 + PyYAML; ONB-15's reader). */
export function openapiRoute(file: string, path: string, method: string): { found: boolean; responses: string[] } {
  const out = execFileSync('python3', [join(__dirname, '..', 'onb-15', 'openapi_route.py'), file, path, method], { encoding: 'utf8' });
  return JSON.parse(out);
}
