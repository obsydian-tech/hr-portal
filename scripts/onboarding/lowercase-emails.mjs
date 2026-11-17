#!/usr/bin/env node
/**
 * BE-18 (NH-210): lower-cases `email` on employee rows stored with capitals, so the start page, the
 * consent route and the post sign-in trigger find them (they look the address up in lower case).
 *
 *   node scripts/onboarding/lowercase-emails.mjs --plan    counts only, writes nothing
 *   node scripts/onboarding/lowercase-emails.mjs --apply   lower-cases those rows
 *
 * Uses the AWS profile and region of the shell (dev: --profile pepla-dev). Prints counts, never an address.
 * Refuses to write anything when two rows would end up with the same address.
 * Each update holds only if the row still has the address the scan read, so a row changed in between is
 * skipped and counted. Running it in prod needs Iggie's yes first (prod data change).
 */
import { DynamoDBClient, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { pathToFileURL } from 'node:url';

const TABLE = process.env.EMPLOYEES_TABLE || 'employees';

/** Runs the plan or the apply. Returns { exitCode }. Never exits the process itself. */
export async function main(args) {
  const apply = args.includes('--apply');
  if (!apply && !args.includes('--plan')) {
    console.error('Say --plan (counts only) or --apply (writes).');
    return { exitCode: 2 };
  }
  const ddb = new DynamoDBClient();

  const rows = [];
  let start;
  do {
    const page = await ddb.send(new ScanCommand({
      TableName: TABLE,
      ProjectionExpression: 'employee_id, #e',
      ExpressionAttributeNames: { '#e': 'email' },
      ...(start ? { ExclusiveStartKey: start } : {}),
    }));
    rows.push(...(page.Items ?? []));
    start = page.LastEvaluatedKey;
  } while (start);

  // An address that is only spaces is left alone: lower-casing it would write an empty index key.
  const withEmail = rows.filter((r) => typeof r.email?.S === 'string' && r.email.S.trim() !== '');
  const byLower = new Map();
  for (const r of withEmail) {
    const lower = r.email.S.trim().toLowerCase();
    byLower.set(lower, (byLower.get(lower) ?? 0) + 1);
  }
  const clashes = [...byLower.values()].filter((n) => n > 1).length;
  const toChange = withEmail.filter((r) => r.email.S !== r.email.S.trim().toLowerCase());

  console.log(`Rows: ${rows.length}. With capitals: ${toChange.length}. Addresses shared by two or more rows: ${clashes}.`);
  if (clashes > 0) {
    console.error('Nothing written: two or more rows would end up with the same address. Sort those out first.');
    return { exitCode: 1 };
  }
  if (!apply) return { exitCode: 0 };

  let changed = 0;
  let skipped = 0;
  try {
    for (const r of toChange) {
      try {
        await ddb.send(new UpdateItemCommand({
          TableName: TABLE,
          Key: { employee_id: r.employee_id },
          UpdateExpression: 'SET #e = :new',
          ConditionExpression: '#e = :old',
          ExpressionAttributeNames: { '#e': 'email' },
          ExpressionAttributeValues: { ':new': { S: r.email.S.trim().toLowerCase() }, ':old': { S: r.email.S } },
        }));
        changed += 1;
      } catch (e) {
        if (e?.name !== 'ConditionalCheckFailedException') throw e;
        skipped += 1;
      }
    }
  } finally {
    // Printed even when a write fails part-way, so whoever runs it knows how far it got.
    console.log(`Lower-cased: ${changed}. Skipped (changed since the scan): ${skipped}.`);
  }
  return { exitCode: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (r) => process.exit(r.exitCode),
    (e) => { console.error(`Failed: ${e?.name ?? 'Error'}`); process.exit(1); },
  );
}
