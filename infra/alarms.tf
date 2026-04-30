# ---------------------------------------------------------------------------
# CloudWatch Alarms + SNS — NH-35
# 7 metric alarms + 1 composite critical alarm → naleko-ops-alerts SNS topic
# ---------------------------------------------------------------------------

module "alarms" {
  source = "./modules/alarms"

  region      = var.aws_region
  environment = var.environment
  ops_email   = var.ops_email

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
}
