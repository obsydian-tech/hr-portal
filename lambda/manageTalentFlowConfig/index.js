'use strict';

/**
 * lambda/manageTalentFlowConfig/index.js
 *
 * Trigger: HTTP API V2 — POST/PUT/GET /config
 *   (wired in TF-010, protected by Cognito JWT authorizer)
 *
 * Operations:
 *   GET  /config?configType=SCORING_WEIGHTS[&active=true]
 *        → list all versions for a configType, or active-only when ?active=true
 *
 *   POST /config   (admin only)
 *        body: { configType, data }
 *        → create version 1 of a new configType
 *        → 409 if an active version already exists (use PUT to update)
 *
 *   PUT  /config   (admin only)
 *        body: { configType, data }
 *        → write new version N+1 (isActive=true, GSI1 keys set)
 *        → deactivate version N (isActive=false, GSI1 keys removed, expiresAt TTL set)
 *        → if no active version exists yet, creates v1 (upsert) and returns 200
 *
 * Admin guard (Epic 2 invariant #4):
 *   event.requestContext.authorizer.jwt.claims['custom:isAdmin'] MUST equal 'true'
 *   for POST and PUT. GET is read-only, no admin guard.
 *
 * TTL invariant (Epic 2 invariant #7):
 *   NEVER delete old config versions — only set expiresAt = now + 365 days.
 *   In-flight candidates locked to old versions must still be able to read them.
 *
 * Env vars:
 *   CONFIG_TABLE_NAME — talent-flow-config
 */

const { isIdToken } = require('../shared/id-token');
const { rolesHelper } = require('../shared/tf-roles.js');
const { tenantHelper } = require('../shared/tf-tenant.js');
const { DynamoDBClient, QueryCommand, PutItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const client = new DynamoDBClient({});
const TABLE = process.env.CONFIG_TABLE_NAME;

const TTL_365_DAYS_S = 365 * 24 * 60 * 60; // seconds

// ── Helpers ───────────────────────────────────────────────────────────────────

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

async function isAdmin(event) {
  return (await rolesHelper()).holds(event, { roles: ['admin'] });
}

/**
 * Query active version for a configType via GSI1-active-configs.
 * Returns the full unmarshalled item or null.
 */
async function getActiveItem(tenantId, configType) {
  const result = await client.send(new QueryCommand({
    TableName: TABLE,
    IndexName: 'GSI1-active-configs',
    KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
    ExpressionAttributeValues: marshall({
      ':pk': `TENANT#${tenantId}#ACTIVE`,
      ':sk': `CONFIG#${configType}`
    }),
    Limit: 1
  }));
  return result.Items?.length ? unmarshall(result.Items[0]) : null;
}

/**
 * Query ALL versions for a configType (audit trail).
 * Returns array of unmarshalled items ordered by SK (version ascending).
 */
async function getAllVersions(tenantId, configType) {
  const result = await client.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
    ExpressionAttributeValues: marshall({
      ':pk': `TENANT#${tenantId}`,
      ':skPrefix': `CONFIG#${configType}#v`
    })
  }));
  return (result.Items || []).map(item => unmarshall(item));
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// TEN-03: the company is the sign-in's. tenantId in the query or body is not read.
async function companyOf(event) {
  const T = await tenantHelper();
  const t = T.requireTenant(event);
  if (t.refusal) return { T, ...t };
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  return moduleOff ? { T, refusal: moduleOff } : { T, ...t };
}

async function handleGet(event) {
  // REC-01: Recruitment settings are read by a Recruiter or an admin. The role answer comes first, before any AWS call.
  // (Saving, below, stays admin only through isAdmin.)
  const RA = await import('../shared/recruitment-access.mjs');
  const notAllowed = RA.requireRecruiterOrAdmin(event);
  if (notAllowed) return notAllowed;
  const { tenantId, refusal } = await companyOf(event);
  if (refusal) return refusal;
  const qs = event.queryStringParameters || {};
  const configType = qs.configType;
  const activeOnly = qs.active === 'true';

  if (!configType) {
    return respond(400, { error: 'configType query parameter is required' });
  }

  if (activeOnly) {
    const item = await getActiveItem(tenantId, configType);
    // Return empty config (200) instead of 404 — the admin UI treats missing config as
    // "not yet configured" and shows an empty state, not an error.
    if (!item) return respond(200, {
      configType,
      version: null,
      isActive: false,
      data: {},
      createdAt: null,
      updatedAt: null,
    });
    return respond(200, item);
  }

  const items = await getAllVersions(tenantId, configType);
  return respond(200, { items, count: items.length });
}

async function handlePost(event) {
  if (!(await isAdmin(event))) {
    return respond(403, { error: 'Forbidden' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { configType, data } = body;
  const { T, tenantId, refusal } = await companyOf(event);
  if (refusal) return refusal;

  if (!configType || data === undefined) {
    return respond(400, { error: 'configType and data are required' });
  }

  // Guard: reject if an active version already exists — use PUT to update
  const existing = await getActiveItem(tenantId, configType);
  if (existing) {
    return respond(409, {
      error: `Config already exists for configType=${configType} at version ${existing.version}. Use PUT to create a new version.`
    });
  }

  const now = new Date().toISOString();
  const version = 1;

  await client.send(new PutItemCommand({
    TableName: TABLE,
    Item: marshall({
      PK: `TENANT#${tenantId}`,
      SK: `CONFIG#${configType}#v${version}`,
      GSI1PK: `TENANT#${tenantId}#ACTIVE`,
      GSI1SK: `CONFIG#${configType}`,
      tenant_id: tenantId,
      configType,
      version,
      isActive: true,
      data,
      createdAt: now
      // No expiresAt on active versions
    }),
    ConditionExpression: 'attribute_not_exists(PK)' // safety — prevent overwrite
  }));

  console.info(`CONFIG_CREATED configType=${configType} version=${version}`);
  return respond(201, { configType, version });
}

async function handlePut(event) {
  if (!(await isAdmin(event))) {
    return respond(403, { error: 'Forbidden' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { configType, data } = body;
  const { T, tenantId, refusal } = await companyOf(event);
  if (refusal) return refusal;

  if (!configType || data === undefined) {
    return respond(400, { error: 'configType and data are required' });
  }

  // Get current active version N — if none exists, bootstrap v1 (upsert semantics)
  const activeItem = await getActiveItem(tenantId, configType);
  if (!activeItem) {
    const now = new Date().toISOString();
    await client.send(new PutItemCommand({
      TableName: TABLE,
      Item: marshall({
        PK: `TENANT#${tenantId}`,
        SK: `CONFIG#${configType}#v1`,
        GSI1PK: `TENANT#${tenantId}#ACTIVE`,
        GSI1SK: `CONFIG#${configType}`,
        tenant_id: tenantId,
        configType,
        version: 1,
        isActive: true,
        data,
        createdAt: now,
      }),
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
    console.info(`CONFIG_CREATED_VIA_PUT configType=${configType} version=1`);
    return respond(200, { configType, version: 1, data, updatedAt: now });
  }

  const oldVersion = activeItem.version;
  const newVersion = oldVersion + 1;
  const now = new Date().toISOString();
  const nowEpochS = Math.floor(Date.now() / 1000);

  // Step 1: Write new version N+1 (isActive=true, GSI1 keys present)
  await client.send(new PutItemCommand({
    TableName: TABLE,
    Item: marshall({
      PK: `TENANT#${tenantId}`,
      SK: `CONFIG#${configType}#v${newVersion}`,
      GSI1PK: `TENANT#${tenantId}#ACTIVE`,
      GSI1SK: `CONFIG#${configType}`,
      tenant_id: tenantId,
      configType,
      version: newVersion,
      isActive: true,
      data,
      createdAt: now
    }),
    ConditionExpression: 'attribute_not_exists(PK)'
  }));

  // Step 2: Deactivate old version N — remove GSI1 keys, set TTL, isActive=false
  // NEVER delete — in-flight candidates may still reference this version
  await client.send(new UpdateItemCommand({
    TableName: TABLE,
    Key: marshall({
      PK: `TENANT#${tenantId}`,
      SK: `CONFIG#${configType}#v${oldVersion}`
    }),
    UpdateExpression: 'SET isActive = :false, expiresAt = :ttl REMOVE GSI1PK, GSI1SK',
    ExpressionAttributeValues: marshall({
      ':false': false,
      ':ttl': nowEpochS + TTL_365_DAYS_S
    })
  }));

  console.info(`CONFIG_VERSION_PUBLISHED configType=${configType} oldVersion=${oldVersion} newVersion=${newVersion}`);
  return respond(200, { configType, version: newVersion, previousVersion: oldVersion });
}

// ── Main handler ──────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  if (!isIdToken(event?.requestContext?.authorizer?.jwt?.claims ?? {})) return respond(403, {"error": "Forbidden: custom:isAdmin claim required"});
  const method = event?.requestContext?.http?.method?.toUpperCase();

  try {
    switch (method) {
      case 'GET':  return await handleGet(event);
      case 'POST': return await handlePost(event);
      case 'PUT':  return await handlePut(event);
      default:
        return respond(405, { error: `Method ${method} not allowed` });
    }
  } catch (err) {
    console.error('manageTalentFlowConfig unhandled error:', err.message, err.stack);
    return respond(500, { error: 'Internal server error' });
  }
};
