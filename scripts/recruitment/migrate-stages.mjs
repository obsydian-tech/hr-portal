#!/usr/bin/env node
/**
 * REC-03: moves one company's candidates from the old stage names to the six stages.
 *
 *   node scripts/recruitment/migrate-stages.mjs --env dev|prod --tenant <ten_ id> [--profile x] [--apply|--check]
 *                                               [--prod-account 937137806477]
 *
 * Default is a dry run: it prints how many candidate rows would move and writes nothing.
 * --apply moves each row together with one history row (reason code STAGE_LIST_CHANGE, no sentence), in one transaction whose
 *   condition holds only while the row still looks the way it was read, so a second apply changes nothing. The old stage is kept
 *   on the row as legacy_stage. A candidate the old system rejected (status REJECTED or EVALUATION_FAILED) becomes Not hired, marked
 *   OLD_SYSTEM with the stage it was in and the old rejection time (evaluationCompletedAt, or the time of this run when there is
 *   none). A candidate in an old Hired stage (contract, pre-boarding, onboarding) becomes Hired and is marked legacy_hired: no
 *   employee record is made for it. Nothing else on the row changes, and `status` stays as it was.
 *   On prod, --apply needs --prod-account 937137806477 as well (Iggie's separate yes).
 * --check exits 1 while any row of the company still needs moving.
 * Rows of any other company are never read for changes and never written. Rows that already carry a decision (decided_by_kind) are
 * left alone, so REC-02's own Not hired rows and the rows of an earlier apply are not touched.
 * Before any read, the account the sign-in reaches is checked against --env (prod must be the prod account, dev must not be);
 * if the account cannot be found out, nothing is read or written.
 * Output is counts only: no names, addresses or numbers beyond the counts.
 */
import { execFileSync } from 'node:child_process';
import { DynamoDBClient, ScanCommand, TransactWriteItemsCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { STAGE_CODES, normaliseStage } from '../../lambda/shared/recruitment-stages.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const env = opt('--env');
const tenant = opt('--tenant');
const profile = opt('--profile');
const prodAccount = opt('--prod-account');
const mode = args.includes('--apply') ? 'apply' : args.includes('--check') ? 'check' : 'dry';
const PROD_ACCOUNT = '937137806477';
const STATE_TABLE = 'talent-flow-state';
const OLD_OUTCOMES = ['REJECTED', 'EVALUATION_FAILED'];

function usage(why) {
  console.error(`${why}\nUsage: migrate-stages.mjs --env dev|prod --tenant <ten_ id> [--profile x] [--apply|--check] [--prod-account ${PROD_ACCOUNT}]`);
  process.exit(2);
}
if (!['dev', 'prod'].includes(env)) usage('--env must be dev or prod.');
if (!/^ten_[0-9a-z]{26}$/.test(tenant ?? '')) usage('--tenant must be a company id (ten_ and 26 lowercase letters or digits).');
if (env === 'prod' && mode === 'apply' && prodAccount !== PROD_ACCOUNT) usage('Prod needs --prod-account with the prod account number, after the separate yes.');
if (profile) process.env.AWS_PROFILE = profile;

const region = process.env.AWS_REGION ?? 'af-south-1';

// The account the sign-in really reaches must match --env, before anything is read or written. No answer is no go.
let account;
try {
  account = execFileSync('aws', ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text', '--region', region], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
} catch {
  usage('Could not ask AWS which account this sign-in reaches. Nothing was read or written.');
}
if (env === 'prod' && account !== PROD_ACCOUNT) usage('--env prod, but this sign-in is not the prod account. Nothing was read or written.');
if (env === 'dev' && account === PROD_ACCOUNT) usage('--env dev, but this sign-in is the prod account. Nothing was read or written.');

const ddb = new DynamoDBClient({ region });

/** A row of this company that still has to move: no decision recorded yet, and an old stage name or an old outcome. */
// A row with no stage, or a stage this script does not know, is left alone (counted, never an error).
const needsMove = (row) => row.tenant_id === tenant && row.decided_by_kind === undefined && normaliseStage(row.currentStage) !== undefined
  && (!STAGE_CODES.includes(row.currentStage) || OLD_OUTCOMES.includes(row.status));

// Every page of the table, candidate rows only.
const rows = [];
let start;
do {
  const page = await ddb.send(new ScanCommand({
    TableName: STATE_TABLE,
    FilterExpression: 'SK = :saga AND begins_with(PK, :candidate)',
    ExpressionAttributeValues: marshall({ ':saga': 'SAGA', ':candidate': 'CANDIDATE#' }),
    ExclusiveStartKey: start,
  }));
  for (const raw of page.Items ?? []) {
    const row = unmarshall(raw);
    if (needsMove(row)) rows.push(row);
  }
  start = page.LastEvaluatedKey;
} while (start);

if (mode === 'check') {
  console.log(`${rows.length} candidate rows still to move.`);
  process.exit(rows.length > 0 ? 1 : 0);
}
if (mode === 'dry') {
  console.log(`Dry run: ${rows.length} candidate rows would move. Nothing was written.`);
  process.exit(0);
}

let moved = 0;
let skipped = 0;

for (const row of rows) {
  const old = row.currentStage;
  const mapped = normaliseStage(old);
  const rejected = OLD_OUTCOMES.includes(row.status);
  const to = rejected ? 'NOT_HIRED' : mapped;
  const at = new Date().toISOString();

  const names = { '#stage': 'currentStage', '#legacy': 'legacy_stage', '#updated': 'updatedAt', '#status': 'status', '#decided': 'decided_by_kind' };
  const values = { ':to': to, ':old': old, ':at': at, ':tenant': tenant };
  let set = 'SET #stage = :to, #legacy = :old, #updated = :at';
  if (rejected) {
    Object.assign(names, { '#before': 'stage_before_not_hired', '#notAt': 'not_hired_at' });
    Object.assign(values, { ':kind': 'OLD_SYSTEM', ':before': mapped, ':notAt': row.evaluationCompletedAt ?? at });
    set += ', #decided = :kind, #before = :before, #notAt = :notAt';
  } else if (to === 'HIRED') {
    names['#hired'] = 'legacy_hired';
    values[':hired'] = true;
    set += ', #hired = :hired';
  }
  // The row must still look as it did when read: same stage, same status (or still none), nothing decided yet, same company.
  let condition = 'tenant_id = :tenant AND #stage = :old AND attribute_not_exists(#decided)';
  if (row.status === undefined) condition += ' AND attribute_not_exists(#status)';
  else { condition += ' AND #status = :status'; values[':status'] = row.status; }

  try {
    await ddb.send(new TransactWriteItemsCommand({
      TransactItems: [
        {
          Update: {
            TableName: STATE_TABLE,
            Key: marshall({ PK: row.PK, SK: 'SAGA' }),
            UpdateExpression: set,
            ConditionExpression: condition,
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: marshall(values),
          },
        },
        {
          Put: {
            TableName: STATE_TABLE,
            Item: marshall({
              PK: row.PK, SK: `STAGE#${at}#migrated`, candidateId: row.candidateId, tenant_id: tenant,
              from: old, to, reason_code: 'STAGE_LIST_CHANGE', by: 'migrate-stages', by_kind: 'SYSTEM', at, recordType: 'STAGE_HISTORY',
            }, { removeUndefinedValues: true }),
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
      ],
    }));
    moved += 1;
  } catch (err) {
    skipped += 1;
    console.error(`Skipped one candidate row: ${err.name}.`);
  }
}
console.log(`Moved ${moved} candidate rows; ${skipped} skipped.`);
process.exit(skipped > 0 ? 1 : 0);
