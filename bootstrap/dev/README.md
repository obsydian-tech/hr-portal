# pepla-dev bootstrap

pepla-dev (424556617428) is a member account in the obsydian AWS Organization.
It holds **no real data** and exists so CI can deploy and run end-to-end tests
before anything reaches prod.

## 1. Bootstrap (once, from the Mac, typed yes)

```sh
cd bootstrap/dev
AWS_PROFILE=Ignecious-udemy terraform init
AWS_PROFILE=Ignecious-udemy terraform apply -var="budget_alert_email=<ops email>"
```

Creates the dev state bucket, the GitHub OIDC provider, role
`pepla-github-deploy-dev` (only usable by jobs in the GitHub environment `dev`),
a monthly budget with alerts, and the Postmark **test** token.

## 2. First apply of the stacks (once)

The two stacks point at each other (TalentFlow uses the Naleko Cognito pool and
agent API; Naleko adds routes to the TalentFlow API), so the very first apply
in a new account goes in three steps. After that, normal plans/applies work.

1. `infra/`, only the pieces TalentFlow needs:
   ```sh
   terraform init -reconfigure -backend-config=env/dev.s3.tfbackend
   terraform apply -var-file=env/dev.tfvars \
     -target=aws_cognito_user_pool.naleko_dev \
     -target=aws_cognito_user_pool_client.web \
     -target=aws_apigatewayv2_api.agent_api \
     -target=aws_apigatewayv2_authorizer.agent_api_cognito_jwt
   ```
   Copy the IDs into `talent-flow-infra/env/dev.tfvars`.
2. `talent-flow-infra/`: full apply with `-var-file=env/dev.tfvars`.
   Copy the API, authorizer and KMS key IDs into `infra/env/dev.tfvars`.
3. `infra/`: full apply with `-var-file=env/dev.tfvars`.

Prod is unchanged: every new variable defaults to today's prod value.

Notes from the first run (2026-11-11, 6 + 306 + 384 resources created):
- `placeholder.zip` must contain a real file (e.g. `index.mjs` exporting a stub
  handler); Lambda rejects a zip with an empty file on create.
- Use short-lived credentials for `OrganizationAccountAccessRole` in 424556617428.
- All dev Lambdas start as the placeholder stub until code is deployed.

## 3. Look-only login for cloud threads (look-only.tf)

User `pepla-cloud-look-dev` can list and describe pepla-dev settings and read
logs. It cannot read table items, files, secrets, parameter values or function
code, cannot decrypt, and cannot change anything. Its own policy is also its
permissions boundary.

Apply only the three new resources, from the Mac, typed yes:

```sh
cd bootstrap/dev
AWS_PROFILE=Ignecious-udemy terraform init
AWS_PROFILE=Ignecious-udemy terraform plan -var="budget_alert_email=unused" \
  -target=aws_iam_policy.look_only \
  -target=aws_iam_user.look_only \
  -target=aws_iam_user_policy_attachment.look_only \
  -out=look-only.tfplan
# must say: Plan: 3 to add, 0 to change, 0 to destroy
AWS_PROFILE=Ignecious-udemy terraform apply look-only.tfplan
```

Then make the key yourself, in your own Terminal or the AWS console, never in a
Claude thread (the secret would land in the chat):

```sh
aws iam create-access-key --user-name pepla-cloud-look-dev --profile pepla-dev
```

Put the two values in the cloud environment's environment variables as
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, with
`AWS_DEFAULT_REGION=af-south-1`. Make a new key and delete the old one every
90 days.
