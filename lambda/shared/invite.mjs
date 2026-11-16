/**
 * ONB-04: invite links. One helper makes a link (createEmployee now, ONB-18's resend later); the two public
 * routes read and use it. Only the SHA-256 of a token is stored; the token itself lives in memory only.
 */
import { createHash, randomBytes } from 'node:crypto';
import { DynamoDBClient, PutItemCommand, QueryCommand, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';

export const INVITES_TABLE = process.env.INVITES_TABLE || 'employee_invites';
export const MAX_FAILED = 5;
export const LINK_SECONDS = 7 * 24 * 60 * 60;
const TTL_AFTER = 30 * 24 * 60 * 60;
const SHAPE = /^[A-Za-z0-9_-]{43}$/;

const ddb = new DynamoDBClient();
const cognito = new CognitoIdentityProviderClient({ region: 'af-south-1' });

export const hashToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');
export const looksLikeToken = (t) => typeof t === 'string' && SHAPE.test(t);

function setting(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing setting ${name}`);
  return v;
}

export async function issueInvite({ employee, hrPartner, sentBy }) {
  const employeeId = employee.employee_id ?? employee.employeeId;
  const email = String(employee.email).toLowerCase();
  const pool = setting('COGNITO_POOL_ID');
  const appUrl = setting('APP_URL').replace(/\/+$/, '');

  try {
    await cognito.send(new AdminCreateUserCommand({
      UserPoolId: pool,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'given_name', Value: employee.first_name ?? employee.firstName ?? '' },
        { Name: 'family_name', Value: employee.last_name ?? employee.lastName ?? '' },
        { Name: 'custom:role', Value: 'employee' },
      ],
      MessageAction: 'SUPPRESS',
    }));
  } catch (e) {
    if (e?.name !== 'UsernameExistsException') throw e;
  }
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: pool, Username: email, GroupName: 'employee' }));

  const now = new Date();
  const createdAt = now.toISOString();
  const earlier = await ddb.send(new QueryCommand({
    TableName: INVITES_TABLE, IndexName: 'employee-index',
    KeyConditionExpression: 'employee_id = :e', ExpressionAttributeValues: { ':e': { S: employeeId } },
  }));
  for (const item of earlier.Items ?? []) {
    try {
      await ddb.send(new UpdateItemCommand({
        TableName: INVITES_TABLE, Key: { token_hash: item.token_hash },
        UpdateExpression: 'SET replaced_at = :now',
        ConditionExpression: 'attribute_not_exists(used_at) AND attribute_not_exists(replaced_at)',
        ExpressionAttributeValues: { ':now': { S: createdAt } },
      }));
    } catch (e) {
      if (e?.name !== 'ConditionalCheckFailedException') throw e;
    }
  }

  const token = randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + LINK_SECONDS * 1000);
  await ddb.send(new PutItemCommand({
    TableName: INVITES_TABLE,
    Item: {
      token_hash: { S: hashToken(token) },
      employee_id: { S: employeeId },
      created_at: { S: createdAt },
      expires_at: { S: expires.toISOString() },
      sent_by: { S: String(sentBy ?? '') },
      ttl: { N: String(Math.floor(expires.getTime() / 1000) + TTL_AFTER) },
    },
    ConditionExpression: 'attribute_not_exists(token_hash)',
  }));
  return { token, expiresAt: expires.toISOString(), link: `${appUrl}/set-password#token=${token}` };
}

/** The invite row for a token and what state it is in: 'ok' | 'expired' | 'used' | 'invalid'. */
export async function readInvite(token) {
  if (!looksLikeToken(token)) return { status: 'invalid' };
  const out = await ddb.send(new GetItemCommand({ TableName: INVITES_TABLE, Key: { token_hash: { S: hashToken(token) } } }));
  const row = out.Item;
  if (!row) return { status: 'invalid' };
  if (row.used_at?.S) return { status: 'used', row };
  if (row.replaced_at?.S || Number(row.failed_attempts?.N ?? 0) >= MAX_FAILED || Date.parse(row.expires_at.S) <= Date.now()) return { status: 'expired', row };
  return { status: 'ok', row };
}

export const PUBLIC_HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
export const answer = (statusCode, body) => ({ statusCode, headers: PUBLIC_HEADERS, body: body === undefined ? '' : JSON.stringify(body) });

/** The JSON body of a public request, or null when it is missing or not a JSON object. */
export function bodyOf(event) {
  if (!event?.body) return null;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const b = JSON.parse(raw);
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  } catch {
    return null;
  }
}
