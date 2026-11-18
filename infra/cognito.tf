# ---------------------------------------------------------------------------
# Cognito User Pool — NH-11 Terraform import
# ---------------------------------------------------------------------------

resource "aws_cognito_user_pool" "naleko_dev" {
  name                     = "naleko-dev-user-pool"
  auto_verified_attributes = ["email"]
  username_attributes      = ["email"]
  deletion_protection      = "ACTIVE"
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

  user_attribute_update_settings {
    attributes_require_verification_before_update = ["email"]
  }

  sign_in_policy {
    allowed_first_auth_factors = ["PASSWORD"]
  }

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

  schema {
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    name                     = "employee_id"
    required                 = false
    string_attribute_constraints {
      max_length = "20"
      min_length = "0"
    }
  }

  schema {
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    name                     = "role"
    required                 = false
    string_attribute_constraints {
      max_length = "20"
      min_length = "0"
    }
  }

  schema {
    attribute_data_type      = "String"
    developer_only_attribute = false
    mutable                  = true
    name                     = "staff_id"
    required                 = false
    string_attribute_constraints {
      max_length = "20"
      min_length = "0"
    }
  }

  # NH-80: Fire cognitoPostAuth Lambda on every successful login.
  # Bumps employee stage INVITED → ACTIVE on first login.
  lambda_config {
    post_authentication = aws_lambda_function.cognito_post_auth.arn
    post_confirmation   = aws_lambda_function.cognito_post_confirmation.arn
    kms_key_id          = module.kms_pii.key_arn
    # TEN-06: TalentFlow people move to this pool the first time they sign in or reset their password.
    user_migration = aws_lambda_function.user_migration.arn

    custom_email_sender {
      lambda_arn     = aws_lambda_function.cognito_email_sender.arn
      lambda_version = "V1_0"
    }

    # TEN-01: the company claim on every ID and access token.
    pre_token_generation_config {
      lambda_arn     = aws_lambda_function.tenant_pre_token.arn
      lambda_version = "V2_0"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# ---------------------------------------------------------------------------
# Cognito User Groups — NH-133 Platform Shell
# Each group gates access to one platform module.
# AuthService reads cognito:groups from the JWT and derives AuthUser.modules[].
# No Lambda, no DynamoDB — purely JWT-based access control.
# ---------------------------------------------------------------------------

resource "aws_cognito_user_group" "onboarding_hr" {
  name         = "naleko-onboarding-hr"
  user_pool_id = aws_cognito_user_pool.naleko_dev.id
  description  = "HR staff with access to the Onboarding module"
  precedence   = 10
}

resource "aws_cognito_user_group" "talentflow_hr" {
  name         = "naleko-talentflow-hr"
  user_pool_id = aws_cognito_user_pool.naleko_dev.id
  description  = "HR staff with access to the TalentFlow module"
  precedence   = 20
}

resource "aws_cognito_user_group" "it_provisioning" {
  name         = "naleko-it-provisioning"
  user_pool_id = aws_cognito_user_pool.naleko_dev.id
  description  = "IT Specialists with access to the IT Provisioning module"
  precedence   = 30
}

# ---------------------------------------------------------------------------
# Cognito User Groups: the two roles the app and the Lambdas read (BE-16)
# hr_staff sends a sign-in to HR home; employee is every new hire.
# Same in pepla-dev and prod. Prod's groups were made by scripts/create-cognito.sh
# and are adopted as they are (see cognito-group-imports.tf).
# ---------------------------------------------------------------------------

resource "aws_cognito_user_group" "hr_staff" {
  name         = "hr_staff"
  user_pool_id = aws_cognito_user_pool.naleko_dev.id
  description  = "HR managers and administrators - full access"
}

resource "aws_cognito_user_group" "employee" {
  name         = "employee"
  user_pool_id = aws_cognito_user_pool.naleko_dev.id
  description  = "Onboarding employees - own data access only"
}

# TEN-05: the roles and permission ticks. Internal names, never shown to a person.
resource "aws_cognito_user_group" "role_admin" {
  name         = "admin"
  user_pool_id = aws_cognito_user_pool.naleko_dev.id
  description  = "Role: Admin"
}

resource "aws_cognito_user_group" "role_manager" {
  name         = "manager"
  user_pool_id = aws_cognito_user_pool.naleko_dev.id
  description  = "Role: Manager"
}

resource "aws_cognito_user_group" "role_guest" {
  name         = "guest"
  user_pool_id = aws_cognito_user_pool.naleko_dev.id
  description  = "Role: Guest"
}

resource "aws_cognito_user_group" "perm_recruitment" {
  name         = "perm-recruitment"
  user_pool_id = aws_cognito_user_pool.naleko_dev.id
  description  = "Permission: Recruitment"
}

resource "aws_cognito_user_group" "perm_it" {
  name         = "perm-it"
  user_pool_id = aws_cognito_user_pool.naleko_dev.id
  description  = "Permission: IT"
}

resource "aws_cognito_user_group" "perm_approve_offers" {
  name         = "perm-approve-offers"
  user_pool_id = aws_cognito_user_pool.naleko_dev.id
  description  = "Permission: Approve offers"
}

# AI cost guardrail, pepla-dev only: every test login is in this group, and the
# AI Lambdas never call Bedrock or Textract for its members
# (lambda/shared/ai-guard.mjs). Terraform owns it so it cannot vanish by accident.
resource "aws_cognito_user_group" "e2e_robots" {
  count = var.environment == "prod" ? 0 : 1

  name         = "e2e-robots"
  user_pool_id = aws_cognito_user_pool.naleko_dev.id
  description  = "Test logins for end-to-end runs: AI services are never called for them"
}

# ── Web app client ───────────────────────────────────────────────────────────
# Other accounts (pepla-dev) get a managed client here. Prod's client
# (1pk5rd58glsohfplnlr63tg0qb) was created by hand; web_prod below describes it
# and cognito-client-imports.tf imports it. People can write only given_name and
# family_name: never email or custom attributes (BE-17.1).
resource "aws_cognito_user_pool_client" "web" {
  count = var.environment == "prod" ? 0 : 1

  name            = "pepla-web-${var.environment}"
  user_pool_id    = aws_cognito_user_pool.naleko_dev.id
  generate_secret = false

  # USER_PASSWORD_AUTH lets end-to-end tests sign in test users without a browser.
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
  # Cognito refuses a list without "email" (it is a required attribute: "Invalid write attributes").
  # A new email only replaces the old one after its code is entered (user_attribute_update_settings),
  # and the owner rule needs email_verified, so a pending address never grants access.
  prevent_user_existence_errors = "ENABLED"
  write_attributes              = ["email", "given_name", "family_name"]
}

# The prod plan must show this client imported and updated in place, with only
# write_attributes (and possibly prevent_user_existence_errors) changing. Any other
# change, or a replace, means these settings do not match the real client: fix them
# here before the release.
resource "aws_cognito_user_pool_client" "web_prod" {
  count = var.environment == "prod" ? 1 : 0

  name         = "pepla-web"
  user_pool_id = aws_cognito_user_pool.naleko_dev.id
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]
  # Cognito refuses a list without "email" (it is a required attribute: "Invalid write attributes").
  # A new email only replaces the old one after its code is entered (user_attribute_update_settings),
  # and the owner rule needs email_verified, so a pending address never grants access.
  prevent_user_existence_errors = "ENABLED"
  write_attributes              = ["email", "given_name", "family_name"]

  # Replacing this client would delete the id both web apps have built in and sign
  # everyone out. Never let a plan do that.
  lifecycle {
    prevent_destroy = true
  }
}

locals {
  naleko_web_client_id = var.environment == "prod" ? aws_cognito_user_pool_client.web_prod[0].id : aws_cognito_user_pool_client.web[0].id
}
