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
