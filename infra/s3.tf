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
