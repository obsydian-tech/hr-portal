# ---------------------------------------------------------------------------
# AI cost guardrail (Iggie's hard rule, 2026-11-11): robots never use paid AI,
# and AI spend has a hard ceiling. Applies to prod and to pepla-dev.
#
#   Code side: lambda/shared/ai-guard.mjs skips Bedrock/Textract for test
#   logins (group e2e-robots) and test records (blackhole.postmarkapp.com).
#
#   This file: a monthly budget on AI spend only.
#     $5 and $15 -> email warning
#     $20        -> "brake": AWS attaches a deny-Bedrock/Textract policy to the
#                   six AI Lambda roles. The rest of the app keeps working; the
#                   AI parts answer with their fallback. To release the brake,
#                   detach policy pepla-ai-brake from those roles (or ask Claude).
#   Change the amounts with the variables below.
#
# Budgets data lags actual use by up to ~8-24 hours, so real spend can pass $20
# before the brake fires. The account's concurrency limit (10) bounds how fast.
# ---------------------------------------------------------------------------

variable "ai_brake_usd" {
  description = "Monthly AI (Bedrock + Textract) spend at which AI is switched off automatically."
  type        = number
  default     = 20
}

variable "ai_warning_usd" {
  description = "Monthly AI spend amounts that send a warning email."
  type        = list(number)
  default     = [5, 15]
}

variable "ai_cost_services" {
  description = <<-EOT
    Cost Explorer service names counted as AI spend. Anthropic models on Bedrock
    are billed under their own names, e.g. "Claude Haiku 4.5 (Amazon Bedrock
    Edition)". Check this list against Cost Explorer before applying.
  EOT
  type        = list(string)
  # Kept in the order AWS returns them, so the plan shows no false drift.
  default = [
    "Amazon Bedrock",
    "Amazon Textract",
    "Claude Haiku 4.5 (Amazon Bedrock Edition)",
    "Claude Opus 4.5 (Amazon Bedrock Edition)",
    "Claude Sonnet 4.5 (Amazon Bedrock Edition)",
    "Claude Sonnet 4.6 (Amazon Bedrock Edition)",
    "Claude 3 Haiku (Amazon Bedrock Edition)",
  ]
}

# talentFlowAiChat lives in talent-flow-infra/; look its role up by function.
data "aws_lambda_function" "talentflow_ai_chat" {
  function_name = "talentFlowAiChat"
}

locals {
  ai_lambda_role_names = [
    aws_iam_role.naleko_ai_chat.name,
    aws_iam_role.classify_onboarding_risk.name,
    aws_iam_role.summarise_verification.name,
    aws_iam_role.get_batch_risk_report.name,
    aws_iam_role.process_document_ocr.name,
    element(split("/", data.aws_lambda_function.talentflow_ai_chat.role), length(split("/", data.aws_lambda_function.talentflow_ai_chat.role)) - 1),
  ]
}

# The brake itself: attached only when the budget action fires.
resource "aws_iam_policy" "ai_brake" {
  name        = "pepla-ai-brake"
  description = "AI cost brake: denies Bedrock and Textract. Attached automatically at the AI budget limit."
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "AiBrake"
      Effect   = "Deny"
      Action   = ["bedrock:*", "textract:*"]
      Resource = "*"
    }]
  })
}

resource "aws_budgets_budget" "ai" {
  name         = "pepla-ai-spend"
  budget_type  = "COST"
  limit_amount = tostring(var.ai_brake_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "Service"
    values = var.ai_cost_services
  }

  dynamic "notification" {
    for_each = var.ai_warning_usd
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "ABSOLUTE_VALUE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }
}

# Lets AWS Budgets attach (and later detach) only the brake, only on these roles.
resource "aws_iam_role" "ai_brake_budgets" {
  name = "pepla-ai-brake-budgets"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "budgets.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = var.aws_account_id } }
    }]
  })
}

resource "aws_iam_role_policy" "ai_brake_budgets" {
  name = "attach-ai-brake-only"
  role = aws_iam_role.ai_brake_budgets.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
      Resource  = [for r in local.ai_lambda_role_names : "arn:aws:iam::${var.aws_account_id}:role/${r}"]
      Condition = { ArnEquals = { "iam:PolicyARN" = aws_iam_policy.ai_brake.arn } }
    }]
  })
}

resource "aws_budgets_budget_action" "ai_brake" {
  budget_name        = aws_budgets_budget.ai.name
  action_type        = "APPLY_IAM_POLICY"
  approval_model     = "AUTOMATIC"
  notification_type  = "ACTUAL"
  execution_role_arn = aws_iam_role.ai_brake_budgets.arn

  action_threshold {
    action_threshold_type  = "PERCENTAGE"
    action_threshold_value = 100
  }

  definition {
    iam_action_definition {
      policy_arn = aws_iam_policy.ai_brake.arn
      roles      = local.ai_lambda_role_names
    }
  }

  subscriber {
    address           = var.alert_email
    subscription_type = "EMAIL"
  }
}
