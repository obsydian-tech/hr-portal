# Intelligence Layer - Implementation Plan

**Based on:** INTELLIGENCE-LAYER-INVESTIGATION.md
**Architecture:** Follows existing TalentFlow multi-tenant metadata patterns
**Date Created:** 2026-06-08
**Status:** READY FOR IMPLEMENTATION

---

## Executive Summary

This implementation follows **discovered TalentFlow patterns** from the investigation. The Intelligence Layer will:

✅ **Reuse existing `talent-flow-config` table** (no new config table)
✅ **Reuse existing `manageTalentFlowConfig` Lambda** (no new CRUD API)
✅ **Reuse existing `config-reader.js`** (no new config loader)
✅ **Reuse existing Admin UI patterns** (consistent with scoring weights, SLA thresholds)
✅ **Support per-tenant configurable rules** (like Salesforce validation rules)

**Your "30 days" requirement** = configurable threshold in metadata, changeable via Admin UI without code deployment.

---

## Key Architectural Decisions

### ✅ Decision 1: Config Storage Pattern

**Use existing `talent-flow-config` table:**
```
PK: TENANT#{tenantId}                    # e.g., TENANT#NALEKO
SK: CONFIG#INTELLIGENCE_RULES#v{version}  # e.g., CONFIG#INTELLIGENCE_RULES#v1
GSI1PK: TENANT#{tenantId}#ACTIVE         # Sparse index for active version
GSI1SK: CONFIG#INTELLIGENCE_RULES
```

**Example record (YOUR "30 days" requirement):**
```json
{
  "PK": "TENANT#NALEKO",
  "SK": "CONFIG#INTELLIGENCE_RULES#v1",
  "GSI1PK": "TENANT#NALEKO#ACTIVE",
  "GSI1SK": "CONFIG#INTELLIGENCE_RULES",
  "tenantId": "NALEKO",
  "configType": "INTELLIGENCE_RULES",
  "version": 1,
  "isActive": true,
  "data": {
    "rules": [
      {
        "id": "RULE-001",
        "name": "Expiring Offer with Inactive HM",
        "enabled": true,
        "conditions": [
          {
            "signal": "OFFER_DAYS_TO_EXPIRY",
            "operator": "lessThan",
            "value": 30
          }
        ],
        "action": {
          "type": "NUDGE_HM_REVIEW_OFFER",
          "cooldownHours": 24
        }
      }
    ]
  },
  "createdAt": "2026-06-08T00:00:00Z"
}
```

**Rationale:**
- Consistent with existing 9+ config types in same table
- Reuses versioning strategy (365-day TTL on inactive versions)
- Reuses IAM permissions, KMS encryption, PITR backup
- **Rejected alternative:** Separate table (violates metadata-lite principle)

---

### ✅ Decision 2: No Version Locking

**Intelligence Layer configs are NOT version-locked to candidates**

**Rationale:**
- Intelligence Layer is **advisory** (proactive insights), not **compliance-critical** (scoring decisions)
- Admin should see immediate effect when changing threshold (30 days → 14 days)
- Unlike scoring weights (must never change retroactively per POPIA), notification rules can evolve

**Implementation:**
- Always read active config: `getConfig(tenantId, 'INTELLIGENCE_RULES')` (no version parameter)
- No `intelligenceConfigVersion` on SAGA record
- Simpler than orchestrateTalentFlowWorkflow pattern

---

### ✅ Decision 3: Tenant Context from Candidate Record

**Extract `tenantId` from candidate in DynamoDB Stream:**
```javascript
const candidate = unmarshall(record.dynamodb.NewImage);
const { candidateId, tenantId } = candidate;  // Always present

// Load tenant-specific rules
const config = await getConfig(tenantId, 'INTELLIGENCE_RULES');
```

**Rationale:**
- Consistent with existing Lambdas (orchestrateTalentFlowWorkflow, submitVote)
- No separate tenant lookup needed
- Natural multi-tenant isolation

---

### ✅ Decision 4: Fail-Open Error Handling

**Skip evaluation on errors, don't crash:**
```javascript
try {
  intelligenceConfig = await getConfig(tenantId, 'INTELLIGENCE_RULES');
} catch (err) {
  console.warn('[evaluateIntelligenceRules] Config read failed — skipping');
  return; // Skip, don't crash candidate workflow
}
```

**Rationale:**
- Intelligence Layer is proactive insights, not workflow blocker
- Better to skip notification than crash
- Follows pattern in getItTasks.js (fail-open for non-critical features)

---

## Implementation Phases

### Phase 1: Backend Configuration (2 days)

**Goal:** Enable Intelligence Layer config storage without new infrastructure

#### Task 1.1: Update config-reader.js
**File:** `lambda/shared/config-reader.js`

Add to `getDefaults()` function:
```javascript
INTELLIGENCE_RULES: {
  rules: []  // Empty = no notifications (safe default)
}
```

**Test:**
```javascript
const config = await getConfig('NALEKO', 'INTELLIGENCE_RULES');
console.log(config); // Should return { rules: [] }
```

**Deliverable:** ✅ config-reader.js supports INTELLIGENCE_RULES

---

#### Task 1.2: Test Existing manageTalentFlowConfig API
**Goal:** Verify no code changes needed for Intelligence Layer configs

**Test via curl:**
```bash
# Create initial config
curl -X POST https://api.talentflow.naleko.ai/v1/config \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "NALEKO",
    "configType": "INTELLIGENCE_RULES",
    "data": {
      "rules": [{
        "id": "RULE-001",
        "name": "Test Rule",
        "enabled": true,
        "conditions": [{
          "signal": "OFFER_DAYS_TO_EXPIRY",
          "operator": "lessThan",
          "value": 30
        }],
        "action": {
          "type": "NUDGE_HM_REVIEW_OFFER",
          "cooldownHours": 24
        }
      }]
    }
  }'

# Read active config
curl "https://api.talentflow.naleko.ai/v1/config?configType=INTELLIGENCE_RULES&active=true&tenantId=NALEKO" \
  -H "Authorization: Bearer $JWT_TOKEN"

# Update (creates v2, deactivates v1 with TTL)
curl -X PUT https://api.talentflow.naleko.ai/v1/config \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "NALEKO",
    "configType": "INTELLIGENCE_RULES",
    "data": {
      "rules": [{
        "id": "RULE-001",
        "conditions": [{
          "signal": "OFFER_DAYS_TO_EXPIRY",
          "operator": "lessThan",
          "value": 14
        }],
        ...
      }]
    }
  }'
```

**Deliverable:** ✅ manageTalentFlowConfig works with INTELLIGENCE_RULES (no code changes!)

---

### Phase 2: Admin UI (3 days)

**Goal:** Enable admins to configure rules via UI

#### Task 2.1: Add TypeScript Types
**File:** `hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts`

```typescript
// Add to ConfigType union
export type ConfigType =
  | 'SCORING_WEIGHTS'
  | 'SLA_THRESHOLDS'
  | /* ... existing ... */
  | 'INTELLIGENCE_RULES';  // ← Add this

// New interfaces
export interface IntelligenceRulesConfig {
  rules: IntelligenceRule[];
}

export interface IntelligenceRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  conditions: RuleCondition[];
  action: RuleAction;
}

export interface RuleCondition {
  signal: string;  // "OFFER_DAYS_TO_EXPIRY"
  operator: 'equals' | 'notEquals' | 'greaterThan' | 'lessThan' |
            'greaterThanOrEqual' | 'lessThanOrEqual' | 'in' | 'notIn';
  value: number | string | string[];  // 30 ← YOUR EXAMPLE
}

export interface RuleAction {
  type: string;  // "NUDGE_HM_REVIEW_OFFER"
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  cooldownHours: number;  // 24
}
```

**Deliverable:** ✅ TypeScript types available

---

#### Task 2.2: Create Admin Component
**File:** `hr-portal/src/app/features/talent-flow/pages/admin/talentflow-config/intelligence-rules/admin-intelligence-rules.component.ts`

**Follow EXACT pattern from existing admin components** (scoring-weights, sla-thresholds, panel-rules):

```typescript
@Component({
  selector: 'tf-admin-intelligence-rules',
  standalone: true,
  imports: [
    FormsModule,
    InputNumberModule,
    DropdownModule,
    ToggleButtonModule,
    ConfigVersionBadgeComponent  // ← Reuse existing
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminIntelligenceRulesComponent implements OnInit {
  private readonly api            = inject(TalentFlowApiService);
  private readonly messageService = inject(MessageService);
  private readonly confirmService = inject(ConfirmationService);

  readonly loading       = signal(true);
  readonly saving        = signal(false);
  readonly rules         = signal<IntelligenceRule[]>([]);
  readonly configVersion = signal<string | null>(null);
  readonly updatedAt     = signal<string | null>(null);

  ngOnInit(): void {
    this.loadConfig();
  }

  private loadConfig(): void {
    this.loading.set(true);
    this.api.getConfig('INTELLIGENCE_RULES').subscribe({
      next: (cfg: ConfigResponse) => {
        const data = cfg.data as IntelligenceRulesConfig;
        this.rules.set(data.rules || []);
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); }
    });
  }

  confirmSave(): void {
    if (this.saving()) return;
    this.confirmService.confirm({
      message: 'Save Intelligence rules? Changes take effect immediately.',
      header: 'Save Rules',
      icon: 'pi pi-exclamation-triangle',
      accept: () => this.doSave()
    });
  }

  private doSave(): void {
    this.saving.set(true);
    const payload: IntelligenceRulesConfig = { rules: this.rules() };

    this.api.updateConfig('INTELLIGENCE_RULES', payload).subscribe({
      next: (cfg: ConfigResponse) => {
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        this.messageService.add({
          severity: 'success',
          summary: 'Saved',
          detail: `Intelligence rules saved as version ${cfg.version}.`,
          life: 4000
        });
      },
      error: (err: { userMessage?: string }) => {
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Save Failed',
          detail: err.userMessage ?? 'Could not save rules.',
          life: 5000
        });
      }
    });
  }
}
```

**Template patterns to follow:**
- Use same SCSS classes as scoring-weights component
- PrimeNG components: InputNumber, Dropdown, ToggleButton
- ConfigVersionBadgeComponent for version display
- Confirm dialog before save (ConfirmationService)
- Toast notifications on save (MessageService)

**Deliverable:** ✅ Admin component functional

---

#### Task 2.3: Add Route and Navigation
**Route:**
```typescript
{
  path: 'platform/talentflow/admin/talentflow/intelligence-rules',
  component: AdminIntelligenceRulesComponent,
  canActivate: [authGuard, adminGuard]
}
```

**Navigation link:**
```html
<a routerLink="/platform/talentflow/admin/talentflow/intelligence-rules">
  <i class="pi pi-bolt"></i>
  <span>Intelligence Rules</span>
</a>
```

**Deliverable:** ✅ Admin can navigate to and use rules UI

---

### Phase 3: Signal Calculation Framework (3 days)

**Goal:** Calculate candidate signals for rule evaluation

#### Task 3.1: Create Signal Calculator Module
**File:** `lambda/evaluateIntelligenceRules/signal-calculator.js`

```javascript
const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');

const USER_ACTIONS_TABLE = process.env.USER_ACTIONS_TABLE;
const client = new DynamoDBClient({ region: process.env.AWS_REGION });

async function calculateSignals(candidate) {
  const signals = {};

  // Direct signals from candidate record
  signals.CANDIDATE_STAGE = candidate.currentStage;
  signals.CANDIDATE_STATUS = candidate.status;

  // Offer expiry signal
  if (candidate.offerExpiryDate) {
    const expiryDate = new Date(candidate.offerExpiryDate);
    const now = new Date();
    const diffDays = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
    signals.OFFER_DAYS_TO_EXPIRY = diffDays;
  }

  // SLA breach signal
  if (candidate.currentStageStartedAt) {
    const stageStarted = new Date(candidate.currentStageStartedAt);
    const now = new Date();
    const diffHours = (now - stageStarted) / (1000 * 60 * 60);

    // Get SLA threshold from config
    const { getConfig } = require('/opt/config-reader');
    const slaConfig = await getConfig(candidate.tenantId, 'SLA_THRESHOLDS');
    const threshold = slaConfig[candidate.currentStage];

    if (threshold) {
      signals.SLA_BREACH_HOURS = Math.max(0, diffHours - threshold);
    }
  }

  // Days in current stage
  if (candidate.currentStageStartedAt) {
    const stageStarted = new Date(candidate.currentStageStartedAt);
    const now = new Date();
    const diffDays = Math.floor((now - stageStarted) / (1000 * 60 * 60 * 24));
    signals.DAYS_IN_CURRENT_STAGE = diffDays;
  }

  // HM days since login
  if (candidate.hiringManagerId) {
    try {
      const hmLastLogin = await getUserLastLogin(candidate.hiringManagerId);
      if (hmLastLogin) {
        const diffDays = Math.floor((Date.now() - new Date(hmLastLogin)) / (1000 * 60 * 60 * 24));
        signals.HM_DAYS_SINCE_LOGIN = diffDays;
      }
    } catch (err) {
      console.warn('Failed to calculate HM_DAYS_SINCE_LOGIN:', err.message);
    }
  }

  // TA days since login
  if (candidate.assignedRecruiterId) {
    try {
      const taLastLogin = await getUserLastLogin(candidate.assignedRecruiterId);
      if (taLastLogin) {
        const diffDays = Math.floor((Date.now() - new Date(taLastLogin)) / (1000 * 60 * 60 * 24));
        signals.TA_DAYS_SINCE_LOGIN = diffDays;
      }
    } catch (err) {
      console.warn('Failed to calculate TA_DAYS_SINCE_LOGIN:', err.message);
    }
  }

  return signals;
}

async function getUserLastLogin(userId) {
  try {
    const result = await client.send(new QueryCommand({
      TableName: USER_ACTIONS_TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: marshall({
        ':pk': `USER#${userId}`
      }),
      ScanIndexForward: false,
      Limit: 1
    }));

    if (result.Items?.length) {
      const action = unmarshall(result.Items[0]);
      return action.timestamp;
    }
    return null;
  } catch (err) {
    console.error('getUserLastLogin error:', err.message);
    return null;
  }
}

module.exports = { calculateSignals };
```

**Deliverable:** ✅ Signal calculator with unit tests

---

#### Task 3.2: Create Rule Evaluator Module
**File:** `lambda/evaluateIntelligenceRules/rule-evaluator.js`

```javascript
function evaluateRule(rule, signals) {
  if (!rule.enabled) return false;

  // All conditions must match (AND logic)
  return rule.conditions.every(condition => {
    const signalValue = signals[condition.signal];
    if (signalValue == null) {
      console.log(`Signal ${condition.signal} not available`);
      return false;
    }
    return evaluateCondition(signalValue, condition.operator, condition.value);
  });
}

function evaluateCondition(actual, operator, expected) {
  switch (operator) {
    case 'equals': return actual === expected;
    case 'notEquals': return actual !== expected;
    case 'greaterThan': return actual > expected;
    case 'lessThan': return actual < expected;
    case 'greaterThanOrEqual': return actual >= expected;
    case 'lessThanOrEqual': return actual <= expected;
    case 'in': return Array.isArray(expected) && expected.includes(actual);
    case 'notIn': return Array.isArray(expected) && !expected.includes(actual);
    default:
      console.error(`Unknown operator: ${operator}`);
      return false;
  }
}

module.exports = { evaluateRule, evaluateCondition };
```

**Deliverable:** ✅ Rule evaluator with unit tests

---

### Phase 4: evaluateIntelligenceRules Lambda (2 days)

**Goal:** Lambda evaluates rules on candidate updates

#### Task 4.1: Create Lambda Function
**File:** `lambda/evaluateIntelligenceRules/index.js`

```javascript
const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { unmarshall, marshall } = require('@aws-sdk/util-dynamodb');
const { calculateSignals } = require('./signal-calculator');
const { evaluateRule } = require('./rule-evaluator');

const STATE_TABLE = process.env.STATE_TABLE;
const PENDING_ACTIONS_TABLE = process.env.PENDING_ACTIONS_TABLE;
const dynamo = new DynamoDBClient({ region: process.env.AWS_REGION });
const eventBridge = new EventBridgeClient({ region: process.env.AWS_REGION });

// Import from Lambda layer
const { getConfig } = require('/opt/config-reader');

exports.handler = async (event) => {
  console.log('evaluateIntelligenceRules invoked', { records: event.Records.length });

  for (const record of event.Records) {
    if (record.eventName !== 'INSERT' && record.eventName !== 'MODIFY') continue;
    if (!record.dynamodb.NewImage.PK.S.startsWith('CANDIDATE#')) continue;

    const candidate = unmarshall(record.dynamodb.NewImage);
    const { candidateId, tenantId } = candidate;

    try {
      // Load tenant-specific rules (FOLLOWS EXISTING PATTERN)
      let intelligenceConfig;
      try {
        intelligenceConfig = await getConfig(tenantId, 'INTELLIGENCE_RULES');
      } catch (err) {
        console.warn('[evaluateIntelligenceRules] Config read failed — skipping:', err.message);
        continue;
      }

      const rules = intelligenceConfig.rules || [];
      if (rules.length === 0) {
        console.info('[evaluateIntelligenceRules] No rules configured — skipping', { tenantId });
        continue;
      }

      // Calculate signals
      const signals = await calculateSignals(candidate);

      // Evaluate rules
      for (const rule of rules) {
        const matched = evaluateRule(rule, signals);

        if (matched) {
          console.info('RULE_MATCHED', {
            candidateId, tenantId, ruleId: rule.id, actionType: rule.action.type
          });

          // Check cooldown
          const cooldownActive = await checkCooldown(candidateId, rule.id, rule.action.cooldownHours);
          if (cooldownActive) {
            console.info('RULE_COOLDOWN_ACTIVE', { candidateId, ruleId: rule.id });
            continue;
          }

          // Create pending action
          await createPendingAction(candidate, rule, signals);

          // Record cooldown
          await recordCooldown(candidateId, rule.id, rule.action.cooldownHours);

          // Publish event
          await publishActionRecommendedEvent(candidate, rule);
        }
      }
    } catch (err) {
      console.error('Error processing candidate', {
        candidateId, error: err.message, stack: err.stack
      });
      // Continue with next (fail-open)
    }
  }
};

async function checkCooldown(candidateId, ruleId, cooldownHours) {
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: STATE_TABLE,
      Key: marshall({
        PK: `CANDIDATE#${candidateId}`,
        SK: `INTELLIGENCE_COOLDOWN#${ruleId}`
      })
    }));

    if (!result.Item) return false;

    const cooldown = unmarshall(result.Item);
    const expiresAt = new Date(cooldown.expiresAt);
    return new Date() < expiresAt;
  } catch (err) {
    console.error('checkCooldown error:', err.message);
    return false; // Fail open
  }
}

async function recordCooldown(candidateId, ruleId, cooldownHours) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + cooldownHours * 60 * 60 * 1000);

  await dynamo.send(new PutItemCommand({
    TableName: STATE_TABLE,
    Item: marshall({
      PK: `CANDIDATE#${candidateId}`,
      SK: `INTELLIGENCE_COOLDOWN#${ruleId}`,
      ruleId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      expiresAtEpoch: Math.floor(expiresAt.getTime() / 1000)  // TTL
    })
  }));
}

async function createPendingAction(candidate, rule, signals) {
  const actionId = `ACT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  await dynamo.send(new PutItemCommand({
    TableName: PENDING_ACTIONS_TABLE,
    Item: marshall({
      PK: `CANDIDATE#${candidate.candidateId}`,
      SK: `ACTION#${actionId}`,
      actionId,
      candidateId: candidate.candidateId,
      tenantId: candidate.tenantId,
      ruleId: rule.id,
      actionType: rule.action.type,
      priority: rule.action.priority,
      status: 'PENDING',
      signals,
      createdAt: new Date().toISOString()
    })
  }));

  console.info('PENDING_ACTION_CREATED', { candidateId: candidate.candidateId, actionId });
}

async function publishActionRecommendedEvent(candidate, rule) {
  await eventBridge.send(new PutEventsCommand({
    Entries: [{
      Source: 'talentflow.intelligence-layer',
      DetailType: 'ActionRecommended',
      Detail: JSON.stringify({
        candidateId: candidate.candidateId,
        tenantId: candidate.tenantId,
        ruleId: rule.id,
        actionType: rule.action.type,
        priority: rule.action.priority,
        timestamp: new Date().toISOString()
      })
    }]
  }));
}
```

**Deliverable:** ✅ Lambda implemented

---

#### Task 4.2: Create Terraform Configuration
**File:** `talent-flow-infra/intelligence-layer.tf`

```hcl
# Lambda function
resource "aws_lambda_function" "evaluateIntelligenceRules" {
  function_name = "evaluateIntelligenceRules"
  role          = aws_iam_role.evaluateIntelligenceRules.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  timeout       = 60
  memory_size   = 512

  filename         = "../lambda/evaluateIntelligenceRules/index.zip"
  source_code_hash = filebase64sha256("../lambda/evaluateIntelligenceRules/index.zip")

  layers = [aws_lambda_layer_version.config_reader.arn]

  environment {
    variables = {
      STATE_TABLE           = local.tf_table_state
      PENDING_ACTIONS_TABLE = local.tf_table_pending_actions
      USER_ACTIONS_TABLE    = local.tf_table_user_actions
      CONFIG_TABLE          = local.tf_table_config
    }
  }
}

# IAM Role
resource "aws_iam_role" "evaluateIntelligenceRules" {
  name = "talent-flow-role-evaluateIntelligenceRules"
  path = "/talent-flow/"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}

# IAM Policy (FOLLOWS EXISTING PATTERN)
resource "aws_iam_role_policy" "evaluateIntelligenceRules_policy" {
  name = "IntelligenceLayerPolicy"
  role = aws_iam_role.evaluateIntelligenceRules.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid = "Logs"
        Effect = "Allow"
        Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/evaluateIntelligenceRules:*"
      },
      {
        Sid = "ConfigTableRead"
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${local.tf_table_config}",
          "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${local.tf_table_config}/index/*"
        ]
      },
      {
        Sid = "StateTableReadWrite"
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${local.tf_table_state}"
      },
      {
        Sid = "UserActionsTableRead"
        Effect = "Allow"
        Action = ["dynamodb:Query"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${local.tf_table_user_actions}"
      },
      {
        Sid = "PendingActionsTableWrite"
        Effect = "Allow"
        Action = ["dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${local.tf_table_pending_actions}"
      },
      {
        Sid = "EventBridge"
        Effect = "Allow"
        Action = ["events:PutEvents"]
        Resource = "*"
      },
      {
        Sid = "KMSStateKey"
        Effect = "Allow"
        Action = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = aws_kms_key.state_key.arn
      }
    ]
  })
}

# DynamoDB Stream Trigger
resource "aws_lambda_event_source_mapping" "evaluateIntelligenceRules_stream" {
  event_source_arn  = aws_dynamodb_table.talent_flow_state.stream_arn
  function_name     = aws_lambda_function.evaluateIntelligenceRules.arn
  starting_position = "LATEST"
  batch_size        = 10

  filter_criteria {
    filter {
      pattern = jsonencode({
        eventName = ["INSERT", "MODIFY"]
        dynamodb = {
          NewImage = {
            PK = { S = [{ prefix = "CANDIDATE#" }] }
          }
        }
      })
    }
  }
}
```

**Deliverable:** ✅ Infrastructure as code

---

### Phase 5: Notification Integration (2-3 days)

**Goal:** Connect Intelligence Layer to notification system

#### Task 5.1: EventBridge Integration
**File:** `talent-flow-infra/intelligence-layer.tf` (add to existing)

```hcl
# EventBridge rule
resource "aws_cloudwatch_event_rule" "intelligence_action_recommended" {
  name        = "intelligence-action-recommended"
  description = "Trigger notifications when Intelligence Layer recommends action"

  event_pattern = jsonencode({
    source      = ["talentflow.intelligence-layer"]
    detail-type = ["ActionRecommended"]
  })
}

resource "aws_cloudwatch_event_target" "intelligence_action_recommended" {
  rule      = aws_cloudwatch_event_rule.intelligence_action_recommended.name
  target_id = "SendTalentFlowNotification"
  arn       = aws_lambda_function.sendTalentFlowNotification.arn
}

resource "aws_lambda_permission" "intelligence_action_recommended" {
  statement_id  = "AllowExecutionFromEventBridge-IntelligenceLayer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sendTalentFlowNotification.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.intelligence_action_recommended.arn
}
```

**Deliverable:** ✅ EventBridge connects to notification Lambda

---

#### Task 5.2: Update sendTalentFlowNotification
**File:** `lambda/sendTalentFlowNotification/index.js`

Add handler for new event type:
```javascript
if (event['detail-type'] === 'ActionRecommended') {
  const { candidateId, actionType, priority } = event.detail;

  const templateMap = {
    'NUDGE_HM_REVIEW_OFFER': 'talent-flow-nudge-hm-review-offer',
    'NUDGE_TA_REVIEW_CANDIDATE': 'talent-flow-nudge-ta-review-candidate',
    'ALERT_SLA_BREACH': 'talent-flow-sla-breach'
  };

  const templateId = templateMap[actionType];
  if (!templateId) {
    console.warn('Unknown action type:', actionType);
    return;
  }

  const candidate = await getCandidateDetails(candidateId);
  const recipientEmail = actionType.includes('HM')
    ? candidate.hiringManagerEmail
    : candidate.recruiterEmail;

  await sendEmail({
    to: recipientEmail,
    templateId,
    data: {
      candidateName: `${candidate.firstName} ${candidate.lastName}`,
      positionTitle: candidate.positionTitle,
      dashboardLink: `https://talentflow.naleko.ai/candidates/${candidateId}`
    }
  });
}
```

**Deliverable:** ✅ Notifications sent for Intelligence Layer events

---

### Phase 6: Monitoring (1-2 days)

**Goal:** Enable operational visibility

#### Task 6.1: CloudWatch Dashboard
**File:** `talent-flow-infra/cloudwatch-dashboard.tf`

```hcl
resource "aws_cloudwatch_dashboard" "intelligence_layer" {
  dashboard_name = "TalentFlow-IntelligenceLayer"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          title = "Lambda Invocations"
          metrics = [["AWS/Lambda", "Invocations", { stat = "Sum" }]]
          region = var.aws_region
        }
      },
      {
        type = "metric"
        properties = {
          title = "Lambda Errors"
          metrics = [["AWS/Lambda", "Errors", { stat = "Sum" }]]
          region = var.aws_region
        }
      }
    ]
  })
}
```

**Deliverable:** ✅ CloudWatch dashboard

---

#### Task 6.2: CloudWatch Alarms
```hcl
resource "aws_cloudwatch_metric_alarm" "intelligence_layer_errors" {
  alarm_name = "TalentFlow-IntelligenceLayer-HighErrorRate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods = "2"
  metric_name = "Errors"
  namespace = "AWS/Lambda"
  period = "300"
  statistic = "Sum"
  threshold = "10"

  dimensions = {
    FunctionName = aws_lambda_function.evaluateIntelligenceRules.function_name
  }
}
```

**Deliverable:** ✅ Alarms configured

---

## Timeline Summary

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1: Backend config | 2 days | None |
| Phase 2: Admin UI | 3 days | Phase 1 |
| Phase 3: Signal calculation | 3 days | None (parallel) |
| Phase 4: Lambda evaluation | 2 days | Phase 1, Phase 3 |
| Phase 5: Notifications | 2-3 days | Phase 4 |
| Phase 6: Monitoring | 1-2 days | Phase 4 |

**Total: 2-3 weeks**

---

## Success Criteria

### Phase 1 Complete When:
- ✅ config-reader.js returns `{ rules: [] }` for INTELLIGENCE_RULES
- ✅ manageTalentFlowConfig API accepts INTELLIGENCE_RULES
- ✅ Versions increment correctly (v1 → v2)

### Phase 2 Complete When:
- ✅ Admin can navigate to intelligence-rules page
- ✅ Can add/edit/remove rules
- ✅ Can configure thresholds (30 days example)
- ✅ Save creates new version
- ✅ Version badge displays

### Phase 4 Complete When:
- ✅ Lambda processes stream records
- ✅ Rules evaluated on candidate updates
- ✅ Cooldown prevents duplicates
- ✅ Pending actions created
- ✅ Events published

### Phase 5 Complete When:
- ✅ sendTalentFlowNotification receives events
- ✅ Emails sent to correct recipients

---

## Risk Mitigation

### Risk 1: False Positives
- Start with rules disabled (admin enables)
- 24-hour cooldown configurable
- Monitor opt-out rate

### Risk 2: Signal Calculation Errors
- Unit test all calculators
- Return null for missing signals
- Skip rules with null signals

### Risk 3: Performance
- Lambda timeout: 60s
- Batch size: 10
- Cache config (5 minutes)

---

## Key Patterns Followed

✅ **Config storage:** Reuses talent-flow-config table
✅ **Versioning:** Follows sparse GSI pattern (365-day TTL)
✅ **Config loading:** Reuses config-reader.js with 5-min cache
✅ **Admin UI:** Follows scoring-weights component pattern
✅ **IAM:** Follows existing permission patterns (Query + index/*)
✅ **Error handling:** Fail-open for non-critical operations
✅ **Tenant context:** From candidate record (no lookup)
✅ **Multi-tenant:** Per-tenant configs (TENANT#{tenantId})

---

## References

- **Investigation:** `/Users/IggieMushanguri/Documents/hr-portal/INTELLIGENCE-LAYER-INVESTIGATION.md`
- **Existing patterns:** talent-flow-config table, manageTalentFlowConfig, config-reader.js
- **Example components:** scoring-weights, sla-thresholds, panel-rules

---

**Status:** READY FOR IMPLEMENTATION
**Date:** 2026-06-08
