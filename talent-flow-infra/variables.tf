# ---------------------------------------------------------------------------
# TalentFlow MVP1 - Input Variables (NH-104 / TF-001)
# ---------------------------------------------------------------------------

variable "aws_account_id" {
  description = "AWS account ID - used in allowed_account_ids guard to prevent accidental cross-account applies."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit AWS account number."
  }
}

variable "environment" {
  description = "Deployment environment label applied to all resource tags."
  type        = string
  default     = "prod"
}

variable "project" {
  description = "Project name prefix used on all TalentFlow resource names."
  type        = string
  default     = "talent-flow"

  validation {
    condition     = var.project == "talent-flow"
    error_message = "project must be 'talent-flow' - all resource names depend on this prefix."
  }
}
