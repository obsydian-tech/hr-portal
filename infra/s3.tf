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
