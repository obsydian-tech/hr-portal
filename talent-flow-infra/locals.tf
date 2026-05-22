# ---------------------------------------------------------------------------
# TalentFlow - Shared Locals (NH-104 / TF-001, extended by all TF-00x tasks)
#
# Single source of truth for every TalentFlow resource name and shared value.
# No talent-flow-*.tf file hardcodes a table, Lambda, queue, or bus name -
# all reference these locals.
#
# Convention: all locals are prefixed `tf_` to be self-documenting.
# ---------------------------------------------------------------------------

locals {

  # ── Shared tag block ──────────────────────────────────────────────────────
  # Usage: tags = merge(local.tf_tags, { Purpose = "...", Ticket = "NH-xxx" })
  tf_tags = {
    Project            = "TalentFlow"
    ManagedBy          = "Terraform"
    DataClassification = "Confidential"
    Environment        = var.environment
    Region             = "af-south-1"
  }

  # ── Placeholder ZIP ───────────────────────────────────────────────────────
  # All Lambda declarations use this until real deployment ZIPs are available.
  tf_placeholder_zip = "${path.root}/../placeholder.zip"

  # ── DynamoDB table names ──────────────────────────────────────────────────
  tf_table_state           = "talent-flow-state"
  tf_table_config          = "talent-flow-config"
  tf_table_agent_audit     = "talent-flow-agent-audit"
  tf_table_pending_actions = "talent-flow-pending-actions"
  tf_table_prompt_cache    = "talent-flow-prompt-cache"
  tf_table_rate_limit      = "talent-flow-ai-rate-limit"
  tf_table_idempotency     = "talent-flow-idempotency-keys"
  tf_table_notifications   = "talent-flow-notifications"

  # ── EventBridge ───────────────────────────────────────────────────────────
  tf_event_bus_name = "talent-flow-bus"

  # ── SQS queue names ───────────────────────────────────────────────────────
  tf_queue_notification     = "talent-flow-notification-queue.fifo"
  tf_queue_notification_dlq = "talent-flow-notification-dlq.fifo"
  tf_queue_feedback         = "talent-flow-feedback-queue.fifo"
  tf_queue_feedback_dlq     = "talent-flow-feedback-dlq.fifo"

  # ── Lambda function names ─────────────────────────────────────────────────
  tf_lambda_create_candidate     = "createCandidate"
  tf_lambda_orchestrate_workflow = "orchestrateTalentFlowWorkflow"
  tf_lambda_schedule_interview   = "scheduleInterview"
  tf_lambda_submit_vote          = "submitVote"
  tf_lambda_complete_evaluation  = "completeEvaluation"
  tf_lambda_manage_config        = "manageTalentFlowConfig"
  tf_lambda_send_notification    = "sendTalentFlowNotification"
  tf_lambda_monitor_slas         = "monitorTalentFlowSLAs"
  tf_lambda_ai_chat              = "talentFlowAiChat"
  tf_lambda_authorizer           = "talentFlowAuthorizer"
  tf_lambda_approve_action       = "talentFlowApproveAction"
  tf_lambda_archive_audit        = "talentFlowArchiveAuditLog"
  tf_lambda_rotate_api_key       = "talentFlowRotateApiKey"
  tf_lambda_get_candidates       = "getCandidates"
  tf_lambda_get_candidate        = "getCandidate"
  tf_lambda_get_panel_members    = "getPanelMembers"
  tf_lambda_advance_stage        = "advanceCandidateStage"
  tf_lambda_get_notifications    = "getUserNotifications"
  tf_lambda_mark_notif_read      = "markNotificationRead"
  tf_lambda_capture_sentiment    = "captureSentiment"
  tf_lambda_create_offer         = "createOffer"
  tf_lambda_get_offer            = "getOffer"
  tf_lambda_advance_offer_state  = "advanceOfferState"
  tf_lambda_update_candidate          = "updateCandidate"
  tf_lambda_generate_scoring_link     = "generateScoringLink"
  tf_lambda_submit_vote_by_token      = "submitVoteByToken"

  # ── KMS key aliases ───────────────────────────────────────────────────────
  tf_kms_alias_state       = "alias/talent-flow/state"
  tf_kms_alias_agent_audit = "alias/talent-flow/agent-audit"

  # ── S3 ────────────────────────────────────────────────────────────────────
  tf_bucket_audit_archive = "talent-flow-audit-archive-${var.aws_account_id}"

  # ── Secrets Manager ───────────────────────────────────────────────────────
  tf_secret_agent_api_key = "talent-flow/agent/api-key"

  # ── Bedrock model IDs ─────────────────────────────────────────────────────
  tf_model_fast  = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
  tf_model_smart = "us.anthropic.claude-sonnet-4-5-20251001-v1:0"

  # ── Cognito ───────────────────────────────────────────────────────────────
  tf_cognito_pool_name   = "talent-flow-user-pool"
  tf_cognito_client_name = "talent-flow-web-client"
  tf_lambda_pre_token    = "talentFlowPreTokenTrigger"

  # Epic 5 Step 2: pool consolidation — talent-flow-api JWT authorizer now
  # validates tokens from the Naleko parent pool (af-south-1_2LdAGFnw2).
  # TalentFlow users exist as groups inside the Naleko pool. Angular logs in
  # once via the Naleko pool and that single token is accepted everywhere.
  tf_naleko_pool_id   = "af-south-1_2LdAGFnw2"
  tf_naleko_client_id = "1pk5rd58glsohfplnlr63tg0qb"

  # Groups - internal staff only (candidates are DynamoDB records, not Cognito users)
  tf_cognito_groups = toset([
    "TalentFlowAdmin",   # full access + config management
    "HiringManager",     # create candidates, view pipeline, approve offers
    "PanelMember",       # submit votes for assigned interviews
    "ComplianceOfficer", # read-only audit access
    "ITAdmin",           # infrastructure and config read
    "FinanceLead",       # budget approval in offer stage
    "HRDirector",        # dashboard and reporting
  ])

  # ── IAM role name prefix ──────────────────────────────────────────────────
  # Per-Lambda role name = tf_iam_role_prefix + lambda function name
  # Example: "talent-flow-role-createCandidate"
  tf_iam_role_prefix = "talent-flow-role-"

  # ── Step Functions ────────────────────────────────────────────────────────
  tf_sfn_state_machine_name = "talent-flow-offer-approval"
}
