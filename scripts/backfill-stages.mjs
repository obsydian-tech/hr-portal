#!/usr/bin/env node
/**
 * NH-99: One-time stage backfill for pre-NH-80 employees.
 *
 * NH-80 introduced event-driven stage bumps that only fire on NEW events
 * (Cognito login, new S3 upload). Employees created before NH-80 was deployed
 * are permanently stuck in INVITED regardless of how many documents they have.
 *
 * This script retroactively applies the correct stage to every INVITED employee
 * based on the actual state of their documents table.
 *
 * Stage logic (mirrors NH-80 Lambda behaviour):
 *   INVITED  → ACTIVE              if any document row exists
 *   ACTIVE   → DOCUMENTS_SUBMITTED if any document has ocr_status in
 *                                  (PASSED | MANUAL_REVIEW | FAILED | PROCESSING)
 *   DOCUMENTS_SUBMITTED → VERIFIED if ALL processed (non-PENDING) docs are PASSED
 *                                  AND at least one NATIONAL_ID is PASSED
 *
 * Safety:
 *   - Idempotent: only updates employees whose current stage would change
 *   - Dry-run mode: set DRY_RUN=1 to log without writing
 *   - Never moves a stage backwards
 *
 * Usage:
 *   node scripts/backfill-stages.mjs
 *   DRY_RUN=1 node scripts/backfill-stages.mjs
 *
 * Prerequisites:
 *   AWS credentials configured (aws sts get-caller-identity)
 *   npm install @aws-sdk/client-dynamodb @aws-sdk/util-dynamodb
 *   (or run from a lambda/ dir that already has the SDK)
 */

import {
  DynamoDBClient,
  ScanCommand,
  QueryCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

// ─── Config ───────────────────────────────────────────────────────────────────

const REGION          = 'af-south-1';
const EMPLOYEES_TABLE = 'employees';
const DOCUMENTS_TABLE = 'documents';
const DRY_RUN         = process.env.DRY_RUN === '1';

const dynamo = new DynamoDBClient({ region: REGION });

// ─── Logging ──────────────────────────────────────────────────────────────────

const log = (level, msg, meta = {}) => {
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, level, msg, ...meta }));
};

// ─── Stage resolution logic ───────────────────────────────────────────────────

/**
 * Given a list of DynamoDB document records (already unmarshalled),
 * return the correct stage for the employee, or null if no change is needed
 * from the currentStage.
 */
function resolveStage(currentStage, docs) {
  if (docs.length === 0) {
    // No documents at all — stay INVITED
    return null;
  }

  const processedDocs = docs.filter(
    (d) => !['PENDING', 'PROCESSING'].includes(d.ocr_status)
  );

  const allProcessedPassed =
    processedDocs.length > 0 &&
    processedDocs.every((d) => d.ocr_status === 'PASSED');

  const hasPassedNationalId = docs.some(
    (d) => d.ocr_status === 'PASSED' && d.document_type === 'NATIONAL_ID'
  );

  // Determine the highest deserved stage
  let deservedStage;
  if (allProcessedPassed && hasPassedNationalId) {
    deservedStage = 'VERIFIED';
  } else if (processedDocs.length > 0) {
    deservedStage = 'DOCUMENTS_SUBMITTED';
  } else {
    // Has document rows but all are still PENDING/PROCESSING
    deservedStage = 'ACTIVE';
  }

  // Only move forward — never backwards
  const STAGE_ORDER = ['INVITED', 'ACTIVE', 'DOCUMENTS_SUBMITTED', 'VERIFIED', 'TRAINING', 'ONBOARDED'];
  const currentRank = STAGE_ORDER.indexOf(currentStage);
  const deservedRank = STAGE_ORDER.indexOf(deservedStage);

  if (deservedRank > currentRank) {
    return deservedStage;
  }
  return null; // already at correct or higher stage
}

// ─── DynamoDB helpers ──────────────────────────────────────────────────────────

async function scanAllEmployees() {
  const employees = [];
  let lastKey;
  do {
    const result = await dynamo.send(
      new ScanCommand({
        TableName: EMPLOYEES_TABLE,
        ExclusiveStartKey: lastKey,
        // Only fetch stuck employees — those at INVITED stage
        FilterExpression: 'stage = :s',
        ExpressionAttributeValues: { ':s': { S: 'INVITED' } },
        ProjectionExpression: 'employee_id, first_name, last_name, email, stage',
      })
    );
    for (const item of result.Items ?? []) {
      employees.push(unmarshall(item));
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
  return employees;
}

async function getDocumentsForEmployee(employeeId) {
  const result = await dynamo.send(
    new QueryCommand({
      TableName: DOCUMENTS_TABLE,
      KeyConditionExpression: 'employee_id = :id',
      ExpressionAttributeValues: { ':id': { S: employeeId } },
      ProjectionExpression: 'document_id, document_type, ocr_status',
    })
  );
  return (result.Items ?? []).map((item) => unmarshall(item));
}

async function updateEmployeeStage(employeeId, newStage) {
  await dynamo.send(
    new UpdateItemCommand({
      TableName: EMPLOYEES_TABLE,
      Key: { employee_id: { S: employeeId } },
      UpdateExpression: 'SET stage = :stage, stage_backfilled_at = :now',
      // Safety guard: only update if still INVITED (prevent race conditions)
      ConditionExpression: 'stage = :invited',
      ExpressionAttributeValues: {
        ':stage':   { S: newStage },
        ':now':     { S: new Date().toISOString() },
        ':invited': { S: 'INVITED' },
      },
    })
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('info', 'NH-99 stage backfill starting', { dryRun: DRY_RUN, region: REGION });

  // 1. Get all INVITED employees
  log('info', 'Scanning employees table for INVITED stage...');
  const employees = await scanAllEmployees();
  log('info', `Found ${employees.length} INVITED employee(s)`, { count: employees.length });

  if (employees.length === 0) {
    log('info', 'Nothing to backfill — all done.');
    return;
  }

  // 2. Process each employee
  const results = { updated: 0, skipped: 0, errors: 0 };

  for (const emp of employees) {
    const { employee_id, first_name, last_name, email, stage } = emp;
    const name = `${first_name} ${last_name}`;

    try {
      // 3. Fetch their documents
      const docs = await getDocumentsForEmployee(employee_id);

      const docSummary = {
        total: docs.length,
        passed: docs.filter((d) => d.ocr_status === 'PASSED').length,
        manual_review: docs.filter((d) => d.ocr_status === 'MANUAL_REVIEW').length,
        failed: docs.filter((d) => d.ocr_status === 'FAILED').length,
        pending: docs.filter((d) => d.ocr_status === 'PENDING').length,
        processing: docs.filter((d) => d.ocr_status === 'PROCESSING').length,
      };

      // 4. Determine correct stage
      const newStage = resolveStage(stage, docs);

      if (!newStage) {
        log('info', 'SKIP — stage already correct or no docs to act on', {
          employee_id, name, email, currentStage: stage, docSummary,
        });
        results.skipped++;
        continue;
      }

      // 5. Apply update (or just log in dry-run)
      if (DRY_RUN) {
        log('info', '[DRY-RUN] Would update stage', {
          employee_id, name, email,
          from: stage, to: newStage, docSummary,
        });
      } else {
        await updateEmployeeStage(employee_id, newStage);
        log('info', 'UPDATED stage', {
          employee_id, name, email,
          from: stage, to: newStage, docSummary,
        });
      }
      results.updated++;

    } catch (err) {
      // ConditionalCheckFailedException means someone else already updated it — safe to skip
      if (err.name === 'ConditionalCheckFailedException') {
        log('warn', 'SKIP — stage changed since scan (race condition, safe to ignore)', {
          employee_id, name, email,
        });
        results.skipped++;
      } else {
        log('error', 'FAILED to update employee', {
          employee_id, name, email, error: err.message,
        });
        results.errors++;
      }
    }
  }

  // 6. Print summary
  log('info', 'Backfill complete', { ...results, dryRun: DRY_RUN });

  if (results.errors > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  log('error', 'Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
