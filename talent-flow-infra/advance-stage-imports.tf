# ---------------------------------------------------------------------------
# Prod-only imports for the advanceCandidateStage route and API permission.
#
# Both were created by hand in prod (route 0y9pxoi on API 57l0w7kk9h), so
# Terraform kept planning them as creates and the 2026-11-11 apply failed with
# 409 "already exists". These blocks adopt them into state. In dev they were
# created by Terraform, so the for_each is empty there.
#
# After import, the route is repointed from the hand-made integration t1ug192
# to the Terraform one (same Lambda, same payload format 2.0, so no behaviour
# change). t1ug192 can then be deleted by hand.
#
# Safe to delete this file once the prod apply has run.
# ---------------------------------------------------------------------------

import {
  for_each = var.environment == "prod" ? toset(["prod"]) : toset([])
  to       = aws_apigatewayv2_route.advance_candidate_stage
  id       = "57l0w7kk9h/0y9pxoi"
}

import {
  for_each = var.environment == "prod" ? toset(["prod"]) : toset([])
  to       = aws_lambda_permission.advance_candidate_stage_api
  id       = "advanceCandidateStage/AllowTalentFlowAPIInvokeAdvanceCandidateStage"
}
