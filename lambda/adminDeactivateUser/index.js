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

const { isIdToken } = require('../shared/id-token');
const { rolesHelper } = require('../shared/tf-roles.js');
const { tenantHelper } = require('../shared/tf-tenant.js');
const {
  CognitoIdentityProviderClient,
  AdminDisableUserCommand,
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
    if (!result.Item || !T.ownsRow(unmarshall(result.Item), tenantId)) {
      return T.notFound();
    }
    user = unmarshall(result.Item);
  } catch (err) {
    console.error('adminDeactivateUser: DynamoDB read failed', { userId, error: err?.name });
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
    console.error('adminDeactivateUser: Cognito disable failed', { userId, error: err?.name });
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
    console.error('adminDeactivateUser: DynamoDB update failed (Cognito already disabled)', { userId, error: err?.name });
    return respond(500, { error: 'User disabled in Cognito but registry update failed — contact administrator' });
  }

  console.info('adminDeactivateUser: user deactivated', { userId, email: user.email, deactivatedBy: callingSub });
  return respond(200, { message: 'User deactivated successfully', userId, deactivatedAt: now });
};
