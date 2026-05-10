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

# NH-39: S3 versioning — enables object version recovery (RPO: 30 days)
# Deleted or overwritten documents can be restored from a previous version.
resource "aws_s3_bucket_versioning" "document_uploads" {
  bucket = aws_s3_bucket.document_uploads.id

  versioning_configuration {
    status = "Enabled"
  }
}

# ---------------------------------------------------------------------------
# NH-77 — Audit Archive Bucket  (POPIA 5-year retention)
# PoC: Lambda-to-S3 instead of Kinesis Firehose (~$18/mo). Swap to Firehose
# when volume exceeds 1 GB/month post-client upgrade.
# ---------------------------------------------------------------------------
resource "aws_s3_bucket" "audit_archive" {
  bucket = "naleko-audit-archive-${var.aws_account_id}"

  tags = {
    Environment        = var.environment
    Purpose            = "audit-archive"
    DataClassification = "AUDIT"
    RetentionYears     = "5"
    Ticket             = "NH-77"
  }
}

resource "aws_s3_bucket_public_access_block" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# POPIA 5-year retention: transition to Glacier after 90 days, delete after 1825 days
resource "aws_s3_bucket_lifecycle_configuration" "audit_archive" {
  bucket = aws_s3_bucket.audit_archive.id

  rule {
    id     = "popia-5yr-retention"
    status = "Enabled"

    filter {} # applies to all objects in the bucket
    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = 1825
    }
  }
}
