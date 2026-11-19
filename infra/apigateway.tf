# ---------------------------------------------------------------------------
# API Gateway v2 (HTTP APIs) — NH-11 Terraform import
# ---------------------------------------------------------------------------

# Browser origins both APIs accept. The new app (pepla-web) runs on port 4300 in the pepla-dev test job, so
# those two addresses are allowed outside prod only. Prod keeps exactly today's list.
#
# OPS-01: pepla-dev's own web address (web-dev.tf) is added the same way, outside prod only, through
# web_dev_origin. CloudFront chooses that address when it first creates the distribution, so it cannot be
# written before then. Until it is, the value is empty and compact() leaves it out. One line fills it in
# (the web_dev_address output of the first dev apply, as https://<id>.cloudfront.net, no slash at the end).
# It is a literal and not a reference to the distribution because the locked ONB-02 AC-11 check reads this
# expression as plain text; the S3 uploads bucket (s3.tf) has no such limit and uses the reference.
locals {
  web_dev_origin      = "https://df2hrxausiknc.cloudfront.net"
  api_allowed_origins = concat(["http://localhost:4200", "https://hr-portal-beryl-three.vercel.app"], var.environment != "prod" ? concat(["http://localhost:4300", "http://127.0.0.1:4300"], compact([local.web_dev_origin])) : [])
}

resource "aws_apigatewayv2_api" "employees_api" {
  name                       = "employees"
  protocol_type              = "HTTP"
  route_selection_expression = "$request.method $request.path"

  cors_configuration {
    allow_credentials = false
    allow_headers     = ["authorization", "content-type", "idempotency-key"]
    allow_methods     = ["GET", "OPTIONS", "POST", "PUT"]
    allow_origins     = local.api_allowed_origins
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
    allow_headers     = ["authorization", "content-type", "idempotency-key"]
    allow_methods     = ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"]
    allow_origins     = local.api_allowed_origins
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
  cognito_issuer   = "https://${aws_cognito_user_pool.naleko_dev.endpoint}"
  cognito_audience = [local.naleko_web_client_id]
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

  # ONB-04: the two public invite routes
  route_settings {
    route_key              = "POST /v1/invites/lookup"
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }

  route_settings {
    route_key              = "POST /v1/invites/redeem"
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }

  # ONB-18: resend
  route_settings {
    route_key              = "POST /v1/employees/{id}/invite"
    throttling_burst_limit = 10
    throttling_rate_limit  = 5
  }

  # A route setting needs its route to exist first, or the first apply fails
  # with "Unable to find Route by key".
  depends_on = [
    aws_apigatewayv2_route.lookup_invite,
    aws_apigatewayv2_route.redeem_invite,
    aws_apigatewayv2_route.resend_invite,
  ]

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
# ONB-03: GET /v1/hr-partners and GET /v1/employees/email-check  (employees_api)
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_integration" "get_hr_partners" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_hr_partners.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_hr_partners" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "GET /v1/hr-partners"
  target             = "integrations/${aws_apigatewayv2_integration.get_hr_partners.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_lambda_permission" "get_hr_partners" {
  statement_id  = "AllowEmployeesAPIInvokeGetHrPartners"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_hr_partners.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

resource "aws_apigatewayv2_integration" "check_employee_email" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.check_employee_email.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "check_employee_email" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "GET /v1/employees/email-check"
  target             = "integrations/${aws_apigatewayv2_integration.check_employee_email.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_lambda_permission" "check_employee_email" {
  statement_id  = "AllowEmployeesAPIInvokeCheckEmployeeEmail"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.check_employee_email.function_name
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

# ONB-04: POST /v1/invites/lookup  (employees_api, public: the person has no sign-in yet)
resource "aws_apigatewayv2_integration" "lookup_invite" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.lookup_invite.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "lookup_invite" {
  api_id    = aws_apigatewayv2_api.employees_api.id
  route_key = "POST /v1/invites/lookup"
  target    = "integrations/${aws_apigatewayv2_integration.lookup_invite.id}"
}

resource "aws_lambda_permission" "lookup_invite" {
  statement_id  = "AllowEmployeesAPIInvokeLookupInvite"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.lookup_invite.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

# ONB-04: POST /v1/invites/redeem  (employees_api, public: the person has no sign-in yet)
resource "aws_apigatewayv2_integration" "redeem_invite" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.redeem_invite.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "redeem_invite" {
  api_id    = aws_apigatewayv2_api.employees_api.id
  route_key = "POST /v1/invites/redeem"
  target    = "integrations/${aws_apigatewayv2_integration.redeem_invite.id}"
}

resource "aws_lambda_permission" "redeem_invite" {
  statement_id  = "AllowEmployeesAPIInvokeRedeemInvite"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.redeem_invite.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

# ONB-05: GET /v1/me  (employees_api, Cognito JWT: only a signed-in employee)
resource "aws_apigatewayv2_integration" "get_my_start" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_my_start.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_my_start" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "GET /v1/me"
  target             = "integrations/${aws_apigatewayv2_integration.get_my_start.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_lambda_permission" "get_my_start" {
  statement_id  = "AllowEmployeesAPIInvokeGetMyStart"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_my_start.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

# ONB-06: GET /v1/me/documents  (employees_api, Cognito JWT: only a signed-in employee)
resource "aws_apigatewayv2_integration" "get_my_documents" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_my_documents.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_my_documents" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "GET /v1/me/documents"
  target             = "integrations/${aws_apigatewayv2_integration.get_my_documents.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_lambda_permission" "get_my_documents" {
  statement_id  = "AllowEmployeesAPIInvokeGetMyDocuments"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_my_documents.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

# ONB-06: POST /v1/me/documents/upload-url  (employees_api, Cognito JWT: only a signed-in employee)
resource "aws_apigatewayv2_integration" "create_my_upload_link" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.create_my_upload_link.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "create_my_upload_link" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "POST /v1/me/documents/upload-url"
  target             = "integrations/${aws_apigatewayv2_integration.create_my_upload_link.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_lambda_permission" "create_my_upload_link" {
  statement_id  = "AllowEmployeesAPIInvokeCreateMyUploadLink"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_my_upload_link.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

# ONB-05: POST /v1/me/consent  (employees_api, Cognito JWT: only a signed-in employee)
resource "aws_apigatewayv2_integration" "record_consent" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.record_consent.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "record_consent" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "POST /v1/me/consent"
  target             = "integrations/${aws_apigatewayv2_integration.record_consent.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_lambda_permission" "record_consent" {
  statement_id  = "AllowEmployeesAPIInvokeRecordConsent"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.record_consent.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

# ONB-18: GET /v1/employees/{id}/invite  (employees_api, HR only)
resource "aws_apigatewayv2_integration" "get_invite" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_invite.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_invite" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "GET /v1/employees/{id}/invite"
  target             = "integrations/${aws_apigatewayv2_integration.get_invite.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_lambda_permission" "get_invite" {
  statement_id  = "AllowEmployeesAPIInvokeGetInvite"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_invite.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

# ONB-18: POST /v1/employees/{id}/invite  (employees_api, HR only)
resource "aws_apigatewayv2_integration" "resend_invite" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.resend_invite.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "resend_invite" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "POST /v1/employees/{id}/invite"
  target             = "integrations/${aws_apigatewayv2_integration.resend_invite.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_lambda_permission" "resend_invite" {
  statement_id  = "AllowEmployeesAPIInvokeResendInvite"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.resend_invite.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# MOD-01: GET /v1/company/modules (employees_api, the API the app calls through employeesApiUrl). Any signed-in
# person whose sign-in carries a company; the employees_api CORS already allows GET and the authorization header.
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_integration" "get_company_modules" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_company_modules.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_company_modules" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "GET /v1/company/modules"
  target             = "integrations/${aws_apigatewayv2_integration.get_company_modules.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_lambda_permission" "get_company_modules" {
  statement_id  = "AllowEmployeesAPIInvokeGetCompanyModules"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_company_modules.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}
