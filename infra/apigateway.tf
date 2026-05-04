# ---------------------------------------------------------------------------
# API Gateway v2 (HTTP APIs) — NH-11 Terraform import
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "employees_api" {
  name                       = "employees"
  protocol_type              = "HTTP"
  route_selection_expression = "$request.method $request.path"

  cors_configuration {
    allow_credentials = false
    allow_headers     = ["authorization", "content-type", "x-role", "x-staff-id"]
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
    allow_headers     = ["authorization", "content-type", "x-role", "x-staff-id"]
    allow_methods     = ["DELETE", "GET", "OPTIONS", "PATCH", "POST", "PUT"]
    allow_origins     = ["http://localhost:4200", "https://hr-portal-beryl-three.vercel.app"]
    expose_headers    = ["*"]
    max_age           = 3600
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
