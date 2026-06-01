'use strict';

/**
 * advanceCandidateStage — NH-145 / BE-010
 *
 * Trigger: PUT /v1/candidates/{id}/stage (HTTP API v2)
 *
 * Steps:
 *   1. Parse candidateId from path, newStage + tenantId from body
 *   2. GetItem SAGA → currentStage, positionLevel
 *   3. Validate forward-only transition (STAGE_ORDER)
 *   4. If advancing FROM INTERVIEWING: gate check — all required interview
 *      types must have status=COMPLETED (per PANEL_CONFIG.interviewRequirements
 *      for this candidate's positionLevel). Returns 409 if any are pending.
 *   5. UpdateItem SAGA: currentStage=newStage, stageEnteredAt=now
 *   6. Publish StageAdvanced to EventBridge talent-flow-bus
 *
 * Env vars:
 *   STATE_TABLE_NAME     — talent-flow-state
 *   CONFIG_TABLE_NAME    — talent-flow-config
 *   EVENTBRIDGE_BUS_NAME — talent-flow-bus
 */

const { DynamoDBClient, GetItemCommand, UpdateItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { getConfig } = require('../shared/config-reader');

const dynamo = new DynamoDBClient({});
const eb     = new EventBridgeClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME    || 'talent-flow-state';
const EB_BUS      = process.env.EVENTBRIDGE_BUS_NAME || 'talent-flow-bus';

/**
 * 10-stage pipeline. PHONE_SCREENING, TECHNICAL_INTERVIEW, PANEL_INTERVIEW
 * are replaced by a single INTERVIEWING stage with a configurable sub-loop.
 * The interview types required per positionLevel are defined in PANEL_CONFIG.
 */
const STAGE_ORDER = [
  'APPLICATION_REVIEW',
  'INTERVIEWING',
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

// ── Interview loop gate ───────────────────────────────────────────────────────
/**
 * When leaving INTERVIEWING, verify every required interview type
 * (per PANEL_CONFIG.interviewRequirements[positionLevel]) has at least
 * one INTERVIEW# record with status=COMPLETED.
 *
 * Returns null if the gate passes, or a 409 response if it does not.
 */
async function checkInterviewLoopComplete(candidateId, tenantId, positionLevel) {
  // Read active PANEL_CONFIG — always use active version for gate checks (Invariant #3)
  let panelConfig;
  try {
    panelConfig = await getConfig(tenantId, 'PANEL_CONFIG');
  } catch (err) {
    console.error('interviewLoopGate: failed to read PANEL_CONFIG', { tenantId, error: err.message });
    return serverError('Failed to read panel configuration');
  }

  const requirements = panelConfig && panelConfig.interviewRequirements && panelConfig.interviewRequirements[positionLevel];
  if (!requirements || requirements.length === 0) {
    // No requirements configured — gate passes (graceful degradation)
    console.warn('interviewLoopGate: no interviewRequirements for positionLevel — gate skipped', { positionLevel });
    return null;
  }

  const requiredTypes = requirements
    .filter((r) => r.required !== false)
    .map((r) => r.type);

  if (requiredTypes.length === 0) return null;

  // Query all INTERVIEW# records for this candidate
  let interviews = [];
  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: STATE_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: marshall({
        ':pk':     `CANDIDATE#${candidateId}`,
        ':prefix': 'INTERVIEW#',
      }),
      ProjectionExpression: 'interviewType, #s',
      ExpressionAttributeNames: { '#s': 'status' },
    }));
    interviews = (result.Items || []).map((i) => unmarshall(i));
  } catch (err) {
    console.error('interviewLoopGate: failed to query INTERVIEW records', { candidateId, error: err.message });
    return serverError('Failed to verify interview completion');
  }

  // Build a set of completed interview types
  const completedTypes = new Set(
    interviews
      .filter((i) => i.status === 'COMPLETED')
      .map((i) => i.interviewType)
  );

  const pending = requiredTypes.filter((t) => !completedTypes.has(t));

  if (pending.length > 0) {
    const fmt = (t) => t.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
    const pendingLabels = pending.map(fmt).join(', ');
    return conflict(
      `To advance to Evaluation, the following required interviews must be completed first: ${pendingLabels}.`
    );
  }

  return null; // gate passed
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const candidateId = event.pathParameters?.id;
  if (!candidateId) return badRequest('Missing candidateId path parameter');

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
    if (!result.Item) return notFound(`Candidate ${candidateId} not found`);
    saga = unmarshall(result.Item);
  } catch (err) {
    console.error('Failed to read SAGA', { candidateId, error: err.message });
    return serverError('Failed to read candidate record');
  }

  const currentStage  = saga.currentStage;
  const positionLevel = saga.positionLevel;

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

  // ── Step 4: Interview loop gate (only when leaving INTERVIEWING) ───────────
  if (currentStage === 'INTERVIEWING') {
    const gateError = await checkInterviewLoopComplete(candidateId, tenantId, positionLevel);
    if (gateError) return gateError;
  }

  const now = new Date().toISOString();

  // ── Step 5: Update SAGA ────────────────────────────────────────────────────
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

  // ── Step 6: Publish StageAdvanced event ────────────────────────────────────
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
    console.error('Failed to publish StageAdvanced event', { candidateId, newStage, error: err.message });
  }

  console.info('Stage advanced', { candidateId, previousStage: currentStage, newStage });

  return ok({ candidateId, previousStage: currentStage, newStage, stageEnteredAt: now });
};
