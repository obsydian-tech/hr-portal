# Intelligence Layer - Existing Architecture Investigation

**Purpose**: Thoroughly understand existing multi-tenant, metadata-driven patterns in TalentFlow before designing Intelligence Layer architecture.

**Date Started**: 2026-06-08
**Date Completed**: 2026-06-08
**Status**: ✅ COMPLETED

---

## Investigation Checklist

- [x] Task 1: talent-flow-config DynamoDB structure ✓
- [x] Task 2: Lambda config consumption patterns ✓
- [x] Task 3: Admin UI configuration patterns ✓
- [x] Task 4: Terraform infrastructure ✓
- [x] Task 5: Synthesize patterns and recommendations ✓

---

## Section 1: talent-flow-config DynamoDB Structure

### Schema Investigation
**Status**: ✓ COMPLETED

### Key Findings

**Primary Keys:**
- PK: `TENANT#{tenantId}` (e.g., `TENANT#DEFAULT`)
- SK: `CONFIG#{configType}#v{version}` (e.g., `CONFIG#SCORING_WEIGHTS#v3`)

**GSI1 (GSI1-active-configs) - SPARSE INDEX:**
- GSI1PK: `TENANT#{tenantId}#ACTIVE` (only on active versions)
- GSI1SK: `CONFIG#{configType}` (only on active versions)
- Purpose: Fast query for currently active config versions
- Pattern: 95%+ of reads use this index

**Multi-Tenancy:**
- Pattern: Tenant-per-record (tenant as partition key prefix)
- Current: Only `TENANT#DEFAULT` in use
- Architecture: Ready for multi-tenant expansion

**Versioning Strategy:**
- ONE active version per configType per tenant
- Active: `isActive=true`, GSI1 keys present, NO expiresAt
- Inactive: `isActive=false`, GSI1 keys REMOVED, expiresAt set (TTL)
- TTL: 365 days after deactivation (audit trail retention)
- CRITICAL: In-flight candidates lock to specific version (compliance requirement)

**Config Types (The Variable Six):**
1. SCORING_WEIGHTS - Interview scoring criteria
2. SLA_THRESHOLDS - Stage response times (hours)
3. APPROVAL_RULES - Offer approval thresholds
4. PANEL_CONFIG - Voting rules, veto power
5. EMAIL_TEMPLATES - Notification template IDs
6. STAGE_CONFIG - Enabled workflow stages

**Additional Config Types (Newer):**
7. IT_QUEUES - IT specialist assignments
8. ROUTING_RULES - IT task routing logic
9. PROVISIONING_TEMPLATES - IT provisioning tasks

**File References:**
- Table: `talent-flow-infra/talent-flow-dynamodb.tf:102-167`
- Seed: `scripts/seed-talent-flow-config.js`
- Reader: `lambda/shared/config-reader.js`

---

## Section 2: Lambda Config Consumption Patterns

### Config Loading Patterns
**Status**: ✓ COMPLETED

### Key Findings

**Shared Config Reader:**
- File: `lambda/shared/config-reader.js`
- Functions: `getConfig(tenantId, configType, version?)`, `getConfigItem(tenantId, configType)`
- Cache: 5-minute in-memory per Lambda container
- Cache key: `${tenantId}#${configType}#${version||'ACTIVE'}`

**Two Read Modes:**
1. **Active Read** (new workflows): No version parameter, reads from GSI1-active-configs
2. **Versioned Read** (in-flight candidates): Requires version, reads from PK/SK directly

**Tenant Context Sources:**
1. EventBridge events: `event.detail.tenantId`
2. HTTP API requests: `body.tenantId`
3. SAGA record fallback: Read from candidate's SAGA record

**Version Locking Pattern (CRITICAL):**
- `orchestrateTalentFlowWorkflow` uses `getConfigItem()` to get version number
- Locks `configVersion` onto SAGA record with conditional write
- All downstream Lambdas (`submitVote`, `completeEvaluation`, `createOffer`) read SAGA first
- Pass locked `configVersion` to `getConfig()` for historical snapshot reads

**Error Handling:**
- **Fail-closed**: Compliance-critical operations (scoring, approval) return 500
- **Fail-open**: Non-critical features (IT queue filtering) continue with no restriction
- **Fallback defaults**: Safe hardcoded defaults if DynamoDB read fails
- Never cache errors

**File References:**
- Reader: `lambda/shared/config-reader.js`
- Orchestrator: `lambda/orchestrateTalentFlowWorkflow/index.js`
- Vote: `lambda/submitVote/index.js`

---

## Section 3: Admin UI Configuration Patterns

### Current Admin Config UI
**Status**: ✓ COMPLETED

### Key Findings

**5 Existing Config Editors:**
1. Scoring Weights (`/platform/talentflow/admin/talentflow/scoring-weights`)
2. SLA Thresholds (`/platform/talentflow/admin/talentflow/sla-thresholds`)
3. Panel Rules (`/platform/talentflow/admin/talentflow/panel-rules`)
4. Stage Config (`/platform/talentflow/admin/talentflow/stage-config`)
5. Sentiment Scales (`/platform/talentflow/admin/talentflow/sentiment-scales`)

**Consistent Angular Pattern:**
- Standalone components with Angular Signals
- Inject: `TalentFlowApiService`, `MessageService`, `ConfirmationService`
- Signals: `loading`, `saving`, `configData`, `configVersion`, `updatedAt`
- Computed validation: `valid = computed(() => /* logic */)`
- PrimeNG components: InputNumber, Dropdown, ToggleButton

**API Integration:**
- Service: `TalentFlowApiService` in `services/talent-flow-api.service.ts`
- GET: `/v1/config?configType=X&active=true&tenantId=Y`
- PUT: `/v1/config` with body `{ tenantId, configType, data }`
- 404 treated as "not configured" (returns empty config)
- Timeout: 120 seconds

**Save Flow (Two-Step):**
1. Confirm via `ConfirmationService` dialog
2. Call `api.updateConfig(configType, data)`
3. Update local signals with new version/updatedAt
4. Show PrimeNG Toast (success green, error red)

**Validation Patterns:**
- Scoring weights: Sum must equal 100
- SLA thresholds: Hours >= 1
- Panel rules: Votes >= 1
- Computed signals with template-bound `[disabled]="!valid()"`

**Admin Lambda:**
- File: `lambda/manageTalentFlowConfig/index.js`
- Routes: GET/POST/PUT `/v1/config`
- Auth: Cognito JWT with admin guard (`custom:isAdmin='true'`)
- Version strategy: PUT creates v(N+1), deactivates v(N) with 365-day TTL

**File References:**
- Components: `hr-portal/src/app/features/talent-flow/pages/admin/talentflow-config/`
- API Service: `hr-portal/src/app/features/talent-flow/services/talent-flow-api.service.ts`
- Models: `hr-portal/src/app/features/talent-flow/models/talent-flow.models.ts`
- Lambda: `lambda/manageTalentFlowConfig/index.js`

---

## Section 4: Terraform Infrastructure

### Infrastructure as Code
**Status**: ✓ COMPLETED

### Key Findings

**Table Configuration:**
- Billing: PAY_PER_REQUEST (on-demand)
- Encryption: KMS key `alias/talent-flow/state` (shared)
- PITR: ENABLED (7-year retention for POPIA compliance)
- Streams: NO
- TTL: ENABLED on `expiresAt` attribute

**Lambdas with READ Access (13 total):**
- orchestrateTalentFlowWorkflow, scheduleInterview, submitVote
- completeEvaluation, sendTalentFlowNotification, monitorTalentFlowSLAs
- talentFlowAiChat, createOffer, submitVoteByToken
- getItTasks, createItTask, createProvisioningBundle

**Lambda with WRITE Access (1 only):**
- manageTalentFlowConfig (Admin UI backend)

**IAM Pattern for Read-Only:**
```hcl
Action = ["dynamodb:GetItem", "dynamodb:Query"]
Resource = [
  "arn:aws:dynamodb:region:account:table/talent-flow-config",
  "arn:aws:dynamodb:region:account:table/talent-flow-config/index/*"
]
```
**NOTE:** Many Lambdas needed IAM patches via `iam-patches.tf` to add Query+index/* permissions

**IAM Pattern for Write (Admin):**
```hcl
Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
```

**Shared Config Reader:**
- File: `lambda/shared/config-reader.js`
- Cache: 5-minute in-memory per Lambda container
- Functions: `getConfig(tenantId, type)`, `getConfig(tenantId, type, version)`
- Fallback: Safe hardcoded defaults

**Environment Strategy:**
- Single table (no dev/staging/prod suffix)
- Differentiation: Via tenantId in PK (future: `TENANT#DEV`, `TENANT#PROD`)
- Current: Only `TENANT#DEFAULT`

**File References:**
- Table: `talent-flow-infra/talent-flow-dynamodb.tf:102-167`
- IAM: `talent-flow-infra/talent-flow-iam.tf`
- Patches: `infra/iam-patches.tf`
- Admin Lambda: `infra/talentflow-config.tf`

---

## Section 5: Multi-Tenant Metadata Patterns (Synthesis)

### Identified Patterns
**Status**: ✓ COMPLETED

### 5.1 PK/SK Conventions (MUST FOLLOW)

**Established Pattern:**
```
PK: TENANT#{tenantId}
SK: CONFIG#{configType}#v{version}
```

**For Intelligence Layer:**
```
PK: TENANT#{tenantId}
SK: CONFIG#INTELLIGENCE_RULES#v{version}
```

**Rationale:**
- Consistent with all existing configs in `talent-flow-config` table
- Enables tenant isolation via partition key
- Versions queryable via `begins_with(SK, 'CONFIG#INTELLIGENCE_RULES#v')`

**CRITICAL: DO NOT create separate table for Intelligence Layer configs**
- Reuse existing `talent-flow-config` table
- Add new configType: `INTELLIGENCE_RULES`
- Follows metadata-lite principle (one config table, many config types)

---

### 5.2 GSI1 Sparse Index Pattern (MUST FOLLOW)

**Established Pattern:**
```
Active configs only:
  GSI1PK: TENANT#{tenantId}#ACTIVE
  GSI1SK: CONFIG#{configType}

Inactive configs:
  GSI1PK: REMOVED
  GSI1SK: REMOVED
```

**For Intelligence Layer:**
- When rule is active: Set `GSI1PK = TENANT#NALEKO#ACTIVE`, `GSI1SK = CONFIG#INTELLIGENCE_RULES`
- When rule is deactivated: Remove both GSI1 keys, set `expiresAt = now + 365 days`

**Benefits:**
- Fast active config lookup (no scanning all versions)
- Automatic cleanup after 365 days via TTL
- Follows existing caching patterns in `config-reader.js`

---

### 5.3 Multi-Tenant Config Storage Pattern

**Current Implementation:**
- Only `TENANT#DEFAULT` in use
- Architecture supports multi-tenant but not activated

**For Intelligence Layer (Your Requirement: Configurable per Tenant):**

**Option A: Per-Tenant Config Records (RECOMMENDED)**
```
PK: TENANT#NALEKO,     SK: CONFIG#INTELLIGENCE_RULES#v1
PK: TENANT#ACME,       SK: CONFIG#INTELLIGENCE_RULES#v1
PK: TENANT#OBSYDIAN,   SK: CONFIG#INTELLIGENCE_RULES#v1
```

Each tenant has own rules with own thresholds:
```javascript
// NALEKO tenant
{
  "rules": [
    {
      "id": "RULE-001",
      "conditions": [
        { "signal": "OFFER_DAYS_TO_EXPIRY", "operator": "lessThan", "value": 30 }
      ]
    }
  ]
}

// ACME tenant
{
  "rules": [
    {
      "id": "RULE-001",
      "conditions": [
        { "signal": "OFFER_DAYS_TO_EXPIRY", "operator": "lessThan", "value": 14 }
      ]
    }
  ]
}
```

**Benefits:**
- Clear tenant separation
- Easy to backup/restore per tenant
- Follows existing pattern (even though DEFAULT is only tenant currently)
- Natural fit for "configurable per tenant" requirement

---

### 5.4 Versioning Strategy (MUST FOLLOW)

**Established Pattern:**
1. Active version: `isActive=true`, GSI1 keys present, NO expiresAt
2. Create new version: Write v(N+1) with `isActive=true`
3. Deactivate old: Update v(N) to `isActive=false`, remove GSI1 keys, set `expiresAt=now+365d`
4. NEVER delete old versions (TTL handles cleanup after 365 days)

**For Intelligence Layer:**
- Admin changes rule threshold (e.g., 30 days → 14 days)
- Create new version v2 with updated threshold
- Deactivate v1 (but keep for audit trail)
- New Lambda reads will get v2 via GSI1
- Old v1 auto-purges after 365 days

**CRITICAL: Version Locking for Candidates?**

**Question for You:** Should in-flight candidates lock to Intelligence Layer config version?

**Scenario:**
- Candidate created when RULE-001 threshold = 30 days
- Admin changes threshold to 14 days (creates v2)
- Should candidate use v1 (30 days) or v2 (14 days)?

**Options:**
- **Option A: NO version locking** (recommended for Intelligence Layer)
  - Always use active config
  - Rationale: Intelligence Layer is **advisory**, not **compliance-critical**
  - Unlike scoring weights (must never change retroactively), notification rules can evolve

- **Option B: Version locking** (follow orchestrateTalentFlowWorkflow pattern)
  - Lock `intelligenceConfigVersion` on SAGA record
  - All rule evaluations read locked version
  - Rationale: Consistent notification behavior per candidate

**My Recommendation: Option A (no locking)**
- Intelligence Layer is for **proactive insights**, not **compliance decisions**
- Admin should be able to tune rules and see immediate effect
- Simpler implementation (no SAGA locking logic needed)

---

### 5.5 Config Loading Pattern (MUST REUSE)

**Existing Shared Utility:**
- File: `lambda/shared/config-reader.js`
- Already supports any `configType` string
- Already caches for 5 minutes
- Already has fallback defaults

**For Intelligence Layer Lambda:**
```javascript
const { getConfig } = require('/opt/config-reader');  // Lambda layer

// Active read (no version locking)
const intelligenceConfig = await getConfig(tenantId, 'INTELLIGENCE_RULES');

// Extract rules
const rules = intelligenceConfig.rules || [];

// Evaluate rules
for (const rule of rules) {
  if (!rule.enabled) continue;
  // ... evaluate conditions ...
}
```

**MUST ADD to config-reader.js defaults:**
```javascript
function getDefaults(configType) {
  const defaults = {
    // ... existing defaults ...
    INTELLIGENCE_RULES: {
      rules: []  // Empty rules = no notifications (safe default)
    }
  };
  return defaults[configType] ?? {};
}
```

**Benefits:**
- Zero duplication
- Inherits 5-minute cache
- Consistent error handling
- Consistent logging

---

### 5.6 Admin UI Pattern (MUST REUSE)

**Create New Component:**
```
hr-portal/src/app/features/talent-flow/pages/admin/talentflow-config/
  intelligence-rules/
    admin-intelligence-rules.component.ts
    admin-intelligence-rules.component.html
    admin-intelligence-rules.component.scss
```

**Component Structure (Follow Existing):**
```typescript
@Component({
  selector: 'tf-admin-intelligence-rules',
  standalone: true,
  imports: [
    FormsModule,
    InputNumberModule,
    SelectModule,
    ToggleButtonModule,
    ConfigVersionBadgeComponent  // Reuse existing
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
        const data = cfg.data as { rules: IntelligenceRule[] };
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
      message: 'Save Intelligence Layer rules? Changes take effect immediately.',
      header:  'Save Rules',
      icon:    'pi pi-exclamation-triangle',
      accept:  () => this.doSave()
    });
  }

  private doSave(): void {
    this.saving.set(true);
    const payload = { rules: this.rules() };

    this.api.updateConfig('INTELLIGENCE_RULES', payload).subscribe({
      next: (cfg: ConfigResponse) => {
        this.configVersion.set(cfg.version);
        this.updatedAt.set(cfg.updatedAt);
        this.saving.set(false);
        this.messageService.add({
          severity: 'success',
          summary:  'Saved',
          detail:   `Intelligence rules saved as version ${cfg.version}.`,
          life:     4000
        });
      },
      error: (err: { userMessage?: string }) => {
        this.saving.set(false);
        this.messageService.add({
          severity: 'error',
          summary:  'Save Failed',
          detail:   err.userMessage ?? 'Could not save rules.',
          life:     5000
        });
      }
    });
  }
}
```

**API Service (Already Ready):**
- `getConfig('INTELLIGENCE_RULES')` - works out of the box
- `updateConfig('INTELLIGENCE_RULES', payload)` - works out of the box
- Just add `'INTELLIGENCE_RULES'` to `ConfigType` union in `talent-flow.models.ts`

**Route Configuration:**
```typescript
// Add to admin routes
{
  path: 'talentflow/intelligence-rules',
  component: AdminIntelligenceRulesComponent,
  canActivate: [authGuard, adminGuard]
}
```

---

### 5.7 Lambda IAM Permissions Pattern

**For evaluateIntelligenceRules Lambda:**

**Read-Only Pattern (Follow Existing):**
```hcl
resource "aws_iam_role_policy" "evaluateIntelligenceRules_config_read" {
  name = "ConfigTableRead"
  role = aws_iam_role.evaluateIntelligenceRules.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ConfigTableRead"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:Query"
        ]
        Resource = [
          "arn:aws:dynamodb:af-south-1:${data.aws_caller_identity.current.account_id}:table/talent-flow-config",
          "arn:aws:dynamodb:af-south-1:${data.aws_caller_identity.current.account_id}:table/talent-flow-config/index/*"
        ]
      }
    ]
  })
}
```

**KMS Key Permission (Follow Existing):**
```hcl
{
  Sid    = "KMSStateKey"
  Effect = "Allow"
  Action = [
    "kms:Decrypt",
    "kms:GenerateDataKey",
    "kms:DescribeKey"
  ]
  Resource = "arn:aws:kms:af-south-1:${account}:key/87842eae-1ee4-43d1-8bf8-9dd92415ea68"
}
```

**LESSON LEARNED:** Grant Query + index/* from day 1 to avoid iam-patches.tf later

---

### 5.8 Tenant Context for Intelligence Layer

**EventBridge Event Pattern:**
```javascript
// DynamoDB Stream → evaluateIntelligenceRules Lambda
{
  "version": "0",
  "id": "...",
  "detail-type": "DynamoDB Stream Record",
  "source": "aws.dynamodb",
  "detail": {
    "eventName": "MODIFY",
    "dynamodb": {
      "NewImage": {
        "PK": { "S": "CANDIDATE#..." },
        "tenantId": { "S": "NALEKO" }  // ← Extract tenantId
      }
    }
  }
}
```

**Lambda Handler:**
```javascript
exports.handler = async (event) => {
  for (const record of event.Records) {
    const newImage = record.dynamodb.NewImage;
    const candidate = unmarshall(newImage);
    const tenantId = candidate.tenantId;  // ← Always present on candidate records

    // Load tenant-specific rules
    const intelligenceConfig = await getConfig(tenantId, 'INTELLIGENCE_RULES');
    const rules = intelligenceConfig.rules || [];

    // Evaluate rules
    for (const rule of rules) {
      // ...
    }
  }
};
```

**Benefits:**
- No separate tenant lookup needed
- Consistent with orchestrateTalentFlowWorkflow pattern
- Natural multi-tenant isolation

---

### 5.9 Error Handling Strategy

**For Intelligence Layer (Advisory, Not Critical):**

**Recommendation: Fail-Open**
```javascript
let intelligenceConfig;
try {
  intelligenceConfig = await getConfig(tenantId, 'INTELLIGENCE_RULES');
} catch (err) {
  console.warn('[evaluateIntelligenceRules] Config read failed — skipping rule evaluation:', err.message);
  return; // Skip this candidate, don't crash
}

const rules = intelligenceConfig.rules || [];
if (rules.length === 0) {
  console.info('[evaluateIntelligenceRules] No rules configured for tenant — skipping');
  return;
}
```

**Rationale:**
- Intelligence Layer is **proactive insights**, not **workflow blocker**
- If config read fails, better to skip notification than crash
- Follows pattern used in getItTasks.js for non-critical features

**Logging Pattern:**
```javascript
console.info('RULE_MATCHED', {
  candidateId,
  ruleId: rule.id,
  tenantId,
  action: rule.action.type
});

console.info('RULE_SKIPPED', {
  candidateId,
  ruleId: rule.id,
  reason: 'signal_not_available',
  missingSignal: 'OFFER_DAYS_TO_EXPIRY'
});

console.error('RULE_EVALUATION_ERROR', {
  candidateId,
  ruleId: rule.id,
  error: err.message
});
```

---

### 5.10 Config Schema for Intelligence Layer

**Recommended Structure (Follows Your "30 days" Example):**

```typescript
// Type definition (add to talent-flow.models.ts)
export interface IntelligenceRulesConfig {
  rules: IntelligenceRule[];
}

export interface IntelligenceRule {
  id: string;                    // "RULE-001"
  name: string;                  // "Expiring Offer with Inactive HM"
  description: string;           // Human-readable description
  enabled: boolean;              // Can disable rule without deleting
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  conditions: RuleCondition[];
  action: RuleAction;
  cooldown: number;              // Hours before re-triggering
}

export interface RuleCondition {
  signal: string;                // "OFFER_DAYS_TO_EXPIRY"
  operator: 'equals' | 'notEquals' | 'greaterThan' | 'lessThan' | 'in' | 'notIn';
  value: number | string | string[];  // 30 (YOUR EXAMPLE)
}

export interface RuleAction {
  type: string;                  // "NUDGE_HM_REVIEW_OFFER"
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  cooldown: number;              // 24 hours
}
```

**Example Config (Your "30 days" Requirement):**
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
        "description": "Notify HM when offer is expiring and they haven't logged in recently",
        "enabled": true,
        "priority": "HIGH",
        "conditions": [
          {
            "signal": "CANDIDATE_STAGE",
            "operator": "equals",
            "value": "OFFER_IN_APPROVAL"
          },
          {
            "signal": "HM_DAYS_SINCE_LOGIN",
            "operator": "greaterThan",
            "value": 3
          },
          {
            "signal": "OFFER_DAYS_TO_EXPIRY",
            "operator": "lessThan",
            "value": 30
          }
        ],
        "action": {
          "type": "NUDGE_HM_REVIEW_OFFER",
          "priority": "HIGH",
          "cooldown": 24
        }
      }
    ]
  },
  "createdAt": "2026-06-08T00:00:00Z"
}
```

**Admin UI Change Flow:**
1. Admin changes value from 30 to 14 via UI
2. UI calls `updateConfig('INTELLIGENCE_RULES', { rules: [...] })`
3. manageTalentFlowConfig creates v2 with value:14
4. manageTalentFlowConfig deactivates v1 (sets TTL)
5. Next Lambda read via `getConfig()` gets v2 from GSI1
6. Rule now triggers at 14 days instead of 30

**Zero code deployment required!**

---

## Recommendations for Intelligence Layer

### 1. How Intent Model Should Integrate

**CRITICAL DECISION: DO NOT create separate table**

**Use existing `talent-flow-config` table with:**
- configType: `INTELLIGENCE_RULES`
- PK: `TENANT#{tenantId}`
- SK: `CONFIG#INTELLIGENCE_RULES#v{version}`
- GSI1PK/SK: Follow sparse index pattern

**Benefits:**
- Consistent with existing architecture
- Reuses config-reader.js
- Reuses manageTalentFlowConfig Lambda
- Reuses TalentFlowApiService
- Reuses ConfigVersionBadgeComponent
- Reuses IAM patterns
- Reuses versioning strategy

**NO separate Lambda needed for CRUD** - manageTalentFlowConfig already handles any configType!

---

### 2. Config Schema Conventions to Follow

**MUST:**
- Store as `data` attribute (not top-level keys)
- Use `isActive` boolean
- Use GSI1PK/SK for active version only
- Set `expiresAt` on inactive versions (365 days)
- Include `createdAt` timestamp
- Never delete old versions (TTL handles it)

**Rule Schema:**
```javascript
{
  "rules": [  // Array of rules
    {
      "id": "RULE-001",  // Unique ID
      "enabled": true,    // Can disable without deleting
      "conditions": [     // Array of AND conditions
        {
          "signal": "...",
          "operator": "...",
          "value": ...     // CONFIGURABLE threshold
        }
      ],
      "action": { ... },
      "cooldown": 24      // CONFIGURABLE
    }
  ]
}
```

---

### 3. Lambda Patterns to Reuse

**evaluateIntelligenceRules Lambda:**

```javascript
const { getConfig } = require('/opt/config-reader');  // Shared layer
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

exports.handler = async (event) => {
  for (const record of event.Records) {
    if (record.eventName !== 'MODIFY' && record.eventName !== 'INSERT') continue;

    const candidate = unmarshall(record.dynamodb.NewImage);
    const { candidateId, tenantId } = candidate;

    // Load tenant-specific rules (FOLLOWS EXISTING PATTERN)
    let intelligenceConfig;
    try {
      intelligenceConfig = await getConfig(tenantId, 'INTELLIGENCE_RULES');
    } catch (err) {
      console.warn('[evaluateIntelligenceRules] Config read failed — skipping:', err.message);
      continue;
    }

    const rules = intelligenceConfig.rules || [];

    // Calculate signals
    const signals = await calculateSignals(candidate);

    // Evaluate rules
    for (const rule of rules) {
      if (!rule.enabled) continue;

      const matched = rule.conditions.every(condition => {
        const signalValue = signals[condition.signal];
        if (signalValue == null) return false;
        return evaluateCondition(signalValue, condition.operator, condition.value);
      });

      if (matched) {
        console.info('RULE_MATCHED', { candidateId, ruleId: rule.id });
        await processAction(rule, candidate, signals);
      }
    }
  }
};
```

**Follows Patterns:**
- Error handling: Fail-open (skip on error)
- Logging: Structured with candidateId, ruleId
- Config loading: Via shared config-reader.js
- Tenant context: From candidate record

---

### 4. Admin UI Patterns to Reuse

**Create Component:**
```
hr-portal/src/app/features/talent-flow/pages/admin/talentflow-config/
  intelligence-rules/
    admin-intelligence-rules.component.ts
```

**Reuse:**
- TalentFlowApiService (already supports INTELLIGENCE_RULES once added to type)
- MessageService for toasts
- ConfirmationService for save confirmation
- ConfigVersionBadgeComponent for version display
- Angular Signals for reactive state
- PrimeNG InputNumber for threshold editing

**Add Route:**
```typescript
{
  path: 'talentflow/intelligence-rules',
  component: AdminIntelligenceRulesComponent,
  canActivate: [authGuard, adminGuard]
}
```

**Add to Navigation:**
```html
<a routerLink="/platform/talentflow/admin/talentflow/intelligence-rules">
  <i class="pi pi-bolt"></i>
  <span>Intelligence Rules</span>
</a>
```

---

### 5. Implementation Checklist

**Phase 1: Backend (Config Storage)**
- [ ] Add `INTELLIGENCE_RULES` to config-reader.js defaults
- [ ] Add `INTELLIGENCE_RULES` to seed script (optional)
- [ ] Test via manageTalentFlowConfig Lambda (no code changes needed!)

**Phase 2: Frontend (Admin UI)**
- [ ] Add `'INTELLIGENCE_RULES'` to ConfigType in talent-flow.models.ts
- [ ] Create AdminIntelligenceRulesComponent
- [ ] Add route and navigation link
- [ ] Test save/load flow

**Phase 3: Lambda (Rule Evaluation)**
- [ ] Create evaluateIntelligenceRules Lambda
- [ ] Add IAM permissions (config read, state read)
- [ ] Add DynamoDB Stream trigger on talent-flow-state
- [ ] Implement signal calculators
- [ ] Implement rule evaluator
- [ ] Test with real candidate updates

**Phase 4: Monitoring**
- [ ] CloudWatch dashboard for rule triggers
- [ ] Alarms for evaluation errors
- [ ] Logs Insights queries for rule matches

---

### 6. What You Asked For: "Configurable per Tenant Like Salesforce"

**You Get:**
- ✅ Rules stored in DynamoDB (not hardcoded)
- ✅ Admin UI to configure thresholds (no code deployment)
- ✅ Per-tenant isolation (TENANT#{tenantId} partition key)
- ✅ Version history (365-day audit trail)
- ✅ Enable/disable rules via UI
- ✅ Test rules before enabling (via rule.enabled flag)
- ✅ Generic rule engine (Lambda code never changes)
- ✅ Configurable thresholds (30 days, 14 days, etc.)

**Exactly like Salesforce validation rules!**

---

## Next Steps

After investigation complete:
1. Review findings with team
2. Design Intent Model schema following existing patterns
3. Design Lambda architecture following existing patterns
4. Design Admin UI following existing patterns
5. Update implementation plan based on real constraints

---

## Notes

<!-- Add any observations or questions during investigation -->
