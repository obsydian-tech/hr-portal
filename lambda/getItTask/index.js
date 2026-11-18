'use strict';

/**
 * lambda/getItTask/index.js
 *
 * Trigger: HTTP API v2 — GET /v1/it/tasks/{taskId}
 * Auth:    JWT (Naleko Cognito pool)
 *
 * Returns a single IT task by taskId.
 * 404 if not found.
 *
 * Env vars:
 *   IT_TASKS_TABLE — it-tasks DynamoDB table name
 */

const { isIdToken } = require('../shared/id-token');
const { tenantHelper } = require('../shared/tf-tenant.js');
const { rolesHelper } = require('../shared/tf-roles.js');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const client = new DynamoDBClient({});
const TABLE  = process.env.IT_TASKS_TABLE;

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

function extractClaims(event) {
  return event?.requestContext?.authorizer?.jwt?.claims ?? {};
}

function parseGroups(rawGroups) {
  if (!rawGroups) return [];
  if (Array.isArray(rawGroups)) return rawGroups;
  const s = String(rawGroups);
  if (s.startsWith('[')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1).split(/[\s,]+/).filter(Boolean); }
  }
  return s.split(',').map(g => g.trim()).filter(Boolean);
}

exports.handler = async (event) => {
  if (!isIdToken(event?.requestContext?.authorizer?.jwt?.claims ?? {})) return respond(403, {"message": "Forbidden: IT Admin or IT Specialist group required."});
  const claims   = extractClaims(event);
  const R = await rolesHelper();
  const denied = R.requireRole(event, { roles: ['admin'], perms: ['perm-it'] });
  if (denied) return denied;

  // TEN-03: after the group check, the company check. The company is the sign-in's; tenantId in the query or body is not read.
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;

  const taskId = event.pathParameters?.taskId;
  if (!taskId) {
    return respond(400, { message: 'taskId path parameter is required.' });
  }

  try {
    const res = await client.send(new GetItemCommand({
      TableName: TABLE,
      Key:       marshall({ taskId }),
    }));

    if (!res.Item || !T.ownsRow(unmarshall(res.Item), tenantId)) {
      return T.notFound();
    }

    const task = unmarshall(res.Item);
    // Normalize: DynamoDB PK is `taskId`; Angular model expects `id`
    if (!task.id) task.id = task.taskId;
    return respond(200, task);

  } catch (err) {
    console.error('getItTask error', err);
    return respond(500, { message: 'Internal server error.' });
  }
};
