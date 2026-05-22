# ---------------------------------------------------------------------------
# TalentFlow Config Management — Feature 1 (NH-Config)
#
# Manages the GET/POST/PUT /v1/config endpoints that power the Config Hub
# admin UI (Config Hub page — scoring weights, SLA thresholds, panel rules,
# approval rules, stage config, email templates).
#
# All resources were created outside Terraform and brought under IaC here.
# Import blocks are in imports.tf — run: terraform plan then terraform apply.
#
# Lambda:  manageTalentFlowConfig
# Routes:  GET  /v1/config
#          PUT  /v1/config
#          POST /v1/config
# Auth:    JWT authorizer ko4zam (Naleko Cognito pool)
# Admin:   PUT + POST require cognito:groups includes naleko-talentflow-admin
# ---------------------------------------------------------------------------

locals {
  manage_config_function_name = "manageTalentFlowConfig"
  manage_config_role_name     = "talent-flow-role-manageTalentFlowConfig"
}

# ─── IAM Role ─────────────────────────────────────────────────────────────────

resource "aws_iam_role" "manage_talent_flow_config" {
  name = local.manage_config_role_name
  path = "/talent-flow/"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = {
    Component = "TalentFlow"
    Ticket    = "NH-Config"
  }
}

resource "aws_iam_role_policy" "manage_talent_flow_config" {
  name = "${local.manage_config_role_name}-policy"
  role = aws_iam_role.manage_talent_flow_config.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/${local.manage_config_function_name}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid    = "ConfigTableCRUD"
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-config",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-config/index/*",
        ]
      },
      {
        Sid      = "KMSStateKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = "arn:aws:kms:${var.aws_region}:${var.aws_account_id}:key/87842eae-1ee4-43d1-8bf8-9dd92415ea68"
      }
    ]
  })
}

# ─── Lambda function ──────────────────────────────────────────────────────────

resource "aws_lambda_function" "manage_talent_flow_config" {
  function_name = local.manage_config_function_name
  role          = aws_iam_role.manage_talent_flow_config.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = "${path.module}/../lambda/manageTalentFlowConfig/function.zip"

  environment {
    variables = {
      ENVIRONMENT       = "prod"
      AWS_ACCOUNT_ID    = var.aws_account_id
      CONFIG_TABLE_NAME = "talent-flow-config"
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.manage_config_function_name}"
  }

  tags = {
    Component = "TalentFlow"
    Ticket    = "NH-Config"
  }
}

# ─── API Gateway integration ──────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "manage_talent_flow_config" {
  api_id                 = data.aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.manage_talent_flow_config.invoke_arn
  payload_format_version = "2.0"
}

# ─── Routes ───────────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_route" "get_config" {
  api_id             = data.aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /v1/config"
  target             = "integrations/${aws_apigatewayv2_integration.manage_talent_flow_config.id}"
  authorization_type = "JWT"
  authorizer_id      = local.talent_flow_cognito_authorizer_id
}

resource "aws_apigatewayv2_route" "put_config" {
  api_id             = data.aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "PUT /v1/config"
  target             = "integrations/${aws_apigatewayv2_integration.manage_talent_flow_config.id}"
  authorization_type = "JWT"
  authorizer_id      = local.talent_flow_cognito_authorizer_id
}

resource "aws_apigatewayv2_route" "post_config" {
  api_id             = data.aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/config"
  target             = "integrations/${aws_apigatewayv2_integration.manage_talent_flow_config.id}"
  authorization_type = "JWT"
  authorizer_id      = local.talent_flow_cognito_authorizer_id
}

# ─── Lambda permission — allow API GW to invoke ───────────────────────────────

resource "aws_lambda_permission" "manage_talent_flow_config_apigw" {
  statement_id  = "AllowTalentFlowAPIInvokeManageConfig"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.manage_talent_flow_config.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/config*"
}
