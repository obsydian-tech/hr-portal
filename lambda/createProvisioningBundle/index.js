'use strict';

/**
 * lambda/createProvisioningBundle/index.js
 *
 * Trigger: HTTP API v2 — POST /v1/provisioning/bundles
 * Auth:    JWT — any authenticated TalentFlow user (HM, TalentFlowAdmin)
 *
 * Body: {
 *   candidateId:   string,
 *   candidateName: string,
 *   candidateRole: string,
 *   seniority:     string,
 *   department?:   string,
 *   startDate:     string,         // ISO 8601
 *   templateId?:   string,         // optional: match against PROVISIONING_TEMPLATES
 *   items?:        ProvisioningItem[]  // optional manual override
 * }
 *
 * Env vars:
 *   BUNDLES_TABLE     — provisioning-bundles DynamoDB table name
 *   CONFIG_TABLE_NAME — talent-flow-config DynamoDB table name
 *   EB_BUS_NAME       — EventBridge bus name (naleko-onboarding)
 */

const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { getConfig } = require('../shared/config-reader');

const dynamo = new DynamoDBClient({});
const eb     = new EventBridgeClient({});

const BUNDLES_TABLE = process.env.BUNDLES_TABLE;
const EB_BUS_NAME   = process.env.EB_BUS_NAME || 'naleko-onboarding';

function respond(statusCode, body) {
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

function extractClaims(event) {
  return event?.requestContext?.authorizer?.jwt?.claims ?? {};
}

function parseGroups(rawGroups) {
  if (!rawGroups) return [];
  const s = String(rawGroups);
  if (s.startsWith('[')) {
    try { return JSON.parse(s); } catch { return s.slice(1, -1).split(/[\s,]+/).filter(Boolean); }
  }
  return s.split(',').map(g => g.trim()).filter(Boolean);
}

/**
 * Find the best matching template for this candidate.
 * Matches by seniority first, then falls back to any active template.
 */
function matchTemplate(templates, seniority, department, templateId) {
  if (!templates || templates.length === 0) return null;
  const active = templates.filter(t => t.active !== false);
  if (templateId) {
    const byId = active.find(t => t.id === templateId);
    if (byId) return byId;
  }
  // Match by seniority
  const bySeniority = active.find(t =>
    t.targetSeniority && t.targetSeniority.toLowerCase() === seniority?.toLowerCase(),
  );
  if (bySeniority) return bySeniority;
  // Fallback: first active template
  return active[0] ?? null;
}

/** Map template requirements (from PROVISIONING_TEMPLATES config) to ProvisioningItem[] */
function templateToItems(template) {
  if (!template?.requirements) return [];
  return template.requirements.map((req) => ({
    id:           crypto.randomUUID(),
    type:         req.type ?? 'HARDWARE',
    label:        req.label,
    queue:        req.queueName ?? req.queue ?? '',
    status:       'PENDING',
    notes:        '',
    fromTemplate: true,
    specNote:     req.specNote ?? null,
  }));
}

exports.handler = async (event) => {
  const claims  = extractClaims(event);
  const hmUserId = claims.sub;
  const groups   = parseGroups(claims['cognito:groups']);
  const isAdmin  = claims['custom:isAdmin'] === 'true' || groups.includes('TalentFlowAdmin');
  const isHm     = groups.includes('HiringManager') || isAdmin;

  if (!hmUserId) {
    return respond(401, { message: 'Unauthorized.' });
  }
  if (!isHm) {
    return respond(403, { message: 'Forbidden: Hiring Manager or Admin role required.' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { message: 'Invalid JSON body.' });
  }

  const { candidateId, candidateName, candidateRole, seniority, department, startDate, templateId, items: manualItems } = body;

  if (!candidateId || !candidateName || !candidateRole || !startDate) {
    return respond(400, { message: 'candidateId, candidateName, candidateRole, and startDate are required.' });
  }

  const tenantId = 'NALEKO';
  const bundleId = crypto.randomUUID();
  const now      = new Date().toISOString();

  // Load PROVISIONING_TEMPLATES to generate items
  let items = manualItems ?? [];
  let templateName = 'Custom';

  if (!manualItems || manualItems.length === 0) {
    try {
      const cfg = await getConfig(tenantId, 'PROVISIONING_TEMPLATES');
      const templates = cfg.templates ?? [];
      const matched   = matchTemplate(templates, seniority, department, templateId);
      if (matched) {
        items        = templateToItems(matched);
        templateName = matched.name ?? templateName;
      }
    } catch (err) {
      console.warn('[createProvisioningBundle] PROVISIONING_TEMPLATES load failed, using empty items:', err.message);
    }
  }

  const bundle = {
    bundleId,
    tenantId,
    candidateId,
    candidateName,
    candidateRole,
    seniority:    seniority ?? '',
    department:   department ?? '',
    startDate,
    items,
    templateName,
    bundleStatus: 'PENDING_REVIEW',
    slaStatus:    'ON_TRACK',
    hmUserId,
    createdAt: now,
    updatedAt: now,
  };

  await dynamo.send(new PutItemCommand({
    TableName: BUNDLES_TABLE,
    Item:      marshall(bundle, { removeUndefinedValues: true }),
    ConditionExpression: 'attribute_not_exists(bundleId)',
  }));

  // Publish BundleCreated event so HM dashboard can refresh
  try {
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: EB_BUS_NAME,
        Source:       'naleko.talentflow.provisioning',
        DetailType:   'BundleCreated',
        Detail:       JSON.stringify({ bundleId, candidateId, tenantId, hmUserId }),
      }],
    }));
  } catch (ebErr) {
    console.warn('[createProvisioningBundle] EventBridge publish failed (non-fatal):', ebErr.message);
  }

  console.info(`[createProvisioningBundle] bundleId=${bundleId} candidate=${candidateId} items=${items.length}`);
  return respond(201, { bundle });
};
