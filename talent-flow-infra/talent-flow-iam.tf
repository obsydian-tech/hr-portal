# ---------------------------------------------------------------------------
# TalentFlow - Per-Lambda IAM Roles (NH-111 / TF-008)
#
# 13 least-privilege roles - one aws_iam_role + aws_iam_role_policy pair
# per Lambda function. All ARNs are scoped to talent-flow-* resources only.
#
# Pattern: mirrors Naleko infra/iam_per_lambda.tf (NH-8)
#   - Inline policy (aws_iam_role_policy) - no managed policies
#   - Sids: Logs, XRay, then service-specific
#   - Path: /talent-flow/
#
# Role naming: local.tf_iam_role_prefix + function_name
# = "talent-flow-role-<functionName>"
#
# preTokenTrigger role is excluded - created in TF-003 / talent-flow-cognito.tf
# ---------------------------------------------------------------------------

locals {
  # Shared assume-role policy for all Lambda execution roles
  tf_lambda_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  # Shared KMS actions needed for DynamoDB SSE reads/writes
  tf_kms_actions = [
    "kms:Decrypt",
    "kms:GenerateDataKey",
    "kms:GenerateDataKeyWithoutPlaintext",
    "kms:DescribeKey",
  ]
}

# ── 1. createCandidate ────────────────────────────────────────────────────────
# Triggered by: POST /candidates (HTTP API)
# Needs: DynamoDB state (PutItem), idempotency (GetItem+PutItem),
#        EventBridge PutEvents, KMS state CMK

resource "aws_iam_role" "create_candidate" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_create_candidate}"
  description        = "Execution role for createCandidate Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-111" })
}

resource "aws_iam_role_policy" "create_candidate" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_create_candidate}-policy"
  role = aws_iam_role.create_candidate.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_create_candidate}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "StateTableWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}"
      },
      {
        Sid      = "IdempotencyTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_idempotency}"
      },
      {
        Sid      = "EventBridgePublish"
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = aws_cloudwatch_event_bus.talent_flow.arn
      },
      {
        Sid      = "KMSStateKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_state.arn
      },
    ]
  })
}

# ── 2. orchestrateTalentFlowWorkflow ──────────────────────────────────────────
# Triggered by: EventBridge CandidateCreated
# Needs: DynamoDB state (UpdateItem), config (GetItem),
#        EventBridge PutEvents, KMS state CMK

resource "aws_iam_role" "orchestrate_workflow" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_orchestrate_workflow}"
  description        = "Execution role for orchestrateTalentFlowWorkflow Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-111" })
}

resource "aws_iam_role_policy" "orchestrate_workflow" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_orchestrate_workflow}-policy"
  role = aws_iam_role.orchestrate_workflow.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_orchestrate_workflow}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "StateTableUpdate"
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem", "dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}"
      },
      {
        Sid      = "ConfigTableRead"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_config}"
      },
      {
        Sid      = "EventBridgePublish"
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = aws_cloudwatch_event_bus.talent_flow.arn
      },
      {
        Sid      = "KMSStateKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_state.arn
      },
    ]
  })
}

# ── 3. scheduleInterview ──────────────────────────────────────────────────────
# Triggered by: EventBridge InterviewScheduled
# Needs: DynamoDB state (UpdateItem), config (GetItem),
#        EventBridge PutEvents, SQS notification queue (SendMessage),
#        KMS state + agent-audit CMKs

resource "aws_iam_role" "schedule_interview" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_schedule_interview}"
  description        = "Execution role for scheduleInterview Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-111" })
}

resource "aws_iam_role_policy" "schedule_interview" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_schedule_interview}-policy"
  role = aws_iam_role.schedule_interview.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_schedule_interview}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "StateTableUpdate"
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem", "dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}"
      },
      {
        Sid      = "ConfigTableRead"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_config}"
      },
      {
        Sid      = "EventBridgePublish"
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = aws_cloudwatch_event_bus.talent_flow.arn
      },
      {
        Sid      = "NotificationQueueSend"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.talent_flow_notification.arn
      },
      {
        Sid      = "KMSStateKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_state.arn
      },
      {
        Sid      = "KMSAgentAuditKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_agent_audit.arn
      },
    ]
  })
}

# ── 4. submitVote ─────────────────────────────────────────────────────────────
# Triggered by: EventBridge VoteSubmitted
# Needs: DynamoDB state (GetItem+UpdateItem), config (GetItem),
#        EventBridge PutEvents, KMS state CMK

resource "aws_iam_role" "submit_vote" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_submit_vote}"
  description        = "Execution role for submitVote Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-111" })
}

resource "aws_iam_role_policy" "submit_vote" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_submit_vote}-policy"
  role = aws_iam_role.submit_vote.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_submit_vote}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "StateTableReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}"
      },
      {
        Sid      = "ConfigTableRead"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_config}"
      },
      {
        Sid      = "EventBridgePublish"
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = aws_cloudwatch_event_bus.talent_flow.arn
      },
      {
        Sid      = "KMSStateKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_state.arn
      },
    ]
  })
}

# ── 5. completeEvaluation ─────────────────────────────────────────────────────
# Triggered by: EventBridge VotingCompleted
# Needs: DynamoDB state (UpdateItem), config (GetItem),
#        EventBridge PutEvents, KMS state CMK

resource "aws_iam_role" "complete_evaluation" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_complete_evaluation}"
  description        = "Execution role for completeEvaluation Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-111" })
}

resource "aws_iam_role_policy" "complete_evaluation" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_complete_evaluation}-policy"
  role = aws_iam_role.complete_evaluation.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_complete_evaluation}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "StateTableUpdate"
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem", "dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}"
      },
      {
        Sid      = "ConfigTableRead"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_config}"
      },
      {
        Sid      = "EventBridgePublish"
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = aws_cloudwatch_event_bus.talent_flow.arn
      },
      {
        Sid      = "KMSStateKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_state.arn
      },
    ]
  })
}

# ── 6. manageTalentFlowConfig ─────────────────────────────────────────────────
# Triggered by: POST/PUT/GET /config (HTTP API, admin-only)
# Needs: DynamoDB config (GetItem+PutItem+UpdateItem+Query), KMS state CMK

resource "aws_iam_role" "manage_config" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_manage_config}"
  description        = "Execution role for manageTalentFlowConfig Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-111" })
}

resource "aws_iam_role_policy" "manage_config" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_manage_config}-policy"
  role = aws_iam_role.manage_config.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_manage_config}:*"
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
          "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_config}",
          "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_config}/index/*",
        ]
      },
      {
        Sid      = "KMSStateKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_state.arn
      },
    ]
  })
}

# ── 7. sendTalentFlowNotification ─────────────────────────────────────────────
# Triggered by: SQS talent-flow-notification-queue
# Needs: SQS (ReceiveMessage+DeleteMessage+GetQueueAttributes),
#        DynamoDB config (GetItem), SES (SendEmail),
#        KMS state + agent-audit CMKs

resource "aws_iam_role" "send_notification" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_send_notification}"
  description        = "Execution role for sendTalentFlowNotification Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-111" })
}

resource "aws_iam_role_policy" "send_notification" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_send_notification}-policy"
  role = aws_iam_role.send_notification.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_send_notification}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "NotificationQueueConsume"
        Effect   = "Allow"
        Action   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
        Resource = aws_sqs_queue.talent_flow_notification.arn
      },
      {
        Sid      = "ConfigTableRead"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_config}"
      },
      {
        Sid      = "SESSendEmail"
        Effect   = "Allow"
        Action   = ["ses:SendEmail", "ses:SendRawEmail"]
        Resource = "arn:aws:ses:af-south-1:${var.aws_account_id}:identity/*"
      },
      {
        Sid      = "KMSStateKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_state.arn
      },
      {
        Sid      = "KMSAgentAuditKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_agent_audit.arn
      },
    ]
  })
}

# ── 8. monitorTalentFlowSLAs ──────────────────────────────────────────────────
# Triggered by: EventBridge hourly cron
# Needs: DynamoDB state (Query+Scan+UpdateItem), config (GetItem),
#        EventBridge PutEvents, KMS state CMK

resource "aws_iam_role" "monitor_slas" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_monitor_slas}"
  description        = "Execution role for monitorTalentFlowSLAs Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-111" })
}

resource "aws_iam_role_policy" "monitor_slas" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_monitor_slas}-policy"
  role = aws_iam_role.monitor_slas.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_monitor_slas}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid    = "StateTableScan"
        Effect = "Allow"
        Action = ["dynamodb:Query", "dynamodb:Scan"]
        Resource = [
          "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}",
          "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}/index/*",
        ]
      },
      {
        Sid      = "StateTableUpdate"
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}"
      },
      {
        Sid      = "ConfigTableRead"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_config}"
      },
      {
        Sid      = "EventBridgePublish"
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = aws_cloudwatch_event_bus.talent_flow.arn
      },
      {
        Sid      = "KMSStateKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_state.arn
      },
    ]
  })
}

# ── 9. talentFlowAiChat ───────────────────────────────────────────────────────
# Triggered by: POST /ai/chat (Agent API Gateway)
# Needs: DynamoDB state (GetItem+Query), config (GetItem),
#        agent-audit (PutItem), rate-limit (GetItem+UpdateItem),
#        Bedrock InvokeModel (Haiku + Sonnet), KMS both CMKs

resource "aws_iam_role" "ai_chat" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_ai_chat}"
  description        = "Execution role for talentFlowAiChat Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-111" })
}

resource "aws_iam_role_policy" "ai_chat" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_ai_chat}-policy"
  role = aws_iam_role.ai_chat.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_ai_chat}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid    = "StateTableRead"
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = [
          "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}",
          "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}/index/*",
        ]
      },
      {
        Sid      = "ConfigTableRead"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_config}"
      },
      {
        Sid      = "AgentAuditTableWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_agent_audit}"
      },
      {
        Sid      = "RateLimitTableReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_rate_limit}"
      },
      {
        Sid    = "BedrockInvokeModel"
        Effect = "Allow"
        Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = [
          "arn:aws:bedrock:*::foundation-model/${local.tf_model_fast}",
          "arn:aws:bedrock:*::foundation-model/${local.tf_model_smart}",
        ]
      },
      {
        # HITL: write pending action for write-tool calls, read back after approval
        Sid      = "PendingActionsTable"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_pending_actions}"
      },
      {
        Sid      = "PromptCacheTableReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_prompt_cache}"
      },
      {
        Sid      = "KMSStateKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_state.arn
      },
      {
        Sid      = "KMSAgentAuditKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_agent_audit.arn
      },
    ]
  })
}

# ── 10. talentFlowAuthorizer ──────────────────────────────────────────────────
# Triggered by: API Gateway Lambda authorizer
# Needs: Secrets Manager GetSecretValue for talent-flow/agent/api-key,
#        KMS agent-audit CMK (secret encrypted with it)

resource "aws_iam_role" "authorizer" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_authorizer}"
  description        = "Execution role for talentFlowAuthorizer Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-111" })
}

resource "aws_iam_role_policy" "authorizer" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_authorizer}-policy"
  role = aws_iam_role.authorizer.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_authorizer}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "SecretsManagerRead"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:af-south-1:${var.aws_account_id}:secret:${local.tf_secret_agent_api_key}*"
      },
      {
        Sid      = "KMSAgentAuditKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_agent_audit.arn
      },
    ]
  })
}

# ── 11. talentFlowApproveAction ───────────────────────────────────────────────
# Triggered by: POST /ai/approve (Agent API Gateway)
# Needs: DynamoDB pending-actions (GetItem+UpdateItem),
#        EventBridge PutEvents (to resume talentFlowAiChat), KMS state CMK

resource "aws_iam_role" "approve_action" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_approve_action}"
  description        = "Execution role for talentFlowApproveAction Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-111" })
}

resource "aws_iam_role_policy" "approve_action" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_approve_action}-policy"
  role = aws_iam_role.approve_action.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_approve_action}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "PendingActionsReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_pending_actions}"
      },
      {
        Sid      = "EventBridgePublish"
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = aws_cloudwatch_event_bus.talent_flow.arn
      },
      {
        Sid      = "KMSStateKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_state.arn
      },
    ]
  })
}

# ── 12. talentFlowArchiveAuditLog ─────────────────────────────────────────────
# Triggered by: DynamoDB Stream on talent-flow-agent-audit
# Needs: DynamoDB Streams read on agent-audit table,
#        S3 PutObject on audit-archive bucket, KMS agent-audit CMK

resource "aws_iam_role" "archive_audit_log" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_archive_audit}"
  description        = "Execution role for talentFlowArchiveAuditLog Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-111" })
}

resource "aws_iam_role_policy" "archive_audit_log" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_archive_audit}-policy"
  role = aws_iam_role.archive_audit_log.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_archive_audit}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid    = "DynamoDBStreamRead"
        Effect = "Allow"
        Action = [
          "dynamodb:GetRecords",
          "dynamodb:GetShardIterator",
          "dynamodb:DescribeStream",
          "dynamodb:ListStreams",
        ]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_agent_audit}/stream/*"
      },
      {
        Sid      = "S3AuditArchiveWrite"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.talent_flow_audit_archive.arn}/*"
      },
      {
        Sid      = "KMSAgentAuditKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_agent_audit.arn
      },
      {
        Sid      = "DLQSend"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.archive_audit_log_dlq.arn
      },
    ]
  })
}

# ── 14. getCandidates ────────────────────────────────────────────────────────
# Triggered by: API GW GET /v1/candidates
# Needs: DynamoDB state table Query (GSI1), Logs, XRay

resource "aws_iam_role" "get_candidates" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_get_candidates}"
  description        = "Execution role for getCandidates Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-113" })
}

resource "aws_iam_role_policy" "get_candidates" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_get_candidates}-policy"
  role = aws_iam_role.get_candidates.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_get_candidates}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "DynamoDBQuery"
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = [
          "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}",
          "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}/index/GSI1",
        ]
      },
    ]
  })
}

# ── 15. getCandidate ─────────────────────────────────────────────────────────
# Triggered by: API GW GET /v1/candidates/{id}
# Needs: DynamoDB state table GetItem, Logs, XRay

resource "aws_iam_role" "get_candidate" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_get_candidate}"
  description        = "Execution role for getCandidate Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-113" })
}

resource "aws_iam_role_policy" "get_candidate" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_get_candidate}-policy"
  role = aws_iam_role.get_candidate.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_get_candidate}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "DynamoDBGetItem"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}"
      },
    ]
  })
}

# ── 13. talentFlowRotateApiKey ────────────────────────────────────────────────
# Triggered by: EventBridge 90-day cron (defined in talent-flow-ai-chat.tf / TF-012)
# Needs: Secrets Manager (GetSecretValue+PutSecretValue) for agent API key,
#        KMS agent-audit CMK

resource "aws_iam_role" "rotate_api_key" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_rotate_api_key}"
  description        = "Execution role for talentFlowRotateApiKey Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "NH-111" })
}

resource "aws_iam_role_policy" "rotate_api_key" {
  name = "${local.tf_iam_role_prefix}${local.tf_lambda_rotate_api_key}-policy"
  role = aws_iam_role.rotate_api_key.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/${local.tf_lambda_rotate_api_key}:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "SecretsManagerReadWrite"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue"]
        Resource = "arn:aws:secretsmanager:af-south-1:${var.aws_account_id}:secret:${local.tf_secret_agent_api_key}*"
      },
      {
        Sid      = "KMSAgentAuditKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_agent_audit.arn
      },
    ]
  })
}
