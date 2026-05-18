# TalentFlow Implementation Agent — Task Prompt Template

Copy and paste this as the opening instruction at the start of every new TF task session.

---

## Standing Instructions

You are implementing TalentFlow MVP1 infrastructure tasks one at a time.

**Workflow (non-negotiable):**
1. Read the Jira ticket
2. Cross-reference all sources (see Research Protocol below)
3. Present a summary with discrepancies clearly flagged
4. **Wait for my confirmation before writing a single line of code**
5. Create feature branch from `develop`
6. Implement
7. `terraform validate` + `terraform plan` (Terraform tasks) OR `npx jest --no-coverage` (Lambda tasks)
8. Commit via Python subprocess script (avoids zsh dquote issues)
9. Push + open PR via Python subprocess script
10. **Deploy Lambda code to AWS:** `bash scripts/deploy-talentflow-lambdas.sh <lambdaDir>` (Lambda tasks only — see Lesson 11)
11. Report PR URL and confirm live deployment

**Never commit directly to `develop`. Always `feature/TF-NNN-*` or `feature/BE-NNN-*` → PR.**

---

## Research Protocol (run before every summary)

Before summarising any task, read ALL of the following in parallel and explicitly cross-reference them:

| Source | What to look for |
|--------|-----------------|
| **Jira ticket** (e.g. NH-107) | Stated requirements, DO/DON'T list, resource names, schema |
| **`talent-flow-infra/locals.tf`** | Locked-in resource names — if ticket names differ, ticket is wrong |
| **`docs/TALENT-FLOW-PLAN-REVISED.md`** | Architectural source of truth — takes precedence over ticket |
| **`docs/Event Driven Architecture Docs/MVP1-FOUNDATION-PLAN-v2.md`** | Milestone-level business intent, table schemas, access patterns, exact Lambda/table names |
| **Naleko reference files** (`infra/*.tf` relevant to current task) | Existing patterns to follow (KMS style, GSI style, tagging, IAM policy documents) |
| **AWS CLI** | Current live state — what already exists, what is missing |
| **Previously merged PRs / existing `talent-flow-infra/` files** | What has already been created — avoid duplication or referencing nonexistent resources |

---

## Discrepancy Detection Checklist

After reading all sources, explicitly check for:

- [ ] Resource names in ticket ≠ `locals.tf` names
- [ ] Ticket references a resource not yet created (wrong KMS key name, nonexistent role, etc.)
- [ ] Table/schema design in ticket ≠ plan doc schema (e.g. multi-table vs single-table-per-concern)
- [ ] Ticket says "create X" but plan doc shows X is intentionally deferred to a later task
- [ ] Ticket's DO list contradicts a decision already locked in a merged PR
- [ ] Ticket names a file path inside `infra/` instead of `talent-flow-infra/`
- [ ] Ticket specifies a billing mode, stream config, or TTL that conflicts with plan doc

---

## Summary Format (required before implementation)

Present your summary in this exact format:

---

### TF-NNN (NH-XXX) — [Task Name] — Pre-Implementation Summary

**✅ Aligned** (matches across all sources):
- Item 1
- Item 2

**⚠️ Discrepancies Found:**
- **Issue:** [what the ticket says] vs [what the plan doc / locals.tf says]
  - **Recommendation:** [your recommended resolution and why]

**Implementation Plan:**
- Files to create/modify (Lambda file path or Terraform file)
- For Lambda tasks: unit tests to write, dependencies required (`npm install`)
- For Terraform tasks: resources to add (count), expected `terraform plan` output

**❓ Confirm before implementing:**
1. [Question only where genuinely ambiguous — skip if recommendation is clear]

---

## Project Context (always active)

- **Repo:** `obsydian-tech/hr-portal`, branch model: `feature/BE-NNN-*` for Epic 2 Lambda code, `feature/TF-NNN-*` for Terraform → always PR to `develop`
- **Lambda dir:** `lambda/` (e.g. `lambda/createCandidate/index.js`, `lambda/shared/config-reader.js`)
- **Infra dir:** `talent-flow-infra/` — small Terraform additions only (never touch `infra/` — Naleko production)
- **AWS account:** `937137806477`, region: `af-south-1` (POPIA hard-locked)
- **Terraform state:** S3 bucket `naleko-tfstate-af-south-1`, key `talent-flow/mvp1/terraform.tfstate`
- **Terraform:** v1.7.0+, provider `hashicorp/aws v5.100.0`, `use_lockfile = true`
- **Runtime:** `nodejs22.x`, arm64, memory 256MB (workflow Lambdas), 512MB (AI/agentic Lambdas)
- **Environment:** `prod`
- **KMS keys created (TF-002):**
  - `aws_kms_key.talent_flow_state` → `alias/talent-flow/state` (DynamoDB state tables)
  - `aws_kms_key.talent_flow_agent_audit` → `alias/talent-flow/agent-audit` (audit, S3, SQS, Secrets)
- **Commit/PR tool:** Python subprocess via `/tmp/commit_BExxx.py` and `/tmp/pr_BExxx.py` (avoids zsh dquote trap)

---

## Hard-Won Lessons (never repeat these mistakes)

### 1. AWS Tag Values — Strict Character Rules
AWS **rejects** tag values containing: em-dashes (`—`), section signs (`§`), commas, or any non-ASCII characters.

**Rule:** All `Purpose`, `Description`, and custom tag values MUST be short, alphanumeric, CamelCase with no prose.

✅ Correct: `"SagaOperationalState"`, `"HITLGate"`, `"AgentAuditTrail"`
❌ Wrong: `"SAGA operational state - candidates, interviews, votes, workflows"`, `"AI agent audit trail — POPIA §21"`

**Before writing ANY tag value in a `.tf` file, verify it contains only:** letters, numbers, hyphens, underscores, dots, forward slashes, colons, at-signs, equals signs, plus signs. No prose sentences. No special characters.

---

### 2. CloudWatch Log Groups — DO NOT set `kms_key_id` without a key policy grant
Setting `kms_key_id` on an `aws_cloudwatch_log_group` requires that the KMS key policy explicitly grants `cloudwatch.amazonaws.com` the right to use the key. Without it, Terraform apply fails with `AccessDeniedException`.

**Rule:** Never add `kms_key_id` to a CloudWatch log group unless you have also added a key policy statement like:
```hcl
{
  Sid       = "AllowCloudWatchLogs"
  Effect    = "Allow"
  Principal = { Service = "logs.af-south-1.amazonaws.com" }
  Action    = ["kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:Describe*"]
  Resource  = "*"
}
```
If that grant is not in scope for the current task, **comment out `kms_key_id`** with `# DEFERRED: requires cloudwatch service principal in key policy`.

---

### 3. Lambda Event Source Mappings with `on_failure` DLQ — IAM must include `sqs:SendMessage`
When an `aws_lambda_event_source_mapping` has a `destination_config { on_failure { destination_arn = <sqs_arn> } }`, AWS validates at ESM creation time that the Lambda's **execution role** has `sqs:SendMessage` on that SQS queue.

**Rule:** Any time you create an ESM with an `on_failure` SQS destination, the corresponding `aws_iam_role_policy` for the Lambda MUST include:
```hcl
{
  Sid      = "DLQSend"
  Effect   = "Allow"
  Action   = ["sqs:SendMessage"]
  Resource = aws_sqs_queue.<dlq_resource>.arn
}
```
This applies to: `archive_audit_log_stream` → `archive_audit_log_dlq`, and any future ESMs.

---

### 4. Terraform State Locking — S3 Native (`use_lockfile = true`)
This project uses **S3 native locking** (`use_lockfile = true` in `provider.tf`), NOT a DynamoDB lock table. There is no `naleko-tfstate-lock` DynamoDB table for TalentFlow.

If Terraform gets stuck on a state lock:
1. Check: `aws s3 ls s3://naleko-tfstate-af-south-1/talent-flow/mvp1/` — look for `terraform.tfstate.tflock`
2. Inspect: `aws s3 cp s3://naleko-tfstate-af-south-1/talent-flow/mvp1/terraform.tfstate.tflock - --region af-south-1`
3. Only delete if the lock owner process is confirmed dead: `aws s3 rm s3://naleko-tfstate-af-south-1/talent-flow/mvp1/terraform.tfstate.tflock --region af-south-1`
4. **Never** use `terraform force-unlock` — it doesn't work with S3 native locking; delete the S3 file directly.

---

### 5. Branch Hygiene — `develop` and `main` Must Stay Aligned
Any commits made **directly to `main`** (e.g. bootstrap fixes, hotfixes) MUST immediately be merged back to `develop` to prevent divergence.

**After any direct-to-main commit:**
```bash
git checkout develop && git merge main --ff-only && git push origin develop
```

**Verify alignment:** `git log --oneline origin/main..origin/develop` and `git log --oneline origin/develop..origin/main` should both return empty.

---

### 6. `talent-flow-infra/.gitignore` — What Must Never Be Committed
The following are covered by `talent-flow-infra/.gitignore` and must never be tracked:
- `*.tfplan` / `tfplan-*` — Terraform plan files (may contain secrets)
- `terraform.tfvars` — contains `aws_account_id` and other env-specific values
- `.terraform/` — provider binaries, not for version control
- `*.tfstate` / `*.tfstate.backup` — state must live in S3 only
- `crash.log` — Terraform crash logs

`.terraform.lock.hcl` IS correctly tracked (pins provider versions — intentional).

---

### 7. Architecture Doc Drift — Deployed Infra Is Always the Source of Truth

The architecture docs in `docs/Event Driven Architecture Docs/` are **v1.0 drafts** that were superseded by the revised plan during Epic 1. Several values in those docs are **wrong relative to what is deployed**. The infra (`talent-flow-infra/*.tf`) and `locals.tf` are always correct.

#### 7a. EventBridge — Source Names (CRITICAL)

The `EVENTBRIDGE_PATTERNS.md` doc lists domain-specific source names. These are **NOT what the deployed rules listen on.** If Lambda code publishes with the wrong source, events will be silently dropped.

| Event | Doc source (❌ wrong) | Deployed rule source (✅ use this) |
|---|---|---|
| `CandidateCreated` | `talent-flow.candidates` | `talent-flow.candidates` ✅ same |
| `InterviewScheduled` | `talent-flow.interviews` | `talent-flow.workflow` |
| `VoteSubmitted` | `talent-flow.evaluations` | `talent-flow.workflow` |
| `VotingCompleted` | `talent-flow.evaluations` | `talent-flow.workflow` |
| `EvaluationCompleted` | `talent-flow.evaluations` | `talent-flow.workflow` |
| `OfferApproved` | `talent-flow.offers` | `talent-flow.workflow` |
| `SLABreached` | `talent-flow.sla` | `talent-flow.sla` ✅ same |

**Rule:** All Epic 2 Lambdas publishing workflow events MUST use `source: "talent-flow.workflow"` except `CandidateCreated` (`talent-flow.candidates`) and `SLABreached` (`talent-flow.sla`). Verify against `talent-flow-infra/talent-flow-eventbridge.tf` before writing any `PutEvents` call.

#### 7b. EventBridge — Bus Name

Doc says `talent-flow-events`. Deployed name is **`talent-flow-bus`** (set in `locals.tf` → `tf_event_bus_name`). Always use the env var `EVENTBRIDGE_BUS_NAME` in Lambda code; never hardcode.

#### 7c. DynamoDB — Table Names

Doc describes a 3-table design (`candidate-pipeline`, `event-ledger`, `workflow-state`). **These tables do not exist.** The deployed 7-table design uses entirely different names. Always use:

| Purpose | Deployed table name (from `locals.tf`) |
|---|---|
| SAGA state (candidates, interviews, votes, workflows) | `talent-flow-state` |
| Tenant config / versioned config | `talent-flow-config` |
| AI audit trail | `talent-flow-agent-audit` |
| Prompt dedup cache | `talent-flow-prompt-cache` |
| HITL pending actions | `talent-flow-pending-actions` |
| AI rate limiting | `talent-flow-ai-rate-limit` |
| Idempotency dedup | `talent-flow-idempotency-keys` |

**Rule:** Never reference `candidate-pipeline`, `event-ledger`, or `workflow-state` anywhere in Lambda code. Use the `locals.tf` names above, passed via Lambda env vars.

#### 7d. Lambda Names — Docs Use Kebab-Case, Infra Uses camelCase

| Lambda catalog name (❌ wrong) | Deployed name from `locals.tf` (✅ use this) |
|---|---|
| `talent-flow-api-handler` | `createCandidate` (+ API GW routing) |
| `talent-flow-workflow-orchestrator` | `orchestrateTalentFlowWorkflow` |
| `talent-flow-interview-scheduler` | `scheduleInterview` |
| `talent-flow-vote-processor` | `submitVote` |
| `talent-flow-evaluation-completer` | `completeEvaluation` |
| `talent-flow-notification-service` | `sendTalentFlowNotification` |
| `talent-flow-sla-monitor` | `monitorTalentFlowSLAs` |

#### 7e. Node.js Runtime

Lambda catalog doc says `nodejs20.x`. All deployed Lambdas use **`nodejs22.x`**. All Epic 2 Lambda code must be Node.js 22 compatible.

---

### 11. Lambda Deployment — Terraform Uses `placeholder.zip`; Real Code Must Be Explicitly Deployed

Terraform (TF-009) creates all Lambda *function resources* using `local.tf_placeholder_zip` (`placeholder.zip`). This is intentional — Epic 1 only declares the infrastructure skeleton. **Terraform never uploads real Lambda code.** After writing and committing Lambda code in any BE task, the code must be separately pushed to AWS.

#### 11a. Deploy script: `scripts/deploy-talentflow-lambdas.sh`

This script packages, patches, and deploys all EP2 Lambdas in one shot:

```bash
# Deploy all 8 EP2 Lambdas at once
bash scripts/deploy-talentflow-lambdas.sh

# Deploy a single Lambda after a BE task
bash scripts/deploy-talentflow-lambdas.sh completeEvaluation

# Deploy multiple specific Lambdas
bash scripts/deploy-talentflow-lambdas.sh submitVote completeEvaluation
```

Run from repo root. Requires: `aws cli v2` configured + correct account (`937137806477` / `af-south-1`).

#### 11b. The `../shared/config-reader` path problem and how the script fixes it

5 Lambdas use `require('../shared/config-reader')`. That relative path is valid during local test runs (Lambda lives in `lambda/<name>/`, shared lives in `lambda/shared/`) but **breaks inside a zip** where everything is at root level.

The deploy script automatically:
1. Copies `lambda/shared/config-reader.js` into `<build>/shared/config-reader.js`
2. Patches the `require` path in the built `index.js`: `../shared/config-reader` → `./shared/config-reader`

Affected Lambdas (currently): `orchestrateTalentFlowWorkflow`, `scheduleInterview`, `submitVote`, `completeEvaluation`, `sendTalentFlowNotification`.

**Rule:** When a new Lambda is written that imports from `../shared/`, add its directory name to the `NEEDS_SHARED` array in `scripts/deploy-talentflow-lambdas.sh`.

#### 11c. When to add a new Lambda to the deploy script

When implementing a new BE task (e.g. `monitorTalentFlowSLAs`), add it to both arrays in the script:
- `ALL_TARGETS` — always add new Lambda dirs here
- `NEEDS_SHARED` — only if the Lambda imports from `../shared/config-reader`

#### 11d. `terraform apply` does NOT redeploy code

Running `terraform apply` after a code change will **not** update the Lambda code in AWS — Terraform only manages infrastructure declared in `.tf` files. The `source_code_hash` is tied to `placeholder.zip` and will never trigger a code update. Always use the deploy script after a Lambda commit.

---

### 10. BE-009 (completeEvaluation) — Confirmed Design Decisions

These decisions were reviewed, recommended by the agent, and **explicitly confirmed** before implementation. Do not relitigate them in future tasks.

#### 10a. Skip the direct SQS send — use EventBridge Rule 5 instead
The Jira ticket (step 8) instructs `completeEvaluation` to also `SendMessage` directly to `talent-flow-notification-queue`. This was **rejected** for three reasons:
1. `NOTIFICATION_QUEUE_URL` is **not** in the Lambda's env vars (confirmed in TF)
2. `completeEvaluation` IAM policy has **no `sqs:SendMessage`** permission
3. EventBridge Rule 5 already routes `EvaluationCompleted → sendTalentFlowNotification` — a direct SQS send would cause a duplicate notification

**Confirmed decision:** `completeEvaluation` publishes `EvaluationCompleted` to EventBridge only. Downstream notification is handled by Rule 5. No Terraform changes required.

#### 10b. `STRONG_NO_VETO` fast-path skips `getConfig`
When `result === 'STRONG_NO_VETO'`, the outcome is `FAILED` by definition. `getConfig` is never called on this path — there is no score to compare against a threshold.

#### 10c. SAGA update fields differ by outcome
- **PASSED:** `currentStage = OFFER_PREPARATION`
- **FAILED:** `currentStage = EVALUATION`, `status = REJECTED`

Both paths set: `evaluationResult`, `finalScore`, `evaluationCompletedAt`, `configVersionUsedForEval`.

#### 10d. Default `minimumPassScore = 6.0`
If `APPROVAL_RULES` config item does not contain `minimumPassScore`, the Lambda defaults to `6.0`. The threshold must NEVER be hardcoded unconditionally — always read from config first, default only as fallback.

#### 10e. `configVersionUsedForEval` on SAGA for POPIA audit trail
The config version used for the pass/fail decision is stored on the SAGA record (`configVersionUsedForEval`) and included in the `EvaluationCompleted` event detail (`configVersion`). This is mandatory for POPIA audit traceability.

#### 10f. `jest.clearAllMocks()` does NOT clear `mockResolvedValueOnce` queues
Tests with early-return paths (e.g. validation returning 400 before reaching `getConfig`) must NOT set up mock return values they will not consume. Unconsumed `mockResolvedValueOnce` values survive `clearAllMocks()` and bleed into later tests, causing false passes or false failures.

**Rule:** Only set up `mockResolvedValueOnce` / `mockRejectedValueOnce` for calls that will actually be made in that test's code path.

---

### 9. BE-008 (submitVote) — Confirmed Design Decisions

These decisions were reviewed, recommended by the agent, and **explicitly confirmed** before implementation. Do not relitigate them in BE-009 or future tasks.

#### 9a. `votesRequired` lives on the INTERVIEW record, NOT on SAGA
`scheduleInterview` writes `votesRequired` to `PK=CANDIDATE#{candidateId}`, `SK=INTERVIEW#{interviewId}`. The SAGA record (`SK=SAGA`) does **not** carry this field. `submitVote` must `Query` `INTERVIEW#` records to read it.

#### 9b. `VoteSubmitted` trigger source — ticket is wrong
The Jira ticket states `source: talent-flow.votes` and `source: talent-flow.evaluations` for the trigger and publish respectively. Both are wrong. Deployed EventBridge rules listen on **`talent-flow.workflow`** for all workflow events. See Lesson 7a.

#### 9c. Atomic counter pattern
Use `UpdateItem ADD votesSubmitted :1` with `ReturnValues: 'UPDATED_NEW'` to atomically increment and read the new value in a **single** DynamoDB call. Do not read-then-write.

#### 9d. Duplicate vote — idempotent, not an error
`PutItem` with `ConditionExpression: 'attribute_not_exists(SK)'`. A `ConditionalCheckFailedException` means the same vote SK was already written — treat as an idempotent no-op (log warn, continue to counter increment and quorum check). Return 200, not 409.

#### 9e. Vote SK uses timestamp for uniqueness
Vote record SK: `VOTE#{voterId}#{ISO-timestamp}`. This allows the condition check to be deterministic within a single Lambda invocation while still being collision-resistant across retries.

#### 9f. EventBridge publish failure is non-fatal
If `PutEvents` fails for `VotingCompleted`, the vote record and SAGA counter have already been committed to DynamoDB. Log the error and return 200 — do not roll back or surface a 500. The downstream workflow will reconcile via the SAGA state.

#### 9g. `configVersionUsed` stored on every vote record
For POPIA audit traceability, every vote record must carry `configVersionUsed = saga.configVersion`. This locks the scoring weights version to the audit trail permanently.

#### 9h. Quorum aggregate reads all VOTE# records
When `votesSubmitted >= votesRequired`, Query all `SK begins_with 'VOTE#'` records for the candidate and compute `averageScore` as a simple mean of each record's `weightedScore`. If the aggregate Query fails, publish `VotingCompleted` anyway with `averageScore: null` (non-fatal).

---

### 8. Terraform `fmt` — Always Run Before Committing
`terraform fmt -check -recursive` is enforced by CI. If HCL is not correctly formatted, the `Terraform — fmt & validate` check fails with exit code 3 and the PR is blocked.

**Rule:** After writing or editing ANY `.tf` file, run `terraform fmt <filename>.tf` (or `terraform fmt -recursive` in the infra dir) before staging the file for commit. Never rely on manual alignment — always let `terraform fmt` decide spacing.

```bash
# Run from talent-flow-infra/
terraform fmt talent-flow-lambdas.tf
# or format all files at once:
terraform fmt -recursive
```

Common cause: manually aligning `=` signs with extra spaces. `terraform fmt` normalises to a single space before `=`, keyed to the longest variable name in the block — do not override this.

---

### Epic 2 Key Invariants (non-negotiable)
1. `configVersion` MUST be snapshotted onto SAGA record at candidate creation (set by `orchestrateTalentFlowWorkflow`)
2. `submitVote` and `completeEvaluation` MUST read config using candidate's locked `configVersion` — never active
3. `scheduleInterview` and `monitorTalentFlowSLAs` MUST use ACTIVE config (no version arg)
4. `manageTalentFlowConfig` MUST guard `custom:isAdmin` claim before any DynamoDB operation
5. All inter-Lambda communication goes through `talent-flow-bus` EventBridge, not direct invocations
6. All notification sends go through `talent-flow-notification-queue` SQS, never SES directly from workflow Lambdas
7. Config table `talent-flow-config` — NEVER delete old versions (in-flight candidates need them); TTL 365 days on deactivated versions

### Epic 2 Terraform Notes
BE-005 is the only Epic 2 task with Terraform additions:
- `aws_cognito_user_group.talent_flow_admin` — add to `talent-flow-infra/talent-flow-cognito.tf`
- `talentFlowPreTokenTrigger` Lambda trigger on Cognito User Pool — LambdaTriggerConfig PRE_TOKEN_GENERATION

### Epic 2 Reference Patterns (copy from Naleko)
| TalentFlow Lambda | Copy pattern from |
|---|---|
| `createCandidate` | `lambda/createEmployee/` — idempotency, DynamoDB write, error handling |
| `sendTalentFlowNotification` | `lambda/sendNotificationEmail/` — SES integration |
| `talentFlowAiChat` | `lambda/nalekoAiChat/` — Bedrock, streaming |
| `talentFlowAuthorizer` | `lambda/agentAuthorizer/` — TOKEN authorizer |

## Progress

### Epic 1 — Terraform Foundation (NH-103) ✅ COMPLETE

| Task | Jira | Status | PR |
|------|------|--------|----|
| TF-001: Terraform backend + provider | NH-104 | ✅ Merged | #149 |
| TF-002: KMS CMKs | NH-105 | ✅ PR open | #151 |
| TF-003: Cognito User Pool | NH-106 | ✅ PR open | #153 |
| TF-004: DynamoDB 7 tables | NH-107 | ✅ PR open | #155 |
| TF-005: S3 audit archive | NH-108 | ✅ PR open | #157 |
| TF-006: SQS FIFO queues | NH-109 | ✅ PR open | #159 |
| TF-007: EventBridge bus | NH-110 | ✅ PR open | #161 |
| TF-008: IAM per-Lambda roles | NH-111 | ✅ PR open | #163 |
| TF-009: 13 Lambda declarations | NH-112 | ✅ PR open | #164 |
| TF-010: API Gateway dual setup | NH-113 | ✅ PR open | #166 |
| TF-011: Step Functions | NH-114 | ✅ PR open | #168 |
| TF-012: AI chat secrets + CI/CD | NH-115 | ✅ PR open | #170 |
| fmt cleanup (all Terraform files) | — | ✅ PR open | #171 |

### Epic 2 — Backend Lambda Foundation (NH-116) 🔶 IN PROGRESS

| Task | Jira | Milestone | Status | PR |
|------|------|-----------|--------|----|
| BE-001: shared/config-reader.js | NH-117 | M1 | ✅ PR open | #174 |
| BE-002: createCandidate Lambda | NH-118 | M1 | ✅ PR open | #176 |
| BE-003: orchestrateTalentFlowWorkflow Lambda | NH-119 | M1 | ✅ PR open | #177 |
| BE-004: manageTalentFlowConfig Lambda | NH-120 | M1 | ✅ PR open | #180 |
| BE-005: Seed script + Cognito admin group | NH-121 | M1 | ✅ PR open | #182 |
| BE-006: scheduleInterview Lambda | NH-122 | M2 | ✅ PR open | #184 |
| BE-007: sendTalentFlowNotification Lambda | NH-123 | M2 | ✅ PR open | #186 |
| BE-008: submitVote Lambda | NH-124 | M3 | ✅ PR open | #188 |
| BE-009: completeEvaluation Lambda | NH-125 | M3 | ✅ PR open | #190 |

### Epic 3 — SLA Monitoring + Agentic AI Foundation (NH-126) 🔶 IN PROGRESS

| Task | Jira | Branch | Status | PR |
|------|------|--------|--------|----|
| AI-003: talentFlowAuthorizer Lambda | NH-129 | `feature/AI-003-authorizer` | ✅ Deployed | #192 |
| AI-004: talentFlowApproveAction Lambda | NH-130 | `feature/AI-004-approve-action` | ✅ Deployed | #193 |
| AI-006: talentFlowRotateApiKey Lambda | NH-132 | `feature/AI-006-rotate-api-key` | ✅ Deployed | #196 |
| AI-005: talentFlowArchiveAuditLog Lambda | NH-131 | `feature/AI-005-archive-audit-log` | ✅ Deployed | #198 |
| AI-001: monitorTalentFlowSLAs Lambda | NH-127 | `feature/AI-001-sla-monitor` | ✅ Deployed | #200 |
| AI-002: talentFlowAiChat Lambda | NH-128 | `feature/AI-002-ai-chat` | 🔲 Not started | — |

**Epic 3 implementation order:** AI-003 → AI-004 → AI-006 → AI-005 → AI-001 → AI-002

**Epic 3 key facts:**
- AI-003 (authorizer): ESM `.mjs` file — deploy script updated to support `.mjs` entry files
- AI-004, AI-005, AI-006: direct copies of Naleko equivalents with env var / table name changes
- AI-001 (`monitorTalentFlowSLAs`): new logic, hourly cron, ACTIVE config, conditional `slaBreachedAt`, publishes to EventBridge (`talent-flow.sla`) AND SQS
- AI-002 (`talentFlowAiChat`): most complex; copy `nalekoAiChat`, all write tools MUST route via `talent-flow-pending-actions` HITL gate; 512MB
- Agent API key secret: `talent-flow/agent/api-key`

### Lesson 12 — ESM Jest Testing Pattern (AI-003)

When writing Jest tests for `.mjs` Lambda files:

1. **Import from `@jest/globals`** — `jest` global is not available in ESM modules:
   ```js
   import { jest, describe, test, expect, beforeEach } from '@jest/globals';
   ```

2. **`package.json` `testMatch` must include `.mjs`:**
   ```json
   "testMatch": ["**/?(*.)+(spec|test).[jt]s?(x)", "**/?(*.)+(spec|test).mjs"]
   ```

3. **`mockReset()` not `clearAllMocks()` in `beforeEach`** — `clearAllMocks()` does NOT clear queued `mockResolvedValueOnce` values; use `mockReset()` which clears both calls AND the queue.

4. **Bust in-process cache between tests** — module-level cache vars (e.g. `cachedKeys`, `cacheExpiry`) persist across tests. Use fake timers:
   ```js
   beforeEach(() => {
     jest.useFakeTimers();
     jest.advanceTimersByTime(CACHE_TTL_MS + 1); // expire cache
     mockSmSend.mockReset();
   });
   ```

5. **Each test sets its own mocks** — never set default mock return values in `beforeEach`; set them inside each `test()` body only for calls that will actually be made.


---

### 13. AI-004 (talentFlowApproveAction) — Confirmed Design Decisions

#### 13a. ESM `.mjs` throughout — no CommonJS
All AI-003+ Lambdas use ESM (`.mjs`). The deploy script was updated (AI-003) to handle `.mjs` entry files. Any future AI-series Lambda must also use `.mjs` + `"type": "module"` in `package.json`.

#### 13b. Merge conflict resolution can silently corrupt scripts
The Python-based merge conflict resolver used during PR #193 mangled `scripts/deploy-talentflow-lambdas.sh`, stripping the entire deploy loop body and leaving only the header + 2 broken `ALL_TARGETS` entries. The script appeared syntactically valid until a real deploy was attempted.

**Rule:** After resolving any merge conflict that touches shell scripts, ALWAYS run `bash -n <script>` immediately to verify syntax. For the deploy script specifically, also grep for the loop body: `grep -n 'for target' scripts/deploy-talentflow-lambdas.sh`.

**Recovery method:** `git show <last-good-commit>:scripts/deploy-talentflow-lambdas.sh > /tmp/good_deploy.sh` — restore from git history, then re-apply the new Lambda addition.

---

### 14. AI-006 (talentFlowRotateApiKey) — Confirmed Design Decisions

#### 14a. `*/3` in JSDoc block comment terminates the comment early
A JSDoc block comment `/** ... */` is terminated by the FIRST `*/` in the text. Writing `cron(0 0 1 */3 ? *)` inside a `/* */` or `/** */` comment closes the comment at `*/3`, causing a syntax error in the rest of the file.

**Rule:** Never write `*/` inside any block comment. Replace with `every3rd` or use `//` line comments instead.

#### 14b. Read `process.env` inside the handler, not at module level
Env vars set at module load time (outside the handler function) are evaluated when the module is first `import`-ed. During Jest tests, `process.env` overrides set after `import` are ignored for module-level reads.

**Rule:** Always read `process.env.FOO` inside the exported handler function, not at module scope. This enables `process.env.FOO = 'test-value'` in `beforeEach` to take effect correctly.

#### 14c. Naleko `rotateApiKey` uses 4-step AWS SM rotation protocol — TalentFlow does not
The Naleko reference file (`lambda/rotateApiKey/index.mjs`) implements the full AWS Secrets Manager rotation protocol (createSecret → setSecret → testSecret → finishSecret via `RotationToken`). TalentFlow's IAM policy for `talentFlowRotateApiKey` only grants `PutSecretValue` — there is no `UpdateSecretVersionStage` permission and no SM rotation Lambda trigger is configured. The correct implementation is a simple cron → `PutSecretValue` pattern.

**Rule:** Do not copy the 4-step rotation protocol from Naleko for `talentFlowRotateApiKey`. Use the simple cron pattern: generate key → `PutSecretValueCommand`.

#### 14d. No email notification; CloudWatch structured log is the POPIA audit trail
`talentFlowRotateApiKey` IAM has no `ses:SendEmail`, no `ssm:GetParameter` (for a Postmark token), and no `dynamodb:PutItem`. The audit trail for the rotation event is a structured CloudWatch log entry:
```json
{ "event": "api_key_rotated", "secretName": "...", "keyPrefix": "tf-", "rotatedAt": "...", "nextRotationAt": "..." }
```
This is sufficient for POPIA compliance. Do not add SES, Postmark, or DynamoDB writes without first adding the corresponding IAM permissions in `talent-flow-infra/`.

#### 14e. Deploy script integrity — always verify after merge conflict resolution
See Lesson 13b. The deploy script was silently broken by the PR #193 merge conflict resolution. This was only discovered when running the actual deploy. The `bash -n` check alone is insufficient — it validates shell syntax but not logic completeness.

---

### Lesson 15 — AI-001 (monitorTalentFlowSLAs) Design Decisions

#### 15a. Always verify IAM before implementing — fix the gap properly, never work around it
The deployed IAM policy for `monitorTalentFlowSLAs` had only `dynamodb:Query` + `dynamodb:Scan` on `talent-flow-state`. The ticket required `UpdateItem` to set `slaBreachedAt` idempotently. A Terraform amendment was made **before** writing Lambda code:
- Added `StateTableUpdate` statement (`dynamodb:UpdateItem` on base table only — not indexes)
- Ran `terraform plan` (confirmed 1 IAM change + 1 pre-existing env var drift, 0 destroys)
- Applied and verified live with `aws iam get-role-policy` before writing a single line of Lambda code

**Rule:** Never shortcut IAM gaps with read-only workarounds. Fix the TF, apply it, then implement.

#### 15b. Conditional UpdateItem is the correct idempotency guard for once-per-stage writes
Use `ConditionExpression: 'attribute_not_exists(slaBreachedAt)'`. This ensures:
- First invocation sets the breach flags atomically
- Subsequent hourly runs skip already-breached candidates in-memory (via `if (saga.slaBreachedAt)` check before the write)
- Concurrent runs that both see no `slaBreachedAt` resolve safely: second write fails with `ConditionalCheckFailedException` → silent skip

#### 15c. No direct SQS send — EventBridge Rule 6 handles notification routing
The ticket asked for a direct SQS send to `talent-flow-notification-queue`. This was **correctly skipped** for two reasons:
1. `NOTIFICATION_QUEUE_URL` is **not** in the Lambda's env vars (confirmed in TF)
2. EventBridge Rule 6 (`sla_breached`) already routes `SLABreached` events → `sendTalentFlowNotification` automatically — a direct SQS send would cause duplicate notifications

#### 15d. Active config read is non-negotiable for SLA monitoring
`getConfig('DEFAULT', 'SLA_THRESHOLDS')` — **never** pass a version argument. SLA policy changes must take effect for ALL open candidates immediately. If a client lowers their threshold from 48h to 24h, all currently-open candidates should be evaluated against the new policy on the next cron run. This is intentional by design (TALENT-FLOW-PLAN-REVISED.md §4.5).

#### 15e. `getConfig` failure is fatal — let the Lambda throw
If `getConfig` fails, the Lambda throws and the cron logs a failure. This is correct — a silent swallow would cause ALL SLA breaches to be missed silently for that hour. Let EventBridge surface the Lambda error; it will retry on the next hour.
