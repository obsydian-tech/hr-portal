# ---------------------------------------------------------------------------
# GitHub Actions prod Lambda CODE deploy role
#
# Assumed by the deploy-prod job of .github/workflows/deploy-lambdas.yml,
# which runs in the GitHub "production" environment (Iggie is the required
# reviewer, main branch only). It promotes the same zips already deployed
# and tested in pepla-dev.
#
# Can:    list functions, read a function, replace its code.
# Cannot: change configuration (env vars, role, memory), create or delete
#         functions, or touch any other service. Terraform owns all of that.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "github_code_deploy" {
  count = var.manage_github_ci_roles ? 1 : 0

  name                 = "pepla-github-deploy-code-prod"
  description          = "Assumed by GitHub Actions in environment production to update Lambda code only"
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
          # Both subject formats, production environment only (see
          # github-plan-role.tf). The GitHub environment is named "Production"
          # and IAM matching is case-sensitive, so both spellings are listed.
          # Remove the unmatched entries after the first run.
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
  count = var.manage_github_ci_roles ? 1 : 0

  name = "pepla-github-deploy-code-prod"
  role = aws_iam_role.github_code_deploy[0].id

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
        Resource = "arn:aws:lambda:af-south-1:${var.aws_account_id}:function:*"
      },
    ]
  })
}
