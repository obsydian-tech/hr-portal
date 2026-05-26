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
  const claims   = extractClaims(event);
  const groups   = parseGroups(claims['cognito:groups']);
  const isITUser = groups.some(g => ['ITAdmin', 'ITSpecialist'].includes(g));
  const isAdmin  = claims['custom:isAdmin'] === 'true' || groups.includes('TalentFlowAdmin');

  if (!isITUser && !isAdmin) {
    return respond(403, { message: 'Forbidden: IT Admin or IT Specialist group required.' });
  }

  const taskId = event.pathParameters?.taskId;
  if (!taskId) {
    return respond(400, { message: 'taskId path parameter is required.' });
  }

  try {
    const res = await client.send(new GetItemCommand({
      TableName: TABLE,
      Key:       marshall({ taskId }),
    }));

    if (!res.Item) {
      return respond(404, { message: `Task ${taskId} not found.` });
    }

    return respond(200, unmarshall(res.Item));

  } catch (err) {
    console.error('getItTask error', err);
    return respond(500, { message: 'Internal server error.' });
  }
};
