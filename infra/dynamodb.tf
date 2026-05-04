# ---------------------------------------------------------------------------
# DynamoDB Tables
# NH-10: SSE with KMS CMK alias/naleko-onboarding-pii on all tables
# NH-11: PII envelope encryption — id_number_encrypted + id_number_last4
#        columns written by createEmployee and processDocumentOCR Lambdas
# NH-13: external-verification-requests table added
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "employees" {
  name         = "employees"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "employee_id"
  table_class  = "STANDARD"

  attribute {
    name = "employee_id"
    type = "S"
  }

  server_side_encryption {
    enabled           = true
    kms_key_arn = module.kms_pii.key_arn
  }

  point_in_time_recovery {
    enabled = false
  }

  ttl {
    enabled        = false
    attribute_name = ""
  }
}

resource "aws_dynamodb_table" "documents" {
  name         = "documents"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "employee_id"
  range_key    = "document_id"
  table_class  = "STANDARD"

  attribute {
    name = "employee_id"
    type = "S"
  }

  attribute {
    name = "document_id"
    type = "S"
  }

  server_side_encryption {
    enabled           = true
    kms_key_arn = module.kms_pii.key_arn
  }

  point_in_time_recovery {
    enabled = false
  }

  ttl {
    enabled        = false
    attribute_name = ""
  }
}

resource "aws_dynamodb_table" "document_verification" {
  name         = "document-verification"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "verificationId"
  table_class  = "STANDARD"

  attribute {
    name = "verificationId"
    type = "S"
  }

  server_side_encryption {
    enabled           = true
    kms_key_arn = module.kms_pii.key_arn
  }

  point_in_time_recovery {
    enabled = false
  }

  ttl {
    enabled        = false
    attribute_name = ""
  }
}

# NH-13: audit table for external verification requests
resource "aws_dynamodb_table" "external_verification_requests" {
  name         = "external-verification-requests"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "request_id"
  table_class  = "STANDARD"

  attribute {
    name = "request_id"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = module.kms_pii.key_arn
  }

  point_in_time_recovery {
    enabled = false
  }

  ttl {
    enabled        = false
    attribute_name = ""
  }
}

# ---------------------------------------------------------------------------
# NH-27: onboarding-events — immutable audit log
# All EventBridge events from naleko-onboarding bus land here.
# Immutability enforced at IAM level: auditLogConsumer only has PutItem.
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "onboarding_events" {
  name         = "onboarding-events"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "eventId"
  range_key    = "timestamp"
  table_class  = "STANDARD"

  attribute {
    name = "eventId"
    type = "S"
  }

  attribute {
    name = "timestamp"
    type = "S"
  }

  attribute {
    name = "employeeId"
    type = "S"
  }

  # GSI: look up all audit events for a specific employee
  global_secondary_index {
    name            = "employeeId-timestamp-index"
    hash_key        = "employeeId"
    range_key       = "timestamp"
    projection_type = "ALL"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = module.kms_pii.key_arn
  }

  point_in_time_recovery {
    enabled = true
  }

  # NO TTL — audit records must be retained 7 years under POPIA
  ttl {
    enabled        = false
    attribute_name = ""
  }

  tags = {
    DataClassification = "AUDIT"
    RetentionYears     = "7"
  }
}
