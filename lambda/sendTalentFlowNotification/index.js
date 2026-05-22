'use strict';

/**
 * sendTalentFlowNotification Lambda
 * NH-123 — BE-007
 *
 * Trigger: SQS ESM on talent-flow-notification-queue.fifo (batch_size=10)
 *
 * Per-record logic:
 *   1. Parse SQS message body: { type, recipientEmail, recipientId, candidateId, tenantId, ...eventData }
 *   2. Validate required fields (tenantId, recipientEmail, type)
 *   3. Write in-app notification to talent-flow-notifications DynamoDB table
 *   4. getConfig(tenantId, 'EMAIL_TEMPLATES') — ACTIVE read — returns config-driven Postmark alias map
 *   5. Resolve templateAlias: config[type] or fallback 'talent-flow-{type-kebab}'
 *   6. Send Postmark email — To address overridden by MVP1_RECIPIENT_OVERRIDE for MVP 1
 *   7. Any failure → add record.messageId to batchItemFailures; process remaining records
 *   8. Return { batchItemFailures }
 *
 * Postmark template alias convention (fallback):
 *   INTERVIEW_SCHEDULED  → talent-flow-interview-scheduled
 *   CANDIDATE_CREATED    → talent-flow-candidate-created
 *   EVALUATION_COMPLETED → talent-flow-evaluation-completed
 *   OFFER_APPROVED       → talent-flow-offer-approved
 *   SLA_BREACHED         → talent-flow-sla-breached
 *
 * Hard-Won Invariants referenced:
 *   Invariant #6: notification sends go through SQS queue — never SES directly from workflow Lambdas
 *
 * Implementation notes:
 *   - POSTMARK_API_TOKEN is read from env; lazy-init client so Lambda cold-start is not blocked
 *   - POSTMARK_SENDER_EMAIL is read from env
 *   - MVP1_RECIPIENT_OVERRIDE: if set, all Postmark emails are sent to this address (single-recipient MVP)
 *   - NOTIFICATIONS_TABLE_NAME: DynamoDB table for in-app notifications
 *   - Does NOT call Cognito or query talent-flow-state — recipientEmail must be in the SQS message body
 */

const postmark = require('postmark');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { getConfig } = require('../shared/config-reader');

const SENDER_EMAIL = process.env.POSTMARK_SENDER_EMAIL || 'ignecious@obsydiantechnologies.com';
const MVP1_RECIPIENT = process.env.MVP1_RECIPIENT_OVERRIDE || null;
const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE_NAME;

// ── Lazy-init DynamoDB client ─────────────────────────────────────────────────
let _ddbClient = null;

function getDdbClient() {
  if (!_ddbClient) {
    _ddbClient = new DynamoDBClient({ region: 'af-south-1' });
  }
  return _ddbClient;
}

// ── Lazy-init Postmark client ────────────────────────────────────────────────
let _postmarkClient = null;

function getPostmarkClient() {
  if (!_postmarkClient) {
    const token = process.env.POSTMARK_API_TOKEN;
    if (!token) throw new Error('POSTMARK_API_TOKEN environment variable is not set');
    _postmarkClient = new postmark.ServerClient(token);
  }
  return _postmarkClient;
}

// ── Exported for test injection ───────────────────────────────────────────────
function _setPostmarkClient(client) {
  _postmarkClient = client;
}

// ── Template alias resolution ─────────────────────────────────────────────────
/**
 * Resolve the Postmark template alias for a given event type.
 * If the config table has an entry for this type, use it.
 * Otherwise fall back to 'talent-flow-{type-lowercased-kebab}'.
 *
 * @param {string} type  - e.g. 'INTERVIEW_SCHEDULED'
 * @param {object} templates - EMAIL_TEMPLATES config data, e.g. { INTERVIEW_SCHEDULED: 'tf-interview-v2' }
 * @returns {string} Postmark template alias
 */
function resolveTemplateAlias(type, templates) {
  if (templates && templates[type]) return templates[type];
  return 'talent-flow-' + type.toLowerCase().replace(/_/g, '-');
}

// ── Per-record processor ──────────────────────────────────────────────────────
/**
 * Process a single SQS record.
 * Returns null on success, throws on failure.
 */
async function processRecord(record) {
  let body;
  try {
    body = JSON.parse(record.body);
  } catch (err) {
    throw new Error(`Invalid JSON in message body: ${err.message}`);
  }

  const { type, recipientEmail, recipientId, candidateId, tenantId, ...eventData } = body;

  // ── Validate required fields ─────────────────────────────────────────────
  if (!tenantId) throw new Error('Missing required field: tenantId');
  if (!recipientEmail) throw new Error('Missing required field: recipientEmail');
  if (!type) throw new Error('Missing required field: type');

  const now = new Date();
  const isoNow = now.toISOString();
  // 30-day TTL (seconds)
  const ttl = Math.floor(now.getTime() / 1000) + 30 * 24 * 60 * 60;

  // ── Write in-app notification to DynamoDB ─────────────────────────────────
  if (NOTIFICATIONS_TABLE && recipientId) {
    const notifId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item = {
      PK:         `USER#${recipientId}`,
      SK:         `NOTIF#${isoNow}`,
      notifId,
      type,
      candidateId: candidateId || null,
      tenantId,
      read:       false,
      createdAt:  isoNow,
      expiresAt:  ttl,
      // Sparse GSI attributes — present only on unread items so markNotificationRead
      // evicts them from UnreadIndex by removing these attributes via UpdateItem.
      GSI1PK: `USER#${recipientId}#UNREAD`,
      GSI1SK: `NOTIF#${isoNow}`,
      payload: { ...eventData },
    };
    await getDdbClient().send(new PutItemCommand({
      TableName: NOTIFICATIONS_TABLE,
      Item: marshall(item, { removeUndefinedValues: true }),
    }));
    console.info('In-app notification written', { recipientId, type, notifId });
  }

  // ── Resolve template alias via config ─────────────────────────────────────
  const templates = await getConfig(tenantId, 'EMAIL_TEMPLATES');
  const templateAlias = resolveTemplateAlias(type, templates);

  // ── Build template model ──────────────────────────────────────────────────
  const templateModel = {
    type,
    candidateId: candidateId || null,
    recipientId: recipientId || null,
    ...eventData,
  };

  // ── Send via Postmark (MVP1: all emails go to the override address) ────────
  const toAddress = MVP1_RECIPIENT || recipientEmail;
  const client = getPostmarkClient();
  await client.sendEmailWithTemplate({
    From:          SENDER_EMAIL,
    To:            toAddress,
    TemplateAlias: templateAlias,
    TemplateModel: templateModel,
  });

  console.info('Notification sent', {
    type,
    templateAlias,
    toAddress,
    originalRecipient: recipientEmail,
    candidateId: candidateId || null,
    tenantId,
  });
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const batchItemFailures = [];

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (err) {
      console.error('Failed to process notification record', {
        messageId: record.messageId,
        error: err.message,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

// ── Test helpers ──────────────────────────────────────────────────────────────
exports._setPostmarkClient = _setPostmarkClient;
exports._setDdbClient = (c) => { _ddbClient = c; };
exports._resolveTemplateAlias = resolveTemplateAlias;
