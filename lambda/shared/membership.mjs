/**
 * TEN-02: Member rows in the company list (pk USER#<sub>, sk TENANT#<id>). Only these functions read or write them
 * from the onboarding Lambdas. The table is named by TENANTS_TABLE.
 */
import { DynamoDBClient, QueryCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { TENANT_ID_PATTERN } from './tenant.mjs';

const db = new DynamoDBClient({});
const table = () => {
  const t = process.env.TENANTS_TABLE;
  if (!t) throw new Error('Missing setting TENANTS_TABLE');
  return t;
};
const legacy = () => (TENANT_ID_PATTERN.test(process.env.LEGACY_TENANT_ID ?? '') ? process.env.LEGACY_TENANT_ID : null);

/** The company ids this sign-in is a member of (every page). */
export async function companiesOf(sub) {
  const out = [];
  let start;
  do {
    const page = await db.send(new QueryCommand({
      TableName: table(),
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :t)',
      ExpressionAttributeValues: { ':pk': { S: `USER#${sub}` }, ':t': { S: 'TENANT#' } },
      ExclusiveStartKey: start,
    }));
    for (const i of page.Items ?? []) if (TENANT_ID_PATTERN.test(i.tenant_id?.S ?? '')) out.push(i.tenant_id.S);
    start = page.LastEvaluatedKey;
  } while (start);
  return out;
}

/** The company a sign-in's token carries, as the pre-token trigger works it out: its one Member row, else the legacy company, else null. */
export async function companyOfSignIn(sub) {
  const mine = await companiesOf(sub);
  if (mine.length === 1) return mine[0];
  if (mine.length === 0) return legacy();
  return null;
}

/** One Member row for a new sign-in; never overwrites one. */
export async function addMember(sub, tenantId) {
  if (!TENANT_ID_PATTERN.test(tenantId ?? '') || !sub) throw new Error('Not a company id');
  await db.send(new PutItemCommand({
    TableName: table(),
    Item: { pk: { S: `USER#${sub}` }, sk: { S: `TENANT#${tenantId}` }, tenant_id: { S: tenantId }, created_at: { S: new Date().toISOString() } },
    ConditionExpression: 'attribute_not_exists(pk)',
  }));
}

/** Keeps the pool users whose sign-in belongs to this company. */
export async function inCompany(users, tenantId) {
  const kept = [];
  for (const u of users) {
    const sub = (u.Attributes ?? u.UserAttributes ?? []).find((a) => a.Name === 'sub')?.Value;
    if (sub && (await companyOfSignIn(sub)) === tenantId) kept.push(u);
  }
  return kept;
}
