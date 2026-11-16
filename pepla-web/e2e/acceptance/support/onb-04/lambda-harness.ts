import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiEvent, body, HR, member, POOL, type Caller, type CognitoUser, type JwtCaller } from '../onb-03/lambda-harness';
import { plain, row, type Row } from '../onb-15/lambda-harness';

/**
 * Runs the real ONB-04 code against a fake AWS (./fake-aws, ONB-03's copy plus the invite table, a Cognito user
 * status and password rules, a fixed clock, console lines recorded, and requests that can race):
 *   - lambda/createEmployee (POST /v1/employees),
 *   - lambda/lookupInvite (POST /v1/invites/lookup, public) and lambda/redeemInvite (POST /v1/invites/redeem, public),
 *   - lambda/shared/invite.mjs issueInvite({ employee, hrPartner, sentBy }), called directly (ONB-18 will call it).
 * Each run is a fresh Node process (a cold Lambda). The world (tables and pool) is handed back after each run, so
 * the next run starts where the last stopped. Nothing reaches AWS, Postmark or any AI service.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
const LAMBDA = join(REPO, 'lambda');
export const CREATE = join(LAMBDA, 'createEmployee', 'index.mjs');
export const LOOKUP = join(LAMBDA, 'lookupInvite', 'index.mjs');
export const REDEEM = join(LAMBDA, 'redeemInvite', 'index.mjs');
export const INVITE = join(LAMBDA, 'shared', 'invite.mjs');
const FAKE_AWS = join(__dirname, 'fake-aws');

export { apiEvent, body, HR, member, plain, POOL, row, type Caller, type CognitoUser, type JwtCaller, type Row };

export const INVITES = 'employee_invites';
export const COMPANY = 'Sunbird Bakery';
export const APP_URL = 'http://localhost:4300';
/** The link a token makes: `<APP_URL>/set-password#token=<43 base64url characters>`. */
export const LINK = new RegExp(`^${APP_URL.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/set-password#token=([A-Za-z0-9_-]{43})$`);
export const LINK_IN_TEXT = new RegExp(`${APP_URL.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/set-password#token=([A-Za-z0-9_-]+)`, 'g');

export type World = {
  tables: { employees: Row[]; employee_invites: Row[]; [name: string]: Row[] };
  cognito: { users: Array<CognitoUser & { status?: string; password?: string; tempPassword?: string }> };
  pageSize?: number;
  /** Cognito operations that fail with a 500. */
  cognitoFail?: string[];
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

export type Answer = { response: any; status: number; body: any; raw: string; error?: { name: string; message: string; stack: string } };
export type Run = Answer & {
  /** Every answer, when the run had more than one event. */
  all: Answer[];
  calls: Call[];
  world: World;
  /** Everything the process wrote outside the result line (stdout and stderr). */
  output: string;
};

export const ENV: Record<string, string> = {
  EVENT_BUS_NAME: 'naleko-onboarding',
  ENVIRONMENT: 'dev',
  COGNITO_POOL_ID: POOL,
  LOGIN_URL: 'http://localhost:4300/sign-in',
  POSTMARK_SENDER_EMAIL: 'sender@example.test',
  COMPANY_NAME: COMPANY,
  APP_URL,
  // The invite table's name, under every name a Lambda might read it by. The table is called employee_invites.
  INVITES_TABLE: INVITES,
  INVITE_TABLE: INVITES,
  EMPLOYEE_INVITES_TABLE: INVITES,
};

/** A fixed moment: 16 Nov 2026 22:30 UTC is already 17 Nov 2026 00:30 in South Africa. */
export const T0 = '2026-11-16T22:30:00.000Z';
export const at = (base: string, seconds: number) => new Date(Date.parse(base) + seconds * 1000).toISOString();
export const DAY = 86_400;

function answerOf(r: any, error?: Answer['error']): Answer {
  const rawBody = r && typeof r === 'object' && 'body' in r ? r.body : undefined;
  const raw = typeof rawBody === 'string' ? rawBody : rawBody === undefined || rawBody === null ? '' : JSON.stringify(rawBody);
  let parsed: unknown = rawBody ?? null;
  if (typeof rawBody === 'string') {
    try {
      parsed = rawBody === '' ? null : JSON.parse(rawBody);
    } catch {
      parsed = rawBody;
    }
  }
  return { response: r, status: Number(r?.statusCode), body: parsed, raw, ...(error ? { error } : {}) };
}

type Opts = { now?: string; env?: Record<string, string>; concurrent?: boolean; call?: string };

/** Runs `file` once per event (or all at once with `concurrent`) in one fresh process against `world`. */
export function runModule(file: string, world: World, events: unknown[], opts: Opts = {}): Run {
  const dir = mkdtempSync(join(tmpdir(), 'onb-04-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify({ pageSize: 4, ...structuredClone(world) }));
  writeFileSync(eventFile, JSON.stringify({ events, concurrent: !!opts.concurrent, ...(opts.call ? { call: opts.call } : {}) }));
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    ONB04_WORLD: worldFile,
    ONB04_NOW: opts.now ?? T0,
    TZ: 'UTC',
    AWS_REGION: 'af-south-1',
    AWS_ACCESS_KEY_ID: 'onb04-fake',
    AWS_SECRET_ACCESS_KEY: 'onb04-fake',
    KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/onb-04-fake',
    EMPLOYEES_TABLE: 'employees',
    POSTMARK_API_TOKEN: 'onb04-fake-postmark-token',
    POWERTOOLS_DEV: 'false',
    POWERTOOLS_TRACE_ENABLED: 'false',
    ...ENV,
    ...(opts.env ?? {}),
  };
  for (const [k, v] of Object.entries(env)) if (v === '') delete env[k];
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), file, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  const lines = out.split('\n');
  const line = lines.find((l) => l.startsWith('@@ONB04@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  const result = JSON.parse(line.slice('@@ONB04@@'.length)) as {
    responses: any[]; errors: Array<Answer['error'] | null>; loadError?: Answer['error']; calls: Call[]; tables: World['tables']; cognito: World['cognito'];
  };
  if (result.loadError) {
    const e = new Error(`${file} could not be loaded: ${result.loadError.message}`);
    e.stack = result.loadError.stack;
    throw e;
  }
  const all = events.map((_e, i) => answerOf(result.responses[i], result.errors[i] ?? undefined));
  return {
    ...all[0]!,
    all,
    calls: result.calls,
    world: { ...world, tables: result.tables as World['tables'], cognito: result.cognito },
    output: lines.filter((l) => !l.startsWith('@@ONB04@@')).join('\n'),
  };
}

// ---------------------------------------------------------------- the routes

export const createEvent = (caller: Caller, b?: unknown, headers?: Record<string, string>) => apiEvent({ method: 'POST', route: '/v1/employees', caller, body: b, headers });
/** A public route: no authorizer, unless the test adds one to show it is ignored. */
export const publicEvent = (route: '/v1/invites/lookup' | '/v1/invites/redeem', b?: unknown, opts: { caller?: Caller; headers?: Record<string, string> } = {}) =>
  apiEvent({ method: 'POST', route, caller: opts.caller ?? { kind: 'none' }, body: b, headers: opts.headers });

export const create = (world: World, caller: Caller, b?: unknown, opts: Opts = {}) => runModule(CREATE, world, [createEvent(caller, b)], opts);
export const lookup = (world: World, token: unknown, opts: Opts = {}) => runModule(LOOKUP, world, [publicEvent('/v1/invites/lookup', token === undefined ? {} : { token })], opts);
export const redeem = (world: World, token: unknown, password: unknown, opts: Opts = {}) =>
  runModule(REDEEM, world, [publicEvent('/v1/invites/redeem', { token, password })], opts);
/** issueInvite({ employee, hrPartner, sentBy }) as ONB-18 will call it. */
export const issue = (world: World, args: { employee: Record<string, unknown>; hrPartner: Record<string, unknown> | null; sentBy: string }, opts: Opts = {}) =>
  runModule(INVITE, world, [args], { ...opts, call: 'issueInvite' });

// ---------------------------------------------------------------- what a run did

export const cognitoCalls = (run: Run, op?: string) => run.calls.filter((c): c is Extract<Call, { service: 'cognito' }> => c.service === 'cognito' && (!op || c.op === op));
export const mails = (run: Run) => run.calls.filter((c): c is Extract<Call, { service: 'postmark' }> => c.service === 'postmark');
export const logLines = (run: Run) => run.calls.filter((c): c is Extract<Call, { service: 'log' }> => c.service === 'log');
export const published = (run: Run) => run.calls.filter((c): c is Extract<Call, { service: 'events' }> => c.service === 'events');
export const dynamoCalls = (run: Run) => run.calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb');

export const invites = (w: World) => (w.tables[INVITES] ?? []).map((r) => plain(r)!);
export const employees = (w: World) => w.tables.employees.map((r) => plain(r)!);
/** Rows that are not used, not replaced and not closed by five refused passwords (expiry not counted). */
export const current = (w: World) => invites(w).filter((r) => !r['used_at'] && !r['replaced_at'] && !(Number(r['failed_attempts'] ?? 0) >= 5));

export const sha256 = (token: string) => {
  const d = createHash('sha256').update(token, 'utf8').digest();
  return [d.toString('hex'), d.toString('base64'), d.toString('base64url')];
};

/** The one token in a run's email (text body), or throws. */
export function tokenOf(run: Run): string {
  const m = mails(run);
  if (m.length !== 1) throw new Error(`expected one email, found ${m.length}`);
  const found = [...String(m[0]!.message.TextBody ?? '').matchAll(LINK_IN_TEXT)].map((x) => x[1]!);
  if (found.length < 1) throw new Error('the email carries no set-password link');
  return found[0]!;
}

export const emptyWorld = (): World => ({ tables: { employees: [], [INVITES]: [], 'naleko-idempotency-keys': [] }, cognito: { users: [] } });

/** HR (Jane Smith, E2EHR01) is in the pool, with Thandi Nkosi (HR0042) as another partner. */
export function worldWithPool(): World {
  const w = emptyWorld();
  w.cognito.users.push(member('Jane', 'Smith', { staffId: 'E2EHR01', email: HR.email }), member('Thandi', 'Nkosi', { staffId: 'HR0042' }));
  return w;
}

export const PARTNER = { id: 'HR0042', name: 'Thandi Nkosi', first: 'Thandi' };

/** A test login: HR in the robots group (as every pepla-dev test login is). */
export const ROBOT_HR: JwtCaller = { ...HR, groups: ['hr_staff', 'e2e-robots'] };
export const ROBOT_ADDRESS = 'e2e.run-onb04-0001@blackhole.postmarkapp.com';

export const GOOD_PASSWORD = 'Kettle-Morning-2026';
export const OTHER_PASSWORD = 'Protea!Winter-2027';

/** An employee row as ONB-03 stores it, with the private fields lookup must never hand out. */
export function storedEmployee(over: Record<string, string> = {}): Row {
  return row({
    employee_id: '5d1c0a9e-7f3b-4c2a-9e1d-2b6f8a4c3e71',
    first_name: 'Lindiwe',
    middle_name: 'Grace',
    last_name: 'Mokoena',
    email: 'lindiwe.mokoena@x.co.za',
    phone: '082 555 0147',
    department: 'Finance',
    job_title: 'Bookkeeper',
    stage: 'INVITED',
    planned_start_date: '2026-12-01',
    created_at: '2026-11-16T08:00:00.000Z',
    created_by: 'E2EHR01',
    hr_staff_id: 'HR0042',
    hr_staff_name: 'Thandi Nkosi',
    hr_staff_email: 'thandi.nkosi@mokoena-logistics.co.za',
    id_number_last4: '4087',
    id_number_encrypted: Buffer.from('kms:9506145009087').toString('base64'),
    salary: '38500',
    bank_account_number: '62841937055',
    bank_name: 'First National Bank',
    notes: 'Private HR note: asked about a later start',
    ...over,
  });
}

/** issueInvite's arguments for a stored employee row. Both spellings, so either shape the helper reads is there. */
export function issueArgs(r: Row, partner: { id: string; name: string; staffId?: string; email?: string } | null = { id: 'HR0042', name: 'Thandi Nkosi', staffId: 'HR0042', email: 'thandi.nkosi@mokoena-logistics.co.za' }) {
  const e = plain(r)!;
  return {
    employee: { ...e, employeeId: e['employee_id'], firstName: e['first_name'], lastName: e['last_name'], startDate: e['planned_start_date'] },
    hrPartner: partner ? { staffId: partner.id, email: '', ...partner } : null,
    sentBy: 'E2EHR01',
  };
}

export const validBody = (over: Record<string, unknown> = {}) => body({ first_name: 'Ayanda', last_name: 'Zulu', email: 'ayanda.zulu@mokoena.co.za', department: 'Finance', ...over });
