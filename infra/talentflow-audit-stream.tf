# ---------------------------------------------------------------------------
# TalentFlow Audit Stream — FE-006
#
# Captures every talent-flow.* EventBridge event into talent-flow-events
# DynamoDB table keyed by candidateId, enabling the full event timeline
# in the Candidate Workspace frontend.
#
# Resources:
#   1. DynamoDB table  — talent-flow-events
#   2. EventBridge bus — talent-flow-bus  (data source — already exists)
#   3. EventBridge rule — catch all talent-flow.* on talent-flow-bus
#   4. Lambda          — talentFlowAuditStream  (EventBridge consumer)
#   5. IAM role+policy — talentFlowAuditStream
#   6. Lambda permission — allow EventBridge to invoke talentFlowAuditStream
#   7. Lambda          — getCandidateEvents  (API handler)
#   8. IAM role+policy — getCandidateEvents
#   9. API Gateway integration + route   GET /v1/candidates/{id}/events
#  10. Data source     — TalentFlow API Gateway  (57l0w7kk9h — already exists)
#  11. Data source     — TalentFlow KMS key (alias/talent-flow)
# ---------------------------------------------------------------------------

# ─── Data sources ─────────────────────────────────────────────────────────────

# TalentFlow EventBridge bus — created manually; we consume it, not create it.
data "aws_cloudwatch_event_bus" "talent_flow_bus" {
  name = "talent-flow-bus"
}

# TalentFlow API Gateway — manually created; we add routes to it.
data "aws_apigatewayv2_api" "talent_flow_api" {
  api_id = "57l0w7kk9h"
}

# TalentFlow API stage — /v1
data "aws_apigatewayv2_stage" "talent_flow_v1" {
  api_id   = data.aws_apigatewayv2_api.talent_flow_api.id
  stage_id = "v1"
}

# TalentFlow Cognito authorizer — used by other routes; we attach to the new route.
# Fetch the first authorizer on the TF api (there should be exactly one — talentFlowAuthorizer).
data "aws_apigatewayv2_authorizers" "talent_flow" {
  api_id = data.aws_apigatewayv2_api.talent_flow_api.id
}

# TalentFlow KMS key — used to encrypt the events table at rest.
data "aws_kms_key" "talent_flow" {
  key_id = "alias/talent-flow"
}

# ─── DynamoDB: talent-flow-events ─────────────────────────────────────────────

resource "aws_dynamodb_table" "talent_flow_events" {
  name         = "talent-flow-events"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # TTL: events expire 2 years after creation (POPIA minimum audit trail)
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = data.aws_kms_key.talent_flow.arn
  }

  # PITR: protects audit log from accidental deletion
  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Component          = "TalentFlow"
    Purpose            = "CandidateEventTimeline"
    DataClassification = "Confidential"
    RetentionYears     = "2"
    Ticket             = "FE-006"
  }
}

# ─── IAM: talentFlowAuditStream ───────────────────────────────────────────────

resource "aws_iam_role" "talent_flow_audit_stream" {
  name        = "naleko-talentFlowAuditStream-role"
  description = "Execution role for talentFlowAuditStream Lambda (FE-006)"
  path        = "/naleko/"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = { Ticket = "FE-006", Component = "TalentFlow" }
}

resource "aws_iam_role_policy" "talent_flow_audit_stream" {
  name = "naleko-talentFlowAuditStream-policy"
  role = aws_iam_role.talent_flow_audit_stream.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/talentFlowAuditStream:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid    = "DynamoDBWrite"
        Effect = "Allow"
        # Append-only: PutItem only — no UpdateItem, no DeleteItem
        Action   = ["dynamodb:PutItem"]
        Resource = aws_dynamodb_table.talent_flow_events.arn
      },
      {
        Sid      = "KMS"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
        Resource = data.aws_kms_key.talent_flow.arn
      },
    ]
  })
}

# ─── Lambda: talentFlowAuditStream ────────────────────────────────────────────

resource "aws_lambda_function" "talent_flow_audit_stream" {
  function_name = "talentFlowAuditStream"
  role          = aws_iam_role.talent_flow_audit_stream.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      EVENTS_TABLE_NAME = aws_dynamodb_table.talent_flow_events.name
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/talentFlowAuditStream"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Ticket = "FE-006", Component = "TalentFlow" }
}

# ─── EventBridge rule — catch all talent-flow.* events ────────────────────────

resource "aws_cloudwatch_event_rule" "talent_flow_all_events" {
  name           = "talent-flow-all-events-audit"
  description    = "FE-006: Capture every talent-flow.* event for the candidate timeline audit log"
  event_bus_name = data.aws_cloudwatch_event_bus.talent_flow_bus.name

  event_pattern = jsonencode({
    source = [{ prefix = "talent-flow." }]
  })

  state = "ENABLED"

  tags = { Ticket = "FE-006", Component = "TalentFlow" }
}

resource "aws_cloudwatch_event_target" "talent_flow_audit_stream" {
  rule           = aws_cloudwatch_event_rule.talent_flow_all_events.name
  event_bus_name = data.aws_cloudwatch_event_bus.talent_flow_bus.name
  target_id      = "talentFlowAuditStream"
  arn            = aws_lambda_function.talent_flow_audit_stream.arn
}

resource "aws_lambda_permission" "talent_flow_audit_stream_eventbridge" {
  statement_id  = "AllowEventBridgeInvokeTalentFlowAuditStream"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.talent_flow_audit_stream.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.talent_flow_all_events.arn
}

# ─── IAM: getCandidateEvents ──────────────────────────────────────────────────

resource "aws_iam_role" "get_candidate_events" {
  name        = "naleko-getCandidateEvents-role"
  description = "Execution role for getCandidateEvents Lambda (FE-006)"
  path        = "/naleko/"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = { Ticket = "FE-006", Component = "TalentFlow" }
}

resource "aws_iam_role_policy" "get_candidate_events" {
  name = "naleko-getCandidateEvents-policy"
  role = aws_iam_role.get_candidate_events.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/getCandidateEvents:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid    = "DynamoDBQuery"
        Effect = "Allow"
        # Read-only: GetItem + Query
        Action   = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = aws_dynamodb_table.talent_flow_events.arn
      },
      {
        Sid      = "KMS"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:DescribeKey"]
        Resource = data.aws_kms_key.talent_flow.arn
      },
    ]
  })
}

# ─── Lambda: getCandidateEvents ───────────────────────────────────────────────

resource "aws_lambda_function" "get_candidate_events" {
  function_name = "getCandidateEvents"
  role          = aws_iam_role.get_candidate_events.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 15
  architectures = ["arm64"]

  environment {
    variables = {
      EVENTS_TABLE_NAME = aws_dynamodb_table.talent_flow_events.name
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getCandidateEvents"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = { Ticket = "FE-006", Component = "TalentFlow" }
}

# ─── API Gateway integration + route ──────────────────────────────────────────

resource "aws_apigatewayv2_integration" "get_candidate_events" {
  api_id                 = data.aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_candidate_events.invoke_arn
  payload_format_version = "2.0"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_apigatewayv2_route" "get_candidate_events" {
  api_id             = data.aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /candidates/{id}/events"
  target             = "integrations/${aws_apigatewayv2_integration.get_candidate_events.id}"
  # Re-use the existing JWT authorizer already protecting /candidates/* routes
  authorization_type = "JWT"
  authorizer_id      = tolist(data.aws_apigatewayv2_authorizers.talent_flow.ids)[0]
}

resource "aws_lambda_permission" "get_candidate_events_apigw" {
  statement_id  = "AllowAPIGatewayInvokeGetCandidateEvents"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_candidate_events.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/candidates/*/events"
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "talent_flow_events_table_name" {
  description = "DynamoDB table name for candidate event timeline (FE-006)"
  value       = aws_dynamodb_table.talent_flow_events.name
}

output "talent_flow_events_table_arn" {
  description = "DynamoDB table ARN for candidate event timeline (FE-006)"
  value       = aws_dynamodb_table.talent_flow_events.arn
}
