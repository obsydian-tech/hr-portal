#!/usr/bin/env node
/**
 * REC-05 rule 1: moves one company's old offer rows (PK CANDIDATE#<id>, SK OFFER) to the new offer shape.
 *
 *   node scripts/recruitment/migrate-offers.mjs --env dev|prod --tenant <ten_ id> [--profile x] [--apply|--check] [--prod-account 937137806477]
 *
 * Default is a dry run (counts, nothing written). --apply writes, for each old row, the new offer row (PK OFFER#<id>, with the list
 * key) and marks the old row with the new state code and moved_to, in one transaction; a live offer also takes the candidate's lock.
 * A second apply changes nothing. --check exits 1 while any row of the company still needs moving. Other companies are never
 * written. Before any read the account is checked against --env. Output is counts only.
 */
import { execFileSync } from 'node:child_process';
import { DynamoDBClient, GetItemCommand, ScanCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { mapState } from '../../lambda/shared/offer-states.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const env = opt('--env');
const tenant = opt('--tenant');
const profile = opt('--profile');
const prodAccount = opt('--prod-account');
const mode = args.includes('--apply') ? 'apply' : args.includes('--check') ? 'check' : 'dry';
const PROD_ACCOUNT = '937137806477';
const STATE_TABLE = 'talent-flow-state';
const ROLES_TABLE = 'talent-flow-roles';
const LIVE = ['DRAFT', 'WAITING_APPROVAL', 'APPROVED', 'SENT'];

function usage(why) {
  console.error(`${why}\nUsage: migrate-offers.mjs --env dev|prod --tenant <ten_ id> [--profile x] [--apply|--check] [--prod-account ${PROD_ACCOUNT}]`);
  process.exit(2);
}
if (!['dev', 'prod'].includes(env)) usage('--env must be dev or prod.');
if (!/^ten_[0-9a-z]{26}$/.test(tenant ?? '')) usage('--tenant must be a company id (ten_ and 26 lowercase letters or digits).');
if (env === 'prod' && mode === 'apply' && prodAccount !== PROD_ACCOUNT) usage('Prod needs --prod-account with the prod account number, after the separate yes.');
if (profile) process.env.AWS_PROFILE = profile;
const region = process.env.AWS_REGION ?? 'af-south-1';

let account;
try {
  account = execFileSync('aws', ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text', '--region', region], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
} catch {
  usage('Could not ask AWS which account this sign-in reaches. Nothing was read or written.');
}
if (env === 'prod' && account !== PROD_ACCOUNT) usage('--env prod, but this sign-in is not the prod account. Nothing was read or written.');
if (env === 'dev' && account === PROD_ACCOUNT) usage('--env dev, but this sign-in is the prod account. Nothing was read or written.');

const ddb = new DynamoDBClient({ region });
const needsMove = (row) => row.tenant_id === tenant && row.moved_to === undefined;

const rows = [];
let start;
do {
  const page = await ddb.send(new ScanCommand({
    TableName: STATE_TABLE, FilterExpression: 'SK = :offer AND begins_with(PK, :candidate)',
    ExpressionAttributeValues: marshall({ ':offer': 'OFFER', ':candidate': 'CANDIDATE#' }), ExclusiveStartKey: start,
  }));
  for (const raw of page.Items ?? []) {
    const row = unmarshall(raw);
    if (needsMove(row)) rows.push(row);
  }
  start = page.LastEvaluatedKey;
} while (start);

if (mode === 'check') {
  console.log(`${rows.length} offer rows still to move.`);
  process.exit(rows.length > 0 ? 1 : 0);
}
if (mode === 'dry') {
  console.log(`Dry run: ${rows.length} offer rows would move. Nothing was written.`);
  process.exit(0);
}

const get = async (table, key) => {
  const r = await ddb.send(new GetItemCommand({ TableName: table, Key: marshall(key) }));
  return r.Item ? unmarshall(r.Item) : null;
};

let moved = 0;
let skipped = 0;
for (const row of rows) {
  const candidateId = row.candidateId ?? String(row.PK).replace('CANDIDATE#', '');
  const offerId = `offer-legacy-${candidateId.toLowerCase()}`;
  const to = mapState(row.state);
  const at = new Date().toISOString();
  const created = row.createdAt ?? at;
  const saga = await get(STATE_TABLE, { PK: `CANDIDATE#${candidateId}`, SK: 'SAGA' });
  const role = saga?.role_id ? await get(ROLES_TABLE, { pk: `TENANT#${tenant}`, sk: `ROLE#${saga.role_id}` }) : null;
  const offer = {
    PK: `OFFER#${offerId}`, SK: 'OFFER', offer_id: offerId, tenant_id: tenant, candidate_id: candidateId, role_id: saga?.role_id ?? null,
    candidate_name: saga ? [saga.firstName, saga.lastName].filter(Boolean).join(' ') : null, role_title: role?.job_title ?? null,
    department: role?.department ?? null, state: to, version: 1, salary: row.baseSalary ?? null, currency: row.currency ?? 'ZAR',
    start_date: row.startDate ?? null, expiry_date: row.expiryDate ?? null, benefits: row.benefits ?? null, drafted_by: null, drafted_by_name: null,
    created_at: created, updated_at: at, ...(row.sentAt ? { sent_at: row.sentAt } : {}), approval_history: [],
    history: [{ from: row.state, to, by: 'migrate-offers', by_kind: 'system', by_name: null, at }], legacy_state: row.state,
    GSI2PK: `TENANT#${tenant}#OFFER`, GSI2SK: `${created}#${offerId}`,
  };
  const items = [
    {
      Update: {
        TableName: STATE_TABLE, Key: marshall({ PK: row.PK, SK: 'OFFER' }), UpdateExpression: 'SET #s = :to, legacy_state = :old, moved_to = :id',
        ConditionExpression: 'tenant_id = :t AND #s = :old AND attribute_not_exists(moved_to)', ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: marshall({ ':to': to, ':old': row.state, ':id': offerId, ':t': tenant }),
      },
    },
    { Put: { TableName: STATE_TABLE, Item: marshall(offer, { removeUndefinedValues: true }), ConditionExpression: 'attribute_not_exists(PK)' } },
  ];
  if (LIVE.includes(to)) {
    items.push({
      Update: {
        TableName: STATE_TABLE, Key: marshall({ PK: `TENANT#${tenant}#OFFER_LIVE#${candidateId}`, SK: 'LOCK' }), UpdateExpression: 'SET live_offer_id = :id, tenant_id = :t',
        ConditionExpression: 'attribute_not_exists(live_offer_id)', ExpressionAttributeValues: marshall({ ':id': offerId, ':t': tenant }),
      },
    });
  }
  try {
    await ddb.send(new TransactWriteItemsCommand({ TransactItems: items }));
    moved += 1;
  } catch (err) {
    skipped += 1;
    console.error(`Skipped one offer row: ${err.name}.`);
  }
}
console.log(`Moved ${moved} offer rows; ${skipped} skipped.`);
process.exit(skipped > 0 ? 1 : 0);
