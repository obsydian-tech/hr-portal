import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * ONB-22: runs the real Lambdas, each call in its own fresh Node process (a cold Lambda), against a fake AWS
 * (./fake-aws, copied from TEN-02's, with code added: a Lambda client that runs the real review Lambda against the same
 * tables, EventBridge that hands every event to the real auditLogConsumer, ordered indexes, a fake fetch).
 * Nothing reaches AWS or any outside host. Bedrock, Textract and any other AI client fail the import or the call.
 *
 * Two companies, A and B. All names and addresses are made up. Everything here is data and plumbing; the rules live in
 * onb-22.spec.ts.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
export const LAMBDA = join(REPO, 'lambda');
export const FAKE_AWS = join(__dirname, 'fake-aws');
export const handlerOf = (name: string) => join(LAMBDA, name, 'index.mjs');

// ------------------------------------------------------------------ stored rows

export type Row = Record<string, Record<string, unknown>>;
export type Tables = Record<string, Row[]>;

export function row(values: Record<string, string | number | boolean | undefined | null>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) continue;
    out[k] = v === null ? { NULL: true } : typeof v === 'number' ? { N: String(v) } : typeof v === 'boolean' ? { BOOL: v } : { S: v };
  }
  return out;
}

export function plain(r: Row | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r ?? {})) out[k] = 'S' in v ? v['S'] : 'N' in v ? Number(v['N']) : 'BOOL' in v ? v['BOOL'] : 'NULL' in v ? null : v;
  return out;
}

export const rowsOf = (t: Tables, name: string) => (t[name] ?? []).map((r) => plain(r));
export function find(t: Tables, name: string, where: Record<string, unknown>): Record<string, unknown> | undefined {
  return rowsOf(t, name).find((r) => Object.entries(where).every(([k, v]) => r[k] === v));
}

// ------------------------------------------------------------------ the two companies

export const A = 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa';
export const B = 'ten_bbbbbbbbbbbbbbbbbbbbbbbbbb';
export const AGENT_SECRET = 'naleko/agent/api-key';
/** The review Lambda is named by a setting; this name is not the folder name, so a constant in the code fails. */
export const REVIEW_NAME = 'naleko-review-document-onb22';
export const NOW = () => new Date().toISOString();

export const P = {
  // Company A
  nomsa: { id: '3f1a7c52-0001-4d7e-9a11-aaaaaaaa0001', first: 'Nomsa', last: 'Dlamini', mail: 'nomsa.dlamini@baker-a.example' }, // one document accepted, the second waits (Matches)
  sipho: { id: '3f1a7c52-0002-4d7e-9a11-aaaaaaaa0002', first: 'Sipho', last: 'Khumalo', mail: 'sipho.khumalo@baker-a.example' }, // both documents wait (Matches)
  thabo: { id: '3f1a7c52-0003-4d7e-9a11-aaaaaaaa0003', first: 'Thabo', last: 'Mahlangu', mail: 'thabo.mahlangu@baker-a.example' }, // waits, Needs a look
  lerato: { id: '3f1a7c52-0004-4d7e-9a11-aaaaaaaa0004', first: 'Lerato', last: 'Molefe', mail: 'lerato.molefe@baker-a.example' }, // being read
  zanele: { id: '3f1a7c52-0005-4d7e-9a11-aaaaaaaa0005', first: 'Zanele', last: 'Ndaba', mail: 'zanele.ndaba@baker-a.example' }, // already decided by HR
  piet: { id: '3f1a7c52-0006-4d7e-9a11-aaaaaaaa0006', first: 'Piet', last: 'Venter', mail: 'piet.venter@baker-a.example' }, // Doesn't match
  // Company B
  bea: { id: '3f1a7c52-00b1-4d7e-9a11-bbbbbbbb0001', first: 'Bea', last: 'Ngcobo', mail: 'bea.ngcobo@baker-b.example' },
};
export const D = {
  nomsaId: 'dd000000-0001-4d7e-9a11-aaaaaaaa0001', // accepted National ID
  nomsaBank: 'dd000000-0002-4d7e-9a11-aaaaaaaa0002', // waiting, Matches
  siphoId: 'dd000000-0003-4d7e-9a11-aaaaaaaa0003', // waiting, Matches
  siphoBank: 'dd000000-0004-4d7e-9a11-aaaaaaaa0004', // waiting, Matches
  thabo: 'dd000000-0005-4d7e-9a11-aaaaaaaa0005', // waiting, Needs a look
  lerato: 'dd000000-0006-4d7e-9a11-aaaaaaaa0006', // being read
  zanele: 'dd000000-0007-4d7e-9a11-aaaaaaaa0007', // decided
  piet: 'dd000000-0008-4d7e-9a11-aaaaaaaa0008', // Doesn't match
  bea: 'dd000000-00b1-4d7e-9a11-bbbbbbbb0001', // company B, waiting, Matches
};
export const V = (d: string) => 'vv' + d.slice(2);
export const HR = {
  a: { sub: 'sub-hr-a-0001', email: 'thandi.mokoena@baker-a.example', first: 'Thandi', last: 'Mokoena', staff: 'HRA001' },
  a2: { sub: 'sub-hr-a-0002', email: 'pieter.vanwyk@baker-a.example', first: 'Pieter', last: 'Van Wyk', staff: 'HRA002' },
  b: { sub: 'sub-hr-b-0001', email: 'bongani.sithole@baker-b.example', first: 'Bongani', last: 'Sithole', staff: 'HRB001' },
};

const ISO = (day: number) => `2026-11-${String(day).padStart(2, '0')}T08:00:00.000Z`;

function employee(p: { id: string; first: string; last: string; mail: string }, tenant: string, extra: Record<string, string | number | undefined> = {}): Row {
  return row({
    employee_id: p.id, first_name: p.first, last_name: p.last, email: p.mail, phone: '000 000 0000', department: 'Bakery', position: 'Baker',
    stage: 'DOCUMENTS_SUBMITTED', step: 'IN_REVIEW', created_by: 'HRA001', hr_staff_id: 'HRA001', created_at: ISO(10), tenant_id: tenant, ...extra,
  });
}
export function document(emp: string, doc: string, type: string, tenant: string, extra: Record<string, string | number | undefined> = {}): Row {
  return row({
    employee_id: emp, document_id: doc, document_type: type, verification_id: V(doc), ocr_status: 'MANUAL_REVIEW', upload_timestamp: ISO(11),
    s3_key: `uploads/${emp}/${type}/${doc}.pdf`, s3_bucket: 'onb22-uploads', file_name: 'letter.pdf', tenant_id: tenant, ...extra,
  });
}
export function verification(emp: string, doc: string, type: string, tenant: string, check: string | undefined, extra: Record<string, string | number | undefined> = {}): Row {
  return row({
    verificationId: V(doc), employeeId: emp, documentId: doc, documentType: type, decision: 'MANUAL_REVIEW', confidence: 96,
    ...(check ? { check } : {}), createdAt: ISO(11), tenant_id: tenant, ...extra,
  });
}

/** The seeded world. */
export function tables(): Tables {
  const ids = (p: { id: string }, d: string, type: string, t: string, check: string | undefined, docExtra = {}, verExtra = {}) =>
    [document(p.id, d, type, t, docExtra), verification(p.id, d, type, t, check, verExtra)] as const;
  const n = ids(P.nomsa, D.nomsaId, 'NATIONAL_ID', A, 'MATCHES', { ocr_status: 'PASSED', hr_reviewed_at: ISO(12), hr_reviewed_by: HR.a2.email, hr_reviewed_by_name: 'Pieter Van Wyk' }, { decision: 'PASSED' });
  const nb = ids(P.nomsa, D.nomsaBank, 'BANK_CONFIRMATION', A, 'MATCHES');
  const si = ids(P.sipho, D.siphoId, 'NATIONAL_ID', A, 'MATCHES');
  const sb = ids(P.sipho, D.siphoBank, 'BANK_CONFIRMATION', A, 'MATCHES');
  const th = ids(P.thabo, D.thabo, 'NATIONAL_ID', A, 'NEEDS_A_LOOK');
  const le = [document(P.lerato.id, D.lerato, 'NATIONAL_ID', A, { ocr_status: 'PROCESSING', verification_id: undefined })] as const;
  const za = ids(P.zanele, D.zanele, 'NATIONAL_ID', A, 'MATCHES', { ocr_status: 'PASSED', hr_reviewed_at: ISO(12), hr_reviewed_by: HR.a2.email, hr_reviewed_by_name: 'Pieter Van Wyk' }, { decision: 'PASSED' });
  const pi = ids(P.piet, D.piet, 'NATIONAL_ID', A, 'DOESNT_MATCH');
  const be = ids(P.bea, D.bea, 'NATIONAL_ID', B, 'MATCHES');
  return {
    employees: [
      employee(P.nomsa, A), employee(P.sipho, A), employee(P.thabo, A), employee(P.lerato, A, { step: 'DOCUMENTS', stage: 'ACTIVE' }),
      employee(P.zanele, A), employee(P.piet, A), employee(P.bea, B),
    ],
    documents: [...n.slice(0, 1), ...nb.slice(0, 1), ...si.slice(0, 1), ...sb.slice(0, 1), ...th.slice(0, 1), ...le, ...za.slice(0, 1), ...pi.slice(0, 1), ...be.slice(0, 1)],
    'document-verification': [n[1], nb[1], si[1], sb[1], th[1], za[1], pi[1], be[1]],
    'naleko-pending-actions': [],
    'onboarding-events': [],
    'naleko-idempotency-keys': [],
    employee_consents: [],
    'naleko-agent-audit': [],
    NalekoAiRateLimit: [],
    'naleko-prompt-cache': [],
  };
}

// ------------------------------------------------------------------ who calls

export type Caller = 'hrA' | 'hrA2' | 'hrB' | 'hrReadonlyA' | 'employeeA' | 'agentA' | 'agentB' | 'accessTokenA' | 'noTenantHr' | 'managerA' | 'hrNoEmail' | 'hrBlankEmail';

function claimsOf(who: { sub: string; email: string; first: string; last: string; staff: string }, tenant: string | undefined, groups: string[], extra: Record<string, unknown> = {}) {
  return {
    sub: who.sub, email: who.email, email_verified: 'true', given_name: who.first, family_name: who.last, token_use: 'id', 'custom:staff_id': who.staff,
    'cognito:groups': `[${groups.join(' ')}]`, iss: 'https://cognito-idp.af-south-1.amazonaws.com/af-south-1_Onb22Fake', ...(tenant ? { tenant_id: tenant } : {}), ...extra,
  };
}
export function authorizerOf(caller: Caller): unknown {
  const jwt = (claims: Record<string, unknown>) => ({ jwt: { claims, scopes: null } });
  switch (caller) {
    case 'hrA': return jwt(claimsOf(HR.a, A, ['hr_staff']));
    case 'hrA2': return jwt(claimsOf(HR.a2, A, ['hr_staff']));
    case 'hrB': return jwt(claimsOf(HR.b, B, ['hr_staff']));
    case 'hrReadonlyA': return jwt(claimsOf(HR.a, A, ['hr_staff_readonly']));
    case 'managerA': return jwt(claimsOf(HR.a, A, ['manager', 'perm-recruitment']));
    case 'employeeA': return jwt(claimsOf({ sub: 'sub-emp-nomsa', email: P.nomsa.mail, first: P.nomsa.first, last: P.nomsa.last, staff: '' }, A, ['employee']));
    case 'accessTokenA': return jwt(claimsOf(HR.a, A, ['hr_staff'], { token_use: 'access' }));
    case 'noTenantHr': return jwt(claimsOf(HR.a, undefined, ['hr_staff']));
    // ONB-22.1 (S-1): an HR sign-in whose token carries no email (missing, or empty).
    case 'hrNoEmail': return jwt(claimsOf(HR.a, A, ['hr_staff'], { email: undefined }));
    case 'hrBlankEmail': return jwt(claimsOf(HR.a, A, ['hr_staff'], { email: '' }));
    case 'agentA': return { lambda: { actor: 'AGENT', tenant_id: A } };
    case 'agentB': return { lambda: { actor: 'AGENT', tenant_id: B } };
  }
}

export type Ask = { method?: string; route?: string; path: string; pathParameters?: Record<string, string>; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> };

/** An HTTP API (payload 2.0) event, as API Gateway hands it over. `route` is the route key's path (with {params}). */
export function eventFor(caller: Caller, a: Ask): any {
  const method = a.method ?? 'GET';
  const query = a.query ?? {};
  return {
    version: '2.0',
    routeKey: `${method} ${a.route ?? a.path}`,
    rawPath: a.path,
    rawQueryString: new URLSearchParams(query).toString(),
    headers: { 'content-type': 'application/json', ...(a.headers ?? {}) },
    ...(Object.keys(query).length ? { queryStringParameters: query } : {}),
    ...(a.pathParameters ? { pathParameters: a.pathParameters } : {}),
    requestContext: {
      http: { method, path: a.path, protocol: 'HTTP/1.1', sourceIp: '198.51.100.22', userAgent: 'onb-22-acceptance' },
      routeKey: `${method} ${a.route ?? a.path}`,
      stage: '$default',
      authorizer: authorizerOf(caller),
    },
    ...(a.body === undefined ? {} : { body: typeof a.body === 'string' ? a.body : JSON.stringify(a.body) }),
    isBase64Encoded: false,
  };
}

// ------------------------------------------------------------------ settings and runs

export function settings(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    ENVIRONMENT: 'dev',
    LEGACY_TENANT_ID: '', // the legacy rule is off: every row here carries its company
    AGENT_TENANT_ID: A,
    EVENT_BUS_NAME: 'naleko-onboarding-onb22',
    PENDING_ACTIONS_TABLE: 'naleko-pending-actions',
    IDEMPOTENCY_TABLE: 'naleko-idempotency-keys',
    EMPLOYEES_TABLE: 'employees',
    DOCUMENTS_TABLE: 'documents',
    VERIFICATIONS_TABLE: 'document-verification',
    VERIFICATION_TABLE: 'document-verification',
    AUDIT_TABLE: 'onboarding-events',
    AUDIT_TABLE_NAME: 'onboarding-events',
    KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/onb22',
    KMS_KEY_ID: 'alias/onb22',
    AGENT_API_BASE_URL: 'https://agent.onb22.example',
    AGENT_API_BASE: 'https://agent.onb22.example',
    AGENT_API_KEY_SECRET_NAME: AGENT_SECRET,
    REVIEW_FUNCTION_NAME: REVIEW_NAME,
    ONB22_FUNCTIONS: JSON.stringify({ [REVIEW_NAME]: handlerOf('reviewDocumentVerification') }),
    ONB22_AUDIT_CONSUMER: handlerOf('auditLogConsumer'),
    UPLOAD_BUCKET: 'onb22-uploads',
    ...extra,
  };
}

export type Call = { service: string; op?: string; [k: string]: any };
export type Run = { response?: any; responses?: any[]; error?: { name: string; message: string; stack: string }; calls: Call[]; tables: Tables };
export type World = { tables?: Tables; secrets?: Record<string, Record<string, string>>; fetch?: unknown; invokeFail?: string; eventBridgeDown?: boolean | string; eventBridgeFailFirst?: number; fail?: unknown };

export function runNode(script: string, args: string[], world: World, files: Record<string, unknown>, env: Record<string, string | undefined>, cwd?: string): any {
  const dir = mkdtempSync(join(tmpdir(), 'onb-22-'));
  const worldFile = join(dir, 'world.json');
  writeFileSync(worldFile, JSON.stringify({ pageSize: 4, ...world, tables: structuredClone(world.tables ?? {}) }));
  const paths: string[] = [];
  for (const [name, value] of Object.entries(files)) {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(value));
    paths.push(p);
  }
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) clean[k] = v;
  const out = execFileSync(process.execPath, ['--no-warnings', '--import', join(FAKE_AWS, 'register.mjs'), script, ...args, ...paths], {
    cwd: cwd ?? dir,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { PATH: process.env['PATH'] ?? '', ONB22_WORLD: worldFile, AWS_REGION: 'af-south-1', AWS_ACCESS_KEY_ID: 'onb22-fake', AWS_SECRET_ACCESS_KEY: 'onb22-fake', POWERTOOLS_DEV: 'false', POWERTOOLS_TRACE_ENABLED: 'false', ...clean },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@ONB22@@'));
  if (!line) throw new Error(`the run printed no result:\n${out.slice(-2000)}`);
  return JSON.parse(line.slice('@@ONB22@@'.length));
}

export type Opts = World & { env?: Record<string, string | undefined>; noLambdaClient?: boolean };

/** Calls `handler` (a Lambda folder name) once, in a fresh process, as `caller` does. */
export function call(handler: string, caller: Caller, a: Ask, opts: Opts = {}): Run {
  return callEvent(handler, eventFor(caller, a), opts);
}
export function callEvent(handler: string, event: unknown, opts: Opts = {}): Run {
  const r = runNode(join(FAKE_AWS, 'run.mjs'), [handlerOf(handler)], { tables: opts.tables ?? tables(), secrets: opts.secrets ?? { [AGENT_SECRET]: { AWSCURRENT: 'onb22-agent-key' } }, fetch: opts.fetch, invokeFail: opts.invokeFail, eventBridgeDown: opts.eventBridgeDown, eventBridgeFailFirst: opts.eventBridgeFailFirst, fail: opts.fail }, { 'event.json': event }, settings({ ...(opts.noLambdaClient ? { ONB22_NO_LAMBDA_CLIENT: '1' } : {}), ...(opts.env ?? {}) }));
  return r as Run;
}
/** Two or more calls started together in one warm container. */
export function callTogether(handler: string, events: unknown[], opts: Opts = {}): Run {
  const r = runNode(join(FAKE_AWS, 'run.mjs'), [handlerOf(handler)], { tables: opts.tables ?? tables(), secrets: { [AGENT_SECRET]: { AWSCURRENT: 'onb22-agent-key' } }, invokeFail: opts.invokeFail }, { 'event.json': { parallel: events } }, settings(opts.env ?? {}));
  return r as Run;
}

export const statusOf = (r: Run, i?: number) => Number((i === undefined ? r.response : r.responses?.[i])?.statusCode);
export function bodyOf(r: Run, i?: number): any {
  const res = i === undefined ? r.response : r.responses?.[i];
  try { return JSON.parse(res?.body ?? 'null'); } catch { return res?.body; }
}
export const describe = (r: Run) => (r.error ? `the Lambda threw ${r.error.name}: ${r.error.message.slice(0, 160)}` : `${statusOf(r)} ${String(r.response?.body ?? '').slice(0, 200)}`);

// ------------------------------------------------------------------ what a run did

export const WRITE_OPS = ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'];
/** Every call to an outside service, one line each; log lines left out. */
export const awsCalls = (calls: Call[]) => calls.filter((c) => c.service !== 'log').map((c) => `${c.service} ${c.op ?? c.method ?? ''}${c.table ? ' ' + c.table : ''}`);
export const writesOf = (calls: Call[]) => calls.filter((c) => c.service === 'dynamodb' && WRITE_OPS.includes(c.op!)).map((c) => `${c.op} ${c.table}`);
export const writesTo = (calls: Call[], table: string) => calls.filter((c) => c.service === 'dynamodb' && WRITE_OPS.includes(c.op!) && c.table === table);
export const publishedOf = (calls: Call[], detailType?: string) => calls.filter((c) => c.service === 'events' && (!detailType || c.detailType === detailType));
export const invokesOf = (calls: Call[]) => calls.filter((c) => c.service === 'lambda');
export const bedrockOf = (calls: Call[]) => calls.filter((c) => c.service === 'bedrock');
export const logLines = (calls: Call[]) => calls.filter((c) => c.service === 'log').map((c) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);
export const httpOf = (calls: Call[]) => calls.filter((c) => c.service === 'http');

/** The rows of the audit table as the audit consumer wrote them (the events of every run so far in this process). */
export const auditRows = (t: Tables) => rowsOf(t, 'onboarding-events');

// ------------------------------------------------------------------ warm containers: the MCP server and Ask Batsi's resolver

export type Step =
  | { call: unknown }
  | { resolve: { tool: string; args?: unknown; context?: unknown } }
  | { rotate: { secretId: string; set: Record<string, string> } }
  | { advance: number }
  | { fetch: unknown };
export type Answer = { status?: number; headers?: Record<string, string>; body?: string; result?: any; error?: string; httpFrom: number; httpTo: number };
export type StepsRun = { answers: Answer[]; calls: Call[]; error?: { name: string; message: string; stack: string }; tables: Tables };

export function runSteps(mode: 'mcp' | 'resolver', moduleFile: string, steps: Step[], world: World, env: Record<string, string | undefined> = {}, cwd?: string): StepsRun {
  return runNode(join(FAKE_AWS, 'steps-run.mjs'), [mode, moduleFile], world, { 'steps.json': steps }, settings(env), cwd);
}

/** The agent API calls an answer made. */
export const httpIn = (run: StepsRun, a: Answer) => httpOf(run.calls).slice(a.httpFrom, a.httpTo);
/** The JSON-RPC message in an SSE body (`event: message` / `data: {...}`), or the plain JSON body. */
export function rpcOf(a: Answer): any {
  const text = a.body ?? '';
  const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim());
  try { return JSON.parse(data.length ? data[data.length - 1]! : text); } catch { return undefined; }
}

// ------------------------------------------------------------------ the MCP server as CI builds it

export type McpBundle = { built: boolean; log: string; dir: string; handlerFile: string; entries: string[] };
let bundle: McpBundle | undefined;
const skipModules = (src: string) => !/(^|[\\/])(node_modules|\.git|dist)([\\/]|$)/.test(src);

/**
 * Builds nalekoMcpServer the way CI does (python3 scripts/ci/build-lambdas.py nalekoMcpServer), in a copy of the repo's build
 * inputs, and unpacks the zip. The tests run the handler out of that zip, so they test what is deployed, wherever the source lives.
 * Needs the npm registry (the build runs `npm ci --omit=dev`). Built once per run.
 */
export function mcpBundle(): McpBundle {
  if (bundle) return bundle;
  const root = mkdtempSync(join(tmpdir(), 'onb-22-build-'));
  for (const rel of ['scripts/ci/build-lambdas.py', 'api/agent-tools.json', 'lambda', 'mcp']) {
    const from = join(REPO, rel);
    if (existsSync(from)) cpSync(from, join(root, rel), { recursive: true, filter: skipModules });
  }
  const run = spawnSync('python3', ['scripts/ci/build-lambdas.py', 'nalekoMcpServer'], { cwd: root, encoding: 'utf8', timeout: 300_000 });
  const zip = join(root, 'dist', 'lambdas', 'nalekoMcpServer.zip');
  const dir = join(root, 'unzipped');
  let entries: string[] = [];
  if (existsSync(zip)) {
    const ls = spawnSync('python3', ['-I', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);z.extractall(sys.argv[2]);print("\\n".join(z.namelist()))', zip, dir], { encoding: 'utf8' });
    entries = ls.stdout.split('\n').filter(Boolean);
  }
  bundle = { built: existsSync(zip), log: `${run.stdout}${run.stderr}`.slice(-1500), dir, handlerFile: join(dir, 'lambda-handler.mjs'), entries };
  return bundle;
}

/** A Lambda Function URL event (payload 2.0) for the MCP server. `key` undefined leaves the header out. */
export function mcpEvent(rpc: unknown, key?: string, over: { method?: string; path?: string } = {}): any {
  const method = over.method ?? 'POST';
  const path = over.path ?? '/';
  return {
    version: '2.0', rawPath: path, rawQueryString: '',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(key === undefined ? {} : { 'x-api-key': key }) },
    requestContext: { http: { method, path, protocol: 'HTTP/1.1', sourceIp: '198.51.100.30', userAgent: 'onb-22-acceptance' }, stage: '$default' },
    ...(method === 'POST' ? { body: JSON.stringify(rpc) } : {}),
    isBase64Encoded: false,
  };
}
