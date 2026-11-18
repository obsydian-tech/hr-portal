'use strict';

/**
 * lambda/adminCreateUser/index.js — Admin-S1
 *
 * Creates a new TalentFlow staff user:
 *   1. Verify ADMIN role from JWT
 *   2. Validate required fields
 *   3. Check EmailIndex for duplicate email
 *   4. Call cognito.adminCreateUser on Naleko pool
 *   5. Add user to Cognito groups matching requested roles[]
 *   6. Write profile + roles to talent-flow-users table
 *   7. Return created user record
 *
 * Body: { email, givenName, familyName, roles: TalentFlowRole[] }
 * TalentFlowRole: 'ADMIN' | 'HM' | 'IT' | 'TA'
 *
 * Access: ADMIN role only.
 */

const { isIdToken } = require('../shared/id-token');
const { rolesHelper } = require('../shared/tf-roles.js');
const { tenantHelper } = require('../shared/tf-tenant.js');
const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient, QueryCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
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


async function checkEmailExists(email) {
  const result = await dynamo.send(new QueryCommand({
    TableName: USERS_TABLE,
    IndexName: 'EmailIndex',
    KeyConditionExpression: 'GSI1PK = :emailKey',
    ExpressionAttributeValues: { ':emailKey': { S: `EMAIL#${email.toLowerCase()}` } },
    Limit: 1,
  }));
  return (result.Items || []).length > 0;
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

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Request body is not valid JSON' });
  }

  const { email, givenName, familyName } = body;
  const roles = Array.isArray(body.roles) ? body.roles : [];

  // ── Validate required fields ───────────────────────────────────────────────
  const missing = ['email', 'givenName', 'familyName'].filter((f) => !body[f]);
  if (missing.length) {
    return respond(400, { error: 'Missing required fields', missing });
  }
  const wanted = R.groupsForBody(body);
  if (!wanted) {
    return respond(400, { error: 'Invalid role or permissions' });
  }

  // ── Check for duplicate email ──────────────────────────────────────────────
  try {
    if (await checkEmailExists(email)) {
      return respond(409, { error: 'A user with this email already exists' });
    }
  } catch (err) {
    console.error('adminCreateUser: email check failed', { error: err?.name });
    return respond(500, { error: 'Failed to validate email uniqueness' });
  }

  // ── Create user in Cognito ─────────────────────────────────────────────────
  let cognitoUser;
  try {
    const result = await cognito.send(new AdminCreateUserCommand({
      UserPoolId: POOL_ID,
      Username:   email.toLowerCase(),
      UserAttributes: [
        { Name: 'email',          Value: email.toLowerCase() },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'given_name',     Value: givenName },
        { Name: 'family_name',    Value: familyName },
      ],
      MessageAction: 'SUPPRESS',
    }));
    cognitoUser = result.User;
  } catch (err) {
    console.error('adminCreateUser: Cognito create failed', { error: err?.name });
    if (err.name === 'UsernameExistsException') {
      return respond(409, { error: 'A Cognito user with this email already exists' });
    }
    return respond(500, { error: 'Failed to create Cognito user' });
  }

  const userId = cognitoUser.Attributes?.find((a) => a.Name === 'sub')?.Value
              || cognitoUser.Username;

  // ── Add to Cognito groups ──────────────────────────────────────────────────
  const groupErrors = [];
  for (const groupName of wanted.groups) {
    try {
      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: POOL_ID,
        Username:   email.toLowerCase(),
        GroupName:  groupName,
      }));
    } catch (err) {
      console.error('adminCreateUser: failed to add group', { groupName, error: err?.name });
      groupErrors.push(groupName);
    }
  }

  // ── Write to talent-flow-users table ──────────────────────────────────────
  const now         = new Date().toISOString();
  const normalEmail = email.toLowerCase();
  const activeRole  = ROLE_PRECEDENCE.find((r) => roles.includes(r)) || roles[0] || body.role;

  const userRecord = {
    PK:         `USER#${userId}`,
    SK:         'PROFILE',
    GSI1PK:     `EMAIL#${normalEmail}`,
    GSI1SK:     `USER#${userId}`,
    userId,
    email:      normalEmail,
    givenName,
    familyName,
    fullName:   `${givenName} ${familyName}`.trim(),
    roles,
    activeRole,
    status:     'ACTIVE',
    tenant_id:  tenantId,
    createdAt:  now,
    updatedAt:  now,
  };

  try {
    await dynamo.send(new PutItemCommand({
      TableName:           USERS_TABLE,
      Item:                marshall(userRecord, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
  } catch (err) {
    console.error('adminCreateUser: DynamoDB write failed', { userId, error: err?.name });
    return respond(500, { error: 'User created in Cognito but registry write failed', userId });
  }

  console.info('adminCreateUser: user created', { userId, email: normalEmail, roles });

  return respond(201, {
    user: userRecord,
    warnings: groupErrors.length ? `Failed to add to groups: ${groupErrors.join(', ')}` : undefined,
  });
};
