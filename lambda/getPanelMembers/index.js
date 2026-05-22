'use strict';

/**
 * getPanelMembers — NH-114 / TF-C12
 *
 * Returns all system users eligible for interview panels.
 * Queries every platform-access Cognito group, deduplicates by email.
 *
 * Decision 005: Internal directory — grows organically from Cognito groups.
 * Decision 041: "System user" members — have full platform access.
 *
 * Path: GET /v1/panel-members  (JWT-secured)
 *
 * Env vars:
 *   COGNITO_POOL_ID  — Naleko user pool id (af-south-1_2LdAGFnw2)
 *   TENANT_ID        — NALEKO
 */

const {
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const cognito    = new CognitoIdentityProviderClient({});
const POOL_ID    = process.env.COGNITO_POOL_ID || 'af-south-1_2LdAGFnw2';
const TENANT_ID  = process.env.TENANT_ID       || 'NALEKO';

// All Cognito groups whose members have TalentFlow platform access
const PLATFORM_GROUPS = ['naleko-talentflow-admin', 'naleko-talentflow-hr'];

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

async function listGroupUsers(groupName) {
  const users = [];
  let nextToken;
  do {
    const result = await cognito.send(new ListUsersInGroupCommand({
      UserPoolId: POOL_ID,
      GroupName:  groupName,
      Limit:      60,
      NextToken:  nextToken,
    }));
    users.push(...(result.Users || []));
    nextToken = result.NextToken;
  } while (nextToken);
  return users;
}

function mapUser(cognitoUser) {
  const attrs = {};
  for (const a of (cognitoUser.Attributes || [])) {
    attrs[a.Name] = a.Value;
  }
  const email      = attrs['email']       || cognitoUser.Username;
  const givenName  = attrs['given_name']  || '';
  const familyName = attrs['family_name'] || '';
  const name       = [givenName, familyName].filter(Boolean).join(' ') || email;
  return { id: email, name, email, role: 'System User', tenantId: TENANT_ID };
}

exports.handler = async () => {
  try {
    const seen    = new Set();
    const members = [];

    for (const group of PLATFORM_GROUPS) {
      let users;
      try {
        users = await listGroupUsers(group);
      } catch (err) {
        console.warn(`getPanelMembers: skipping group "${group}"`, { error: err.message });
        continue;
      }
      for (const user of users) {
        const email = (user.Attributes || []).find((a) => a.Name === 'email')?.Value
                      || user.Username;
        if (!seen.has(email)) {
          seen.add(email);
          members.push(mapUser(user));
        }
      }
    }

    return respond(200, { members, total: members.length });
  } catch (err) {
    console.error('getPanelMembers error', err);
    return respond(500, { message: 'Failed to retrieve panel members' });
  }
};
