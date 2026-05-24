'use strict';

/**
 * lambda/adminDeactivateUser/index.js — Admin-S1
 *
 * Soft-deactivates a TalentFlow staff user:
 *   1. Verify ADMIN role from JWT
 *   2. Prevent self-deactivation
 *   3. Read user from DynamoDB (verify exists + not already inactive)
 *   4. Call cognito.adminDisableUser (blocks future logins immediately)
 *   5. Set status = INACTIVE + deactivatedAt in DynamoDB
 *
 * The user record is NEVER deleted — retained for POPIA audit trail.
 * Path param: {userId} — Cognito sub
 *
 * Access: ADMIN role only.
 */

const {
  CognitoIdentityProviderClient,
  AdminDisableUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const cognito     = new CognitoIdentityProviderClient({});
const dynamo      = new DynamoDBClient({});
const USERS_TABLE = process.env.USERS_TABLE_NAME || 'talent-flow-users';
const POOL_ID     = process.env.COGNITO_POOL_ID  || 'af-south-1_2LdAGFnw2';

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

  const userId     = event.pathParameters?.userId;
  const callingSub = claims['sub'];

  if (!userId) {
    return respond(400, { error: 'userId path parameter is required' });
  }

  // ── Prevent self-deactivation ──────────────────────────────────────────────
  if (userId === callingSub) {
    return respond(409, { error: 'You cannot deactivate your own account' });
  }

  // ── Read user from DynamoDB ────────────────────────────────────────────────
  let user;
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ PK: `USER#${userId}`, SK: 'PROFILE' }),
    }));
    if (!result.Item) {
      return respond(404, { error: 'User not found' });
    }
    user = unmarshall(result.Item);
  } catch (err) {
    console.error('adminDeactivateUser: DynamoDB read failed', { userId, error: err.message });
    return respond(500, { error: 'Failed to retrieve user' });
  }

  if (user.status === 'INACTIVE') {
    return respond(409, { error: 'User is already inactive' });
  }

  // ── Disable in Cognito (blocks logins immediately) ─────────────────────────
  try {
    await cognito.send(new AdminDisableUserCommand({
      UserPoolId: POOL_ID,
      Username:   user.email,
    }));
  } catch (err) {
    console.error('adminDeactivateUser: Cognito disable failed', { userId, error: err.message });
    return respond(500, { error: 'Failed to disable user in Cognito' });
  }

  // ── Set status = INACTIVE in DynamoDB ─────────────────────────────────────
  const now = new Date().toISOString();
  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ PK: `USER#${userId}`, SK: 'PROFILE' }),
      UpdateExpression: 'SET #s = :inactive, deactivatedAt = :now, updatedAt = :now, deactivatedBy = :caller',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: marshall({
        ':inactive': 'INACTIVE',
        ':now':      now,
        ':caller':   callingSub || 'unknown',
      }),
    }));
  } catch (err) {
    console.error('adminDeactivateUser: DynamoDB update failed (Cognito already disabled)', { userId, error: err.message });
    return respond(500, { error: 'User disabled in Cognito but registry update failed — contact administrator' });
  }

  console.info('adminDeactivateUser: user deactivated', { userId, email: user.email, deactivatedBy: callingSub });
  return respond(200, { message: 'User deactivated successfully', userId, deactivatedAt: now });
};
