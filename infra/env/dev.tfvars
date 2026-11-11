# pepla-dev (424556617428). Usage: terraform plan -var-file=env/dev.tfvars
aws_account_id         = "424556617428"
environment            = "dev"
enable_prod_monitoring = false # Config, dashboards, alarms: prod only

# Filled in after talent-flow-infra/ is applied in pepla-dev.
talent_flow_api_id                = "TODO_AFTER_TALENT_FLOW_APPLY"
talent_flow_cognito_authorizer_id = "TODO_AFTER_TALENT_FLOW_APPLY"
talent_flow_kms_key_id            = "TODO_AFTER_TALENT_FLOW_APPLY"
