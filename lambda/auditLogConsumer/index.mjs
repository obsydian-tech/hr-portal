/**
 * NH-27: auditLogConsumer
 *
 * EventBridge consumer — writes every event from the naleko-onboarding bus
 * into the `onboarding-events` DynamoDB table as an immutable audit record.
 *
 * Triggered by: EventBridge rule matching source prefix "naleko."
 * NOT triggered via API Gateway — event shape is EventBridge event envelope.
 *
 * Immutability guarantee: this Lambda's IAM role has ONLY dynamodb:PutItem
 * (no UpdateItem, no DeleteItem). Items are append-only forever.
 *
 * Item schema:
 *   eventId    (S)  PK  — UUID v4
 *   timestamp  (S)  SK  — ISO-8601 UTC from EventBridge event time
 *   source     (S)      — e.g. "naleko.employees"
 *   detailType (S)      — e.g. "employee.invited"
 *   detail     (S)      — raw JSON string of event detail
 *   employeeId (S)      — extracted from detail.employee_id if present (for GSI)
 *   busName    (S)      — EventBridge bus name
 *   region     (S)      — AWS region
 *   ttl       omitted  — no TTL; records live forever for POPIA compliance
 */

import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { randomUUID } from 'crypto';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const dynamodb = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'af-south-1' });
const logger = new Logger({ serviceName: 'auditLogConsumer' });
const tracer = new Tracer({ serviceName: 'auditLogConsumer' });

const TABLE_NAME = process.env.AUDIT_TABLE_NAME ?? 'onboarding-events';

/**
 * Safely extract a string field from parsed event detail.
 * Returns empty string if not present.
 */
function extractString(detail, ...keys) {
  for (const key of keys) {
    if (detail && typeof detail[key] === 'string' && detail[key]) {
      return detail[key];
    }
  }
  return '';
}

export const handler = async (event) => {
  tracer.putAnnotation('operation', 'auditLogConsumer');
  logger.info('EventBridge event received', {
    source: event.source,
    detailType: event['detail-type'],
    eventId: event.id,
  });

  // EventBridge can send batches — handle both single events and Records arrays
  // In practice EventBridge sends one event per Lambda invocation, but be defensive
  const events = Array.isArray(event.Records) ? event.Records : [event];

  const results = await Promise.allSettled(
    events.map(async (ev) => {
      const eventId = ev.id ?? randomUUID();
      const timestamp = ev.time ?? new Date().toISOString();
      const source = ev.source ?? 'unknown';
      const detailType = ev['detail-type'] ?? 'unknown';
      const detailRaw = typeof ev.detail === 'string'
        ? ev.detail
        : JSON.stringify(ev.detail ?? {});

      // Extract employeeId for the GSI — try common field names across all event types
      let parsedDetail = {};
      try { parsedDetail = JSON.parse(detailRaw); } catch { /* ignore */ }
      const employeeId = extractString(
        parsedDetail,
        'employee_id', 'employeeId', 'employee', 'id',
      );

      // NH-45: actor tagging — 'AGENT' (agent API key calls) vs 'HUMAN' (Cognito/HR portal calls).
      // Publishing Lambdas include actor in the EventBridge detail payload; default to 'HUMAN'
      // for legacy events that pre-date actor tagging.
      const actor = extractString(parsedDetail, 'actor') || 'HUMAN';

      const item = {
        eventId:    { S: eventId },
        timestamp:  { S: timestamp },
        source:     { S: source },
        detailType: { S: detailType },
        detail:     { S: detailRaw },
        busName:    { S: ev['event-bus-name'] ?? process.env.EVENT_BUS_NAME ?? 'naleko-onboarding' },
        region:     { S: ev.region ?? process.env.AWS_REGION ?? 'af-south-1' },
        actor:      { S: actor },
        // Only write employeeId if we found one (avoids empty-string GSI entries)
        ...(employeeId ? { employeeId: { S: employeeId } } : {}),
      };

      // ConditionExpression prevents overwriting an existing record (extra safety belt)
      await dynamodb.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(eventId)',
      }));

      logger.info('Audit record written', { eventId, source, detailType, actor, employeeId: employeeId || '(none)' });
      return { eventId, source, detailType };
    })
  );

  const failed = results.filter(r => r.status === 'rejected');
  if (failed.length > 0) {
    failed.forEach(r => logger.error('Failed to write audit record', { reason: r.reason?.message }));
    // Re-throw so EventBridge retries (up to 185 retry attempts by default)
    throw new Error(`${failed.length} audit record(s) failed to write`);
  }

  logger.info('All audit records written', { count: results.length });
  return { written: results.length };
};
