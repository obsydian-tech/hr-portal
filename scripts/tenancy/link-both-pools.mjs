#!/usr/bin/env node
/**
 * TEN-06: people who are already in both pools (same email) keep their Naleko password. This gives each of them their
 * old TalentFlow id (legacy_user_id on their Member row, so their votes, tasks and candidates still match) and the
 * groups their TalentFlow groups map to (lambda/shared/roles.mjs).
 *   node scripts/tenancy/link-both-pools.mjs --env dev|prod --tenant <founding id> --pool <Naleko pool id> --talent-flow-pool <TalentFlow pool id> [--profile x] [--apply|--check]
 * Default is a dry run: counts only, no writes. --apply writes with conditions (a second apply changes nothing).
 * --check exits 1 if anyone in both pools is not linked yet. Output is counts only: no names, emails or ids.
 */
import { DynamoDBClient, QueryCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { CognitoIdentityProviderClient, ListUsersCommand, AdminListGroupsForUserCommand, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { grantOfNames } from '../../lambda/shared/roles.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const env = opt('--env');
const tenant = opt('--tenant');
const naleko = opt('--pool');
const talentFlow = opt('--talent-flow-pool');
const profile = opt('--profile');
const mode = args.includes('--apply') ? 'apply' : args.includes('--check') ? 'check' : 'dry';
if (!['dev', 'prod'].includes(env) || !/^ten_[0-9a-z]{26}$/.test(tenant ?? '') || !naleko || !talentFlow) {
  console.error('Usage: link-both-pools.mjs --env dev|prod --tenant <id> --pool <Naleko pool id> --talent-flow-pool <TalentFlow pool id> [--profile x] [--apply|--check]');
  process.exit(2);
}
if (profile) process.env.AWS_PROFILE = profile;
const region = process.env.AWS_REGION ?? 'af-south-1';
const ddb = new DynamoDBClient({ region });
const idp = new CognitoIdentityProviderClient({ region });
const TENANTS = `naleko-people-${env}-tenants`;
const counts = {};
const add = (k, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
const attr = (u, n) => (u.Attributes ?? []).find((a) => a.Name === n)?.Value;

async function users(poolId, filter) {
  const out = [];
  let token;
  do {
    const page = await idp.send(new ListUsersCommand({ UserPoolId: poolId, ...(filter ? { Filter: filter } : {}), ...(token ? { PaginationToken: token } : {}) }));
    out.push(...(page.Users ?? []));
    token = page.PaginationToken;
  } while (token);
  return out;
}
const groupsOf = async (poolId, username) => (await idp.send(new AdminListGroupsForUserCommand({ UserPoolId: poolId, Username: username }))).Groups?.map((g) => g.GroupName) ?? [];
const conditional = async (cmd) => {
  try { await ddb.send(cmd); return true; } catch (e) { if (e?.name === 'ConditionalCheckFailedException') return false; throw e; }
};

for (const tf of await users(talentFlow)) {
  const email = String(attr(tf, 'email') ?? '').trim().toLowerCase();
  const tfSub = attr(tf, 'sub');
  if (!email || !tfSub) { add('TalentFlow people without an email'); continue; }
  const there = (await users(naleko, `email = "${email}"`)).filter((u) => String(attr(u, 'email') ?? '').toLowerCase() === email);
  if (there.length === 0) { add('only in the TalentFlow pool'); continue; }
  if (there.length > 1) { add('several sign-ins for one email'); continue; }
  add('in both pools');
  const nSub = attr(there[0], 'sub');
  const members = (await ddb.send(new QueryCommand({
    TableName: TENANTS,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :t)',
    ExpressionAttributeValues: { ':pk': { S: `USER#${nSub}` }, ':t': { S: 'TENANT#' } },
  }))).Items ?? [];
  if (members.length > 1 || (members.length === 1 && members[0].tenant_id?.S !== tenant)) { add('in another company or in several'); continue; }
  const member = members[0];
  if (member?.legacy_user_id?.S && member.legacy_user_id.S !== tfSub) { add('linked to a different TalentFlow person'); continue; }
  let linked = member?.legacy_user_id?.S === tfSub;
  if (!linked) {
    add('to link');
    if (mode === 'apply') {
      const done = member
        ? await conditional(new UpdateItemCommand({
          TableName: TENANTS, Key: { pk: member.pk, sk: member.sk }, UpdateExpression: 'SET legacy_user_id = :l',
          ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(legacy_user_id)', ExpressionAttributeValues: { ':l': { S: tfSub } },
        }))
        : await conditional(new PutItemCommand({
          TableName: TENANTS,
          Item: { pk: { S: `USER#${nSub}` }, sk: { S: `TENANT#${tenant}` }, tenant_id: { S: tenant }, legacy_user_id: { S: tfSub }, created_at: { S: new Date().toISOString() } },
          ConditionExpression: 'attribute_not_exists(pk)',
        }));
      if (done) { add('linked'); linked = true; }
    }
  } else add('already linked');
  const want = grantOfNames(await groupsOf(talentFlow, attr(tf, 'email') ?? tf.Username));
  const wanted = [...want.roles, ...want.perms];
  const have = new Set(await groupsOf(naleko, there[0].Username));
  const missing = wanted.filter((g) => !have.has(g));
  if (missing.length) {
    add('with groups to add');
    if (mode === 'apply') {
      for (const g of missing) await idp.send(new AdminAddUserToGroupCommand({ UserPoolId: naleko, Username: there[0].Username, GroupName: g }));
      add('groups added', missing.length);
    }
  }
}
for (const [k, v] of Object.entries(counts)) console.log(`${k}: ${v}`);
console.log(`mode: ${mode}`);
if (mode === 'check' && ((counts['to link'] ?? 0) > 0 || (counts['with groups to add'] ?? 0) > 0)) process.exit(1);
