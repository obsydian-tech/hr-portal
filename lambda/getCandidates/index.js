'use strict';

/**
 * lambda/getCandidates/index.js
 *
 * Returns a paginated list of candidate SAGA records from talent-flow-state
 * using GSI1 (GSI1PK = TENANT#<tenantId>) — avoids full table scan.
 *
 * Query params (all optional):
 *   stage            — FilterExpression on currentStage
 *   positionLevel    — FilterExpression on positionLevel
 *   slaStatus        — FilterExpression on slaStatus
 *   search           — contains() match on firstName/lastName/email
 *   hiringManagerId  — FilterExpression on hiringManagerId (Cognito sub of HM)
 *   limit            — default 50, max 100
 *   nextToken        — exclusive start key (base64 JSON)
 */

const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { tenantHelper } = require('../shared/tf-tenant.js');

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
  // TEN-03: the company comes from the sign-in only. tenantId in the query string is not read.
  const T = await tenantHelper();
  const { tenantId, refusal } = T.requireTenant(event);
  if (refusal) return refusal;
  // MOD-01: Recruitment must be on for the company (after the company check, before any other AWS call).
  const { requireModule } = await import('../shared/modules.mjs');
  const moduleOff = await requireModule(event, 'recruitment');
  if (moduleOff) return moduleOff;

  const qs = event.queryStringParameters || {};
  const limit = Math.min(parseInt(qs.limit || '50', 10), 100);
  const { stage, positionLevel, slaStatus, search, hiringManagerId, nextToken } = qs;


  // GSI1 key condition — only fetch SAGA records for this tenant
  const exprValues = {
    ':pk': { S: T.tenantKey(tenantId) },
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
  if (hiringManagerId) {
    filterParts.push('hiringManagerId = :hmId');
    exprValues[':hmId'] = { S: hiringManagerId };
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
    const candidates = (result.Items || []).filter((item) => T.ownsRow(unmarshall(item), tenantId)).map((item) => {
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
