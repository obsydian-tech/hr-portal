import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

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
  const email = event.queryStringParameters?.email;
  logger.info('Handler invoked', { email });
  tracer.putAnnotation('operation', 'getEmployeeByEmail');

  try {
    if (!email || !email.includes('@')) {
      return errorResponse(400, "Missing or invalid query parameter: email");
    }

    const normalised = email.trim().toLowerCase();

    const result = await dynamodb.send(new ScanCommand({
      TableName: EMPLOYEES_TABLE,
      FilterExpression: "#em = :email",
      ExpressionAttributeNames:  { "#em": "email" },
      ExpressionAttributeValues: { ":email": { S: normalised } },
      ProjectionExpression: "employee_id",
      Limit: 1,
    }));

    const found = (result.Items?.length ?? 0) > 0;

    logger.info('Lookup result', { email: normalised, found });

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
    return errorResponse(500, err.message || "Internal server error");
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
