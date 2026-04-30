output "sns_topic_arn" {
  description = "ARN of the naleko-ops-alerts SNS topic."
  value       = aws_sns_topic.naleko_ops.arn
}

output "critical_composite_alarm_arn" {
  description = "ARN of the naleko-production-critical composite alarm."
  value       = aws_cloudwatch_composite_alarm.naleko_critical.arn
}
