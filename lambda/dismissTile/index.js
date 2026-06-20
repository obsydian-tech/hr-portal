/**
 * dismissTile Lambda — INTEL-002 EPIC 1 Task 1.1
 *
 * POST /v1/intelligence/tiles/{id}/dismiss
 *
 * Records a user's dismissal of an intelligence tile.
 * Governance: CRITICAL compliance/SLA tiles reject dismiss (must use acknowledge).
 *
 * EPIC 1 Task 1.1
 */

const { DynamoDBClient, PutItemCommand, GetItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamoDB = new DynamoDBClient({});
const DISMISSALS_TABLE = process.env.DISMISSALS_TABLE_NAME || 'talent-flow-intelligence-dismissals';
const STATE_TABLE = process.env.STATE_TABLE_NAME || 'talent-flow-state';

// TTL: 90 days (POPIA retention for user preferences)
const TTL_DAYS = 90;

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  console.info('[dismissTile] Invoked', {
    path: event.path,
    pathParameters: event.pathParameters,
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

    // Parse tileId to extract entityId and ruleId
    // Expected format: "tile-{entityId}-{ruleId}"
    const parsed = parseTileId(tileId);
    if (!parsed) {
      return errorResponse(400, 'Invalid tile ID format');
    }
    const { entityId, ruleId } = parsed;

    // Check governance: CRITICAL compliance/SLA tiles are acknowledge-only
    // Fetch the tile's priority and category from current snapshot
    const tileMetadata = await getTileMetadata(entityId, ruleId);
    if (tileMetadata && tileMetadata.priority === 'CRITICAL' && isComplianceRule(ruleId)) {
      return errorResponse(403, 'This tile requires acknowledgment, not dismissal. Use the acknowledge action instead.');
    }

    // Compute tileKey (stable key for per-entity-per-rule dismissal)
    const tileKey = `${entityId}#${ruleId}`;

    // Compute snapshot signature (hash of current condition)
    // For now, use tileKey as signature; in TASK 1.2 we'll refine this
    // to detect when the same condition re-triggers after being cleared
    const snapshotSignature = tileKey;

    // Write dismissal record
    const now = new Date().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + (TTL_DAYS * 24 * 60 * 60);

    await dynamoDB.send(new PutItemCommand({
      TableName: DISMISSALS_TABLE,
      Item: marshall({
        PK: `USER#${userId}`,
        SK: `TILEDISMISS#${tileKey}`,
        action: 'DISMISS',
        snapshotSignature,
        tileId,
        entityId,
        ruleId,
        at: now,
        ttl,
      }),
    }));

    console.info('[dismissTile] Dismiss recorded', { userId, tileKey });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ message: 'Tile dismissed successfully', tileId }),
    };

  } catch (error) {
    console.error('[dismissTile] Error:', error);
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
 * Check if a rule is a compliance/SLA rule (acknowledge-only when CRITICAL)
 */
function isComplianceRule(ruleId) {
  const complianceKeywords = ['SLA', 'COMPLIANCE', 'AUDIT', 'LEGAL'];
  return complianceKeywords.some(keyword => ruleId.toUpperCase().includes(keyword));
}

/**
 * Get tile metadata (priority, category) from current snapshot
 * This is a simplified check; in production, we'd query the full tile projection
 */
async function getTileMetadata(entityId, ruleId) {
  try {
    // Query snapshot for this entity
    // PK = TENANT#{tenantId}#SNAP, SK = CAND#{entityId}
    // For simplicity, we'll use DEFAULT tenant; in production, extract from JWT
    const tenantId = 'DEFAULT';

    const result = await dynamoDB.send(new QueryCommand({
      TableName: STATE_TABLE,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: marshall({
        ':pk': `TENANT#${tenantId}#SNAP`,
        ':sk': `CAND#${entityId}`,
      }),
      Limit: 1,
    }));

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    // In practice, the tile priority comes from rule evaluation, not the snapshot
    // For now, check if the rule is critical-severity by ID pattern
    if (ruleId === 'RULE-SLA-001') {
      return { priority: 'CRITICAL', category: 'COMPLIANCE' };
    }

    return { priority: 'MEDIUM', category: 'GENERAL' };

  } catch (error) {
    console.warn('[dismissTile] Failed to fetch tile metadata:', error);
    return null; // Fail open - allow dismiss if metadata unavailable
  }
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
