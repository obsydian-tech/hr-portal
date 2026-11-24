# ── 6. Look-only login for cloud threads ────────────────────────────────────
#
# Cloud Claude threads have no AWS access, so every look at dev state has to go
# through a Mac thread. This user lets them LOOK at pepla-dev and nothing else.
#
# - Dev account only (the provider above refuses any other account).
# - Add-only: one policy, one user, one attachment. Nothing existing changes.
# - Every allowed action is a List/Describe/Get of settings or logs. No action
#   wildcards. Reads of stored data (table items, files, secrets, parameter
#   values, decrypt, function code) are not granted and are also denied.
# - The same policy is the user's permissions boundary, so attaching a bigger
#   policy to this user later still cannot give it more.
# - No console password and no access key in Terraform (a key here would land in
#   state). Iggie creates the key by hand after apply; see README section 3.
#
# Resource "*" appears only on read actions that AWS does not let you scope to
# a resource (List*/Describe* calls). Regional reads are held to af-south-1.

locals {
  look_only_name = "pepla-cloud-look-dev"
}

data "aws_iam_policy_document" "look_only" {
  statement {
    sid    = "LookRegionalSettingsAndLogs"
    effect = "Allow"
    actions = [
      "lambda:ListFunctions",
      "lambda:GetFunctionConfiguration",
      "lambda:GetFunctionConcurrency",
      "lambda:GetAccountSettings",
      "lambda:ListEventSourceMappings",
      "lambda:ListAliases",
      "lambda:GetPolicy",

      "logs:DescribeLogGroups",
      "logs:DescribeLogStreams",
      "logs:DescribeMetricFilters",
      "logs:FilterLogEvents",
      "logs:GetLogEvents",
      "logs:StartQuery",
      "logs:GetQueryResults",

      "cloudwatch:DescribeAlarms",
      "cloudwatch:GetMetricData",
      "cloudwatch:GetMetricStatistics",
      "cloudwatch:ListMetrics",
      "cloudwatch:ListDashboards",
      "cloudwatch:GetDashboard",

      "dynamodb:ListTables",
      "dynamodb:DescribeTable",
      "dynamodb:DescribeTimeToLive",
      "dynamodb:DescribeContinuousBackups",

      "apigateway:GET",

      "cognito-idp:ListUserPools",
      "cognito-idp:DescribeUserPool",
      "cognito-idp:ListGroups",
      "cognito-idp:ListUsersInGroup",
      "cognito-idp:AdminListGroupsForUser",

      "states:ListStateMachines",
      "states:DescribeStateMachine",
      "states:ListExecutions",

      "events:ListRules",
      "events:DescribeRule",
      "events:ListTargetsByRule",

      "kms:ListKeys",
      "kms:ListAliases",
      "kms:DescribeKey",
      "kms:GetKeyPolicy",
      "kms:ListGrants",

      "sqs:ListQueues",
      "sqs:GetQueueAttributes",

      "ssm:DescribeParameters",
      "secretsmanager:ListSecrets",

      "bedrock:ListGuardrails",
      "bedrock:GetGuardrail",

      "tag:GetResources",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = ["af-south-1"]
    }
  }

  statement {
    sid    = "LookGlobalSettings"
    effect = "Allow"
    actions = [
      "iam:ListRoles",
      "iam:GetRole",
      "iam:ListRolePolicies",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",

      "cloudfront:ListDistributions",
      "cloudfront:GetDistribution",

      "s3:ListAllMyBuckets",
      "s3:GetBucketLocation",
      "s3:GetBucketPolicy",
      "s3:GetBucketVersioning",
      "s3:GetEncryptionConfiguration",
      "s3:GetBucketPublicAccessBlock",
      "s3:GetBucketCORS",

      "ce:GetCostAndUsage",
    ]
    resources = ["*"]
  }

  statement {
    sid     = "LookDevBudget"
    effect  = "Allow"
    actions = ["budgets:ViewBudget"]
    # Name written out (not a reference) so a targeted apply never touches the budget.
    resources = ["arn:aws:budgets::${var.dev_account_id}:budget/pepla-dev-monthly"]
  }

  # Belt and braces: even if a later change grants more, these stay closed.
  statement {
    sid    = "NeverReadStoredDataOrAct"
    effect = "Deny"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:ListBucket",
      "s3:ListBucketVersions",
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:PartiQLSelect",
      "dynamodb:ExportTableToPointInTime",
      "secretsmanager:GetSecretValue",
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
      "ssm:GetParameterHistory",
      "kms:Decrypt",
      "kms:ReEncryptFrom",
      "kms:GenerateDataKey",
      "kms:GenerateDataKeyWithoutPlaintext",
      "lambda:GetFunction",
      "lambda:InvokeFunction",
      "lambda:InvokeFunctionUrl",
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:ApplyGuardrail",
      "cognito-idp:DescribeUserPoolClient",
      "cognito-idp:AdminGetUser",
      "cognito-idp:ListUsers",
      "states:DescribeExecution",
      "states:GetExecutionHistory",
      "states:StartExecution",
      "iam:CreateAccessKey",
      "iam:CreateLoginProfile",
      "iam:UpdateLoginProfile",
      "iam:AttachUserPolicy",
      "iam:PutUserPolicy",
      "iam:PutUserPermissionsBoundary",
      "iam:DeleteUserPermissionsBoundary",
      "iam:PassRole",
      "sts:AssumeRole",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "look_only" {
  name        = local.look_only_name
  description = "Look-only access to pepla-dev settings and logs for cloud Claude threads. No data reads, no changes."
  policy      = data.aws_iam_policy_document.look_only.json
}

resource "aws_iam_user" "look_only" {
  name                 = local.look_only_name
  path                 = "/look-only/"
  permissions_boundary = aws_iam_policy.look_only.arn
}

resource "aws_iam_user_policy_attachment" "look_only" {
  user       = aws_iam_user.look_only.name
  policy_arn = aws_iam_policy.look_only.arn
}

output "look_only_user" {
  value = aws_iam_user.look_only.name
}
