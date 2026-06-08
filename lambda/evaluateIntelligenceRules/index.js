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
const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');
const { randomUUID } = require('crypto');
const { getConfig } = require('./config-reader');

const dynamoDB = new DynamoDBClient({});

const STATE_TABLE = process.env.STATE_TABLE_NAME || 'talent-flow-state';
const USERS_TABLE = process.env.USERS_TABLE_NAME || 'talent-flow-users';

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
 */
const SIGNAL_CALCULATORS = {
  CANDIDATE_STAGE: calculateCandidateStage,
  HM_DAYS_SINCE_LOGIN: calculateHmDaysSinceLogin,
  OFFER_DAYS_TO_EXPIRY: calculateOfferDaysToExpiry,
  TA_DAYS_SINCE_CANDIDATE_ACTION: calculateTaDaysSinceCandidateAction,
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
 * Process action when rule matches
 * Creates notification and checks cooldown to prevent spam
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

  // Check cooldown to prevent notification spam
  const cooldownHours = rule.action.cooldown || 24;
  const withinCooldown = await checkCooldown(entityId, rule.id, cooldownHours);

  if (withinCooldown) {
    console.info('[evaluateIntelligenceRules] Action skipped - within cooldown', {
      entityId,
      ruleId: rule.id,
      cooldownHours
    });
    return { status: 'skipped', reason: 'cooldown' };
  }

  // Create notification record
  const notificationId = randomUUID();
  const now = new Date().toISOString();

  const notification = {
    PK: `${entityType}#${entityId}`,
    SK: `NOTIFICATION#${notificationId}`,
    notificationId,
    entityId,
    entityType,
    ruleId: rule.id,
    ruleName: rule.name,
    actionType: rule.action.type,
    priority: rule.action.priority || 'MEDIUM',
    status: 'PENDING',
    signals: signals, // Store signal values that triggered the rule
    createdAt: now,
    tenantId: item.tenantId || 'DEFAULT'
  };

  try {
    await dynamoDB.send(new PutItemCommand({
      TableName: STATE_TABLE,
      Item: marshall(notification)
    }));

    console.info('[evaluateIntelligenceRules] Notification created', {
      notificationId,
      entityId,
      ruleId: rule.id,
      actionType: rule.action.type,
      priority: rule.action.priority
    });

    return { status: 'created', notificationId };
  } catch (err) {
    console.error('[evaluateIntelligenceRules] Failed to create notification', {
      entityId,
      ruleId: rule.id,
      error: err.message
    });
    throw err;
  }
}

/**
 * Check if we're within cooldown period for this rule
 * Queries recent notifications to prevent spam
 *
 * @param {string} entityId - Candidate or offer ID
 * @param {string} ruleId - Rule ID
 * @param {number} cooldownHours - Hours to wait before re-triggering
 * @returns {Promise<boolean>} True if within cooldown period
 */
async function checkCooldown(entityId, ruleId, cooldownHours) {
  const cooldownMs = cooldownHours * 60 * 60 * 1000;
  const cooldownThreshold = new Date(Date.now() - cooldownMs).toISOString();

  try {
    // Query for recent notifications for this rule
    const result = await dynamoDB.send(new QueryCommand({
      TableName: STATE_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'ruleId = :ruleId AND createdAt > :threshold',
      ExpressionAttributeValues: marshall({
        ':pk': `CANDIDATE#${entityId}`, // Try candidate first
        ':sk': 'NOTIFICATION#',
        ':ruleId': ruleId,
        ':threshold': cooldownThreshold
      }),
      Limit: 1
    }));

    // If we found a recent notification, we're within cooldown
    if (result.Items && result.Items.length > 0) {
      return true;
    }

    // Also check OFFER# prefix if candidate check returned nothing
    const offerResult = await dynamoDB.send(new QueryCommand({
      TableName: STATE_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'ruleId = :ruleId AND createdAt > :threshold',
      ExpressionAttributeValues: marshall({
        ':pk': `OFFER#${entityId}`,
        ':sk': 'NOTIFICATION#',
        ':ruleId': ruleId,
        ':threshold': cooldownThreshold
      }),
      Limit: 1
    }));

    return offerResult.Items && offerResult.Items.length > 0;
  } catch (err) {
    console.warn('[evaluateIntelligenceRules] Cooldown check failed - allowing action', {
      entityId,
      ruleId,
      error: err.message
    });
    // Fail-open: if cooldown check fails, allow the action
    return false;
  }
}
