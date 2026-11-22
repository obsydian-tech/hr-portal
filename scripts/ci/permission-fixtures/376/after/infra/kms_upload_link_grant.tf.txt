# ---------------------------------------------------------------------------
# ONB-06: the createMyUploadLink role may make data keys on the PII key, for the
# upload bucket only.
#
# The bucket encrypts every new object with the PII key, and a signed PUT runs as
# the role that signed it, so that role needs GenerateDataKey. The role's own
# policy and the key policy lists are locked (ONB-06 AC-10, BE-18 AC-1), so the
# right is a KMS grant: it names this one role, one operation (GenerateDataKey), and only calls
# whose encryption context is this bucket (S3 sets aws:s3:arn to the bucket ARN
# when the bucket uses a Bucket Key). It adds nothing to the key policy.
#
# Terraform keeps it: removing this block revokes it.
# ---------------------------------------------------------------------------
resource "aws_kms_grant" "create_my_upload_link_s3_put" {
  name              = "onb06-createMyUploadLink-s3-put"
  key_id            = module.kms_pii.key_id
  grantee_principal = aws_iam_role.create_my_upload_link.arn
  operations        = ["GenerateDataKey"]

  constraints {
    encryption_context_subset = {
      "aws:s3:arn" = "arn:aws:s3:::${local.document_uploads_bucket}"
    }
  }
}
