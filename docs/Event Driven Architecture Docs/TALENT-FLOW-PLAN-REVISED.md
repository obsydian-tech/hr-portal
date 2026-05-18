# TalentFlow — Revised Implementation Plan
> **Date:** 15 May 2026 | **Status:** Planning Complete, Implementation Not Started | **Version:** 2.0.0

---

## Table of Contents

1. [Overview & Objectives](#1-overview--objectives)
2. [Technical Foundation](#2-technical-foundation)
3. [Codebase Status](#3-codebase-status)
4. [Problem Resolution & Architecture Decisions](#4-problem-resolution--architecture-decisions)
5. [Implementation Phases](#5-implementation-phases)
6. [Angular Feature Module, Scripts & Timeline](#6-angular-feature-module-scripts--timeline)

---

## 1. Overview & Objectives

### 1.1 What Is TalentFlow?

TalentFlow is a **12-stage hiring lifecycle platform** built as a fully isolated module inside the existing Naleko HR Portal workspace. It manages the complete candidate journey from application through offer, with AI-assisted evaluation intelligence, configurable business rules, and a full agentic AI foundation.

### 1.2 Primary Objectives

| # | Objective | Detail |
|---|-----------|--------|
| 1 | **Zero regression risk to Naleko** | Fully isolated sibling stack — never modify existing Naleko files |
| 2 | **Copy patterns, not reinvent** | Reuse everything Naleko already has, especially the live agentic AI foundation |
| 3 | **Agentic AI from MVP1** | Reach agentic AI maturity in Week 1–7, not Week 26–34 as originally planned |
| 4 | **Metadata-Lite Architecture (Variable Six)** | All business rules configurable without code deployment from Day 1 |
| 5 | **POPIA compliance from Day 1** | `af-south-1` data residency, PII guard, 5yr audit archive |

### 1.6 Why Metadata-Lite? (Three-Model Synthesis)

This architecture was validated by a three-model synthesis (Claude, ChatGPT, Gemini) + Opus review in May 2026. All three models independently converged on the same core principle:

> **"Business variability belongs in metadata. Platform invariants belong in code."** — ChatGPT
>
> **"The workflow is now data, not code."** — Claude
>
> **"The engine reads a map of how to hire, not hardcoded rules."** — Gemini

**The middle path chosen — Metadata-Lite — sits between two extremes:**

| Approach | Description | Verdict |
|----------|-------------|--------|
| Hardcoded app | Business rules burned into Lambda code | ❌ Rebuild for every client |
| Universal platform | Fully dynamic workflow engine from Day 1 | ❌ Over-engineered, never ships |
| **Metadata-Lite** ✅ | Generic Lambda interpreters read Variable Six from config | ✅ Ships in 7 weeks, scales to N tenants |

**Business case:** The +1 week investment (7 weeks vs 6 weeks) to build the config layer saves an estimated **R1.06M on vertical 2 launch** by eliminating the need to redeploy hardcoded values for each new client. Adding Agriculture (1–2 days) or Banking (2–3 days) becomes a config seed, not a code sprint.

**What stays hardcoded (platform invariants):**
- Orchestration engine logic (EventBridge routing, SAGA state machine)
- Authentication and authorisation infrastructure
- Audit trail and POPIA compliance controls
- The agentic AI loop (intent router, HITL gate, PII guard)

### 1.7 Evolution Path: MVP1 → MVP4 AI Config Assistant

The Metadata-Lite architecture is not just a technical choice — it is the foundation for a 4-phase evolution that ends with an AI that configures the platform through natural language:

| Phase | Capability | Config Method |
|-------|-----------|---------------|
| **MVP1** (Weeks 1–7) | Hiring lifecycle + full agentic AI | Admin UI (3 of 6 Variable Six) + seed script |
| **MVP2** (Weeks 8–14) | Full Variable Six admin UI + Step Functions offer approval | Admin UI (all 6) + multi-tenant support |
| **MVP3** (Weeks 15–20) | Analytics dashboard + SLA trend reporting + config audit trail UI | UI + export |
| **MVP4** (Weeks 21–26) | **AI Config Assistant** — natural language config changes | "Change SLA to 24h" → deployed in 30 seconds |

**MVP4 AI Config Assistant detail:**
- Constrained vocabulary: AI can only modify the Variable Six (not platform code)
- Flow: AI proposes change → human reviews diff → human approves → Lambda deploys new config version
- HITL gate: same `talent-flow-pending-actions` pattern as other write tools — AI never writes config directly
- Success metric: "Increase technical weight to 40%" → new config version live in 30 seconds
- Why this works: Because Variable Six is already in DynamoDB from Day 1, MVP4 only adds the NL → config diff → approval UI layer on top of infrastructure that already exists

This is what ChatGPT called *"Prompts Not Clicks"* — the natural endpoint of externalising business rules into metadata.

### 1.3 Isolation Decision (Locked)

TalentFlow is a **sibling stack**, not a nested module:

- Separate Cognito User Pool
- Separate API Gateway (two: Human REST + Agent API)
- New Terraform files only — zero changes to any existing Naleko `.tf` files
- Dedicated EventBridge bus: `talent-flow-bus` — never shares with `naleko-onboarding`
- New DynamoDB tables — never shares Naleko tables
- Dedicated KMS CMK, S3 bucket, SQS queues

**The only three Naleko files touched:** `app.routes.ts` (add lazy route), `environment.ts` (add env vars), sidebar component (add nav item).

### 1.4 Key Insight: Naleko Already Built What TalentFlow Needs

Naleko v2.0.0 (live as of 11 May 2026) has **31 Lambda functions deployed** including the complete agentic AI stack:

- Intent router (deterministic fast-path)
- HITL gate for all write tools
- Pre+post LLM PII sanitisation (two independent passes)
- DynamoDB prompt cache (SHA-256, 1hr TTL)
- Per-user rate limiting (50 req/hr)
- AI audit trail with POPIA 5yr S3 archive
- 90-day API key rotation via Secrets Manager

All of this can be **copied verbatim** with naming changes, collapsing the MVP roadmap from 34 weeks to 7 weeks for full agentic AI maturity.

### 1.5 MVP1 Scope (Weeks 1–7)

MVP1 delivers **Stages 1–3 Evaluation Intelligence** plus the full agentic foundation:

- Candidate creation with config-version snapshot
- Interview scheduling with panel rules
- Vote submission with configurable scoring weights + STRONG_NO veto toggle
- Evaluation completion with configurable pass threshold
- Config management UI (Variable Six CRUD)
- SLA monitoring (hourly cron)
- Full agentic AI chat (read + write tools with HITL)
- Email notifications via SES

---

## 2. Technical Foundation

### 2.1 Tech Stack

| Layer | Technology | Version / Detail |
|-------|-----------|-----------------|
| Frontend | Angular | 19 |
| UI Components | PrimeNG | 19.1.4 |
| Runtime | AWS Lambda | Node.js 22.x / 24.x |
| AI Models | Amazon Bedrock | Claude Haiku 4.5 (fast) + Claude Sonnet (smart) |
| Database | Amazon DynamoDB | Single-table design per concern |
| Events | Amazon EventBridge | Dedicated `talent-flow-bus` |
| Queues | Amazon SQS | FIFO + DLQ pattern |
| Auth | Amazon Cognito | Dedicated User Pool, PKCE, JWT |
| API | API Gateway HTTP | Dual: Human REST + Agent API |
| IaC | Terraform | New `.tf` files in existing `infra/` |
| Region | `af-south-1` | Cape Town — POPIA data residency |
| Email | Amazon SES | Config-driven templates |
| Storage | Amazon S3 | Audit archive (POPIA 5yr cold) |
| Encryption | AWS KMS | CMK for state + audit tables |
| Secrets | AWS Secrets Manager | Agent API key, 90-day rotation |

### 2.2 Amazon Bedrock Model Strategy

| Path | Model | Trigger Condition | Use Cases |
|------|-------|------------------|-----------|
| **Fast Path** | Claude Haiku 4.5 (`MODEL_FAST`) | `SIMPLE` intent, no tools needed | `candidate_status`, `pipeline_overview`, `vote_summary`, `sla_status` |
| **Smart Path** | Claude Sonnet (`MODEL_SMART`) | `TOOL_REQUIRED` intent, complex reasoning | `evaluation_risk`, `sla_prediction`, `config_recommendation` |

Both models are **already wired up in Naleko** — copied verbatim into TalentFlow.

### 2.3 DynamoDB Table Inventory (7 Tables)

| Table Name | Purpose | Key Pattern |
|------------|---------|-------------|
| `talent-flow-state` | Operational SAGA records (candidates, interviews, votes) | `PK: CANDIDATE#{id}`, `SK: STAGE#{stage}` |
| `talent-flow-config` | Variable Six — versioned tenant config | `PK: TENANT#{tenantId}`, `SK: CONFIG#{configType}#v{version}` |
| `talent-flow-agent-audit` | Full AI audit trail (POPIA) | `PK: AUDIT#{staffId}`, `SK: ISO8601` |
| `talent-flow-prompt-cache` | SHA-256 keyed prompt cache (1hr TTL) | `PK: CACHE#{sha256}` |
| `talent-flow-pending-actions` | HITL gate — pending AI write actions (24hr TTL) | `PK: ACTION#{actionId}` |
| `talent-flow-ai-rate-limit` | Rolling window per-user rate limit (50 req/hr) | `PK: RATE#{staffId}`, `SK: WINDOW#{epoch}` |
| `talent-flow-idempotency-keys` | Idempotency for candidate creation | `PK: IDEM#{key}` |

#### `talent-flow-config` Full Schema (Critical)

This table is the heart of Metadata-Lite. The schema must be exact — wrong PK/SK breaks all Lambda config reads.

```
Table: talent-flow-config
──────────────────────────────────────────────────────────────────
PK  (S): TENANT#{tenantId}               e.g. "TENANT#DEFAULT"
SK  (S): CONFIG#{configType}#v{version}  e.g. "CONFIG#SCORING_WEIGHTS#v3"

GSI1 — for querying active config (used by ALL Lambdas at runtime):
  GSI1PK (S): TENANT#{tenantId}#ACTIVE   e.g. "TENANT#DEFAULT#ACTIVE"
  GSI1SK (S): CONFIG#{configType}        e.g. "CONFIG#SCORING_WEIGHTS"
  Projection: ALL

Attributes:
  configType       (S)  — "SCORING_WEIGHTS" | "SLA_THRESHOLDS" | "APPROVAL_RULES"
                          "PANEL_CONFIG" | "EMAIL_TEMPLATES" | "STAGE_CONFIG"
  version          (N)  — integer, increments on each PUT (1, 2, 3...)
  isActive         (BOOL) — true on latest version, false on all previous
  data             (M)  — JSON blob of the config payload
  createdBy        (S)  — staffId of admin who created this version
  createdAt        (S)  — ISO8601 timestamp
  previousVersion  (N)  — version number of the previous record (audit chain)
  expiresAt        (N)  — Unix epoch TTL — set to createdAt + 365 days
                          on INACTIVE versions only (active versions have no TTL)
──────────────────────────────────────────────────────────────────
```

**Access patterns:**

| Pattern | Operation | Used By |
|---------|-----------|--------|
| Get active config by type | `GSI1` query: `GSI1PK = TENANT#DEFAULT#ACTIVE AND GSI1SK = CONFIG#SCORING_WEIGHTS` | All Lambdas at runtime |
| Get config by specific version | `GetItem`: `PK = TENANT#DEFAULT`, `SK = CONFIG#SCORING_WEIGHTS#v3` | `submitVote`, `completeEvaluation` (locked version) |
| List all versions of a config type | `Query`: `PK = TENANT#DEFAULT`, `SK begins_with CONFIG#SCORING_WEIGHTS` | `manageTalentFlowConfig` audit trail |
| `manageTalentFlowConfig` PUT flow | 1. Get current active version N → 2. Write new version N+1 with `isActive: true` → 3. Update v N to `isActive: false`, set TTL | `manageTalentFlowConfig` |

### 2.4 Cognito User Pool Groups

| Group | Purpose |
|-------|---------|
| `TalentFlowAdmin` | Full access — config management, all candidates |
| `HiringManager` | Create candidates, view pipeline, approve offers |
| `PanelMember` | Submit votes for assigned interviews |
| `ComplianceOfficer` | Read-only audit access |
| `ITAdmin` | Infrastructure and config read |
| `FinanceLead` | Budget approval in offer stage |
| `HRDirector` | Dashboard and reporting |

Custom claim: `custom:isAdmin` (boolean) — used by `manageTalentFlowConfig` Lambda guard.

### 2.5 Metadata-Lite Architecture — The Variable Six

All six business rules are stored in `talent-flow-config` DynamoDB, read at Lambda runtime. **Nothing is hardcoded.**

| Variable | Config Key | Default Value | Read By |
|----------|-----------|---------------|---------|
| Scoring Weights | `scoringWeights` | Tech 30 / Comm 25 / Cultural 25 / ProbSolving 20 | `submitVote` (versioned) |
| SLA Thresholds | `slaThresholds` | Stage-specific hours | `monitorTalentFlowSLAs` (active) |
| Approval Rules | `approvalRules` | Offer threshold, escalation config | `completeEvaluation` (versioned) |
| Panel Size Rules | `panelConfig` | `votesRequired` by position level | `scheduleInterview` (active) |
| Notification Templates | `emailTemplates` | SES HTML templates per event | `sendTalentFlowNotification` (active) |
| Stage Enablement | `stageConfig` | Which of 12 stages are active | `orchestrateTalentFlowWorkflow` (versioned) |

### 2.5b Shared Config Reader Utility (`config-reader.js`)

All workflow Lambdas share a single utility for reading config. **Never duplicate this logic.**

```javascript
// lambda/shared/config-reader.js
const { DynamoDBClient, GetItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const client = new DynamoDBClient({});
const TABLE = process.env.CONFIG_TABLE_NAME; // 'talent-flow-config'
const cache = new Map(); // 5-min in-memory cache per Lambda instance
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Get config — use version param for in-flight candidates (submitVote, completeEvaluation)
 *              omit version to get active config (scheduleInterview, monitorSLAs, notifications)
 */
async function getConfig(tenantId, configType, version = null) {
  const cacheKey = `${tenantId}#${configType}#${version || 'ACTIVE'}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  let data;
  if (version) {
    // Versioned read — locked to candidate's configVersion
    const result = await client.send(new GetItemCommand({
      TableName: TABLE,
      Key: marshall({
        PK: `TENANT#${tenantId}`,
        SK: `CONFIG#${configType}#v${version}`
      })
    }));
    data = result.Item ? unmarshall(result.Item).data : getDefaults(configType);
  } else {
    // Active read — current policy
    const result = await client.send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK = :sk',
      ExpressionAttributeValues: marshall({
        ':pk': `TENANT#${tenantId}#ACTIVE`,
        ':sk': `CONFIG#${configType}`
      }),
      Limit: 1
    }));
    data = result.Items?.length ? unmarshall(result.Items[0]).data : getDefaults(configType);
  }

  cache.set(cacheKey, { data, ts: Date.now() });
  return data;
}

// Defensive fallback — never fail a Lambda invocation due to missing config
function getDefaults(configType) {
  const defaults = {
    SCORING_WEIGHTS: { technical: 30, communication: 25, culturalFit: 25, problemSolving: 20 },
    SLA_THRESHOLDS: { APPLICATION_REVIEW: 24, PHONE_SCREENING: 48, TECHNICAL_INTERVIEW: 72,
                      PANEL_INTERVIEW: 96, EVALUATION: 48, OFFER_PREPARATION: 24,
                      OFFER_APPROVAL: 72, OFFER_DELIVERY: 24 },
    APPROVAL_RULES: { minimumPassScore: 6.0, requireFinanceApprovalAbove: 600000, escalationThresholdDays: 3 },
    PANEL_CONFIG: { rules: { strongNoVeto: true, votesRequired: { JUNIOR: 2, MID: 3, SENIOR: 4, DIRECTOR: 5 } } },
    EMAIL_TEMPLATES: {},
    STAGE_CONFIG: { enabled: ['APPLICATION_REVIEW','PHONE_SCREENING','TECHNICAL_INTERVIEW',
                              'PANEL_INTERVIEW','EVALUATION','BACKGROUND_CHECK','OFFER_PREPARATION',
                              'OFFER_APPROVAL','OFFER_DELIVERY','CONTRACT_SIGNING','PRE_BOARDING','ONBOARDING'] }
  };
  console.warn(`Config not found for ${configType} — using defaults`);
  return defaults[configType] || {};
}

module.exports = { getConfig };
```

**How each Lambda uses it:**

```javascript
// submitVote — uses LOCKED version from candidate record
const { getConfig } = require('../shared/config-reader');
const scoringWeights = await getConfig(tenantId, 'SCORING_WEIGHTS', candidate.configVersion);
const panelConfig    = await getConfig(tenantId, 'PANEL_CONFIG',    candidate.configVersion);

// monitorTalentFlowSLAs — uses ACTIVE config (intentional)
const slaThresholds = await getConfig(tenantId, 'SLA_THRESHOLDS'); // no version = active

// scheduleInterview — uses ACTIVE panel config for new interviews
const panelConfig = await getConfig(tenantId, 'PANEL_CONFIG'); // no version = active
```

### 2.6 Config Versioning Strategy

This is **non-negotiable** for compliance:

```
Candidate Created → configVersion snapshot onto SAGA record (e.g., "v3")
  └─ submitVote reads config at v3 (candidate's locked version)
  └─ completeEvaluation reads config at v3
  └─ Config changes → new v4 created; in-flight candidates unaffected
  └─ SLA monitor reads ACTIVE config (intentional — SLAs apply to all regardless)
```

**Why:** Changing scoring weights mid-evaluation would retroactively alter scores, creating compliance and legal risk.

### 2.7 Agentic AI Architecture (Copied from Naleko)

Five pillars — all live in Naleko, all copied to TalentFlow:

```
┌─────────────────────────────────────────────────────────────────┐
│                    TalentFlow Agentic Loop                       │
│                                                                  │
│  User Request                                                    │
│      │                                                           │
│      ▼                                                           │
│  ┌─────────────┐    SIMPLE     ┌──────────────┐                 │
│  │Intent Router│──────────────▶│ Haiku (Fast) │                 │
│  │(Deterministic)│             └──────────────┘                 │
│  │             │    TOOL_REQ   ┌──────────────┐                 │
│  │             │──────────────▶│Sonnet (Smart)│                 │
│  └─────────────┘               └──────┬───────┘                 │
│                                       │                          │
│                              Tool Calls                          │
│                                       │                          │
│                         ┌────────────▼──────────────┐           │
│                         │    Is it a WRITE tool?     │           │
│                         └────────────┬──────────────┘           │
│                              No      │      Yes                  │
│                              │       │      │                    │
│                         Execute  HITL Gate  │                    │
│                         directly  pending   │                    │
│                              │   action     │                    │
│                              │       │      │                    │
│                         PII Sanitise (post-LLM)                  │
│                              │                                   │
│                         AI Audit Trail                           │
└─────────────────────────────────────────────────────────────────┘
```

**Read Tools (execute directly):** `get_candidate`, `get_pipeline_overview`, `get_vote_summary`, `get_sla_status`, `get_config`, `get_workflow_audit_trail`

**Write Tools (HITL gate — never execute directly):** `schedule_interview`, `flag_sla_risk`, `update_config`

---

## 3. Codebase Status

### 3.1 Existing Naleko Files — READ ONLY (Never Modify)

These files are **reference patterns only**. Copy structure, update names.

| Terraform File | Copy Pattern For |
|---------------|-----------------|
| `infra/cognito.tf` | `talent-flow-cognito.tf` |
| `infra/apigateway.tf` | `talent-flow-apigateway.tf` (Human REST) |
| `infra/agent_api.tf` | `talent-flow-apigateway.tf` (Agent API) |
| `infra/ai_chat.tf` | `talent-flow-ai-chat.tf` |
| `infra/dynamodb.tf` | `talent-flow-dynamodb.tf` |
| `infra/lambdas.tf` | `talent-flow-lambdas.tf` |
| `infra/iam.tf` | `talent-flow-iam.tf` |
| `infra/iam_per_lambda.tf` | `talent-flow-iam.tf` (per-Lambda roles) |
| `infra/eventbridge.tf` | `talent-flow-eventbridge.tf` |
| `infra/stepfunctions.tf` | `talent-flow-stepfunctions.tf` |
| `infra/kms.tf` | `talent-flow-kms.tf` |
| `infra/s3.tf` | `talent-flow-s3.tf` |

| Lambda Directory | Copy Pattern For |
|-----------------|-----------------|
| `lambda/nalekoAiChat/` | `lambda/talentFlowAiChat/` |
| `lambda/agentAuthorizer/` | `lambda/talentFlowAuthorizer/` |
| `lambda/approveAgentAction/` | `lambda/talentFlowApproveAction/` |
| `lambda/archiveAuditLog/` | `lambda/talentFlowArchiveAuditLog/` |
| `lambda/rotateApiKey/` | `lambda/talentFlowRotateApiKey/` |
| `lambda/createEmployee/` | `lambda/createCandidate/` (pattern) |
| `lambda/sendNotificationEmail/` | `lambda/sendTalentFlowNotification/` (pattern) |

### 3.2 New Terraform Files to Create

All new files live inside the existing `infra/` directory.

#### `infra/talent-flow-cognito.tf`
- New dedicated TalentFlow Cognito User Pool
- PKCE auth flow
- 7 User Pool Groups (see section 2.4)
- `custom:isAdmin` attribute
- App client scopes: `openid`, `profile`, `email`

#### `infra/talent-flow-dynamodb.tf`
- 7 tables (see section 2.3)
- `talent-flow-state` and `talent-flow-agent-audit` encrypted with KMS CMK
- TTLs: `talent-flow-pending-actions` (24hr), `talent-flow-prompt-cache` (1hr), `talent-flow-ai-rate-limit` (rolling), `talent-flow-idempotency-keys` (48hr)
- `talent-flow-config`: TTL attribute `expiresAt` — set on inactive versions only (365 days); active versions have no TTL
- `talent-flow-config`: GSI1 (`GSI1PK` hash, `GSI1SK` range, projection ALL) — required for active config queries
- DynamoDB Streams on `talent-flow-state` (for SLA monitor trigger)

#### `infra/talent-flow-apigateway.tf`
- **Gateway 1 — Human REST API**: Cognito JWT authorizer, CORS, routes for all workflow endpoints
- **Gateway 2 — Agent API**: Lambda authorizer (`talentFlowAuthorizer`), x-api-key header, routes for AI chat and action approval

#### `infra/talent-flow-eventbridge.tf`
- Custom bus: `talent-flow-bus`
- 7 routing rules for MVP1:
  1. `CandidateCreated` → `orchestrateTalentFlowWorkflow`
  2. `InterviewScheduled` → `scheduleInterview`
  3. `VoteSubmitted` → `submitVote`
  4. `VotingCompleted` → `completeEvaluation`
  5. `EvaluationCompleted` → `sendTalentFlowNotification`
  6. `SLABreached` → `sendTalentFlowNotification`
  7. `OfferApproved` → `sendTalentFlowNotification`

#### `infra/talent-flow-sqs.tf`
- `talent-flow-notification-queue` + DLQ
- `talent-flow-feedback-queue` + DLQ
- Both FIFO, SSE enabled

#### `infra/talent-flow-ai-chat.tf`
- IAM policy: Bedrock `InvokeModel` for Haiku 4.5 + Sonnet
- `talentFlowAiChat` Lambda declaration + env vars
- `talentFlowApproveAction` Lambda declaration
- `talentFlowRotateApiKey` Lambda declaration
- EventBridge schedule: 90-day API key rotation cron
- KMS key alias: `talent-flow/agent-api-key`

#### `infra/talent-flow-iam.tf`
- Per-Lambda least-privilege IAM roles
- All resource ARNs scoped to `talent-flow-*` resources only
- Roles for: `createCandidate`, `orchestrateTalentFlowWorkflow`, `scheduleInterview`, `submitVote`, `completeEvaluation`, `manageTalentFlowConfig`, `sendTalentFlowNotification`, `monitorTalentFlowSLAs`, `talentFlowAiChat`, `talentFlowAuthorizer`, `talentFlowApproveAction`, `talentFlowArchiveAuditLog`, `talentFlowRotateApiKey`

#### `infra/talent-flow-lambdas.tf`
- All 13 TalentFlow Lambda function declarations
- Runtime: `nodejs22.x`
- Architecture: `arm64`
- Environment variables per Lambda (table names, bus name, Bedrock model IDs, Secrets Manager paths)

#### `infra/talent-flow-stepfunctions.tf`
- State machine: `talent-flow-offer-approval`
- ASL pattern: `WaitForTaskToken`
- Invoked when offer reaches FinanceLead approval stage
- Task token stored on SAGA record

#### `infra/talent-flow-kms.tf`
- CMK alias: `talent-flow/state`
- CMK alias: `talent-flow/agent-audit`
- Key rotation enabled on both

#### `infra/talent-flow-s3.tf`
- Bucket: `talent-flow-audit-archive-{account_id}`
- Lifecycle: 90 days S3 Standard → Glacier Deep Archive
- Retention: POPIA 5-year minimum (object lock)
- Server-side encryption: KMS CMK

### 3.3 New Lambda Functions to Create

#### Workflow Lambdas (8)

| Lambda | Trigger | Key Responsibility |
|--------|---------|-------------------|
| `createCandidate` | POST /candidates (HTTP API) | Idempotency check, write to `talent-flow-state`, publish `CandidateCreated` to `talent-flow-bus` |
| `orchestrateTalentFlowWorkflow` | EventBridge `CandidateCreated` | **Snapshot `configVersion` onto SAGA record**, initialise stage metadata, publish `WorkflowStarted` |
| `scheduleInterview` | EventBridge `InterviewScheduled` | Read `votesRequired` from panel rules config (active), write interview record, notify panel members |
| `submitVote` | EventBridge `VoteSubmitted` | Read scoring weights using candidate's **locked `configVersion`**, apply STRONG_NO veto toggle, check if `votesRequired` met |
| `completeEvaluation` | EventBridge `VotingCompleted` | Apply 6.0/10 pass threshold (from versioned config), publish `EvaluationCompleted` |
| `manageTalentFlowConfig` | POST/PUT/GET /config (HTTP API) | CRUD on Variable Six, create new config version, admin-only (`custom:isAdmin` guard) |
| `sendTalentFlowNotification` | SQS `talent-flow-notification-queue` | Config-driven SES email templates, supports all 7 event types |
| `monitorTalentFlowSLAs` | EventBridge hourly cron | Read **active** (not versioned) SLA thresholds, scan open SAGA records, publish `SLABreached` if threshold exceeded |

**Lambda specs:** Memory 256MB (workflow), runtime `nodejs22.x`, timeout 30s, arm64

#### Agentic AI Lambdas (5 — copied from Naleko)

| Lambda | Source | Changes From Naleko |
|--------|--------|---------------------|
| `talentFlowAiChat` | `nalekoAiChat` | TalentFlow intent templates; tool definitions (6 read + 3 write); table/secret names updated |
| `talentFlowAuthorizer` | `agentAuthorizer` | Secret path: `talent-flow/agent/api-key` |
| `talentFlowApproveAction` | `approveAgentAction` | Table: `talent-flow-pending-actions` |
| `talentFlowArchiveAuditLog` | `archiveAuditLog` | Source: `talent-flow-agent-audit` stream; target: `talent-flow-audit-archive` S3 |
| `talentFlowRotateApiKey` | `rotateApiKey` | Key: `talent-flow/agent/api-key` |

**`talentFlowAiChat` intent templates:**

| Intent | Model | Tools |
|--------|-------|-------|
| `candidate_status` | Haiku (SIMPLE) | `get_candidate` (read) |
| `pipeline_overview` | Haiku (SIMPLE) | `get_pipeline_overview` (read) |
| `vote_summary` | Haiku (SIMPLE) | `get_vote_summary` (read) |
| `sla_status` | Haiku (SIMPLE) | `get_sla_status` (read) |
| `evaluation_risk` | Sonnet (TOOL_REQUIRED) | `get_candidate` + `get_vote_summary` (read) |
| `sla_prediction` | Sonnet (TOOL_REQUIRED) | `get_sla_status` + `get_workflow_audit_trail` (read) |
| `config_recommendation` | Sonnet (TOOL_REQUIRED) | `get_config`, `update_config` (write → HITL) |

**`talentFlowAiChat` specs:** Memory 512MB, timeout 60s, arm64

### 3.4 New Angular Files to Create

Location: `hr-portal/src/app/features/talent-flow/`

> **MVP1 vs MVP2 config UI scope (explicit):**
> - MVP1 builds admin UI for **3 of 6** Variable Six: Scoring Weights, SLA Thresholds, Panel Rules
> - MVP2 will add: Approval Rules UI, Notification Templates UI, Stage Enablement Flags UI
> - Rationale: All 6 are read from config by Lambdas from Day 1. The UI for the remaining 3 is deferred only to keep MVP1 at 7 weeks. Changing those 3 in MVP1 requires updating the seed script and re-seeding — acceptable for early-stage use.

```
talent-flow/
├── talent-flow.routes.ts               # Lazy-loaded routing
├── guards/
│   └── admin.guard.ts                  # Checks custom:isAdmin claim — protects /config routes
├── pages/
│   ├── dashboard/                      # Pipeline overview + KPIs
│   ├── pipeline/                       # Kanban-style stage view
│   ├── candidate-create/               # Create candidate form
│   ├── candidate-workspace/            # Full candidate detail + timeline
│   ├── evaluation/                     # Vote submission UI
│   └── config/
│       ├── scoring-weights/            # MVP1 — Variable Six CRUD (admin-only)
│       ├── sla-thresholds/             # MVP1 — admin-only
│       ├── panel-rules/                # MVP1 — admin-only
│       ├── approval-rules/             # MVP2 — deferred
│       ├── notification-templates/     # MVP2 — deferred
│       └── stage-enablement/          # MVP2 — deferred
├── components/
│   ├── stage-selector/                 # Stage progress indicator
│   ├── evaluation-scoring-panel/       # Vote breakdown with weights
│   ├── sla-timer-widget/               # Live countdown per stage
│   ├── candidate-identity-card/        # Summary card component
│   ├── evaluation-summary-widget/      # Score aggregation display
│   └── ai-chat-panel/                  # Copy of Naleko chat-widget pattern
└── services/
    ├── talent-flow-api.service.ts      # Human REST API calls
    ├── talent-flow-agent-api.service.ts # Agent API calls
    └── talent-flow-state.service.ts    # Client-side state (signals)
```

**Three Naleko files to modify (only additions, no deletions):**

1. `hr-portal/src/app/app.routes.ts` — Add lazy route: `{ path: 'talent-flow', loadChildren: () => import('./features/talent-flow/talent-flow.routes') }`
2. `hr-portal/src/environments/environment.ts` — Add `talentFlow: { apiUrl, agentApiUrl, cognitoConfig }` block
3. Sidebar component — Add TalentFlow nav item

**Admin `isAdmin` claim flow (required for `AdminGuard` to work):**

```
Cognito → create group "TalentFlowAdmin"
  → add admin test users: hr-director@testcompany.com, admin@testcompany.com
  → Cognito JWT includes custom:isAdmin = "true" for members of TalentFlowAdmin group
  → Angular auth service parses claim: isAdmin(): boolean { return this.getClaim('custom:isAdmin') === 'true'; }
  → AdminGuard: canActivate() { return this.authService.isAdmin(); }
  → manageTalentFlowConfig Lambda: if (!event.requestContext.authorizer.claims['custom:isAdmin']) return 403
```

**Tasks required (must be in Phase 0 Terraform + Phase 4 Angular):**
- Terraform: `talent-flow-cognito.tf` must include `aws_cognito_user_group.talent_flow_admin` resource
- Terraform: add pre-token generation Lambda trigger to inject `custom:isAdmin` claim based on group membership
- Angular Phase 4: `admin.guard.ts` functional route guard using `AuthService.isAdmin()`
- Angular Phase 4: `AuthService` updated to expose `isAdmin()` method parsing JWT claim
- Seed: create admin test user in Cognito during local dev setup

### 3.5 New Supporting Files to Create

| File | Purpose |
|------|---------|| `lambda/shared/config-reader.js` | Shared config utility — all workflow Lambdas import this; 5-min cache, versioned + active reads, defaults fallback || `scripts/seed-talent-flow-config.js` | Seeds all 6 Variable Six for tenant `DEFAULT` at `v1` to `talent-flow-config` table |
| `api/talent-flow-openapi.yaml` | Full OpenAPI 3.0 spec for all TalentFlow REST routes |

---

## 4. Problem Resolution & Architecture Decisions

### 4.1 Problem: Hardcoded Scoring Weights in Original Plan

**Original:** PROJECT_CONTEXT.md had hardcoded scoring weights (Tech 30 / Comm 25 / Cultural 25 / ProbSolving 20) burned into Lambda logic.

**Resolution:** All weights moved to `talent-flow-config` table under key `scoringWeights`, read at runtime using the candidate's locked `configVersion`. Changing weights creates a new config version — in-flight candidates are unaffected.

### 4.2 Problem: Missing STRONG_NO Veto Logic

**Original:** STRONG_NO veto was not present in the Lambda catalog or voting logic.

**Resolution:** STRONG_NO is a **configurable boolean toggle** (`panelConfig.rules.strongNoVeto`) stored in `talent-flow-config`. When `true`, a single STRONG_NO vote from any panel member immediately fails the candidate regardless of overall score. `submitVote` Lambda reads this toggle from the candidate's locked `configVersion`.

### 4.3 Problem: Panel Size Hardcoded at 2

**Original:** Panel size was hardcoded at 2 voters, confirmed in 5 places across architecture documents.

**Resolution:** `votesRequired` is stored as a field on each interview record, pre-populated by `scheduleInterview` Lambda which reads `panelConfig.rules.votesRequired` from the active config (keyed by position level: `JUNIOR`, `MID`, `SENIOR`, `DIRECTOR`). This allows different roles to have different panel sizes without code changes.

### 4.4 Problem: Agentic AI Deferred to MVP4 (Week 26)

**Original:** PROJECT_CONTEXT.md planned agentic AI for MVP4, Week 26–34 of the roadmap.

**Resolution:** Naleko v2.0.0 already has the complete agentic AI foundation live in production. All five pillars (intent router, HITL gate, PII guard, prompt cache, AI audit trail) exist as deployable Lambda code. Copying them with TalentFlow naming delivers full agentic AI **in MVP1, Week 1–7** — a 19-week acceleration.

### 4.5 Problem: Config Changes Affecting In-Flight Candidates

**Original:** No versioning strategy existed — any config change would affect all candidates regardless of stage.

**Resolution:** Config versioning with **snapshot-at-creation** pattern:
- `orchestrateTalentFlowWorkflow` writes the current config version (e.g., `"v3"`) onto the SAGA record at creation time
- All evaluation Lambdas (`submitVote`, `completeEvaluation`) read config using the candidate's locked version
- `manageTalentFlowConfig` never mutates existing versions — always creates a new version record
- `monitorTalentFlowSLAs` **intentionally reads active config** (not versioned) — SLA thresholds apply to all open work regardless of when the candidate was created

### 4.6 Decision: Two API Gateways (Not One)

**Decision:** TalentFlow has two separate API Gateways, matching Naleko's dual-gateway pattern.

| Gateway | Auth Method | Consumers | Routes |
|---------|------------|-----------|--------|
| Human REST API | Cognito JWT (`Authorization` header) | Angular frontend | `/candidates`, `/interviews`, `/votes`, `/config`, `/pipeline` |
| Agent API | Lambda authorizer (`x-api-key` header) | AI chat, external agents | `/agent/chat`, `/agent/actions/{id}/approve`, `/agent/actions/{id}/reject` |

**Why separate:** Agent API has different authentication requirements (rotating API key vs. user JWT), different rate limiting, and different audit requirements. Mixing them creates security boundary confusion.

### 4.7 Decision: EventBridge Over Direct Lambda Invocation

**Decision:** All inter-Lambda communication goes through `talent-flow-bus` EventBridge, not direct Lambda invocations.

**Why:**
- Decoupled — adding a new consumer (e.g., a compliance webhook) requires no changes to publisher Lambda
- Replay capability — failed events can be replayed from EventBridge archive
- Observability — all events visible in EventBridge monitoring
- Matches Naleko's proven pattern

### 4.8 Decision: Step Functions Only for Offer Approval

**Decision:** Step Functions is used **only** for the offer approval workflow (`talent-flow-offer-approval` state machine), not for the full hiring lifecycle.

**Why:** The hiring lifecycle is event-driven (EventBridge + SAGA pattern in DynamoDB) which is simpler, cheaper, and more observable. Step Functions adds value only for the offer stage because it requires human approval via `WaitForTaskToken` with long-running state (days to weeks for finance approval).

### 4.9 Key Invariants (Non-Negotiable)

These must be preserved throughout all implementation:

| # | Invariant | Consequences if Violated |
|---|-----------|--------------------------|
| 1 | `configVersion` MUST be snapshotted onto every SAGA record at creation | In-flight evaluations use wrong scoring weights → compliance violation |
| 2 | `submitVote` MUST read scoring config using candidate's locked `configVersion` | Retroactive score changes → legal risk |
| 3 | SLA monitor MUST read active config, not versioned | Old SLA thresholds applied → SLAs never breached correctly |
| 4 | All write-prefix AI tools MUST route through `talent-flow-pending-actions` HITL gate | AI executes write operations without human approval → audit failure |
| 5 | PII sanitisation MUST run pre-LLM AND post-LLM (two independent passes) | PII sent to Bedrock or returned to user → POPIA violation |
| 6 | `terraform plan` MUST show zero changes to Naleko resources before any `apply` | Naleko production regression risk |

---

## 5. Implementation Phases

### Phase 0 — Terraform Foundation

**Goal:** All AWS infrastructure deployed, Naleko untouched, `terraform plan` confirms zero changes to existing resources.

**Steps (in order):**

1. Create `infra/talent-flow-kms.tf` — CMKs first (other resources depend on them)
2. Create `infra/talent-flow-cognito.tf` — User Pool, groups, app client
3. Create `infra/talent-flow-dynamodb.tf` — All 7 tables with TTLs, streams, encryption
4. Create `infra/talent-flow-s3.tf` — Audit archive bucket with lifecycle + object lock
5. Create `infra/talent-flow-sqs.tf` — Notification + feedback queues with DLQs
6. Create `infra/talent-flow-eventbridge.tf` — Bus + 7 routing rules
7. Create `infra/talent-flow-iam.tf` — All per-Lambda IAM roles (scoped to talent-flow-* ARNs)
8. Create `infra/talent-flow-lambdas.tf` — All 13 Lambda declarations (code deployed later)
9. Create `infra/talent-flow-apigateway.tf` — Dual gateways with authorizers
10. Create `infra/talent-flow-stepfunctions.tf` — Offer approval state machine
11. Create `infra/talent-flow-ai-chat.tf` — Bedrock IAM + AI Lambda declarations + rotation schedule

**Validation:** `terraform plan` → must show 0 changes to existing resources, only additions.

---

### Phase 1 — Workflow Lambdas (MVP1 Milestone 1–2)

**Goal:** End-to-end candidate creation → interview scheduling flow working.

#### Milestone 1: Infrastructure + Candidate Creation + Config Layer

**Tasks:**

- [ ] `lambda/shared/config-reader.js` — Create shared utility FIRST (all other Lambdas depend on it). Implement versioned read (GetItem), active read (GSI1 Query), 5-min cache, defaults fallback. See §2.5b for full implementation.
- [ ] `lambda/createCandidate/index.js` — Implement idempotency check (DynamoDB `talent-flow-idempotency-keys`), write SAGA record to `talent-flow-state`, publish `CandidateCreated` to `talent-flow-bus`. Copy error handling pattern from `lambda/createEmployee/`.
- [ ] `lambda/orchestrateTalentFlowWorkflow/index.js` — Consume `CandidateCreated`, call `getConfig(tenantId, 'SCORING_WEIGHTS')` (active, no version) to read active config version number, **snapshot `configVersion` onto SAGA record**, initialise stage array from `STAGE_CONFIG`, publish `WorkflowStarted`.
- [ ] `lambda/manageTalentFlowConfig/index.js` — GET/POST/PUT for Variable Six. POST: (1) query current active version N via GSI1, (2) write new item at v(N+1) with `isActive: true` and `GSI1PK: TENANT#DEFAULT#ACTIVE`, (3) update v(N) to `isActive: false`, remove GSI1PK, set `expiresAt` TTL. Guard: reject if `custom:isAdmin` claim is not `true`.
- [ ] `scripts/seed-talent-flow-config.js` — Seed `DEFAULT` tenant config at `v1` for all 6 configTypes. Each item: `PK: TENANT#DEFAULT`, `SK: CONFIG#{type}#v1`, `GSI1PK: TENANT#DEFAULT#ACTIVE`, `GSI1SK: CONFIG#{type}`, `isActive: true`, `version: 1`. See §6.2 for full seed data.
- [ ] **Cognito admin setup** — Create `TalentFlowAdmin` user group in Cognito (Terraform). Add pre-token-generation Lambda trigger to inject `custom:isAdmin: "true"` claim for group members. Create test admin user `hr-director@testcompany.com` in dev environment.

**Test:** POST /candidates → DynamoDB record exists with `configVersion: "v1"` → EventBridge event delivered → `orchestrateTalentFlowWorkflow` invoked.

#### Milestone 2: Interview Scheduling

**Tasks:**

- [ ] `lambda/scheduleInterview/index.js` — Consume `InterviewScheduled`, call `getConfig(tenantId, 'PANEL_CONFIG')` (active — no version), read `votesRequired` by `positionLevel`, write `votesRequired` onto interview record in `talent-flow-state`, publish panel member assignment events, publish to SQS notification queue.
- [ ] `lambda/sendTalentFlowNotification/index.js` — SQS consumer, call `getConfig(tenantId, 'EMAIL_TEMPLATES')` (active), resolve template name by event type, send via SES. Copy pattern from `lambda/sendNotificationEmail/`.

**Test:** POST /interviews → interview record has `votesRequired` field → panel members receive SES email.

---

### Phase 2 — Voting + Evaluation (MVP1 Milestone 3)

**Goal:** Full evaluation flow from vote submission to evaluation completion.

#### Milestone 3: Evaluation + Admin Config UI

**Tasks:**

- [ ] `lambda/submitVote/index.js` — Consume `VoteSubmitted`, fetch candidate SAGA to get `candidate.configVersion`, call `getConfig(tenantId, 'SCORING_WEIGHTS', candidate.configVersion)` and `getConfig(tenantId, 'PANEL_CONFIG', candidate.configVersion)` (**both versioned — locked to candidate's version**), apply weights to compute weighted score, check `panelConfig.rules.strongNoVeto` toggle, check if `votesSubmitted >= votesRequired`, publish `VotingCompleted` when quorum met.
- [ ] `lambda/completeEvaluation/index.js` — Consume `VotingCompleted`, call `getConfig(tenantId, 'APPROVAL_RULES', candidate.configVersion)` (**versioned**), compare final score vs `minimumPassScore`, publish `EvaluationCompleted` (pass/fail), update SAGA stage.

**Scoring calculation:**
```
weightedScore = (techScore * techWeight + commScore * commWeight +
                 culturalScore * culturalWeight + probSolvingScore * probSolvingWeight) / 100
```

**STRONG_NO logic:**
```
if (vote.rating === 'STRONG_NO' && config.panelConfig.rules.strongNoVeto === true) {
  → immediately publish EvaluationCompleted with result: 'FAILED', reason: 'STRONG_NO_VETO'
}
```

**Test:** Submit votes → scores aggregated using v1 config weights → change config to v2 → verify in-flight candidate still uses v1 weights.

---

### Phase 3 — SLA Monitoring + Agentic AI (MVP1 Milestone 4)

**Goal:** SLA monitoring live, full agentic AI foundation deployed.

#### SLA Monitor

- [ ] `lambda/monitorTalentFlowSLAs/index.js` — Hourly EventBridge cron, scan `talent-flow-state` for open SAGA records, call `getConfig(tenantId, 'SLA_THRESHOLDS')` (**active only — no version parameter — intentional design decision**: current SLA policy applies to all open candidates regardless of when they were created), compare `stageEnteredAt` vs. threshold hours, publish `SLABreached` events for violations.

**Test:** Advance system clock simulation → `SLABreached` event fires → notification sent.

#### Agentic AI Lambdas

- [ ] `lambda/talentFlowAiChat/` — Copy `lambda/nalekoAiChat/` verbatim. Update: (1) intent routing table (7 intents per section 3.3), (2) tool definitions (6 read + 3 write), (3) table names to `talent-flow-*`, (4) secret path to `talent-flow/agent/api-key`, (5) system prompt to TalentFlow context.
- [ ] `lambda/talentFlowAuthorizer/` — Copy `lambda/agentAuthorizer/`. Update secret path only.
- [ ] `lambda/talentFlowApproveAction/` — Copy `lambda/approveAgentAction/`. Update table name to `talent-flow-pending-actions`.
- [ ] `lambda/talentFlowArchiveAuditLog/` — Copy `lambda/archiveAuditLog/`. Update source table and target bucket name.
- [ ] `lambda/talentFlowRotateApiKey/` — Copy `lambda/rotateApiKey/`. Update secret name.

**Validation checklist for `talentFlowAiChat`:**
- [ ] Prompt cache hit avoids Bedrock call (SHA-256 key, read from `talent-flow-prompt-cache`)
- [ ] Rate limit enforced at 50 req/hr per staffId
- [ ] `schedule_interview` tool routed to `talent-flow-pending-actions` (never executed directly)
- [ ] `update_config` tool routed to HITL gate
- [ ] PII stripped from tool responses before Bedrock call
- [ ] PII stripped from Bedrock response before returning to user
- [ ] Full audit record written to `talent-flow-agent-audit` (model, tokens, cost, latency, intent, tool calls)

---

### Phase 4 — Angular Feature Module

**Goal:** Full TalentFlow UI accessible at `/talent-flow`, no Naleko UI broken.

**Steps:**

1. Create `hr-portal/src/app/features/talent-flow/talent-flow.routes.ts`
2. Add lazy route to `app.routes.ts`
3. Add TalentFlow env vars to `environment.ts`
4. Add nav item to sidebar component
5. Build `AuthService` update: add `isAdmin(): boolean` method parsing `custom:isAdmin` JWT claim
6. Build `AdminGuard`: `canActivate() { return inject(AuthService).isAdmin(); }` — protects all `/talent-flow/config/*` routes
7. Build pages (dashboard → pipeline → candidate-create → candidate-workspace → evaluation → config pages — 3 MVP1 config pages only, 3 MVP2 deferred)
8. Build components (in dependency order: `candidate-identity-card` → `stage-selector` → `sla-timer-widget` → `evaluation-scoring-panel` → `evaluation-summary-widget` → `ai-chat-panel`)
9. Build services (`talent-flow-api.service.ts`, `talent-flow-agent-api.service.ts`, `talent-flow-state.service.ts`)

**Angular 19 patterns to use:** Standalone components, `signal()`-based state, `inject()` for DI, typed `HttpClient` responses, functional route guards.

---

## 6. Angular Feature Module, Scripts, OpenAPI & Timeline

### 6.1 Angular Feature Module — Component Specifications

#### Pages

| Page | Route | Component | Key Features |
|------|-------|-----------|-------------|
| Dashboard | `/talent-flow` | `DashboardPageComponent` | KPI cards (active candidates, avg score, SLAs breached), pipeline funnel chart (PrimeNG Chart.js), recent activity feed |
| Pipeline | `/talent-flow/pipeline` | `PipelinePageComponent` | Kanban-style column view per stage, candidate cards, DnD stage change (HiringManager only), SLA timer on each card |
| Candidate Create | `/talent-flow/candidates/new` | `CandidateCreatePageComponent` | Reactive form (Angular 19 `FormBuilder`), position level selector (triggers `votesRequired` preview), submit → `createCandidate` Lambda |
| Candidate Workspace | `/talent-flow/candidates/:id` | `CandidateWorkspacePageComponent` | Full timeline, identity card, current stage, documents, AI chat panel, vote history |
| Evaluation | `/talent-flow/candidates/:id/evaluate` | `EvaluationPageComponent` | Scoring panel per dimension, STRONG_NO toggle (if config enabled), submit vote → `submitVote` Lambda |
| Config — Scoring Weights | `/talent-flow/config/scoring` | `ScoringWeightsPageComponent` | Admin-only, weight sliders (must sum to 100), version preview, save creates new version |
| Config — SLA Thresholds | `/talent-flow/config/sla` | `SLAThresholdsPageComponent` | Admin-only, per-stage hour inputs |
| Config — Panel Rules | `/talent-flow/config/panel` | `PanelRulesPageComponent` | Admin-only, votes required by position level, STRONG_NO toggle |

#### Shared Components

| Component | Inputs | Outputs |
|-----------|--------|---------|
| `StageSelector` | `stages: Stage[]`, `currentStage: string` | `stageSelected: EventEmitter<string>` |
| `EvaluationScoringPanel` | `weights: ScoringWeights`, `readOnly: boolean` | `scoreSubmitted: EventEmitter<VotePayload>` |
| `SlaTimerWidget` | `stageEnteredAt: Date`, `thresholdHours: number` | `slaBreached: EventEmitter<void>` |
| `CandidateIdentityCard` | `candidate: Candidate` | — |
| `EvaluationSummaryWidget` | `votes: Vote[]`, `weights: ScoringWeights` | — |
| `AiChatPanel` | `candidateId: string` | — (copy Naleko chat-widget pattern) |

#### Services

```typescript
// talent-flow-api.service.ts
getCandidates(filters?: PipelineFilters): Observable<Candidate[]>
getCandidate(id: string): Observable<Candidate>
createCandidate(payload: CreateCandidatePayload): Observable<Candidate>
scheduleInterview(candidateId: string, payload: ScheduleInterviewPayload): Observable<Interview>
submitVote(candidateId: string, payload: VotePayload): Observable<void>
getConfig(tenant: string, version?: string): Observable<TalentFlowConfig>
updateConfig(tenant: string, config: Partial<TalentFlowConfig>): Observable<TalentFlowConfig>

// talent-flow-agent-api.service.ts
chat(message: string, context: ChatContext): Observable<ChatResponse>
approveAction(actionId: string): Observable<void>
rejectAction(actionId: string, reason: string): Observable<void>

// talent-flow-state.service.ts — signals-based
readonly pipeline = signal<Candidate[]>([])
readonly activeCandidateId = signal<string | null>(null)
readonly configVersion = signal<string>('v1')
```

### 6.2 Seed Script Specification

**File:** `scripts/seed-talent-flow-config.js`

Seeds the following to `talent-flow-config` table, tenant `DEFAULT`, version `v1`:

```json
{
  "scoringWeights": {
    "technical": 30,
    "communication": 25,
    "culturalFit": 25,
    "problemSolving": 20
  },
  "slaThresholds": {
    "APPLICATION_REVIEW": 24,
    "PHONE_SCREENING": 48,
    "TECHNICAL_INTERVIEW": 72,
    "PANEL_INTERVIEW": 96,
    "EVALUATION": 48,
    "OFFER_PREPARATION": 24,
    "OFFER_APPROVAL": 72,
    "OFFER_DELIVERY": 24
  },
  "approvalRules": {
    "minimumPassScore": 6.0,
    "requireFinanceApprovalAbove": 600000,
    "escalationThresholdDays": 3
  },
  "panelConfig": {
    "rules": {
      "strongNoVeto": true,
      "votesRequired": {
        "JUNIOR": 2,
        "MID": 3,
        "SENIOR": 4,
        "DIRECTOR": 5
      }
    }
  },
  "emailTemplates": {
    "CANDIDATE_CREATED": "template-candidate-created-v1",
    "INTERVIEW_SCHEDULED": "template-interview-scheduled-v1",
    "EVALUATION_COMPLETED": "template-evaluation-completed-v1",
    "OFFER_APPROVED": "template-offer-approved-v1",
    "SLA_BREACHED": "template-sla-breached-v1"
  },
  "stageConfig": {
    "enabled": [
      "APPLICATION_REVIEW", "PHONE_SCREENING", "TECHNICAL_INTERVIEW",
      "PANEL_INTERVIEW", "EVALUATION", "BACKGROUND_CHECK",
      "OFFER_PREPARATION", "OFFER_APPROVAL", "OFFER_DELIVERY",
      "CONTRACT_SIGNING", "PRE_BOARDING", "ONBOARDING"
    ]
  }
}
```

### 6.3 OpenAPI Specification Summary

**File:** `api/talent-flow-openapi.yaml`

| Method | Path | Lambda | Auth |
|--------|------|--------|------|
| `POST` | `/candidates` | `createCandidate` | Cognito JWT |
| `GET` | `/candidates` | Query `talent-flow-state` | Cognito JWT |
| `GET` | `/candidates/{id}` | Query `talent-flow-state` | Cognito JWT |
| `POST` | `/candidates/{id}/interviews` | `scheduleInterview` | Cognito JWT |
| `POST` | `/candidates/{id}/votes` | `submitVote` | Cognito JWT |
| `GET` | `/pipeline` | Query `talent-flow-state` + aggregation | Cognito JWT |
| `GET` | `/config` | `manageTalentFlowConfig` | Cognito JWT |
| `POST` | `/config` | `manageTalentFlowConfig` | Cognito JWT + `isAdmin` |
| `PUT` | `/config/{version}` | `manageTalentFlowConfig` | Cognito JWT + `isAdmin` |
| `POST` | `/agent/chat` | `talentFlowAiChat` | Agent API Key |
| `POST` | `/agent/actions/{id}/approve` | `talentFlowApproveAction` | Agent API Key |
| `POST` | `/agent/actions/{id}/reject` | `talentFlowApproveAction` | Agent API Key |

### 6.4 MVP1 Timeline (7 Weeks)

| Week | Milestone | Deliverables | Done When |
|------|-----------|--------------|-----------|
| 1 | Terraform Foundation | All `infra/talent-flow-*.tf` files applied, `terraform plan` clean | AWS console shows all resources |
| 2 | Candidate Creation + Config | `createCandidate`, `orchestrateTalentFlowWorkflow`, `manageTalentFlowConfig`, seed script | POST /candidates returns 201, DynamoDB record has `configVersion` |
| 3 | Interview Scheduling | `scheduleInterview`, `sendTalentFlowNotification`, SQS wired | Interview record has `votesRequired`, panel email received |
| 4 | Voting + Evaluation | `submitVote` (versioned config), `completeEvaluation`, STRONG_NO | Vote quorum triggers `EvaluationCompleted`, score uses v1 weights |
| 5 | SLA + Agentic AI | `monitorTalentFlowSLAs`, all 5 agentic AI Lambdas deployed | SLA breach fires, AI chat responds, HITL gate blocks write tools |
| 6 | Angular Module | All pages and components, services, lazy-loaded route | `/talent-flow` renders, full flow end-to-end in browser |
| 7 | Polish + OpenAPI | `api/talent-flow-openapi.yaml`, E2E Playwright tests, README | Playwright green, OpenAPI validates |

### 6.4b Config Migration Strategy

The Metadata-Lite schema is designed to be **forward-compatible**. Adding a new field to an existing config type (e.g., adding `leadershipScore` to `SCORING_WEIGHTS`) requires:

1. Update `manageTalentFlowConfig` validation to accept the new field (one Lambda deploy)
2. Create a new config version via the admin UI (or seed script) that includes the new field
3. Old config versions without the field are unaffected — `config-reader.js` defaults handle missing keys gracefully
4. New candidates will use the new version; in-flight candidates continue with their locked version

**No data migration required.** This is the key advantage of the JSON blob `data` attribute — the schema is self-describing per version.

### 6.5 Cost Estimate (MVP1)

| Service | Est. Monthly | Notes |
|---------|-------------|-------|
| Lambda | ~$0 | Well within free tier at low volume |
| DynamoDB | ~$0 | On-demand, minimal reads/writes |
| Bedrock | ~$2–8 | Haiku $0.25/MTok input; Sonnet ~$6/MTok input. Prompt cache reduces by ~60% |
| API Gateway | ~$0 | Free tier |
| EventBridge | ~$0 | Free tier |
| SES | ~$0 | Minimal emails |
| S3 | ~$0 | Audit archive, minimal writes |
| **Total** | **~$2–8/month** | |

### 6.6 Dependency Graph (Critical Path)

```
talent-flow-kms.tf
    └─► talent-flow-dynamodb.tf
    └─► talent-flow-s3.tf
talent-flow-cognito.tf
    └─► talent-flow-apigateway.tf (Cognito authorizer)
talent-flow-iam.tf
    └─► talent-flow-lambdas.tf
talent-flow-lambdas.tf
    └─► talent-flow-apigateway.tf (Lambda integrations)
    └─► talent-flow-eventbridge.tf (Lambda targets)
    └─► talent-flow-stepfunctions.tf (Lambda invoker)
talent-flow-sqs.tf
    └─► talent-flow-lambdas.tf (SQS event source mapping)

Lambda code (after infrastructure):
createCandidate → orchestrateTalentFlowWorkflow → scheduleInterview
    → submitVote → completeEvaluation → monitorTalentFlowSLAs
    → talentFlowAiChat (last — depends on all tables existing)

Angular (after all Lambda endpoints deployed):
services → components → pages → routes → sidebar
```

### 6.6b Vertical Expansion Examples (Business Case)

Once Metadata-Lite is live, adding a new client requires **only a config seed** — no code changes:

| Vertical | Config Changes | Time to Launch | Code Changes |
|----------|---------------|---------------|-------------|
| Agriculture cooperative | Lower `votesRequired` (SENIOR: 2), shorter SLA (24h interview), no finance approval | 1–2 days | Zero |
| Banking / financial services | Strict scoring (Tech weight: 50), mandatory C-level approval for all offers, 6-person panels | 2–3 days | Zero |
| Healthcare | Compliance stage enablement, extended background check SLA, STRONG_NO veto required | 1 day | Zero |
| **Without Metadata-Lite** | Hardcode every rule per client | 4–6 weeks per vertical | Full Lambda redeployment |

**Estimated saving:** R1.06M per vertical launch (vs hardcoded rebuild approach).

### 6.7 Progress Tracking

| Phase | Status | Notes |
|-------|--------|-------|
| Planning | ✅ Complete | All architecture decisions locked |
| Phase 0 — Terraform | ⏸ Not started | Start here |
| Phase 1 — Workflow Lambdas (M1–2) | ⏸ Not started | After Terraform |
| Phase 2 — Voting + Evaluation (M3) | ⏸ Not started | After Phase 1 |
| Phase 3 — SLA + Agentic AI (M4) | ⏸ Not started | After Phase 2 |
| Phase 4 — Angular Module | ⏸ Not started | After Phase 3 |
| Phase 5 — Polish + Tests | ⏸ Not started | Final week |

---

### 6.8 v1.0 → v2.0 Changes Summary

This table captures every meaningful change between the original hardcoded architecture (v1.0) and the Metadata-Lite architecture (v2.0) in this plan. Use it to explain the evolution to new team members or stakeholders.

| Area | v1.0 (Hardcoded) | v2.0 (Metadata-Lite) | Impact |
|------|-----------------|---------------------|--------|
| **Scoring weights** | Hard-coded in `submitVote`: `technical * 0.30` | Read from `talent-flow-config` at candidate's locked `configVersion` | Change weights without code deploy; in-flight candidates unaffected |
| **STRONG_NO veto** | Not implemented | Configurable boolean toggle `panelConfig.rules.strongNoVeto` | Enable/disable per tenant via admin UI |
| **Panel size** | Hardcoded at 2 voters | `panelConfig.rules.votesRequired` by position level (JUNIOR/MID/SENIOR/DIRECTOR) | Different panel sizes per role, no code change |
| **Pass threshold** | Hardcoded `6.0` in `completeEvaluation` | `approvalRules.minimumPassScore` from versioned config | Adjustable per tenant |
| **SLA thresholds** | Hardcoded `48h`/`72h` in `monitorTalentFlowSLAs` | Read from `talent-flow-config` active config at cron runtime | Change SLA policy without Lambda redeploy |
| **Email templates** | Hardcoded SES template names | `emailTemplates` config key, template name resolved by event type | Add/change templates without code |
| **Stage enablement** | All 12 stages always active | `stageConfig.enabled[]` array in config | Enable/disable stages per tenant (e.g., skip background check) |
| **Config table** | Did not exist | `talent-flow-config` with PK/SK versioning + GSI1 for active queries | Foundation for all runtime config reads |
| **Config versioning** | Did not exist | Snapshot `configVersion` at candidate creation; in-flight locked | Audit compliance — retroactive score changes impossible |
| **Config reader** | Each Lambda duplicated DynamoDB logic | Shared `lambda/shared/config-reader.js` (5-min cache, versioned + active, defaults) | DRY, consistent caching, single point of change |
| **Admin UI scope** | No config UI | 3 of 6 Variable Six in MVP1; all 6 in MVP2 | Config changes via UI, not seed script re-run |
| **Admin role** | No admin Cognito group | `TalentFlowAdmin` group + pre-token Lambda + `custom:isAdmin` claim + `AdminGuard` | Config routes protected from non-admin users |
| **Agentic AI timeline** | MVP4 (Week 26+) | MVP1 (Week 1–7) — copied from live Naleko | 19-week acceleration |
| **Timeline** | 6 weeks (240h) | 7 weeks (280h) | +40h for config layer — saves R1.06M on vertical 2 |
| **Multi-tenant** | Single tenant implicit | `tenantId` in all config keys from Day 1 | Add new tenant with seed script only |
| **Vertical expansion** | Full code redeployment per client | Config seed only (1–3 days) | R1.06M saving per vertical launch |
| **MVP4 evolution** | Not planned | AI Config Assistant — NL → config diff → HITL approval | "Prompts Not Clicks" — natural language platform management |

---

*End of TALENT-FLOW-PLAN-REVISED.md — Document complete. Version 2.0.0, 15 May 2026.*
