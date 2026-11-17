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
const HM_GROUP    = process.env.HM_GROUP_NAME      || 'naleko-talentflow-hiringmanager';

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
  // TEN-03: the company check. The pool holds no company, so the list is not narrowed by it until TEN-05
  // (narrowing needs a read grant on the tenants table: an IAM change for Iggie).
  const T = await tenantHelper();
  const { refusal } = T.requireTenant(event);
  if (refusal) return refusal;

  const users = [];
  let nextToken;

  try {
    do {
      const result = await cognito.send(new ListUsersInGroupCommand({
        UserPoolId: HM_POOL_ID,
        GroupName:  HM_GROUP,
        NextToken:  nextToken,
      }));
      users.push(...(result.Users ?? []));
      nextToken = result.NextToken;
    } while (nextToken);
  } catch (err) {
    console.error('getHiringManagers: Cognito list failed', { error: err.message });
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
