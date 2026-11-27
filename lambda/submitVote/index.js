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
 *   5.  REC-02: a Strong No decides nothing. When the candidate's REJECTION_RULES say reviewVoteLevel is STRONG_NO,
 *         it adds one to strong_no_count on the candidate row (a flag for a person); no status or stage is written.
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
const { getConfig } = require('./config-reader');
const { tenantHelper, scopeWrite, eventTenant } = require('../shared/tf-tenant.js');

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
  // REC-07: the card's two routes.
  const rk = event.routeKey || event.requestContext?.routeKey;
  if (rk === 'POST /v1/interviews/{id}/votes') return (await import('./rec07.mjs')).vote(event);
  if (rk === 'GET /v1/candidates/{id}/scores') return (await import('./rec07.mjs')).sheet(event);
  if (rk === 'GET /v1/interviews/{id}') return (await import('./read.mjs')).read(event);
  // TEN-03: a person calling the API gets the company from the sign-in. The VoteSubmitted event has none: it names
  // its company in tenant_id. The company is never read from the body, query, path or headers.
  const T = await tenantHelper();
  // REC-01: a person votes as themselves (the voter is the sign-in, never the body) and only on an interview whose panel
  // they are on. The VoteSubmitted event is the system, not a person: it keeps naming its voter.
  const RA = await import('../shared/recruitment-access.mjs');
  const byPerson = !!event.requestContext;
  let tenantId;
  if (event.requestContext) {
    const t = T.requireTenant(event);
    if (t.refusal) return t.refusal;
    // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
    const { requireModule } = await import('../shared/modules.mjs');
    const moduleOff = await requireModule(event, 'recruitment');
    if (moduleOff) return moduleOff;
    tenantId = t.tenantId;
  } else {
    tenantId = await eventTenant(event.detail || event);
    if (!tenantId) {
      console.warn('submitVote: event skipped, it names no company');
      return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
    }
  }

  // Extract userId from JWT claims for action tracking (INTEL-001)
  // Only available when called via API Gateway (not EventBridge)
  const userId = T.userIdOf(event);

  const message = event.detail || event.body
    ? (event.detail || (typeof event.body === 'string' ? JSON.parse(event.body) : event.body))
    : event;

  const { scores, rating, interviewId, submittedByTA } = message || {};
  // A person's vote is made on the candidate's own route (/v1/candidates/{id}/votes): the path names the candidate when the body does not.
  const candidateId = (byPerson ? event.pathParameters?.id : undefined) ?? message?.candidateId;
  // The voter: the signed-in person (a person never names one), or, for the VoteSubmitted event, the voter it names.
  const voterId = byPerson ? RA.callerId(event) : message?.voterId;
  if (byPerson && !voterId) return RA.forbidden();

  // ── Step 1: Validate required fields ─────────────────────────────────────
  if (!candidateId) return badRequest('Missing required field: candidateId');
  // A person's vote on a candidate is made on that candidate's own route.
  if (byPerson && event.pathParameters?.id && message?.candidateId && event.pathParameters.id !== message.candidateId) return badRequest('candidateId does not match the route');
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
    if (!result.Item) return T.notFound();
    saga = unmarshall(result.Item);
    if (!T.ownsRow(saga, tenantId)) return T.notFound();
  } catch (err) {
    console.error('Failed to read SAGA record', { candidateId, error: err.message });
    return serverError('Failed to read candidate record');
  }

  // The interview row is read once, before anything else is written.
  let interviewRow = null;
  if (interviewId) {
    try {
      const res = await dynamo.send(new GetItemCommand({
        TableName: STATE_TABLE,
        Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: `INTERVIEW#${interviewId}` }),
      }));
      interviewRow = res.Item ? unmarshall(res.Item) : null;
    } catch (err) {
      console.error('Failed to read interview record', { candidateId, interviewId, error: err.name });
      return serverError('Failed to read interview record');
    }
  }

  // ── REC-01: a person must be on the panel of the interview they vote on ──────────────────────────────────────
  // The interview must be named and must be this candidate's. Not on its panel (a Recruiter included) is 403, and
  // nothing is written.
  if (byPerson) {
    if (!interviewId) return RA.forbidden();
    if (!interviewRow || !T.ownsRow(interviewRow, tenantId) || !RA.panelMemberOf(interviewRow, voterId)) return RA.forbidden();
  }

  // INT-01 (M-1, R-12, R-13): an interview booked the new way is scored on the new route only. Nothing is written.
  if (interviewRow && T.ownsRow(interviewRow, tenantId) && interviewRow.sequence !== undefined && interviewRow.sequence !== null) {
    if (byPerson) return { statusCode: 409, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Conflict', code: 'USE_NEW_ROUTE' }) };
    console.warn('submitVote: event skipped', { error: 'USE_NEW_ROUTE' });
    return { statusCode: 200, body: JSON.stringify({ skipped: true }) };
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

  // ── Step 5: a Strong No raises a flag, never an outcome (REC-02) ──────────
  // REJECTION_RULES is the candidate's locked version. null in the company's settings means nothing is flagged.
  const strongNoFlag = rating === 'STRONG_NO' && (await strongNoReview(tenantId, saga));

  // ── Step 6: Calculate weighted score ─────────────────────────────────────
  const weights = scoringWeights;
  // REC-02: a score that is not a number (the Standard pack carries no weights yet; REC-07 rebuilds the maths) is stored empty,
  // because DynamoDB refuses NaN and the vote must still be recorded.
  const rawScore = calculateWeightedScore(scores, weights);
  const weightedScore = Number.isFinite(rawScore) ? rawScore : null;

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
      Item: marshall(T.stampTenant({
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
        submittedByTA:    byPerson ? null : (submittedByTA || null), // a person votes as themselves: nobody else entered it (REC-07 adds HR entering for a member)
        updatedBy:        userId || undefined,  // INTEL-001: Track who submitted the vote for action tracking
      }, tenantId), { removeUndefinedValues: true }),
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

  // ── Step 7b: the Strong No flag (REC-02): a number for a person to look at, never a decision ──────────
  if (strongNoFlag) {
    try {
      await dynamo.send(new UpdateItemCommand(scopeWrite({
        TableName: STATE_TABLE,
        Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
        UpdateExpression: 'ADD strong_no_count :one',
        ExpressionAttributeValues: marshall({ ':one': 1 }),
      }, tenantId)));
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') return T.notFound();
      console.error('Failed to record the Strong No flag', { candidateId, error: err.name });
      return serverError('Failed to record the vote flag');
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
      const updateResult = await dynamo.send(new UpdateItemCommand(scopeWrite({
        TableName: STATE_TABLE,
        Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: `INTERVIEW#${interviewId}` }),
        UpdateExpression: 'ADD votesSubmitted :inc',
        ExpressionAttributeValues: marshall({ ':inc': 1 }),
        ReturnValues: 'ALL_NEW',
      }, tenantId)));
      if (updateResult.Attributes) {
        const updated = unmarshall(updateResult.Attributes);
        newVotesSubmitted = updated.votesSubmitted;
        votesRequired = updated.votesRequired ?? null;
      }
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') return T.notFound();
      console.error('Failed to increment votesSubmitted on INTERVIEW#', { candidateId, interviewId, error: err.message });
      return serverError('Failed to update vote counter');
    }
  } else {
    // Fallback: no interviewId provided — increment on SAGA (deprecated path)
    console.warn('submitVote called without interviewId — falling back to SAGA counter', { candidateId });
    try {
      const updateResult = await dynamo.send(new UpdateItemCommand(scopeWrite({
        TableName: STATE_TABLE,
        Key: marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
        UpdateExpression: 'ADD votesSubmitted :inc',
        ExpressionAttributeValues: marshall({ ':inc': 1 }),
        ReturnValues: 'UPDATED_NEW',
      }, tenantId)));
      newVotesSubmitted = updateResult.Attributes
        ? unmarshall(updateResult.Attributes).votesSubmitted
        : null;
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') return T.notFound();
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
        // A vote stored with no score (REC-02) is left out of the average.
        const allScores = voteQuery.Items.map((i) => unmarshall(i).weightedScore).filter((x) => Number.isFinite(x));
        averageScore = allScores.length > 0 ? allScores.reduce((sum, s) => sum + s, 0) / allScores.length : null;
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

// REC-02: does this candidate's REJECTION_RULES (the version locked to the candidate) ask for a Strong No to be flagged?
async function strongNoReview(tenantId, saga) {
  const { getRecruitmentSettings, DEFAULTS } = await import('../shared/recruitment-settings.mjs');
  const settings = await getRecruitmentSettings(tenantId, saga);
  const rules = settings.REJECTION_RULES ?? DEFAULTS.REJECTION_RULES;
  return rules.reviewVoteLevel === 'STRONG_NO';
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
          tenant_id:       tenantId,
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
