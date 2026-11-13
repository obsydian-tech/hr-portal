# ---------------------------------------------------------------------------
# Cognito User Pool — NH-11 Terraform import
# ---------------------------------------------------------------------------

resource "aws_cognito_user_pool" "naleko_dev" {
  name                     = "naleko-dev-user-pool"
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
# Prod's app client (1pk5rd58glsohfplnlr63tg0qb) was created by hand and is not
# in Terraform yet. Other accounts (pepla-dev) get a managed one here.
# Follow-up: import the prod client and drop the count.
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
  prevent_user_existence_errors = "ENABLED"
}

locals {
  naleko_web_client_id = var.environment == "prod" ? "1pk5rd58glsohfplnlr63tg0qb" : aws_cognito_user_pool_client.web[0].id
}
