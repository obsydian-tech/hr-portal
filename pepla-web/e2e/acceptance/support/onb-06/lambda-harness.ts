import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiEvent, type Caller, type JwtCaller } from '../onb-03/lambda-harness';
import { plain, row, type Row } from '../onb-15/lambda-harness';

/**
 * ONB-06: runs the real ONB-06 code against a fake AWS (./fake-aws: ONB-05's DynamoDB fake with the
 * employee_consents and documents tables, a fixed clock, every console line recorded, plus an S3 client that
 * refuses every call and a URL signer that records what the signature would bind):
 *   - lambda/getMyDocuments     GET  /v1/me/documents             (Cognito JWT authorizer)
 *   - lambda/createMyUploadLink POST /v1/me/documents/upload-url  (Cognito JWT authorizer)
 *   - lambda/shared/upload-link.mjs, read for its exports only.
 * Each run is a fresh Node process (a cold Lambda). The tables are handed back after each run, so the next run
 * starts where the last stopped. Nothing reaches AWS or any AI service.
 *
 * Since TEN-01 every caller's token carries the company in the claim `tenant_id`: callers here are company A
 * unless a test says otherwise.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
const LAMBDA = join(REPO, 'lambda');
export const GET_DOCS = join(LAMBDA, 'getMyDocuments', 'index.mjs');
export const CREATE_LINK = join(LAMBDA, 'createMyUploadLink', 'index.mjs');
export const UPLOAD_LINK_MODULE = join(LAMBDA, 'shared', 'upload-link.mjs');
export const NOTICE_MODULE = join(LAMBDA, 'shared', 'privacy-notice.mjs');
const FAKE_AWS = join(__dirname, 'fake-aws');

export { plain, row, type Caller, type JwtCaller, type Row };

export const CONSENTS = 'employee_consents';
export const DOCUMENTS = 'documents';
export const BUCKET = 'onb-06-uploads';
export const COMPANY = 'Sunbird Bakery';

/** Two companies. Ids follow `^ten_[0-9a-z]{26}$` (lambda/shared/tenant.mjs). */
export const TEN_A = 'ten_01jcz8a4a6k3q9v2x7b5m0d4e1';
export const TEN_B = 'ten_01jcz8b7c9n5r2w4y6d8f0h3j5';

export type World = { tables: { employees: Row[]; employee_consents: Row[]; documents: Row[]; [name: string]: Row[] }; pageSize?: number; fail?: Array<{ op: string; table: string }> };
export type Call =
  | { service: 'dynamodb'; op: string; table?: string; input: any }
  | { service: 'kms'; op: string }
  | { service: 's3'; op: string; key?: string; bucket?: string; expiresIn?: number; contentType?: string; contentLength?: unknown; unsignable?: string[]; unhoistable?: string[]; otherInput?: string[] }
  | { service: 'log'; level: string; message: string; extra?: unknown };
export type Answer = { response: any; status: number; body: any; raw: string; error?: { name: string; message: string; stack: string } };
export type Run = Answer & { all: Answer[]; calls: Call[]; world: World; output: string };

export const ENV: Record<string, string> = {
  ENVIRONMENT: 'dev',
  COMPANY_NAME: COMPANY,
  EMPLOYEES_TABLE: 'employees',
  DOCUMENTS_TABLE: DOCUMENTS,
  CONSENTS_TABLE: CONSENTS,
  CONSENT_TABLE: CONSENTS,
  EMPLOYEE_CONSENTS_TABLE: CONSENTS,
  UPLOAD_BUCKET: BUCKET,
  DOCUMENT_BUCKET: BUCKET,
  UPLOADS_BUCKET: BUCKET,
};

/** A fixed moment: 17 Nov 2026 07:30:00 UTC (09:30 in South Africa). */
export const T0 = '2026-11-17T07:30:00.000Z';
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
  const dir = mkdtempSync(join(tmpdir(), 'onb-06-lambda-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify({ pageSize: 4, ...structuredClone(world) }));
  writeFileSync(eventFile, JSON.stringify(spec));
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    ONB06_WORLD: worldFile,
    ONB06_NOW: opts.now ?? T0,
    TZ: 'UTC',
    AWS_REGION: 'af-south-1',
    AWS_ACCESS_KEY_ID: 'onb06-fake',
    AWS_SECRET_ACCESS_KEY: 'onb06-fake',
    KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/onb-06-fake',
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
  const line = lines.find((l) => l.startsWith('@@ONB06@@'));
  if (!line) throw new Error(`the handler printed no result:\n${out.slice(-2000)}`);
  const result = JSON.parse(line.slice('@@ONB06@@'.length));
  if (result.loadError) {
    const e = new Error(`${file} could not be loaded: ${result.loadError.message}`);
    e.stack = result.loadError.stack;
    throw e;
  }
  return { result, output: lines.filter((l) => !l.startsWith('@@ONB06@@')).join('\n') };
}

/** Runs `file` once per event (or all at once with `concurrent`) in one fresh process against `world`. */
export function runModule(file: string, world: World, events: unknown[], opts: Opts = {}): Run {
  const { result, output } = spawn(file, world, { events, concurrent: !!opts.concurrent, ...(opts.call ? { call: opts.call } : {}) }, opts);
  const all = events.map((_e, i) => answerOf(result.responses[i], result.errors[i] ?? undefined));
  return { ...all[0]!, all, calls: result.calls, world: { ...world, tables: result.tables }, output };
}

/** The module's exports that are not functions, as JSON. */
export function exportsOf(file: string): Record<string, any> {
  return spawn(file, { tables: { employees: [], employee_consents: [], documents: [] } }, { exports: true }, {}).result.exports;
}

// ---------------------------------------------------------------- the routes

export type EventOpts = {
  /** The company in the token. Default company A; `null` leaves the claim out. */
  tenant?: string | null;
  /** The `email_verified` claim: 'true' (default), another value, or 'omit' to leave it out. */
  emailVerified?: unknown;
  /** The `token_use` claim: 'id' or leave out for an ID token; 'access' for an access token. */
  tokenUse?: unknown;
  body?: unknown;
  query?: Record<string, string>;
  pathParameters?: Record<string, string>;
  headers?: Record<string, string>;
};

/** An API Gateway event for one of the two routes, with the caller's token claims as Cognito and TEN-01 write them. */
export function event(method: 'GET' | 'POST', route: string, caller: Caller, o: EventOpts = {}): any {
  const ev: any = apiEvent({ method, route, caller, body: o.body, query: o.query, headers: o.headers });
  const claims = ev.requestContext?.authorizer?.jwt?.claims;
  if (claims) {
    if (o.emailVerified === 'omit') delete claims.email_verified;
    else if (o.emailVerified !== undefined) claims.email_verified = o.emailVerified;
    if (o.tokenUse !== undefined) claims.token_use = o.tokenUse;
    const tenant = o.tenant === undefined ? TEN_A : o.tenant;
    if (tenant) claims.tenant_id = tenant;
  }
  if (o.pathParameters) ev.pathParameters = o.pathParameters;
  return ev;
}

export const LIST_ROUTE = '/v1/me/documents';
export const LINK_ROUTE = '/v1/me/documents/upload-url';
export const listEvent = (caller: Caller, o: EventOpts = {}) => event('GET', LIST_ROUTE, caller, o);
export const linkEvent = (caller: Caller, body?: unknown, o: EventOpts = {}) => event('POST', LINK_ROUTE, caller, { ...o, body });

export const list = (world: World, caller: Caller, o: EventOpts = {}, opts: Opts = {}) => runModule(GET_DOCS, world, [listEvent(caller, o)], opts);
export const makeLink = (world: World, caller: Caller, body?: unknown, o: EventOpts = {}, opts: Opts = {}) => runModule(CREATE_LINK, world, [linkEvent(caller, body, o)], opts);

// ---------------------------------------------------------------- what a run did

export const dynamoCalls = (run: Run) => run.calls.filter((c): c is Extract<Call, { service: 'dynamodb' }> => c.service === 'dynamodb');
export const s3Calls = (run: Run) => run.calls.filter((c): c is Extract<Call, { service: 's3' }> => c.service === 's3');
export const presigns = (run: Run) => s3Calls(run).filter((c) => c.op.startsWith('presign:'));
export const logLines = (run: Run) => run.calls.filter((c): c is Extract<Call, { service: 'log' }> => c.service === 'log');
export const WRITE_OPS = ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'];
export const writes = (run: Run) => dynamoCalls(run).filter((c) => WRITE_OPS.includes(c.op));
export const documentRows = (w: World) => (w.tables[DOCUMENTS] ?? []).map((r) => plain(r)!);
/** Nothing read, nothing written, nothing signed: no DynamoDB call and no S3 call of any kind. */
export const noAwsCalls = (run: Run) => [...dynamoCalls(run), ...s3Calls(run)].map((c) => `${c.service} ${c.op}${'table' in c && c.table ? ' ' + c.table : ''}`);

// ---------------------------------------------------------------- the people

/** The person who calls: an employee token whose email differs from the stored one only in case. */
export const LINDIWE: JwtCaller = { kind: 'jwt', email: 'Lindiwe.Mokoena@X.co.za', groups: ['employee'], sub: '7f3c2a10-5b9e-4d61-8a2f-0c4e9b7d1a55', givenName: 'Lindiwe', familyName: 'Mokoena' };
export const LINDIWE_ID = '5d1c0a9e-7f3b-4c2a-9e1d-2b6f8a4c3e71';
export const OTHER_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
export const HR: JwtCaller = { kind: 'jwt', email: 'jane.smith@mokoena-logistics.co.za', groups: ['hr_staff'], staffId: 'E2EHR01', givenName: 'Jane', familyName: 'Smith' };

/** An employee row as ONB-03 stores it, in company A, with the private fields the list must never hand out. */
export function storedEmployee(over: Record<string, string | undefined> = {}): Row {
  return row({
    employee_id: LINDIWE_ID,
    tenant_id: TEN_A,
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

/** Kagiso: another employee in the same company, with his own documents. */
export const otherEmployee = () =>
  storedEmployee({ employee_id: OTHER_ID, first_name: 'Kagiso', middle_name: '', last_name: 'Molefe', email: 'kagiso.molefe@x.co.za', id_number_last4: '1183', phone: '083 444 0199' });

export const consentRow = (employeeId: string, version: string, acceptedAt: string) =>
  row({ employee_id: employeeId, notice_version: version, accepted_at: acceptedAt, cognito_sub: LINDIWE.sub!, notice_sha256: 'a'.repeat(64), source: 'web' });

/**
 * A documents row as processDocumentOCR and the review route leave it, in company A, carrying every private field
 * the list must never hand out (the S3 key, the verification id, what the check found).
 */
export type StoredDoc = {
  id: string;
  type: string;
  status: string;
  /** Left out when not given: a row from before upload_timestamp was written. */
  uploaded?: string;
  employee?: string;
  file?: string;
  started?: string;
  completed?: string;
  reviewed?: string;
  tenant?: string | null;
  extra?: Record<string, string | undefined>;
};
export function docRow(d: StoredDoc): Row {
  const employee = d.employee ?? LINDIWE_ID;
  return row({
    employee_id: employee,
    document_id: d.id,
    ...(d.tenant === null ? {} : { tenant_id: d.tenant ?? TEN_A }),
    document_type: d.type,
    s3_key: `uploads/${employee}/${d.type}/${d.id}_${d.file ?? 'scan.pdf'}`,
    file_name: d.file ?? 'scan.pdf',
    upload_timestamp: d.uploaded,
    ocr_status: d.status,
    verification_id: `ver-${d.id}`,
    ocr_started_at: d.started,
    ocr_completed_at: d.completed,
    hr_reviewed_at: d.reviewed,
    hr_reviewed_by: d.reviewed ? 'Thandi Nkosi' : undefined,
    hr_decision_notes: d.reviewed ? 'Checked by hand' : undefined,
    confidence: d.completed ? '0.9731' : undefined,
    check_reasoning: d.completed ? 'The ID number 9506145009087 matches the name on the form' : undefined,
    ...(d.extra ?? {}),
  });
}

export const world = (opts: { consents?: Row[]; docs?: Row[]; employees?: Row[] } = {}): World => ({
  tables: { employees: opts.employees ?? [storedEmployee(), otherEmployee()], [CONSENTS]: opts.consents ?? [], [DOCUMENTS]: opts.docs ?? [] } as World['tables'],
});
