# ---------------------------------------------------------------------------
# Prod account bootstrap (OPS-05): the CI identities, owned in one place.
#
#   1. The GitHub OIDC provider                  (moved from talent-flow-infra)
#   2. naleko-github-plan-readonly               (moved; PR plans, drift check, release plan)
#   3. pepla-github-deploy-code-prod             (moved; Lambda code only)
#   4. pepla-github-tf-apply-prod                (new; Terraform apply after Iggie's Approve)
#
# The apply role must never manage the roles that guard it, so these live in
# their own root that no workflow applies. Changes here are rare and applied
# by hand by Iggie (AWS CloudShell or the Mac). The nightly drift check plans
# this root read-only.
#
# The import blocks adopt what talent-flow-infra created before; once applied
# they are no-ops. talent-flow-infra forgets the same resources with
# removed { destroy = false } blocks, so nothing is deleted or recreated.
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
    key          = "bootstrap/prod/terraform.tfstate"
    region       = "af-south-1"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region              = "af-south-1"
  allowed_account_ids = ["937137806477"]

  # Same default tags as talent-flow-infra, so adopting the resources changes no tags.
  default_tags {
    tags = {
      Project            = "TalentFlow"
      ManagedBy          = "Terraform"
      DataClassification = "Confidential"
      Environment        = "prod"
    }
  }
}

locals {
  account_id   = "937137806477"
  state_bucket = "naleko-tfstate-af-south-1"

  repo_short     = "repo:obsydian-tech/hr-portal"
  repo_immutable = "repo:obsydian-tech@183697107/hr-portal@1188146294"

  tf_tags = {
    Project            = "TalentFlow"
    ManagedBy          = "Terraform"
    DataClassification = "Confidential"
    Environment        = "prod"
    Region             = "af-south-1"
  }

  # State the plan role may read: both stacks, and this root (for the drift check).
  plan_state_keys = [
    "naleko/onboarding/terraform.tfstate",
    "talent-flow/mvp1/terraform.tfstate",
    "bootstrap/prod/terraform.tfstate",
  ]

  # Secret values and parameters Terraform reads at plan time.
  plan_readable_secrets = [
    "arn:aws:secretsmanager:af-south-1:${local.account_id}:secret:naleko/agent/api-key-*",
    "arn:aws:secretsmanager:af-south-1:${local.account_id}:secret:talent-flow/agent/api-key-*",
  ]
  plan_readable_params = [
    "arn:aws:ssm:af-south-1:${local.account_id}:parameter/naleko/postmark/api_token",
  ]
}

# ── Adopt what talent-flow-infra created ────────────────────────────────────

import {
  to = aws_iam_openid_connect_provider.github
  id = "arn:aws:iam::937137806477:oidc-provider/token.actions.githubusercontent.com"
}

import {
  to = aws_iam_role.github_plan_readonly
  id = "naleko-github-plan-readonly"
}

import {
  to = aws_iam_role_policy.github_plan_readonly
  id = "naleko-github-plan-readonly:naleko-github-plan-readonly"
}

import {
  to = aws_iam_role_policy_attachment.github_plan_readonly_managed
  id = "naleko-github-plan-readonly/arn:aws:iam::aws:policy/ReadOnlyAccess"
}

import {
  to = aws_iam_role.github_code_deploy
  id = "pepla-github-deploy-code-prod"
}

import {
  to = aws_iam_role_policy.github_code_deploy
  id = "pepla-github-deploy-code-prod:pepla-github-deploy-code-prod"
}

# ── 1. GitHub OIDC provider ─────────────────────────────────────────────────

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = merge(local.tf_tags, { Ticket = "NH-115", Purpose = "GitHubActionsOIDC" })
}

# ── 2. Read-only plan role ──────────────────────────────────────────────────
#
# PR plans (terraform-plan.yml), the nightly drift check (environment
# drift-check) and the release plan (environment prod-plan, main only).
# Reads configuration and the state files; changes nothing; never reads
# business data (DynamoDB items, S3 objects outside state, logs, users).

resource "aws_iam_role" "github_plan_readonly" {
  name                 = "naleko-github-plan-readonly"
  description          = "Assumed by GitHub Actions on hr-portal pull requests to run terraform plan (read-only)"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = [
            "${local.repo_short}:pull_request",
            "${local.repo_immutable}:pull_request",
            "${local.repo_short}:environment:drift-check",
            "${local.repo_immutable}:environment:drift-check",
            "${local.repo_short}:environment:prod-plan",
            "${local.repo_immutable}:environment:prod-plan",
          ]
        }
      }
    }]
  })

  tags = merge(local.tf_tags, { Purpose = "GitHubActionsPlanRole" })
}

resource "aws_iam_role_policy_attachment" "github_plan_readonly_managed" {
  role       = aws_iam_role.github_plan_readonly.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy" "github_plan_readonly" {
  name = "naleko-github-plan-readonly"
  role = aws_iam_role.github_plan_readonly.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "StateRead"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = [for k in local.plan_state_keys : "arn:aws:s3:::${local.state_bucket}/${k}"]
      },
      {
        Sid      = "StateLockOnly"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject"]
        Resource = [for k in local.plan_state_keys : "arn:aws:s3:::${local.state_bucket}/${k}.tflock"]
      },
      {
        Sid      = "PlanSecrets"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = local.plan_readable_secrets
      },
      {
        Sid      = "PlanParams"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = local.plan_readable_params
      },
      {
        Sid      = "DecryptForPlanSecretsOnly"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = [
              "secretsmanager.af-south-1.amazonaws.com",
              "ssm.af-south-1.amazonaws.com",
            ]
          }
        }
      },
      {
        # Never read business or personal data, whatever ReadOnlyAccess allows.
        Sid    = "DenyDataPlaneReads"
        Effect = "Deny"
        Action = [
          "dynamodb:GetItem", "dynamodb:BatchGetItem", "dynamodb:Query", "dynamodb:Scan",
          "dynamodb:GetRecords", "dynamodb:GetShardIterator", "dynamodb:ExportTableToPointInTime",
          "logs:GetLogEvents", "logs:FilterLogEvents", "logs:StartQuery", "logs:GetQueryResults",
          "logs:StartLiveTail", "logs:GetLogRecord",
          "cognito-idp:ListUsers", "cognito-idp:AdminGetUser", "cognito-idp:ListUsersInGroup",
          "sqs:ReceiveMessage", "kinesis:GetRecords", "kinesis:GetShardIterator",
          "athena:GetQueryResults", "athena:StartQueryExecution",
          "textract:Get*", "states:GetExecutionHistory", "states:DescribeExecution",
          "lambda:InvokeFunction",
        ]
        Resource = "*"
      },
      {
        Sid         = "DenyObjectReadsOutsideState"
        Effect      = "Deny"
        Action      = ["s3:GetObject", "s3:GetObjectVersion"]
        NotResource = ["arn:aws:s3:::${local.state_bucket}/*"]
      },
      {
        Sid         = "DenyOtherSecrets"
        Effect      = "Deny"
        Action      = ["secretsmanager:GetSecretValue"]
        NotResource = local.plan_readable_secrets
      },
      {
        Sid         = "DenyOtherParams"
        Effect      = "Deny"
        Action      = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "ssm:GetParameterHistory"]
        NotResource = local.plan_readable_params
      },
    ]
  })
}

# ── 3. Lambda code deploy role ──────────────────────────────────────────────
#
# Used only by the release job (environment Production, main only, Iggie
# approves), after Terraform has applied. Replaces function code; cannot
# change configuration or touch any other service.

resource "aws_iam_role" "github_code_deploy" {
  name                 = "pepla-github-deploy-code-prod"
  description          = "Assumed by GitHub Actions in environment production to update Lambda code only"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          # The GitHub environment is "Production"; IAM matching is
          # case-sensitive, so both spellings are listed.
          "token.actions.githubusercontent.com:sub" = [
            "repo:obsydian-tech/hr-portal:environment:Production",
            "repo:obsydian-tech/hr-portal:environment:production",
            "repo:obsydian-tech@183697107/hr-portal@1188146294:environment:Production",
            "repo:obsydian-tech@183697107/hr-portal@1188146294:environment:production",
          ]
        }
      }
    }]
  })

  tags = merge(local.tf_tags, { Purpose = "GitHubActionsLambdaCodeDeploy" })
}

resource "aws_iam_role_policy" "github_code_deploy" {
  name = "pepla-github-deploy-code-prod"
  role = aws_iam_role.github_code_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ListFunctions"
        Effect   = "Allow"
        Action   = "lambda:ListFunctions"
        Resource = "*"
      },
      {
        Sid    = "UpdateCodeOnly"
        Effect = "Allow"
        Action = [
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
          "lambda:UpdateFunctionCode",
        ]
        Resource = "arn:aws:lambda:af-south-1:${local.account_id}:function:*"
      },
    ]
  })
}

# ── 4. Terraform apply role ─────────────────────────────────────────────────
#
# Used only by the release job in GitHub environment Production (main only,
# Iggie approves on his phone). Rights come from the shared policy module,
# the same one pepla-github-tf-apply-dev uses in pepla-dev.

resource "aws_iam_role" "tf_apply" {
  name                 = "pepla-github-tf-apply-prod"
  description          = "GitHub Actions (environment Production, after Approve) applies Terraform to prod"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = [
            "${local.repo_short}:environment:Production",
            "${local.repo_short}:environment:production",
            "${local.repo_immutable}:environment:Production",
            "${local.repo_immutable}:environment:production",
          ]
        }
      }
    }]
  })

  tags = merge(local.tf_tags, { Purpose = "GitHubActionsTerraformApply" })
}

module "tf_apply_policy" {
  source = "../modules/tf-apply-policy"

  name         = "pepla-github-tf-apply-prod"
  account_id   = local.account_id
  state_bucket = local.state_bucket
}

resource "aws_iam_role_policy_attachment" "tf_apply" {
  count = module.tf_apply_policy.part_count

  role       = aws_iam_role.tf_apply.name
  policy_arn = module.tf_apply_policy.policy_arns[count.index]
}

output "plan_role_arn" {
  value = aws_iam_role.github_plan_readonly.arn
}

output "code_deploy_role_arn" {
  value = aws_iam_role.github_code_deploy.arn
}

output "tf_apply_role_arn" {
  value = aws_iam_role.tf_apply.arn
}
