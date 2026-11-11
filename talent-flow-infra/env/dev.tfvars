# pepla-dev (424556617428). Usage: terraform plan -var-file=env/dev.tfvars
aws_account_id         = "424556617428"
environment            = "dev"
manage_github_ci_roles = false # comes from bootstrap/dev

# IDs from infra/ in pepla-dev (first applied 2026-11-11).
naleko_pool_id                 = "af-south-1_gUjFTe9bn"
naleko_client_id               = "5mki8rhp1cujgk53ro4r219bnr"
naleko_agent_api_id            = "k0832ravif"
naleko_agent_jwt_authorizer_id = "4aeqy7"
