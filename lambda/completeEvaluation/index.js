'use strict';

/**
 * completeEvaluation Lambda
 * NH-125 — BE-009
 *
 * Trigger: EventBridge talent-flow.workflow / VotingCompleted
 *          (deployed rule: talent-flow-voting-completed → completeEvaluation)
 *
 * Implementation spec (6 steps):
 *   1.  Extract candidateId, tenantId, averageScore, result from event.detail
 *   2.  If result === 'STRONG_NO_VETO': skip scoring → outcome=FAILED
 *   3.  GetItem SAGA → extract configVersion
 *   4.  getConfig(tenantId, 'APPROVAL_RULES', configVersion) — VERSIONED (invariant #2)
 *   5.  averageScore >= config.minimumPassScore (default 6.0) → PASSED else FAILED
 *   6.  UpdateItem SAGA + publish EvaluationCompleted
 *
 * Notification: EventBridge Rule 5 routes EvaluationCompleted →
 *   sendTalentFlowNotification automatically. No direct SQS send from this
 *   Lambda — avoids double notification and respects invariant #5 & #6.
 *
 * Compliance invariant #2 (non-negotiable):
 *   getConfig MUST use candidate.configVersion — NEVER active version.
 *   Pass threshold decisions are POPIA-auditable and must be version-locked.
 *
 * EventBridge publish source: talent-flow.workflow (Hard-Won Lesson 7a)
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
const { getConfig } = require('../shared/config-reader');

const dynamo = new DynamoDBClient({});
const eb     = new EventBridgeClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME;
const EB_BUS      = process.env.EVENTBRIDGE_BUS_NAME;

const DEFAULT_MINIMUM_PASS_SCORE = 6.0;

// ── Response helpers ──────────────────────────────────────────────────────────
const ok          = (body) => ({ statusCode: 200, body: JSON.stringify(body) });
const badRequest  = (msg)  => ({ statusCode: 400, body: JSON.stringify({ error: msg }) });
const serverError = (msg)  => ({ statusCode: 500, body: JSON.stringify({ error: msg }) });

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // ── Step 1: Extract fields from event detail ────────────────────────────
  const detail = event.detail
    || (event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body) : event);

  const { candidateId, tenantId, averageScore, result } = detail || {};

  if (!candidateId) return badRequest('Missing required field: candidateId');
  if (!tenantId)    return badRequest('Missing required field: tenantId');
  if (!result)      return badRequest('Missing required field: result');

  // ── Step 2: STRONG_NO_VETO fast-path ─────────────────────────────────────
  const isVeto = result === 'STRONG_NO_VETO';

  // ── Step 3: Get SAGA → configVersion ─────────────────────────────────────
  let saga;
  try {
    const res = await dynamo.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
    }));
    if (!res.Item) {
      return badRequest(`SAGA record not found for candidate ${candidateId}`);
    }
    saga = unmarshall(res.Item);
  } catch (err) {
    console.error('Failed to read SAGA record', { candidateId, error: err.message });
    return serverError('Failed to read candidate record');
  }

  const configVersion = saga.configVersion;
  if (!configVersion) {
    return badRequest(`SAGA record for candidate ${candidateId} has no configVersion`);
  }

  // ── Steps 4 & 5: Versioned config read + threshold comparison ─────────────
  let outcome;

  if (isVeto) {
    outcome = 'FAILED';
  } else {
    // averageScore must be present for non-veto path
    if (averageScore == null) {
      return badRequest('Missing required field: averageScore (required when result is not STRONG_NO_VETO)');
    }

    let approvalRules;
    try {
      approvalRules = await getConfig(tenantId, 'APPROVAL_RULES', configVersion);
    } catch (err) {
      console.error('Failed to read APPROVAL_RULES', { tenantId, configVersion, error: err.message });
      return serverError('Failed to read approval configuration');
    }

    const minimumPassScore = (approvalRules && approvalRules.minimumPassScore != null)
      ? approvalRules.minimumPassScore
      : DEFAULT_MINIMUM_PASS_SCORE;

    outcome = averageScore >= minimumPassScore ? 'PASSED' : 'FAILED';

    console.info('Threshold comparison', {
      candidateId, averageScore, minimumPassScore, configVersion, outcome,
    });
  }

  // ── Step 6a: UpdateItem SAGA ────────────────────────────────────────────
  const now = new Date().toISOString();

  const updateExpression = outcome === 'PASSED'
    ? 'SET evaluationResult = :res, finalScore = :fs, evaluationCompletedAt = :at, currentStage = :stage, configVersionUsedForEval = :cv'
    : 'SET evaluationResult = :res, finalScore = :fs, evaluationCompletedAt = :at, currentStage = :stage, #st = :rejected, configVersionUsedForEval = :cv';

  const expressionAttributeValues = outcome === 'PASSED'
    ? {
        ':res':   outcome,
        ':fs':    averageScore ?? null,
        ':at':    now,
        ':stage': 'OFFER_PREPARATION',
        ':cv':    configVersion,
      }
    : {
        ':res':      outcome,
        ':fs':       averageScore ?? null,
        ':at':       now,
        ':stage':    'EVALUATION',
        ':rejected': 'REJECTED',
        ':cv':       configVersion,
      };

  const expressionAttributeNames = outcome === 'FAILED' ? { '#st': 'status' } : undefined;

  try {
    const updateParams = {
      TableName: STATE_TABLE,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: marshall(expressionAttributeValues),
    };
    if (expressionAttributeNames) {
      updateParams.ExpressionAttributeNames = expressionAttributeNames;
    }
    await dynamo.send(new UpdateItemCommand(updateParams));
  } catch (err) {
    console.error('Failed to update SAGA record', { candidateId, outcome, error: err.message });
    return serverError('Failed to update candidate evaluation record');
  }

  // ── Step 6b: Publish EvaluationCompleted ───────────────────────────────
  await publishEvaluationCompleted({
    candidateId,
    tenantId,
    outcome,
    finalScore:    averageScore ?? null,
    configVersion,
  });

  console.info('Evaluation completed', { candidateId, outcome, configVersion, finalScore: averageScore ?? null });

  return ok({ candidateId, tenantId, outcome, finalScore: averageScore ?? null, configVersion });
};

// ── EventBridge publish helper ────────────────────────────────────────────────
async function publishEvaluationCompleted({ candidateId, tenantId, outcome, finalScore, configVersion }) {
  try {
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: EB_BUS,
        Source:       'talent-flow.workflow',
        DetailType:   'EvaluationCompleted',
        Detail:       JSON.stringify({
          candidateId,
          tenantId,
          outcome,
          finalScore,
          configVersion,
          timestamp: new Date().toISOString(),
        }),
      }],
    }));
  } catch (err) {
    // Non-fatal: SAGA already updated; downstream notification will reconcile
    console.error('Failed to publish EvaluationCompleted', { candidateId, outcome, error: err.message });
  }
}
