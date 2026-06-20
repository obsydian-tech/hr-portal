# ═══════════════════════════════════════════════════════════════════════════════
# Track User Actions Lambda — INTEL-001 Phase 3
# ═══════════════════════════════════════════════════════════════════════════════
#
# Purpose: DynamoDB Stream Processor that tracks user actions by updating
#          talent-flow-users.lastActionAt when mutations occur
#
# Trigger: DynamoDB Stream on talent-flow-state table
# Filter:  Only processes records where SK starts with "SAGA" and updatedBy exists
#
# Architecture:
#   talent-flow-state (SAGA updates with updatedBy)
#     ↓ (DynamoDB Stream)
#   trackUserActions Lambda
#     ↓ (UpdateItem)
#   talent-flow-users (lastActionAt updated)
#
# ═══════════════════════════════════════════════════════════════════════════════

# ── Lambda Function ────────────────────────────────────────────────────────────

resource "aws_lambda_function" "track_user_actions" {
  function_name = "trackUserActions"
  role          = aws_iam_role.track_user_actions.arn
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 256
  timeout       = 30

  # Code will be deployed separately via deploy script
  filename         = local.tf_placeholder_zip
  source_code_hash = filebase64sha256(local.tf_placeholder_zip)

  environment {
    variables = {
      USERS_TABLE_NAME = data.aws_dynamodb_table.talent_flow_users.name
    }
  }

  tracing_config {
    mode = "Active"
  }

  logging_config {
    log_format            = "JSON"
    application_log_level = "INFO"
    system_log_level      = "INFO"
    log_group             = aws_cloudwatch_log_group.track_user_actions.name
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, {
    Purpose = "UserActionTracking"
    Ticket  = "INTEL-001"
    Phase   = "3"
  })
}

# ── CloudWatch Log Group ───────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "track_user_actions" {
  name              = "/aws/lambda/trackUserActions"
  retention_in_days = 30

  tags = merge(local.tf_tags, {
    Purpose = "UserActionTrackingLogs"
    Ticket  = "INTEL-001"
  })
}

# ── DynamoDB Stream Event Source Mapping ───────────────────────────────────────

resource "aws_lambda_event_source_mapping" "track_user_actions_stream" {
  event_source_arn  = data.aws_dynamodb_table.talent_flow_state.stream_arn
  function_name     = aws_lambda_function.track_user_actions.arn
  starting_position = "LATEST" # Don't process historical records
  batch_size        = 10

  # Bisect on error for better error isolation
  bisect_batch_on_function_error = true
  maximum_retry_attempts         = 3

  # Report batch item failures (partial batch processing)
  function_response_types = ["ReportBatchItemFailures"]

  # Note: No stream filter applied - Lambda handles filtering internally
  # This is more reliable than DynamoDB stream filter syntax
  # Lambda skips records that don't match: SK=SAGA AND updatedBy exists

  depends_on = [
    aws_iam_role_policy.track_user_actions
  ]
}

# ── IAM Role ───────────────────────────────────────────────────────────────────

resource "aws_iam_role" "track_user_actions" {
  name        = "talent-flow-role-trackUserActions"
  description = "Execution role for trackUserActions Lambda (INTEL-001)"
  path        = "/talent-flow/"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = merge(local.tf_tags, {
    Purpose = "UserActionTrackingRole"
    Ticket  = "INTEL-001"
  })
}

# ── IAM Policy ─────────────────────────────────────────────────────────────────

resource "aws_iam_role_policy" "track_user_actions" {
  name = "talent-flow-policy-trackUserActions"
  role = aws_iam_role.track_user_actions.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "Logs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "${aws_cloudwatch_log_group.track_user_actions.arn}:*"
      },
      {
        Sid    = "XRay"
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords"
        ]
        Resource = "*"
      },
      {
        Sid    = "StreamRead"
        Effect = "Allow"
        Action = [
          "dynamodb:DescribeStream",
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:ListStreams"
        ]
        Resource = data.aws_dynamodb_table.talent_flow_state.stream_arn
      },
      {
        Sid    = "UsersTableUpdate"
        Effect = "Allow"
        Action = [
          "dynamodb:UpdateItem"
        ]
        Resource = data.aws_dynamodb_table.talent_flow_users.arn
      },
      {
        Sid    = "KMSDecrypt"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = data.aws_kms_key.talent_flow_state.arn
      }
    ]
  })
}

# ── Data Sources ───────────────────────────────────────────────────────────────

# talent-flow-state table (source of stream events)
data "aws_dynamodb_table" "talent_flow_state" {
  name = "talent-flow-state"
}

# talent-flow-users table (target for updates)
data "aws_dynamodb_table" "talent_flow_users" {
  name = "talent-flow-users"
}

# KMS key for talent-flow-state table encryption
data "aws_kms_key" "talent_flow_state" {
  key_id = "alias/talent-flow/state"
}
