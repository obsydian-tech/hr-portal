'use strict';

/**
 * lambda/claimItTask/index.js
 *
 * Trigger: HTTP API v2 — POST /v1/it/tasks/{taskId}/claim
 * Auth:    JWT (Naleko Cognito pool)
 *
 * Atomically claims an UNASSIGNED task. Uses a DynamoDB ConditionExpression
 * to prevent two specialists from claiming the same task concurrently.
 *
 * On success: taskStatus → CLAIMED, claimedBy/claimedByName/claimedAt set.
 * On 409: task was already claimed by another specialist.
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
  const claims            = extractClaims(event);
  const groups            = parseGroups(claims['cognito:groups']);
  const isITUser          = groups.some(g => ['ITAdmin', 'ITSpecialist'].includes(g));
  const isAdmin           = claims['custom:isAdmin'] === 'true' || groups.includes('TalentFlowAdmin');

  if (!isITUser && !isAdmin) {
    return respond(403, { message: 'Forbidden: IT Admin or IT Specialist group required.' });
  }

  const taskId       = event.pathParameters?.taskId;
  const specialistId = claims['sub'] ?? '';
  const email        = claims['email'] ?? '';
  const givenName    = claims['given_name'] ?? '';
  const familyName   = claims['family_name'] ?? '';
  const fullName     = `${givenName} ${familyName}`.trim() || email;
  const now          = new Date().toISOString();

  if (!taskId) {
    return respond(400, { message: 'taskId path parameter is required.' });
  }

  if (!specialistId) {
    return respond(400, { message: 'Could not derive specialistId from JWT sub claim.' });
  }

  try {
    // First confirm the task exists
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

    // Atomic claim: condition = taskStatus = UNASSIGNED or already claimed by me
    const activityEvent = {
      type:      'claim',
      text:      `Claimed by ${fullName}`,
      timestamp: now,
      subtext:   `${task.queue} queue`,
    };

    await client.send(new UpdateItemCommand({
      TableName: TABLE,
      Key:       marshall({ taskId }),
      UpdateExpression: [
        'SET taskStatus    = :claimed',
        '    claimedBy     = :sub',
        '    claimedByName = :name',
        '    claimedByRole = :role',
        '    claimedAt     = :ts',
        '    updatedAt     = :ts',
        '    #act          = list_append(if_not_exists(#act, :emptyList), :entry)',
      ].join(', '),
      // Only claim if UNASSIGNED (prevent race condition)
      ConditionExpression:       'taskStatus = :unassigned',
      ExpressionAttributeNames:  { '#act': 'activity' },
      ExpressionAttributeValues: marshall({
        ':claimed':    'CLAIMED',
        ':unassigned': 'UNASSIGNED',
        ':sub':        specialistId,
        ':name':       fullName,
        ':role':       groups.includes('ITAdmin') ? 'IT Admin' : 'IT Specialist',
        ':ts':         now,
        ':emptyList':  [],
        ':entry':      [activityEvent],
      }),
    }));

    return respond(200, { message: 'Task claimed successfully.', taskId });

  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return respond(409, { message: 'Task has already been claimed by another specialist.' });
    }
    console.error('claimItTask error', err);
    return respond(500, { message: 'Internal server error.' });
  }
};
