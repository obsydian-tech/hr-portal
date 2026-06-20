# ═══════════════════════════════════════════════════════════════════════════════
# Get Intelligence Tiles Lambda — INTEL-002 Phase 6.2.5
# ═══════════════════════════════════════════════════════════════════════════════
#
# Purpose: API endpoint to fetch intelligence tiles for dashboard display
#          Tiles are projections over signal snapshots (§10.2)
#
# Trigger: HTTP API Gateway GET /v1/intelligence/tiles
# Auth:    Cognito JWT (same as other talent-flow-api routes)
#
# ═══════════════════════════════════════════════════════════════════════════════

# ── Lambda Function ────────────────────────────────────────────────────────────

resource "aws_lambda_function" "get_intelligence_tiles" {
  function_name = "getIntelligenceTiles"
  role          = aws_iam_role.get_intelligence_tiles.arn
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
      STATE_TABLE_NAME      = data.aws_dynamodb_table.talent_flow_state.name
      DISMISSALS_TABLE_NAME = aws_dynamodb_table.intelligence_dismissals.name
      CONFIG_TABLE_NAME     = data.aws_dynamodb_table.talent_flow_config.name
    }
  }

  tracing_config {
    mode = "Active"
  }

  logging_config {
    log_format            = "JSON"
    application_log_level = "INFO"
    system_log_level      = "INFO"
    log_group             = aws_cloudwatch_log_group.get_intelligence_tiles.name
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, {
    Purpose = "IntelligenceLayerTiles"
    Ticket  = "INTEL-002"
    Phase   = "6.2.5"
  })
}

# ── CloudWatch Log Group ───────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "get_intelligence_tiles" {
  name              = "/aws/lambda/getIntelligenceTiles"
  retention_in_days = 30

  tags = merge(local.tf_tags, {
    Purpose = "IntelligenceLayerLogs"
    Ticket  = "INTEL-002"
  })
}

# ── IAM Role ───────────────────────────────────────────────────────────────────

resource "aws_iam_role" "get_intelligence_tiles" {
  name        = "talent-flow-role-getIntelligenceTiles"
  description = "Execution role for getIntelligenceTiles Lambda (INTEL-002)"
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

resource "aws_iam_role_policy" "get_intelligence_tiles" {
  name = "talent-flow-policy-getIntelligenceTiles"
  role = aws_iam_role.get_intelligence_tiles.name

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
        Resource = "${aws_cloudwatch_log_group.get_intelligence_tiles.arn}:*"
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
        Sid    = "StateTableRead"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          data.aws_dynamodb_table.talent_flow_state.arn,
          "${data.aws_dynamodb_table.talent_flow_state.arn}/index/*"
        ]
      },
      {
        Sid    = "DismissalsTableRead"
        Effect = "Allow"
        Action = [
          "dynamodb:Query"
        ]
        Resource = aws_dynamodb_table.intelligence_dismissals.arn
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

# ── API Gateway Integration ────────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "get_intelligence_tiles" {
  api_id                 = aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_intelligence_tiles.invoke_arn
  payload_format_version = "2.0"
}

# ── API Gateway Route: GET /v1/intelligence/tiles ──────────────────────────────

resource "aws_apigatewayv2_route" "get_intelligence_tiles" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /v1/intelligence/tiles"
  target             = "integrations/${aws_apigatewayv2_integration.get_intelligence_tiles.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

# ── Lambda Permission for API Gateway ──────────────────────────────────────────

resource "aws_lambda_permission" "get_intelligence_tiles_api" {
  statement_id  = "AllowTalentFlowAPIInvokeGetIntelligenceTiles"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_intelligence_tiles.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*"
}
