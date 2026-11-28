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

const { DynamoDBClient, QueryCommand, ScanCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { getConfig } = require('./config-reader');
const { tenantHelper } = require('../shared/tf-tenant.js');

const dynamoDB = new DynamoDBClient({});
const STATE_TABLE = process.env.STATE_TABLE_NAME || 'talent-flow-state';
const DISMISSALS_TABLE = process.env.DISMISSALS_TABLE_NAME || 'talent-flow-intelligence-dismissals';

// Default tile generation thresholds (fallback if config unavailable)
// EPIC 1 Task 1.3: Now loaded from config; these are safe defaults
const DEFAULT_THRESHOLDS = {
  OFFER_EXPIRY_URGENT: 3,    // Days - urgent if expiring in 3 days
  FINAL_SCORE_HIGH: 85,      // Score - high performer threshold
  DAYS_STALE: 14,            // Days - candidate stale threshold
};

// Stage labels for human-readable display
const STAGE_LABELS = {
  APPLIED: 'Applied',
  SCREENING: 'Screening',
  INTERVIEW: 'Interview',
  OFFER: 'Offer',
  HIRED: 'Hired',
  NOT_HIRED: 'Not hired',
};

// REC-03: a snapshot may still hold an old stage name until its company's stage move has run, so stages are read through the one
// list. The shared file is an ES module: it is loaded once per run, before any tile is made. Until then a stage reads as stored.
let normaliseStage = (value) => (value && typeof value === 'object' ? value.currentStage : value);
const stageOf = (snapshot) => normaliseStage(snapshot);

/**
 * Lambda handler
 */
exports.handler = async (event) => {
  ({ normaliseStage } = await import('../shared/recruitment-stages.mjs'));
  // REC-01: a Recruiter reads every tile of the company; a manager only the tiles of the candidates they are hiring for;
  // everyone else gets 403. The role answer comes first, before any AWS call.
  const RA = await import('../shared/recruitment-access.mjs');
  const notAllowed = RA.requireRecruiterOrManager(event);
  if (notAllowed) return notAllowed;
  // TEN-03: the company comes from the sign-in only. tenantId in the query string is not read.
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;

  console.info('[getIntelligenceTiles] Invoked', { path: event.path });

  try {
    const params = event.queryStringParameters || {};
    const role = params.role; // TA | HM | IT
    const ownerId = params.ownerId;
    const limit = parseInt(params.limit, 10) || 100; // Increased from 20 to 100

    // EPIC 1 Task 1.3: Load config-driven thresholds
    let thresholds = DEFAULT_THRESHOLDS;
    try {
      const config = await getConfig(tenantId, 'INTELLIGENCE_RULES');
      if (config?.thresholds) {
        thresholds = { ...DEFAULT_THRESHOLDS, ...config.thresholds };
        console.info('[getIntelligenceTiles] Using config thresholds', { thresholds });
      }
    } catch (configError) {
      console.warn('[getIntelligenceTiles] Config load failed, using defaults', { error: configError.message });
    }

    // Fetch signal snapshots
    // A manager's tiles are picked from the company's snapshots afterwards, so they are read without the small page limit.
    let snapshots = await fetchSnapshots(T, tenantId, { ownerId, role, limit: RA.isRecruiter(event) ? limit : Math.max(limit, 1000) });

    // REC-01: a manager who is not a Recruiter sees only the tiles of the candidates they are the hiring manager of.
    // The candidate rows decide it, so nothing in the query (ownerId, role) can widen it.
    if (!RA.isRecruiter(event)) {
      const mine = await managedCandidateIds(T, tenantId, RA.callerId(event));
      snapshots = snapshots.filter((s) => s.entityType === 'CANDIDATE' && mine.has(s.entityId));
    }

    // Generate tiles from snapshots (with role filtering and config thresholds)
    const rawTiles = await tilesFromRules(T, tenantId, snapshots);
    console.info('[DEBUG] After generateTiles', { rawTileCount: rawTiles.length });

    // EPIC 1 Task 1.4: Aggregate-and-route tile model
    // Group tiles → aggregate by rule, promote top 1-3 CRITICAL to per-entity
    const tiles = applyAggregationModel(rawTiles, tenantId, role);
    console.info('[DEBUG] After aggregation', { tileCount: tiles.length });

    // EPIC 1 Task 1.2: Apply dismissal/snooze overlay
    // Extract userId from JWT claims
    const userId = T.userIdOf(event);

    // Fetch user's dismissal overlay (single query, no N+1)
    const dismissalOverlay = userId ? await fetchDismissalOverlay(T, tenantId, userId) : new Map();
    console.info('[DEBUG] Dismissal overlay', { userId, dismissedCount: dismissalOverlay.size });

    // Filter tiles based on dismissal overlay
    const visibleTiles = applyDismissalFilter(tiles, dismissalOverlay);
    console.info('[DEBUG] After dismissal filter', { visibleTileCount: visibleTiles.length });

    // Sort by priority (CRITICAL > HIGH > MEDIUM > LOW)
    const sortedTiles = sortTilesByPriority(visibleTiles);

    console.info('[getIntelligenceTiles] Generated tiles', {
      role,
      snapshotCount: snapshots.length,
      tileCount: sortedTiles.length,
    });

    return response(200, {
      tiles: sortedTiles.slice(0, limit),
      total: sortedTiles.length,
    });
  } catch (err) {
    console.error('[getIntelligenceTiles] Error', { error: err.message });
    return response(500, { error: 'Failed to fetch intelligence tiles' });
  }
};

/**
 * REC-01: the ids of the candidates of this company whose hiring manager is this person (the candidates' own rows).
 * An empty set when the caller has no person id.
 */
async function managedCandidateIds(T, tenantId, managerId) {
  const ids = new Set();
  if (!managerId) return ids;
  let startKey;
  do {
    const res = await dynamoDB.send(new QueryCommand({
      TableName: STATE_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :saga)',
      FilterExpression: 'hiringManagerId = :hm',
      ExpressionAttributeValues: {
        ':pk': { S: T.tenantKey(tenantId) },
        ':saga': { S: 'SAGA#' },
        ':hm': { S: managerId },
      },
      ...(startKey ? { ExclusiveStartKey: startKey } : {}),
    }));
    for (const item of res.Items || []) {
      const row = unmarshall(item);
      if (T.ownsRow(row, tenantId) && row.candidateId) ids.add(row.candidateId);
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return ids;
}

/**
 * Fetch signal snapshots from DynamoDB
 */
async function fetchSnapshots(T, tenantId, opts = {}) {
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

    return (result.Items || []).map(item => unmarshall(item)).filter(row => T.ownsRow(row, tenantId));
  }

  // Otherwise, query by tenant snapshot partition
  const result = await dynamoDB.send(new QueryCommand({
    TableName: STATE_TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': { S: T.tenantKey(tenantId, 'SNAP') },
      ':sk': { S: 'CAND#' },
    },
    Limit: limit,
  }));

  // Sort by computedAt (most recent first) since DynamoDB sorts by SK (alphabetical)
  const snapshots = (result.Items || []).map(item => unmarshall(item)).filter(row => T.ownsRow(row, tenantId));
  return snapshots.sort((a, b) => {
    const timeA = new Date(a.computedAt || 0).getTime();
    const timeB = new Date(b.computedAt || 0).getTime();
    return timeB - timeA; // Descending (newest first)
  });
}

/**
 * Fetch user's dismissal overlay (EPIC 1 Task 1.2)
 * Returns Map of tileKey → { action, snoozeUntil, snapshotSignature }
 * Single query per request (no N+1)
 */
async function fetchDismissalOverlay(T, tenantId, userId) {
  try {
    const result = await dynamoDB.send(new QueryCommand({
      TableName: DISMISSALS_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
      },
      Limit: 100, // Most users won't have more than 100 dismissals
    }));

    const overlay = new Map();
    for (const item of result.Items || []) {
      const record = unmarshall(item);
      if (!T.ownsRow(record, tenantId)) continue;
      // Extract tileKey from SK: "TILEDISMISS#{tileKey}"
      const tileKey = record.SK?.replace(/^TILEDISMISS#/, '');
      if (tileKey) {
        overlay.set(tileKey, {
          action: record.action,
          snoozeUntil: record.snoozeUntil,
          snapshotSignature: record.snapshotSignature,
        });
      }
    }

    return overlay;
  } catch (error) {
    console.warn('[fetchDismissalOverlay] Failed to fetch dismissals - showing all tiles', { error: error.message });
    return new Map(); // Fail open - show all tiles if dismissals unavailable
  }
}

/**
 * Apply aggregate-and-route tile model (EPIC 1 Task 1.4)
 * Groups tiles by rule → creates aggregate tiles with count + routeTarget
 * Promotes top 1-3 CRITICAL tiles to per-entity mode
 */
function applyAggregationModel(rawTiles, tenantId, role) {
  // Group tiles by ruleId
  const ruleGroups = new Map();
  for (const tile of rawTiles) {
    const ruleId = tile.ruleId || 'UNKNOWN';
    if (!ruleGroups.has(ruleId)) {
      ruleGroups.set(ruleId, []);
    }
    ruleGroups.get(ruleId).push(tile);
  }

  const resultTiles = [];

  // Process each rule group
  for (const [ruleId, tiles] of ruleGroups.entries()) {
    // If only 1-2 tiles, or all non-CRITICAL, keep as-is (per-entity)
    if (tiles.length <= 2) {
      for (const tile of tiles) {
        tile.mode = 'per-entity';
      }
      resultTiles.push(...tiles);
      continue;
    }

    // Multiple tiles (3+) → apply aggregation logic
    const criticalTiles = tiles.filter(t => t.priority === 'CRITICAL');
    const nonCriticalTiles = tiles.filter(t => t.priority !== 'CRITICAL');

    // Rank CRITICAL tiles by scoring function
    const rankedCritical = rankTiles(criticalTiles);

    // Promote top 1-3 CRITICAL to per-entity
    const promotedCount = Math.min(3, rankedCritical.length);
    for (let i = 0; i < promotedCount; i++) {
      rankedCritical[i].mode = 'per-entity';
      resultTiles.push(rankedCritical[i]);
    }

    // Aggregate the rest (remaining CRITICAL + all non-CRITICAL)
    const aggregateCandidates = [
      ...rankedCritical.slice(promotedCount),
      ...nonCriticalTiles,
    ];

    if (aggregateCandidates.length > 0) {
      // Create aggregate tile
      const firstTile = aggregateCandidates[0];
      const ruleName = ruleId;

      const aggregateTile = {
        id: `tile-aggregate-${ruleId}`,
        mode: 'aggregate',
        priority: firstTile.priority,
        title: ruleName,
        description: `${aggregateCandidates.length} items require attention`,
        entityType: firstTile.entityType,
        entityId: null, // No specific entity for aggregate
        entityName: null,
        currentStage: null,
        signals: [],
        actions: [
          {
            id: 'view-all',
            label: 'View All',
            icon: 'pi pi-list',
            type: 'primary',
            route: `/platform/talentflow/candidates`, // Will be enhanced with filters
          },
        ],
        createdAt: new Date().toISOString(),
        ruleId,
        count: aggregateCandidates.length,
        routeTarget: {
          view: 'candidates',
          filters: {
            ruleId,
            role,
          },
        },
      };

      resultTiles.push(aggregateTile);
    }
  }

  return resultTiles;
}

/**
 * Rank tiles by scoring function (§4.4 design)
 * score = severityWeight + businessImpactWeight + actionabilityWeight - ageDecay
 */
function rankTiles(tiles) {
  return [...tiles].sort((a, b) => {
    const scoreA = calculateTileScore(a);
    const scoreB = calculateTileScore(b);
    return scoreB - scoreA; // Descending
  });
}

/**
 * Calculate tile ranking score (§4.4 design)
 */
function calculateTileScore(tile) {
  // Severity weight
  const severityWeights = { CRITICAL: 100, HIGH: 60, MEDIUM: 30, LOW: 10 };
  let score = severityWeights[tile.priority] || 0;

  // Business impact weight (based on ruleId pattern)
  if (tile.ruleId?.includes('OFFER') || tile.ruleId?.includes('ONBOARD')) {
    score += 40; // Offer/onboarding highest impact
  } else if (tile.ruleId?.includes('SLA') || tile.ruleId?.includes('PROVISION')) {
    score += 30; // Time-sensitive operations
  } else if (tile.ruleId?.includes('EVAL') || tile.ruleId?.includes('DECISION')) {
    score += 20; // Decision points
  } else {
    score += 10; // Housekeeping/general
  }

  // Actionability weight (tiles with primary actions score higher)
  if (tile.actions?.some(a => a.type === 'primary')) {
    score += 15;
  }

  // Age decay (tiles older than 24h get slight penalty)
  const ageHours = (Date.now() - new Date(tile.createdAt).getTime()) / (1000 * 60 * 60);
  if (ageHours > 24) {
    score -= Math.min(20, Math.floor(ageHours / 24) * 2); // -2 per day, max -20
  }

  return score;
}

/**
 * Apply dismissal/snooze filter to tiles (EPIC 1 Task 1.2)
 * Filters out dismissed/snoozed tiles based on user's overlay
 */
function applyDismissalFilter(tiles, dismissalOverlay) {
  const now = new Date().toISOString();

  return tiles.filter(tile => {
    // Compute tileKey from tile.entityId and tile.ruleId
    const tileKey = `${tile.entityId}#${tile.ruleId}`;

    // Check if user has a dismissal record for this tileKey
    const dismissal = dismissalOverlay.get(tileKey);
    if (!dismissal) {
      return true; // No dismissal → show tile
    }

    // Compute current snapshotSignature (for now, use tileKey)
    // In future: hash of actual condition so recurring issues resurface
    const currentSignature = tileKey;

    // Check action type
    if (dismissal.action === 'DISMISS') {
      // Skip if signature matches (same condition still active)
      if (dismissal.snapshotSignature === currentSignature) {
        return false; // Hide tile
      }
      // If signature changed (condition cleared and re-triggered), show tile
      return true;
    }

    if (dismissal.action === 'SNOOZE') {
      // Skip if snooze window hasn't expired yet
      if (dismissal.snoozeUntil && now < dismissal.snoozeUntil) {
        return false; // Hide tile until snoozeUntil
      }
      // Snooze expired → show tile
      return true;
    }

    if (dismissal.action === 'ACKNOWLEDGE') {
      // Acknowledge doesn't hide the tile (just records user saw it)
      // Future: could add "don't show again" behavior for ACK
      return true;
    }

    // Unknown action → show tile
    return true;
  });
}

/**
 * REC-09 rule 1 and 5: a tile for every rule the candidate's locked INTELLIGENCE_RULES version holds and whose conditions hold now.
 * Numbers that depend on the time are worked out from the candidate's own row at this moment, never taken from a saved snapshot.
 */
async function tilesFromRules(T, tenantId, snapshots) {
  const S = await import('../shared/recruitment-settings.mjs');
  const { judge, RETIRED } = await import('../shared/intelligence-rules.mjs');
  const { flagTitle, dayName } = await import('../shared/flag-titles.mjs');
  const tiles = [];
  for (const snapshot of snapshots) {
    if (snapshot.entityType !== 'CANDIDATE' || !snapshot.signals) continue;
    const got = await dynamoDB.send(new GetItemCommand({ TableName: STATE_TABLE, Key: { PK: { S: `CANDIDATE#${snapshot.entityId}` }, SK: { S: 'SAGA' } } }));
    const saga = got.Item ? unmarshall(got.Item) : null;
    if (!saga || !T.ownsRow(saga, tenantId)) continue;
    const { settings } = await S.settingsForRead(tenantId, saga);
    const versions = await S.lockedVersions(tenantId, saga);
    const signals = { ...snapshot.signals, ...freshSignals(saga, settings) };
    for (const rule of settings.INTELLIGENCE_RULES?.rules ?? []) {
      if (!rule.enabled || RETIRED.includes(rule.id)) continue;
      const { matched, seen } = judge(rule, signals);
      if (!matched) continue;
      let name = snapshot.entityName || [saga.firstName, saga.lastName].filter(Boolean).join(' ');
      const { flagPersonName, namesAPerson } = await import('../shared/flag-people.mjs');
      if (namesAPerson(rule.id)) {
        const rows = (await dynamoDB.send(new QueryCommand({ TableName: STATE_TABLE, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': { S: `CANDIDATE#${snapshot.entityId}` } } }))).Items.map((i) => unmarshall(i));
        const person = await flagPersonName(tenantId, rule.id, { interviews: rows.filter((r) => String(r.SK).startsWith('INTERVIEW#')), votes: rows.filter((r) => String(r.SK).startsWith('VOTE#')), slaThresholds: settings.SLA_THRESHOLDS });
        if (person !== null) name = person;
      }
      const title = flagTitle(rule.id, { stage: STAGE_LABELS[stageOf(snapshot)] ?? '', name, day: dayName(String(saga.expiryDate ?? '').slice(0, 10)) }) ?? rule.name;
      tiles.push({
        ...createTile(snapshot, { priority: rule.severity ?? 'MEDIUM', title, description: title, ruleId: rule.id }),
        why: { rule_id: rule.id, signals_seen: seen, rule_version: versions.INTELLIGENCE_RULES ?? null },
      });
    }
  }
  return tiles;
}

const DAY_MS = 86_400_000;
/** The signals that move with the clock, from the candidate's row and settings, at this moment. */
function freshSignals(saga, settings) {
  const out = {};
  const now = Date.now();
  const entered = Date.parse(saga.stageEnteredAt);
  if (Number.isFinite(entered)) {
    out.DAYS_IN_CURRENT_STAGE = Math.floor((now - entered) / DAY_MS);
    const code = normaliseStage(saga);
    const limits = settings.SLA_THRESHOLDS ?? {};
    let hours;
    for (const [k, h] of Object.entries(limits)) if (typeof h === 'number' && normaliseStage(k) === code) hours = Math.max(hours ?? 0, h);
    if (hours) {
      const used = (now - entered) / 3_600_000 / hours;
      out.SLA_STATUS = used >= 1 ? 'BREACHED' : used >= 0.75 ? 'AT_RISK' : 'ON_TRACK';
    }
  }
  const expiry = Date.parse(saga.expiryDate);
  if (Number.isFinite(expiry)) out.OFFER_DAYS_TO_EXPIRY = Math.floor((expiry - now) / DAY_MS);
  const approvalSince = Date.parse(saga.approvalStartedAt);
  if (saga.currentApprovalStep && Number.isFinite(approvalSince)) out.APPROVAL_STEP_AGE = Math.floor((now - approvalSince) / DAY_MS);
  return out;
}

/**
 * Create a tile object from snapshot and rule metadata
 */
function createTile(snapshot, opts) {
  const signals = snapshot.signals || {};

  const tile = {
    id: `tile-${snapshot.entityId}-${opts.ruleId}`,
    priority: opts.priority,
    title: opts.title,
    description: opts.description,
    entityType: snapshot.entityType,
    entityId: snapshot.entityId,
    entityName: snapshot.entityName || 'Unknown',
    currentStage: stageOf(snapshot),
    signals: extractDisplaySignals(snapshot),
    actions: getDefaultActions(snapshot),
    createdAt: snapshot.computedAt,
    ruleId: opts.ruleId,
  };

  // Add acknowledgeOnly flag if specified
  if (opts.acknowledgeOnly) {
    tile.acknowledgeOnly = true;
  }

  return tile;
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
      value: STAGE_LABELS[stageOf(snapshot)] || snapshot.currentStage,
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

  // 28 Nov: the 0 to 100 risk score is gone from the pack, so no tile shows it (REC-09 changes, item 2).

  if (s.DAYS_IN_CURRENT_STAGE !== null && s.DAYS_IN_CURRENT_STAGE !== undefined && s.DAYS_IN_CURRENT_STAGE >= 7) {
    signals.push({
      label: 'In Stage',
      value: `${s.DAYS_IN_CURRENT_STAGE}d`,
      type: s.DAYS_IN_CURRENT_STAGE >= 14 ? 'warning' : 'info',
    });
  }

  if (s.ONBOARDING_READINESS !== null && s.ONBOARDING_READINESS !== undefined) {
    signals.push({
      label: 'Ready',
      value: `${s.ONBOARDING_READINESS}%`,
      type: s.ONBOARDING_READINESS >= 75 ? 'success' : s.ONBOARDING_READINESS >= 50 ? 'warning' : 'error',
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
