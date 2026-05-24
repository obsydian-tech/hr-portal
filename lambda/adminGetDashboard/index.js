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

const { DynamoDBClient, QueryCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamo      = new DynamoDBClient({});
const STATE_TABLE = process.env.STATE_TABLE_NAME || 'talent-flow-state';
const USERS_TABLE = process.env.USERS_TABLE_NAME || 'talent-flow-users';
const TENANT_ID   = 'NALEKO';

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

function hasAdminRole(claims) {
  // Path 1: TalentFlow pool token — custom:roles injected by pre-token trigger
  try {
    const roles = JSON.parse(claims['custom:roles'] || '[]');
    if (Array.isArray(roles) && roles.includes('ADMIN')) return true;
  } catch { /* fall through */ }

  // Path 2: Naleko pool token (pool consolidation, Epic 5).
  // API Gateway HTTP API v2 serialises cognito:groups as a space-separated
  // string, NOT a JSON array. Handle both formats defensively.
  const raw = claims['cognito:groups'];
  if (!raw) return false;
  let groups;
  try { groups = JSON.parse(raw); } catch { /* not JSON */ }
  if (!Array.isArray(groups)) groups = String(raw).split(' ');
  return groups.includes('naleko-talentflow-admin');
}

/** Fetch all SAGA records for the tenant via GSI1 (paginated). */
async function getAllSagaRecords() {
  const records = [];
  let lastKey;

  do {
    const params = {
      TableName: STATE_TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk':     { S: `TENANT#${TENANT_ID}` },
        ':prefix': { S: 'SAGA#' },
      },
    };
    if (lastKey) params.ExclusiveStartKey = lastKey;

    const result = await dynamo.send(new QueryCommand(params));
    records.push(...(result.Items || []).map(unmarshall));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return records;
}

/** Count ACTIVE users in the talent-flow-users table. */
async function countActiveUsers() {
  let count = 0;
  let lastKey;

  do {
    const params = {
      TableName: USERS_TABLE,
      FilterExpression: '#s = :active',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':active': { S: 'ACTIVE' } },
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
  const claims = extractClaims(event);
  console.info('adminGetDashboard auth', { rolesRaw: claims['custom:roles'], groupsRaw: claims['cognito:groups'] });
  if (!hasAdminRole(claims)) {
    return respond(403, { error: 'Admin role required' });
  }

  try {
    const [sagaRecords, activeUsers] = await Promise.all([
      getAllSagaRecords(),
      countActiveUsers(),
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
