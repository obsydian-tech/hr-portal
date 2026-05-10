# ─── NH-82: CloudWatch metric filters + Lambda log retention ──────────────────
#
# 1. aws_cloudwatch_log_group (for_each) — 30-day retention on all Lambda groups.
#    Pre-existing groups (auto-created by Lambda) are reconciled via import blocks.
# 2. Metric filters extract structured-log fields into Naleko/AI custom namespace.
#    Source: /aws/lambda/nalekoAiChat (Powertools JSON format)
# ─────────────────────────────────────────────────────────────────────────────

locals {
  lambda_log_groups = toset([
    "/aws/lambda/agentAuthorizer",
    "/aws/lambda/approveAgentAction",
    "/aws/lambda/archiveAuditLog",
    "/aws/lambda/auditLogConsumer",
    "/aws/lambda/classifyOnboardingRisk",
    "/aws/lambda/configRegionCheck",
    "/aws/lambda/createEmployee",
    "/aws/lambda/generateDocumentUploadUrl",
    "/aws/lambda/getBatchRiskReport",
    "/aws/lambda/getDocumentPresignedUrl",
    "/aws/lambda/getDocumentVerifications",
    "/aws/lambda/getEmployee",
    "/aws/lambda/getEmployeeByEmail",
    "/aws/lambda/getEmployeeDocumentVerifications",
    "/aws/lambda/getEmployees",
    "/aws/lambda/getSingleDocumentVerification",
    "/aws/lambda/lookupEmployeeEmail",
    "/aws/lambda/nalekoAiChat",
    "/aws/lambda/nalekoMcpServer",
    "/aws/lambda/processDocumentOCR",
    "/aws/lambda/queryAuditLog",
    "/aws/lambda/reviewDocumentVerification",
    "/aws/lambda/rotateApiKey",
    "/aws/lambda/sendNotificationEmail",
    "/aws/lambda/serveAgentManifest",
    "/aws/lambda/serveDocs",
    "/aws/lambda/summariseVerification",
    "/aws/lambda/triggerExternalVerification",
    "/aws/lambda/uploadDocumentToS3",
  ])

  # Log groups that already exist in AWS (auto-created by Lambda on first invocation).
  # These are reconciled via import blocks; the remainder are created fresh.
  existing_lambda_log_groups = toset([
    "/aws/lambda/agentAuthorizer",
    "/aws/lambda/auditLogConsumer",
    "/aws/lambda/classifyOnboardingRisk",
    "/aws/lambda/configRegionCheck",
    "/aws/lambda/createEmployee",
    "/aws/lambda/getBatchRiskReport",
    "/aws/lambda/getDocumentPresignedUrl",
    "/aws/lambda/getDocumentVerifications",
    "/aws/lambda/getEmployee",
    "/aws/lambda/getEmployeeDocumentVerifications",
    "/aws/lambda/getEmployees",
    "/aws/lambda/getSingleDocumentVerification",
    "/aws/lambda/lookupEmployeeEmail",
    "/aws/lambda/nalekoAiChat",
    "/aws/lambda/nalekoMcpServer",
    "/aws/lambda/processDocumentOCR",
    "/aws/lambda/queryAuditLog",
    "/aws/lambda/reviewDocumentVerification",
    "/aws/lambda/rotateApiKey",
    "/aws/lambda/sendNotificationEmail",
    "/aws/lambda/serveDocs",
    "/aws/lambda/summariseVerification",
    "/aws/lambda/uploadDocumentToS3",
  ])
}

# Import pre-existing log groups (auto-created by Lambda runtime) so Terraform
# can manage retention without a resource-already-exists conflict.
import {
  for_each = local.existing_lambda_log_groups
  id       = each.value
  to       = aws_cloudwatch_log_group.lambda[each.value]
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.lambda_log_groups
  name              = each.value
  retention_in_days = 30

  tags = {
    Component = "Naleko"
    Ticket    = "NH-82"
  }
}

# ─── Metric filters — Naleko/AI namespace ─────────────────────────────────────
# All sourced from /aws/lambda/nalekoAiChat.
# Powertools Logger merges the second-arg object into the top-level JSON record,
# so $.event, $.input_tokens etc. are top-level fields.

# Input tokens per request (from ai_chat_complete)
resource "aws_cloudwatch_log_metric_filter" "naleko_input_tokens" {
  name           = "NalekoInputTokens"
  log_group_name = "/aws/lambda/nalekoAiChat"
  pattern        = "{ $.event = \"ai_chat_complete\" }"

  metric_transformation {
    name          = "InputTokens"
    namespace     = "Naleko/AI"
    value         = "$.input_tokens"
    default_value = 0
    unit          = "Count"
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

# Output tokens per request
resource "aws_cloudwatch_log_metric_filter" "naleko_output_tokens" {
  name           = "NalekoOutputTokens"
  log_group_name = "/aws/lambda/nalekoAiChat"
  pattern        = "{ $.event = \"ai_chat_complete\" }"

  metric_transformation {
    name          = "OutputTokens"
    namespace     = "Naleko/AI"
    value         = "$.output_tokens"
    default_value = 0
    unit          = "Count"
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

# End-to-end latency per request (ms)
resource "aws_cloudwatch_log_metric_filter" "naleko_latency_ms" {
  name           = "NalekoLatencyMs"
  log_group_name = "/aws/lambda/nalekoAiChat"
  pattern        = "{ $.event = \"ai_chat_complete\" }"

  metric_transformation {
    name          = "LatencyMs"
    namespace     = "Naleko/AI"
    value         = "$.latencyMs"
    default_value = 0
    unit          = "Milliseconds"
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

# Prompt cache hits (cache_hit=true on ai_chat_complete)
resource "aws_cloudwatch_log_metric_filter" "naleko_cache_hit" {
  name           = "NalekoCacheHit"
  log_group_name = "/aws/lambda/nalekoAiChat"
  pattern        = "{ $.event = \"ai_chat_complete\" && $.cache_hit = true }"

  metric_transformation {
    name          = "CacheHit"
    namespace     = "Naleko/AI"
    value         = "1"
    default_value = 0
    unit          = "Count"
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

# Rate-limited requests (429 responses)
resource "aws_cloudwatch_log_metric_filter" "naleko_rate_limited" {
  name           = "NalekoRateLimited"
  log_group_name = "/aws/lambda/nalekoAiChat"
  pattern        = "{ $.event = \"rate_limited\" }"

  metric_transformation {
    name          = "RateLimited"
    namespace     = "Naleko/AI"
    value         = "1"
    default_value = 0
    unit          = "Count"
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

# Context trimmed events (history trimmed to prevent exceeding context window)
resource "aws_cloudwatch_log_metric_filter" "naleko_context_trimmed" {
  name           = "NalekoContextTrimmed"
  log_group_name = "/aws/lambda/nalekoAiChat"
  pattern        = "?\"context_trimmed\""

  metric_transformation {
    name          = "ContextTrimmed"
    namespace     = "Naleko/AI"
    value         = "1"
    default_value = 0
    unit          = "Count"
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

# History summarisation events (NH-79 Haiku summarisation triggered)
resource "aws_cloudwatch_log_metric_filter" "naleko_history_summarised" {
  name           = "NalekoHistorySummarised"
  log_group_name = "/aws/lambda/nalekoAiChat"
  pattern        = "?\"history_summarised\""

  metric_transformation {
    name          = "HistorySummarised"
    namespace     = "Naleko/AI"
    value         = "1"
    default_value = 0
    unit          = "Count"
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}
