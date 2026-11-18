/**
 * acknowledgeTile Lambda — INTEL-002 EPIC 1 Task 1.1
 *
 * POST /v1/intelligence/tiles/{id}/acknowledge
 * Body: { "reason"?: string } (optional)
 *
 * Records a user's acknowledgment of an intelligence tile.
 * Governance: All tiles can be acknowledged (including CRITICAL compliance tiles).
 * ACK is always recorded for audit trail.
 *
 * EPIC 1 Task 1.1
 */

const { DynamoDBClient, PutItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { tenantHelper, candidateIsOurs } = require('../shared/tf-tenant.js');

const dynamoDB = new DynamoDBClient({});
const DISMISSALS_TABLE = process.env.DISMISSALS_TABLE_NAME || 'talent-flow-intelligence-dismissals';

// TTL: 90 days (POPIA retention for user preferences)
const TTL_DAYS = 90;

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  // REC-01: only a Recruiter (HR with the Recruitment tick) may do this. The role answer comes first, before any AWS call.
  const RA = await import('../shared/recruitment-access.mjs');
  const notRecruiter = RA.requireRecruiter(event);
  if (notRecruiter) return notRecruiter;
  // TEN-03: the company comes from the sign-in only.
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;

  console.info('[acknowledgeTile] Invoked', {
    path: event.path,
    pathParameters: event.pathParameters,
    body: event.body,
  });

  try {
    // Extract path parameter
    const tileId = event.pathParameters?.id;
    if (!tileId) {
      return errorResponse(400, 'Missing tile ID in path');
    }

    // Extract userId from JWT claims
    const userId = event.requestContext?.authorizer?.jwt?.claims?.sub;
    if (!userId) {
      return errorResponse(401, 'Unauthorized: missing user ID in token');
    }

    // Parse request body (reason is optional)
    const body = JSON.parse(event.body || '{}');
    const reason = body.reason || null;

    // Parse tileId to extract entityId and ruleId
    const parsed = parseTileId(tileId);
    if (!parsed) {
      return errorResponse(400, 'Invalid tile ID format');
    }
    const { entityId, ruleId } = parsed;

    // A tile is judged through the candidate it names: another company's candidate is not found.
    if (entityId !== 'aggregate' && !(await candidateIsOurs((c) => dynamoDB.send(c), QueryCommand, process.env.STATE_TABLE_NAME || 'talent-flow-state', entityId, tenantId))) {
      return T.notFound();
    }

    // Compute tileKey
    const tileKey = `${entityId}#${ruleId}`;

    // Compute snapshotSignature (for now, use tileKey)
    const snapshotSignature = tileKey;

    // Write acknowledge record
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + (TTL_DAYS * 24 * 60 * 60);

    const item = {
      PK: `USER#${userId}`,
      SK: `TILEDISMISS#${tileKey}`,
      action: 'ACKNOWLEDGE',
      snapshotSignature,
      tileId,
      entityId,
      ruleId,
      at: now,
      ttl,
    };

    if (reason) {
      item.reason = reason;
    }

    await dynamoDB.send(new PutItemCommand({
      TableName: DISMISSALS_TABLE,
      Item: marshall(T.stampTenant(item, tenantId)),
    }));

    console.info('[acknowledgeTile] Acknowledgment recorded', { userId, tileKey });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        message: 'Tile acknowledged successfully',
        tileId
      }),
    };

  } catch (error) {
    console.error('[acknowledgeTile] Error:', error);
    return errorResponse(500, 'Internal server error');
  }
};

/**
 * Parse tileId into entityId and ruleId
 * Format: "tile-{entityId}-{ruleId}" or "{entityId}#{ruleId}"
 */
function parseTileId(tileId) {
  // Try format: "tile-CAND-123-RULE-SLA-001"
  const match1 = tileId.match(/^tile-(.+)-(RULE-[A-Z0-9-]+)$/);
  if (match1) {
    return { entityId: match1[1], ruleId: match1[2] };
  }

  // Try format: "CAND-123#RULE-SLA-001"
  const match2 = tileId.match(/^(.+)#(RULE-[A-Z0-9-]+)$/);
  if (match2) {
    return { entityId: match2[1], ruleId: match2[2] };
  }

  return null;
}

/**
 * CORS headers
 */
function corsHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

/**
 * Error response helper
 */
function errorResponse(statusCode, message) {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify({ error: message }),
  };
}
