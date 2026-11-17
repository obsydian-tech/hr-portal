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

resource "aws_dynamodb_table_item" "founding_tenant" {
  table_name = aws_dynamodb_table.tenants.name
  hash_key   = aws_dynamodb_table.tenants.hash_key
  range_key  = aws_dynamodb_table.tenants.range_key

  item = jsonencode({
    pk         = { S = "TENANT#${var.founding_tenant_id}" }
    sk         = { S = "PROFILE" }
    tenant_id  = { S = var.founding_tenant_id }
    name       = { S = "Founding client" }
    status     = { S = "ACTIVE" }
    country    = { S = "ZA" }
    founding   = { BOOL = true }
    created_at = { S = "2026-11-16T00:00:00Z" }
  })

  lifecycle {
    ignore_changes = [item]
  }
}
