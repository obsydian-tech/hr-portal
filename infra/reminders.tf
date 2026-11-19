# ONB-21 the daily reminder email. A new table for the claims, a function, its own role, and a
# schedule on the default bus. Prod stays off until go-live: the rule's state comes from var.document_reminders_enabled.

resource "aws_dynamodb_table" "reminders" {
  name         = "naleko-people-${var.environment}-reminders"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  deletion_protection_enabled = true

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = "expires_at"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_iam_role" "send_document_reminders" {
  name        = "naleko-sendDocumentReminders-role"
  description = "Execution role for sendDocumentReminders Lambda"
  path        = "/naleko/"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "send_document_reminders" {
  name = "naleko-sendDocumentReminders-policy"
  role = aws_iam_role.send_document_reminders.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/sendDocumentReminders:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid    = "ReadEmployeesByCompany"
        Effect = "Allow"
        Action = ["dynamodb:Query"]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/employees",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/employees/index/tenant-index",
        ]
      },
      {
        # Only the founding company's rows carry no company id, so only it is read with a Scan, until TEN-02 step 2.
        Sid      = "ScanEmployeesLegacy"
        Effect   = "Allow"
        Action   = ["dynamodb:Scan"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/employees"
      },
      {
        Sid      = "ReadDocuments"
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/documents"
      },
      {
        Sid      = "ListCompanies"
        Effect   = "Allow"
        Action   = ["dynamodb:Scan"]
        Resource = aws_dynamodb_table.tenants.arn
        Condition = {
          "ForAllValues:StringEquals" = {
            "dynamodb:Attributes" = ["pk", "sk", "status", "modules", "founding"]
          }
          StringEqualsIfExists = {
            "dynamodb:Select" = "SPECIFIC_ATTRIBUTES"
          }
        }
      },
      {
        Sid      = "ReadCompanyRow"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = aws_dynamodb_table.tenants.arn
      },
      {
        Sid      = "Claims"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource = aws_dynamodb_table.reminders.arn
      },
    ]
  })
}

resource "aws_lambda_function" "send_document_reminders" {
  function_name = "sendDocumentReminders"
  role          = aws_iam_role.send_document_reminders.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 300
  architectures = ["x86_64"]

  environment {
    variables = {
      LEGACY_TENANT_ID      = var.legacy_tenant_id
      POSTMARK_API_TOKEN    = data.aws_ssm_parameter.postmark_token.value
      POSTMARK_SENDER_EMAIL = "ignecious@obsydiantechnologies.com"
      EMPLOYEES_TABLE       = aws_dynamodb_table.employees.name
      DOCUMENTS_TABLE       = aws_dynamodb_table.documents.name
      TENANTS_TABLE         = aws_dynamodb_table.tenants.name
      REMINDERS_TABLE       = aws_dynamodb_table.reminders.name
      LOGIN_URL             = var.login_url
      MAX_REMINDERS_PER_RUN = "500"
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/sendDocumentReminders"
  }

  depends_on = [aws_cloudwatch_log_group.lambda]

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# 06:00 UTC is 08:00 in South Africa. A schedule is on the default bus.
resource "aws_cloudwatch_event_rule" "send_document_reminders" {
  name                = "send-document-reminders"
  description         = "Every morning: remind new employees of the documents still to upload"
  schedule_expression = "cron(0 6 * * ? *)"
  state               = var.document_reminders_enabled ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "send_document_reminders" {
  rule      = aws_cloudwatch_event_rule.send_document_reminders.name
  target_id = "sendDocumentReminders"
  arn       = aws_lambda_function.send_document_reminders.arn
}

resource "aws_lambda_permission" "send_document_reminders" {
  statement_id  = "AllowEventBridgeSchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.send_document_reminders.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.send_document_reminders.arn
}
