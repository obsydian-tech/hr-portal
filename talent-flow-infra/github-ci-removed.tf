# ---------------------------------------------------------------------------
# The GitHub OIDC provider and the CI roles moved to bootstrap/prod (OPS-05).
#
# The apply role must never manage the roles that guard it, so they live in a
# root that only Iggie applies (by hand, in AWS CloudShell). These blocks let
# this stack forget them without deleting anything: bootstrap/prod imports
# the same resources.
#
# The old role talent-flow-role-github-deploy is not listed here: it was
# unused, trusted any push to main with no approval, and is deleted by the
# first release after OPS-05 (Iggie approves the delete in production-destroy).
# ---------------------------------------------------------------------------

removed {
  from = aws_iam_openid_connect_provider.github
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_iam_role.github_plan_readonly
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_iam_role_policy.github_plan_readonly
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_iam_role_policy_attachment.github_plan_readonly_managed
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_iam_role.github_code_deploy
  lifecycle {
    destroy = false
  }
}

removed {
  from = aws_iam_role_policy.github_code_deploy
  lifecycle {
    destroy = false
  }
}
