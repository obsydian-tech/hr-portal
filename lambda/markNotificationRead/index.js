'use strict';

/**
 * markNotificationRead Lambda
 * NH-123 — BE-007b
 *
 * Trigger: PATCH /v1/notifications/{id}/read (HTTP API v2, Cognito JWT authorizer)
 *
 * Path param: {id} — the SK value URL-encoded, e.g. NOTIF%232026-05-21T10%3A00%3A00.000Z
 * userId from JWT sub → PK = USER#{userId}
 *
 * Sets read=true and removes GSI1PK/GSI1SK, evicting the item from UnreadIndex.
 * Condition: PK must match the caller — prevents one user marking another's notifications.
 */

const { DynamoDBClient, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');

const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE_NAME;

const dynamo = new DynamoDBClient({});

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const userId = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!userId) return response(401, { error: 'Unauthorized' });

  const notifSk = event.pathParameters?.id;
  if (!notifSk) return response(400, { error: 'Missing notification id' });

  const pk = `USER#${userId}`;
  const sk = decodeURIComponent(notifSk);

  try {
    await dynamo.send(new UpdateItemCommand({
      TableName:                 NOTIFICATIONS_TABLE,
      Key:                       { PK: { S: pk }, SK: { S: sk } },
      ConditionExpression:       'PK = :pk',
      UpdateExpression:          'SET #rd = :true REMOVE GSI1PK, GSI1SK',
      ExpressionAttributeNames:  { '#rd': 'read' },
      ExpressionAttributeValues: { ':pk': { S: pk }, ':true': { BOOL: true } },
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return response(404, { error: 'Notification not found' });
    }
    console.error('DynamoDB update failed', { userId, sk, error: err.message });
    return response(500, { error: 'Failed to mark notification as read' });
  }

  return response(200, { success: true });
};
