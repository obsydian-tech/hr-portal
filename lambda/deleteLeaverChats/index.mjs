/**
 * deleteLeaverChats (CHAT-15): once an hour, deletes every Ask Batsi chat of each person an admin deactivated more than 65 minutes
 * ago and whose chats have not been cleared yet. EventBridge is the only caller and the event is never read: the company and the
 * person of every delete come from the stored row of the person being handled, never from the call.
 *
 * For each leaver, in this order:
 *   1. Cognito (AdminGetUser, by the row's email) must say the sign-in is disabled. Enabled: nothing is deleted (LeaverStillEnabled).
 *   2. The company is the row's tenant_id; a row with none is the founding company (LEGACY_TENANT_ID); neither: skipped (LeaverCompanyUnknown).
 *   3. deleteAllChats under T#<company>#S#<staff id> (when Cognito knows one) and T#<company>#S#<sub> (the row's userId when Cognito has no such user).
 *   4. One Query per key must find no row left.
 *   5. One audit row, then chats_deleted_at on the person's row. A failure anywhere before the mark leaves the person unmarked, so the next run tries again.
 *
 * Nothing here logs a title, a message, a name, an email, a staff id, a sign-in id or an AWS message: logs hold counts and error names only.
 * A run with any failure ends in a thrown error, so the Lambda error alarm fires.
 */
import { AdminGetUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient, PutItemCommand, QueryCommand, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { ChatNotDeleted, deleteAllChats, ownerKey } from '../shared/ask-batsi-chats.mjs';
import { TENANT_ID_PATTERN } from '../shared/tenant.mjs';

/** A sign-in handed out before the deactivation lasts up to 60 minutes; 5 more minutes for the hourly schedule's slack. */
const WAIT_MS = 65 * 60 * 1000;
const MAX_PEOPLE = 200;
/** Time kept back: no new person is started with less than this left. */
const MIN_LEFT_MS = 30_000;
const AUDIT_DAYS = 90;

// BE-15: a setting that names one environment has no fallback value. A missing or empty one stops the run at the start with
// one line, before any AWS call. LEGACY_TENANT_ID is the one setting that may be empty (a stack with no founding company).
function requireSetting(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing setting ${name}`);
    throw new Error(`Missing setting ${name}`);
  }
  return value;
}

const s = (v) => ({ S: String(v) });
let dynamoClient;
let cognitoClient;
const dynamo = () => (dynamoClient ??= new DynamoDBClient({}));
const cognito = () => (cognitoClient ??= new CognitoIdentityProviderClient({}));

/** Every INACTIVE person row with a deactivation time and no chats_deleted_at, whatever the company. Every page of the Scan. */
async function waitingLeavers(usersTable, now) {
  const found = [];
  let start;
  do {
    const page = await dynamo().send(new ScanCommand({
      TableName: usersTable,
      ProjectionExpression: 'PK, SK, userId, email, tenant_id, deactivatedAt, deactivatedBy',
      FilterExpression: '#status = :inactive AND SK = :profile AND attribute_exists(deactivatedAt) AND attribute_not_exists(chats_deleted_at)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':inactive': s('INACTIVE'), ':profile': s('PROFILE') },
      ...(start ? { ExclusiveStartKey: start } : {}),
    }));
    for (const item of page.Items ?? []) {
      const at = Date.parse(item.deactivatedAt?.S ?? '');
      // The wait counts from deactivatedAt, never from updatedAt.
      if (!Number.isNaN(at) && at <= now - WAIT_MS) found.push(item);
    }
    start = page.LastEvaluatedKey;
  } while (start);
  return found;
}

/** Cognito's answer for the person: their staff id and sign-in id, or { unknown: true } when Cognito has no such user. */
async function signInOf(config, row) {
  const userId = row.userId?.S ?? String(row.PK?.S ?? '').replace(/^USER#/, '');
  try {
    const user = await cognito().send(new AdminGetUserCommand({ UserPoolId: config.poolId, Username: row.email?.S }));
    if (user.Enabled !== false) return { skip: 'LeaverStillEnabled' };
    const attribute = (name) => (user.UserAttributes ?? []).find((a) => a.Name === name)?.Value;
    return { staffId: attribute('custom:staff_id') || undefined, sub: attribute('sub') || userId, userId, unknown: false };
  } catch (err) {
    if (err?.name !== 'UserNotFoundException') throw err;
    return { staffId: undefined, sub: userId, userId, unknown: true };
  }
}

/** Handles one person. Returns 'done' or the name of why they were skipped; throws when something must be tried again. */
async function clearOne(config, row) {
  const who = await signInOf(config, row);
  if (who.skip) return who.skip;
  // The founding company only for a row with no tenant_id at all (the ownsRow rule); a tenant_id that is there must be a valid one.
  const tenantId = row.tenant_id === undefined ? config.legacyTenantId : row.tenant_id.S;
  if (!tenantId || !TENANT_ID_PATTERN.test(tenantId)) return 'LeaverCompanyUnknown';

  const keys = [...(who.staffId ? [['staff_id', who.staffId]] : []), ['sub', who.sub]];
  let rowsDeleted = 0;
  for (const [, person] of keys) rowsDeleted += await deleteAllChats(tenantId, person);
  // Never reported done while a row is left: ask again, per key, with a read that sees the deletes.
  for (const [, person] of keys) {
    const left = await dynamo().send(new QueryCommand({
      TableName: config.chatsTable,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': s(ownerKey(tenantId, person)) },
      ConsistentRead: true,
      Limit: 1,
    }));
    if ((left.Items ?? []).length) throw new ChatNotDeleted();
  }

  const at = new Date();
  await dynamo().send(new PutItemCommand({
    TableName: config.auditTable,
    Item: {
      pk: s(ownerKey(tenantId, who.sub)),
      sk: s(at.toISOString()),
      action: s('LEAVER_CHATS_DELETED'),
      tenant_id: s(tenantId),
      user_id: s(who.userId),
      staff_keys: { L: keys.map(([name]) => s(name)) },
      staff_id_unknown: { BOOL: who.unknown },
      deactivated_at: s(row.deactivatedAt.S),
      deactivated_by: s(row.deactivatedBy?.S ?? 'unknown'),
      rows_deleted: { N: String(rowsDeleted) },
      expiresAt: { N: String(Math.floor(at.getTime() / 1000) + AUDIT_DAYS * 24 * 3600) },
    },
  }));
  await dynamo().send(new UpdateItemCommand({
    TableName: config.usersTable,
    Key: { PK: row.PK, SK: row.SK },
    // Only the row that was read, still INACTIVE and not yet marked; never a new row.
    ConditionExpression: 'attribute_exists(PK) AND #status = :inactive AND attribute_not_exists(chats_deleted_at)',
    UpdateExpression: 'SET chats_deleted_at = :at',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':at': s(at.toISOString()), ':inactive': s('INACTIVE') },
  }));
  return 'done';
}

export const handler = async (_event, context) => {
  const config = {
    usersTable: requireSetting('USERS_TABLE_NAME'),
    poolId: requireSetting('COGNITO_POOL_ID'),
    chatsTable: requireSetting('CHATS_TABLE'),
    auditTable: requireSetting('AGENT_AUDIT_TABLE'),
    legacyTenantId: process.env.LEGACY_TENANT_ID || '',
  };

  let people;
  try {
    people = await waitingLeavers(config.usersTable, Date.now());
  } catch (err) {
    console.error('deleteLeaverChats: the people table could not be read', { error: err?.name ?? 'Error' });
    throw new Error('deleteLeaverChats: the people table could not be read');
  }

  const count = { waiting: people.length, started: 0, deleted: 0, failed: 0, LeaverStillEnabled: 0, LeaverCompanyUnknown: 0 };
  for (const row of people) {
    if (count.started >= MAX_PEOPLE) break;
    if ((context?.getRemainingTimeInMillis?.() ?? Infinity) < MIN_LEFT_MS) break;
    try {
      const result = await clearOne(config, row);
      if (result === 'done') { count.started++; count.deleted++; } else {
        // A skipped person uses none of the 200 places.
        count[result]++;
        console.warn(result);
      }
    } catch (err) {
      count.started++;
      count.failed++;
      console.error('deleteLeaverChats: a person could not be cleared', { error: err?.name ?? 'Error' });
    }
  }
  console.info('deleteLeaverChats: run finished', count);
  if (count.failed) throw new Error(`deleteLeaverChats: ${count.failed} of ${count.started} people could not be cleared`);
  return count;
};
