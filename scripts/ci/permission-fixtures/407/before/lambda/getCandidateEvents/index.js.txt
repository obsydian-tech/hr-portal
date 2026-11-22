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
 *     eventId, eventType, source, candidateId, tenant_id,
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
const { tenantHelper, candidateIsOurs } = require('../shared/tf-tenant.js');

const dynamo = new DynamoDBClient({});
const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || 'talent-flow-events';
const STATE_TABLE  = process.env.STATE_TABLE_NAME  || 'talent-flow-state';

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
  // REC-01: who may read one candidate's history is judged after the company and module checks. Anyone who may not gets
  // 404, as for a candidate that does not exist.
  const RA = await import('../shared/recruitment-access.mjs');
  // TEN-03: the company is the sign-in's. The candidate must be this company's; another company's is 404.
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;

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

  // The candidate's own row says whose it is. This role may not read the state table yet (listed for Iggie in the
  // PR): until it can, the answer is limited to event rows that carry this company, so nothing foreign leaks.
  let stateReadable = true;
  try {
    if (!(await candidateIsOurs((c) => dynamo.send(c), QueryCommand, STATE_TABLE, candidateId, tenantId))) {
      return T.notFound();
    }
  } catch (err) {
    if (err && (err.name === 'AccessDeniedException' || err.name === 'AccessDenied')) stateReadable = false;
    else {
      console.error(JSON.stringify({ event: 'get_candidate_events_error', error: err.message }));
      return respond(500, { message: 'Failed to retrieve candidate events' });
    }
  }

  // REC-01: a Recruiter reads the history of any candidate of the company. The hiring manager of the candidate (salary
  // removed) and a panel member of one of its interviews (no offer, no salary) need the candidate's own rows to prove it.
  // Where this role cannot read the state table, that is not proven, so they get 404 (fail closed) until it can.
  let relation = RA.isRecruiter(event) ? 'recruiter' : null;
  if (!relation) {
    if (!stateReadable) {
      console.warn(JSON.stringify({ event: 'get_candidate_events_access_not_proven', candidateId }));
      return T.notFound();
    }
    try {
      const saga = await dynamo.send(new QueryCommand({
        TableName: STATE_TABLE,
        KeyConditionExpression: 'PK = :pk AND SK = :sk',
        ExpressionAttributeValues: { ':pk': { S: `CANDIDATE#${candidateId}` }, ':sk': { S: 'SAGA' } },
        Limit: 1,
      }));
      const candidate = saga.Items && saga.Items[0] ? unmarshall(saga.Items[0]) : null;
      if (!candidate || !T.ownsRow(candidate, tenantId)) return T.notFound();
      relation = await RA.relationOf(event, candidate, async () => {
        const res = await dynamo.send(new QueryCommand({
          TableName: STATE_TABLE,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: { ':pk': { S: `CANDIDATE#${candidateId}` }, ':prefix': { S: 'INTERVIEW#' } },
          ProjectionExpression: 'interviewId, panelMemberIds, tenant_id',
        }));
        return (res.Items || []).map((i) => unmarshall(i)).filter((i) => T.ownsRow(i, tenantId));
      });
    } catch (err) {
      console.warn(JSON.stringify({ event: 'get_candidate_events_access_not_proven', candidateId, error: err.name }));
      return T.notFound();
    }
    if (!relation) return T.notFound();
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

    let events = (result.Items ?? []).map((item) => unmarshall(item)).filter((rec) => (stateReadable ? T.ownsRow(rec, tenantId) || rec.tenant_id === undefined : T.ownsRow(rec, tenantId))).map((rec) => {
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
        tenant_id:   rec.tenant_id,
        actor:       rec.actor ?? 'SYSTEM',
        timestamp:   rec.timestamp,
        detail,
      };
    });
    // REC-01: the hiring manager's history has no salary; a panel member's has no offer event and no offer or salary field.
    if (relation === 'hiringManager') events = RA.forHiringManager(events);
    if (relation === 'panel') events = RA.forPanelMember(events.filter((e) => !RA.aboutOffer(e)));

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
