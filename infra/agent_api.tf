# ---------------------------------------------------------------------------
# NH-43: Agent-facing API namespace /agent/v1/*
#
# A separate HTTP API with Lambda-based API key auth (x-api-key header).
# The key is stored in Secrets Manager; the agentAuthorizer Lambda validates it.
#
# Auth design:
#   - identity_source = $request.header.x-api-key
#   - Authorizer returns { isAuthorized, context: { actor: 'AGENT' } }
#   - context.actor flows through to Lambdas via event.requestContext.authorizer.lambda.actor
#
# Rate limiting: 10 rps / 20 burst at the stage level.
# Note: per-key quota (requests/day) requires REST API v1; HTTP API only supports
# throttle settings. Use WAF rate-based rules for hard daily quotas if needed.
# ---------------------------------------------------------------------------

# ─── API key — stored in Secrets Manager ─────────────────────────────────────
# Initial value is a placeholder. After first apply, update via:
#   aws secretsmanager put-secret-value \
#     --secret-id naleko/agent/api-key \
#     --secret-string '<your-key>'
# Terraform will not overwrite a subsequently-set value (ignore_changes lifecycle).

resource "aws_secretsmanager_secret" "agent_api_key" {
  name                    = "naleko/agent/api-key"
  description             = "NH-43: API key for naleko-agent-api — validated by agentAuthorizer Lambda"
  recovery_window_in_days = 7

  tags = {
    Component = "AgentAPI"
  }
}

resource "aws_secretsmanager_secret_version" "agent_api_key" {
  secret_id = aws_secretsmanager_secret.agent_api_key.id
  # Replace this placeholder immediately after first apply — see comment above.
  secret_string = "REPLACE_WITH_STRONG_KEY_SEE_AGENT_API_TF"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ─── Agent HTTP API ───────────────────────────────────────────────────────────

resource "aws_apigatewayv2_api" "agent_api" {
  name                       = "naleko-agent-api"
  protocol_type              = "HTTP"
  route_selection_expression = "$request.method $request.path"

  cors_configuration {
    allow_headers = ["x-api-key", "content-type"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_origins = ["*"]
    max_age       = 86400
  }

  tags = {
    Component = "AgentAPI"
  }
}

# ─── $default stage — 10 rps, 20 burst ───────────────────────────────────────

resource "aws_apigatewayv2_stage" "agent_api_default" {
  api_id      = aws_apigatewayv2_api.agent_api.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    # NH-43: 10 rps steady-state, 20 burst as specified in requirements
    throttling_rate_limit  = 10
    throttling_burst_limit = 20
  }

  lifecycle {
    ignore_changes = [deployment_id]
  }
}

# ─── Lambda authorizer — validates x-api-key header ──────────────────────────

resource "aws_apigatewayv2_authorizer" "agent_api_key" {
  api_id          = aws_apigatewayv2_api.agent_api.id
  authorizer_type = "REQUEST"

  # API GW passes the x-api-key header to the authorizer as the identity source.
  # If the header is absent the request is rejected before calling the Lambda.
  identity_sources = ["$request.header.x-api-key"]

  name                              = "agent-api-key-authorizer"
  authorizer_uri                    = aws_lambda_function.agent_api_authorizer.invoke_arn
  authorizer_payload_format_version = "2.0"

  # Simple response: Lambda returns { isAuthorized: bool, context: { actor: 'AGENT' } }
  enable_simple_responses = true

  # Cache the validated key for 5 minutes to reduce Secrets Manager API calls.
  authorizer_result_ttl_in_seconds = 300
}

resource "aws_lambda_permission" "agent_api_invoke_authorizer" {
  statement_id  = "AllowAgentAPIInvokeAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.agent_api_authorizer.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.agent_api.execution_arn}/authorizers/${aws_apigatewayv2_authorizer.agent_api_key.id}"
}

# ─── Route 1: GET /agent/v1/employees ────────────────────────────────────────
# Reuses the existing getEmployees Lambda (same DynamoDB read path, different auth).

resource "aws_apigatewayv2_integration" "agent_get_employees" {
  api_id                 = aws_apigatewayv2_api.agent_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_employees.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "agent_get_employees" {
  api_id             = aws_apigatewayv2_api.agent_api.id
  route_key          = "GET /agent/v1/employees"
  target             = "integrations/${aws_apigatewayv2_integration.agent_get_employees.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.agent_api_key.id
}

resource "aws_lambda_permission" "agent_get_employees" {
  # Unique per API — existing AllowEmployeesAPIInvokeGetEmployees is on employees_api.
  statement_id  = "AllowAgentAPIInvokeGetEmployees"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_employees.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.agent_api.execution_arn}/*/*"
}

# ─── Route 2: GET /agent/v1/employees/{id} ───────────────────────────────────
# New getEmployee Lambda (NH-43) — single employee lookup by ID.

resource "aws_apigatewayv2_integration" "agent_get_employee" {
  api_id                 = aws_apigatewayv2_api.agent_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_employee.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "agent_get_employee" {
  api_id             = aws_apigatewayv2_api.agent_api.id
  route_key          = "GET /agent/v1/employees/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.agent_get_employee.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.agent_api_key.id
}

resource "aws_lambda_permission" "agent_get_employee" {
  statement_id  = "AllowAgentAPIInvokeGetEmployee"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_employee.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.agent_api.execution_arn}/*/*"
}

# ─── Route 3: GET /agent/v1/verifications ────────────────────────────────────
# Reuses the existing getDocumentVerifications Lambda.

resource "aws_apigatewayv2_integration" "agent_get_verifications" {
  api_id                 = aws_apigatewayv2_api.agent_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_document_verifications.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "agent_get_verifications" {
  api_id             = aws_apigatewayv2_api.agent_api.id
  route_key          = "GET /agent/v1/verifications"
  target             = "integrations/${aws_apigatewayv2_integration.agent_get_verifications.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.agent_api_key.id
}

resource "aws_lambda_permission" "agent_get_verifications" {
  statement_id  = "AllowAgentAPIInvokeGetVerifications"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_document_verifications.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.agent_api.execution_arn}/*/*"
}

# ─── Route 4: GET /agent/v1/verifications/{id}/summary ───────────────────────
# Reuses the existing summariseVerification Lambda (NH-40).

resource "aws_apigatewayv2_integration" "agent_summarise_verification" {
  api_id                 = aws_apigatewayv2_api.agent_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.summarise_verification.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "agent_summarise_verification" {
  api_id             = aws_apigatewayv2_api.agent_api.id
  route_key          = "GET /agent/v1/verifications/{id}/summary"
  target             = "integrations/${aws_apigatewayv2_integration.agent_summarise_verification.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.agent_api_key.id
}

resource "aws_lambda_permission" "agent_summarise_verification" {
  statement_id  = "AllowAgentAPIInvokeSummariseVerification"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.summarise_verification.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.agent_api.execution_arn}/*/*"
}

# ─── Route 5: POST /agent/v1/employees/{id}/assess-risk ──────────────────────
# Reuses the existing classifyOnboardingRisk Lambda (NH-41).

resource "aws_apigatewayv2_integration" "agent_assess_risk" {
  api_id                 = aws_apigatewayv2_api.agent_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.classify_onboarding_risk.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "agent_assess_risk" {
  api_id             = aws_apigatewayv2_api.agent_api.id
  route_key          = "POST /agent/v1/employees/{id}/assess-risk"
  target             = "integrations/${aws_apigatewayv2_integration.agent_assess_risk.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.agent_api_key.id
}

resource "aws_lambda_permission" "agent_assess_risk" {
  statement_id  = "AllowAgentAPIInvokeAssessRisk"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.classify_onboarding_risk.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.agent_api.execution_arn}/*/*"
}

# ─── Route 6: GET /agent/v1/audit-log ────────────────────────────────────────
# New queryAuditLog Lambda (NH-43) — queries onboarding-events DynamoDB table.

resource "aws_apigatewayv2_integration" "agent_query_audit_log" {
  api_id                 = aws_apigatewayv2_api.agent_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.query_audit_log.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "agent_query_audit_log" {
  api_id             = aws_apigatewayv2_api.agent_api.id
  route_key          = "GET /agent/v1/audit-log"
  target             = "integrations/${aws_apigatewayv2_integration.agent_query_audit_log.id}"
  authorization_type = "CUSTOM"
  authorizer_id      = aws_apigatewayv2_authorizer.agent_api_key.id
}

resource "aws_lambda_permission" "agent_query_audit_log" {
  statement_id  = "AllowAgentAPIInvokeQueryAuditLog"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.query_audit_log.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.agent_api.execution_arn}/*/*"
}

# ─── Route 7: GET /agent/agent-tools.json ────────────────────────────────────
# NH-45: serves the OpenAI-compatible tooling manifest.
# Intentionally unauthenticated — agents discover tools before acquiring a key.

resource "aws_apigatewayv2_integration" "serve_agent_manifest" {
  api_id                 = aws_apigatewayv2_api.agent_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.serve_agent_manifest.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "serve_agent_manifest" {
  api_id    = aws_apigatewayv2_api.agent_api.id
  route_key = "GET /agent/agent-tools.json"
  target    = "integrations/${aws_apigatewayv2_integration.serve_agent_manifest.id}"
  # No authorization_type — public endpoint
}

resource "aws_lambda_permission" "serve_agent_manifest" {
  statement_id  = "AllowAgentAPIInvokeServeManifest"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.serve_agent_manifest.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.agent_api.execution_arn}/*/*"
}

# ─── Output ───────────────────────────────────────────────────────────────────

output "agent_api_endpoint" {
  description = "Base URL for the naleko-agent-api. Append /agent/v1/<route>."
  value       = aws_apigatewayv2_api.agent_api.api_endpoint
}
