# ═══════════════════════════════════════════════════════════════════════════════
# Dismiss Tile Lambda — INTEL-002 EPIC 1 Task 1.1
# ═══════════════════════════════════════════════════════════════════════════════
#
# Purpose: API endpoint to dismiss an intelligence tile
#          Records per-user dismissal in talent-flow-intelligence-dismissals table
#
# Trigger: HTTP API Gateway POST /v1/intelligence/tiles/{id}/dismiss
# Auth:    Cognito JWT (same as other talent-flow-api routes)
#
# ═══════════════════════════════════════════════════════════════════════════════

# ── Lambda Function ────────────────────────────────────────────────────────────

resource "aws_lambda_function" "dismiss_tile" {
  function_name = "dismissTile"
  role          = aws_iam_role.dismiss_tile.arn
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
      STATE_TABLE_NAME      = data.aws_dynamodb_table.talent_flow_state.name
    }
  }

  tracing_config {
    mode = "Active"
  }

  logging_config {
    log_format            = "JSON"
    application_log_level = "INFO"
    system_log_level      = "INFO"
    log_group             = aws_cloudwatch_log_group.dismiss_tile.name
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, {
    Purpose = "IntelligenceDismissal"
    Ticket  = "INTEL-002"
    Phase   = "EPIC1-Task1.1"
  })
}

# ── CloudWatch Log Group ───────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "dismiss_tile" {
  name              = "/aws/lambda/dismissTile"
  retention_in_days = 30

  tags = merge(local.tf_tags, {
    Purpose = "IntelligenceDismissalLogs"
    Ticket  = "INTEL-002"
  })
}

# ── IAM Role ───────────────────────────────────────────────────────────────────

resource "aws_iam_role" "dismiss_tile" {
  name        = "talent-flow-role-dismissTile"
  description = "Execution role for dismissTile Lambda (INTEL-002 EPIC 1)"
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
    Purpose = "IntelligenceDismissalRole"
    Ticket  = "INTEL-002"
  })
}

# ── IAM Policy (Least-Privilege) ──────────────────────────────────────────────

resource "aws_iam_role_policy" "dismiss_tile" {
  name = "talent-flow-policy-dismissTile"
  role = aws_iam_role.dismiss_tile.name

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
        Resource = "${aws_cloudwatch_log_group.dismiss_tile.arn}:*"
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
        Sid    = "StateTableRead"
        Effect = "Allow"
        Action = [
          "dynamodb:Query"
        ]
        Resource = data.aws_dynamodb_table.talent_flow_state.arn
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

resource "aws_apigatewayv2_integration" "dismiss_tile" {
  api_id                 = aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.dismiss_tile.invoke_arn
  payload_format_version = "2.0"
}

# ── API Gateway Route: POST /v1/intelligence/tiles/{id}/dismiss ────────────────

resource "aws_apigatewayv2_route" "dismiss_tile" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/intelligence/tiles/{id}/dismiss"
  target             = "integrations/${aws_apigatewayv2_integration.dismiss_tile.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

# ── Lambda Permission for API Gateway ──────────────────────────────────────────

resource "aws_lambda_permission" "dismiss_tile_api" {
  statement_id  = "AllowTalentFlowAPIInvokeDismissTile"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dismiss_tile.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*"
}
