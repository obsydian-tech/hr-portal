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

const { isIdToken } = require('../shared/id-token');
const { rolesHelper } = require('../shared/tf-roles.js');
const { tenantHelper } = require('../shared/tf-tenant.js');
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

const ROLE_PRECEDENCE = ['ADMIN', 'HM', 'IT', 'TA'];

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


exports.handler = async (event) => {
  if (!isIdToken(event?.requestContext?.authorizer?.jwt?.claims ?? {})) return respond(403, {"error": "Admin role required"});
  const claims = extractClaims(event);
  const R = await rolesHelper();
  const denied = R.requireRole(event, { roles: ['admin'] });
  if (denied) return denied;
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;

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

  const roles = Array.isArray(body.roles) ? body.roles : [];
  const wanted = R.groupsForBody(body);
  if (!wanted) {
    return respond(400, { error: 'Invalid role or permissions' });
  }

  // ── Read current user from DynamoDB ───────────────────────────────────────
  let currentUser;
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ PK: `USER#${userId}`, SK: 'PROFILE' }),
    }));
    if (!result.Item || !T.ownsRow(unmarshall(result.Item), tenantId)) {
      return T.notFound();
    }
    currentUser = unmarshall(result.Item);
  } catch (err) {
    console.error('adminUpdateUser: DynamoDB read failed', { userId, error: err?.name });
    return respond(500, { error: 'Failed to retrieve user' });
  }

  if (currentUser.status === 'INACTIVE') {
    return respond(409, { error: 'Cannot update roles for an inactive user' });
  }

  // ── Current groups from Cognito ───────────────────────────────────────────
  let current = [];
  try {
    const res = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: POOL_ID, Username: currentUser.email }));
    current = (res.Groups || []).map((g) => g.GroupName);
  } catch (err) {
    console.error('adminUpdateUser: list groups failed', { userId, error: err?.name });
    return respond(500, { error: 'Failed to read groups' });
  }
  const desired = new Set(wanted.groups);
  if (!wanted.hasRole) for (const g of current) if (R.ROLES.includes(g)) desired.add(g);
  const managed = new Set([...R.MANAGED_GROUPS, ...R.OLD_MANAGED_GROUPS, ...Object.keys(R.OLD_GROUPS)]);
  const toAdd    = [...desired].filter((g) => !current.includes(g));
  const toRemove = current.filter((g) => managed.has(g) && !desired.has(g));

  const addedGroups = [];
  for (const group of toAdd) {
    try {
      await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: POOL_ID, Username: currentUser.email, GroupName: group }));
      addedGroups.push(group);
    } catch (err) {
      console.error('adminUpdateUser: failed to add group — rolling back', { group, error: err?.name });
      for (const added of addedGroups) {
        try {
          await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: POOL_ID, Username: currentUser.email, GroupName: added }));
        } catch (rbErr) {
          console.error('adminUpdateUser: rollback failed for group', { added, error: rbErr?.name });
        }
      }
      return respond(500, { error: `Failed to assign group "${group}" in Cognito — changes rolled back` });
    }
  }
  for (const group of toRemove) {
    try {
      await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId: POOL_ID, Username: currentUser.email, GroupName: group }));
    } catch (err) {
      // A group left behind keeps the old access, so this is not answered as a success.
      console.error('adminUpdateUser: failed to remove group', { group, error: err?.name });
      return respond(500, { error: 'Failed to remove a group in Cognito' });
    }
  }

  // ── Update DynamoDB ───────────────────────────────────────────────────────
  const activeRole = ROLE_PRECEDENCE.find((r) => roles.includes(r)) || roles[0] || body.role || currentUser.activeRole;
  const now        = new Date().toISOString();

  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ PK: `USER#${userId}`, SK: 'PROFILE' }),
      UpdateExpression: 'SET #roles = :roles, activeRole = :activeRole, updatedAt = :now',
      ExpressionAttributeNames: { '#roles': 'roles' },
      ExpressionAttributeValues: marshall({
        ':roles':      roles.length ? roles : (currentUser.roles || []),
        ':activeRole': activeRole,
        ':now':        now,
      }),
    }));
  } catch (err) {
    console.error('adminUpdateUser: DynamoDB update failed (Cognito already updated)', { userId, error: err?.name });
    return respond(500, { error: 'Cognito groups updated but registry sync failed — contact administrator' });
  }

  console.info('adminUpdateUser: roles updated', { userId, roles, activeRole });
  return respond(200, {
    user: { ...currentUser, roles, activeRole, updatedAt: now },
  });
};
