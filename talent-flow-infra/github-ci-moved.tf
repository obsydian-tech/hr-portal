# The GitHub OIDC provider and the CI roles live only in the prod account.
# In other accounts (pepla-dev) they come from bootstrap/dev instead, so they are
# switched off with var.manage_github_ci_roles. These moved blocks keep prod's
# existing resources in place (no destroy/create) after adding count.

moved {
  from = aws_iam_openid_connect_provider.github
  to   = aws_iam_openid_connect_provider.github[0]
}

moved {
  from = aws_iam_role.talent_flow_github_deploy
  to   = aws_iam_role.talent_flow_github_deploy[0]
}

moved {
  from = aws_iam_role_policy.talent_flow_github_deploy
  to   = aws_iam_role_policy.talent_flow_github_deploy[0]
}

moved {
  from = aws_iam_role.github_plan_readonly
  to   = aws_iam_role.github_plan_readonly[0]
}

moved {
  from = aws_iam_role_policy_attachment.github_plan_readonly_managed
  to   = aws_iam_role_policy_attachment.github_plan_readonly_managed[0]
}

moved {
  from = aws_iam_role_policy.github_plan_readonly
  to   = aws_iam_role_policy.github_plan_readonly[0]
}
