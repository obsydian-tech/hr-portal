/**
 * TEN-06: moves a TalentFlow person to the one sign-in pool, silently, the first time they sign in or ask to
 * reset their password. Cognito calls this when the person is not in this pool.
 *
 * Sign-in: the email and password are checked in the TalentFlow pool (AdminInitiateAuth on a server-only client).
 * Forgot password: the person is looked up only (AdminGetUser); the normal reset then sends its code.
 * Before answering, a pending row (MIGRATE#<email> / TENANT#<founding id>) keeps the old TalentFlow id and the
 * groups the person gets here, so the first token is complete. Any failure is the same error as a wrong password.
 * Logs hold no email, name or password: only the two lines below and a reason code.
 */
import { CognitoIdentityProviderClient, AdminInitiateAuthCommand, AdminGetUserCommand, AdminListGroupsForUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { grantOfNames } from '../shared/roles.mjs';

const logger = new Logger({ serviceName: 'userMigration' });
const idp = new CognitoIdentityProviderClient({});
const db = new DynamoDBClient({});
const THIRTY_DAYS = 30 * 24 * 60 * 60;

/** One answer for every refusal, so a wrong password, an unknown email and a fault look alike. */
function refuse(reason) {
  logger.warn('User not moved', { reason });
  throw new Error('Bad username or password');
}

function attribute(list, name) {
  return (list ?? []).find((a) => a.Name === name)?.Value;
}

export const handler = async (event) => {
  const source = event?.triggerSource;
  const signIn = source === 'UserMigration_Authentication';
  if (!signIn && source !== 'UserMigration_ForgotPassword') return refuse('trigger');
  const email = String(event.userName ?? '').trim().toLowerCase();
  const poolId = process.env.TALENT_FLOW_POOL_ID;
  const clientId = process.env.TALENT_FLOW_CLIENT_ID;
  const table = process.env.TENANTS_TABLE;
  const founding = process.env.LEGACY_TENANT_ID;
  if (!email || !poolId || !clientId || !table || !/^ten_[0-9a-z]{26}$/.test(founding ?? '')) return refuse('setup');

  if (signIn) {
    let signedIn;
    try {
      signedIn = await idp.send(new AdminInitiateAuthCommand({
        UserPoolId: poolId,
        ClientId: clientId,
        AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: email, PASSWORD: String(event.request?.password ?? '') },
      }));
    } catch {
      return refuse('refused');
    }
    if (!signedIn?.AuthenticationResult) return refuse('refused');
  }

  let user;
  let groups;
  try {
    user = await idp.send(new AdminGetUserCommand({ UserPoolId: poolId, Username: email }));
    groups = await idp.send(new AdminListGroupsForUserCommand({ UserPoolId: poolId, Username: email }));
  } catch {
    return refuse(signIn ? 'unavailable' : 'not_found');
  }
  if (user?.Enabled === false) return refuse('refused');
  const legacyUserId = attribute(user?.UserAttributes, 'sub');
  if (!legacyUserId) return refuse('unavailable');
  const mapped = grantOfNames((groups?.Groups ?? []).map((g) => g.GroupName));

  try {
    await db.send(new PutItemCommand({
      TableName: table,
      Item: {
        pk: { S: `MIGRATE#${email}` },
        sk: { S: `TENANT#${founding}` },
        legacy_user_id: { S: legacyUserId },
        groups: { L: [...mapped.roles, ...mapped.perms].map((g) => ({ S: g })) },
        created_at: { S: new Date().toISOString() },
        expires_at: { N: String(Math.floor(Date.now() / 1000) + THIRTY_DAYS) },
      },
    }));
  } catch {
    return refuse('unavailable');
  }

  event.response = event.response ?? {};
  event.response.userAttributes = {
    email,
    email_verified: 'true',
    ...(attribute(user.UserAttributes, 'given_name') ? { given_name: attribute(user.UserAttributes, 'given_name') } : {}),
    ...(attribute(user.UserAttributes, 'family_name') ? { family_name: attribute(user.UserAttributes, 'family_name') } : {}),
  };
  if (signIn) {
    event.response.finalUserStatus = 'CONFIRMED';
    event.response.messageAction = 'SUPPRESS';
  }
  logger.info('User moved');
  return event;
};
