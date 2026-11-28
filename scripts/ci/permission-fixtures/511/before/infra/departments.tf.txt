# REC-14 step A: the company's department list (one row per company in the tenants table, sk DEPARTMENTS).
#  - manageDepartments: GET /v1/company/departments, POST /v1/admin/company/departments and
#    PATCH /v1/admin/company/departments/{id} on the employees API (Cognito JWT).
# It lives in this stack, next to the PII key, so its role and its line on the key's read list land in one apply.
# The lists themselves come from the seed (scripts/tenancy/company-seeds/departments.mjs), never from Terraform.

resource "aws_iam_role" "manage_departments" {
  name        = "naleko-manageDepartments-role"
  description = "Execution role for manageDepartments Lambda (REC-14)"
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

resource "aws_iam_role_policy" "manage_departments" {
  name = "naleko-manageDepartments-policy"
  role = aws_iam_role.manage_departments.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/manageDepartments:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        # The company's DEPARTMENTS row and its DEPARTMENTS# audit and key rows. Member rows start USER#, so they are out of reach.
        Sid      = "CompanyDepartments"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.tenants.arn
        Condition = {
          "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["TENANT#*"] }
        }
      },
    ]
  })
}

resource "aws_lambda_function" "manage_departments" {
  function_name = "manageDepartments"
  role          = aws_iam_role.manage_departments.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 10
  architectures = ["x86_64"]

  environment {
    variables = {
      TENANTS_TABLE = aws_dynamodb_table.tenants.name
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/manageDepartments"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  tags = {
    Component = "Departments"
    Ticket    = "REC-14"
  }
}

resource "aws_apigatewayv2_integration" "manage_departments" {
  api_id                 = aws_apigatewayv2_api.employees_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.manage_departments.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "list_departments" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "GET /v1/company/departments"
  target             = "integrations/${aws_apigatewayv2_integration.manage_departments.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_apigatewayv2_route" "add_department" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "POST /v1/admin/company/departments"
  target             = "integrations/${aws_apigatewayv2_integration.manage_departments.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_apigatewayv2_route" "change_department" {
  api_id             = aws_apigatewayv2_api.employees_api.id
  route_key          = "PATCH /v1/admin/company/departments/{id}"
  target             = "integrations/${aws_apigatewayv2_integration.manage_departments.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.employees_api_cognito.id
}

resource "aws_lambda_permission" "manage_departments" {
  statement_id  = "AllowEmployeesAPIInvokeManageDepartments"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.manage_departments.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.employees_api.execution_arn}/*/*"
}
