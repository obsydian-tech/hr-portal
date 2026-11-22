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
 * positionLevel guard (REC-03): locked once the candidate is in Interview or later, and in Applied or Screening once any
 * interview has been scheduled. Changing level after scores have been cast would invalidate the approval chain and the
 * scoring weights, so the field is immutable from that point.
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
  QueryCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { tenantHelper, scopeWrite } = require('../shared/tf-tenant.js');
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

// positionLevel is open to change only while the candidate is in one of these stages and has no interview yet.
const LEVEL_OPEN_STAGES = ['APPLIED', 'SCREENING'];

/** True when any interview row of the candidate (this company's) exists. Reads every page. */
async function hasInterview(candidateId, tenantId, T) {
  let start;
  do {
    const page = await dynamo.send(new QueryCommand({
      TableName: STATE_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${candidateId}`, ':sk': 'INTERVIEW#' }),
      ExclusiveStartKey: start,
    }));
    if ((page.Items ?? []).some((i) => T.ownsRow(unmarshall(i), tenantId))) return true;
    start = page.LastEvaluatedKey;
  } while (start);
  return false;
}

exports.handler = async (event) => {
  // REC-01: only a Recruiter (HR with the Recruitment tick) may do this. The role answer comes first, before any AWS call.
  const RA = await import('../shared/recruitment-access.mjs');
  const notRecruiter = RA.requireRecruiter(event);
  if (notRecruiter) return notRecruiter;
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;

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
    if (!res.Item) return T.notFound();
    saga = unmarshall(res.Item);
    if (!T.ownsRow(saga, tenantId)) return T.notFound();
  } catch (err) {
    console.error('Failed to read SAGA', { candidateId, error: err.message });
    return respond(500, { error: 'Failed to read candidate record' });
  }

  // Guard (REC-03): the level is locked in Interview and later (a stored old stage name counts through normaliseStage), and in
  // Applied or Screening once any interview exists.
  if (patch.positionLevel !== undefined) {
    const { normaliseStage } = await import('../shared/recruitment-stages.mjs');
    let locked = !LEVEL_OPEN_STAGES.includes(normaliseStage(saga));
    if (!locked) {
      try {
        locked = await hasInterview(candidateId, tenantId, T);
      } catch (err) {
        console.error('Failed to read interviews', { candidateId, error: err.name });
        return respond(500, { error: 'Failed to read candidate record' });
      }
    }
    if (locked) return respond(409, { error: 'Conflict', code: 'LEVEL_LOCKED' });
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
    await dynamo.send(new UpdateItemCommand(scopeWrite({
      TableName:                 STATE_TABLE,
      Key:                       marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
      UpdateExpression:          updateExpression,
      ExpressionAttributeNames:  exprAttrNames,
      ExpressionAttributeValues: marshall(exprAttrValues),
      ConditionExpression:       'attribute_exists(PK)',
    }, tenantId)));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return T.notFound();
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
          tenant_id:     tenantId,
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
