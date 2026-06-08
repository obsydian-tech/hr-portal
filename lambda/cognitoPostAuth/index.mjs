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
const TALENT_FLOW_USERS_TABLE = process.env.TALENT_FLOW_USERS_TABLE ?? 'talent-flow-users';

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
      logger.info('No Naleko employee record found — checking if TalentFlow user', { email });

      // User might be TalentFlow-only (no Naleko employee record)
      // Still track their login
      try {
        const tfQueryResult = await dynamo.send(new QueryCommand({
          TableName: TALENT_FLOW_USERS_TABLE,
          IndexName: 'EmailIndex',
          KeyConditionExpression: 'GSI1PK = :emailKey',
          ExpressionAttributeValues: {
            ':emailKey': { S: `EMAIL#${email.toLowerCase()}` }
          },
          ProjectionExpression: 'userId, PK, SK',
          Limit: 1,
        }));

        if (tfQueryResult.Items && tfQueryResult.Items.length > 0) {
          const tfUser = tfQueryResult.Items[0];
          const userId = tfUser.userId?.S;
          const now = new Date().toISOString();

          await dynamo.send(new UpdateItemCommand({
            TableName: TALENT_FLOW_USERS_TABLE,
            Key: {
              PK: { S: `USER#${userId}` },
              SK: { S: 'PROFILE' }
            },
            UpdateExpression: 'SET lastLoginAt = :now, updatedAt = :now',
            ExpressionAttributeValues: {
              ':now': { S: now }
            },
          }));

          logger.info('Updated TalentFlow-only user lastLoginAt', { userId, email });
        } else {
          logger.warn('No user found in either employees or talent-flow-users', { email });
        }
      } catch (tfErr) {
        logger.error('Failed to track TalentFlow-only user login', {
          errorMessage: tfErr.message,
          errorName: tfErr.name,
          email
        });
      }

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

    // === NEW: TalentFlow User Login Tracking ===
    // Check if this email also belongs to a TalentFlow user and update lastLoginAt
    try {
      const tfQueryResult = await dynamo.send(new QueryCommand({
        TableName: TALENT_FLOW_USERS_TABLE,
        IndexName: 'EmailIndex',
        KeyConditionExpression: 'GSI1PK = :emailKey',
        ExpressionAttributeValues: {
          ':emailKey': { S: `EMAIL#${email.toLowerCase()}` }
        },
        ProjectionExpression: 'userId, PK, SK',
        Limit: 1,
      }));

      if (tfQueryResult.Items && tfQueryResult.Items.length > 0) {
        const tfUser = tfQueryResult.Items[0];
        const userId = tfUser.userId?.S;
        const now = new Date().toISOString();

        // Update lastLoginAt for TalentFlow user
        await dynamo.send(new UpdateItemCommand({
          TableName: TALENT_FLOW_USERS_TABLE,
          Key: {
            PK: { S: `USER#${userId}` },
            SK: { S: 'PROFILE' }
          },
          UpdateExpression: 'SET lastLoginAt = :now, updatedAt = :now',
          ExpressionAttributeValues: {
            ':now': { S: now }
          },
        }));

        logger.info('Updated TalentFlow user lastLoginAt', { userId, email });
      } else {
        logger.debug('No TalentFlow user found for email — skipping login tracking', { email });
      }
    } catch (tfErr) {
      // Log error but don't block login — tracking is nice-to-have, not critical
      logger.error('Failed to update TalentFlow lastLoginAt — login will still succeed', {
        errorMessage: tfErr.message,
        errorName: tfErr.name,
        email
      });
    }
    // === END: TalentFlow User Login Tracking ===

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
