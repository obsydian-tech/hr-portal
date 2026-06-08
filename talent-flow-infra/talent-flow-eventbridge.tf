# ---------------------------------------------------------------------------
# TalentFlow - EventBridge Bus + Routing Rules (NH-110 / TF-007)
#
# Custom bus: talent-flow-bus
# All inter-Lambda events route through this bus - never the default bus.
# (Plan doc s.4.7: "All inter-Lambda communication goes through talent-flow-bus")
#
# 7 workflow routing rules:
#   1. CandidateCreated      → orchestrateTalentFlowWorkflow
#   2. InterviewScheduled    → scheduleInterview
#   3. VoteSubmitted         → submitVote
#   4. VotingCompleted       → completeEvaluation
#   5. EvaluationCompleted   → sendTalentFlowNotification
#   6. SLABreached           → sendTalentFlowNotification
#   7. OfferApproved         → sendTalentFlowNotification
#
# Plus 1 scheduled rule on the default bus:
#   8. rate(1 hour) cron     → monitorTalentFlowSLAs
#
# Lambda ARNs are constructed from locals + var.aws_account_id to avoid
# forward references to TF-009 Lambda resources. aws_lambda_permission
# resources are pre-declared here and will be satisfied when TF-009 applies.
#
# Pattern: mirrors Naleko infra/eventbridge.tf (aws_cloudwatch_event_bus,
# aws_cloudwatch_event_rule, aws_cloudwatch_event_target, aws_lambda_permission)
# ---------------------------------------------------------------------------

locals {
  # Convenience: base Lambda ARN prefix for this account/region
  tf_lambda_arn_prefix = "arn:aws:lambda:af-south-1:${var.aws_account_id}:function"
}

# ── Custom Event Bus ──────────────────────────────────────────────────────────

resource "aws_cloudwatch_event_bus" "talent_flow" {
  name = local.tf_event_bus_name # talent-flow-bus

  tags = merge(local.tf_tags, {
    Purpose = "talent-flow-event-bus"
    Ticket  = "NH-110"
  })
}

# ── Rule 1: CandidateCreated → orchestrateTalentFlowWorkflow ──────────────────

resource "aws_cloudwatch_event_rule" "candidate_created" {
  name           = "talent-flow-candidate-created"
  description    = "Route CandidateCreated events to orchestrateTalentFlowWorkflow"
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  state          = "ENABLED"

  event_pattern = jsonencode({
    source      = ["talent-flow.candidates"]
    detail-type = ["CandidateCreated"]
  })

  tags = merge(local.tf_tags, { Ticket = "NH-110" })
}

resource "aws_cloudwatch_event_target" "candidate_created" {
  rule           = aws_cloudwatch_event_rule.candidate_created.name
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  target_id      = "orchestrateTalentFlowWorkflow"
  arn            = "${local.tf_lambda_arn_prefix}:${local.tf_lambda_orchestrate_workflow}"
}

resource "aws_lambda_permission" "orchestrate_workflow_eventbridge" {
  statement_id  = "AllowEventBridgeInvokeOrchestrateWorkflow"
  action        = "lambda:InvokeFunction"
  function_name = local.tf_lambda_orchestrate_workflow
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.candidate_created.arn
}

# ── Rule 2: InterviewScheduled → scheduleInterview ────────────────────────────

resource "aws_cloudwatch_event_rule" "interview_scheduled" {
  name           = "talent-flow-interview-scheduled"
  description    = "Route InterviewScheduled events to scheduleInterview"
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  state          = "ENABLED"

  event_pattern = jsonencode({
    source      = ["talent-flow.workflow"]
    detail-type = ["InterviewScheduled"]
  })

  tags = merge(local.tf_tags, { Ticket = "NH-110" })
}

resource "aws_cloudwatch_event_target" "interview_scheduled" {
  rule           = aws_cloudwatch_event_rule.interview_scheduled.name
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  target_id      = "scheduleInterview"
  arn            = "${local.tf_lambda_arn_prefix}:${local.tf_lambda_schedule_interview}"
}

resource "aws_lambda_permission" "schedule_interview_eventbridge" {
  statement_id  = "AllowEventBridgeInvokeScheduleInterview"
  action        = "lambda:InvokeFunction"
  function_name = local.tf_lambda_schedule_interview
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.interview_scheduled.arn
}

# ── Rule 3: VoteSubmitted → submitVote ────────────────────────────────────────

resource "aws_cloudwatch_event_rule" "vote_submitted" {
  name           = "talent-flow-vote-submitted"
  description    = "Route VoteSubmitted events to submitVote"
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  state          = "ENABLED"

  event_pattern = jsonencode({
    source      = ["talent-flow.workflow"]
    detail-type = ["VoteSubmitted"]
  })

  tags = merge(local.tf_tags, { Ticket = "NH-110" })
}

resource "aws_cloudwatch_event_target" "vote_submitted" {
  rule           = aws_cloudwatch_event_rule.vote_submitted.name
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  target_id      = "submitVote"
  arn            = "${local.tf_lambda_arn_prefix}:${local.tf_lambda_submit_vote}"
}

resource "aws_lambda_permission" "submit_vote_eventbridge" {
  statement_id  = "AllowEventBridgeInvokeSubmitVote"
  action        = "lambda:InvokeFunction"
  function_name = local.tf_lambda_submit_vote
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.vote_submitted.arn
}

# ── Rule 4: VotingCompleted → completeEvaluation ──────────────────────────────

resource "aws_cloudwatch_event_rule" "voting_completed" {
  name           = "talent-flow-voting-completed"
  description    = "Route VotingCompleted events to completeEvaluation"
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  state          = "ENABLED"

  event_pattern = jsonencode({
    source      = ["talent-flow.workflow"]
    detail-type = ["VotingCompleted"]
  })

  tags = merge(local.tf_tags, { Ticket = "NH-110" })
}

resource "aws_cloudwatch_event_target" "voting_completed" {
  rule           = aws_cloudwatch_event_rule.voting_completed.name
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  target_id      = "completeEvaluation"
  arn            = "${local.tf_lambda_arn_prefix}:${local.tf_lambda_complete_evaluation}"
}

resource "aws_lambda_permission" "complete_evaluation_eventbridge" {
  statement_id  = "AllowEventBridgeInvokeCompleteEvaluation"
  action        = "lambda:InvokeFunction"
  function_name = local.tf_lambda_complete_evaluation
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.voting_completed.arn
}

# ── Rule 5a: EvaluationCompleted (FAILED) → notification queue (I9-002) ───────
# FAILED path: TA receives an in-app/email notification that evaluation failed.

resource "aws_cloudwatch_event_rule" "evaluation_completed_failed" {
  name           = "talent-flow-evaluation-completed-failed"
  description    = "Route failed EvaluationCompleted events to notification queue"
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  state          = "ENABLED"

  event_pattern = jsonencode({
    source      = ["talent-flow.workflow"]
    detail-type = ["EvaluationCompleted"]
    detail      = { outcome = ["FAILED"] }
  })

  tags = merge(local.tf_tags, { Ticket = "NH-110" })
}

resource "aws_cloudwatch_event_target" "evaluation_completed_failed" {
  rule           = aws_cloudwatch_event_rule.evaluation_completed_failed.name
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  target_id      = "notificationQueue-evalFailed"
  arn            = aws_sqs_queue.talent_flow_notification.arn

  sqs_target {
    message_group_id = "evaluation-failed"
  }

  input_transformer {
    input_paths = {
      candidateId = "$.detail.candidateId"
      tenantId    = "$.detail.tenantId"
      finalScore  = "$.detail.finalScore"
    }
    input_template = "{\"type\":\"EVALUATION_FAILED\",\"recipientEmail\":\"system@talentflow.internal\",\"candidateId\":<candidateId>,\"tenantId\":<tenantId>,\"finalScore\":<finalScore>}"
  }
}

# ── Rule 5b: EvaluationCompleted (PASSED) → createOffer Lambda (Phase D) ──────
# Phase D: target updated from SQS placeholder to createOffer Lambda (NH-130).
# createOffer reads APPROVAL_RULES config, builds seniority-driven chain, writes
# the OFFER record to DynamoDB, and starts the Step Functions offer-approval machine.

resource "aws_cloudwatch_event_rule" "evaluation_completed_passed" {
  name           = "talent-flow-evaluation-completed-passed"
  description    = "Route passed EvaluationCompleted events to createOffer Lambda"
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  state          = "ENABLED"

  event_pattern = jsonencode({
    source      = ["talent-flow.workflow"]
    detail-type = ["EvaluationCompleted"]
    detail      = { outcome = ["PASSED"] }
  })

  tags = merge(local.tf_tags, { Ticket = "NH-130" })
}

resource "aws_cloudwatch_event_target" "evaluation_completed_passed" {
  rule           = aws_cloudwatch_event_rule.evaluation_completed_passed.name
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  target_id      = "createOffer-evalPassed"
  arn            = aws_lambda_function.create_offer.arn
}

resource "aws_lambda_permission" "create_offer_eventbridge" {
  statement_id  = "AllowEventBridgeInvokeCreateOffer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_offer.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.evaluation_completed_passed.arn
}

# ── Rule 6: SLABreached → notification queue (I9-003) ────────────────────────
# Fix: was invoking Lambda directly (wrong event format). Now routes via SQS
# so the Lambda's ESM handler processes it correctly.

resource "aws_cloudwatch_event_rule" "sla_breached" {
  name           = "talent-flow-sla-breached"
  description    = "Route SLABreached events to notification queue"
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  state          = "ENABLED"

  event_pattern = jsonencode({
    source      = ["talent-flow.sla"]
    detail-type = ["SLABreached"]
  })

  tags = merge(local.tf_tags, { Ticket = "NH-110" })
}

resource "aws_cloudwatch_event_target" "sla_breached" {
  rule           = aws_cloudwatch_event_rule.sla_breached.name
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  target_id      = "notificationQueue-slaBreached"
  arn            = aws_sqs_queue.talent_flow_notification.arn

  sqs_target {
    message_group_id = "sla-breached"
  }

  input_transformer {
    input_paths = {
      candidateId    = "$.detail.candidateId"
      tenantId       = "$.detail.tenantId"
      stage          = "$.detail.stage"
      hoursElapsed   = "$.detail.hoursElapsed"
      thresholdHours = "$.detail.thresholdHours"
    }
    input_template = "{\"type\":\"SLA_BREACHED\",\"recipientEmail\":\"system@talentflow.internal\",\"candidateId\":<candidateId>,\"tenantId\":<tenantId>,\"stage\":<stage>,\"hoursElapsed\":<hoursElapsed>,\"thresholdHours\":<thresholdHours>}"
  }
}

# ── Rule 7: OfferApproved → notification queue (I9-004) ──────────────────────
# Fix: was invoking Lambda directly (wrong event format). Now routes via SQS.
# Phase D wires the offer state transition (OFFER_APPROVED → OFFER_SENT) separately.

resource "aws_cloudwatch_event_rule" "offer_approved" {
  name           = "talent-flow-offer-approved"
  description    = "Route OfferApproved events to notification queue"
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  state          = "ENABLED"

  event_pattern = jsonencode({
    source      = ["talent-flow.workflow"]
    detail-type = ["OfferApproved"]
  })

  tags = merge(local.tf_tags, { Ticket = "NH-110" })
}

resource "aws_cloudwatch_event_target" "offer_approved" {
  rule           = aws_cloudwatch_event_rule.offer_approved.name
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  target_id      = "notificationQueue-offerApproved"
  arn            = aws_sqs_queue.talent_flow_notification.arn

  sqs_target {
    message_group_id = "offer-approved"
  }

  input_transformer {
    input_paths = {
      candidateId = "$.detail.candidateId"
      tenantId    = "$.detail.tenantId"
      offerId     = "$.detail.offerId"
    }
    input_template = "{\"type\":\"OFFER_APPROVED\",\"recipientEmail\":\"system@talentflow.internal\",\"candidateId\":<candidateId>,\"tenantId\":<tenantId>,\"offerId\":<offerId>}"
  }
}

# ── Rule 8: SentimentCaptured (HESITANT/DISENGAGED) → notification queue (I9-005) ─
# Fix: was invoking Lambda directly (wrong event format). Now routes via SQS.
# VERY_INTERESTED, INTERESTED, NEUTRAL are published to EventBridge but have no rule.

resource "aws_cloudwatch_event_rule" "sentiment_captured_risk" {
  name           = "talent-flow-sentiment-captured-risk"
  description    = "Route high-risk SentimentCaptured events to notification queue"
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  state          = "ENABLED"

  event_pattern = jsonencode({
    source      = ["talent-flow.workflow"]
    detail-type = ["SentimentCaptured"]
    detail = {
      interviewSentiment = ["HESITANT", "DISENGAGED"]
    }
  })

  tags = merge(local.tf_tags, { Ticket = "NH-123" })
}

resource "aws_cloudwatch_event_target" "sentiment_captured_risk" {
  rule           = aws_cloudwatch_event_rule.sentiment_captured_risk.name
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  target_id      = "notificationQueue-sentimentRisk"
  arn            = aws_sqs_queue.talent_flow_notification.arn

  sqs_target {
    message_group_id = "sentiment-risk"
  }

  input_transformer {
    input_paths = {
      candidateId        = "$.detail.candidateId"
      tenantId           = "$.detail.tenantId"
      interviewSentiment = "$.detail.interviewSentiment"
    }
    input_template = "{\"type\":\"SENTIMENT_RISK\",\"recipientEmail\":\"system@talentflow.internal\",\"candidateId\":<candidateId>,\"tenantId\":<tenantId>,\"interviewSentiment\":<interviewSentiment>}"
  }
}

# ── Rule 9: Hourly cron → monitorTalentFlowSLAs (default bus) ────────────────
# Uses the default event bus - scheduled rules must target the default bus.
# (EventBridge Scheduler or default bus cron - cron on custom bus not supported)

resource "aws_cloudwatch_event_rule" "sla_monitor_cron" {
  name                = "talent-flow-sla-monitor-hourly"
  description         = "Trigger monitorTalentFlowSLAs every hour to detect SLA breaches"
  schedule_expression = "rate(1 hour)"
  state               = "ENABLED"
  # No event_bus_name - targets the default bus (required for scheduled rules)

  tags = merge(local.tf_tags, { Ticket = "NH-110" })
}

resource "aws_cloudwatch_event_target" "sla_monitor_cron" {
  rule      = aws_cloudwatch_event_rule.sla_monitor_cron.name
  target_id = "monitorTalentFlowSLAs"
  arn       = "${local.tf_lambda_arn_prefix}:${local.tf_lambda_monitor_slas}"
}

resource "aws_lambda_permission" "sla_monitor_cron_eventbridge" {
  statement_id  = "AllowEventBridgeInvokeMonitorSLAs"
  action        = "lambda:InvokeFunction"
  function_name = local.tf_lambda_monitor_slas
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.sla_monitor_cron.arn
}

# ── Rule 10: IntelligenceRuleMatched → notification queue (INTEL-002 Phase 4) ─
# Routes Intelligence Layer alerts to existing notification system.
# Intelligence Layer evaluates rules when candidate data changes and publishes
# events when rules match. This rule routes them to the notification queue
# for email + in-app delivery via sendTalentFlowNotification Lambda.

resource "aws_cloudwatch_event_rule" "intelligence_rule_matched" {
  name           = "talent-flow-intelligence-rule-matched"
  description    = "Route IntelligenceRuleMatched events to notification queue"
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  state          = "ENABLED"

  event_pattern = jsonencode({
    source      = ["talent-flow.intelligence"]
    detail-type = ["IntelligenceRuleMatched"]
  })

  tags = merge(local.tf_tags, { Ticket = "INTEL-002" })
}

resource "aws_cloudwatch_event_target" "intelligence_rule_matched" {
  rule           = aws_cloudwatch_event_rule.intelligence_rule_matched.name
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  target_id      = "notificationQueue-intelligenceRuleMatched"
  arn            = aws_sqs_queue.talent_flow_notification.arn

  sqs_target {
    message_group_id = "intelligence-alerts"
  }

  # Pass the entire detail object without transformation to avoid issues with null values
  input_path = "$.detail"
}
