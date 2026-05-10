# ---------------------------------------------------------------------------
# NH-50: AI Mode - nalekoAiChat Lambda + API route
# NH-53: tool-resolver.mjs reads agent API key from Secrets Manager
#
# Guardrail decision (per NH-49 + NH-50 apply 2026-05-06):
#   CreateGuardrail returns 403 AccessDeniedException in af-south-1.
#   pii-sanitiser.mjs (NH-56) is the PRIMARY PII layer.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "naleko_ai_chat" {
  name        = "naleko-nalekoAiChat-role"
  description = "Execution role for nalekoAiChat Lambda (NH-50)"
  path        = "/naleko/"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "naleko_ai_chat" {
  name = "naleko-nalekoAiChat-policy"
  role = aws_iam_role.naleko_ai_chat.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/nalekoAiChat:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        # NH-54: InvokeModel for Claude Haiku 4.5 via cross-region inference profile (on-demand not supported directly)
        # global. inference profile requires wildcard resource (same pattern as classifyOnboardingRisk)
        Sid      = "BedrockInvoke"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "*"
      },
      {
        Sid      = "AgentApiKeyRead"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:${var.aws_account_id}:secret:naleko/agent/api-key*"
      },
      {
        Sid      = "AuditLogWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/onboarding-events"
      },
      {
        # NH-67: Rate limiting — read + increment per-staff-id token bucket
        Sid      = "RateLimitTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/NalekoAiRateLimit"
      },
      {
        # NH-73: HITL gate — store pending write tool calls
        Sid      = "PendingActionsWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = aws_dynamodb_table.pending_actions.arn
      },
      {
        # NH-74: write AI agent interaction records for POPIA audit trail
        Sid      = "AgentAuditWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = aws_dynamodb_table.agent_audit.arn
      },
      {
        # NH-76: prompt response cache — read + write for cache lookup/store
        Sid      = "PromptCacheReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem"]
        Resource = aws_dynamodb_table.prompt_cache.arn
      },
    ]
  })
}

# ─── Lambda function ──────────────────────────────────────────────────────────

resource "aws_lambda_function" "naleko_ai_chat" {
  function_name = "nalekoAiChat"
  role          = aws_iam_role.naleko_ai_chat.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 512
  timeout       = 60
  # NH-71: reserved_concurrent_executions omitted — account limit is 10 (minimum floor)
  # Revisit once a Lambda concurrency quota increase is approved for af-south-1

  environment {
    variables = {
      BEDROCK_MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
      MODEL_FAST       = "us.anthropic.claude-haiku-4-5-v1:0"
      MODEL_SMART      = "us.anthropic.claude-sonnet-4-5-v1:0"
      # NH-81: JSON alias map — resolveModel() uses this for alias-based lookups
      MODEL_ALIASES             = jsonencode({ fast = "us.anthropic.claude-haiku-4-5-v1:0", smart = "us.anthropic.claude-sonnet-4-5-v1:0" })
      AWS_REGION_NAME           = var.aws_region
      AUDIT_TABLE               = "onboarding-events"
      RATE_LIMIT_TABLE          = "NalekoAiRateLimit"
      RATE_LIMIT_RPH            = "50" # NH-80: max requests per staff per hour
      AGENT_API_BASE_URL        = "https://${aws_apigatewayv2_api.agent_api.id}.execute-api.${var.aws_region}.amazonaws.com"
      AGENT_API_KEY_SECRET_NAME = "naleko/agent/api-key"
      # NH-73: HITL gate — write tool calls stored here pending approval
      PENDING_ACTIONS_TABLE = aws_dynamodb_table.pending_actions.name
      # NH-74: AI agent interaction audit trail for POPIA compliance
      AGENT_AUDIT_TABLE = aws_dynamodb_table.agent_audit.name
      # NH-76: prompt response cache (1hr TTL, DynamoDB)
      PROMPT_CACHE_TABLE = aws_dynamodb_table.prompt_cache.name
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/nalekoAiChat"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = {
    Component = "AIMode"
    Ticket    = "NH-50"
  }
}

# ─── Cognito JWT authorizer on agent_api (HR staff auth) ─────────────────────
# The existing agent_api uses x-api-key for MCP agent calls.
# AI Mode is HR-staff-facing, so it uses a separate JWT authorizer on the same API.

resource "aws_apigatewayv2_authorizer" "agent_api_cognito_jwt" {
  api_id           = aws_apigatewayv2_api.agent_api.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-jwt-hr-staff"

  jwt_configuration {
    audience = local.cognito_audience
    issuer   = local.cognito_issuer
  }
}

# ─── API Gateway route: POST /agent/v1/ai-chat ───────────────────────────────

resource "aws_apigatewayv2_integration" "naleko_ai_chat" {
  api_id                 = aws_apigatewayv2_api.agent_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.naleko_ai_chat.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "naleko_ai_chat" {
  api_id             = aws_apigatewayv2_api.agent_api.id
  route_key          = "POST /agent/v1/ai-chat"
  target             = "integrations/${aws_apigatewayv2_integration.naleko_ai_chat.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.agent_api_cognito_jwt.id
}

resource "aws_lambda_permission" "naleko_ai_chat" {
  statement_id  = "AllowAgentAPIInvokeNalekoAiChat"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.naleko_ai_chat.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.agent_api.execution_arn}/*/*"
}

# ─── Rate limiting table (NH-67) ─────────────────────────────────────────────

resource "aws_dynamodb_table" "naleko_ai_rate_limit" {
  name         = "NalekoAiRateLimit"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  tags = {
    Component = "AIMode"
    Ticket    = "NH-67"
  }
}
