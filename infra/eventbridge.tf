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
