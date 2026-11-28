/**
 * Intelligence Layer - Rule Evaluation Engine
 *
 * Triggered by: DynamoDB Stream on talent-flow-state
 * Purpose: Evaluate intelligence rules when candidate/offer data changes
 * Architecture: Fail-open (advisory, not critical)
 *
 * INTEL-002 Phase 3
 */

const { DynamoDBClient, GetItemCommand, QueryCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');
const { randomUUID } = require('crypto');
const { getConfig } = require('./config-reader');
const { eventTenant } = require('../shared/tf-tenant.js');
const { logRuleFired } = require('./event-logger');
const { writeSignalSnapshot } = require('./snapshot-writer');

const dynamoDB = new DynamoDBClient({});
// REC-09: the settings this record is judged with (the versions locked to the candidate), set once per record.
let CURRENT = { settings: {}, versions: {}, tenantId: null };
const lambda = new LambdaClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME || 'talent-flow-state';
const USERS_TABLE = process.env.USERS_TABLE_NAME || 'talent-flow-users';
const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE_NAME || 'talent-flow-notifications';
const NOTIFICATION_LAMBDA = process.env.NOTIFICATION_LAMBDA_NAME || 'sendTalentFlowNotification';

/**
 * Main handler - processes DynamoDB stream records
 */
// REC-03: a row may still hold an old stage name until its company's stage move has run, so stages are read through the one list.
// The shared file is an ES module: it is loaded once per run, before any row is read. Until then a stage reads as stored.
let normaliseStage = (value) => (value && typeof value === 'object' ? value.currentStage : value);

exports.handler = async (event) => {
  ({ normaliseStage } = await import('../shared/recruitment-stages.mjs'));
  console.info('[evaluateIntelligenceRules] Processing batch', {
    recordCount: event.Records.length
  });

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  const errors = [];

  for (const record of event.Records) {
    try {
      // Only process INSERT and MODIFY events
      if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') {
        skipped++;
        continue;
      }

      // Skip records without NewImage
      if (!record.dynamodb?.NewImage) {
        skipped++;
        continue;
      }

      // Unmarshall DynamoDB record
      const item = unmarshall(record.dynamodb.NewImage);

      // Process the record
      await processRecord(item, record.eventName);
      processed++;

    } catch (err) {
      failed++;
      errors.push({
        recordId: record.eventID,
        error: err.message
      });
      console.error('[evaluateIntelligenceRules] Record processing failed', {
        eventID: record.eventID,
        error: err.message
      });
    }
  }

  console.info('[evaluateIntelligenceRules] Batch complete', {
    processed,
    skipped,
    failed,
    errors: errors.length
  });

  return {
    processed,
    skipped,
    failed,
    errors
  };
};

/**
 * Process a single record from the stream
 */
async function processRecord(item, eventName) {
  console.info('[evaluateIntelligenceRules] Processing record', {
    PK: item.PK,
    SK: item.SK,
    eventName
  });

  // Skip snapshot records (they're written by this Lambda, avoid re-processing)
  if (item.PK && item.PK.includes('#SNAP')) {
    console.info('[evaluateIntelligenceRules] Skipping snapshot record', { PK: item.PK });
    return { status: 'skipped', reason: 'snapshot_record' };
  }

  // Skip non-SAGA records (only process candidate/offer SAGA state)
  if (item.SK && item.SK !== 'SAGA') {
    console.info('[evaluateIntelligenceRules] Skipping non-SAGA record', { SK: item.SK });
    return { status: 'skipped', reason: 'non_saga_record' };
  }

  // TEN-03: the company is the row's tenant_id. A row without one is skipped, with no read and no write.
  const tenantId = await eventTenant({ tenant_id: item.tenant_id });
  if (!tenantId) {
    console.warn('[evaluateIntelligenceRules] Skipping record: it carries no company');
    return { status: 'skipped', reason: 'no_company' };
  }
  // MOD-01: a company with Recruitment off is skipped, never thrown.
  const { modulesOf } = await import('../shared/modules.mjs');
  if (!(await modulesOf(tenantId)).includes('recruitment')) {
    console.warn('[evaluateIntelligenceRules] Module off, skipped', { tenantId });
    return { status: 'skipped', reason: 'module_off' };
  }

  // Step 1: the company's rules, from the settings versions locked to this candidate (REC-09 rule 1). Nothing is hard-coded.
  let intelligenceConfig;
  try {
    const S = await import('../shared/recruitment-settings.mjs');
    const { settings } = await S.settingsForRead(tenantId, item); // a read: the engine never writes a candidate's lock
    const versions = await S.lockedVersions(tenantId, item);
    CURRENT = { settings, versions, tenantId };
    intelligenceConfig = settings.INTELLIGENCE_RULES ?? { rules: [] };
  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Config read failed — skipping rule evaluation', {
      tenantId,
      error: err.name
    });
    return { status: 'skipped', reason: 'config_read_failed' };
  }

  const { RETIRED } = await import('../shared/intelligence-rules.mjs');
  const rules = (intelligenceConfig.rules || []).filter((r) => !RETIRED.includes(r.id));

  // If no rules configured, skip processing
  if (rules.length === 0) {
    console.info('[evaluateIntelligenceRules] No rules configured for tenant — skipping', { tenantId });
    return { status: 'skipped', reason: 'no_rules' };
  }

  console.info('[evaluateIntelligenceRules] Loaded rules', { tenantId, ruleCount: rules.length });

  // Step 2: Calculate signals from candidate/offer data
  let signals;
  try {
    signals = await calculateSignals(item);
    console.info('[evaluateIntelligenceRules] Signals calculated', {
      candidateId: item.candidateId || item.offerId,
      signals: Object.keys(signals)
    });
  } catch (err) {
    console.error('[evaluateIntelligenceRules] Signal calculation failed', {
      error: err.message
    });
    return { status: 'skipped', reason: 'signal_calculation_failed' };
  }

  // Step 2.5: Write signal snapshot for tile projections (§10.2)
  const entityType = item.candidateId ? 'CANDIDATE' : 'OFFER';
  const entityId = item.candidateId || item.offerId;

  if (entityId) {
    try {
      await writeSignalSnapshot(dynamoDB, {
        tenantId,
        entityType,
        entityId,
        signals,
        item
      });
    } catch (err) {
      // Fail-open: snapshot write is advisory
      console.warn('[evaluateIntelligenceRules] Snapshot write failed (continuing)', {
        entityId,
        error: err.message
      });
    }
  }

  // Step 3: Evaluate rules against signals
  let matchedRules = 0;
  let skippedRules = 0;

  for (const rule of rules) {
    // Skip disabled rules
    if (!rule.enabled) {
      skippedRules++;
      continue;
    }

    // Evaluate rule conditions
    const { matched, reason, seen } = await judgeRule(rule, signals);

    if (matched) {
      matchedRules++;
      console.info('[evaluateIntelligenceRules] Rule matched', {
        candidateId: item.candidateId || item.offerId,
        ruleId: rule.id,
        ruleName: rule.name
      });

      // Process action
      try {
        await processAction(rule, item, signals, seen);
      } catch (err) {
        console.error('[evaluateIntelligenceRules] Action processing failed', {
          candidateId: item.candidateId || item.offerId,
          ruleId: rule.id,
          error: err.message
        });
      }
    } else {
      skippedRules++;
      console.info('[evaluateIntelligenceRules] Rule skipped', {
        candidateId: item.candidateId || item.offerId,
        ruleId: rule.id,
        reason
      });
    }
  }

  console.info('[evaluateIntelligenceRules] Rule evaluation complete', {
    candidateId: item.candidateId || item.offerId,
    totalRules: rules.length,
    matched: matchedRules,
    skipped: skippedRules
  });

  return {
    status: 'complete',
    rulesLoaded: rules.length,
    signalsCalculated: Object.keys(signals).length,
    matchedRules,
    skippedRules
  };
}

/**
 * Load intelligence rules config for tenant
 * Uses config-reader.js from Lambda layer (with 5-minute cache)
 *
 * @param {string} tenantId - Tenant identifier
 * @returns {Promise<Object>} Intelligence rules config { rules: [...] }
 * @throws {Error} If config read fails
 */
async function loadIntelligenceConfig(tenantId) {
  console.info('[evaluateIntelligenceRules] Loading INTELLIGENCE_RULES config', { tenantId });

  try {
    // getConfig returns the config data directly (e.g., { rules: [] })
    const config = await getConfig(tenantId, 'INTELLIGENCE_RULES');

    console.info('[evaluateIntelligenceRules] Config loaded', {
      tenantId,
      ruleCount: (config.rules || []).length
    });

    // Config is already the data object with rules array
    return config;
  } catch (err) {
    console.error('[evaluateIntelligenceRules] Config load failed', {
      tenantId,
      error: err.message
    });
    throw err;
  }
}

/**
 * Signal Registry - Maps signal names to calculator functions
 * Extensible pattern: Add new signals here without changing core logic
 *
 * Legend:
 *   🟢 Atomic - derivable from single record, no queries needed
 *   🟡 Cross-record - needs lookup of other records (GetItem/Query)
 */
const SIGNAL_CALCULATORS = {
  // === Existing Signals ===
  CANDIDATE_STAGE: calculateCandidateStage,                         // 🟢
  HM_DAYS_SINCE_LOGIN: calculateHmDaysSinceLogin,                   // 🟡
  OFFER_DAYS_TO_EXPIRY: calculateOfferDaysToExpiry,                 // 🟢
  TA_DAYS_SINCE_CANDIDATE_ACTION: calculateTaDaysSinceCandidateAction, // 🟡

  // === §1.1 Time & Stage Progression ===
  DAYS_SINCE_CANDIDATE_CREATED: calculateDaysSinceCandidateCreated, // 🟢
  DAYS_IN_CURRENT_STAGE: calculateDaysInCurrentStage,               // 🟢 (Phase 6.4)

  // === §1.2 SLA & Risk ===
  SLA_STATUS: calculateSlaStatus,                                   // 🟢
  DAYS_SINCE_SLA_BREACH: calculateDaysSinceSlaBreach,               // 🟢

  // === §1.3 Engagement & Sentiment ===
  ENGAGEMENT_SCORE: calculateEngagementScore,                       // 🟢
  ENGAGEMENT_SENTIMENT: calculateEngagementSentiment,               // 🟢
  INTERVIEW_SENTIMENT: calculateInterviewSentiment,                 // 🟢
  ENGAGEMENT_TREND: calculateEngagementTrend,                       // 🟢 (EPIC 3 TASK 3.2)
  CANDIDATE_DAYS_SINCE_RESPONSE: calculateCandidateDaysSinceResponse, // 🟢 (EPIC 3 TASK 3.2)

  // === §1.5 Panel & Evaluation ===
  FINAL_SCORE: calculateFinalScore,                                 // 🟢
  EVALUATION_RESULT: calculateEvaluationResult,                     // 🟢
  PANEL_FEEDBACK_PENDING_COUNT: calculatePanelFeedbackPendingCount, // 🟢 (EPIC 4 TASK 4.1)
  STRONG_NO_COUNT: (item) => (typeof item.strong_no_count === 'number' ? item.strong_no_count : 0),
  INTERVIEW_MISSED: (item) => (item.interviewMissedAt ? true : null),
  DECISION_READY: calculateDecisionReady,
  PANEL_CONSENSUS: calculatePanelConsensus,                         // 🟢 (EPIC 4 TASK 4.1)
  PANEL_SPLIT_FLAG: calculatePanelSplitFlag,                        // 🟢 (EPIC 4 TASK 4.1)

  // === §1.6 Offer & Approval ===
  OFFER_STATE: calculateOfferState,                                 // 🟢 (EPIC 4 TASK 4.2)
  DAYS_SINCE_OFFER_SENT: calculateDaysSinceOfferSent,               // 🟢 (EPIC 4 TASK 4.2)
  APPROVAL_STEP_AGE: calculateApprovalStepAge,                      // 🟢 (EPIC 4 TASK 4.2)

  // === Phase 6.4: Composite Signals ===
  CANDIDATE_RISK_SCORE: calculateCandidateRiskScore,                // 🟢 Composite
  ONBOARDING_READINESS: calculateOnboardingReadiness,               // 🟢 Composite

  // === IT Provisioning Signals ===
  DAYS_TO_START_DATE: calculateDaysToStartDate,                     // 🟢
  EQUIPMENT_REQUEST_STATUS: calculateEquipmentRequestStatus,        // 🟢
  ACCESS_PROVISIONED: calculateAccessProvisioned,                   // 🟢
};

/**
 * Calculate all available signals from candidate/offer data
 * Returns object with signal values (null for unavailable signals)
 *
 * @param {Object} item - DynamoDB item (candidate or offer)
 * @returns {Promise<Object>} Signal values { SIGNAL_NAME: value }
 */
async function calculateSignals(item) {
  const signals = {};

  // Calculate all registered signals
  for (const [signalName, calculator] of Object.entries(SIGNAL_CALCULATORS)) {
    try {
      signals[signalName] = await calculator(item);
    } catch (err) {
      console.warn('[evaluateIntelligenceRules] Signal calculation failed', {
        signal: signalName,
        error: err.message
      });
      signals[signalName] = null; // Mark as unavailable
    }
  }

  return signals;
}

/**
 * Signal Calculator: CANDIDATE_STAGE
 * Returns current hiring stage of the candidate
 */
function calculateCandidateStage(item) {
  return normaliseStage(item) || null;
}

/**
 * Signal Calculator: HM_DAYS_SINCE_LOGIN
 * Returns days since hiring manager last logged in
 */
async function calculateHmDaysSinceLogin(item) {
  if (!item.hiringManagerId) return null;

  try {
    // Query talent-flow-users for HM's lastLoginAt
    const result = await dynamoDB.send(new GetItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ userId: item.hiringManagerId })
    }));

    if (!result.Item) return null;

    const user = unmarshall(result.Item);
    if (!user.lastLoginAt) return null;

    const lastLogin = new Date(user.lastLoginAt);
    const now = new Date();
    const daysSince = Math.floor((now - lastLogin) / (1000 * 60 * 60 * 24));

    return daysSince;
  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Failed to fetch HM login data', {
      hiringManagerId: item.hiringManagerId,
      error: err.message
    });
    return null;
  }
}

/**
 * Signal Calculator: OFFER_DAYS_TO_EXPIRY
 * Returns days until offer expires (negative if expired)
 */
function calculateOfferDaysToExpiry(item) {
  if (!item.expiryDate) return null;

  try {
    const expiry = new Date(item.expiryDate);
    const now = new Date();
    const daysTo = Math.floor((expiry - now) / (1000 * 60 * 60 * 24));

    return daysTo;
  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Failed to parse expiryDate', {
      expiryDate: item.expiryDate,
      error: err.message
    });
    return null;
  }
}

/**
 * Signal Calculator: TA_DAYS_SINCE_CANDIDATE_ACTION
 * Returns days since TA last took action on this candidate
 */
async function calculateTaDaysSinceCandidateAction(item) {
  if (!item.updatedBy) return null;

  try {
    // Query talent-flow-users for TA's lastActionAt
    const result = await dynamoDB.send(new GetItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ userId: item.updatedBy })
    }));

    if (!result.Item) return null;

    const user = unmarshall(result.Item);
    if (!user.lastActionAt) return null;

    const lastAction = new Date(user.lastActionAt);
    const now = new Date();
    const daysSince = Math.floor((now - lastAction) / (1000 * 60 * 60 * 24));

    return daysSince;
  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Failed to fetch TA action data', {
      updatedBy: item.updatedBy,
      error: err.message
    });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §1.1 Time & Stage Progression Signals (Atomic 🟢)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Signal Calculator: DAYS_SINCE_CANDIDATE_CREATED
 * Returns total pipeline age in days
 */
function calculateDaysSinceCandidateCreated(item) {
  if (!item.createdAt) return null;

  try {
    const created = new Date(item.createdAt);
    const now = new Date();
    const daysSince = Math.floor((now - created) / (1000 * 60 * 60 * 24));
    return daysSince;
  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Failed to parse createdAt', {
      createdAt: item.createdAt,
      error: err.message
    });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §1.2 SLA & Risk Signals (Atomic 🟢)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Signal Calculator: SLA_STATUS
 * Returns current SLA state: ON_TRACK | AT_RISK | BREACHED
 */
function calculateSlaStatus(item) {
  return item.slaStatus || null;
}

/**
 * Signal Calculator: DAYS_SINCE_SLA_BREACH
 * Returns days since SLA was breached (null if not breached)
 */
function calculateDaysSinceSlaBreach(item) {
  if (!item.slaBreachedAt) return null;

  try {
    const breachedAt = new Date(item.slaBreachedAt);
    const now = new Date();
    const daysSince = Math.floor((now - breachedAt) / (1000 * 60 * 60 * 24));
    return daysSince;
  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Failed to parse slaBreachedAt', {
      slaBreachedAt: item.slaBreachedAt,
      error: err.message
    });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §1.3 Engagement & Sentiment Signals (Atomic 🟢)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Signal Calculator: ENGAGEMENT_SCORE
 * Returns engagement score (0-100)
 */
function calculateEngagementScore(item) {
  if (item.engagementScore === undefined || item.engagementScore === null) return null;
  return item.engagementScore;
}

/**
 * Signal Calculator: ENGAGEMENT_SENTIMENT
 * Returns categorical engagement: ENTHUSIASTIC | POSITIVE | NEUTRAL | HESITANT | DISENGAGED
 */
function calculateEngagementSentiment(item) {
  return item.engagementSentiment || null;
}

/**
 * Signal Calculator: INTERVIEW_SENTIMENT
 * Returns sentiment captured at first interview
 */
function calculateInterviewSentiment(item) {
  return item.interviewSentiment || null;
}

/**
 * Signal Calculator: ENGAGEMENT_TREND (EPIC 3 TASK 3.2)
 * Returns engagement trend: RISING | FLAT | FALLING
 *
 * Compares lastEngagementReading to previousEngagementReading
 * to detect if candidate is becoming more or less engaged.
 *
 * Thresholds:
 *   RISING: current > previous + 10
 *   FALLING: current < previous - 10
 *   FLAT: otherwise (or only one reading)
 */
function calculateEngagementTrend(item) {
  const last = item.lastEngagementReading;
  const previous = item.previousEngagementReading;

  // Default to FLAT if insufficient data
  if (!last || !last.score || !previous || !previous.score) {
    return 'FLAT';
  }

  const diff = last.score - previous.score;

  if (diff > 10) return 'RISING';
  if (diff < -10) return 'FALLING';
  return 'FLAT';
}

/**
 * Signal Calculator: CANDIDATE_DAYS_SINCE_RESPONSE (EPIC 3 TASK 3.2)
 * Returns days since candidate's last engagement reading
 *
 * Used for ghosting detection - if days > threshold, candidate may be cooling off
 */
function calculateCandidateDaysSinceResponse(item) {
  const last = item.lastEngagementReading;

  if (!last || !last.timestamp) {
    return null;
  }

  try {
    const lastTime = new Date(last.timestamp);
    const now = new Date();
    const daysSince = Math.floor((now - lastTime) / (1000 * 60 * 60 * 24));
    return daysSince;
  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Failed to parse lastEngagementReading.timestamp', {
      timestamp: last.timestamp,
      error: err.message
    });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §1.5 Panel & Evaluation Signals (Atomic 🟢)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Signal Calculator: FINAL_SCORE
 * Returns aggregate evaluation score (0-100)
 */
function calculateFinalScore(item) {
  if (item.finalScore === undefined || item.finalScore === null) return null;
  return item.finalScore;
}

/**
 * Signal Calculator: EVALUATION_RESULT
 * Returns pass/fail outcome: PASSED | FAILED
 */
function calculateEvaluationResult(item) {
  return item.evaluationResult || null;
}

/**
 * Signal Calculator: PANEL_FEEDBACK_PENDING_COUNT (EPIC 4 TASK 4.1)
 * Returns count of pending panel member votes
 *
 * Queries INTERVIEW# records to count how many have votesSubmitted < votesRequired
 */
async function calculatePanelFeedbackPendingCount(item) {
  if (!item.candidateId) return null;
  try {
    // REC-09: only feedback that is past its due time counts, and only from panel members who have not voted.
    return (await dueFeedback(item, await contextOf(item))).pendingPeople.length;
  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Failed to calculate PANEL_FEEDBACK_PENDING_COUNT', { error: err.name });
    return null;
  }
}

/** REC-09 rule 2: the required interviews are done and every vote is in. */
async function calculateDecisionReady(item) {
  if (!item.candidateId || normaliseStage(item) !== 'INTERVIEW') return false;
  const ctx = await contextOf(item);
  const required = CURRENT.settings.INTERVIEW_TYPES?.requiredByLevel?.[item.positionLevel] ?? [];
  const done = ctx.interviews.filter((i) => i.status === 'COMPLETED');
  if (!required.every((t) => done.some((i) => i.interviewType === t))) return false;
  return done.every((iv) => (iv.panelMemberIds ?? []).every((m) => ctx.votes.some((v) => v.interviewId === iv.interviewId && v.voterId === m)));
}

/**
 * Signal Calculator: PANEL_CONSENSUS (EPIC 4 TASK 4.1)
 * Returns consensus score 0-1 + label + factors
 *
 * Consensus algorithm:
 *   - Query all VOTE# records for the candidate
 *   - Convert ratings to numeric scores: STRONG_NO=-2, NO=-1, YES=1, STRONG_YES=2
 *   - Calculate standard deviation of votes
 *   - Consensus = 1 - (stddev / max_possible_stddev)
 *   - Label: HIGH (>0.75), MODERATE (0.5-0.75), LOW (<0.5)
 *
 * Returns: { value: 0-1, label: string, factors: [] }
 */
async function calculatePanelConsensus(item) {
  const candidateId = item.candidateId;
  if (!candidateId) return null;

  try {
    // Query all VOTE# records
    const result = await dynamoDB.send(new QueryCommand({
      TableName: STATE_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: marshall({
        ':pk': `CANDIDATE#${candidateId}`,
        ':prefix': 'VOTE#',
      }),
      ProjectionExpression: 'rating, voterId'
    }));

    if (!result.Items || result.Items.length === 0) {
      return null; // No votes yet
    }

    const votes = result.Items.map(i => unmarshall(i));

    // Convert ratings to numeric scores
    const ratingToScore = {
      'STRONG_NO': -2,
      'NO': -1,
      'YES': 1,
      'STRONG_YES': 2
    };

    const scores = votes.map(v => ratingToScore[v.rating] || 0);
    const count = scores.length;

    if (count === 0) return null;
    if (count === 1) {
      // Single vote = perfect consensus
      return {
        value: 1.0,
        label: 'UNANIMOUS',
        factors: [`Single vote: ${votes[0].rating}`]
      };
    }

    // Calculate mean and standard deviation
    const mean = scores.reduce((sum, s) => sum + s, 0) / count;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / count;
    const stddev = Math.sqrt(variance);

    // Max possible stddev for our rating scale (-2 to 2) with this many votes
    // Worst case: half votes are -2, half are +2
    const maxStddev = 2; // Theoretical max for this scale

    // Consensus score: 1 - (normalized stddev)
    const consensusScore = Math.max(0, Math.min(1, 1 - (stddev / maxStddev)));

    // Determine label
    let label;
    if (consensusScore > 0.75) label = 'HIGH';
    else if (consensusScore >= 0.5) label = 'MODERATE';
    else label = 'LOW';

    // Build factors array (distribution)
    const distribution = {};
    votes.forEach(v => {
      distribution[v.rating] = (distribution[v.rating] || 0) + 1;
    });

    const factors = Object.entries(distribution).map(([rating, count]) =>
      `${rating}: ${count}`
    );

    return {
      value: parseFloat(consensusScore.toFixed(2)),
      label,
      factors,
      distribution // Also include for debugging
    };

  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Failed to calculate PANEL_CONSENSUS', {
      candidateId,
      error: err.message
    });
    return null;
  }
}

/**
 * Signal Calculator: PANEL_SPLIT_FLAG (EPIC 4 TASK 4.1)
 * Returns true if panel has both STRONG_YES and STRONG_NO votes
 *
 * Split panel = strong disagreement requiring documentation/escalation
 */
async function calculatePanelSplitFlag(item) {
  const candidateId = item.candidateId;
  if (!candidateId) return null;

  try {
    // Query all VOTE# records
    const result = await dynamoDB.send(new QueryCommand({
      TableName: STATE_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: marshall({
        ':pk': `CANDIDATE#${candidateId}`,
        ':prefix': 'VOTE#',
      }),
      ProjectionExpression: 'rating'
    }));

    if (!result.Items || result.Items.length === 0) {
      return false; // No votes = no split
    }

    const votes = result.Items.map(i => unmarshall(i));
    const ratings = votes.map(v => v.rating);

    // Split flag = both STRONG_YES and STRONG_NO exist
    const hasStrongYes = ratings.includes('STRONG_YES');
    const hasStrongNo = ratings.includes('STRONG_NO');

    return hasStrongYes && hasStrongNo;

  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Failed to calculate PANEL_SPLIT_FLAG', {
      candidateId,
      error: err.message
    });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// §1.6 Offer & Approval Signals (EPIC 4 TASK 4.2)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Signal Calculator: OFFER_STATE (EPIC 4 TASK 4.2)
 * Returns the current state of the offer
 *
 * Possible values:
 *   - DRAFT: Offer created but not yet sent
 *   - PENDING_APPROVAL: Awaiting approval from stakeholders
 *   - APPROVED: Approved but not yet sent
 *   - SENT: Sent to candidate
 *   - ACCEPTED: Candidate accepted
 *   - DECLINED: Candidate declined
 *   - EXPIRED: Offer expired
 */
function calculateOfferState(item) {
  // Read from offerStatus field on SAGA record
  return item.offerStatus || null;
}

/**
 * Signal Calculator: DAYS_SINCE_OFFER_SENT (EPIC 4 TASK 4.2)
 * Returns days since offer was sent to candidate
 *
 * Used for detecting stalled offers and tracking response time
 */
function calculateDaysSinceOfferSent(item) {
  const offerSentAt = item.offerSentAt;

  if (!offerSentAt) {
    return null; // Offer not sent yet
  }

  try {
    const sentTime = new Date(offerSentAt);
    const now = new Date();
    const daysSince = Math.floor((now - sentTime) / (1000 * 60 * 60 * 24));
    return daysSince;
  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Failed to parse offerSentAt', {
      offerSentAt,
      error: err.message
    });
    return null;
  }
}

/**
 * Signal Calculator: APPROVAL_STEP_AGE (EPIC 4 TASK 4.2)
 * Returns days the current approval step has been pending
 *
 * Queries APPROVAL# history records to find when current step started
 * Similar to DAYS_IN_CURRENT_STAGE pattern from EPIC 3 TASK 3.1
 */
async function calculateApprovalStepAge(item) {
  const candidateId = item.candidateId;
  const currentApprovalStep = item.currentApprovalStep; // e.g., 'HM_REVIEW', 'EXEC_APPROVAL'

  if (!candidateId || !currentApprovalStep) {
    return null; // Not in approval workflow
  }

  try {
    // Query APPROVAL# history records for this candidate
    const result = await dynamoDB.send(new QueryCommand({
      TableName: STATE_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: marshall({
        ':pk': `CANDIDATE#${candidateId}`,
        ':prefix': 'APPROVAL#',
      }),
      ScanIndexForward: false, // Latest first
      Limit: 20 // Get recent history
    }));

    if (!result.Items || result.Items.length === 0) {
      // No approval history - fall back to approvalStartedAt if available
      if (item.approvalStartedAt) {
        const startTime = new Date(item.approvalStartedAt);
        const now = new Date();
        return Math.floor((now - startTime) / (1000 * 60 * 60 * 24));
      }
      return null;
    }

    const history = result.Items.map(i => unmarshall(i));

    // Find most recent transition TO current step
    const mostRecentTransition = history.find(h => h.toStep === currentApprovalStep);

    if (mostRecentTransition && mostRecentTransition.timestamp) {
      const stepStartTime = new Date(mostRecentTransition.timestamp);
      const now = new Date();
      return Math.floor((now - stepStartTime) / (1000 * 60 * 60 * 24));
    }

    // Fallback to approvalStartedAt
    if (item.approvalStartedAt) {
      const startTime = new Date(item.approvalStartedAt);
      const now = new Date();
      return Math.floor((now - startTime) / (1000 * 60 * 60 * 24));
    }

    return null;

  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Failed to calculate APPROVAL_STEP_AGE', {
      candidateId,
      currentApprovalStep,
      error: err.message
    });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 6.4: Stage History & Composite Signals
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Signal Calculator: DAYS_IN_CURRENT_STAGE (EPIC 3 TASK 3.1)
 * Returns days since candidate entered current stage
 *
 * Precision strategy (graceful degradation):
 *   1. Query for latest STAGE# history record (most accurate)
 *   2. Fallback to stageEnteredAt from SAGA (advanceCandidateStage writes this)
 *   3. Fallback to stageChangedAt/lastStageChangeAt (legacy)
 *   4. Fallback to updatedAt (least accurate, better than null)
 */
async function calculateDaysInCurrentStage(item) {
  const candidateId = item.candidateId;
  const currentStage = item.currentStage;

  // Strategy 1: Query for latest STAGE# history record (EPIC 3)
  if (candidateId && currentStage) {
    try {
      const result = await dynamoDB.send(new QueryCommand({
        TableName: STATE_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: marshall({
          ':pk': `CANDIDATE#${candidateId}`,
          ':prefix': 'STAGE#',
        }),
        ScanIndexForward: false, // Descending order (most recent first)
        Limit: 5, // Get last 5 transitions
      }));

      if (result.Items && result.Items.length > 0) {
        // Find the most recent transition TO the current stage
        const transitions = result.Items.map(i => unmarshall(i));
        // REC-03: history rows carry from/to/at; rows written before it carry fromStage/toStage/timestamp and the old stage names.
        const currentCode = normaliseStage(item);
        const currentStageEntry = transitions.find(t => normaliseStage(t.to ?? t.toStage) === currentCode);
        const enteredAtText = currentStageEntry && (currentStageEntry.at ?? currentStageEntry.timestamp);

        if (enteredAtText) {
          const enteredAt = new Date(enteredAtText);
          const now = new Date();
          const daysSince = Math.floor((now - enteredAt) / (1000 * 60 * 60 * 24));
          return daysSince;
        }
      }
    } catch (err) {
      // Non-fatal: log and fall through to fallbacks
      console.warn('[evaluateIntelligenceRules] Failed to query stage history', {
        candidateId,
        error: err.message
      });
    }
  }

  // Strategy 2: Use stageEnteredAt from SAGA (written by advanceCandidateStage)
  if (item.stageEnteredAt) {
    try {
      const enteredAt = new Date(item.stageEnteredAt);
      const now = new Date();
      const daysSince = Math.floor((now - enteredAt) / (1000 * 60 * 60 * 24));
      return daysSince;
    } catch (err) {
      console.warn('[evaluateIntelligenceRules] Failed to parse stageEnteredAt', {
        stageEnteredAt: item.stageEnteredAt,
        error: err.message
      });
    }
  }

  // Strategy 3: Legacy stageChangedAt/lastStageChangeAt (backward compatibility)
  const stageChangeTimestamp = item.stageChangedAt || item.lastStageChangeAt;
  if (stageChangeTimestamp) {
    try {
      const changedAt = new Date(stageChangeTimestamp);
      const now = new Date();
      const daysSince = Math.floor((now - changedAt) / (1000 * 60 * 60 * 24));
      return daysSince;
    } catch (err) {
      console.warn('[evaluateIntelligenceRules] Failed to parse stageChangedAt', {
        stageChangedAt: stageChangeTimestamp,
        error: err.message
      });
    }
  }

  // Strategy 4: Fallback to updatedAt (least accurate)
  if (item.updatedAt) {
    try {
      const updatedAt = new Date(item.updatedAt);
      const now = new Date();
      const daysSince = Math.floor((now - updatedAt) / (1000 * 60 * 60 * 24));
      return daysSince;
    } catch (err) {
      // Fall through to null
    }
  }

  return null;
}

/**
 * Signal Calculator: CANDIDATE_RISK_SCORE (Composite)
 * Returns weighted risk score 0-100 based on multiple signals
 *
 * Factors:
 * - SLA status (BREACHED = +40, AT_RISK = +20)
 * - Days in current stage (>14 = +15, >7 = +10)
 * - Engagement sentiment (DISENGAGED = +25, HESITANT = +15)
 * - Days since created (>30 = +10)
 * - Low final score (<60 = +10)
 */
function calculateCandidateRiskScore(item) {
  let riskScore = 0;

  // Factor 1: SLA Status (heaviest weight)
  if (item.slaStatus === 'BREACHED') {
    riskScore += 40;
  } else if (item.slaStatus === 'AT_RISK') {
    riskScore += 20;
  }

  // Factor 2: Days in current stage (stale candidates)
  const stageChangeTimestamp = item.stageChangedAt || item.lastStageChangeAt || item.updatedAt;
  if (stageChangeTimestamp) {
    try {
      const changedAt = new Date(stageChangeTimestamp);
      const now = new Date();
      const daysInStage = Math.floor((now - changedAt) / (1000 * 60 * 60 * 24));
      if (daysInStage > 14) {
        riskScore += 15;
      } else if (daysInStage > 7) {
        riskScore += 10;
      }
    } catch (err) {
      // Skip this factor
    }
  }

  // Factor 3: Engagement sentiment
  if (item.engagementSentiment === 'DISENGAGED') {
    riskScore += 25;
  } else if (item.engagementSentiment === 'HESITANT') {
    riskScore += 15;
  }

  // Factor 4: Pipeline age
  if (item.createdAt) {
    try {
      const created = new Date(item.createdAt);
      const now = new Date();
      const daysSinceCreated = Math.floor((now - created) / (1000 * 60 * 60 * 24));
      if (daysSinceCreated > 30) {
        riskScore += 10;
      }
    } catch (err) {
      // Skip this factor
    }
  }

  // Factor 5: Low evaluation score
  if (item.finalScore !== undefined && item.finalScore !== null && item.finalScore < 60) {
    riskScore += 10;
  }

  // Cap at 100
  return Math.min(riskScore, 100);
}

/**
 * Signal Calculator: ONBOARDING_READINESS (Composite)
 * Returns readiness percentage 0-100 for candidates in pre-boarding/onboarding stages
 *
 * Factors (each worth 25%):
 * - Stage is Hired
 * - IT equipment requested
 * - Access provisioned
 * - Documents complete
 *
 * Returns null for candidates not in onboarding stages
 */
function calculateOnboardingReadiness(item) {
  // Only calculate for candidates in relevant stages
  if (normaliseStage(item) !== 'HIRED') {
    return null;
  }

  let readinessScore = 0;
  let factorsEvaluated = 0;

  // Factor 1: In onboarding stage (baseline)
  readinessScore += 25;
  factorsEvaluated++;

  // Factor 2: IT equipment requested
  if (item.equipmentRequested || item.provisioningBundleId) {
    readinessScore += 25;
  }
  factorsEvaluated++;

  // Factor 3: Access provisioned
  if (item.accessProvisioned || item.systemAccessGranted) {
    readinessScore += 25;
  }
  factorsEvaluated++;

  // Factor 4: Documents complete
  if (item.documentsComplete || item.onboardingDocumentsComplete) {
    readinessScore += 25;
  }
  factorsEvaluated++;

  return readinessScore;
}

// ═══════════════════════════════════════════════════════════════════════════════
// IT Provisioning Signals (Atomic 🟢)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Signal Calculator: DAYS_TO_START_DATE
 * Returns days until candidate's start date (negative if past)
 * Used by IT to prioritize provisioning
 */
function calculateDaysToStartDate(item) {
  // Check multiple possible field names for start date
  const startDate = item.startDate || item.proposedStartDate || item.targetStartDate;

  if (!startDate) return null;

  try {
    const start = new Date(startDate);
    const now = new Date();
    const daysTo = Math.floor((start - now) / (1000 * 60 * 60 * 24));
    return daysTo;
  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Failed to parse startDate', {
      startDate,
      error: err.message
    });
    return null;
  }
}

/**
 * Signal Calculator: EQUIPMENT_REQUEST_STATUS
 * Returns status of IT equipment request: NOT_ORDERED | PENDING | ORDERED | DELIVERED
 */
function calculateEquipmentRequestStatus(item) {
  // Check explicit status field
  if (item.equipmentRequestStatus) {
    return item.equipmentRequestStatus;
  }

  // Infer from boolean flags
  if (item.equipmentDelivered) return 'DELIVERED';
  if (item.equipmentOrdered) return 'ORDERED';
  if (item.equipmentRequested || item.provisioningBundleId) return 'PENDING';

  // Default for candidates in onboarding stages
  if (normaliseStage(item) === 'HIRED') {
    return 'NOT_ORDERED';
  }

  return null;
}

/**
 * Signal Calculator: ACCESS_PROVISIONED
 * Returns boolean indicating if system access has been set up
 */
function calculateAccessProvisioned(item) {
  // Check explicit boolean field
  if (item.accessProvisioned !== undefined) {
    return item.accessProvisioned;
  }

  // Check alternate field names
  if (item.systemAccessGranted !== undefined) {
    return item.systemAccessGranted;
  }

  // For candidates in onboarding stages, default to false if not explicitly set
  if (normaliseStage(item) === 'HIRED') {
    return false;
  }

  return null;
}

/**
 * Evaluate if a rule matches based on signals
 * Uses AND logic - all conditions must match
 *
 * @param {Object} rule - Intelligence rule with conditions
 * @param {Object} signals - Calculated signal values
 * @returns {Object} { matched: boolean, reason: string }
 */
function evaluateRule(rule, signals) {
  // Check each condition (AND logic)
  for (const condition of rule.conditions) {
    let signalValue = signals[condition.signal];

    // If signal is unavailable (null), condition fails
    if (signalValue == null) {
      return {
        matched: false,
        reason: `signal_unavailable:${condition.signal}`
      };
    }

    // Support nested property access via 'path' (e.g., path: 'value' for PANEL_CONSENSUS.value)
    if (condition.path && typeof signalValue === 'object') {
      signalValue = signalValue[condition.path];

      // If nested property doesn't exist, condition fails
      if (signalValue == null) {
        return {
          matched: false,
          reason: `signal_path_unavailable:${condition.signal}.${condition.path}`
        };
      }
    }

    // Evaluate the condition
    const conditionMet = evaluateCondition(signalValue, condition.operator, condition.value);

    if (!conditionMet) {
      return {
        matched: false,
        reason: `condition_not_met:${condition.signal}_${condition.operator}_${condition.value}`
      };
    }
  }

  // All conditions passed
  return { matched: true, reason: 'all_conditions_met' };
}

/**
 * Evaluate a single condition using the specified operator
 *
 * @param {any} signalValue - Actual signal value
 * @param {string} operator - Comparison operator
 * @param {any} expectedValue - Expected value from rule
 * @returns {boolean} True if condition is met
 */
function evaluateCondition(signalValue, operator, expectedValue) {
  switch (operator) {
    case 'equals':
      return signalValue === expectedValue;

    case 'notEquals':
      return signalValue !== expectedValue;

    case 'greaterThan':
      return signalValue > expectedValue;

    case 'lessThan':
      return signalValue < expectedValue;

    case 'greaterThanOrEqual':
      return signalValue >= expectedValue;

    case 'lessThanOrEqual':
      return signalValue <= expectedValue;

    case 'in':
      // expectedValue should be an array
      return Array.isArray(expectedValue) && expectedValue.includes(signalValue);

    case 'notIn':
      // expectedValue should be an array
      return Array.isArray(expectedValue) && !expectedValue.includes(signalValue);

    default:
      console.warn('[evaluateIntelligenceRules] Unknown operator', { operator });
      return false;
  }
}


async function judgeRule(rule, signals) {
  const { judge } = await import('../shared/intelligence-rules.mjs');
  const r = judge(rule, signals);
  return { ...r, reason: r.matched ? 'all_conditions_met' : 'condition_not_met' };
}

const query = async (params) => (await dynamoDB.send(new QueryCommand(params))).Items?.map((i) => unmarshall(i)) ?? [];
const oneRow = async (table, key) => {
  const r = await dynamoDB.send(new GetItemCommand({ TableName: table, Key: marshall(key) }));
  return r.Item ? unmarshall(r.Item) : null;
};

/** The rows a flag's people and title are worked out from. */
async function contextOf(item) {
  const rows = await query({ TableName: STATE_TABLE, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${item.candidateId}` }) });
  return {
    candidate: item,
    interviews: rows.filter((r) => String(r.SK).startsWith('INTERVIEW#')),
    votes: rows.filter((r) => String(r.SK).startsWith('VOTE#')),
  };
}

/** The values the approved titles are filled with. */
async function titleValues(item, ctx, rule) {
  const { STAGE_LABELS, dayName } = await import('../shared/flag-titles.mjs');
  const { flagPersonName } = await import('../shared/flag-people.mjs');
  const candidateName = [item.firstName, item.lastName].filter(Boolean).join(' ');
  const values = { stage: STAGE_LABELS[normaliseStage(item)] ?? '', name: candidateName, day: dayName(String(item.expiryDate ?? '').slice(0, 10)) };
  const person = await flagPersonName(CURRENT.tenantId, rule.id, { interviews: ctx.interviews, votes: ctx.votes, slaThresholds: CURRENT.settings.SLA_THRESHOLDS });
  if (person !== null) values.name = person;
  return values;
}

async function dueFeedback(item, ctx) {
  const { pendingFeedback } = await import('../shared/flag-people.mjs');
  return { pendingPeople: pendingFeedback(ctx.interviews, ctx.votes, CURRENT.settings.SLA_THRESHOLDS) };
}

/**
 * Process the action of a rule that matched (REC-09 rules 3 to 7): who gets it, the in-app notification with the approved title, the
 * "why" row, and for a draft rule the draft. No email, no Lambda call.
 */
async function processAction(rule, item, signals, seen) {
  const tenantId = CURRENT.tenantId;
  const entityId = item.candidateId;
  if (!entityId) return { status: 'skipped', reason: 'no_candidate' };
  const R = await import('../shared/recipients.mjs');
  const ctx = await contextOf(item);
  const rejectionRules = CURRENT.settings.REJECTION_RULES;
  const offer = await liveOffer(item);
  const people = new Set();
  for (const target of rule.targetRoles ?? []) {
    const interviews = target === 'PANEL_MEMBER' ? ctx.interviews : [undefined];
    for (const interview of interviews) {
      for (const sub of await R.resolveRecipients(tenantId, target, { candidate: item, interview, votes: ctx.votes, offer, rejectionRules })) people.add(sub);
    }
  }
  if (people.size === 0) {
    console.warn('No recipient', { ruleId: rule.id, tenantId });
    return { status: 'skipped', reason: 'no_recipient' };
  }
  const cooldownHours = rule.action?.cooldown ?? 24;
  const fresh = [];
  for (const sub of [...people].sort()) if (!(await checkCooldown(sub, rule.id, entityId, cooldownHours))) fresh.push(sub);
  if (fresh.length === 0) {
    console.info('[evaluateIntelligenceRules] Action skipped - within cooldown', { ruleId: rule.id, tenantId });
    return { status: 'skipped', reason: 'cooldown' };
  }
  const { flagTitle } = await import('../shared/flag-titles.mjs');
  const title = flagTitle(rule.id, await titleValues(item, ctx, rule)) ?? rule.name;
  const at = new Date().toISOString();
  const version = CURRENT.versions.INTELLIGENCE_RULES ?? null;
  for (const sub of fresh) {
    await dynamoDB.send(new PutItemCommand({
      TableName: NOTIFICATIONS_TABLE,
      Item: marshall({
        PK: `USER#${sub}`, SK: `NOTIF#${at}#${rule.id}#${entityId}`, notifId: `${rule.id}#${entityId}#${at}`, type: 'FLAG', title, candidateId: entityId,
        ruleId: rule.id, settingsVersion: version, severity: rule.severity ?? 'MEDIUM', tenant_id: tenantId, read: false, createdAt: at,
        expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400, GSI1PK: `USER#${sub}#UNREAD`, GSI1SK: `NOTIF#${at}#${rule.id}#${entityId}`,
      }),
    }));
  }
  await logFlag({ tenantId, rule, version, candidateId: entityId, seen, recipients: fresh.length, at });
  if (rule.action?.type === 'DRAFT_CANDIDATE_MESSAGE') await makeDraft(rule, item, tenantId, at);
  return { status: 'flagged', recipients: fresh.length };
}

async function liveOffer(item) {
  try {
    const lock = await oneRow(STATE_TABLE, { PK: `TENANT#${CURRENT.tenantId}#OFFER_LIVE#${item.candidateId}`, SK: 'LOCK' });
    return lock?.live_offer_id ? await oneRow(STATE_TABLE, { PK: `OFFER#${lock.live_offer_id}`, SK: 'OFFER' }) : null;
  } catch { return null; }
}

/** REC-09 rule 5: one row per firing, ids and numbers only. */
async function logFlag({ tenantId, rule, version, candidateId, seen, recipients, at }) {
  const id = `evt-${Math.random().toString(36).slice(2, 12).toUpperCase()}`;
  await dynamoDB.send(new PutItemCommand({
    TableName: process.env.EVENTS_TABLE_NAME || 'talent-flow-intelligence-events',
    Item: marshall({
      PK: `TENANT#${tenantId}`, SK: `INTEL#${at}#${id}`, GSI1PK: `RULE#${rule.id}`, GSI1SK: at, tenant_id: tenantId, rule_id: rule.id, rule_version: version,
      candidate_id: candidateId, signals_seen: seen, severity: rule.severity ?? 'MEDIUM', recipients_count: recipients, at, expiresAt: Math.floor(Date.now() / 1000) + 90 * 86400,
    }, { removeUndefinedValues: true }),
  }));
}

/** REC-09 rule 7: a draft for HR to edit and send. At most one open draft of a kind per candidate. */
async function makeDraft(rule, item, tenantId, at) {
  const kind = rule.action.template;
  const template = CURRENT.settings.EMAIL_TEMPLATES?.[kind];
  if (!template?.body || !item.email) return;
  const open = await query({
    TableName: STATE_TABLE, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :p)', FilterExpression: '#s = :d AND kind = :k',
    ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: marshall({ ':pk': `CANDIDATE#${item.candidateId}`, ':p': 'DRAFT#', ':d': 'DRAFT', ':k': kind }),
  });
  if (open.length) return;
  const company = (await oneRow(process.env.TENANTS_TABLE, { pk: `TENANT#${tenantId}`, sk: 'PROFILE' }))?.name ?? '';
  let role = item.positionTitle ?? '';
  if (item.role_id && process.env.ROLES_TABLE_NAME) role = (await oneRow(process.env.ROLES_TABLE_NAME, { pk: `TENANT#${tenantId}`, sk: `ROLE#${item.role_id}` }))?.job_title ?? role;
  const { saDate } = await import('../shared/invite-email.mjs');
  const values = { first_name: item.firstName ?? '', role, company, date: item.expiryDate ? saDate(`${String(item.expiryDate).slice(0, 10)}T12:00:00Z`) : '' };
  const body = template.body.replace(/\{([a-z_]+)\}/g, (_m, k) => values[k] ?? '');
  const { randomBytes } = require('crypto');
  const draftId = `drf_${randomBytes(13).toString('hex').slice(0, 26)}`;
  await dynamoDB.send(new PutItemCommand({
    TableName: STATE_TABLE,
    Item: marshall({
      PK: `CANDIDATE#${item.candidateId}`, SK: `DRAFT#${draftId}`, GSI1PK: `TENANT#${tenantId}`, GSI1SK: `DRAFT#${at}#${draftId}`, draft_id: draftId, tenant_id: tenantId,
      candidate_id: item.candidateId, candidate_name: [item.firstName, item.lastName].filter(Boolean).join(' '), to_email: item.email, kind, rule_id: rule.id, body, status: 'DRAFT', created_at: at,
    }),
    ConditionExpression: 'attribute_not_exists(PK)',
  }));
}

/** Within the cooldown of this rule for this candidate and person (REC-09 rule 5): their own notification rows say. */
async function checkCooldown(recipientId, ruleId, candidateId, cooldownHours) {
  const threshold = new Date(Date.now() - cooldownHours * 3600_000).toISOString();
  const rows = await query({
    TableName: NOTIFICATIONS_TABLE, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)', FilterExpression: 'ruleId = :r AND candidateId = :c AND createdAt > :t',
    ExpressionAttributeValues: marshall({ ':pk': `USER#${recipientId}`, ':sk': 'NOTIF#', ':r': ruleId, ':c': candidateId, ':t': threshold }),
  });
  return rows.length > 0;
}
