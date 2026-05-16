# ---------------------------------------------------------------------------
# TalentFlow - Lambda Function Declarations (NH-112 / TF-009)
#
# 13 placeholder-ZIP Lambda functions + 2 event source mappings + 1 DLQ.
#
# talentFlowPreTokenTrigger is EXCLUDED - already declared in talent-flow-cognito.tf
#
# Runtime: nodejs22.x, architectures: arm64
# Placeholder ZIP: local.tf_placeholder_zip (repo-root placeholder.zip)
# lifecycle: ignore_changes on [filename, source_code_hash] - CI/CD deploys code
#
# Pattern: mirrors Naleko infra/lambdas.tf
#   - tracing_config { mode = "Active" }
#   - logging_config { log_format = "JSON" }
#   - lifecycle ignore_changes
#   - All table/queue/bus names from locals (no hardcoded strings)
#
# EventBridge targets + aws_lambda_permission already set in talent-flow-eventbridge.tf (TF-007).
# This file only adds the function declarations and SQS/DynamoDB event source mappings.
# ---------------------------------------------------------------------------

# ── 1. createCandidate ────────────────────────────────────────────────────────
# Trigger: POST /candidates (HTTP API, wired in TF-010)
# Writes new candidate to state table, checks idempotency, publishes CandidateCreated

resource "aws_lambda_function" "create_candidate" {
  function_name = local.tf_lambda_create_candidate
  role          = aws_iam_role.create_candidate.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME       = local.tf_table_state
      IDEMPOTENCY_TABLE_NAME = local.tf_table_idempotency
      CONFIG_TABLE_NAME      = local.tf_table_config
      EVENTBRIDGE_BUS_NAME   = local.tf_event_bus_name
      AWS_ACCOUNT_ID         = var.aws_account_id
      ENVIRONMENT            = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_create_candidate}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-112" })
}

# ── 2. orchestrateTalentFlowWorkflow ──────────────────────────────────────────
# Trigger: EventBridge CandidateCreated (permission declared in TF-007)
# Snapshots configVersion onto SAGA record, initialises stage metadata

resource "aws_lambda_function" "orchestrate_workflow" {
  function_name = local.tf_lambda_orchestrate_workflow
  role          = aws_iam_role.orchestrate_workflow.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME     = local.tf_table_state
      CONFIG_TABLE_NAME    = local.tf_table_config
      EVENTBRIDGE_BUS_NAME = local.tf_event_bus_name
      AWS_ACCOUNT_ID       = var.aws_account_id
      ENVIRONMENT          = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_orchestrate_workflow}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-112" })
}

# ── 3. scheduleInterview ──────────────────────────────────────────────────────
# Trigger: EventBridge InterviewScheduled (permission declared in TF-007)
# Reads panel rules config, writes interview record, enqueues notifications

resource "aws_lambda_function" "schedule_interview" {
  function_name = local.tf_lambda_schedule_interview
  role          = aws_iam_role.schedule_interview.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME       = local.tf_table_state
      CONFIG_TABLE_NAME      = local.tf_table_config
      NOTIFICATION_QUEUE_URL = aws_sqs_queue.talent_flow_notification.url
      EVENTBRIDGE_BUS_NAME   = local.tf_event_bus_name
      AWS_ACCOUNT_ID         = var.aws_account_id
      ENVIRONMENT            = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_schedule_interview}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-112" })
}

# ── 4. submitVote ─────────────────────────────────────────────────────────────
# Trigger: EventBridge VoteSubmitted (permission declared in TF-007)
# Reads scoring weights using candidate's locked configVersion, checks veto toggle

resource "aws_lambda_function" "submit_vote" {
  function_name = local.tf_lambda_submit_vote
  role          = aws_iam_role.submit_vote.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME     = local.tf_table_state
      CONFIG_TABLE_NAME    = local.tf_table_config
      EVENTBRIDGE_BUS_NAME = local.tf_event_bus_name
      AWS_ACCOUNT_ID       = var.aws_account_id
      ENVIRONMENT          = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_submit_vote}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-112" })
}

# ── 5. completeEvaluation ─────────────────────────────────────────────────────
# Trigger: EventBridge VotingCompleted (permission declared in TF-007)
# Applies 6.0/10 pass threshold from versioned config, publishes EvaluationCompleted

resource "aws_lambda_function" "complete_evaluation" {
  function_name = local.tf_lambda_complete_evaluation
  role          = aws_iam_role.complete_evaluation.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME     = local.tf_table_state
      CONFIG_TABLE_NAME    = local.tf_table_config
      EVENTBRIDGE_BUS_NAME = local.tf_event_bus_name
      AWS_ACCOUNT_ID       = var.aws_account_id
      ENVIRONMENT          = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_complete_evaluation}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-112" })
}

# ── 6. manageTalentFlowConfig ─────────────────────────────────────────────────
# Trigger: POST/PUT/GET /config (HTTP API, wired in TF-010)
# CRUD on Variable Six config, creates new config versions, admin-only guard

resource "aws_lambda_function" "manage_config" {
  function_name = local.tf_lambda_manage_config
  role          = aws_iam_role.manage_config.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      CONFIG_TABLE_NAME = local.tf_table_config
      AWS_ACCOUNT_ID    = var.aws_account_id
      ENVIRONMENT       = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_manage_config}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-112" })
}

# ── 7. sendTalentFlowNotification ─────────────────────────────────────────────
# Trigger: SQS talent-flow-notification-queue.fifo (ESM below)
# Config-driven SES email templates, handles all 7 notification event types

resource "aws_lambda_function" "send_notification" {
  function_name = local.tf_lambda_send_notification
  role          = aws_iam_role.send_notification.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      NOTIFICATION_QUEUE_URL = aws_sqs_queue.talent_flow_notification.url
      CONFIG_TABLE_NAME      = local.tf_table_config
      AWS_ACCOUNT_ID         = var.aws_account_id
      ENVIRONMENT            = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_send_notification}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-112" })
}

# ── 8. monitorTalentFlowSLAs ──────────────────────────────────────────────────
# Trigger: EventBridge hourly cron on default bus (permission declared in TF-007)
# Scans open SAGA records, publishes SLABreached if threshold exceeded

resource "aws_lambda_function" "monitor_slas" {
  function_name = local.tf_lambda_monitor_slas
  role          = aws_iam_role.monitor_slas.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME     = local.tf_table_state
      CONFIG_TABLE_NAME    = local.tf_table_config
      EVENTBRIDGE_BUS_NAME = local.tf_event_bus_name
      AWS_ACCOUNT_ID       = var.aws_account_id
      ENVIRONMENT          = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_monitor_slas}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-112" })
}

# ── 9. talentFlowAiChat ───────────────────────────────────────────────────────
# Trigger: POST /ai/chat (Agent API Gateway, wired in TF-010)
# 512MB / 60s - Bedrock inference; HITL write-tool calls via pending-actions table

resource "aws_lambda_function" "ai_chat" {
  function_name = local.tf_lambda_ai_chat
  role          = aws_iam_role.ai_chat.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 512
  timeout       = 60
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME           = local.tf_table_state
      CONFIG_TABLE_NAME          = local.tf_table_config
      AGENT_AUDIT_TABLE_NAME     = local.tf_table_agent_audit
      RATE_LIMIT_TABLE_NAME      = local.tf_table_rate_limit
      PENDING_ACTIONS_TABLE_NAME = local.tf_table_pending_actions
      BEDROCK_MODEL_FAST         = local.tf_model_fast
      BEDROCK_MODEL_SMART        = local.tf_model_smart
      AGENT_API_KEY_SECRET_NAME  = local.tf_secret_agent_api_key
      EVENTBRIDGE_BUS_NAME       = local.tf_event_bus_name
      AWS_ACCOUNT_ID             = var.aws_account_id
      ENVIRONMENT                = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_ai_chat}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-112" })
}

# ── 10. talentFlowAuthorizer ──────────────────────────────────────────────────
# Trigger: API Gateway Lambda authorizer (wired in TF-010)
# Validates x-api-key header against Secrets Manager; 10s timeout (authorizer SLA)

resource "aws_lambda_function" "authorizer" {
  function_name = local.tf_lambda_authorizer
  role          = aws_iam_role.authorizer.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 10
  architectures = ["arm64"]

  environment {
    variables = {
      AGENT_API_KEY_SECRET_NAME = local.tf_secret_agent_api_key
      AWS_ACCOUNT_ID            = var.aws_account_id
      ENVIRONMENT               = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_authorizer}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-112" })
}

# ── 11. talentFlowApproveAction ───────────────────────────────────────────────
# Trigger: POST /ai/approve (Agent API Gateway, wired in TF-010)
# Reads pending-actions table, marks approved/rejected, publishes resume event

resource "aws_lambda_function" "approve_action" {
  function_name = local.tf_lambda_approve_action
  role          = aws_iam_role.approve_action.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      PENDING_ACTIONS_TABLE_NAME = local.tf_table_pending_actions
      EVENTBRIDGE_BUS_NAME       = local.tf_event_bus_name
      AWS_ACCOUNT_ID             = var.aws_account_id
      ENVIRONMENT                = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_approve_action}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-112" })
}

# ── 12. talentFlowArchiveAuditLog ─────────────────────────────────────────────
# Trigger: DynamoDB Stream on talent-flow-agent-audit (ESM below)
# Reads stream, writes Parquet-style JSON batches to S3 audit-archive bucket

resource "aws_lambda_function" "archive_audit_log" {
  function_name = local.tf_lambda_archive_audit
  role          = aws_iam_role.archive_audit_log.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 60
  architectures = ["arm64"]

  environment {
    variables = {
      AGENT_AUDIT_TABLE_NAME = local.tf_table_agent_audit
      AUDIT_ARCHIVE_BUCKET   = aws_s3_bucket.talent_flow_audit_archive.bucket
      AWS_ACCOUNT_ID         = var.aws_account_id
      ENVIRONMENT            = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_archive_audit}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-112" })
}

# ── 13. talentFlowRotateApiKey ────────────────────────────────────────────────
# Trigger: EventBridge 90-day cron (declared in TF-012)
# Rotates talent-flow/agent/api-key in Secrets Manager

resource "aws_lambda_function" "rotate_api_key" {
  function_name = local.tf_lambda_rotate_api_key
  role          = aws_iam_role.rotate_api_key.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      AGENT_API_KEY_SECRET_NAME = local.tf_secret_agent_api_key
      AWS_ACCOUNT_ID            = var.aws_account_id
      ENVIRONMENT               = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_rotate_api_key}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-112" })
}

# ── Event Source Mapping 1: SQS notification queue → sendTalentFlowNotification
# batch_size=10 - processes up to 10 notifications per Lambda invocation
# FIFO queue: batch_size must be ≤ 10 per AWS docs

resource "aws_lambda_event_source_mapping" "send_notification_sqs" {
  event_source_arn = aws_sqs_queue.talent_flow_notification.arn
  function_name    = aws_lambda_function.send_notification.arn
  batch_size       = 10
  enabled          = true

  function_response_types = ["ReportBatchItemFailures"]
}

# ── Event Source Mapping 2: DynamoDB Stream on agent-audit → talentFlowArchiveAuditLog
# Mirrors Naleko infra/lambdas.tf archive_audit_log_stream pattern exactly.
# TRIM_HORIZON: process any records written before the ESM was created.
# bisect_batch_on_function_error: isolates poison-pill records.
# on_failure DLQ: failed batches land in archive-audit-log-dlq (below).

resource "aws_lambda_event_source_mapping" "archive_audit_log_stream" {
  event_source_arn                   = aws_dynamodb_table.talent_flow_agent_audit.stream_arn
  function_name                      = aws_lambda_function.archive_audit_log.arn
  starting_position                  = "TRIM_HORIZON"
  batch_size                         = 10
  maximum_batching_window_in_seconds = 30
  bisect_batch_on_function_error     = true

  destination_config {
    on_failure {
      destination_arn = aws_sqs_queue.archive_audit_log_dlq.arn
    }
  }

  function_response_types = ["ReportBatchItemFailures"]
}

# DLQ for failed archive batches - 14-day retention, standard queue (not FIFO)
# Mirrors Naleko infra/lambdas.tf archive_audit_log_dlq

resource "aws_sqs_queue" "archive_audit_log_dlq" {
  name                      = "talent-flow-archive-audit-log-dlq"
  message_retention_seconds = 1209600 # 14 days
  kms_master_key_id         = aws_kms_key.talent_flow_agent_audit.arn

  tags = merge(local.tf_tags, { Ticket = "NH-112" })
}
