# ---------------------------------------------------------------------------
# IAM Patches — Supplementary policies for Lambda roles created outside Terraform.
#
# Pattern: these roles pre-exist in AWS. We attach additional inline policies
# here without importing the full role, following the same approach used in
# it-provisioning.tf for the createItTask invocation patch.
#
# Each patch block documents:
#   - Which Lambda role is being patched
#   - What action was missing
#   - Which CloudWatch error it fixes
#   - The ticket / test that confirmed the bug
# ---------------------------------------------------------------------------

# ─── PATCH 1: orchestrateTalentFlowWorkflow — Config table Query access ────────
#
# Bug: config-reader inside orchestrateTalentFlowWorkflow calls QueryCommand on
# the GSI1-active-configs GSI (PK = TENANT#<id>#ACTIVE) to find the active
# config version. The existing inline policy only allows dynamodb:GetItem on the
# table ARN — no Query, and no index ARN.
#
# Error observed (CloudWatch, 2026-06-01):
#   ERROR config-reader: getConfigItem DynamoDB error for NALEKO/SCORING_WEIGHTS:
#   User: arn:aws:sts::937137806477:assumed-role/talent-flow-role-orchestrate...
#   is not authorized to perform: dynamodb:Query on resource: .../index/GSI1-active-configs
#
# Effect of bug: every candidate gets hardcoded default scoring weights and
# stage config regardless of what the admin has configured. configVersion is
# written as NULL.
#
resource "aws_iam_role_policy" "orchestrate_config_query" {
  name = "orchestrate-config-table-query"
  role = "talent-flow-role-orchestrateTalentFlowWorkflow"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ConfigTableQuery"
        Effect = "Allow"
        Action = [
          "dynamodb:Query",
          "dynamodb:GetItem",
        ]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-config",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-config/index/*",
        ]
      }
    ]
  })
}

# ─── PATCH 2: createCandidate — Idempotency table UpdateItem access ────────────
#
# Bug: createCandidate writes an IN_PROGRESS idempotency record via PutItemCommand
# (step 3), then after successful candidate creation marks it COMPLETED via
# UpdateItemCommand (step 8). The existing inline policy only grants GetItem +
# PutItem — UpdateItem is missing.
#
# Error observed (CloudWatch, 2026-06-01):
#   WARN Failed to mark idempotency COMPLETED {
#     idempotencyKey: '37001220-...', candidateId: 'CAND-01KT11912...',
#     error: 'User: arn:aws:sts::...createCandidate... is not authorized
#     to perform: dynamodb:UpdateItem on resource: .../talent-flow-idempotency-keys'
#   }
#
# Effect of bug: idempotency key stays IN_PROGRESS. A retry with the same
# idempotencyKey returns 409 Conflict instead of the original 201. Duplicate
# candidate creation protection is broken for the session.
#
# ─── PATCH 3: advanceCandidateStage + workflow Lambdas — Config table Query access
#
# Bug: config-reader inside these Lambdas calls QueryCommand on the GSI1-active-configs
# GSI to read PANEL_CONFIG (interview loop gate) and other config types.
# Their inline policies only grant access to the state table — no config table at all.
#
# Lambdas affected (confirmed via iam simulate-principal-policy, 2026-06-01):
#   advanceCandidateStage   — needs PANEL_CONFIG for interview loop gate
#   scheduleInterview       — needs PANEL_CONFIG for interview type validation
#   submitVote              — needs PANEL_CONFIG for votesRequired lookup
#   completeEvaluation      — needs PANEL_CONFIG for scoring rules
#   sendTalentFlowNotification — needs EMAIL_TEMPLATES / STAGE_CONFIG
#
# Already allowed (have broader managed policies):
#   orchestrateTalentFlowWorkflow — fixed by PATCH 1
#   monitorTalentFlowSLAs         — already allowed
#   createProvisioningBundle       — already allowed
#
# Error observed (CloudWatch, 2026-06-01):
#   ERROR config-reader: DynamoDB error for NALEKO/PANEL_CONFIG/ACTIVE:
#   User: arn:aws:sts::...talent-flow-role-advanceCandidateStage...
#   is not authorized to perform: dynamodb:Query on resource:
#   .../talent-flow-config/index/GSI1-active-configs
#
# Effect: interview loop gate silently skipped on every INTERVIEWING → EVALUATION
# advance — candidates bypass the required interview completion check.
#
locals {
  config_query_lambdas = [
    "advanceCandidateStage",
    "scheduleInterview",
    "submitVote",
    "completeEvaluation",
    "sendTalentFlowNotification",
  ]
}

resource "aws_iam_role_policy" "config_table_query" {
  for_each = toset(local.config_query_lambdas)

  name = "config-table-query"
  role = "talent-flow-role-${each.key}"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ConfigTableQuery"
        Effect = "Allow"
        Action = [
          "dynamodb:Query",
          "dynamodb:GetItem",
        ]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-config",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-config/index/*",
        ]
      }
    ]
  })
}

# ─── PATCH 4: advanceCandidateStage — State table Query access ──────────────────
#
# Bug: the interview loop gate (added during INTERVIEWING stage architecture rewrite)
# queries all INTERVIEW# records for a candidate using QueryCommand on talent-flow-state.
# The original role policy only had GetItem + UpdateItem — no Query.
#
# Error (CloudWatch, 2026-06-01): Lambda returned 500 "Failed to verify interview
# completion" because the QueryCommand was denied before the gate could evaluate.
#
# Effect: gate always hit the catch block and returned 500 instead of 409 — the
# frontend showed "Failed to verify interview completion" instead of the list of
# pending required interview types.
#
resource "aws_iam_role_policy" "advance_stage_state_query" {
  name = "state-table-query"
  role = "talent-flow-role-advanceCandidateStage"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "StateTableQuery"
        Effect = "Allow"
        Action = ["dynamodb:Query"]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-state",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-state/index/*",
        ]
      }
    ]
  })
}

# ─── PATCH 5: scheduleInterview — State table PutItem + Query access ────────────
#
# Bug: scheduleInterview writes a new INTERVIEW# record via PutItemCommand.
# The original role policy only had GetItem + UpdateItem on talent-flow-state.
# PutItem was never added when the Lambda was provisioned.
#
# Also missing: Query (needed for any INTERVIEW# scan operations).
#
# Error (CloudWatch, 2026-06-01): "Failed to write interview record — not authorized
# to perform: dynamodb:PutItem on resource: talent-flow-state"
#
resource "aws_iam_role_policy" "schedule_interview_state_write" {
  name = "state-table-write"
  role = "talent-flow-role-scheduleInterview"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "StateTablePutQuery"
        Effect = "Allow"
        Action = ["dynamodb:PutItem", "dynamodb:Query"]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-state",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-state/index/*",
        ]
      }
    ]
  })
}

# ─── PATCH 6: createCandidate — Idempotency table UpdateItem access ─────────────
resource "aws_iam_role_policy" "create_candidate_idempotency_update" {
  name = "create-candidate-idempotency-update"
  role = "talent-flow-role-createCandidate"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "IdempotencyUpdate"
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-idempotency-keys"
      }
    ]
  })
}
