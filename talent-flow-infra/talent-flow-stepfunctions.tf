# ---------------------------------------------------------------------------
# TalentFlow — Step Functions Offer Approval State Machine (NH-114 / TF-011)
#
# State machine: talent-flow-offer-approval (STANDARD type)
#
# Why STANDARD (not EXPRESS):
#   EXPRESS has a 5-minute maximum execution duration.
#   WaitForTaskToken for FinanceLead/HiringManager approval can take days to
#   weeks — STANDARD is the only correct choice for long-running human approvals.
#   Naleko's own SFN (naleko-onboarding-flow) is also STANDARD type.
#
# ASL flow:
#   1. SendApprovalRequest — Lambda.waitForTaskToken → sendTalentFlowNotification
#      Sends approval email with task token callback URL, then PAUSES until
#      talentFlowApproveAction calls SendTaskSuccess / SendTaskFailure.
#      HeartbeatSeconds = 86400 (24 h heartbeat to detect stale tokens).
#   2. ProcessDecision — Choice state on $.decision
#      "APPROVED" → InvokeOfferProcessor
#      default     → RejectOffer
#   3a. InvokeOfferProcessor — sync Lambda invoke → talentFlowApproveAction
#       Payload flags action = "APPROVE"
#   3b. RejectOffer — sync Lambda invoke → talentFlowApproveAction
#       Payload flags action = "REJECT"
#
# Lambda wiring rationale:
#   Ticket referenced non-existent "send-approval-request" and "process-offer".
#   Correct targets are the two functionally appropriate Lambdas from TF-009:
#   - sendTalentFlowNotification  → handles outbound notification with token
#   - talentFlowApproveAction     → processes APPROVE / REJECT resolution
#
# IAM:
#   Role: talent-flow-role-stepfunctions (follows tf_iam_role_prefix convention)
#   KMS:  agent_audit key only (covers encrypted CloudWatch log group writes)
#   No state key — state machine does not directly read/write DynamoDB tables.
#
# Discrepancies resolved vs ticket:
#   - type = STANDARD (not EXPRESS) — EXPRESS max 5 min, incompatible with WaitForTaskToken
#   - Lambda names corrected to declared resources (send_notification, approve_action)
#   - KMS key: agent_audit (not the nonexistent "general" key)
#   - IAM role name: talent-flow-role-stepfunctions (follows TF-008 prefix convention)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# CloudWatch Log Group
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "talent_flow_sfn" {
  name              = "/aws/states/talent-flow-offer-approval"
  retention_in_days = 90
  kms_key_id        = aws_kms_key.talent_flow_agent_audit.arn

  tags = merge(local.tf_tags, { Ticket = "NH-114", Purpose = "StepFunctionsExecutionLogs" })
}

# ---------------------------------------------------------------------------
# IAM Role — Step Functions execution
# ---------------------------------------------------------------------------

resource "aws_iam_role" "talent_flow_sfn" {
  name        = "${local.tf_iam_role_prefix}stepfunctions"
  description = "Execution role for talent-flow-offer-approval state machine"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "states.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = merge(local.tf_tags, { Ticket = "NH-114", Purpose = "StepFunctionsExecution" })
}

# ---------------------------------------------------------------------------
# Inline IAM Policy
# ---------------------------------------------------------------------------

resource "aws_iam_role_policy" "talent_flow_sfn" {
  name = "${local.tf_iam_role_prefix}stepfunctions-policy"
  role = aws_iam_role.talent_flow_sfn.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # CloudWatch Logs delivery — required for logging_configuration
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
          "logs:StartQueryExecution",
        ]
        Resource = "*"
      },
      {
        # X-Ray tracing
        Sid    = "XRay"
        Effect = "Allow"
        Action = [
          "xray:PutTraceSegments",
          "xray:PutTelemetryRecords",
          "xray:GetSamplingRules",
          "xray:GetSamplingTargets",
        ]
        Resource = "*"
      },
      {
        # Step 1: SendApprovalRequest (waitForTaskToken) + Steps 3a/3b
        Sid    = "InvokeTalentFlowLambdas"
        Effect = "Allow"
        Action = ["lambda:InvokeFunction"]
        Resource = [
          aws_lambda_function.send_notification.arn,
          aws_lambda_function.approve_action.arn,
        ]
      },
      {
        # KMS for encrypted CloudWatch log group writes
        Sid    = "KmsForLogs"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey",
        ]
        Resource = aws_kms_key.talent_flow_agent_audit.arn
      },
    ]
  })
}

# ---------------------------------------------------------------------------
# State Machine
# ---------------------------------------------------------------------------

resource "aws_sfn_state_machine" "offer_approval" {
  name     = local.tf_sfn_state_machine_name
  role_arn = aws_iam_role.talent_flow_sfn.arn
  type     = "STANDARD"

  # ASL defined inline using jsonencode — no separate .asl.json file required
  definition = jsonencode({
    Comment = "TalentFlow offer approval workflow — waits for human decision via task token"
    StartAt = "SendApprovalRequest"

    States = {
      SendApprovalRequest = {
        Type     = "Task"
        Comment  = "Send approval notification with embedded task token; pause until SendTaskSuccess/Failure"
        Resource = "arn:aws:states:::lambda:invoke.waitForTaskToken"
        Parameters = {
          FunctionName = aws_lambda_function.send_notification.arn
          Payload = {
            "taskToken.$"    = "$$.Task.Token"
            "input.$"        = "$"
            notificationType = "OFFER_APPROVAL_REQUEST"
          }
        }
        HeartbeatSeconds = 86400
        Next             = "ProcessDecision"
        Catch = [{
          ErrorEquals = ["States.HeartbeatTimeout", "States.TaskFailed"]
          Next        = "RejectOffer"
          ResultPath  = "$.error"
        }]
      }

      ProcessDecision = {
        Type    = "Choice"
        Comment = "Route based on the approver's decision returned via SendTaskSuccess"
        Choices = [{
          Variable     = "$.decision"
          StringEquals = "APPROVED"
          Next         = "InvokeOfferProcessor"
        }]
        Default = "RejectOffer"
      }

      InvokeOfferProcessor = {
        Type     = "Task"
        Comment  = "Process approved offer — update state table and notify candidate"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.approve_action.arn
          Payload = {
            "candidateId.$" = "$.candidateId"
            "action"        = "APPROVE"
            "input.$"       = "$"
          }
        }
        End = true
      }

      RejectOffer = {
        Type     = "Task"
        Comment  = "Process rejected offer — update state table and notify candidate"
        Resource = "arn:aws:states:::lambda:invoke"
        Parameters = {
          FunctionName = aws_lambda_function.approve_action.arn
          Payload = {
            "candidateId.$" = "$.candidateId"
            "action"        = "REJECT"
            "input.$"       = "$"
          }
        }
        End = true
      }
    }
  })

  logging_configuration {
    level                  = "ERROR"
    include_execution_data = false
    log_destination        = "${aws_cloudwatch_log_group.talent_flow_sfn.arn}:*"
  }

  tracing_configuration {
    enabled = true
  }

  tags = merge(local.tf_tags, { Ticket = "NH-114", Purpose = "OfferApprovalOrchestration" })
}

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

output "talent_flow_sfn_arn" {
  description = "ARN of the talent-flow-offer-approval state machine (for process-offer Lambda env vars)"
  value       = aws_sfn_state_machine.offer_approval.arn
}
