'use strict';

/**
 * lambda/getCandidateEvents/index.js
 *
 * FE-006 — Full event timeline for a candidate
 *
 * Route: GET /v1/candidates/{id}/events
 *
 * Query params:
 *   limit     — max events to return (default 100, max 200)
 *   nextToken — base64-encoded pagination token (LastEvaluatedKey from previous page)
 *   since     — ISO-8601 timestamp; only return events at or after this time
 *
 * Auth: Cognito JWT (validated by talentFlowAuthorizer Lambda on the TF API Gateway)
 *
 * Response:
 * {
 *   events: [{
 *     eventId, eventType, source, candidateId, tenantId,
 *     actor, timestamp, detail (parsed object)
 *   }],
 *   nextToken?: string,
 *   total: number  ← count of events returned (not total in table)
 * }
 *
 * Env vars:
 *   EVENTS_TABLE_NAME — talent-flow-events
 */

const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamo = new DynamoDBClient({});
const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || 'talent-flow-events';

function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  const candidateId = event.pathParameters?.id;
  if (!candidateId) {
    return respond(400, { message: 'Missing candidateId path parameter' });
  }

  const qs     = event.queryStringParameters || {};
  const limit  = Math.min(parseInt(qs.limit || '100', 10), 200);
  const since  = qs.since ?? null;

  // Decode pagination cursor
  let exclusiveStartKey;
  if (qs.nextToken) {
    try {
      exclusiveStartKey = JSON.parse(Buffer.from(qs.nextToken, 'base64').toString('utf-8'));
    } catch {
      return respond(400, { message: 'Invalid nextToken' });
    }
  }

  const PK = `CANDIDATE#${candidateId}`;

  // Build key condition — optionally add SK >= since filter
  let keyCondition = 'PK = :pk';
  const exprValues = { ':pk': { S: PK } };

  if (since) {
    // SK format: EVENT#<timestamp>#<eventId> — prefix filter gives chronological range
    keyCondition += ' AND SK >= :skFrom';
    exprValues[':skFrom'] = { S: `EVENT#${since}` };
  }

  try {
    const params = {
      TableName:                 EVENTS_TABLE,
      KeyConditionExpression:    keyCondition,
      ExpressionAttributeValues: exprValues,
      Limit:                     limit,
      ScanIndexForward:          true,  // ascending = oldest first
      ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
    };

    const result = await dynamo.send(new QueryCommand(params));

    const events = (result.Items ?? []).map((item) => {
      const rec = unmarshall(item);
      // Parse detail back from JSON string to object for frontend convenience
      let detail = rec.detail;
      if (typeof detail === 'string') {
        try { detail = JSON.parse(detail); } catch { /* keep as string */ }
      }
      return {
        eventId:     rec.eventId,
        eventType:   rec.eventType,
        source:      rec.source,
        candidateId: rec.candidateId,
        tenantId:    rec.tenantId,
        actor:       rec.actor ?? 'SYSTEM',
        timestamp:   rec.timestamp,
        detail,
      };
    });

    // Encode next page cursor
    let nextToken;
    if (result.LastEvaluatedKey) {
      nextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
    }

    console.log(JSON.stringify({
      event: 'get_candidate_events',
      candidateId,
      returned: events.length,
      hasMore: !!nextToken,
    }));

    return respond(200, {
      events,
      total: events.length,
      ...(nextToken ? { nextToken } : {}),
    });
  } catch (err) {
    console.error(JSON.stringify({ event: 'get_candidate_events_error', candidateId, error: err.message }));
    return respond(500, { message: 'Failed to retrieve candidate events' });
  }
};
