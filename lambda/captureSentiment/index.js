'use strict';

/**
 * captureSentiment Lambda
 * NH-123 — BE-011
 *
 * Trigger: POST /v1/candidates/{id}/sentiment (HTTP API v2, Cognito JWT authorizer)
 *
 * Body: { interviewSentiment: string, tenantId: string }
 *
 * Steps:
 *   1. Validate interviewSentiment against D007 scale
 *   2. UpdateItem SAGA record with new sentiment + capturedBy + capturedAt
 *      ConditionExpression: attribute_exists(PK) — rejects unknown candidateIds
 *   3. Publish SentimentCaptured to EventBridge talent-flow-bus
 *
 * D007 sentiment scale (interview loop, Triggers 1-2):
 *   VERY_INTERESTED | INTERESTED | NEUTRAL | HESITANT | DISENGAGED
 *
 * EventBridge rule (I9-005) filters on HESITANT/DISENGAGED to trigger
 * Signal Intelligence notification via sendTalentFlowNotification.
 */

const { DynamoDBClient, UpdateItemCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { tenantHelper, scopeWrite } = require('../shared/tf-tenant.js');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const dynamo = new DynamoDBClient({});
const eb     = new EventBridgeClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME    || 'talent-flow-state';
const EB_BUS      = process.env.EVENTBRIDGE_BUS_NAME || 'talent-flow-bus';

const VALID_SENTIMENTS = ['VERY_INTERESTED', 'INTERESTED', 'NEUTRAL', 'HESITANT', 'DISENGAGED'];

function ok(body)        { return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }
function badRequest(msg) { return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) }; }
function notFound(msg)   { return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) }; }
function serverError(msg){ return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) }; }

exports.handler = async (event) => {
  // REC-01: only a Recruiter (HR with the Recruitment tick) may do this. The role answer comes first, before any AWS call.
  const RA = await import('../shared/recruitment-access.mjs');
  const notRecruiter = RA.requireRecruiter(event);
  if (notRecruiter) return notRecruiter;
  // TEN-03: the company comes from the sign-in only. tenantId in the body is not read.
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;

  const candidateId = event.pathParameters?.id;
  if (!candidateId) return badRequest('Missing candidateId');

  const capturedBy = event.requestContext?.authorizer?.jwt?.claims?.sub || 'unknown';

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return badRequest('Invalid JSON body');
  }

  const { interviewSentiment } = body;

  if (!interviewSentiment) return badRequest('Missing interviewSentiment');
  if (!VALID_SENTIMENTS.includes(interviewSentiment)) {
    return badRequest(`Invalid interviewSentiment. Must be one of: ${VALID_SENTIMENTS.join(', ')}`);
  }

  const capturedAt = new Date().toISOString();

  // The candidate is this company's, or it is not found (read first: nothing is written for another company).
  try {
    const found = await dynamo.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key:       marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
    }));
    if (!found.Item || !T.ownsRow(unmarshall(found.Item), tenantId)) return T.notFound();
  } catch (err) {
    console.error('DynamoDB read failed', { candidateId, error: err.message });
    return serverError('Failed to capture sentiment');
  }

  // ── Update SAGA record ────────────────────────────────────────────────────
  try {
    await dynamo.send(new UpdateItemCommand(scopeWrite({
      TableName:                 STATE_TABLE,
      Key:                       marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
      ConditionExpression:       'attribute_exists(PK)',
      UpdateExpression:          'SET interviewSentiment = :s, sentimentCapturedBy = :by, sentimentCapturedAt = :at, updatedBy = :uid',
      ExpressionAttributeValues: marshall({
        ':s':   interviewSentiment,
        ':by':  capturedBy,
        ':at':  capturedAt,
        ':uid': capturedBy,  // INTEL-001: Track who captured sentiment for action tracking
      }),
    }, tenantId)));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return T.notFound();
    }
    console.error('DynamoDB update failed', { candidateId, error: err.message });
    return serverError('Failed to capture sentiment');
  }

  // ── Publish SentimentCaptured to EventBridge ──────────────────────────────
  try {
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: EB_BUS,
        Source:       'talent-flow.workflow',
        DetailType:   'SentimentCaptured',
        Detail:       JSON.stringify({
          candidateId,
          tenant_id: tenantId,
          interviewSentiment,
          capturedBy,
          capturedAt,
        }),
      }],
    }));
  } catch (err) {
    // EventBridge failure is non-fatal — SAGA record is already updated
    console.error('EventBridge PutEvents failed (non-fatal)', { candidateId, error: err.message });
  }

  console.info('Sentiment captured', { candidateId, interviewSentiment, capturedBy });

  return ok({ candidateId, interviewSentiment, capturedAt });
};
