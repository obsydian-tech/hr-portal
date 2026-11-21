#!/usr/bin/env node
/**
 * REC-12: writes the Recruitment Standard pack for one company, the same seed MOD-01's switch-on runs. scripts/ci/seed-dev.py
 * calls this for the first dev company. It creates only the settings the company lacks and never changes one that exists.
 *   node scripts/tenancy/seed-recruitment-pack.mjs --tenant <id> [--apply]
 * Without --apply it prints nothing and writes nothing but the line that says so. Output is counts only.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import seed from './module-seeds/recruitment.mjs';
import { TENANT_ID } from './lib/set-modules.mjs';

const args = process.argv.slice(2);
const i = args.indexOf('--tenant');
const tenantId = i >= 0 ? args[i + 1] : undefined;

if (!TENANT_ID.test(tenantId ?? '')) {
  console.error('Refused: --tenant must be a company id (ten_ and 26 letters or digits)');
  process.exit(2);
}
if (!args.includes('--apply')) {
  console.log('Dry run: nothing written. Add --apply to write.');
  process.exit(0);
}
try {
  await seed({ ddb: new DynamoDBClient({ region: process.env.AWS_REGION ?? 'af-south-1' }), tenantId, log: (l) => console.log(l) });
} catch (err) {
  console.error(`Failed, nothing changed: ${err?.name ?? 'Error'}`);
  process.exit(1);
}
