# ---------------------------------------------------------------------------
# NH-50: AI Mode — nalekoAiChat Lambda + Bedrock Guardrail + API route
#
# Auth: Cognito JWT (HR staff only — not x-api-key agent auth).
# Route: POST /agent/v1/ai-chat on the existing agent_api HTTP API.
#
# Guardrail scope (per NH-49 investigation — 2026-05-05):
#   ✅ Content filters  ✅ Denied topics  ✅ Word filters  ✅ PII masking (regex)
#   ❌ Contextual Grounding — no AF guardrail profile in af-south-1, dropped.
#
# PII defence: pii-sanitiser.mjs in Lambda (NH-56) is the primary PII layer.
# Guardrail PII masking is a second layer for defence-in-depth.
# ---------------------------------------------------------------------------

# ─── Bedrock Guardrail ────────────────────────────────────────────────────────

resource "aws_bedrock_guardrail" "naleko_hr" {
  name                      = "naleko-hr-guardrail"
  description               = "NH-50: Guards AI Mode against off-topic queries and PII leakage"
  blocked_input_messaging   = "I can only help with HR onboarding tasks."
  blocked_outputs_messaging = "I can only help with HR onboarding tasks."

  # ── Denied topics ──────────────────────────────────────────────────────────
  topic_policy_config {
    topics_config {
      name       = "salary-benchmarking"
      type       = "DENY"
      definition = "Requests for salary benchmarks, market pay rates, or pay band comparisons."
      examples   = ["What is the market rate for this role?", "How does our pay compare to competitors?"]
    }
    topics_config {
      name       = "employment-law-advice"
      type       = "DENY"
      definition = "Legal advice on labour law, CCMA procedures, dismissal processes, or employment contracts."
      examples   = ["Can we dismiss this employee?", "What does the LRA say about this?"]
    }
    topics_config {
      name       = "performance-reviews"
      type       = "DENY"
      definition = "Individual employee performance ratings, performance improvement plans, or disciplinary records."
      examples   = ["What is this employee's performance rating?", "Show me PIP history."]
    }
  }

  # ── Content filters ────────────────────────────────────────────────────────
  content_policy_config {
    filters_config {
      type            = "HATE"
      input_strength  = "MEDIUM"
      output_strength = "MEDIUM"
    }
    filters_config {
      type            = "INSULTS"
      input_strength  = "MEDIUM"
      output_strength = "MEDIUM"
    }
    filters_config {
      type            = "MISCONDUCT"
      input_strength  = "MEDIUM"
      output_strength = "MEDIUM"
    }
    filters_config {
      type            = "PROMPT_ATTACK"
      input_strength  = "HIGH"
      output_strength = "NONE"
    }
  }

  # ── PII / Sensitive information ────────────────────────────────────────────
  sensitive_information_policy_config {
    # SA Identity Number — 13-digit pattern matching YYMMDD + sequence + checksum
    regexes_config {
      name        = "sa-id-number"
      description = "South African ID number (13 digits)"
      pattern     = "\\b[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])[0-9]{4}[0-9]{3}\\b"
      action      = "ANONYMIZE"
    }
    # SA bank account numbers (8–11 digits)
    regexes_config {
      name        = "bank-account-number"
      description = "South African bank account number"
      pattern     = "\\b[0-9]{8,11}\\b"
      action      = "ANONYMIZE"
    }
    # SA phone numbers (+27 or 0 prefix, 9 digits)
    regexes_config {
      name        = "sa-phone-number"
      description = "South African phone number"
      pattern     = "\\b(\\+27|0)[0-9]{9}\\b"
      action      = "ANONYMIZE"
    }
    pii_entities_config {
      type   = "ADDRESS"
      action = "BLOCK"
    }
    pii_entities_config {
      type   = "PHONE"
      action = "ANONYMIZE"
    }
    pii_entities_config {
      type   = "EMAIL"
      action = "ANONYMIZE"
    }
  }

  tags = {
    Component = "AIMode"
    Ticket    = "NH-50"
  }
}

# ─── IAM role for nalekoAiChat ────────────────────────────────────────────────

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
        # NH-54: InvokeModel for Claude Haiku 4.5
        Sid    = "BedrockInvoke"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel"]
        Resource = "arn:aws:bedrock:${var.aws_region}::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0"
      },
      {
        # NH-49: ApplyGuardrail for pre-flight content checking
        Sid      = "BedrockGuardrail"
        Effect   = "Allow"
        Action   = ["bedrock:ApplyGuardrail"]
        Resource = aws_bedrock_guardrail.naleko_hr.guardrail_arn
      },
      {
        # NH-57: Write AI chat turns and HITL actions to audit log table
        Sid    = "AuditLogWrite"
        Effect = "Allow"
        Action = ["dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/onboarding-events"
      },
      {
        # NH-67: Rate limiting — read + increment per-staff-id token bucket
        Sid    = "RateLimitTable"
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/NalekoAiRateLimit"
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

  environment {
    variables = {
      GUARDRAIL_ID      = aws_bedrock_guardrail.naleko_hr.guardrail_id
      GUARDRAIL_VERSION = "DRAFT"
      BEDROCK_MODEL_ID  = "anthropic.claude-haiku-4-5-20251001-v1:0"
      AWS_REGION_NAME   = var.aws_region
      AUDIT_TABLE       = "onboarding-events"
      RATE_LIMIT_TABLE  = "NalekoAiRateLimit"
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
