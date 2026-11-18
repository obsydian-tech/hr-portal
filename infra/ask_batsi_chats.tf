# ---------------------------------------------------------------------------
# CHAT-02: Ask Batsi stored chats and the company switch.
#
#  - Table ask-batsi-chats: one partition per person (T#<company>#S#<staff>), a header row per chat and a row per message.
#    Kept until the person deletes. Deletion protection on, point-in-time recovery on, the PII key.
#  - askBatsiChats: list, open, delete one, delete all (agent API, Cognito JWT). No model, no secrets.
#  - adminSetAskBatsi: an admin of the company turns the Ask Batsi switch on or off (employees API, Cognito JWT).
#  - nalekoAiChat and talentFlowAiChat (their own files) get add-only rights on this table and a GetItem on the company list.
# Terraform never writes table rows.
# ---------------------------------------------------------------------------

resource "aws_dynamodb_table" "ask_batsi_chats" {
  name                        = "ask-batsi-chats"
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

  tags = {
    Component = "AskBatsi"
    Ticket    = "CHAT-02"
  }
}

# ─── askBatsiChats ────────────────────────────────────────────────────────────

resource "aws_iam_role" "ask_batsi_chats" {
  name        = "naleko-askBatsiChats-role"
  description = "Execution role for askBatsiChats Lambda (CHAT-02)"
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

resource "aws_iam_role_policy" "ask_batsi_chats" {
  name = "naleko-askBatsiChats-policy"
  role = aws_iam_role.ask_batsi_chats.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/askBatsiChats:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "ChatsTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:DeleteItem", "dynamodb:BatchWriteItem"]
        Resource = aws_dynamodb_table.ask_batsi_chats.arn
      },
      {
        # A delete leaves a record with no chat text in it.
        Sid      = "DeleteAudit"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = aws_dynamodb_table.agent_audit.arn
      },
      {
        # The switch: one GetItem on the company's row.
        Sid      = "CompanySwitchRead"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = aws_dynamodb_table.tenants.arn
      },
    ]
  })
}

resource "aws_lambda_function" "ask_batsi_chats" {
  function_name = "askBatsiChats"
  role          = aws_iam_role.ask_batsi_chats.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 256
  timeout       = 15
  architectures = ["x86_64"]

  environment {
    variables = {
      CHATS_TABLE       = aws_dynamodb_table.ask_batsi_chats.name
      TENANTS_TABLE     = aws_dynamodb_table.tenants.name
      AGENT_AUDIT_TABLE = aws_dynamodb_table.agent_audit.name
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/askBatsiChats"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = {
    Component = "AskBatsi"
    Ticket    = "CHAT-02"
  }
}

resource "aws_apigatewayv2_integration" "ask_batsi_chats" {
  api_id                 = aws_apigatewayv2_api.agent_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.ask_batsi_chats.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "ask_batsi_chats_list" {
  api_id             = aws_apigatewayv2_api.agent_api.id
  route_key          = "GET /v1/chats"
  target             = "integrations/${aws_apigatewayv2_integration.ask_batsi_chats.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.agent_api_cognito_jwt.id
}

resource "aws_apigatewayv2_route" "ask_batsi_chats_get" {
  api_id             = aws_apigatewayv2_api.agent_api.id
  route_key          = "GET /v1/chats/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.ask_batsi_chats.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.agent_api_cognito_jwt.id
}

resource "aws_apigatewayv2_route" "ask_batsi_chats_delete" {
  api_id             = aws_apigatewayv2_api.agent_api.id
  route_key          = "DELETE /v1/chats/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.ask_batsi_chats.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.agent_api_cognito_jwt.id
}

resource "aws_apigatewayv2_route" "ask_batsi_chats_delete_all" {
  api_id             = aws_apigatewayv2_api.agent_api.id
  route_key          = "DELETE /v1/chats"
  target             = "integrations/${aws_apigatewayv2_integration.ask_batsi_chats.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.agent_api_cognito_jwt.id
}

resource "aws_lambda_permission" "ask_batsi_chats" {
  statement_id  = "AllowAgentAPIInvokeAskBatsiChats"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ask_batsi_chats.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.agent_api.execution_arn}/*/*"
}

# ─── adminSetAskBatsi ─────────────────────────────────────────────────────────

resource "aws_iam_role" "admin_set_ask_batsi" {
  name        = "naleko-adminSetAskBatsi-role"
  description = "Execution role for adminSetAskBatsi Lambda (CHAT-02)"
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

resource "aws_iam_role_policy" "admin_set_ask_batsi" {
  name = "naleko-adminSetAskBatsi-policy"
  role = aws_iam_role.admin_set_ask_batsi.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/adminSetAskBatsi:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        # Read the company row, change its modules, and keep an audit row beside it.
        Sid      = "CompanyRowChange"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:PutItem"]
        Resource = aws_dynamodb_table.tenants.arn
      },
    ]
  })
}

resource "aws_lambda_function" "admin_set_ask_batsi" {
  function_name = "adminSetAskBatsi"
  role          = aws_iam_role.admin_set_ask_batsi.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 10
  architectures = ["x86_64"]

  environment {
    variables = {
      TENANTS_TABLE = aws_dynamodb_table.tenants.name
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/adminSetAskBatsi"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = {
    Component = "AskBatsi"
    Ticket    = "CHAT-02"
  }
}

resource "aws_apigatewayv2_integration" "admin_set_ask_batsi" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.admin_set_ask_batsi.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "admin_set_ask_batsi" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "PUT /v1/admin/company/ask-batsi"
  target             = "integrations/${aws_apigatewayv2_integration.admin_set_ask_batsi.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_lambda_permission" "admin_set_ask_batsi" {
  statement_id  = "AllowEmployeesAPIInvokeAdminSetAskBatsi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.admin_set_ask_batsi.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

# ─── The two old chat Lambdas: add only ───────────────────────────────────────
# nalekoAiChat keeps and reads chats. The PII key right it needs is already in its own policy (KMSAuditAndCache).
resource "aws_iam_role_policy" "naleko_ai_chat_chats" {
  name = "chat02-chats-naleko-ai-chat"
  role = aws_iam_role.naleko_ai_chat.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ChatsTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.ask_batsi_chats.arn
      },
      {
        Sid      = "CompanySwitchRead"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = aws_dynamodb_table.tenants.arn
      },
    ]
  })
}
