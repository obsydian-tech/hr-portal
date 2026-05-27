# ---------------------------------------------------------------------------
# IT Provisioning — Feature: IT Tasks Backend
#
# Implements the full backend for the IT Specialist queue view.
# Speaks to admin config (IT_QUEUES, ROUTING_RULES, PROVISIONING_TEMPLATES)
# stored in talent-flow-config by the Admin IT Request Config pages.
#
# Resources in this file:
#   1.  DynamoDB table        it-tasks
#   2–7. IAM roles + policies  (one per Lambda)
#   8–13. Lambda functions     getItTasks | getItTask | claimItTask |
#                              releaseItTask | completeItTask | createItTask
#   14–18. API GW integrations + routes (5 public routes on talent-flow-api)
#   19–23. Lambda permissions  (API GW → Lambda invoke)
#   24.   Lambda permission    (orchestrateTalentFlowWorkflow → createItTask)
#
# Admin ↔ IT data flow:
#   Admin writes IT_QUEUES / ROUTING_RULES / PROVISIONING_TEMPLATES
#   via PUT /v1/config (manageTalentFlowConfig Lambda → talent-flow-config table)
#   ──────────────────────────────────────────────────────────────────────────
#   orchestrateTalentFlowWorkflow reads those configs and invokes createItTask
#   when a provisioning bundle is approved → writes records to it-tasks table
#   ──────────────────────────────────────────────────────────────────────────
#   IT_QUEUES.assignedSpecialists drives which queues an IT Specialist sees
#   in the frontend queue page (getItTasks filtered by queue name)
#
# Auth: JWT Cognito authorizer (talent_flow_cognito_authorizer_id = "ko4zam")
#       Naleko pool tokens accepted (Epic 5 pool consolidation)
#       Group gate enforced inside each Lambda:
#         ITAdmin | ITSpecialist  for read+write
#         TalentFlowAdmin         for unrestricted access
#
# POPIA: data classified as Internal — no PII stored in it-tasks.
#        New-hire information (name, role, dept) is operational metadata, not PII.
#        KMS encryption uses the talent-flow KMS key (alias/talent-flow).
# ---------------------------------------------------------------------------

locals {
  it_tasks_table_name = "it-tasks"
  it_tasks_table_arn  = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/${local.it_tasks_table_name}"
  tf_config_table_arn = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-config"
}

# ─── DynamoDB table: it-tasks ─────────────────────────────────────────────────
# PK:   taskId        (UUID, write-once)
# GSI1: byTenantStatus   PK=tenantId  SK=taskStatus   → getItTasks query
# GSI2: byCandidateId    PK=candidateId SK=createdAt  → orchestration / audit

resource "aws_dynamodb_table" "it_tasks" {
  name         = local.it_tasks_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "taskId"
  table_class  = "STANDARD"

  attribute {
    name = "taskId"
    type = "S"
  }

  attribute {
    name = "tenantId"
    type = "S"
  }

  attribute {
    name = "taskStatus"
    type = "S"
  }

  attribute {
    name = "candidateId"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  # GSI1 — used by getItTasks: list all tasks for a tenant by status
  global_secondary_index {
    name            = "byTenantStatus"
    hash_key        = "tenantId"
    range_key       = "taskStatus"
    projection_type = "ALL"
  }

  # GSI2 — used by createItTask audit / orchestration lookup
  global_secondary_index {
    name            = "byCandidateId"
    hash_key        = "candidateId"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = data.aws_kms_key.talent_flow.arn
  }

  tags = {
    Component          = "ITProvisioning"
    DataClassification = "Internal"
    Ticket             = "IT-001"
  }
}

# ─── Shared IAM assume-role policy (all IT Lambdas) ──────────────────────────

locals {
  it_lambda_assume_role = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  # Logs + X-Ray are identical for each Lambda — defined once per function below
}

# ═══════════════════════════════════════════════════════════════════════════════
# getItTasks
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "get_it_tasks" {
  name               = "it-tasks-role-getItTasks"
  path               = "/talent-flow/"
  assume_role_policy = local.it_lambda_assume_role

  tags = { Component = "ITProvisioning", Ticket = "IT-001" }
}

resource "aws_iam_role_policy" "get_it_tasks" {
  name = "it-tasks-policy-getItTasks"
  role = aws_iam_role.get_it_tasks.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/getItTasks:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid    = "DynamoDBQuery"
        Effect = "Allow"
        Action = ["dynamodb:Query"]
        Resource = [
          "${local.it_tasks_table_arn}/index/byTenantStatus",
        ]
      },
      {
        Sid    = "ConfigRead"
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = [
          local.tf_config_table_arn,
          "${local.tf_config_table_arn}/index/*",
        ]
      },
      {
        Sid      = "KMS"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
        Resource = data.aws_kms_key.talent_flow.arn
      },
    ]
  })
}

resource "aws_lambda_function" "get_it_tasks" {
  function_name = "getItTasks"
  role          = aws_iam_role.get_it_tasks.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 15
  architectures = ["x86_64"]

  environment {
    variables = {
      IT_TASKS_TABLE    = local.it_tasks_table_name
      CONFIG_TABLE_NAME = "talent-flow-config"
    }
  }

  tracing_config { mode = "Active" }
  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getItTasks"
  }

  tags = { Component = "ITProvisioning", Ticket = "IT-001" }

  lifecycle { ignore_changes = [filename, source_code_hash] }
}

# ═══════════════════════════════════════════════════════════════════════════════
# getItTask
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "get_it_task" {
  name               = "it-tasks-role-getItTask"
  path               = "/talent-flow/"
  assume_role_policy = local.it_lambda_assume_role

  tags = { Component = "ITProvisioning", Ticket = "IT-001" }
}

resource "aws_iam_role_policy" "get_it_task" {
  name = "it-tasks-policy-getItTask"
  role = aws_iam_role.get_it_task.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/getItTask:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "DynamoDBGet"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = local.it_tasks_table_arn
      },
      {
        Sid      = "KMS"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
        Resource = data.aws_kms_key.talent_flow.arn
      },
    ]
  })
}

resource "aws_lambda_function" "get_it_task" {
  function_name = "getItTask"
  role          = aws_iam_role.get_it_task.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 10
  architectures = ["x86_64"]

  environment {
    variables = {
      IT_TASKS_TABLE = local.it_tasks_table_name
    }
  }

  tracing_config { mode = "Active" }
  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getItTask"
  }

  tags = { Component = "ITProvisioning", Ticket = "IT-001" }

  lifecycle { ignore_changes = [filename, source_code_hash] }
}

# ═══════════════════════════════════════════════════════════════════════════════
# claimItTask
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "claim_it_task" {
  name               = "it-tasks-role-claimItTask"
  path               = "/talent-flow/"
  assume_role_policy = local.it_lambda_assume_role

  tags = { Component = "ITProvisioning", Ticket = "IT-001" }
}

resource "aws_iam_role_policy" "claim_it_task" {
  name = "it-tasks-policy-claimItTask"
  role = aws_iam_role.claim_it_task.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/claimItTask:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "DynamoDBReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = local.it_tasks_table_arn
      },
      {
        Sid      = "KMS"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
        Resource = data.aws_kms_key.talent_flow.arn
      },
    ]
  })
}

resource "aws_lambda_function" "claim_it_task" {
  function_name = "claimItTask"
  role          = aws_iam_role.claim_it_task.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 10
  architectures = ["x86_64"]

  environment {
    variables = {
      IT_TASKS_TABLE = local.it_tasks_table_name
    }
  }

  tracing_config { mode = "Active" }
  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/claimItTask"
  }

  tags = { Component = "ITProvisioning", Ticket = "IT-001" }

  lifecycle { ignore_changes = [filename, source_code_hash] }
}

# ═══════════════════════════════════════════════════════════════════════════════
# releaseItTask
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "release_it_task" {
  name               = "it-tasks-role-releaseItTask"
  path               = "/talent-flow/"
  assume_role_policy = local.it_lambda_assume_role

  tags = { Component = "ITProvisioning", Ticket = "IT-001" }
}

resource "aws_iam_role_policy" "release_it_task" {
  name = "it-tasks-policy-releaseItTask"
  role = aws_iam_role.release_it_task.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/releaseItTask:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "DynamoDBReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = local.it_tasks_table_arn
      },
      {
        Sid      = "KMS"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
        Resource = data.aws_kms_key.talent_flow.arn
      },
    ]
  })
}

resource "aws_lambda_function" "release_it_task" {
  function_name = "releaseItTask"
  role          = aws_iam_role.release_it_task.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 10
  architectures = ["x86_64"]

  environment {
    variables = {
      IT_TASKS_TABLE = local.it_tasks_table_name
    }
  }

  tracing_config { mode = "Active" }
  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/releaseItTask"
  }

  tags = { Component = "ITProvisioning", Ticket = "IT-001" }

  lifecycle { ignore_changes = [filename, source_code_hash] }
}

# ═══════════════════════════════════════════════════════════════════════════════
# completeItTask
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "complete_it_task" {
  name               = "it-tasks-role-completeItTask"
  path               = "/talent-flow/"
  assume_role_policy = local.it_lambda_assume_role

  tags = { Component = "ITProvisioning", Ticket = "IT-001" }
}

resource "aws_iam_role_policy" "complete_it_task" {
  name = "it-tasks-policy-completeItTask"
  role = aws_iam_role.complete_it_task.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/completeItTask:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "DynamoDBReadWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:UpdateItem"]
        Resource = local.it_tasks_table_arn
      },
      {
        Sid      = "KMS"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
        Resource = data.aws_kms_key.talent_flow.arn
      },
    ]
  })
}

resource "aws_lambda_function" "complete_it_task" {
  function_name = "completeItTask"
  role          = aws_iam_role.complete_it_task.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 10
  architectures = ["x86_64"]

  environment {
    variables = {
      IT_TASKS_TABLE = local.it_tasks_table_name
    }
  }

  tracing_config { mode = "Active" }
  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/completeItTask"
  }

  tags = { Component = "ITProvisioning", Ticket = "IT-001" }

  lifecycle { ignore_changes = [filename, source_code_hash] }
}

# ═══════════════════════════════════════════════════════════════════════════════
# createItTask — INTERNAL (no API Gateway route)
# Invoked by orchestrateTalentFlowWorkflow when a provisioning bundle is APPROVED
# Reads IT_QUEUES / ROUTING_RULES / PROVISIONING_TEMPLATES from talent-flow-config
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "create_it_task" {
  name               = "it-tasks-role-createItTask"
  path               = "/talent-flow/"
  assume_role_policy = local.it_lambda_assume_role

  tags = { Component = "ITProvisioning", Ticket = "IT-001" }
}

resource "aws_iam_role_policy" "create_it_task" {
  name = "it-tasks-policy-createItTask"
  role = aws_iam_role.create_it_task.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/createItTask:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "WriteItTasksTable"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:GetItem"]
        Resource = local.it_tasks_table_arn
      },
      {
        Sid    = "ReadAdminConfig"
        Effect = "Allow"
        # Reads IT_QUEUES, ROUTING_RULES, PROVISIONING_TEMPLATES from talent-flow-config
        Action = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = [
          local.tf_config_table_arn,
          "${local.tf_config_table_arn}/index/*",
        ]
      },
      {
        Sid      = "KMS"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
        Resource = data.aws_kms_key.talent_flow.arn
      },
    ]
  })
}

resource "aws_lambda_function" "create_it_task" {
  function_name = "createItTask"
  role          = aws_iam_role.create_it_task.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 256
  timeout       = 30
  architectures = ["x86_64"]

  environment {
    variables = {
      IT_TASKS_TABLE    = local.it_tasks_table_name
      CONFIG_TABLE_NAME = "talent-flow-config"
    }
  }

  tracing_config { mode = "Active" }
  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/createItTask"
  }

  tags = { Component = "ITProvisioning", Ticket = "IT-001" }

  lifecycle { ignore_changes = [filename, source_code_hash] }
}

# Allow orchestrateTalentFlowWorkflow to invoke createItTask directly
resource "aws_lambda_permission" "orchestrate_invoke_create_it_task" {
  statement_id  = "AllowOrchestrateInvokeCreateItTask"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_it_task.function_name
  principal     = "lambda.amazonaws.com"
  source_arn    = "arn:aws:lambda:${var.aws_region}:${var.aws_account_id}:function:orchestrateTalentFlowWorkflow"
}

# ─── API Gateway integrations ─────────────────────────────────────────────────
# All 5 public routes on the existing TalentFlow API Gateway (57l0w7kk9h)

resource "aws_apigatewayv2_integration" "get_it_tasks" {
  api_id                 = data.aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_it_tasks.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "get_it_task" {
  api_id                 = data.aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_it_task.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "claim_it_task" {
  api_id                 = data.aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.claim_it_task.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "release_it_task" {
  api_id                 = data.aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.release_it_task.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "complete_it_task" {
  api_id                 = data.aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.complete_it_task.invoke_arn
  payload_format_version = "2.0"
}

# ─── Routes ───────────────────────────────────────────────────────────────────

resource "aws_apigatewayv2_route" "get_it_tasks" {
  api_id             = data.aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /v1/it/tasks"
  target             = "integrations/${aws_apigatewayv2_integration.get_it_tasks.id}"
  authorization_type = "JWT"
  authorizer_id      = local.talent_flow_cognito_authorizer_id
}

resource "aws_apigatewayv2_route" "get_it_task" {
  api_id             = data.aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /v1/it/tasks/{taskId}"
  target             = "integrations/${aws_apigatewayv2_integration.get_it_task.id}"
  authorization_type = "JWT"
  authorizer_id      = local.talent_flow_cognito_authorizer_id
}

resource "aws_apigatewayv2_route" "claim_it_task" {
  api_id             = data.aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/it/tasks/{taskId}/claim"
  target             = "integrations/${aws_apigatewayv2_integration.claim_it_task.id}"
  authorization_type = "JWT"
  authorizer_id      = local.talent_flow_cognito_authorizer_id
}

resource "aws_apigatewayv2_route" "release_it_task" {
  api_id             = data.aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/it/tasks/{taskId}/release"
  target             = "integrations/${aws_apigatewayv2_integration.release_it_task.id}"
  authorization_type = "JWT"
  authorizer_id      = local.talent_flow_cognito_authorizer_id
}

resource "aws_apigatewayv2_route" "complete_it_task" {
  api_id             = data.aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "POST /v1/it/tasks/{taskId}/complete"
  target             = "integrations/${aws_apigatewayv2_integration.complete_it_task.id}"
  authorization_type = "JWT"
  authorizer_id      = local.talent_flow_cognito_authorizer_id
}

# ─── Lambda permissions (API GW → Lambda) ────────────────────────────────────

resource "aws_lambda_permission" "apigw_get_it_tasks" {
  statement_id  = "AllowTalentFlowAPIInvokeGetItTasks"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_it_tasks.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/it/tasks"
}

resource "aws_lambda_permission" "apigw_get_it_task" {
  statement_id  = "AllowTalentFlowAPIInvokeGetItTask"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_it_task.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/it/tasks/*"
}

resource "aws_lambda_permission" "apigw_claim_it_task" {
  statement_id  = "AllowTalentFlowAPIInvokeClaimItTask"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.claim_it_task.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/it/tasks/*/claim"
}

resource "aws_lambda_permission" "apigw_release_it_task" {
  statement_id  = "AllowTalentFlowAPIInvokeReleaseItTask"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.release_it_task.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/it/tasks/*/release"
}

resource "aws_lambda_permission" "apigw_complete_it_task" {
  statement_id  = "AllowTalentFlowAPIInvokeCompleteItTask"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.complete_it_task.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/it/tasks/*/complete"
}

# ─── Patch orchestrateTalentFlowWorkflow IAM — allow invoking createItTask ────
# Add lambda:InvokeFunction on createItTask to the orchestrate Lambda's role.
# The orchestrate Lambda calls createItTask when a provisioning bundle is APPROVED.

resource "aws_iam_role_policy" "orchestrate_can_create_it_task" {
  name = "it-tasks-allow-invoke-createItTask"
  # This role was created outside Terraform; name matches the existing resource.
  role = "talent-flow-role-orchestrateTalentFlowWorkflow"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "InvokeCreateItTask"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.create_it_task.arn
      }
    ]
  })
}


# ═══════════════════════════════════════════════════════════════════════════════
# adminGetUsers  — GET /v1/admin/users
# Returns paginated list of users from talent-flow-users table (admin-only).
# Used by the Queue Management UI to populate the IT specialist multi-select.
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "admin_get_users" {
  name               = "talent-flow-role-adminGetUsers"
  path               = "/talent-flow/"
  assume_role_policy = local.it_lambda_assume_role

  tags = { Component = "ITProvisioning", Ticket = "IT-002" }
}

resource "aws_iam_role_policy" "admin_get_users" {
  name = "talent-flow-policy-adminGetUsers"
  role = aws_iam_role.admin_get_users.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/adminGetUsers:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "DynamoDBScan"
        Effect   = "Allow"
        Action   = ["dynamodb:Scan", "dynamodb:Query"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/talent-flow-users"
      },
      {
        Sid      = "KMS"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"]
        Resource = data.aws_kms_key.talent_flow.arn
      },
    ]
  })
}

resource "aws_lambda_function" "admin_get_users" {
  function_name = "adminGetUsers"
  role          = aws_iam_role.admin_get_users.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 15
  architectures = ["arm64"]

  environment {
    variables = {
      USERS_TABLE_NAME = "talent-flow-users"
    }
  }

  tracing_config { mode = "Active" }
  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/adminGetUsers"
  }

  tags = { Component = "ITProvisioning", Ticket = "IT-002" }

  lifecycle { ignore_changes = [filename, source_code_hash, architectures] }
}

resource "aws_apigatewayv2_integration" "admin_get_users" {
  api_id                 = data.aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.admin_get_users.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "admin_get_users" {
  api_id             = data.aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /v1/admin/users"
  target             = "integrations/${aws_apigatewayv2_integration.admin_get_users.id}"
  authorization_type = "JWT"
  authorizer_id      = local.talent_flow_cognito_authorizer_id
}

resource "aws_lambda_permission" "apigw_admin_get_users" {
  statement_id  = "AllowTalentFlowAPIInvokeAdminGetUsers"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.admin_get_users.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/admin/users"
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "it_tasks_table_name" {
  description = "DynamoDB table name for IT provisioning tasks"
  value       = aws_dynamodb_table.it_tasks.name
}

output "it_tasks_table_arn" {
  description = "DynamoDB table ARN for IT provisioning tasks"
  value       = aws_dynamodb_table.it_tasks.arn
}
