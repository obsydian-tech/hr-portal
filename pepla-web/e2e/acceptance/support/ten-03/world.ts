import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LAMBDA, Row, Run, Tables, httpEvent, jwtAuthorizer, runHandler } from './lambda-harness';
import { ROLES_TABLE as ADD_ROLES_TABLE, addRoleRows } from '../rec-15b.1/roles';

/**
 * TEN-03: two companies and their TalentFlow, IT and bundle rows, as the spec's acceptance criteria seed them.
 *   A: the founding company (what today's users belong to). B: a second company.
 * Every row of A carries tenant_id A (the shape the move leaves) and every row of B carries tenant_id B, with the
 * company inside keys where TalentFlow keys hold one (TENANT#<id>...). Nothing here has a company called DEFAULT
 * or NALEKO: after TEN-03 no handler may read or write either. All names and addresses are made up.
 *
 * The legacy rule (LEGACY_TENANT_ID) is NOT set by any run here unless a test says so: a row with no company
 * belongs to nobody, which is the state after the move.
 */
export const A = 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa';
export const B = 'ten_bbbbbbbbbbbbbbbbbbbbbbbbbb';
export const TENANTS = 'naleko-people-dev-tenants';
export const AGENT_SECRET = 'talent-flow/agent/api-key';

/** Names of the made-up people, so a test can look for B's words in an answer meant for A. */
export const NAME = { a1: 'John Doe', a2: 'Jane Smith', b1: 'Bea Ndlovu', b2: 'Sipho Khumalo' };

export const ID = {
  a1: 'CAND-01TEN03AAAAAAAAAAAAAAA1',
  a2: 'CAND-01TEN03AAAAAAAAAAAAAAA2',
  b1: 'CAND-01TEN03BBBBBBBBBBBBBBB1',
  b2: 'CAND-01TEN03BBBBBBBBBBBBBBB2',
  ivA: 'iv-a-0001',
  ivB: 'iv-b-0001',
  taskA: 'task-a-0001',
  taskA2: 'task-a-0002',
  taskA3: 'task-a-0003',
  taskA4: 'task-a-0004',
  taskB: 'task-b-0001',
  bundleA: 'bundle-a-0001',
  bundleB: 'bundle-b-0001',
  notifA: 'notif-a-0001',
  notifB: 'notif-b-0001',
  actionA: 'act-a-0001',
  actionB: 'act-b-0001',
  voteTokenA: 'vote-token-a-0001',
  voteTokenB: 'vote-token-b-0001',
};
export const SUB = { staffA: 'sub-staff-a', staffB: 'sub-staff-b', itA: 'sub-it-a', hmA: 'sub-hm-a', hmB: 'sub-hm-b', panelA: 'sub-panel-a', panelB: 'sub-panel-b' };
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

// ---------------------------------------------------------------- rows

type Plain = string | number | boolean | null | undefined | Plain[] | { [k: string]: Plain };
/** A row as DynamoDB stores it, from plain values (maps and lists too). */
/** MOD-01: both companies have Recruitment on (a string set), so the module check lets these routes through. */
const RECRUITMENT_ON = { SS: ['onboarding', 'recruitment'] };

export function av(values: Record<string, Plain>): Row {
  const one = (v: Plain): Record<string, unknown> =>
    v === null ? { NULL: true }
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

function saga(id: string, first: string, last: string, c: string, extra: Record<string, Plain> = {}): Row {
  return av({
    PK: `CANDIDATE#${id}`, SK: 'SAGA', GSI1PK: `TENANT#${c}`, GSI1SK: `SAGA#${NOW}`, candidateId: id, ...company(c),
    firstName: first, lastName: last, email: `${first}.${last}`.toLowerCase().replace(/ /g, '') + '@example.test', positionTitle: 'Junior baker',
    positionLevel: 'MID', department: 'Operations', currentStage: 'APPLICATION_REVIEW', stageEnteredAt: NOW, status: 'ACTIVE', slaStatus: 'ON_TRACK',
    configVersion: '1', hiringManagerId: c === A ? SUB.hmA : SUB.hmB, appliedDate: NOW, createdAt: NOW, ...extra,
  });
}
function interview(id: string, iv: string, c: string, extra: Record<string, Plain> = {}): Row {
  return av({
    PK: `CANDIDATE#${id}`, SK: `INTERVIEW#${iv}`, interviewId: iv, candidateId: id, ...company(c), interviewType: 'HR_SCREEN', status: 'SCHEDULED',
    scheduledAt: '2026-12-01T09:00:00.000Z', votesRequired: 1, createdAt: NOW,
    // REC-01: the voter is the signed-in person and must be on the panel; company staff sit on their own company's panel.
    panelMemberIds: [c === A ? SUB.staffA : SUB.staffB], ...extra,
  });
}
function offer(id: string, c: string): Row {
  return av({
    PK: `CANDIDATE#${id}`, SK: 'OFFER', offerId: `OFFER#${id}`, candidateId: id, ...company(c), state: 'OFFER_CREATED', positionLevel: 'MID',
    approvalChain: [{ stepId: 'step-1', approverRole: 'HiringManager', status: 'PENDING' }], currentApprovalStep: 0, configVersion: '1',
    interactionLog: [], createdAt: NOW, updatedAt: NOW,
  });
}
function snapshot(id: string, name: string, c: string, owner: string): Row {
  return av({
    PK: `TENANT#${c}#SNAP`, SK: `CAND#${id}`, GSI1PK: `OWNER#${owner}#TA`, GSI1SK: NOW, entityId: id, entityType: 'CANDIDATE', entityName: name, ...company(c),
    currentStage: 'APPLICATION_REVIEW', computedAt: NOW, signals: { SLA_STATUS: 'AT_RISK' },
  });
}
function config(c: string, type: string, data: Record<string, Plain>): Row {
  return av({
    PK: `TENANT#${c}`, SK: `CONFIG#${type}#v1`, GSI1PK: `TENANT#${c}#ACTIVE`, GSI1SK: `CONFIG#${type}`, ...company(c), configType: type, version: 1, isActive: true, data, createdAt: NOW,
  });
}
function task(id: string, c: string, who: string, extra: Record<string, Plain> = {}): Row {
  return av({
    taskId: id, ...company(c), taskStatus: 'UNASSIGNED', queue: 'Laptops', slaStatus: 'ON_TRACK', candidateId: c === A ? (who === NAME.a2 ? ID.a2 : ID.a1) : ID.b1, createdAt: NOW,
    newHire: { name: who, role: 'Junior baker', daysRemaining: 10 }, itemName: 'Laptop', category: 'HARDWARE', ...extra,
  });
}
function bundle(id: string, c: string, hm: string, who: string): Row {
  return av({
    bundleId: id, ...company(c), hmUserId: hm, candidateId: c === A ? ID.a1 : ID.b1, candidateName: who, candidateRole: 'Junior baker', bundleStatus: 'PENDING_REVIEW',
    startDate: '2026-12-01', items: [{ type: 'LAPTOP', label: 'Laptop', queue: 'Laptops' }], createdAt: NOW, updatedAt: NOW,
  });
}
function pendingAction(id: string, c: string): Row {
  return av({ actionId: id, status: 'PENDING_APPROVAL', toolName: 'advance_stage', toolArgs: { candidateId: c === A ? ID.a1 : ID.b1 }, staffId: 'STAFF-requester', ...company(c), createdAt: NOW });
}
function scoringLink(token: string, cand: string, c: string, panel: string): Row {
  return av({
    PK: `SCORING_LINK#${token}`, SK: 'META', token, candidateId: cand, ...company(c), panelMemberId: panel, panelMemberEmail: `${panel}@example.test`,
    panelMemberName: c === A ? 'Pia Alpha' : 'Paul Beta', panelMemberRole: 'Engineer', used: false, createdAt: NOW, ttl: 4102444800,
  });
}
function notification(id: string, c: string, user: string, text: string): Row {
  return av({ PK: `USER#${user}`, SK: `NOTIF#${NOW}#${id}`, notificationId: id, ...company(c), read: false, message: text, createdAt: NOW });
}

/** The seeded world. */
export function tables(): Tables {
  return {
    // Child lock rec-15b.1 (REC-15 step B): one open role per company, so the add-candidate fixtures send a real role_id.
    [ADD_ROLES_TABLE]: addRoleRows([{ id: A, hm: SUB.hmA }, { id: B, hm: SUB.hmB }]),
    [TABLE.state]: [
      saga(ID.a1, 'John', 'Doe', A), saga(ID.a2, 'Jane', 'Smith', A, { currentStage: 'INTERVIEWING' }),
      saga(ID.b1, 'Bea', 'Ndlovu', B), saga(ID.b2, 'Sipho', 'Khumalo', B),
      interview(ID.a1, ID.ivA, A), interview(ID.b1, ID.ivB, B),
      scoringLink(ID.voteTokenA, ID.a1, A, SUB.panelA), scoringLink(ID.voteTokenB, ID.b1, B, SUB.panelB),
      offer(ID.a1, A), offer(ID.b1, B),
      snapshot(ID.a1, NAME.a1, A, 'own-a'), snapshot(ID.b1, NAME.b1, B, 'own-b'),
    ],
    [TABLE.config]: [
      config(A, 'SCORING_WEIGHTS', { weights: { skills: 40 }, label: 'weights of A' }),
      config(B, 'SCORING_WEIGHTS', { weights: { skills: 70 }, label: 'weights of B' }),
      config(A, 'INTELLIGENCE_RULES', { rules: [{ id: 'RULE-OFF', name: 'Switched off', enabled: false }] }),
      config(B, 'INTELLIGENCE_RULES', { rules: [{ id: 'RULE-OFF', name: 'Switched off', enabled: false }] }),
      config(A, 'IT_QUEUES', { queues: [{ name: 'Laptops', active: true, assignedSpecialists: [SUB.itA] }] }),
      config(B, 'IT_QUEUES', { queues: [{ name: 'Laptops', active: true, assignedSpecialists: [SUB.itA] }] }),
    ],
    [TABLE.dismissals]: [],
    [TABLE.notifications]: [notification(ID.notifA, A, SUB.staffA, 'Notice for A'), notification(ID.notifB, B, SUB.staffB, 'Notice for B')],
    [TABLE.users]: [],
    [TABLE.events]: [],
    [TABLE.idempotency]: [],
    [TABLE.pending]: [pendingAction(ID.actionA, A), pendingAction(ID.actionB, B)],
    [TABLE.itTasks]: [
      task(ID.taskA, A, NAME.a1), task(ID.taskA2, A, NAME.a2), task(ID.taskB, B, NAME.b1),
      task(ID.taskA3, A, NAME.a1, { taskStatus: 'CLAIMED', claimedBy: SUB.staffA, claimedByName: 'Test staffA' }),
      task(ID.taskA4, A, NAME.a1, { taskStatus: 'CLAIMED', claimedBy: SUB.staffA, claimedByName: 'Test staffA' }),
    ],
    [TABLE.bundles]: [bundle(ID.bundleA, A, SUB.hmA, NAME.a1), bundle(ID.bundleB, B, SUB.hmB, NAME.b1)],
    [TENANTS]: [
      av({ pk: `USER#${SUB.hmA}`, sk: `TENANT#${A}`, tenant_id: A }),
      av({ pk: `USER#${SUB.hmB}`, sk: `TENANT#${B}`, tenant_id: B }),
      av({ pk: `USER#${SUB.panelA}`, sk: `TENANT#${A}`, tenant_id: A }),
      av({ pk: `USER#${SUB.panelB}`, sk: `TENANT#${B}`, tenant_id: B }),
      { ...av({ pk: `TENANT#${A}`, sk: 'PROFILE', tenant_id: A, name: 'Company A', status: 'ACTIVE' }), modules: RECRUITMENT_ON },
      { ...av({ pk: `TENANT#${B}`, sk: 'PROFILE', tenant_id: B, name: 'Company B', status: 'ACTIVE' }), modules: RECRUITMENT_ON },
    ],
  };
}

// ---------------------------------------------------------------- callers

export type Caller = 'staffA' | 'staffB' | 'itA' | 'agentA' | 'agentNoTenant' | 'public' | 'noTenant' | 'noTenantIt';
const ALL_STAFF = '[TalentFlowAdmin naleko-talentflow-admin ITAdmin HiringManager hr_staff]';

/** The authorizer a caller arrives with. staff: every TalentFlow, IT and hiring manager role, so only the company is under test. */
export function authorizerOf(caller: Caller): unknown {
  const staff = (sub: string, c?: string) =>
    jwtAuthorizer({ sub, email: `${sub}@example.test`, email_verified: 'true', token_use: 'id', 'cognito:groups': ALL_STAFF, 'custom:isAdmin': 'true', 'custom:staff_id': `STAFF-${sub}`, given_name: 'Test', family_name: sub, ...(c ? { tenant_id: c } : {}) });
  if (caller === 'staffA') return staff(SUB.staffA, A);
  if (caller === 'staffB') return staff(SUB.staffB, B);
  if (caller === 'noTenant' || caller === 'noTenantIt') return staff(SUB.staffA);
  if (caller === 'itA') return jwtAuthorizer({ sub: SUB.itA, email: 'it.a@example.test', email_verified: 'true', token_use: 'id', 'cognito:groups': '[ITSpecialist]', given_name: 'Ita', family_name: 'Spec', tenant_id: A });
  if (caller === 'public') return undefined;
  if (caller === 'agentNoTenant') return { lambda: { actor: 'AGENT' } };
  return { lambda: { actor: 'AGENT', tenant_id: A } };
}

/** Settings every run gets. LEGACY_TENANT_ID is left out on purpose (see the top). */
export function settings(extra: Record<string, string> = {}): Record<string, string> {
  return {
    STATE_TABLE_NAME: TABLE.state, CONFIG_TABLE_NAME: TABLE.config, DISMISSALS_TABLE_NAME: TABLE.dismissals, NOTIFICATIONS_TABLE_NAME: TABLE.notifications,
    USERS_TABLE_NAME: TABLE.users, EVENTS_TABLE_NAME: TABLE.events, IDEMPOTENCY_TABLE_NAME: TABLE.idempotency, PENDING_ACTIONS_TABLE_NAME: TABLE.pending,
    IT_TASKS_TABLE: TABLE.itTasks, BUNDLES_TABLE: TABLE.bundles, EVENTBRIDGE_BUS_NAME: 'ten03-bus', EB_BUS_NAME: 'ten03-bus',
    NOTIFICATION_QUEUE_URL: 'https://sqs.ten03.example/queue', NOTIFICATION_LAMBDA_NAME: 'sendTalentFlowNotification', TENANTS_TABLE: TENANTS,
    AGENT_TENANT_ID: A, AGENT_API_KEY_SECRET_NAME: AGENT_SECRET, ENVIRONMENT: 'dev', HM_GROUP_NAME: 'HiringManager', POSTMARK_SENDER_EMAIL: 'noreply@ten03.example', POSTMARK_API_TOKEN: 'ten03-fake-token', COGNITO_POOL_ID: 'af-south-1_Ten03Fake', HM_COGNITO_POOL_ID: 'af-south-1_Ten03Fake', FRONTEND_URL: 'https://ten03.example',
    ROLES_TABLE_NAME: ADD_ROLES_TABLE, // child lock rec-15b.1
    ...extra,
  };
}

/** The handler file of a Lambda (index.js, or index.mjs for the newer ones). */
export function fileOf(name: string): string {
  for (const f of ['index.js', 'index.mjs']) if (existsSync(join(LAMBDA, name, f))) return join(LAMBDA, name, f);
  throw new Error(`no handler file for ${name}`);
}

export type Ask = { rawPath?: string; method?: string; path?: Record<string, string>; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> };

/** Runs one route as a caller against the seeded world (or the given one). */
/** The sign-in pool: each company's hiring manager and panel member (Cognito keeps no company; the Member rows do). */
export const POOL = {
  users: [
    { username: 'hm.a@example.test', sub: SUB.hmA, status: 'CONFIRMED', attributes: { email: 'hm.a@example.test', given_name: 'Hanna', family_name: 'Alpha' }, groups: ['HiringManager'] },
    { username: 'hm.b@example.test', sub: SUB.hmB, status: 'CONFIRMED', attributes: { email: 'hm.b@example.test', given_name: 'Hugo', family_name: 'Beta' }, groups: ['HiringManager'] },
    { username: 'panel.a@example.test', sub: SUB.panelA, status: 'CONFIRMED', attributes: { email: 'panel.a@example.test', given_name: 'Pia', family_name: 'Alpha' }, groups: ['naleko-talentflow-admin'] },
    { username: 'panel.b@example.test', sub: SUB.panelB, status: 'CONFIRMED', attributes: { email: 'panel.b@example.test', given_name: 'Paul', family_name: 'Beta' }, groups: ['naleko-talentflow-admin'] },
  ],
};

export function ask(handler: string, caller: Caller, a: Ask = {}, opts: { tables?: Tables; env?: Record<string, string>; flipOnUpdate?: { table: string; set: Row } } = {}): Run {
  const event = httpEvent({ authorizer: authorizerOf(caller), path: a.path, query: a.query, body: a.body, headers: a.headers });
  if (a.method) event.requestContext.http.method = a.method;
  if (a.rawPath) event.rawPath = a.rawPath;
  return runHandler(fileOf(handler), event, {
    tables: opts.tables ?? tables(),
    secrets: { [AGENT_SECRET]: { AWSCURRENT: 'ten03-agent-key' } },
    env: settings(opts.env),
    cognito: POOL,
    ...(opts.flipOnUpdate ? { flipOnUpdate: opts.flipOnUpdate } : {}),
  });
}

/** Runs a handler with an event the test built itself (EventBridge, Step Functions, the public vote route). */
export function runEvent(handler: string, event: unknown, opts: { tables?: Tables; env?: Record<string, string | undefined> } = {}): Run {
  return runHandler(fileOf(handler), event, { tables: opts.tables ?? tables(), secrets: { [AGENT_SECRET]: { AWSCURRENT: 'ten03-agent-key' } }, env: { ...settings(), ...(opts.env ?? {}) } });
}

export const bodyOf = (r: { response: any }) => {
  try { return JSON.parse(r.response?.body ?? 'null'); } catch { return r.response?.body; }
};
export const statusOf = (r: Run) => r.response?.statusCode as number | undefined;
export const describe = (r: Run) => `${statusOf(r)} ${JSON.stringify(bodyOf(r)).slice(0, 300)}${r.error ? ` (threw ${r.error.name}: ${r.error.message.slice(0, 200)})` : ''}`;

/** Plain values of a stored row. */
export function plain(r: Row | undefined): Record<string, any> {
  const un = (v: any): any => ('S' in v ? v.S : 'N' in v ? Number(v.N) : 'BOOL' in v ? v.BOOL : 'NULL' in v ? null : 'L' in v ? v.L.map(un) : 'M' in v ? Object.fromEntries(Object.entries(v.M).map(([k, x]) => [k, un(x)])) : v);
  return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, un(v)]));
}
export const rowsOf = (t: Tables, table: string) => (t[table] ?? []).map(plain);
export const findRow = (t: Tables, table: string, match: Record<string, unknown>) => rowsOf(t, table).find((r) => Object.entries(match).every(([k, v]) => r[k] === v));

/** Everything a run sent to AWS, as one string, so a test can look for a company id in it. */
export const sentText = (r: Run) => JSON.stringify(r.calls.filter((c) => c.service !== 'log'));
export const calls = (r: Run) => r.calls.filter((c: any) => c.service !== 'log') as any[];
