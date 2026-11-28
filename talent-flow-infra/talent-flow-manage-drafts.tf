# ═══════════════════════════════════════════════════════════════════════════════
# manageDrafts — REC-09 (NH-243): drafts for HR to edit and send, one at a time
# ═══════════════════════════════════════════════════════════════════════════════
#
#   GET   /v1/drafts                  the company's open drafts (Recruiter)
#   PATCH /v1/drafts/{id}             edit the words
#   POST  /v1/drafts/{id}/send        queue one email to the candidate (Idempotency-Key), recorded, never twice
#   POST  /v1/drafts/{id}/dismiss     let a draft go
#
# Grants: the state table and its tenant index, the idempotency table, the tenants table read (modules), the state key, the
# notification queue send and its key, its own log group. No model, no wildcard action. The code goes up by the deploy script.
# KMS: add this role to infra/kms.tf kms_pii dynamodb_read_role_arns in the NEXT merge (the role must exist first).
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_cloudwatch_log_group" "manage_drafts" {
  name              = "/aws/lambda/manageDrafts"
  retention_in_days = 30

  tags = merge(local.tf_tags, { Purpose = "ManageDraftsLogs", Ticket = "NH-243" })
}

resource "aws_iam_role" "manage_drafts" {
  name               = "${local.tf_iam_role_prefix}manageDrafts"
  description        = "Execution role for manageDrafts Lambda (REC-09)"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Purpose = "ManageDraftsRole", Ticket = "NH-243" })
}

resource "aws_iam_role_policy" "manage_drafts" {
  name = "${local.tf_iam_role_prefix}manageDrafts-policy"
  role = aws_iam_role.manage_drafts.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/manageDrafts:*"
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
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
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
        # lambda/shared/modules.mjs: one GetItem on the company's row in the tenants table (infra/tenancy.tf).
        Sid      = "ReadCompanyModules"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_tenants_table}"
      },
      {
        Sid      = "NotificationQueueSend"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.talent_flow_notification.arn
      },
      {
        Sid      = "NotificationQueueKey"
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = aws_kms_key.talent_flow_agent_audit.arn
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

resource "aws_lambda_function" "manage_drafts" {
  function_name = "manageDrafts"
  role          = aws_iam_role.manage_drafts.arn
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
      NOTIFICATION_QUEUE_URL = aws_sqs_queue.talent_flow_notification.url
      IDEMPOTENCY_TABLE_NAME = local.tf_table_idempotency
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
    log_group             = aws_cloudwatch_log_group.manage_drafts.name
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Purpose = "ManageDrafts", Ticket = "NH-243" })
}

resource "aws_apigatewayv2_integration" "manage_drafts" {
  api_id                 = aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.manage_drafts.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "manage_drafts_list" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /v1/drafts"
  target             = "integrations/${aws_apigatewayv2_integration.manage_drafts.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_drafts_patch" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "PATCH /v1/drafts/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.manage_drafts.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_drafts_send" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/drafts/{id}/send"
  target             = "integrations/${aws_apigatewayv2_integration.manage_drafts.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_drafts_dismiss" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/drafts/{id}/dismiss"
  target             = "integrations/${aws_apigatewayv2_integration.manage_drafts.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_lambda_permission" "manage_drafts_api" {
  statement_id  = "AllowTalentFlowAPIInvokeManageDrafts"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.manage_drafts.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*"
}
