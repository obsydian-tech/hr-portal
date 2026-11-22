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

const { isIdToken } = require('../shared/id-token');
const { tenantHelper, candidateIsOurs } = require('../shared/tf-tenant.js');
const { rolesHelper } = require('../shared/tf-roles.js');
const { DynamoDBClient, PutItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { getConfig } = require('../shared/config-reader');

const dynamo = new DynamoDBClient({});
const eb     = new EventBridgeClient({});

const BUNDLES_TABLE = process.env.BUNDLES_TABLE;
const EB_BUS_NAME   = process.env.EB_BUS_NAME || 'naleko-onboarding';
const STATE_TABLE   = process.env.STATE_TABLE_NAME || 'talent-flow-state';

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
  if (!isIdToken(event?.requestContext?.authorizer?.jwt?.claims ?? {})) return respond(401, {"message": "Unauthorized."});
  const claims  = extractClaims(event);
  let hmUserId = claims.sub;
  const R = await rolesHelper();
  const isAdmin = R.holds(event, { roles: ['admin'] });

  if (!hmUserId) {
    return respond(401, { message: 'Unauthorized.' });
  }
  const denied = R.requireRole(event, { roles: ['admin', 'manager'] });
  if (denied) return denied;

  // TEN-03: after the group check, the company check. The company is the sign-in's; none is read from the body.
  const T = await tenantHelper();
  hmUserId = T.userIdOf(event) || hmUserId; // TEN-06: a moved person's old id, as stored records know it
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { message: 'Invalid JSON body.' });
  }

  const { candidateId, candidateName, candidateRole, seniority, department, startDate, templateId, items: manualItems } = body;

  if (typeof candidateId !== 'string' || !candidateId || !candidateName || !candidateRole || !startDate) {
    return respond(400, { message: 'candidateId, candidateName, candidateRole, and startDate are required.' });
  }

  try {
    if (!(await candidateIsOurs(dynamo.send.bind(dynamo), QueryCommand, STATE_TABLE, candidateId, tenantId))) return respond(404, { error: 'Not found' });
  } catch (err) {
    console.error('[createProvisioningBundle] candidate check failed', { error: err?.name });
    return respond(500, { error: 'Failed to create provisioning bundle' });
  }

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
      console.warn('[createProvisioningBundle] PROVISIONING_TEMPLATES load failed, using empty items:', { error: err?.name });
    }
  }

  const bundle = T.stampTenant({
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
  }, tenantId);

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
        Detail:       JSON.stringify({ bundleId, candidateId, tenant_id: tenantId, hmUserId }),
      }],
    }));
  } catch (ebErr) {
    console.warn('[createProvisioningBundle] EventBridge publish failed (non-fatal):', { error: ebErr?.name });
  }

  console.info(`[createProvisioningBundle] bundleId=${bundleId} candidate=${candidateId} items=${items.length}`);
  return respond(201, { bundle });
};
