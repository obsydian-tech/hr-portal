#!/usr/bin/env node
/**
 * REC-14 rule 8: gives a company its department list when it has none.
 *   node scripts/tenancy/company-seeds/departments.mjs --env dev|prod --tenant <id> [--apply]
 * Writes version 1 of the company's list (pk TENANT#<id>, sk DEPARTMENTS) with the starting names (Q-1, chosen by Iggie
 * on 22 Nov 2026), all active. A company that already has a list keeps it: nothing is written and nothing re-versions.
 * Without --apply it prints the plan and writes nothing. Output is ids and names of departments only.
 * The module seeds (module-seeds/index.mjs) call seedDepartments for Onboarding and Recruitment, and scripts/ci/seed-dev.py
 * runs this file for the dev companies.
 */
import { pathToFileURL } from 'node:url';
import { DynamoDBClient, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { listItem, listKey, listOfItem, newDepartmentId } from '../../../lambda/shared/departments.mjs';

export const STARTING = ['Engineering', 'Finance', 'Operations', 'People'];
export const TENANT_ID = /^ten_[0-9a-z]{26}$/;
export const tenantsTable = (env) => `naleko-people-${env}-tenants`;
export const available = true;

export class Refused extends Error {
  constructor(message) { super(message); this.name = 'Refused'; }
}

/** Writes version 1 when the company has no list. Returns { written }. */
export async function seedDepartments({ ddb, tenantId, table, by = 'company-seed', apply = true, log = console.log }) {
  const res = await ddb.send(new GetItemCommand({ TableName: table, Key: listKey(tenantId), ConsistentRead: true }));
  if (res.Item) {
    log(`Company ${tenantId}: has a department list (version ${listOfItem(res.Item).version}), nothing to do`);
    return { written: 0 };
  }
  const departments = STARTING.map((name) => ({ id: newDepartmentId(), name, status: 'ACTIVE' }));
  log(`Company ${tenantId}: no department list; version 1 with ${departments.map((d) => d.name).join(', ')}`);
  if (!apply) return { written: 0 };
  await ddb.send(new PutItemCommand({
    TableName: table,
    Item: listItem(tenantId, 1, departments, new Date().toISOString(), by),
    ConditionExpression: 'attribute_not_exists(sk)',
  }));
  log(`Company ${tenantId}: department list written`);
  return { written: 1 };
}

/** The module seed form: set-modules.mjs runs it before a module is switched on. */
export default async function seed({ ddb, tenantId, table, by, log }) {
  return seedDepartments({ ddb, tenantId, table, by: by ?? 'set-modules', log });
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const env = opt('--env');
  const tenantId = opt('--tenant');
  const apply = args.includes('--apply');
  if (!['dev', 'prod'].includes(env)) throw new Refused('--env must be dev or prod');
  if (!TENANT_ID.test(tenantId ?? '')) throw new Refused('--tenant must be a company id (ten_ and 26 letters or digits)');
  const region = process.env.AWS_REGION ?? 'af-south-1';
  const ddb = new DynamoDBClient({ region });
  const table = tenantsTable(env);
  const company = await ddb.send(new GetItemCommand({ TableName: table, Key: { pk: { S: `TENANT#${tenantId}` }, sk: { S: 'PROFILE' } }, ConsistentRead: true }));
  if (!company.Item) throw new Refused(`No company ${tenantId} in ${table}`);
  let by = 'company-seed';
  if (apply) {
    by = (await new STSClient({ region }).send(new GetCallerIdentityCommand({}))).Arn;
    if (!by) throw new Refused('STS did not name the AWS caller');
  }
  await seedDepartments({ ddb, tenantId, table, by, apply, log: (l) => console.log(l) });
  if (!apply) console.log('Dry run: nothing written. Add --apply to write.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    if (err instanceof Refused) {
      console.error(`Refused: ${err.message}`);
      console.error('Usage: departments.mjs --env dev|prod --tenant <id> [--apply]');
      process.exitCode = 2;
    } else {
      console.error(`Failed, nothing changed: ${err?.name ?? 'Error'}`);
      process.exitCode = 1;
    }
  });
}
