'use strict';

/**
 * updateCandidate Lambda
 * PATCH /v1/candidates/{id}
 *
 * Partial update of a candidate SAGA record.
 *
 * Allowed fields (explicit allowlist — all others are silently ignored):
 *   firstName, lastName, phone, role, department, location,
 *   experienceYears, source, hiringManagerId, positionLevel (guarded)
 *
 * positionLevel guard: locked once the candidate reaches PANEL_INTERVIEW or later.
 * Changing level after evaluation scores have been submitted would invalidate
 * the approval chain and scoring weights — the field is immutable from that point.
 *
 * Permanently locked (never accepted in body):
 *   id, email, currentStage, workflowTemplateId, configVersion,
 *   appliedDate, createdAt, updatedAt, slaStatus, slaBreachedAt,
 *   interviewSentiment, engagementSentiment, acceptanceSentiment,
 *   engagementScore, currentInterviewId
 *
 * DynamoDB key: PK=CANDIDATE#{candidateId}, SK=SAGA
 */

const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const {
  EventBridgeClient,
  PutEventsCommand,
} = require('@aws-sdk/client-eventbridge');

const dynamo = new DynamoDBClient({});
const eb     = new EventBridgeClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME;
const EB_BUS      = process.env.EVENTBRIDGE_BUS_NAME;

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

// Fields a TA is allowed to change. Anything outside this list is ignored.
const EDITABLE_FIELDS = new Set([
  'firstName', 'lastName', 'phone', 'role',
  'department', 'location', 'experienceYears',
  'source', 'hiringManagerId', 'positionLevel',
]);

// positionLevel is locked once evaluation has started (scores were cast against it)
const EVALUATION_LOCK_STAGES = new Set([
  'PANEL_INTERVIEW', 'EVALUATION', 'BACKGROUND_CHECK',
  'OFFER_PREPARATION', 'OFFER_APPROVAL', 'OFFER_DELIVERY',
  'CONTRACT_SIGNING', 'PRE_BOARDING', 'ONBOARDING',
]);

exports.handler = async (event) => {
  const candidateId = event.pathParameters?.id;
  if (!candidateId) return respond(400, { error: 'Missing candidateId path parameter' });

  let body;
  try {
    body = event.body
      ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body)
      : {};
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  // Filter to allowlist only
  const patch = {};
  for (const [key, val] of Object.entries(body)) {
    if (EDITABLE_FIELDS.has(key) && val !== undefined) {
      patch[key] = val;
    }
  }

  if (Object.keys(patch).length === 0) {
    return respond(400, { error: 'No editable fields provided' });
  }

  // Fetch the existing SAGA to validate guards
  let saga;
  try {
    const res = await dynamo.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
    }));
    if (!res.Item) return respond(404, { error: `Candidate ${candidateId} not found` });
    saga = unmarshall(res.Item);
  } catch (err) {
    console.error('Failed to read SAGA', { candidateId, error: err.message });
    return respond(500, { error: 'Failed to read candidate record' });
  }

  // Guard: positionLevel is locked once evaluation has started
  if (patch.positionLevel && EVALUATION_LOCK_STAGES.has(saga.currentStage)) {
    return respond(409, {
      error: `positionLevel cannot be changed after evaluation has started (current stage: ${saga.currentStage})`,
    });
  }

  // Build UpdateExpression dynamically
  const now = new Date().toISOString();
  patch.updatedAt = now;

  const setExpressions = [];
  const exprAttrNames  = {};
  const exprAttrValues = {};

  for (const [key, val] of Object.entries(patch)) {
    const nameAlias  = `#f_${key}`;
    const valueAlias = `:v_${key}`;
    setExpressions.push(`${nameAlias} = ${valueAlias}`);
    exprAttrNames[nameAlias]  = key;
    exprAttrValues[valueAlias] = val;
  }

  const updateExpression = `SET ${setExpressions.join(', ')}`;

  try {
    await dynamo.send(new UpdateItemCommand({
      TableName:                 STATE_TABLE,
      Key:                       marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
      UpdateExpression:          updateExpression,
      ExpressionAttributeNames:  exprAttrNames,
      ExpressionAttributeValues: marshall(exprAttrValues),
      ConditionExpression:       'attribute_exists(PK)',
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return respond(404, { error: `Candidate ${candidateId} not found` });
    }
    console.error('Failed to update SAGA', { candidateId, error: err.message });
    return respond(500, { error: 'Failed to update candidate record' });
  }

  // Publish CandidateUpdated event (best-effort — does not fail the request)
  try {
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: EB_BUS,
        Source:       'talent-flow.workflow',
        DetailType:   'CandidateUpdated',
        Detail:       JSON.stringify({
          candidateId,
          updatedFields: Object.keys(patch).filter((k) => k !== 'updatedAt'),
          updatedAt:     now,
        }),
      }],
    }));
  } catch (err) {
    console.warn('Failed to publish CandidateUpdated event', { candidateId, error: err.message });
  }

  console.info('Candidate updated', { candidateId, fields: Object.keys(patch) });
  return respond(200, {
    candidateId,
    updatedFields: Object.keys(patch).filter((k) => k !== 'updatedAt'),
    updatedAt: now,
  });
};
