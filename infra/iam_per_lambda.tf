# ---------------------------------------------------------------------------
# Per-Lambda IAM Roles — NH-8
# Replaces the single shared doc-verification-lambda-role with least-privilege
# per-function roles. Each role has exactly the AWS actions its code calls.
# ---------------------------------------------------------------------------

# ─── createEmployee ──────────────────────────────────────────────────────────

resource "aws_iam_role" "create_employee" {
  name        = "naleko-createEmployee-role"
  description = "Execution role for createEmployee Lambda"
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

resource "aws_iam_role_policy" "create_employee" {
  name = "naleko-createEmployee-policy"
  role = aws_iam_role.create_employee.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/createEmployee:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "DynamoDB"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:Scan", "dynamodb:Query"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/employees"
      },
      {
        Sid    = "Cognito"
        Effect = "Allow"
        Action = [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminSetUserPassword",
        ]
        Resource = "arn:aws:cognito-idp:${var.aws_region}:${var.aws_account_id}:userpool/af-south-1_2LdAGFnw2"
      },
      {
        Sid      = "KMSPIIKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = module.kms_pii.key_arn
      }
    ]
  })
}

# ─── getEmployees ─────────────────────────────────────────────────────────────

resource "aws_iam_role" "get_employees" {
  name        = "naleko-getEmployees-role"
  description = "Execution role for getEmployees Lambda"
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

resource "aws_iam_role_policy" "get_employees" {
  name = "naleko-getEmployees-policy"
  role = aws_iam_role.get_employees.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/getEmployees:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "DynamoDB"
        Effect   = "Allow"
        Action   = ["dynamodb:Scan"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/employees"
      },
      {
        Sid      = "KMSPIIKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = module.kms_pii.key_arn
      }
    ]
  })
}

# ─── uploadDocumentToS3 ───────────────────────────────────────────────────────

resource "aws_iam_role" "upload_document_to_s3" {
  name        = "naleko-uploadDocumentToS3-role"
  description = "Execution role for uploadDocumentToS3 Lambda"
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

resource "aws_iam_role_policy" "upload_document_to_s3" {
  name = "naleko-uploadDocumentToS3-policy"
  role = aws_iam_role.upload_document_to_s3.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/uploadDocumentToS3:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "S3Put"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "arn:aws:s3:::document-ocr-verification-uploads/*"
      },
      {
        Sid      = "DynamoDB"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/documents"
      },
      {
        Sid      = "KMSPIIKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = module.kms_pii.key_arn
      }
    ]
  })
}

# ─── processDocumentOCR ───────────────────────────────────────────────────────

resource "aws_iam_role" "process_document_ocr" {
  name        = "naleko-processDocumentOCR-role"
  description = "Execution role for processDocumentOCR Lambda"
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

resource "aws_iam_role_policy" "process_document_ocr" {
  name = "naleko-processDocumentOCR-policy"
  role = aws_iam_role.process_document_ocr.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/processDocumentOCR:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "S3Read"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "arn:aws:s3:::document-ocr-verification-uploads/*"
      },
      {
        Sid      = "Textract"
        Effect   = "Allow"
        Action   = ["textract:AnalyzeDocument"]
        Resource = "*"
      },
      {
        # Bedrock InvokeModel — cross-region inference profile requires wildcard resource
        Sid      = "Bedrock"
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "*"
      },
      {
        Sid    = "DynamoDB"
        Effect = "Allow"
        Action = ["dynamodb:PutItem", "dynamodb:UpdateItem"]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/documents",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/document-verification",
        ]
      },
      {
        Sid      = "KMSPIIKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = module.kms_pii.key_arn
      }
    ]
  })
}

# ─── getDocumentVerifications ─────────────────────────────────────────────────

resource "aws_iam_role" "get_document_verifications" {
  name        = "naleko-getDocumentVerifications-role"
  description = "Execution role for getDocumentVerifications Lambda"
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

resource "aws_iam_role_policy" "get_document_verifications" {
  name = "naleko-getDocumentVerifications-policy"
  role = aws_iam_role.get_document_verifications.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/getDocumentVerifications:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid    = "DynamoDB"
        Effect = "Allow"
        Action = ["dynamodb:Scan", "dynamodb:Query"]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/document-verification",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/documents",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/employees",
        ]
      },
      {
        Sid      = "KMSPIIKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = module.kms_pii.key_arn
      }
    ]
  })
}

# ─── getSingleDocumentVerification ───────────────────────────────────────────

resource "aws_iam_role" "get_single_document_verification" {
  name        = "naleko-getSingleDocumentVerification-role"
  description = "Execution role for getSingleDocumentVerification Lambda"
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

resource "aws_iam_role_policy" "get_single_document_verification" {
  name = "naleko-getSingleDocumentVerification-policy"
  role = aws_iam_role.get_single_document_verification.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/getSingleDocumentVerification:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid    = "DynamoDB"
        Effect = "Allow"
        Action = ["dynamodb:Scan", "dynamodb:Query", "dynamodb:GetItem"]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/document-verification",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/documents",
        ]
      },
      {
        Sid      = "KMSPIIKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = module.kms_pii.key_arn
      }
    ]
  })
}

# ─── getEmployeeDocumentVerifications ────────────────────────────────────────

resource "aws_iam_role" "get_employee_document_verifications" {
  name        = "naleko-getEmployeeDocumentVerifications-role"
  description = "Execution role for getEmployeeDocumentVerifications Lambda"
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

resource "aws_iam_role_policy" "get_employee_document_verifications" {
  name = "naleko-getEmployeeDocumentVerifications-policy"
  role = aws_iam_role.get_employee_document_verifications.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/getEmployeeDocumentVerifications:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid    = "DynamoDB"
        Effect = "Allow"
        Action = ["dynamodb:Query"]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/employees",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/documents",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/document-verification",
        ]
      },
      {
        Sid      = "KMSPIIKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = module.kms_pii.key_arn
      }
    ]
  })
}

# ─── reviewDocumentVerification ───────────────────────────────────────────────

resource "aws_iam_role" "review_document_verification" {
  name        = "naleko-reviewDocumentVerification-role"
  description = "Execution role for reviewDocumentVerification Lambda"
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

resource "aws_iam_role_policy" "review_document_verification" {
  name = "naleko-reviewDocumentVerification-policy"
  role = aws_iam_role.review_document_verification.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/reviewDocumentVerification:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid    = "DynamoDB"
        Effect = "Allow"
        Action = ["dynamodb:Scan", "dynamodb:UpdateItem", "dynamodb:Query", "dynamodb:GetItem"]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/documents",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/document-verification",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/employees",
        ]
      },
      {
        Sid      = "CloudWatchMetrics"
        Effect   = "Allow"
        Action   = ["cloudwatch:PutMetricData"]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "Naleko/Onboarding"
          }
        }
      },
      {
        Sid      = "KMSPIIKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = module.kms_pii.key_arn
      }
    ]
  })
}

# ─── lookupEmployeeEmail ──────────────────────────────────────────────────────

resource "aws_iam_role" "lookup_employee_email" {
  name        = "naleko-lookupEmployeeEmail-role"
  description = "Execution role for lookupEmployeeEmail Lambda"
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

resource "aws_iam_role_policy" "lookup_employee_email" {
  name = "naleko-lookupEmployeeEmail-policy"
  role = aws_iam_role.lookup_employee_email.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/lookupEmployeeEmail:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "DynamoDB"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/employees"
      },
      {
        Sid      = "KMSPIIKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = module.kms_pii.key_arn
      }
    ]
  })
}

# ─── getDocumentPresignedUrl ───────────────────────────────────────────────────

resource "aws_iam_role" "get_document_presigned_url" {
  name        = "naleko-getDocumentPresignedUrl-role"
  description = "Execution role for getDocumentPresignedUrl Lambda"
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

resource "aws_iam_role_policy" "get_document_presigned_url" {
  name = "naleko-getDocumentPresignedUrl-policy"
  role = aws_iam_role.get_document_presigned_url.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/getDocumentPresignedUrl:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "DynamoDB"
        Effect   = "Allow"
        Action   = ["dynamodb:Scan"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/documents"
      },
      {
        Sid      = "S3Get"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "arn:aws:s3:::document-ocr-verification-uploads/*"
      },
      {
        Sid      = "KMSPIIKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = module.kms_pii.key_arn
      }
    ]
  })
}

# ─── NH-12: generateDocumentUploadUrl ────────────────────────────────────────

resource "aws_iam_role" "generate_document_upload_url" {
  name        = "naleko-generateDocumentUploadUrl-role"
  description = "Execution role for generateDocumentUploadUrl Lambda (NH-12)"
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

resource "aws_iam_role_policy" "generate_document_upload_url" {
  name = "naleko-generateDocumentUploadUrl-policy"
  role = aws_iam_role.generate_document_upload_url.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/generateDocumentUploadUrl:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        # Lambda must have s3:PutObject to sign a presigned PUT URL on behalf of callers
        Sid      = "S3PresignedPut"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "arn:aws:s3:::document-ocr-verification-uploads/uploads/*"
      },
      {
        Sid      = "DynamoDB"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:GetItem"]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/documents",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/employees",
        ]
      },
      {
        Sid      = "KMSPIIKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = module.kms_pii.key_arn
      }
    ]
  })
}

# ─── NH-13: getEmployeeByEmail ──────────────────────────────────────────────
resource "aws_iam_role" "get_employee_by_email" {
  name        = "naleko-getEmployeeByEmail-role"
  description = "Execution role for getEmployeeByEmail Lambda (NH-13)"
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

resource "aws_iam_role_policy" "get_employee_by_email" {
  name = "naleko-getEmployeeByEmail-policy"
  role = aws_iam_role.get_employee_by_email.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/getEmployeeByEmail:*"
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
        Action   = ["dynamodb:Scan"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/employees"
      },
      {
        Sid      = "KMSPIIKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = module.kms_pii.key_arn
      }
    ]
  })
}

# ─── NH-13: triggerExternalVerification ─────────────────────────────────────
resource "aws_iam_role" "trigger_external_verification" {
  name        = "naleko-triggerExternalVerification-role"
  description = "Execution role for triggerExternalVerification Lambda (NH-13)"
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

resource "aws_iam_role_policy" "trigger_external_verification" {
  name = "naleko-triggerExternalVerification-policy"
  role = aws_iam_role.trigger_external_verification.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "Logs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:${var.aws_region}:${var.aws_account_id}:log-group:/aws/lambda/triggerExternalVerification:*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"]
        Resource = "*"
      },
      {
        Sid      = "DynamoDB"
        Effect   = "Allow"
        Action   = ["dynamodb:Scan", "dynamodb:PutItem"]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/documents",
          "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/external-verification-requests",
        ]
      },
      {
        Sid      = "KMSPIIKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey", "kms:GenerateDataKeyWithoutPlaintext", "kms:DescribeKey"]
        Resource = module.kms_pii.key_arn
      }
    ]
  })
}
