import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LAMBDA, Row, Run, Tables, httpEvent, jwtAuthorizer, runHandler } from './lambda-harness';
import { ROLES_TABLE as ADD_ROLES_TABLE, addRoleRows } from '../rec-15b.1/roles';

/**
 * MOD-01: the companies of the card's acceptance criteria and their records (copied from ../ten-03/world.ts and
 * changed: the second company with Recruitment records is C here, and B, D and the others are added).
 *
 *   A  the founding company: founding = true, NO modules attribute (today's users; rule 2 gives it both).
 *   B  modules {onboarding}: Recruitment is off. It has a few Recruitment records of its own (left from before).
 *   C  modules {recruitment}: Recruitment is on, Onboarding is not.
 *   D  modules {recruitment} but status SUSPENDED: nothing.
 *   E  not founding, ACTIVE, no modules attribute: nothing (rule 2: only the founding company gets the default).
 *   F  modules {recruitment, payroll}: the unknown key is dropped.
 *   G  founding = true WITH modules {onboarding}: the attribute wins, the default is only for no attribute.
 *   X  a well-formed company id with no Company row: nothing.
 * Modules are stored as a string set (SS), as rule 1 says. All names and addresses are made up.
 */
export const A = 'ten_aaaaaaaaaaaaaaaaaaaaaaaaaa';
export const B = 'ten_bbbbbbbbbbbbbbbbbbbbbbbbbb';
export const C = 'ten_cccccccccccccccccccccccccc';
export const D = 'ten_dddddddddddddddddddddddddd';
export const E = 'ten_eeeeeeeeeeeeeeeeeeeeeeeeee';
export const F = 'ten_ffffffffffffffffffffffffff';
export const G = 'ten_gggggggggggggggggggggggggg';
export const X = 'ten_xxxxxxxxxxxxxxxxxxxxxxxxxx';
export const TENANTS = 'naleko-people-dev-tenants';
export const TENANTS_PROD = 'naleko-people-prod-tenants';
export const AGENT_SECRET = 'talent-flow/agent/api-key';
/** The company names on the Company rows, so a test can look for one where only an id may be. */
export const COMPANY_NAME: Record<string, string> = {
  [A]: 'Mokoena Bakeries', [B]: 'Bontle Logistics', [C]: 'Cebo Foods', [D]: 'Dube Transport', [E]: 'Ekhaya Stores', [F]: 'Fumani Farms', [G]: 'Gugu Media',
};

/** Names of the made-up people, so a test can look for them in an answer or a log. */
export const NAME = { a1: 'John Doe', a2: 'Jane Smith', b1: 'Bongi Mahlangu', c1: 'Bea Ndlovu', c2: 'Sipho Khumalo' };

export const ID = {
  a1: 'CAND-01MOD01AAAAAAAAAAAAAAA1',
  a2: 'CAND-01MOD01AAAAAAAAAAAAAAA2',
  b1: 'CAND-01MOD01BBBBBBBBBBBBBBB1',
  c1: 'CAND-01MOD01CCCCCCCCCCCCCCC1',
  c2: 'CAND-01MOD01CCCCCCCCCCCCCCC2',
  ivA: 'iv-a-0001',
  ivB: 'iv-b-0001',
  ivC: 'iv-c-0001',
  notifA: 'notif-a-0001',
  notifB: 'notif-b-0001',
  notifC: 'notif-c-0001',
  actionA: 'act-a-0001',
  actionB: 'act-b-0001',
  actionC: 'act-c-0001',
  voteTokenA: 'vote-token-a-0001',
  voteTokenB: 'vote-token-b-0001',
  voteTokenC: 'vote-token-c-0001',
};
export const SUB = { staffA: 'sub-staff-a', staffB: 'sub-staff-b', staffC: 'sub-staff-c', staffD: 'sub-staff-d', hmA: 'sub-hm-a', hmB: 'sub-hm-b', hmC: 'sub-hm-c', panelA: 'sub-panel-a', panelB: 'sub-panel-b', panelC: 'sub-panel-c' };
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
const hmOf = (c: string) => (c === A ? SUB.hmA : c === B ? SUB.hmB : SUB.hmC);

function saga(id: string, first: string, last: string, c: string, extra: Record<string, Plain> = {}): Row {
  return av({
    PK: `CANDIDATE#${id}`, SK: 'SAGA', GSI1PK: `TENANT#${c}`, GSI1SK: `SAGA#${NOW}`, candidateId: id, ...company(c),
    firstName: first, lastName: last, email: `${first}.${last}`.toLowerCase().replace(/ /g, '') + '@example.test', positionTitle: 'Junior baker',
    positionLevel: 'MID', department: 'Operations', currentStage: 'APPLICATION_REVIEW', stageEnteredAt: NOW, status: 'ACTIVE', slaStatus: 'ON_TRACK',
    configVersion: '1', hiringManagerId: hmOf(c), appliedDate: NOW, createdAt: NOW, ...extra,
  });
}
function interview(id: string, iv: string, c: string): Row {
  return av({
    PK: `CANDIDATE#${id}`, SK: `INTERVIEW#${iv}`, interviewId: iv, candidateId: id, ...company(c), interviewType: 'HR_SCREEN', status: 'SCHEDULED',
    scheduledAt: '2026-12-01T09:00:00.000Z', votesRequired: 1, createdAt: NOW,
    // REC-01: the voter is the signed-in person and must be on the panel; company staff sit on their own company's panel.
    panelMemberIds: [c === A ? SUB.staffA : c === B ? SUB.staffB : SUB.staffC],
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
function pendingAction(id: string, c: string, cand: string): Row {
  return av({ actionId: id, status: 'PENDING_APPROVAL', toolName: 'advance_stage', toolArgs: { candidateId: cand }, staffId: 'STAFF-requester', ...company(c), createdAt: NOW });
}
function scoringLink(token: string, cand: string, c: string, panel: string): Row {
  return av({
    PK: `SCORING_LINK#${token}`, SK: 'META', token, candidateId: cand, ...company(c), panelMemberId: panel, panelMemberEmail: `${panel}@example.test`,
    panelMemberName: c === A ? 'Pia Alpha' : c === B ? 'Pule Bravo' : 'Paul Charlie', panelMemberRole: 'Engineer', used: false, createdAt: NOW, ttl: 4102444800,
  });
}
function notification(id: string, c: string, user: string, text: string): Row {
  return av({ PK: `USER#${user}`, SK: `NOTIF#${NOW}#${id}`, notificationId: id, ...company(c), read: false, message: text, createdAt: NOW });
}

/** The Company rows (TEN-01 shape: pk TENANT#<id>, sk PROFILE). */
export function companyRows(): Row[] {
  const profile = (c: string, extra: Record<string, Plain | Set<string>>) =>
    av({ pk: `TENANT#${c}`, sk: 'PROFILE', tenant_id: c, name: COMPANY_NAME[c]!, status: 'ACTIVE', country: 'ZA', created_at: '2026-11-16T00:00:00Z', ...extra });
  return [
    profile(A, { founding: true }),
    profile(B, { modules: new Set(['onboarding']) }),
    profile(C, { modules: new Set(['recruitment']) }),
    profile(D, { modules: new Set(['recruitment']), status: 'SUSPENDED' }),
    profile(E, {}),
    profile(F, { modules: new Set(['recruitment', 'payroll']) }),
    profile(G, { founding: true, modules: new Set(['onboarding']) }),
  ];
}

/** The seeded world. */
export function tables(): Tables {
  return {
    // Child lock rec-15b.1 (REC-15 step B): one open role per company, so the add-candidate fixtures send a real role_id.
    [ADD_ROLES_TABLE]: addRoleRows([{ id: A, hm: SUB.hmA }, { id: B, hm: SUB.hmB }, { id: C, hm: SUB.hmC }, { id: D, hm: SUB.hmA }]),
    [TABLE.state]: [
      saga(ID.a1, 'John', 'Doe', A), saga(ID.a2, 'Jane', 'Smith', A, { currentStage: 'INTERVIEWING' }),
      saga(ID.b1, 'Bongi', 'Mahlangu', B),
      saga(ID.c1, 'Bea', 'Ndlovu', C), saga(ID.c2, 'Sipho', 'Khumalo', C),
      interview(ID.a1, ID.ivA, A), interview(ID.b1, ID.ivB, B), interview(ID.c1, ID.ivC, C),
      scoringLink(ID.voteTokenA, ID.a1, A, SUB.panelA), scoringLink(ID.voteTokenB, ID.b1, B, SUB.panelB), scoringLink(ID.voteTokenC, ID.c1, C, SUB.panelC),
      offer(ID.a1, A), offer(ID.b1, B), offer(ID.c1, C),
      snapshot(ID.a1, NAME.a1, A, 'own-a'), snapshot(ID.b1, NAME.b1, B, 'own-b'), snapshot(ID.c1, NAME.c1, C, 'own-c'),
    ],
    [TABLE.config]: [
      config(A, 'SCORING_WEIGHTS', { weights: { skills: 40 }, label: 'weights of A' }),
      config(B, 'SCORING_WEIGHTS', { weights: { skills: 55 }, label: 'weights of B' }),
      config(C, 'SCORING_WEIGHTS', { weights: { skills: 70 }, label: 'weights of C' }),
      config(A, 'INTELLIGENCE_RULES', { rules: [{ id: 'RULE-OFF', name: 'Switched off', enabled: false }] }),
      config(B, 'INTELLIGENCE_RULES', { rules: [{ id: 'RULE-OFF', name: 'Switched off', enabled: false }] }),
      config(C, 'INTELLIGENCE_RULES', { rules: [{ id: 'RULE-OFF', name: 'Switched off', enabled: false }] }),
    ],
    [TABLE.dismissals]: [],
    [TABLE.notifications]: [notification(ID.notifA, A, SUB.staffA, 'Notice for A'), notification(ID.notifB, B, SUB.staffB, 'Notice for B'), notification(ID.notifC, C, SUB.staffC, 'Notice for C')],
    [TABLE.users]: [],
    [TABLE.events]: [],
    [TABLE.idempotency]: [],
    [TABLE.pending]: [pendingAction(ID.actionA, A, ID.a1), pendingAction(ID.actionB, B, ID.b1), pendingAction(ID.actionC, C, ID.c1)],
    [TABLE.itTasks]: [],
    [TABLE.bundles]: [],
    [TENANTS]: [
      ...companyRows(),
      av({ pk: `USER#${SUB.hmA}`, sk: `TENANT#${A}`, tenant_id: A }),
      av({ pk: `USER#${SUB.hmB}`, sk: `TENANT#${B}`, tenant_id: B }),
      av({ pk: `USER#${SUB.hmC}`, sk: `TENANT#${C}`, tenant_id: C }),
      av({ pk: `USER#${SUB.panelA}`, sk: `TENANT#${A}`, tenant_id: A }),
      av({ pk: `USER#${SUB.panelB}`, sk: `TENANT#${B}`, tenant_id: B }),
      av({ pk: `USER#${SUB.panelC}`, sk: `TENANT#${C}`, tenant_id: C }),
    ],
  };
}

// ---------------------------------------------------------------- callers

export type Caller =
  | 'staffA' | 'staffB' | 'staffC' | 'staffD' | 'staffX'
  | 'noRoleA' | 'noRoleB' | 'guestA' | 'guestB'
  | 'agentA' | 'agentB' | 'agentC' | 'public' | 'noTenant' | 'rolesB';
/** Every TalentFlow and hiring manager role, so only the company and its modules are under test. e2e-robots keeps any AI away. */
const ALL_STAFF = '[TalentFlowAdmin naleko-talentflow-admin naleko-talentflow-hr ITAdmin HiringManager hr_staff e2e-robots]';
const COMPANY_OF: Record<string, string> = { A, B, C, D, X };
/** TEN-05's eight groups (lambda/shared/roles.mjs ROLES and PERMS). */
export const NEW_GROUPS = ['admin', 'hr_staff', 'manager', 'employee', 'guest', 'perm-recruitment', 'perm-it', 'perm-approve-offers'];

/** The authorizer a caller arrives with. */
export function authorizerOf(caller: Caller, extraClaims: Record<string, unknown> = {}): unknown {
  const staff = (sub: string, c?: string, groups = ALL_STAFF) =>
    jwtAuthorizer({
      sub, email: `${sub}@example.test`, email_verified: 'true', token_use: 'id', 'cognito:groups': groups, 'custom:isAdmin': 'true', 'custom:staff_id': `STAFF-${sub}`,
      given_name: 'Test', family_name: sub, ...(c ? { tenant_id: c } : {}), ...extraClaims,
    });
  const m = /^staff([A-Z])$/.exec(caller);
  if (m) return staff(`sub-staff-${m[1]!.toLowerCase()}`, COMPANY_OF[m[1]!]);
  // No group at all: a person the route's own role check refuses (the "role answer").
  if (caller === 'noRoleA') return jwtAuthorizer({ sub: 'sub-norole-a', email: 'norole.a@example.test', email_verified: 'true', token_use: 'id', 'cognito:groups': '[e2e-robots]', tenant_id: A, ...extraClaims });
  if (caller === 'noRoleB') return jwtAuthorizer({ sub: 'sub-norole-b', email: 'norole.b@example.test', email_verified: 'true', token_use: 'id', 'cognito:groups': '[e2e-robots]', tenant_id: B, ...extraClaims });
  // A guest (TEN-05's role name; no TalentFlow group).
  if (caller === 'guestA') return jwtAuthorizer({ sub: 'sub-guest-a', email: 'guest.a@example.test', email_verified: 'true', token_use: 'id', 'cognito:groups': '[guest]', tenant_id: A, ...extraClaims });
  if (caller === 'guestB') return jwtAuthorizer({ sub: 'sub-guest-b', email: 'guest.b@example.test', email_verified: 'true', token_use: 'id', 'cognito:groups': '[guest]', tenant_id: B, ...extraClaims });
  if (caller === 'noTenant') return staff(SUB.staffA);
  // TEN-05: a person of B in the new groups only (every role and tick, no old name, no custom:isAdmin).
  if (caller === 'rolesB') return jwtAuthorizer({ sub: 'sub-roles-b', email: 'roles.b@example.test', email_verified: 'true', token_use: 'id', 'cognito:groups': `[${NEW_GROUPS.join(' ')} e2e-robots]`, tenant_id: B, ...extraClaims });
  if (caller === 'public') return undefined;
  const agent = /^agent([A-C])$/.exec(caller);
  if (agent) return { lambda: { actor: 'AGENT', tenant_id: COMPANY_OF[agent[1]!] } };
  throw new Error(`no caller ${caller}`);
}

/** Settings every run gets (as TEN-03's; the tenants table is TENANTS_TABLE). No legacy company. */
export function settings(extra: Record<string, string> = {}): Record<string, string> {
  return {
    STATE_TABLE_NAME: TABLE.state, CONFIG_TABLE_NAME: TABLE.config, DISMISSALS_TABLE_NAME: TABLE.dismissals, NOTIFICATIONS_TABLE_NAME: TABLE.notifications,
    USERS_TABLE_NAME: TABLE.users, EVENTS_TABLE_NAME: TABLE.events, IDEMPOTENCY_TABLE_NAME: TABLE.idempotency, PENDING_ACTIONS_TABLE_NAME: TABLE.pending,
    IT_TASKS_TABLE: TABLE.itTasks, BUNDLES_TABLE: TABLE.bundles, EVENTBRIDGE_BUS_NAME: 'mod01-bus', EB_BUS_NAME: 'mod01-bus',
    NOTIFICATION_QUEUE_URL: 'https://sqs.mod01.example/queue', NOTIFICATION_LAMBDA_NAME: 'sendTalentFlowNotification', TENANTS_TABLE: TENANTS,
    AGENT_TENANT_ID: A, AGENT_API_KEY_SECRET_NAME: AGENT_SECRET, ENVIRONMENT: 'dev', HM_GROUP_NAME: 'HiringManager', POSTMARK_SENDER_EMAIL: 'noreply@mod01.example', POSTMARK_API_TOKEN: 'mod01-fake-token', COGNITO_POOL_ID: 'af-south-1_Mod01Fake', HM_COGNITO_POOL_ID: 'af-south-1_Mod01Fake', FRONTEND_URL: 'https://mod01.example',
    ROLES_TABLE_NAME: ADD_ROLES_TABLE, // child lock rec-15b.1
    ...extra,
  };
}

/** The handler file of a Lambda (index.js, or index.mjs for the newer ones). */
export function fileOf(name: string): string {
  for (const f of ['index.js', 'index.mjs']) if (existsSync(join(LAMBDA, name, f))) return join(LAMBDA, name, f);
  throw new Error(`no handler file for ${name}`);
}

export type Ask = { rawPath?: string; method?: string; path?: Record<string, string>; query?: Record<string, string>; body?: unknown; headers?: Record<string, string>; claims?: Record<string, unknown> };

/** The sign-in pool: each company's hiring manager and panel member (Cognito keeps no company; the Member rows do). */
export const POOL = {
  users: (['a', 'b', 'c'] as const).flatMap((x) => [
    { username: `hm.${x}@example.test`, sub: `sub-hm-${x}`, status: 'CONFIRMED', attributes: { email: `hm.${x}@example.test`, given_name: 'Hanna', family_name: x.toUpperCase() }, groups: ['HiringManager'] },
    { username: `panel.${x}@example.test`, sub: `sub-panel-${x}`, status: 'CONFIRMED', attributes: { email: `panel.${x}@example.test`, given_name: 'Pia', family_name: x.toUpperCase() }, groups: ['naleko-talentflow-admin'] },
  ]),
};

/** Runs one route as a caller against the seeded world (or the given one). */
export function ask(handler: string, caller: Caller, a: Ask = {}, opts: { tables?: Tables; env?: Record<string, string>; fail?: any } = {}): Run {
  const event = httpEvent({ authorizer: authorizerOf(caller, a.claims ?? {}), path: a.path, query: a.query, body: a.body, headers: a.headers });
  if (a.method) event.requestContext.http.method = a.method;
  if (a.rawPath) event.rawPath = a.rawPath;
  return runHandler(fileOf(handler), event, {
    tables: opts.tables ?? tables(),
    secrets: { [AGENT_SECRET]: { AWSCURRENT: 'mod01-agent-key' } },
    env: settings(opts.env),
    cognito: POOL,
    ...(opts.fail ? { fail: opts.fail } : {}),
  });
}

/** Runs a handler with an event the test built itself (EventBridge, a stream, SQS, the public vote route). */
export function runEvent(handler: string, event: unknown, opts: { tables?: Tables; env?: Record<string, string | undefined> } = {}): Run {
  return runHandler(fileOf(handler), event, { tables: opts.tables ?? tables(), secrets: { [AGENT_SECRET]: { AWSCURRENT: 'mod01-agent-key' } }, env: { ...settings(), ...(opts.env ?? {}) }, cognito: POOL });
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
/** The Company row of `c` in a world (plain values), or undefined. */
export const profileOf = (t: Tables, c: string, table = TENANTS) => findRow(t, table, { pk: `TENANT#${c}`, sk: 'PROFILE' });

/** Every call to an outside service (log lines and step markers left out). */
export const calls = (r: { calls: any[] }) => r.calls.filter((c: any) => c.service !== 'log' && c.service !== 'step') as any[];
/** One line per outside call: "dynamodb GetItem <table>", "events PutEvents" ... */
export const callLines = (r: { calls: any[] }) => calls(r).map((c) => `${c.service} ${c.op ?? ''}${c.table ? ' ' + c.table : ''}`.trim());
/** The calls that read the company list for its modules: a GetItem of TENANT#<id> / PROFILE on the tenants table. */
export const isModulesRead = (c: any) => c.service === 'dynamodb' && c.op === 'GetItem' && /tenants$/.test(String(c.table ?? '')) && JSON.stringify(c.input?.Key ?? {}).includes('PROFILE');
/** Everything a run asked of AWS (not the log), as text. */
export const sent = (r: Run) => JSON.stringify(calls(r));
