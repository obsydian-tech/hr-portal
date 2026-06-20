# ═══════════════════════════════════════════════════════════════════════════════
# Intelligence Dismissals Table — INTEL-002 EPIC 1 Task 1.1
# ═══════════════════════════════════════════════════════════════════════════════
#
# Purpose: Per-user tile dismissal, snooze, and acknowledge records
#          Enables user-driven intelligence governance (§4.5 design)
#
# Schema:
#   PK  = USER#{userId}                   (partition by user for per-user queries)
#   SK  = TILEDISMISS#{tileKey}           (tileKey = {entityId}#{ruleId})
#
# Attributes:
#   action              - DISMISS | SNOOZE | ACKNOWLEDGE
#   snoozeUntil         - ISO8601 timestamp (only for SNOOZE)
#   reason              - Optional user reason text
#   snapshotSignature   - Hash of condition (so recurring issues resurface)
#   at                  - ISO8601 timestamp of action
#   ttl                 - Unix epoch (POPIA: 90-day retention for user preferences)
#
# Access Patterns:
#   1. Check user's dismissals: Query PK=USER#{userId}
#   2. Check specific tile:     GetItem PK=USER#{userId}, SK=TILEDISMISS#{tileKey}
#
# POPIA: User preference data with 90-day TTL (sufficient for operational needs)
#
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_dynamodb_table" "intelligence_dismissals" {
  name         = "talent-flow-intelligence-dismissals"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # TTL - 90 days (user preferences retained for 3 months per POPIA)
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.talent_flow_state.arn
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(local.tf_tags, {
    Purpose            = "IntelligenceDismissalState"
    DataClassification = "Internal"
    RetentionDays      = "90"
    Ticket             = "INTEL-002"
    Phase              = "EPIC1-Task1.1"
  })
}
