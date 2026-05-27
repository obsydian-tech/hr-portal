# ---------------------------------------------------------------------------
# TalentFlow - advanceCandidateStage Lambda + API Route
#
# Migrated from infra/talentflow-advance-stage.tf (wrong module).
# Resources were bootstrapped live — import before applying:
#
#   cd talent-flow-infra
#   terraform import aws_iam_role.advance_candidate_stage           talent-flow-role-advanceCandidateStage
#   terraform import aws_iam_role_policy.advance_candidate_stage    talent-flow-role-advanceCandidateStage:talent-flow-policy-advanceCandidateStage
#   terraform import aws_lambda_function.advance_candidate_stage    advanceCandidateStage
#   terraform import aws_apigatewayv2_integration.advance_candidate_stage 57l0w7kk9h/t1ug192
#   terraform import aws_apigatewayv2_route.advance_candidate_stage       57l0w7kk9h/0y9pxoi
#   terraform import aws_lambda_permission.advance_candidate_stage_api     advanceCandidateStage/AllowTalentFlowAPIInvokeAdvanceCandidateStage
#
# Route: PUT /v1/candidates/{id}/stage
# API:   57l0w7kk9h (talent-flow-api HTTP API v2)
# ---------------------------------------------------------------------------

# ── IAM ───────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "advance_candidate_stage" {
  name = "talent-flow-role-${local.tf_lambda_advance_stage}"
  path = "/talent-flow/"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = merge(local.tf_tags, { Ticket = "NH-137" })
}

resource "aws_iam_role_policy" "advance_candidate_stage" {
  name = "talent-flow-policy-${local.tf_lambda_advance_stage}"
  role = aws_iam_role.advance_candidate_stage.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DynamoStateRW"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}"
      },
      {
        Sid      = "EventBridgePut"
        Effect   = "Allow"
        Action   = "events:PutEvents"
        Resource = "arn:aws:events:af-south-1:${var.aws_account_id}:event-bus/${local.tf_event_bus_name}"
      },
      {
        Sid      = "CloudWatchLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_advance_stage}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "KMSDecrypt"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = aws_kms_key.talent_flow_state.arn
      }
    ]
  })
}

# ── Lambda ────────────────────────────────────────────────────────────────────

data "archive_file" "advance_candidate_stage" {
  type        = "zip"
  source_dir  = "${path.root}/../lambda/advanceCandidateStage"
  output_path = "${path.root}/../lambda/advanceCandidateStage.zip"
  excludes    = ["node_modules", "*.test.js", "*.md"]
}

resource "aws_lambda_function" "advance_candidate_stage" {
  function_name    = local.tf_lambda_advance_stage
  role             = aws_iam_role.advance_candidate_stage.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  architectures    = ["arm64"]
  filename         = data.archive_file.advance_candidate_stage.output_path
  source_code_hash = data.archive_file.advance_candidate_stage.output_base64sha256
  timeout          = 30
  memory_size      = 256

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_advance_stage}"
  }

  environment {
    variables = {
      STATE_TABLE_NAME     = local.tf_table_state
      EVENTBRIDGE_BUS_NAME = local.tf_event_bus_name
      ENVIRONMENT          = var.environment
      AWS_ACCOUNT_ID       = var.aws_account_id
    }
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-137" })
}

# ── API Gateway ───────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "advance_candidate_stage" {
  api_id                 = aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.advance_candidate_stage.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

resource "aws_apigatewayv2_route" "advance_candidate_stage" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "PUT /v1/candidates/{id}/stage"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
  target             = "integrations/${aws_apigatewayv2_integration.advance_candidate_stage.id}"
}

resource "aws_lambda_permission" "advance_candidate_stage_api" {
  statement_id  = "AllowTalentFlowAPIInvokeAdvanceCandidateStage"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.advance_candidate_stage.function_name
  principal     = "apigateway.amazonaws.com"
  # ⚠️  ADR-006: MUST use .execution_arn (arn:aws:execute-api:…), NOT .arn (arn:aws:apigateway:…).
  # APIGW v2 sends execute-api ARNs as the caller context; using .arn causes
  # AccessDeniedException → silent HTTP 500 with Lambda never invoked.
  source_arn = "${aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*"
}
