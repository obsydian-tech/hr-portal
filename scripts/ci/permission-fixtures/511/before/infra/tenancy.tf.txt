# TEN-01: the company list. Company rows (TENANT#<id> / PROFILE) and member rows (USER#<sub> / TENANT#<id>).
resource "aws_dynamodb_table" "tenants" {
  name                        = "naleko-people-${var.environment}-tenants"
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  range_key                   = "sk"
  deletion_protection_enabled = true

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  # TEN-02: the company index (sparse: rows written before TEN-02 join it once the backfill stamps them).
  attribute {
    name = "tenant_id"
    type = "S"
  }

  global_secondary_index {
    name            = "tenant-index"
    hash_key        = "tenant_id"
    range_key       = "pk"
    projection_type = "ALL"
  }

  # TEN-06: pending rows of people who are moving (MIGRATE#<email>) leave after 30 days.
  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = module.kms_pii.key_arn
  }

  lifecycle {
    prevent_destroy = true
  }
}

# The first company's row (TENANT#<id> / PROFILE) is data, not infrastructure. The OPS-05 apply role
# may not read or write table data (DenyRunningOrReadingData), so Terraform does not manage it.
# pepla-dev: scripts/ci/seed-dev.py writes it. prod: the TEN-02 backfill writes it.
