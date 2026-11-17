'use strict';

/**
 * lambda/releaseItTask/index.js
 *
 * Trigger: HTTP API v2 — POST /v1/it/tasks/{taskId}/release
 * Auth:    JWT (Naleko Cognito pool)
 *
 * Releases a CLAIMED task back to UNASSIGNED.
 * Condition: task must be claimed by the requesting specialist (or ITAdmin).
 *
 * Body: { reason: string }
 *
 * Env vars:
 *   IT_TASKS_TABLE — it-tasks DynamoDB table name
 */

const { isIdToken } = require('../shared/id-token');
const { tenantHelper, scopeWrite } = require('../shared/tf-tenant.js');
const { rolesHelper } = require('../shared/tf-roles.js');
const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');
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
  if (!isIdToken(event?.requestContext?.authorizer?.jwt?.claims ?? {})) return respond(403, {"message": "Forbidden: IT group required."});
  const claims       = extractClaims(event);
  const R = await rolesHelper();
  const denied = R.requireRole(event, { perms: ['perm-it'] });
  if (denied) return denied;
  const isAdminGroup = R.isItLead(event);

  // TEN-03: after the group check, the company check. The company is the sign-in's; tenantId in the query or body is not read.
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;

  const taskId       = event.pathParameters?.taskId;
  const specialistId = claims['sub'] ?? '';
  const now          = new Date().toISOString();

  let body = {};
  try { body = JSON.parse(event.body ?? '{}'); } catch { /* ignore */ }
  const reason = (body.reason ?? '').trim() || 'No reason provided.';

  if (!taskId || !specialistId) {
    return respond(400, { message: 'taskId path param and valid JWT sub required.' });
  }

  try {
    const getRes = await client.send(new GetItemCommand({
      TableName: TABLE,
      Key:       marshall({ taskId }),
    }));

    if (!getRes.Item || !T.ownsRow(unmarshall(getRes.Item), tenantId)) {
      return T.notFound();
    }

    const task = unmarshall(getRes.Item);

    if (task.taskStatus !== 'CLAIMED') {
      return respond(409, { message: 'Task is not in CLAIMED state.' });
    }

    // Only the claiming specialist or an ITAdmin can release
    if (task.claimedBy !== specialistId && !isAdminGroup) {
      return respond(403, { message: 'You did not claim this task.' });
    }

    const activityEvent = {
      type:      'release',
      text:      'Released back to queue',
      timestamp: now,
      subtext:   reason,
    };

    await client.send(new UpdateItemCommand(scopeWrite({
      TableName: TABLE,
      Key:       marshall({ taskId }),
      UpdateExpression: [
        'SET taskStatus    = :unassigned',
        '    claimedBy     = :null',
        '    claimedByName = :null',
        '    claimedByRole = :null',
        '    claimedAt     = :null',
        '    updatedAt     = :ts',
        '    #act          = list_append(if_not_exists(#act, :emptyList), :entry)',
      ].join(', '),
      ExpressionAttributeNames:  { '#act': 'activity' },
      ExpressionAttributeValues: marshall({
        ':unassigned': 'UNASSIGNED',
        ':null':       null,
        ':ts':         now,
        ':emptyList':  [],
        ':entry':      [activityEvent],
      }),
    }, tenantId)));

    return respond(200, { message: 'Task released.', taskId });

  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return T.notFound();
    console.error('releaseItTask error', err);
    return respond(500, { message: 'Internal server error.' });
  }
};
