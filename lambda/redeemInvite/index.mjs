import { DynamoDBClient, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, AdminSetUserPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import { Logger } from '@aws-lambda-powertools/logger';
import { INVITES_TABLE, MAX_FAILED, answer, bodyOf, hashToken, readInvite, signInState } from '../shared/invite.mjs';

const logger = new Logger({ serviceName: 'redeemInvite' });
const ddb = new DynamoDBClient();
const cognito = new CognitoIdentityProviderClient({ region: 'af-south-1' });

function broken(p) {
  if (typeof p !== 'string') return ['minLength'];
  const out = [];
  if (p.length < 12) out.push('minLength');
  if (p.length > 256) out.push('maxLength');
  if (!/[a-z]/.test(p)) out.push('lower');
  if (!/[A-Z]/.test(p)) out.push('upper');
  if (!/[0-9]/.test(p)) out.push('number');
  if (!/[^A-Za-z0-9]/.test(p)) out.push('symbol');
  return out;
}

/** POST /v1/invites/redeem  public. */
export const handler = async (event) => {
  const body = bodyOf(event);
  if (!body) return answer(400, { error: 'The request body is missing or not valid' });
  try {
    const found = await readInvite(body.token);
    if (found.status !== 'ok') return answer(410, { status: found.status });
    const rules = broken(body.password);
    if (rules.length) {
      await ddb.send(new UpdateItemCommand({
        TableName: INVITES_TABLE, Key: { token_hash: { S: hashToken(body.token) } },
        UpdateExpression: 'ADD failed_attempts :one', ExpressionAttributeValues: { ':one': { N: '1' } },
      }));
      return answer(400, { error: 'Check the password', fields: { password: rules } });
    }
    // Read the person first: a missing or unreadable row must not use the link up.
    const emp = (await ddb.send(new GetItemCommand({ TableName: 'employees', Key: { employee_id: found.row.employee_id }, ProjectionExpression: 'email' }))).Item;
    if (!emp?.email?.S) return answer(410, { status: 'invalid' });
    const key = { token_hash: { S: hashToken(body.token) } };
    const now = new Date().toISOString();
    try {
      await ddb.send(new UpdateItemCommand({
        TableName: INVITES_TABLE, Key: key,
        UpdateExpression: 'SET used_at = :now',
        ConditionExpression: 'attribute_exists(token_hash) AND attribute_not_exists(used_at) AND attribute_not_exists(replaced_at) AND expires_at > :now AND (attribute_not_exists(failed_attempts) OR failed_attempts < :max)',
        ExpressionAttributeValues: { ':now': { S: now }, ':max': { N: String(MAX_FAILED) } },
      }));
    } catch (e) {
      if (e?.name === 'ConditionalCheckFailedException') return answer(410, { status: 'used' });
      throw e;
    }
    try {
      // ONB-04.2: a link only finishes a sign-in nobody has used yet. Refusing keeps the link used.
      const state = await signInState(process.env.COGNITO_POOL_ID, emp.email.S);
      if (!state.ok) {
        logger.warn('Invite redeem refused', { employeeId: found.row.employee_id.S, reason: state.reason });
        return answer(410, { status: 'used' });
      }
      await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: process.env.COGNITO_POOL_ID, Username: emp.email.S, Password: body.password, Permanent: true }));
    } catch (e) {
      logger.error('Setting the password failed', { error: e.name });
      await ddb.send(new UpdateItemCommand({ TableName: INVITES_TABLE, Key: key, UpdateExpression: 'REMOVE used_at' }));
      return answer(502, { error: 'Could not set the password. Try again.' });
    }
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' }, body: '' };
  } catch (error) {
    logger.error('Redeem failed', { error: error.message });
    return answer(500, { error: 'Something went wrong' });
  }
};
