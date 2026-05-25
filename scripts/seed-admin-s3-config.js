#!/usr/bin/env node
/**
 * seed-admin-s3-config.js
 *
 * Seed script for Admin-S3 Tenant Settings default configs.
 * Usage: node scripts/seed-admin-s3-config.js [--env staging|prod]
 *
 * Requires: AWS credentials with PutItem on the TalentFlow config DynamoDB table.
 */

const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

// ── Config ────────────────────────────────────────────────────────────────────

const REGION             = process.env.AWS_REGION || 'af-south-1';
const TABLE_NAME         = process.env.CONFIG_TABLE || 'naleko-dev-talentflow-config';
const TENANT_ID          = process.env.TENANT_ID   || 'naleko-default';

const client = new DynamoDBClient({ region: REGION });

// ── Default payloads ──────────────────────────────────────────────────────────

const SENIORITY_DEFINITIONS = {
  levels: [
    { key: 'JUNIOR', label: 'Junior', description: 'Graduate · Entry level · Early career',       experienceGuide: '0–3 years', colour: '#2e7d32' },
    { key: 'MID',    label: 'Mid',    description: 'Professional · Specialist · Independent',      experienceGuide: '3–7 years', colour: '#1565c0' },
    { key: 'SENIOR', label: 'Senior', description: 'Manager · Director · Executive · Lead',        experienceGuide: '7+ years',  colour: '#4a3f8a' },
  ],
};

const WORKFLOW_TEMPLATES = {
  templates: [
    {
      templateId: 'tpl-standard-001',
      name: 'Standard',
      description: 'Standard hiring workflow for most roles',
      isDefault: true,
      isActive: true,
      stages: ['Interview', 'Offer', 'Background Check', 'IT Setup'],
      createdAt: new Date().toISOString(),
      createdBy: 'system',
    },
    {
      templateId: 'tpl-govt-001',
      name: 'Government',
      description: 'Extended workflow for government positions',
      isDefault: false,
      isActive: true,
      stages: ['Interview', 'Offer', 'Background', 'Character', 'Medical', 'Security Clearance', 'IT Setup'],
      createdAt: new Date().toISOString(),
      createdBy: 'system',
    },
    {
      templateId: 'tpl-banking-001',
      name: 'Banking',
      description: 'Regulatory workflow for banking sector roles',
      isDefault: false,
      isActive: true,
      stages: ['Interview', 'Offer', 'Background', 'Financial Check', 'Regulatory Approval', 'IT Setup'],
      createdAt: new Date().toISOString(),
      createdBy: 'system',
    },
  ],
};

const APPROVAL_CHAINS = {
  chains: [
    {
      seniority: 'JUNIOR',
      offerApprovalChain: [
        { order: 1, role: 'TA', label: 'TA Specialist',  isRequired: true },
        { order: 2, role: 'HM', label: 'Hiring Manager', isRequired: true },
      ],
      provisioningApprovalChain: [
        { order: 1, role: 'HM', label: 'Hiring Manager', isRequired: true },
      ],
    },
    {
      seniority: 'MID',
      offerApprovalChain: [
        { order: 1, role: 'TA', label: 'TA Specialist',  isRequired: true },
        { order: 2, role: 'HM', label: 'Hiring Manager', isRequired: true },
      ],
      provisioningApprovalChain: [
        { order: 1, role: 'HM', label: 'Hiring Manager', isRequired: true },
      ],
    },
    {
      seniority: 'SENIOR',
      offerApprovalChain: [
        { order: 1, role: 'TA',          label: 'TA Specialist',  isRequired: true },
        { order: 2, role: 'HM',          label: 'Hiring Manager', isRequired: true },
        { order: 3, role: 'HR_DIRECTOR', label: 'HR Director',    isRequired: true },
      ],
      provisioningApprovalChain: [
        { order: 1, role: 'HM',          label: 'Hiring Manager', isRequired: true },
        { order: 2, role: 'HR_DIRECTOR', label: 'HR Director',    isRequired: true },
      ],
    },
  ],
};

const LOCALE_SETTINGS = {
  timezone:       'Africa/Johannesburg',
  dateFormat:     'DD MMM YYYY',
  currency:       'ZAR',
  currencySymbol: 'R',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildItem(configType, data) {
  return {
    pk:         { S: `TENANT#${TENANT_ID}` },
    sk:         { S: `CONFIG#${configType}` },
    configType: { S: configType },
    tenantId:   { S: TENANT_ID },
    version:    { S: '1' },
    isActive:   { BOOL: true },
    data:       { S: JSON.stringify(data) },
    createdAt:  { S: new Date().toISOString() },
    updatedAt:  { S: new Date().toISOString() },
  };
}

async function seedConfig(configType, data) {
  const item = buildItem(configType, data);
  const command = new PutItemCommand({
    TableName:           TABLE_NAME,
    Item:                item,
    ConditionExpression: 'attribute_not_exists(pk)', // skip if already exists
  });

  try {
    await client.send(command);
    console.log(`✅ Seeded ${configType}`);
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.log(`⏭  ${configType} already exists — skipped`);
    } else {
      console.error(`❌ Failed to seed ${configType}: ${err.message}`);
    }
  }
}

// ── Execute ───────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\nSeeding Admin-S3 configs → ${TABLE_NAME} (tenant: ${TENANT_ID})\n`);

  await seedConfig('SENIORITY_DEFINITIONS', SENIORITY_DEFINITIONS);
  await seedConfig('WORKFLOW_TEMPLATES',    WORKFLOW_TEMPLATES);
  await seedConfig('APPROVAL_CHAINS',       APPROVAL_CHAINS);
  await seedConfig('LOCALE_SETTINGS',       LOCALE_SETTINGS);

  console.log('\nDone.\n');
})();
