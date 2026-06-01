'use strict';

/**
 * scheduleInterview — NH-122 / BE-006
 *
 * Trigger: POST /candidates/{id}/interviews  (schedule a new interview)
 *          PATCH /candidates/{id}/interviews/{interviewId}  (update: add panel members OR complete)
 *
 * POST — Schedule a new interview within the INTERVIEWING stage:
 *   1. Parse and validate body fields
 *   2. GetItem SAGA — verify currentStage === 'INTERVIEWING'
 *   3. Read active PANEL_CONFIG → votesRequired for positionLevel (Invariant #3)
 *   4. PutItem INTERVIEW# record (status=SCHEDULED)
 *   5. UpdateItem SAGA: currentInterviewId = interviewId (tracks most recent interview)
 *   6. Write AUDIT# timeline entry
 *   7. Enqueue INTERVIEW_SCHEDULED notification for each system panel member
 *
 * PATCH (action=complete) — Mark an interview as COMPLETED:
 *   1. UpdateItem INTERVIEW# record: status=COMPLETED, completedAt, outcome
 *
 * PATCH (no action field) — Add panel members to an existing interview.
 *
 * DO NOT update SAGA currentStage from this Lambda — the stage stays INTERVIEWING
 * for all interview types. advanceCandidateStage gates the INTERVIEWING→EVALUATION
 * transition by checking all required interview types are COMPLETED.
 *
 * DO NOT read panelConfig using candidate's configVersion for new interviews —
 * always use active (Invariant #3).
 *
 * Env vars:
 *   STATE_TABLE_NAME       — talent-flow-state
 *   CONFIG_TABLE_NAME      — talent-flow-config
 *   NOTIFICATION_QUEUE_URL — talent-flow-notification-queue.fifo URL
 *   EVENTBRIDGE_BUS_NAME   — talent-flow-bus
 */

const { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { getConfig } = require('../shared/config-reader');

const VALID_POSITION_LEVELS = ['JUNIOR', 'MID', 'SENIOR'];

const dynamo = new DynamoDBClient({});
const sqs    = new SQSClient({});

function badRequest(message) { return { statusCode: 400, body: JSON.stringify({ error: message }) }; }
function notFound(message)   { return { statusCode: 404, body: JSON.stringify({ error: message }) }; }
function conflict(message)   { return { statusCode: 409, body: JSON.stringify({ error: message }) }; }
function serverError(message){ return { statusCode: 500, body: JSON.stringify({ error: message }) }; }
function ok(body)            { return { statusCode: 200, body: JSON.stringify(body) }; }

// ── PATCH: complete interview ─────────────────────────────────────────────────

async function handleCompleteInterview(event) {
  const candidateId  = event.pathParameters?.id;
  const interviewId  = event.pathParameters?.interviewId;
  const body         = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
  const { outcome }  = body; // optional: PASS | DEFER | FAIL

  if (!candidateId || !interviewId) return badRequest('Missing candidateId or interviewId');

  const now = new Date().toISOString();

  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: process.env.STATE_TABLE_NAME,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: `INTERVIEW#${interviewId}` }),
      UpdateExpression: 'SET #s = :completed, completedAt = :at' + (outcome ? ', outcome = :outcome' : ''),
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: marshall({
        ':completed': 'COMPLETED',
        ':at': now,
        ...(outcome ? { ':outcome': outcome } : {}),
      }),
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return notFound(`Interview ${interviewId} not found`);
    console.error('handleCompleteInterview: UpdateItem failed', { interviewId, error: err.message });
    return serverError('Failed to mark interview as completed');
  }

  console.info('Interview marked COMPLETED', { candidateId, interviewId, outcome: outcome ?? 'not set' });
  return ok({ interviewId, candidateId, status: 'COMPLETED', completedAt: now });
}

// ── PATCH: add panel members ──────────────────────────────────────────────────

async function handleAddPanelMembers(event) {
  const candidateId  = event.pathParameters?.id;
  const interviewId  = event.pathParameters?.interviewId;
  const body         = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
  const newSystemIds = Array.isArray(body.panelMemberIds)    ? body.panelMemberIds    : [];
  const newAdhocList = Array.isArray(body.adhocPanelMembers) ? body.adhocPanelMembers : [];

  if (!candidateId || !interviewId) return badRequest('Missing candidateId or interviewId');
  if (newSystemIds.length === 0 && newAdhocList.length === 0) {
    return badRequest('At least one panel member must be provided');
  }

  let existing;
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: process.env.STATE_TABLE_NAME,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: `INTERVIEW#${interviewId}` }),
    }));
    if (!result.Item) return notFound(`Interview ${interviewId} not found`);
    existing = unmarshall(result.Item);
  } catch (err) {
    console.error('handleAddPanelMembers: GetItem failed', { interviewId, error: err.message });
    return serverError('Failed to read interview record');
  }

  const currentIds   = Array.isArray(existing.panelMemberIds)    ? existing.panelMemberIds    : [];
  const currentAdhoc = Array.isArray(existing.adhocPanelMembers) ? existing.adhocPanelMembers : [];
  const mergedIds    = [...new Set([...currentIds, ...newSystemIds])];
  const adhocEmails  = new Set(currentAdhoc.map((m) => m.email));
  const mergedAdhoc  = [
    ...currentAdhoc,
    ...newAdhocList.filter((m) => !adhocEmails.has(m.email)),
  ];

  try {
    const updateExpr  = mergedAdhoc.length > 0
      ? 'SET panelMemberIds = :ids, adhocPanelMembers = :adhoc, updatedAt = :ts'
      : 'SET panelMemberIds = :ids, updatedAt = :ts';
    const exprValues  = mergedAdhoc.length > 0
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
  });
  return ok({ interviewId, panelMemberIds: mergedIds, adhocPanelMembers: mergedAdhoc });
}

// ── Main handler ──────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method;

  // ── GET: list all interviews for a candidate ──────────────────────────────
  if (method === 'GET') {
    const candidateId = event.pathParameters?.id;
    if (!candidateId) return badRequest('Missing candidateId');
    try {
      const result = await dynamo.send(new QueryCommand({
        TableName: process.env.STATE_TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${candidateId}`, ':prefix': 'INTERVIEW#' }),
      }));
      const interviews = (result.Items || [])
        .map((i) => { const { PK, SK, ...rest } = unmarshall(i); return rest; })
        .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
      return ok({ interviews });
    } catch (err) {
      console.error('GET interviews: query failed', { candidateId, error: err.message });
      return serverError('Failed to fetch interviews');
    }
  }

  if (method === 'PATCH') {
    const body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
    if (body.action === 'complete') return handleCompleteInterview(event);
    return handleAddPanelMembers(event);
  }

  // ── POST: schedule a new interview ───────────────────────────────────────────

  let detail;
  if (event.detail) {
    detail = event.detail;
  } else if (event.body != null) {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    const pathCandidateId = event.pathParameters?.id;
    detail = { ...body, candidateId: body.candidateId || pathCandidateId };
  } else {
    detail = event;
  }

  const {
    candidateId, tenantId, interviewId, interviewType, scheduledAt,
    panelMemberIds, adhocPanelMembers,
  } = detail;

  const missing = ['candidateId', 'tenantId', 'interviewId', 'interviewType', 'scheduledAt']
    .filter((f) => detail[f] == null);
  if (missing.length > 0) return badRequest(`Missing required fields: ${missing.join(', ')}`);

  const systemIds = Array.isArray(panelMemberIds)   ? panelMemberIds   : [];
  const adhocList = Array.isArray(adhocPanelMembers) ? adhocPanelMembers : [];

  if (systemIds.length === 0 && adhocList.length === 0) {
    return badRequest('At least one panel member (system user or ad hoc) is required');
  }

  // ── Step 2: Read SAGA — verify stage and positionLevel ────────────────────
  let saga;
  try {
    const sagaResult = await dynamo.send(new GetItemCommand({
      TableName: process.env.STATE_TABLE_NAME,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
    }));
    if (!sagaResult.Item) return notFound(`Candidate ${candidateId} not found`);
    saga = unmarshall(sagaResult.Item);
  } catch (err) {
    console.error('Failed to read SAGA record', { candidateId, error: err.message });
    return serverError('Failed to read candidate record');
  }

  if (saga.currentStage !== 'INTERVIEWING') {
    return conflict(
      `Interviews can only be scheduled when the candidate is in INTERVIEWING stage. ` +
      `Current stage: ${saga.currentStage}. Advance the candidate to INTERVIEWING first.`
    );
  }

  const positionLevel = saga.positionLevel;
  if (!VALID_POSITION_LEVELS.includes(positionLevel)) {
    return badRequest(`positionLevel must be one of: ${VALID_POSITION_LEVELS.join(', ')} — got: ${positionLevel}`);
  }

  // ── Step 3: Read active PANEL_CONFIG → votesRequired ─────────────────────
  let panelConfig;
  try {
    panelConfig = await getConfig(tenantId, 'PANEL_CONFIG');
  } catch (err) {
    console.error('Failed to read PANEL_CONFIG', { tenantId, error: err.message });
    return serverError('Failed to read panel configuration');
  }

  const votesRequired = panelConfig?.rules?.votesRequired?.[positionLevel];
  if (votesRequired == null) {
    console.error('votesRequired not found for positionLevel', { positionLevel, panelConfig });
    return serverError(`votesRequired not configured for positionLevel: ${positionLevel}`);
  }

  const now = new Date().toISOString();

  // ── Step 4: Write INTERVIEW# record ──────────────────────────────────────
  const interviewItem = {
    PK: `CANDIDATE#${candidateId}`,
    SK: `INTERVIEW#${interviewId}`,
    interviewId,
    candidateId,
    tenantId,
    interviewType,
    scheduledAt,
    panelMemberIds: systemIds,
    ...(adhocList.length > 0 ? { adhocPanelMembers: adhocList } : {}),
    votesRequired,
    votesSubmitted: 0,
    status: 'SCHEDULED',
    createdAt: now,
  };

  try {
    await dynamo.send(new PutItemCommand({
      TableName: process.env.STATE_TABLE_NAME,
      Item: marshall(interviewItem, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.warn('Interview record already exists — idempotent skip', { interviewId });
    } else {
      console.error('Failed to write interview record', { interviewId, error: err.message });
      return serverError('Failed to write interview record');
    }
  }

  // ── Step 5: Update SAGA currentInterviewId (tracks most recent interview) ─
  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: process.env.STATE_TABLE_NAME,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
      UpdateExpression: 'SET currentInterviewId = :iid',
      ExpressionAttributeValues: marshall({ ':iid': interviewId }),
    }));
  } catch (err) {
    console.error('Failed to update SAGA currentInterviewId', { candidateId, error: err.message });
  }

  // ── Step 6: Write timeline audit entry ───────────────────────────────────
  try {
    await dynamo.send(new PutItemCommand({
      TableName: process.env.STATE_TABLE_NAME,
      Item: marshall({
        PK: `CANDIDATE#${candidateId}`,
        SK: `AUDIT#${now}`,
        eventType: 'INTERVIEW_SCHEDULED',
        interviewId,
        interviewType,
        scheduledAt,
        tenantId,
        createdAt: now,
      }, { removeUndefinedValues: true }),
    }));
  } catch (err) {
    console.error('Failed to write timeline audit entry', { candidateId, error: err.message });
  }

  // ── Step 7: Enqueue notification for each system panel member ─────────────
  for (const recipientId of systemIds) {
    try {
      await sqs.send(new SendMessageCommand({
        QueueUrl: process.env.NOTIFICATION_QUEUE_URL,
        MessageBody: JSON.stringify({
          type: 'INTERVIEW_SCHEDULED',
          recipientId,
          candidateId,
          scheduledAt,
          interviewId,
          interviewType,
        }),
        MessageGroupId: candidateId,
        MessageDeduplicationId: `${interviewId}#${recipientId}`,
      }));
    } catch (err) {
      console.error('Failed to enqueue notification', { recipientId, interviewId, error: err.message });
    }
  }

  console.info('Interview scheduled', {
    interviewId, candidateId, tenantId, interviewType, positionLevel, votesRequired,
    panelSize: systemIds.length, adhocCount: adhocList.length,
  });

  return ok({ interviewId, candidateId, interviewType, votesRequired, status: 'SCHEDULED' });
};
