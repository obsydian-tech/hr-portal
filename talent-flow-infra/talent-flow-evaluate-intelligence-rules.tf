# ═══════════════════════════════════════════════════════════════════════════════
# Evaluate Intelligence Rules Lambda — INTEL-002 Phase 3
# ═══════════════════════════════════════════════════════════════════════════════
#
# Purpose: DynamoDB Stream Processor that evaluates intelligence rules and
#          triggers notifications when conditions match
#
# Trigger: DynamoDB Stream on talent-flow-state table
# Filter:  Processes SAGA records (candidate/offer changes)
#
# Architecture:
#   talent-flow-state (SAGA updates)
#     ↓ (DynamoDB Stream)
#   evaluateIntelligenceRules Lambda
#     ↓ (Reads) talent-flow-config (INTELLIGENCE_RULES)
#     ↓ (Reads) talent-flow-users (for signals: lastLoginAt, lastActionAt)
#     ↓ (Writes) talent-flow-state (NOTIFICATION# records)
#
# ═══════════════════════════════════════════════════════════════════════════════

# ── Lambda Function ────────────────────────────────────────────────────────────

resource "aws_lambda_function" "evaluate_intelligence_rules" {
  function_name = "evaluateIntelligenceRules"
  role          = aws_iam_role.evaluate_intelligence_rules.arn
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 512  # Higher memory for config reads + DB queries
  timeout       = 60   # Longer timeout for rule evaluation

  # Code will be deployed separately via deploy script
  filename         = local.tf_placeholder_zip
  source_code_hash = filebase64sha256(local.tf_placeholder_zip)

  # Note: config-reader.js will be included directly in the Lambda package
  # (Lambda layer not created yet)

  environment {
    variables = {
      STATE_TABLE_NAME  = data.aws_dynamodb_table.talent_flow_state.name
      CONFIG_TABLE_NAME = data.aws_dynamodb_table.talent_flow_config.name
      USERS_TABLE_NAME  = data.aws_dynamodb_table.talent_flow_users.name
    }
  }

  tracing_config {
    mode = "Active"
  }

  logging_config {
    log_format            = "JSON"
    application_log_level = "INFO"
    system_log_level      = "INFO"
    log_group             = aws_cloudwatch_log_group.evaluate_intelligence_rules.name
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, {
    Purpose = "IntelligenceLayerRuleEvaluation"
    Ticket  = "INTEL-002"
    Phase   = "3"
  })
}

# ── CloudWatch Log Group ───────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "evaluate_intelligence_rules" {
  name              = "/aws/lambda/evaluateIntelligenceRules"
  retention_in_days = 30

  tags = merge(local.tf_tags, {
    Purpose = "IntelligenceLayerLogs"
    Ticket  = "INTEL-002"
  })
}

# ── DynamoDB Stream Event Source Mapping ───────────────────────────────────────

resource "aws_lambda_event_source_mapping" "evaluate_intelligence_rules_stream" {
  event_source_arn  = data.aws_dynamodb_table.talent_flow_state.stream_arn
  function_name     = aws_lambda_function.evaluate_intelligence_rules.arn
  starting_position = "LATEST"  # Don't process historical records
  batch_size        = 10

  # Bisect on error for better error isolation
  bisect_batch_on_function_error = true
  maximum_retry_attempts         = 3

  # Report batch item failures (partial batch processing)
  function_response_types = ["ReportBatchItemFailures"]

  # Note: No stream filter applied - Lambda handles filtering internally
  # This is more reliable than DynamoDB stream filter syntax
  # Lambda evaluates rules for relevant candidate/offer changes

  depends_on = [
    aws_iam_role_policy.evaluate_intelligence_rules
  ]
}

# ── IAM Role ───────────────────────────────────────────────────────────────────

resource "aws_iam_role" "evaluate_intelligence_rules" {
  name        = "talent-flow-role-evaluateIntelligenceRules"
  description = "Execution role for evaluateIntelligenceRules Lambda (INTEL-002)"
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
    Purpose = "IntelligenceLayerRole"
    Ticket  = "INTEL-002"
  })
}

# ── IAM Policy ─────────────────────────────────────────────────────────────────

resource "aws_iam_role_policy" "evaluate_intelligence_rules" {
  name = "talent-flow-policy-evaluateIntelligenceRules"
  role = aws_iam_role.evaluate_intelligence_rules.name

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
        Resource = "${aws_cloudwatch_log_group.evaluate_intelligence_rules.arn}:*"
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
        Sid    = "ConfigTableRead"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:Query"
        ]
        Resource = [
          data.aws_dynamodb_table.talent_flow_config.arn,
          "${data.aws_dynamodb_table.talent_flow_config.arn}/index/*"
        ]
      },
      {
        Sid    = "StateTableRead"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:Query"
        ]
        Resource = [
          data.aws_dynamodb_table.talent_flow_state.arn,
          "${data.aws_dynamodb_table.talent_flow_state.arn}/index/*"
        ]
      },
      {
        Sid    = "StateTableWrite"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem"
        ]
        Resource = data.aws_dynamodb_table.talent_flow_state.arn
      },
      {
        Sid    = "UsersTableRead"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:Query"
        ]
        Resource = [
          data.aws_dynamodb_table.talent_flow_users.arn,
          "${data.aws_dynamodb_table.talent_flow_users.arn}/index/*"
        ]
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
#
# Note: talent-flow-state, talent-flow-users, and talent_flow_state KMS key data sources
# are defined in talent-flow-track-user-actions.tf (reused to avoid duplication)

# talent-flow-config table (source of intelligence rules)
data "aws_dynamodb_table" "talent_flow_config" {
  name = "talent-flow-config"
}
