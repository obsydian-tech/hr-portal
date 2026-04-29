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
}
