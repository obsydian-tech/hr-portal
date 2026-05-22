'use strict';

/**
 * advanceCandidateStage — NH-145 / BE-010
 *
 * Trigger: PUT /v1/candidates/{id}/stage (HTTP API v2)
 *
 * Steps:
 *   1. Parse candidateId from path, newStage + tenantId from body
 *   2. GetItem SAGA → currentStage
 *   3. Validate forward-only transition (STAGE_ORDER)
 *   4. UpdateItem SAGA: currentStage=newStage, stageEnteredAt=now
 *   5. Publish StageAdvanced to EventBridge talent-flow-bus
 *
 * Env vars:
 *   STATE_TABLE_NAME   — talent-flow-state
 *   EVENTBRIDGE_BUS_NAME — talent-flow-bus
 */

const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

const dynamo = new DynamoDBClient({});
const eb     = new EventBridgeClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME  || 'talent-flow-state';
const EB_BUS      = process.env.EVENTBRIDGE_BUS_NAME || 'talent-flow-bus';

/** Ordered list of hiring stages — index determines allowed forward movement */
const STAGE_ORDER = [
  'APPLICATION_REVIEW',
  'PHONE_SCREENING',
  'TECHNICAL_INTERVIEW',
  'PANEL_INTERVIEW',
  'EVALUATION',
  'BACKGROUND_CHECK',
  'OFFER_PREPARATION',
  'OFFER_APPROVAL',
  'OFFER_DELIVERY',
  'CONTRACT_SIGNING',
  'PRE_BOARDING',
  'ONBOARDING',
];

// ── Response helpers ──────────────────────────────────────────────────────────
function ok(body)          { return { statusCode: 200, body: JSON.stringify(body) }; }
function badRequest(msg)   { return { statusCode: 400, body: JSON.stringify({ error: msg }) }; }
function notFound(msg)     { return { statusCode: 404, body: JSON.stringify({ error: msg }) }; }
function conflict(msg)     { return { statusCode: 409, body: JSON.stringify({ error: msg }) }; }
function serverError(msg)  { return { statusCode: 500, body: JSON.stringify({ error: msg }) }; }

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Parse candidateId from path parameter
  const candidateId = event.pathParameters?.id;
  if (!candidateId) return badRequest('Missing candidateId path parameter');

  // Parse body
  let body;
  try {
    body = event.body
      ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body)
      : {};
  } catch {
    return badRequest('Invalid JSON body');
  }

  const { newStage, tenantId } = body;

  if (!newStage)  return badRequest('Missing required field: newStage');
  if (!tenantId)  return badRequest('Missing required field: tenantId');
  if (!STAGE_ORDER.includes(newStage)) {
    return badRequest(`Invalid stage: ${newStage}. Must be one of: ${STAGE_ORDER.join(', ')}`);
  }

  // ── Step 2: Read SAGA record ────────────────────────────────────────────────
  let saga;
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
    }));
    if (!result.Item) {
      return notFound(`Candidate ${candidateId} not found`);
    }
    saga = unmarshall(result.Item);
  } catch (err) {
    console.error('Failed to read SAGA', { candidateId, error: err.message });
    return serverError('Failed to read candidate record');
  }

  const currentStage = saga.currentStage;

  // ── Step 3: Validate forward-only transition ────────────────────────────────
  const currentIdx = STAGE_ORDER.indexOf(currentStage);
  const newIdx     = STAGE_ORDER.indexOf(newStage);

  if (currentIdx === -1) {
    return serverError(`Current stage '${currentStage}' is not recognised`);
  }
  if (newIdx <= currentIdx) {
    return conflict(
      `Cannot move from ${currentStage} (index ${currentIdx}) to ${newStage} (index ${newIdx}). Stage advancement is forward-only.`,
    );
  }

  const now = new Date().toISOString();

  // ── Step 4: Update SAGA ────────────────────────────────────────────────────
  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
      UpdateExpression: 'SET currentStage = :stage, stageEnteredAt = :ts, slaStatus = :slaReset',
      ExpressionAttributeValues: marshall({ ':stage': newStage, ':ts': now, ':slaReset': 'ON_TRACK' }),
    }));
  } catch (err) {
    console.error('Failed to update SAGA stage', { candidateId, newStage, error: err.message });
    return serverError('Failed to advance candidate stage');
  }

  // ── Step 5: Publish StageAdvanced event ────────────────────────────────────
  try {
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: EB_BUS,
        Source:       'talent-flow.workflow',
        DetailType:   'StageAdvanced',
        Detail:       JSON.stringify({
          candidateId,
          tenantId,
          previousStage: currentStage,
          newStage,
          timestamp:     now,
        }),
      }],
    }));
  } catch (err) {
    // Non-fatal: SAGA already updated — log and continue
    console.error('Failed to publish StageAdvanced event', { candidateId, newStage, error: err.message });
  }

  console.info('Stage advanced', { candidateId, previousStage: currentStage, newStage });

  return ok({ candidateId, previousStage: currentStage, newStage, stageEnteredAt: now });
};
