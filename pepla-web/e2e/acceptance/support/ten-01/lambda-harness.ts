import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * TEN-01: runs the real code, each call in its own fresh Node process (a cold Lambda), against a fake AWS
 * (./fake-aws, copied from BE-17's at 7f1442c with code added only): DynamoDB over rows given as DynamoDB
 * stores them (the company list is `naleko-people-dev-tenants`, keyed pk + sk), Secrets Manager answering
 * the agent key from the world, Powertools and every console line recorded as a log line. Bedrock and any
 * other AI client fail the import or the call; outbound HTTP is recorded and refused. Nothing reaches AWS.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
export const LAMBDA = join(REPO, 'lambda');
const FAKE_AWS = join(__dirname, 'fake-aws');

export const PRE_TOKEN = join(LAMBDA, 'tenantPreToken', 'index.mjs');
export const AGENT_AUTHORIZER = join(LAMBDA, 'agentAuthorizer', 'index.mjs');
export const TENANT_HELPER = join(LAMBDA, 'shared', 'tenant.mjs');
export const TENANTS_TABLE = 'naleko-people-dev-tenants';

/** A row as DynamoDB stores it: attribute name -> AttributeValue. */
export type Row = Record<string, Record<string, unknown>>;
export type Tables = Record<string, Row[]>;

export type Call =
  | { service: 'dynamodb'; op: string; table?: string; input: any }
  | { service: 'log'; level: string; message: string; extra?: unknown }
  | { service: string; op: string };

export type Run = { response: any; error?: { name: string; message: string; stack: string }; calls: Call[]; tables: Tables };

/** What a stored-row test gives: plain values. */
export function row(values: Record<string, string | number | boolean | undefined | null>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    out[k] = v === null ? { NULL: true } : typeof v === 'number' ? { N: String(v) } : typeof v === 'boolean' ? { BOOL: v } : { S: v };
  }
  return out;
}

/** Makes every matching fake call throw (after it is recorded). */
export type Failure = { service: 'dynamodb'; ops?: string[]; message: string; name?: string };

function node(args: string[], world: unknown, files: Record<string, unknown>, env: Record<string, string | undefined>) {
  const dir = mkdtempSync(join(tmpdir(), 'ten-01-'));
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
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), ...args, ...paths], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env['PATH'] ?? '',
      TEN01_WORLD: worldFile,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'ten01-fake',
      AWS_SECRET_ACCESS_KEY: 'ten01-fake',
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
      ...clean,
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@TEN01@@'));
  if (!line) throw new Error(`the run printed no result:\n${out.slice(-2000)}`);
  return JSON.parse(line.slice('@@TEN01@@'.length));
}

/** Calls `handler` once with `event` in a fresh process. Only the settings given in `env` are set. */
export function runHandler(
  handler: string,
  event: unknown,
  opts: { tables?: Tables; secrets?: Record<string, Record<string, string>>; env?: Record<string, string | undefined>; fail?: Failure } = {},
): Run {
  const world = { tables: structuredClone(opts.tables ?? {}), secrets: opts.secrets ?? {}, pageSize: 4, ...(opts.fail ? { fail: opts.fail } : {}) };
  const r = node([join(FAKE_AWS, 'run.mjs'), handler], world, { 'event.json': event }, opts.env ?? {});
  return { response: r.response, error: r.error, calls: r.calls, tables: r.tables };
}

export type Step = { fn: string; args?: unknown[] } | { get: string };
export type StepResult = { ok: boolean; value?: any; undefined?: boolean; type?: string; error?: { name: string; ctor: string; message: string } };
export type HelperRun = { results: StepResult[]; exports: string[]; calls: Call[]; importError?: { name: string; message: string } };

/** Imports lambda/shared/tenant.mjs in a fresh process with exactly these settings, and runs the steps in order. */
export function runHelper(steps: Step[], env: Record<string, string | undefined> = {}): HelperRun {
  return node([join(FAKE_AWS, 'helper-run.mjs'), TENANT_HELPER], { tables: {} }, { 'steps.json': steps }, env);
}

/** Every call to an outside service; log lines left out. */
export function awsCalls(calls: Call[]): string[] {
  return calls.filter((c) => c.service !== 'log').map((c) => `${c.service} ${'op' in c ? c.op : ''}${'table' in c && c.table ? ' ' + c.table : ''}`);
}
export function logLines(calls: Call[]): string[] {
  return calls
    .filter((c): c is Extract<Call, { service: 'log' }> => c.service === 'log')
    .map((c) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);
}

// ---------------------------------------------------------------- events

/** A Cognito pre token generation event, version 2 (ID and access token), as Cognito hands it over. */
export function preTokenEvent(opts: {
  sub: string;
  email: string;
  groups: string[];
  trigger?: string;
  extraAttributes?: Record<string, string>;
  clientMetadata?: Record<string, string>;
}): any {
  return {
    version: '2',
    triggerSource: opts.trigger ?? 'TokenGeneration_Authentication',
    region: 'af-south-1',
    userPoolId: 'af-south-1_Ten01Fake',
    userName: opts.sub,
    callerContext: { awsSdkVersion: 'aws-sdk-unknown-unknown', clientId: 'ten01fakeclientid' },
    request: {
      userAttributes: {
        sub: opts.sub,
        email: opts.email,
        email_verified: 'true',
        'cognito:user_status': 'CONFIRMED',
        'custom:staff_id': 'E2EHR01',
        ...(opts.extraAttributes ?? {}),
      },
      groupConfiguration: { groupsToOverride: [...opts.groups], iamRolesToOverride: [], preferredRole: null },
      scopes: ['aws.cognito.signin.user.admin', 'openid', 'email'],
      ...(opts.clientMetadata ? { clientMetadata: opts.clientMetadata } : {}),
    },
    response: { claimsAndScopeOverrideDetails: null },
  };
}

/** An HTTP API (payload 2.0) event, with an authorizer as API Gateway hands it over. */
export function httpEvent(opts: {
  authorizer?: unknown;
  query?: Record<string, string>;
  path?: Record<string, string>;
  headers?: Record<string, string>;
  cookies?: string[];
  body?: unknown;
}): any {
  const query = opts.query ?? {};
  return {
    version: '2.0',
    routeKey: 'GET /v1/employees',
    rawPath: '/v1/employees',
    rawQueryString: new URLSearchParams(query).toString(),
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    ...(opts.cookies ? { cookies: opts.cookies } : {}),
    ...(Object.keys(query).length ? { queryStringParameters: query } : {}),
    ...(opts.path ? { pathParameters: opts.path } : {}),
    requestContext: {
      http: { method: 'GET', path: '/v1/employees', protocol: 'HTTP/1.1', sourceIp: '198.51.100.17', userAgent: 'ten-01-acceptance' },
      routeKey: 'GET /v1/employees',
      stage: '$default',
      ...(opts.authorizer === undefined ? {} : { authorizer: opts.authorizer }),
    },
    ...(opts.body === undefined ? {} : { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) }),
    isBase64Encoded: false,
  };
}

/** The JWT authorizer's claims for a signed-in person (ID token), as API Gateway passes them. */
export function jwtAuthorizer(claims: Record<string, unknown>): unknown {
  return {
    jwt: {
      claims: {
        sub: 'b1f0c2d4-1111-4a5b-9c3d-ten01person',
        email: 'jane.smith@mokoena-logistics.co.za',
        token_use: 'id',
        'cognito:groups': '[hr_staff]',
        iss: 'https://cognito-idp.af-south-1.amazonaws.com/af-south-1_Ten01Fake',
        ...claims,
      },
      scopes: null,
    },
  };
}
