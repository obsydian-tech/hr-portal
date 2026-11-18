import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LAMBDA, REPO, Row, Run, Tables, httpEvent, jwtAuthorizer, logLines, runHandler, type Failure, type ModelScript } from './lambda-harness';

/**
 * CHAT-02: the companies, people, tables and calls of the card's acceptance criteria. Written from
 * /mnt/project-files/ask-batsi-chat/CHAT-02-stored-chats.md and the decisions in cards/chat-02.md (D-1 to D-24).
 *
 *   A  the founding company (founding = true). Its switch is set per test: no modules attribute at all ('default'),
 *      {onboarding, recruitment} ('off') or {onboarding, recruitment, ask_batsi} ('on'). It is AGENT_TENANT_ID, the one
 *      company nalekoAiChat serves today.
 *   B  not founding, {onboarding, ask_batsi}: Ask Batsi is on.
 *   C  not founding, {onboarding}: Ask Batsi is off.
 *   F  not founding, {ask_batsi} only: the edge where turning the switch off leaves no module.
 *   E  not founding, ACTIVE, no modules attribute: nothing is on.
 *
 * People are made up. Every person has a distinct sub and staff id, except `bTwin` (company B) who has the SAME staff id as
 * `a1` (company A): the company in the key is what keeps their chats apart.
 */
export const A = 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa';
export const B = 'ten_bbbbbbbbbbbbbbbbbbbbbbbbbb';
export const C = 'ten_cccccccccccccccccccccccccc';
export const E = 'ten_eeeeeeeeeeeeeeeeeeeeeeeeee';
export const F = 'ten_ffffffffffffffffffffffffff';
export const TENANTS = 'naleko-people-dev-tenants';
export const CHATS = 'ask-batsi-chats';
export const AUDIT = 'naleko-agent-audit';
export const TF_AUDIT = 'talent-flow-agent-audit';

export const ULID = /^[0-9A-Z]{26}$/;
export const AI_OFF_LABEL = 'AI is switched off here (cost guardrail). Nothing was sent to an AI service.';
export const AI_SKIPPED_LABEL = 'AI skipped: this is test data (cost guardrail). Nothing was sent to an AI service.';

// ---------------------------------------------------------------- people and events

export type Person = { c: string; sub: string; staff?: string; groups: string[]; tokenUse?: 'id' | 'access' };
const P = (c: string, sub: string, staff: string | undefined, groups: string[], extra: Partial<Person> = {}): Person => ({ c, sub, staff, groups, ...extra });
export const PEOPLE = {
  a1: P(A, 'sub-a1', 'STAFF-A1', ['hr_staff']),
  a2: P(A, 'sub-a2', 'STAFF-A2', ['hr_staff']),
  b1: P(B, 'sub-b1', 'STAFF-B1', ['hr_staff']),
  bTwin: P(B, 'sub-btwin', 'STAFF-A1', ['hr_staff']),
  c1: P(C, 'sub-c1', 'STAFF-C1', ['hr_staff']),
  f1: P(F, 'sub-f1', 'STAFF-F1', ['hr_staff']),
  e1: P(E, 'sub-e1', 'STAFF-E1', ['hr_staff']),
  aTf: P(A, 'sub-atf', 'STAFF-ATF', ['naleko-talentflow-hr']),
  aAdmin: P(A, 'sub-aadmin', 'STAFF-AADMIN', ['admin']),
  aAdminHr: P(A, 'sub-aadminhr', 'STAFF-AADMINHR', ['admin', 'hr_staff']),
  bAdmin: P(B, 'sub-badmin', 'STAFF-BADMIN', ['admin']),
  fAdmin: P(F, 'sub-fadmin', 'STAFF-FADMIN', ['admin']),
  eAdmin: P(E, 'sub-eadmin', 'STAFF-EADMIN', ['admin']),
  aEmployee: P(A, 'sub-aemp', 'STAFF-AEMP', ['employee']),
  aManager: P(A, 'sub-amgr', 'STAFF-AMGR', ['manager']),
  aGuest: P(A, 'sub-aguest', 'STAFF-AGUEST', ['guest']),
  aNone: P(A, 'sub-anone', 'STAFF-ANONE', []),
  aIt: P(A, 'sub-ait', 'STAFF-AIT', ['perm-it']),
  aRecruiter: P(A, 'sub-arec', 'STAFF-AREC', ['perm-recruitment']),
  aAccessToken: P(A, 'sub-a1', 'STAFF-A1', ['hr_staff'], { tokenUse: 'access' }),
  aAdminAccessToken: P(A, 'sub-aadmin', 'STAFF-AADMIN', ['admin'], { tokenUse: 'access' }),
  aRobot: P(A, 'sub-arobot', 'STAFF-AROBOT', ['hr_staff', 'e2e-robots']),
  aNoStaffId: P(A, 'sub-anostaff', undefined, ['hr_staff']),
} as const;
export type Who = keyof typeof PEOPLE;

export type Ask = {
  path?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  headers?: Record<string, string>;
  claims?: Record<string, unknown>;
  /** The signed-in company, when a test wants a person at another company than the one given. Never set by the app. */
};

/** The API Gateway event of a signed-in person calling `route`. */
export function eventOf(who: Who | Person, route: string, a: Ask = {}): any {
  const p = typeof who === 'string' ? PEOPLE[who] : who;
  return httpEvent({
    route,
    path: a.path,
    query: a.query,
    body: a.body,
    headers: a.headers,
    authorizer: jwtAuthorizer({
      sub: p.sub,
      ...(p.staff !== undefined ? { 'custom:staff_id': p.staff } : {}),
      tenant_id: p.c,
      email: `${p.sub}@example.test`,
      token_use: p.tokenUse ?? 'id',
      'cognito:groups': `[${p.groups.join(' ')}]`,
      ...(a.claims ?? {}),
    }),
  });
}

// ---------------------------------------------------------------- tables

type Plain = string | number | boolean | null | undefined | Plain[] | { [k: string]: Plain };
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
/** A stored row as plain values (strings, numbers, booleans, lists, string sets as arrays). */
export function plain(r: Row | undefined): Record<string, any> {
  const one = (a: any): any => (a === undefined ? undefined : 'S' in a ? a.S : 'N' in a ? Number(a.N) : 'BOOL' in a ? a.BOOL : 'NULL' in a ? null : 'SS' in a ? [...a.SS] : 'L' in a ? a.L.map(one) : 'M' in a ? Object.fromEntries(Object.entries(a.M).map(([k, v]) => [k, one(v)])) : a);
  return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, one(v)]));
}

export type Switch = 'default' | 'off' | 'on';
const MODULES: Record<Switch, string[] | undefined> = { default: undefined, off: ['onboarding', 'recruitment'], on: ['onboarding', 'recruitment', 'ask_batsi'] };
const NAMES: Record<string, string> = { [A]: 'Mokoena Bakeries', [B]: 'Bontle Logistics', [C]: 'Cebo Foods', [E]: 'Ekhaya Stores', [F]: 'Fumani Farms' };

/** The company list rows. `a` is company A's switch; B is on, C is off, F has only ask_batsi, E has no attribute. */
export function tenantRows(a: Switch = 'on'): Row[] {
  const row = (c: string, founding: boolean, modules: string[] | undefined) =>
    av({ pk: `TENANT#${c}`, sk: 'PROFILE', tenant_id: c, status: 'ACTIVE', name: NAMES[c], founding, ...(modules ? { modules: new Set(modules) } : {}) });
  return [
    row(A, true, MODULES[a]),
    row(B, false, ['onboarding', 'ask_batsi']),
    row(C, false, ['onboarding']),
    row(E, false, undefined),
    row(F, false, ['ask_batsi']),
  ];
}

/** Every table the three chat Lambdas and the admin Lambda touch, empty, plus the company list. */
export function baseTables(a: Switch = 'on'): Tables {
  return {
    [TENANTS]: tenantRows(a),
    [CHATS]: [],
    [AUDIT]: [],
    [TF_AUDIT]: [],
    NalekoAiRateLimit: [],
    'talent-flow-ai-rate-limit': [],
    'naleko-prompt-cache': [],
    'talent-flow-prompt-cache': [],
    'naleko-pending-actions': [],
    'talent-flow-pending-actions': [],
    'talent-flow-state': [],
    'talent-flow-config': [],
  };
}

export type SeedChat = { c: string; staff: string; id: string; title: string; created: string; updated: string; messages: { role: 'person' | 'batsi'; text: string; at?: string; tools?: string[]; proposal_ids?: string[] }[] };
/** The rows of a stored chat, in the shape the card fixes (Storage): pk T#<tenant>#S#<staff>, sk CHAT#<id> and MSG#<id>#0001... */
export function chatRows(s: SeedChat): Row[] {
  const pk = `T#${s.c}#S#${s.staff}`;
  return [
    av({ pk, sk: `CHAT#${s.id}`, chat_id: s.id, title: s.title, created: s.created, updated: s.updated, message_count: s.messages.length, tenant_id: s.c, staff_id: s.staff }),
    ...s.messages.map((m, i) => av({
      pk, sk: `MSG#${s.id}#${String(i + 1).padStart(4, '0')}`, chat_id: s.id, role: m.role, text: m.text, at: m.at ?? s.updated, tenant_id: s.c,
      ...(m.tools ? { tools: m.tools } : {}), ...(m.proposal_ids ? { proposal_ids: m.proposal_ids } : {}),
    })),
  ];
}
let seq = 0;
/** A 26-character id that is not made by the code under test. */
export const idOf = (n: number) => `01CHAT02SEED${String(n).padStart(14, '0')}`;
export function seed(c: string, staff: string, over: Partial<SeedChat> & { n?: number; messages?: number } = {}): SeedChat {
  seq += 1;
  const n = over.n ?? seq;
  const count = typeof over.messages === 'number' ? over.messages : 2;
  const at = over.updated ?? `2026-10-${String(1 + (n % 28)).padStart(2, '0')}T08:00:00.000Z`;
  return {
    c, staff, id: over.id ?? idOf(n), title: over.title ?? `Question number ${n} about onboarding`, created: over.created ?? at, updated: at,
    messages: Array.from({ length: count }, (_x, i) => ({ role: i % 2 === 0 ? 'person' : 'batsi', text: `${i % 2 === 0 ? 'Question' : 'Answer'} ${i + 1} of chat ${n} SEED-TEXT-${n}`, at })),
  };
}
export function withChats(t: Tables, ...chats: SeedChat[]): Tables {
  const out: Tables = { ...t, [CHATS]: [...(t[CHATS] ?? [])] };
  for (const c of chats) out[CHATS]!.push(...chatRows(c));
  return out;
}

// ---------------------------------------------------------------- running a Lambda

export type Lam = 'askBatsiChats' | 'nalekoAiChat' | 'talentFlowAiChat' | 'adminSetAskBatsi' | 'getCompanyModules';
export const fileOf = (l: Lam) => join(LAMBDA, l, 'index.mjs');
export const exists = (l: Lam) => existsSync(fileOf(l));

/** The settings each Lambda gets (the names Terraform sets today, plus CHATS_TABLE and TENANTS_TABLE which this card adds). */
export function settings(l: Lam, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const common = { TENANTS_TABLE: TENANTS, CHATS_TABLE: CHATS, LEGACY_TENANT_ID: undefined };
  const by: Record<Lam, Record<string, string | undefined>> = {
    askBatsiChats: { ...common, AGENT_AUDIT_TABLE: AUDIT },
    nalekoAiChat: {
      ...common, AGENT_TENANT_ID: A, MODEL_FAST: 'test-model-fast', MODEL_SMART: 'test-model-smart', RATE_LIMIT_TABLE: 'NalekoAiRateLimit', RATE_LIMIT_RPH: '50',
      AGENT_AUDIT_TABLE: AUDIT, PROMPT_CACHE_TABLE: 'naleko-prompt-cache', PENDING_ACTIONS_TABLE: 'naleko-pending-actions',
      AGENT_API_BASE_URL: 'https://agent.example.test', AGENT_API_KEY_SECRET_NAME: 'naleko/agent/api-key',
    },
    talentFlowAiChat: {
      ...common, BEDROCK_MODEL_FAST: 'test-model-fast', BEDROCK_MODEL_SMART: 'test-model-smart', RATE_LIMIT_TABLE_NAME: 'talent-flow-ai-rate-limit', RATE_LIMIT_RPH: '50',
      AGENT_AUDIT_TABLE_NAME: TF_AUDIT, PROMPT_CACHE_TABLE_NAME: 'talent-flow-prompt-cache', PENDING_ACTIONS_TABLE_NAME: 'talent-flow-pending-actions',
      STATE_TABLE_NAME: 'talent-flow-state', CONFIG_TABLE_NAME: 'talent-flow-config',
    },
    adminSetAskBatsi: { ...common },
    getCompanyModules: { ...common },
  };
  return { ...by[l], ...extra };
}

export type Out = { run: Run; status: number | undefined; json: any; text: string };
export type Opts = { tables?: Tables; env?: Record<string, string | undefined>; bedrock?: ModelScript; fail?: Failure; secrets?: Record<string, Record<string, string>> };
export function call(l: Lam, who: Who | Person, route: string, a: Ask = {}, o: Opts = {}): Out {
  const run = runHandler(fileOf(l), eventOf(who, route, a), { tables: o.tables ?? baseTables(), env: settings(l, o.env), bedrock: o.bedrock, fail: o.fail, secrets: o.secrets });
  const text = typeof run.response?.body === 'string' ? run.response.body : '';
  let json: any;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { run, status: run.response?.statusCode, json, text };
}

// ---------------------------------------------------------------- the five chat routes, the question, the switch

export const ROUTE = {
  list: 'GET /v1/chats',
  get: 'GET /v1/chats/{id}',
  del: 'DELETE /v1/chats/{id}',
  delAll: 'DELETE /v1/chats',
  ask: 'POST /agent/v1/ai-chat',
  admin: 'PUT /v1/admin/company/ask-batsi',
  modules: 'GET /v1/company/modules',
} as const;

export const list = (who: Who | Person, o: Opts = {}, a: Ask = {}) => call('askBatsiChats', who, ROUTE.list, a, o);
export const getChat = (who: Who | Person, id: string, o: Opts = {}, a: Ask = {}) => call('askBatsiChats', who, ROUTE.get, { ...a, path: { id, ...(a.path ?? {}) } }, o);
export const delChat = (who: Who | Person, id: string, o: Opts = {}, a: Ask = {}) => call('askBatsiChats', who, ROUTE.del, { ...a, path: { id, ...(a.path ?? {}) } }, o);
export const delAll = (who: Who | Person, o: Opts = {}, a: Ask = {}) => call('askBatsiChats', who, ROUTE.delAll, a, o);
export const setSwitch = (who: Who | Person, enabled: unknown, o: Opts = {}, a: Ask = {}) => call('adminSetAskBatsi', who, ROUTE.admin, { body: { enabled }, ...a }, o);
export const modulesRoute = (who: Who | Person, o: Opts = {}) => call('getCompanyModules', who, ROUTE.modules, {}, o);

/** A question to Batsi through one of the two chat Lambdas, answered by the script. */
export function ask(l: 'nalekoAiChat' | 'talentFlowAiChat', who: Who | Person, question: string, o: Opts & { chatId?: string; body?: Record<string, unknown> } = {}): Out {
  const bedrock: ModelScript = o.bedrock ?? { intent: 'TOOL_REQUIRED', answers: [{ text: `Answer to: ${question.slice(0, 20)}` }] };
  return call(l, who, ROUTE.ask, { body: { message: question, templateId: 'freeform', ...(o.chatId ? { chatId: o.chatId } : {}), ...(o.body ?? {}) } }, { ...o, bedrock });
}

// ---------------------------------------------------------------- reading what a run left

export const chatTable = (t: Tables) => (t[CHATS] ?? []).map(plain);
export const headersOf = (t: Tables) => chatTable(t).filter((r) => String(r['sk']).startsWith('CHAT#'));
export const messagesOf = (t: Tables, id: string) => chatTable(t).filter((r) => String(r['sk']).startsWith(`MSG#${id}#`)).sort((x, y) => String(x['sk']).localeCompare(String(y['sk'])));
export const rowsOfChat = (t: Tables, id: string) => chatTable(t).filter((r) => String(r['sk']).includes(id));
/** Every call to the model in a run, in order. */
export const modelCalls = (run: Run) => (run.calls as any[]).filter((c) => c.service === 'bedrock');
export const answerCalls = (run: Run) => modelCalls(run).filter((c) => c.kind === 'answer');
export const logs = (run: Run) => logLines(run.calls).join('\n');
/** The AWS calls a run made to one table, by operation. */
export const dynamoCalls = (run: Run, table?: string) => (run.calls as any[]).filter((c) => c.service === 'dynamodb' && (!table || c.table === table));
export const writesTo = (run: Run, table: string) => dynamoCalls(run, table).filter((c) => /^(PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems)$/.test(c.op));
/** Every write of a run, to any table. TransactWriteItems and BatchWriteItem name their tables inside the input. */
export const allWrites = (run: Run) => (run.calls as any[]).filter((c) => c.service === 'dynamodb' && /^(PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems)$/.test(c.op));
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const REPO_ROOT = REPO;
