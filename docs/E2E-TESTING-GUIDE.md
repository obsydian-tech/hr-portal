# TalentFlow E2E Testing & Troubleshooting Guide

**Living document — updated as we test and fix.**
Last updated: 2026-06-01

---

## How to use this guide

This is a running log of every bug found, confirmed, and fixed during end-to-end workflow testing of the TalentFlow platform. For each issue it captures:
- What broke and what error to look for
- Which AWS service / layer to investigate
- The root cause
- The fix (always at the correct layer — no data seeding shortcuts)
- Status

---

## Test Candidate

| Field | Value |
|---|---|
| **Candidate ID** | `CAND-01KT11912DY8NAC0F9PNQ6DMKF` |
| **Name** | June July |
| **Email** | june@gmail.com |
| **Position** | Senior Accountant |
| **Created** | 2026-06-01T07:27:23Z |
| **Created by** | iggytanakamush@gmail.com (TalentFlowAdmin) |
| **Starting stage** | `APPLICATION_REVIEW` |

---

## Platform Users & Roles (NALEKO tenant)

### TalentFlow Cognito Pool (`af-south-1_C8TTlQxY7`)

| User | Email | Groups | Notes |
|---|---|---|---|
| Ignecious M | iggytanakamush@gmail.com | TalentFlowAdmin | Primary test admin |
| Ignecious M | ignecious@obsydiantechnologies.com | TalentFlowAdmin | Secondary admin |
| Tshepo Mashego | joworesources@gmail.com | HiringManager | HM for interview flow |

### Groups with no users assigned ⚠️

| Group | Required for |
|---|---|
| `PanelMember` | Interview panel scoring |
| `ComplianceOfficer` | Compliance review stage |
| `FinanceLead` | Offer approval chain |
| `ITAdmin` / `ITSpecialist` | IT provisioning queue |

> **Action needed:** Assign real users to these groups in Cognito before testing those stages.

### Naleko Pool (`af-south-1_2LdAGFnw2`)

| User | Naleko Groups | TalentFlow access |
|---|---|---|
| (same users above) | `naleko-talentflow-admin` | via pool consolidation |

---

## Config State (talent-flow-config table)

### What exists

27 config items across `TENANT#NALEKO` and `TENANT#DEFAULT`:

| Config Type | NALEKO versions | DEFAULT |
|---|---|---|
| SCORING_WEIGHTS | v1, v2, v3 | v1 |
| SLA_THRESHOLDS | v1, v2 | v1 |
| STAGE_CONFIG | v1 | v1 |
| PANEL_CONFIG | v1 | v1 |
| APPROVAL_RULES | v1, v2 | v1 |
| IT_QUEUES | v1, v2, v3, v4 | v1 |
| PROVISIONING_TEMPLATES | v1, v2 | v1 |
| ROUTING_RULES | v1 | v1 |
| EMAIL_TEMPLATES | v1 | v1 |
| SENTIMENT_SCALES | — | v1 |

### How active config works

The `manageTalentFlowConfig` lambda stores active config items with:
```
GSI1PK = TENANT#<tenantId>#ACTIVE
GSI1SK = CONFIG#<configType>
```

The `orchestrateTalentFlowWorkflow` lambda's config-reader queries this GSI (`GSI1-active-configs`) to load the active version for each config type at candidate creation time. If no active item is found it logs a WARN and uses hardcoded defaults.

### Problem

The existing config items in DynamoDB were likely saved before the GSI1 active-key pattern was in place, or were created manually without going through the admin UI PUT/POST flow. They do **not** have the `GSI1PK = TENANT#NALEKO#ACTIVE` attribute set.

### Fix (correct layer)

Re-save each config type through the Admin UI (`/platform/talentflow/admin`) using the **Save / Update** button. The `manageTalentFlowConfig` PUT handler sets the GSI1PK correctly on save. Do **not** seed data directly into DynamoDB.

---

## Bugs Found & Fix Status

---

### BUG-001 — `orchestrateTalentFlowWorkflow` cannot Query config table

| Field | Detail |
|---|---|
| **Severity** | High |
| **Status** | ✅ Fixed — `infra/iam-patches.tf` (pending deploy) |
| **Discovered** | 2026-06-01 via CloudWatch |
| **Affects** | Every new candidate |

**Symptom:** Every new candidate gets `configVersion = NULL` in the SAGA record. Scoring weights and stage config always fall back to hardcoded defaults regardless of admin configuration.

**Where to look:**
- CloudWatch → `/aws/lambda/orchestrateTalentFlowWorkflow` → filter: `SCORING_WEIGHTS`
- DynamoDB → `talent-flow-state` → item `PK: CANDIDATE#<id> SK: SAGA` → check `configVersion`

**Error in CloudWatch:**
```
ERROR config-reader: getConfigItem DynamoDB error for NALEKO/SCORING_WEIGHTS:
User: arn:aws:sts::937137806477:assumed-role/talent-flow-role-orchestrateTalentFlowWorkflow/...
is not authorized to perform: dynamodb:Query on resource:
arn:aws:dynamodb:af-south-1:937137806477:table/talent-flow-config/index/GSI1-active-configs
```

**Root cause:** The existing inline policy on `talent-flow-role-orchestrateTalentFlowWorkflow` only grants `dynamodb:GetItem` on the table ARN. The config-reader uses `QueryCommand` against the `GSI1-active-configs` GSI — `Query` permission on the index ARN was never granted.

**Fix:** `infra/iam-patches.tf` → `aws_iam_role_policy.orchestrate_config_query`
Adds `dynamodb:Query` + `dynamodb:GetItem` on both the table and `/index/*` ARN.

---

### BUG-002 — `createCandidate` cannot mark idempotency key COMPLETED

| Field | Detail |
|---|---|
| **Severity** | Medium |
| **Status** | ✅ Fixed — `infra/iam-patches.tf` (pending deploy) |
| **Discovered** | 2026-06-01 via CloudWatch |
| **Affects** | Every new candidate creation — retry safety broken |

**Symptom:** Candidate IS created successfully, but the idempotency record stays `IN_PROGRESS`. If the same `idempotencyKey` is retried (e.g., double-click, network retry), the API returns `409 Conflict` instead of returning the already-created candidate.

**Where to look:**
- CloudWatch → `/aws/lambda/createCandidate` → filter: `Failed to mark idempotency`
- DynamoDB → `talent-flow-idempotency-keys` → look up the idempotencyKey from the request

**Error in CloudWatch:**
```
WARN Failed to mark idempotency COMPLETED {
  idempotencyKey: '37001220-...',
  candidateId: 'CAND-01KT11912...',
  error: 'User: ...createCandidate... is not authorized to perform:
  dynamodb:UpdateItem on resource: .../talent-flow-idempotency-keys'
}
```

**Root cause:** `createCandidate` writes the idempotency record as `IN_PROGRESS` via `PutItemCommand`, then after success calls `UpdateItemCommand` to mark it `COMPLETED`. The policy only grants `GetItem` + `PutItem` — `UpdateItem` was never added.

**Fix:** `infra/iam-patches.tf` → `aws_iam_role_policy.create_candidate_idempotency_update`
Adds `dynamodb:UpdateItem` on `talent-flow-idempotency-keys`.

---

### BUG-003 — Config items have no active version set (GSI1PK missing)

| Field | Detail |
|---|---|
| **Severity** | High (blocks BUG-001 fix from being useful) |
| **Status** | 🔄 In progress — requires admin UI re-save |
| **Discovered** | 2026-06-01 via DynamoDB scan |
| **Affects** | All config-dependent features |

**Symptom:** Even after BUG-001 IAM fix is deployed, orchestrate will still fall back to defaults because no config item has `GSI1PK = TENANT#NALEKO#ACTIVE`.

**Where to look:**
- DynamoDB → `talent-flow-config` → scan for `GSI1PK` attribute → should see `TENANT#NALEKO#ACTIVE` on active items
- CloudWatch → `/aws/lambda/orchestrateTalentFlowWorkflow` → `WARN: no active item found for configType=SCORING_WEIGHTS`

**Root cause:** Existing config items were saved without the `GSI1PK` active-marker attribute. The admin UI PUT flow correctly sets this — the items were likely created via a different path or before this pattern was implemented.

**Fix (correct layer):** After deploying BUG-001 IAM fix, go to Admin → each config section and re-save using the UI Update button. The `manageTalentFlowConfig` PUT handler will write the correct `GSI1PK = TENANT#NALEKO#ACTIVE`. No direct DynamoDB writes.

Config types to re-save via Admin UI:
- [ ] SCORING_WEIGHTS
- [ ] SLA_THRESHOLDS
- [ ] STAGE_CONFIG
- [ ] PANEL_CONFIG
- [ ] APPROVAL_RULES
- [ ] IT_QUEUES
- [ ] PROVISIONING_TEMPLATES
- [ ] ROUTING_RULES
- [ ] EMAIL_TEMPLATES

---

## Workflow Stages — Status & Blockers

| Stage | Status | Blocker |
|---|---|---|
| Candidate Created | ✅ Working | — |
| `APPLICATION_REVIEW` | ✅ Working | — |
| `CV_SCREENING` | 🔲 Not tested | BUG-001, BUG-003 (stage advance may use config) |
| `INTERVIEW_SCHEDULING` | 🔲 Not tested | Needs PanelMember users assigned |
| `PANEL_INTERVIEW` | 🔲 Not tested | Needs PanelMember users |
| `REFERENCE_CHECK` | 🔲 Not tested | — |
| `OFFER` | 🔲 Not tested | Needs FinanceLead for approval chain |
| `CONTRACT_SIGNING` | 🔲 Not tested | Triggers IT provisioning creation |
| `IT_PROVISIONING` | 🔲 Not tested | Needs ITAdmin/ITSpecialist in Cognito |
| Provisioning bundle approved | 🔲 Not tested | offer-approval Step Function |

---

## Where to Investigate What

| Symptom | Where to look |
|---|---|
| Candidate stuck in stage | CloudWatch `/aws/lambda/advanceCandidateStage` |
| Config not applying | CloudWatch `/aws/lambda/orchestrateTalentFlowWorkflow` + DynamoDB `talent-flow-config` GSI1PK |
| Idempotency errors | CloudWatch `/aws/lambda/createCandidate` + DynamoDB `talent-flow-idempotency-keys` |
| Stage advance fails | CloudWatch `/aws/lambda/advanceCandidateStage` + `talent-flow-state` table SAGA item |
| Events not firing | CloudWatch `/aws/lambda/orchestrateTalentFlowWorkflow` + EventBridge `talent-flow-bus` |
| Notifications not sending | CloudWatch `/aws/lambda/sendTalentFlowNotification` |
| Offer approval stuck | Step Functions console → `talent-flow-offer-approval` execution |
| IT tasks not created | CloudWatch `/aws/lambda/createItTask` + DynamoDB `it-tasks` table |
| Provisioning bundle missing | DynamoDB `provisioning-bundles` + CloudWatch `/aws/lambda/createProvisioningBundle` |
| Audit log missing | CloudWatch `/aws/lambda/talentFlowAuditStream` + DynamoDB `talent-flow-events` |
| SLA breach not detected | CloudWatch `/aws/lambda/monitorTalentFlowSLAs` |

---

## Deploy Checklist (for this branch)

- [ ] `terraform fmt -check -recursive` passes
- [ ] `terraform plan` shows only the 2 new `aws_iam_role_policy` resources (PATCH 1 + PATCH 2)
- [ ] `terraform apply`
- [ ] Re-test candidate creation — CloudWatch should show no `UpdateItem` WARN
- [ ] Re-save all config types via Admin UI
- [ ] Re-test orchestrate — CloudWatch should show `configVersion locked to v<N>` not NULL
- [ ] Advance June July to `CV_SCREENING` and verify event fires
