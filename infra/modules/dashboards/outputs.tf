output "hr_operations_dashboard_arn" {
  description = "ARN of the HR Operations dashboard."
  value       = aws_cloudwatch_dashboard.hr_operations.dashboard_arn
}

output "system_health_dashboard_arn" {
  description = "ARN of the System Health (Ops) dashboard."
  value       = aws_cloudwatch_dashboard.system_health.dashboard_arn
}

output "security_dashboard_arn" {
  description = "ARN of the Security/Audit dashboard."
  value       = aws_cloudwatch_dashboard.security.dashboard_arn
}
