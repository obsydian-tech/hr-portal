import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { hrOnly, json } from '../shared/hr-group.mjs';

const logger = new Logger({ serviceName: 'checkEmployeeEmail' });
const dynamodb = new DynamoDBClient();

const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function used(email) {
  const result = await dynamodb.send(new QueryCommand({
    TableName: 'employees',
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': { S: email } },
    Limit: 1,
    ProjectionExpression: 'employee_id',
  }));
  return (result.Count ?? result.Items?.length ?? 0) > 0;
}

/** GET /v1/employees/email-check?email=  HR only. { inUse } and nothing else. */
export const handler = async (event) => {
  const refused = hrOnly(event, 'Only HR can check an email');
  if (refused) return refused;
  const typed = String(event.queryStringParameters?.email ?? '').trim();
  if (!SHAPE.test(typed)) return json(400, { error: 'Check the email address' });
  try {
    const lower = typed.toLowerCase();
    const inUse = (await used(lower)) || (typed !== lower && (await used(typed)));
    return json(200, { inUse });
  } catch (error) {
    logger.error('Email check failed', { error: error.message });
    return json(500, { error: 'The email could not be checked' });
  }
};
