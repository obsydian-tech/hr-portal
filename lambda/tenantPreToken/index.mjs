// TEN-01: puts the person's company into every ID and access token (pre token generation, V2).
// TEN-06: a person who moved from TalentFlow also gets user_id (their old id), and, on the very first sign-in, the groups
// kept in their pending row (MIGRATE#<email>), so the first token is complete.
import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';

const PATTERN = /^ten_[0-9a-z]{26}$/;
const TABLE = process.env.TENANTS_TABLE;
const rawLegacy = process.env.LEGACY_TENANT_ID;
const LEGACY = rawLegacy && PATTERN.test(rawLegacy) ? rawLegacy : null;
if (rawLegacy && !LEGACY) console.warn(JSON.stringify({ message: 'LEGACY_TENANT_ID is not a company id; legacy rule off' }));
const db = new DynamoDBClient({});

function skip(sub, reason) {
  console.warn(JSON.stringify({ message: 'Tenant claim skipped', sub, reason }));
  return null;
}

/** The company, and for a moved TalentFlow person their old id (and, before their Member row exists, their groups). */
async function claimsOf(sub, email) {
  let items;
  try {
    const out = await db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :t)',
      ExpressionAttributeValues: { ':pk': { S: `USER#${sub}` }, ':t': { S: 'TENANT#' } },
    }));
    items = out.Items ?? [];
  } catch {
    return skip(sub, 'error');
  }
  if (items.length > 1) return skip(sub, 'several');
  if (items.length === 1) {
    const id = items[0].tenant_id?.S ?? '';
    if (!(PATTERN.test(id) && items[0].sk?.S === `TENANT#${id}`)) return skip(sub, 'malformed');
    const old = items[0].legacy_user_id?.S;
    return { tenantId: id, ...(old ? { userId: old } : {}) };
  }
  const pending = await pendingOf(sub, email);
  if (pending === 'error') return skip(sub, 'error');
  if (pending) return pending;
  return LEGACY ? { tenantId: LEGACY } : skip(sub, 'none');
}

/** The pending row of a person who is moving (MIGRATE#<email>), unless it has expired; null when there is none. */
async function pendingOf(sub, email) {
  if (!email) return null;
  let items;
  try {
    const out = await db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :t)',
      ExpressionAttributeValues: { ':pk': { S: `MIGRATE#${email}` }, ':t': { S: 'TENANT#' } },
    }));
    items = out.Items ?? [];
  } catch {
    return 'error';
  }
  if (items.length !== 1) return null;
  const row = items[0];
  const id = String(row.sk?.S ?? '').replace(/^TENANT#/, '');
  const expires = Number(row.expires_at?.N);
  if (!PATTERN.test(id) || !row.legacy_user_id?.S || !(expires > Date.now() / 1000)) return null;
  return { tenantId: id, userId: row.legacy_user_id.S, groups: (row.groups?.L ?? []).map((g) => g.S).filter(Boolean) };
}

export const handler = async (event) => {
  const sub = event?.request?.userAttributes?.sub;
  const email = String(event?.request?.userAttributes?.email ?? '').trim().toLowerCase();
  const found = sub ? await claimsOf(sub, email) : skip(sub, 'none');
  if (found) {
    const claims = { tenant_id: found.tenantId, ...(found.userId ? { user_id: found.userId } : {}) };
    event.response = event.response ?? {};
    event.response.claimsAndScopeOverrideDetails = {
      idTokenGeneration: { claimsToAddOrOverride: claims },
      accessTokenGeneration: { claimsToAddOrOverride: claims },
      ...(found.groups ? { groupOverrideDetails: { groupsToOverride: found.groups, iamRolesToOverride: [], preferredRole: null } } : {}),
    };
  }
  return event;
};
