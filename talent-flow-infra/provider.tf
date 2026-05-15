# ---------------------------------------------------------------------------
# TalentFlow MVP1 — Terraform Provider & Backend (NH-104 / TF-001)
#
# TalentFlow is a SIBLING STACK to Naleko.
# - Same AWS account (937137806477), same region (af-south-1)
# - Separate Terraform state key — never shares state with Naleko
# - allowed_account_ids guard prevents accidental cross-account applies
#
# State bucket: naleko-tfstate-af-south-1  (already exists, created by Naleko)
# State key:    talent-flow/mvp1/terraform.tfstate  (new key — TF creates it)
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Reuse Naleko's existing state bucket — different key isolates TalentFlow state.
  # use_lockfile = true uses TF 1.7+ native S3 locking (no DynamoDB lock table needed).
  backend "s3" {
    bucket       = "naleko-tfstate-af-south-1"
    key          = "talent-flow/mvp1/terraform.tfstate"
    region       = "af-south-1"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  # Hard-locked to af-south-1 (Cape Town) — POPIA data residency requirement.
  # Do NOT parameterise this — region must never drift.
  region = "af-south-1"

  # Safety guard: Terraform will refuse to run against any account other than
  # Naleko prod. Prevents accidental applies to a staging or personal account.
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = {
      Project            = "TalentFlow"
      ManagedBy          = "Terraform"
      DataClassification = "Confidential"
      Environment        = var.environment
    }
  }
}
