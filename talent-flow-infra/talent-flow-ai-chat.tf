# ---------------------------------------------------------------------------
# TalentFlow — AI Chat Supplementary Infrastructure (NH-115 / TF-012)
#
# This file provisions the secrets + rotation schedule that support the
# talentFlowAiChat and talentFlowAuthorizer Lambdas declared in TF-009.
#
# NOT included here (intentionally):
#   - talentFlowAiChat Lambda declaration → already complete in talent-flow-lambdas.tf
#     (memory=512, timeout=60, all env vars including BEDROCK model IDs)
#   - Lambda URL → NOT added; Lambda is protected by Gateway 2 TOKEN authorizer
#     (TF-010). Adding auth_type=NONE URL would bypass security.
#   - AI_SESSIONS_TABLE → no such table exists; not in locals.tf or DynamoDB plan.
#
# Contents:
#   1. Secrets Manager secret: talent-flow/agent/api-key
#      - KMS-encrypted with agent_audit key
#      - Referenced by talentFlowAuthorizer + talentFlowAiChat (AGENT_API_KEY_SECRET_NAME)
#   2. EventBridge scheduled rule: 90-day API key rotation cron
#      → talentFlowRotateApiKey Lambda
#   3. Lambda permission for the rotation rule
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# 1. Secrets Manager — Agent API Key
#    Placeholder value. Real key injected by ops on first apply or via
#    aws secretsmanager put-secret-value out-of-band.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "agent_api_key" {
  name        = local.tf_secret_agent_api_key
  description = "TalentFlow Agent API key — validated by talentFlowAuthorizer on every request"
  kms_key_id  = aws_kms_key.talent_flow_agent_audit.arn

  # 90-day forced rotation period (manual rotation via talentFlowRotateApiKey Lambda)
  # Automatic rotation is triggered by the EventBridge schedule below.
  recovery_window_in_days = 7

  tags = merge(local.tf_tags, { Ticket = "NH-115", Purpose = "AgentApiKey" })
}

resource "aws_secretsmanager_secret_version" "agent_api_key_placeholder" {
  secret_id     = aws_secretsmanager_secret.agent_api_key.id
  secret_string = "PLACEHOLDER_REPLACE_BEFORE_USE"

  lifecycle {
    # Prevent Terraform from reverting the key after ops sets the real value
    ignore_changes = [secret_string]
  }
}

# ---------------------------------------------------------------------------
# 2. EventBridge Scheduled Rule — 90-day API key rotation
#    Cron: 0 0 1 */3 ? * = midnight on 1st day of every 3rd month (~90 days)
#    Must target the default event bus — scheduled rules cannot use custom buses.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "api_key_rotation" {
  name                = "talent-flow-api-key-rotation-90day"
  description         = "Trigger talentFlowRotateApiKey every ~90 days to rotate the agent API key"
  schedule_expression = "cron(0 0 1 */3 ? *)"
  state               = "ENABLED"
  # No event_bus_name — scheduled rules must target the default bus

  tags = merge(local.tf_tags, { Ticket = "NH-115", Purpose = "ApiKeyRotation" })
}

resource "aws_cloudwatch_event_target" "api_key_rotation" {
  rule      = aws_cloudwatch_event_rule.api_key_rotation.name
  target_id = "talentFlowRotateApiKey"
  arn       = aws_lambda_function.rotate_api_key.arn
}

# ---------------------------------------------------------------------------
# 3. Lambda permission — allow EventBridge to invoke talentFlowRotateApiKey
# ---------------------------------------------------------------------------

resource "aws_lambda_permission" "rotate_api_key_eventbridge" {
  statement_id  = "AllowEventBridgeInvokeRotateApiKey"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rotate_api_key.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.api_key_rotation.arn
}
