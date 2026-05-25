#!/usr/bin/env node
/**
 * seed-admin-s2-config.js — Admin-S2
 *
 * Seeds 4 new configTypes introduced in Admin-S2:
 *   SENTIMENT_SCALES, IT_QUEUES, PROVISIONING_TEMPLATES, ROUTING_RULES
 *
 * Safety: uses condition_expression to skip existing items.
 *
 * Usage:
 *   node scripts/seed-admin-s2-config.js [--dry-run] [--region af-south-1]
 *
 * Required env:
 *   CONFIG_TABLE_NAME  — DynamoDB table name (falls back to 'talent-flow-config')
 */

import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const regionArg  = (() => { const idx = args.indexOf('--region'); return idx !== -1 ? args[idx + 1] : null; })();

const REGION     = process.env.AWS_REGION     || regionArg || 'af-south-1';
const TABLE_NAME = process.env.CONFIG_TABLE_NAME || 'talent-flow-config';
const TENANT_ID  = 'DEFAULT';
const VERSION    = 1;

// ── Seed data ─────────────────────────────────────────────────────────────────

const DEFAULTS = {

  SENTIMENT_SCALES: {
    scales: [
      { key: 'VERY_INTERESTED', label: 'Very Interested', score: 5, escalate: false, escalationPath: 'NONE'            },
      { key: 'INTERESTED',      label: 'Interested',       score: 4, escalate: false, escalationPath: 'NONE'            },
      { key: 'NEUTRAL',         label: 'Neutral',          score: 3, escalate: false, escalationPath: 'NONE'            },
      { key: 'HESITANT',        label: 'Hesitant',         score: 2, escalate: true,  escalationPath: 'TA_REVIEW'       },
      { key: 'DISENGAGED',      label: 'Disengaged',       score: 1, escalate: true,  escalationPath: 'URGENT_REENGAGE' },
    ],
  },

  IT_QUEUES: {
    queues: [
      {
        id:                   'q-hardware-001',
        name:                 'Hardware Setup',
        description:          'Laptop, monitors, peripherals and docking stations',
        category:             'HARDWARE',
        slaHours:             48,
        assignedSpecialists:  [],
        active:               true,
      },
      {
        id:                   'q-software-001',
        name:                 'Software Provisioning',
        description:          'License allocation and software installation',
        category:             'SOFTWARE',
        slaHours:             24,
        assignedSpecialists:  [],
        active:               true,
      },
      {
        id:                   'q-access-001',
        name:                 'Access & Permissions',
        description:          'Active Directory, VPN, cloud IAM and application access',
        category:             'ACCESS',
        slaHours:             8,
        assignedSpecialists:  [],
        active:               true,
      },
      {
        id:                   'q-infra-001',
        name:                 'Infrastructure',
        description:          'Network setup, server access and infra provisioning',
        category:             'INFRA',
        slaHours:             72,
        assignedSpecialists:  [],
        active:               true,
      },
    ],
  },

  PROVISIONING_TEMPLATES: {
    templates: [
      {
        id:           'tpl-engineer-001',
        name:         'Software Engineer Bundle',
        description:  'Standard bundle for software engineering hires',
        targetRole:   'Software Engineer',
        requirements: [
          { itemName: 'MacBook Pro 14"',     category: 'HARDWARE',    optional: false },
          { itemName: 'External Monitor',    category: 'HARDWARE',    optional: true  },
          { itemName: 'GitHub Enterprise',   category: 'SOFTWARE',    optional: false },
          { itemName: 'JetBrains Toolbox',   category: 'SOFTWARE',    optional: true  },
          { itemName: 'AWS Console Access',  category: 'ACCESS',      optional: false },
          { itemName: 'VPN Account',         category: 'ACCESS',      optional: false },
        ],
        active: true,
      },
      {
        id:           'tpl-ops-001',
        name:         'Operations Bundle',
        description:  'Standard bundle for operations and admin staff',
        targetRole:   'Operations',
        requirements: [
          { itemName: 'MacBook Air 13"',     category: 'HARDWARE',    optional: false },
          { itemName: 'Microsoft 365',       category: 'SOFTWARE',    optional: false },
          { itemName: 'Slack Access',        category: 'ACCESS',      optional: false },
        ],
        active: true,
      },
    ],
  },

  ROUTING_RULES: {
    rules: [
      { id: 'rr-001', conditionField: 'department', conditionValue: 'Engineering',   targetQueueId: 'q-hardware-001', priority: 10 },
      { id: 'rr-002', conditionField: 'department', conditionValue: 'Operations',    targetQueueId: 'q-software-001', priority: 20 },
      { id: 'rr-003', conditionField: 'role',        conditionValue: 'Developer',    targetQueueId: 'q-hardware-001', priority: 30 },
      { id: 'rr-004', conditionField: 'seniority',   conditionValue: 'SENIOR',       targetQueueId: 'q-infra-001',    priority: 40 },
    ],
  },

};

// ── Build DynamoDB item ───────────────────────────────────────────────────────

function buildItem(configType) {
  const createdAt = new Date().toISOString();
  return {
    PK:       `TENANT#${TENANT_ID}`,
    SK:       `CONFIG#${configType}#v${VERSION}`,
    GSI1PK:   `TENANT#${TENANT_ID}#ACTIVE`,
    GSI1SK:   `CONFIG#${configType}`,
    tenantId: TENANT_ID,
    configType,
    version:  VERSION,
    isActive: true,
    data:     DEFAULTS[configType],
    createdAt,
  };
}

// ── Seed ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log(`\nAdmin-S2 Config Seed — table: ${TABLE_NAME} region: ${REGION}`);
  if (DRY_RUN) console.log('DRY RUN — no writes will be made\n');

  const client = new DynamoDBClient({ region: REGION });
  const configTypes = Object.keys(DEFAULTS);
  let seeded = 0, skipped = 0, failed = 0;

  for (const configType of configTypes) {
    const item = buildItem(configType);

    if (DRY_RUN) {
      console.log(`  [DRY] Would write ${configType} v${VERSION}`);
      seeded++;
      continue;
    }

    try {
      await client.send(new PutItemCommand({
        TableName: TABLE_NAME,
        Item: marshall(item, { removeUndefinedValues: true }),
        ConditionExpression: 'attribute_not_exists(PK)',
      }));
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

  console.log(`\nDone — ${seeded} seeded, ${skipped} skipped, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

seed().catch((err) => {
  console.error('Seed script fatal error:', err);
  process.exit(1);
});
