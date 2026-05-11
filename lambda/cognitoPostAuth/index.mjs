/**
 * cognitoPostAuth — Cognito PostAuthentication trigger
 *
 * NH-80: Fires on every successful login. When the employee's current stage is
 * INVITED, bumps it to ACTIVE (conditional update — idempotent on repeat logins).
 *
 * Trigger type: PostAuthentication (USER_SRP_AUTH / USER_PASSWORD_AUTH / etc.)
 * The event.userName is the Cognito username (= email for this user pool).
 * We look up the employee by email via the email-index GSI, then do a
 * conditional UpdateItem so we never regress the stage.
 */

import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';

const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'af-south-1' });
const logger = new Logger({ serviceName: 'cognitoPostAuth' });

const EMPLOYEES_TABLE = process.env.EMPLOYEES_TABLE ?? 'employees';

export const handler = async (event) => {
  logger.info('PostAuthentication trigger fired', {
    userName: event.userName,
    triggerSource: event.triggerSource,
  });

  try {
    // The Cognito username is the employee's email address for this user pool.
    const email = event.request?.userAttributes?.email ?? event.userName;

    if (!email) {
      logger.warn('No email found in trigger event — skipping stage update');
      return event; // Always return event to Cognito
    }

    // 1. Look up employee by email via the email-index GSI
    const queryResult = await dynamo.send(new QueryCommand({
      TableName: EMPLOYEES_TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': { S: email } },
      ProjectionExpression: 'employee_id, stage',
      Limit: 1,
    }));

    if (!queryResult.Items || queryResult.Items.length === 0) {
      logger.warn('No employee record found for email — skipping stage update', { email });
      return event;
    }

    const employee = queryResult.Items[0];
    const employeeId = employee.employee_id?.S;
    const currentStage = employee.stage?.S;

    logger.info('Employee found', { employeeId, currentStage });

    // 2. Only bump INVITED → ACTIVE. All other stages are left untouched.
    if (currentStage !== 'INVITED') {
      logger.info('Stage already past INVITED — no update needed', { currentStage });
      return event;
    }

    // 3. Conditional UpdateItem: only write if stage is still INVITED.
    //    This prevents a race condition from downgrading a more advanced stage.
    await dynamo.send(new UpdateItemCommand({
      TableName: EMPLOYEES_TABLE,
      Key: { employee_id: { S: employeeId } },
      UpdateExpression: 'SET stage = :active, activated_at = :now',
      ConditionExpression: 'stage = :invited',
      ExpressionAttributeValues: {
        ':active':  { S: 'ACTIVE' },
        ':invited': { S: 'INVITED' },
        ':now':     { S: new Date().toISOString() },
      },
    }));

    logger.info('Stage bumped INVITED → ACTIVE', { employeeId, email });

  } catch (err) {
    // ConditionalCheckFailedException is fine — means another invocation already
    // updated the stage. Any other error is logged but must not block login.
    if (err.name === 'ConditionalCheckFailedException') {
      logger.info('Conditional update skipped — stage already updated by concurrent call');
    } else {
      logger.error('Unexpected error bumping stage — login will still succeed', {
        errorMessage: err.message,
        errorName: err.name,
      });
    }
  }

  // Always return the event unmodified — Cognito requires this to complete login
  return event;
};
