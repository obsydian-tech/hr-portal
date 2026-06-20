/**
 * snoozeTile Lambda — INTEL-002 EPIC 1 Task 1.1
 *
 * POST /v1/intelligence/tiles/{id}/snooze
 * Body: { "hours": number }
 *
 * Records a user's snooze of an intelligence tile with a wake-up time.
 * Governance: All tiles can be snoozed (including CRITICAL).
 *
 * EPIC 1 Task 1.1
 */

const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const dynamoDB = new DynamoDBClient({});
const DISMISSALS_TABLE = process.env.DISMISSALS_TABLE_NAME || 'talent-flow-intelligence-dismissals';

// TTL: 90 days (POPIA retention for user preferences)
const TTL_DAYS = 90;

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  console.info('[snoozeTile] Invoked', {
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

    // Parse request body
    const body = JSON.parse(event.body || '{}');
    const hours = parseInt(body.hours, 10);

    if (!hours || hours < 1 || hours > 8760) { // Max 1 year
      return errorResponse(400, 'Invalid snooze duration. Must be between 1 and 8760 hours.');
    }

    // Parse tileId to extract entityId and ruleId
    const parsed = parseTileId(tileId);
    if (!parsed) {
      return errorResponse(400, 'Invalid tile ID format');
    }
    const { entityId, ruleId } = parsed;

    // Compute tileKey
    const tileKey = `${entityId}#${ruleId}`;

    // Compute snapshotSignature (for now, use tileKey)
    const snapshotSignature = tileKey;

    // Compute snoozeUntil timestamp
    const now = new Date();
    const snoozeUntil = new Date(now.getTime() + (hours * 60 * 60 * 1000)).toISOString();
    const ttl = Math.floor(Date.now() / 1000) + (TTL_DAYS * 24 * 60 * 60);

    // Write snooze record
    await dynamoDB.send(new PutItemCommand({
      TableName: DISMISSALS_TABLE,
      Item: marshall({
        PK: `USER#${userId}`,
        SK: `TILEDISMISS#${tileKey}`,
        action: 'SNOOZE',
        snoozeUntil,
        snapshotSignature,
        tileId,
        entityId,
        ruleId,
        at: now.toISOString(),
        ttl,
      }),
    }));

    console.info('[snoozeTile] Snooze recorded', { userId, tileKey, snoozeUntil });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        message: 'Tile snoozed successfully',
        tileId,
        snoozeUntil
      }),
    };

  } catch (error) {
    console.error('[snoozeTile] Error:', error);
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
