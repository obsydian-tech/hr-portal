# ---------------------------------------------------------------------------
# NH-77 — Glue Crawler + Athena Workgroup for audit archive query access
#
# The Glue crawler runs weekly over the S3 audit archive bucket, inferring
# schema from the gzipped JSONL partitions and populating naleko_audit_db.
# Athena exposes the table for ad-hoc POPIA compliance queries.
#
# Scan limit: 100 MB per query (cost guard at PoC scale).
# ---------------------------------------------------------------------------

# ─── Glue IAM Role ───────────────────────────────────────────────────────────

resource "aws_iam_role" "glue_audit_crawler" {
  name        = "naleko-glueAuditCrawler-role"
  description = "IAM role for Glue crawler on naleko audit archive (NH-77)"
  path        = "/naleko/"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "glue.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "glue_service" {
  role       = aws_iam_role.glue_audit_crawler.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSGlueServiceRole"
}

resource "aws_iam_role_policy" "glue_audit_crawler_s3" {
  name = "naleko-glueAuditCrawler-s3-policy"
  role = aws_iam_role.glue_audit_crawler.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AuditArchiveRead"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:ListBucket"]
        Resource = [
          aws_s3_bucket.audit_archive.arn,
          "${aws_s3_bucket.audit_archive.arn}/*",
        ]
      },
    ]
  })
}

# ─── Glue Database ───────────────────────────────────────────────────────────

resource "aws_glue_catalog_database" "audit" {
  name        = "naleko_audit_db"
  description = "Schema catalog for Naleko audit archive (NH-77 / POPIA compliance)"
}

# ─── Glue Crawler ────────────────────────────────────────────────────────────

resource "aws_glue_crawler" "audit_archive" {
  name          = "naleko-audit-archive-crawler"
  database_name = aws_glue_catalog_database.audit.name
  role          = aws_iam_role.glue_audit_crawler.arn
  description   = "Weekly crawler: discovers schema from S3 audit JSONL partitions (NH-77)"

  # Schedule: every Sunday at 02:00 UTC (cron syntax)
  schedule = "cron(0 2 ? * SUN *)"

  s3_target {
    path = "s3://${aws_s3_bucket.audit_archive.bucket}"
  }

  schema_change_policy {
    update_behavior = "UPDATE_IN_DATABASE"
    delete_behavior = "LOG"
  }

  configuration = jsonencode({
    Version = 1.0
    CrawlerOutput = {
      Partitions = { AddOrUpdateBehavior = "InheritFromTable" }
    }
    Grouping = {
      TableGroupingPolicy = "CombineCompatibleSchemas"
    }
  })

  tags = {
    Environment = var.environment
    Ticket      = "NH-77"
  }
}

# ─── Athena Workgroup ─────────────────────────────────────────────────────────

resource "aws_athena_workgroup" "audit" {
  name        = "naleko-audit"
  description = "Athena workgroup for POPIA compliance queries on naleko audit archive (NH-77)"

  configuration {
    enforce_workgroup_configuration = true

    result_configuration {
      output_location = "s3://${aws_s3_bucket.audit_archive.bucket}/athena-results/"

      encryption_configuration {
        encryption_option = "SSE_S3"
      }
    }

    bytes_scanned_cutoff_per_query = 104857600 # 100 MB scan limit (cost guard)
  }

  tags = {
    Environment = var.environment
    Ticket      = "NH-77"
  }
}
