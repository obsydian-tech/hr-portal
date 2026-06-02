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

# TalentFlow Cognito JWT authorizer ID (cognito-jwt, id: ko4zam).
# aws_apigatewayv2_authorizer has no data source in this provider version;
# the ID is stable — managed by talent-flow-infra/ and imported here by value.
locals {
  talent_flow_cognito_authorizer_id = "ko4zam"
}

# TalentFlow KMS key — used to encrypt the events table at rest.
# The alias/talent-flow does not exist; look up by key ID directly.
data "aws_kms_key" "talent_flow" {
  key_id = "87842eae-1ee4-43d1-8bf8-9dd92415ea68"
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

  # GSI1: tenant-scoped event timeline (matches talent-flow-state convention)
  # GSI1PK = TENANT#<tenantId>  /  GSI1SK = ISO-8601 timestamp
  # Supports: POPIA audit exports, compliance date-range queries, multi-tenant ops
  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
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
        # Read-only: GetItem + Query (table + all GSIs)
        Action = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = [
          aws_dynamodb_table.talent_flow_events.arn,
          "${aws_dynamodb_table.talent_flow_events.arn}/index/*",
        ]
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
  api_id    = data.aws_apigatewayv2_api.talent_flow_api.id
  route_key = "GET /v1/candidates/{id}/events"
  target    = "integrations/${aws_apigatewayv2_integration.get_candidate_events.id}"
  # Re-use the existing JWT authorizer already protecting /candidates/* routes
  authorization_type = "JWT"
  authorizer_id      = local.talent_flow_cognito_authorizer_id
}

resource "aws_lambda_permission" "get_candidate_events_apigw" {
  statement_id  = "AllowAPIGatewayInvokeGetCandidateEvents"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_candidate_events.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/candidates/*/events"
}

# ─── EventBridge: EvaluationCompleted → createOffer (NH-130) ─────────────────
#
# Option B: EvaluationCompleted is published by advanceCandidateStage when the TA
# deliberately advances EVALUATION → BACKGROUND_CHECK. createOffer listens here and
# auto-creates the draft offer. The outcome filter ensures FAILED events are ignored.
#
# createOffer Lambda — deployed outside this Terraform workspace; referenced by data source.

data "aws_lambda_function" "create_offer" {
  function_name = "createOffer"
}

resource "aws_cloudwatch_event_rule" "evaluation_completed_create_offer" {
  name           = "talent-flow-evaluation-completed-create-offer"
  description    = "EvaluationCompleted (outcome=PASSED) on talent-flow-bus → createOffer Lambda"
  event_bus_name = data.aws_cloudwatch_event_bus.talent_flow_bus.name

  event_pattern = jsonencode({
    source        = ["talent-flow.workflow"]
    "detail-type" = ["EvaluationCompleted"]
    detail = {
      outcome = ["PASSED"]
    }
  })

  state = "ENABLED"

  tags = { Ticket = "NH-130", Component = "TalentFlow" }
}

resource "aws_cloudwatch_event_target" "evaluation_completed_create_offer" {
  rule           = aws_cloudwatch_event_rule.evaluation_completed_create_offer.name
  event_bus_name = data.aws_cloudwatch_event_bus.talent_flow_bus.name
  target_id      = "createOffer-onEvaluationCompleted"
  arn            = data.aws_lambda_function.create_offer.arn
}

resource "aws_lambda_permission" "create_offer_evaluation_completed" {
  statement_id  = "AllowEventBridgeInvokeCreateOfferOnEvalCompleted"
  action        = "lambda:InvokeFunction"
  function_name = data.aws_lambda_function.create_offer.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.evaluation_completed_create_offer.arn
}

# ─── EventBridge: OfferAccepted (talent-flow-bus) → sendNotificationEmail ────
#
# Cross-bus fix: advanceOfferState publishes OfferAccepted to talent-flow-bus but
# the existing rule in eventbridge.tf listens on naleko-onboarding — it never fires.
# This adds the equivalent rule on the correct bus. The old rule is left untouched
# (additive change) in case advanceOfferState ever publishes to naleko-onboarding.

resource "aws_cloudwatch_event_rule" "offer_accepted_notify_hm_tf_bus" {
  name           = "talent-flow-offer-accepted-notify-hm-provisioning"
  description    = "OfferAccepted on talent-flow-bus → notify HM to create IT provisioning bundle"
  event_bus_name = data.aws_cloudwatch_event_bus.talent_flow_bus.name

  event_pattern = jsonencode({
    source        = ["talent-flow.workflow"]
    "detail-type" = ["OfferAccepted"]
  })

  state = "ENABLED"

  tags = { Ticket = "NH-132", Component = "TalentFlow" }
}

resource "aws_cloudwatch_event_target" "offer_accepted_notify_hm_tf_bus" {
  rule           = aws_cloudwatch_event_rule.offer_accepted_notify_hm_tf_bus.name
  event_bus_name = data.aws_cloudwatch_event_bus.talent_flow_bus.name
  target_id      = "sendNotificationEmail-offerAccepted-tfBus"
  arn            = aws_lambda_function.send_notification_email.arn

  input_transformer {
    input_paths = {
      candidateName = "$.detail.candidateName"
      hmEmail       = "$.detail.hmEmail"
      candidateId   = "$.detail.candidateId"
    }
    input_template = <<-EOT
      {
        "notificationType": "HM_PROVISIONING_REMINDER",
        "recipientEmail": "<hmEmail>",
        "subject": "Action required: Set up IT provisioning for <candidateName>",
        "body": "The offer for <candidateName> has been accepted. Please create their IT provisioning bundle at your earliest convenience.",
        "candidateId": "<candidateId>"
      }
    EOT
  }
}

resource "aws_lambda_permission" "send_notification_email_offer_accepted_tf_bus" {
  statement_id  = "AllowTFBusInvokeNotifyHMProvisioningOfferAccepted"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.send_notification_email.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.offer_accepted_notify_hm_tf_bus.arn
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
