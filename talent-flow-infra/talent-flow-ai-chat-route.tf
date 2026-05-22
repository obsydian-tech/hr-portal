# ---------------------------------------------------------------------------
# TalentFlow AI Chat — Naleko Agent API Route
#
# Wires talentFlowAiChat Lambda to the Naleko Agent API (fou21cj8tj) with
# JWT authorizer. Isolated from the Onboarding AI Chat Lambda.
#
# Route:  POST /agent/v1/talentflow/chat
# Auth:   JWT (cognito-jwt-hr-staff, authorizer uhi317)
# Lambda: aws_lambda_function.ai_chat (declared in talent-flow-lambdas.tf)
#
# Resources were bootstrapped via AWS CLI.
# To import into state (run from talent-flow-infra/):
#   terraform import aws_apigatewayv2_integration.talentflow_ai_chat fou21cj8tj/g4sajmu
#   terraform import aws_apigatewayv2_route.talentflow_ai_chat       fou21cj8tj/i7lgygi
#   terraform import aws_lambda_permission.talentflow_ai_chat_agent_api talentFlowAiChat/allow-naleko-agent-api-talentflow-chat
# ---------------------------------------------------------------------------

resource "aws_apigatewayv2_integration" "talentflow_ai_chat" {
  api_id                 = "fou21cj8tj"
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.ai_chat.invoke_arn
  payload_format_version = "2.0"

  lifecycle {
    ignore_changes = [integration_uri]
  }
}

resource "aws_apigatewayv2_route" "talentflow_ai_chat" {
  api_id             = "fou21cj8tj"
  route_key          = "POST /agent/v1/talentflow/chat"
  authorization_type = "JWT"
  authorizer_id      = "uhi317"
  target             = "integrations/${aws_apigatewayv2_integration.talentflow_ai_chat.id}"
}

resource "aws_lambda_permission" "talentflow_ai_chat_agent_api" {
  statement_id  = "allow-naleko-agent-api-talentflow-chat"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ai_chat.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "arn:aws:execute-api:af-south-1:${var.aws_account_id}:fou21cj8tj/*/POST/agent/v1/talentflow/chat"
}
