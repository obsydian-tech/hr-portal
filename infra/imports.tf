# NH-11 — Import blocks for all existing Naleko resources
#
# These tell Terraform "this resource already exists in AWS — pull it into state."
# After running: terraform plan -generate-config-out=generated.tf
# Terraform will read each resource from AWS and write the matching HCL.
#
# Once generated.tf is reviewed and tidied into permanent files, delete this file
# and replace the import {} blocks with the permanent resource definitions.

# ── Cognito ──────────────────────────────────────────────────────────────────

import {
  id = "af-south-1_2LdAGFnw2"
  to = aws_cognito_user_pool.naleko_dev
}

# ── IAM Role ─────────────────────────────────────────────────────────────────

import {
  id = "doc-verification-lambda-role"
  to = aws_iam_role.lambda_execution
}

# ── DynamoDB tables ───────────────────────────────────────────────────────────

import {
  id = "employees"
  to = aws_dynamodb_table.employees
}

import {
  id = "documents"
  to = aws_dynamodb_table.documents
}

import {
  id = "document-verification"
  to = aws_dynamodb_table.document_verification
}

# ── S3 buckets ────────────────────────────────────────────────────────────────

import {
  id = "document-ocr-verification-uploads"
  to = aws_s3_bucket.document_uploads
}

# ── API Gateway HTTP APIs ─────────────────────────────────────────────────────

import {
  id = "ndksa9ec0k"
  to = aws_apigatewayv2_api.employees_api
}

import {
  id = "b2wt303fc8"
  to = aws_apigatewayv2_api.document_upload_api
}

# ── API Gateway $default stages — NH-33 ──────────────────────────────────────

import {
  id = "ndksa9ec0k/$default"
  to = aws_apigatewayv2_stage.employees_api_default
}

import {
  id = "b2wt303fc8/$default"
  to = aws_apigatewayv2_stage.document_upload_api_default
}

# ── Lambda functions ──────────────────────────────────────────────────────────

import {
  id = "createEmployee"
  to = aws_lambda_function.create_employee
}

import {
  id = "getEmployees"
  to = aws_lambda_function.get_employees
}

import {
  id = "uploadDocumentToS3"
  to = aws_lambda_function.upload_document_to_s3
}

import {
  id = "processDocumentOCR"
  to = aws_lambda_function.process_document_ocr
}

import {
  id = "getDocumentVerifications"
  to = aws_lambda_function.get_document_verifications
}

import {
  id = "getSingleDocumentVerification"
  to = aws_lambda_function.get_single_document_verification
}

import {
  id = "getEmployeeDocumentVerifications"
  to = aws_lambda_function.get_employee_document_verifications
}

import {
  id = "reviewDocumentVerification"
  to = aws_lambda_function.review_document_verification
}

import {
  id = "lookupEmployeeEmail"
  to = aws_lambda_function.lookup_employee_email
}

import {
  id = "getDocumentPresignedUrl"
  to = aws_lambda_function.get_document_presigned_url
}
