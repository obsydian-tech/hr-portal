# ---------------------------------------------------------------------------
# TalentFlow - DynamoDB Tables (7)
# Ticket : NH-107 / TF-004
#
# Architecture: 7 purpose-specific tables - each owns a concern.
# Plan doc s.2.3 + locals.tf are the source of truth for names and schemas.
# Ticket's domain-separated design (candidates/workflows/interviews/votes…)
# overridden by plan doc's SAGA-state single-table per concern approach.
#
# KMS split (TF-002 CMKs):
#   talent_flow_state      → state, config, pending-actions, rate-limit, idempotency
#   talent_flow_agent_audit → agent-audit, prompt-cache
#
# Streams: talent-flow-state only (feeds SLA monitor in TF-012)
# PITR   : all 7 tables (POPIA data recovery requirement)
# TTLs   : config (expiresAt on inactive versions), agent-audit (30d),
#          prompt-cache (1hr), pending-actions (24hr), rate-limit (rolling),
#          idempotency-keys (48hr)
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 1. talent-flow-state
#    SAGA operational records - candidates, interviews, votes, workflows.
#    All entities share this table, differentiated by PK prefix:
#      CANDIDATE#{id}  INTERVIEW#{id}  VOTE#{id}  WORKFLOW#{id}
#    Stream enabled - SLA monitor Lambda polls NEW_AND_OLD_IMAGES.
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "talent_flow_state" {
  name         = local.tf_table_state
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

  # GSI1 - generic reusable index (access pattern: query by tenant + entity type)
  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  # GSI2 - second reusable index (e.g. query by candidateId or workflowId)
  attribute {
    name = "GSI2PK"
    type = "S"
  }

  attribute {
    name = "GSI2SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI2"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  # Stream - consumed by monitorTalentFlowSLAs Lambda (TF-012)
  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.talent_flow_state.arn
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(local.tf_tags, {
    Purpose            = "SagaOperationalState"
    DataClassification = "Confidential"
    RetentionYears     = "7"
    Ticket             = "NH-107"
  })
}

# ---------------------------------------------------------------------------
# 2. talent-flow-config
#    Metadata-Lite Variable Six store. MUST have GSI1 for active config queries.
#    ALL Lambdas call getConfig() at runtime - GSI1 is the hot read path.
#    TTL on expiresAt - set ONLY on inactive versions (365d retention then purge).
#
#    PK  = TENANT#{tenantId}
#    SK  = CONFIG#{configType}#v{version}
#    GSI1PK = TENANT#{tenantId}#ACTIVE
#    GSI1SK = CONFIG#{configType}
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "talent_flow_config" {
  name         = local.tf_table_config
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

  # GSI1 - active config query: GSI1PK = TENANT#DEFAULT#ACTIVE AND GSI1SK = CONFIG#SCORING_WEIGHTS
  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1-active-configs"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  # TTL - set on inactive config versions only (active versions omit this attribute)
  ttl {
    attribute_name = "expiresAt"
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
    Purpose            = "MetadataLiteConfig"
    DataClassification = "Confidential"
    RetentionYears     = "7"
    Ticket             = "NH-107"
  })
}

# ---------------------------------------------------------------------------
# 3. talent-flow-agent-audit
#    Full AI interaction audit trail (POPIA s.21 accountability).
#    Every prompt + response from talentFlowAiChat Lambda recorded here.
#    PK = AUDIT#{staffId}  SK = ISO8601 timestamp
#    GSI DateIndex - compliance date-range queries
#    TTL 30 days (hot window); DynamoDB Stream → S3 archive (TF-005/TF-012)
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "talent_flow_agent_audit" {
  name         = local.tf_table_agent_audit
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "date"
    type = "S"
  }

  # DateIndex - compliance queries: all AI interactions on a calendar day
  global_secondary_index {
    name            = "DateIndex"
    hash_key        = "date"
    range_key       = "sk"
    projection_type = "ALL"
  }

  # 30-day hot window; stream feeds S3 archiver for 5-year POPIA retention
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.talent_flow_agent_audit.arn
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(local.tf_tags, {
    Purpose            = "AgentAuditTrail"
    DataClassification = "AUDIT"
    RetentionDays      = "30"
    Ticket             = "NH-107"
  })
}

# ---------------------------------------------------------------------------
# 4. talent-flow-prompt-cache
#    SHA-256 keyed full-response cache (1hr TTL).
#    Cache key = SHA-256(systemPrompt + firstUserMessage + modelId)
#    Eliminates repeat Bedrock calls for identical prompts.
#    PK = CACHE#{sha256hash}
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "talent_flow_prompt_cache" {
  name         = local.tf_table_prompt_cache
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "cacheKey"

  attribute {
    name = "cacheKey"
    type = "S"
  }

  # 1-hour TTL - cache entries auto-purge
  ttl {
    attribute_name = "expiresAt"
    enabled        = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.talent_flow_agent_audit.arn
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = merge(local.tf_tags, {
    Purpose       = "PromptCache"
    RetentionDays = "0.04"
    Ticket        = "NH-107"
  })
}

# ---------------------------------------------------------------------------
# 5. talent-flow-pending-actions
#    HITL gate - AI agent write actions pending human approval.
#    Matches Naleko naleko-pending-actions pattern exactly.
#    PK = ACTION#{actionId}   TTL 24hr (auto-expire unapproved actions)
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "talent_flow_pending_actions" {
  name         = local.tf_table_pending_actions
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "actionId"

  attribute {
    name = "actionId"
    type = "S"
  }

  # 24hr TTL - unapproved actions auto-expire
  ttl {
    attribute_name = "expiresAt"
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
    Purpose            = "HITLGate"
    DataClassification = "Internal"
    RetentionDays      = "1"
    Ticket             = "NH-107"
  })
}

# ---------------------------------------------------------------------------
# 6. talent-flow-ai-rate-limit
#    Rolling per-user rate limit (50 req/hr window).
#    PK = RATE#{staffId}   SK = WINDOW#{epochMinute}
#    TTL on window expiry - rolling window self-cleans
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "talent_flow_ai_rate_limit" {
  name         = local.tf_table_rate_limit
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  # Rolling window items self-expire
  ttl {
    attribute_name = "expiresAt"
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
    Purpose = "AiRateLimit"
    Ticket  = "NH-107"
  })
}

# ---------------------------------------------------------------------------
# 7. talent-flow-idempotency-keys
#    48hr TTL dedup for Lambda mutation endpoints (createCandidate, etc.).
#    Matches Naleko naleko-idempotency-keys pattern.
#    PK = IDEM#{idempotencyKey}
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "talent_flow_idempotency_keys" {
  name         = local.tf_table_idempotency
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "idempotencyKey"

  attribute {
    name = "idempotencyKey"
    type = "S"
  }

  # 48hr TTL - dedup window
  ttl {
    attribute_name = "expiresAt"
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
    Purpose            = "IdempotencyDedup"
    DataClassification = "Internal"
    RetentionDays      = "2"
    Ticket             = "NH-107"
  })
}
