'use strict';

/**
 * lambda/talentFlowAuditStream/index.js
 *
 * EventBridge audit stream consumer — FE-006 / TALENT-FLOW backend
 *
 * Triggered by: EventBridge rule on talent-flow-bus matching ALL talent-flow.* events
 *
 * Writes every domain event into talent-flow-events DynamoDB table keyed by
 * candidateId so the frontend can render a full event timeline per candidate.
 *
 * Item schema (talent-flow-events):
 *   PK          (S)  — CANDIDATE#<candidateId>
 *   SK          (S)  — EVENT#<timestamp>#<eventId>  (ISO + EB id for uniqueness)
 *   eventId     (S)  — EventBridge event .id
 *   eventType   (S)  — EventBridge detail-type  (e.g. CandidateCreated)
 *   source      (S)  — EventBridge .source       (e.g. talent-flow.candidates)
 *   tenantId    (S)  — extracted from detail.tenantId
 *   candidateId (S)  — extracted from detail.candidateId
 *   detail      (S)  — raw JSON string of event detail
 *   timestamp   (S)  — ISO-8601 timestamp from EventBridge .time
 *   actor       (S)  — detail.actor or 'SYSTEM'
 *   ttl         (N)  — epoch seconds; 2 years from event time (POPIA: audit trail)
 *
 * Idempotent: PK+SK are deterministic from EB event id — a replay of the same
 * event will overwrite with identical data (benign).
 *
 * Env vars:
 *   EVENTS_TABLE_NAME  — talent-flow-events
 */

const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const dynamo = new DynamoDBClient({});
const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || 'talent-flow-events';

// TTL: 2 years from event time (104 weeks × 7 days × 86400 sec)
const TWO_YEARS_SECONDS = 104 * 7 * 86400;

/**
 * Build SK: EVENT#<timestamp>#<eventId>
 * Pad timestamp so lexicographic order == chronological order.
 */
function buildSK(timestamp, eventId) {
  return `EVENT#${timestamp}#${eventId}`;
}

exports.handler = async (event) => {
  // EventBridge delivers one event per Lambda invocation for rules with Lambda targets.
  // Handle both single-event and (defensive) batched shapes.
  const events = Array.isArray(event.Records) ? event.Records : [event];

  for (const ev of events) {
    const eventId    = ev.id      ?? `unknown-${Date.now()}`;
    const timestamp  = ev.time    ?? new Date().toISOString();
    const source     = ev.source  ?? 'talent-flow.unknown';
    const eventType  = ev['detail-type'] ?? 'Unknown';
    const detail     = ev.detail  ?? {};

    // Extract candidateId from event detail — all TalentFlow events include it
    const candidateId = detail.candidateId ?? detail.candidate_id ?? null;
    const tenantId    = detail.tenantId    ?? detail.tenant_id    ?? 'UNKNOWN';
    const actor       = detail.actor       ?? 'SYSTEM';

    if (!candidateId) {
      // Some system events (e.g. bus health checks) may not have a candidateId.
      // Log and skip rather than throwing — we don't want to block the rule.
      console.warn(JSON.stringify({
        event: 'audit_stream_skip',
        reason: 'no_candidateId',
        eventType,
        source,
        eventId,
      }));
      continue;
    }

    const PK = `CANDIDATE#${candidateId}`;
    const SK = buildSK(timestamp, eventId);
    const ttl = Math.floor(new Date(timestamp).getTime() / 1000) + TWO_YEARS_SECONDS;

    // GSI1: tenant-scoped timeline — GSI1PK = TENANT#<tenantId>, GSI1SK = ISO timestamp
    // Matches talent-flow-state pattern (same table family convention)
    const GSI1PK = `TENANT#${tenantId}`;
    const GSI1SK = timestamp;

    try {
      await dynamo.send(new PutItemCommand({
        TableName: EVENTS_TABLE,
        Item: marshall({
          PK,
          SK,
          GSI1PK,
          GSI1SK,
          eventId,
          eventType,
          source,
          tenantId,
          candidateId,
          detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
          timestamp,
          actor,
          ttl,
        }),
      }));

      console.log(JSON.stringify({
        event: 'audit_stream_write',
        candidateId,
        tenantId,
        eventType,
        eventId,
        SK,
      }));
    } catch (err) {
      // Log but don't throw — partial failure here should not block other events
      console.error(JSON.stringify({
        event: 'audit_stream_error',
        candidateId,
        eventId,
        error: err.message,
        code: err.name,
      }));
    }
  }
};
