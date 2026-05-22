'use strict';

/**
 * getPanelMembers — NH-114 / TF-C12 (Phase E: email-link members added)
 *
 * Returns panel members eligible for interview scoring.
 *
 * Two member types (D004 hybrid model):
 *   SYSTEM_ACCOUNT — internal platform users from Cognito groups
 *   EMAIL_LINK     — external panelists added by TA; scored via scoring link tokens
 *
 * Query param: ?candidateId={id}
 *   When provided, also queries DynamoDB for SCORING_LINK# records under
 *   that candidate and merges them as EMAIL_LINK members with scoringLinkToken.
 *   When omitted, returns SYSTEM_ACCOUNT members only (directory mode).
 *
 * Paths:
 *   GET /v1/panel-members              — system directory (no candidateId)
 *   GET /v1/panel-members?candidateId= — merged list for a specific candidate
 *
 * Env vars:
 *   COGNITO_POOL_ID  — Naleko user pool id (af-south-1_2LdAGFnw2)
 *   STATE_TABLE_NAME — talent-flow-state
 *   TENANT_ID        — NALEKO
 */

const {
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall }         = require('@aws-sdk/util-dynamodb');

const cognito = new CognitoIdentityProviderClient({});
const dynamo  = new DynamoDBClient({});

const POOL_ID     = process.env.COGNITO_POOL_ID   || 'af-south-1_2LdAGFnw2';
const STATE_TABLE = process.env.STATE_TABLE_NAME   || 'talent-flow-state';
const TENANT_ID   = process.env.TENANT_ID          || 'NALEKO';

// Groups whose members have TalentFlow platform access
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

function mapCognitoUser(cognitoUser) {
  const attrs = {};
  for (const a of (cognitoUser.Attributes || [])) {
    attrs[a.Name] = a.Value;
  }
  const email      = attrs['email']       || cognitoUser.Username;
  const givenName  = attrs['given_name']  || '';
  const familyName = attrs['family_name'] || '';
  const name       = [givenName, familyName].filter(Boolean).join(' ') || email;
  return {
    id:          email,
    name,
    email,
    role:        'System User',
    tenantId:    TENANT_ID,
    accessType:  'SYSTEM_ACCOUNT',
  };
}

/** Fetch all non-expired SCORING_LINK# records for a candidate from DynamoDB */
async function getEmailLinkMembers(candidateId) {
  const nowSec = Math.floor(Date.now() / 1000);
  let items    = [];

  try {
    const result = await dynamo.send(new QueryCommand({
      TableName:                 STATE_TABLE,
      KeyConditionExpression:    'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: marshall({
        ':pk':       `CANDIDATE#${candidateId}`,
        ':skPrefix': 'SCORING_LINK#',
      }),
    }));
    items = (result.Items || []).map(unmarshall);
  } catch (err) {
    console.error('Failed to query scoring links from DynamoDB', { candidateId, error: err.message });
    return [];
  }

  return items
    .filter((rec) => !rec.ttl || rec.ttl > nowSec)   // exclude expired tokens (DDB TTL lag guard)
    .map((rec) => ({
      id:               rec.panelMemberId,
      name:             rec.panelMemberName,
      email:            rec.panelMemberEmail,
      role:             rec.panelMemberRole,
      tenantId:         rec.tenantId || TENANT_ID,
      accessType:       'EMAIL_LINK',
      scoringLinkToken: rec.token,
      scoringLinkUsed:  rec.used === true,
      scoringLinkExpiry: rec.expiresAt,
    }));
}

exports.handler = async (event) => {
  try {
    const candidateId = event.queryStringParameters?.candidateId || null;

    // ── 1. Fetch system users from Cognito ──────────────────────────────────
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
          members.push(mapCognitoUser(user));
        }
      }
    }

    // ── 2. Merge email-link members (only when candidateId provided) ────────
    if (candidateId) {
      const emailLinkMembers = await getEmailLinkMembers(candidateId);
      for (const em of emailLinkMembers) {
        // Avoid duplicates: a system user may also have been added as email-link
        if (!seen.has(em.email)) {
          seen.add(em.email);
          members.push(em);
        } else {
          // System user also has a scoring link — annotate the existing record
          const existing = members.find((m) => m.email === em.email);
          if (existing) {
            existing.scoringLinkToken  = em.scoringLinkToken;
            existing.scoringLinkUsed   = em.scoringLinkUsed;
            existing.scoringLinkExpiry = em.scoringLinkExpiry;
          }
        }
      }
    }

    return respond(200, { members, total: members.length, candidateId: candidateId || null });
  } catch (err) {
    console.error('getPanelMembers error', err);
    return respond(500, { message: 'Failed to retrieve panel members' });
  }
};
