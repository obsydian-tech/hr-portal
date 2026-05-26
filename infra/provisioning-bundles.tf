# ---------------------------------------------------------------------------
# infra/provisioning-bundles.tf
#
# Provisioning bundle backend: DynamoDB table + 6 Lambdas + API routes
#
# Routes:
#   POST   /v1/provisioning/bundles                      → createProvisioningBundle
#   GET    /v1/provisioning/bundles                      → getProvisioningBundles
#   GET    /v1/provisioning/bundles/{bundleId}           → getProvisioningBundle
#   POST   /v1/provisioning/bundles/{bundleId}/approve   → approveProvisioningBundle
#   PATCH  /v1/provisioning/bundles/{bundleId}           → updateProvisioningBundle
#   GET    /v1/provisioning/bundles/{bundleId}/progress  → getProvisioningBundleProgress
#
# Auth: JWT Cognito authorizer (same as IT tasks — talent_flow_cognito_authorizer_id)
# ---------------------------------------------------------------------------

locals {
  bundles_table_name = "provisioning-bundles"
  bundles_table_arn  = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/${local.bundles_table_name}"
  eb_bus_arn         = "arn:aws:events:${var.aws_region}:${var.aws_account_id}:event-bus/naleko-onboarding"
  eb_bus_name        = "naleko-onboarding"
}

# ─── DynamoDB table: provisioning-bundles ────────────────────────────────────
# PK:   bundleId     (UUID, write-once)
# GSI1: byHmId       PK=hmUserId   SK=createdAt  → HM-scoped list
# GSI2: byCandidateId PK=candidateId SK=createdAt → progress + EventBridge lookup

resource "aws_dynamodb_table" "provisioning_bundles" {
  name         = local.bundles_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "bundleId"
  table_class  = "STANDARD"

  attribute {
    name = "bundleId"
    type = "S"
  }

  attribute {
    name = "hmUserId"
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

  global_secondary_index {
    name            = "byHmId"
    hash_key        = "hmUserId"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "byCandidateId"
    hash_key        = "candidateId"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  point_in_time_recovery { enabled = true }

  server_side_encryption {
    enabled     = true
    kms_key_arn = data.aws_kms_key.talent_flow.arn
  }

  tags = {
    Component          = "ITProvisioning"
    DataClassification = "Internal"
    Ticket             = "IT-003"
  }
}

# ─── Shared bundle policy fragments ──────────────────────────────────────────

locals {
  bundle_logs_base      = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda"
  bundle_kms_arn        = data.aws_kms_key.talent_flow.arn
  bundle_assume_role    = local.it_lambda_assume_role
}

# ═══════════════════════════════════════════════════════════════════════════════
# createProvisioningBundle
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "create_provisioning_bundle" {
  name               = "talent-flow-role-createProvisioningBundle"
  path               = "/talent-flow/"
  assume_role_policy = local.bundle_assume_role
  tags               = { Component = "ITProvisioning", Ticket = "IT-003" }
}

resource "aws_iam_role_policy" "create_provisioning_bundle" {
  name = "talent-flow-policy-createProvisioningBundle"
  role = aws_iam_role.create_provisioning_bundle.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], Resource = "${local.bundle_logs_base}/createProvisioningBundle:*" },
      { Sid = "XRay", Effect = "Allow", Action = ["xray:PutTraceSegments","xray:PutTelemetryRecords"], Resource = "*" },
      { Sid = "DynamoDBPut", Effect = "Allow", Action = ["dynamodb:PutItem"], Resource = local.bundles_table_arn },
      { Sid = "ConfigRead", Effect = "Allow", Action = ["dynamodb:GetItem","dynamodb:Query"], Resource = [local.tf_config_table_arn,"${local.tf_config_table_arn}/index/*"] },
      { Sid = "EventBridge", Effect = "Allow", Action = ["events:PutEvents"], Resource = local.eb_bus_arn },
      { Sid = "KMS", Effect = "Allow", Action = ["kms:Decrypt","kms:GenerateDataKey","kms:DescribeKey"], Resource = local.bundle_kms_arn },
    ]
  })
}

resource "aws_lambda_function" "create_provisioning_bundle" {
  function_name = "createProvisioningBundle"
  role          = aws_iam_role.create_provisioning_bundle.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 256
  timeout       = 15
  architectures = ["x86_64"]
  environment {
    variables = {
      BUNDLES_TABLE     = local.bundles_table_name
      CONFIG_TABLE_NAME = "talent-flow-config"
      EB_BUS_NAME       = local.eb_bus_name
    }
  }
  tracing_config { mode = "Active" }
  logging_config { log_format = "JSON"; log_group = "/aws/lambda/createProvisioningBundle" }
  tags = { Component = "ITProvisioning", Ticket = "IT-003" }
  lifecycle { ignore_changes = [filename, source_code_hash] }
}

# ═══════════════════════════════════════════════════════════════════════════════
# getProvisioningBundles
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "get_provisioning_bundles" {
  name               = "talent-flow-role-getProvisioningBundles"
  path               = "/talent-flow/"
  assume_role_policy = local.bundle_assume_role
  tags               = { Component = "ITProvisioning", Ticket = "IT-003" }
}

resource "aws_iam_role_policy" "get_provisioning_bundles" {
  name = "talent-flow-policy-getProvisioningBundles"
  role = aws_iam_role.get_provisioning_bundles.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], Resource = "${local.bundle_logs_base}/getProvisioningBundles:*" },
      { Sid = "XRay", Effect = "Allow", Action = ["xray:PutTraceSegments","xray:PutTelemetryRecords"], Resource = "*" },
      { Sid = "DynamoDBRead", Effect = "Allow", Action = ["dynamodb:Query","dynamodb:Scan"], Resource = [local.bundles_table_arn,"${local.bundles_table_arn}/index/*"] },
      { Sid = "KMS", Effect = "Allow", Action = ["kms:Decrypt","kms:GenerateDataKey","kms:DescribeKey"], Resource = local.bundle_kms_arn },
    ]
  })
}

resource "aws_lambda_function" "get_provisioning_bundles" {
  function_name = "getProvisioningBundles"
  role          = aws_iam_role.get_provisioning_bundles.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 15
  architectures = ["x86_64"]
  environment   { variables = { BUNDLES_TABLE = local.bundles_table_name } }
  tracing_config { mode = "Active" }
  logging_config { log_format = "JSON"; log_group = "/aws/lambda/getProvisioningBundles" }
  tags = { Component = "ITProvisioning", Ticket = "IT-003" }
  lifecycle { ignore_changes = [filename, source_code_hash] }
}

# ═══════════════════════════════════════════════════════════════════════════════
# getProvisioningBundle
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "get_provisioning_bundle" {
  name               = "talent-flow-role-getProvisioningBundle"
  path               = "/talent-flow/"
  assume_role_policy = local.bundle_assume_role
  tags               = { Component = "ITProvisioning", Ticket = "IT-003" }
}

resource "aws_iam_role_policy" "get_provisioning_bundle" {
  name = "talent-flow-policy-getProvisioningBundle"
  role = aws_iam_role.get_provisioning_bundle.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], Resource = "${local.bundle_logs_base}/getProvisioningBundle:*" },
      { Sid = "XRay", Effect = "Allow", Action = ["xray:PutTraceSegments","xray:PutTelemetryRecords"], Resource = "*" },
      { Sid = "DynamoDBGet", Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = local.bundles_table_arn },
      { Sid = "KMS", Effect = "Allow", Action = ["kms:Decrypt","kms:GenerateDataKey","kms:DescribeKey"], Resource = local.bundle_kms_arn },
    ]
  })
}

resource "aws_lambda_function" "get_provisioning_bundle" {
  function_name = "getProvisioningBundle"
  role          = aws_iam_role.get_provisioning_bundle.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 15
  architectures = ["x86_64"]
  environment   { variables = { BUNDLES_TABLE = local.bundles_table_name } }
  tracing_config { mode = "Active" }
  logging_config { log_format = "JSON"; log_group = "/aws/lambda/getProvisioningBundle" }
  tags = { Component = "ITProvisioning", Ticket = "IT-003" }
  lifecycle { ignore_changes = [filename, source_code_hash] }
}

# ═══════════════════════════════════════════════════════════════════════════════
# approveProvisioningBundle
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "approve_provisioning_bundle" {
  name               = "talent-flow-role-approveProvisioningBundle"
  path               = "/talent-flow/"
  assume_role_policy = local.bundle_assume_role
  tags               = { Component = "ITProvisioning", Ticket = "IT-003" }
}

resource "aws_iam_role_policy" "approve_provisioning_bundle" {
  name = "talent-flow-policy-approveProvisioningBundle"
  role = aws_iam_role.approve_provisioning_bundle.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], Resource = "${local.bundle_logs_base}/approveProvisioningBundle:*" },
      { Sid = "XRay", Effect = "Allow", Action = ["xray:PutTraceSegments","xray:PutTelemetryRecords"], Resource = "*" },
      { Sid = "DynamoDB", Effect = "Allow", Action = ["dynamodb:GetItem","dynamodb:UpdateItem"], Resource = local.bundles_table_arn },
      { Sid = "EventBridge", Effect = "Allow", Action = ["events:PutEvents"], Resource = local.eb_bus_arn },
      { Sid = "KMS", Effect = "Allow", Action = ["kms:Decrypt","kms:GenerateDataKey","kms:DescribeKey"], Resource = local.bundle_kms_arn },
    ]
  })
}

resource "aws_lambda_function" "approve_provisioning_bundle" {
  function_name = "approveProvisioningBundle"
  role          = aws_iam_role.approve_provisioning_bundle.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 15
  architectures = ["x86_64"]
  environment {
    variables = {
      BUNDLES_TABLE = local.bundles_table_name
      EB_BUS_NAME   = local.eb_bus_name
    }
  }
  tracing_config { mode = "Active" }
  logging_config { log_format = "JSON"; log_group = "/aws/lambda/approveProvisioningBundle" }
  tags = { Component = "ITProvisioning", Ticket = "IT-003" }
  lifecycle { ignore_changes = [filename, source_code_hash] }
}

# ═══════════════════════════════════════════════════════════════════════════════
# updateProvisioningBundle
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "update_provisioning_bundle" {
  name               = "talent-flow-role-updateProvisioningBundle"
  path               = "/talent-flow/"
  assume_role_policy = local.bundle_assume_role
  tags               = { Component = "ITProvisioning", Ticket = "IT-003" }
}

resource "aws_iam_role_policy" "update_provisioning_bundle" {
  name = "talent-flow-policy-updateProvisioningBundle"
  role = aws_iam_role.update_provisioning_bundle.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], Resource = "${local.bundle_logs_base}/updateProvisioningBundle:*" },
      { Sid = "XRay", Effect = "Allow", Action = ["xray:PutTraceSegments","xray:PutTelemetryRecords"], Resource = "*" },
      { Sid = "DynamoDB", Effect = "Allow", Action = ["dynamodb:GetItem","dynamodb:UpdateItem"], Resource = local.bundles_table_arn },
      { Sid = "KMS", Effect = "Allow", Action = ["kms:Decrypt","kms:GenerateDataKey","kms:DescribeKey"], Resource = local.bundle_kms_arn },
    ]
  })
}

resource "aws_lambda_function" "update_provisioning_bundle" {
  function_name = "updateProvisioningBundle"
  role          = aws_iam_role.update_provisioning_bundle.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 15
  architectures = ["x86_64"]
  environment   { variables = { BUNDLES_TABLE = local.bundles_table_name } }
  tracing_config { mode = "Active" }
  logging_config { log_format = "JSON"; log_group = "/aws/lambda/updateProvisioningBundle" }
  tags = { Component = "ITProvisioning", Ticket = "IT-003" }
  lifecycle { ignore_changes = [filename, source_code_hash] }
}

# ═══════════════════════════════════════════════════════════════════════════════
# getProvisioningBundleProgress
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role" "get_provisioning_bundle_progress" {
  name               = "talent-flow-role-getProvisioningBundleProgress"
  path               = "/talent-flow/"
  assume_role_policy = local.bundle_assume_role
  tags               = { Component = "ITProvisioning", Ticket = "IT-003" }
}

resource "aws_iam_role_policy" "get_provisioning_bundle_progress" {
  name = "talent-flow-policy-getProvisioningBundleProgress"
  role = aws_iam_role.get_provisioning_bundle_progress.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogGroup","logs:CreateLogStream","logs:PutLogEvents"], Resource = "${local.bundle_logs_base}/getProvisioningBundleProgress:*" },
      { Sid = "XRay", Effect = "Allow", Action = ["xray:PutTraceSegments","xray:PutTelemetryRecords"], Resource = "*" },
      { Sid = "DynamoDBBundle", Effect = "Allow", Action = ["dynamodb:GetItem"], Resource = local.bundles_table_arn },
      { Sid = "DynamoDBItTasks", Effect = "Allow", Action = ["dynamodb:Query"], Resource = [local.it_tasks_table_arn,"${local.it_tasks_table_arn}/index/byCandidateId"] },
      { Sid = "KMS", Effect = "Allow", Action = ["kms:Decrypt","kms:GenerateDataKey","kms:DescribeKey"], Resource = local.bundle_kms_arn },
    ]
  })
}

resource "aws_lambda_function" "get_provisioning_bundle_progress" {
  function_name = "getProvisioningBundleProgress"
  role          = aws_iam_role.get_provisioning_bundle_progress.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 15
  architectures = ["x86_64"]
  environment {
    variables = {
      BUNDLES_TABLE  = local.bundles_table_name
      IT_TASKS_TABLE = local.it_tasks_table_name
    }
  }
  tracing_config { mode = "Active" }
  logging_config { log_format = "JSON"; log_group = "/aws/lambda/getProvisioningBundleProgress" }
  tags = { Component = "ITProvisioning", Ticket = "IT-003" }
  lifecycle { ignore_changes = [filename, source_code_hash] }
}

# ─── API Gateway integrations ─────────────────────────────────────────────────

resource "aws_apigatewayv2_integration" "create_provisioning_bundle" {
  api_id = data.aws_apigatewayv2_api.talent_flow_api.id; integration_type = "AWS_PROXY"
  integration_uri = aws_lambda_function.create_provisioning_bundle.invoke_arn; payload_format_version = "2.0"
}
resource "aws_apigatewayv2_integration" "get_provisioning_bundles" {
  api_id = data.aws_apigatewayv2_api.talent_flow_api.id; integration_type = "AWS_PROXY"
  integration_uri = aws_lambda_function.get_provisioning_bundles.invoke_arn; payload_format_version = "2.0"
}
resource "aws_apigatewayv2_integration" "get_provisioning_bundle" {
  api_id = data.aws_apigatewayv2_api.talent_flow_api.id; integration_type = "AWS_PROXY"
  integration_uri = aws_lambda_function.get_provisioning_bundle.invoke_arn; payload_format_version = "2.0"
}
resource "aws_apigatewayv2_integration" "approve_provisioning_bundle" {
  api_id = data.aws_apigatewayv2_api.talent_flow_api.id; integration_type = "AWS_PROXY"
  integration_uri = aws_lambda_function.approve_provisioning_bundle.invoke_arn; payload_format_version = "2.0"
}
resource "aws_apigatewayv2_integration" "update_provisioning_bundle" {
  api_id = data.aws_apigatewayv2_api.talent_flow_api.id; integration_type = "AWS_PROXY"
  integration_uri = aws_lambda_function.update_provisioning_bundle.invoke_arn; payload_format_version = "2.0"
}
resource "aws_apigatewayv2_integration" "get_provisioning_bundle_progress" {
  api_id = data.aws_apigatewayv2_api.talent_flow_api.id; integration_type = "AWS_PROXY"
  integration_uri = aws_lambda_function.get_provisioning_bundle_progress.invoke_arn; payload_format_version = "2.0"
}

# ─── API Gateway routes ───────────────────────────────────────────────────────

resource "aws_apigatewayv2_route" "create_provisioning_bundle" {
  api_id = data.aws_apigatewayv2_api.talent_flow_api.id; route_key = "POST /v1/provisioning/bundles"
  target = "integrations/${aws_apigatewayv2_integration.create_provisioning_bundle.id}"
  authorization_type = "JWT"; authorizer_id = local.talent_flow_cognito_authorizer_id
}
resource "aws_apigatewayv2_route" "get_provisioning_bundles" {
  api_id = data.aws_apigatewayv2_api.talent_flow_api.id; route_key = "GET /v1/provisioning/bundles"
  target = "integrations/${aws_apigatewayv2_integration.get_provisioning_bundles.id}"
  authorization_type = "JWT"; authorizer_id = local.talent_flow_cognito_authorizer_id
}
resource "aws_apigatewayv2_route" "get_provisioning_bundle" {
  api_id = data.aws_apigatewayv2_api.talent_flow_api.id; route_key = "GET /v1/provisioning/bundles/{bundleId}"
  target = "integrations/${aws_apigatewayv2_integration.get_provisioning_bundle.id}"
  authorization_type = "JWT"; authorizer_id = local.talent_flow_cognito_authorizer_id
}
resource "aws_apigatewayv2_route" "approve_provisioning_bundle" {
  api_id = data.aws_apigatewayv2_api.talent_flow_api.id; route_key = "POST /v1/provisioning/bundles/{bundleId}/approve"
  target = "integrations/${aws_apigatewayv2_integration.approve_provisioning_bundle.id}"
  authorization_type = "JWT"; authorizer_id = local.talent_flow_cognito_authorizer_id
}
resource "aws_apigatewayv2_route" "update_provisioning_bundle" {
  api_id = data.aws_apigatewayv2_api.talent_flow_api.id; route_key = "PATCH /v1/provisioning/bundles/{bundleId}"
  target = "integrations/${aws_apigatewayv2_integration.update_provisioning_bundle.id}"
  authorization_type = "JWT"; authorizer_id = local.talent_flow_cognito_authorizer_id
}
resource "aws_apigatewayv2_route" "get_provisioning_bundle_progress" {
  api_id = data.aws_apigatewayv2_api.talent_flow_api.id; route_key = "GET /v1/provisioning/bundles/{bundleId}/progress"
  target = "integrations/${aws_apigatewayv2_integration.get_provisioning_bundle_progress.id}"
  authorization_type = "JWT"; authorizer_id = local.talent_flow_cognito_authorizer_id
}

# ─── Lambda permissions (API GW invoke) ──────────────────────────────────────

resource "aws_lambda_permission" "apigw_create_provisioning_bundle" {
  statement_id  = "AllowTFAPIInvokeCreateBundle"; action = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_provisioning_bundle.function_name; principal = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/provisioning/bundles"
}
resource "aws_lambda_permission" "apigw_get_provisioning_bundles" {
  statement_id  = "AllowTFAPIInvokeGetBundles"; action = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_provisioning_bundles.function_name; principal = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/provisioning/bundles"
}
resource "aws_lambda_permission" "apigw_get_provisioning_bundle" {
  statement_id  = "AllowTFAPIInvokeGetBundle"; action = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_provisioning_bundle.function_name; principal = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/provisioning/bundles/*"
}
resource "aws_lambda_permission" "apigw_approve_provisioning_bundle" {
  statement_id  = "AllowTFAPIInvokeApproveBundle"; action = "lambda:InvokeFunction"
  function_name = aws_lambda_function.approve_provisioning_bundle.function_name; principal = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/provisioning/bundles/*/approve"
}
resource "aws_lambda_permission" "apigw_update_provisioning_bundle" {
  statement_id  = "AllowTFAPIInvokeUpdateBundle"; action = "lambda:InvokeFunction"
  function_name = aws_lambda_function.update_provisioning_bundle.function_name; principal = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/provisioning/bundles/*"
}
resource "aws_lambda_permission" "apigw_get_provisioning_bundle_progress" {
  statement_id  = "AllowTFAPIInvokeGetBundleProgress"; action = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_provisioning_bundle_progress.function_name; principal = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*/v1/provisioning/bundles/*/progress"
}

# ─── Outputs ──────────────────────────────────────────────────────────────────

output "provisioning_bundles_table_name" {
  description = "DynamoDB table name for provisioning bundles"
  value       = aws_dynamodb_table.provisioning_bundles.name
}
