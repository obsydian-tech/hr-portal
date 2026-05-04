# ---------------------------------------------------------------------------
# KMS Module — customer-managed key for Naleko PII at rest
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "key_policy" {
  # 1. Account root — full admin; enables IAM delegation for all child principals
  statement {
    sid    = "RootFullAdmin"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.aws_account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  # 2. DynamoDB service — required for SSE with CMK
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
      values   = [var.aws_account_id]
    }
  }

  # 3. S3 service — required for default-SSE with CMK
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
      values   = [var.aws_account_id]
    }
  }

  # 4. Lambda execution roles — encrypt/decrypt for PII fields and presigned URLs
  dynamic "statement" {
    for_each = length(var.allowed_role_arns) > 0 ? [1] : []
    content {
      sid    = "AllowLambdaRolesToUsePIIKey"
      effect = "Allow"
      principals {
        type        = "AWS"
        identifiers = var.allowed_role_arns
      }
      actions = [
        "kms:Encrypt",
        "kms:Decrypt",
        "kms:ReEncryptFrom",
        "kms:ReEncryptTo",
        "kms:GenerateDataKey",
        "kms:GenerateDataKeyWithoutPlaintext",
        "kms:DescribeKey",
      ]
      resources = ["*"]
    }
  }
}

resource "aws_kms_key" "this" {
  description             = var.description
  enable_key_rotation     = true
  rotation_period_in_days = 365
  deletion_window_in_days = var.deletion_window_in_days
  policy                  = data.aws_iam_policy_document.key_policy.json

  tags = {
    Name = var.alias_name
  }
}

resource "aws_kms_alias" "this" {
  name          = "alias/${var.alias_name}"
  target_key_id = aws_kms_key.this.key_id
}
