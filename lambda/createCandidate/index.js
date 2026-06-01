'use strict';

/**
 * lambda/createCandidate/index.js
 *
 * Entry point for all TalentFlow workflows.
 *
 * Flow (9 steps per NH-118):
 *   1. Extract idempotencyKey from body (required)
 *   2. Check talent-flow-idempotency-keys — return early on COMPLETED, 409 on IN_PROGRESS
 *   3. Write IN_PROGRESS to idempotency table (TTL 48hr)
 *   4. Validate required body fields
 *   5. Generate candidateId = CAND-{ulid()}
 *   6. Write SAGA record to talent-flow-state (configVersion=null — orchestrator sets it)
 *   7. Publish CandidateCreated to talent-flow-bus
 *   8. Mark idempotency key COMPLETED with candidateId
 *   9. Return 201 with candidateId
 *
 * DO NOT set configVersion here.
 * DO NOT write to any Naleko tables.
 * DO NOT skip idempotency check.
 */

const { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { ulid } = require('ulid');

const dynamo = new DynamoDBClient({});
const eb = new EventBridgeClient({});

const STATE_TABLE       = process.env.STATE_TABLE_NAME;        // talent-flow-state
const IDEMPOTENCY_TABLE = process.env.IDEMPOTENCY_TABLE_NAME;  // talent-flow-idempotency-keys
const EVENT_BUS_NAME    = process.env.EVENTBRIDGE_BUS_NAME;    // talent-flow-bus

const VALID_POSITION_LEVELS = ['JUNIOR', 'MID', 'SENIOR'];
const IDEMPOTENCY_TTL_SECONDS = 48 * 60 * 60; // 48 hours

// ─── Response helpers ─────────────────────────────────────────────────────────

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  };
}

function ok(candidateId) {
  return respond(201, { candidateId });
}

function alreadyExists(candidateId) {
  return respond(200, { candidateId, message: 'Duplicate request — candidate already created.' });
}

function conflict(message) {
  return respond(409, { error: message });
}

function badRequest(message, missing) {
  return respond(400, missing ? { error: message, missing } : { error: message });
}

function internalError(message) {
  return respond(500, { error: message });
}

// ─── Handler ─────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  console.info('createCandidate invoked', { path: event.path, method: event.httpMethod });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return badRequest('Request body is not valid JSON');
  }

  // ── Step 1: idempotencyKey is required ────────────────────────────────────
  const { idempotencyKey } = body;
  if (!idempotencyKey) {
    return badRequest('idempotencyKey is required in request body');
  }

  // ── Step 2: Check idempotency table ──────────────────────────────────────
  let existingItem;
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: IDEMPOTENCY_TABLE,
      Key: marshall({ idempotencyKey }),
    }));
    existingItem = result.Item ? unmarshall(result.Item) : null;
  } catch (err) {
    console.error('Idempotency check failed', { error: err.message });
    return internalError('Failed to check idempotency key');
  }

  if (existingItem) {
    if (existingItem.status === 'COMPLETED') {
      console.info('Duplicate request — returning existing candidateId', {
        idempotencyKey,
        candidateId: existingItem.candidateId,
      });
      return alreadyExists(existingItem.candidateId);
    }
    if (existingItem.status === 'IN_PROGRESS') {
      return conflict('A concurrent request with the same idempotencyKey is already in progress');
    }
  }

  // ── Step 3: Write IN_PROGRESS (conditional — race-safe) ──────────────────
  const ttlValue = Math.floor(Date.now() / 1000) + IDEMPOTENCY_TTL_SECONDS;
  try {
    await dynamo.send(new PutItemCommand({
      TableName: IDEMPOTENCY_TABLE,
      Item: marshall({
        idempotencyKey,
        status: 'IN_PROGRESS',
        ttl: ttlValue,
        createdAt: new Date().toISOString(),
      }),
      ConditionExpression: 'attribute_not_exists(idempotencyKey)',
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return conflict('A concurrent request with the same idempotencyKey is already in progress');
    }
    console.error('Failed to write idempotency IN_PROGRESS', { error: err.message });
    return internalError('Failed to reserve idempotency key');
  }

  // ── Step 4: Validate required fields ─────────────────────────────────────
  const requiredFields = ['firstName', 'lastName', 'email', 'positionTitle', 'positionLevel', 'tenantId'];
  const missingFields = requiredFields.filter(f => !body[f]);
  if (missingFields.length > 0) {
    return badRequest('Missing required fields', missingFields);
  }

  const { firstName, lastName, email, positionTitle, positionLevel, tenantId } = body;

  // Optional fields — stored when provided, omitted when absent (removeUndefinedValues handles this)
  const phone           = body.phone           || undefined;
  const department      = body.department      || undefined;
  const location        = body.location        || undefined;
  const source          = body.source          || undefined;
  const experienceYears   = body.experienceYears != null ? body.experienceYears : undefined;
  const hiringManagerId   = body.hiringManagerId   || undefined;

  if (!VALID_POSITION_LEVELS.includes(positionLevel)) {
    return badRequest(`positionLevel must be one of: ${VALID_POSITION_LEVELS.join(', ')}`);
  }

  // ── Step 5: Generate candidateId ─────────────────────────────────────────
  const candidateId = `CAND-${ulid()}`;

  // ── Step 6: Write SAGA record to talent-flow-state ────────────────────────
  // configVersion is intentionally OMITTED — orchestrateTalentFlowWorkflow sets it
  // via attribute_not_exists(configVersion) condition. Writing null would create a
  // DynamoDB NULL-type attribute that satisfies attribute_exists, causing orchestrate
  // to skip with "already locked" on every invocation.
  const now = new Date().toISOString();
  const sagaRecord = {
    PK: `CANDIDATE#${candidateId}`,
    SK: 'SAGA',
    GSI1PK: `TENANT#${tenantId}`,
    GSI1SK: `SAGA#${now}`,
    candidateId,
    tenantId,
    firstName,
    lastName,
    email,
    phone,
    positionTitle,
    positionLevel,
    department,
    location,
    experienceYears,
    source,
    hiringManagerId,
    appliedDate: now,  // date the candidate was added to the system
    currentStage: 'APPLICATION_REVIEW',
    stageEnteredAt: now,
    status: 'ACTIVE',
    slaStatus: 'ON_TRACK',
    configVersion: undefined,  // omitted — orchestrateTalentFlowWorkflow sets it via attribute_not_exists condition
    createdAt: now,
  };

  try {
    await dynamo.send(new PutItemCommand({
      TableName: STATE_TABLE,
      Item: marshall(sagaRecord, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
  } catch (err) {
    console.error('Failed to write SAGA record', { candidateId, error: err.message });
    return internalError('Failed to create candidate record');
  }

  // ── Step 7: Publish CandidateCreated to talent-flow-bus ──────────────────
  // source = 'talent-flow.candidates' (confirmed in talent-flow-eventbridge.tf rule 1)
  try {
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: EVENT_BUS_NAME,
        Source: 'talent-flow.candidates',
        DetailType: 'CandidateCreated',
        Detail: JSON.stringify({ candidateId, tenantId, positionLevel, positionTitle, email }),
      }],
    }));
  } catch (err) {
    // Log but do not fail — event delivery is best-effort at this layer;
    // missing event will be detected by SLA monitor TTL breach.
    console.error('EventBridge publish failed', { candidateId, error: err.message });
  }

  // ── Step 8: Mark idempotency key COMPLETED ────────────────────────────────
  try {
    await dynamo.send(new UpdateItemCommand({
      TableName: IDEMPOTENCY_TABLE,
      Key: marshall({ idempotencyKey }),
      UpdateExpression: 'SET #s = :completed, candidateId = :cid',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: marshall({ ':completed': 'COMPLETED', ':cid': candidateId }),
    }));
  } catch (err) {
    // Non-fatal — idempotency TTL will clean up; candidate was successfully created
    console.warn('Failed to mark idempotency COMPLETED', { idempotencyKey, candidateId, error: err.message });
  }

  // ── Step 9: Return 201 ────────────────────────────────────────────────────
  console.info('Candidate created successfully', { candidateId, tenantId, positionLevel });
  return ok(candidateId);
};
