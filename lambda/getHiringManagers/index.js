'use strict';

/**
 * getHiringManagers Lambda
 *
 * Returns all CONFIRMED users in the `naleko-talentflow-hiringmanager` Cognito group
 * from the Naleko (HR Portal) user pool.
 *
 * Pool consolidation (Epic 5): TF API GW authorizer was switched to the Naleko pool.
 * All user lookups must use the Naleko pool so that `sub` values match
 * the `hiringManagerId` stored on Candidate SAGA records.
 *
 * Used by the TA Create Candidate form to populate the HM selector dropdown.
 *
 * GET /v1/hiring-managers
 * Auth: JWT (any authenticated TalentFlow user)
 *
 * Response: { hiringManagers: [{ sub, email, givenName, familyName, name }] }
 */

const {
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const { tenantHelper } = require('../shared/tf-tenant.js');
const { rolesHelper } = require('../shared/tf-roles.js');

const cognito    = new CognitoIdentityProviderClient({});
// After pool consolidation, use the Naleko (HR Portal) Cognito pool.
// The TF API GW authorizer validates against this pool, so subs must match.
// BE-15: a setting that names one environment has no fallback value. A missing
// one stops the Lambda when it starts, with one clear line in the log.
function requireSetting(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing setting ${name}`);
    throw new Error(`Missing setting ${name}`);
  }
  return value;
}

const HM_POOL_ID  = requireSetting('HM_COGNITO_POOL_ID');
const HM_GROUP    = process.env.HM_GROUP_NAME;

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  // TEN-03: the company check. TEN-04.2: the pool holds no company, so the list is narrowed to the company's people by
  // their Member rows (inCompany). A failed Member read answers 500, never the whole pool.
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;

  const R = await rolesHelper();
  const groups = [...new Set([...(HM_GROUP ? [HM_GROUP] : []), ...R.HIRING_MANAGER_GROUPS])];
  const pool = [];
  const seen = new Set();
  for (const group of groups) {
    try {
      let nextToken;
      do {
        const result = await cognito.send(new ListUsersInGroupCommand({
          UserPoolId: HM_POOL_ID,
          GroupName:  group,
          NextToken:  nextToken,
        }));
        for (const u of result.Users ?? []) if (!seen.has(u.Username)) { seen.add(u.Username); pool.push(u); }
        nextToken = result.NextToken;
      } while (nextToken);
    } catch (err) {
      console.warn(`getHiringManagers: skipping group "${group}"`, { error: err?.name });
    }
  }
  let users;
  try {
    const { inCompany } = await import('../shared/membership.mjs');
    users = await inCompany(pool, tenantId);
  } catch (err) {
    console.error('getHiringManagers: Member read failed', { error: err?.name });
    return respond(500, { error: 'Failed to retrieve hiring managers' });
  }

  const hiringManagers = users
    .filter(u => u.UserStatus === 'CONFIRMED')
    .map(u => {
      const a = Object.fromEntries((u.Attributes ?? []).map(x => [x.Name, x.Value]));
      return {
        sub:        a.sub,
        email:      a.email,
        givenName:  a.given_name  ?? '',
        familyName: a.family_name ?? '',
        name:       [a.given_name, a.family_name].filter(Boolean).join(' ') || a.email,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return respond(200, { hiringManagers });
};
