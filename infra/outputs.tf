# Outputs grow as modules are added.
# Stage 1: bootstrap only — nothing to output yet.

output "aws_region" {
  description = "AWS region all resources are deployed in."
  value       = var.aws_region
}

output "environment" {
  description = "Active deployment environment."
  value       = var.environment
}

# NH-10: KMS CMK
output "kms_pii_key_arn" {
  description = "ARN of the PII customer-managed KMS key (alias/naleko-onboarding-pii)."
  value       = module.kms_pii.key_arn
}

output "kms_pii_alias_name" {
  description = "Alias name of the PII CMK."
  value       = module.kms_pii.alias_name
}

# NH-47: MCP Server
output "mcp_server_url" {
  description = "Lambda Function URL for the Naleko MCP server (HTTP+SSE transport). Use this in mcp-config.json for Claude Desktop / Cursor."
  value       = aws_lambda_function_url.naleko_mcp_server.function_url
}
