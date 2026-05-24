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
const POOL_ID     = process.env.COGNITO_POOL_ID  || 'af-south-1_2LdAGFnw2';

// Role → Naleko pool group mapping (mirrors pre-token trigger's group→role mapping in reverse)
const ROLE_TO_GROUP = {
  ADMIN: 'TalentFlowAdmin',
  HM:    'HiringManager',
  IT:    'ITAdmin',
  TA:    'HRDirector',
};

const VALID_ROLES = Object.keys(ROLE_TO_GROUP);
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

function hasAdminRole(claims) {
  try {
    const roles = JSON.parse(claims['custom:roles'] || '[]');
    return Array.isArray(roles) && roles.includes('ADMIN');
  } catch {
    return false;
  }
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
  const claims = extractClaims(event);
  if (!hasAdminRole(claims)) {
    return respond(403, { error: 'Admin role required' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Request body is not valid JSON' });
  }

  const { email, givenName, familyName, roles } = body;

  // ── Validate required fields ───────────────────────────────────────────────
  const missing = ['email', 'givenName', 'familyName', 'roles'].filter((f) => !body[f]);
  if (missing.length) {
    return respond(400, { error: 'Missing required fields', missing });
  }
  if (!Array.isArray(roles) || roles.length === 0) {
    return respond(400, { error: 'roles must be a non-empty array' });
  }
  const invalidRoles = roles.filter((r) => !VALID_ROLES.includes(r));
  if (invalidRoles.length) {
    return respond(400, { error: `Invalid roles: ${invalidRoles.join(', ')}. Valid: ${VALID_ROLES.join(', ')}` });
  }

  // ── Check for duplicate email ──────────────────────────────────────────────
  try {
    if (await checkEmailExists(email)) {
      return respond(409, { error: 'A user with this email already exists' });
    }
  } catch (err) {
    console.error('adminCreateUser: email check failed', { error: err.message });
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
    console.error('adminCreateUser: Cognito create failed', { error: err.message });
    if (err.name === 'UsernameExistsException') {
      return respond(409, { error: 'A Cognito user with this email already exists' });
    }
    return respond(500, { error: 'Failed to create Cognito user' });
  }

  const userId = cognitoUser.Attributes?.find((a) => a.Name === 'sub')?.Value
              || cognitoUser.Username;

  // ── Add to Cognito groups ──────────────────────────────────────────────────
  const groupErrors = [];
  for (const role of roles) {
    const groupName = ROLE_TO_GROUP[role];
    try {
      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: POOL_ID,
        Username:   email.toLowerCase(),
        GroupName:  groupName,
      }));
    } catch (err) {
      console.error('adminCreateUser: failed to add group', { groupName, error: err.message });
      groupErrors.push(groupName);
    }
  }

  // ── Write to talent-flow-users table ──────────────────────────────────────
  const now         = new Date().toISOString();
  const normalEmail = email.toLowerCase();
  const activeRole  = ROLE_PRECEDENCE.find((r) => roles.includes(r)) || roles[0];

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
    console.error('adminCreateUser: DynamoDB write failed', { userId, error: err.message });
    return respond(500, { error: 'User created in Cognito but registry write failed', userId });
  }

  console.info('adminCreateUser: user created', { userId, email: normalEmail, roles });

  return respond(201, {
    user: userRecord,
    warnings: groupErrors.length ? `Failed to add to groups: ${groupErrors.join(', ')}` : undefined,
  });
};
