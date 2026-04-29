import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient();

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
export const handler = async (event) => {
  console.log("Event:", JSON.stringify(event, null, 2));

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

    // Validate format: must be EMP-NNNNNNN
    if (!/^EMP-\d{7}$/i.test(employeeId)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Invalid employee ID format. Expected: EMP-0000001",
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
    console.error("Error:", error);
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
