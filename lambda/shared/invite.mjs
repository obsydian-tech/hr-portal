/**
 * ONB-04: invite links. One helper makes a link (createEmployee now, ONB-18's resend later); the two public
 * routes read and use it. Only the SHA-256 of a token is stored; the token itself lives in memory only.
 */
import { createHash, randomBytes } from 'node:crypto';
import { DynamoDBClient, PutItemCommand, QueryCommand, UpdateItemCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminAddUserToGroupCommand, AdminGetUserCommand, AdminListGroupsForUserCommand } from '@aws-sdk/client-cognito-identity-provider';

export const INVITES_TABLE = process.env.INVITES_TABLE || 'employee_invites';
export const MAX_FAILED = 5;
export const LINK_SECONDS = 7 * 24 * 60 * 60;
const TTL_AFTER = 30 * 24 * 60 * 60;
const SHAPE = /^[A-Za-z0-9_-]{43}$/;

const ddb = new DynamoDBClient();
const cognito = new CognitoIdentityProviderClient({ region: 'af-south-1' });

export const hashToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');
export const looksLikeToken = (t) => typeof t === 'string' && SHAPE.test(t);

/**
 * ONB-04.2: whether an invite may finish setting up this sign-in. Only one that nobody has used yet (FORCE_CHANGE_PASSWORD)
 * and that belongs to no group except `employee` qualifies. Returns { ok: true } or { ok: false, reason: 'missing' | 'status' | 'group' }.
 * A Cognito error other than UserNotFoundException is thrown.
 */
export async function signInState(pool, email) {
  let user;
  try {
    user = await cognito.send(new AdminGetUserCommand({ UserPoolId: pool, Username: email }));
  } catch (e) {
    if (e?.name === 'UserNotFoundException') return { ok: false, reason: 'missing' };
    throw e;
  }
  // ONB-18 (L-1): a disabled sign-in is never finished by a link.
  if (user?.Enabled === false) return { ok: false, reason: 'disabled' };
  if (user?.UserStatus !== 'FORCE_CHANGE_PASSWORD') return { ok: false, reason: 'status' };
  const groups = [];
  let next;
  do {
    const page = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId: pool, Username: email, NextToken: next }));
    for (const g of page?.Groups ?? []) groups.push(g.GroupName);
    next = page?.NextToken;
  } while (next);
  if (groups.some((g) => g !== 'employee')) return { ok: false, reason: 'group' };
  return { ok: true };
}

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
    // The address already has a sign-in. Carry on only when nobody has used it yet (the resend case); otherwise stop
    // before any group change, invite row or email.
    const state = await signInState(pool, email);
    if (!state.ok) {
      const refused = new Error('This address already has a sign-in that is in use');
      refused.name = 'InviteRefused';
      throw refused;
    }
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
  return { token, sentAt: createdAt, expiresAt: expires.toISOString(), link: `${appUrl}/set-password#token=${token}` };
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
