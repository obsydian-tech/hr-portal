# prod bootstrap (CI roles)

This root owns the GitHub OIDC provider and the CI roles in prod
(937137806477): `naleko-github-plan-readonly`, `pepla-github-deploy-code-prod`
and `pepla-github-tf-apply-prod`. Nothing applies it automatically. PRs plan it
read-only and the nightly drift check plans it too; a change is applied by
hand, by Iggie.

## The one run that sets up OPS-05 (about 5 minutes)

Run after the OPS-05 PR is merged into develop. Paste into Terminal (or AWS
CloudShell, once it is checked that Terraform runs there). Stop at either
"Expect" line if the plan shows anything else, and send a screenshot.

```sh
# 0. Fresh copy of develop (git inside ~/hr-portal hangs, so use /tmp)
export AWS_PROFILE=Ignecious-udemy
rm -rf /tmp/ops05 && git clone --depth 1 --branch develop https://github.com/obsydian-tech/hr-portal.git /tmp/ops05

# 1. Prod: CI roles move into bootstrap/prod, new prod apply role
cd /tmp/ops05/bootstrap/prod
terraform init -input=false
terraform plan -input=false -out=ops05-prod.tfplan
# Expect: 6 to import, 9 to add, 4 to change, 0 to destroy.
terraform apply -input=false ops05-prod.tfplan

# 2. pepla-dev: new dev apply role
cd /tmp/ops05/bootstrap/dev
terraform init -input=false
read -r -p "Budget alert email (the one used on 11 Nov): " TF_VAR_budget_alert_email; export TF_VAR_budget_alert_email
terraform plan -input=false -out=ops05-dev.tfplan
# Expect: 9 to add, 1 to change, 0 to destroy.
terraform apply -input=false ops05-dev.tfplan

# 3. Tidy up. The old drift-role plan is replaced by step 1: delete it, do not apply it.
rm -f ~/hr-portal/talent-flow-infra/drift-role.tfplan
cd ~ && rm -rf /tmp/ops05
unset TF_VAR_budget_alert_email AWS_PROFILE
```

9 to add is 1 role, 4 policy parts and 4 attachments. Prod's 4 changes are
updates to imported pieces, as the read-only plan on the OPS-05 PR showed: the
plan role's trust (adds `prod-plan` and `drift-check`) and its policy (reads
this root's state), plus the OIDC provider and the code deploy role, which pick
up the root's default tags. Dev's 1 change is the deploy-dev guardrail, which
now also protects the dev apply role.
