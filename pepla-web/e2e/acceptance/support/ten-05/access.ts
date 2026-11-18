import { A, B, ID, TEN05, type Ask, type Caller } from './world';

/**
 * TEN-05: the roles, the ticks, how today's group names map onto them, and what each one may do on every route that
 * checks a role. This file is the frozen answer the tests compare with; TEN-05-refresh.md says why each line is so.
 */

export const ROLES = ['admin', 'hr_staff', 'manager', 'employee', 'guest'] as const;
export const PERMS = ['perm-recruitment', 'perm-it', 'perm-approve-offers'] as const;
/** The eight groups of rule 1 (the user admin routes add and remove these). */
export const NEW_GROUPS = [...ROLES, ...PERMS] as string[];
/** Today's TalentFlow group names the user admin routes already manage (they may still remove them, never add them). */
export const OLD_MANAGED = ['TalentFlowAdmin', 'HiringManager', 'ITAdmin', 'HRDirector'];
/** TEN-05.1 (S-1): what user admin update may remove: the eight, today's four, and every old name of OLD_GROUPS below. */
export const UPDATE_MANAGED = (): string[] => [...new Set([...NEW_GROUPS, ...OLD_MANAGED, ...Object.keys(OLD_GROUPS)])];

export type Grant = { roles: string[]; perms: string[] };
const ALL_PERMS = [...PERMS] as string[];
const g = (roles: string[], perms: string[] = []): Grant => ({ roles, perms });

/**
 * Rule 4, as pinned (see the refresh file): old group name -> roles and ticks.
 * naleko-onboarding-hr gives nothing and naleko-talentflow-hr / HRDirector give no HR role: today none of them passes an
 * HR check (BE-17.1, ONB-12, ONB-13 pin that), and rule 3 says hrOnly keeps its answers.
 */
export const OLD_GROUPS: Record<string, Grant> = {
  'naleko-talentflow-admin': g(['admin'], ALL_PERMS),
  TalentFlowAdmin: g(['admin'], ALL_PERMS),
  'naleko-onboarding-hr': g([]),
  'naleko-talentflow-hr': g([], ['perm-recruitment']),
  HRDirector: g([], ['perm-recruitment']),
  'naleko-talentflow-hiringmanager': g(['manager'], ['perm-recruitment']),
  HiringManager: g(['manager'], ['perm-recruitment']),
  // TEN-05.1 (S-3): a panel member or a finance lead is not a manager. PanelMember gives nothing, FinanceLead only the offers tick.
  PanelMember: g([]),
  FinanceLead: g([], ['perm-approve-offers']),
  'naleko-it-provisioning': g([], ['perm-it']),
  ITAdmin: g([], ['perm-it']),
  ITSpecialist: g([], ['perm-it']),
  ComplianceOfficer: g(['guest']),
};
/** The TalentFlow pool's custom:roles values, read through the same table. */
export const CLAIM_ROLES: Record<string, string> = { ADMIN: 'TalentFlowAdmin', HM: 'HiringManager', IT: 'ITAdmin', TA: 'HRDirector' };

/** What rolesOf must give for a set of group names (and the TalentFlow pool claims). */
export function grantOf(groups: string[], claims: Record<string, unknown> = {}): Grant {
  const roles = new Set<string>();
  const perms = new Set<string>();
  const add = (x: Grant) => { x.roles.forEach((r) => roles.add(r)); x.perms.forEach((p) => perms.add(p)); };
  for (const name of groups) {
    if ((ROLES as readonly string[]).includes(name)) roles.add(name);
    else if ((PERMS as readonly string[]).includes(name)) perms.add(name);
    else if (OLD_GROUPS[name]) add(OLD_GROUPS[name]!);
  }
  if (claims['custom:isAdmin'] === 'true') add(OLD_GROUPS['TalentFlowAdmin']!);
  try {
    const list = JSON.parse(String(claims['custom:roles'] ?? '[]'));
    if (Array.isArray(list)) for (const r of list) if (CLAIM_ROLES[r]) add(OLD_GROUPS[CLAIM_ROLES[r]!]!);
  } catch { /* not a list: nothing */ }
  return { roles: [...roles].sort(), perms: [...perms].sort() };
}

// ---------------------------------------------------------------- callers

const groupsList = (c: Caller): string[] => (Array.isArray(c.groups) ? c.groups : []);
const one = (name: string): Caller => ({ name, groups: [name] });

/** One caller per old group of rule 4 (hr_staff and employee are both old and new), and the TalentFlow pool's admin claims. */
export const OLD_CALLERS: Caller[] = [
  ...Object.keys(OLD_GROUPS).map(one),
  one('hr_staff'),
  one('employee'),
  { name: 'custom:roles ["ADMIN"] only', groups: [], claims: { 'custom:roles': '["ADMIN"]' } },
  { name: 'custom:isAdmin "true" only', groups: [], claims: { 'custom:isAdmin': 'true' } },
];
/** One caller per new role and per tick, two people as they will really be set up, and the ones that must get nothing. */
export const NEW_CALLERS: Caller[] = [
  one('admin'), one('manager'), one('guest'),
  one('perm-recruitment'), one('perm-it'), one('perm-approve-offers'),
  { name: 'manager + perm-recruitment', groups: ['manager', 'perm-recruitment'] },
  { name: 'admin + perm-it', groups: ['admin', 'perm-it'] },
  { name: 'hr_staff + perm-recruitment', groups: ['hr_staff', 'perm-recruitment'] },
];
export const NOBODY_CALLERS: Caller[] = [
  { name: 'no groups claim', claims: {} },
  { name: 'empty groups', groups: '[]' },
  one('hr_staffx'), one('xhr_staff'), one('admins'), one('perm-itx'), one('e2e-robots'),
];
export const ALL_CALLERS: Caller[] = [...OLD_CALLERS, ...NEW_CALLERS, ...NOBODY_CALLERS];

export const grantOfCaller = (c: Caller): Grant => grantOf(groupsList(c), c.claims ?? {});
const has = (c: Caller, x: string) => { const r = grantOfCaller(c); return r.roles.includes(x) || r.perms.includes(x); };
/** IT lead (completes or releases a task someone else claimed; sees every queue): the admin role, or today's ITAdmin group. */
const itLead = (c: Caller) => has(c, 'admin') || groupsList(c).includes('ITAdmin');

// ---------------------------------------------------------------- probes

/**
 * One request per route and question. `answer` reads what came back; `want` is the frozen answer for a caller.
 * Answers: yes / no (403 before any AWS call) for a plain role check; all / own for "may see someone else's bundle";
 * all / scoped for the IT task list; lead / not-claimer for finishing someone else's task.
 */
export type Outcome = string;
export type Probe = {
  name: string;
  handler: string;
  ask: Ask;
  /** Turns a run into an outcome, or '?' with the reason. */
  read: 'gate' | 'bundle' | 'list' | 'itList' | 'lead';
  ok?: number[];
  want: (c: Caller) => Outcome;
  /** The role check this route has: its refusal is 403 {"error":"Forbidden"} with no AWS call. */
  gated: boolean;
};

const yesNo = (b: boolean) => (b ? 'yes' : 'no');
const admin = (c: Caller) => yesNo(has(c, 'admin'));
const itRead = (c: Caller) => has(c, 'admin') || has(c, 'perm-it');
const itFinish = (c: Caller) => has(c, 'perm-it');

export const PROBES: Probe[] = [
  { name: 'GET /v1/admin/users', handler: 'adminGetUsers', ask: {}, read: 'gate', want: admin, gated: true },
  { name: 'GET /v1/admin/dashboard', handler: 'adminGetDashboard', ask: {}, read: 'gate', want: admin, gated: true },
  { name: 'POST /v1/admin/users', handler: 'adminCreateUser', ask: { method: 'POST', body: { email: 'new.person@example.test', givenName: 'Nomsa', familyName: 'New', roles: ['HM'] } }, read: 'gate', ok: [200, 201], want: admin, gated: true },
  { name: 'PUT /v1/admin/users/{userId}', handler: 'adminUpdateUser', ask: { method: 'PUT', path: { userId: TEN05.userA2 }, body: { roles: ['HM'] } }, read: 'gate', want: admin, gated: true },
  { name: 'DELETE /v1/admin/users/{userId}', handler: 'adminDeactivateUser', ask: { method: 'DELETE', path: { userId: TEN05.userA2 } }, read: 'gate', want: admin, gated: true },
  { name: 'POST /v1/config', handler: 'manageTalentFlowConfig', ask: { method: 'POST', body: { configType: 'PANEL_CONFIG', data: { x: 1 } } }, read: 'gate', ok: [200, 201], want: admin, gated: true },
  { name: 'PUT /v1/config', handler: 'manageTalentFlowConfig', ask: { method: 'PUT', body: { configType: 'SCORING_WEIGHTS', data: { weights: { skills: 45 } } } }, read: 'gate', ok: [200, 201], want: admin, gated: true },
  { name: 'GET /v1/config (no role check today)', handler: 'manageTalentFlowConfig', ask: { query: { configType: 'SCORING_WEIGHTS', active: 'true' } }, read: 'gate', want: () => 'yes', gated: false },
  { name: 'GET /v1/it/tasks/{taskId}', handler: 'getItTask', ask: { path: { taskId: ID.taskA } }, read: 'gate', want: (c) => yesNo(itRead(c)), gated: true },
  { name: 'POST /v1/it/tasks/{taskId}/claim', handler: 'claimItTask', ask: { method: 'POST', path: { taskId: ID.taskA } }, read: 'gate', want: (c) => yesNo(itRead(c)), gated: true },
  { name: 'GET /v1/it/tasks', handler: 'getItTasks', ask: {}, read: 'itList', want: (c) => (!itRead(c) ? 'no' : itLead(c) ? 'all' : 'scoped'), gated: true },
  { name: 'POST /v1/it/tasks/{taskId}/complete (own task)', handler: 'completeItTask', ask: { method: 'POST', path: { taskId: TEN05.taskMine }, body: { assetReference: 'ASSET-1', fulfilmentMethod: 'ISSUED' } }, read: 'gate', want: (c) => yesNo(itFinish(c)), gated: true },
  { name: 'POST /v1/it/tasks/{taskId}/release (own task)', handler: 'releaseItTask', ask: { method: 'POST', path: { taskId: TEN05.taskMine }, body: { reason: 'busy' } }, read: 'gate', want: (c) => yesNo(itFinish(c)), gated: true },
  { name: 'POST /v1/it/tasks/{taskId}/complete (someone else\'s task)', handler: 'completeItTask', ask: { method: 'POST', path: { taskId: ID.taskA3 }, body: { assetReference: 'ASSET-1', fulfilmentMethod: 'ISSUED' } }, read: 'lead', want: (c) => (!itFinish(c) ? 'no' : itLead(c) ? 'lead' : 'not-claimer'), gated: true },
  { name: 'POST /v1/it/tasks/{taskId}/release (someone else\'s task)', handler: 'releaseItTask', ask: { method: 'POST', path: { taskId: ID.taskA4 }, body: { reason: 'busy' } }, read: 'lead', want: (c) => (!itFinish(c) ? 'no' : itLead(c) ? 'lead' : 'not-claimer'), gated: true },
  { name: 'POST /v1/provisioning/bundles', handler: 'createProvisioningBundle', ask: { method: 'POST', body: { candidateId: ID.a1, candidateName: 'John Doe', candidateRole: 'Junior baker', startDate: '2026-12-01', items: [{ type: 'LAPTOP', label: 'Laptop', queue: 'Laptops' }] } }, read: 'gate', ok: [200, 201], want: (c) => yesNo(has(c, 'admin') || has(c, 'manager')), gated: true },
  { name: 'GET /v1/provisioning/bundles/{bundleId} (another manager\'s)', handler: 'getProvisioningBundle', ask: { path: { bundleId: ID.bundleA } }, read: 'bundle', want: (c) => (has(c, 'admin') ? 'all' : 'own'), gated: false },
  { name: 'PATCH /v1/provisioning/bundles/{bundleId} (another manager\'s)', handler: 'updateProvisioningBundle', ask: { method: 'PATCH', path: { bundleId: ID.bundleA }, body: { department: 'Operations' } }, read: 'bundle', want: (c) => (has(c, 'admin') ? 'all' : 'own'), gated: false },
  { name: 'POST /v1/provisioning/bundles/{bundleId}/approve (another manager\'s)', handler: 'approveProvisioningBundle', ask: { method: 'POST', path: { bundleId: ID.bundleA } }, read: 'bundle', want: (c) => (has(c, 'admin') ? 'all' : 'own'), gated: false },
  { name: 'GET /v1/provisioning/bundles/{bundleId}/progress (another manager\'s)', handler: 'getProvisioningBundleProgress', ask: { path: { bundleId: ID.bundleA } }, read: 'bundle', want: (c) => (has(c, 'admin') || has(c, 'perm-it') ? 'all' : 'own'), gated: false },
  { name: 'GET /v1/provisioning/bundles', handler: 'getProvisioningBundles', ask: {}, read: 'list', want: (c) => (has(c, 'admin') ? 'all' : 'own'), gated: false },
  { name: 'GET /v1/hiring-managers (no role check today)', handler: 'getHiringManagers', ask: {}, read: 'gate', want: () => 'yes', gated: false },
  { name: 'GET /v1/panel-members (no role check today)', handler: 'getPanelMembers', ask: {}, read: 'gate', want: () => 'yes', gated: false },
];

/** The handlers whose own group checks move into lambda/shared/roles.mjs (the spec's table, as it is on develop 1420ef9). */
export const ROLE_HANDLERS = [
  'adminCreateUser', 'adminUpdateUser', 'adminDeactivateUser', 'adminGetUsers', 'adminGetDashboard', 'manageTalentFlowConfig',
  'getHiringManagers', 'getPanelMembers', 'getItTasks', 'getItTask', 'claimItTask', 'completeItTask', 'releaseItTask',
  'createProvisioningBundle', 'getProvisioningBundle', 'getProvisioningBundles', 'getProvisioningBundleProgress', 'updateProvisioningBundle', 'approveProvisioningBundle',
];
export { A, B };
