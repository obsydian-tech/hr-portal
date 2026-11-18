#!/usr/bin/env node
/**
 * MOD-01: switches a company's modules on or off. Naleko only; no HTTP route does this.
 *   node scripts/tenancy/set-modules.mjs --env dev|prod --tenant <id> [--on a,b] [--off c] [--reason "..."] [--apply|--check]
 * Default is a dry run: it prints the plan and writes nothing. --apply writes (seed first, then the key, then one
 * audit row). --check exits 1 while the company does not have exactly the change asked for. A second --apply
 * changes nothing and writes no row. Output is ids and keys only. The AWS caller is your own profile (STS names it).
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { Refused, setModules } from './lib/set-modules.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const keys = (name) => (opt(name) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const env = opt('--env');
const tenantId = opt('--tenant');
const reason = opt('--reason');
const mode = args.includes('--apply') ? 'apply' : args.includes('--check') ? 'check' : 'dry';
const region = process.env.AWS_REGION ?? 'af-south-1';

async function main() {
  const ddb = new DynamoDBClient({ region });
  let by;
  if (mode === 'apply') {
    by = (await new STSClient({ region }).send(new GetCallerIdentityCommand({}))).Arn;
    if (!by) throw new Refused('STS did not name the AWS caller', 1);
  }
  const r = await setModules({ ddb, env, tenantId, on: keys('--on'), off: keys('--off'), reason, mode, by, log: (l) => console.log(l) });
  if (mode === 'check') {
    console.log(r.changed ? 'Check: the company does not have this yet' : 'Check: the company already has this');
    process.exitCode = r.changed ? 1 : 0;
  } else if (mode === 'dry') {
    console.log('Dry run: nothing written. Add --apply to write.');
  }
}

main().catch((err) => {
  if (err instanceof Refused) {
    console.error(`Refused: ${err.message}`);
    console.error('Usage: set-modules.mjs --env dev|prod --tenant <id> [--on a,b] [--off c] [--reason "..."] [--apply|--check]');
    process.exitCode = err.code;
  } else {
    console.error(`Failed, nothing changed: ${err?.message ?? err}`);
    process.exitCode = 1;
  }
});
