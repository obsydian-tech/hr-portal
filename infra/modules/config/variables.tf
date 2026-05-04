variable "region" {
  description = "AWS region."
  type        = string
}

variable "environment" {
  description = "Deployment environment label."
  type        = string
}

variable "account_id" {
  description = "AWS account ID — used in bucket policies and Config evaluations."
  type        = string
}

variable "ops_sns_topic_arn" {
  description = "ARN of the naleko-ops-alerts SNS topic for Config non-compliance notifications."
  type        = string
}

variable "lambda_role_arn" {
  description = "ARN of the Lambda execution role used by the custom Config rule Lambda."
  type        = string
}

variable "placeholder_zip" {
  description = "Path to the placeholder zip used for Lambda function source until code is deployed."
  type        = string
}

variable "config_lambda_zip" {
  description = "Path to the configRegionCheck Lambda deployment zip (built from lambda/configRegionCheck/)."
  type        = string
}
