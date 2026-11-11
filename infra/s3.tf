# ---------------------------------------------------------------------------
# S3 Bucket — NH-11 Terraform import
# ---------------------------------------------------------------------------

# Bucket names are global across AWS, so non-prod accounts get their own name.
# Prod keeps its original name (no change to the live bucket).
locals {
  document_uploads_bucket = var.environment == "prod" ? "document-ocr-verification-uploads" : "pepla-${var.environment}-document-uploads-${var.aws_account_id}"

  # Only non-prod Lambdas get UPLOAD_BUCKET; prod code falls back to the original name.
  upload_bucket_env = var.environment == "prod" ? {} : { UPLOAD_BUCKET = local.document_uploads_bucket }
}

resource "aws_s3_bucket" "document_uploads" {
  bucket = local.document_uploads_bucket

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

# Browser uploads and the OCR trigger. Prod has both, made by hand outside
# Terraform (CORS for localhost:4200 and the Vercel app; 4 identical OCR
# triggers). Until those are imported, Terraform manages them in non-prod only,
# so this changes nothing in prod.
resource "aws_s3_bucket_cors_configuration" "document_uploads" {
  count  = var.environment == "prod" ? 0 : 1
  bucket = aws_s3_bucket.document_uploads.id

  cors_rule {
    allowed_methods = ["GET", "PUT", "POST", "HEAD"]
    allowed_origins = ["http://localhost:4200", "http://127.0.0.1:4200"]
    allowed_headers = ["*"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

resource "aws_lambda_permission" "process_document_ocr_s3" {
  count          = var.environment == "prod" ? 0 : 1
  statement_id   = "AllowS3InvokeOCR"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.process_document_ocr.function_name
  principal      = "s3.amazonaws.com"
  source_arn     = aws_s3_bucket.document_uploads.arn
  source_account = var.aws_account_id
}

# Test uploads reach processDocumentOCR, but the AI cost guardrail
# (lambda/shared/ai-guard.mjs) skips Textract and Bedrock for test employees.
resource "aws_s3_bucket_notification" "document_uploads" {
  count  = var.environment == "prod" ? 0 : 1
  bucket = aws_s3_bucket.document_uploads.id

  lambda_function {
    lambda_function_arn = aws_lambda_function.process_document_ocr.arn
    events              = ["s3:ObjectCreated:Put"]
    filter_prefix       = "uploads/"
  }

  depends_on = [aws_lambda_permission.process_document_ocr_s3]
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
