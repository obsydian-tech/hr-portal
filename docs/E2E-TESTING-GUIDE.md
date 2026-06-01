# TalentFlow E2E Testing & Troubleshooting Guide

**Living document — updated as we test and fix.**
Last updated: 2026-06-01 (Phase 5)

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
| `CAND-01KT1N9BQ9AH8ATEPJYAP2HYDY` | Ryan Giggs | JUNIOR | 2026-06-01T13:17Z | `EVALUATION` | Phase 4 pre-fix test — department/location empty (created before BUG-009 fix), interview loop completed manually |
| `CAND-01KT1Q9A6RRY8TEMA7TS5B8P2E` | _(Phase 5 test)_ | JUNIOR | 2026-06-01T13:52Z | `EVALUATION` | ✅ **Primary Phase 5 reference candidate** — all 3 interviews (Phone Screen → Behavioral → Final) completed with PASS, advanced to EVALUATION cleanly |

> **Active test candidate:** `CAND-01KT1Q9A6RRY8TEMA7TS5B8P2E` — Phase 5 complete. Create a fresh candidate for any future regression tests.

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

---

### BUG-009 — `createCandidate` optional fields not persisted to DynamoDB

| Field | Detail |
|---|---|
| **Severity** | Medium |
| **Status** | ✅ Fixed — Lambda redeployed + API service updated 2026-06-01 |
| **Discovered** | 2026-06-01 — department, location, experience all showing `—` on workspace after creating candidate with those fields filled in |
| **Affects** | Every candidate created — optional field data silently lost |

**Symptom:** Create Candidate form accepts department, location, experience years, phone, source. After creation the candidate workspace shows `—` for all those fields. DynamoDB SAGA record confirms they are absent.

**Two-layer bug:**

1. **Lambda** — `createCandidate/index.js` extracted the optional fields from `body` but never included them in the `sagaRecord` object passed to `PutItemCommand`.
2. **API service** — `talent-flow-api.service.ts` `createCandidate()` was building the request body with only the required fields — `department` and `location` were never forwarded to the Lambda even if the frontend had them.

**Fix:**
- `createCandidate/index.js` — added `phone`, `department`, `location`, `experienceYears`, `source`, `appliedDate` to `sagaRecord`; uses `removeUndefinedValues: true` on marshall so absent optional fields are cleanly omitted
- `talent-flow-api.service.ts` — added `department` and `location` to the HTTP request body in `createCandidate()`

**Note:** Candidates created before this fix will have empty optional fields permanently (the SAGA record was written without them). Create a new candidate to verify.

---

### BUG-010 — PANEL_CONFIG race condition — interview type dropdown not guided on Interviews tab open

| Field | Detail |
|---|---|
| **Severity** | Medium |
| **Status** | ✅ Fixed — PANEL_CONFIG now loaded on page init 2026-06-01 |
| **Discovered** | 2026-06-01 — schedule form showed all interview types as a free dropdown instead of locking to the next required type |
| **Affects** | Any user navigating directly to the Interviews tab |

**Symptom:** Opening the Interviews tab and clicking "Schedule New Interview" shows a free dropdown with all interview types (PHONE_SCREEN, TECHNICAL, BEHAVIORAL, etc.) instead of being locked to the next required type in PANEL_CONFIG order.

**Root cause:** `_loadPanelConfig()` was only called inside `setTab('interviews')` — after the tab rendered. The `nextScheduleableType` computed signal read `requiredTypes()` which was still an empty array because the async config call hadn't resolved yet. The form opened before the signal populated.

**Fix:** Call `_loadPanelConfig(candidate.positionLevel)` in `ngOnInit()` immediately after the candidate resolves (both the pipeline-cache path and the API-fetch path). By the time the user clicks the Interviews tab, the config is already loaded.

---

### BUG-011 — No backend guard: could schedule duplicate interview types or concurrent interviews

| Field | Detail |
|---|---|
| **Severity** | High |
| **Status** | ✅ Fixed — backend guards added to `scheduleInterview` Lambda 2026-06-01 |
| **Discovered** | 2026-06-01 — was able to schedule Phone Screen twice; could schedule while another was SCHEDULED |
| **Affects** | Any candidate in INTERVIEWING stage — data integrity of the interview loop |

**Symptom:** Two issues in one:
1. Could schedule a new interview while another interview was still in `SCHEDULED` state (sequential rule violated)
2. Could schedule the same interview type (e.g. Phone Screen) again after it was already `COMPLETED`

**Root cause:** The `scheduleInterview` POST handler had no pre-write checks on existing `INTERVIEW#` records. It just wrote the new record unconditionally.

**Fix:** Added a guard block after the stage check in the POST handler that:
1. Queries all existing `INTERVIEW#` records for the candidate
2. Returns `409` if any interview is currently `SCHEDULED` — "Cannot schedule a new interview while Phone Screen is still in SCHEDULED state. Mark it as COMPLETED first."
3. Returns `409` if the requested `interviewType` already has a `COMPLETED` record — "A Phone Screen interview has already been COMPLETED for this candidate. Each interview type can only be completed once."

---

### BUG-012 — Vote button reappears after submission

| Field | Detail |
|---|---|
| **Severity** | Low |
| **Status** | ✅ Fixed — session vote tracking added 2026-06-01 |
| **Discovered** | 2026-06-01 — after submitting a vote the "Submit Vote / Score" button was still visible |
| **Affects** | Vote UX — no data impact, button was effectively inert after vote submitted |

**Symptom:** After submitting a vote for an interview, the "Submit Vote / Score" button was still visible. Clicking it again would open the form and allow a second vote submission.

**Root cause:** No client-side tracking of which interviews had been voted on. The `voteSuccess` signal was set on submission but immediately cleared; `voteTargetId` was nulled; but nothing prevented the button from re-rendering.

**Fix:** Added `votedInterviewIds = signal<ReadonlySet<string>>(new Set())` to the workspace component. On vote success, the interview ID is added to the set via `votedInterviewIds.update(prev => new Set([...prev, interviewId]))`. The template checks `votedInterviewIds().has(iv.interviewId)` — if true, renders a green **✓ Voted** badge instead of the vote button.

**Note:** This is session-scoped — refreshing the page will show the button again. Server-side "already voted" state (checking existing VOTE# records on load) is not yet implemented.

---

### BUG-013 — `votesSubmitted` incremented on SAGA record instead of INTERVIEW# record

| Field | Detail |
|---|---|
| **Severity** | High |
| **Status** | ✅ Fixed — `submitVote` Lambda updated 2026-06-01 |
| **Discovered** | 2026-06-01 — vote counter on SAGA grew across interviews; per-interview quorum check was unreliable |
| **Affects** | Voting quorum logic — `VotingCompleted` event could fire at wrong time |

**Symptom:** The `votesSubmitted` counter on the SAGA record accumulated across ALL interviews for the candidate. A second interview's vote could push SAGA `votesSubmitted` past `votesRequired` and prematurely publish `VotingCompleted`.

**Root cause:** `submitVote` Lambda step 8 was calling `UpdateItem` on `PK=CANDIDATE#<id>, SK=SAGA` (`ADD votesSubmitted :1`). Each interview has its own `votesRequired` value and the quorum should be checked per-interview, not globally.

**Fix:**
- `submitVote` now extracts `interviewId` from the request body
- Stores `interviewId` on the `VOTE#` record for traceability
- Increments `votesSubmitted` on `INTERVIEW#${interviewId}` (not SAGA) and reads back both `votesSubmitted` and `votesRequired` from the same `ALL_NEW` response
- Quorum check now compares per-interview counts
- Fallback to SAGA increment preserved for calls without `interviewId` (backward compat, logs a WARN)

---

### BUG-014 — Activity log sidebar never shows interview events

| Field | Detail |
|---|---|
| **Severity** | Medium |
| **Status** | ✅ Fixed — EventBridge publish added to `scheduleInterview` Lambda 2026-06-01 |
| **Discovered** | 2026-06-01 — scheduling and completing interviews had no effect on the activity log sidebar |
| **Affects** | Activity log for the entire interview loop — all interview events invisible |

**Symptom:** After scheduling an interview or marking one complete, the activity log sidebar on the candidate workspace shows no interview-related events. Events like "Interview Scheduled" and "Interview Completed" never appear.

**Root cause — how the activity log works:**
- Activity log reads from `talent-flow-events` table
- `talent-flow-events` is populated by the `talentFlowAuditStream` Lambda
- `talentFlowAuditStream` is triggered by EventBridge rules on `talent-flow-bus`
- `scheduleInterview` Lambda **already had** `EventBridgeClient` imported and `EVENTBRIDGE_BUS_NAME` env var set, and even had the `publishEvent()` helper function declared — but `publishEvent()` was never actually called anywhere in the handler

**Fix:** Added two `publishEvent()` calls:
1. After `PutItem` succeeds for a new `INTERVIEW#` record (POST handler): `publishEvent('InterviewScheduled', { candidateId, interviewId, tenantId, interviewType, scheduledAt, positionLevel, panelMemberIds })`
2. After `UpdateItem` succeeds in `handleCompleteInterview`: `publishEvent('InterviewCompleted', { candidateId, interviewId, outcome })`

Both calls are non-fatal — interview record is already written before the EB call, so a publish failure only affects the activity log.

---

### BUG-015 — Manual Lambda zip skipped `require` path patch — `ImportModuleError` on cold start

| Field | Detail |
|---|---|
| **Severity** | Critical (deployment blocker) |
| **Status** | ✅ Fixed — always use `deploy-talentflow-lambdas.sh` 2026-06-01 |
| **Discovered** | 2026-06-01 — immediately after first manual zip deploy, all Lambda calls returned 500 |
| **Affects** | Any Lambda in `NEEDS_SHARED` in the deploy script if deployed manually |

**Symptom:** After manually zipping and deploying `scheduleInterview`, every request returned 500. The GET interviews endpoint (new feature) and the existing POST/PATCH also broke.

**CloudWatch error:**
```
ImportModuleError: Error: Cannot find module '../shared/config-reader'
Require stack:
- /var/task/index.js
- /var/runtime/index.mjs
```

**Root cause:** The source code uses `require('../shared/config-reader')` because in the local repo structure, `index.js` is at `lambda/scheduleInterview/index.js` and `config-reader.js` is at `lambda/shared/config-reader.js`. In the Lambda zip, both are at the same directory level (`/var/task/`), so the path should be `require('./shared/config-reader')`.

The official deploy script `scripts/deploy-talentflow-lambdas.sh` handles this automatically:
```bash
sed -i '' \
  "s|require('../shared/config-reader')|require('./shared/config-reader')|g" \
  "$BUILD/$ENTRY_FILE"
```

A manual zip does not apply this patch. The Lambda loads, cannot resolve `../shared/config-reader`, and throws `ImportModuleError` before any handler logic runs.

**Rule:** **Never manually zip and deploy Lambdas in `NEEDS_SHARED`.** Always use:
```bash
bash scripts/deploy-talentflow-lambdas.sh scheduleInterview submitVote
# or for all:
bash scripts/deploy-talentflow-lambdas.sh
```

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

| Stage | Status | Notes |
|---|---|---|
| Candidate Created | ✅ Verified | All optional fields (department, location, experience) now persisted — BUG-009 fixed |
| `APPLICATION_REVIEW` | ✅ Verified | — |
| `INTERVIEWING` (advance in) | ✅ Verified | — |
| `INTERVIEWING` gate (block until interviews done) | ✅ Verified | Gate fires correctly — 409 with pending type list |
| Schedule interview — sequential enforcement | ✅ Verified | Type locked to next in PANEL_CONFIG order; backend 409 if another SCHEDULED exists |
| Schedule interview — duplicate type guard | ✅ Verified | Backend 409 if same type already COMPLETED |
| Complete interview (Mark Complete inline form) | ✅ Verified | PATCH updates status + outcome; list refreshes |
| Add Panel Member to interview | ✅ Verified | PATCH merges panel member IDs; list refreshes |
| Submit vote per interview | ✅ Verified | Vote form per card; "✓ Voted" badge replaces button after submission |
| Activity log — interview events | ✅ Verified | InterviewScheduled + InterviewCompleted now published to EventBridge → audit stream |
| Interview loop progress tracker | ✅ Verified | Loop stepper shows PENDING / SCHEDULED / COMPLETED per required type |
| `EVALUATION` (advance out of INTERVIEWING) | ✅ Verified | Gate passes when all 3 required types COMPLETED — CloudWatch confirmed clean |
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
| Interview events missing from activity log | `scheduleInterview` Lambda not publishing to EventBridge (BUG-014 pattern) — check `publishEvent` calls exist |
| Interview scheduled 500 immediately after deploy | Manual zip used instead of deploy script — `ImportModuleError` for `../shared/config-reader` (BUG-015) — use `deploy-talentflow-lambdas.sh` |
| Same interview type schedulable twice | Backend guard missing — check `scheduleInterview` has duplicate-type 409 guard (BUG-011) |
| Vote button reappears after submission | `votedInterviewIds` signal not tracking this interviewId — check `submitVoteForInterview` success handler |
| `votesSubmitted` growing beyond `votesRequired` | SAGA-level counter not cleared between interviews — `submitVote` should target `INTERVIEW#` record (BUG-013) |
| Candidate fields empty despite being entered | Created before BUG-009 fix, or `createCandidate` not redeployed — check Lambda version date |
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

### Phase 4 — Interview loop E2E verification (completed 2026-06-01)
- [x] Fresh candidate created (JUNIOR) — `CAND-01KT1N9BQ9AH8ATEPJYAP2HYDY` (Ryan Giggs)
- [x] Gate blocks advance at INTERVIEWING → EVALUATION before interviews done
- [x] All 3 required interview types scheduled and completed (Phone Screen → Behavioral → Final)
- [x] Gate passes — advance to EVALUATION succeeds
- [x] CloudWatch confirms clean gate log with no "gate skipped" WARN
- [x] Angular workspace UI — Interview tab loads scheduled interviews from `GET /v1/candidates/{id}/interviews`
- [x] "Complete Interview" form submits PATCH and updates status in UI
- [x] "Add Panel Member" form submits PATCH and updates panelMemberIds in UI
- [x] Several UX and data bugs discovered in this phase → fixed in Phase 5

### Phase 5 — Interview UX hardening + activity log (completed 2026-06-01)
- [x] BUG-009: `createCandidate` optional fields not persisted — fixed Lambda + API service
- [x] BUG-010: PANEL_CONFIG race condition — `nextScheduleableType` empty on Interviews tab open — fixed load-on-init
- [x] BUG-011: No backend guard for duplicate/concurrent interviews — added 409 guards in `scheduleInterview`
- [x] BUG-012: Vote button stays after submission — added `votedInterviewIds` session tracking, replaced with "✓ Voted" badge
- [x] BUG-013: `votesSubmitted` incremented on SAGA not INTERVIEW# record — fixed `submitVote` Lambda
- [x] BUG-014: Activity log never showed interview events — `scheduleInterview` never published to EventBridge — fixed
- [x] BUG-015: Manual Lambda zip skipped `require` path patch — broke cold start with `ImportModuleError` — must always use `deploy-talentflow-lambdas.sh`
- [x] Both Lambdas redeployed via `deploy-talentflow-lambdas.sh`
- [x] Phase 5 reference candidate `CAND-01KT1Q9A6RRY8TEMA7TS5B8P2E` — full interview loop + advance to EVALUATION confirmed clean in CloudWatch
