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

## Test Candidates

| Candidate ID | Name | Position | Created | Notes |
|---|---|---|---|---|
| `CAND-01KT11912DY8NAC0F9PNQ6DMKF` | June July | Senior Accountant | 2026-06-01T07:27:23Z | First test candidate — created before IAM + code fixes |
| `CAND-01KT14TFD46JSEB5MNA68WN3NC` | After Fix | Contact Center Agent | 2026-06-01T08:29:20Z | Created after IAM fix, before Lambda code fix — SAGA patched manually |
| `CAND-01KT1558317GRG3Y1DSFQP1CSB` | after1 fix1 | — | 2026-06-01T08:35:14Z | ✅ First clean candidate — configVersion=v4, all 12 stages, idempotency COMPLETED |

**Created by:** iggytanakamush@gmail.com (TalentFlowAdmin)
**Starting stage:** `APPLICATION_REVIEW`

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

| Config Type | NALEKO versions | DEFAULT | Active version |
|---|---|---|---|
| SCORING_WEIGHTS | v1, v2, v3 | v1 | **v4** (confirmed via SAGA) |
| SLA_THRESHOLDS | v1, v2 | v1 | re-saved via Admin UI ✅ |
| STAGE_CONFIG | v1 | v1 | re-saved via Admin UI ✅ |
| PANEL_CONFIG | v1 | v1 | re-saved via Admin UI ✅ |
| APPROVAL_RULES | v1, v2 | v1 | re-saved via Admin UI ✅ |
| IT_QUEUES | v1, v2, v3, v4 | v1 | re-saved via Admin UI ✅ |
| PROVISIONING_TEMPLATES | v1, v2 | v1 | re-saved via Admin UI ✅ |
| ROUTING_RULES | v1 | v1 | re-saved via Admin UI ✅ |
| EMAIL_TEMPLATES | v1 | v1 | re-saved via Admin UI ✅ |
| SENTIMENT_SCALES | — | v1 | — |

### How active config works

The `manageTalentFlowConfig` lambda stores active config items with:
```
GSI1PK = TENANT#<tenantId>#ACTIVE
GSI1SK = CONFIG#<configType>
```

The `orchestrateTalentFlowWorkflow` lambda's config-reader queries this GSI (`GSI1-active-configs`) to load the active version for each config type at candidate creation time. If no active item is found it logs a WARN and uses hardcoded defaults.

### Active STAGE_CONFIG (v4) — Enabled stages

Confirmed from SAGA record for `CAND-01KT1558317GRG3Y1DSFQP1CSB`:

1. `APPLICATION_REVIEW`
2. `PHONE_SCREENING`
3. `TECHNICAL_INTERVIEW`
4. `PANEL_INTERVIEW`
5. `EVALUATION`
6. `BACKGROUND_CHECK`
7. `OFFER_PREPARATION`
8. `OFFER_APPROVAL`
9. `OFFER_DELIVERY`
10. `CONTRACT_SIGNING`
11. `PRE_BOARDING`
12. `ONBOARDING`

---

## Bugs Found & Fix Status

---

### BUG-001 — `orchestrateTalentFlowWorkflow` cannot Query config table

| Field | Detail |
|---|---|
| **Severity** | High |
| **Status** | ✅ Fixed & deployed — 2026-06-01 |
| **Discovered** | 2026-06-01 via CloudWatch |
| **Affects** | Every new candidate |
| **Fix file** | `infra/iam-patches.tf` |

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
Adds `dynamodb:Query` + `dynamodb:GetItem` on both the table and `/index/*` ARN. Deployed via `terraform apply`.

---

### BUG-002 — `createCandidate` cannot mark idempotency key COMPLETED

| Field | Detail |
|---|---|
| **Severity** | Medium |
| **Status** | ✅ Fixed & deployed — 2026-06-01 |
| **Discovered** | 2026-06-01 via CloudWatch |
| **Affects** | Every new candidate creation — retry safety broken |
| **Fix file** | `infra/iam-patches.tf` |

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
Adds `dynamodb:UpdateItem` on `talent-flow-idempotency-keys`. Deployed via `terraform apply`.

**Confirmed fixed:** `CAND-01KT1558317GRG3Y1DSFQP1CSB` idempotency key → `COMPLETED` ✅

---

### BUG-003 — Config items have no active version set (GSI1PK missing)

| Field | Detail |
|---|---|
| **Severity** | High (blocked BUG-001 fix from being useful) |
| **Status** | ✅ Fixed — all 9 config types re-saved via Admin UI 2026-06-01 |
| **Discovered** | 2026-06-01 via DynamoDB scan |
| **Affects** | All config-dependent features |

**Symptom:** Even after BUG-001 IAM fix is deployed, orchestrate still falls back to defaults because no config item has `GSI1PK = TENANT#NALEKO#ACTIVE`.

**Where to look:**
- DynamoDB → `talent-flow-config` → scan for `GSI1PK` attribute → should see `TENANT#NALEKO#ACTIVE` on active items
- CloudWatch → `/aws/lambda/orchestrateTalentFlowWorkflow` → `WARN: no active item found for configType=SCORING_WEIGHTS`

**Root cause:** Existing config items were saved without the `GSI1PK` active-marker attribute. The admin UI PUT flow correctly sets this — the items were likely created via a different path or before this pattern was implemented.

**Fix (correct layer):** Go to Admin UI → each config section → re-save using the Update button. The `manageTalentFlowConfig` PUT handler writes `GSI1PK = TENANT#NALEKO#ACTIVE`. No direct DynamoDB writes.

Config types re-saved via Admin UI:
- [x] SCORING_WEIGHTS
- [x] SLA_THRESHOLDS
- [x] STAGE_CONFIG
- [x] PANEL_CONFIG
- [x] APPROVAL_RULES
- [x] IT_QUEUES
- [x] PROVISIONING_TEMPLATES
- [x] ROUTING_RULES
- [x] EMAIL_TEMPLATES

**Confirmed fixed:** Active SCORING_WEIGHTS = v4 locked into SAGA for clean test candidates ✅

---

### BUG-004 — `createCandidate` writes `configVersion=null` which blocks orchestrate permanently

| Field | Detail |
|---|---|
| **Severity** | Critical (masked BUG-001 fix — orchestrate skipped on every invocation) |
| **Status** | ✅ Fixed & deployed — 2026-06-01 |
| **Discovered** | 2026-06-01 — found after BUG-001+002+003 were fixed but configVersion still NULL |
| **Affects** | Every candidate created before this fix |
| **Fix file** | `lambda/createCandidate/index.js` |

**Symptom:** Even after BUG-001 IAM and BUG-003 config fixes are applied, `configVersion` stays `NULL` in the SAGA and CloudWatch shows:
```
INFO orchestrate: configVersion already locked for candidateId=CAND-... — skipping (idempotent)
```
No IAM error — orchestrate runs but exits immediately without doing anything.

**Where to look:**
- CloudWatch → `/aws/lambda/orchestrateTalentFlowWorkflow` → filter: `already locked`
- DynamoDB → `talent-flow-state` → SAGA item → `configVersion` attribute type (must be String `"v4"`, not NULL)

**Root cause:** `createCandidate` explicitly set `configVersion: null` in the SAGA `PutItemCommand`. The AWS SDK marshals JavaScript `null` as a DynamoDB `{"NULL": true}` attribute — this is a real attribute that satisfies `attribute_exists`. The orchestrate Lambda uses `ConditionExpression: 'attribute_not_exists(configVersion)'` for idempotency — since the NULL attribute exists, DynamoDB throws `ConditionalCheckFailedException`, which orchestrate catches and treats as "already locked", silently skipping.

**The trap:** `null` in JavaScript is NOT the same as "attribute absent" in DynamoDB. Only `undefined` is omitted by `{ removeUndefinedValues: true }` in the marshall call.

**Fix:** `lambda/createCandidate/index.js` line 170
```js
// Before (broken):
configVersion: null,  // set by orchestrateTalentFlowWorkflow

// After (fixed):
configVersion: undefined,  // omitted — orchestrateTalentFlowWorkflow sets it via attribute_not_exists condition
```
`marshall(sagaRecord, { removeUndefinedValues: true })` then omits the key entirely, so `attribute_not_exists(configVersion)` correctly evaluates to true on first orchestrate invocation.

Deployed via `bash scripts/deploy-talentflow-lambdas.sh createCandidate orchestrateTalentFlowWorkflow`.

**Confirmed fixed:** `CAND-01KT1558317GRG3Y1DSFQP1CSB` — `configVersion: "v4"`, no "already locked" log ✅

---

## Workflow Stages — Status & Blockers

Stages are driven by active **STAGE_CONFIG v4**. The 12 enabled stages are listed in the Config State section above.

| Stage | Status | Blocker |
|---|---|---|
| Candidate Created | ✅ Working | — |
| `APPLICATION_REVIEW` | ✅ Working | — |
| `PHONE_SCREENING` | 🔲 Not tested | — |
| `TECHNICAL_INTERVIEW` | 🔲 Not tested | — |
| `PANEL_INTERVIEW` | 🔲 Not tested | Needs PanelMember users in Cognito |
| `EVALUATION` | 🔲 Not tested | — |
| `BACKGROUND_CHECK` | 🔲 Not tested | — |
| `OFFER_PREPARATION` | 🔲 Not tested | — |
| `OFFER_APPROVAL` | 🔲 Not tested | Needs FinanceLead in Cognito |
| `OFFER_DELIVERY` | 🔲 Not tested | — |
| `CONTRACT_SIGNING` | 🔲 Not tested | Triggers IT provisioning bundle creation |
| `PRE_BOARDING` | 🔲 Not tested | Needs ITAdmin/ITSpecialist in Cognito |
| `ONBOARDING` | 🔲 Not tested | — |

---

## Where to Investigate What

| Symptom | Where to look |
|---|---|
| Candidate stuck in stage | CloudWatch `/aws/lambda/advanceCandidateStage` |
| Config not applying | CloudWatch `/aws/lambda/orchestrateTalentFlowWorkflow` + DynamoDB `talent-flow-config` GSI1PK |
| `already locked` log, configVersion still NULL | See BUG-004 — check `configVersion` attribute type in SAGA (NULL vs String) |
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

## Deploy Checklist

### IAM + Config fixes (completed 2026-06-01)

- [x] `terraform fmt -check -recursive` passes
- [x] `terraform plan` shows only the 2 new `aws_iam_role_policy` resources (PATCH 1 + PATCH 2)
- [x] `terraform apply` — 2 added, 8 changed, 0 destroyed
- [x] All 9 config types re-saved via Admin UI (`/platform/talentflow/admin`)
- [x] Lambda code fix deployed: `createCandidate` + `orchestrateTalentFlowWorkflow`
- [x] Confirmed on `CAND-01KT1558317GRG3Y1DSFQP1CSB`: configVersion=v4, idempotency=COMPLETED

### Next: stage advance testing

- [ ] Advance `CAND-01KT1558317GRG3Y1DSFQP1CSB` to `PHONE_SCREENING` — verify event fires
- [ ] Continue through `TECHNICAL_INTERVIEW`, `PANEL_INTERVIEW` (assign PanelMember user first)
- [ ] Test EVALUATION → BACKGROUND_CHECK → OFFER_PREPARATION
- [ ] Test OFFER_APPROVAL (assign FinanceLead user first)
- [ ] Test CONTRACT_SIGNING → verify IT provisioning bundle is created
- [ ] Test PRE_BOARDING / ONBOARDING (assign ITAdmin/ITSpecialist user first)
