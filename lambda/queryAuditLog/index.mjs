/**
 * NH-43: queryAuditLog — GET /agent/v1/audit-log
 *
 * Queries the onboarding-events DynamoDB table.
 * Supports filtering by employeeId (uses GSI) with optional ISO 8601 date range.
 *
 * Query parameters:
 *   employeeId  — filter to a specific employee (uses employeeId-timestamp-index GSI)
 *   startDate   — ISO 8601 lower bound on timestamp (inclusive)
 *   endDate     — ISO 8601 upper bound on timestamp (inclusive)
 *   limit       — max records to return (default 50, max 200)
 *
 * Without employeeId: returns a table scan limited to `limit` records.
 * Without date range: returns all events for the employee newest-first.
 *
 * GSI: employeeId-timestamp-index (hash=employeeId, range=timestamp)
 */

import { DynamoDBClient, QueryCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const dynamodb = new DynamoDBClient();
const logger = new Logger({ serviceName: 'queryAuditLog' });
const tracer = new Tracer({ serviceName: 'queryAuditLog' });

const AUDIT_TABLE = process.env.AUDIT_TABLE ?? 'onboarding-events';
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

function marshalEvent(item) {
  return {
    eventId:    item.eventId?.S,
    timestamp:  item.timestamp?.S,
    employeeId: item.employeeId?.S,
    eventType:  item.eventType?.S,
    actor:      item.actor?.S,
    detail:     item.detail?.S ? (() => { try { return JSON.parse(item.detail.S); } catch { return item.detail.S; } })() : undefined,
  };
}

export const handler = async (event) => {
  const actor = event.requestContext?.authorizer?.lambda?.actor ?? 'HUMAN';
  const qs = event.queryStringParameters ?? {};

  const employeeId = qs.employeeId;
  const startDate  = qs.startDate;
  const endDate    = qs.endDate;
  const limit      = Math.min(parseInt(qs.limit ?? DEFAULT_LIMIT, 10), MAX_LIMIT);

  logger.info('queryAuditLog invoked', { employeeId, startDate, endDate, limit, actor });
  tracer.putAnnotation('actor', actor);

  try {
    let result;

    if (employeeId) {
      // Targeted query via GSI — efficient, supports date range
      const hasDateRange = startDate && endDate;

      const params = {
        TableName: AUDIT_TABLE,
        IndexName: 'employeeId-timestamp-index',
        ExpressionAttributeNames: { '#ts': 'timestamp' },
        ExpressionAttributeValues: { ':eid': { S: employeeId } },
        ScanIndexForward: false, // newest first
        Limit: limit,
      };

      if (hasDateRange) {
        params.KeyConditionExpression = 'employeeId = :eid AND #ts BETWEEN :start AND :end';
        params.ExpressionAttributeValues[':start'] = { S: startDate };
        params.ExpressionAttributeValues[':end']   = { S: endDate };
      } else {
        params.KeyConditionExpression = 'employeeId = :eid';
      }

      result = await dynamodb.send(new QueryCommand(params));
      tracer.putAnnotation('employeeId', employeeId);
    } else {
      // Full scan — only for admins/agents browsing the log without a target
      logger.warn('Full audit log scan requested — consider adding employeeId filter');
      result = await dynamodb.send(new ScanCommand({
        TableName: AUDIT_TABLE,
        Limit: Math.min(limit, DEFAULT_LIMIT), // cap full scans at 50
      }));
    }

    const events = (result.Items ?? []).map(marshalEvent);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        events,
        count: events.length,
        lastEvaluatedKey: result.LastEvaluatedKey ?? null,
      }),
    };
  } catch (error) {
    logger.error('Error querying audit log', { error: error.message });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
