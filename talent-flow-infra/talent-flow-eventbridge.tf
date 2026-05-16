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

# ── Rule 5: EvaluationCompleted → sendTalentFlowNotification ─────────────────

resource "aws_cloudwatch_event_rule" "evaluation_completed" {
  name           = "talent-flow-evaluation-completed"
  description    = "Route EvaluationCompleted events to sendTalentFlowNotification"
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  state          = "ENABLED"

  event_pattern = jsonencode({
    source      = ["talent-flow.workflow"]
    detail-type = ["EvaluationCompleted"]
  })

  tags = merge(local.tf_tags, { Ticket = "NH-110" })
}

resource "aws_cloudwatch_event_target" "evaluation_completed" {
  rule           = aws_cloudwatch_event_rule.evaluation_completed.name
  event_bus_name = aws_cloudwatch_event_bus.talent_flow.name
  target_id      = "sendTalentFlowNotification-evalCompleted"
  arn            = "${local.tf_lambda_arn_prefix}:${local.tf_lambda_send_notification}"
}

resource "aws_lambda_permission" "send_notification_evaluation_completed" {
  statement_id  = "AllowEventBridgeInvokeNotifyEvalCompleted"
  action        = "lambda:InvokeFunction"
  function_name = local.tf_lambda_send_notification
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.evaluation_completed.arn
}

# ── Rule 6: SLABreached → sendTalentFlowNotification ─────────────────────────

resource "aws_cloudwatch_event_rule" "sla_breached" {
  name           = "talent-flow-sla-breached"
  description    = "Route SLABreached events to sendTalentFlowNotification"
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
  target_id      = "sendTalentFlowNotification-slaBreached"
  arn            = "${local.tf_lambda_arn_prefix}:${local.tf_lambda_send_notification}"
}

resource "aws_lambda_permission" "send_notification_sla_breached" {
  statement_id  = "AllowEventBridgeInvokeNotifySLABreached"
  action        = "lambda:InvokeFunction"
  function_name = local.tf_lambda_send_notification
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.sla_breached.arn
}

# ── Rule 7: OfferApproved → sendTalentFlowNotification ───────────────────────

resource "aws_cloudwatch_event_rule" "offer_approved" {
  name           = "talent-flow-offer-approved"
  description    = "Route OfferApproved events to sendTalentFlowNotification"
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
  target_id      = "sendTalentFlowNotification-offerApproved"
  arn            = "${local.tf_lambda_arn_prefix}:${local.tf_lambda_send_notification}"
}

resource "aws_lambda_permission" "send_notification_offer_approved" {
  statement_id  = "AllowEventBridgeInvokeNotifyOfferApproved"
  action        = "lambda:InvokeFunction"
  function_name = local.tf_lambda_send_notification
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.offer_approved.arn
}

# ── Rule 8: Hourly cron → monitorTalentFlowSLAs (default bus) ────────────────
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
