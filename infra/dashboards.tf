# ---------------------------------------------------------------------------
# CloudWatch Dashboards — NH-34
# Three persona views: HR Operations, System Health, Security/Audit
# ---------------------------------------------------------------------------

module "dashboards" {
  source = "./modules/dashboards"

  region      = var.aws_region
  environment = var.environment

  lambda_names = [
    "createEmployee",
    "getEmployees",
    "uploadDocumentToS3",
    "processDocumentOCR",
    "getDocumentVerifications",
    "getSingleDocumentVerification",
    "getEmployeeDocumentVerifications",
    "reviewDocumentVerification",
    "lookupEmployeeEmail",
    "getDocumentPresignedUrl",
  ]

  employees_api_id = aws_apigatewayv2_api.employees_api.id
  document_api_id  = aws_apigatewayv2_api.document_upload_api.id

  dynamodb_tables = [
    aws_dynamodb_table.employees.name,
    aws_dynamodb_table.documents.name,
    aws_dynamodb_table.document_verification.name,
  ]

  s3_bucket = aws_s3_bucket.document_uploads.bucket
}
