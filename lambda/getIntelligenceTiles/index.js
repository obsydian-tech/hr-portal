/**
 * getIntelligenceTiles Lambda — Phase 6.2.5
 *
 * Fetches signal snapshots and returns intelligence tiles for dashboard display.
 * Tiles are projections over precomputed signal snapshots (§10.2).
 *
 * Query patterns:
 *   - By tenant: PK = TENANT#{tenantId}#SNAP
 *   - By owner (via GSI1): GSI1PK = OWNER#{ownerId}#{role}
 *
 * INTEL-002 Phase 6.2.5
 */

const { DynamoDBClient, QueryCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamoDB = new DynamoDBClient({});
const STATE_TABLE = process.env.STATE_TABLE_NAME || 'talent-flow-state';

// Tile generation thresholds
const THRESHOLDS = {
  OFFER_EXPIRY_URGENT: 3,    // Days - urgent if expiring in 3 days
  FINAL_SCORE_HIGH: 85,      // Score - high performer threshold
  DAYS_STALE: 14,            // Days - candidate stale threshold
};

// Stage labels for human-readable display
const STAGE_LABELS = {
  APPLICATION_REVIEW: 'Application Review',
  INTERVIEWING: 'Interviewing',
  EVALUATION: 'Evaluation',
  BACKGROUND_CHECK: 'Background Check',
  OFFER_PREPARATION: 'Offer Preparation',
  OFFER_APPROVAL: 'Offer Approval',
  OFFER_DELIVERY: 'Offer Delivery',
  CONTRACT_SIGNING: 'Contract Signing',
  PRE_BOARDING: 'Pre-Boarding',
  ONBOARDING: 'Onboarding',
};

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  console.info('[getIntelligenceTiles] Invoked', {
    path: event.path,
    queryParams: event.queryStringParameters,
  });

  try {
    const params = event.queryStringParameters || {};
    const tenantId = params.tenantId || 'DEFAULT';
    const role = params.role; // TA | HM | IT
    const ownerId = params.ownerId;
    const limit = parseInt(params.limit, 10) || 20;

    // Fetch signal snapshots
    const snapshots = await fetchSnapshots(tenantId, { ownerId, role, limit });

    // Generate tiles from snapshots
    const tiles = generateTiles(snapshots);

    // Sort by priority (CRITICAL > HIGH > MEDIUM > LOW)
    const sortedTiles = sortTilesByPriority(tiles);

    return response(200, {
      tiles: sortedTiles.slice(0, limit),
      total: sortedTiles.length,
      tenantId,
    });
  } catch (err) {
    console.error('[getIntelligenceTiles] Error', { error: err.message });
    return response(500, { error: 'Failed to fetch intelligence tiles' });
  }
};

/**
 * Fetch signal snapshots from DynamoDB
 */
async function fetchSnapshots(tenantId, opts = {}) {
  const { ownerId, role, limit = 50 } = opts;

  // If ownerId provided, use GSI1 for scoped query
  if (ownerId && role) {
    const result = await dynamoDB.send(new QueryCommand({
      TableName: STATE_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': { S: `OWNER#${ownerId}#${role}` },
      },
      Limit: limit,
      ScanIndexForward: false, // Most recent first
    }));

    return (result.Items || []).map(item => unmarshall(item));
  }

  // Otherwise, query by tenant snapshot partition
  const result = await dynamoDB.send(new QueryCommand({
    TableName: STATE_TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': { S: `TENANT#${tenantId}#SNAP` },
      ':sk': { S: 'CAND#' },
    },
    Limit: limit,
  }));

  return (result.Items || []).map(item => unmarshall(item));
}

/**
 * Generate intelligence tiles from signal snapshots
 * Applies business rules to create actionable tiles
 */
function generateTiles(snapshots) {
  const tiles = [];

  for (const snapshot of snapshots) {
    if (!snapshot.signals) continue;

    const signals = snapshot.signals;
    const entityName = snapshot.entityName || 'Unknown';

    // Rule 1: SLA Breached (CRITICAL)
    if (signals.SLA_STATUS === 'BREACHED') {
      tiles.push(createTile(snapshot, {
        priority: 'CRITICAL',
        title: 'SLA Breached',
        description: `${entityName} has breached SLA threshold — immediate action required`,
        ruleId: 'RULE-SLA-001',
      }));
    }

    // Rule 2: SLA At Risk (HIGH)
    else if (signals.SLA_STATUS === 'AT_RISK') {
      tiles.push(createTile(snapshot, {
        priority: 'HIGH',
        title: 'SLA At Risk',
        description: `${entityName} is approaching SLA threshold`,
        ruleId: 'RULE-SLA-002',
      }));
    }

    // Rule 3: Offer Expiring Soon (CRITICAL/HIGH)
    const daysToExpiry = signals.OFFER_DAYS_TO_EXPIRY;
    if (daysToExpiry !== null && daysToExpiry !== undefined &&
        daysToExpiry <= THRESHOLDS.OFFER_EXPIRY_URGENT && daysToExpiry >= 0) {
      tiles.push(createTile(snapshot, {
        priority: daysToExpiry <= 1 ? 'CRITICAL' : 'HIGH',
        title: 'Offer Expiring Soon',
        description: `Offer for ${entityName} expires in ${daysToExpiry} day${daysToExpiry !== 1 ? 's' : ''}`,
        ruleId: 'RULE-OFFER-001',
      }));
    }

    // Rule 4: High Score Candidate Ready (MEDIUM)
    const finalScore = signals.FINAL_SCORE;
    if (finalScore !== null && finalScore !== undefined && finalScore >= THRESHOLDS.FINAL_SCORE_HIGH) {
      tiles.push(createTile(snapshot, {
        priority: 'MEDIUM',
        title: 'Strong Candidate Ready',
        description: `${entityName} scored ${finalScore}% — ready for decision`,
        ruleId: 'RULE-HIPO-001',
      }));
    }

    // Rule 5: Engagement Falling (HIGH)
    const engagementSentiment = signals.ENGAGEMENT_SENTIMENT;
    if (engagementSentiment === 'HESITANT' || engagementSentiment === 'DISENGAGED') {
      tiles.push(createTile(snapshot, {
        priority: 'HIGH',
        title: 'Engagement Falling',
        description: `${entityName} showing ${engagementSentiment.toLowerCase()} signals`,
        ruleId: 'RULE-DROP-001',
      }));
    }

    // Rule 6: Evaluation Failed (MEDIUM)
    if (signals.EVALUATION_RESULT === 'FAILED') {
      tiles.push(createTile(snapshot, {
        priority: 'MEDIUM',
        title: 'Evaluation Failed',
        description: `${entityName} did not pass evaluation — review recommended`,
        ruleId: 'RULE-EVAL-001',
      }));
    }
  }

  return tiles;
}

/**
 * Create a tile object from snapshot and rule metadata
 */
function createTile(snapshot, opts) {
  const signals = snapshot.signals || {};

  return {
    id: `tile-${snapshot.entityId}-${opts.ruleId}`,
    priority: opts.priority,
    title: opts.title,
    description: opts.description,
    entityType: snapshot.entityType,
    entityId: snapshot.entityId,
    entityName: snapshot.entityName || 'Unknown',
    currentStage: snapshot.currentStage,
    signals: extractDisplaySignals(snapshot),
    actions: getDefaultActions(snapshot),
    createdAt: snapshot.computedAt,
    ruleId: opts.ruleId,
  };
}

/**
 * Extract displayable signal pills for tile
 */
function extractDisplaySignals(snapshot) {
  const signals = [];
  const s = snapshot.signals || {};

  if (snapshot.currentStage) {
    signals.push({
      label: 'Stage',
      value: STAGE_LABELS[snapshot.currentStage] || snapshot.currentStage,
      type: 'info',
    });
  }

  if (s.SLA_STATUS) {
    signals.push({
      label: 'SLA',
      value: s.SLA_STATUS,
      type: s.SLA_STATUS === 'BREACHED' ? 'error' : s.SLA_STATUS === 'AT_RISK' ? 'warning' : 'success',
    });
  }

  if (s.FINAL_SCORE !== null && s.FINAL_SCORE !== undefined) {
    const score = s.FINAL_SCORE;
    signals.push({
      label: 'Score',
      value: `${score}%`,
      type: score >= 85 ? 'success' : score >= 60 ? 'info' : 'warning',
    });
  }

  return signals;
}

/**
 * Get default actions for a tile
 */
function getDefaultActions(snapshot) {
  return [
    {
      id: 'view',
      label: 'View',
      icon: 'pi pi-eye',
      type: 'primary',
      route: `/platform/talentflow/candidates/${snapshot.entityId}`,
    },
  ];
}

/**
 * Sort tiles by priority
 */
function sortTilesByPriority(tiles) {
  const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return [...tiles].sort((a, b) =>
    (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4)
  );
}

/**
 * Build HTTP response
 */
function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify(body),
  };
}
