variable "alias_name" {
  description = "KMS alias (without the alias/ prefix)."
  type        = string
}

variable "description" {
  description = "Human-readable description for the KMS key."
  type        = string
  default     = "Naleko onboarding PII customer-managed key"
}

variable "aws_account_id" {
  description = "AWS account ID for the key policy root principal."
  type        = string
}

variable "aws_region" {
  description = "AWS region (used in key policy conditions)."
  type        = string
}

variable "allowed_role_arns" {
  description = "IAM role ARNs that may use this key for encrypt/decrypt operations."
  type        = list(string)
  default     = []
}

variable "deletion_window_in_days" {
  description = "Waiting period (7-30 days) before a scheduled key deletion takes effect."
  type        = number
  default     = 30
}
