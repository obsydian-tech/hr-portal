/**
 * Intelligence Snapshot Writer - §10.2 Latest-Signals Snapshot
 *
 * Writes per-entity signal snapshots for tile projections.
 * Tiles are NOT stored records - they are projections over snapshots.
 *
 * Schema:
 *   PK: TENANT#<tenantId>#SNAP
 *   SK: CAND#<candidateId> | OFFER#<offerId>
 *
 * GSI1 (ByOwner):
 *   GSI1PK: OWNER#<recruiterId>#<role>
 *   GSI1SK: <computedAt>
 *
 * INTEL-002 Phase 6.1.2
 */

const { PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const STATE_TABLE = process.env.STATE_TABLE_NAME || 'talent-flow-state';

/**
 * Write a signal snapshot for an entity
 * Overwrites on each stream event (always latest)
 *
 * @param {DynamoDBClient} dynamoDB - DynamoDB client instance
 * @param {Object} params - Snapshot parameters
 * @param {string} params.tenantId - Tenant identifier
 * @param {string} params.entityType - CANDIDATE | OFFER
 * @param {string} params.entityId - Entity identifier
 * @param {Object} params.signals - Calculated signal values
 * @param {Object} params.item - Original item data (for owner extraction)
 * @returns {Promise<{success: boolean, snapshotKey: string}>}
 */
async function writeSignalSnapshot(dynamoDB, { tenantId, entityType, entityId, signals, item }) {
  const computedAt = new Date().toISOString();

  // Determine SK prefix based on entity type
  const skPrefix = entityType === 'CANDIDATE' ? 'CAND' : 'OFFER';

  // Extract owner IDs for GSI queries
  const ownerIds = extractOwnerIds(item);

  // Primary owner for GSI1 (recruiter/TA)
  const primaryOwnerId = ownerIds.recruiterId || ownerIds.createdBy || 'UNKNOWN';
  const primaryOwnerRole = ownerIds.recruiterId ? 'TA' : 'SYSTEM';

  const snapshot = {
    // Primary Key
    PK: `TENANT#${tenantId}#SNAP`,
    SK: `${skPrefix}#${entityId}`,

    // GSI1: Query by owner (for dashboard tile queries)
    GSI1PK: `OWNER#${primaryOwnerId}#${primaryOwnerRole}`,
    GSI1SK: computedAt,

    // Entity Reference
    entityType,
    entityId,
    tenantId,

    // Computed Signals (all available signals)
    signals,

    // Composites (placeholder - will be populated in Phase 6.4)
    composites: {},

    // Owner IDs for filtering
    ownerIds,

    // Entity Context (for tile display)
    entityName: buildEntityName(item),
    currentStage: item.currentStage || null,
    positionTitle: item.positionTitle || null,

    // Timestamps
    computedAt,
    updatedAt: computedAt,

    // Record Type (for filtering in queries)
    recordType: 'SIGNAL_SNAPSHOT',
  };

  try {
    await dynamoDB.send(new PutItemCommand({
      TableName: STATE_TABLE,
      Item: marshall(snapshot, { removeUndefinedValues: true })
    }));

    console.info('[snapshot-writer] Signal snapshot written', {
      entityType,
      entityId,
      signalCount: Object.keys(signals).length,
      primaryOwner: primaryOwnerId
    });

    return {
      success: true,
      snapshotKey: `${snapshot.PK}|${snapshot.SK}`
    };
  } catch (err) {
    // Fail-open: snapshot write is advisory, don't block rule evaluation
    console.error('[snapshot-writer] Failed to write signal snapshot', {
      entityType,
      entityId,
      error: err.message
    });
    return {
      success: false,
      snapshotKey: `${snapshot.PK}|${snapshot.SK}`,
      error: err.message
    };
  }
}

/**
 * Extract owner IDs from item for scoped queries
 *
 * @param {Object} item - DynamoDB item (candidate or offer)
 * @returns {Object} Owner IDs { recruiterId, hiringManagerId, createdBy }
 */
function extractOwnerIds(item) {
  return {
    recruiterId: item.recruiterId || item.updatedBy || null,
    hiringManagerId: item.hiringManagerId || null,
    createdBy: item.createdBy || null,
  };
}

/**
 * Build human-readable entity name for tile display
 *
 * @param {Object} item - DynamoDB item
 * @returns {string|null} Entity name
 */
function buildEntityName(item) {
  // Candidate name
  if (item.firstName && item.lastName) {
    return `${item.firstName} ${item.lastName}`;
  }
  // Offer reference
  if (item.candidateName) {
    return item.candidateName;
  }
  return null;
}

module.exports = {
  writeSignalSnapshot,
  extractOwnerIds,
  buildEntityName
};
