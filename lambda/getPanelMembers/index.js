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
 *   COGNITO_POOL_ID  — Naleko user pool id of this account (set by Terraform)
 *   STATE_TABLE_NAME — talent-flow-state
 */

const {
  CognitoIdentityProviderClient,
  ListUsersInGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall }         = require('@aws-sdk/util-dynamodb');
const { tenantHelper } = require('../shared/tf-tenant.js');

const cognito = new CognitoIdentityProviderClient({});
const dynamo  = new DynamoDBClient({});

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

const POOL_ID     = requireSetting('COGNITO_POOL_ID');
const STATE_TABLE = process.env.STATE_TABLE_NAME   || 'talent-flow-state';

// Groups whose members have TalentFlow platform access


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

function mapCognitoUser(cognitoUser, tenantId) {
  const attrs = {};
  for (const a of (cognitoUser.Attributes || [])) {
    attrs[a.Name] = a.Value;
  }
  const sub        = attrs['sub']         || cognitoUser.Username;
  const email      = attrs['email']       || cognitoUser.Username;
  const givenName  = attrs['given_name']  || '';
  const familyName = attrs['family_name'] || '';
  const name       = [givenName, familyName].filter(Boolean).join(' ') || email;
  return {
    id:          sub,    // sub — matches panelMemberIds in INTERVIEW# records
    name,
    email,
    role:        'System User',
    tenantId,
    accessType:  'SYSTEM_ACCOUNT',
  };
}

/** Fetch all non-expired SCORING_LINK# records for a candidate from DynamoDB */
async function getEmailLinkMembers(T, tenantId, candidateId) {
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
    .filter((rec) => T.ownsRow(rec, tenantId))        // this company's links only
    .filter((rec) => !rec.ttl || rec.ttl > nowSec)   // exclude expired tokens (DDB TTL lag guard)
    .map((rec) => ({
      id:               rec.panelMemberId,
      name:             rec.panelMemberName,
      email:            rec.panelMemberEmail,
      role:             rec.panelMemberRole,
      tenantId,
      accessType:       'EMAIL_LINK',
      scoringLinkToken: rec.token,
      scoringLinkUsed:  rec.used === true,
      scoringLinkExpiry: rec.expiresAt,
    }));
}

exports.handler = async (event) => {
  // TEN-03: the company comes from the sign-in only. The pool holds no company, so the system users are not
  // narrowed by it until TEN-05 (narrowing needs a read grant on the tenants table: an IAM change for Iggie).
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;

  try {
    const candidateId = event.queryStringParameters?.candidateId || null;

    // ── 1. Fetch system users from Cognito ──────────────────────────────────
    const seen    = new Set();
    const members = [];

    const R = await require('../shared/tf-roles.js').rolesHelper();
    for (const group of R.PANEL_GROUPS) {
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
          members.push(mapCognitoUser(user, tenantId));
        }
      }
    }

    // ── 2. Merge email-link members (only when candidateId provided) ────────
    if (candidateId) {
      const emailLinkMembers = await getEmailLinkMembers(T, tenantId, candidateId);
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
