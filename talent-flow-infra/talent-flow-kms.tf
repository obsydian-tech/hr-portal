# ---------------------------------------------------------------------------
# TalentFlow KMS — Customer Managed Keys (NH-105 / TF-002)
#
# Two dedicated CMKs — completely separate from Naleko's naleko-onboarding-pii
# key. Zero cross-references with any Naleko resource.
#
# Key  1: alias/talent-flow/state
#   Encrypts: talent-flow-state (SAGA), talent-flow-config,
#             talent-flow-pending-actions, talent-flow-prompt-cache,
#             talent-flow-ai-rate-limit, talent-flow-idempotency-keys DynamoDB tables
#
# Key 2: alias/talent-flow/agent-audit
#   Encrypts: talent-flow-agent-audit DynamoDB table,
#             talent-flow-audit-archive S3 bucket,
#             talent-flow-notification-queue + talent-flow-feedback-queue SQS,
#             talent-flow/agent/api-key Secrets Manager secret
#
# Key policy pattern copied from infra/modules/kms/main.tf (Naleko):
#   - Root admin statement (full kms:* for IAM delegation)
#   - DynamoDB service principal — scoped with aws:SourceAccount condition
#   - S3 service principal — scoped with aws:SourceAccount condition
#   - SQS service principal — scoped with aws:SourceAccount condition
#   - Lambda roles: deferred to TF-008 (IAM) once roles exist
# ---------------------------------------------------------------------------

data "aws_caller_identity" "current" {}

# ── Key 1: talent-flow/state ─────────────────────────────────────────────────

data "aws_iam_policy_document" "talent_flow_state_key_policy" {
  # 1. Account root — full admin; enables IAM delegation for all child principals
  statement {
    sid    = "RootFullAdmin"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  # 2. DynamoDB service — required for SSE-CMK on all talent-flow-* tables
  statement {
    sid    = "AllowDynamoDBSSE"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["dynamodb.amazonaws.com"]
    }
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncryptFrom",
      "kms:ReEncryptTo",
      "kms:GenerateDataKey",
      "kms:GenerateDataKeyWithoutPlaintext",
      "kms:DescribeKey",
      "kms:CreateGrant",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  # NOTE: Lambda IAM role grants for this key are added in TF-008 (talent-flow-iam.tf)
  # once the per-Lambda execution roles exist. Do not add role ARNs here manually.
}

resource "aws_kms_key" "talent_flow_state" {
  description             = "TalentFlow — CMK for DynamoDB table encryption (state, config, pending-actions, caches)"
  enable_key_rotation     = true
  rotation_period_in_days = 365
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.talent_flow_state_key_policy.json

  tags = merge({
    Name    = "talent-flow/state"
    Purpose = "DynamoDB SSE"
    Ticket  = "NH-105"
  }, local.tf_tags)
}

resource "aws_kms_alias" "talent_flow_state" {
  name          = "alias/talent-flow/state"
  target_key_id = aws_kms_key.talent_flow_state.key_id
}

# ── Key 2: talent-flow/agent-audit ───────────────────────────────────────────

data "aws_iam_policy_document" "talent_flow_agent_audit_key_policy" {
  # 1. Account root — full admin
  statement {
    sid    = "RootFullAdmin"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  # 2. DynamoDB service — for talent-flow-agent-audit table SSE
  statement {
    sid    = "AllowDynamoDBSSE"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["dynamodb.amazonaws.com"]
    }
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncryptFrom",
      "kms:ReEncryptTo",
      "kms:GenerateDataKey",
      "kms:GenerateDataKeyWithoutPlaintext",
      "kms:DescribeKey",
      "kms:CreateGrant",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  # 3. S3 service — for talent-flow-audit-archive bucket default SSE
  statement {
    sid    = "AllowS3DefaultSSE"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:GenerateDataKey",
      "kms:GenerateDataKeyWithoutPlaintext",
      "kms:DescribeKey",
      "kms:ReEncryptFrom",
      "kms:ReEncryptTo",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  # 4. SQS service — for talent-flow-notification-queue + talent-flow-feedback-queue SSE
  statement {
    sid    = "AllowSQSSSE"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["sqs.amazonaws.com"]
    }
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:GenerateDataKey",
      "kms:GenerateDataKeyWithoutPlaintext",
      "kms:DescribeKey",
    ]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  # NOTE: Lambda IAM role grants for this key are added in TF-008 (talent-flow-iam.tf)
  # once the per-Lambda execution roles exist. Do not add role ARNs here manually.
}

resource "aws_kms_key" "talent_flow_agent_audit" {
  description             = "TalentFlow — CMK for agent-audit DynamoDB table, S3 audit archive, SQS queues, Secrets Manager"
  enable_key_rotation     = true
  rotation_period_in_days = 365
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.talent_flow_agent_audit_key_policy.json

  tags = merge({
    Name    = "talent-flow/agent-audit"
    Purpose = "DynamoDB SSE + S3 audit archive + SQS + Secrets Manager"
    Ticket  = "NH-105"
  }, local.tf_tags)
}

resource "aws_kms_alias" "talent_flow_agent_audit" {
  name          = "alias/talent-flow/agent-audit"
  target_key_id = aws_kms_key.talent_flow_agent_audit.key_id
}
