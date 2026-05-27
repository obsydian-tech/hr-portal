'use strict';

/**
 * lambda/updateProvisioningBundle/index.js
 *
 * Trigger: HTTP API v2 — PATCH /v1/provisioning/bundles/{bundleId}
 * Auth:    JWT — HM who owns the bundle or TalentFlowAdmin.
 *
 * Allows updating: items[], templateName, seniority, department, startDate
 * Only allowed when bundleStatus = PENDING_REVIEW.
 *
 * Env vars:
 *   BUNDLES_TABLE — provisioning-bundles DynamoDB table name
 */

const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');

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

const EDITABLE_FIELDS = new Set(['items', 'templateName', 'seniority', 'department', 'startDate']);

exports.handler = async (event) => {
  const claims  = extractClaims(event);
  const userId  = claims.sub;
  const groups  = parseGroups(claims['cognito:groups']);
  const isAdmin = claims['custom:isAdmin'] === 'true' || groups.includes('TalentFlowAdmin');

  if (!userId) return respond(401, { message: 'Unauthorized.' });

  const bundleId = event.pathParameters?.bundleId;
  if (!bundleId) return respond(400, { message: 'bundleId path parameter is required.' });

  let patch;
  try {
    patch = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { message: 'Invalid JSON body.' });
  }

  // Restrict to editable fields only
  const invalidFields = Object.keys(patch).filter(k => !EDITABLE_FIELDS.has(k));
  if (invalidFields.length > 0) {
    return respond(400, { message: `Cannot update fields: ${invalidFields.join(', ')}` });
  }

  // Fetch current bundle
  let bundle;
  try {
    const res = await dynamo.send(new GetItemCommand({
      TableName: BUNDLES_TABLE,
      Key: { bundleId: { S: bundleId } },
    }));
    if (!res.Item) return respond(404, { message: 'Bundle not found.' });
    bundle = unmarshall(res.Item);
  } catch (err) {
    console.error('[updateProvisioningBundle] GetItem error', err);
    return respond(500, { message: 'Internal server error.' });
  }

  if (!isAdmin && bundle.hmUserId !== userId) {
    return respond(404, { message: 'Bundle not found.' });
  }

  if (bundle.bundleStatus !== 'PENDING_REVIEW') {
    return respond(409, { message: 'Bundle can only be edited while in PENDING_REVIEW status.' });
  }

  const now = new Date().toISOString();
  const patchKeys = Object.keys(patch).filter(k => EDITABLE_FIELDS.has(k));

  if (patchKeys.length === 0) {
    return respond(400, { message: 'No editable fields provided.' });
  }

  // Build UpdateExpression dynamically
  const setParts  = ['updatedAt = :updatedAt'];
  const attrNames = {};
  const attrValues = { ':updatedAt': { S: now }, ':pending': { S: 'PENDING_REVIEW' } };

  for (const key of patchKeys) {
    const placeholder  = `:v_${key}`;
    const namePlaceholder = `#f_${key}`;
    setParts.push(`${namePlaceholder} = ${placeholder}`);
    attrNames[namePlaceholder] = key;
    const [marshalled] = Object.values(marshall({ [key]: patch[key] }, { removeUndefinedValues: true }));
    attrValues[placeholder] = marshalled;
  }

  try {
    const res = await dynamo.send(new UpdateItemCommand({
      TableName: BUNDLES_TABLE,
      Key: { bundleId: { S: bundleId } },
      UpdateExpression: `SET ${setParts.join(', ')}`,
      ConditionExpression: 'bundleStatus = :pending',
      ExpressionAttributeNames:  attrNames,
      ExpressionAttributeValues: attrValues,
      ReturnValues: 'ALL_NEW',
    }));
    bundle = unmarshall(res.Attributes);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      return respond(409, { message: 'Bundle was modified concurrently or moved out of PENDING_REVIEW.' });
    }
    console.error('[updateProvisioningBundle] UpdateItem error', err);
    return respond(500, { message: 'Internal server error.' });
  }

  bundle.id = bundle.id ?? bundle.bundleId;
  return respond(200, { bundle });
};
