# ---------------------------------------------------------------------------
# TalentFlow - API Gateway Dual Setup (NH-113 / TF-010)
#
# Gateway 1: HTTP API v2  - talent-flow-api
#   - Cognito JWT authorizer (Bearer token from Angular SPA)
#   - CORS: localhost:4200 + hr-portal-beryl-three.vercel.app
#   - $default stage, auto_deploy, throttling burst=100 / rate=50
#   - Routes:
#       POST /v1/candidates          → createCandidate
#       POST /v1/config              → manageTalentFlowConfig
#       GET  /v1/config              → manageTalentFlowConfig
#       PUT  /v1/config/{id}         → manageTalentFlowConfig
#
# Gateway 2: REST API v1  - talent-flow-agent-api
#   - TOKEN Lambda authorizer (reads x-api-key header) → talentFlowAuthorizer
#   - REST API v1 required: TOKEN-type authorizer not supported on HTTP API v2
#   - Routes:
#       POST /chat                   → talentFlowAiChat
#       POST /approve                → talentFlowApproveAction
#   - CloudWatch access logging (requires aws_api_gateway_account singleton)
#   - Throttling: burst=100, rate=50 via method_settings
#
# Pattern: mirrors infra/apigateway.tf (Naleko reference)
# ---------------------------------------------------------------------------


# ===========================================================================
# GATEWAY 1 - HTTP API v2  (talent-flow-api)
# ===========================================================================

resource "aws_apigatewayv2_api" "talent_flow_api" {
  name                       = "talent-flow-api"
  protocol_type              = "HTTP"
  route_selection_expression = "$request.method $request.path"

  cors_configuration {
    allow_credentials = false
    allow_headers     = ["authorization", "content-type"]
    allow_methods     = ["GET", "OPTIONS", "POST", "PUT"]
    allow_origins     = ["http://localhost:4200", "https://hr-portal-beryl-three.vercel.app"]
    expose_headers    = []
    max_age           = 86400
  }

  tags = merge(local.tf_tags, { Ticket = "NH-113", Gateway = "talent-flow-api" })
}

# ---------------------------------------------------------------------------
# Cognito JWT Authorizer
# Issuer:   https://cognito-idp.<region>.amazonaws.com/<pool_id>
# Audience: Cognito App Client ID (web client)
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_authorizer" "talent_flow_api_cognito" {
  api_id           = aws_apigatewayv2_api.talent_flow_api.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-jwt"

  jwt_configuration {
    audience = [aws_cognito_user_pool_client.talent_flow_web.id]
    issuer   = "https://cognito-idp.af-south-1.amazonaws.com/${aws_cognito_user_pool.talent_flow.id}"
  }
}

# ---------------------------------------------------------------------------
# CloudWatch Log Group - Gateway 1
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "talent_flow_api_logs" {
  name              = "/aws/apigateway/talent-flow-api"
  retention_in_days = 90
  # DEFERRED:   kms_key_id        = aws_kms_key.talent_flow_agent_audit.arn

  tags = merge(local.tf_tags, { Ticket = "NH-113" })
}

# ---------------------------------------------------------------------------
# $default Stage - auto_deploy, throttling matches Naleko (burst=100/rate=50)
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_stage" "talent_flow_api_default" {
  api_id      = aws_apigatewayv2_api.talent_flow_api.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.talent_flow_api_logs.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
    })
  }

  lifecycle {
    ignore_changes = [deployment_id]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-113" })
}

# ---------------------------------------------------------------------------
# POST /v1/candidates → createCandidate
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_integration" "create_candidate" {
  api_id                 = aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.create_candidate.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "post_candidates" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/candidates"
  target             = "integrations/${aws_apigatewayv2_integration.create_candidate.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_lambda_permission" "create_candidate_talent_flow_api" {
  statement_id  = "AllowTalentFlowAPIInvokeCreateCandidate"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_candidate.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# Config routes → manageTalentFlowConfig
# POST /v1/config  |  GET /v1/config  |  PUT /v1/config/{id}
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_integration" "manage_config" {
  api_id                 = aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.manage_config.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "post_config" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/config"
  target             = "integrations/${aws_apigatewayv2_integration.manage_config.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "get_config" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /v1/config"
  target             = "integrations/${aws_apigatewayv2_integration.manage_config.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "put_config" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "PUT /v1/config/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.manage_config.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_lambda_permission" "manage_config_talent_flow_api" {
  statement_id  = "AllowTalentFlowAPIInvokeManageConfig"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.manage_config.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*"
}


# ===========================================================================
# GATEWAY 2 - REST API v1  (talent-flow-agent-api)
#
# REST API v1 is required because TOKEN-type Lambda authorizers (which read
# raw header values like x-api-key and return IAM policies) are only
# supported on REST API v1. HTTP API v2 supports REQUEST-type only.
# ===========================================================================

resource "aws_api_gateway_rest_api" "agent_api" {
  name        = "talent-flow-agent-api"
  description = "TalentFlow AI Agent API - secured by TOKEN Lambda authorizer"

  endpoint_configuration {
    types = ["REGIONAL"]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-113", Gateway = "talent-flow-agent-api" })
}

# ---------------------------------------------------------------------------
# Resources: /chat and /approve
# ---------------------------------------------------------------------------

resource "aws_api_gateway_resource" "chat" {
  rest_api_id = aws_api_gateway_rest_api.agent_api.id
  parent_id   = aws_api_gateway_rest_api.agent_api.root_resource_id
  path_part   = "chat"
}

resource "aws_api_gateway_resource" "approve" {
  rest_api_id = aws_api_gateway_rest_api.agent_api.id
  parent_id   = aws_api_gateway_rest_api.agent_api.root_resource_id
  path_part   = "approve"
}

# ---------------------------------------------------------------------------
# TOKEN Lambda Authorizer
# Identity source: method.request.header.x-api-key
# talentFlowAuthorizer validates the API key and returns an IAM policy.
# TTL 300 s - matches best practice; set to 0 for immediate invalidation.
# ---------------------------------------------------------------------------

resource "aws_api_gateway_authorizer" "agent_api_token" {
  name                             = "talentFlowAuthorizer"
  rest_api_id                      = aws_api_gateway_rest_api.agent_api.id
  type                             = "TOKEN"
  authorizer_uri                   = aws_lambda_function.authorizer.invoke_arn
  identity_source                  = "method.request.header.x-api-key"
  authorizer_result_ttl_in_seconds = 300
}

# ---------------------------------------------------------------------------
# POST /chat → talentFlowAiChat
# ---------------------------------------------------------------------------

resource "aws_api_gateway_method" "post_chat" {
  rest_api_id   = aws_api_gateway_rest_api.agent_api.id
  resource_id   = aws_api_gateway_resource.chat.id
  http_method   = "POST"
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.agent_api_token.id
}

resource "aws_api_gateway_integration" "post_chat" {
  rest_api_id             = aws_api_gateway_rest_api.agent_api.id
  resource_id             = aws_api_gateway_resource.chat.id
  http_method             = aws_api_gateway_method.post_chat.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.ai_chat.invoke_arn
}

# ---------------------------------------------------------------------------
# POST /approve → talentFlowApproveAction
# ---------------------------------------------------------------------------

resource "aws_api_gateway_method" "post_approve" {
  rest_api_id   = aws_api_gateway_rest_api.agent_api.id
  resource_id   = aws_api_gateway_resource.approve.id
  http_method   = "POST"
  authorization = "CUSTOM"
  authorizer_id = aws_api_gateway_authorizer.agent_api_token.id
}

resource "aws_api_gateway_integration" "post_approve" {
  rest_api_id             = aws_api_gateway_rest_api.agent_api.id
  resource_id             = aws_api_gateway_resource.approve.id
  http_method             = aws_api_gateway_method.post_approve.http_method
  integration_http_method = "POST"
  type                    = "AWS_PROXY"
  uri                     = aws_lambda_function.approve_action.invoke_arn
}

# ---------------------------------------------------------------------------
# Deployment - triggered by hash of method + integration config
# create_before_destroy: required for zero-downtime redeployments
# ---------------------------------------------------------------------------

resource "aws_api_gateway_deployment" "agent_api" {
  rest_api_id = aws_api_gateway_rest_api.agent_api.id

  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.chat.id,
      aws_api_gateway_resource.approve.id,
      aws_api_gateway_method.post_chat.id,
      aws_api_gateway_method.post_approve.id,
      aws_api_gateway_integration.post_chat.id,
      aws_api_gateway_integration.post_approve.id,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [
    aws_api_gateway_integration.post_chat,
    aws_api_gateway_integration.post_approve,
  ]
}

# ---------------------------------------------------------------------------
# CloudWatch Log Group - Gateway 2
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "agent_api_logs" {
  name              = "/aws/apigateway/talent-flow-agent-api"
  retention_in_days = 90
  # DEFERRED:   kms_key_id        = aws_kms_key.talent_flow_agent_audit.arn

  tags = merge(local.tf_tags, { Ticket = "NH-113" })
}

# ---------------------------------------------------------------------------
# Stage (prod)
# ---------------------------------------------------------------------------

resource "aws_api_gateway_stage" "agent_api_prod" {
  rest_api_id   = aws_api_gateway_rest_api.agent_api.id
  deployment_id = aws_api_gateway_deployment.agent_api.id
  stage_name    = "prod"

  xray_tracing_enabled = true

  tags = merge(local.tf_tags, { Ticket = "NH-113" })

  depends_on = [aws_api_gateway_account.talent_flow]
}

# ---------------------------------------------------------------------------
# Method Settings - logging + throttling (burst=100, rate=50)
# Applies to all methods in the stage via "*/*"
# ---------------------------------------------------------------------------

resource "aws_api_gateway_method_settings" "agent_api_all" {
  rest_api_id = aws_api_gateway_rest_api.agent_api.id
  stage_name  = aws_api_gateway_stage.agent_api_prod.stage_name
  method_path = "*/*"

  settings {
    metrics_enabled        = true
    data_trace_enabled     = false
    logging_level          = "INFO"
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }
}

# ---------------------------------------------------------------------------
# IAM Role - API Gateway CloudWatch logging (account-level singleton)
# Required for REST API v1 CloudWatch access log delivery
# ---------------------------------------------------------------------------

resource "aws_iam_role" "api_gateway_cloudwatch" {
  name = "talent-flow-role-api-gateway-cloudwatch"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "apigateway.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = merge(local.tf_tags, { Ticket = "NH-113", Purpose = "ApiGatewayLogging" })
}

resource "aws_iam_role_policy_attachment" "api_gateway_cloudwatch" {
  role       = aws_iam_role.api_gateway_cloudwatch.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

# ---------------------------------------------------------------------------
# aws_api_gateway_account - account-level singleton
# Associates the CloudWatch IAM role so REST API stages can push logs.
# Safe to re-apply; Terraform will update in-place if role ARN changes.
# ---------------------------------------------------------------------------

resource "aws_api_gateway_account" "talent_flow" {
  cloudwatch_role_arn = aws_iam_role.api_gateway_cloudwatch.arn

  depends_on = [aws_iam_role_policy_attachment.api_gateway_cloudwatch]
}

# ---------------------------------------------------------------------------
# Lambda permissions - Gateway 2
# source_arn uses execution_arn with wildcard stage + method
# Authorizer invocation requires a separate permission scoped to /authorizers/*
# ---------------------------------------------------------------------------

resource "aws_lambda_permission" "ai_chat_agent_api" {
  statement_id  = "AllowAgentAPIInvokeAiChat"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ai_chat.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.agent_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "approve_action_agent_api" {
  statement_id  = "AllowAgentAPIInvokeApproveAction"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.approve_action.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.agent_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "authorizer_agent_api" {
  statement_id  = "AllowAgentAPIInvokeAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.agent_api.execution_arn}/authorizers/*"
}


# ===========================================================================
# OUTPUTS
# ===========================================================================

output "talent_flow_api_endpoint" {
  description = "TalentFlow HTTP API v2 endpoint (Gateway 1 - Cognito JWT)"
  value       = aws_apigatewayv2_api.talent_flow_api.api_endpoint
}

output "agent_api_endpoint" {
  description = "TalentFlow Agent REST API endpoint (Gateway 2 - TOKEN authorizer)"
  value       = "https://${aws_api_gateway_rest_api.agent_api.id}.execute-api.af-south-1.amazonaws.com/${aws_api_gateway_stage.agent_api_prod.stage_name}"
}
