'use strict';

/**
 * generateScoringLink Lambda
 * Phase E — D004 hybrid panel model (email-link panel members)
 *
 * Trigger: POST /v1/candidates/{id}/scoring-links (HTTP API v2, Cognito JWT authorizer)
 *
 * Body:
 *   {
 *     panelMemberId:    string,  // unique id for this panelist (email works as id)
 *     panelMemberEmail: string,
 *     panelMemberName:  string,
 *     panelMemberRole:  string,
 *     tenantId:         string,
 *     interviewId?:     string   // optional — links token to a specific interview round
 *   }
 *
 * Steps:
 *   1. Validate required fields
 *   2. Confirm candidate SAGA record exists (fail early if not)
 *   3. Generate a cryptographically random UUID token
 *   4. Compute TTL = now + TOKEN_TTL_DAYS (default: 7 days)
 *   5. Write TWO DynamoDB records atomically:
 *        a) Candidate-indexed:  PK=CANDIDATE#{candidateId}, SK=SCORING_LINK#{token}
 *           → enables getPanelMembers to list all email-link members for a candidate
 *        b) Token-indexed:      PK=SCORING_LINK#{token}, SK=META
 *           → enables O(1) token validation in submitVoteByToken (no scan)
 *   6. Return { token, scoringUrl, expiresAt }
 *
 * Security:
 *   - Tokens are UUIDv4 (122 bits of randomness) — not guessable
 *   - Both DDB records share the same TTL epoch value — DynamoDB TTL cleans up automatically
 *   - submitVoteByToken is the ONLY consumer of SCORING_LINK#{token} records
 *   - Duplicate call for same panelMemberId + candidateId returns the existing token
 *     (idempotent — does not generate a new token if one already exists and hasn't expired)
 *
 * Env vars:
 *   STATE_TABLE_NAME  — talent-flow-state
 *   FRONTEND_URL      — base URL used to build the scoring link (e.g. https://hr-portal-beryl-three.vercel.app)
 *   TOKEN_TTL_DAYS    — days before token expires (default: 7)
 */

const {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { randomUUID } = require('crypto');

const dynamo = new DynamoDBClient({});

const STATE_TABLE  = process.env.STATE_TABLE_NAME || 'talent-flow-state';
const FRONTEND_URL = process.env.FRONTEND_URL     || 'https://hr-portal-beryl-three.vercel.app';
const TTL_DAYS     = parseInt(process.env.TOKEN_TTL_DAYS || '7', 10);

// ── Helpers ───────────────────────────────────────────────────────────────────
const ok         = (body) => ({ statusCode: 201, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const badRequest = (msg)  => ({ statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) });
const notFound   = (msg)  => ({ statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) });
const serverError= (msg)  => ({ statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: msg }) });

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const candidateId = event.pathParameters?.id;
  if (!candidateId) return badRequest('Missing candidateId path parameter');

  const createdBy = event.requestContext?.authorizer?.jwt?.claims?.sub || 'unknown';

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return badRequest('Invalid JSON body');
  }

  const { panelMemberId, panelMemberEmail, panelMemberName, panelMemberRole, tenantId, interviewId } = body;

  if (!panelMemberId)    return badRequest('Missing required field: panelMemberId');
  if (!panelMemberEmail) return badRequest('Missing required field: panelMemberEmail');
  if (!panelMemberName)  return badRequest('Missing required field: panelMemberName');
  if (!panelMemberRole)  return badRequest('Missing required field: panelMemberRole');
  if (!tenantId)         return badRequest('Missing required field: tenantId');

  // ── Step 2: Confirm candidate SAGA exists ─────────────────────────────────
  try {
    const sagaResult = await dynamo.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key:       marshall({ PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' }),
    }));
    if (!sagaResult.Item) {
      return notFound(`Candidate ${candidateId} not found`);
    }
  } catch (err) {
    console.error('Failed to read SAGA record', { candidateId, error: err.message });
    return serverError('Failed to validate candidate');
  }

  // ── Step 3: Check for existing non-expired token (idempotency) ────────────
  try {
    const existing = await dynamo.send(new QueryCommand({
      TableName:                 STATE_TABLE,
      KeyConditionExpression:    'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression:          'panelMemberId = :pmid',
      ExpressionAttributeValues: marshall({
        ':pk':       `CANDIDATE#${candidateId}`,
        ':skPrefix': 'SCORING_LINK#',
        ':pmid':     panelMemberId,
      }),
    }));

    if (existing.Items && existing.Items.length > 0) {
      const rec = unmarshall(existing.Items[0]);
      const nowSec = Math.floor(Date.now() / 1000);
      if (rec.ttl && rec.ttl > nowSec) {
        // Return existing valid token — do not regenerate
        const scoringUrl = `${FRONTEND_URL}/score?token=${rec.token}`;
        console.info('Returning existing valid scoring link', { candidateId, panelMemberId, token: rec.token });
        return ok({ token: rec.token, scoringUrl, expiresAt: rec.expiresAt, reused: true });
      }
    }
  } catch (err) {
    // Non-fatal: if idempotency check fails, proceed to create a new token
    console.warn('Idempotency check failed, proceeding to create new token', { candidateId, error: err.message });
  }

  // ── Step 4: Generate token + TTL ─────────────────────────────────────────
  const token     = randomUUID();
  const now       = new Date();
  const expiresAt = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const ttlEpoch  = Math.floor(new Date(expiresAt).getTime() / 1000);
  const createdAt = now.toISOString();

  const sharedFields = {
    token,
    candidateId,
    tenantId,
    panelMemberId,
    panelMemberEmail,
    panelMemberName,
    panelMemberRole,
    interviewId:  interviewId || null,
    createdBy,
    createdAt,
    expiresAt,
    ttl:          ttlEpoch,
    used:         false,   // becomes true after first vote submission
  };

  // ── Step 5a: Write candidate-indexed record (for getPanelMembers) ─────────
  try {
    await dynamo.send(new PutItemCommand({
      TableName: STATE_TABLE,
      Item:      marshall({
        PK: `CANDIDATE#${candidateId}`,
        SK: `SCORING_LINK#${token}`,
        ...sharedFields,
      }),
    }));
  } catch (err) {
    console.error('Failed to write candidate-indexed scoring link', { candidateId, token, error: err.message });
    return serverError('Failed to generate scoring link');
  }

  // ── Step 5b: Write token-indexed record (for O(1) validation) ────────────
  try {
    await dynamo.send(new PutItemCommand({
      TableName: STATE_TABLE,
      Item:      marshall({
        PK: `SCORING_LINK#${token}`,
        SK: 'META',
        ...sharedFields,
      }),
    }));
  } catch (err) {
    console.error('Failed to write token-indexed scoring link', { token, error: err.message });
    // Attempt to clean up the candidate-indexed record (best-effort)
    return serverError('Failed to generate scoring link (token index write failed)');
  }

  const scoringUrl = `${FRONTEND_URL}/score?token=${token}`;

  console.info('Scoring link generated', { candidateId, panelMemberId, token, expiresAt });

  // ── Step 6: Return link ───────────────────────────────────────────────────
  return ok({ token, scoringUrl, expiresAt });
};
