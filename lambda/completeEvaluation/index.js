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
 *   6.  UpdateItem SAGA (scores + result only — stage stays at EVALUATION)
 *
 * Option B design: EvaluationCompleted is published by advanceCandidateStage
 * when the TA deliberately advances EVALUATION → BACKGROUND_CHECK. This Lambda
 * only records the computed score/result; the TA decides when to act on it.
 * Exception: FAILED path still sets status=REJECTED immediately — a vote veto
 * or score below threshold requires no TA decision.
 *
 * Notification: EventBridge Rule 5 routes EvaluationCompleted →
 *   sendTalentFlowNotification automatically. No direct SQS send from this
 *   Lambda — avoids double notification and respects invariant #5 & #6.
 *
 * Compliance invariant #2 (non-negotiable):
 *   getConfig MUST use candidate.configVersion — NEVER active version.
 *   Pass threshold decisions are POPIA-auditable and must be version-locked.
 */

const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { getConfig } = require('../shared/config-reader');

const dynamo = new DynamoDBClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME;

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

  // ── Step 6a: UpdateItem SAGA (scores + result only; stage unchanged) ─────
  // PASSED: stage stays at EVALUATION — TA advances via advanceCandidateStage.
  // FAILED: status=REJECTED — vote quorum decided; no TA action needed.
  const now = new Date().toISOString();

  const updateExpression = outcome === 'PASSED'
    ? 'SET evaluationResult = :res, finalScore = :fs, evaluationCompletedAt = :at, configVersionUsedForEval = :cv'
    : 'SET evaluationResult = :res, finalScore = :fs, evaluationCompletedAt = :at, #st = :rejected, configVersionUsedForEval = :cv';

  const expressionAttributeValues = outcome === 'PASSED'
    ? {
        ':res': outcome,
        ':fs':  averageScore ?? null,
        ':at':  now,
        ':cv':  configVersion,
      }
    : {
        ':res':      outcome,
        ':fs':       averageScore ?? null,
        ':at':       now,
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

  // ── Step 6b: Mark INTERVIEW record as COMPLETED ────────────────────────
  if (saga.currentInterviewId) {
    try {
      await dynamo.send(new UpdateItemCommand({
        TableName: STATE_TABLE,
        Key: marshall({
          PK: `CANDIDATE#${candidateId}`,
          SK: `INTERVIEW#${saga.currentInterviewId}`,
        }),
        UpdateExpression: 'SET #s = :completed, completedAt = :at',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: marshall({ ':completed': 'COMPLETED', ':at': now }),
      }));
    } catch (err) {
      // Non-fatal — SAGA already updated; log and continue
      console.warn('Failed to mark INTERVIEW record as COMPLETED', {
        candidateId, interviewId: saga.currentInterviewId, error: err.message,
      });
    }
  }

  console.info('Evaluation scores recorded', { candidateId, outcome, configVersion, finalScore: averageScore ?? null });

  return ok({ candidateId, tenantId, outcome, finalScore: averageScore ?? null, configVersion });
};
