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

variable "frontend_url" {
  description = "Base web address used to build scoring links (FRONTEND_URL on generateScoringLink). Defaults to prod; env/dev.tfvars overrides."
  type        = string
  default     = "https://hr-portal-beryl-three.vercel.app"
}

variable "legacy_tenant_id" {
  description = "TEN-03: the founding company, given to a TalentFlow sign-in that has no Member row yet. Empty turns the rule off."
  type        = string
  default     = ""

  validation {
    condition     = var.legacy_tenant_id == "" || can(regex("^ten_[0-9a-z]{26}$", var.legacy_tenant_id))
    error_message = "legacy_tenant_id must be empty or ten_ followed by 26 lower-case letters or digits."
  }
}

variable "roles_legacy_tenant_id" {
  description = "REC-04: the founding company, for manageRoles only, so a hiring manager with no Member row counts as in that company. Same value as legacy_tenant_id in infra/env. Empty turns the rule off."
  type        = string
  default     = ""

  validation {
    condition     = var.roles_legacy_tenant_id == "" || can(regex("^ten_[0-9a-z]{26}$", var.roles_legacy_tenant_id))
    error_message = "roles_legacy_tenant_id must be empty or ten_ followed by 26 lower-case letters or digits."
  }
}

variable "agent_tenant_id" {
  description = "TEN-03: the one company the TalentFlow agent key (x-api-key) acts for. Empty: the authorizer authorizes nothing."
  type        = string
  default     = ""

  validation {
    condition     = var.agent_tenant_id == "" || can(regex("^ten_[0-9a-z]{26}$", var.agent_tenant_id))
    error_message = "agent_tenant_id must be empty or ten_ followed by 26 lower-case letters or digits."
  }
}

variable "delete_leaver_chats_enabled" {
  description = "CHAT-15: whether the hourly rule that deletes a leaver's Ask Batsi chats is ENABLED. Off by default (prod gets it in the release that gives prod Ask Batsi); env/dev.tfvars turns it on."
  type        = bool
  default     = false
}

variable "interview_email_mode" {
  description = "INT-04: TEST_ADDRESS sends every interview email to the blackhole test address; REAL sends to the person. Iggie switches it at release (P-21)."
  type        = string
  default     = "TEST_ADDRESS"
  validation {
    condition     = contains(["TEST_ADDRESS", "REAL"], var.interview_email_mode)
    error_message = "interview_email_mode must be TEST_ADDRESS or REAL."
  }
}
