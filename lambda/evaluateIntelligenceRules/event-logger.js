/**
 * Intelligence Event Logger - §7.5 Event Log
 *
 * Logs rule evaluation events for effectiveness metrics:
 * - Fire rate (notifications per rule per week)
 * - Action conversion rate (% where user acted)
 * - Dismissal rate (% dismissed without action)
 * - Time-to-action (notification → user action)
 *
 * INTEL-002 Phase 7.5
 */

const { PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const EVENTS_TABLE = process.env.EVENTS_TABLE_NAME || 'talent-flow-intelligence-events';
const TTL_DAYS = 90; // Analytics window

/**
 * Generate a short event ID
 * Format: evt-XXXXXXXXXXXXXXXX (16 chars)
 */
function generateEventId() {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let id = 'evt-';
  for (let i = 0; i < 16; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

/**
 * Log an intelligence event to the events table
 *
 * @param {DynamoDBClient} dynamoDB - DynamoDB client instance
 * @param {Object} eventData - Event data to log
 * @param {string} eventData.eventType - RULE_FIRED | RULE_SKIPPED | NOTIFICATION_SENT
 * @param {string} eventData.tenantId - Tenant identifier
 * @param {string} eventData.ruleId - Rule that was evaluated
 * @param {string} eventData.ruleName - Human-readable rule name
 * @param {string} eventData.ruleSeverity - INFO | WARNING | CRITICAL
 * @param {string} eventData.entityType - CANDIDATE | OFFER
 * @param {string} eventData.entityId - Entity identifier
 * @param {string} eventData.entityName - Human-readable entity name
 * @param {string} eventData.currentStage - Current pipeline stage
 * @param {string} eventData.recipientId - User ID of notification recipient
 * @param {string} eventData.recipientRole - TA | HM | ADMIN
 * @param {Object} eventData.signalsSnapshot - Signal values at evaluation time
 * @param {string} eventData.notificationId - ID of notification sent (if any)
 * @returns {Promise<{eventId: string, timestamp: string}>}
 */
async function logIntelligenceEvent(dynamoDB, eventData) {
  const eventId = generateEventId();
  const timestamp = new Date().toISOString();
  const expiresAt = Math.floor(Date.now() / 1000) + (TTL_DAYS * 24 * 60 * 60);

  const item = {
    // Primary Key
    PK: `TENANT#${eventData.tenantId || 'DEFAULT'}`,
    SK: `INTEL#${timestamp}#${eventId}`,

    // GSI Keys
    GSI1PK: `RULE#${eventData.ruleId}`,
    GSI1SK: timestamp,
    GSI2PK: `ENTITY#${eventData.entityType}#${eventData.entityId}`,
    GSI2SK: timestamp,
    GSI3PK: `USER#${eventData.recipientId}`,
    GSI3SK: timestamp,

    // Event Metadata
    eventId,
    eventType: eventData.eventType,
    tenantId: eventData.tenantId || 'DEFAULT',

    // Rule Context
    ruleId: eventData.ruleId,
    ruleName: eventData.ruleName,
    ruleSeverity: eventData.ruleSeverity || 'MEDIUM',

    // Entity Context
    entityType: eventData.entityType,
    entityId: eventData.entityId,
    entityName: eventData.entityName,
    currentStage: eventData.currentStage,

    // Recipient Context
    recipientId: eventData.recipientId,
    recipientRole: eventData.recipientRole,

    // Signal Snapshot (for debugging and attribution)
    signalsSnapshot: eventData.signalsSnapshot,

    // Notification Reference
    notificationId: eventData.notificationId || null,

    // Outcome Tracking (updated later when user acts)
    actionTakenAt: null,
    dismissedAt: null,
    actionType: null,

    // Timestamps
    firedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,

    // TTL
    expiresAt
  };

  try {
    await dynamoDB.send(new PutItemCommand({
      TableName: EVENTS_TABLE,
      Item: marshall(item, { removeUndefinedValues: true })
    }));

    console.info('[event-logger] Intelligence event logged', {
      eventId,
      eventType: eventData.eventType,
      ruleId: eventData.ruleId,
      entityId: eventData.entityId
    });

    return { eventId, timestamp };
  } catch (err) {
    // Fail-open: log error but don't throw (event logging is advisory)
    console.error('[event-logger] Failed to log intelligence event', {
      eventId,
      error: err.message
    });
    return { eventId, timestamp, error: err.message };
  }
}

/**
 * Convenience: Log a RULE_FIRED event
 */
async function logRuleFired(dynamoDB, eventData) {
  return logIntelligenceEvent(dynamoDB, {
    ...eventData,
    eventType: 'RULE_FIRED'
  });
}

/**
 * Convenience: Log a NOTIFICATION_SENT event
 */
async function logNotificationSent(dynamoDB, eventData) {
  return logIntelligenceEvent(dynamoDB, {
    ...eventData,
    eventType: 'NOTIFICATION_SENT'
  });
}

module.exports = {
  logIntelligenceEvent,
  logRuleFired,
  logNotificationSent,
  generateEventId
};
