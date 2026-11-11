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
