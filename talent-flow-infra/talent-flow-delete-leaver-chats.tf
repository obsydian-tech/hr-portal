# CHAT-15: deleteLeaverChats. Every hour it deletes the Ask Batsi chats of people an admin deactivated more than 65 minutes ago.
# Add only: a role, a function, a rule, its target and its permission. The role is also in infra/kms.tf dynamodb_read_role_arns (once).
resource "aws_iam_role" "delete_leaver_chats" {
  name               = "${local.tf_iam_role_prefix}deleteLeaverChats"
  description        = "Execution role for deleteLeaverChats Lambda"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Ticket = "CHAT-15" })
}

resource "aws_iam_role_policy" "delete_leaver_chats" {
  name = "${local.tf_iam_role_prefix}deleteLeaverChats-policy"
  role = aws_iam_role.delete_leaver_chats.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/deleteLeaverChats:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "UsersTable"
        Effect   = "Allow"
        Action   = ["dynamodb:Scan", "dynamodb:UpdateItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_users}"
      },
      {
        Sid      = "CognitoGetUser"
        Effect   = "Allow"
        Action   = ["cognito-idp:AdminGetUser"]
        Resource = "arn:aws:cognito-idp:af-south-1:${var.aws_account_id}:userpool/${local.tf_naleko_pool_id}"
      },
      {
        Sid      = "ChatsTable"
        Effect   = "Allow"
        Action   = ["dynamodb:Query", "dynamodb:BatchWriteItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/ask-batsi-chats"
      },
      {
        Sid      = "AuditTable"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/naleko-agent-audit"
      },
      {
        Sid      = "KMSStateKey"
        Effect   = "Allow"
        Action   = local.tf_kms_actions
        Resource = aws_kms_key.talent_flow_state.arn
      },
    ]
  })
}

resource "aws_lambda_function" "delete_leaver_chats" {
  function_name = "deleteLeaverChats"
  role          = aws_iam_role.delete_leaver_chats.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.tf_placeholder_zip
  memory_size   = 256
  timeout       = 300
  architectures = ["arm64"]

  environment {
    variables = {
      USERS_TABLE_NAME  = local.tf_table_users
      COGNITO_POOL_ID   = local.tf_naleko_pool_id
      CHATS_TABLE       = "ask-batsi-chats"
      AGENT_AUDIT_TABLE = "naleko-agent-audit"
      LEGACY_TENANT_ID  = var.legacy_tenant_id
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/deleteLeaverChats"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Ticket = "CHAT-15", Purpose = "DeleteLeaverChats" })
}

resource "aws_cloudwatch_event_rule" "delete_leaver_chats" {
  name                = "delete-leaver-chats"
  description         = "Every hour: delete the Ask Batsi chats of people deactivated more than 65 minutes ago"
  schedule_expression = "rate(1 hour)"
  state               = var.delete_leaver_chats_enabled ? "ENABLED" : "DISABLED"
}

resource "aws_cloudwatch_event_target" "delete_leaver_chats" {
  rule      = aws_cloudwatch_event_rule.delete_leaver_chats.name
  target_id = "deleteLeaverChats"
  arn       = aws_lambda_function.delete_leaver_chats.arn
}

resource "aws_lambda_permission" "delete_leaver_chats" {
  statement_id  = "AllowEventBridgeSchedule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.delete_leaver_chats.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.delete_leaver_chats.arn
}
