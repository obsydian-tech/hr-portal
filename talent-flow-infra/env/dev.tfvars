# pepla-dev (424556617428). Usage: terraform plan -var-file=env/dev.tfvars
aws_account_id         = "424556617428"
environment            = "dev"
manage_github_ci_roles = false # comes from bootstrap/dev

# Filled in after infra/ step 1 in pepla-dev (see bootstrap/dev/README.md).
naleko_pool_id                 = "TODO_AFTER_INFRA_STEP_1"
naleko_client_id               = "TODO_AFTER_INFRA_STEP_1"
naleko_agent_api_id            = "TODO_AFTER_INFRA_STEP_1"
naleko_agent_jwt_authorizer_id = "TODO_AFTER_INFRA_STEP_1"
