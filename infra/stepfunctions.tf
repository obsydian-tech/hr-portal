# ---------------------------------------------------------------------------
# Step Functions State Machine — NH-42
# naleko-onboarding-flow: durable orchestration of the post-creation
# onboarding lifecycle (document upload wait → OCR signal → risk assess
# → EventBridge completion/failure events).
#
# Trigger:   createEmployee Lambda calls sfn:StartExecution after DynamoDB write.
# Heartbeat: processDocumentOCR Lambda calls sfn:SendTaskSuccess after OCR.
# ---------------------------------------------------------------------------

# CloudWatch log group for all execution history
resource "aws_cloudwatch_log_group" "sfn_onboarding" {
  name              = "/aws/states/naleko-onboarding-flow"
  retention_in_days = 90

  tags = {
    Purpose = "StepFunctionsExecutionLogs"
  }
}

# ─── SFN execution role ───────────────────────────────────────────────────────

resource "aws_iam_role" "sfn_onboarding" {
  name        = "naleko-sfn-onboarding-role"
  description = "Execution role for the naleko-onboarding-flow state machine"
  path        = "/naleko/"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "states.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "sfn_onboarding" {
  name = "naleko-sfn-onboarding-policy"
  role = aws_iam_role.sfn_onboarding.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # CloudWatch Logs — required for logging_configuration level = "ALL"
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogDelivery",
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:DescribeLogGroups",
          "logs:DescribeResourcePolicies",
          "logs:GetLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutLogEvents",
          "logs:PutResourcePolicy",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
        ]
        Resource = "*"
      },
      {
        Sid      = "XRay"
        Effect   = "Allow"
        Action   = ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets"]
        Resource = "*"
      },
      {
        # WaitForDocumentUpload state: store task token on employee record
        Sid      = "DynamoDBStoreTaskToken"
        Effect   = "Allow"
        Action   = ["dynamodb:UpdateItem"]
        Resource = aws_dynamodb_table.employees.arn
      },
      {
        # AssessRisk state: invoke classifyOnboardingRisk Lambda
        Sid      = "InvokeClassifyRisk"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.classify_onboarding_risk.arn
      },
      {
        # OnboardingComplete / OnboardingFailed states: publish to event bus
        Sid      = "EventBridgePublish"
        Effect   = "Allow"
        Action   = ["events:PutEvents"]
        Resource = aws_cloudwatch_event_bus.naleko_onboarding.arn
      }
    ]
  })
}

# ─── State machine ────────────────────────────────────────────────────────────

resource "aws_sfn_state_machine" "onboarding" {
  name     = "naleko-onboarding-flow"
  role_arn = aws_iam_role.sfn_onboarding.arn
  type     = "STANDARD"

  definition = file("${path.module}/step-functions/naleko-onboarding-flow.asl.json")

  logging_configuration {
    level                  = "ALL"
    include_execution_data = true
    log_destination        = "${aws_cloudwatch_log_group.sfn_onboarding.arn}:*"
  }

  tracing_configuration {
    enabled = true
  }

  tags = {
    Purpose = "OnboardingOrchestration"
    NH      = "NH-42"
  }
}
