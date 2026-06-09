/**
 * Seed Intelligence Rules - EPIC 2
 *
 * Idempotent script to populate canonical rule set into talent-flow-config
 *
 * Usage: node seed-intelligence-rules.js <tenantId>
 * Example: node seed-intelligence-rules.js NALEKO
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'af-south-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const CONFIG_TABLE_NAME = process.env.CONFIG_TABLE_NAME || 'talent-flow-config';

/**
 * Canonical Rule Set - EPIC 2 TASK 2.1
 *
 * All rules use ONLY the 19 implemented signals from EPIC 0:
 * - CANDIDATE_STAGE, HM_DAYS_SINCE_LOGIN, OFFER_DAYS_TO_EXPIRY
 * - TA_DAYS_SINCE_CANDIDATE_ACTION, DAYS_SINCE_CANDIDATE_CREATED
 * - DAYS_IN_CURRENT_STAGE, SLA_STATUS, DAYS_SINCE_SLA_BREACH
 * - ENGAGEMENT_SCORE, ENGAGEMENT_SENTIMENT, INTERVIEW_SENTIMENT
 * - FINAL_SCORE, EVALUATION_RESULT, CANDIDATE_RISK_SCORE
 * - ONBOARDING_READINESS, DAYS_TO_START_DATE
 * - EQUIPMENT_REQUEST_STATUS, ACCESS_PROVISIONED
 */
const CANONICAL_RULES = [
  // === 1. SLA Breached (CRITICAL, Compliance) ===
  {
    id: 'RULE-SLA-001',
    name: 'SLA Breached - Immediate Action Required',
    enabled: true,
    severity: 'CRITICAL',
    category: 'Compliance',
    targetRoles: ['TA', 'HM'],
    description: 'Candidate has breached SLA threshold and requires immediate attention to maintain compliance.',
    conditions: [
      {
        signal: 'SLA_STATUS',
        operator: 'equals',
        value: 'BREACHED'
      }
    ],
    action: {
      type: 'NOTIFY_SLA_BREACH',
      cooldown: 0  // Compliance rules have no cooldown - fire every time
    }
  },

  // === 2. SLA At-Risk (HIGH, Compliance) ===
  {
    id: 'RULE-SLA-002',
    name: 'SLA At Risk - Proactive Intervention',
    enabled: true,
    severity: 'HIGH',
    category: 'Compliance',
    targetRoles: ['TA'],
    description: 'Candidate approaching SLA breach threshold. Proactive action can prevent breach.',
    conditions: [
      {
        signal: 'SLA_STATUS',
        operator: 'equals',
        value: 'AT_RISK'
      },
      {
        signal: 'DAYS_IN_CURRENT_STAGE',
        operator: 'greaterThan',
        value: 5
      }
    ],
    action: {
      type: 'NOTIFY_SLA_AT_RISK',
      cooldown: 24  // Once per day to avoid spam
    }
  },

  // === 3. High Risk Candidate (HIGH, Candidate Lifecycle) ===
  {
    id: 'RULE-RISK-001',
    name: 'High Risk Candidate - Review Required',
    enabled: true,
    severity: 'HIGH',
    category: 'Candidate Lifecycle',
    targetRoles: ['TA', 'HM'],
    description: 'Composite risk score indicates high likelihood of drop-off or process failure.',
    conditions: [
      {
        signal: 'CANDIDATE_RISK_SCORE',
        operator: 'greaterThanOrEqual',
        value: 70
      },
      {
        signal: 'CANDIDATE_STAGE',
        operator: 'in',
        value: ['TECHNICAL_INTERVIEW', 'HM_REVIEW', 'OFFER']
      }
    ],
    action: {
      type: 'NOTIFY_HIGH_RISK_CANDIDATE',
      cooldown: 48  // Check every 2 days
    }
  },

  // === 4. Stalled in Stage (MEDIUM, Candidate Lifecycle) ===
  {
    id: 'RULE-STAGE-001',
    name: 'Candidate Stalled in Stage',
    enabled: true,
    severity: 'MEDIUM',
    category: 'Candidate Lifecycle',
    targetRoles: ['TA', 'HM'],
    description: 'Candidate has been in current stage longer than expected. Process may be bottlenecked.',
    conditions: [
      {
        signal: 'DAYS_IN_CURRENT_STAGE',
        operator: 'greaterThan',
        value: 10
      },
      {
        signal: 'CANDIDATE_STAGE',
        operator: 'notIn',
        value: ['OFFER', 'ACCEPTED', 'ONBOARDING']
      }
    ],
    action: {
      type: 'NOTIFY_STAGE_STALLED',
      cooldown: 72  // Check every 3 days
    }
  },

  // === 5. Equipment Not Ordered (HIGH, IT Provisioning) ===
  {
    id: 'RULE-EQUIPMENT-001',
    name: 'Equipment Not Ordered - Start Date Approaching',
    enabled: true,
    severity: 'HIGH',
    category: 'IT Provisioning',
    targetRoles: ['IT', 'HM'],
    description: 'Equipment request is pending or not started with start date within 2 weeks.',
    conditions: [
      {
        signal: 'EQUIPMENT_REQUEST_STATUS',
        operator: 'in',
        value: ['PENDING', 'NOT_STARTED']
      },
      {
        signal: 'DAYS_TO_START_DATE',
        operator: 'lessThanOrEqual',
        value: 14
      }
    ],
    action: {
      type: 'NOTIFY_EQUIPMENT_URGENT',
      cooldown: 24  // Daily reminder
    }
  },

  // === 6. Onboarding Prep Needed (MEDIUM, IT Provisioning) ===
  {
    id: 'RULE-ONBOARD-001',
    name: 'Onboarding Preparation Incomplete',
    enabled: true,
    severity: 'MEDIUM',
    category: 'IT Provisioning',
    targetRoles: ['IT', 'HM'],
    description: 'Onboarding readiness score is low with start date approaching.',
    conditions: [
      {
        signal: 'ONBOARDING_READINESS',
        operator: 'lessThan',
        value: 50
      },
      {
        signal: 'DAYS_TO_START_DATE',
        operator: 'lessThanOrEqual',
        value: 7
      },
      {
        signal: 'CANDIDATE_STAGE',
        operator: 'in',
        value: ['ACCEPTED', 'ONBOARDING']
      }
    ],
    action: {
      type: 'NOTIFY_ONBOARDING_PREP_NEEDED',
      cooldown: 24  // Daily check
    }
  },

  // === 7. Strong Candidate Ready (INFO, HM Engagement) ===
  {
    id: 'RULE-EVAL-001',
    name: 'Strong Candidate Ready for Next Stage',
    enabled: true,
    severity: 'INFO',
    category: 'HM Engagement',
    targetRoles: ['HM', 'TA'],
    description: 'High-performing candidate ready to advance based on evaluation results.',
    conditions: [
      {
        signal: 'FINAL_SCORE',
        operator: 'greaterThanOrEqual',
        value: 80
      },
      {
        signal: 'EVALUATION_RESULT',
        operator: 'equals',
        value: 'STRONG_HIRE'
      },
      {
        signal: 'CANDIDATE_STAGE',
        operator: 'in',
        value: ['TECHNICAL_INTERVIEW', 'HM_REVIEW']
      }
    ],
    action: {
      type: 'NOTIFY_STRONG_CANDIDATE_READY',
      cooldown: 48  // Check every 2 days
    }
  },

  // === 8. HiPo Engagement Falling (HIGH, HM Engagement) ===
  {
    id: 'RULE-HIPO-001',
    name: 'High-Potential Candidate Disengaging',
    enabled: true,
    severity: 'HIGH',
    category: 'HM Engagement',
    targetRoles: ['TA', 'HM'],
    description: 'High-scoring candidate showing declining engagement. Risk of losing top talent.',
    conditions: [
      {
        signal: 'FINAL_SCORE',
        operator: 'greaterThanOrEqual',
        value: 75
      },
      {
        signal: 'ENGAGEMENT_SCORE',
        operator: 'lessThan',
        value: 50
      },
      {
        signal: 'ENGAGEMENT_SENTIMENT',
        operator: 'equals',
        value: 'NEGATIVE'
      }
    ],
    action: {
      type: 'NOTIFY_HIPO_DISENGAGING',
      cooldown: 24  // Daily monitoring
    }
  }
];

/**
 * Default thresholds (from EPIC 1 TASK 1.3)
 * These coexist with rules in the config
 */
const DEFAULT_THRESHOLDS = {
  slaBreachDays: 14,
  slaAtRiskDays: 10,
  offerExpiryUrgent: 3,
  offerExpiryWarning: 7,
  engagementLow: 40,
  riskScoreHigh: 70,
  daysInStageWarning: 7,
  daysInStageCritical: 14,
  equipmentLeadTime: 14,
  onboardingReadinessMin: 60
};

/**
 * Seed the intelligence rules configuration
 * Idempotent - can be run multiple times safely
 */
async function seedIntelligenceRules(tenantId) {
  if (!tenantId) {
    throw new Error('tenantId is required. Usage: node seed-intelligence-rules.js <tenantId>');
  }

  console.log(`[seed-intelligence-rules] Starting seed for tenant: ${tenantId}`);

  const configKey = {
    PK: `TENANT#${tenantId}`,
    SK: 'CONFIG#INTELLIGENCE_RULES#v1'
  };

  // Check if config already exists
  const existingConfig = await docClient.send(new GetCommand({
    TableName: CONFIG_TABLE_NAME,
    Key: configKey
  }));

  if (existingConfig.Item) {
    console.log(`[seed-intelligence-rules] ⚠️  Config already exists. Updating...`);
    console.log(`[seed-intelligence-rules] Existing rules count: ${existingConfig.Item.data?.rules?.length || 0}`);
  }

  // Merge with existing thresholds if present
  const thresholds = {
    ...DEFAULT_THRESHOLDS,
    ...(existingConfig.Item?.thresholds || {})
  };

  // Prepare config item with GSI attributes for active-config lookups
  const configItem = {
    ...configKey,
    // GSI1 attributes for active-config queries (used by evaluateIntelligenceRules)
    GSI1PK: `TENANT#${tenantId}#ACTIVE`,
    GSI1SK: 'CONFIG#INTELLIGENCE_RULES',
    // Config data (nested in 'data' attribute per config-reader convention)
    data: {
      rules: CANONICAL_RULES,
      thresholds
    },
    version: '1.0.0',
    seededAt: new Date().toISOString(),
    seededBy: 'seed-intelligence-rules.js (EPIC 2 TASK 2.2)'
  };

  // Write to DynamoDB
  await docClient.send(new PutCommand({
    TableName: CONFIG_TABLE_NAME,
    Item: configItem
  }));

  console.log(`[seed-intelligence-rules] ✅ Successfully seeded ${CANONICAL_RULES.length} rules`);
  console.log(`[seed-intelligence-rules] Rule IDs: ${CANONICAL_RULES.map(r => r.id).join(', ')}`);
  console.log(`[seed-intelligence-rules] Thresholds: ${Object.keys(thresholds).length} keys`);
  console.log(`[seed-intelligence-rules] Config key: PK=${configKey.PK}, SK=${configKey.SK}`);

  return {
    success: true,
    rulesCount: CANONICAL_RULES.length,
    thresholdsCount: Object.keys(thresholds).length,
    configKey
  };
}

// CLI execution
if (require.main === module) {
  const tenantId = process.argv[2];

  seedIntelligenceRules(tenantId)
    .then(result => {
      console.log('\n✅ Seed complete:', result);
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Seed failed:', error.message);
      console.error(error.stack);
      process.exit(1);
    });
}

module.exports = { seedIntelligenceRules, CANONICAL_RULES, DEFAULT_THRESHOLDS };
