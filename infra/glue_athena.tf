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

# ─── Glue Table (partition projection — no crawler run needed) ────────────────
#
# Defines the schema for the agent-audit archive so Athena can query immediately
# without waiting for the weekly crawler. Partition projection auto-resolves
# year/month/day from S3 key paths — no MSCK REPAIR TABLE needed.

resource "aws_glue_catalog_table" "agent_audit_archive" {
  name          = "agent_audit"
  database_name = aws_glue_catalog_database.audit.name
  description   = "AI agent audit trail archived from naleko-agent-audit DynamoDB stream (NH-77)"
  table_type    = "EXTERNAL_TABLE"

  parameters = {
    "EXTERNAL"                  = "TRUE"
    "classification"            = "json"
    "projection.enabled"        = "true"
    "projection.year.type"      = "integer"
    "projection.year.range"     = "2026,2035"
    "projection.year.digits"    = "4"
    "projection.month.type"     = "integer"
    "projection.month.range"    = "1,12"
    "projection.month.digits"   = "2"
    "projection.day.type"       = "integer"
    "projection.day.range"      = "1,31"
    "projection.day.digits"     = "2"
    "storage.location.template" = "s3://${aws_s3_bucket.audit_archive.bucket}/year=$${year}/month=$${month}/day=$${day}"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.audit_archive.bucket}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"
    compressed    = true

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        "ignore.malformed.json" = "TRUE"
        "dots.in.keys"          = "FALSE"
        "case.insensitive"      = "TRUE"
      }
    }

    columns {
      name = "pk"
      type = "string"
    }
    columns {
      name = "sk"
      type = "string"
    }
    columns {
      name = "staffid"
      type = "string"
    }
    columns {
      name = "conversation_id"
      type = "string"
    }
    columns {
      name = "templateid"
      type = "string"
    }
    columns {
      name = "modelid"
      type = "string"
    }
    columns {
      name = "inputtokens"
      type = "bigint"
    }
    columns {
      name = "outputtokens"
      type = "bigint"
    }
    columns {
      name = "latencyms"
      type = "bigint"
    }
    columns {
      name = "status"
      type = "string"
    }
    columns {
      name = "actor_type"
      type = "string"
    }
    columns {
      name = "intentclass"
      type = "string"
    }
    columns {
      name = "cachehit"
      type = "boolean"
    }
    columns {
      name = "responsesummary"
      type = "string"
    }
    columns {
      name = "promptsummary"
      type = "string"
    }
    columns {
      name = "toolcallsmade"
      type = "string"
    }
    columns {
      name = "tool_outputs_raw"
      type = "string"
    }
    columns {
      name = "employees_accessed"
      type = "string"
    }
    columns {
      name = "guardrail_action"
      type = "string"
    }
    columns {
      name = "date"
      type = "string"
    }
    columns {
      name = "bedrock_request_id"
      type = "string"
    }
    columns {
      name = "expiresat"
      type = "bigint"
    }
  }

  partition_keys {
    name = "year"
    type = "string"
  }
  partition_keys {
    name = "month"
    type = "string"
  }
  partition_keys {
    name = "day"
    type = "string"
  }
}
