# ─── advanceCandidateStage Lambda + API Route ────────────────────────────────
# Created: 2026-05-19 via feature/4-advance-candidate-stage
# ─────────────────────────────────────────────────────────────────────────────

locals {
  acs_function_name = "advanceCandidateStage"
}

# ── IAM ───────────────────────────────────────────────────────────────────────
resource "aws_iam_role" "advance_candidate_stage" {
  name = "talent-flow-role-advanceCandidateStage"
  path = "/talent-flow/"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "advance_candidate_stage" {
  name = "talent-flow-policy-advanceCandidateStage"
  role = aws_iam_role.advance_candidate_stage.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "DynamoStateRW"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.account_id}:table/talent-flow-state"
      },
      {
        Sid      = "EventBridgePut"
        Effect   = "Allow"
        Action   = "events:PutEvents"
        Resource = "arn:aws:events:${var.aws_region}:${var.account_id}:event-bus/talent-flow-bus"
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.account_id}:log-group:/aws/lambda/advanceCandidateStage:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
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
  function_name    = local.acs_function_name
  role             = aws_iam_role.advance_candidate_stage.arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  filename         = data.archive_file.advance_candidate_stage.output_path
  source_code_hash = data.archive_file.advance_candidate_stage.output_base64sha256
  timeout          = 30
  memory_size      = 256

  tracing_config { mode = "Active" }

  environment {
    variables = {
      STATE_TABLE_NAME     = "talent-flow-state"
      EVENTBRIDGE_BUS_NAME = "talent-flow-bus"
      ENVIRONMENT          = "prod"
      AWS_ACCOUNT_ID       = var.account_id
    }
  }
}

# ── API Gateway ───────────────────────────────────────────────────────────────
resource "aws_apigatewayv2_integration" "advance_candidate_stage" {
  api_id                 = data.aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.advance_candidate_stage.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

resource "aws_apigatewayv2_route" "advance_candidate_stage" {
  api_id             = data.aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "PUT /v1/candidates/{id}/stage"
  authorization_type = "JWT"
  authorizer_id      = data.aws_apigatewayv2_authorizers.talent_flow.items[0].authorizer_id
  target             = "integrations/${aws_apigatewayv2_integration.advance_candidate_stage.id}"
}

resource "aws_lambda_permission" "advance_candidate_stage_api" {
  statement_id  = "AllowTalentFlowAPIInvokeAdvanceCandidateStage"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.advance_candidate_stage.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.arn}/*/*"
}
