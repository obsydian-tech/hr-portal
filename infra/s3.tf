# ---------------------------------------------------------------------------
# S3 Bucket — NH-11 Terraform import
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "document_uploads" {
  bucket = "document-ocr-verification-uploads"

  tags = {
    Environment = "dev"
    Project     = "document-ocr-verification"
  }
}

resource "aws_s3_bucket_public_access_block" "document_uploads" {
  bucket = aws_s3_bucket.document_uploads.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

# NH-10: S3 default SSE — all new objects encrypted with the PII CMK
resource "aws_s3_bucket_server_side_encryption_configuration" "document_uploads" {
  bucket = aws_s3_bucket.document_uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = module.kms_pii.key_arn
    }
    bucket_key_enabled = true # reduces KMS API calls/cost
  }
}
