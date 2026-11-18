# pepla-dev (424556617428). Usage: terraform plan -var-file=env/dev.tfvars
aws_account_id         = "424556617428"
environment            = "dev"
enable_prod_monitoring = false # Config, dashboards, alarms: prod only

# IDs from talent-flow-infra/ in pepla-dev (first applied 2026-11-11).
talent_flow_api_id                = "qoftdyvp76"
talent_flow_cognito_authorizer_id = "lda7mq"
talent_flow_kms_key_id            = "68d7f1a9-2f46-452b-bda4-c0e319b48e15" # alias/talent-flow/state

# BE-15: pepla-web has no address on AWS yet (OPS-01 parked), so dev emails
# link to the local app instead of the live prod site.
login_url = "http://localhost:4300/sign-in"

# ONB-04: invite links point at the local app; the email names the help-picture company.
company_name = "Sunbird Bakery"
app_url      = "http://localhost:4300"

# TEN-01: the first company in pepla-dev.
founding_tenant_id = "ten_hyyt49drh9efwb79h2a0cjee0s"

# TEN-02 step 1: rows written before TEN-02 belong to the dev first company until the backfill stamps them.
# Step 2 (a later PR) sets this to "" once the dev backfill check passes.
legacy_tenant_id = "ten_hyyt49drh9efwb79h2a0cjee0s"

# TEN-06: the TalentFlow pool people move from, and its server-only migration client (output cognito_migration_client_id of
# talent-flow-infra). Empty until that stack is applied on pepla-dev: userMigration then refuses every call, so nobody is
# moved and nobody is locked out. A person with AWS access fills both in after the apply.
talent_flow_user_pool_id     = ""
talent_flow_server_client_id = ""
