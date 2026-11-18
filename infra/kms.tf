# ---------------------------------------------------------------------------
# KMS CMK — naleko-onboarding-pii  (NH-10)
# Single customer-managed key for PII at rest across DynamoDB, S3, and
# Lambda envelope encryption (NH-11).
# ---------------------------------------------------------------------------

module "kms_pii" {
  source = "./modules/kms"

  alias_name     = "naleko-onboarding-pii"
  description    = "Naleko HR Portal — CMK for PII at rest (DynamoDB, S3, Lambda envelope encryption)"
  aws_account_id = var.aws_account_id
  aws_region     = var.aws_region

  # All 10 per-Lambda execution roles are granted encrypt/decrypt rights so
  # they can read/write KMS-encrypted DynamoDB items and S3 objects, and
  # perform envelope encryption in NH-11.
  allowed_role_arns = [
    aws_iam_role.create_employee.arn,
    aws_iam_role.get_employees.arn,
    aws_iam_role.upload_document_to_s3.arn,
    aws_iam_role.process_document_ocr.arn,
    aws_iam_role.get_document_verifications.arn,
    aws_iam_role.get_single_document_verification.arn,
    aws_iam_role.get_employee_document_verifications.arn,
    aws_iam_role.review_document_verification.arn,
    aws_iam_role.lookup_employee_email.arn,
    aws_iam_role.get_document_presigned_url.arn,
  ]

  # NH-169: checkEmployeeEmail queries the encrypted employees table. Its role
  # may hold no KMS IAM statement (locked AC-12), so the key policy grants
  # Decrypt/DescribeKey only, and only via DynamoDB.
  dynamodb_read_role_arns = [
    aws_iam_role.check_employee_email.arn,
    # ONB-22: the proposal Lambdas and the two agent reads open the encrypted rows through DynamoDB.
    aws_iam_role.create_proposal.arn,
    aws_iam_role.approve_agent_action.arn,
    aws_iam_role.summarise_verification.arn,
    aws_iam_role.lookup_invite.arn,
    aws_iam_role.redeem_invite.arn,
    aws_iam_role.get_invite.arn,
    aws_iam_role.resend_invite.arn,
    # ONB-05: both routes read the encrypted employees table (email-index) and employee_consents.
    # BE-18: recordConsent also writes employee_consents. DynamoDB does that with the table key, so the
    # role needs no Encrypt or data-key right of its own and is not in allowed_role_arns.
    aws_iam_role.get_my_start.arn,
    aws_iam_role.record_consent.arn,
    # ONB-06: both read the encrypted employees table (email-index).
    aws_iam_role.get_my_documents.arn,
    aws_iam_role.create_my_upload_link.arn,
    aws_iam_role.tenant_pre_token.arn,
    # TEN-06: writes pending rows in the encrypted tenants table.
    aws_iam_role.user_migration.arn,
    # TEN-02: read Member rows in the tenants table.
    aws_iam_role.cognito_post_auth.arn,
    aws_iam_role.get_hr_partners.arn,
    # TEN-03: the TalentFlow pre-token trigger reads Member rows in the tenants table. Its role lives in the
    # talent-flow-infra stack, so it is named by ARN: that stack applies first (the role must exist), then this one.
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow-role-talentFlowPreTokenTrigger",
    # MOD-01: getCompanyModules and every Lambda that asks modules.mjs read the company row in the tenants table.
    # The TalentFlow roles live in talent-flow-infra, named by ARN (their path /talent-flow/ is part of it).
    aws_iam_role.get_company_modules.arn,
    aws_iam_role.get_candidate_events.arn,
    aws_iam_role.get_hiring_managers.arn,
    # Walk fix: queryAuditLog Queries/Scans the onboarding-events table, which this key encrypts (AccessDeniedException in its log).
    aws_iam_role.query_audit_log.arn,
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-getCandidate",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-updateCandidate",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-advanceCandidateStage",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-scheduleInterview",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-submitVote",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-captureSentiment",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-generateScoringLink",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-getOffer",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-createOffer",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-advanceOfferState",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-dismissTile",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-snoozeTile",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-acknowledgeTile",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-getCandidates",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-createCandidate",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-getIntelligenceTiles",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-manageTalentFlowConfig",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-getUserNotifications",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-markNotificationRead",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-getPanelMembers",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-talentFlowApproveAction",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-talentFlowAiChat",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-submitVoteByToken",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-evaluateIntelligenceRules",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-sendTalentFlowNotification",
    "arn:aws:iam::${var.aws_account_id}:role/talent-flow/talent-flow-role-orchestrateTalentFlowWorkflow",
  ]

  # ONB-24: Cognito encrypts reset codes under a grant the deploy role makes (RootFullAdmin covers it).
  # Only the sender may decrypt them, only for this pool. The pool id comes from a lookup by name, not
  # from aws_cognito_user_pool.naleko_dev: the pool needs this key, so that would be a cycle.
  cognito_sender_decrypt_role_arns = [aws_iam_role.cognito_email_sender.arn]
  cognito_pool_id                  = one(data.aws_cognito_user_pools.naleko.ids)

  deletion_window_in_days = 30
}

# ONB-24: the pool's id for the sender's decrypt condition, looked up by name (no link to the resource).
data "aws_cognito_user_pools" "naleko" {
  name = "naleko-dev-user-pool"
}

# ONB-24: fails the plan if the pool is ever renamed without this lookup, so the decrypt condition
# can never point at another pool. (A check block, not a reference in the data source: that would be a cycle.)
check "cognito_lookup_matches_pool" {
  assert {
    condition     = data.aws_cognito_user_pools.naleko.name == aws_cognito_user_pool.naleko_dev.name
    error_message = "The KMS key policy looks up a different user pool name than the pool's own name."
  }
}
