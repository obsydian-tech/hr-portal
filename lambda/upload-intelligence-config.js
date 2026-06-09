/**
 * Upload Intelligence Rules Configuration to DynamoDB
 *
 * This script creates the INTELLIGENCE_RULES config with all Epic 4 rules
 */

const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const dynamoDB = new DynamoDBClient({ region: 'af-south-1' });
const CONFIG_TABLE = 'talent-flow-config';

const intelligenceRulesConfig = {
  rules: [
    // ══════════════════════════════════════════════════════════════════
    // EPIC 3 Rules (Engagement & Stage Progression)
    // ══════════════════════════════════════════════════════════════════
    {
      id: 'RULE-COOLING-001',
      name: 'Candidate Engagement Cooling',
      description: 'Candidate showing declining engagement - potential ghosting risk',
      enabled: true,
      conditions: [
        {
          signal: 'ENGAGEMENT_TREND',
          operator: 'equals',
          value: 'FALLING',
        },
        {
          signal: 'CANDIDATE_DAYS_SINCE_RESPONSE',
          operator: 'greaterThanOrEqual',
          value: 7,
        },
      ],
      action: {
        type: 'NOTIFY_TA_ENGAGEMENT_COOLING',
        priority: 'MEDIUM',
        cooldown: 24, // hours
      },
    },
    {
      id: 'RULE-STAGE-001',
      name: 'Stalled in Stage',
      description: 'Candidate has been in current stage for extended period',
      enabled: true,
      conditions: [
        {
          signal: 'DAYS_IN_CURRENT_STAGE',
          operator: 'greaterThan',
          value: 10,
        },
      ],
      action: {
        type: 'NOTIFY_TA_STALE_CANDIDATE',
        priority: 'HIGH',
        cooldown: 48,
      },
    },

    // ══════════════════════════════════════════════════════════════════
    // EPIC 4 TASK 4.1 - Panel Rules
    // ══════════════════════════════════════════════════════════════════
    {
      id: 'RULE-PANEL-001',
      name: 'Split Panel - Document Rationale',
      description: 'Panel has strong disagreement (both STRONG_YES and STRONG_NO votes)',
      enabled: true,
      conditions: [
        {
          signal: 'PANEL_SPLIT_FLAG',
          operator: 'equals',
          value: true,
        },
      ],
      action: {
        type: 'REQUIRE_RATIONALE_DOCUMENTATION',
        priority: 'HIGH',
        cooldown: 24,
      },
    },
    {
      id: 'RULE-FEEDBACK-001',
      name: 'Panel Feedback Overdue',
      description: 'Panel members have not submitted feedback after completed interview',
      enabled: true,
      conditions: [
        {
          signal: 'PANEL_FEEDBACK_PENDING_COUNT',
          operator: 'greaterThan',
          value: 0,
        },
      ],
      action: {
        type: 'NOTIFY_HM_FEEDBACK_OVERDUE',
        priority: 'MEDIUM',
        cooldown: 12,
      },
    },

    // ══════════════════════════════════════════════════════════════════
    // EPIC 4 TASK 4.2 - Offer & Approval Rules
    // ══════════════════════════════════════════════════════════════════
    {
      id: 'RULE-APPROVAL-001',
      name: 'Approval Step Stalled',
      description: 'Offer stuck in approval workflow for extended period',
      enabled: true,
      conditions: [
        {
          signal: 'APPROVAL_STEP_AGE',
          operator: 'greaterThanOrEqual',
          value: 7,
        },
      ],
      action: {
        type: 'NOTIFY_APPROVAL_STALLED',
        priority: 'HIGH',
        cooldown: 24,
      },
    },

    // ══════════════════════════════════════════════════════════════════
    // EPIC 4 TASK 4.3 - HM Rules
    // ══════════════════════════════════════════════════════════════════
    {
      id: 'RULE-FASTTRACK-001',
      name: 'Fast-Track Recommended',
      description: 'High score + strong consensus + declining engagement = urgent decision',
      enabled: true,
      conditions: [
        {
          signal: 'FINAL_SCORE',
          operator: 'greaterThanOrEqual',
          value: 85,
        },
        {
          signal: 'PANEL_CONSENSUS',
          path: 'label', // Nested access: PANEL_CONSENSUS.label
          operator: 'equals',
          value: 'HIGH',
        },
        {
          signal: 'ENGAGEMENT_TREND',
          operator: 'equals',
          value: 'FALLING',
        },
      ],
      action: {
        type: 'RECOMMEND_FAST_TRACK',
        priority: 'CRITICAL',
        cooldown: 48,
      },
    },
    {
      id: 'RULE-HIPO-001',
      name: 'High Potential Candidate',
      description: 'Candidate shows strong performance and engagement',
      enabled: true,
      conditions: [
        {
          signal: 'FINAL_SCORE',
          operator: 'greaterThanOrEqual',
          value: 80,
        },
        {
          signal: 'ENGAGEMENT_SCORE',
          operator: 'greaterThanOrEqual',
          value: 70,
        },
      ],
      action: {
        type: 'NOTIFY_HM_HIGH_POTENTIAL',
        priority: 'MEDIUM',
        cooldown: 72,
      },
    },

    // ══════════════════════════════════════════════════════════════════
    // Risk & SLA Rules
    // ══════════════════════════════════════════════════════════════════
    {
      id: 'RULE-RISK-001',
      name: 'High Risk Candidate',
      description: 'Multiple risk factors detected - requires attention',
      enabled: true,
      conditions: [
        {
          signal: 'CANDIDATE_RISK_SCORE',
          operator: 'greaterThanOrEqual',
          value: 70,
        },
      ],
      action: {
        type: 'ALERT_TA_HIGH_RISK',
        priority: 'HIGH',
        cooldown: 24,
      },
    },
    {
      id: 'RULE-SLA-001',
      name: 'SLA Breached',
      description: 'Candidate has breached SLA threshold',
      enabled: true,
      conditions: [
        {
          signal: 'SLA_STATUS',
          operator: 'equals',
          value: 'BREACHED',
        },
      ],
      action: {
        type: 'ALERT_TA_SLA_BREACH',
        priority: 'CRITICAL',
        cooldown: 24,
      },
    },
    {
      id: 'RULE-SLA-002',
      name: 'SLA At Risk',
      description: 'Candidate approaching SLA threshold',
      enabled: true,
      conditions: [
        {
          signal: 'SLA_STATUS',
          operator: 'equals',
          value: 'AT_RISK',
        },
      ],
      action: {
        type: 'NOTIFY_TA_SLA_AT_RISK',
        priority: 'HIGH',
        cooldown: 48,
      },
    },

    // ══════════════════════════════════════════════════════════════════
    // IT Provisioning Rules
    // ══════════════════════════════════════════════════════════════════
    {
      id: 'RULE-EQUIPMENT-001',
      name: 'Equipment Not Ordered',
      description: 'Equipment request pending for onboarding candidate',
      enabled: true,
      conditions: [
        {
          signal: 'EQUIPMENT_REQUEST_STATUS',
          operator: 'in',
          value: ['NOT_ORDERED', 'PENDING'],
        },
      ],
      action: {
        type: 'NOTIFY_IT_EQUIPMENT_PENDING',
        priority: 'HIGH',
        cooldown: 24,
      },
    },
    {
      id: 'RULE-ONBOARD-001',
      name: 'Onboarding Not Ready',
      description: 'Onboarding readiness below threshold',
      enabled: true,
      conditions: [
        {
          signal: 'ONBOARDING_READINESS',
          operator: 'lessThan',
          value: 75,
        },
      ],
      action: {
        type: 'NOTIFY_IT_ONBOARDING_INCOMPLETE',
        priority: 'MEDIUM',
        cooldown: 48,
      },
    },
    {
      id: 'RULE-EVAL-001',
      name: 'Strong Evaluation Score',
      description: 'Candidate achieved strong evaluation performance',
      enabled: true,
      conditions: [
        {
          signal: 'FINAL_SCORE',
          operator: 'greaterThanOrEqual',
          value: 80,
        },
      ],
      action: {
        type: 'NOTIFY_HM_STRONG_SCORE',
        priority: 'MEDIUM',
        cooldown: 72,
      },
    },
  ],
  thresholds: {
    OFFER_EXPIRY_URGENT: 3,
    FINAL_SCORE_HIGH: 85,
    DAYS_STALE: 14,
    offerExpiryWarning: 7,
    equipmentLeadTime: 14,
    riskScoreHigh: 70,
    daysInStageCritical: 14,
    engagementLow: 40,
    daysInStageWarning: 7,
    slaBreachDays: 14,
    slaAtRiskDays: 10,
    onboardingReadinessMin: 60,
    offerExpiryUrgent: 3,
  },
};

async function uploadConfig() {
  try {
    const item = marshall({
      PK: 'TENANT#NALEKO',
      SK: 'CONFIG#INTELLIGENCE_RULES',
      configType: 'INTELLIGENCE_RULES',
      data: intelligenceRulesConfig,
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      updatedBy: 'SYSTEM',
    });

    await dynamoDB.send(new PutItemCommand({
      TableName: CONFIG_TABLE,
      Item: item,
    }));

    console.log('✅ Intelligence rules config uploaded successfully!');
    console.log(`📊 Total rules: ${intelligenceRulesConfig.rules.length}`);
    console.log('Rules uploaded:');
    intelligenceRulesConfig.rules.forEach(rule => {
      console.log(`  - ${rule.id}: ${rule.name} (${rule.enabled ? 'enabled' : 'disabled'})`);
    });
  } catch (error) {
    console.error('❌ Failed to upload config:', error);
    process.exit(1);
  }
}

uploadConfig();
