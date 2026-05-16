# ---------------------------------------------------------------------------
# TalentFlow MVP1 — Root Outputs (NH-104 / TF-001)
#
# Minimal outputs for the bootstrap phase.
# Additional outputs (Lambda ARNs, API Gateway URLs, Cognito IDs, etc.)
# will be added in TF-003 through TF-012 as resources are created.
# ---------------------------------------------------------------------------

output "environment" {
  description = "Deployment environment this stack was applied to."
  value       = var.environment
}

output "project" {
  description = "Project prefix used on all TalentFlow resource names."
  value       = var.project
}

output "aws_region" {
  description = "AWS region — always af-south-1 for POPIA compliance."
  value       = "af-south-1"
}

output "state_bucket" {
  description = "S3 bucket holding the TalentFlow Terraform state."
  value       = "naleko-tfstate-af-south-1"
}

output "state_key" {
  description = "S3 key (path) for the TalentFlow state file."
  value       = "talent-flow/mvp1/terraform.tfstate"
}

# ── KMS outputs (added TF-002 / NH-105) ──────────────────────────────────────

output "kms_state_key_arn" {
  description = "ARN of the TalentFlow state CMK (alias/talent-flow/state) — used for DynamoDB SSE."
  value       = aws_kms_key.talent_flow_state.arn
}

output "kms_state_key_id" {
  description = "Key ID of the TalentFlow state CMK — referenced by DynamoDB table resources."
  value       = aws_kms_key.talent_flow_state.key_id
}

output "kms_agent_audit_key_arn" {
  description = "ARN of the TalentFlow agent-audit CMK (alias/talent-flow/agent-audit) — used for agent-audit DynamoDB, S3, SQS, Secrets Manager."
  value       = aws_kms_key.talent_flow_agent_audit.arn
}

output "kms_agent_audit_key_id" {
  description = "Key ID of the TalentFlow agent-audit CMK — referenced by S3, SQS, and Secrets Manager resources."
  value       = aws_kms_key.talent_flow_agent_audit.key_id
}

# ── Cognito outputs (added TF-003 / NH-106) ───────────────────────────────────

output "cognito_user_pool_id" {
  description = "TalentFlow Cognito User Pool ID — referenced by API Gateway authorizer (TF-010) and Angular environment config."
  value       = aws_cognito_user_pool.talent_flow.id
}

output "cognito_user_pool_arn" {
  description = "TalentFlow Cognito User Pool ARN."
  value       = aws_cognito_user_pool.talent_flow.arn
}

output "cognito_client_id" {
  description = "TalentFlow web app client ID — used by Angular Amplify configuration."
  value       = aws_cognito_user_pool_client.talent_flow_web.id
}

# ── DynamoDB outputs (added TF-004 / NH-107) ──────────────────────────────────

output "dynamodb_state_table_name" {
  description = "talent-flow-state table name — SAGA operational records."
  value       = aws_dynamodb_table.talent_flow_state.name
}

output "dynamodb_state_table_arn" {
  description = "talent-flow-state table ARN."
  value       = aws_dynamodb_table.talent_flow_state.arn
}

output "dynamodb_state_stream_arn" {
  description = "talent-flow-state DynamoDB Stream ARN — consumed by SLA monitor Lambda."
  value       = aws_dynamodb_table.talent_flow_state.stream_arn
}

output "dynamodb_config_table_name" {
  description = "talent-flow-config table name — Metadata-Lite Variable Six store."
  value       = aws_dynamodb_table.talent_flow_config.name
}

output "dynamodb_config_table_arn" {
  description = "talent-flow-config table ARN."
  value       = aws_dynamodb_table.talent_flow_config.arn
}

output "dynamodb_agent_audit_table_name" {
  description = "talent-flow-agent-audit table name — AI audit trail (POPIA)."
  value       = aws_dynamodb_table.talent_flow_agent_audit.name
}

output "dynamodb_agent_audit_table_arn" {
  description = "talent-flow-agent-audit table ARN."
  value       = aws_dynamodb_table.talent_flow_agent_audit.arn
}

output "dynamodb_agent_audit_stream_arn" {
  description = "talent-flow-agent-audit DynamoDB Stream ARN — feeds S3 audit archive."
  value       = aws_dynamodb_table.talent_flow_agent_audit.stream_arn
}

output "dynamodb_prompt_cache_table_name" {
  description = "talent-flow-prompt-cache table name."
  value       = aws_dynamodb_table.talent_flow_prompt_cache.name
}

output "dynamodb_pending_actions_table_name" {
  description = "talent-flow-pending-actions table name — HITL gate."
  value       = aws_dynamodb_table.talent_flow_pending_actions.name
}

output "dynamodb_rate_limit_table_name" {
  description = "talent-flow-ai-rate-limit table name."
  value       = aws_dynamodb_table.talent_flow_ai_rate_limit.name
}

output "dynamodb_idempotency_table_name" {
  description = "talent-flow-idempotency-keys table name."
  value       = aws_dynamodb_table.talent_flow_idempotency_keys.name
}

# ── S3 outputs (added TF-005 / NH-108) ────────────────────────────────────────

output "s3_audit_archive_bucket_name" {
  description = "talent-flow-audit-archive S3 bucket name — written to by talentFlowArchiveAuditLog Lambda."
  value       = aws_s3_bucket.talent_flow_audit_archive.id
}

output "s3_audit_archive_bucket_arn" {
  description = "talent-flow-audit-archive S3 bucket ARN — referenced in talentFlowArchiveAuditLog Lambda IAM role (TF-008)."
  value       = aws_s3_bucket.talent_flow_audit_archive.arn
}

# ── SQS outputs (added TF-006 / NH-109) ───────────────────────────────────────

output "sqs_notification_queue_url" {
  description = "talent-flow-notification-queue.fifo URL — used as Lambda event source mapping target (TF-009)."
  value       = aws_sqs_queue.talent_flow_notification.id
}

output "sqs_notification_queue_arn" {
  description = "talent-flow-notification-queue.fifo ARN — referenced in sendTalentFlowNotification Lambda IAM role (TF-008)."
  value       = aws_sqs_queue.talent_flow_notification.arn
}

output "sqs_notification_dlq_arn" {
  description = "talent-flow-notification-dlq.fifo ARN — for alarm configuration."
  value       = aws_sqs_queue.talent_flow_notification_dlq.arn
}

output "sqs_feedback_queue_url" {
  description = "talent-flow-feedback-queue.fifo URL."
  value       = aws_sqs_queue.talent_flow_feedback.id
}

output "sqs_feedback_queue_arn" {
  description = "talent-flow-feedback-queue.fifo ARN."
  value       = aws_sqs_queue.talent_flow_feedback.arn
}

output "sqs_feedback_dlq_arn" {
  description = "talent-flow-feedback-dlq.fifo ARN — for alarm configuration."
  value       = aws_sqs_queue.talent_flow_feedback_dlq.arn
}

# ── EventBridge outputs (added TF-007 / NH-110) ───────────────────────────────

output "eventbridge_bus_name" {
  description = "talent-flow-bus custom event bus name — used in Lambda publisher env vars (TF-009)."
  value       = aws_cloudwatch_event_bus.talent_flow.name
}

output "eventbridge_bus_arn" {
  description = "talent-flow-bus custom event bus ARN — referenced in Lambda IAM policies (TF-008)."
  value       = aws_cloudwatch_event_bus.talent_flow.arn
}
