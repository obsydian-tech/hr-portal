terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state — bucket created once via CLI (see README bootstrap section)
  backend "s3" {
    bucket       = "naleko-tfstate-af-south-1"
    key          = "naleko/onboarding/terraform.tfstate"
    region       = "af-south-1"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.aws_region

  # Hard-guard: refuse to run against any account other than Naleko prod
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = {
      Project            = "Naleko"
      ManagedBy          = "Terraform"
      DataClassification = "PII"
      Environment        = var.environment
    }
  }
}
