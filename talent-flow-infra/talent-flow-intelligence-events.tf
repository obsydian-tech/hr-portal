# ═══════════════════════════════════════════════════════════════════════════════
# Intelligence Events Table — §7.5 Event Log
# ═══════════════════════════════════════════════════════════════════════════════
#
# Purpose: Log all rule evaluations and notification events for:
#   - Fire rate metrics (notifications per rule per week)
#   - Action conversion tracking (% where user acted)
#   - Per-rule attribution (which rules drive action)
#   - Compliance audit trail
#
# Key Structure:
#   PK: TENANT#{tenantId}
#   SK: INTEL#{iso-timestamp}#{eventId}
#
# GSIs:
#   ByRule:      RULE#{ruleId} / {timestamp}     - Query events per rule
#   ByEntity:    ENTITY#{type}#{id} / {timestamp} - Query events per candidate/offer
#   ByRecipient: USER#{userId} / {timestamp}      - Query events per user
#
# TTL: 90 days (analytics window for tuning)
#
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_dynamodb_table" "intelligence_events" {
  name         = "talent-flow-intelligence-events"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  # ── Primary Key ─────────────────────────────────────────────────────────────

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # ── GSI Attributes ──────────────────────────────────────────────────────────

  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  attribute {
    name = "GSI2PK"
    type = "S"
  }

  attribute {
    name = "GSI2SK"
    type = "S"
  }

  attribute {
    name = "GSI3PK"
    type = "S"
  }

  attribute {
    name = "GSI3SK"
    type = "S"
  }

  # ── GSI1: ByRule ────────────────────────────────────────────────────────────
  # Query: "How many times did RULE-DROP-001 fire this week?"
  # Key:   GSI1PK = "RULE#RULE-DROP-001", GSI1SK between timestamps

  global_secondary_index {
    name            = "ByRule"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  # ── GSI2: ByEntity ──────────────────────────────────────────────────────────
  # Query: "What intelligence events for candidate CAND-01J8K2M3N4P5?"
  # Key:   GSI2PK = "ENTITY#CANDIDATE#CAND-01J8K2M3N4P5"

  global_secondary_index {
    name            = "ByEntity"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  # ── GSI3: ByRecipient ───────────────────────────────────────────────────────
  # Query: "What intelligence events were sent to user 811c8228-...?"
  # Key:   GSI3PK = "USER#811c8228-5071-709e-bb21-2f424a2d80d0"

  global_secondary_index {
    name            = "ByRecipient"
    hash_key        = "GSI3PK"
    range_key       = "GSI3SK"
    projection_type = "ALL"
  }

  # ── TTL: 90-day analytics window ────────────────────────────────────────────

  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  # ── Point-in-time recovery ──────────────────────────────────────────────────

  point_in_time_recovery {
    enabled = true
  }

  # ── Encryption (reuse existing KMS key) ─────────────────────────────────────

  server_side_encryption {
    enabled     = true
    kms_key_arn = data.aws_kms_key.talent_flow_state.arn
  }

  tags = merge(local.tf_tags, {
    Purpose = "IntelligenceLayerEventLog"
    Ticket  = "INTEL-002"
    Phase   = "7.5"
  })
}

# ── Output for reference ──────────────────────────────────────────────────────

output "intelligence_events_table_name" {
  description = "Intelligence Events table name"
  value       = aws_dynamodb_table.intelligence_events.name
}

output "intelligence_events_table_arn" {
  description = "Intelligence Events table ARN"
  value       = aws_dynamodb_table.intelligence_events.arn
}
