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
    # ONB-05: recordConsent writes the encrypted employee_consents table, so it needs data keys.
    aws_iam_role.record_consent.arn,
  ]

  # NH-169: checkEmployeeEmail queries the encrypted employees table. Its role
  # may hold no KMS IAM statement (locked AC-12), so the key policy grants
  # Decrypt/DescribeKey only, and only via DynamoDB.
  dynamodb_read_role_arns = [
    aws_iam_role.check_employee_email.arn,
    aws_iam_role.lookup_invite.arn,
    aws_iam_role.redeem_invite.arn,
    aws_iam_role.get_invite.arn,
    aws_iam_role.resend_invite.arn,
    # ONB-05: both routes read the encrypted employees table (email-index) and employee_consents.
    aws_iam_role.get_my_start.arn,
    aws_iam_role.record_consent.arn,
    aws_iam_role.tenant_pre_token.arn,
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
