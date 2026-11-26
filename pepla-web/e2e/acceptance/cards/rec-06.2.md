# REC-06.2

Card: REC-06.2 (NH-285) Start the onboarding workflow for recruitment hires (red: one AWS permission and an automated step for real hires)
Spec: `/mnt/project-files/onboarding-cards/specs/REC-06.2.md` (rules 1 to 16, AC-1 to AC-11; spec check round 2 passed 26 Nov 2026).
Tests: `rec-06.2.spec.ts`, `support/rec-06.2/`. Child lock `rec-06.2.1` (separate branch, one commit) lets the older IAM checks accept the one new statement.

## Choices the tests pin that the spec left to the builder

- **One start, one place.** `lambda/resendInvite/index.mjs` sends one `StartExecution` per good invite, only when the typed row has a
  `from_recruitment` MAP (`item.from_recruitment?.M`; the plain `employee` object turns a map into null), after `issueInvite` and after the
  email attempt (sent, failed or skipped), before the answer. Name `onboarding-<employee_id>`, input exactly `{"employeeId": <id>}`, ARN from
  `SFN_STATE_MACHINE_ARN`. Nothing else is in the call.
- **A time limit is required.** The send carries an `abortSignal` (3 seconds). The tests check that the option is present and that a call
  which never answers ends between 2.8 and 9 seconds, with the same answer as today. The Step Functions fake in the tests only ends a
  hanging call when it is given that signal. Note for the builder: Node does not keep a process alive for an abort timer alone; a real Lambda
  does, the test runner holds the process open for it.
- **Errors never reach the answer.** `ExecutionAlreadyExists` logs one info line ("already started" in the words, free); every other error
  logs ONE warn line with the employee id and the error name only. Retries: none.
- **Empty or missing `SFN_STATE_MACHINE_ARN`**: no Step Functions call, answer as today, ONE info line. The wording is free as long as it
  matches `/workflow|SFN_STATE_MACHINE_ARN/i` (and carries no ARN, no address, no company). Before the merge this line does not exist, so
  AC-4 (d), and the info and warn parts of AC-4 (b) and (c), are red today by design.
- **Log fields.** Only `employeeId` and `error` (an error name). No address, name, phone, link, token, company id, input or ARN, in any outcome.
- **Terraform.** Only `infra/iam_per_lambda.tf` and `infra/lambdas.tf` change: the resend_invite policy gets exactly one more statement
  (`states:StartExecution` on `aws_sfn_state_machine.onboarding.arn`, no condition, no wildcard) and the Lambda's settings get
  `SFN_STATE_MACHINE_ARN`; timeout stays 15. `infra/kms.tf`, `stepfunctions.tf`, `apigateway.tf` and the workflow definition stay as they are.
- **Package.** `lambda/resendInvite/package.json` lists `@aws-sdk/client-sfn` under `devDependencies` only (the Lambda runtime ships the SDK)
  and `package-lock.json` agrees (`npm ci` must work). Only those three files change in that folder.
- **Dev seed.** `scripts/ci/seed-dev.py` gets `seed_rec06_2(ddb, tenant_id)`, called from `main()` like the other seeds. It reads
  `support/rec-06.2/dev-ids.json`, builds the employee id from the company, `GITHUB_RUN_ID` and `GITHUB_RUN_ATTEMPT` (a closed run keeps its
  name 90 days, so a reused id would make the dev test fail with ExecutionAlreadyExists), finds the earlier runs' rows of the address with a
  Query on `email-index` (no Scan), deletes only this company's with `ConditionExpression tenant_id = :t`, and puts one INVITED row in
  Operations with a `from_recruitment` map, no `user_sub`. The seeded address is `e2e.run-rec062-hire@blackhole.postmarkapp.com`: the
  `e2e.run-` start is what the dev clean-up removes by.
- **Dev test (after merge).** AC-11 `@pepla-dev` has not been run anywhere (nobody has run the chain on dev yet); it runs with
  `ACCEPTANCE_TARGET=pepla-dev` after the apply. It sends the invite as HR, uploads the two documents with HR's own token, waits for
  `risk_assessed_at`, and expects the stand-in "AI skipped" label (no model call). The person cannot upload their own documents yet
  (no `user_sub`, REC-06.3).
- **Older checks.** Child lock `rec-06.2.1` (`support/rec-06.2.1/grants.ts`, 13 suites) leaves out exactly the line
  `Allow states:StartExecution aws_sfn_state_machine.onboarding.arn null` on `infra/resend_invite`. int-01f AC-8 also lets REC-16's role
  through (rec-16.1 did not reach it).
