# ---------------------------------------------------------------------------
# DynamoDB Tables — NH-11 Terraform import
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

  point_in_time_recovery {
    enabled = false
  }

  ttl {
    enabled        = false
    attribute_name = ""
  }
}
