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
 *        body: { tenantId, configType, data }
 *        → create version 1 of a new configType
 *        → 409 if an active version already exists (use PUT to update)
 *
 *   PUT  /config   (admin only)
 *        body: { tenantId, configType, data }
 *        → write new version N+1 (isActive=true, GSI1 keys set)
 *        → deactivate version N (isActive=false, GSI1 keys removed, expiresAt TTL set)
 *        → 404 if no active version exists yet (use POST to create)
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

function isAdmin(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims ?? {};
  // Primary check: custom:isAdmin injected by talentFlowPreTokenTrigger
  if (claims['custom:isAdmin'] === 'true') return true;
  // cognito:groups — API GW HTTP JWT authorizer serialises the array claim as a string.
  // Observed formats:
  //   1. JSON array string: '["g1","g2"]'
  //   2. Bracket+space:     '[g1 g2]'   ← actual Cognito format from browser
  //   3. Comma-separated:   'g1,g2'
  //   4. Native JS array:   ['g1','g2']
  const rawGroups = claims['cognito:groups'] ?? '';
  let groups;
  if (Array.isArray(rawGroups)) {
    groups = rawGroups;
  } else if (typeof rawGroups === 'string' && rawGroups.startsWith('[')) {
    try {
      groups = JSON.parse(rawGroups); // format 1
    } catch {
      groups = rawGroups.slice(1, -1).split(/\s+/).filter(Boolean); // format 2
    }
  } else {
    groups = String(rawGroups).split(',').map(g => g.trim()).filter(Boolean); // format 3
  }
  return groups.includes('naleko-talentflow-admin') || groups.includes('TalentFlowAdmin');
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

async function handleGet(event) {
  const qs = event.queryStringParameters || {};
  const tenantId = qs.tenantId || 'DEFAULT';
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
      tenantId,
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
  if (!isAdmin(event)) {
    return respond(403, { error: 'Forbidden: custom:isAdmin claim required' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { tenantId = 'DEFAULT', configType, data } = body;

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
      tenantId,
      configType,
      version,
      isActive: true,
      data,
      createdAt: now
      // No expiresAt on active versions
    }),
    ConditionExpression: 'attribute_not_exists(PK)' // safety — prevent overwrite
  }));

  console.info(`CONFIG_CREATED tenantId=${tenantId} configType=${configType} version=${version}`);
  return respond(201, { tenantId, configType, version });
}

async function handlePut(event) {
  if (!isAdmin(event)) {
    return respond(403, { error: 'Forbidden: custom:isAdmin claim required' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { tenantId = 'DEFAULT', configType, data } = body;

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
        tenantId,
        configType,
        version: 1,
        isActive: true,
        data,
        createdAt: now,
      }),
      ConditionExpression: 'attribute_not_exists(PK)',
    }));
    console.info(`CONFIG_CREATED_VIA_PUT tenantId=${tenantId} configType=${configType} version=1`);
    return respond(200, { tenantId, configType, version: 1, data, updatedAt: now });
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
      tenantId,
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

  console.info(`CONFIG_VERSION_PUBLISHED tenantId=${tenantId} configType=${configType} oldVersion=${oldVersion} newVersion=${newVersion}`);
  return respond(200, { tenantId, configType, version: newVersion, previousVersion: oldVersion });
}

// ── Main handler ──────────────────────────────────────────────────────────────

exports.handler = async (event) => {
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
