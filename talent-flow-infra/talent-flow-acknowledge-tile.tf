# ═══════════════════════════════════════════════════════════════════════════════
# Acknowledge Tile Lambda — INTEL-002 EPIC 1 Task 1.1
# ═══════════════════════════════════════════════════════════════════════════════
#
# Purpose: API endpoint to acknowledge an intelligence tile
#          Records per-user acknowledgment (required for CRITICAL compliance tiles)
#
# Trigger: HTTP API Gateway POST /v1/intelligence/tiles/{id}/acknowledge
# Auth:    Cognito JWT (same as other talent-flow-api routes)
#
# ═══════════════════════════════════════════════════════════════════════════════

# ── Lambda Function ────────────────────────────────────────────────────────────

resource "aws_lambda_function" "acknowledge_tile" {
  function_name = "acknowledgeTile"
  role          = aws_iam_role.acknowledge_tile.arn
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 256
  timeout       = 10

  # Code will be deployed separately via deploy script
  filename         = local.tf_placeholder_zip
  source_code_hash = filebase64sha256(local.tf_placeholder_zip)

  environment {
    variables = {
      DISMISSALS_TABLE_NAME = aws_dynamodb_table.intelligence_dismissals.name
    }
  }

  tracing_config {
    mode = "Active"
  }

  logging_config {
    log_format            = "JSON"
    application_log_level = "INFO"
    system_log_level      = "INFO"
    log_group             = aws_cloudwatch_log_group.acknowledge_tile.name
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, {
    Purpose = "IntelligenceAcknowledge"
    Ticket  = "INTEL-002"
    Phase   = "EPIC1-Task1.1"
  })
}

# ── CloudWatch Log Group ───────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "acknowledge_tile" {
  name              = "/aws/lambda/acknowledgeTile"
  retention_in_days = 30

  tags = merge(local.tf_tags, {
    Purpose = "IntelligenceAcknowledgeLogs"
    Ticket  = "INTEL-002"
  })
}

# ── IAM Role ───────────────────────────────────────────────────────────────────

resource "aws_iam_role" "acknowledge_tile" {
  name        = "talent-flow-role-acknowledgeTile"
  description = "Execution role for acknowledgeTile Lambda (INTEL-002 EPIC 1)"
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
    Purpose = "IntelligenceAcknowledgeRole"
    Ticket  = "INTEL-002"
  })
}

# ── IAM Policy (Least-Privilege) ──────────────────────────────────────────────

resource "aws_iam_role_policy" "acknowledge_tile" {
  name = "talent-flow-policy-acknowledgeTile"
  role = aws_iam_role.acknowledge_tile.name

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
        Resource = "${aws_cloudwatch_log_group.acknowledge_tile.arn}:*"
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
        Sid    = "DismissalsTableWrite"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem"
        ]
        Resource = aws_dynamodb_table.intelligence_dismissals.arn
      },
      {
        Sid    = "KMSDecrypt"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = aws_kms_key.talent_flow_state.arn
      }
    ]
  })
}

# ── API Gateway Integration ────────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "acknowledge_tile" {
  api_id                 = aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.acknowledge_tile.invoke_arn
  payload_format_version = "2.0"
}

# ── API Gateway Route: POST /v1/intelligence/tiles/{id}/acknowledge ────────────

resource "aws_apigatewayv2_route" "acknowledge_tile" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/intelligence/tiles/{id}/acknowledge"
  target             = "integrations/${aws_apigatewayv2_integration.acknowledge_tile.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

# ── Lambda Permission for API Gateway ──────────────────────────────────────────

resource "aws_lambda_permission" "acknowledge_tile_api" {
  statement_id  = "AllowTalentFlowAPIInvokeAcknowledgeTile"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.acknowledge_tile.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*"
}
