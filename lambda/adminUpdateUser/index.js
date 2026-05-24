'use strict';

/**
 * lambda/adminUpdateUser/index.js — Admin-S1
 *
 * Updates a user's roles (Option C dual-write: Cognito groups + DynamoDB).
 *
 * Steps:
 *   1. Verify ADMIN role from JWT
 *   2. Read current user from DynamoDB (get current roles for diff)
 *   3. Compute groups to add and groups to remove
 *   4. Apply Cognito group changes
 *   5. If Cognito fails mid-way, attempt rollback of applied changes
 *   6. Update DynamoDB record (roles[], activeRole, updatedAt)
 *   7. Return updated user
 *
 * Body: { roles: TalentFlowRole[] }
 * Path param: {userId} — Cognito sub
 *
 * Access: ADMIN role only.
 */

const {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  AdminListGroupsForUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const cognito     = new CognitoIdentityProviderClient({});
const dynamo      = new DynamoDBClient({});
const USERS_TABLE = process.env.USERS_TABLE_NAME || 'talent-flow-users';
const POOL_ID     = process.env.COGNITO_POOL_ID  || 'af-south-1_2LdAGFnw2';

const ROLE_TO_GROUP = {
  ADMIN: 'TalentFlowAdmin',
  HM:    'HiringManager',
  IT:    'ITAdmin',
  TA:    'HRDirector',
};

const VALID_ROLES    = Object.keys(ROLE_TO_GROUP);
const ROLE_PRECEDENCE = ['ADMIN', 'HM', 'IT', 'TA'];
// Only manage groups owned by TalentFlow — do not touch other Naleko groups
const MANAGED_GROUPS = new Set(Object.values(ROLE_TO_GROUP));

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

function extractClaims(event) {
  return event.requestContext?.authorizer?.jwt?.claims || {};
}

function hasAdminRole(claims) {
  // Path 1: TF pool — custom:roles JSON array
  try {
    const roles = JSON.parse(claims['custom:roles'] || '[]');
    if (Array.isArray(roles) && roles.includes('ADMIN')) return true;
  } catch { /* fall through */ }
  // Path 2: Naleko pool — API GW HTTP API v2 sends cognito:groups as '[group1 group2]'
  const raw = claims['cognito:groups'];
  if (!raw) return false;
  let groups;
  try { groups = JSON.parse(raw); } catch { /* not JSON */ }
  if (!Array.isArray(groups)) {
    groups = String(raw).replace(/^\[|\]$/g, '').split(' ').filter(Boolean);
  }
  return groups.includes('naleko-talentflow-admin');
}

exports.handler = async (event) => {
  const claims = extractClaims(event);
  if (!hasAdminRole(claims)) {
    return respond(403, { error: 'Admin role required' });
  }

  const userId = event.pathParameters?.userId;
  if (!userId) {
    return respond(400, { error: 'userId path parameter is required' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Request body is not valid JSON' });
  }

  const { roles } = body;
  if (!Array.isArray(roles) || roles.length === 0) {
    return respond(400, { error: 'roles must be a non-empty array' });
  }
  const invalidRoles = roles.filter((r) => !VALID_ROLES.includes(r));
  if (invalidRoles.length) {
    return respond(400, { error: `Invalid roles: ${invalidRoles.join(', ')}` });
  }

  // ── Read current user from DynamoDB ───────────────────────────────────────
  let currentUser;
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ PK: `USER#${userId}`, SK: 'PROFILE' }),
    }));
    if (!result.Item) {
      return respond(404, { error: 'User not found' });
    }
    currentUser = unmarshall(result.Item);
  } catch (err) {
    console.error('adminUpdateUser: DynamoDB read failed', { userId, error: err.message });
    return respond(500, { error: 'Failed to retrieve user' });
  }

  if (currentUser.status === 'INACTIVE') {
    return respond(409, { error: 'Cannot update roles for an inactive user' });
  }

  // ── Compute group diff ────────────────────────────────────────────────────
  const desiredGroups = new Set(roles.map((r) => ROLE_TO_GROUP[r]));
  const currentRoles  = currentUser.roles || [];
  const currentGroups = new Set(currentRoles.map((r) => ROLE_TO_GROUP[r]).filter(Boolean));

  const toAdd    = [...desiredGroups].filter((g) => !currentGroups.has(g));
  const toRemove = [...currentGroups].filter((g) => !desiredGroups.has(g) && MANAGED_GROUPS.has(g));

  // ── Apply Cognito group changes (add first, then remove) ──────────────────
  const addedGroups = [];
  for (const group of toAdd) {
    try {
      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: POOL_ID,
        Username:   currentUser.email,
        GroupName:  group,
      }));
      addedGroups.push(group);
    } catch (err) {
      console.error('adminUpdateUser: failed to add group — rolling back', { group, error: err.message });
      // Rollback successfully added groups
      for (const added of addedGroups) {
        try {
          await cognito.send(new AdminRemoveUserFromGroupCommand({
            UserPoolId: POOL_ID, Username: currentUser.email, GroupName: added,
          }));
        } catch (rbErr) {
          console.error('adminUpdateUser: rollback failed for group', { added, error: rbErr.message });
        }
      }
      return respond(500, { error: `Failed to assign group "${group}" in Cognito — changes rolled back` });
    }
  }

  for (const group of toRemove) {
    try {
      await cognito.send(new AdminRemoveUserFromGroupCommand({
        UserPoolId: POOL_ID,
        Username:   currentUser.email,
        GroupName:  group,
      }));
    } catch (err) {
      // Non-fatal for removals — log and continue; DynamoDB write is the source of truth for the UI
      console.warn('adminUpdateUser: failed to remove group (non-fatal)', { group, error: err.message });
    }
  }

  // ── Update DynamoDB ───────────────────────────────────────────────────────
  const activeRole = ROLE_PRECEDENCE.find((r) => roles.includes(r)) || roles[0];
  const now        = new Date().toISOString();

  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ PK: `USER#${userId}`, SK: 'PROFILE' }),
      UpdateExpression: 'SET #roles = :roles, activeRole = :activeRole, updatedAt = :now',
      ExpressionAttributeNames: { '#roles': 'roles' },
      ExpressionAttributeValues: marshall({
        ':roles':      roles,
        ':activeRole': activeRole,
        ':now':        now,
      }),
    }));
  } catch (err) {
    console.error('adminUpdateUser: DynamoDB update failed (Cognito already updated)', { userId, error: err.message });
    return respond(500, { error: 'Cognito groups updated but registry sync failed — contact administrator' });
  }

  console.info('adminUpdateUser: roles updated', { userId, roles, activeRole });
  return respond(200, {
    user: { ...currentUser, roles, activeRole, updatedAt: now },
  });
};
