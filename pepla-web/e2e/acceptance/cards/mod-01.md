# MOD-01

Card: MOD-01 A company has modules switched on, and the server refuses a module that is off (epic Modules)

Test files: `mod-01.spec.ts` and `support/mod-01/` (`lambda-harness.ts`, `world.ts`, `routes.ts`, `iam.ts`, `seed-run.py`,
`iam-91fef10/policies.json`, `fake-aws/`)

Spec: `onboarding-cards/specs/MOD-01.md` (17 Nov 2026). Review page: `onboarding-cards/specs/MOD-01-tests-for-review.md`.

Locks: acceptance-lock/mod-01

These tests add files only; no other card's file changed. Written against develop 91fef10 (TEN-03 and MOD-02 in, TEN-05 not).

## How the tests run

AC-1 to AC-9 run once (`desktop-1280`) in the no-backend run. Nothing opens the app. The Lambda tests run each real handler,
and the real helper, in a fresh Node process against a fake AWS (`support/mod-01/fake-aws`, copied from TEN-03's with code
added only: STS, the credential helpers, an `aws` command that answers `sts get-caller-identity` only, a clock step, and the
prod tenants table). The script test runs `scripts/tenancy/set-modules.mjs` against the same fake. AC-7 and AC-8 read code
and Terraform as text; AC-8 also runs `scripts/ci/seed-dev.py` against a fake boto3 (`support/mod-01/seed-run.py`). AC-9 runs
`node --test modules.test.mjs` on a copy of `lambda/` and plants two faults in the copy. AC-10 runs on pepla-dev only
(`@pepla-dev`) and is skipped in the no-backend run. Bedrock and outbound HTTP are refused; nothing calls AWS or any AI.

Companies in the fake (`support/mod-01/world.ts`): A founding with no `modules` attribute, B `{onboarding}`, C `{recruitment}`,
D suspended `{recruitment}`, E not founding with no attribute, F `{recruitment, payroll}`, G founding with `{onboarding}`, X no row.

## Decisions the tests make where the card is silent (for the BA to confirm)

- D-1 `GET /v1/company/modules` is on the employees API (`aws_apigatewayv2_api.employees_api`, the "Naleko API" MOD-02 calls
  through `employeesApiUrl`) behind `employees_api_cognito`. Its CORS already allows GET and the `authorization` header from
  `local.api_allowed_origins`; AC-8 pins that so a later edit cannot drop it (LESSONS: CORS lines for new headers).
- D-2 The rule 4 list is `support/mod-01/routes.ts`: TEN-03's 38 routes less the IT task and bundle routes, plus the agent and HR
  routes of talentFlowApproveAction (29 routes, 23 Lambda folders). Notifications, panel members and hiring managers are on it
  (they are TalentFlow routes in TEN-03's table).
- D-3 The TalentFlow chat itself (`talentFlowAiChat`) is "Ask Batsi itself" and stays open; its Recruitment tools are refused
  inside `resolveToolCall` (no AWS call but the modules read, no Recruitment data, no pending action).
- D-4 The helper reads the table named by the `TENANTS_TABLE` setting; every gated Lambda gets it (infra:
  `aws_dynamodb_table.tenants.name`; talent-flow-infra: `local.tf_tenants_table`). `modules` is a DynamoDB string set.
- D-5 The script writes `naleko-people-<env>-tenants`; its command line is rule 6's and nothing more. `by` is the STS `Arn`.
- D-6 Order is judged where it can be seen: no company on the sign-in gives 403 with no AWS call; on routes whose wrong-role
  answer makes no AWS call today, a wrong-role caller of B gets exactly that answer and no modules read.
- D-7 "Answers exactly as an expired link" is measured: the same handler run with the link's `ttl` in the past.
- D-8 Event handlers: the three the card names (rule evaluation, notification sender, orchestration). The event paths of
  scheduleInterview, submitVote and createOffer are not judged.
- D-9 The 60 second cache counts from the read: 59 s later no GetItem, 61 s later one. Each company has its own entry.
- D-10 `--off` on the founding company with no attribute writes what is left on (`{onboarding}`), and its audit row's `from` is
  both. `--check` exits 1 while the company does not have the asked change, 0 once it has.
- D-11 seed-dev.py sets the founding company to both and company B to `{onboarding}` on every run (so AC-10's put-back cannot
  leave B with Recruitment), and only on rows that exist.
- D-12 A talent-flow-infra role's KMS entry is its ARN with its path (`role/talent-flow/talent-flow-role-<fn>`). AC-8 is add only
  against the 107 role policies of develop 91fef10 (`iam-91fef10/policies.json`).

## Locked tests of other cards that move

A correct build (the throwaway on the review page) fails 14 locked tests that pass on develop 91fef10. Each moves for one of
three reasons, all ones the card makes:

1. Their fake worlds have no Company row and no `TENANTS_TABLE` setting, so the module check refuses (fail closed). The world
   needs the caller's company row with Recruitment on (or founding) and the setting, nothing else:
   - be-17 AC-1 and AC-2 (`GET /agent/v1/actions/pending` as HR; AC-1 compares the CORS header with HR's answer)
   - be-18 AC-3 and AC-4 (pending list and approval as HR)
   - be-19 AC-1 (approve as HR)
   - ten-03 Control, AC-1, AC-3 (record by id), AC-3 (lists), AC-4, AC-5 and AC-6 (every Recruitment route, event and agent route)
2. ten-02 AC-13 pins "on the tenants table only `dynamodb:Query`" for every role; rule 8 adds `dynamodb:GetItem` there for
   getCompanyModules, getCandidateEvents and getHiringManagers.
3. ten-03 AC-10 pins the roles exactly ("new role policy belongs to the pre-token trigger"); rule 8 adds one GetItem policy
   per gated role and the getCompanyModules role.

They need their own lock names at the same commit as the build (ONB-23 precedent). No acceptance-lock branch holds a spec that
develop lacks except site-08 (no Lambda), so nothing else is known to move.
