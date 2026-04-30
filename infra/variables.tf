variable "aws_region" {
  description = "AWS region for all Naleko resources. Must remain af-south-1 for POPIA compliance."
  type        = string
  default     = "af-south-1"

  validation {
    condition     = var.aws_region == "af-south-1"
    error_message = "POPIA requires all resources to stay in af-south-1 (Cape Town). Do not change this."
  }
}

variable "aws_account_id" {
  description = "Naleko production AWS account ID. Used as a safety guard in the provider block."
  type        = string
  default     = "937137806477"
}

variable "environment" {
  description = "Deployment environment label applied to all resource tags."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "staging", "dev"], var.environment)
    error_message = "environment must be one of: prod, staging, dev"
  }
}

variable "project" {
  description = "Project name used as a prefix on resource names."
  type        = string
  default     = "naleko"
}

variable "ops_email" {
  description = "Email address subscribed to the naleko-ops-alerts SNS topic for CloudWatch alarm notifications."
  type        = string
  default     = "ops@naleko.co.za"
}
