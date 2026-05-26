'use strict';

/**
 * lambda/completeItTask/index.js
 *
 * Trigger: HTTP API v2 — POST /v1/it/tasks/{taskId}/complete
 * Auth:    JWT (Naleko Cognito pool)
 *
 * Marks a CLAIMED task as COMPLETED and records fulfilment details.
 * Condition: task must be claimed by the requesting specialist (or ITAdmin).
 *
 * Body: { assetReference: string, fulfilmentMethod: string, notes?: string }
 *
 * Env vars:
 *   IT_TASKS_TABLE — it-tasks DynamoDB table name
 */

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
  const claims       = extractClaims(event);
  const groups       = parseGroups(claims['cognito:groups']);
  const isITUser     = groups.some(g => ['ITAdmin', 'ITSpecialist'].includes(g));
  const isAdminGroup = groups.includes('ITAdmin') || claims['custom:isAdmin'] === 'true';

  if (!isITUser) {
    return respond(403, { message: 'Forbidden: IT group required.' });
  }

  const taskId       = event.pathParameters?.taskId;
  const specialistId = claims['sub'] ?? '';
  const givenName    = claims['given_name'] ?? '';
  const familyName   = claims['family_name'] ?? '';
  const fullName     = `${givenName} ${familyName}`.trim() || (claims['email'] ?? 'Unknown');
  const now          = new Date().toISOString();

  let body = {};
  try { body = JSON.parse(event.body ?? '{}'); } catch { /* ignore */ }

  const { assetReference, fulfilmentMethod, notes } = body;

  if (!taskId || !specialistId) {
    return respond(400, { message: 'taskId and valid JWT sub required.' });
  }
  if (!assetReference || !fulfilmentMethod) {
    return respond(400, { message: 'assetReference and fulfilmentMethod are required in the request body.' });
  }

  try {
    const getRes = await client.send(new GetItemCommand({
      TableName: TABLE,
      Key:       marshall({ taskId }),
    }));

    if (!getRes.Item) {
      return respond(404, { message: `Task ${taskId} not found.` });
    }

    const task = unmarshall(getRes.Item);

    if (task.taskStatus === 'COMPLETED') {
      return respond(409, { message: 'Task is already completed.' });
    }

    if (task.taskStatus !== 'CLAIMED') {
      return respond(409, { message: 'Task must be claimed before it can be completed.' });
    }

    if (task.claimedBy !== specialistId && !isAdminGroup) {
      return respond(403, { message: 'You did not claim this task.' });
    }

    const activityEvent = {
      type:      'complete',
      text:      `Marked complete by ${fullName}`,
      timestamp: now,
      subtext:   `Asset: ${assetReference} · ${fulfilmentMethod}`,
    };

    const fulfilment = {
      assetReference,
      fulfilmentMethod,
      notes:         notes ?? '',
      completedBy:   specialistId,
      completedByName: fullName,
      completedAt:   now,
    };

    await client.send(new UpdateItemCommand({
      TableName: TABLE,
      Key:       marshall({ taskId }),
      UpdateExpression: [
        'SET taskStatus  = :completed',
        '    slaProgress = :100',
        '    updatedAt   = :ts',
        '    completedAt = :ts',
        '    fulfilment  = :f',
        '    #act        = list_append(if_not_exists(#act, :emptyList), :entry)',
      ].join(', '),
      ExpressionAttributeNames:  { '#act': 'activity' },
      ExpressionAttributeValues: marshall({
        ':completed': 'COMPLETED',
        ':100':        100,
        ':ts':         now,
        ':f':          fulfilment,
        ':emptyList':  [],
        ':entry':      [activityEvent],
      }),
    }));

    return respond(200, { message: 'Task completed.', taskId, fulfilment });

  } catch (err) {
    console.error('completeItTask error', err);
    return respond(500, { message: 'Internal server error.' });
  }
};
