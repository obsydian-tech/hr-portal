# ---------------------------------------------------------------------------
# Lambda Functions
# Code source is managed outside Terraform (direct console/CI deploys).
# We track configuration only; filename/source_code_hash are ignored.
# NH-10: KMS_KEY_ARN injected into every Lambda that handles PII.
# ---------------------------------------------------------------------------

# Postmark API token — stored in SSM SecureString; never hardcoded in .tf files.
# To rotate: aws ssm put-parameter --name /naleko/postmark/api_token --value NEW_TOKEN
#            --type SecureString --overwrite --region af-south-1
data "aws_ssm_parameter" "postmark_token" {
  name            = "/naleko/postmark/api_token"
  with_decryption = true
}

locals {
  # Retained for the AWS Config region-enforcement Lambda in config.tf
  lambda_role_arn = "arn:aws:iam::937137806477:role/doc-verification-lambda-role"
  placeholder_zip = "${path.root}/../placeholder.zip"
}

resource "aws_lambda_function" "create_employee" {
  function_name = "createEmployee"
  role          = aws_iam_role.create_employee.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 256
  timeout       = 15
  architectures = ["x86_64"]

  environment {
    variables = {
      POSTMARK_API_TOKEN    = data.aws_ssm_parameter.postmark_token.value
      POSTMARK_SENDER_EMAIL = "ignecious@obsydiantechnologies.com"
      LOGIN_URL             = "https://hr-portal-beryl-three.vercel.app/login"
      KMS_KEY_ARN           = module.kms_pii.key_arn
      EVENT_BUS_NAME        = aws_cloudwatch_event_bus.naleko_onboarding.name
      IDEMPOTENCY_TABLE     = aws_dynamodb_table.idempotency_keys.name
      # NH-42: ARN injected so createEmployee can start the onboarding execution
      SFN_STATE_MACHINE_ARN = aws_sfn_state_machine.onboarding.arn
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/createEmployee"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_function" "get_employees" {
  function_name = "getEmployees"
  role          = aws_iam_role.get_employees.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 30
  architectures = ["x86_64"]

  environment {
    variables = {
      KMS_KEY_ARN = module.kms_pii.key_arn
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getEmployees"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_function" "upload_document_to_s3" {
  function_name = "uploadDocumentToS3"
  role          = aws_iam_role.upload_document_to_s3.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 512
  timeout       = 30
  architectures = ["x86_64"]

  environment {
    variables = {
      KMS_KEY_ARN       = module.kms_pii.key_arn
      IDEMPOTENCY_TABLE = aws_dynamodb_table.idempotency_keys.name
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/uploadDocumentToS3"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_function" "process_document_ocr" {
  function_name = "processDocumentOCR"
  role          = aws_iam_role.process_document_ocr.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 512
  timeout       = 60
  architectures = ["x86_64"]

  environment {
    variables = {
      KMS_KEY_ARN    = module.kms_pii.key_arn
      EVENT_BUS_NAME = aws_cloudwatch_event_bus.naleko_onboarding.name
      # NH-42: read sfn_task_token from employee record to signal Step Functions
      EMPLOYEES_TABLE = aws_dynamodb_table.employees.name
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/processDocumentOCR"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_function" "get_document_verifications" {
  function_name = "getDocumentVerifications"
  role          = aws_iam_role.get_document_verifications.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 30
  architectures = ["x86_64"]

  environment {
    variables = {
      KMS_KEY_ARN = module.kms_pii.key_arn
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getDocumentVerifications"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_function" "get_single_document_verification" {
  function_name = "getSingleDocumentVerification"
  role          = aws_iam_role.get_single_document_verification.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 30
  architectures = ["x86_64"]

  environment {
    variables = {
      KMS_KEY_ARN = module.kms_pii.key_arn
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getSingleDocumentVerification"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_function" "get_employee_document_verifications" {
  function_name = "getEmployeeDocumentVerifications"
  role          = aws_iam_role.get_employee_document_verifications.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 30
  architectures = ["x86_64"]

  environment {
    variables = {
      KMS_KEY_ARN = module.kms_pii.key_arn
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getEmployeeDocumentVerifications"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_function" "review_document_verification" {
  function_name = "reviewDocumentVerification"
  role          = aws_iam_role.review_document_verification.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 256
  timeout       = 15
  architectures = ["x86_64"]

  environment {
    variables = {
      KMS_KEY_ARN       = module.kms_pii.key_arn
      EVENT_BUS_NAME    = aws_cloudwatch_event_bus.naleko_onboarding.name
      IDEMPOTENCY_TABLE = aws_dynamodb_table.idempotency_keys.name
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/reviewDocumentVerification"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_function" "lookup_employee_email" {
  function_name = "lookupEmployeeEmail"
  role          = aws_iam_role.lookup_employee_email.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 30
  architectures = ["x86_64"]

  environment {
    variables = {
      KMS_KEY_ARN = module.kms_pii.key_arn
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/lookupEmployeeEmail"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

resource "aws_lambda_function" "get_document_presigned_url" {
  function_name = "getDocumentPresignedUrl"
  role          = aws_iam_role.get_document_presigned_url.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 10
  architectures = ["x86_64"]

  environment {
    variables = {
      KMS_KEY_ARN = module.kms_pii.key_arn
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getDocumentPresignedUrl"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# ─── NH-12: generateDocumentUploadUrl ───────────────────────────────────────
resource "aws_lambda_function" "generate_document_upload_url" {
  function_name = "generateDocumentUploadUrl"
  role          = aws_iam_role.generate_document_upload_url.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 10
  architectures = ["x86_64"]

  environment {
    variables = {
      KMS_KEY_ARN = module.kms_pii.key_arn
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/generateDocumentUploadUrl"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# ─── NH-13: getEmployeeByEmail ────────────────────────────────────────────────
resource "aws_lambda_function" "get_employee_by_email" {
  function_name = "getEmployeeByEmail"
  role          = aws_iam_role.get_employee_by_email.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 5
  architectures = ["x86_64"]

  environment {
    variables = {
      KMS_KEY_ARN = module.kms_pii.key_arn
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getEmployeeByEmail"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# ─── NH-13: triggerExternalVerification ──────────────────────────────────────
resource "aws_lambda_function" "trigger_external_verification" {
  function_name = "triggerExternalVerification"
  role          = aws_iam_role.trigger_external_verification.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 10
  architectures = ["x86_64"]

  environment {
    variables = {
      KMS_KEY_ARN = module.kms_pii.key_arn
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/triggerExternalVerification"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# ─── NH-13-swagger: serveDocs (GET /docs + GET /openapi.yaml) ────────────────
resource "aws_lambda_function" "serve_docs" {
  function_name = "serveDocs"
  role          = aws_iam_role.serve_docs.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 5
  architectures = ["x86_64"]

  environment {
    variables = {
      # Injected so Swagger UI HTML knows the full URL of /openapi.yaml
      API_ENDPOINT = aws_apigatewayv2_api.employees_api.api_endpoint
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/serveDocs"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}
# ─── NH-45: serveAgentManifest (serves api/agent-tools.json) ─────────────────
resource "aws_lambda_function" "serve_agent_manifest" {
  function_name = "serveAgentManifest"
  role          = aws_iam_role.serve_agent_manifest.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 5
  architectures = ["x86_64"]

  # No env vars — reads bundled tools.json copied from api/agent-tools.json at deploy time

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/serveAgentManifest"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}
# ─── NH-40: summariseVerification (Bedrock Claude 3 Haiku — GET /v1/verifications/{id}/summary) ──
resource "aws_lambda_function" "summarise_verification" {
  function_name = "summariseVerification"
  role          = aws_iam_role.summarise_verification.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 256
  timeout       = 30 # Bedrock inference can take up to ~10s; 30s gives headroom
  architectures = ["x86_64"]

  environment {
    variables = {
      VERIFICATIONS_TABLE = aws_dynamodb_table.document_verification.name
      BEDROCK_MODEL_ID    = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
      KMS_KEY_ARN         = module.kms_pii.key_arn
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/summariseVerification"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# ─── NH-27: auditLogConsumer (EventBridge -> DynamoDB audit log) ─────────────
resource "aws_lambda_function" "audit_log_consumer" {
  function_name = "auditLogConsumer"
  role          = aws_iam_role.audit_log_consumer.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 30
  architectures = ["x86_64"]

  environment {
    variables = {
      AUDIT_TABLE_NAME = aws_dynamodb_table.onboarding_events.name
      EVENT_BUS_NAME   = aws_cloudwatch_event_bus.naleko_onboarding.name
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/auditLogConsumer"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# ─── NH-41: classifyOnboardingRisk (Bedrock risk classifier) ─────────────────
resource "aws_lambda_function" "classify_onboarding_risk" {
  function_name = "classifyOnboardingRisk"
  role          = aws_iam_role.classify_onboarding_risk.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 256
  timeout       = 30 # Bedrock inference can take up to ~10s; 30s gives headroom
  architectures = ["x86_64"]

  environment {
    variables = {
      VERIFICATIONS_TABLE = aws_dynamodb_table.document_verification.name
      EMPLOYEES_TABLE     = aws_dynamodb_table.employees.name
      BEDROCK_MODEL_ID    = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
      KMS_KEY_ARN         = module.kms_pii.key_arn
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/classifyOnboardingRisk"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# ─── NH-notification-emails: sendNotificationEmail ───────────────────────────
# Triggered by EventBridge events: document.reviewed + onboarding.completed
# Sends Postmark emails to employees (PASSED/FAILED/onboarding complete) and HR (MANUAL_REVIEW)
resource "aws_lambda_function" "send_notification_email" {
  function_name = "sendNotificationEmail"
  role          = aws_iam_role.send_notification_email.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 30
  architectures = ["x86_64"]

  environment {
    variables = {
      POSTMARK_API_TOKEN    = data.aws_ssm_parameter.postmark_token.value
      POSTMARK_SENDER_EMAIL = "ignecious@obsydiantechnologies.com"
      HR_EMAIL              = "ignecious@obsydiantechnologies.com"
      EMPLOYEES_TABLE       = aws_dynamodb_table.employees.name
      DOCUMENTS_TABLE       = aws_dynamodb_table.documents.name
      LOGIN_URL             = "https://hr-portal-beryl-three.vercel.app/login"
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/sendNotificationEmail"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}
# ─── NH-43: agentAuthorizer (HTTP API key Lambda authorizer) ─────────────────
resource "aws_lambda_function" "agent_api_authorizer" {
  function_name = "agentAuthorizer"
  role          = aws_iam_role.agent_api_authorizer.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 5
  architectures = ["x86_64"]

  environment {
    variables = {
      AGENT_API_KEY_SECRET_NAME = aws_secretsmanager_secret.agent_api_key.name
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/agentAuthorizer"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# ─── NH-43: getEmployee (single employee lookup for agent namespace) ──────────
resource "aws_lambda_function" "get_employee" {
  function_name = "getEmployee"
  role          = aws_iam_role.get_employee.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 15
  architectures = ["x86_64"]

  environment {
    variables = {
      EMPLOYEES_TABLE = aws_dynamodb_table.employees.name
      KMS_KEY_ARN     = module.kms_pii.key_arn
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getEmployee"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# ─── NH-43: queryAuditLog (agent read of onboarding-events table) ─────────────
resource "aws_lambda_function" "query_audit_log" {
  function_name = "queryAuditLog"
  role          = aws_iam_role.query_audit_log.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 15
  architectures = ["x86_64"]

  environment {
    variables = {
      AUDIT_TABLE = aws_dynamodb_table.onboarding_events.name
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/queryAuditLog"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}