'use strict';

/**
 * lambda/getProvisioningBundle/index.js
 *
 * Trigger: HTTP API v2 — GET /v1/provisioning/bundles/{bundleId}
 * Auth:    JWT — returns 404 instead of 403 for non-owners to avoid enumeration.
 *
 * Env vars:
 *   BUNDLES_TABLE — provisioning-bundles DynamoDB table name
 */

const { isIdToken } = require('../shared/id-token');
const { tenantHelper } = require('../shared/tf-tenant.js');
const { rolesHelper } = require('../shared/tf-roles.js');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamo = new DynamoDBClient({});
const BUNDLES_TABLE = process.env.BUNDLES_TABLE;

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
  const userId   = claims.sub;
  const R = await rolesHelper();
  const isAdmin = R.holds(event, { roles: ['admin'] });

  if (!userId) return respond(401, { message: 'Unauthorized.' });

  // TEN-03: after the sign-in checks, the company check. The company is the sign-in's.
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;

  const bundleId = event.pathParameters?.bundleId;
  if (!bundleId) return respond(400, { message: 'bundleId path parameter is required.' });

  try {
    const res = await dynamo.send(new GetItemCommand({
      TableName: BUNDLES_TABLE,
      Key: { bundleId: { S: bundleId } },
    }));

    if (!res.Item) return T.notFound();

    const bundle = unmarshall(res.Item);
    if (!T.ownsRow(bundle, tenantId)) return T.notFound();

    // Ownership check: non-admins can only see their own bundles
    if (!isAdmin && bundle.hmUserId !== userId) {
      return T.notFound();
    }

    // Normalize: add `id` alias
    bundle.id = bundle.id ?? bundle.bundleId;

    return respond(200, { bundle });

  } catch (err) {
    console.error('[getProvisioningBundle] error', err);
    return respond(500, { message: 'Internal server error.' });
  }
};
