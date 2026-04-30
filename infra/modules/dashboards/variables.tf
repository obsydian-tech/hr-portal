variable "region" {
  description = "AWS region for dashboard widgets."
  type        = string
}

variable "environment" {
  description = "Deployment environment label (e.g. prod, dev)."
  type        = string
}

variable "lambda_names" {
  description = "List of all Lambda function names to include in health/security dashboards."
  type        = list(string)
}

variable "employees_api_id" {
  description = "API Gateway v2 ID for the employees HTTP API."
  type        = string
}

variable "document_api_id" {
  description = "API Gateway v2 ID for the document-upload HTTP API."
  type        = string
}

variable "dynamodb_tables" {
  description = "List of DynamoDB table names to monitor for throttles."
  type        = list(string)
}

variable "s3_bucket" {
  description = "Name of the S3 bucket used for document uploads."
  type        = string
}
