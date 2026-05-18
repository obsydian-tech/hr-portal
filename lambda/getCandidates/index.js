'use strict';

/**
 * lambda/getCandidates/index.js
 *
 * Returns a paginated list of candidate SAGA records from talent-flow-state
 * using GSI1 (GSI1PK = TENANT#<tenantId>) — avoids full table scan.
 *
 * Query params (all optional):
 *   stage          — FilterExpression on currentStage
 *   positionLevel  — FilterExpression on positionLevel
 *   slaStatus      — FilterExpression on slaStatus
 *   search         — contains() match on firstName/lastName/email
 *   limit          — default 50, max 100
 *   nextToken      — exclusive start key (base64 JSON)
 */

const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamo = new DynamoDBClient({});
const STATE_TABLE = process.env.STATE_TABLE_NAME || 'talent-flow-state';

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

exports.handler = async (event) => {
  const qs = event.queryStringParameters || {};
  const limit = Math.min(parseInt(qs.limit || '50', 10), 100);
  const { stage, positionLevel, slaStatus, search, nextToken, tenantId: qsTenant } = qs;

  // Pool consolidation (Epic 5): custom:tenantId was a TF-pool-only claim.
  // Frontend now always sends ?tenantId= query param; fall back to 'DEFAULT' only
  // if neither source is present (should not happen in production).
  const claims = event.requestContext?.authorizer?.jwt?.claims || {};
  const tenantId = qsTenant || claims['custom:tenantId'] || 'DEFAULT';

  // GSI1 key condition — only fetch SAGA records for this tenant
  const exprValues = {
    ':pk': { S: `TENANT#${tenantId}` },
    ':sagaPrefix': { S: 'SAGA#' },
  };
  const exprNames = {};

  // Optional filter expressions
  const filterParts = [];
  if (stage) {
    filterParts.push('#stage = :stage');
    exprValues[':stage'] = { S: stage };
    exprNames['#stage'] = 'currentStage';
  }
  if (positionLevel) {
    filterParts.push('positionLevel = :pl');
    exprValues[':pl'] = { S: positionLevel };
  }
  if (slaStatus) {
    filterParts.push('slaStatus = :sla');
    exprValues[':sla'] = { S: slaStatus };
  }
  if (search) {
    filterParts.push(
      '(contains(firstName, :s) OR contains(lastName, :s) OR contains(email, :s))',
    );
    exprValues[':s'] = { S: search };
  }

  const params = {
    TableName: STATE_TABLE,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sagaPrefix)',
    ExpressionAttributeValues: exprValues,
    Limit: limit,
  };
  if (filterParts.length) {
    params.FilterExpression = filterParts.join(' AND ');
  }
  if (Object.keys(exprNames).length) {
    params.ExpressionAttributeNames = exprNames;
  }
  if (nextToken) {
    try {
      params.ExclusiveStartKey = JSON.parse(
        Buffer.from(nextToken, 'base64').toString('utf8'),
      );
    } catch (_) {
      return respond(400, { message: 'Invalid nextToken' });
    }
  }

  try {
    const result = await dynamo.send(new QueryCommand(params));
    const candidates = (result.Items || []).map((item) => {
      const c = unmarshall(item);
      // Normalise: frontend Candidate interface uses `id`, DynamoDB stores `candidateId`
      if (!c.id && c.candidateId) c.id = c.candidateId;
      return c;
    });

    const response = { candidates, total: candidates.length };
    if (result.LastEvaluatedKey) {
      response.nextToken = Buffer.from(
        JSON.stringify(result.LastEvaluatedKey),
      ).toString('base64');
    }
    return respond(200, response);
  } catch (err) {
    console.error('getCandidates error', err);
    return respond(500, { message: 'Failed to retrieve candidates' });
  }
};
