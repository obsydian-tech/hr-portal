import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LAMBDA, Row, Run, Tables, httpEvent, jwtAuthorizer, runHandler, runPack } from './lambda-harness';

/**
 * REC-03: copied from ../rec-02/world.ts (no change; this card's rows and routes are in ./move.ts).
 *
 * REC-02: copied from ../rec-12/world.ts (no change; this card's rows and routes are in ./decide.ts).
 *
 * REC-12: copied from ../rec-01/world.ts (code added only): the settings of company A are written by the real Standard pack (see
 * packTables), company B has none, and the row builders are exported so a test can add a candidate of its own.
 *
 * REC-01: the world of the card's acceptance criteria (rows and helpers adapted from ../mod-01/world.ts).
 *
 *   A  the founding company (founding = true, no modules attribute: Recruitment is on).
 *   B  a second company with Recruitment on (modules {onboarding, recruitment}). Its recruiter exists to be refused A's records.
 *   D  a company with Recruitment off (modules {onboarding}): the module refusal, after the role check.
 *
 * Company A holds two candidates. C1 is the one the card talks about: its hiring manager is `hmA`, it has one
 * interview I1 with two panel members by person id (`panelA`, `panelX`), two votes on I1 (one each), an offer with a
 * base salary, and a history with a stage event and an offer event. The saga row also carries `offer` and `salary` fields
 * so a read that must hide them has something to hide (the stored shape allows both; the card hides them).
 * C2 belongs to another hiring manager (`hm2A`) and has its own interview I2 (panel `panel2A`).
 * Company B holds CB1. All names and addresses are made up.
 */
export const A = 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa';
export const B = 'ten_bbbbbbbbbbbbbbbbbbbbbbbbbb';
export const D = 'ten_dddddddddddddddddddddddddd';
export const TENANTS = 'naleko-people-dev-tenants';
export const AGENT_SECRET = 'talent-flow/agent/api-key';
export const COMPANY_NAME: Record<string, string> = { [A]: 'Mokoena Bakeries', [B]: 'Bontle Logistics', [D]: 'Dube Transport' };

export const NAME = { c1: 'Lerato Dlamini', c2: 'Sipho Khumalo', cb1: 'Bongi Mahlangu' };
export const ID = {
  c1: 'CAND-01REC01AAAAAAAAAAAAAAA1',
  c2: 'CAND-01REC01AAAAAAAAAAAAAAA2',
  cb1: 'CAND-01REC01BBBBBBBBBBBBBBB1',
  i1: 'iv-a-0001',
  i2: 'iv-a-0002',
  ib1: 'iv-b-0001',
  tokenA: 'vote-token-a-0001',
  tokenExpiredA: 'vote-token-a-old',
};
/** Person ids (the Cognito sub of each made-up person). */
export const SUB = {
  recA: 'sub-rec-a', recB: 'sub-rec-b', hmA: 'sub-hm-a', hm2A: 'sub-hm2-a', hmB: 'sub-hm-b',
  panelA: 'sub-panel-a', panelX: 'sub-panel-x', panel2A: 'sub-panel2-a', panelB: 'sub-panel-b',
};
export const TABLE = {
  state: 'talent-flow-state',
  config: 'talent-flow-config',
  dismissals: 'talent-flow-intelligence-dismissals',
  notifications: 'talent-flow-notifications',
  users: 'talent-flow-users',
  events: 'talent-flow-events',
  idempotency: 'talent-flow-idempotency-keys',
  pending: 'talent-flow-pending-actions',
  itTasks: 'it-tasks',
  bundles: 'provisioning-bundles',
};
/**
 * REC-12: the seeded world after the real Standard pack ran for company A (the way set-modules.mjs calls it). Built once
 * per process; each call hands back its own copy. Throws with the script's words when the pack does not run.
 */
let packed: Tables | undefined;
export function packTables(): Tables {
  if (!packed) {
    const r = runPack(A, 'dev', { tables: tables() });
    if (r.code !== 0) throw new Error(`the Standard pack did not run for company A (exit ${r.code}): ${(r.stdout + r.stderr).slice(-600)}`);
    packed = r.tables;
    if (!(packed[TABLE.config] ?? []).length) throw new Error('the Standard pack wrote no settings for company A (scripts/tenancy/module-seeds/recruitment.mjs still writes nothing)');
  }
  return structuredClone(packed);
}
export const STATE_WRITES = /PutItem|UpdateItem|DeleteItem|BatchWriteItem|TransactWriteItems/;

// ---------------------------------------------------------------- rows

type Plain = string | number | boolean | null | undefined | Plain[] | { [k: string]: Plain };
/** A row as DynamoDB stores it, from plain values (maps and lists too). A `Set` of strings becomes a string set. */
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

const NOW = '2026-11-10T08:00:00.000Z';
const company = (c: string) => ({ tenant_id: c, tenantId: c });

export function saga(id: string, first: string, last: string, c: string, hm: string, extra: Record<string, Plain> = {}): Row {
  return av({
    PK: `CANDIDATE#${id}`, SK: 'SAGA', GSI1PK: `TENANT#${c}`, GSI1SK: `SAGA#${NOW}`, candidateId: id, ...company(c),
    firstName: first, lastName: last, email: `${first}.${last}`.toLowerCase().replace(/ /g, '') + '@example.test', positionTitle: 'Junior baker',
    positionLevel: 'MID', department: 'Operations', currentStage: 'APPLICATION_REVIEW', stageEnteredAt: NOW, status: 'ACTIVE', slaStatus: 'ON_TRACK',
    configVersion: '1', hiringManagerId: hm, appliedDate: NOW, createdAt: NOW, ...extra,
  });
}
export function interview(id: string, iv: string, c: string, panel: string[], status = 'SCHEDULED'): Row {
  return av({
    PK: `CANDIDATE#${id}`, SK: `INTERVIEW#${iv}`, interviewId: iv, candidateId: id, ...company(c), interviewType: 'HR_SCREEN', status, scheduledAt: '2026-12-01T09:00:00.000Z', votesRequired: 2, panelMemberIds: panel, createdAt: NOW,
  });
}
function vote(id: string, iv: string, c: string, voter: string): Row {
  return av({
    PK: `CANDIDATE#${id}`, SK: `VOTE#${voter}#${NOW}`, voterId: voter, candidateId: id, interviewId: iv, ...company(c), rating: 'YES',
    scores: { technical: 4, communication: 4, culturalFit: 4, problemSolving: 4 }, weightedScore: 4, configVersionUsed: '1', createdAt: NOW,
  });
}
function offer(id: string, c: string): Row {
  return av({
    PK: `CANDIDATE#${id}`, SK: 'OFFER', offerId: `OFFER#${id}`, candidateId: id, ...company(c), state: 'OFFER_CREATED', positionLevel: 'MID',
    baseSalary: 95000, currency: 'ZAR', approvalChain: [{ stepId: 'step-1', approverRole: 'HiringManager', status: 'PENDING' }], currentApprovalStep: 0,
    configVersion: '1', interactionLog: [], createdAt: NOW, updatedAt: NOW,
  });
}
function event(id: string, c: string, n: number, type: string, detail: Record<string, Plain>): Row {
  return av({
    PK: `CANDIDATE#${id}`, SK: `EVENT#2026-11-10T08:0${n}:00.000Z#ev-${id}-${n}`, eventId: `ev-${id}-${n}`, eventType: type, source: 'talentflow', candidateId: id,
    ...company(c), actor: 'SYSTEM', timestamp: `2026-11-10T08:0${n}:00.000Z`, detail: JSON.stringify(detail),
  });
}
function snapshot(id: string, name: string, c: string): Row {
  return av({
    PK: `TENANT#${c}#SNAP`, SK: `CAND#${id}`, GSI1PK: `OWNER#own-${c}#TA`, GSI1SK: NOW, entityId: id, entityType: 'CANDIDATE', entityName: name, ...company(c),
    currentStage: 'INTERVIEWING', computedAt: NOW, signals: { SLA_STATUS: 'AT_RISK' },
  });
}
function config(c: string, type: string, data: Record<string, Plain>): Row {
  return av({
    PK: `TENANT#${c}`, SK: `CONFIG#${type}#v1`, GSI1PK: `TENANT#${c}#ACTIVE`, GSI1SK: `CONFIG#${type}`, ...company(c), configType: type, version: 1, isActive: true, data, createdAt: NOW,
  });
}
function scoringLink(token: string, cand: string, c: string, panel: string, iv: string, ttl: number): Row {
  return av({
    PK: `SCORING_LINK#${token}`, SK: 'META', token, candidateId: cand, ...company(c), panelMemberId: panel, panelMemberEmail: `${panel}@example.test`,
    panelMemberName: 'Pia Alpha', panelMemberRole: 'Engineer', interviewId: iv, used: false, createdAt: NOW, ttl,
  });
}

/** The Company rows (TEN-01 shape: pk TENANT#<id>, sk PROFILE). */
export function companyRows(): Row[] {
  const profile = (c: string, extra: Record<string, Plain | Set<string>>) =>
    av({ pk: `TENANT#${c}`, sk: 'PROFILE', tenant_id: c, name: COMPANY_NAME[c]!, status: 'ACTIVE', country: 'ZA', created_at: '2026-11-16T00:00:00Z', ...extra });
  return [profile(A, { founding: true }), profile(B, { modules: new Set(['onboarding', 'recruitment']) }), profile(D, { modules: new Set(['onboarding']) })];
}

/** The seeded world. */
export function tables(): Tables {
  return {
    [TABLE.state]: [
      saga(ID.c1, 'Lerato', 'Dlamini', A, SUB.hmA, { salary: 95000, offer: { baseSalary: 95000, state: 'OFFER_CREATED' } }),
      saga(ID.c2, 'Sipho', 'Khumalo', A, SUB.hm2A, { currentStage: 'INTERVIEWING' }),
      saga(ID.cb1, 'Bongi', 'Mahlangu', B, SUB.hmB),
      interview(ID.c1, ID.i1, A, [SUB.panelA, SUB.panelX]), interview(ID.c2, ID.i2, A, [SUB.panel2A], 'COMPLETED'), interview(ID.cb1, ID.ib1, B, [SUB.panelB]),
      vote(ID.c1, ID.i1, A, SUB.panelA), vote(ID.c1, ID.i1, A, SUB.panelX),
      scoringLink(ID.tokenA, ID.c2, A, SUB.panel2A, ID.i2, 4102444800), scoringLink(ID.tokenExpiredA, ID.c2, A, SUB.panel2A, ID.i2, 1000000000),
      offer(ID.c1, A), offer(ID.cb1, B),
      snapshot(ID.c1, NAME.c1, A), snapshot(ID.c2, NAME.c2, A), snapshot(ID.cb1, NAME.cb1, B),
    ],
    // REC-12: no settings at all. Company A gets the Standard pack from packTables(); company B has none.
    [TABLE.config]: [],
    [TABLE.dismissals]: [],
    [TABLE.notifications]: [],
    [TABLE.users]: [],
    [TABLE.events]: [
      event(ID.c1, A, 1, 'CandidateCreated', { stage: 'APPLICATION_REVIEW' }),
      event(ID.c1, A, 2, 'OFFER_CREATED', { baseSalary: 95000, offer: { state: 'OFFER_CREATED' } }),
      event(ID.c2, A, 1, 'CandidateCreated', { stage: 'APPLICATION_REVIEW' }),
    ],
    [TABLE.idempotency]: [],
    [TABLE.pending]: [],
    [TABLE.itTasks]: [],
    [TABLE.bundles]: [],
    [TENANTS]: [
      ...companyRows(),
      ...Object.values(SUB).map((s) => av({ pk: `USER#${s}`, sk: `TENANT#${/-b$/.test(s) ? B : A}`, tenant_id: /-b$/.test(s) ? B : A })),
    ],
  };
}

// ---------------------------------------------------------------- callers

export type Caller = {
  name: string;
  /** The "cognito:groups" claim: a list is sent in the form API Gateway uses ("[a b]"); a string is sent as it is; undefined sends none. */
  groups?: string[] | string;
  sub?: string;
  company?: 'A' | 'B' | 'D' | null;
  claims?: Record<string, unknown>;
};
const COMPANY = { A, B, D };

/** The authorizer a caller arrives with. */
export function authorizerOf(c: Caller, extra: Record<string, unknown> = {}): unknown {
  const company = c.company === undefined ? 'A' : c.company;
  const groups = Array.isArray(c.groups) ? `[${c.groups.join(' ')}]` : c.groups;
  return jwtAuthorizer({
    sub: c.sub ?? 'sub-nobody', email: `${c.sub ?? 'nobody'}@example.test`, email_verified: 'true', token_use: 'id',
    'cognito:groups': groups, ...(company ? { tenant_id: COMPANY[company] } : {}), ...(c.claims ?? {}), ...extra,
  });
}

/** Settings every run gets. */
export function settings(extra: Record<string, string> = {}): Record<string, string> {
  return {
    STATE_TABLE_NAME: TABLE.state, CONFIG_TABLE_NAME: TABLE.config, DISMISSALS_TABLE_NAME: TABLE.dismissals, NOTIFICATIONS_TABLE_NAME: TABLE.notifications,
    USERS_TABLE_NAME: TABLE.users, EVENTS_TABLE_NAME: TABLE.events, IDEMPOTENCY_TABLE_NAME: TABLE.idempotency, PENDING_ACTIONS_TABLE_NAME: TABLE.pending,
    IT_TASKS_TABLE: TABLE.itTasks, BUNDLES_TABLE: TABLE.bundles, EVENTBRIDGE_BUS_NAME: 'rec01-bus', EB_BUS_NAME: 'rec01-bus',
    NOTIFICATION_QUEUE_URL: 'https://sqs.rec01.example/queue', NOTIFICATION_LAMBDA_NAME: 'sendTalentFlowNotification', TENANTS_TABLE: TENANTS,
    AGENT_TENANT_ID: A, AGENT_API_KEY_SECRET_NAME: AGENT_SECRET, ENVIRONMENT: 'dev', HM_GROUP_NAME: 'HiringManager', POSTMARK_SENDER_EMAIL: 'noreply@rec01.example',
    POSTMARK_API_TOKEN: 'rec01-fake-token', COGNITO_POOL_ID: 'af-south-1_Rec01Fake', HM_COGNITO_POOL_ID: 'af-south-1_Rec01Fake', FRONTEND_URL: 'https://rec01.example',
    ...extra,
  };
}

/** The handler file of a Lambda (index.js, or index.mjs for the newer ones). */
export function fileOf(name: string): string {
  for (const f of ['index.js', 'index.mjs']) if (existsSync(join(LAMBDA, name, f))) return join(LAMBDA, name, f);
  throw new Error(`no handler file for ${name}`);
}

export type Ask = { rawPath?: string; method?: string; path?: Record<string, string>; query?: Record<string, string>; body?: unknown; headers?: Record<string, string>; claims?: Record<string, unknown> };

/** Runs one route as a caller against the seeded world (or the given one). */
export function ask(handler: string, caller: Caller, a: Ask = {}, opts: { tables?: Tables; env?: Record<string, string>; fail?: any } = {}): Run {
  const event = httpEvent({ authorizer: authorizerOf(caller, a.claims ?? {}), path: a.path, query: a.query, body: a.body, headers: a.headers });
  if (a.method) event.requestContext.http.method = a.method;
  if (a.rawPath) event.rawPath = a.rawPath;
  return runHandler(fileOf(handler), event, {
    tables: opts.tables ?? tables(),
    secrets: { [AGENT_SECRET]: { AWSCURRENT: 'rec01-agent-key' } },
    env: settings(opts.env),
    cognito: { users: [] },
    ...(opts.fail ? { fail: opts.fail } : {}),
  });
}

/** Runs a handler with an event the test built itself (the public vote by token, an EventBridge event). */
export function runEvent(handler: string, event: unknown, opts: { tables?: Tables; env?: Record<string, string | undefined> } = {}): Run {
  return runHandler(fileOf(handler), event, { tables: opts.tables ?? tables(), secrets: { [AGENT_SECRET]: { AWSCURRENT: 'rec01-agent-key' } }, env: { ...settings(), ...(opts.env ?? {}) }, cognito: { users: [] } });
}

export const bodyOf = (r: { response: any }) => {
  try { return JSON.parse(r.response?.body ?? 'null'); } catch { return r.response?.body; }
};
export const statusOf = (r: Run) => r.response?.statusCode as number | undefined;
export const describe = (r: Run) => `${statusOf(r)} ${JSON.stringify(bodyOf(r)).slice(0, 300)}${r.error ? ` (threw ${r.error.name}: ${r.error.message.slice(0, 200)})` : ''}`;

/** Plain values of a stored row (a string set comes back as a sorted array). */
export function plain(r: Row | undefined): Record<string, any> {
  const un = (v: any): any => ('S' in v ? v.S : 'N' in v ? Number(v.N) : 'BOOL' in v ? v.BOOL : 'NULL' in v ? null : 'SS' in v ? [...v.SS].sort() : 'L' in v ? v.L.map(un) : 'M' in v ? Object.fromEntries(Object.entries(v.M).map(([k, x]) => [k, un(x)])) : v);
  return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, un(v)]));
}
export const rowsOf = (t: Tables, table: string) => (t[table] ?? []).map(plain);
export const findRow = (t: Tables, table: string, match: Record<string, unknown>) => rowsOf(t, table).find((r) => Object.entries(match).every(([k, v]) => r[k] === v));

/** Every call to an outside service (log lines and step markers left out). */
export const calls = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service !== 'log' && c.service !== 'step') as any[];
/** One line per outside call: "dynamodb GetItem <table>", "events PutEvents" ... */
export const callLines = (r: { calls: any[] }) => calls(r).map((c) => `${c.service} ${c.op ?? ''}${c.table ? ' ' + c.table : ''}`.trim());
/** The calls that read the company list for its modules. */
export const isModulesRead = (c: any) => c.service === 'dynamodb' && c.op === 'GetItem' && /tenants$/.test(String(c.table ?? '')) && JSON.stringify(c.input?.Key ?? {}).includes('PROFILE');
/** Calls that change something (a write to a table, an event put, a queue send, a Lambda invoke). */
export const writes = (r: { calls: any[] }) => calls(r).filter((c) => (c.service === 'dynamodb' && STATE_WRITES.test(c.op)) || /^(events|eventbridge|sqs|lambda|sfn|ses|s3)$/i.test(c.service) && !/^(Get|List|Head)/.test(c.op ?? ''));
/** Everything a run asked of AWS (not the log), as text. */
export const sent = (r: Run) => JSON.stringify(calls(r));
