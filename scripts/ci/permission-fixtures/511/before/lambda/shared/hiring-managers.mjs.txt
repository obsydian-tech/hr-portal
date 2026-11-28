/**
 * REC-14 rule 12: the company's hiring managers, the one place that lists them.
 *
 * A person is listed when they are CONFIRMED and enabled in the sign-in pool, belong to a hiring manager group (HIRING_MANAGER_GROUPS
 * or the HM_GROUP_NAME setting), and have a Member row for the company. A person with no Member row is never taken as the legacy
 * company's. Every page of every group is read; a read that fails fails the function (never a shorter list).
 */
import { CognitoIdentityProviderClient, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { HIRING_MANAGER_GROUPS } from './roles.mjs';
import { companiesOf } from './membership.mjs';

const attr = (user, name) => (user.Attributes ?? []).find((a) => a.Name === name)?.Value;

/** The people, with what the old picker answers carry: [{ sub, email, givenName, familyName, name }], sorted by name ignoring case. */
export async function hiringManagerPeopleOf(tenantId) {
  const pool = process.env.HM_COGNITO_POOL_ID;
  if (!pool) throw new Error('Missing setting HM_COGNITO_POOL_ID');
  const cognito = new CognitoIdentityProviderClient({});
  const groups = [...new Set([...(process.env.HM_GROUP_NAME ? [process.env.HM_GROUP_NAME] : []), ...HIRING_MANAGER_GROUPS])];
  const seen = new Map();
  for (const group of groups) {
    let next;
    try {
      do {
        const page = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: pool, GroupName: group, NextToken: next }));
        for (const u of page.Users ?? []) {
          const sub = attr(u, 'sub');
          if (sub && !seen.has(sub)) seen.set(sub, u);
        }
        next = page.NextToken;
      } while (next);
    } catch (e) {
      if (e?.name !== 'ResourceNotFoundException') throw e;
      console.warn(`getHiringManagers: skipping group "${group}"`, { error: e?.name });
    }
  }
  const people = [];
  for (const [sub, u] of seen) {
    if (u.UserStatus !== 'CONFIRMED' || u.Enabled === false) continue;
    const mine = await companiesOf(sub);
    if (mine.length !== 1 || mine[0] !== tenantId) continue; // one Member row, this company's: a person of two companies is nobody's (TEN-05), never the legacy company's
    const givenName = attr(u, 'given_name') ?? '';
    const familyName = attr(u, 'family_name') ?? '';
    const email = attr(u, 'email');
    people.push({ sub, email, givenName, familyName, name: [givenName, familyName].filter(Boolean).join(' ') || email });
  }
  return people.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/** [{ id, name }]: id is the person's sign-in id. */
export async function hiringManagersOf(tenantId) {
  return (await hiringManagerPeopleOf(tenantId)).map((p) => ({ id: p.sub, name: p.name }));
}
