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
const { logRuleFired } = require('./event-logger');
const { writeSignalSnapshot } = require('./snapshot-writer');

const dynamoDB = new DynamoDBClient({});
const lambda = new LambdaClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME || 'talent-flow-state';
const USERS_TABLE = process.env.USERS_TABLE_NAME || 'talent-flow-users';
const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE_NAME || 'talent-flow-notifications';
const NOTIFICATION_LAMBDA = process.env.NOTIFICATION_LAMBDA_NAME || 'sendTalentFlowNotification';

/**
 * Main handler - processes DynamoDB stream records
 */
exports.handler = async (event) => {
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

  // Extract tenantId from item
  const tenantId = item.tenantId || 'DEFAULT';

  // Step 1: Load INTELLIGENCE_RULES config for tenant
  let intelligenceConfig;
  try {
    intelligenceConfig = await loadIntelligenceConfig(tenantId);
  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Config read failed — skipping rule evaluation', {
      tenantId,
      error: err.message
    });
    return { status: 'skipped', reason: 'config_read_failed' };
  }

  const rules = intelligenceConfig.rules || [];

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
    const { matched, reason } = evaluateRule(rule, signals);

    if (matched) {
      matchedRules++;
      console.info('[evaluateIntelligenceRules] Rule matched', {
        candidateId: item.candidateId || item.offerId,
        ruleId: rule.id,
        ruleName: rule.name
      });

      // Process action
      try {
        await processAction(rule, item, signals);
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

  // === §1.2 SLA & Risk ===
  SLA_STATUS: calculateSlaStatus,                                   // 🟢
  DAYS_SINCE_SLA_BREACH: calculateDaysSinceSlaBreach,               // 🟢

  // === §1.3 Engagement & Sentiment ===
  ENGAGEMENT_SCORE: calculateEngagementScore,                       // 🟢
  ENGAGEMENT_SENTIMENT: calculateEngagementSentiment,               // 🟢
  INTERVIEW_SENTIMENT: calculateInterviewSentiment,                 // 🟢

  // === §1.5 Panel & Evaluation ===
  FINAL_SCORE: calculateFinalScore,                                 // 🟢
  EVALUATION_RESULT: calculateEvaluationResult,                     // 🟢
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
  return item.currentStage || null;
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
    const signalValue = signals[condition.signal];

    // If signal is unavailable (null), condition fails
    if (signalValue == null) {
      return {
        matched: false,
        reason: `signal_unavailable:${condition.signal}`
      };
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

/**
 * Map action type to notification type
 * Determines which type of notification to send based on rule action
 *
 * @param {string} actionType - Action type from rule
 * @returns {string} Notification type
 */
function getNotificationType(actionType) {
  const ACTION_TYPE_TO_NOTIFICATION_TYPE = {
    // Generic/Fallback
    'INTELLIGENCE_ALERT': 'INTELLIGENCE_RULE_MATCHED',
    'CUSTOM_NOTIFICATION': 'INTELLIGENCE_RULE_MATCHED',

    // Urgent Attention
    'ALERT_TA_URGENT': 'CANDIDATE_ATTENTION_REQUIRED',
    'ALERT_HM_URGENT': 'CANDIDATE_ATTENTION_REQUIRED',
    'ESCALATE_TO_ADMIN': 'CANDIDATE_ATTENTION_REQUIRED',

    // Offer Expiry
    'NOTIFY_HM_OFFER_EXPIRY': 'OFFER_EXPIRING_SOON',
    'NOTIFY_TA_OFFER_EXPIRY': 'OFFER_EXPIRING_SOON',
    'ALERT_OFFER_DEADLINE': 'OFFER_EXPIRING_SOON',
    'NOTIFY_HM_REVIEW_OFFER': 'OFFER_EXPIRING_SOON',

    // HM Inactivity
    'NOTIFY_HM_LOGIN_REQUIRED': 'HM_INACTIVE_ALERT',
    'ALERT_TA_HM_INACTIVE': 'HM_INACTIVE_ALERT',
    'ESCALATE_HM_INACTIVITY': 'HM_INACTIVE_ALERT',

    // TA Follow-up
    'NOTIFY_TA_FOLLOWUP': 'TA_FOLLOWUP_NEEDED',
    'ALERT_TA_STALE_CANDIDATE': 'TA_FOLLOWUP_NEEDED',
    'REMIND_TA_ACTION_NEEDED': 'TA_FOLLOWUP_NEEDED',
    'NOTIFY_TA_REVIEW_CANDIDATE': 'TA_FOLLOWUP_NEEDED',
  };

  return ACTION_TYPE_TO_NOTIFICATION_TYPE[actionType] || 'INTELLIGENCE_RULE_MATCHED';
}

/**
 * Determine recipient role based on action type
 *
 * @param {string} actionType - Action type from rule
 * @returns {string} Recipient role (TA, HM, ADMIN)
 */
function getRecipientRole(actionType) {
  const ACTION_TYPE_TO_RECIPIENT_ROLE = {
    // TA Recipients
    'ALERT_TA_URGENT': 'TA',
    'NOTIFY_TA_FOLLOWUP': 'TA',
    'ALERT_TA_STALE_CANDIDATE': 'TA',
    'REMIND_TA_ACTION_NEEDED': 'TA',
    'NOTIFY_TA_REVIEW_CANDIDATE': 'TA',
    'NOTIFY_TA_OFFER_EXPIRY': 'TA',
    'ALERT_TA_HM_INACTIVE': 'TA',

    // HM Recipients
    'ALERT_HM_URGENT': 'HM',
    'NOTIFY_HM_OFFER_EXPIRY': 'HM',
    'NOTIFY_HM_LOGIN_REQUIRED': 'HM',
    'NOTIFY_HM_REVIEW_OFFER': 'HM',

    // Admin Recipients
    'ESCALATE_TO_ADMIN': 'ADMIN',
    'ESCALATE_HM_INACTIVITY': 'ADMIN',

    // Generic
    'INTELLIGENCE_ALERT': 'TA',
    'CUSTOM_NOTIFICATION': 'TA',
  };

  return ACTION_TYPE_TO_RECIPIENT_ROLE[actionType] || 'TA';
}

/**
 * Determine recipient ID based on recipient role and candidate data
 *
 * @param {string} actionType - Action type from rule
 * @param {Object} candidateData - Candidate SAGA record
 * @returns {string} User ID of recipient
 */
function determineRecipientId(actionType, candidateData) {
  const role = getRecipientRole(actionType);

  switch (role) {
    case 'HM':
      // Hiring Manager - from candidate record
      return candidateData.hiringManagerId || candidateData.updatedBy;

    case 'TA':
      // Talent Acquisition - candidate creator
      return candidateData.updatedBy || candidateData.createdBy;

    case 'ADMIN':
      // System admin - placeholder for now
      return 'SYSTEM_ADMIN';

    default:
      return candidateData.updatedBy || 'SYSTEM';
  }
}

/**
 * Process action when rule matches
 * Directly invokes sendTalentFlowNotification Lambda for notification delivery
 *
 * @param {Object} rule - Matched intelligence rule
 * @param {Object} item - DynamoDB item (candidate or offer)
 * @param {Object} signals - Calculated signal values
 */
async function processAction(rule, item, signals) {
  const entityId = item.candidateId || item.offerId;
  const entityType = item.candidateId ? 'CANDIDATE' : 'OFFER';

  console.info('[evaluateIntelligenceRules] Processing action', {
    entityId,
    ruleId: rule.id,
    actionType: rule.action.type
  });

  // Determine recipient
  const recipientId = determineRecipientId(rule.action.type, item);

  // Check cooldown to prevent notification spam
  const cooldownHours = rule.action.cooldown || 24;
  const withinCooldown = await checkCooldown(recipientId, rule.id, cooldownHours);

  if (withinCooldown) {
    console.info('[evaluateIntelligenceRules] Action skipped - within cooldown', {
      entityId,
      ruleId: rule.id,
      recipientId,
      cooldownHours
    });
    return { status: 'skipped', reason: 'cooldown' };
  }

  // Determine notification type
  const notificationType = getNotificationType(rule.action.type);

  // Build notification payload for sendTalentFlowNotification Lambda
  const notificationPayload = {
    type: notificationType,
    recipientEmail: 'system@talentflow.internal', // Placeholder for MVP1
    recipientId,
    candidateId: item.candidateId || null,
    offerId: item.offerId || null,
    tenantId: item.tenantId || 'DEFAULT',
    ruleId: rule.id,
    ruleName: rule.name,
    priority: rule.action.priority || 'MEDIUM',
    actionType: rule.action.type,
    signals: signals,
    candidateName: item.firstName && item.lastName ? `${item.firstName} ${item.lastName}` : null,
    positionTitle: item.positionTitle || null,
    currentStage: item.currentStage || null,
  };

  // Add type-specific fields
  if (signals.OFFER_DAYS_TO_EXPIRY !== undefined) {
    notificationPayload.daysToExpiry = signals.OFFER_DAYS_TO_EXPIRY;
  }
  if (signals.HM_DAYS_SINCE_LOGIN !== undefined) {
    notificationPayload.daysSinceHMLogin = signals.HM_DAYS_SINCE_LOGIN;
  }
  if (signals.TA_DAYS_SINCE_CANDIDATE_ACTION !== undefined) {
    notificationPayload.daysSinceLastAction = signals.TA_DAYS_SINCE_CANDIDATE_ACTION;
  }

  try {
    // Directly invoke sendTalentFlowNotification Lambda (async)
    await lambda.send(new InvokeCommand({
      FunctionName: NOTIFICATION_LAMBDA,
      InvocationType: 'Event', // Async invocation - don't wait for response
      Payload: JSON.stringify({
        Records: [{
          body: JSON.stringify(notificationPayload)
        }]
      })
    }));

    console.info('[evaluateIntelligenceRules] Notification Lambda invoked', {
      entityId,
      ruleId: rule.id,
      actionType: rule.action.type,
      notificationType,
      recipientId,
      lambdaFunction: NOTIFICATION_LAMBDA
    });

    // Log intelligence event for effectiveness metrics (§7.5)
    await logRuleFired(dynamoDB, {
      tenantId: item.tenantId || 'DEFAULT',
      ruleId: rule.id,
      ruleName: rule.name,
      ruleSeverity: rule.action?.priority || 'MEDIUM',
      entityType,
      entityId,
      entityName: item.firstName && item.lastName ? `${item.firstName} ${item.lastName}` : null,
      currentStage: item.currentStage,
      recipientId,
      recipientRole: getRecipientRole(rule.action.type),
      signalsSnapshot: signals,
      notificationId: `NOTIF#${new Date().toISOString()}`
    });

    return { status: 'invoked', notificationType, recipientId };
  } catch (err) {
    console.error('[evaluateIntelligenceRules] Failed to invoke notification Lambda', {
      entityId,
      ruleId: rule.id,
      error: err.message
    });
    // Fail-open: log error but don't crash
    return { status: 'failed', error: err.message };
  }
}

/**
 * Check if we're within cooldown period for this rule
 * Queries talent-flow-notifications table to prevent spam
 *
 * @param {string} recipientId - User ID of recipient
 * @param {string} ruleId - Rule ID
 * @param {number} cooldownHours - Hours to wait before re-triggering
 * @returns {Promise<boolean>} True if within cooldown period
 */
async function checkCooldown(recipientId, ruleId, cooldownHours) {
  const cooldownMs = cooldownHours * 60 * 60 * 1000;
  const cooldownThreshold = new Date(Date.now() - cooldownMs).toISOString();

  try {
    // Query talent-flow-notifications table for recent notifications
    // PK: USER#{userId}, SK: NOTIFICATION#{notificationId}
    const result = await dynamoDB.send(new QueryCommand({
      TableName: NOTIFICATIONS_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'ruleId = :ruleId AND createdAt > :threshold',
      ExpressionAttributeValues: marshall({
        ':pk': `USER#${recipientId}`,
        ':sk': 'NOTIFICATION#',
        ':ruleId': ruleId,
        ':threshold': cooldownThreshold
      }),
      Limit: 1
    }));

    // If we found a recent notification, we're within cooldown
    if (result.Items && result.Items.length > 0) {
      const notification = unmarshall(result.Items[0]);
      console.info('[evaluateIntelligenceRules] Within cooldown period', {
        recipientId,
        ruleId,
        lastNotificationAt: notification.createdAt,
        cooldownHours
      });
      return true;
    }

    return false;
  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Cooldown check failed - allowing action', {
      recipientId,
      ruleId,
      error: err.message
    });
    // Fail-open: if cooldown check fails, allow the action
    return false;
  }
}
