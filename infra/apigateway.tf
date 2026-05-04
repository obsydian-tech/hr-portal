# ---------------------------------------------------------------------------
# API Gateway v2 (HTTP APIs) — NH-11 Terraform import
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "employees_api" {
  name                       = "employees"
  protocol_type              = "HTTP"
  route_selection_expression = "$request.method $request.path"

  cors_configuration {
    allow_credentials = false
    allow_headers     = ["authorization", "content-type"]
    allow_methods     = ["GET", "OPTIONS", "POST"]
    allow_origins     = ["http://localhost:4200", "https://hr-portal-beryl-three.vercel.app"]
    expose_headers    = []
    max_age           = 86400
  }
}

resource "aws_apigatewayv2_api" "document_upload_api" {
  name                       = "document-upload-api"
  protocol_type              = "HTTP"
  route_selection_expression = "$request.method $request.path"

  cors_configuration {
    allow_credentials = false
    allow_headers     = ["authorization", "content-type"]
    allow_methods     = ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"]
    allow_origins     = ["http://localhost:4200", "https://hr-portal-beryl-three.vercel.app"]
    expose_headers    = ["*"]
    max_age           = 3600
  }
}

# ---------------------------------------------------------------------------
# Cognito JWT Authorizers — NH-5
# Both APIs share the same Cognito User Pool and app client audience.
# Identity source: Authorization: Bearer <cognito-jwt>
# ---------------------------------------------------------------------------

locals {
  cognito_issuer   = "https://cognito-idp.af-south-1.amazonaws.com/af-south-1_2LdAGFnw2"
  cognito_audience = ["1pk5rd58glsohfplnlr63tg0qb"]
}

resource "aws_apigatewayv2_authorizer" "employees_api_cognito" {
  api_id           = aws_apigatewayv2_api.employees_api.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-jwt"

  jwt_configuration {
    audience = local.cognito_audience
    issuer   = local.cognito_issuer
  }
}

resource "aws_apigatewayv2_authorizer" "document_upload_api_cognito" {
  api_id           = aws_apigatewayv2_api.document_upload_api.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-jwt"

  jwt_configuration {
    audience = local.cognito_audience
    issuer   = local.cognito_issuer
  }
}

# ---------------------------------------------------------------------------
# API Gateway $default stages — NH-33 X-Ray tracing
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_stage" "employees_api_default" {
  api_id      = aws_apigatewayv2_api.employees_api.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }

  lifecycle {
    ignore_changes = [deployment_id]
  }
}

resource "aws_apigatewayv2_stage" "document_upload_api_default" {
  api_id      = aws_apigatewayv2_api.document_upload_api.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }

  lifecycle {
    ignore_changes = [deployment_id]
  }
}

# ---------------------------------------------------------------------------
# NH-12: POST /employees/{employee_id}/documents/upload-url
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_integration" "generate_document_upload_url" {
  api_id                 = aws_apigatewayv2_api.document_upload_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.generate_document_upload_url.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "generate_document_upload_url" {
  api_id             = aws_apigatewayv2_api.document_upload_api.id
  route_key          = "POST /v1/employees/{employee_id}/documents/upload-url"
  target             = "integrations/${aws_apigatewayv2_integration.generate_document_upload_url.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.document_upload_api_cognito.id
}

resource "aws_lambda_permission" "generate_document_upload_url" {
  statement_id  = "AllowDocumentUploadAPIInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.generate_document_upload_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.document_upload_api.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# NH-13: GET /employees/by-email?email=  (employees_api)
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_integration" "get_employee_by_email" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_employee_by_email.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_employee_by_email" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "GET /v1/employees/by-email"
  target             = "integrations/${aws_apigatewayv2_integration.get_employee_by_email.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_lambda_permission" "get_employee_by_email" {
  statement_id  = "AllowEmployeesAPIInvokeByEmail"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_employee_by_email.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# NH-13: POST /verifications/{id}/external  (document_upload_api)
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_integration" "trigger_external_verification" {
  api_id                 = aws_apigatewayv2_api.document_upload_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.trigger_external_verification.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "trigger_external_verification" {
  api_id             = aws_apigatewayv2_api.document_upload_api.id
  route_key          = "POST /v1/verifications/{id}/external"
  target             = "integrations/${aws_apigatewayv2_integration.trigger_external_verification.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.document_upload_api_cognito.id
}

resource "aws_lambda_permission" "trigger_external_verification" {
  statement_id  = "AllowDocumentUploadAPIInvokeExternal"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.trigger_external_verification.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.document_upload_api.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# NH-13: GET /docs and GET /openapi.yaml  (employees_api, NO auth)
# Both routes are served by a single serveDocs Lambda.
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_integration" "serve_docs" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.serve_docs.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "serve_docs" {
  api_id    = aws_apigatewayv2_api.employees_api.id
  route_key = "GET /docs"
  target    = "integrations/${aws_apigatewayv2_integration.serve_docs.id}"
  # No authorizer — public endpoint
}

resource "aws_apigatewayv2_route" "serve_openapi_spec" {
  api_id    = aws_apigatewayv2_api.employees_api.id
  route_key = "GET /openapi.yaml"
  target    = "integrations/${aws_apigatewayv2_integration.serve_docs.id}"
  # No authorizer — public endpoint
}

resource "aws_lambda_permission" "serve_docs" {
  statement_id  = "AllowEmployeesAPIInvokeServeDocs"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.serve_docs.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# NH-29: /v1/ versioned routes — employees_api
# ---------------------------------------------------------------------------

# GET /v1/employees
resource "aws_apigatewayv2_integration" "get_employees" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_employees.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_employees" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "GET /v1/employees"
  target             = "integrations/${aws_apigatewayv2_integration.get_employees.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_lambda_permission" "get_employees" {
  statement_id  = "AllowEmployeesAPIInvokeGetEmployees"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_employees.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

# POST /v1/employees
resource "aws_apigatewayv2_integration" "create_employee" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.create_employee.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "create_employee" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "POST /v1/employees"
  target             = "integrations/${aws_apigatewayv2_integration.create_employee.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_lambda_permission" "create_employee" {
  statement_id  = "AllowEmployeesAPIInvokeCreateEmployee"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_employee.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

# GET /v1/employees/lookup  (no auth — used by login flow before JWT is available)
resource "aws_apigatewayv2_integration" "lookup_employee_email" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.lookup_employee_email.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "lookup_employee_email" {
  api_id    = aws_apigatewayv2_api.employees_api.id
  route_key = "GET /v1/employees/lookup"
  target    = "integrations/${aws_apigatewayv2_integration.lookup_employee_email.id}"
  # No authorizer — public endpoint (resolves employeeId → email before login)
}

resource "aws_lambda_permission" "lookup_employee_email" {
  statement_id  = "AllowEmployeesAPIInvokeLookup"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.lookup_employee_email.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# NH-29: /v1/ versioned routes — document_upload_api
# ---------------------------------------------------------------------------

# GET /v1/verifications
resource "aws_apigatewayv2_integration" "get_document_verifications" {
  api_id                 = aws_apigatewayv2_api.document_upload_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_document_verifications.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_document_verifications" {
  api_id             = aws_apigatewayv2_api.document_upload_api.id
  route_key          = "GET /v1/verifications"
  target             = "integrations/${aws_apigatewayv2_integration.get_document_verifications.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.document_upload_api_cognito.id
}

resource "aws_lambda_permission" "get_document_verifications" {
  statement_id  = "AllowDocAPIInvokeGetVerifications"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_document_verifications.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.document_upload_api.execution_arn}/*/*"
}

# GET /v1/verifications/{id}
resource "aws_apigatewayv2_integration" "get_single_document_verification" {
  api_id                 = aws_apigatewayv2_api.document_upload_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_single_document_verification.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_single_document_verification" {
  api_id             = aws_apigatewayv2_api.document_upload_api.id
  route_key          = "GET /v1/verifications/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.get_single_document_verification.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.document_upload_api_cognito.id
}

resource "aws_lambda_permission" "get_single_document_verification" {
  statement_id  = "AllowDocAPIInvokeGetSingleVerification"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_single_document_verification.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.document_upload_api.execution_arn}/*/*"
}

# GET /v1/employees/{id}/verifications
resource "aws_apigatewayv2_integration" "get_employee_document_verifications" {
  api_id                 = aws_apigatewayv2_api.document_upload_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_employee_document_verifications.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_employee_document_verifications" {
  api_id             = aws_apigatewayv2_api.document_upload_api.id
  route_key          = "GET /v1/employees/{id}/verifications"
  target             = "integrations/${aws_apigatewayv2_integration.get_employee_document_verifications.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.document_upload_api_cognito.id
}

resource "aws_lambda_permission" "get_employee_document_verifications" {
  statement_id  = "AllowDocAPIInvokeGetEmpVerifications"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_employee_document_verifications.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.document_upload_api.execution_arn}/*/*"
}

# GET /v1/documents/{id}/url  (presigned download/preview URL)
resource "aws_apigatewayv2_integration" "get_document_presigned_url" {
  api_id                 = aws_apigatewayv2_api.document_upload_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_document_presigned_url.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_document_presigned_url" {
  api_id             = aws_apigatewayv2_api.document_upload_api.id
  route_key          = "GET /v1/documents/{id}/url"
  target             = "integrations/${aws_apigatewayv2_integration.get_document_presigned_url.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.document_upload_api_cognito.id
}

resource "aws_lambda_permission" "get_document_presigned_url" {
  statement_id  = "AllowDocAPIInvokePresignedUrl"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_document_presigned_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.document_upload_api.execution_arn}/*/*"
}

# NH-40: GET /v1/verifications/{id}/summary  (Bedrock AI summariser)
resource "aws_apigatewayv2_integration" "summarise_verification" {
  api_id                 = aws_apigatewayv2_api.document_upload_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.summarise_verification.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "summarise_verification" {
  api_id             = aws_apigatewayv2_api.document_upload_api.id
  route_key          = "GET /v1/verifications/{id}/summary"
  target             = "integrations/${aws_apigatewayv2_integration.summarise_verification.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.document_upload_api_cognito.id
}

resource "aws_lambda_permission" "summarise_verification" {
  statement_id  = "AllowDocAPIInvokeSummariseVerification"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.summarise_verification.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.document_upload_api.execution_arn}/*/*"
}

# PATCH /v1/verifications/{id}/review
resource "aws_apigatewayv2_integration" "review_document_verification" {
  api_id                 = aws_apigatewayv2_api.document_upload_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.review_document_verification.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "review_document_verification" {
  api_id             = aws_apigatewayv2_api.document_upload_api.id
  route_key          = "PATCH /v1/verifications/{id}/review"
  target             = "integrations/${aws_apigatewayv2_integration.review_document_verification.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.document_upload_api_cognito.id
}

resource "aws_lambda_permission" "review_document_verification" {
  statement_id  = "AllowDocAPIInvokeReviewVerification"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.review_document_verification.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.document_upload_api.execution_arn}/*/*"
}

# NH-41: POST /v1/employees/{id}/assess-risk  (Bedrock risk classifier)
resource "aws_apigatewayv2_integration" "classify_onboarding_risk" {
  api_id                 = aws_apigatewayv2_api.document_upload_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.classify_onboarding_risk.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "classify_onboarding_risk" {
  api_id             = aws_apigatewayv2_api.document_upload_api.id
  route_key          = "POST /v1/employees/{id}/assess-risk"
  target             = "integrations/${aws_apigatewayv2_integration.classify_onboarding_risk.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.document_upload_api_cognito.id
}

resource "aws_lambda_permission" "classify_onboarding_risk" {
  statement_id  = "AllowDocAPIInvokeClassifyOnboardingRisk"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.classify_onboarding_risk.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.document_upload_api.execution_arn}/*/*"
}
