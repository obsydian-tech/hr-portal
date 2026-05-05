/**
 * NH-43: getEmployee — GET /agent/v1/employees/{id}
 *
 * Returns a single employee record (non-PII fields only) for the given ID.
 * Called exclusively via the agent API namespace so the actor is always AGENT,
 * but the code reads it from request context for future extensibility.
 *
 * Audit context:
 *   actor = event.requestContext?.authorizer?.lambda?.actor ?? 'HUMAN'
 */

import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

const dynamodb = new DynamoDBClient();
const logger = new Logger({ serviceName: 'getEmployee' });
const tracer = new Tracer({ serviceName: 'getEmployee' });

const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE ?? 'employees';

export const handler = async (event) => {
  const actor = event.requestContext?.authorizer?.lambda?.actor ?? 'HUMAN';
  const employeeId = event.pathParameters?.id;

  logger.info('getEmployee invoked', { employeeId, actor });
  tracer.putAnnotation('actor', actor);

  if (!employeeId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Missing path parameter: id' }),
    };
  }

  try {
    const result = await dynamodb.send(new GetItemCommand({
      TableName: EMPLOYEES_TABLE,
      Key: { employee_id: { S: employeeId } },
    }));

    if (!result.Item) {
      logger.warn('Employee not found', { employeeId });
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ message: `Employee ${employeeId} not found` }),
      };
    }

    const item = result.Item;

    // Return non-PII fields safe for agent consumption.
    // Encrypted fields (national_id, etc.) are intentionally omitted.
    const employee = {
      employee_id:  item.employee_id?.S,
      email:        item.email?.S,
      first_name:   item.first_name?.S,
      last_name:    item.last_name?.S,
      department:   item.department?.S,
      stage:        item.stage?.S,
      risk_band:    item.risk_band?.S,
      risk_reason:  item.risk_reason?.S,
      created_at:   item.created_at?.S,
      updated_at:   item.updated_at?.S,
    };

    tracer.putAnnotation('employeeId', employeeId);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ employee }),
    };
  } catch (error) {
    logger.error('Error fetching employee', { error: error.message, employeeId });
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ message: 'Internal server error' }),
    };
  }
};
