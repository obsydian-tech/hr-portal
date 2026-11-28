/**
 * ONB-03: who may add an employee, and who the HR partners are.
 *  */
import { groupsOf } from './document-check.mjs';
import { rolesOf } from './roles.mjs';

export const HR_GROUP = 'hr_staff';
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

export function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

/** True when the claims carry one of the group names (exact names, through groupsOf). */
export function inGroup(claims, ...names) {
  if (!isIdToken(claims)) return false; // BE-18: an access token is in no group here
  const groups = groupsOf(claims);
  return names.some((n) => groups.includes(n));
}

/** BE-18: an ID token, or claims with no token_use at all. Any other token_use (access, empty, look-alikes) is refused. */
export function isIdToken(claims) {
  const t = claims?.token_use;
  return t === undefined || t === 'id';
}

/**
 * HR may act on anyone; everyone else only on the record that is theirs. TEN-02: the owner is the sign-in whose sub is
 * the row's user_sub (a row without one has no owner), and BE-17.1's verified email must still match.
 */
export function isHrOrOwner(claims, employee) {
  if (!isIdToken(claims)) return false;
  if (claims && groupsOf(claims).includes(HR_GROUP)) return true;
  const sub = String(claims?.sub ?? '');
  if (sub === '' || String(employee?.user_sub ?? '') !== sub) return false;
  const v = claims?.email_verified;
  const verified = v === true || (typeof v === 'string' && v.toLowerCase() === 'true');
  if (!verified) return false;
  const mine = String(claims?.email ?? '').trim().toLowerCase();
  const theirs = String(employee?.email ?? '').trim().toLowerCase();
  return mine !== '' && mine === theirs;
}

/** null for the Agent API (actor AGENT) or HR, else the 403 answer. */
export function hrOrAgent(event, message) {
  if (event?.requestContext?.authorizer?.lambda?.actor === 'AGENT') return null;
  return hrOnly(event, message);
}

/** null for HR, else the 403 answer. Groups are split into names, never a substring match. */
export function hrOnly(event, message) {
  if (rolesOf(event).roles.includes(HR_GROUP)) return null;
  return json(403, { error: message });
}

const attr = (user, name) => (user.Attributes ?? user.UserAttributes ?? []).find((a) => a.Name === name)?.Value ?? '';

/**
 * Every member of hr_staff in the pool, every page. The caller passes its own Cognito client and
 * ListUsersInGroupCommand, so this shared file needs no AWS package of its own.
 */
export async function listHrMembers(client, ListUsersInGroupCommand, poolId) {
  const out = [];
  let token;
  do {
    const page = await client.send(new ListUsersInGroupCommand({ UserPoolId: poolId, GroupName: HR_GROUP, Limit: 60, NextToken: token }));
    out.push(...(page.Users ?? []));
    token = page.NextToken;
  } while (token);
  return out;
}

/** One member as the screens and createEmployee see them. */
export function toPartner(user) {
  const email = attr(user, 'email');
  const name = [attr(user, 'given_name'), attr(user, 'family_name')].filter(Boolean).join(' ').trim() || email || user.Username;
  const staffId = attr(user, 'custom:staff_id') || user.Username;
  // id is what createEmployee accepts as hr_staff_id: the staff ID, or the Cognito username when there is none.
  return { id: staffId, name, staffId, email };
}
