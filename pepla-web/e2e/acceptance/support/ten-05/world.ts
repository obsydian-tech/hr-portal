import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { A, B, ID, SUB, TABLE, TENANTS, av, tables as ten03Tables } from '../ten-03/world';
import { LAMBDA, httpEvent, runHandler, type Fail, type Pool, type PoolUser, type Run, type Tables } from './lambda-harness';

/**
 * TEN-05: the world the role tests run in. TEN-03's two companies and their TalentFlow, IT and bundle rows (support/ten-03/world.ts),
 * plus TalentFlow user profiles of both companies and a sign-in pool. Every row of A carries tenant_id A and every row of B
 * carries tenant_id B (the shape TEN-03's move leaves). All names and addresses are made up.
 */
export { A, B, ID, SUB, TABLE, TENANTS };

/** The one person every role test signs in as: the same sub and company, only the groups change. */
export const CALLER_SUB = 'sub-ten05-caller';
export const POOL_ID = 'af-south-1_Ten05Fake';

export const TEN05 = {
  taskMine: 'task-ten05-mine', // claimed by the caller
  userA: 'sub-ten05-user-a',
  userA2: 'sub-ten05-user-a2',
  userB: 'sub-ten05-user-b',
};

const NOW = '2026-11-10T08:00:00.000Z';

function profile(sub: string, email: string, given: string, family: string, company: string, roles: string[]) {
  return av({
    PK: `USER#${sub}`, SK: 'PROFILE', GSI1PK: `EMAIL#${email}`, GSI1SK: `USER#${sub}`, userId: sub, email, givenName: given, familyName: family,
    fullName: `${given} ${family}`, roles, activeRole: roles[0], status: 'ACTIVE', createdAt: NOW, updatedAt: NOW, tenant_id: company,
  });
}

/** TEN-03's rows, plus a task the caller claimed and the TalentFlow user profiles. */
export function tables(): Tables {
  const t = ten03Tables();
  t[TABLE.itTasks]!.push(av({
    taskId: TEN05.taskMine, tenant_id: A, tenantId: A, taskStatus: 'CLAIMED', claimedBy: CALLER_SUB, claimedByName: 'Test Caller', queue: 'Laptops',
    slaStatus: 'ON_TRACK', candidateId: ID.a1, createdAt: NOW, newHire: { name: 'John Doe', role: 'Junior baker', daysRemaining: 10 }, itemName: 'Laptop', category: 'HARDWARE',
  }));
  t[TABLE.users] = [
    profile(TEN05.userA, 'thandeka.a@example.test', 'Thandeka', 'Alpha', A, ['IT']),
    profile(TEN05.userA2, 'musa.a@example.test', 'Musa', 'Alpha', A, ['HM']),
    profile(TEN05.userB, 'bongi.b@example.test', 'Bongi', 'Beta', B, ['IT']),
  ];
  return t;
}

/** Every group the Naleko pool holds once TEN-05 is applied, plus the old TalentFlow names users may still be in. */
export const POOL_GROUPS = [
  'admin', 'hr_staff', 'manager', 'employee', 'guest', 'perm-recruitment', 'perm-it', 'perm-approve-offers', 'e2e-robots',
  'naleko-onboarding-hr', 'naleko-talentflow-hr', 'naleko-it-provisioning', 'naleko-talentflow-admin', 'naleko-talentflow-hiringmanager',
  'TalentFlowAdmin', 'HiringManager', 'ITAdmin', 'HRDirector',
];

const person = (username: string, sub: string, given: string, family: string, groups: string[]): PoolUser => ({
  username, sub, status: 'CONFIRMED', attributes: { email: username, given_name: given, family_name: family }, groups,
});

/** The sign-in pool. The two profile users are here too, so the user admin routes can change their groups. */
export function pool(extra: PoolUser[] = [], groups?: string[]): Pool {
  return {
    users: [
      person('thandeka.a@example.test', TEN05.userA, 'Thandeka', 'Alpha', ['hr_staff', 'perm-it', 'e2e-robots', 'TalentFlowAdmin', 'naleko-onboarding-hr', 'naleko-talentflow-admin']),
      person('musa.a@example.test', TEN05.userA2, 'Musa', 'Alpha', ['manager', 'perm-recruitment', 'e2e-robots']),
      person('bongi.b@example.test', TEN05.userB, 'Bongi', 'Beta', ['perm-it']),
      ...extra,
    ],
    ...(groups ? { groups } : {}),
  };
}

/** Settings every run gets (the TalentFlow, IT and bundle tables of TEN-03, the pool, and the hiring manager group Terraform sets). */
export function settings(extra: Record<string, string> = {}): Record<string, string> {
  return {
    STATE_TABLE_NAME: TABLE.state, CONFIG_TABLE_NAME: TABLE.config, DISMISSALS_TABLE_NAME: TABLE.dismissals, NOTIFICATIONS_TABLE_NAME: TABLE.notifications,
    USERS_TABLE_NAME: TABLE.users, EVENTS_TABLE_NAME: TABLE.events, IDEMPOTENCY_TABLE_NAME: TABLE.idempotency, PENDING_ACTIONS_TABLE_NAME: TABLE.pending,
    IT_TASKS_TABLE: TABLE.itTasks, BUNDLES_TABLE: TABLE.bundles, EVENTBRIDGE_BUS_NAME: 'ten05-bus', EB_BUS_NAME: 'ten05-bus', TENANTS_TABLE: TENANTS,
    ENVIRONMENT: 'dev', COGNITO_POOL_ID: POOL_ID, HM_COGNITO_POOL_ID: POOL_ID, HM_GROUP_NAME: 'naleko-talentflow-hiringmanager', FRONTEND_URL: 'https://ten05.example',
    ...extra,
  };
}

// ---------------------------------------------------------------- callers

export type Caller = { name: string; groups?: string[] | string; claims?: Record<string, unknown>; company?: string | null; sub?: string };

/** The JWT authorizer a caller arrives with: an ID token of company A (unless it says otherwise), groups as API Gateway hands them over. */
export function authorizerOf(c: Caller): unknown {
  const claims: Record<string, unknown> = {
    sub: c.sub ?? CALLER_SUB, email: 'caller.ten05@example.test', email_verified: 'true', token_use: 'id', given_name: 'Test', family_name: 'Caller',
    'custom:staff_id': 'STAFF-T05', iss: `https://cognito-idp.af-south-1.amazonaws.com/${POOL_ID}`,
  };
  const company = c.company === undefined ? A : c.company;
  if (company !== null) claims['tenant_id'] = company;
  if (c.groups !== undefined) claims['cognito:groups'] = Array.isArray(c.groups) ? `[${c.groups.join(' ')}]` : c.groups;
  Object.assign(claims, c.claims ?? {});
  return { jwt: { claims, scopes: null } };
}

export function fileOf(name: string): string {
  for (const f of ['index.js', 'index.mjs']) if (existsSync(join(LAMBDA, name, f))) return join(LAMBDA, name, f);
  throw new Error(`no handler file for ${name}`);
}

export type Ask = { method?: string; path?: Record<string, string>; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> };

/** Runs one route as a caller against the seeded world (or the given one). */
export function ask(handler: string, caller: Caller, a: Ask = {}, opts: { tables?: Tables; pool?: Pool; env?: Record<string, string>; fail?: Fail } = {}): Run {
  const event = httpEvent({ authorizer: authorizerOf(caller), method: a.method, path: a.path, query: a.query, body: a.body, headers: a.headers });
  return runHandler(fileOf(handler), event, { tables: opts.tables ?? tables(), env: settings(opts.env), cognito: opts.pool ?? pool(), fail: opts.fail });
}

export const bodyOf = (r: { response: any }) => {
  try { return JSON.parse(r.response?.body ?? 'null'); } catch { return r.response?.body; }
};
export const statusOf = (r: Run) => r.response?.statusCode as number | undefined;
export const describe = (r: Run) => `${statusOf(r)} ${JSON.stringify(bodyOf(r)).slice(0, 240)}${r.error ? ` (threw ${r.error.name}: ${r.error.message.slice(0, 200)})` : ''}`;
export const aws = (r: Run) => r.calls.filter((c: any) => c.service !== 'log') as any[];

/** Plain values of a stored row. */
export function plain(r: Record<string, any> | undefined): Record<string, any> {
  const un = (v: any): any => ('S' in v ? v.S : 'N' in v ? Number(v.N) : 'BOOL' in v ? v.BOOL : 'NULL' in v ? null : 'L' in v ? v.L.map(un) : 'M' in v ? Object.fromEntries(Object.entries(v.M).map(([k, x]) => [k, un(x)])) : v);
  return Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, un(v)]));
}
export const rowsOf = (t: Tables, table: string) => (t[table] ?? []).map(plain);
