/**
 * REC-15 step D rule 24: people's names for the interviews and history answers. namesOf(tenantId, personIds) answers { [id]: name | null }.
 *  - Only an id in sign-in form (a 36-character UUID) is checked or looked up; anything else is null with no read at all (R2-1).
 *  - Company check first: the id's company (companyOfSignIn, the pickers' rule, LEGACY_TENANT_ID for no Member row) must be the caller's
 *    company before the sign-in pool is asked (D-8a). After AdminGetUser the record's sub must equal the id asked.
 *  - The name is the trimmed given_name and family_name joined by one space; neither gives null. Nothing else the pool returns is kept.
 *  - At most 50 distinct ids per invocation; the rest are null, with one log line holding the count only.
 *  - Any error gives null for that id and one log line with the error name only. Cached for the invocation.
 */
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { companyOfSignIn } from './membership.mjs';

export const SIGN_IN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_IDS = 50;
const cognito = new CognitoIdentityProviderClient({});
async function nameOf(tenantId, id) {
  let company;
  try {
    company = await companyOfSignIn(id);
  } catch (err) {
    console.warn(JSON.stringify({ event: 'people_names_member_read_failed', error: err?.name ?? 'Error' }));
    return null;
  }
  if (!company || company !== tenantId) return null;
  try {
    const got = await cognito.send(new AdminGetUserCommand({ UserPoolId: process.env.COGNITO_POOL_ID, Username: id }));
    const attrs = Object.fromEntries((got.UserAttributes ?? []).map((a) => [a.Name, a.Value]));
    if (attrs.sub !== id) return null;
    const parts = [attrs.given_name, attrs.family_name].map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
    return parts.length ? parts.join(' ') : null;
  } catch (err) {
    if (err?.name !== 'UserNotFoundException') console.warn(JSON.stringify({ event: 'people_names_pool_read_failed', error: err?.name ?? 'Error' }));
    return null;
  }
}

export async function namesOf(tenantId, personIds) {
  const out = {};
  const cache = new Map();
  const ids = [...new Set((personIds ?? []).filter((x) => typeof x === 'string'))];
  let looked = 0;
  let skipped = 0;
  for (const id of ids) {
    if (!SIGN_IN_ID.test(id)) { out[id] = null; continue; }
    const key = `${tenantId}|${id}`;
    if (cache.has(key)) { out[id] = cache.get(key); continue; }
    if (looked >= MAX_IDS) { out[id] = null; skipped++; continue; }
    looked++;
    const name = await nameOf(tenantId, id);
    cache.set(key, name);
    out[id] = name;
  }
  if (skipped) console.warn(JSON.stringify({ event: 'people_names_limit', skipped }));
  return out;
}
