# ---------------------------------------------------------------------------
# TalentFlow Hiring Managers
#
# GET /v1/hiring-managers — returns all CONFIRMED users in the HiringManager
# Cognito group (TF pool af-south-1_C8TTlQxY7).
#
# Used by the TA Create Candidate form to populate the HM selector dropdown.
#
# Lambda:  getHiringManagers
# Route:   GET /v1/hiring-managers
# Auth:    JWT authorizer ko4zam (TalentFlow Cognito pool)
# IAM:     cognito-idp:ListUsersInGroup on TF pool only — no DynamoDB needed
# ---------------------------------------------------------------------------

locals {
  get_hiring_managers_function_name = "getHiringManagers"
  get_hiring_managers_role_name     = "talent-flow-role-getHiringManagers"
}

# ─── IAM Role ─────────────────────────────────────────────────────────────────

resource "aws_iam_role" "get_hiring_managers" {
  name = local.get_hiring_managers_role_name
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
    Feature   = "HMDashboard"
  }
}

resource "aws_iam_role_policy" "get_hiring_managers" {
  name = "${local.get_hiring_managers_role_name}-policy"
  role = aws_iam_role.get_hiring_managers.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/${local.get_hiring_managers_function_name}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid    = "CognitoListHMGroup"
        Effect = "Allow"
        Action = ["cognito-idp:ListUsersInGroup"]
        # Pool consolidation: use Naleko pool (same pool as TF API GW authorizer)
        Resource = "arn:aws:cognito-idp:${var.aws_region}:${var.aws_account_id}:userpool/af-south-1_2LdAGFnw2"
      }
    ]
  })
}

# ─── Lambda function ──────────────────────────────────────────────────────────

resource "aws_lambda_function" "get_hiring_managers" {
  function_name = local.get_hiring_managers_function_name
  role          = aws_iam_role.get_hiring_managers.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip

  environment {
    variables = {
      HM_COGNITO_POOL_ID = "af-south-1_2LdAGFnw2"
      HM_GROUP_NAME      = "naleko-talentflow-hiringmanager"
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.get_hiring_managers_function_name}"
  }

  tags = {
    Component = "TalentFlow"
    Feature   = "HMDashboard"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# ─── API Gateway integration ──────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "get_hiring_managers" {
  api_id                 = data.aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_hiring_managers.invoke_arn
  payload_format_version = "2.0"
}

# ─── Route ────────────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_route" "get_hiring_managers" {
  api_id             = data.aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /v1/hiring-managers"
  target             = "integrations/${aws_apigatewayv2_integration.get_hiring_managers.id}"
  authorization_type = "JWT"
  authorizer_id      = local.talent_flow_cognito_authorizer_id
}

# ─── Lambda permission — allow API GW to invoke ───────────────────────────────

resource "aws_lambda_permission" "get_hiring_managers_apigw" {
  statement_id  = "AllowTalentFlowAPIInvokeGetHiringManagers"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_hiring_managers.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/hiring-managers"
}
