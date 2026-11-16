import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { plain, row, type Row } from '../onb-15/lambda-harness';

/**
 * Runs the real ONB-03 Lambdas (createEmployee, getHrPartners and checkEmployeeEmail), each in its own fresh
 * Node process (a cold Lambda), against a fake AWS (./fake-aws, ONB-09's copy plus a Cognito user pool):
 * DynamoDB with the employees table and its email-index, KMS, EventBridge, Step Functions, Postmark, and the
 * pool's users and groups (ListUsersInGroup answers 60 a page, as Cognito does). The world is given as data;
 * after each run the tables and the pool are taken back with the handler's writes, so the next run starts
 * where the last one stopped.
 *
 * Every call is recorded. Nothing reaches AWS, Postmark or any AI service. Needs nothing installed.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
const LAMBDA = join(REPO, 'lambda');
export const CREATE = join(LAMBDA, 'createEmployee', 'index.mjs');
export const PARTNERS = join(LAMBDA, 'getHrPartners', 'index.mjs');
export const EMAIL_CHECK = join(LAMBDA, 'checkEmployeeEmail', 'index.mjs');
const FAKE_AWS = join(__dirname, 'fake-aws');

export { plain, row, type Row };

export const POOL = 'af-south-1_Onb03Fake';
export const PAGE = 60; // what Cognito answers at most in one ListUsersInGroup page

export type CognitoUser = { username: string; enabled?: boolean; attributes: Record<string, string>; groups: string[] };
export type World = {
  tables: { employees: Row[] };
  cognito: { users: CognitoUser[] };
  /** Rows per Query page. */
  pageSize?: number;
  /** "table/index" -> the rows that index sees. */
  index?: Record<string, Row[]>;
  /** DynamoDB calls that fail with a 500. */
  fail?: Array<{ op: string; table: string }>;
};

export type Call =
  | { service: 'dynamodb'; op: string; table?: string; input: any }
  | { service: 'cognito'; op: string; input: any }
  | { service: 'events'; op: 'PutEvents'; bus?: string; source: string; detailType: string; detail: any }
  | { service: 'postmark'; op: string; message: any }
  | { service: 'kms' | 'sfn' | 'cloudwatch' | 's3'; op: string }
  | { service: 'textract' | 'bedrock'; op: string; reached: boolean; input: any }
  | { service: 'log'; level: string; message: string; extra?: unknown };

export type Run = {
  response: any;
  status: number;
  /** The response body, parsed when it is JSON text. */
  body: any;
  raw: string;
  error?: { name: string; message: string; stack: string };
  calls: Call[];
  /** The world after the run (tables and pool with the handler's writes). */
  world: World;
};

// ---------------------------------------------------------------- who calls

/** How API Gateway hands the `cognito:groups` claim over: "[a b]", a real list, or one bare name. */
export type GroupsForm = 'bracket' | 'array' | 'name';

export type JwtCaller = { kind: 'jwt'; email: string; groups: string[]; form?: GroupsForm; staffId?: string; sub?: string; givenName?: string; familyName?: string };
export type Caller =
  | { kind: 'jwt'; email: string; groups: string[]; form?: GroupsForm; staffId?: string; sub?: string; givenName?: string; familyName?: string }
  | { kind: 'agent' }
  | { kind: 'none' };

export const HR: JwtCaller = { kind: 'jwt', email: 'jane.smith@mokoena-logistics.co.za', groups: ['hr_staff'], staffId: 'E2EHR01', givenName: 'Jane', familyName: 'Smith' };
export const EMPLOYEE: JwtCaller = { kind: 'jwt', email: 'john.doe@mokoena-logistics.co.za', groups: ['employee'], staffId: '', givenName: 'John', familyName: 'Doe' };
export const AGENT: Caller = { kind: 'agent' };

function groupsClaim(groups: string[], form: GroupsForm): unknown {
  if (!groups.length) return undefined;
  if (form === 'array') return groups;
  if (form === 'name') return groups.join(' ');
  return `[${groups.join(' ')}]`;
}

/** An HTTP API (payload 2.0) event as API Gateway hands it over, with the authorizer's answer. */
export function apiEvent(opts: {
  method: 'GET' | 'POST';
  route: string;
  caller: Caller;
  query?: Record<string, string>;
  /** An object (sent as JSON), a string (sent as is) or undefined (no body at all). */
  body?: unknown;
  headers?: Record<string, string>;
}): unknown {
  const { caller } = opts;
  const query = opts.query ?? {};
  const rawQueryString = new URLSearchParams(query).toString();
  let authorizer: unknown;
  if (caller.kind === 'jwt') {
    const claims: Record<string, unknown> = {
      sub: caller.sub ?? 'sub-' + caller.email.toLowerCase().replace(/[^a-z]/g, ''),
      email: caller.email,
      email_verified: 'true',
      token_use: 'id',
      iss: `https://cognito-idp.af-south-1.amazonaws.com/${POOL}`,
      ...(caller.givenName ? { given_name: caller.givenName } : {}),
      ...(caller.familyName ? { family_name: caller.familyName } : {}),
      ...(caller.staffId !== undefined ? { 'custom:staff_id': caller.staffId } : {}),
    };
    const g = groupsClaim(caller.groups, caller.form ?? 'bracket');
    if (g !== undefined) claims['cognito:groups'] = g;
    authorizer = { jwt: { claims, scopes: null } };
  } else if (caller.kind === 'agent') {
    authorizer = { lambda: { actor: 'AGENT' } };
  }
  const routeKey = `${opts.method} ${opts.route}`;
  return {
    version: '2.0',
    routeKey,
    rawPath: opts.route,
    rawQueryString,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    ...(rawQueryString ? { queryStringParameters: query } : {}),
    requestContext: {
      http: { method: opts.method, path: opts.route, protocol: 'HTTP/1.1', sourceIp: '198.51.100.15', userAgent: 'onb-03-acceptance' },
      routeKey,
      stage: '$default',
      ...(authorizer ? { authorizer } : {}),
    },
    ...(opts.body === undefined ? {} : { body: typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body) }),
    isBase64Encoded: false,
  };
}

export const createEvent = (caller: Caller, body?: unknown, headers?: Record<string, string>) => apiEvent({ method: 'POST', route: '/v1/employees', caller, body, headers });
export const partnersEvent = (caller: Caller) => apiEvent({ method: 'GET', route: '/v1/hr-partners', caller });
export const emailCheckEvent = (caller: Caller, email?: string) => apiEvent({ method: 'GET', route: '/v1/employees/email-check', caller, query: email === undefined ? {} : { email } });

// ---------------------------------------------------------------- running a handler

export const ENV = {
  EVENT_BUS_NAME: 'naleko-onboarding',
  ENVIRONMENT: 'dev',
  COGNITO_POOL_ID: POOL,
  LOGIN_URL: 'http://localhost:4300/sign-in',
  POSTMARK_SENDER_EMAIL: 'sender@example.test',
  // ONB-04 (re-lock onb-03.4): createEmployee now reads these two settings and writes an invite row.
  COMPANY_NAME: 'Sunbird Bakery',
  APP_URL: 'http://localhost:4300',
};

/** Calls `handler` once with `event` in a fresh process against `world`. */
export function runHandler(handler: string, world: World, event: unknown, env: Record<string, string> = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'onb-03-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify({ pageSize: 4, ...structuredClone(world) }));
  writeFileSync(eventFile, JSON.stringify(event));
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      PATH: process.env['PATH'] ?? '',
      ONB03_WORLD: worldFile,
      AWS_REGION: 'af-south-1',
      AWS_ACCESS_KEY_ID: 'onb03-fake',
      AWS_SECRET_ACCESS_KEY: 'onb03-fake',
      KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/onb-03-fake',
      EMPLOYEES_TABLE: 'employees',
      POSTMARK_API_TOKEN: 'onb03-fake-postmark-token',
      POWERTOOLS_DEV: 'false',
      POWERTOOLS_TRACE_ENABLED: 'false',
      ...ENV,
      ...env,
    },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@ONB03@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  const result = JSON.parse(line.slice('@@ONB03@@'.length)) as { response?: any; error?: Run['error']; calls: Call[]; tables: World['tables']; cognito: World['cognito'] };
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
  return { response: r, status: Number(r?.statusCode), body, raw, error: result.error, calls: result.calls, world: { ...world, tables: result.tables as World['tables'], cognito: result.cognito } };
}

export const create = (world: World, caller: Caller, body?: unknown, headers?: Record<string, string>) => runHandler(CREATE, world, createEvent(caller, body, headers));
export const partners = (world: World, caller: Caller) => runHandler(PARTNERS, world, partnersEvent(caller));
export const emailCheck = (world: World, caller: Caller, email?: string) => runHandler(EMAIL_CHECK, world, emailCheckEvent(caller, email));

// ---------------------------------------------------------------- what a run did

const WRITE_OPS = ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'];

export function dynamoCalls(run: Run): Array<Extract<Call, { service: 'dynamodb' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb');
}
/** Every write the run asked for on a table. */
export function writesTo(run: Run, tableName: string): number {
  return dynamoCalls(run).filter((c) => WRITE_OPS.includes(c.op) && c.table === tableName).length;
}
export function cognitoCalls(run: Run, op?: string): Array<Extract<Call, { service: 'cognito' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'cognito' }> => c.service === 'cognito' && (!op || c.op === op));
}
export function published(run: Run): Array<Extract<Call, { service: 'events' }>> {
  return run.calls.filter((c): c is Extract<Call, { service: 'events' }> => c.service === 'events');
}
/** Every call to an AWS service or Postmark (log lines left out). */
export function aws(run: Run): string[] {
  return run.calls.filter((c) => c.service !== 'log').map((c) => `${c.service} ${c.op}${'table' in c && c.table ? ' ' + c.table : ''}`);
}
export function aiReached(run: Run): string[] {
  return run.calls.filter((c): c is Extract<Call, { service: 'textract' | 'bedrock' }> => (c.service === 'textract' || c.service === 'bedrock') && c.reached).map((c) => c.service);
}
/** The stored rows of the employees table, plain. */
export function stored(w: World): Array<Record<string, unknown>> {
  return w.tables.employees.map((r) => plain(r)!);
}
/** The stored row with this email exactly as stored. */
export function storedWithEmail(w: World, email: string): Record<string, unknown> | undefined {
  return stored(w).find((p) => p['email'] === email);
}

// ---------------------------------------------------------------- test people

let serial = 0;
/** A pool member. `staffId` is the custom:staff_id attribute (left out when undefined). Extra attributes are what must never leak. */
export function member(first: string, last: string, opts: { staffId?: string; groups?: string[]; username?: string; email?: string; enabled?: boolean } = {}): CognitoUser {
  serial++;
  const email = opts.email ?? `${first}.${last}`.toLowerCase().replace(/[^a-z.]/g, '') + `@mokoena-logistics.co.za`;
  return {
    username: opts.username ?? email,
    enabled: opts.enabled,
    groups: opts.groups ?? ['hr_staff'],
    attributes: {
      sub: `00000000-0000-4000-8000-${String(serial).padStart(12, '0')}`,
      email,
      email_verified: 'true',
      given_name: first,
      family_name: last,
      phone_number: `+2782555${String(serial).padStart(4, '0')}`,
      'custom:role': 'hr_staff',
      'custom:disabled_reason': `secret-note-${serial}`,
      ...(opts.staffId !== undefined ? { 'custom:staff_id': opts.staffId } : {}),
    },
  };
}

export function employeeRow(values: Record<string, string | number | boolean | undefined | null>): Row {
  return row(values);
}

export const emptyWorld = (): World => ({ tables: { employees: [] }, cognito: { users: [] } });

// ---------------------------------------------------------------- a valid South African ID number

/** A 13-digit ID: YYMMDD, four digits of sequence, citizenship 0/1, 8, and the Luhn check digit. */
export function saId(yymmdd: string, sequence = '5009', citizen = '0'): string {
  const twelve = `${yymmdd}${sequence}${citizen}8`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let d = Number(twelve[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return twelve + String((10 - (sum % 10)) % 10);
}
/** The same number with its check digit made wrong. */
export function withBadCheck(id: string): string {
  return id.slice(0, 12) + String((Number(id[12]) + 1) % 10);
}

/** A valid registration body (what the new screens send). */
export function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane.doe@x.co.za',
    phone: '081 234 5678',
    department: 'Finance',
    job_title: 'Bookkeeper',
    planned_start_date: '2026-12-01',
    ...over,
  };
}
