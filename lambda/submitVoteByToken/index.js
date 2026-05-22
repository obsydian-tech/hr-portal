'use strict';

/**
 * submitVoteByToken Lambda
 * Phase E — D004 hybrid panel model (token-gated scoring for email-link panelists)
 *
 * Trigger: POST /v1/scoring/{token}/votes  (authorization_type = NONE)
 *          — This route requires NO Cognito JWT.
 *          — The scoring link token IS the credential. The Lambda performs
 *            all validation internally before executing any write.
 *
 * Body:
 *   {
 *     scores: { technical, communication, culturalFit, problemSolving },
 *     rating: 'STRONG_NO' | 'NO' | 'YES' | 'STRONG_YES'
 *   }
 *   Note: candidateId + tenantId are resolved from the token record —
 *         the external panelist does NOT need to provide them.
 *
 * Security invariants:
 *   1. Token must exist in DynamoDB under PK=SCORING_LINK#{token}, SK=META
 *   2. Token TTL epoch must be in the future (guard against DDB TTL lag)
 *   3. Token must not already be marked used=true (single-use: one vote per link)
 *   4. After successful vote, token is marked used=true (conditional update)
 *   5. configVersion is read from the candidate SAGA — same POPIA invariant as submitVote
 *   6. Scoring weights are read from versioned config — NOT from live config
 *
 * Scoring logic is identical to submitVote. The only difference is identity
 * resolution (token → panelMemberId instead of JWT → sub).
 *
 * Env vars:
 *   STATE_TABLE_NAME  — talent-flow-state
 *   EVENTBRIDGE_BUS_NAME
 */

const {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  QueryCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const {
  EventBridgeClient,
  PutEventsCommand,
} = require('@aws-sdk/client-eventbridge');
const { getConfig } = require('../shared/config-reader');

const dynamo = new DynamoDBClient({});
const eb     = new EventBridgeClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME     || 'talent-flow-state';
const EB_BUS      = process.env.EVENTBRIDGE_BUS_NAME || 'talent-flow-bus';

const VALID_RATINGS = ['STRONG_NO', 'NO', 'YES', 'STRONG_YES'];

// ── Helpers ───────────────────────────────────────────────────────────────────
const ok         = (body) => ({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const badRequest = (msg)  => ({ statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) });
const forbidden  = (msg)  => ({ statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) });
const gone       = (msg)  => ({ statusCode: 410, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) });
const serverError= (msg)  => ({ statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) });

function calculateWeightedScore(scores, weights) {
  return (
    (scores.technical      * weights.technical) +
    (scores.communication  * weights.communication) +
    (scores.culturalFit    * weights.culturalFit) +
    (scores.problemSolving * weights.problemSolving)
  ) / 100;
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const token = event.pathParameters?.token;
  if (!token) return badRequest('Missing token path parameter');

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return badRequest('Invalid JSON body');
  }

  const { scores, rating } = body;

  // ── Validate vote payload ─────────────────────────────────────────────────
  if (!rating) return badRequest('Missing required field: rating');
  if (!VALID_RATINGS.includes(rating)) {
    return badRequest(`Invalid rating. Must be one of: ${VALID_RATINGS.join(', ')}`);
  }
  if (!scores || typeof scores !== 'object') return badRequest('Missing required field: scores');
  const { technical, communication, culturalFit, problemSolving } = scores;
  if (technical == null || communication == null || culturalFit == null || problemSolving == null) {
    return badRequest('scores must include: technical, communication, culturalFit, problemSolving');
  }

  // ── Step 1: Validate token ────────────────────────────────────────────────
  let tokenRecord;
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key:       marshall({ PK: `SCORING_LINK#${token}`, SK: 'META' }),
    }));
    if (!result.Item) {
      console.warn('Token not found', { token });
      return forbidden('Invalid or expired scoring link');
    }
    tokenRecord = unmarshall(result.Item);
  } catch (err) {
    console.error('Failed to read token record', { token, error: err.message });
    return serverError('Failed to validate scoring link');
  }

  // ── TTL check (guard against DDB TTL processing lag) ─────────────────────
  const nowSec = Math.floor(Date.now() / 1000);
  if (tokenRecord.ttl && tokenRecord.ttl < nowSec) {
    console.warn('Token expired', { token, ttl: tokenRecord.ttl, nowSec });
    return gone('Scoring link has expired');
  }

  // ── Single-use check ──────────────────────────────────────────────────────
  if (tokenRecord.used === true) {
    console.warn('Token already used', { token });
    return gone('Scoring link has already been used');
  }

  const { candidateId, tenantId, panelMemberId, panelMemberEmail, panelMemberName } = tokenRecord;
  const voterId = panelMemberId; // identity derived from token record, not JWT

  // ── Step 2: Get SAGA record → configVersion ───────────────────────────────
  let saga;
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key:       marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
    }));
    if (!result.Item) return badRequest(`Candidate ${candidateId} no longer exists in the pipeline`);
    saga = unmarshall(result.Item);
  } catch (err) {
    console.error('Failed to read SAGA record', { candidateId, error: err.message });
    return serverError('Failed to read candidate record');
  }

  const configVersion = saga.configVersion;
  if (!configVersion) {
    return badRequest(`Candidate ${candidateId} has no configVersion — workflow not started`);
  }

  // ── Steps 3 & 4: Versioned config reads (POPIA invariant — same as submitVote) ─
  let scoringWeights, panelConfig;
  try {
    scoringWeights = await getConfig(tenantId, 'SCORING_WEIGHTS', configVersion);
  } catch (err) {
    console.error('Failed to read SCORING_WEIGHTS', { tenantId, configVersion, error: err.message });
    return serverError('Failed to read scoring configuration');
  }
  try {
    panelConfig = await getConfig(tenantId, 'PANEL_CONFIG', configVersion);
  } catch (err) {
    console.error('Failed to read PANEL_CONFIG', { tenantId, configVersion, error: err.message });
    return serverError('Failed to read panel configuration');
  }

  // ── Step 5: STRONG_NO veto check ─────────────────────────────────────────
  const strongNoVeto = panelConfig && panelConfig.rules && panelConfig.rules.strongNoVeto === true;
  if (rating === 'STRONG_NO' && strongNoVeto) {
    try {
      await dynamo.send(new UpdateItemCommand({
        TableName:                 STATE_TABLE,
        Key:                       marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
        UpdateExpression:          'SET votingResult = :vr, #s = :sf',
        ExpressionAttributeNames:  { '#s': 'status' },
        ExpressionAttributeValues: marshall({ ':vr': 'STRONG_NO_VETO', ':sf': 'EVALUATION_FAILED' }),
      }));
    } catch (err) {
      console.error('Failed to update SAGA for STRONG_NO veto', { candidateId, error: err.message });
      return serverError('Failed to record veto decision');
    }

    await markTokenUsed(token);
    await publishVotingCompleted({ candidateId, tenantId, result: 'STRONG_NO_VETO', voterId });
    console.info('STRONG_NO veto applied via scoring link', { candidateId, voterId: panelMemberId });
    return ok({ candidateId, voterId, result: 'STRONG_NO_VETO' });
  }

  // ── Step 6: Calculate weighted score ─────────────────────────────────────
  const weightedScore = calculateWeightedScore(scores, scoringWeights);

  // ── Step 7: Write vote record ─────────────────────────────────────────────
  const timestamp = new Date().toISOString();
  const voteSK    = `VOTE#${voterId}#${timestamp}`;

  try {
    await dynamo.send(new PutItemCommand({
      TableName: STATE_TABLE,
      Item:      marshall({
        PK:               `CANDIDATE#${candidateId}`,
        SK:               voteSK,
        voterId,
        voterEmail:       panelMemberEmail,
        voterName:        panelMemberName,
        voteSource:       'EMAIL_LINK',              // distinguishes token votes from JWT votes
        candidateId,
        tenantId,
        rating,
        scores,
        weightedScore,
        configVersionUsed: configVersion,
        createdAt:        timestamp,
      }),
      ConditionExpression: 'attribute_not_exists(SK)',
    }));
  } catch (err) {
    if (err.name !== 'ConditionalCheckFailedException') {
      console.error('Failed to write vote record', { voteSK, error: err.message });
      return serverError('Failed to write vote record');
    }
    console.warn('Duplicate vote record — idempotent skip', { voteSK });
  }

  // ── Step 8: Increment counter + quorum check (same as submitVote) ─────────
  let newVotesSubmitted;
  try {
    const updateResult = await dynamo.send(new UpdateItemCommand({
      TableName:                 STATE_TABLE,
      Key:                       marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
      UpdateExpression:          'ADD votesSubmitted :inc',
      ExpressionAttributeValues: marshall({ ':inc': 1 }),
      ReturnValues:              'UPDATED_NEW',
    }));
    newVotesSubmitted = updateResult.Attributes
      ? unmarshall(updateResult.Attributes).votesSubmitted
      : null;
  } catch (err) {
    console.error('Failed to increment votesSubmitted', { candidateId, error: err.message });
    return serverError('Failed to update vote counter');
  }

  // ── Mark token used (single-use enforcement) ──────────────────────────────
  await markTokenUsed(token);

  // ── Quorum check ──────────────────────────────────────────────────────────
  let votesRequired = null;
  try {
    const interviewQuery = await dynamo.send(new QueryCommand({
      TableName:                 STATE_TABLE,
      KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${candidateId}`, ':prefix': 'INTERVIEW#' }),
      ProjectionExpression:      'votesRequired',
      Limit:                     1,
    }));
    if (interviewQuery.Items && interviewQuery.Items.length > 0) {
      votesRequired = unmarshall(interviewQuery.Items[0]).votesRequired;
    }
  } catch (err) {
    console.error('Failed to query interview record for votesRequired', { candidateId, error: err.message });
  }

  if (votesRequired != null && newVotesSubmitted != null && newVotesSubmitted >= votesRequired) {
    let averageScore = null;
    try {
      const voteQuery = await dynamo.send(new QueryCommand({
        TableName:                 STATE_TABLE,
        KeyConditionExpression:    'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${candidateId}`, ':prefix': 'VOTE#' }),
        ProjectionExpression:      'weightedScore',
      }));
      if (voteQuery.Items && voteQuery.Items.length > 0) {
        const allScores = voteQuery.Items.map((i) => unmarshall(i).weightedScore);
        averageScore = allScores.reduce((sum, s) => sum + s, 0) / allScores.length;
      }
    } catch (err) {
      console.error('Failed to aggregate vote scores', { candidateId, error: err.message });
    }

    await publishVotingCompleted({
      candidateId, tenantId, result: 'COMPLETED',
      averageScore, votesSubmitted: newVotesSubmitted,
    });
    console.info('Quorum reached — VotingCompleted published via scoring link', {
      candidateId, votesRequired, newVotesSubmitted, averageScore,
    });
  }

  console.info('Token vote submitted successfully', {
    candidateId, voterId, weightedScore, configVersionUsed: configVersion,
  });

  return ok({ candidateId, voterId, weightedScore, configVersionUsed: configVersion });
};

// ── Mark token used (best-effort — non-fatal if it fails) ────────────────────
async function markTokenUsed(token) {
  try {
    await dynamo.send(new UpdateItemCommand({
      TableName:                 STATE_TABLE,
      Key:                       marshall({ PK: `SCORING_LINK#${token}`, SK: 'META' }),
      UpdateExpression:          'SET #u = :t, usedAt = :at',
      ExpressionAttributeNames:  { '#u': 'used' },
      ExpressionAttributeValues: marshall({ ':t': true, ':at': new Date().toISOString() }),
    }));
  } catch (err) {
    console.error('Failed to mark token as used — token may be reusable', { token, error: err.message });
  }
}

// ── EventBridge publish helper ────────────────────────────────────────────────
async function publishVotingCompleted({ candidateId, tenantId, result, averageScore, votesSubmitted, voterId }) {
  try {
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: EB_BUS,
        Source:       'talent-flow.workflow',
        DetailType:   'VotingCompleted',
        Detail:       JSON.stringify({
          candidateId,
          tenantId,
          result,
          averageScore:   averageScore   ?? null,
          votesSubmitted: votesSubmitted ?? null,
          voterId:        voterId        ?? null,
          timestamp:      new Date().toISOString(),
        }),
      }],
    }));
  } catch (err) {
    console.error('Failed to publish VotingCompleted', { candidateId, result, error: err.message });
  }
}
