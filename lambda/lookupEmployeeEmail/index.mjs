import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const dynamodb = new DynamoDBClient();

const logger = new Logger({ serviceName: 'lookupEmployeeEmail' });
const tracer = new Tracer({ serviceName: 'lookupEmployeeEmail' });

/**
 * lookupEmployeeEmail
 * -------------------
 * Given an EMP-style employee ID, returns the employee's email address.
 * This allows the frontend to resolve EMP-0000001 → email for Cognito login.
 *
 * Route: GET /employee/lookup?employeeId=EMP-0000001
 * Response: { email: "john.doe@example.com" }
 *
 * This endpoint is PUBLIC (no auth required) since it's needed before login.
 * It only exposes the email — no other PII.
 */
const handlerFn = async (event) => {
  logger.info('Handler invoked', { path: event.path, employeeId: event.queryStringParameters?.employeeId });
  tracer.putAnnotation('operation', 'lookupEmployeeEmail');

  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };

  try {
    // Handle CORS preflight
    if (event.requestContext?.http?.method === "OPTIONS") {
      return { statusCode: 200, headers, body: "" };
    }

    // Extract employeeId from query string
    const employeeId = event.queryStringParameters?.employeeId;

    if (!employeeId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Missing required query parameter: employeeId",
        }),
      };
    }

    // NH-28: accept both UUID v4 (new) and legacy EMP-NNNNNNN (old) formats
    const UUID_RE    = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const LEGACY_RE  = /^EMP-\d{7}$/i;
    if (!UUID_RE.test(employeeId) && !LEGACY_RE.test(employeeId)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Invalid employee ID format. Expected a UUID (new) or EMP-0000001 (legacy)",
        }),
      };
    }

    // Look up the employee in DynamoDB
    const result = await dynamodb.send(
      new GetItemCommand({
        TableName: "employees",
        Key: {
          employee_id: { S: employeeId.toUpperCase() },
        },
        ProjectionExpression: "email",
      })
    );

    if (!result.Item) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          error: "Employee not found",
        }),
      };
    }

    const email = result.Item.email?.S;

    if (!email) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          error: "Employee email not found",
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ email }),
    };
  } catch (error) {
    logger.error('Handler error', { error });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Internal server error",
        details: error.message,
      }),
    };
  }
};

export const handler = tracer.captureLambdaHandler(handlerFn);
