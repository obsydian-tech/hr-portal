// NH-28: DynamoDB hardening — GSI query for non-managers, server-side pagination
import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { legacyPage } from '../shared/company-rows.mjs';
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { stepOf } from '../shared/onboarding-step.mjs';
import { hrOrAgent, inGroup } from '../shared/hr-group.mjs';
import { requireTenant, tenantFilter, andFilter, readsLegacyRows } from '../shared/tenant.mjs';

const dynamodb = new DynamoDBClient();

const logger = new Logger({ serviceName: 'getEmployees' });
const tracer = new Tracer({ serviceName: 'getEmployees' });

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
};

/** Encode DynamoDB LastEvaluatedKey to a URL-safe base64 string. */
function encodeKey(key) {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

/** Decode a base64-encoded pagination cursor back to a DynamoDB key map. */
function decodeKey(cursor) {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
}

/** The request's own filter AND the company filter, in AttributeValue form. */
function companyOnly(params, tenantId) {
  const t = tenantFilter(tenantId);
  const merged = andFilter(
    { FilterExpression: params.FilterExpression, ExpressionAttributeNames: params.ExpressionAttributeNames },
    { FilterExpression: t.FilterExpression, ExpressionAttributeNames: t.ExpressionAttributeNames },
  );
  return {
    FilterExpression: merged.FilterExpression,
    ExpressionAttributeNames: merged.ExpressionAttributeNames,
    ExpressionAttributeValues: { ...(params.ExpressionAttributeValues ?? {}), ':tenant_id': { S: tenantId } },
  };
}

const handlerFn = async (event) => {
  const refused = hrOrAgent(event, 'Only HR can look up employees');
  if (refused) return { ...refused, headers: CORS_HEADERS };
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return { ...refusal, headers: CORS_HEADERS };
  logger.info('Handler invoked', { path: event.path, httpMethod: event.httpMethod });
  tracer.putAnnotation('operation', 'getEmployees');

  try {
    // 1. Resolve caller identity — support both JWT (HR staff) and agent API key (actor=AGENT)
    const lambdaActor = event.requestContext?.authorizer?.lambda?.actor ?? '';
    const isAgent = lambdaActor === 'AGENT';

    const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
    const staffMemberId = isAgent ? 'agent' : (claims['custom:staff_id'] || claims['sub'] || '');
    // Agents get full manager-level access (scan all employees)
    const isManager = isAgent || inGroup(claims, 'hr_staff');

    if (!isAgent && !staffMemberId) {
      return {
        statusCode: 401,
        headers: CORS_HEADERS,
        body: JSON.stringify({ error: 'Unable to resolve staff identity from token' }),
      };
    }

    // 2. Parse query parameters
    const qp    = event.queryStringParameters || {};
    const stage      = qp.stage;
    const department = qp.department;
    const limit      = Math.min(parseInt(qp.limit || '50', 10), 200); // cap at 200
    const cursor     = qp.lastKey;  // base64url-encoded LastEvaluatedKey from prev page

    const exclusiveStartKey = cursor ? decodeKey(cursor) : undefined;

    logger.info('Query params', { staffMemberId, isManager, stage, department, limit, hasCursor: !!cursor });

    let items;
    let lastEvaluatedKey;

    if (!isManager) {
      // NH-28: non-managers — Query on created_by-index GSI to avoid full-table Scan
      const queryParams = {
        TableName: 'employees',
        IndexName: 'created_by-index',
        KeyConditionExpression: 'created_by = :staffId',
        ExpressionAttributeValues: { ':staffId': { S: staffMemberId } },
        Limit: limit,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      };

      // Optional stage filter applied server-side via FilterExpression
      if (stage) {
        queryParams.FilterExpression = '#st = :stage';
        queryParams.ExpressionAttributeNames = { '#st': 'stage' };
        queryParams.ExpressionAttributeValues[':stage'] = { S: stage };
      }
      Object.assign(queryParams, companyOnly(queryParams, tenantId));

      const result = await dynamodb.send(new QueryCommand(queryParams));
      items = result.Items.map(item => unmarshall(item));
      lastEvaluatedKey = result.LastEvaluatedKey;

    } else if (!readsLegacyRows(tenantId)) {
      // TEN-02: the company's rows only, from tenant-index (never a Scan of everyone).
      const queryParams = {
        TableName: 'employees',
        IndexName: 'tenant-index',
        KeyConditionExpression: '#tenant_id = :tenant_id',
        ExpressionAttributeNames: { '#tenant_id': 'tenant_id' },
        ExpressionAttributeValues: { ':tenant_id': { S: tenantId } },
        Limit: limit,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      };
      if (stage) {
        queryParams.FilterExpression = '#st = :stage';
        queryParams.ExpressionAttributeNames['#st'] = 'stage';
        queryParams.ExpressionAttributeValues[':stage'] = { S: stage };
      }
      const result = await dynamodb.send(new QueryCommand(queryParams));
      items = result.Items.map(item => unmarshall(item));
      lastEvaluatedKey = result.LastEvaluatedKey;

    } else {
      // Managers of the legacy company while the legacy rule is on — Scan with the company filter (TEN-02 step 2 removes this)
      const scanParams = {
        TableName: 'employees',
        Limit: limit,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      };

      // Optional stage filter
      if (stage) {
        scanParams.FilterExpression = '#st = :stage';
        scanParams.ExpressionAttributeNames = { '#st': 'stage' };
        scanParams.ExpressionAttributeValues = { ':stage': { S: stage } };
      }

      const result = await legacyPage('employees', tenantId, scanParams);
      items = result.Items.map(item => unmarshall(item));
      lastEvaluatedKey = result.LastEvaluatedKey;
    }

    logger.info('Page retrieved', { count: items.length, hasNextPage: !!lastEvaluatedKey });

    // In-memory department filter (no GSI on department)
    if (department) {
      items = items.filter(item => item.department === department);
    }

    // Sort by created_at descending
    items.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    // Format response — id_number_encrypted is NEVER returned (NH-11)
    const formattedItems = items.map(item => ({
      employee_id:        item.employee_id,
      first_name:         item.first_name,
      middle_name:        item.middle_name || '',
      last_name:          item.last_name,
      email:              item.email,
      phone:              item.phone,
      department:         item.department,
      job_title:          item.job_title || '',
      stage:              item.stage,
      step:               stepOf(item),
      offer_accept_date:  item.offer_accept_date || '',
      planned_start_date: item.planned_start_date || '',
      created_at:         item.created_at,
      created_by:         item.created_by,
      hr_staff_id:        item.hr_staff_id || item.created_by || '',
      hr_staff_name:      item.hr_staff_name || '',
      hr_staff_email:     item.hr_staff_email || '',
      id_number_last4:    item.id_number_last4 || '',
    }));

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        items:    formattedItems,
        count:    formattedItems.length,
        // NH-28: pagination cursor — pass as ?lastKey= on next request; absent when no more pages
        ...(lastEvaluatedKey ? { lastKey: encodeKey(lastEvaluatedKey) } : {}),
        staff_id: staffMemberId,
        filters_applied: {
          created_by: staffMemberId,
          stage:      stage      || 'none',
          department: department || 'none',
        },
      }),
    };

  } catch (error) {
    logger.error('Handler error', { errorName: error?.name ?? 'Error' });
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Failed to retrieve employees' }),
    };
  }
};

export const handler = handlerFn;