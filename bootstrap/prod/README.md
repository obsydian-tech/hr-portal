# prod bootstrap (CI roles)

This root owns the GitHub OIDC provider and the CI roles in prod
(937137806477): `naleko-github-plan-readonly`, `pepla-github-deploy-code-prod`
and `pepla-github-tf-apply-prod`. Nothing applies it automatically. PRs plan it
read-only and the nightly drift check plans it too; a change is applied by
hand, by Iggie.

## The one run that sets up OPS-05 (about 5 minutes)

Run after the OPS-05 PR is merged into develop. Paste each block into Terminal
on the Mac (zsh or bash both work: the blocks have no comment lines and no
`read -p`). Stop at any "Expect" line if the plan shows anything else, and send
a screenshot. Git inside ~/hr-portal hangs, so the blocks use a fresh copy in
/tmp.

Block 1, fresh copy of develop:

```sh
export AWS_PROFILE=Ignecious-udemy
rm -rf /tmp/ops05 && git clone --depth 1 --branch develop https://github.com/obsydian-tech/hr-portal.git /tmp/ops05
```

Block 2, prod: the CI roles move into bootstrap/prod and the prod apply role is
created.

```sh
cd /tmp/ops05/bootstrap/prod
terraform init -input=false
terraform plan -input=false -out=ops05-prod.tfplan
```

Expect on a first run: 6 to import, 9 to add, 4 to change, 0 to destroy.
Expect after the 13 Nov partial run (part 2 failed on a wildcard service in
an ARN, now fixed): 5 to add, 0 to change, 0 to destroy (policy part 2 and
the four attachments). Then:

```sh
terraform apply -input=false ops05-prod.tfplan
```

Block 3, pepla-dev: the dev apply role. It asks for the budget alert email
(the one used on 11 Nov).

```sh
cd /tmp/ops05/bootstrap/dev
terraform init -input=false
printf 'Budget alert email: '; read -r TF_VAR_budget_alert_email; export TF_VAR_budget_alert_email
terraform plan -input=false -out=ops05-dev.tfplan
```

Expect: 9 to add, 1 to change, 0 to destroy. Then:

```sh
terraform apply -input=false ops05-dev.tfplan
```

Block 4, tidy up. The old drift-role plan is replaced by block 2: delete it,
do not apply it.

```sh
rm -f ~/hr-portal/talent-flow-infra/drift-role.tfplan
cd ~ && rm -rf /tmp/ops05
unset TF_VAR_budget_alert_email AWS_PROFILE
```

9 to add is 1 role, 4 policy parts and 4 attachments. Prod's 4 changes are
updates to imported pieces, as the read-only plan on the OPS-05 PR showed: the
plan role's trust (adds `prod-plan` and `drift-check`) and its policy (reads
this root's state), plus in-place updates on the OIDC provider and the code deploy
role (the PR run summary names the changed attributes; check them before
applying). Dev's 1 change is the deploy-dev guardrail, which
now also protects the dev apply role.
