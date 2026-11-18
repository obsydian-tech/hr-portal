/**
 * REC-01: who may do what in Recruitment. One file, one named check per kind of caller.
 *
 * Every Recruitment handler a person calls runs one of these before its first AWS call, in this order:
 *   1. the role check from this file (403 { "error": "Forbidden" }, no AWS call),
 *   2. requireTenant (tenant.mjs), then requireModule (modules.mjs),
 *   3. only then any row is read. A row that is not the caller's answers 404, the same as a row that does not exist.
 *
 *   const RA = await import('../shared/recruitment-access.mjs');
 *   const forbidden = RA.requireRecruiter(event);
 *   if (forbidden) return forbidden;
 *
 * Roles and ticks come from roles.mjs (TEN-05's file, read and not edited). This file names no group: the roles and
 * ticks are TEN-05's role and tick names, and the old TalentFlow names count through TEN-05's own OLD_GROUPS table.
 *
 * Decisions (specs/REC-01.md, REC-DECISIONS.md):
 *   D-REC-1.1 A Recruiter is HR with the Recruitment tick. An admin who is not HR is not a Recruiter.
 *   D-REC-1.3 Until TEN-06 moves the old TalentFlow HR people, a name that TEN-05's OLD_GROUPS gives the Recruitment tick and
 *             no role (the old HR names) counts as a Recruiter. The new tick on its own, and every old name that carries a
 *             role (an old admin or hiring manager), do not.
 *   D-REC-1.2 / 1.4 A route that opens one candidate answers 404, never 403, to anyone who may not see that candidate.
 */
import { OLD_GROUPS, OLD_ROLE_GROUP, ROLES, PERMS, grantOfNames, groupsOf, holds, rolesOf } from './roles.mjs';
import { json } from './hr-group.mjs';

const [ROLE_ADMIN, ROLE_HR, ROLE_MANAGER] = [ROLES[0], ROLES[1], ROLES[2]];
const [TICK_RECRUITMENT, , TICK_APPROVE_OFFERS] = PERMS;

export const forbidden = () => json(403, { error: 'Forbidden' });

const claimsOf = (event) => event?.requestContext?.authorizer?.jwt?.claims;
const isId = (c) => c?.token_use === undefined || c?.token_use === 'id';
const present = (v) => typeof v === 'string' && v !== '';

/** Every group name the caller holds: the groups claim, and the old app's roles as the old group they stand for. */
function namesOf(event) {
  const c = claimsOf(event);
  if (!c || !isId(c)) return [];
  const names = groupsOf(c);
  try {
    const l = JSON.parse(String(c['custom:roles'] ?? '[]'));
    if (Array.isArray(l)) for (const r of l) if (OLD_ROLE_GROUP[r]) names.push(OLD_ROLE_GROUP[r]);
  } catch { /* nothing */ }
  return names;
}

/** True when this one name is an old group that carries the Recruitment tick and no role (D-REC-1.3). */
function oldHrName(name) {
  if (!Object.prototype.hasOwnProperty.call(OLD_GROUPS, name)) return false;
  const g = grantOfNames([name]);
  return g.roles.length === 0 && g.perms.includes(TICK_RECRUITMENT);
}

/** HR with the Recruitment tick (or an old TalentFlow HR name until TEN-06). */
export function isRecruiter(event) {
  const g = rolesOf(event);
  if (g.roles.includes(ROLE_HR) && g.perms.includes(TICK_RECRUITMENT)) return true;
  return g.perms.includes(TICK_RECRUITMENT) && namesOf(event).some(oldHrName);
}
export const isAdmin = (event) => holds(event, { roles: [ROLE_ADMIN] });
export const isManager = (event) => holds(event, { roles: [ROLE_MANAGER] });
export const isApprover = (event) => holds(event, { perms: [TICK_APPROVE_OFFERS] });

/** null when the caller is a Recruiter, else the 403 answer. */
export const requireRecruiter = (event) => (isRecruiter(event) ? null : forbidden());
/** null when the caller has the admin role, else the 403 answer. */
export const requireAdmin = (event) => (isAdmin(event) ? null : forbidden());
/** null when the caller has the Approve offers tick (REC-05 applies it; the drafter rule is REC-05's). */
export const requireApprover = (event) => (isApprover(event) ? null : forbidden());
/** Reading Recruitment settings: a Recruiter or an admin. */
export const requireRecruiterOrAdmin = (event) => (isRecruiter(event) || isAdmin(event) ? null : forbidden());
/** Lists: a Recruiter (everything of the company) or a manager (only their own candidates). */
export const requireRecruiterOrManager = (event) => (isRecruiter(event) || isManager(event) ? null : forbidden());

/**
 * The person id of the caller: the user_id claim (TEN-06 keeps the old TalentFlow id there) when there is one, else sub.
 * Only the sign-in is read, never a body, query, path or header value. undefined when there is none.
 */
export function callerId(event) {
  const c = claimsOf(event);
  if (!c) return undefined;
  if (present(c.user_id)) return c.user_id;
  return present(c.sub) ? c.sub : undefined;
}

/** The candidate row names this person as its hiring manager (a row the handler has already loaded and ownsRow-checked). */
export const hiringManagerOf = (row, personId) => present(personId) && present(row?.hiringManagerId) && row.hiringManagerId === personId;

/** The interview row lists this person (by person id; a guest known by email only is not a person id) on its panel. */
export const panelMemberOf = (interview, personId) => present(personId) && Array.isArray(interview?.panelMemberIds) && interview.panelMemberIds.includes(personId);

/**
 * May this caller decide (move Interview to Offer, or Not hired)? A Recruiter always; the role's hiring manager when the
 * level's decider setting is HR_OR_HM. REC-02 and REC-03 apply it.
 */
export function canDecide(event, candidate, decider) {
  if (isRecruiter(event)) return true;
  return decider === 'HR_OR_HM' && isManager(event) && hiringManagerOf(candidate, callerId(event));
}

/**
 * How the caller relates to one candidate: 'recruiter', 'hiringManager', 'panel' or null (not theirs: answer 404).
 * `loadInterviews` is only called when the answer needs the interviews (a panel member), so a Recruiter or the hiring
 * manager reads no interview row. It returns the candidate's interview rows (already ownsRow-checked).
 */
export async function relationOf(event, candidate, loadInterviews) {
  if (isRecruiter(event)) return 'recruiter';
  const id = callerId(event);
  if (isManager(event) && hiringManagerOf(candidate, id)) return 'hiringManager';
  if (!present(id)) return null;
  const interviews = await loadInterviews();
  return (interviews ?? []).some((iv) => panelMemberOf(iv, id)) ? 'panel' : null;
}

/** A copy of a value without any key that matches the pattern, at every depth. */
export function withoutKeys(value, pattern) {
  if (Array.isArray(value)) return value.map((v) => withoutKeys(v, pattern));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!pattern.test(k)) out[k] = withoutKeys(v, pattern);
    return out;
  }
  return value;
}
const SALARY = /salary/i;
const OFFER_OR_SALARY = /offer|salary/i;
/** Salary stays hidden from the hiring manager (REC-05). */
export const forHiringManager = (value) => withoutKeys(value, SALARY);
/** A panel member sees no offer and no salary field. */
export const forPanelMember = (value) => withoutKeys(value, OFFER_OR_SALARY);
/** True when a stored history event is about an offer or a salary (a panel member's history drops it). */
export const aboutOffer = (event) => OFFER_OR_SALARY.test(String(event?.eventType ?? '')) || OFFER_OR_SALARY.test(JSON.stringify(event?.detail ?? ''));
