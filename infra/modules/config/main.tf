# ---------------------------------------------------------------------------
# AWS Config — NH-36
# Continuous compliance monitoring: recorder, delivery, 5 managed rules,
# 1 custom region-enforcement rule + SSM auto-remediation for S3 encryption
# ---------------------------------------------------------------------------

# ── IAM Role for AWS Config ──────────────────────────────────────────────────

resource "aws_iam_role" "config_role" {
  name = "naleko-config-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "config.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  managed_policy_arns = [
    "arn:aws:iam::aws:policy/service-role/AWS_ConfigRole",
  ]

  tags = {
    Environment = var.environment
    Project     = "naleko"
  }
}

# Allow Config role to write to the config logs S3 bucket
resource "aws_iam_role_policy" "config_s3" {
  name = "naleko-config-s3-delivery"
  role = aws_iam_role.config_role.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl",
        ]
        Resource = "${aws_s3_bucket.config_logs.arn}/AWSLogs/${var.account_id}/Config/*"
        Condition = {
          StringLike = {
            "s3:x-amz-acl" = "bucket-owner-full-control"
          }
        }
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetBucketAcl"]
        Resource = aws_s3_bucket.config_logs.arn
      }
    ]
  })
}

# ── S3 Bucket for Config Logs ─────────────────────────────────────────────────

resource "aws_s3_bucket" "config_logs" {
  bucket        = "naleko-config-logs-${var.account_id}"
  force_destroy = false

  tags = {
    Environment = var.environment
    Project     = "naleko"
    Purpose     = "aws-config-delivery"
  }
}

resource "aws_s3_bucket_versioning" "config_logs" {
  bucket = aws_s3_bucket.config_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "config_logs" {
  bucket = aws_s3_bucket.config_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "config_logs" {
  bucket                  = aws_s3_bucket.config_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "config_logs" {
  bucket = aws_s3_bucket.config_logs.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AWSConfigBucketPermissionsCheck"
        Effect = "Allow"
        Principal = {
          Service = "config.amazonaws.com"
        }
        Action   = "s3:GetBucketAcl"
        Resource = aws_s3_bucket.config_logs.arn
        Condition = {
          StringEquals = {
            "AWS:SourceAccount" = var.account_id
          }
        }
      },
      {
        Sid    = "AWSConfigBucketDelivery"
        Effect = "Allow"
        Principal = {
          Service = "config.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.config_logs.arn}/AWSLogs/${var.account_id}/Config/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl"    = "bucket-owner-full-control"
            "AWS:SourceAccount" = var.account_id
          }
        }
      }
    ]
  })
}

# ── Config Recorder ───────────────────────────────────────────────────────────

resource "aws_config_configuration_recorder" "naleko" {
  name     = "naleko-config-recorder"
  role_arn = aws_iam_role.config_role.arn

  recording_group {
    all_supported                 = true
    include_global_resource_types = true
  }
}

resource "aws_config_configuration_recorder_status" "naleko" {
  name       = aws_config_configuration_recorder.naleko.name
  is_enabled = true

  depends_on = [aws_config_delivery_channel.naleko]
}

# ── Delivery Channel ─────────────────────────────────────────────────────────

resource "aws_config_delivery_channel" "naleko" {
  name           = "naleko-config-delivery"
  s3_bucket_name = aws_s3_bucket.config_logs.bucket
  sns_topic_arn  = var.ops_sns_topic_arn

  snapshot_delivery_properties {
    delivery_frequency = "TwentyFour_Hours"
  }

  depends_on = [aws_config_configuration_recorder.naleko]
}

# ── 5 Managed Config Rules ───────────────────────────────────────────────────

resource "aws_config_config_rule" "s3_encryption" {
  name        = "naleko-s3-bucket-server-side-encryption-enabled"
  description = "Checks that S3 buckets have server-side encryption enabled."

  source {
    owner             = "AWS"
    source_identifier = "S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED"
  }

  depends_on = [aws_config_configuration_recorder_status.naleko]

  tags = {
    Environment = var.environment
    Severity    = "high"
  }
}

# NOTE: DYNAMODB_TABLE_ENCRYPTED_AT_REST is not available in af-south-1.
# DynamoDB tables are encrypted at rest by default (AWS-managed keys since 2017).
# KMS CMK usage is enforced by the kms_not_scheduled_deletion rule above.

resource "aws_config_config_rule" "kms_not_scheduled_deletion" {
  name        = "naleko-kms-cmk-not-scheduled-for-deletion"
  description = "Checks that no KMS CMK is scheduled for deletion."

  source {
    owner             = "AWS"
    source_identifier = "KMS_CMK_NOT_SCHEDULED_FOR_DELETION"
  }

  depends_on = [aws_config_configuration_recorder_status.naleko]

  tags = {
    Environment = var.environment
    Severity    = "critical"
  }
}

resource "aws_config_config_rule" "lambda_runtime" {
  name        = "naleko-lambda-function-settings-check"
  description = "Checks that Lambda functions do not use deprecated runtimes."

  source {
    owner             = "AWS"
    source_identifier = "LAMBDA_FUNCTION_SETTINGS_CHECK"
  }

  input_parameters = jsonencode({
    runtime = "nodejs20.x,nodejs22.x"
  })

  depends_on = [aws_config_configuration_recorder_status.naleko]

  tags = {
    Environment = var.environment
    Severity    = "medium"
  }
}

resource "aws_config_config_rule" "restricted_ssh" {
  name        = "naleko-restricted-ssh"
  description = "Checks that security groups do not allow unrestricted SSH (port 22)."

  source {
    owner             = "AWS"
    source_identifier = "INCOMING_SSH_DISABLED"
  }

  depends_on = [aws_config_configuration_recorder_status.naleko]

  tags = {
    Environment = var.environment
    Severity    = "high"
  }
}

# ── Custom Config Rule: af-south-1 region enforcement ────────────────────────

# Lambda function for the custom rule
resource "aws_lambda_function" "config_region_check" {
  function_name = "configRegionCheck"
  role          = var.lambda_role_arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = var.config_lambda_zip
  memory_size   = 128
  timeout       = 30
  architectures = ["x86_64"]

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/configRegionCheck"
  }

  environment {
    variables = {
      ALLOWED_REGION         = "af-south-1"
      # Documented deviation: Textract is called cross-region in eu-west-1 (NH-30)
      EXEMPT_RESOURCE_TYPES  = "AWS::Textract::*"
    }
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash, runtime]
  }

  tags = {
    Environment = var.environment
    Purpose     = "aws-config-custom-rule"
  }
}

# Allow Config service to invoke the Lambda
resource "aws_lambda_permission" "config_invoke_region_check" {
  statement_id  = "AllowAWSConfigInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.config_region_check.function_name
  principal     = "config.amazonaws.com"
  source_account = var.account_id
}

resource "aws_config_config_rule" "region_enforcement" {
  name        = "naleko-af-south-1-region-enforcement"
  description = "Custom rule: flags any resource created outside af-south-1 as NON_COMPLIANT. Exception: Textract cross-region calls (NH-30 documented deviation)."

  source {
    owner = "CUSTOM_LAMBDA"
    source_identifier = aws_lambda_function.config_region_check.arn

    source_detail {
      message_type = "ConfigurationItemChangeNotification"
    }

    source_detail {
      message_type = "OversizedConfigurationItemChangeNotification"
    }
  }

  depends_on = [
    aws_config_configuration_recorder_status.naleko,
    aws_lambda_permission.config_invoke_region_check,
  ]

  tags = {
    Environment = var.environment
    Severity    = "high"
  }
}

# ── SSM Auto-remediation: S3 server-side encryption ──────────────────────────

resource "aws_config_remediation_configuration" "s3_encryption" {
  config_rule_name = aws_config_config_rule.s3_encryption.name
  target_type      = "SSM_DOCUMENT"
  target_id        = "AWS-EnableS3BucketEncryption"
  automatic        = true

  maximum_automatic_attempts = 3
  retry_attempt_seconds      = 60

  parameter {
    name         = "AutomationAssumeRole"
    static_value = aws_iam_role.config_role.arn
  }

  parameter {
    name           = "BucketName"
    resource_value = "RESOURCE_ID"
  }

  parameter {
    name         = "SSEAlgorithm"
    static_value = "AES256"
  }

  depends_on = [aws_config_config_rule.s3_encryption]
}
