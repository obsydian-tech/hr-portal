#!/usr/bin/env node
/**
 * seed-talent-flow-config.js — NH-121 / BE-005
 *
 * Seeds all 6 TalentFlow configTypes for the DEFAULT tenant at v1.
 * Safe to run multiple times — uses condition_expression to skip existing items.
 *
 * Usage:
 *   node scripts/seed-talent-flow-config.js [--dry-run] [--region af-south-1]
 *
 * Required env:
 *   CONFIG_TABLE_NAME  — DynamoDB table name (falls back to 'talent-flow-config')
 *
 * Optional env:
 *   AWS_REGION         — AWS region (falls back to --region flag or af-south-1)
 */

import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const regionArg = (() => {
  const idx = args.indexOf('--region');
  return idx !== -1 ? args[idx + 1] : null;
})();

// ── Config ────────────────────────────────────────────────────────────────────

const REGION = process.env.AWS_REGION || regionArg || 'af-south-1';
const TABLE_NAME = process.env.CONFIG_TABLE_NAME || 'talent-flow-config';
const TENANT_ID = 'DEFAULT';
const VERSION = 1;

// ── Default data — mirrors getDefaults() in lambda/shared/config-reader.js ───

const DEFAULTS = {
  SCORING_WEIGHTS: {
    technical: 30,
    communication: 25,
    culturalFit: 25,
    problemSolving: 20,
  },
  SLA_THRESHOLDS: {
    APPLICATION_REVIEW: 24,
    PHONE_SCREENING: 48,
    TECHNICAL_INTERVIEW: 72,
    PANEL_INTERVIEW: 96,
    EVALUATION: 48,
    OFFER_PREPARATION: 24,
    OFFER_APPROVAL: 72,
    OFFER_DELIVERY: 24,
  },
  APPROVAL_RULES: {
    minimumPassScore: 6.0,
    requireFinanceApprovalAbove: 600000,
    escalationThresholdDays: 3,
  },
  PANEL_CONFIG: {
    rules: {
      strongNoVeto: true,
      votesRequired: {
        JUNIOR: 2,
        MID: 3,
        SENIOR: 4,
        DIRECTOR: 5,
      },
    },
  },
  EMAIL_TEMPLATES: {
    CANDIDATE_CREATED:    'talent-flow-candidate-created',
    INTERVIEW_SCHEDULED:  'talent-flow-interview-scheduled',
    EVALUATION_COMPLETED: 'talent-flow-evaluation-completed',
    OFFER_APPROVED:       'talent-flow-offer-approved',
    SLA_BREACHED:         'talent-flow-sla-breached',
  },
  STAGE_CONFIG: {
    enabled: [
      'APPLICATION_REVIEW',
      'PHONE_SCREENING',
      'TECHNICAL_INTERVIEW',
      'PANEL_INTERVIEW',
      'EVALUATION',
      'BACKGROUND_CHECK',
      'OFFER_PREPARATION',
      'OFFER_APPROVAL',
      'OFFER_DELIVERY',
      'CONTRACT_SIGNING',
      'PRE_BOARDING',
      'ONBOARDING',
    ],
  },
};

// ── Build DynamoDB items ──────────────────────────────────────────────────────

function buildItem(configType) {
  const createdAt = new Date().toISOString();
  return {
    PK: `TENANT#${TENANT_ID}`,
    SK: `CONFIG#${configType}#v${VERSION}`,
    GSI1PK: `TENANT#${TENANT_ID}#ACTIVE`,
    GSI1SK: `CONFIG#${configType}`,
    tenantId: TENANT_ID,
    configType,
    version: VERSION,
    isActive: true,
    data: DEFAULTS[configType],
    createdAt,
  };
}

// ── Seed ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log(`\nTalentFlow Config Seed — table: ${TABLE_NAME} region: ${REGION}`);
  if (DRY_RUN) console.log('DRY RUN — no writes will be made\n');

  const client = new DynamoDBClient({ region: REGION });

  const configTypes = Object.keys(DEFAULTS);
  let seeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const configType of configTypes) {
    const item = buildItem(configType);

    if (DRY_RUN) {
      console.log(`  [DRY] Would write ${configType} v${VERSION}`);
      console.log('        Item:', JSON.stringify(item, null, 2));
      seeded++;
      continue;
    }

    try {
      await client.send(
        new PutItemCommand({
          TableName: TABLE_NAME,
          Item: marshall(item, { removeUndefinedValues: true }),
          // Idempotent: skip silently if item already exists
          ConditionExpression: 'attribute_not_exists(PK)',
        })
      );
      console.log(`  ✅  ${configType}#v${VERSION} seeded`);
      seeded++;
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        console.log(`  ⟳   ${configType}#v${VERSION} already exists — skipped`);
        skipped++;
      } else {
        console.error(`  ❌  ${configType}#v${VERSION} FAILED:`, err.message);
        failed++;
      }
    }
  }

  console.log(
    `\nDone — ${seeded} seeded, ${skipped} skipped, ${failed} failed\n`
  );

  if (failed > 0) process.exit(1);
}

seed().catch((err) => {
  console.error('Seed script fatal error:', err);
  process.exit(1);
});
