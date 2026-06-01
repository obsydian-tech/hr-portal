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

const cognito    = new CognitoIdentityProviderClient({});
// After pool consolidation, use the Naleko (HR Portal) Cognito pool.
// The TF API GW authorizer validates against this pool, so subs must match.
const HM_POOL_ID  = process.env.HM_COGNITO_POOL_ID || 'af-south-1_2LdAGFnw2';
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

exports.handler = async () => {
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
