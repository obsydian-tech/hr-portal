# ---------------------------------------------------------------------------
# TalentFlow - Cognito User Pool, App Client, Groups, Pre-Token Lambda
# Ticket : NH-106 / TF-003
# Pattern: Follows infra/cognito.tf (ESSENTIALS tier, admin-create-only,
#           lambda_config in same file - pragmatic for MVP1)
# Auth   : PKCE / Authorization Code Grant - more secure, Angular-ready
# Groups : Internal staff only. Candidates are DynamoDB records, not
#          Cognito users (they gain portal access in MVP2).
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 1. Pre-Token Generation Lambda
#    Injects custom:isAdmin = "true" into JWT for TalentFlowAdmin group members.
#    Logic mirrors Naleko's cognito_post_auth pattern but for token enrichment.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "pre_token_assume" {
  statement {
    sid     = "AllowLambdaAssume"
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "pre_token_trigger" {
  name               = "${local.tf_iam_role_prefix}${local.tf_lambda_pre_token}"
  assume_role_policy = data.aws_iam_policy_document.pre_token_assume.json

  tags = merge(local.tf_tags, {
    Purpose = "PreTokenLambdaRole"
    Ticket  = "NH-106"
  })
}

resource "aws_iam_role_policy_attachment" "pre_token_basic_execution" {
  role       = aws_iam_role.pre_token_trigger.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "talent_flow_pre_token_trigger" {
  function_name = local.tf_lambda_pre_token
  role          = aws_iam_role.pre_token_trigger.arn
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"
  filename      = local.tf_placeholder_zip

  environment {
    variables = {
      ADMIN_GROUP = "TalentFlowAdmin"
    }
  }

  tags = merge(local.tf_tags, {
    Purpose = "CognitoIsAdminClaim"
    Ticket  = "NH-106"
  })
}

# Allow Cognito to invoke the pre-token Lambda
resource "aws_lambda_permission" "cognito_invoke_pre_token" {
  statement_id  = "AllowCognitoInvokePreToken"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.talent_flow_pre_token_trigger.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.talent_flow.arn
}

# ---------------------------------------------------------------------------
# 2. User Pool
# ---------------------------------------------------------------------------

resource "aws_cognito_user_pool" "talent_flow" {
  name                     = local.tf_cognito_pool_name
  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]
  deletion_protection      = "INACTIVE"
  mfa_configuration        = "OFF"
  user_pool_tier           = "ESSENTIALS"

  username_configuration {
    case_sensitive = false
  }

  password_policy {
    minimum_length                   = 12
    password_history_size            = 0
    require_lowercase                = true
    require_numbers                  = true
    require_symbols                  = true
    require_uppercase                = true
    temporary_password_validity_days = 7
  }

  # Internal staff only - no self-registration
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
  }

  sign_in_policy {
    allowed_first_auth_factors = ["PASSWORD"]
  }

  # Standard email schema
  schema {
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    name                     = "email"
    required                 = true
    string_attribute_constraints {
      max_length = "2048"
      min_length = "0"
    }
  }

  # Custom attribute: injected by pre-token Lambda for TalentFlowAdmin group members.
  # Angular route guards read this claim to show/hide config management UI.
  schema {
    attribute_data_type      = "Boolean"
    developer_only_attribute = false
    mutable                  = true
    name                     = "isAdmin"
    required                 = false
  }

  lambda_config {
    pre_token_generation = aws_lambda_function.talent_flow_pre_token_trigger.arn
  }

  tags = merge(local.tf_tags, {
    Purpose = "TalentFlowUserPool"
    Ticket  = "NH-106"
  })
}

# ---------------------------------------------------------------------------
# 3. App Client - Authorization Code Grant with PKCE
#    Angular SPA will use Amplify / aws-amplify with PKCE flow.
#    No client_secret - public SPA.
# ---------------------------------------------------------------------------

resource "aws_cognito_user_pool_client" "talent_flow_web" {
  name         = local.tf_cognito_client_name
  user_pool_id = aws_cognito_user_pool.talent_flow.id

  # PKCE: code grant only, no implicit, no client_credentials
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "profile", "email"]
  supported_identity_providers         = ["COGNITO"]

  # SRP + refresh - PKCE sits on top of code grant, SRP handles password exchange
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # MVP1 dev redirects - extend with prod URL when domain is configured
  callback_urls = [
    "http://localhost:4200/auth/callback",
  ]
  logout_urls = [
    "http://localhost:4200/auth/logout",
  ]

  # Token validity
  access_token_validity  = 60 # 1 hour (minutes)
  id_token_validity      = 60 # 1 hour (minutes)
  refresh_token_validity = 30 # 30 days

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  # No client secret - public SPA, PKCE provides the security
  generate_secret = false
}

# ---------------------------------------------------------------------------
# 4. User Pool Groups - 7 internal staff roles
#    for_each on tf_cognito_groups set - each group added with no IAM role
#    for MVP1. IAM role attachment deferred to TF-008.
# ---------------------------------------------------------------------------

resource "aws_cognito_user_group" "talent_flow" {
  for_each = local.tf_cognito_groups

  name         = each.value
  user_pool_id = aws_cognito_user_pool.talent_flow.id
  description  = "TalentFlow group: ${each.value}"
  precedence   = 0
}
