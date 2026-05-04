# ---------------------------------------------------------------------------
# Lambda Functions — NH-11 Terraform import
# Code source is managed outside Terraform (direct console/CI deploys).
# We track configuration only; filename/source_code_hash are ignored.
# ---------------------------------------------------------------------------

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
      POSTMARK_API_TOKEN    = "623fee86-c7a5-4d08-b3f6-e9193bd2a316"
      POSTMARK_SENDER_EMAIL = "joworesources@gmail.com"
    }
  }

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/createEmployee"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash, runtime]
  }
}

resource "aws_lambda_function" "get_employees" {
  function_name = "getEmployees"
  role          = aws_iam_role.get_employees.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 3
  architectures = ["x86_64"]

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getEmployees"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash, runtime]
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

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/uploadDocumentToS3"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash, runtime]
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

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/processDocumentOCR"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash, runtime]
  }
}

resource "aws_lambda_function" "get_document_verifications" {
  function_name = "getDocumentVerifications"
  role          = aws_iam_role.get_document_verifications.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 3
  architectures = ["x86_64"]

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getDocumentVerifications"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash, runtime]
  }
}

resource "aws_lambda_function" "get_single_document_verification" {
  function_name = "getSingleDocumentVerification"
  role          = aws_iam_role.get_single_document_verification.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 3
  architectures = ["x86_64"]

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getSingleDocumentVerification"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash, runtime]
  }
}

resource "aws_lambda_function" "get_employee_document_verifications" {
  function_name = "getEmployeeDocumentVerifications"
  role          = aws_iam_role.get_employee_document_verifications.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 3
  architectures = ["x86_64"]

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getEmployeeDocumentVerifications"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash, runtime]
  }
}

resource "aws_lambda_function" "review_document_verification" {
  function_name = "reviewDocumentVerification"
  role          = aws_iam_role.review_document_verification.arn
  handler       = "index.handler"
  runtime       = "nodejs20.x"
  filename      = local.placeholder_zip
  memory_size   = 256
  timeout       = 15
  architectures = ["x86_64"]

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/reviewDocumentVerification"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash, runtime]
  }
}

resource "aws_lambda_function" "lookup_employee_email" {
  function_name = "lookupEmployeeEmail"
  role          = aws_iam_role.lookup_employee_email.arn
  handler       = "index.handler"
  runtime       = "nodejs22.x"
  filename      = local.placeholder_zip
  memory_size   = 128
  timeout       = 3
  architectures = ["x86_64"]

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/lookupEmployeeEmail"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash, runtime]
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

  ephemeral_storage { size = 512 }
  tracing_config { mode = "Active" }

  logging_config {
    log_format = "JSON"
    log_group  = "/aws/lambda/getDocumentPresignedUrl"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash, runtime]
  }
}
