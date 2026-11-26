# ─── REC-16 (NH-283): hiring manager IT-bundle email on an accepted offer ─────
# CandidateHired on talent-flow-bus → notifyHiringManagerOnHire → one Postmark email to the candidate's hiring manager
# (or the blackhole test address while hm_it_email_mode is TEST_ADDRESS, the default). Spec: onboarding-cards/specs/REC-16.md.

resource "aws_iam_role" "notify_hiring_manager_on_hire" {
  name        = "naleko-notifyHiringManagerOnHire-role"
  description = "Execution role for notifyHiringManagerOnHire Lambda (REC-16)"
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

resource "aws_iam_role_policy" "notify_hiring_manager_on_hire" {
  name = "naleko-notifyHiringManagerOnHire-policy"
  role = aws_iam_role.notify_hiring_manager_on_hire.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/notifyHiringManagerOnHire:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "ReadOfferAndCandidate"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-state"
      },
      {
        Sid      = "WriteGuardRowOnly"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-state"
        Condition = {
          "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["NOTICE#HM_IT#*"] }
        }
      },
      {
        Sid      = "StateTableKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:DescribeKey", "kms:GenerateDataKey"]
        Resource = data.aws_kms_key.talent_flow.arn
      },
      {
        Sid      = "MemberRows"
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = aws_dynamodb_table.tenants.arn
      },
      {
        Sid      = "TenantsTableKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:DescribeKey"]
        Resource = module.kms_pii.key_arn
        Condition = {
          StringEquals = { "kms:ViaService" = "dynamodb.af-south-1.amazonaws.com" }
        }
      },
      {
        Sid      = "HiringManagers"
        Effect   = "Allow"
        Action   = ["cognito-idp:ListUsersInGroup"]
        Resource = aws_cognito_user_pool.naleko_dev.arn
      },
    ]
  })
}

resource "aws_lambda_function" "notify_hiring_manager_on_hire" {
  function_name = "notifyHiringManagerOnHire"
  role          = aws_iam_role.notify_hiring_manager_on_hire.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 30
  architectures = ["x86_64"]

  environment {
    variables = {
      HM_IT_EMAIL_MODE      = var.hm_it_email_mode
      HM_IT_TEST_EMAIL      = "hm-it-bundle@blackhole.postmarkapp.com"
      POSTMARK_API_TOKEN    = data.aws_ssm_parameter.postmark_token.value
      POSTMARK_SENDER_EMAIL = "ignecious@obsydiantechnologies.com"
      STATE_TABLE           = "talent-flow-state"
      TENANTS_TABLE         = aws_dynamodb_table.tenants.name
      HM_COGNITO_POOL_ID    = aws_cognito_user_pool.naleko_dev.id
      HM_GROUP_NAME         = "naleko-talentflow-hiringmanager"
      LEGACY_TENANT_ID      = var.legacy_tenant_id
    }
  }

  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/notifyHiringManagerOnHire"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_cloudwatch_event_rule" "notify_hiring_manager_on_hire" {
  name           = "talent-flow-candidate-hired-notify-hm-it"
  description    = "CandidateHired on talent-flow-bus → email the hiring manager to set up the IT provisioning bundle (REC-16)"
  event_bus_name = data.aws_cloudwatch_event_bus.talent_flow_bus.name

  event_pattern = jsonencode({
    source        = ["talent-flow.workflow"]
    "detail-type" = ["CandidateHired"]
  })

  state = "ENABLED"

  tags = { Ticket = "NH-283", Component = "TalentFlow" }
}

resource "aws_cloudwatch_event_target" "notify_hiring_manager_on_hire" {
  rule           = aws_cloudwatch_event_rule.notify_hiring_manager_on_hire.name
  event_bus_name = data.aws_cloudwatch_event_bus.talent_flow_bus.name
  target_id      = "notifyHiringManagerOnHire"
  arn            = aws_lambda_function.notify_hiring_manager_on_hire.arn
}

resource "aws_lambda_permission" "notify_hiring_manager_on_hire" {
  statement_id  = "AllowTFBusInvokeNotifyHiringManagerOnHire"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.notify_hiring_manager_on_hire.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.notify_hiring_manager_on_hire.arn
}
