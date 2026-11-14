import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Runs a real Lambda handler, in its own Node process, against a fake AWS (./fake-aws): every AWS SDK
 * and Powertools import is answered by a fake, the tables are given row by row as DynamoDB stores
 * them, and every DynamoDB and KMS call is recorded. A Scan answers in pages of at most `pageSize`
 * rows (DynamoDB's 1 MB page), so a reader that stops after one page misses rows. Nothing reaches
 * AWS; an AI client import fails the run; a write fails the run. Needs nothing installed.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
export const LIST_HANDLER = join(REPO, 'lambda', 'getDocumentVerifications', 'index.mjs');
export const PERSON_HANDLER = join(REPO, 'lambda', 'getEmployeeDocumentVerifications', 'index.mjs');
/** lambda/getDocumentVerifications as it is on develop fffb9f2, before this card: "today's answer". */
export const LIST_HANDLER_TODAY = join(__dirname, 'getDocumentVerifications.fffb9f2.mjs');
const FAKE_AWS = join(__dirname, 'fake-aws');

/** A row as DynamoDB stores it: attribute name -> AttributeValue. */
export type Row = Record<string, { S: string } | { N: string } | { BOOL: boolean } | { NULL: true }>;
export type Tables = { employees: Row[]; documents: Row[]; 'document-verification': Row[] };
export type LambdaCall = { service: 'dynamodb' | 'kms'; op: string; table?: string; startKey?: boolean };
export type LambdaRun = { status: number; body: any; raw: string; calls: LambdaCall[] };

/** Who calls: a signed-in person (the JWT authorizer's claims), the Agent API (its key authorizer), or nobody. */
export type Caller =
  | { kind: 'jwt'; email: string; groups: string[]; sub?: string }
  | { kind: 'agent' }
  | { kind: 'none' };

/** Plain values to a stored row (strings, numbers, booleans; undefined left out). */
export function row(values: Record<string, string | number | boolean | undefined>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'number' ? { N: String(v) } : typeof v === 'boolean' ? { BOOL: v } : { S: v };
  }
  return out;
}

/** A made-up, unsigned ID token carrying the claims (API Gateway has already checked the real one). */
function token(claims: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'RS256', kid: 'onb-13' })}.${b(claims)}.c2lnbmF0dXJl`;
}

/**
 * An HTTP API (payload 2.0) event, as API Gateway hands it over. `route` is the route key's path,
 * such as /v1/verifications or /agent/v1/verifications; `query` the query string parameters.
 */
export function eventFor(opts: { route: string; path?: string; pathParameters?: Record<string, string>; query?: Record<string, string>; caller: Caller }): unknown {
  const { route, caller } = opts;
  const path = opts.path ?? route;
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
      iss: 'https://cognito-idp.af-south-1.amazonaws.com/af-south-1_Onb13Fake',
    };
    // API Gateway passes a list claim as one string: "[hr_staff naleko-onboarding-hr]"
    if (caller.groups.length) claims['cognito:groups'] = `[${caller.groups.join(' ')}]`;
    authorizer = { jwt: { claims, scopes: null } };
    authorization = `Bearer ${token(claims)}`;
  } else if (caller.kind === 'agent') {
    authorizer = { lambda: { actor: 'AGENT' } };
    authorization = 'ApiKey onb13-fake-agent-key';
  }
  return {
    version: '2.0',
    routeKey: `GET ${route}`,
    rawPath: path,
    rawQueryString,
    headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) },
    ...(rawQueryString ? { queryStringParameters: query } : {}),
    ...(opts.pathParameters ? { pathParameters: opts.pathParameters } : {}),
    requestContext: {
      http: { method: 'GET', path, protocol: 'HTTP/1.1', sourceIp: '198.51.100.7', userAgent: 'onb-13-acceptance' },
      routeKey: `GET ${route}`,
      stage: '$default',
      ...(authorizer ? { authorizer } : {}),
    },
    isBase64Encoded: false,
  };
}

/** Calls `handler` once with `event`, against `tables`. Scan pages hold at most `pageSize` rows. */
export function runHandler(handler: string, tables: Tables, event: unknown, pageSize = 4): LambdaRun {
  const dir = mkdtempSync(join(tmpdir(), 'onb-13-lambda-'));
  const world = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(world, JSON.stringify({ tables, pageSize }));
  writeFileSync(eventFile, JSON.stringify(event));
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      PATH: process.env['PATH'] ?? '',
      ONB13_WORLD: world,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'onb13-fake',
      AWS_SECRET_ACCESS_KEY: 'onb13-fake',
      KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/onb-13-fake',
      EMPLOYEES_TABLE: 'employees',
      DOCUMENTS_TABLE: 'documents',
      VERIFICATION_TABLE: 'document-verification',
      VERIFICATIONS_TABLE: 'document-verification',
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@ONB13@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  const result = JSON.parse(line.slice('@@ONB13@@'.length)) as { response?: any; calls?: LambdaCall[]; error?: string };
  if (result.error) throw new Error(`the handler threw:\n${result.error}`);
  const raw = typeof result.response?.body === 'string' ? result.response.body : JSON.stringify(result.response?.body ?? null);
  let body: unknown = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = raw;
  }
  return { status: Number(result.response?.statusCode), body, raw, calls: result.calls ?? [] };
}

/** GET /v1/verifications (or the Agent API's /agent/v1/verifications) through `handler`. */
export function runList(tables: Tables, caller: Caller, query: Record<string, string> = {}, handler = LIST_HANDLER, pageSize = 4): LambdaRun {
  const route = caller.kind === 'agent' ? '/agent/v1/verifications' : '/v1/verifications';
  return runHandler(handler, tables, eventFor({ route, query, caller }), pageSize);
}

/** GET /v1/employees/{id}/verifications through the real lambda/getEmployeeDocumentVerifications. */
export function runPerson(tables: Tables, id: string, caller: Caller): LambdaRun {
  const path = `/v1/employees/${encodeURIComponent(id)}/verifications`;
  return runHandler(PERSON_HANDLER, tables, eventFor({ route: '/v1/employees/{id}/verifications', path, pathParameters: { id }, caller }));
}

/** What api/openapi.yaml says GET /v1/verifications takes and answers (python3 + PyYAML). */
export function openapiList(): {
  parameters: Array<{ name: string; in: string }>;
  responses: string[];
  objects: Array<{ properties: string[]; items: string[] | null }>;
} {
  const out = execFileSync('python3', [join(__dirname, 'openapi_list.py'), join(REPO, 'api', 'openapi.yaml')], { encoding: 'utf8' });
  return JSON.parse(out);
}
