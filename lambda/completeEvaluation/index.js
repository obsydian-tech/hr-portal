'use strict';

/**
 * completeEvaluation Lambda
 * NH-125 — BE-009
 *
 * Trigger: EventBridge talent-flow.workflow / VotingCompleted
 *          (deployed rule: talent-flow-voting-completed → completeEvaluation)
 *
 * REC-02: scores never decide. This Lambda records the final score on the candidate row as data and, when the candidate's
 * REJECTION_RULES set reviewBelowScore and the score is below it, sets score_under_review_level = true (a flag for a person).
 * Nothing here moves a candidate or writes a status; Not hired is a person's action (lambda/recordNotHired).
 *
 *   1.  Extract candidateId, tenantId, averageScore from event.detail
 *   2.  GetItem SAGA (must be the event's company)
 *   3.  Read REJECTION_RULES (the version locked to the candidate)
 *   4.  UpdateItem SAGA: finalScore, evaluationCompletedAt, configVersionUsedForEval (+ the flag when below reviewBelowScore)
 *
 * Notification: EventBridge Rule 5 routes EvaluationCompleted →
 *   sendTalentFlowNotification automatically. No direct SQS send from this
 *   Lambda — avoids double notification and respects invariant #5 & #6.
 *
 * Compliance invariant #2 (non-negotiable): the setting is read at the version locked to the candidate
 *   (getRecruitmentSettings), never the active version.
 */

const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { tenantHelper, scopeWrite, eventTenant } = require('../shared/tf-tenant.js');

const dynamo = new DynamoDBClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME;

// ── Response helpers ──────────────────────────────────────────────────────────
const ok          = (body) => ({ statusCode: 200, body: JSON.stringify(body) });
const badRequest  = (msg)  => ({ statusCode: 400, body: JSON.stringify({ error: msg }) });
const serverError = (msg)  => ({ statusCode: 500, body: JSON.stringify({ error: msg }) });

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // ── Step 1: Extract fields from event detail ────────────────────────────
  const detail = event.detail
    || (event.body ? (typeof event.body === 'string' ? JSON.parse(event.body) : event.body) : event);

  const { candidateId, averageScore, result } = detail || {};

  // TEN-03: the company is the event's tenant_id. An event without one is skipped (nothing read, written or sent).
  const T = await tenantHelper();
  const tenantId = await eventTenant(detail);
  if (!tenantId) {
    console.warn('completeEvaluation: event skipped, it names no company');
    return ok({ skipped: true });
  }

  if (!candidateId) return badRequest('Missing required field: candidateId');
  if (!result)      return badRequest('Missing required field: result');

  // ── Step 3: Get SAGA → configVersion ─────────────────────────────────────
  let saga;
  try {
    const res = await dynamo.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
    }));
    if (!res.Item) return T.notFound();
    saga = unmarshall(res.Item);
    if (!T.ownsRow(saga, tenantId)) {
      console.warn('completeEvaluation: event skipped, the candidate is not in the event\'s company');
      return T.notFound();
    }
  } catch (err) {
    console.error('Failed to read SAGA record', { candidateId, error: err.message });
    return serverError('Failed to read candidate record');
  }

  const configVersion = saga.configVersion;
  if (!configVersion) {
    return badRequest(`SAGA record for candidate ${candidateId} has no configVersion`);
  }

  // ── Step 4: the score is data; a score under the company's reviewBelowScore raises a flag ─────────────
  // averageScore is empty when no vote carried a score (the Standard pack has no weights yet; REC-07 rebuilds the maths).
  const finalScore = Number.isFinite(averageScore) ? averageScore : null;
  const { getRecruitmentSettings, DEFAULTS } = await import('../shared/recruitment-settings.mjs');
  let rules;
  try {
    const settings = await getRecruitmentSettings(tenantId, saga);
    rules = settings.REJECTION_RULES ?? DEFAULTS.REJECTION_RULES;
  } catch (err) {
    console.error('Failed to read REJECTION_RULES', { tenantId, error: err.name });
    return serverError('Failed to read rejection settings');
  }
  const flagged = rules.reviewBelowScore != null && finalScore != null && finalScore < rules.reviewBelowScore;
  const now = new Date().toISOString();

  try {
    await dynamo.send(new UpdateItemCommand(scopeWrite({
      TableName: STATE_TABLE,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
      UpdateExpression: 'SET finalScore = :fs, evaluationCompletedAt = :at, configVersionUsedForEval = :cv' + (flagged ? ', score_under_review_level = :flag' : ''),
      ExpressionAttributeValues: marshall({ ':fs': finalScore, ':at': now, ':cv': configVersion, ...(flagged ? { ':flag': true } : {}) }),
    }, tenantId)));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return T.notFound();
    console.error('Failed to update SAGA record', { candidateId, error: err.name });
    return serverError('Failed to update candidate evaluation record');
  }

  // ── Step 6b: Mark INTERVIEW record as COMPLETED ────────────────────────
  if (saga.currentInterviewId) {
    try {
      await dynamo.send(new UpdateItemCommand(scopeWrite({
        TableName: STATE_TABLE,
        Key: marshall({
          PK: `CANDIDATE#${candidateId}`,
          SK: `INTERVIEW#${saga.currentInterviewId}`,
        }),
        UpdateExpression: 'SET #s = :completed, completedAt = :at',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: marshall({ ':completed': 'COMPLETED', ':at': now }),
      }, tenantId)));
    } catch (err) {
      // Non-fatal — SAGA already updated; log and continue
      console.warn('Failed to mark INTERVIEW record as COMPLETED', {
        candidateId, interviewId: saga.currentInterviewId, error: err.message,
      });
    }
  }

  console.info('Evaluation scores recorded', { candidateId, configVersion, finalScore, flagged });

  return ok({ candidateId, finalScore, configVersion, flagged });
};
