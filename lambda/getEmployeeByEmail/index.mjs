import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { hrOnly } from '../shared/hr-group.mjs';
import { requireTenant, tenantFilter } from '../shared/tenant.mjs';

const dynamodb = new DynamoDBClient();

const logger = new Logger({ serviceName: 'getEmployeeByEmail' });
const tracer = new Tracer({ serviceName: 'getEmployeeByEmail' });

const EMPLOYEES_TABLE = "employees";

/**
 * getEmployeeByEmail
 * ------------------
 * Route: GET /employees/by-email?email=<email>  (employees_api)
 * Auth:  Cognito JWT required (HR staff only — guards enforced on the frontend)
 *
 * Returns { exists: boolean, employee_id?: string } so the Angular HR-dashboard
 * can check for duplicate email before creating a new employee record.
 * Only employee_id is returned — no extra PII exposed.
 */
const handlerFn = async (event) => {
  const refused = hrOnly(event, 'Only HR can look up employees');
  if (refused) return { ...refused, headers: corsHeaders() };
  const { tenantId, refusal } = requireTenant(event);
  if (refusal) return { ...refusal, headers: corsHeaders() };
  const email = event.queryStringParameters?.email;
  logger.info('Handler invoked');
  tracer.putAnnotation('operation', 'getEmployeeByEmail');

  try {
    if (!email || !email.includes('@')) {
      return errorResponse(400, "Missing or invalid query parameter: email");
    }

    const normalised = email.trim().toLowerCase();

    // NH-28: use Query on email-index GSI instead of a full-table Scan
    const f = tenantFilter(tenantId);
    const result = await dynamodb.send(new QueryCommand({
      TableName: EMPLOYEES_TABLE,
      IndexName: "email-index",
      KeyConditionExpression: "email = :email",
      FilterExpression: f.FilterExpression,
      ExpressionAttributeNames: f.ExpressionAttributeNames,
      ExpressionAttributeValues: { ":email": { S: normalised }, ":tenant_id": { S: tenantId } },
      ProjectionExpression: "employee_id",
    }));

    const found = (result.Items?.length ?? 0) > 0;

    logger.info('Lookup result', { found });

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        exists: found,
        ...(found ? { employee_id: result.Items[0].employee_id?.S } : {}),
      }),
    };

  } catch (err) {
    logger.error('Unexpected error', { errorMessage: err.message });
    return errorResponse(500, "Internal server error");
  }
};

function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function errorResponse(statusCode, message) {
  return { statusCode, headers: corsHeaders(), body: JSON.stringify({ error: message }) };
}

export const handler = tracer.captureAsyncFunction ? tracer.captureAsyncFunction(handlerFn) : handlerFn;
