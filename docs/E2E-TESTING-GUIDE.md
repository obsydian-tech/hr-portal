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

| ID | Name | Level | Created | Final Stage | Notes |
|---|---|---|---|---|---|
| `CAND-01KT11912DY8NAC0F9PNQ6DMKF` | June July | Senior | 2026-06-01T07:27Z | `APPLICATION_REVIEW` | Original test candidate — BUG-001/002/003 era |
| `CAND-01KT14TFD46JSEB5MNA68WN3NC` | _(test)_ | — | 2026-06-01 | `APPLICATION_REVIEW` | Stale SAGA patched (BUG-004 manual fix) — discard |
| `CAND-01KT1558317GRG3Y1DSFQP1CSB` | _(test)_ | — | 2026-06-01 | `PHONE_SCREENING` | Stage no longer valid in 10-stage pipeline — discard |
| `CAND-01KT190NKFS4BMWSMH06W015WP` | _(test)_ | JUNIOR | 2026-06-01T09:42Z | `ONBOARDING` | Raced through all stages — BUG-005 era, gate was skipped — discard |

> **Active test:** Create a fresh candidate after confirming BUG-005 is fixed. Advance to INTERVIEWING, then immediately try advancing to EVALUATION — expect a `409` listing pending interview types.

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

---

## Architecture Change — INTERVIEWING Stage (2026-06-01)

### What changed

The original 12-stage pipeline had three hardcoded interview stages:
`PHONE_SCREENING → TECHNICAL_INTERVIEW → PANEL_INTERVIEW`

These were replaced by a **single `INTERVIEWING` stage** with a configurable sub-loop driven by `PANEL_CONFIG.interviewRequirements`. This is architecturally correct — not all roles need a technical interview, and the number/type of rounds should be config-driven, not baked into code.

### New 10-stage pipeline

| # | Stage | Phase |
|---|---|---|
| 1 | `APPLICATION_REVIEW` | Phase 1 — Interview & Evaluation |
| 2 | `INTERVIEWING` | Phase 1 — Interview & Evaluation |
| 3 | `EVALUATION` | Phase 1 — Interview & Evaluation |
| 4 | `BACKGROUND_CHECK` | Phase 2 — Offer & Acceptance |
| 5 | `OFFER_PREPARATION` | Phase 2 — Offer & Acceptance |
| 6 | `OFFER_APPROVAL` | Phase 2 — Offer & Acceptance |
| 7 | `OFFER_DELIVERY` | Phase 2 — Offer & Acceptance |
| 8 | `CONTRACT_SIGNING` | Phase 2 — Offer & Acceptance |
| 9 | `PRE_BOARDING` | Phase 3 — Pre-Onboarding |
| 10 | `ONBOARDING` | Phase 4 — Onboarding & Day 1 |

### How the interview loop gate works

When `advanceCandidateStage` receives a request to move a candidate **out of** `INTERVIEWING`:

1. It reads the active `PANEL_CONFIG` (via `shared/config-reader` → `GSI1-active-configs` GSI)
2. It looks up `panelConfig.interviewRequirements[positionLevel]` — an array of `{ type, required }` objects
3. It queries all `INTERVIEW#` records for this candidate from `talent-flow-state`
4. It builds a set of interview types that have `status = COMPLETED`
5. If any **required** types are not in that set → returns `409 Conflict` with the list of pending types
6. If all required types are complete (or no requirements configured) → advance proceeds

### Interview Requirements config (PANEL_CONFIG v2)

Saved 2026-06-01 via Admin → TalentFlow Config → Panel Rules → Interview Requirements section:

| Interview Type | JUNIOR | MID | SENIOR |
|---|---|---|---|
| Phone Screen | Required | Required | Required |
| Technical | Optional | Required | Required |
| Behavioral | Required | Optional | Required |
| Culture Fit | Optional | Optional | Optional |
| Final | Required | Optional | Optional |

### Admin UI — how to configure

- **Interview Requirements** → `/platform/talentflow/admin/talentflow/panel-rules` → second section on the page
- **Stage Config (enable/disable stages)** → `/platform/talentflow/admin/talentflow/stage-config` → new page added to sidebar

---

## Config State (talent-flow-config table)

### Current active versions (TENANT#NALEKO)

| Config Type | Active Version | Notes |
|---|---|---|
| `SCORING_WEIGHTS` | v4 | Re-saved via admin UI |
| `SLA_THRESHOLDS` | v3 | Re-saved via admin UI |
| `STAGE_CONFIG` | v2 | 10-stage list saved 2026-06-01 |
| `PANEL_CONFIG` | v2 | interviewRequirements saved 2026-06-01 |
| `PANEL_RULES` | v1 | Votes required + veto rules |
| `APPROVAL_RULES` | v2 | Re-saved via admin UI |
| `IT_QUEUES` | v5 | Re-saved via admin UI |
| `PROVISIONING_TEMPLATES` | v3 | Re-saved via admin UI |
| `ROUTING_RULES` | v2 | Re-saved via admin UI |
| `EMAIL_TEMPLATES` | v1 | Re-saved via admin UI |

### How active config works

Active config items have:
```
PK       = TENANT#<tenantId>
SK       = CONFIG#<configType>#v<N>
GSI1PK   = TENANT#<tenantId>#ACTIVE
GSI1SK   = CONFIG#<configType>
isActive = true
```

The `shared/config-reader` queries `GSI1-active-configs` with both `GSI1PK` and `GSI1SK` to find the current active version. When a new version is saved, the old version has its `GSI1PK` and `GSI1SK` removed (REMOVE expression) so it drops out of the GSI.

**To confirm a config is active:** DynamoDB → `talent-flow-config` table → scan → look for your configType item with `GSI1PK` attribute present.

---

## Bugs Found & Fix Status

---

### BUG-001 — `orchestrateTalentFlowWorkflow` cannot Query config table

| Field | Detail |
|---|---|
| **Severity** | High |
| **Status** | ✅ Fixed & deployed — `infra/iam-patches.tf`, `terraform apply` 2026-06-01 |
| **Discovered** | 2026-06-01 via CloudWatch |
| **Affects** | Every new candidate |

**Symptom:** Every new candidate gets `configVersion = NULL` in the SAGA record. Scoring weights and stage config always fall back to hardcoded defaults regardless of admin configuration.

**Where to look:**
- CloudWatch → `/aws/lambda/orchestrateTalentFlowWorkflow` → filter: `SCORING_WEIGHTS`
- DynamoDB → `talent-flow-state` → `PK: CANDIDATE#<id> SK: SAGA` → check `configVersion`

**Error in CloudWatch:**
```
ERROR config-reader: getConfigItem DynamoDB error for NALEKO/SCORING_WEIGHTS:
User: arn:aws:sts::937137806477:assumed-role/talent-flow-role-orchestrateTalentFlowWorkflow/...
is not authorized to perform: dynamodb:Query on resource:
arn:aws:dynamodb:af-south-1:937137806477:table/talent-flow-config/index/GSI1-active-configs
```

**Root cause:** The inline policy on `talent-flow-role-orchestrateTalentFlowWorkflow` only granted `dynamodb:GetItem` on the table ARN. `config-reader` uses `QueryCommand` against the `GSI1-active-configs` GSI — `Query` on the index ARN was never granted.

**Fix:** `infra/iam-patches.tf` → `aws_iam_role_policy.orchestrate_config_query`
Adds `dynamodb:Query` + `dynamodb:GetItem` on the table and `/index/*` ARN.

---

### BUG-002 — `createCandidate` cannot mark idempotency key COMPLETED

| Field | Detail |
|---|---|
| **Severity** | Medium |
| **Status** | ✅ Fixed & deployed — `infra/iam-patches.tf`, `terraform apply` 2026-06-01 |
| **Discovered** | 2026-06-01 via CloudWatch |
| **Affects** | Every new candidate creation — retry safety broken |

**Symptom:** Candidate IS created successfully, but the idempotency record stays `IN_PROGRESS`. Retrying the same `idempotencyKey` returns `409 Conflict` instead of the already-created candidate.

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

**Root cause:** `createCandidate` writes the idempotency record as `IN_PROGRESS` via `PutItemCommand`, then after success calls `UpdateItemCommand` to mark it `COMPLETED`. The policy only granted `GetItem` + `PutItem` — `UpdateItem` was never added.

**Fix:** `infra/iam-patches.tf` → `aws_iam_role_policy.create_candidate_idempotency_update`
Adds `dynamodb:UpdateItem` on `talent-flow-idempotency-keys`.

---

### BUG-003 — Config items have no active version set (GSI1PK missing)

| Field | Detail |
|---|---|
| **Severity** | High |
| **Status** | ✅ Fixed — all configs re-saved via admin UI 2026-06-01 |
| **Discovered** | 2026-06-01 via DynamoDB scan |
| **Affects** | All config-dependent features |

**Symptom:** Even after BUG-001 IAM fix, orchestrate still falls back to defaults because no config item has `GSI1PK = TENANT#NALEKO#ACTIVE`.

**Where to look:**
- DynamoDB → `talent-flow-config` → scan → check `GSI1PK` attribute is present on active items
- CloudWatch → `/aws/lambda/orchestrateTalentFlowWorkflow` → `WARN: no active item found for configType=SCORING_WEIGHTS`

**Root cause:** Existing config items were written without the `GSI1PK` active-marker. Likely created before this pattern was implemented or via a direct DynamoDB write that bypassed the Lambda.

**Fix (correct layer):** After deploying BUG-001 fix, go to Admin → each config section and re-save via UI. `manageTalentFlowConfig` PUT sets the correct `GSI1PK`. Do not write directly to DynamoDB.

---

### BUG-004 — `configVersion: null` in SAGA blocks orchestrate permanently

| Field | Detail |
|---|---|
| **Severity** | Critical |
| **Status** | ✅ Fixed — `lambda/createCandidate/index.js` deployed 2026-06-01 |
| **Discovered** | 2026-06-01 during candidate testing |
| **Affects** | Any candidate whose SAGA record has `configVersion` as a DynamoDB NULL-type |

**Symptom:** `orchestrateTalentFlowWorkflow` fires once, sees the SAGA already has `configVersion` set (even though it's `null`), and logs "already locked — skipping (idempotent)". The candidate's `configVersion` is never assigned to a real version. The workflow appears to succeed (HTTP 200) but produces a broken SAGA.

**Where to look:**
- DynamoDB → `talent-flow-state` → `PK: CANDIDATE#<id> SK: SAGA` → look for `configVersion: {"NULL": true}` in raw DynamoDB view
- CloudWatch → `/aws/lambda/orchestrateTalentFlowWorkflow` → filter `skipping`

**Error / signal in CloudWatch:**
```
INFO already locked — skipping (idempotent) { candidateId: 'CAND-...' }
```
No error — it silently skips. The SAGA looks fine at a glance but `configVersion` is a NULL-type attribute.

**Root cause (subtle DynamoDB trap):**
```javascript
// createCandidate — BEFORE fix
const sagaRecord = {
  PK: `CANDIDATE#${candidateId}`,
  configVersion: null,   // ← marshals to {"NULL": true} in DynamoDB
  ...
};
marshall(sagaRecord, { removeUndefinedValues: true });
// null is NOT undefined — it is NOT removed. DynamoDB stores {"NULL": true}.
// attribute_exists(configVersion) returns TRUE for NULL-type attributes.
// orchestrate's ConditionExpression: 'attribute_not_exists(configVersion)' FAILS.
```

**Fix:** Changed `configVersion: null` → `configVersion: undefined` in `createCandidate`.
`removeUndefinedValues: true` in `marshall()` then omits the key entirely, so the attribute is truly absent from DynamoDB and `attribute_not_exists(configVersion)` passes correctly on first invocation.

**Manual remediation for existing stale SAGAs:**
```bash
# REMOVE the null-type configVersion attribute from the stale SAGA
aws dynamodb update-item \
  --table-name talent-flow-state \
  --key '{"PK":{"S":"CANDIDATE#<id>"},"SK":{"S":"SAGA"}}' \
  --update-expression 'REMOVE configVersion' \
  --region af-south-1

# Then manually invoke orchestrate to re-run
aws lambda invoke \
  --function-name orchestrateTalentFlowWorkflow \
  --payload '{"candidateId":"<id>","tenantId":"NALEKO"}' \
  --region af-south-1 /tmp/out.json
```

---

### BUG-005 — `advanceCandidateStage` missing `CONFIG_TABLE_NAME` env var — interview loop gate silently skipped

| Field | Detail |
|---|---|
| **Severity** | Critical |
| **Status** | ✅ Fixed — env var added via AWS CLI 2026-06-01 |
| **Discovered** | 2026-06-01 — JUNIOR candidate advanced through all 10 stages without any interviews |
| **Affects** | The entire INTERVIEWING stage gate — any candidate, any level |

**Symptom:** A candidate in `INTERVIEWING` can be advanced to `EVALUATION` (and beyond) without completing any required interviews. The gate is completely bypassed.

**Where to look:**
- CloudWatch → `/aws/lambda/advanceCandidateStage` → filter: `interviewLoopGate` or `CONFIG_TABLE_NAME`
- DynamoDB → `talent-flow-state` → `PK: CANDIDATE#<id>` → query all `SK` beginning with `INTERVIEW#` → should see zero records if no interviews scheduled

**Error in CloudWatch:**
```
ERROR config-reader: DynamoDB error for NALEKO/PANEL_CONFIG/ACTIVE:
1 validation error detected: Value null at 'tableName' failed to satisfy constraint: Member must not be null

WARN config-reader: no item found for configType=PANEL_CONFIG — returning defaults

WARN interviewLoopGate: no interviewRequirements for positionLevel — gate skipped { positionLevel: 'JUNIOR' }
```

**Root cause:** When the `advanceCandidateStage` Lambda was rewritten to add the interview loop gate (which reads `PANEL_CONFIG` via `shared/config-reader`), the `CONFIG_TABLE_NAME` environment variable was never added to the Lambda's configuration. The config-reader receives `undefined` as the table name, DynamoDB rejects the call with a validation error, the reader falls back to hardcoded defaults (which have no `interviewRequirements`), and the gate logs "gate skipped" and returns `null` — allowing the advance.

**Before fix:**
```json
{
  "STATE_TABLE_NAME": "talent-flow-state",
  "EVENTBRIDGE_BUS_NAME": "talent-flow-bus",
  "ENVIRONMENT": "prod",
  "AWS_ACCOUNT_ID": "937137806477"
}
```

**After fix:**
```json
{
  "STATE_TABLE_NAME": "talent-flow-state",
  "CONFIG_TABLE_NAME": "talent-flow-config",
  "EVENTBRIDGE_BUS_NAME": "talent-flow-bus",
  "ENVIRONMENT": "prod",
  "AWS_ACCOUNT_ID": "937137806477"
}
```

**Fix applied:**
```bash
aws lambda update-function-configuration \
  --function-name advanceCandidateStage \
  --region af-south-1 \
  --environment "Variables={STATE_TABLE_NAME=talent-flow-state,CONFIG_TABLE_NAME=talent-flow-config,EVENTBRIDGE_BUS_NAME=talent-flow-bus,ENVIRONMENT=prod,AWS_ACCOUNT_ID=937137806477}"
```

**Env var audit — check all Lambdas that use shared/config-reader:**
Any Lambda added to `NEEDS_SHARED` in `scripts/deploy-talentflow-lambdas.sh` requires both `STATE_TABLE_NAME` and `CONFIG_TABLE_NAME`. Run this audit after adding a new Lambda to the shared list:

```bash
for fn in orchestrateTalentFlowWorkflow advanceCandidateStage scheduleInterview submitVote completeEvaluation sendTalentFlowNotification monitorTalentFlowSLAs createProvisioningBundle getItTasks createItTask; do
  echo "=== $fn ==="
  aws lambda get-function-configuration \
    --function-name "$fn" --region af-south-1 \
    --query 'Environment.Variables.CONFIG_TABLE_NAME' --output text
done
```

Expected output for each: `talent-flow-config`. Any `None` means the env var is missing.

---

---

### BUG-006 — Five workflow Lambdas missing `dynamodb:Query` on `talent-flow-config` index

| Field | Detail |
|---|---|
| **Severity** | Critical |
| **Status** | ✅ Fixed — IAM policies added via AWS CLI + `infra/iam-patches.tf` updated 2026-06-01 |
| **Discovered** | 2026-06-01 — gate still bypassed after BUG-005 fix |
| **Affects** | Interview loop gate, vote counting, offer notification, and any other config-dependent logic in these Lambdas |

**Symptom:** After fixing BUG-005 (`CONFIG_TABLE_NAME` env var), the gate still skips. Same end result — candidate advances through INTERVIEWING with no interviews.

**Where to look:**
- CloudWatch → `/aws/lambda/advanceCandidateStage` → filter: `not authorized to perform: dynamodb:Query`

**Error in CloudWatch:**
```
ERROR config-reader: DynamoDB error for NALEKO/PANEL_CONFIG/ACTIVE:
User: arn:aws:sts::937137806477:assumed-role/talent-flow-role-advanceCandidateStage/...
is not authorized to perform: dynamodb:Query on resource:
arn:aws:dynamodb:af-south-1:937137806477:table/talent-flow-config/index/GSI1-active-configs
because no identity-based policy allows the dynamodb:Query action
```

**Root cause:** When each Lambda was originally provisioned, its IAM role policy was scoped to the `talent-flow-state` table only. Reading config was not a requirement at the time. When `shared/config-reader` was added to these Lambdas as part of the INTERVIEWING stage architecture, no one added the corresponding IAM permissions.

**Lambdas confirmed broken (via `iam simulate-principal-policy`, 2026-06-01):**

| Lambda | Impact of missing permission |
|---|---|
| `advanceCandidateStage` | Interview loop gate silently skipped |
| `scheduleInterview` | PANEL_CONFIG unreadable — panel rules not enforced |
| `submitVote` | PANEL_CONFIG unreadable — votesRequired falls to defaults |
| `completeEvaluation` | PANEL_CONFIG unreadable — scoring rules fall to defaults |
| `sendTalentFlowNotification` | EMAIL_TEMPLATES / STAGE_CONFIG unreadable |

**Lambdas already allowed (broader policies in place):** `orchestrateTalentFlowWorkflow` (PATCH 1), `monitorTalentFlowSLAs`, `createProvisioningBundle`.

**Fix:** Added inline policy `config-table-query` to all 5 roles granting `dynamodb:Query` + `dynamodb:GetItem` on `talent-flow-config` table and `/index/*`. Tracked in `infra/iam-patches.tf` as PATCH 3 (`aws_iam_role_policy.config_table_query` with `for_each`).

**Lesson:** Any Lambda added to `NEEDS_SHARED` in `deploy-talentflow-lambdas.sh` that calls `getConfig()` needs `dynamodb:Query` on both the table ARN and `table/talent-flow-config/index/*`. Add this as part of the Lambda creation checklist.

---

---

### BUG-007 — `advanceCandidateStage` missing `dynamodb:Query` on `talent-flow-state` — gate returns 500

| Field | Detail |
|---|---|
| **Severity** | Critical |
| **Status** | ✅ Fixed — IAM policy added + Lambda redeployed 2026-06-01 |
| **Discovered** | 2026-06-01 — gate appeared to work (blocked advance) but with wrong error |
| **Affects** | Interview loop gate — the 409 was never reached, a 500 was returned instead |

**Symptom:** Clicking "Advance to Evaluation" shows "Failed to verify interview completion" in the red error banner. The gate IS blocking the advance (good) but for the wrong reason — it's a 500 from a failed DynamoDB query, not a proper 409 with the list of pending interviews.

**Where to look:**
- CloudWatch → `/aws/lambda/advanceCandidateStage` → filter: `failed to query INTERVIEW records`

**Error in CloudWatch:**
```
ERROR interviewLoopGate: failed to query INTERVIEW records {
  candidateId: 'CAND-...',
  error: 'User: ...talent-flow-role-advanceCandidateStage... is not authorized
  to perform: dynamodb:Query on resource: .../talent-flow-state'
}
```

**Root cause:** The original policy for `talent-flow-role-advanceCandidateStage` only had `GetItem` + `UpdateItem` on `talent-flow-state`. The interview loop gate added a `QueryCommand` to scan all `INTERVIEW#` records for the candidate — `Query` on the table was never in the policy.

**Fix:** Added inline policy `state-table-query` granting `dynamodb:Query` on `talent-flow-state` and `/index/*`. Tracked as PATCH 4 in `infra/iam-patches.tf`. Lambda redeployed with improved gate message (type names now formatted as "Phone Screen" not "PHONE_SCREEN").

---

### BUG-008 — `scheduleInterview` missing `dynamodb:PutItem` on `talent-flow-state` — cannot create interview record

| Field | Detail |
|---|---|
| **Severity** | Critical |
| **Status** | ✅ Fixed — IAM policy added 2026-06-01 |
| **Discovered** | 2026-06-01 — "Failed to write interview record" in Schedule Interview form |
| **Affects** | Every interview creation — the entire interview loop is unusable without this |

**Symptom:** Schedule Interview form fills in correctly and submits, but returns "Failed to write interview record". No `INTERVIEW#` record appears in DynamoDB.

**Where to look:**
- CloudWatch → `/aws/lambda/scheduleInterview` → filter: `Failed to write interview record`

**Error in CloudWatch:**
```
ERROR Failed to write interview record {
  interviewId: '...',
  error: 'User: ...talent-flow-role-scheduleInterview... is not authorized
  to perform: dynamodb:PutItem on resource: .../talent-flow-state'
}
```

**Root cause:** The original policy for `talent-flow-role-scheduleInterview` only had `GetItem` + `UpdateItem` on `talent-flow-state`. Creating a new `INTERVIEW#<id>` record requires `PutItem` — never provisioned.

**Fix:** Added inline policy `state-table-write` granting `dynamodb:PutItem` + `dynamodb:Query` on `talent-flow-state` and `/index/*`. Tracked as PATCH 5 in `infra/iam-patches.tf`.

---

## Interview Loop — E2E Test Checklist

Use a fresh candidate for this test. Existing stale candidates (at `PHONE_SCREENING`, `ONBOARDING`, etc.) should be discarded.

### Pre-conditions

- [ ] `PANEL_CONFIG` v2 active with `interviewRequirements` (confirm in DynamoDB)
- [ ] `STAGE_CONFIG` v2 active with all 10 stages (confirm in DynamoDB)
- [ ] `advanceCandidateStage` has `CONFIG_TABLE_NAME=talent-flow-config` env var set
- [ ] Dev server running on `:4200`

### Test sequence (JUNIOR candidate — 3 required types: Phone Screen, Behavioral, Final)

| Step | Action | Expected result | Status |
|---|---|---|---|
| 1 | Create new JUNIOR candidate | SAGA at `APPLICATION_REVIEW`, `configVersion = v<N>` | 🔲 |
| 2 | Advance to `INTERVIEWING` | Success — no gate on exit from APPLICATION_REVIEW | 🔲 |
| 3 | **Try advancing to `EVALUATION` immediately** | `409 Conflict` — lists pending: PHONE_SCREEN, BEHAVIORAL, FINAL | 🔲 |
| 4 | Schedule a `PHONE_SCREEN` interview | `INTERVIEW#<id>` record created, `status=SCHEDULED` | 🔲 |
| 5 | Mark PHONE_SCREEN complete | `status=COMPLETED`, `completedAt` set | 🔲 |
| 6 | Try advancing to EVALUATION again | Still `409` — BEHAVIORAL and FINAL still pending | 🔲 |
| 7 | Schedule + complete `BEHAVIORAL` interview | `status=COMPLETED` | 🔲 |
| 8 | Schedule + complete `FINAL` interview | `status=COMPLETED` | 🔲 |
| 9 | Advance to `EVALUATION` | Success — all required types complete | 🔲 |
| 10 | Verify CloudWatch — no gate-skipped WARN | Clean log — gate fired and passed | 🔲 |

### CloudWatch verification for step 3 (gate blocking correctly)

Filter `/aws/lambda/advanceCandidateStage` for the candidate ID. Expected log:
```
INFO interviewLoopGate: blocking advance — pending types { pending: ['PHONE_SCREEN', 'BEHAVIORAL', 'FINAL'] }
```
And HTTP response to the frontend should be `409`.

### CloudWatch verification for step 9 (gate passing)

No gate-related WARN. Should see:
```
INFO Stage advanced { candidateId: '...', previousStage: 'INTERVIEWING', newStage: 'EVALUATION' }
```

---

## Workflow Stages — Current Status

| Stage | Status | Blocker |
|---|---|---|
| Candidate Created | ✅ Working | — |
| `APPLICATION_REVIEW` | ✅ Working | — |
| `INTERVIEWING` (advance in) | ✅ Working | — |
| `INTERVIEWING` gate (block until interviews done) | 🔲 Verify with fresh candidate | BUG-005 just fixed — needs confirmation |
| Schedule interview within INTERVIEWING | 🔲 Not tested | — |
| Complete interview (mark COMPLETED) | 🔲 Not tested | — |
| `EVALUATION` (advance out of INTERVIEWING) | 🔲 Pending gate test | Step 9 of interview loop checklist |
| `BACKGROUND_CHECK` | 🔲 Not tested | — |
| `OFFER_PREPARATION` | 🔲 Not tested | — |
| `OFFER_APPROVAL` | 🔲 Not tested | Needs FinanceLead in Cognito |
| `OFFER_DELIVERY` | 🔲 Not tested | — |
| `CONTRACT_SIGNING` | 🔲 Not tested | Triggers IT provisioning |
| `PRE_BOARDING` | 🔲 Not tested | — |
| `ONBOARDING` | 🔲 Not tested | — |
| IT provisioning bundle created | 🔲 Not tested | Needs ITAdmin/ITSpecialist |

---

## Where to Investigate What

| Symptom | Where to look |
|---|---|
| Candidate advanced through INTERVIEWING without interviews | CloudWatch `/aws/lambda/advanceCandidateStage` — filter `interviewLoopGate` |
| Gate says "gate skipped" | Lambda missing `CONFIG_TABLE_NAME` env var (BUG-005) |
| Gate says "no item found for PANEL_CONFIG" | PANEL_CONFIG not re-saved via admin UI (BUG-003 pattern) |
| Candidate stuck in stage | CloudWatch `/aws/lambda/advanceCandidateStage` |
| Config not applying | CloudWatch `/aws/lambda/orchestrateTalentFlowWorkflow` + DynamoDB `talent-flow-config` GSI1PK |
| `configVersion` stuck as NULL | BUG-004 — check SAGA for `{"NULL": true}` attribute |
| Idempotency errors | CloudWatch `/aws/lambda/createCandidate` + DynamoDB `talent-flow-idempotency-keys` |
| Events not firing | CloudWatch `/aws/lambda/orchestrateTalentFlowWorkflow` + EventBridge `talent-flow-bus` |
| Notifications not sending | CloudWatch `/aws/lambda/sendTalentFlowNotification` |
| Offer approval stuck | Step Functions console → `talent-flow-offer-approval` execution |
| IT tasks not created | CloudWatch `/aws/lambda/createItTask` + DynamoDB `it-tasks` table |
| Provisioning bundle missing | DynamoDB `provisioning-bundles` + CloudWatch `/aws/lambda/createProvisioningBundle` |
| Audit log missing | CloudWatch `/aws/lambda/talentFlowAuditStream` + DynamoDB `talent-flow-events` |
| SLA breach not detected | CloudWatch `/aws/lambda/monitorTalentFlowSLAs` |

---

## Deploy Checklist

### Phase 1 — IAM + config (completed 2026-06-01)
- [x] `terraform apply` — 2 IAM patches deployed (BUG-001, BUG-002)
- [x] All config types re-saved via Admin UI (BUG-003)
- [x] `createCandidate` redeployed — `configVersion: null → undefined` fix (BUG-004)
- [x] `orchestrateTalentFlowWorkflow` redeployed — comment fix
- [x] Confirmed new candidate gets real `configVersion` (not NULL) in SAGA

### Phase 2 — INTERVIEWING stage architecture (completed 2026-06-01)
- [x] `advanceCandidateStage` rewritten — 10-stage STAGE_ORDER, interview loop gate
- [x] `scheduleInterview` refactored — removed per-type stage-map, added `completeInterview` handler
- [x] `completeEvaluation` fixed — advances to `BACKGROUND_CHECK` (not `OFFER_PREPARATION`)
- [x] `submitVote` fixed — votesRequired from PANEL_CONFIG not fragile INTERVIEW# query
- [x] All 4 Lambdas redeployed via `deploy-talentflow-lambdas.sh`
- [x] Frontend updated — 10-stage models, STAGE_LABELS, service STAGE_ORDER, workspace HTML
- [x] `PANEL_CONFIG` v2 saved with `interviewRequirements` via new Admin UI panel
- [x] `STAGE_CONFIG` v2 saved with 10 stages via new Admin UI page
- [x] `CONFIG_TABLE_NAME` env var added to `advanceCandidateStage` (BUG-005)
- [x] `dynamodb:Query` on `talent-flow-config/index/*` added to 5 Lambda roles (BUG-006)
- [x] `infra/iam-patches.tf` updated with PATCH 3 (`for_each` across all 5 roles)
- [x] `dynamodb:Query` on `talent-flow-state` added to `advanceCandidateStage` (BUG-007)
- [x] `dynamodb:PutItem` + `Query` on `talent-flow-state` added to `scheduleInterview` (BUG-008)
- [x] `advanceCandidateStage` redeployed — gate message now shows readable interview type names

### Phase 3 — Interview GET route + full deploy (completed 2026-06-01)
- [x] PR #233 (`feature/interviewing-stage-loop` → `develop`) merged — 19 files, interview loop UI + Lambda GET handler
- [x] PR #234 (`develop` → `main`) merge conflicts resolved — `docs/E2E-TESTING-GUIDE.md` and `infra/iam-patches.tf` add/add conflicts kept develop's version
- [x] `terraform apply` — 3 new resources: `aws_lambda_permission.apigw_get_interviews`, `aws_apigatewayv2_integration.get_candidate_interviews`, `aws_apigatewayv2_route.get_candidate_interviews`
- [x] API GW route `GET /v1/candidates/{id}/interviews` live (JWT-protected, route ID `vdkqhg2`)
- [x] All 33 TalentFlow Lambdas redeployed via `deploy-talentflow-lambdas.sh`
- [x] Lambda invoked directly — returned real interview record (`BEHAVIORAL`, `SCHEDULED`, panel member attached) for `CAND-01KS5H7TKYCP8KYQSAFXQHZAME`

### Phase 4 — Interview loop E2E verification (pending)
- [ ] Fresh candidate created (JUNIOR)
- [ ] Gate blocks advance at INTERVIEWING → EVALUATION before interviews done (step 3)
- [ ] All 3 required interview types scheduled and completed (steps 4–8)
- [ ] Gate passes — advance to EVALUATION succeeds (step 9)
- [ ] CloudWatch confirms clean gate log with no "gate skipped" WARN
- [ ] Angular workspace UI — Interview tab shows scheduled interviews fetched from `GET /v1/candidates/{id}/interviews`
- [ ] "Complete Interview" form submits PATCH and updates status in UI
- [ ] "Add Panel Member" form submits PATCH and updates panelMemberIds in UI
