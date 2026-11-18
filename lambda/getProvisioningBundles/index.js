'use strict';

/**
 * lambda/getProvisioningBundles/index.js
 *
 * Trigger: HTTP API v2 — GET /v1/provisioning/bundles
 * Auth:    JWT — HM sees only their own bundles; TalentFlowAdmin sees all.
 *
 * Query params:
 *   status     — optional: PENDING_REVIEW | APPROVED | IN_FULFILMENT | READY
 *   nextToken  — optional pagination cursor (base64 JSON)
 *
 * Env vars:
 *   BUNDLES_TABLE — provisioning-bundles DynamoDB table name
 */

const { isIdToken } = require('../shared/id-token');
const { tenantHelper } = require('../shared/tf-tenant.js');
const { rolesHelper } = require('../shared/tf-roles.js');
const { DynamoDBClient, QueryCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamo = new DynamoDBClient({});
const BUNDLES_TABLE = process.env.BUNDLES_TABLE;
const GSI_BY_HM    = 'byHmId';

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

exports.handler = async (event) => {
  if (!isIdToken(event?.requestContext?.authorizer?.jwt?.claims ?? {})) return respond(401, {"message": "Unauthorized."});
  const claims   = extractClaims(event);
  let hmUserId = claims.sub;
  const R = await rolesHelper();
  const isAdmin = R.holds(event, { roles: ['admin'] });

  if (!hmUserId) return respond(401, { message: 'Unauthorized.' });

  // TEN-03: the company is the sign-in's. Bundles carry tenant_id; lists are filtered by it.
  const T = await tenantHelper();
  hmUserId = T.userIdOf(event) || hmUserId; // TEN-06: a moved person's old id, as stored records know it
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;

  const qs            = event.queryStringParameters ?? {};
  const statusFilter  = qs.status ?? null;
  const nextTokenRaw  = qs.nextToken ?? null;

  let ExclusiveStartKey;
  if (nextTokenRaw) {
    try { ExclusiveStartKey = JSON.parse(Buffer.from(nextTokenRaw, 'base64').toString('utf-8')); } catch { /* ignore */ }
  }

  let bundles = [];
  let lastKey;

  try {
    if (isAdmin) {
      // Admin: scan all bundles (small table expected — tenant-level data)
      const f = T.andFilter(
        statusFilter
          ? { FilterExpression: 'bundleStatus = :status', ExpressionAttributeNames: {}, ExpressionAttributeValues: { ':status': statusFilter } }
          : { ExpressionAttributeNames: {}, ExpressionAttributeValues: {} },
        T.tenantFilter(tenantId),
      );
      const res = await dynamo.send(new ScanCommand({
        TableName:                 BUNDLES_TABLE,
        FilterExpression:          f.FilterExpression,
        ExpressionAttributeNames:  f.ExpressionAttributeNames,
        ExpressionAttributeValues: marshall(f.ExpressionAttributeValues),
        ExclusiveStartKey,
        Limit: 50,
      }));
      bundles = (res.Items ?? []).map(i => unmarshall(i));
      lastKey = res.LastEvaluatedKey;
    } else {
      // HM: query GSI1 byHmId
      const keyCondition   = 'hmUserId = :hmId';
      const attrValues     = { ':hmId': { S: hmUserId } };
      const f = T.andFilter(
        statusFilter
          ? { FilterExpression: 'bundleStatus = :status', ExpressionAttributeNames: {}, ExpressionAttributeValues: { ':status': statusFilter } }
          : { ExpressionAttributeNames: {}, ExpressionAttributeValues: {} },
        T.tenantFilter(tenantId),
      );
      Object.assign(attrValues, marshall(f.ExpressionAttributeValues));

      const res = await dynamo.send(new QueryCommand({
        TableName:                 BUNDLES_TABLE,
        IndexName:                 GSI_BY_HM,
        KeyConditionExpression:    keyCondition,
        FilterExpression:          f.FilterExpression,
        ExpressionAttributeNames:  f.ExpressionAttributeNames,
        ExpressionAttributeValues: attrValues,
        ExclusiveStartKey,
        ScanIndexForward:          false, // newest first
        Limit: 50,
      }));
      bundles = (res.Items ?? []).map(i => unmarshall(i));
      lastKey = res.LastEvaluatedKey;
    }

    // Normalize: add `id` alias for bundleId (Angular model expects `id`)
    bundles = bundles.filter(b => T.ownsRow(b, tenantId)).map(b => ({ ...b, id: b.id ?? b.bundleId }));

    const response = { bundles };
    if (lastKey) {
      response.nextToken = Buffer.from(JSON.stringify(lastKey)).toString('base64');
    }

    return respond(200, response);

  } catch (err) {
    console.error('[getProvisioningBundles] error', err);
    return respond(500, { message: 'Internal server error.' });
  }
};
