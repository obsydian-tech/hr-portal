# ═══════════════════════════════════════════════════════════════════════════════
# recordNotHired — REC-02 (NH-236): a person decides Not hired, with a reason
# ═══════════════════════════════════════════════════════════════════════════════
#
# One Lambda, five JWT routes (the route key picks the action):
#   POST /v1/candidates/{id}/not-hired          record Not hired (or a pending decision when a second person must confirm)
#   POST /v1/candidates/{id}/not-hired/confirm  a different person completes it
#   POST /v1/candidates/{id}/not-hired/cancel   a person who may decide lets a pending decision go
#   POST /v1/candidates/{id}/reopen             move a Not hired candidate back
#   GET  /v1/candidates/old-system              the old system's rejections, for HR
#
# The code goes up by the deploy script (placeholder zip here, like every TalentFlow Lambda).
# Grants (rule 8 of the card): the state table and its tenant index, the idempotency table, the config table read, the tenants
# table read (modules), the state key, PutEvents on the bus, its own log group. No other Lambda gains a write.
#
# KMS: the tenants table is encrypted with the PII key. This role is added to infra/kms.tf kms_pii dynamodb_read_role_arns in the
# NEXT merge (the pipeline applies infra/ before this stack, and KMS rejects a principal that does not exist yet).
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_cloudwatch_log_group" "record_not_hired" {
  name              = "/aws/lambda/recordNotHired"
  retention_in_days = 30

  tags = merge(local.tf_tags, { Purpose = "RecordNotHiredLogs", Ticket = "NH-236" })
}

resource "aws_iam_role" "record_not_hired" {
  name               = "${local.tf_iam_role_prefix}recordNotHired"
  description        = "Execution role for recordNotHired Lambda (REC-02)"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Purpose = "RecordNotHiredRole", Ticket = "NH-236" })
}

resource "aws_iam_role_policy" "record_not_hired" {
  name = "${local.tf_iam_role_prefix}recordNotHired-policy"
  role = aws_iam_role.record_not_hired.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/recordNotHired:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "StateTableReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}"
      },
      {
        Sid      = "StateTenantIndexQuery"
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}/index/GSI1"
      },
      {
        Sid      = "IdempotencyTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_idempotency}"
      },
      {
        # The company's settings (REJECTION_RULES) are read through the active-configs index and, for a locked version, by key.
        Sid      = "ConfigActiveRead"
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_config}/index/GSI1-active-configs"
      },
      {
        Sid      = "ConfigVersionRead"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_config}"
      },
      {
        # lambda/shared/modules.mjs: one GetItem on the company's row in the tenants table (infra/tenancy.tf).
        Sid      = "ReadCompanyModules"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_tenants_table}"
      },
      {
        Sid      = "EventBridgePublish"
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = aws_cloudwatch_event_bus.talent_flow.arn
      },
      {
        Sid      = "KMSStateKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
        Resource = aws_kms_key.talent_flow_state.arn
      },
    ]
  })
}

resource "aws_lambda_function" "record_not_hired" {
  function_name = "recordNotHired"
  role          = aws_iam_role.record_not_hired.arn
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 256
  timeout       = 30

  # Code will be deployed separately via the deploy script
  filename         = local.tf_placeholder_zip
  source_code_hash = filebase64sha256(local.tf_placeholder_zip)

  environment {
    variables = {
      TENANTS_TABLE          = local.tf_tenants_table
      STATE_TABLE_NAME       = local.tf_table_state
      CONFIG_TABLE_NAME      = local.tf_table_config
      IDEMPOTENCY_TABLE_NAME = local.tf_table_idempotency
      EVENTBRIDGE_BUS_NAME   = local.tf_event_bus_name
      ENVIRONMENT            = var.environment
    }
  }

  tracing_config {
    mode = "Active"
  }

  logging_config {
    log_format            = "JSON"
    application_log_level = "INFO"
    system_log_level      = "INFO"
    log_group             = aws_cloudwatch_log_group.record_not_hired.name
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Purpose = "RecordNotHired", Ticket = "NH-236" })
}

resource "aws_apigatewayv2_integration" "record_not_hired" {
  api_id                 = aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.record_not_hired.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "record_not_hired_not_hired" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/candidates/{id}/not-hired"
  target             = "integrations/${aws_apigatewayv2_integration.record_not_hired.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "record_not_hired_confirm" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/candidates/{id}/not-hired/confirm"
  target             = "integrations/${aws_apigatewayv2_integration.record_not_hired.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "record_not_hired_cancel" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/candidates/{id}/not-hired/cancel"
  target             = "integrations/${aws_apigatewayv2_integration.record_not_hired.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "record_not_hired_reopen" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/candidates/{id}/reopen"
  target             = "integrations/${aws_apigatewayv2_integration.record_not_hired.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "record_not_hired_old_system" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /v1/candidates/old-system"
  target             = "integrations/${aws_apigatewayv2_integration.record_not_hired.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_lambda_permission" "record_not_hired_api" {
  statement_id  = "AllowTalentFlowAPIInvokeRecordNotHired"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.record_not_hired.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*"
}
