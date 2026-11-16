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

variable "dynamodb_read_role_arns" {
  description = "IAM role ARNs that may only Decrypt/DescribeKey with this key, and only via DynamoDB (kms:ViaService)."
  type        = list(string)
  default     = []
}

variable "cognito_encrypt_pool_arns" {
  description = "ONB-24: user pools whose custom email sender codes Cognito encrypts with this key (Encrypt only)."
  type        = list(string)
  default     = []
}

variable "cognito_sender_decrypt_role_arns" {
  description = "ONB-24: custom email sender roles that may Decrypt codes, only for the pool's encryption context."
  type        = list(string)
  default     = []
}

variable "cognito_pool_id" {
  description = "ONB-24: the pool id Cognito puts in the encryption context (userpool-id)."
  type        = string
  default     = ""
}
