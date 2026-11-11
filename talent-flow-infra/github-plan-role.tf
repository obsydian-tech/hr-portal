# ---------------------------------------------------------------------------
# GitHub Actions read-only plan role
#
# Assumed by .github/workflows/terraform-plan.yml on pull requests, through
# the GitHub OIDC provider defined in talent-flow-github-oidc.tf.
# It runs `terraform plan` for both roots (infra/ and talent-flow-infra/).
#
# Can:    read AWS configuration (AWS managed ReadOnlyAccess), read both
#         state files and write only their .tflock lock objects, and read
#         the three secret values Terraform reads during plan.
# Cannot: change any resource, or read business data (DynamoDB items,
#         S3 objects outside the state bucket, logs, Cognito users, queues).
#
# The repo is public, so the workflow never prints plan contents: only the
# address and action of each changed resource.
# ---------------------------------------------------------------------------

locals {
  plan_state_bucket = "naleko-tfstate-af-south-1"
  plan_state_keys   = ["naleko/onboarding/terraform.tfstate", "talent-flow/mvp1/terraform.tfstate"]

  # Secret values that Terraform reads at plan time (data sources and
  # secret_version refresh). Plan fails without them.
  plan_readable_secrets = [
    "arn:aws:secretsmanager:af-south-1:${var.aws_account_id}:secret:naleko/agent/api-key-*",
    "arn:aws:secretsmanager:af-south-1:${var.aws_account_id}:secret:talent-flow/agent/api-key-*",
  ]
  plan_readable_params = [
    "arn:aws:ssm:af-south-1:${var.aws_account_id}:parameter/naleko/postmark/api_token",
  ]
}

resource "aws_iam_role" "github_plan_readonly" {
  count = var.manage_github_ci_roles ? 1 : 0

  name                 = "naleko-github-plan-readonly"
  description          = "Assumed by GitHub Actions on hr-portal pull requests to run terraform plan (read-only)"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github[0].arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          # Both subject formats for the same repo, pull_request events only.
          # The obsydian-tech org may issue the immutable form (org and repo
          # IDs). Remove the form that does not match after the first run.
          "token.actions.githubusercontent.com:sub" = [
            "repo:obsydian-tech/hr-portal:pull_request",
            "repo:obsydian-tech@183697107/hr-portal@1188146294:pull_request",
          ]
        }
      }
    }]
  })

  tags = merge(local.tf_tags, { Purpose = "GitHubActionsPlanRole" })
}

resource "aws_iam_role_policy_attachment" "github_plan_readonly_managed" {
  count = var.manage_github_ci_roles ? 1 : 0

  role       = aws_iam_role.github_plan_readonly[0].name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

resource "aws_iam_role_policy" "github_plan_readonly" {
  count = var.manage_github_ci_roles ? 1 : 0

  name = "naleko-github-plan-readonly"
  role = aws_iam_role.github_plan_readonly[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "StateRead"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = [for k in local.plan_state_keys : "arn:aws:s3:::${local.plan_state_bucket}/${k}"]
      },
      {
        Sid      = "StateLockOnly"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:DeleteObject"]
        Resource = [for k in local.plan_state_keys : "arn:aws:s3:::${local.plan_state_bucket}/${k}.tflock"]
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
        NotResource = ["arn:aws:s3:::${local.plan_state_bucket}/*"]
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

output "github_plan_role_arn" {
  description = "Role ARN used by .github/workflows/terraform-plan.yml"
  value       = one(aws_iam_role.github_plan_readonly[*].arn)
}
