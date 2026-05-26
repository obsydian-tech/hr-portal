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

import {
  id = "document-ocr-verification-uploads"
  to = aws_s3_bucket_public_access_block.document_uploads
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

# ── API Gateway JWT Authorizers — NH-5 ───────────────────────────────────────
# Format: <api-id>/<authorizer-id>

import {
  id = "ndksa9ec0k/5bxpy1"
  to = aws_apigatewayv2_authorizer.employees_api_cognito
}

import {
  id = "b2wt303fc8/l54jaw"
  to = aws_apigatewayv2_authorizer.document_upload_api_cognito
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

# ── TalentFlow Config Management (NH-Config) ──────────────────────────────────

import {
  id = "manageTalentFlowConfig"
  to = aws_lambda_function.manage_talent_flow_config
}

import {
  id = "talent-flow-role-manageTalentFlowConfig"
  to = aws_iam_role.manage_talent_flow_config
}

import {
  id = "talent-flow-role-manageTalentFlowConfig:talent-flow-role-manageTalentFlowConfig-policy"
  to = aws_iam_role_policy.manage_talent_flow_config
}

import {
  id = "57l0w7kk9h/lj112ce"
  to = aws_apigatewayv2_integration.manage_talent_flow_config
}

import {
  id = "57l0w7kk9h/icdwhvf"
  to = aws_apigatewayv2_route.get_config
}

import {
  id = "57l0w7kk9h/yjchsyd"
  to = aws_apigatewayv2_route.put_config
}

import {
  id = "57l0w7kk9h/f643ou1"
  to = aws_apigatewayv2_route.post_config
}

# manage_talent_flow_config_apigw permission was destroyed+recreated by apply
# (source_arn tightened to /v1/config* during first apply run) — no import needed.

# ── Feature 4: advanceCandidateStage (2026-05-19) ────────────────────────────
# TODO: resource blocks for advanceCandidateStage have not been written yet.
#       Imports commented out until talentflow-advance-candidate-stage.tf is added.

# import {
#   id = "talent-flow-role-advanceCandidateStage"
#   to = aws_iam_role.advance_candidate_stage
# }
#
# import {
#   id = "talent-flow-role-advanceCandidateStage:talent-flow-policy-advanceCandidateStage"
#   to = aws_iam_role_policy.advance_candidate_stage
# }
#
# import {
#   id = "advanceCandidateStage"
#   to = aws_lambda_function.advance_candidate_stage
# }
#
# import {
#   id = "57l0w7kk9h/t1ug192"
#   to = aws_apigatewayv2_integration.advance_candidate_stage
# }
#
# import {
#   id = "57l0w7kk9h/0y9pxoi"
#   to = aws_apigatewayv2_route.advance_candidate_stage
# }
#
# import {
#   id = "advanceCandidateStage/AllowTalentFlowAPIInvokeAdvanceCandidateStage"
#   to = aws_lambda_permission.advance_candidate_stage_api
# }
# ── talentflow-audit-stream pre-existing resources (2026-05-26) ──────────────

import {
  id = "talent-flow-events"
  to = aws_dynamodb_table.talent_flow_events
}

import {
  id = "naleko-talentFlowAuditStream-role"
  to = aws_iam_role.talent_flow_audit_stream
}

import {
  id = "naleko-getCandidateEvents-role"
  to = aws_iam_role.get_candidate_events
}
import {
  id = "talentFlowAuditStream"
  to = aws_lambda_function.talent_flow_audit_stream
}

import {
  id = "getCandidateEvents"
  to = aws_lambda_function.get_candidate_events
}

import {
  id = "talentFlowAuditStream/AllowEventBridgeInvokeTalentFlowAuditStream"
  to = aws_lambda_permission.talent_flow_audit_stream_eventbridge
}

import {
  id = "getCandidateEvents/AllowAPIGatewayInvokeGetCandidateEvents"
  to = aws_lambda_permission.get_candidate_events_apigw
}

import {
  id = "57l0w7kk9h/2qvk439"
  to = aws_apigatewayv2_route.get_candidate_events
}
