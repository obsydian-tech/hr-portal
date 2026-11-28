# ═══════════════════════════════════════════════════════════════════════════════
# manageRoles — REC-04 (NH-238): a role record, and the candidates of a role
# ═══════════════════════════════════════════════════════════════════════════════
#
# One table and one Lambda, four JWT routes (the route key picks the action):
#   GET  /v1/roles             a Recruiter lists the company's roles; a manager lists the roles they hire for
#   GET  /v1/roles/{id}        one role, with its counts
#   POST /v1/roles             a Recruiter opens a role (Idempotency-Key required)
#   POST /v1/roles/{id}/close  a Recruiter closes a role once no candidate is open
# The candidates of a role are GET /v1/candidates?role_id= on getCandidates (the role-id-index on the state table).
#
# The code goes up by the deploy script (placeholder zip here, like every TalentFlow Lambda).
# Grants: the roles table, the role-id-index, the idempotency table, the settings read, the tenants table read (modules and the
# hiring manager's company), ListUsersInGroup on the one sign-in pool (the hiring manager check), the state key, its own log group.
#
# KMS: the tenants table is encrypted with the PII key. This role is added to infra/kms.tf kms_pii dynamodb_read_role_arns in the
# NEXT merge (the pipeline applies infra/ before this stack, and KMS rejects a principal that does not exist yet).
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_dynamodb_table" "talent_flow_roles" {
  name                        = local.tf_table_roles
  deletion_protection_enabled = true
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  range_key                   = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.talent_flow_state.arn
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(local.tf_tags, { Purpose = "RecruitmentRoles", Ticket = "NH-238" })

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_cloudwatch_log_group" "manage_roles" {
  name              = "/aws/lambda/manageRoles"
  retention_in_days = 30

  tags = merge(local.tf_tags, { Purpose = "ManageRolesLogs", Ticket = "NH-238" })
}

resource "aws_iam_role" "manage_roles" {
  name               = "${local.tf_iam_role_prefix}manageRoles"
  description        = "Execution role for manageRoles Lambda (REC-04)"
  path               = "/talent-flow/"
  assume_role_policy = local.tf_lambda_assume_role_policy
  tags               = merge(local.tf_tags, { Purpose = "ManageRolesRole", Ticket = "NH-238" })
}

resource "aws_iam_role_policy" "manage_roles" {
  name = "${local.tf_iam_role_prefix}manageRoles-policy"
  role = aws_iam_role.manage_roles.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:af-south-1:${var.aws_account_id}:log-group:/aws/lambda/manageRoles:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "RolesTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_roles}"
      },
      {
        # The open candidates of a role (counts and the close check).
        Sid      = "RoleIndexQuery"
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}/index/role-id-index"
      },
      {
        Sid      = "IdempotencyTable"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_idempotency}"
      },
      {
        # The company's settings (levels, default criteria, panel sizes) through the active-configs index.
        Sid      = "ConfigActiveRead"
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_config}/index/GSI1-active-configs"
      },
      {
        # lambda/shared/modules.mjs (one GetItem on the company's row) and membership.mjs (the hiring manager's Member rows).
        Sid      = "ReadCompanyList"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_tenants_table}"
      },
      {
        # The hiring manager must be one the picker lists (getHiringManagers' groups, one pool).
        Sid      = "HiringManagerGroups"
        Effect   = "Allow"
        Action   = ["cognito-idp:ListUsersInGroup"]
        Resource = "arn:aws:cognito-idp:af-south-1:${var.aws_account_id}:userpool/${local.tf_naleko_pool_id}"
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

resource "aws_lambda_function" "manage_roles" {
  function_name = "manageRoles"
  role          = aws_iam_role.manage_roles.arn
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
      ROLES_TABLE_NAME       = local.tf_table_roles
      HM_COGNITO_POOL_ID     = local.tf_naleko_pool_id
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
    log_group             = aws_cloudwatch_log_group.manage_roles.name
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = merge(local.tf_tags, { Purpose = "ManageRoles", Ticket = "NH-238" })
}

resource "aws_apigatewayv2_integration" "manage_roles" {
  api_id                 = aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.manage_roles.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "manage_roles_list" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /v1/roles"
  target             = "integrations/${aws_apigatewayv2_integration.manage_roles.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_roles_one" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /v1/roles/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.manage_roles.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_roles_open" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/roles"
  target             = "integrations/${aws_apigatewayv2_integration.manage_roles.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_apigatewayv2_route" "manage_roles_close" {
  api_id             = aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/roles/{id}/close"
  target             = "integrations/${aws_apigatewayv2_integration.manage_roles.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.talent_flow_api_cognito.id
}

resource "aws_lambda_permission" "manage_roles_api" {
  statement_id  = "AllowTalentFlowAPIInvokeManageRoles"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.manage_roles.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*"
}
