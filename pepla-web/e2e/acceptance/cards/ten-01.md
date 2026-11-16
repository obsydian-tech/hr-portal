# TEN-01

Card: TEN-01 Every request knows its company: the company list, the company in the sign-in, one shared check (NH-193, epic NH-192 Tenancy)

Test files: `ten-01.spec.ts` and `support/ten-01/`

Spec: [NH-193](https://obsydian.atlassian.net/browse/NH-193)

Locks: acceptance-lock/ten-01 (and acceptance-lock/ops-05.8 on the same commit)

Nothing here opens the app. AC-2 runs the real `lambda/tenantPreToken` handler, AC-3 and AC-4 import the real
`lambda/shared/tenant.mjs`, and AC-5 runs the real `lambda/agentAuthorizer`, each call in a fresh Node process,
against `support/ten-01/fake-aws`: a copy of BE-17's fake AWS (7f1442c) with code added only. The fake DynamoDB
knows the company list `naleko-people-dev-tenants` (pk + sk); Secrets Manager answers the agent key from the
test; every Powertools and console line is recorded, so the log checks see both. Any AI client fails, and
outbound HTTP is refused. These run once, in `desktop-1280`.

- AC-2 reads tenantPreToken's settings from Terraform: the setting whose value is the tenants table's name is
  pointed at the fake table, and `LEGACY_TENANT_ID` is set per case. The person's own attributes and the
  client metadata say company B in case (b), and must not count.
- AC-3 and AC-4 run with `LEGACY_TENANT_ID` set to company A, so a helper that falls back to the first company
  when the sign-in has none shows up. `tenantFilter` and `andFilter` are judged by applying what they return to
  rows with the fake's expression reader. Values may be plain or in AttributeValue form.
- AC-5: with `AGENT_TENANT_ID` missing or not a company id, the Lambda may stop at start (the BE-15 way) or
  refuse; either way it logs `Missing setting AGENT_TENANT_ID` and never authorizes.
- AC-6 compares `lambda/shared/tenant-retrofit.json` (a JSON list of folder names, or one list inside an object)
  with `support/ten-01/tenant-retrofit.locked.json`: the 24 Lambdas on develop at 71fe5b8 whose own source names
  an onboarding table or its setting (the spec's 22, with `lookupEmployeeEmail`, which reads `employees` by name,
  in place of `nalekoAiChat`, which reaches the tables only through the Agent API, plus ONB-18's `getInvite` and
  `resendInvite`). Names may be removed, never added. It also runs
  lambda/shared's own `npm test` (after `npm ci`, as the "Lambda unit tests" job does) on a copy of `lambda/`
  with a planted folder: it must fail for a folder that names `EMPLOYEES_TABLE` or `"employees"` without the
  helper, and pass once the folder imports `../shared/tenant.mjs`. Today `npm test` there is `jest --coverage`,
  which does not pick up `*.test.mjs` files, so the build must make it run `tenant.test.mjs`.
- AC-1 and AC-7 read Terraform as text against `support/ten-01/cognito.71fe5b8.tf.txt` and
  `support/ten-01/iam.agent-authorizer.71fe5b8.tf.txt` (develop at 71fe5b8, after ONB-24, BE-17.1 and #355). Prod plans run with no var file,
  so prod's first company is the variable's default (or `env/prod.tfvars` if one is added; both must agree).
  The pool may change only in `lambda_config`; both web clients (`web` and BE-17.1's `web_prod`) stay exactly
  as they are, and neither may let anyone write a `custom:` attribute. The trigger goes in as a `pre_token_generation_config` block,
  which also keeps ONB-24's AC-13 ("lambda_config has nothing else" counts attributes, not blocks) green.
- AC-8 runs on pepla-dev only (@pepla-dev). It signs the HR and employee test logins in straight at Cognito
  (USER_PASSWORD_AUTH), so no browser session is kept between the two sign-ins.

Expected red before the build: all eight (AC-8 only on pepla-dev, after merge).

A later card that changes the pool outside those blocks, the dev web client's other settings, or
agentAuthorizer's role re-locks these tests. The new tenants table raises OPS-05 AC-7's locked table count
from 27 to 28; this commit carries that re-lock (ops-05.8, see `cards/ops-05.md`). The pool's existing triggers
(ONB-24's post_confirmation, kms_key_id and custom_email_sender) must stay exactly as they are.
