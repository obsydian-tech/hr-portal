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

variable "manage_github_ci_roles" {
  description = "Create the GitHub OIDC provider and CI roles in this account. True in prod only; pepla-dev gets them from bootstrap/dev."
  type        = bool
  default     = true
}

# ── IDs of resources owned by infra/ (Naleko onboarding stack) ───────────────
# Defaults are prod. A new account (pepla-dev) sets them in env/<env>.tfvars;
# see bootstrap/dev/README.md for the first-time apply order.

variable "naleko_pool_id" {
  description = "Cognito user pool ID of the shared Naleko pool (infra/cognito.tf)."
  type        = string
  default     = "af-south-1_2LdAGFnw2"
}

variable "naleko_client_id" {
  description = "Cognito app client ID used by the Angular app."
  type        = string
  default     = "1pk5rd58glsohfplnlr63tg0qb"
}

variable "naleko_agent_api_id" {
  description = "API Gateway ID of naleko-agent-api (infra/agent_api.tf)."
  type        = string
  default     = "fou21cj8tj"
}

variable "naleko_agent_jwt_authorizer_id" {
  description = "ID of the Cognito JWT authorizer on naleko-agent-api."
  type        = string
  default     = "uhi317"
}
