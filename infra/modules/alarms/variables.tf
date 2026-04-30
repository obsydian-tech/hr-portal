variable "region" {
  description = "AWS region."
  type        = string
}

variable "environment" {
  description = "Deployment environment label (e.g. prod, dev)."
  type        = string
}

variable "ops_email" {
  description = "Email address for the naleko-ops SNS subscription (operations alerts)."
  type        = string
}

variable "lambda_names" {
  description = "List of all Lambda function names — used for per-function error/duration alarms."
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
