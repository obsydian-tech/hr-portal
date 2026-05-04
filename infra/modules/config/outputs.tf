output "config_bucket_name" {
  description = "Name of the S3 bucket storing AWS Config snapshots and history."
  value       = aws_s3_bucket.config_logs.bucket
}

output "config_recorder_name" {
  description = "Name of the AWS Config configuration recorder."
  value       = aws_config_configuration_recorder.naleko.name
}

output "region_check_lambda_arn" {
  description = "ARN of the custom Config rule Lambda (af-south-1 region enforcement)."
  value       = aws_lambda_function.config_region_check.arn
}
