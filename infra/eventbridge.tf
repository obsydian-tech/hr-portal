# ---------------------------------------------------------------------------
# EventBridge custom bus — NH-14
# Bus: naleko-onboarding
# Publishes: employee.invited, document.uploaded, ocr.completed,
#            verification.passed, verification.failed, verification.manual_review,
#            document.reviewed, employee.stage_changed, onboarding.completed
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_event_bus" "naleko_onboarding" {
  name = "naleko-onboarding"
}

# ---------------------------------------------------------------------------
# NH-27: EventBridge rule — all naleko.* events -> auditLogConsumer Lambda
# Catch-all pattern: any event whose source starts with "naleko."
# This captures all 9 event types published by the platform Lambdas.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "audit_log_all_events" {
  name           = "naleko-audit-all-events"
  description    = "Capture every naleko.* event and fan out to auditLogConsumer"
  event_bus_name = aws_cloudwatch_event_bus.naleko_onboarding.name

  event_pattern = jsonencode({
    source = [{ prefix = "naleko." }]
  })

  state = "ENABLED"
}

resource "aws_cloudwatch_event_target" "audit_log_consumer" {
  rule           = aws_cloudwatch_event_rule.audit_log_all_events.name
  event_bus_name = aws_cloudwatch_event_bus.naleko_onboarding.name
  target_id      = "auditLogConsumer"
  arn            = aws_lambda_function.audit_log_consumer.arn
}

resource "aws_lambda_permission" "audit_log_consumer_eventbridge" {
  statement_id  = "AllowEventBridgeInvokeAuditLog"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.audit_log_consumer.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.audit_log_all_events.arn
}

# ---------------------------------------------------------------------------
# NH-notification-emails: sendNotificationEmail EventBridge rules
# Rule 1: document.reviewed events  (PASSED / FAILED / MANUAL_REVIEW)
# Rule 2: onboarding.completed events
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_event_rule" "document_reviewed_notify" {
  name           = "naleko-document-reviewed-notify"
  description    = "Trigger sendNotificationEmail on document.reviewed events"
  event_bus_name = aws_cloudwatch_event_bus.naleko_onboarding.name

  event_pattern = jsonencode({
    source      = ["naleko.onboarding"]
    detail-type = ["document.reviewed"]
  })

  state = "ENABLED"
}

resource "aws_cloudwatch_event_target" "document_reviewed_notify" {
  rule           = aws_cloudwatch_event_rule.document_reviewed_notify.name
  event_bus_name = aws_cloudwatch_event_bus.naleko_onboarding.name
  target_id      = "sendNotificationEmail-docReviewed"
  arn            = aws_lambda_function.send_notification_email.arn
}

resource "aws_lambda_permission" "send_notification_email_document_reviewed" {
  statement_id  = "AllowEventBridgeInvokeNotifyDocReviewed"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.send_notification_email.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.document_reviewed_notify.arn
}

resource "aws_cloudwatch_event_rule" "onboarding_completed_notify" {
  name           = "naleko-onboarding-completed-notify"
  description    = "Trigger sendNotificationEmail on onboarding.completed events"
  event_bus_name = aws_cloudwatch_event_bus.naleko_onboarding.name

  event_pattern = jsonencode({
    source      = ["naleko.onboarding"]
    detail-type = ["onboarding.completed"]
  })

  state = "ENABLED"
}

resource "aws_cloudwatch_event_target" "onboarding_completed_notify" {
  rule           = aws_cloudwatch_event_rule.onboarding_completed_notify.name
  event_bus_name = aws_cloudwatch_event_bus.naleko_onboarding.name
  target_id      = "sendNotificationEmail-onboardingCompleted"
  arn            = aws_lambda_function.send_notification_email.arn
}

resource "aws_lambda_permission" "send_notification_email_onboarding_completed" {
  statement_id  = "AllowEventBridgeInvokeNotifyOnboardingCompleted"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.send_notification_email.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.onboarding_completed_notify.arn
}
