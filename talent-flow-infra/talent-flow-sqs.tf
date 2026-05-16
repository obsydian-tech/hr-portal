# ---------------------------------------------------------------------------
# TalentFlow - SQS FIFO Queues (NH-109 / TF-006)
#
# Two FIFO queue pairs (main + DLQ):
#   1. talent-flow-notification-queue.fifo
#      Consumer: sendTalentFlowNotification Lambda (SQS event source mapping)
#      Producers: orchestrateTalentFlowWorkflow, scheduleInterview,
#                 completeEvaluation, monitorTalentFlowSLAs (via EventBridge rules)
#
#   2. talent-flow-feedback-queue.fifo
#      Consumer: future feedback processing Lambda (MVP2)
#      Producer: talentFlowAiChat (HITL approval callbacks)
#
# Design decisions:
#   - content_based_deduplication = true  → producers omit MessageDeduplicationId
#   - visibility_timeout_seconds = 30     → matches Lambda 30s timeout
#   - max_receive_count = 5               → 5 delivery attempts before DLQ
#   - KMS: aws_kms_key.talent_flow_agent_audit (SSE-KMS)
# ---------------------------------------------------------------------------

# ── Notification DLQ ──────────────────────────────────────────────────────────

resource "aws_sqs_queue" "talent_flow_notification_dlq" {
  name                        = local.tf_queue_notification_dlq # talent-flow-notification-dlq.fifo
  fifo_queue                  = true
  content_based_deduplication = true
  kms_master_key_id           = aws_kms_key.talent_flow_agent_audit.arn
  message_retention_seconds   = 604800 # 7 days

  tags = merge(local.tf_tags, {
    Purpose = "notification-dlq"
    Ticket  = "NH-109"
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "talent_flow_notification_dlq" {
  queue_url = aws_sqs_queue.talent_flow_notification_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.talent_flow_notification.arn]
  })
}

# ── Notification Queue ────────────────────────────────────────────────────────

resource "aws_sqs_queue" "talent_flow_notification" {
  name                        = local.tf_queue_notification # talent-flow-notification-queue.fifo
  fifo_queue                  = true
  content_based_deduplication = true
  kms_master_key_id           = aws_kms_key.talent_flow_agent_audit.arn
  visibility_timeout_seconds  = 30
  message_retention_seconds   = 345600 # 4 days

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.talent_flow_notification_dlq.arn
    maxReceiveCount     = 5
  })

  tags = merge(local.tf_tags, {
    Purpose = "notification-queue"
    Ticket  = "NH-109"
  })
}

# ── Feedback DLQ ──────────────────────────────────────────────────────────────

resource "aws_sqs_queue" "talent_flow_feedback_dlq" {
  name                        = local.tf_queue_feedback_dlq # talent-flow-feedback-dlq.fifo
  fifo_queue                  = true
  content_based_deduplication = true
  kms_master_key_id           = aws_kms_key.talent_flow_agent_audit.arn
  message_retention_seconds   = 604800 # 7 days

  tags = merge(local.tf_tags, {
    Purpose = "feedback-dlq"
    Ticket  = "NH-109"
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "talent_flow_feedback_dlq" {
  queue_url = aws_sqs_queue.talent_flow_feedback_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.talent_flow_feedback.arn]
  })
}

# ── Feedback Queue ────────────────────────────────────────────────────────────

resource "aws_sqs_queue" "talent_flow_feedback" {
  name                        = local.tf_queue_feedback # talent-flow-feedback-queue.fifo
  fifo_queue                  = true
  content_based_deduplication = true
  kms_master_key_id           = aws_kms_key.talent_flow_agent_audit.arn
  visibility_timeout_seconds  = 30
  message_retention_seconds   = 345600 # 4 days

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.talent_flow_feedback_dlq.arn
    maxReceiveCount     = 5
  })

  tags = merge(local.tf_tags, {
    Purpose = "feedback-queue"
    Ticket  = "NH-109"
  })
}
