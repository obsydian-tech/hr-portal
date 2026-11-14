import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Runs the real ONB-15 Lambdas (getSingleDocumentVerification, getDocumentPresignedUrl and
 * reviewDocumentVerification), each in its own fresh Node process (a cold Lambda), against a fake AWS
 * (./fake-aws, copied from ONB-07's): DynamoDB with writes and condition expressions honoured, KMS,
 * the S3 URL signer, EventBridge, CloudWatch and Powertools. The tables are given row by row as
 * DynamoDB stores them; after each run they are taken back with the handler's writes, so a second
 * decision on the same document is a second cold start on the same tables.
 *
 * Every DynamoDB, KMS, S3, EventBridge and CloudWatch call is recorded. Nothing reaches AWS; an AI
 * client import fails the run. Needs nothing installed.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
const LAMBDA = join(REPO, 'lambda');
export const GET_ONE = join(LAMBDA, 'getSingleDocumentVerification', 'index.mjs');
export const FILE_URL = join(LAMBDA, 'getDocumentPresignedUrl', 'index.mjs');
export const REVIEW = join(LAMBDA, 'reviewDocumentVerification', 'index.mjs');
const FAKE_AWS = join(__dirname, 'fake-aws');

/** A row as DynamoDB stores it: attribute name -> AttributeValue. */
export type Row = Record<string, Record<string, unknown>>;
export type Tables = { employees: Row[]; documents: Row[]; 'document-verification': Row[] };

export type Call =
  | { service: 'dynamodb'; op: string; table?: string; input: any }
  | { service: 's3'; op: string; key?: string; bucket?: string; expiresIn?: number }
  | { service: 'events'; op: 'PutEvents'; bus?: string; source: string; detailType: string; detail: any }
  | { service: 'kms' | 'cloudwatch'; op: string }
  | { service: 'log'; level: string; message: string; extra?: unknown };

export type Run = {
  status: number;
  body: any;
  raw: string;
  error?: { name: string; message: string; stack: string };
  calls: Call[];
  tables: Tables;
};

/**
 * Who calls. `jwt`: a signed-in person, with the ID token claims the JWT authorizer hands over
 * (`givenName`/`familyName` left out means the token has no names). `none`: no authorizer at all.
 */
export type Caller =
  | { kind: 'jwt'; email: string; groups: string[]; givenName?: string; familyName?: string; sub?: string }
  | { kind: 'none' };

export const ENV = {
  EVENT_BUS_NAME: 'naleko-onboarding',
  UPLOAD_BUCKET: 'document-ocr-verification-uploads-onb15',
  ENVIRONMENT: 'dev',
};

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

/** KMS ciphertext as the fake KMS makes it ("kms:" + the plain text), base64, as processDocumentOCR stores it. */
export const encrypted = (plainText: string) => Buffer.from(`kms:${plainText}`).toString('base64');

function token(claims: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'RS256', kid: 'onb-15' })}.${b(claims)}.c2lnbmF0dXJl`;
}

/** An HTTP API (payload 2.0) event, as API Gateway hands it over. */
export function eventFor(opts: {
  method: 'GET' | 'PATCH';
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
      token_use: 'id',
      iss: 'https://cognito-idp.af-south-1.amazonaws.com/af-south-1_Onb15Fake',
    };
    if (caller.givenName !== undefined) claims['given_name'] = caller.givenName;
    if (caller.familyName !== undefined) claims['family_name'] = caller.familyName;
    // API Gateway passes a list claim as one string: "[hr_staff naleko-onboarding-hr]"
    if (caller.groups.length) claims['cognito:groups'] = `[${caller.groups.join(' ')}]`;
    authorizer = { jwt: { claims, scopes: null } };
    authorization = `Bearer ${token(claims)}`;
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
      http: { method: opts.method, path: opts.path, protocol: 'HTTP/1.1', sourceIp: '198.51.100.15', userAgent: 'onb-15-acceptance' },
      routeKey,
      stage: '$default',
      ...(authorizer ? { authorizer } : {}),
    },
    ...(opts.body === undefined ? {} : { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) }),
    isBase64Encoded: false,
  };
}

/** Calls `handler` once with `event` in a fresh process against `tables`. */
export function runHandler(handler: string, tables: Tables, event: unknown, env: Record<string, string> = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'onb-15-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify({ tables: structuredClone(tables), pageSize: 4 }));
  writeFileSync(eventFile, JSON.stringify(event));
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env['PATH'] ?? '',
      ONB15_WORLD: worldFile,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'onb15-fake',
      AWS_SECRET_ACCESS_KEY: 'onb15-fake',
      KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/onb-15-fake',
      KMS_KEY_ID: 'arn:aws:kms:af-south-1:000000000000:key/onb-15-fake',
      EMPLOYEES_TABLE: 'employees',
      DOCUMENTS_TABLE: 'documents',
      VERIFICATION_TABLE: 'document-verification',
      VERIFICATIONS_TABLE: 'document-verification',
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
      ...ENV,
      ...env,
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@ONB15@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  const result = JSON.parse(line.slice('@@ONB15@@'.length)) as { response?: any; error?: Run['error']; calls: Call[]; tables: Tables };
  const raw = typeof result.response?.body === 'string' ? result.response.body : JSON.stringify(result.response?.body ?? null);
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }
  return { status: Number(result.response?.statusCode), body, raw, error: result.error, calls: result.calls, tables: result.tables };
}

// ---------------------------------------------------------------- the three routes

/** GET /v1/verifications/{id} (with ?employee_id= when given). */
export function getOne(tables: Tables, documentId: string, caller: Caller, employeeId?: string): Run {
  return runHandler(GET_ONE, tables, eventFor({
    method: 'GET', route: '/v1/verifications/{id}', path: `/v1/verifications/${documentId}`, id: documentId, caller,
    query: employeeId ? { employee_id: employeeId } : undefined,
  }));
}

/** GET /v1/documents/{id}/url. */
export function fileUrl(tables: Tables, documentId: string, caller: Caller): Run {
  return runHandler(FILE_URL, tables, eventFor({ method: 'GET', route: '/v1/documents/{id}/url', path: `/v1/documents/${documentId}/url`, id: documentId, caller }));
}

/** PATCH /v1/verifications/{id}/review with `body` (an object, or a raw string). */
export function review(tables: Tables, documentId: string, caller: Caller, body: unknown, headers?: Record<string, string>): Run {
  return runHandler(REVIEW, tables, eventFor({
    method: 'PATCH', route: '/v1/verifications/{id}/review', path: `/v1/verifications/${documentId}/review`, id: documentId, caller, body, headers,
  }));
}

// ---------------------------------------------------------------- what a run did

export const WRITE_OPS = ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'];

export function dynamoCalls(run: Run): Array<Extract<Call, { service: 'dynamodb' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb');
}
export function writes(run: Run): string[] {
  return dynamoCalls(run).filter((c) => WRITE_OPS.includes(c.op)).map((c) => `${c.op} ${c.table}`);
}
export function published(run: Run, detailType?: string): Array<Extract<Call, { service: 'events' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'events' }> => c.service === 'events' && (!detailType || c.detailType === detailType));
}
/** Every call to an AWS service (DynamoDB, S3, KMS, EventBridge, CloudWatch); log lines left out. */
export function awsCalls(run: Run): string[] {
  return run.calls.filter((c) => c.service !== 'log').map((c) => `${c.service} ${c.op}${'table' in c && c.table ? ' ' + c.table : ''}`);
}

export function docRow(tables: Tables, employeeId: string, documentId: string): Record<string, unknown> | undefined {
  return plain(tables.documents.find((r) => (r['employee_id'] as any)?.S === employeeId && (r['document_id'] as any)?.S === documentId));
}

/** What api/openapi.yaml says about one route (python3 + PyYAML). */
export function openapiRoute(path: string, method: string): {
  found: boolean;
  responses: string[];
  /** Every property name reachable from each response's schema, by status code. */
  fields: Record<string, string[]>;
  /** Property names of the request body's schema. */
  request: string[];
} {
  const out = execFileSync('python3', [join(__dirname, 'openapi_route.py'), join(REPO, 'api', 'openapi.yaml'), path, method], { encoding: 'utf8' });
  return JSON.parse(out);
}
