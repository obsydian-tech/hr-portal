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
  default     = "ignecious@obsydiantechnologies.com"
}

variable "alert_email" {
  description = "Email address subscribed to the naleko-cost-alerts SNS topic for cost anomaly notifications."
  type        = string
  default     = "ignecious@obsydiantechnologies.com"
}

variable "enable_prod_monitoring" {
  description = "AWS Config, CloudWatch dashboards and alarms. These cost a fixed amount each month, so they are on in prod and off in pepla-dev."
  type        = bool
  default     = true
}

# ── IDs of resources owned by talent-flow-infra/ ─────────────────────────────
# Defaults are prod. A new account (pepla-dev) sets them in env/<env>.tfvars
# after talent-flow-infra/ has been applied there.

variable "talent_flow_api_id" {
  description = "API Gateway ID of talent-flow-api (created by talent-flow-infra/)."
  type        = string
  default     = "57l0w7kk9h"
}

variable "talent_flow_cognito_authorizer_id" {
  description = "ID of the cognito-jwt authorizer on talent-flow-api."
  type        = string
  default     = "ko4zam"
}

variable "talent_flow_kms_key_id" {
  description = "Key ID of the TalentFlow KMS key used for the talent-flow-events table."
  type        = string
  default     = "87842eae-1ee4-43d1-8bf8-9dd92415ea68"
}
