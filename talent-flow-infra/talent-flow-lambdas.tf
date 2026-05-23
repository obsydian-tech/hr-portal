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

# ── Postmark API token (shared with Naleko; stored in SSM) ──────────────────────
data "aws_ssm_parameter" "postmark_token" {
  name            = "/naleko/postmark/api_token"
  with_decryption = true
}

# ── 7. sendTalentFlowNotification ─────────────────────────────────────────────
# Trigger: SQS talent-flow-notification-queue.fifo (ESM below)
# Config-driven Postmark email templates, handles all 7 notification event types

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
      NOTIFICATION_QUEUE_URL   = aws_sqs_queue.talent_flow_notification.url
      CONFIG_TABLE_NAME        = local.tf_table_config
      NOTIFICATIONS_TABLE_NAME = local.tf_table_notifications
      MVP1_RECIPIENT_OVERRIDE  = "ignecious@obsydiantechnologies.com"
      AWS_ACCOUNT_ID           = var.aws_account_id
      ENVIRONMENT              = var.environment
      POSTMARK_API_TOKEN       = data.aws_ssm_parameter.postmark_token.value
      POSTMARK_SENDER_EMAIL    = "ignecious@obsydiantechnologies.com"
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
      TENANT_ID            = "NALEKO"
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
      PROMPT_CACHE_TABLE_NAME    = local.tf_table_prompt_cache
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

# ── 14. getCandidates ─────────────────────────────────────────────────────────
# Triggered by: API GW GET /v1/candidates (JWT-secured)
# Lists candidate SAGA records via GSI1 query

resource "aws_lambda_function" "get_candidates" {
  function_name = local.tf_lambda_get_candidates
  role          = aws_iam_role.get_candidates.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME = local.tf_table_state
      ENVIRONMENT      = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_get_candidates}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-113" })
}

# ── 15. getCandidate ──────────────────────────────────────────────────────────
# Triggered by: API GW GET /v1/candidates/{id} (JWT-secured)
# Returns a single candidate SAGA record by PK

resource "aws_lambda_function" "get_candidate" {
  function_name = local.tf_lambda_get_candidate
  role          = aws_iam_role.get_candidate.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME = local.tf_table_state
      ENVIRONMENT      = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_get_candidate}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-113" })
}

# ── 17. getPanelMembers ───────────────────────────────────────────────────────
# Triggered by: GET /v1/panel-members (JWT-secured HTTP API)
# Lists system users from Naleko Cognito groups — internal panel directory (D005/D041)

resource "aws_lambda_function" "get_panel_members" {
  function_name = local.tf_lambda_get_panel_members
  role          = aws_iam_role.get_panel_members.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      COGNITO_POOL_ID  = local.tf_naleko_pool_id
      STATE_TABLE_NAME = local.tf_table_state
      TENANT_ID        = "NALEKO"
      ENVIRONMENT      = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_get_panel_members}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-114" })
}

# ── 16. getUserNotifications ──────────────────────────────────────────────────
# Triggered by: GET /v1/notifications (JWT-secured HTTP API)
# Returns notification inbox for the calling user (userId from JWT sub claim).
# Optional query param ?unreadOnly=true queries via GSI1 UnreadIndex.

resource "aws_lambda_function" "get_notifications" {
  function_name = local.tf_lambda_get_notifications
  role          = aws_iam_role.get_notifications.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      NOTIFICATIONS_TABLE_NAME = local.tf_table_notifications
      ENVIRONMENT              = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_get_notifications}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-123" })
}

# ── 18. captureSentiment ─────────────────────────────────────────────────────
# Triggered by: POST /v1/candidates/{id}/sentiment (JWT-secured HTTP API)
# Writes D007 interview sentiment to SAGA record; publishes SentimentCaptured to EventBridge

resource "aws_lambda_function" "capture_sentiment" {
  function_name = local.tf_lambda_capture_sentiment
  role          = aws_iam_role.capture_sentiment.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME     = local.tf_table_state
      EVENTBRIDGE_BUS_NAME = local.tf_event_bus_name
      ENVIRONMENT          = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_capture_sentiment}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-123" })
}

# ── 17. markNotificationRead ──────────────────────────────────────────────────
# Triggered by: PATCH /v1/notifications/{id}/read (JWT-secured HTTP API)
# Sets read=true on the notification item and removes it from the UnreadIndex GSI
# by deleting GSI1PK and GSI1SK attributes.

resource "aws_lambda_function" "mark_notif_read" {
  function_name = local.tf_lambda_mark_notif_read
  role          = aws_iam_role.mark_notif_read.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      NOTIFICATIONS_TABLE_NAME = local.tf_table_notifications
      ENVIRONMENT              = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_mark_notif_read}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-123" })
}

# ── 19. createOffer ───────────────────────────────────────────────────────────
# Triggered by: EventBridge EvaluationCompleted (outcome=PASSED)
# Creates the offer record in DynamoDB, builds the seniority-driven approval chain,
# and starts the Step Functions offer-approval state machine.

resource "aws_lambda_function" "create_offer" {
  function_name = local.tf_lambda_create_offer
  role          = aws_iam_role.create_offer.arn
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
      EVENTBRIDGE_BUS_NAME   = local.tf_event_bus_name
      SFN_OFFER_APPROVAL_ARN = aws_sfn_state_machine.offer_approval.arn
      ENVIRONMENT            = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_create_offer}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-130", Purpose = "OfferCreation" })
}

# ── 20. getOffer ──────────────────────────────────────────────────────────────
# Triggered by: GET /v1/candidates/{id}/offer (JWT-secured HTTP API)
# Read-only: returns the current offer record including approvalChain and interactionLog.

resource "aws_lambda_function" "get_offer" {
  function_name = local.tf_lambda_get_offer
  role          = aws_iam_role.get_offer.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 15
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME = local.tf_table_state
      ENVIRONMENT      = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_get_offer}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-131", Purpose = "OfferRead" })
}

# ── 21. advanceOfferState ─────────────────────────────────────────────────────
# Triggered by: PUT /v1/candidates/{id}/offer (JWT-secured HTTP API)
# Handles all offer state transitions and interaction logging.
# On CONFIRM_ACCEPTANCE publishes OfferAccepted (Trigger 4 — IT/Facilities fan-out).

resource "aws_lambda_function" "advance_offer_state" {
  function_name = local.tf_lambda_advance_offer_state
  role          = aws_iam_role.advance_offer_state.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME     = local.tf_table_state
      EVENTBRIDGE_BUS_NAME = local.tf_event_bus_name
      ENVIRONMENT          = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_advance_offer_state}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-132", Purpose = "OfferStateAdvance" })
}

# ── 22. updateCandidate ───────────────────────────────────────────────────────
# Triggered by: PATCH /v1/candidates/{id} (JWT-secured HTTP API)
# Partial update of mutable candidate fields.
# positionLevel locked once stage >= PANEL_INTERVIEW.
# Publishes CandidateUpdated to EventBridge for the activity log.

resource "aws_lambda_function" "update_candidate" {
  function_name = local.tf_lambda_update_candidate
  role          = aws_iam_role.update_candidate.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME     = local.tf_table_state
      EVENTBRIDGE_BUS_NAME = local.tf_event_bus_name
      ENVIRONMENT          = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_update_candidate}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-133", Purpose = "CandidateUpdate" })
}

# ── 23. generateScoringLink ───────────────────────────────────────────────────
# Phase E — D004 hybrid panel model (email-link panelists)
# Triggered by: POST /v1/candidates/{id}/scoring-links (JWT-secured HTTP API)
# Generates a UUID token, writes candidate-indexed + token-indexed DDB records,
# returns a signed scoring URL valid for TOKEN_TTL_DAYS (default: 7 days).

resource "aws_lambda_function" "generate_scoring_link" {
  function_name = local.tf_lambda_generate_scoring_link
  role          = aws_iam_role.generate_scoring_link.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME = local.tf_table_state
      FRONTEND_URL     = "https://hr-portal-beryl-three.vercel.app"
      TOKEN_TTL_DAYS   = "7"
      ENVIRONMENT      = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_generate_scoring_link}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-138", Purpose = "ScoringLink", Phase = "E" })
}

# ── 24. submitVoteByToken ─────────────────────────────────────────────────────
# Phase E — D004 hybrid panel model (token-gated vote for email-link panelists)
# Triggered by: POST /v1/scoring/{token}/votes (authorization_type = NONE)
# Validates token from DDB, resolves identity, runs same scoring logic as
# submitVote but marks token used=true after successful submission.

resource "aws_lambda_function" "submit_vote_by_token" {
  function_name = local.tf_lambda_submit_vote_by_token
  role          = aws_iam_role.submit_vote_by_token.arn
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
    log_group  = "/aws/lambda/${local.tf_lambda_submit_vote_by_token}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "NH-138", Purpose = "TokenVote", Phase = "E" })
}

# ===========================================================================
# Admin Workspace Lambdas (Admin-S1)
# All five are JWT-secured via Gateway 1; ADMIN check enforced in-Lambda
# by reading custom:roles claim from the JWT context.
# Cognito operations target the Naleko pool (post pool-consolidation auth).
# ===========================================================================

# ── adminGetDashboard ────────────────────────────────────────────────────────
# GET /v1/admin/dashboard
# Aggregates KPI metrics (active candidates, SLA breaches, open offers,
# active users) from state + users tables. Read-only.

resource "aws_lambda_function" "admin_get_dashboard" {
  function_name = local.tf_lambda_admin_get_dashboard
  role          = aws_iam_role.admin_get_dashboard.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      STATE_TABLE_NAME = local.tf_table_state
      USERS_TABLE_NAME = local.tf_table_users
      ENVIRONMENT      = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_admin_get_dashboard}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "Admin-S1", Purpose = "AdminDashboard" })
}

# ── adminGetUsers ────────────────────────────────────────────────────────────
# GET /v1/admin/users
# Queries talent-flow-users table (fast, no Cognito N+1). Returns user list
# with roles[], status, and profile data for the admin Users & Roles UI.

resource "aws_lambda_function" "admin_get_users" {
  function_name = local.tf_lambda_admin_get_users
  role          = aws_iam_role.admin_get_users.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      USERS_TABLE_NAME = local.tf_table_users
      COGNITO_POOL_ID  = local.tf_naleko_pool_id
      ENVIRONMENT      = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_admin_get_users}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "Admin-S1", Purpose = "AdminUsersList" })
}

# ── adminCreateUser ──────────────────────────────────────────────────────────
# POST /v1/admin/users
# Calls cognitoIdentityServiceProvider.adminCreateUser on the Naleko pool,
# adds the user to the appropriate Cognito groups, then writes the profile +
# roles[] record to the talent-flow-users table.

resource "aws_lambda_function" "admin_create_user" {
  function_name = local.tf_lambda_admin_create_user
  role          = aws_iam_role.admin_create_user.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      USERS_TABLE_NAME = local.tf_table_users
      COGNITO_POOL_ID  = local.tf_naleko_pool_id
      ENVIRONMENT      = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_admin_create_user}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "Admin-S1", Purpose = "AdminUserCreate" })
}

# ── adminUpdateUser ──────────────────────────────────────────────────────────
# PUT /v1/admin/users/{userId}
# Updates Cognito group membership (add/remove) AND writes the new roles[]
# to the talent-flow-users table atomically. Both writes must succeed;
# Lambda rolls back the Cognito change if the DynamoDB write fails.

resource "aws_lambda_function" "admin_update_user" {
  function_name = local.tf_lambda_admin_update_user
  role          = aws_iam_role.admin_update_user.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      USERS_TABLE_NAME = local.tf_table_users
      COGNITO_POOL_ID  = local.tf_naleko_pool_id
      ENVIRONMENT      = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_admin_update_user}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "Admin-S1", Purpose = "AdminUserUpdate" })
}

# ── adminDeactivateUser ──────────────────────────────────────────────────────
# DELETE /v1/admin/users/{userId}
# Soft delete: calls adminDisableUser on Cognito + sets status = INACTIVE
# in the talent-flow-users table. User record is retained for POPIA audit trail.

resource "aws_lambda_function" "admin_deactivate_user" {
  function_name = local.tf_lambda_admin_deactivate
  role          = aws_iam_role.admin_deactivate_user.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["arm64"]

  environment {
    variables = {
      USERS_TABLE_NAME = local.tf_table_users
      COGNITO_POOL_ID  = local.tf_naleko_pool_id
      ENVIRONMENT      = var.environment
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/${local.tf_lambda_admin_deactivate}"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "Admin-S1", Purpose = "AdminUserDeactivate" })
}
