# ---------------------------------------------------------------------------
# TalentFlow - S3 Audit Archive (NH-108 / TF-005)
#
# POPIA 5-year audit archive for the talent-flow-agent-audit DynamoDB stream.
# The talentFlowArchiveAuditLog Lambda reads the stream and writes JSONL
# batches to this bucket under year=YYYY/month=MM/day=DD/ prefixes.
#
# Pattern mirrors naleko infra/s3.tf (audit_archive bucket, NH-77):
#   - SSE-KMS with talent_flow_agent_audit CMK
#   - Versioning enabled
#   - Lifecycle: 90d Standard → Glacier, objects expire at 1825d (5yr)
#   - No Object Lock (matched Naleko pattern; policy-only retention)
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "talent_flow_audit_archive" {
  bucket = local.tf_bucket_audit_archive # talent-flow-audit-archive-937137806477

  tags = merge(local.tf_tags, {
    Purpose            = "audit-archive"
    DataClassification = "AUDIT"
    RetentionYears     = "5"
    Ticket             = "NH-108"
  })
}

resource "aws_s3_bucket_public_access_block" "talent_flow_audit_archive" {
  bucket = aws_s3_bucket.talent_flow_audit_archive.id

  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "talent_flow_audit_archive" {
  bucket = aws_s3_bucket.talent_flow_audit_archive.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "talent_flow_audit_archive" {
  bucket = aws_s3_bucket.talent_flow_audit_archive.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.talent_flow_agent_audit.arn
    }
    bucket_key_enabled = true # reduces KMS API calls/cost
  }
}

# POPIA 5-year retention:
#   - Transition to Glacier after 90 days to reduce cost
#   - Expire (permanently delete) at day 1825 (5 years)
resource "aws_s3_bucket_lifecycle_configuration" "talent_flow_audit_archive" {
  bucket = aws_s3_bucket.talent_flow_audit_archive.id

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
