# ═══════════════════════════════════════════════════════════════════════════════
# REC-09 (NH-243): add-only grants for the rule engine and the hourly check
# ═══════════════════════════════════════════════════════════════════════════════
#
# evaluateIntelligenceRules: write the flag rows it makes (notifications table), find the people a flag goes to (members of the
# company: Query on the tenants table; people of a group: Cognito ListUsersInGroup and AdminGetUser, on the one pool; the hiring
# manager of a role: the roles table). Drafts use its existing state-table PutItem.
# monitorTalentFlowSLAs: remind interviewers (queue send and its key), write the flag rows it makes, look people up the same way,
# and mark missed interviews (its existing state-table UpdateItem). The state-table PutItem is pinned by the locked test (rec-09 AC-10 policy-lines.json) although the reminder guard row goes to the notifications table; dropping it needs a child lock (leftover L6).
# Every statement is written out here in full (no locals, no concat) so the IAM checks can read it. Nothing here is a wildcard action. KMS decrypt for the tenants table comes through infra/kms.tf dynamodb_read_role_arns.
# ═══════════════════════════════════════════════════════════════════════════════

resource "aws_iam_role_policy" "evaluate_intelligence_rules_rec09" {
  name = "rec09-flags-and-drafts-evaluate-intelligence-rules"
  role = aws_iam_role.evaluate_intelligence_rules.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RecipientsMembersQuery"
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = ["arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_tenants_table}"]
      },
      {
        Sid      = "RecipientsPool"
        Effect   = "Allow"
        Action   = ["cognito-idp:ListUsersInGroup", "cognito-idp:AdminGetUser"]
        Resource = "arn:aws:cognito-idp:af-south-1:${var.aws_account_id}:userpool/${local.tf_naleko_pool_id}"
      },
      {
        Sid      = "RecipientsRolesRead"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_roles}"
      },
      {
        Sid      = "RolesKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:DescribeKey"]
        Resource = aws_kms_key.talent_flow_state.arn
      },
      {
        Sid      = "FlagNotificationsWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_notifications}"
      },
    ]
  })
}

resource "aws_iam_role_policy" "monitor_slas_rec09" {
  name = "rec09-reminders-and-flags-monitor-slas"
  role = aws_iam_role.monitor_slas.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "RecipientsMembersQuery"
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = ["arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_tenants_table}"]
      },
      {
        Sid      = "RecipientsPool"
        Effect   = "Allow"
        Action   = ["cognito-idp:ListUsersInGroup", "cognito-idp:AdminGetUser"]
        Resource = "arn:aws:cognito-idp:af-south-1:${var.aws_account_id}:userpool/${local.tf_naleko_pool_id}"
      },
      {
        Sid      = "RecipientsRolesRead"
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:Query"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_roles}"
      },
      {
        Sid      = "RolesKey"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:DescribeKey"]
        Resource = aws_kms_key.talent_flow_state.arn
      },
      {
        Sid      = "FlagNotificationsWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_notifications}"
      },
      {
        Sid      = "ReminderQueueSend"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.talent_flow_notification.arn
      },
      {
        Sid      = "ReminderQueueKey"
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = aws_kms_key.talent_flow_agent_audit.arn
      },
      {
        Sid      = "ReminderGuardWrite"
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem"]
        Resource = "arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_table_state}"
      },
    ]
  })
}

# getIntelligenceTiles names the person a flag is about (feedback owed, strong no) the same way the engine does: the company's Member
# rows (Query on the tenants table) and the person's name in the pool (AdminGetUser). Add only.
resource "aws_iam_role_policy" "get_intelligence_tiles_rec09" {
  name = "rec09-names-get-intelligence-tiles"
  role = aws_iam_role.get_intelligence_tiles.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "NamesMembersQuery"
        Effect   = "Allow"
        Action   = ["dynamodb:Query"]
        Resource = ["arn:aws:dynamodb:af-south-1:${var.aws_account_id}:table/${local.tf_tenants_table}"]
      },
      {
        Sid      = "NamesPool"
        Effect   = "Allow"
        Action   = ["cognito-idp:AdminGetUser"]
        Resource = "arn:aws:cognito-idp:af-south-1:${var.aws_account_id}:userpool/${local.tf_naleko_pool_id}"
      },
    ]
  })
}
