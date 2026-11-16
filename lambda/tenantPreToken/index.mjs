// TEN-01: puts the person's company into every ID and access token (pre token generation, V2).
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

async function companyOf(sub) {
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
    return PATTERN.test(id) && items[0].sk?.S === `TENANT#${id}` ? id : skip(sub, 'malformed');
  }
  return LEGACY ?? skip(sub, 'none');
}

export const handler = async (event) => {
  const sub = event?.request?.userAttributes?.sub;
  const tenantId = sub ? await companyOf(sub) : skip(sub, 'none');
  if (tenantId) {
    event.response = event.response ?? {};
    event.response.claimsAndScopeOverrideDetails = {
      idTokenGeneration: { claimsToAddOrOverride: { tenant_id: tenantId } },
      accessTokenGeneration: { claimsToAddOrOverride: { tenant_id: tenantId } },
    };
  }
  return event;
};
