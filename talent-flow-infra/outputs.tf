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
