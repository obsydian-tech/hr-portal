#!/usr/bin/env node
/**
 * TEN-02: gives every onboarding row and every sign-in a company.
 *   node scripts/tenancy/backfill.mjs --env dev|prod --tenant <founding id> --pool <pool id> [--profile x] [--apply|--check]
 * Default is a dry run: counts only, no writes. --apply writes with conditions (a second apply changes nothing).
 * --check exits 1 if anything still lacks a company. Output is counts only: no names, emails, ids or numbers.
 */
import { DynamoDBClient, ScanCommand, UpdateItemCommand, PutItemCommand, QueryCommand, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const env = opt('--env');
const tenant = opt('--tenant');
const poolId = opt('--pool');
const profile = opt('--profile');
const mode = args.includes('--apply') ? 'apply' : args.includes('--check') ? 'check' : 'dry';
if (!['dev', 'prod'].includes(env) || !/^ten_[0-9a-z]{26}$/.test(tenant ?? '') || !poolId) {
  console.error('Usage: backfill.mjs --env dev|prod --tenant <id> --pool <poolId> [--profile x] [--apply|--check]');
  process.exit(2);
}
if (profile) process.env.AWS_PROFILE = profile;
const region = process.env.AWS_REGION ?? 'af-south-1';
const ddb = new DynamoDBClient({ region });
const idp = new CognitoIdentityProviderClient({ region });
const TENANTS = `naleko-people-${env}-tenants`;
const TABLES = {
  employees: ['employee_id'],
  documents: ['employee_id', 'document_id'],
  employee_invites: ['token_hash'],
  'document-verification': ['verificationId'],
  'external-verification-requests': ['request_id'],
  'naleko-agent-audit': ['pk', 'sk'],
  'naleko-pending-actions': ['actionId'],
};
const counts = {};
const add = (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };

async function* scan(table) {
  let start;
  do {
    const page = await ddb.send(new ScanCommand({ TableName: table, ...(start ? { ExclusiveStartKey: start } : {}) }));
    for (const i of page.Items ?? []) yield i;
    start = page.LastEvaluatedKey;
  } while (start);
}
async function users() {
  const out = [];
  let token;
  do {
    const page = await idp.send(new ListUsersCommand({ UserPoolId: poolId, ...(token ? { PaginationToken: token } : {}) }));
    out.push(...(page.Users ?? []));
    token = page.PaginationToken;
  } while (token);
  return out;
}
const attr = (u, n) => (u.Attributes ?? []).find((a) => a.Name === n)?.Value;
const conditional = async (cmd) => {
  try { await ddb.send(cmd); return true; } catch (e) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
};

// The founding company's row.
const profileRow = (await ddb.send(new GetItemCommand({ TableName: TENANTS, Key: { pk: { S: `TENANT#${tenant}` }, sk: { S: 'PROFILE' } } }))).Item;
if (!profileRow) {
  add('company row missing');
  if (mode === 'apply' && await conditional(new PutItemCommand({
    TableName: TENANTS,
    Item: { pk: { S: `TENANT#${tenant}` }, sk: { S: 'PROFILE' }, tenant_id: { S: tenant }, name: { S: 'Founding client' }, status: { S: 'ACTIVE' }, country: { S: 'ZA' }, founding: { BOOL: true }, created_at: { S: new Date().toISOString() } },
    ConditionExpression: 'attribute_not_exists(pk)',
  }))) add('company row written');
}

// Sign-ins without a Member row.
const pool = await users();
// Only a verified address names a row's owner: an unverified one may be someone else's.
const subByEmail = new Map(pool.filter((u) => String(attr(u, 'email_verified') ?? '').toLowerCase() === 'true').map((u) => [String(attr(u, 'email') ?? '').toLowerCase(), attr(u, 'sub')]));
const unverified = new Set(pool.filter((u) => String(attr(u, 'email_verified') ?? '').toLowerCase() !== 'true').map((u) => String(attr(u, 'email') ?? '').toLowerCase()));
for (const u of pool) {
  const sub = attr(u, 'sub');
  if (!sub) continue;
  const mine = await ddb.send(new QueryCommand({ TableName: TENANTS, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :t)', ExpressionAttributeValues: { ':pk': { S: `USER#${sub}` }, ':t': { S: 'TENANT#' } } }));
  if ((mine.Items ?? []).length) continue;
  add('sign-ins without a company');
  if (mode === 'apply' && await conditional(new PutItemCommand({
    TableName: TENANTS,
    Item: { pk: { S: `USER#${sub}` }, sk: { S: `TENANT#${tenant}` }, tenant_id: { S: tenant }, created_at: { S: new Date().toISOString() } },
    ConditionExpression: 'attribute_not_exists(pk)',
  }))) add('Member rows written');
}

// Rows without a company; employee rows without a sign-in id.
for (const [table, keys] of Object.entries(TABLES)) {
  for await (const item of scan(table)) {
    const Key = Object.fromEntries(keys.map((k) => [k, item[k]]));
    if (table === 'employees' && !item.user_sub?.S) {
      const sub = subByEmail.get(String(item.email?.S ?? '').toLowerCase());
      if (sub) {
        add('employees without a sign-in id');
        if (mode === 'apply' && await conditional(new UpdateItemCommand({ TableName: table, Key, UpdateExpression: 'SET user_sub = :s', ConditionExpression: 'attribute_not_exists(user_sub)', ExpressionAttributeValues: { ':s': { S: sub } } }))) add('sign-in ids written');
      } else if (unverified.has(String(item.email?.S ?? '').toLowerCase())) add('employees without a sign-in id (address not verified, left empty)');
      else add('employees with no sign-in (left empty)');
    }
    if (item.tenant_id?.S) continue;
    add(`${table} rows without a company`);
    if (mode === 'apply' && await conditional(new UpdateItemCommand({ TableName: table, Key, UpdateExpression: 'SET tenant_id = :t', ConditionExpression: 'attribute_not_exists(tenant_id)', ExpressionAttributeValues: { ':t': { S: tenant } } }))) add(`${table} rows stamped`);
  }
}

console.log(`TEN-02 backfill, ${env}, ${mode === 'dry' ? 'dry run (nothing written)' : mode}`);
for (const [k, n] of Object.entries(counts)) console.log(`  ${k}: ${n}`);
if (!Object.keys(counts).length) console.log('  nothing to do');
if (mode === 'check') {
  const missing = Object.entries(counts).filter(([k]) => /without|missing/.test(k)).reduce((s, [, n]) => s + n, 0);
  process.exitCode = missing ? 1 : 0;
}
