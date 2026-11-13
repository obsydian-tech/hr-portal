# ---------------------------------------------------------------------------
# Imports for the Naleko sign-in groups (BE-16).
#
# hr_staff and employee already exist in both accounts: prod got them from
# scripts/create-cognito.sh, pepla-dev from the old seed. e2e-robots exists in
# pepla-dev only. These blocks adopt them into state, so a plain create does
# not fail with "already exists". Prod adopts with no change at all.
#
# Safe to delete this file once the pepla-dev and prod applies have run.
# ---------------------------------------------------------------------------

import {
  to = aws_cognito_user_group.hr_staff
  id = "${aws_cognito_user_pool.naleko_dev.id}/hr_staff"
}

import {
  to = aws_cognito_user_group.employee
  id = "${aws_cognito_user_pool.naleko_dev.id}/employee"
}

import {
  for_each = var.environment == "prod" ? toset([]) : toset(["dev"])
  to       = aws_cognito_user_group.e2e_robots[0]
  id       = "${aws_cognito_user_pool.naleko_dev.id}/e2e-robots"
}
