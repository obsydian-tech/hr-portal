// INT-04 (NH-277) rule 4: a person's contact details for an email, looked up fresh. The person's company (companyOfSignIn) must be the
// interview's company before the sign-in pool is asked; the pool record's sub must equal the id asked; the email must pass INT-02's
// pattern. Anything else gives null. Names missing in the pool are empty strings. Nothing is logged but an error name.
import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { companyOfSignIn } from './membership.mjs';
import { EMAIL_PATTERN, oneLine } from './interview-emails.mjs';

const cognito = new CognitoIdentityProviderClient({});

export async function contactOf(tenantId, id) {
  if (typeof id !== 'string' || !id) return null;
  let company;
  try { company = await companyOfSignIn(id); } catch (err) { console.warn(JSON.stringify({ event: 'people_contacts_member_read_failed', error: err?.name ?? 'Error' })); return null; }
  if (!company || company !== tenantId) return null;
  try {
    const got = await cognito.send(new AdminGetUserCommand({ UserPoolId: process.env.COGNITO_POOL_ID, Username: id }));
    const a = Object.fromEntries((got.UserAttributes ?? []).map((x) => [x.Name, x.Value]));
    if (a.sub !== id) return null;
    const email = typeof a.email === 'string' ? a.email.trim() : '';
    if (!EMAIL_PATTERN.test(email)) return null;
    return { id, first_name: oneLine(a.given_name), last_name: oneLine(a.family_name), email };
  } catch (err) {
    if (err?.name !== 'UserNotFoundException') console.warn(JSON.stringify({ event: 'people_contacts_pool_read_failed', error: err?.name ?? 'Error' }));
    return null;
  }
}

/** Runs fn over items at most `limit` at a time; an item whose turn comes when stop() is true gets { late: true }. */
export async function limited(items, limit, stop, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      if (stop()) { out[i] = { late: true }; continue; }
      out[i] = { value: await fn(items[i]) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
