'use strict';

/**
 * lambda/adminGetUsers/index.js — Admin-S1
 *
 * Returns a paginated list of users from the talent-flow-users table.
 * Fast DDB query — no Cognito ListUsersInGroup N+1 calls.
 *
 * Query params (all optional):
 *   status  — 'ACTIVE' | 'INACTIVE' (default: returns all)
 *   search  — contains() match on email, givenName, familyName
 *   limit   — default 50, max 100
 *   nextToken — exclusive start key (base64 JSON)
 *
 * Access: ADMIN role only.
 */

const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamo      = new DynamoDBClient({});
const USERS_TABLE = process.env.USERS_TABLE_NAME || 'talent-flow-users';

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

exports.handler = async (event) => {
  const claims = extractClaims(event);
  if (!hasAdminRole(claims)) {
    return respond(403, { error: 'Admin role required' });
  }

  const qs        = event.queryStringParameters || {};
  const limit     = Math.min(parseInt(qs.limit || '50', 10), 100);
  const { status, search, nextToken } = qs;

  const filterParts  = ['SK = :profile'];
  const exprValues   = { ':profile': { S: 'PROFILE' } };
  const exprNames    = {};

  if (status) {
    filterParts.push('#s = :status');
    exprNames['#s']      = 'status';
    exprValues[':status'] = { S: status };
  }

  if (search) {
    filterParts.push(
      '(contains(email, :q) OR contains(givenName, :q) OR contains(familyName, :q))',
    );
    exprValues[':q'] = { S: search };
  }

  const params = {
    TableName:        USERS_TABLE,
    FilterExpression: filterParts.join(' AND '),
    ExpressionAttributeValues: exprValues,
    Limit: limit,
  };
  if (Object.keys(exprNames).length) {
    params.ExpressionAttributeNames = exprNames;
  }
  if (nextToken) {
    try {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString('utf8'));
    } catch {
      return respond(400, { error: 'Invalid nextToken' });
    }
  }

  try {
    const result = await dynamo.send(new ScanCommand(params));
    const users  = (result.Items || []).map(unmarshall);

    const response = { users, total: users.length };
    if (result.LastEvaluatedKey) {
      response.nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    console.info('adminGetUsers', { count: users.length, status: status || 'all' });
    return respond(200, response);
  } catch (err) {
    console.error('adminGetUsers error', { error: err.message });
    return respond(500, { error: 'Failed to retrieve users' });
  }
};
