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
