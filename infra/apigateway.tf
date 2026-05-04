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
  route_key          = "POST /employees/{employee_id}/documents/upload-url"
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
