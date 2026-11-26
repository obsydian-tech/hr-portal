# manageOffers: REC-05 (NH-239), every /v1/offers route.

locals {
  tf_offer_upload_bucket = var.environment == "prod" ? "document-ocr-verification-uploads" : "pepla-${var.environment}-document-uploads-${var.aws_account_id}"
}

resource "aws_cloudwatch_log_group" "manage_offers" {
  name              = "/aws/lambda/manageOffers"
  retention_in_days = 30
  tags              = merge(local.tf_tags, { Purpose = "ManageOffersLogs", Ticket = "NH-239" })
}

resource "aws_iam_role" "manage_offers" {
  name               = "${local.tf_iam_role_prefix}manageOffers"
  description        = "Execution role for manageOffers Lambda (REC-05)"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Purpose = "ManageOffersRole", Ticket = "NH-239" })
}

resource "aws_iam_role_policy" "manage_offers" {
  name = "${local.tf_iam_role_prefix}manageOffers-policy"
  role = aws_iam_role.manage_offers.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/manageOffers:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "StateTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}"
      },
      {
        Sid      = "OfferList"
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}/index/GSI2"
      },
      {
        Sid      = "RolesRead"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_roles}"
      },
      {
        Sid      = "EmployeeWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/employees"
      },
      {
        Sid      = "EmployeeEmailCheck"
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/employees/index/email-index"
      },
      {
        Sid      = "IdempotencyTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_idempotency}"
      },
      {
        Sid      = "ReadCompanyList"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_tenants_table}"
      },
      {
        Sid      = "ApproverGroups"
        Effect   = "Allow"
        Action   = ["cognito-idp:ListUsersInGroup"]
        Resource = "arn:aws:cognito-idp:af-south-1:${var.aws_account_id}:userpool/${local.tf_naleko_pool_id}"
      },
      {
        Sid      = "SignedOffer"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "arn:aws:s3:::${local.tf_offer_upload_bucket}/recruitment/*"
      },
      {
        Sid      = "OfferEvents"
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

resource "aws_lambda_function" "manage_offers" {
  function_name = "manageOffers"
  role          = aws_iam_role.manage_offers.arn
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  memory_size   = 256
  timeout       = 30

  filename         = local.tf_placeholder_zip
  source_code_hash = filebase64sha256(local.tf_placeholder_zip)

  environment {
    variables = {
      TENANTS_TABLE        = local.tf_tenants_table
      STATE_TABLE_NAME     = local.tf_table_state
      IDEMPOTENCY_TABLE    = local.tf_table_idempotency
      ROLES_TABLE_NAME     = local.tf_table_roles
      UPLOAD_BUCKET        = local.tf_offer_upload_bucket
      EVENTBRIDGE_BUS_NAME = local.tf_event_bus_name
      COGNITO_POOL_ID      = local.tf_naleko_pool_id
      ENVIRONMENT          = var.environment
    }
  }

  tracing_config {
    mode = "Active"
  }

  logging_config {
    log_format            = "JSON"
    application_log_level = "INFO"
    system_log_level      = "INFO"
    log_group             = aws_cloudwatch_log_group.manage_offers.name
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Purpose = "ManageOffers", Ticket = "NH-239" })
}

resource "aws_apigatewayv2_integration" "manage_offers" {
  api_id                 = aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.manage_offers.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "manage_offers_list" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /v1/offers"
  target             = "integrations/${aws_apigatewayv2_integration.manage_offers.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_offers_create" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/offers"
  target             = "integrations/${aws_apigatewayv2_integration.manage_offers.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_offers_one" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /v1/offers/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.manage_offers.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_offers_edit" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "PATCH /v1/offers/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.manage_offers.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_offers_submit" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/offers/{id}/submit"
  target             = "integrations/${aws_apigatewayv2_integration.manage_offers.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_offers_approve" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/offers/{id}/approve"
  target             = "integrations/${aws_apigatewayv2_integration.manage_offers.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_offers_send_back" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/offers/{id}/send-back"
  target             = "integrations/${aws_apigatewayv2_integration.manage_offers.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_offers_send" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/offers/{id}/send"
  target             = "integrations/${aws_apigatewayv2_integration.manage_offers.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_offers_answer" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/offers/{id}/answer"
  target             = "integrations/${aws_apigatewayv2_integration.manage_offers.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_offers_withdraw" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/offers/{id}/withdraw"
  target             = "integrations/${aws_apigatewayv2_integration.manage_offers.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_offers_upload" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/offers/{id}/signed-upload"
  target             = "integrations/${aws_apigatewayv2_integration.manage_offers.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_lambda_permission" "manage_offers_api" {
  statement_id  = "AllowTalentFlowAPIInvokeManageOffers"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.manage_offers.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*"
}
