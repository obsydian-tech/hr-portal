# ---------------------------------------------------------------------------
# TalentFlow Interview Routes
#
# Adds GET /v1/candidates/{id}/interviews to the existing TalentFlow API GW.
# The scheduleInterview Lambda handles GET (list), POST (schedule), and
# PATCH (complete / add panel members) for the same resource.
#
# The Lambda was provisioned outside Terraform — referenced via data source.
# IAM: scheduleInterview already has dynamodb:Query on talent-flow-state
#      (PATCH 5 in iam-patches.tf). No new IAM needed.
# ---------------------------------------------------------------------------

data "aws_lambda_function" "schedule_interview" {
  function_name = "scheduleInterview"
}

# Allow the API GW to invoke the Lambda for the GET route
resource "aws_lambda_permission" "apigw_get_interviews" {
  statement_id  = "AllowTalentFlowAPIInvokeGetInterviews"
  action        = "lambda:InvokeFunction"
  function_name = data.aws_lambda_function.schedule_interview.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${data.aws_apigatewayv2_api.talent_flow_api.execution_arn}/*/*"
}

resource "aws_apigatewayv2_integration" "get_candidate_interviews" {
  api_id                 = data.aws_apigatewayv2_api.talent_flow_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = data.aws_lambda_function.schedule_interview.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "get_candidate_interviews" {
  api_id             = data.aws_apigatewayv2_api.talent_flow_api.id
  route_key          = "GET /v1/candidates/{id}/interviews"
  target             = "integrations/${aws_apigatewayv2_integration.get_candidate_interviews.id}"
  authorization_type = "JWT"
  authorizer_id      = local.talent_flow_cognito_authorizer_id
}
