# ---------------------------------------------------------------------------
# pepla-dev account bootstrap (one-off, applied from Iggie's Mac)
#
# Creates the things CI needs before it can deploy into pepla-dev:
#   1. S3 bucket for pepla-dev's Terraform state
#   2. GitHub OIDC provider + role pepla-github-deploy-dev (no stored keys)
#   3. Monthly budget with email alerts
#   4. Seed parameters the stacks read at plan time
#
# State for THIS root lives in the prod state bucket (management account),
# because the dev bucket doesn't exist until this root creates it.
# The provider switches into pepla-dev via OrganizationAccountAccessRole.
# ---------------------------------------------------------------------------

terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket       = "naleko-tfstate-af-south-1"
    key          = "bootstrap/pepla-dev/terraform.tfstate"
    region       = "af-south-1"
    use_lockfile = true
    encrypt      = true
  }
}

variable "dev_account_id" {
  description = "pepla-dev member account ID."
  type        = string
  default     = "424556617428"
}

variable "budget_alert_email" {
  description = "Who gets the budget alerts. Passed at apply time; not stored in this public repo."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly cost budget for pepla-dev, in USD."
  type        = string
  default     = "20"
}

provider "aws" {
  region              = "af-south-1"
  allowed_account_ids = [var.dev_account_id]

  assume_role {
    role_arn     = "arn:aws:iam::${var.dev_account_id}:role/OrganizationAccountAccessRole"
    session_name = "pepla-dev-bootstrap"
  }

  default_tags {
    tags = {
      Project     = "Pepla"
      ManagedBy   = "Terraform"
      Environment = "dev"
      Stack       = "bootstrap"
    }
  }
}

locals {
  repo_short     = "repo:obsydian-tech/hr-portal"
  repo_immutable = "repo:obsydian-tech@183697107/hr-portal@1188146294"
}

# ── 1. Terraform state bucket for pepla-dev ─────────────────────────────────

resource "aws_s3_bucket" "tfstate" {
  bucket = "pepla-tfstate-dev-${var.dev_account_id}"
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "tfstate_tls_only" {
  bucket = aws_s3_bucket.tfstate.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.tfstate.arn, "${aws_s3_bucket.tfstate.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# ── 2. GitHub OIDC + deploy role ────────────────────────────────────────────

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

# Only jobs that run in the GitHub environment "dev" can use this role.
resource "aws_iam_role" "github_deploy_dev" {
  name                 = "pepla-github-deploy-dev"
  description          = "GitHub Actions (environment dev) deploys Terraform and Lambda code to pepla-dev"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = [
            "${local.repo_short}:environment:dev",
            "${local.repo_immutable}:environment:dev",
          ]
        }
      }
    }]
  })
}

# Broad rights, but only inside pepla-dev, which holds no real data.
resource "aws_iam_role_policy_attachment" "github_deploy_dev_admin" {
  role       = aws_iam_role.github_deploy_dev.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# Guard rails: CI can't create long-lived keys or users, touch billing or the
# org, leave af-south-1 (except global services), or change this bootstrap.
resource "aws_iam_role_policy" "github_deploy_dev_guardrails" {
  name = "guardrails"
  role = aws_iam_role.github_deploy_dev.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "NoLongLivedCredentials"
        Effect = "Deny"
        Action = [
          "iam:CreateUser", "iam:CreateAccessKey", "iam:CreateLoginProfile",
          "iam:UpdateLoginProfile", "iam:CreateServiceSpecificCredential",
        ]
        Resource = "*"
      },
      {
        Sid      = "NoAccountOrBilling"
        Effect   = "Deny"
        Action   = ["organizations:*", "account:*", "billing:*", "budgets:*", "aws-portal:*"]
        Resource = "*"
      },
      {
        Sid    = "ProtectBootstrap"
        Effect = "Deny"
        Action = ["iam:*"]
        Resource = [
          aws_iam_role.github_deploy_dev.arn,
          aws_iam_openid_connect_provider.github.arn,
          "arn:aws:iam::${var.dev_account_id}:role/OrganizationAccountAccessRole",
        ]
      },
      {
        Sid      = "ProtectStateBucketConfig"
        Effect   = "Deny"
        Action   = ["s3:DeleteBucket", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:PutBucketVersioning"]
        Resource = aws_s3_bucket.tfstate.arn
      },
      {
        # AI cost guardrail: CI is a robot, and robots never call paid AI.
        Sid      = "NoPaidAI"
        Effect   = "Deny"
        Action   = ["bedrock:Invoke*", "bedrock:StartAsyncInvoke", "bedrock:CreateModelInvocationJob", "textract:*"]
        Resource = "*"
      },
      {
        # Lambda direct-invoke of the AI functions from CI would bypass the robot check.
        Sid    = "NoInvokingAiLambdas"
        Effect = "Deny"
        Action = ["lambda:InvokeFunction", "lambda:InvokeFunctionUrl"]
        Resource = [for f in ["talentFlowAiChat", "nalekoAiChat", "classifyOnboardingRisk",
          "summariseVerification", "getBatchRiskReport", "processDocumentOCR"] :
        "arn:aws:lambda:af-south-1:${var.dev_account_id}:function:${f}*"]
      },
      {
        Sid    = "CapeTownOnly"
        Effect = "Deny"
        NotAction = [
          "iam:*", "sts:*", "cloudfront:*", "route53:*", "support:*",
          "bedrock:*", "ce:*", "health:*", "trustedadvisor:*",
        ]
        Resource  = "*"
        Condition = { StringNotEquals = { "aws:RequestedRegion" = "af-south-1" } }
      },
    ]
  })
}

# ── 3. Budget ───────────────────────────────────────────────────────────────

resource "aws_budgets_budget" "monthly" {
  name         = "pepla-dev-monthly"
  budget_type  = "COST"
  limit_amount = var.monthly_budget_usd
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_alert_email]
  }
}

# ── 4. Seed parameters read at plan time ────────────────────────────────────

# Postmark's documented test token: accepted by the API, sends nothing.
# Dev never emails real people.
resource "aws_ssm_parameter" "postmark_token" {
  name  = "/naleko/postmark/api_token"
  type  = "SecureString"
  value = "POSTMARK_API_TEST"
}

output "deploy_role_arn" {
  value = aws_iam_role.github_deploy_dev.arn
}

output "state_bucket" {
  value = aws_s3_bucket.tfstate.bucket
}
