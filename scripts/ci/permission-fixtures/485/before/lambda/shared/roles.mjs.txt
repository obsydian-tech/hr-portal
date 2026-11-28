/**
 * TEN-05: who the caller is, as roles and ticks. The only file that names a group.
 *
 * Roles: admin, hr_staff, manager, employee, guest. Ticks: perm-recruitment, perm-it, perm-approve-offers.
 * OLD_GROUPS maps today's group names onto them until TEN-06 moves the people (then it goes).
 * Groups are split into exact names, never a substring match. A token that is not an ID token has none.
 */
export const ROLES = ['admin', 'hr_staff', 'manager', 'employee', 'guest'];
export const PERMS = ['perm-recruitment', 'perm-it', 'perm-approve-offers'];
export const MANAGED_GROUPS = [...ROLES, ...PERMS];

const ALL = [...PERMS];
export const OLD_GROUPS = {
  'naleko-talentflow-admin': { roles: ['admin'], perms: ALL },
  TalentFlowAdmin: { roles: ['admin'], perms: ALL },
  'naleko-onboarding-hr': { roles: [], perms: [] },
  'naleko-talentflow-hr': { roles: [], perms: ['perm-recruitment'] },
  HRDirector: { roles: [], perms: ['perm-recruitment'] },
  'naleko-talentflow-hiringmanager': { roles: ['manager'], perms: ['perm-recruitment'] },
  HiringManager: { roles: ['manager'], perms: ['perm-recruitment'] },
  PanelMember: { roles: [], perms: [] },
  FinanceLead: { roles: [], perms: ['perm-approve-offers'] },
  'naleko-it-provisioning': { roles: [], perms: ['perm-it'] },
  ITAdmin: { roles: [], perms: ['perm-it'] },
  ITSpecialist: { roles: [], perms: ['perm-it'] },
  ComplianceOfficer: { roles: ['guest'], perms: [] },
};
/** The old app's roles (TalentFlow pool custom:roles and the user admin body). */
export const OLD_ROLE_GROUP = { ADMIN: 'TalentFlowAdmin', HM: 'HiringManager', IT: 'ITAdmin', TA: 'HRDirector' };
/** What the user admin routes may still remove (today's managed TalentFlow names). */
export const OLD_MANAGED_GROUPS = Object.values(OLD_ROLE_GROUP);
/** Pickers. */
export const HIRING_MANAGER_GROUPS = ['manager', 'perm-recruitment', 'naleko-talentflow-hiringmanager'];
export const PANEL_GROUPS = ['naleko-talentflow-admin', 'naleko-talentflow-hr', 'manager'];

const claimsOf = (event) => event?.requestContext?.authorizer?.jwt?.claims;
const isId = (c) => c?.token_use === undefined || c?.token_use === 'id';

export function groupsOf(claims) {
  const raw = claims?.['cognito:groups'];
  if (Array.isArray(raw)) return raw.map((g) => String(g).trim()).filter(Boolean);
  const s = String(raw ?? '').trim();
  if (s.startsWith('[')) {
    try { const l = JSON.parse(s); if (Array.isArray(l)) return l.map((g) => String(g).trim()).filter(Boolean); } catch { /* "[a b]" */ }
  }
  return s.replace(/^\[|\]$/g, '').split(/[\s,]+/).map((g) => g.trim()).filter(Boolean);
}

export function grantOfNames(names) {
  const roles = new Set();
  const perms = new Set();
  for (const n of names) {
    if (ROLES.includes(n)) roles.add(n);
    else if (PERMS.includes(n)) perms.add(n);
    else if (Object.prototype.hasOwnProperty.call(OLD_GROUPS, n)) { OLD_GROUPS[n].roles.forEach((r) => roles.add(r)); OLD_GROUPS[n].perms.forEach((p) => perms.add(p)); }
  }
  return { roles: [...roles], perms: [...perms] };
}

export function rolesOf(event) {
  const c = claimsOf(event);
  if (!c || !isId(c)) return { roles: [], perms: [] };
  const names = groupsOf(c);
  if (c['custom:isAdmin'] === 'true') names.push('TalentFlowAdmin');
  try {
    const l = JSON.parse(String(c['custom:roles'] ?? '[]'));
    if (Array.isArray(l)) for (const r of l) if (OLD_ROLE_GROUP[r]) names.push(OLD_ROLE_GROUP[r]);
  } catch { /* nothing */ }
  return grantOfNames(names);
}

export function holds(event, { roles = [], perms = [] } = {}) {
  const g = rolesOf(event);
  return roles.some((r) => g.roles.includes(r)) || perms.some((p) => g.perms.includes(p));
}

export function requireRole(event, need) {
  if (holds(event, need)) return null;
  return { statusCode: 403, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Forbidden' }) };
}

/** IT lead: the admin role, or today's ITAdmin group (until TEN-06). */
export function isItLead(event) {
  const c = claimsOf(event);
  if (!c || !isId(c)) return false;
  return holds(event, { roles: ['admin'] }) || groupsOf(c).includes('ITAdmin');
}

/** The groups a user admin body asks for: { role, permissions } or today's roles. null when the body is not valid. */
export function groupsForBody(body) {
  if (body && body.role !== undefined) {
    if (!ROLES.includes(body.role)) return null;
    const p = body.permissions ?? [];
    if (!Array.isArray(p) || p.some((x) => !PERMS.includes(x))) return null;
    return { groups: [...new Set([body.role, ...p])], hasRole: true };
  }
  const r = body?.roles;
  if (!Array.isArray(r) || r.length === 0 || r.some((x) => !OLD_ROLE_GROUP[x])) return null;
  const g = grantOfNames(r.map((x) => OLD_ROLE_GROUP[x]));
  return { groups: [...g.roles, ...g.perms], hasRole: g.roles.length > 0 };
}
