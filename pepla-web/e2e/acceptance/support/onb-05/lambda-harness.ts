import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiEvent, type Caller, type JwtCaller } from '../onb-03/lambda-harness';
import { plain, row, type Row } from '../onb-15/lambda-harness';

/**
 * Runs the real ONB-05 code against a fake AWS (./fake-aws: ONB-03's DynamoDB fake, with the employee_consents
 * table, a fixed clock and every console line recorded):
 *   - lambda/getMyStart (GET /v1/me), lambda/recordConsent (POST /v1/me/consent), both behind the Cognito JWT authorizer,
 *   - lambda/shared/consent.mjs hasCurrentConsent(employeeId), called directly (ONB-06 will call it),
 *   - lambda/shared/privacy-notice.mjs, read for its exports.
 * Each run is a fresh Node process (a cold Lambda). The tables are handed back after each run, so the next run
 * starts where the last stopped. Nothing reaches AWS or any AI service.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
const LAMBDA = join(REPO, 'lambda');
export const GET_ME = join(LAMBDA, 'getMyStart', 'index.mjs');
export const RECORD = join(LAMBDA, 'recordConsent', 'index.mjs');
export const CONSENT_HELPER = join(LAMBDA, 'shared', 'consent.mjs');
export const NOTICE_MODULE = join(LAMBDA, 'shared', 'privacy-notice.mjs');
const FAKE_AWS = join(__dirname, 'fake-aws');

export { apiEvent, plain, row, type Caller, type JwtCaller, type Row };

export const CONSENTS = 'employee_consents';
export const COMPANY = 'Sunbird Bakery';

export type World = { tables: { employees: Row[]; employee_consents: Row[]; [name: string]: Row[] }; pageSize?: number; fail?: Array<{ op: string; table: string }> };
export type Call = { service: 'dynamodb'; op: string; table?: string; input: any } | { service: 'kms'; op: string } | { service: 'log'; level: string; message: string; extra?: unknown };
export type Answer = { response: any; status: number; body: any; raw: string; error?: { name: string; message: string; stack: string } };
export type Run = Answer & { all: Answer[]; calls: Call[]; world: World; output: string };

export const ENV: Record<string, string> = {
  ENVIRONMENT: 'dev',
  COMPANY_NAME: COMPANY,
  EMPLOYEES_TABLE: 'employees',
  // The consent table's name, under every name a Lambda might read it by. The table is called employee_consents.
  CONSENTS_TABLE: CONSENTS,
  CONSENT_TABLE: CONSENTS,
  EMPLOYEE_CONSENTS_TABLE: CONSENTS,
};

/** A fixed moment: 16 Nov 2026 06:42:00 UTC (08:42 in South Africa). */
export const T0 = '2026-11-16T06:42:00.000Z';
export const at = (base: string, seconds: number) => new Date(Date.parse(base) + seconds * 1000).toISOString();

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

function spawn(file: string, world: World, spec: unknown, opts: Opts): { result: any; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'onb-05-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify({ pageSize: 4, ...structuredClone(world) }));
  writeFileSync(eventFile, JSON.stringify(spec));
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    ONB05_WORLD: worldFile,
    ONB05_NOW: opts.now ?? T0,
    TZ: 'UTC',
    AWS_REGION: 'af-south-1',
    AWS_ACCESS_KEY_ID: 'onb05-fake',
    AWS_SECRET_ACCESS_KEY: 'onb05-fake',
    KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/onb-05-fake',
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
  const line = lines.find((l) => l.startsWith('@@ONB05@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  const result = JSON.parse(line.slice('@@ONB05@@'.length));
  if (result.loadError) {
    const e = new Error(`${file} could not be loaded: ${result.loadError.message}`);
    e.stack = result.loadError.stack;
    throw e;
  }
  return { result, output: lines.filter((l) => !l.startsWith('@@ONB05@@')).join('\n') };
}

/** Runs `file` once per event (or all at once with `concurrent`) in one fresh process against `world`. */
export function runModule(file: string, world: World, events: unknown[], opts: Opts = {}): Run {
  const { result, output } = spawn(file, world, { events, concurrent: !!opts.concurrent, ...(opts.call ? { call: opts.call } : {}) }, opts);
  const all = events.map((_e, i) => answerOf(result.responses[i], result.errors[i] ?? undefined));
  return { ...all[0]!, all, calls: result.calls, world: { ...world, tables: result.tables }, output };
}

/** The module's exports that are not functions (the notice), as JSON. */
export function exportsOf(file: string): Record<string, any> {
  return spawn(file, { tables: { employees: [], employee_consents: [] } }, { exports: true }, {}).result.exports;
}

// ---------------------------------------------------------------- the routes

export const meEvent = (caller: Caller) => apiEvent({ method: 'GET', route: '/v1/me', caller });
export const consentEvent = (caller: Caller, b?: unknown, headers?: Record<string, string>) => apiEvent({ method: 'POST', route: '/v1/me/consent', caller, body: b, headers });

export const getMe = (world: World, caller: Caller, opts: Opts = {}) => runModule(GET_ME, world, [meEvent(caller)], opts);
export const record = (world: World, caller: Caller, b?: unknown, opts: Opts = {}) => runModule(RECORD, world, [consentEvent(caller, b)], opts);
export const hasCurrentConsent = (world: World, employeeId: string) => runModule(CONSENT_HELPER, world, [employeeId], { call: 'hasCurrentConsent' });

// ---------------------------------------------------------------- what a run did

export const dynamoCalls = (run: Run) => run.calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb');
export const logLines = (run: Run) => run.calls.filter((c): c is Extract<Call, { service: 'log' }> => c.service === 'log');
export const WRITE_OPS = ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'];
export const writes = (run: Run) => dynamoCalls(run).filter((c) => WRITE_OPS.includes(c.op));
export const consents = (w: World) => (w.tables[CONSENTS] ?? []).map((r) => plain(r)!);

// ---------------------------------------------------------------- the people

/** The person who calls: an employee token whose email differs from the stored one only in case. */
export const LINDIWE: JwtCaller = { kind: 'jwt', email: 'Lindiwe.Mokoena@X.co.za', groups: ['employee'], sub: '7f3c2a10-5b9e-4d61-8a2f-0c4e9b7d1a55', givenName: 'Lindiwe', familyName: 'Mokoena' };
export const LINDIWE_ID = '5d1c0a9e-7f3b-4c2a-9e1d-2b6f8a4c3e71';
export const OTHER_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
export const HR: JwtCaller = { kind: 'jwt', email: 'jane.smith@mokoena-logistics.co.za', groups: ['hr_staff'], staffId: 'E2EHR01', givenName: 'Jane', familyName: 'Smith' };

/** An employee row as ONB-03 stores it, with the private fields GET /v1/me must never hand out. */
export function storedEmployee(over: Record<string, string> = {}): Row {
  return row({
    employee_id: LINDIWE_ID,
    first_name: 'Lindiwe',
    middle_name: 'Grace',
    last_name: 'Mokoena',
    email: 'lindiwe.mokoena@x.co.za',
    phone: '082 555 0147',
    department: 'Finance',
    job_title: 'Bookkeeper',
    stage: 'INVITED',
    step: 'INVITED',
    planned_start_date: '2026-12-01',
    created_at: '2026-11-10T08:00:00.000Z',
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

/** Kagiso: another employee in the same company. */
export const otherEmployee = () =>
  storedEmployee({ employee_id: OTHER_ID, first_name: 'Kagiso', middle_name: '', last_name: 'Molefe', email: 'kagiso.molefe@x.co.za', id_number_last4: '1183', phone: '083 444 0199' });

export const consentRow = (employeeId: string, version: string, acceptedAt: string, extra: Record<string, string> = {}) =>
  row({ employee_id: employeeId, notice_version: version, accepted_at: acceptedAt, cognito_sub: LINDIWE.sub!, notice_sha256: 'a'.repeat(64), source: 'web', ...extra });

export const world = (consentRows: Row[] = []): World => ({ tables: { employees: [storedEmployee(), otherEmployee()], [CONSENTS]: consentRows } as World['tables'] });
