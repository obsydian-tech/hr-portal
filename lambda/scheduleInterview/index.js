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

const VALID_POSITION_LEVELS = ['JUNIOR', 'MID', 'SENIOR'];

/** Map interviewType → SAGA currentStage (Option A — simplified 6-stage model) */
const INTERVIEW_TYPE_STAGE_MAP = {
  PHONE_SCREEN: 'PHONE_SCREENING',
  TECHNICAL:    'TECHNICAL_INTERVIEW',
  BEHAVIORAL:   'PANEL_INTERVIEW',
  CULTURE_FIT:  'PANEL_INTERVIEW',
  FINAL:        'PANEL_INTERVIEW',
};

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

// ── PATCH handler: add panel members to an existing interview ─────────────────

async function handleAddPanelMembers(event) {
  const candidateId  = event.pathParameters && event.pathParameters.id;
  const interviewId  = event.pathParameters && event.pathParameters.interviewId;
  const body         = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
  const newSystemIds = Array.isArray(body.panelMemberIds)    ? body.panelMemberIds    : [];
  const newAdhocList = Array.isArray(body.adhocPanelMembers) ? body.adhocPanelMembers : [];

  if (!candidateId || !interviewId) {
    return badRequest('Missing candidateId or interviewId');
  }
  if (newSystemIds.length === 0 && newAdhocList.length === 0) {
    return badRequest('At least one panel member must be provided');
  }

  // Read current interview record so we can merge without duplicates
  let existing;
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: process.env.STATE_TABLE_NAME,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: `INTERVIEW#${interviewId}` }),
    }));
    if (!result.Item) return badRequest(`Interview ${interviewId} not found`);
    existing = unmarshall(result.Item);
  } catch (err) {
    console.error('handleAddPanelMembers: GetItem failed', { interviewId, error: err.message });
    return serverError('Failed to read interview record');
  }

  // Merge: deduplicate by id/email
  const currentIds   = Array.isArray(existing.panelMemberIds)    ? existing.panelMemberIds    : [];
  const currentAdhoc = Array.isArray(existing.adhocPanelMembers) ? existing.adhocPanelMembers : [];

  const mergedIds   = [...new Set([...currentIds,   ...newSystemIds])];
  const adhocEmails = new Set(currentAdhoc.map((m) => m.email));
  const mergedAdhoc = [
    ...currentAdhoc,
    ...newAdhocList.filter((m) => !adhocEmails.has(m.email)),
  ];

  try {
    const updateExpr = mergedAdhoc.length > 0
      ? 'SET panelMemberIds = :ids, adhocPanelMembers = :adhoc, updatedAt = :ts'
      : 'SET panelMemberIds = :ids, updatedAt = :ts';
    const exprValues = mergedAdhoc.length > 0
      ? marshall({ ':ids': mergedIds, ':adhoc': mergedAdhoc, ':ts': new Date().toISOString() })
      : marshall({ ':ids': mergedIds, ':ts': new Date().toISOString() });

    await dynamo.send(new UpdateItemCommand({
      TableName: process.env.STATE_TABLE_NAME,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: `INTERVIEW#${interviewId}` }),
      UpdateExpression: updateExpr,
      ExpressionAttributeValues: exprValues,
    }));
  } catch (err) {
    console.error('handleAddPanelMembers: UpdateItem failed', { interviewId, error: err.message });
    return serverError('Failed to update interview panel');
  }

  console.info('Panel members added to interview', {
    interviewId, candidateId,
    addedSystem: newSystemIds.length, addedAdhoc: newAdhocList.length,
    totalSystem: mergedIds.length,   totalAdhoc: mergedAdhoc.length,
  });
  return ok({ interviewId, panelMemberIds: mergedIds, adhocPanelMembers: mergedAdhoc });
}

// ── Main handler ──────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  // PATCH: add panel members to an existing interview
  if (event.requestContext && event.requestContext.http && event.requestContext.http.method === 'PATCH') {
    return handleAddPanelMembers(event);
  }

  // Support both EventBridge invocations (event.detail) and HTTP API v2 invocations (event.body)
  let detail;
  if (event.detail) {
    // EventBridge — detail.candidateId is set by the event
    detail = event.detail;
  } else if (event.body != null) {
    // HTTP API v2 — body is JSON string; candidateId comes from path parameter
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const pathCandidateId = event.pathParameters && event.pathParameters.id;
    detail = { ...body, candidateId: body.candidateId || pathCandidateId };
  } else {
    detail = event;
  }

  const {
    candidateId, tenantId, interviewId, interviewType, scheduledAt,
    panelMemberIds,
    adhocPanelMembers, // D004/D005/D041: optional ad hoc members (name+email+role)
  } = detail;

  // ── Validate required fields ───────────────────────────────────────────────

  const missing = ['candidateId', 'tenantId', 'interviewId', 'interviewType', 'scheduledAt']
    .filter((f) => detail[f] == null);
  if (missing.length > 0) {
    return badRequest(`Missing required fields: ${missing.join(', ')}`);
  }

  const systemIds = Array.isArray(panelMemberIds) ? panelMemberIds : [];
  const adhocList = Array.isArray(adhocPanelMembers) ? adhocPanelMembers : [];

  if (systemIds.length === 0 && adhocList.length === 0) {
    return badRequest('At least one panel member (system user or ad hoc) is required');
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
    panelMemberIds: systemIds,
    // D004/D005/D041: ad hoc members stored; scoring links generated in Phase E
    ...(adhocList.length > 0 ? { adhocPanelMembers: adhocList } : {}),
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

  // ── Step 6: Update SAGA — map interviewType → currentStage ─────────────────

  const targetStage = INTERVIEW_TYPE_STAGE_MAP[interviewType];

  if (!targetStage) {
    console.warn('Unknown interviewType — SAGA stage not updated', { interviewType });
  } else {
    try {
      await dynamo.send(
        new UpdateItemCommand({
          TableName: process.env.STATE_TABLE_NAME,
          Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
          UpdateExpression: 'SET currentStage = :stage, stageEnteredAt = :ts, currentInterviewId = :iid',
          ExpressionAttributeValues: marshall({ ':stage': targetStage, ':ts': now, ':iid': interviewId }),
        })
      );
    } catch (err) {
      console.error('Failed to update SAGA stage', { candidateId, error: err.message });
    }
  }

  // ── Step 6b: Write timeline audit entry ──────────────────────────────────────

  try {
    await dynamo.send(
      new PutItemCommand({
        TableName: process.env.STATE_TABLE_NAME,
        Item: marshall({
          PK: `CANDIDATE#${candidateId}`,
          SK: `AUDIT#${now}`,
          eventType: 'INTERVIEW_SCHEDULED',
          interviewId,
          interviewType,
          targetStage: targetStage ?? null,
          scheduledAt,
          tenantId,
          createdAt: now,
        }, { removeUndefinedValues: true }),
      })
    );
  } catch (err) {
    console.error('Failed to write timeline audit entry', { candidateId, error: err.message });
  }

  // ── Step 7: Enqueue notification for each system panel member (non-fatal) ──
  // Ad hoc members (adhocList) receive scoring-link emails via Phase E —
  // they are stored on the interview record and processed by generateScoringLink.

  for (const recipientId of systemIds) {
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
    panelSize: systemIds.length,
    adhocCount: adhocList.length,
  });

  return ok({ interviewId, candidateId, votesRequired, status: 'SCHEDULED' });
};
