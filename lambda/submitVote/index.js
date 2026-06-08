'use strict';

/**
 * submitVote Lambda
 * NH-124 — BE-008
 *
 * Trigger: EventBridge talent-flow.workflow / VoteSubmitted
 *          (also reachable via POST /candidates/{id}/votes through API GW)
 *
 * Implementation spec (8 steps):
 *   1.  Extract candidateId, tenantId, voterId, scores, rating from event.detail
 *   2.  GetItem SAGA record → extract configVersion
 *   3.  getConfig(tenantId, 'SCORING_WEIGHTS', configVersion) — VERSIONED
 *   4.  getConfig(tenantId, 'PANEL_CONFIG',    configVersion) — VERSIONED
 *   5.  STRONG_NO veto check (before scoring):
 *         if rating === 'STRONG_NO' && panelConfig.rules.strongNoVeto === true
 *           → UpdateItem SAGA: votingResult=STRONG_NO_VETO, status=EVALUATION_FAILED
 *           → Publish VotingCompleted with result=STRONG_NO_VETO
 *           → Return early
 *   6.  Calculate weightedScore = Σ(score[dim] * weight[dim]) / 100
 *   7.  PutItem vote record PK=CANDIDATE#{id}, SK=VOTE#{voterId}#{timestamp}
 *         Fields: score, weightedScore, rating, scores, voterId, configVersionUsed
 *   8.  Atomic UpdateItem ADD votesSubmitted :1 on SAGA
 *         → Query interview record for votesRequired
 *         → If votesSubmitted + 1 >= votesRequired:
 *             Query all VOTE# records, average weightedScore
 *             Publish VotingCompleted with averageScore
 *
 * Compliance invariant #2 (non-negotiable):
 *   BOTH getConfig calls MUST use candidate.configVersion — NEVER active.
 *   Retroactive score changes are a POPIA compliance violation.
 *   configVersionUsed is stored on every vote record for audit traceability.
 *
 * EventBridge publish source: talent-flow.workflow (Hard-Won Lesson 7a)
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

const dynamo  = new DynamoDBClient({});
const eb      = new EventBridgeClient({});

const STATE_TABLE  = process.env.STATE_TABLE_NAME;
const EB_BUS       = process.env.EVENTBRIDGE_BUS_NAME;

const VALID_RATINGS = ['STRONG_NO', 'NO', 'YES', 'STRONG_YES'];

// ── Response helpers ──────────────────────────────────────────────────────────
const ok          = (body) => ({ statusCode: 200, body: JSON.stringify(body) });
const badRequest  = (msg)  => ({ statusCode: 400, body: JSON.stringify({ error: msg }) });
const serverError = (msg)  => ({ statusCode: 500, body: JSON.stringify({ error: msg }) });

// ── Weighted score calculation ────────────────────────────────────────────────
/**
 * @param {object} scores  { technical, communication, culturalFit, problemSolving }
 * @param {object} weights { technical, communication, culturalFit, problemSolving } — sum to 100
 * @returns {number} weighted score (0-10 scale assuming input scores are 0-10)
 */
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
  // Extract userId from JWT claims for action tracking (INTEL-001)
  // Only available when called via API Gateway (not EventBridge)
  const userId = event.requestContext?.authorizer?.jwt?.claims?.sub;

  const detail = event.detail || event.body
    ? (event.detail || (typeof event.body === 'string' ? JSON.parse(event.body) : event.body))
    : event;

  const { candidateId, tenantId, voterId, scores, rating, interviewId, submittedByTA } = detail || {};

  // ── Step 1: Validate required fields ─────────────────────────────────────
  if (!candidateId) return badRequest('Missing required field: candidateId');
  if (!tenantId)    return badRequest('Missing required field: tenantId');
  if (!voterId)     return badRequest('Missing required field: voterId');
  if (!rating)      return badRequest('Missing required field: rating');
  if (!VALID_RATINGS.includes(rating)) {
    return badRequest(`Invalid rating: ${rating}. Must be one of: ${VALID_RATINGS.join(', ')}`);
  }
  if (!scores || typeof scores !== 'object') return badRequest('Missing required field: scores');
  const { technical, communication, culturalFit, problemSolving } = scores;
  if (technical == null || communication == null || culturalFit == null || problemSolving == null) {
    return badRequest('scores must include: technical, communication, culturalFit, problemSolving');
  }

  // ── Step 2: Get SAGA record → configVersion ────────────────────────────────
  let saga;
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
    }));
    if (!result.Item) {
      return badRequest(`SAGA record not found for candidate ${candidateId}`);
    }
    saga = unmarshall(result.Item);
  } catch (err) {
    console.error('Failed to read SAGA record', { candidateId, error: err.message });
    return serverError('Failed to read candidate record');
  }

  const configVersion = saga.configVersion;
  if (!configVersion) {
    return badRequest(`SAGA record for candidate ${candidateId} has no configVersion — workflow not started`);
  }

  // ── Steps 3 & 4: Versioned config reads (CRITICAL invariant #2) ───────────
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

  // ── Step 5: STRONG_NO veto check (runs BEFORE score calculation) ──────────
  const strongNoVeto = panelConfig && panelConfig.rules && panelConfig.rules.strongNoVeto === true;
  if (rating === 'STRONG_NO' && strongNoVeto) {
    try {
      const updateExpr = userId
        ? 'SET votingResult = :vr, #s = :sf, updatedBy = :uid'
        : 'SET votingResult = :vr, #s = :sf';
      const attrValues = userId
        ? marshall({ ':vr': 'STRONG_NO_VETO', ':sf': 'EVALUATION_FAILED', ':uid': userId })
        : marshall({ ':vr': 'STRONG_NO_VETO', ':sf': 'EVALUATION_FAILED' });

      await dynamo.send(new UpdateItemCommand({
        TableName: STATE_TABLE,
        Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
        UpdateExpression: updateExpr,
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: attrValues,
      }));
    } catch (err) {
      console.error('Failed to update SAGA for STRONG_NO_VETO', { candidateId, error: err.message });
      return serverError('Failed to record veto decision');
    }

    await publishVotingCompleted({ candidateId, tenantId, result: 'STRONG_NO_VETO', voterId });
    console.info('STRONG_NO veto applied', { candidateId, voterId });
    return ok({ candidateId, voterId, result: 'STRONG_NO_VETO' });
  }

  // ── Step 6: Calculate weighted score ─────────────────────────────────────
  const weights = scoringWeights;
  const weightedScore = calculateWeightedScore(scores, weights);

  // ── Duplicate vote check (per voter per interview) ────────────────────────
  // Prevents the same panelist from submitting multiple votes on the same interview.
  if (interviewId) {
    try {
      const existing = await dynamo.send(new QueryCommand({
        TableName: STATE_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :votePrefix)',
        FilterExpression:       'interviewId = :iid',
        ExpressionAttributeValues: marshall({
          ':pk':         `CANDIDATE#${candidateId}`,
          ':votePrefix': `VOTE#${voterId}#`,
          ':iid':        interviewId,
        }),
        ProjectionExpression: 'SK',
        Limit: 1,
      }));
      if ((existing.Items?.length ?? 0) > 0) {
        console.info('Duplicate vote rejected', { candidateId, voterId, interviewId });
        return { statusCode: 409, body: JSON.stringify({ error: 'You have already submitted a vote for this interview.' }) };
      }
    } catch (err) {
      console.error('Duplicate vote check failed', { candidateId, voterId, interviewId, error: err.message });
      return serverError('Failed to validate vote submission');
    }
  }

  // ── Step 7: Write vote record ─────────────────────────────────────────────
  const timestamp = new Date().toISOString();
  const voteSK = `VOTE#${voterId}#${timestamp}`;

  try {
    await dynamo.send(new PutItemCommand({
      TableName: STATE_TABLE,
      Item: marshall({
        PK:               `CANDIDATE#${candidateId}`,
        SK:               voteSK,
        voterId,
        candidateId,
        tenantId,
        interviewId:      interviewId  || null,
        rating,
        scores,
        weightedScore,
        configVersionUsed: configVersion,
        createdAt:        timestamp,
        submittedByTA:    submittedByTA || null,
        updatedBy:        userId || undefined,  // INTEL-001: Track who submitted the vote for action tracking
      }, { removeUndefinedValues: true }),
      ConditionExpression: 'attribute_not_exists(SK)',
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.warn('Duplicate vote record — idempotent skip', { voteSK });
    } else {
      console.error('Failed to write vote record', { voteSK, error: err.message });
      return serverError('Failed to write vote record');
    }
  }

  // ── Step 8: Atomic counter increment + quorum check ───────────────────────
  // Increment votesSubmitted on the specific INTERVIEW# record so each interview
  // tracks its own vote count independently. votesRequired is read back from the
  // same record (stored at scheduling time from active PANEL_CONFIG).
  let newVotesSubmitted = null;
  let votesRequired = null;

  if (interviewId) {
    try {
      const updateResult = await dynamo.send(new UpdateItemCommand({
        TableName: STATE_TABLE,
        Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: `INTERVIEW#${interviewId}` }),
        UpdateExpression: 'ADD votesSubmitted :inc',
        ExpressionAttributeValues: marshall({ ':inc': 1 }),
        ReturnValues: 'ALL_NEW',
      }));
      if (updateResult.Attributes) {
        const updated = unmarshall(updateResult.Attributes);
        newVotesSubmitted = updated.votesSubmitted;
        votesRequired = updated.votesRequired ?? null;
      }
    } catch (err) {
      console.error('Failed to increment votesSubmitted on INTERVIEW#', { candidateId, interviewId, error: err.message });
      return serverError('Failed to update vote counter');
    }
  } else {
    // Fallback: no interviewId provided — increment on SAGA (deprecated path)
    console.warn('submitVote called without interviewId — falling back to SAGA counter', { candidateId });
    try {
      const updateResult = await dynamo.send(new UpdateItemCommand({
        TableName: STATE_TABLE,
        Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
        UpdateExpression: 'ADD votesSubmitted :inc',
        ExpressionAttributeValues: marshall({ ':inc': 1 }),
        ReturnValues: 'UPDATED_NEW',
      }));
      newVotesSubmitted = updateResult.Attributes
        ? unmarshall(updateResult.Attributes).votesSubmitted
        : null;
    } catch (err) {
      console.error('Failed to increment votesSubmitted on SAGA', { candidateId, error: err.message });
      return serverError('Failed to update vote counter');
    }
    votesRequired = panelConfig?.rules?.votesRequired?.[saga.positionLevel] ?? null;
  }

  // ── Publish VotingCompleted if quorum met ─────────────────────────────────
  if (votesRequired != null && newVotesSubmitted != null && newVotesSubmitted >= votesRequired) {
    let averageScore = null;
    try {
      const voteQuery = await dynamo.send(new QueryCommand({
        TableName: STATE_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: marshall({
          ':pk':     `CANDIDATE#${candidateId}`,
          ':prefix': 'VOTE#',
        }),
        ProjectionExpression: 'weightedScore',
      }));
      if (voteQuery.Items && voteQuery.Items.length > 0) {
        const allScores = voteQuery.Items.map((i) => unmarshall(i).weightedScore);
        averageScore = allScores.reduce((sum, s) => sum + s, 0) / allScores.length;
      }
    } catch (err) {
      console.error('Failed to aggregate vote scores', { candidateId, error: err.message });
      // Non-fatal — publish VotingCompleted without averageScore
    }

    await publishVotingCompleted({
      candidateId, tenantId, result: 'COMPLETED',
      averageScore, votesSubmitted: newVotesSubmitted,
    });
    console.info('Quorum reached — VotingCompleted published', {
      candidateId, votesRequired, newVotesSubmitted, averageScore,
    });
  }

  console.info('Vote submitted successfully', {
    candidateId, voterId, weightedScore, configVersionUsed: configVersion,
  });

  return ok({ candidateId, voterId, weightedScore, configVersionUsed: configVersion });
};

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
          averageScore:    averageScore   ?? null,
          votesSubmitted:  votesSubmitted ?? null,
          voterId:         voterId        ?? null,
          timestamp:       new Date().toISOString(),
        }),
      }],
    }));
  } catch (err) {
    // Non-fatal: vote record and SAGA already written; log and continue
    console.error('Failed to publish VotingCompleted', { candidateId, result, error: err.message });
  }
}

// ── Exported for testing ──────────────────────────────────────────────────────
exports._calculateWeightedScore = calculateWeightedScore;
