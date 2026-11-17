'use strict';

/**
 * lambda/adminGetDashboard/index.js — Admin-S1
 *
 * Aggregates KPI metrics for the admin Global Dashboard.
 *
 * Returns:
 *   kpis.activePipeline  — count of ACTIVE SAGA candidates
 *   kpis.slaBreached     — count of BREACHED candidates
 *   kpis.activeUsers     — count of ACTIVE users in talent-flow-users table
 *   breachedCandidates   — full SAGA records with slaStatus = BREACHED
 *   lastRefreshed        — ISO timestamp
 *
 * Access: ADMIN role only (checked via custom:roles JWT claim).
 */

const { isIdToken } = require('../shared/id-token');
const { rolesHelper } = require('../shared/tf-roles.js');
const { tenantHelper } = require('../shared/tf-tenant.js');
const { DynamoDBClient, QueryCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamo      = new DynamoDBClient({});
const STATE_TABLE = process.env.STATE_TABLE_NAME || 'talent-flow-state';
const USERS_TABLE = process.env.USERS_TABLE_NAME || 'talent-flow-users';

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
  return event.requestContext?.authorizer?.jwt?.claims || {};
}


/** Fetch all SAGA records for the tenant via GSI1 (paginated). */
async function getAllSagaRecords(T, tenantId) {
  const records = [];
  let lastKey;

  do {
    const params = {
      TableName: STATE_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk':     { S: T.tenantKey(tenantId) },
        ':prefix': { S: 'SAGA#' },
      },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;

    const result = await dynamo.send(new QueryCommand(params));
    records.push(...(result.Items || []).map(unmarshall).filter((r) => T.ownsRow(r, tenantId)));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return records;
}

/** Count ACTIVE users in the talent-flow-users table. */
async function countActiveUsers(T, tenantId) {
  let count = 0;
  let lastKey;

  do {
    const f = T.andFilter(
      { FilterExpression: '#s = :active', ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: { ':active': 'ACTIVE' } },
      T.tenantFilter(tenantId),
    );
    const params = {
      TableName: USERS_TABLE,
      FilterExpression: f.FilterExpression,
      ExpressionAttributeNames: f.ExpressionAttributeNames,
      ExpressionAttributeValues: marshall(f.ExpressionAttributeValues),
      Select: 'COUNT',
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;

    const result = await dynamo.send(new ScanCommand(params));
    count  += result.Count || 0;
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return count;
}

exports.handler = async (event) => {
  if (!isIdToken(event?.requestContext?.authorizer?.jwt?.claims ?? {})) return respond(403, {"error": "Admin role required"});
  const claims = extractClaims(event);
  const R = await rolesHelper();
  const denied = R.requireRole(event, { roles: ['admin'] });
  if (denied) return denied;
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;


  try {
    const [sagaRecords, activeUsers] = await Promise.all([
      getAllSagaRecords(T, tenantId),
      countActiveUsers(T, tenantId),
    ]);

    const activePipeline      = sagaRecords.filter((r) => r.status === 'ACTIVE').length;
    const slaBreached         = sagaRecords.filter((r) => r.slaStatus === 'BREACHED').length;
    const breachedCandidates  = sagaRecords.filter((r) => r.slaStatus === 'BREACHED');

    console.info('adminGetDashboard', { activePipeline, slaBreached, activeUsers });

    return respond(200, {
      kpis: {
        activePipeline,
        slaBreached,
        activeUsers,
      },
      breachedCandidates,
      lastRefreshed: new Date().toISOString(),
    });
  } catch (err) {
    console.error('adminGetDashboard error', { error: err.message });
    return respond(500, { error: 'Failed to load dashboard data' });
  }
};
