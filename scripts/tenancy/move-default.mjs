#!/usr/bin/env node
/**
 * TEN-03: moves the TalentFlow, IT task and provisioning bundle records that name no real company
 * (company DEFAULT, company NALEKO, or no company at all) to the founding company.
 *
 *   node scripts/tenancy/move-default.mjs --env dev|prod --tenant <founding id> [--profile x] [--apply|--check]
 *                                         [--prod-account 937137806477]
 *
 * Default is a dry run: counts only, nothing written.
 * --apply moves the records. A record whose key holds the old company is copied under the new key and the old key is
 *   removed in the same TransactWriteItems (one record per transaction), so a failed copy deletes nothing. Every other
 *   record is updated in place with a condition that holds only while it still looks the way it was read, so a second
 *   apply changes nothing. On prod, --apply needs --prod-account 937137806477 as well (Iggie's separate yes).
 * --check exits 1 while any record still names DEFAULT or NALEKO, or has no company. Records of any other company are
 *   counted and never touched.
 * Output is counts only: no names, addresses, record ids or numbers beyond the counts.
 */
import { DynamoDBClient, ScanCommand, UpdateItemCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const env = opt('--env');
const tenant = opt('--tenant');
const profile = opt('--profile');
const prodAccount = opt('--prod-account');
const mode = args.includes('--apply') ? 'apply' : args.includes('--check') ? 'check' : 'dry';
const PROD_ACCOUNT = '937137806477';

function usage(why) {
  console.error(`${why}\nUsage: move-default.mjs --env dev|prod --tenant <ten_ id> [--profile x] [--apply|--check] [--prod-account ${PROD_ACCOUNT}]`);
  process.exit(2);
}
if (!['dev', 'prod'].includes(env)) usage('--env must be dev or prod.');
if (!/^ten_[0-9a-z]{26}$/.test(tenant ?? '')) usage('--tenant must be a company id (ten_ and 26 lowercase letters or digits).');
if (env === 'prod' && mode === 'apply' && prodAccount !== PROD_ACCOUNT) usage('Prod needs --prod-account with the prod account number, after the separate yes.');
if (profile) process.env.AWS_PROFILE = profile;

const region = process.env.AWS_REGION ?? 'af-south-1';
const ddb = new DynamoDBClient({ region });

// The fixed TalentFlow, IT task and bundle tables and their key attributes.
const TABLES = [
  { label: 'state', name: 'talent-flow-state', keys: ['PK', 'SK'] },
  { label: 'config', name: 'talent-flow-config', keys: ['PK', 'SK'] },
  { label: 'dismissals', name: 'talent-flow-intelligence-dismissals', keys: ['PK', 'SK'] },
  { label: 'notifications', name: 'talent-flow-notifications', keys: ['PK', 'SK'] },
  { label: 'events', name: 'talent-flow-events', keys: ['PK', 'SK'] },
  { label: 'users', name: 'talent-flow-users', keys: ['PK', 'SK'] },
  { label: 'pending actions', name: 'talent-flow-pending-actions', keys: ['actionId'] },
  { label: 'IT tasks', name: 'it-tasks', keys: ['taskId'] },
  { label: 'bundles', name: 'provisioning-bundles', keys: ['bundleId'] },
];

const OLD = /^(DEFAULT|NALEKO)$/;
const OLD_IN_KEY = /TENANT#(DEFAULT|NALEKO)/;
const s = (item, name) => item[name]?.S;
const isSaga = (item) => s(item, 'SK') === 'SAGA' && (s(item, 'PK') ?? '').startsWith('CANDIDATE#');

/** 'legacy' (to move), 'ours' (already the founding company), or 'other' (another company: counted, untouched). */
function classify(item) {
  const tid = s(item, 'tenant_id');
  const old = s(item, 'tenantId');
  if (tid !== undefined && !OLD.test(tid) && tid !== tenant) return 'other';
  if (tid === undefined && old !== undefined && !OLD.test(old) && old !== tenant) return 'other';
  const inKey = ['PK', 'SK', 'GSI1PK', 'GSI1SK'].some((k) => OLD_IN_KEY.test(s(item, k) ?? ''));
  const named = (tid !== undefined && OLD.test(tid)) || (old !== undefined && OLD.test(old));
  const none = tid === undefined && old === undefined;
  const unlisted = isSaga(item) && s(item, 'GSI1PK') !== `TENANT#${tenant}`;
  return named || none || inKey || unlisted ? 'legacy' : 'ours';
}

const swap = (v) => v.replace(/TENANT#(DEFAULT|NALEKO)/, `TENANT#${tenant}`);

/** The moved record, and whether its key changed. */
function moved(item, keys) {
  const next = { ...item, tenant_id: { S: tenant } };
  if (item.tenantId !== undefined) next.tenantId = { S: tenant };
  for (const k of ['PK', 'SK', 'GSI1PK', 'GSI1SK']) {
    const v = s(item, k);
    if (v !== undefined && OLD_IN_KEY.test(v)) next[k] = { S: swap(v) };
  }
  if (isSaga(item)) {
    next.GSI1PK = { S: `TENANT#${tenant}` };
    if (!next.GSI1SK) next.GSI1SK = { S: `SAGA#${s(item, 'createdAt') ?? '1970-01-01T00:00:00.000Z'}` };
  }
  const keyChanged = keys.some((k) => s(item, k) !== s(next, k));
  return { next, keyChanged };
}

async function* scan(table) {
  let start;
  do {
    const page = await ddb.send(new ScanCommand({ TableName: table, ...(start ? { ExclusiveStartKey: start } : {}) }));
    for (const i of page.Items ?? []) yield i;
    start = page.LastEvaluatedKey;
  } while (start);
}

/** Updates a record in place, only while it still reads the way it was scanned. */
async function updateInPlace(name, keys, item, next) {
  const names = {};
  const values = {};
  const sets = [];
  const conds = [];
  let n = 0;
  for (const attr of ['tenant_id', 'tenantId', 'GSI1PK', 'GSI1SK']) {
    if (next[attr] === undefined) continue;
    const had = item[attr];
    if (had !== undefined && s(item, attr) === s(next, attr)) continue; // already right
    names[`#a${n}`] = attr;
    values[`:n${n}`] = next[attr];
    sets.push(`#a${n} = :n${n}`);
    if (had === undefined) conds.push(`attribute_not_exists(#a${n})`);
    else { values[`:o${n}`] = had; conds.push(`#a${n} = :o${n}`); }
    n += 1;
  }
  if (!sets.length) return false;
  await ddb.send(new UpdateItemCommand({
    TableName: name,
    Key: Object.fromEntries(keys.map((k) => [k, item[k]])),
    UpdateExpression: `SET ${sets.join(', ')}`,
    ConditionExpression: conds.join(' AND '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  }));
  return true;
}

const totals = { legacy: 0, other: 0, moved: 0, failed: 0 };
console.log(`TEN-03 move, ${env}, ${mode === 'dry' ? 'dry run (nothing written)' : mode}`);

for (const { label, name, keys } of TABLES) {
  const legacy = [];
  const count = { ours: 0, other: 0 };
  for await (const item of scan(name)) {
    const kind = classify(item);
    if (kind === 'legacy') legacy.push(item);
    else count[kind] += 1;
  }
  totals.legacy += legacy.length;
  totals.other += count.other;
  let done = 0;
  let failed = 0;

  if (mode === 'apply') {
    for (const item of legacy) {
      const { next, keyChanged } = moved(item, keys);
      try {
        if (keyChanged) {
          await ddb.send(new TransactWriteItemsCommand({
            TransactItems: [
              { Put: { TableName: name, Item: next, ConditionExpression: `attribute_not_exists(${keys[0]})` } },
              { Delete: { TableName: name, Key: Object.fromEntries(keys.map((k) => [k, item[k]])), ConditionExpression: `attribute_exists(${keys[0]})` } },
            ],
          }));
          done += 1;
        } else if (await updateInPlace(name, keys, item, next)) {
          done += 1;
        }
      } catch (e) {
        // A record that changed since it was read is left for the next run; the run then exits 1.
        failed += 1;
        console.error(`  ${label}: one record not moved (${e?.name ?? 'error'})`);
      }
    }
  }
  totals.moved += done;
  totals.failed += failed;
  const verb = mode === 'apply' ? `moved ${done}, not moved ${failed}` : `to move ${legacy.length}`;
  console.log(`  ${label}: ${verb}, already the founding company ${count.ours}, other companies ${count.other} (left alone)`);
}

console.log(`  total ${mode === 'apply' ? 'moved' : 'to move'}: ${mode === 'apply' ? totals.moved : totals.legacy}`);
console.log(`  total of other companies (left alone): ${totals.other}`);
if (mode === 'check') {
  console.log(totals.legacy ? `  check: ${totals.legacy} still to move` : '  check: nothing left to move');
  process.exitCode = totals.legacy ? 1 : 0;
} else if (mode === 'apply') {
  process.exitCode = totals.failed ? 1 : 0;
}
