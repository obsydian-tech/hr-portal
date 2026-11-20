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

  deletion_window_in_days = 30
}
