'use strict';

/**
 * lambda/approveProvisioningBundle/index.js
 *
 * Trigger: HTTP API v2 — POST /v1/provisioning/bundles/{bundleId}/approve
 * Auth:    JWT — HM who owns the bundle or TalentFlowAdmin.
 *
 * Transitions bundle: PENDING_REVIEW → APPROVED
 * Publishes BundleApproved event to EventBridge.
 * EventBridge rule will invoke createItTask to create individual IT task records.
 *
 * Env vars:
 *   BUNDLES_TABLE — provisioning-bundles DynamoDB table name
 *   EB_BUS_NAME   — EventBridge bus name (naleko-onboarding)
 */

const { isIdToken } = require('../shared/id-token');
const { tenantHelper, scopeWrite } = require('../shared/tf-tenant.js');
const { rolesHelper } = require('../shared/tf-roles.js');
const { DynamoDBClient, GetItemCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');

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

exports.handler = async (event) => {
  if (!isIdToken(event?.requestContext?.authorizer?.jwt?.claims ?? {})) return respond(401, {"message": "Unauthorized."});
  const claims  = extractClaims(event);
  const userId  = claims.sub;
  const R = await rolesHelper();
  const isAdmin = R.holds(event, { roles: ['admin'] });

  if (!userId) return respond(401, { message: 'Unauthorized.' });

  // TEN-03: after the sign-in checks, the company check. The company is the sign-in's.
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;

  const bundleId = event.pathParameters?.bundleId;
  if (!bundleId) return respond(400, { message: 'bundleId path parameter is required.' });

  // After a failed condition: is the row still this company's? Another company's row is 404, not 409.
  async function stillOurs(id) {
    try {
      const r = await dynamo.send(new GetItemCommand({ TableName: BUNDLES_TABLE, Key: { bundleId: { S: id } } }));
      return !!r.Item && T.ownsRow(unmarshall(r.Item), tenantId);
    } catch { return false; }
  }

  // Fetch current bundle
  let bundle;
  try {
    const res = await dynamo.send(new GetItemCommand({
      TableName: BUNDLES_TABLE,
      Key: { bundleId: { S: bundleId } },
    }));
    if (!res.Item) return T.notFound();
    bundle = unmarshall(res.Item);
    if (!T.ownsRow(bundle, tenantId)) return T.notFound();
  } catch (err) {
    console.error('[approveProvisioningBundle] GetItem error', err);
    return respond(500, { message: 'Internal server error.' });
  }

  // Ownership check
  if (!isAdmin && bundle.hmUserId !== userId) {
    return T.notFound();
  }

  // Idempotency: already approved
  if (bundle.bundleStatus === 'APPROVED' || bundle.bundleStatus === 'IN_FULFILMENT') {
    bundle.id = bundle.id ?? bundle.bundleId;
    return respond(200, { bundle });
  }

  if (bundle.bundleStatus !== 'PENDING_REVIEW') {
    return respond(409, { message: `Cannot approve bundle in status: ${bundle.bundleStatus}` });
  }

  const now = new Date().toISOString();

  // Update bundle status
  try {
    const res = await dynamo.send(new UpdateItemCommand(scopeWrite({
      TableName: BUNDLES_TABLE,
      Key: { bundleId: { S: bundleId } },
      UpdateExpression: 'SET bundleStatus = :s, approvedAt = :a, approvedBy = :by, updatedAt = :u',
      ConditionExpression: 'bundleStatus = :pending',
      ExpressionAttributeValues: marshall({
        ':s':       'APPROVED',
        ':a':       now,
        ':by':      userId,
        ':u':       now,
        ':pending': 'PENDING_REVIEW',
      }),
      ReturnValues: 'ALL_NEW',
    }, tenantId)));
    bundle = unmarshall(res.Attributes);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      if (!(await stillOurs(bundleId))) return T.notFound();
      return respond(409, { message: 'Bundle was modified concurrently. Please refresh and try again.' });
    }
    console.error('[approveProvisioningBundle] UpdateItem error', err);
    return respond(500, { message: 'Internal server error.' });
  }

  // Publish BundleApproved — EventBridge rule fan-outs to createItTask per bundle item
  try {
    await eb.send(new PutEventsCommand({
      Entries: [{
        EventBusName: EB_BUS_NAME,
        Source:       'naleko.talentflow.provisioning',
        DetailType:   'BundleApproved',
        Detail:       JSON.stringify({
          bundleId,
          candidateId:   bundle.candidateId,
          candidateName: bundle.candidateName,
          candidateRole: bundle.candidateRole,
          seniority:     bundle.seniority,
          department:    bundle.department,
          startDate:     bundle.startDate,
          tenant_id:     tenantId,
          items:         bundle.items ?? [],
          approvedBy:    userId,
          approvedAt:    now,
        }),
      }],
    }));
    console.info(`[approveProvisioningBundle] BundleApproved published bundleId=${bundleId}`);
  } catch (ebErr) {
    // EB publish failure is logged but not fatal — bundle IS approved in DDB.
    // createItTask can be triggered manually or via a DLQ retry.
    console.error('[approveProvisioningBundle] EventBridge publish failed:', ebErr.message);
  }

  bundle.id = bundle.id ?? bundle.bundleId;
  return respond(200, { bundle });
};
