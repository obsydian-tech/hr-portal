# ---------------------------------------------------------------------------
# TalentFlow — GitHub Actions OIDC Provider + Deploy Role (NH-115 / TF-012)
#
# Enables GitHub Actions to authenticate to AWS without long-lived access keys.
# The GitHub OIDC provider is an account-level singleton — if Naleko already
# created it, Terraform will adopt it via import (or use a data source).
#
# Resources:
#   1. aws_iam_openid_connect_provider — registers GitHub's OIDC IdP
#   2. aws_iam_role.talent_flow_github_deploy — assumed by the deploy job
#   3. aws_iam_role_policy.talent_flow_github_deploy — least-privilege deploy perms
#
# Trust policy constrains the role to:
#   - repo: obsydian-tech/hr-portal
#   - ref: refs/heads/main (deploy job only runs on main)
#
# Permissions granted:
#   - Full Terraform apply scope: all talent-flow-* resources
#   - Scoped to af-south-1 + account 937137806477 where possible
#   - S3 + DynamoDB for Terraform remote state
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 1. GitHub OIDC Provider (account-level singleton)
#    thumbprint_list: current GitHub OIDC thumbprint (stable, SHA-1 of root CA)
# ---------------------------------------------------------------------------

resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  # GitHub's OIDC root CA thumbprint — stable across all GitHub-hosted runners
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = merge(local.tf_tags, { Ticket = "NH-115", Purpose = "GitHubActionsOIDC" })
}

# ---------------------------------------------------------------------------
# 2. IAM Role — assumed by the GitHub Actions deploy job
# ---------------------------------------------------------------------------

resource "aws_iam_role" "talent_flow_github_deploy" {
  name        = "talent-flow-role-github-deploy"
  description = "Assumed by GitHub Actions (main branch only) to apply TalentFlow Terraform"

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
          # Constrain to the hr-portal repo, main branch only
          "token.actions.githubusercontent.com:sub" = "repo:obsydian-tech/hr-portal:ref:refs/heads/main"
        }
      }
    }]
  })

  tags = merge(local.tf_tags, { Ticket = "NH-115", Purpose = "GitHubActionsDeployRole" })
}

# ---------------------------------------------------------------------------
# 3. Inline policy — least-privilege Terraform apply perms
#    Covers all AWS service types used across TF-001..TF-012.
#    Scoped to talent-flow-* resources wherever the ARN pattern allows.
# ---------------------------------------------------------------------------

resource "aws_iam_role_policy" "talent_flow_github_deploy" {
  name = "talent-flow-github-deploy-policy"
  role = aws_iam_role.talent_flow_github_deploy.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # Terraform remote state — S3 + DynamoDB lock table
        Sid    = "TerraformState"
        Effect = "Allow"
        Action = [
          "s3:GetObject", "s3:PutObject", "s3:DeleteObject",
          "s3:ListBucket", "s3:GetBucketVersioning",
        ]
        Resource = [
          "arn:aws:s3:::naleko-tfstate-af-south-1",
          "arn:aws:s3:::naleko-tfstate-af-south-1/*",
        ]
      },
      {
        # DynamoDB state lock
        Sid    = "TerraformStateLock"
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource = "arn:aws:dynamodb:af-south-1:937137806477:table/naleko-tfstate-lock"
      },
      {
        # IAM — create/manage talent-flow roles + policies
        Sid    = "IAMTalentFlow"
        Effect = "Allow"
        Action = [
          "iam:CreateRole", "iam:DeleteRole", "iam:UpdateRole",
          "iam:GetRole", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies",
          "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy",
          "iam:AttachRolePolicy", "iam:DetachRolePolicy",
          "iam:PassRole", "iam:TagRole", "iam:UntagRole",
          "iam:CreateOpenIDConnectProvider", "iam:DeleteOpenIDConnectProvider",
          "iam:GetOpenIDConnectProvider", "iam:TagOpenIDConnectProvider",
        ]
        Resource = [
          "arn:aws:iam::937137806477:role/talent-flow-*",
          "arn:aws:iam::937137806477:oidc-provider/token.actions.githubusercontent.com",
        ]
      },
      {
        # KMS — manage talent-flow CMKs
        Sid    = "KMSTalentFlow"
        Effect = "Allow"
        Action = [
          "kms:CreateKey", "kms:DescribeKey", "kms:GetKeyPolicy",
          "kms:GetKeyRotationStatus", "kms:ListResourceTags",
          "kms:PutKeyPolicy", "kms:EnableKeyRotation",
          "kms:CreateAlias", "kms:DeleteAlias", "kms:ListAliases",
          "kms:TagResource", "kms:ScheduleKeyDeletion",
          "kms:Decrypt", "kms:GenerateDataKey",
        ]
        Resource = "*"
        Condition = {
          StringEquals = { "aws:RequestedRegion" = "af-south-1" }
        }
      },
      {
        # DynamoDB — manage talent-flow tables
        Sid    = "DynamoDBTalentFlow"
        Effect = "Allow"
        Action = [
          "dynamodb:CreateTable", "dynamodb:DeleteTable", "dynamodb:DescribeTable",
          "dynamodb:UpdateTable", "dynamodb:ListTagsOfResource",
          "dynamodb:TagResource", "dynamodb:UntagResource",
          "dynamodb:DescribeTimeToLive", "dynamodb:UpdateTimeToLive",
          "dynamodb:DescribeContinuousBackups", "dynamodb:UpdateContinuousBackups",
          "dynamodb:DescribeStream", "dynamodb:ListStreams",
        ]
        Resource = "arn:aws:dynamodb:af-south-1:937137806477:table/talent-flow-*"
      },
      {
        # Lambda — manage talent-flow functions + permissions + ESMs
        Sid    = "LambdaTalentFlow"
        Effect = "Allow"
        Action = [
          "lambda:CreateFunction", "lambda:DeleteFunction", "lambda:GetFunction",
          "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
          "lambda:AddPermission", "lambda:RemovePermission", "lambda:GetPolicy",
          "lambda:ListVersionsByFunction", "lambda:PublishVersion",
          "lambda:CreateEventSourceMapping", "lambda:DeleteEventSourceMapping",
          "lambda:GetEventSourceMapping", "lambda:UpdateEventSourceMapping",
          "lambda:TagResource", "lambda:UntagResource", "lambda:ListTags",
          "lambda:PutFunctionEventInvokeConfig",
        ]
        Resource = [
          "arn:aws:lambda:af-south-1:937137806477:function:talentFlow*",
          "arn:aws:lambda:af-south-1:937137806477:function:createCandidate",
          "arn:aws:lambda:af-south-1:937137806477:function:orchestrateTalentFlowWorkflow",
          "arn:aws:lambda:af-south-1:937137806477:function:scheduleInterview",
          "arn:aws:lambda:af-south-1:937137806477:function:submitVote",
          "arn:aws:lambda:af-south-1:937137806477:function:completeEvaluation",
          "arn:aws:lambda:af-south-1:937137806477:function:manageTalentFlowConfig",
          "arn:aws:lambda:af-south-1:937137806477:function:sendTalentFlowNotification",
          "arn:aws:lambda:af-south-1:937137806477:function:monitorTalentFlowSLAs",
        ]
      },
      {
        # Lambda ESM — event:* scoped separately (no resource-level condition on ESMs)
        Sid      = "LambdaESM"
        Effect   = "Allow"
        Action   = ["lambda:CreateEventSourceMapping", "lambda:DeleteEventSourceMapping", "lambda:GetEventSourceMapping", "lambda:UpdateEventSourceMapping", "lambda:ListEventSourceMappings"]
        Resource = "*"
      },
      {
        # SQS — manage talent-flow queues
        Sid    = "SQSTalentFlow"
        Effect = "Allow"
        Action = [
          "sqs:CreateQueue", "sqs:DeleteQueue", "sqs:GetQueueAttributes",
          "sqs:SetQueueAttributes", "sqs:TagQueue", "sqs:ListQueueTags",
          "sqs:GetQueueUrl",
        ]
        Resource = "arn:aws:sqs:af-south-1:937137806477:talent-flow-*"
      },
      {
        # S3 — manage talent-flow audit archive bucket
        Sid    = "S3TalentFlow"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket", "s3:DeleteBucket", "s3:GetBucketPolicy",
          "s3:PutBucketPolicy", "s3:GetBucketVersioning", "s3:PutBucketVersioning",
          "s3:GetBucketEncryption", "s3:PutBucketEncryption",
          "s3:GetLifecycleConfiguration", "s3:PutLifecycleConfiguration",
          "s3:GetBucketPublicAccessBlock", "s3:PutBucketPublicAccessBlock",
          "s3:GetBucketTagging", "s3:PutBucketTagging",
          "s3:GetObjectLockConfiguration", "s3:PutObjectLockConfiguration",
          "s3:GetBucketLogging", "s3:PutBucketLogging",
        ]
        Resource = "arn:aws:s3:::talent-flow-*"
      },
      {
        # API Gateway v2 + v1
        Sid    = "APIGatewayTalentFlow"
        Effect = "Allow"
        Action = ["apigateway:*"]
        Resource = [
          "arn:aws:apigateway:af-south-1::/apis/*/routes/*",
          "arn:aws:apigateway:af-south-1::/apis/*/integrations/*",
          "arn:aws:apigateway:af-south-1::/apis/*/authorizers/*",
          "arn:aws:apigateway:af-south-1::/apis/*/stages/*",
          "arn:aws:apigateway:af-south-1::/apis/*",
          "arn:aws:apigateway:af-south-1::/restapis/*",
          "arn:aws:apigateway:af-south-1::/account",
        ]
      },
      {
        # Cognito — manage talent-flow user pool
        Sid    = "CognitoTalentFlow"
        Effect = "Allow"
        Action = [
          "cognito-idp:CreateUserPool", "cognito-idp:DeleteUserPool",
          "cognito-idp:DescribeUserPool", "cognito-idp:UpdateUserPool",
          "cognito-idp:CreateUserPoolClient", "cognito-idp:DeleteUserPoolClient",
          "cognito-idp:DescribeUserPoolClient", "cognito-idp:UpdateUserPoolClient",
          "cognito-idp:CreateGroup", "cognito-idp:DeleteGroup", "cognito-idp:GetGroup",
          "cognito-idp:TagResource", "cognito-idp:UntagResource", "cognito-idp:ListTagsForResource",
        ]
        Resource = "arn:aws:cognito-idp:af-south-1:937137806477:userpool/*"
      },
      {
        # EventBridge — manage talent-flow rules + schedules
        Sid    = "EventBridgeTalentFlow"
        Effect = "Allow"
        Action = [
          "events:PutRule", "events:DeleteRule", "events:DescribeRule",
          "events:PutTargets", "events:RemoveTargets", "events:ListTargetsByRule",
          "events:TagResource", "events:UntagResource", "events:ListTagsForResource",
          "events:CreateEventBus", "events:DeleteEventBus", "events:DescribeEventBus",
        ]
        Resource = [
          "arn:aws:events:af-south-1:937137806477:rule/*talent-flow*",
          "arn:aws:events:af-south-1:937137806477:event-bus/talent-flow-*",
        ]
      },
      {
        # Step Functions — manage talent-flow state machine
        Sid    = "SFNTalentFlow"
        Effect = "Allow"
        Action = [
          "states:CreateStateMachine", "states:DeleteStateMachine",
          "states:DescribeStateMachine", "states:UpdateStateMachine",
          "states:TagResource", "states:UntagResource", "states:ListTagsForResource",
          "states:CreateActivity", "states:DeleteActivity",
        ]
        Resource = "arn:aws:states:af-south-1:937137806477:stateMachine:talent-flow-*"
      },
      {
        # Secrets Manager — manage talent-flow secrets
        Sid    = "SecretsTalentFlow"
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret", "secretsmanager:DeleteSecret",
          "secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue", "secretsmanager:TagResource",
          "secretsmanager:RestoreSecret",
        ]
        Resource = "arn:aws:secretsmanager:af-south-1:937137806477:secret:talent-flow/*"
      },
      {
        # CloudWatch Logs — manage talent-flow log groups
        Sid    = "LogsTalentFlow"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup", "logs:DeleteLogGroup",
          "logs:DescribeLogGroups", "logs:ListTagsForResource",
          "logs:TagResource", "logs:UntagResource",
          "logs:PutRetentionPolicy", "logs:AssociateKmsKey", "logs:DisassociateKmsKey",
          "logs:CreateLogDelivery", "logs:DeleteLogDelivery",
          "logs:DescribeResourcePolicies", "logs:PutResourcePolicy",
          "logs:GetLogDelivery", "logs:UpdateLogDelivery", "logs:ListLogDeliveries",
        ]
        Resource = [
          "arn:aws:logs:af-south-1:937137806477:log-group:/aws/lambda/talent-flow*",
          "arn:aws:logs:af-south-1:937137806477:log-group:/aws/lambda/createCandidate*",
          "arn:aws:logs:af-south-1:937137806477:log-group:/aws/lambda/orchestrateTalentFlowWorkflow*",
          "arn:aws:logs:af-south-1:937137806477:log-group:/aws/lambda/scheduleInterview*",
          "arn:aws:logs:af-south-1:937137806477:log-group:/aws/lambda/submitVote*",
          "arn:aws:logs:af-south-1:937137806477:log-group:/aws/lambda/completeEvaluation*",
          "arn:aws:logs:af-south-1:937137806477:log-group:/aws/lambda/manageTalentFlowConfig*",
          "arn:aws:logs:af-south-1:937137806477:log-group:/aws/lambda/sendTalentFlowNotification*",
          "arn:aws:logs:af-south-1:937137806477:log-group:/aws/lambda/monitorTalentFlowSLAs*",
          "arn:aws:logs:af-south-1:937137806477:log-group:/aws/apigateway/talent-flow*",
          "arn:aws:logs:af-south-1:937137806477:log-group:/aws/states/talent-flow*",
          "arn:aws:logs:af-south-1:937137806477:log-group:*",
        ]
      },
    ]
  })
}
