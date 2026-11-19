import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * CHAT-06: runs the real Lambdas, each call in its own fresh Node process (a cold Lambda), against a fake AWS (./fake-aws, copied from
 * CHAT-05's, which is CHAT-02's, with code added only):
 *   - the Lambda client runs the REAL createEmployee (and nothing else) in the same process, against the same fake tables, Cognito and
 *     Postmark, exactly as approveAgentAction would invoke it (fake-aws/client-lambda.mjs, from ONB-22's);
 *   - EventBridge hands every event to the real auditLogConsumer, so the onboarding audit table holds what the audit log would
 *     (fake-aws/client-eventbridge.mjs, from ONB-22's);
 *   - Bedrock answers only from a script the test wrote, and records every prompt; a call with no script is refused
 *     (fake-aws/bedrock-scripted.mjs). Textract and any other AI client fail the import. Outbound HTTP is a fake Agent API.
 * Nothing reaches AWS, Postmark, an outside host or any AI service.
 *
 * Two companies, A and B, both with Ask Batsi switched on (CHAT-02). All names, addresses and numbers are made up. Everything here is data
 * and plumbing; the rules live in chat-06.spec.ts.
 */

export const REPO = join(__dirname, '..', '..', '..', '..', '..');
export const LAMBDA = join(REPO, 'lambda');
const FAKE_AWS = join(__dirname, 'fake-aws');
export const handlerOf = (name: string) => join(LAMBDA, name, 'index.mjs');
export const exists = (name: string) => existsSync(handlerOf(name));

// ------------------------------------------------------------------ rows

export type Row = Record<string, Record<string, unknown>>;
export type Tables = Record<string, Row[]>;
type Plain = string | number | boolean | null | undefined | Plain[] | { [k: string]: Plain };

/** A stored row from plain values (strings, numbers, booleans, lists, maps, string sets). */
export function av(values: Record<string, Plain | Set<string>>): Row {
  const one = (v: Plain | Set<string>): Record<string, unknown> =>
    v instanceof Set ? { SS: [...v] }
      : v === null ? { NULL: true }
        : typeof v === 'string' ? { S: v }
          : typeof v === 'number' ? { N: String(v) }
            : typeof v === 'boolean' ? { BOOL: v }
              : Array.isArray(v) ? { L: v.map(one) }
                : { M: Object.fromEntries(Object.entries(v as Record<string, Plain>).filter(([, x]) => x !== undefined).map(([k, x]) => [k, one(x)])) };
  const out: Row = {};
  for (const [k, v] of Object.entries(values)) if (v !== undefined) out[k] = one(v);
  return out;
}
/** A stored row as plain values. */
export function plain(r: Row | undefined): Record<string, any> {
  const one = (a: any): any => (a === undefined ? undefined : 'S' in a ? a.S : 'N' in a ? Number(a.N) : 'BOOL' in a ? a.BOOL : 'NULL' in a ? null : 'SS' in a ? [...a.SS] : 'L' in a ? a.L.map(one) : 'M' in a ? Object.fromEntries(Object.entries(a.M).map(([k, v]) => [k, one(v)])) : a);
  return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, one(v)]));
}
export const rowsOf = (t: Tables, name: string) => (t[name] ?? []).map((r) => plain(r));

// ------------------------------------------------------------------ the two companies and the people

export const A = 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa';
export const B = 'ten_bbbbbbbbbbbbbbbbbbbbbbbbbb';
export const PENDING = 'naleko-pending-actions';
export const CHATS = 'ask-batsi-chats';
export const TENANTS = 'naleko-people-dev-tenants';
export const EMPLOYEES = 'employees';
export const AUDIT = 'onboarding-events';
export const CHAT_AUDIT = 'naleko-agent-audit';
export const POOL = 'af-south-1_Chat06Fake';
/** The createEmployee function is named by a setting. The name is not the folder name, so a name written into the code fails. */
export const CREATE_NAME = 'naleko-create-employee-chat06';

export type Who = 'hrA' | 'hrA2' | 'hrB' | 'hrReadonlyA' | 'employeeA' | 'accessTokenA' | 'hrNoEmailA' | 'hrA_noStaffId' | 'agentA' | 'agentB';
type Person = { sub: string; email: string; first: string; last: string; staff?: string; c: string; groups: string[] };
export const HR: Record<'a' | 'a2' | 'b', Person> = {
  a: { sub: 'sub-hr-a-0001', email: 'thandi.mokoena@baker-a.example', first: 'Thandi', last: 'Mokoena', staff: 'HRA001', c: A, groups: ['hr_staff'] },
  a2: { sub: 'sub-hr-a-0002', email: 'pieter.vanwyk@baker-a.example', first: 'Pieter', last: 'Van Wyk', staff: 'HRA002', c: A, groups: ['hr_staff'] },
  b: { sub: 'sub-hr-b-0001', email: 'bongani.sithole@baker-b.example', first: 'Bongani', last: 'Sithole', staff: 'HRB001', c: B, groups: ['hr_staff'] },
};
export const nameOf = (p: Person) => `${p.first} ${p.last}`;

function claimsOf(p: Person, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {
    sub: p.sub, email: p.email, email_verified: 'true', given_name: p.first, family_name: p.last, token_use: 'id',
    ...(p.staff ? { 'custom:staff_id': p.staff } : {}),
    'cognito:groups': `[${p.groups.join(' ')}]`, iss: `https://cognito-idp.af-south-1.amazonaws.com/${POOL}`, tenant_id: p.c, ...extra,
  };
  for (const [k, v] of Object.entries(out)) if (v === undefined) delete out[k];
  return out;
}
export function authorizerOf(who: Who): unknown {
  const jwt = (claims: Record<string, unknown>) => ({ jwt: { claims, scopes: null } });
  switch (who) {
    case 'hrA': return jwt(claimsOf(HR.a));
    case 'hrA2': return jwt(claimsOf(HR.a2));
    case 'hrB': return jwt(claimsOf(HR.b));
    // The same person as hrA, but only read-only HR.
    case 'hrReadonlyA': return jwt(claimsOf({ ...HR.a, groups: ['hr_staff_readonly'] }));
    case 'employeeA': return jwt(claimsOf({ sub: 'sub-emp-a-0001', email: 'lerato.dube@baker-a.example', first: 'Lerato', last: 'Dube', staff: 'EMPA001', c: A, groups: ['employee'] }));
    case 'accessTokenA': return jwt(claimsOf(HR.a, { token_use: 'access' }));
    case 'hrNoEmailA': return jwt(claimsOf(HR.a, { email: undefined }));
    // hrA with no custom:staff_id: the chat falls back to the sub, and so must the proposal.
    case 'hrA_noStaffId': return jwt(claimsOf({ ...HR.a, staff: undefined }));
    case 'agentA': return { lambda: { actor: 'AGENT', tenant_id: A } };
    case 'agentB': return { lambda: { actor: 'AGENT', tenant_id: B } };
  }
}

/** An HTTP API (payload 2.0) event. `route` is "METHOD /path/{param}"; the path parameters fill the real path. */
export function eventOf(who: Who, route: string, a: { path?: Record<string, string>; body?: unknown; headers?: Record<string, string>; query?: Record<string, string> } = {}): any {
  const method = route.split(' ')[0]!;
  const rawPath = route.split(' ')[1]!.replace(/\{(\w+)\}/g, (_m, k) => encodeURIComponent(String(a.path?.[k] ?? k)));
  const query = a.query ?? {};
  return {
    version: '2.0',
    routeKey: route,
    rawPath,
    rawQueryString: new URLSearchParams(query).toString(),
    headers: { 'content-type': 'application/json', ...(a.headers ?? {}) },
    ...(Object.keys(query).length ? { queryStringParameters: query } : {}),
    ...(a.path ? { pathParameters: a.path } : {}),
    requestContext: {
      http: { method, path: rawPath, protocol: 'HTTP/1.1', sourceIp: '198.51.100.26', userAgent: 'chat-06-acceptance' },
      routeKey: route,
      stage: '$default',
      authorizer: authorizerOf(who),
    },
    ...(a.body === undefined ? {} : { body: typeof a.body === 'string' ? a.body : JSON.stringify(a.body) }),
    isBase64Encoded: false,
  };
}

// ------------------------------------------------------------------ tables

/** The company list: A and B, both with Ask Batsi on. A is the founding company. */
export function tenantRows(): Row[] {
  const row = (c: string, founding: boolean, name: string) => av({ pk: `TENANT#${c}`, sk: 'PROFILE', tenant_id: c, status: 'ACTIVE', name, founding, modules: new Set(['onboarding', 'recruitment', 'ask_batsi']) });
  return [row(A, true, 'Mokoena Bakeries'), row(B, false, 'Bontle Logistics')];
}

/** An employee already on file (for the duplicate-email cases). */
export function employeeRow(c: string, id: string, first: string, last: string, email: string): Row {
  return av({ employee_id: id, first_name: first, last_name: last, email, phone: '000 000 0000', department: 'Bakery', job_title: 'Baker', stage: 'INVITED', created_at: '2026-11-10T08:00:00.000Z', created_by: 'HRA001', hr_staff_id: 'HRA001', tenant_id: c });
}

/** Every table the four Lambdas (chat, approve, createEmployee, chats) and the audit consumer touch. */
export function tables(): Tables {
  return {
    [TENANTS]: tenantRows(),
    [CHATS]: [],
    [CHAT_AUDIT]: [],
    NalekoAiRateLimit: [],
    'naleko-prompt-cache': [],
    [PENDING]: [],
    [EMPLOYEES]: [],
    employee_invites: [],
    'naleko-idempotency-keys': [],
    [AUDIT]: [],
    documents: [],
    'document-verification': [],
    employee_consents: [],
  };
}

/** A proposal row as nalekoAiChat writes it (spec "What gets built" 1), for tests that start from a stored proposal. */
export function proposalRow(o: {
  id: string; c?: string; staff?: string; staffName?: string; chat?: string;
  details?: Partial<Record<'first_name' | 'last_name' | 'email' | 'phone' | 'department' | 'job_title', string>>;
  status?: string; createdAt?: string; expiresAt?: number; extra?: Record<string, Plain>;
}): Row {
  const d = { first_name: 'Kagiso', last_name: 'Molefe', email: 'kagiso.molefe@mail-a.example', phone: '082 555 0199', department: 'Finance', job_title: 'Payroll Clerk', ...(o.details ?? {}) };
  const now = Math.floor(Date.now() / 1000);
  return av({
    actionId: o.id, type: 'CREATE_EMPLOYEE', toolName: 'onboard_new_employee', toolArgs: d,
    employee_name: `${d.first_name} ${d.last_name}`, proposed_by_kind: 'BATSI', proposed_by_id: 'nalekoAiChat',
    requested_by: o.staff ?? HR.a.staff!, requested_by_name: o.staffName ?? nameOf(HR.a), chat_id: o.chat ?? '01CHAT06SEED00000000000001',
    status: o.status ?? 'PENDING_APPROVAL', createdAt: o.createdAt ?? new Date(Date.now() - 60_000).toISOString(), expiresAt: o.expiresAt ?? now + 7 * 24 * 3600,
    tenant_id: o.c ?? A, ...(o.extra ?? {}),
  });
}
/** An ONB-22 Accept document proposal (the agent's), to show the old type is untouched. */
export function acceptRow(id: string, c = A): Row {
  const now = Math.floor(Date.now() / 1000);
  return av({ actionId: id, type: 'ACCEPT_DOCUMENT', document_id: 'dd000000-0001-4d7e-9a11-aaaaaaaa0002', employee_id: '3f1a7c52-0001-4d7e-9a11-aaaaaaaa0001', employee_name: 'Nomsa Dlamini', document_type: 'BANK_CONFIRMATION', check: 'MATCHES', proposed_by_kind: 'AGENT', proposed_by_id: 'agent-key', status: 'PENDING_APPROVAL', createdAt: new Date(Date.now() - 120_000).toISOString(), expiresAt: now + 7 * 24 * 3600, tenant_id: c });
}
export const withRows = (t: Tables, name: string, rows: Row[]): Tables => ({ ...t, [name]: [...(t[name] ?? []), ...rows] });

// ------------------------------------------------------------------ settings and runs

/** One set of settings for every Lambda here: the names Terraform sets (and the one this card adds, CREATE_EMPLOYEE_FUNCTION_NAME). */
export function settings(extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    ENVIRONMENT: 'dev',
    LEGACY_TENANT_ID: '',
    TENANTS_TABLE: TENANTS,
    CHATS_TABLE: CHATS,
    // nalekoAiChat
    AGENT_TENANT_ID: A,
    MODEL_FAST: 'test-model-fast', MODEL_SMART: 'test-model-smart',
    RATE_LIMIT_TABLE: 'NalekoAiRateLimit', RATE_LIMIT_RPH: '50',
    AGENT_AUDIT_TABLE: CHAT_AUDIT, PROMPT_CACHE_TABLE: 'naleko-prompt-cache', PENDING_ACTIONS_TABLE: PENDING,
    AGENT_API_BASE_URL: 'https://agent.chat06.example', AGENT_API_KEY_SECRET_NAME: 'naleko/agent/api-key',
    // approveAgentAction
    EVENT_BUS_NAME: 'naleko-onboarding-chat06',
    REVIEW_FUNCTION_NAME: 'naleko-review-document-chat06',
    CREATE_EMPLOYEE_FUNCTION_NAME: CREATE_NAME,
    // createEmployee (it runs in the same process when invoked)
    COGNITO_POOL_ID: POOL,
    LOGIN_URL: 'http://localhost:4300/sign-in',
    POSTMARK_SENDER_EMAIL: 'sender@chat06.example',
    POSTMARK_API_TOKEN: 'chat06-fake-postmark-token',
    COMPANY_NAME: 'Mokoena Bakeries',
    SFN_STATE_MACHINE_ARN: 'arn:aws:states:af-south-1:000000000000:stateMachine:chat06-onboarding',
    APP_URL: 'http://localhost:4300',
    IDEMPOTENCY_TABLE: 'naleko-idempotency-keys',
    EMPLOYEES_TABLE: EMPLOYEES,
    KMS_KEY_ARN: 'arn:aws:kms:af-south-1:000000000000:key/chat06',
    // the audit consumer
    AUDIT_TABLE_NAME: AUDIT,
    AUDIT_TABLE: AUDIT,
    // the fakes: the functions a Lambda client may run, and the consumer of every event
    CHAT06_FUNCTIONS: JSON.stringify({ [CREATE_NAME]: handlerOf('createEmployee'), 'naleko-review-document-chat06': handlerOf('reviewDocumentVerification') }),
    CHAT06_AUDIT_CONSUMER: handlerOf('auditLogConsumer'),
    ...extra,
  };
}

export type Call = { service: string; op?: string; [k: string]: any };
export type Run = { response?: any; responses?: any[]; error?: { name: string; message: string; stack: string }; calls: Call[]; tables: Tables; cognito?: unknown };

/** The model's answers for one run (fake-aws/bedrock-scripted.mjs). */
export type ModelScript = { answers?: ({ text: string } | { tool: { name: string; input?: Record<string, unknown> } } | { error: { name: string; message: string } })[]; intent?: 'SIMPLE' | 'TOOL_REQUIRED'; summary?: string };
export type Failure = { service: 'dynamodb'; ops?: string[]; message: string; name?: string };
export type Opts = {
  tables?: Tables;
  env?: Record<string, string | undefined>;
  bedrock?: ModelScript;
  fail?: Failure;
  invokeFail?: string;
  eventBridgeDown?: boolean;
  cognito?: { users: unknown[] };
};

/** The global secondary indexes Terraform declares, name -> key attributes, so a handler that Queries one still runs. */
function terraformIndexes(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const dir of [join(REPO, 'infra'), join(REPO, 'talent-flow-infra')]) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.tf'))) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const m of text.matchAll(/global_secondary_index\s*\{([^}]*)\}/g)) {
        const name = /name\s*=\s*"([^"]+)"/.exec(m[1]!)?.[1];
        const hash = /hash_key\s*=\s*"([^"]+)"/.exec(m[1]!)?.[1];
        const range = /range_key\s*=\s*"([^"]+)"/.exec(m[1]!)?.[1];
        if (name && hash) out[name] = range ? [hash, range] : [hash];
      }
    }
  }
  return out;
}
const INDEXES = terraformIndexes();

function node(handler: string, event: unknown, o: Opts): Run {
  const dir = mkdtempSync(join(tmpdir(), 'chat-06-'));
  const worldFile = join(dir, 'world.json');
  const eventFile = join(dir, 'event.json');
  writeFileSync(worldFile, JSON.stringify({
    indexes: { ...INDEXES, 'email-index': ['email'], 'tenant-index': ['tenant_id'] },
    tables: structuredClone(o.tables ?? tables()),
    secrets: { 'naleko/agent/api-key': { AWSCURRENT: 'chat06-agent-key' } },
    // Rows a Scan or Query reads in one page: a route that reads one page of a company's rows misses some, as in AWS.
    pageSize: 4,
    cognito: structuredClone(o.cognito ?? { users: [] }),
    ...(o.fail ? { fail: o.fail } : {}),
    ...(o.bedrock ? { bedrock: structuredClone(o.bedrock) } : {}),
    ...(o.invokeFail ? { invokeFail: o.invokeFail } : {}),
    ...(o.eventBridgeDown ? { eventBridgeDown: true } : {}),
  }));
  writeFileSync(eventFile, JSON.stringify(event));
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings(o.env))) if (v !== undefined) clean[k] = v;
  const out = execFileSync(process.execPath, ['--no-warnings', '--require', join(FAKE_AWS, 'cjs-hook.cjs'), '--import', join(FAKE_AWS, 'register.mjs'), join(FAKE_AWS, 'run.mjs'), handler, eventFile], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { PATH: process.env['PATH'] ?? '', CHAT06_WORLD: worldFile, AWS_REGION: 'af-south-1', AWS_ACCESS_KEY_ID: 'chat06-fake', AWS_SECRET_ACCESS_KEY: 'chat06-fake', POWERTOOLS_DEV: 'false', POWERTOOLS_TRACE_ENABLED: 'false', ...clean },
  });
  const line = out.split('\n').find((l) => l.startsWith('@@CHAT06@@'));
  if (!line) throw new Error(`the run printed no result:\n${out.slice(-2000)}`);
  return JSON.parse(line.slice('@@CHAT06@@'.length)) as Run;
}

export type Out = { run: Run; status: number | undefined; json: any; text: string };
function outOf(run: Run, res = run.response): Out {
  const text = typeof res?.body === 'string' ? res.body : '';
  let json: any;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { run, status: res?.statusCode === undefined ? undefined : Number(res.statusCode), json, text };
}
/** Calls Lambda `name` once, in a fresh process, as `who` calls `route`. */
export function call(name: string, who: Who, route: string, a: Parameters<typeof eventOf>[2] = {}, o: Opts = {}): Out {
  return outOf(node(handlerOf(name), eventOf(who, route, a), o));
}
/** Two or more calls started together in one warm container. */
export function callTogether(name: string, events: unknown[], o: Opts = {}): { run: Run; outs: Out[] } {
  const run = node(handlerOf(name), { parallel: events }, o);
  return { run, outs: (run.responses ?? []).map((r) => outOf(run, r)) };
}
export const describe = (o: Out) => (o.run.error ? `the Lambda threw ${o.run.error.name}: ${o.run.error.message.slice(0, 200)}` : `${o.status} ${o.text.slice(0, 240)}`);

// ------------------------------------------------------------------ the routes

export const ROUTE = {
  ask: 'POST /agent/v1/ai-chat',
  list: 'GET /agent/v1/actions',
  one: 'GET /agent/v1/actions/{actionId}',
  approve: 'POST /agent/v1/actions/{actionId}/approve',
  reject: 'POST /agent/v1/actions/{actionId}/reject',
  chat: 'GET /v1/chats/{id}',
} as const;

/** A question to Batsi, answered by the script. */
export function ask(who: Who, question: string, bedrock: ModelScript, o: Opts & { chatId?: string } = {}): Out {
  return call('nalekoAiChat', who, ROUTE.ask, { body: { message: question, templateId: 'freeform', ...(o.chatId ? { chatId: o.chatId } : {}) } }, { ...o, bedrock });
}
/** The model drafts a new employee with these tool arguments, then says nothing more. */
export const draftTool = (input: Record<string, unknown>): ModelScript => ({ intent: 'TOOL_REQUIRED', answers: [{ tool: { name: 'onboard_new_employee', input } }, { text: 'Here is the draft.' }] });
export const decide = (verb: 'approve' | 'reject', who: Who, id: string, t: Tables, body?: unknown, o: Opts = {}): Out =>
  call('approveAgentAction', who, verb === 'approve' ? ROUTE.approve : ROUTE.reject, { path: { actionId: id }, ...(body === undefined ? {} : { body }) }, { ...o, tables: t });
export const listActions = (who: Who, t: Tables, o: Opts = {}): Out => call('approveAgentAction', who, ROUTE.list, {}, { ...o, tables: t });
export const readAction = (who: Who, id: string, t: Tables, o: Opts = {}): Out => call('approveAgentAction', who, ROUTE.one, { path: { actionId: id } }, { ...o, tables: t });
export const openChat = (who: Who, id: string, t: Tables, o: Opts = {}): Out => call('askBatsiChats', who, ROUTE.chat, { path: { id } }, { ...o, tables: t });

// ------------------------------------------------------------------ what a run did

export const WRITE_OPS = ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'TransactWriteItems'];
export const dynamoCalls = (r: Run, table?: string) => r.calls.filter((c) => c.service === 'dynamodb' && (!table || c.table === table));
export const writesTo = (r: Run, table: string) => dynamoCalls(r, table).filter((c) => WRITE_OPS.includes(c.op!));
/** Every write, to any table, as "Op table". */
export const writesOf = (r: Run) => r.calls.filter((c) => c.service === 'dynamodb' && WRITE_OPS.includes(c.op!)).map((c) => `${c.op} ${c.table}`);
export const readsOf = (r: Run, table: string) => dynamoCalls(r, table).filter((c) => !WRITE_OPS.includes(c.op!));
export const invokesOf = (r: Run) => r.calls.filter((c) => c.service === 'lambda');
export const publishedOf = (r: Run, detailType?: string) => r.calls.filter((c) => c.service === 'events' && (!detailType || c.detailType === detailType));
export const mailsOf = (r: Run) => r.calls.filter((c) => c.service === 'postmark' && !c.failed);
export const modelCalls = (r: Run) => r.calls.filter((c) => c.service === 'bedrock');
export const cognitoCalls = (r: Run) => r.calls.filter((c) => c.service === 'cognito');
export const sfnCalls = (r: Run) => r.calls.filter((c) => c.service === 'sfn' || c.service === 'stepfunctions');
export const logLines = (r: Run) => r.calls.filter((c) => c.service === 'log').map((c) => `${c.message}${c.extra === undefined ? '' : ' ' + JSON.stringify(c.extra)}`);
export const pendingRows = (t: Tables) => rowsOf(t, PENDING);
export const pendingRow = (t: Tables, id: string) => pendingRows(t).find((r) => r['actionId'] === id);
