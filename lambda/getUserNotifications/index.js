'use strict';

/**
 * getUserNotifications Lambda
 * NH-123 — BE-007a
 *
 * Trigger: GET /v1/notifications (HTTP API v2, Cognito JWT authorizer)
 *
 * Query params:
 *   ?unreadOnly=true  — queries GSI1 UnreadIndex (sparse: only unread items)
 *   ?limit=<n>        — max items to return (default 50, max 100)
 *
 * Response: { notifications: [...], count: n }
 */

const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE_NAME;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

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

  const qs = event.queryStringParameters || {};
  const unreadOnly = qs.unreadOnly === 'true';
  const limit = Math.min(parseInt(qs.limit, 10) || DEFAULT_LIMIT, MAX_LIMIT);

  try {
    let result;
    if (unreadOnly) {
      result = await dynamo.send(new QueryCommand({
        TableName:              NOTIFICATIONS_TABLE,
        IndexName:              'UnreadIndex',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': { S: `USER#${userId}#UNREAD` } },
        ScanIndexForward:       false,
        Limit:                  limit,
      }));
    } else {
      result = await dynamo.send(new QueryCommand({
        TableName:              NOTIFICATIONS_TABLE,
        KeyConditionExpression: 'PK = :pk',
        ExpressionAttributeValues: { ':pk': { S: `USER#${userId}` } },
        ScanIndexForward:       false,
        Limit:                  limit,
      }));
    }

    const notifications = (result.Items || []).map((i) => unmarshall(i));
    return response(200, { notifications, count: notifications.length });
  } catch (err) {
    console.error('DynamoDB query failed', { userId, unreadOnly, error: err.message });
    return response(500, { error: 'Failed to load notifications' });
  }
};
