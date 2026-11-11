# pepla-dev (424556617428). Usage: terraform plan -var-file=env/dev.tfvars
aws_account_id         = "424556617428"
environment            = "dev"
enable_prod_monitoring = false # Config, dashboards, alarms: prod only

# IDs from talent-flow-infra/ in pepla-dev (first applied 2026-11-11).
talent_flow_api_id                = "qoftdyvp76"
talent_flow_cognito_authorizer_id = "lda7mq"
talent_flow_kms_key_id            = "68d7f1a9-2f46-452b-bda4-c0e319b48e15" # alias/talent-flow/state
