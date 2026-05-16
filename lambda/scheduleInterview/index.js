'use strict';

/**
 * scheduleInterview — NH-122 / BE-006
 *
 * Trigger: EventBridge rule — source=talent-flow.workflow, detail-type=InterviewScheduled
 * Also invocable directly from POST /candidates/{id}/interviews (HTTP API)
 *
 * Steps:
 *   1. Extract fields from event.detail
 *   2. GetItem SAGA record → positionLevel
 *   3. Validate positionLevel
 *   4. getConfig(tenantId, 'PANEL_CONFIG') — ACTIVE read (no version arg)
 *      REASON: Panel size for new interviews uses current policy (Invariant #3)
 *   5. Write interview record to talent-flow-state
 *   6. UpdateItem SAGA: currentStage=TECHNICAL_INTERVIEW, stageEnteredAt=now
 *   7. Per panelMemberId: enqueue INTERVIEW_SCHEDULED to notification SQS FIFO
 *
 * DO NOT read panelConfig using candidate's configVersion — always use active for new interviews.
 * DO NOT send SES directly — always route through NOTIFICATION_QUEUE_URL.
 *
 * Env vars:
 *   STATE_TABLE_NAME       — talent-flow-state
 *   CONFIG_TABLE_NAME      — talent-flow-config (read by config-reader)
 *   NOTIFICATION_QUEUE_URL — talent-flow-notification-queue.fifo URL
 *   EVENTBRIDGE_BUS_NAME   — talent-flow-bus
 *   AWS_ACCOUNT_ID         — 937137806477
 */

const { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { getConfig } = require('../shared/config-reader');

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_POSITION_LEVELS = ['JUNIOR', 'MID', 'SENIOR', 'DIRECTOR'];

// ── AWS clients ───────────────────────────────────────────────────────────────

const dynamo = new DynamoDBClient({});
const sqs = new SQSClient({});

// ── Helpers ───────────────────────────────────────────────────────────────────

function badRequest(message) {
  return { statusCode: 400, body: JSON.stringify({ error: message }) };
}

function serverError(message) {
  return { statusCode: 500, body: JSON.stringify({ error: message }) };
}

function ok(body) {
  return { statusCode: 200, body: JSON.stringify(body) };
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const detail = event.detail || event;

  const { candidateId, tenantId, interviewId, interviewType, scheduledAt, panelMemberIds } = detail;

  // ── Validate required fields ───────────────────────────────────────────────

  const missing = ['candidateId', 'tenantId', 'interviewId', 'interviewType', 'scheduledAt', 'panelMemberIds']
    .filter((f) => detail[f] == null);
  if (missing.length > 0) {
    return badRequest(`Missing required fields: ${missing.join(', ')}`);
  }

  if (!Array.isArray(panelMemberIds) || panelMemberIds.length === 0) {
    return badRequest('panelMemberIds must be a non-empty array');
  }

  // ── Step 2: Get SAGA record → positionLevel ────────────────────────────────

  let positionLevel;
  try {
    const sagaResult = await dynamo.send(
      new GetItemCommand({
        TableName: process.env.STATE_TABLE_NAME,
        Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
      })
    );

    if (!sagaResult.Item) {
      return badRequest(`SAGA record not found for candidate ${candidateId}`);
    }

    const saga = unmarshall(sagaResult.Item);
    positionLevel = saga.positionLevel;
  } catch (err) {
    console.error('Failed to read SAGA record', { candidateId, error: err.message });
    return serverError('Failed to read candidate record');
  }

  // ── Step 3: Validate positionLevel ────────────────────────────────────────

  if (!VALID_POSITION_LEVELS.includes(positionLevel)) {
    return badRequest(`positionLevel must be one of: ${VALID_POSITION_LEVELS.join(', ')} — got: ${positionLevel}`);
  }

  // ── Step 4: Read ACTIVE panel config (no version arg — Invariant #3) ───────

  let panelConfig;
  try {
    panelConfig = await getConfig(tenantId, 'PANEL_CONFIG');
  } catch (err) {
    console.error('Failed to read PANEL_CONFIG', { tenantId, error: err.message });
    return serverError('Failed to read panel configuration');
  }

  const votesRequired = panelConfig && panelConfig.rules && panelConfig.rules.votesRequired
    ? panelConfig.rules.votesRequired[positionLevel]
    : undefined;

  if (votesRequired == null) {
    console.error('votesRequired not found for positionLevel', { positionLevel, panelConfig });
    return serverError(`votesRequired not configured for positionLevel: ${positionLevel}`);
  }

  const now = new Date().toISOString();

  // ── Step 5: Write interview record ────────────────────────────────────────

  const interviewItem = {
    PK: `CANDIDATE#${candidateId}`,
    SK: `INTERVIEW#${interviewId}`,
    interviewId,
    candidateId,
    tenantId,
    interviewType,
    scheduledAt,
    panelMemberIds,
    votesRequired,
    votesSubmitted: 0,
    status: 'SCHEDULED',
    createdAt: now,
  };

  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: process.env.STATE_TABLE_NAME,
        Item: marshall(interviewItem, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(PK)',
      })
    );
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.warn('Interview record already exists — idempotent skip', { interviewId });
    } else {
      console.error('Failed to write interview record', { interviewId, error: err.message });
      return serverError('Failed to write interview record');
    }
  }

  // ── Step 6: Update SAGA — currentStage + stageEnteredAt ───────────────────

  try {
    await dynamo.send(
      new UpdateItemCommand({
        TableName: process.env.STATE_TABLE_NAME,
        Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
        UpdateExpression: 'SET currentStage = :stage, stageEnteredAt = :ts',
        ExpressionAttributeValues: marshall({
          ':stage': 'TECHNICAL_INTERVIEW',
          ':ts': now,
        }),
      })
    );
  } catch (err) {
    // Non-fatal: interview record already written; log and continue
    console.error('Failed to update SAGA stage', { candidateId, error: err.message });
  }

  // ── Step 7: Enqueue notification for each panel member (non-fatal) ─────────

  for (const recipientId of panelMemberIds) {
    const message = JSON.stringify({
      type: 'INTERVIEW_SCHEDULED',
      recipientId,
      candidateId,
      scheduledAt,
      interviewId,
    });

    try {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: process.env.NOTIFICATION_QUEUE_URL,
          MessageBody: message,
          MessageGroupId: candidateId,
          MessageDeduplicationId: `${interviewId}#${recipientId}`,
        })
      );
    } catch (err) {
      // Non-fatal: notification failure must not block interview scheduling
      console.error('Failed to enqueue notification', { recipientId, interviewId, error: err.message });
    }
  }

  console.info('Interview scheduled successfully', {
    interviewId,
    candidateId,
    tenantId,
    positionLevel,
    votesRequired,
    panelSize: panelMemberIds.length,
  });

  return ok({ interviewId, candidateId, votesRequired, status: 'SCHEDULED' });
};
