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
