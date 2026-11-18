# MOD-01

Card: MOD-01 A company has modules switched on, and the server refuses a module that is off (epic Modules)

Test files: `mod-01.spec.ts` and `support/mod-01/` (`lambda-harness.ts`, `world.ts`, `routes.ts`, `iam.ts`, `seed-run.py`,
`iam-6122df1/policies.json`, `fake-aws/`), plus the moved tests of other cards listed at the end (re-locked here)

Spec: `onboarding-cards/specs/MOD-01.md` (17 Nov 2026). Review page: `onboarding-cards/specs/MOD-01-tests-for-review.md`.

Locks: acceptance-lock/mod-01 (AC-1 to AC-10, and in the same commit the moved tests of other cards: `be-17.spec.ts` AC-1 and
AC-2, `be-18.spec.ts` AC-3 and AC-4, `be-19.spec.ts` AC-1 (through `support/be-17|be-18|be-19/lambda-harness.ts` and
`fake-aws/world.mjs`), `ten-02.spec.ts` AC-13, `ten-03.spec.ts` AC-10 and, through `support/ten-03/world.ts`, ten-03 Control, AC-1,
AC-3 (both), AC-4, AC-5, AC-6 and ten-05 Control, AC-3 (both), and `ten-05.spec.ts` AC-6. These files are re-locked by
acceptance-lock/mod-01 itself.)

Written against develop 6122df1 (TEN-03, TEN-05 and MOD-02 in). The IAM baseline `iam-6122df1/policies.json` is taken from
that commit (107 role policies; TEN-05 changed none, so it holds the same policies as 91fef10).

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
  routes of talentFlowApproveAction (read, pending list, approve and reject): 30 routes, 23 Lambda folders. AC-8 checks every
  route's Lambda is on the gated list. Notifications, panel members and hiring managers are on it
  (they are TalentFlow routes in TEN-03's table).
- D-3 The TalentFlow chat itself (`talentFlowAiChat`) is "Ask Batsi itself" and stays open; its Recruitment tools are refused
  inside `resolveToolCall` (no AWS call but the modules read, no Recruitment data, no pending action).
- D-4 The helper reads the table named by the `TENANTS_TABLE` setting; every gated Lambda gets it (infra:
  `aws_dynamodb_table.tenants.name`; talent-flow-infra: `local.tf_tenants_table`). `modules` is a DynamoDB string set.
- D-5 The script writes `naleko-people-<env>-tenants`; its command line is rule 6's and nothing more. `by` is the STS `Arn`.
- D-6 Order is TEN-05's: CORS, role, company, module. It is judged where it can be seen: no company on the sign-in gives 403
  with no AWS call; on routes whose wrong-role answer makes no AWS call, a wrong-role caller of A or B gets exactly that answer
  and no modules read. Those routes are pinned: `POST /v1/config` and `PUT /v1/config` (TEN-05's admin check) and the HR
  pending, approve and reject routes. A person of B in TEN-05's eight groups only (no old name) is refused too, with no AWS call
  but at most B's modules read.
- D-7 "Answers exactly as an expired link" is measured: the same handler run with the link's `ttl` in the past.
- D-8 Event handlers: the three the card names (rule evaluation, notification sender, orchestration). The event paths of
  scheduleInterview, submitVote and createOffer are not judged.
- D-9 The 60 second cache counts from the read: 59 s later no GetItem, 61 s later one. Each company has its own entry.
- D-10 `--off` on the founding company with no attribute writes what is left on (`{onboarding}`), and its audit row's `from` is
  both. `--check` exits 1 while the company does not have the asked change, 0 once it has.
- D-11 seed-dev.py sets the founding company to both and company B to `{onboarding}` on every run (so AC-10's put-back cannot
  leave B with Recruitment), and only on rows that exist.
- D-12 A talent-flow-infra role's KMS entry is its ARN with its path (`role/talent-flow/talent-flow-role-<fn>`). AC-8 is add only
  against the 107 role policies of develop 6122df1 (`iam-6122df1/policies.json`).
- D-13 A gated role is only in `dynamodb_read_role_arns` (decrypt through DynamoDB). AC-8 fails if any gated role is in
  `allowed_role_arns` (encrypt and data-key rights), in any spelling (resource reference, ARN with or without its path).
- D-14 The company is never read from a body, whatever it is called. AC-3 and AC-5 name company C in the body as `tenant_id`,
  `tenantId`, `company`, `companyId`, `company_id`, `tenant` and `companyTenantId`. AC-4 does the same on the public vote link
  (B's link naming C still answers as expired and never reads C; C's and A's links naming B still record under their own
  company) and on the three event handlers (only `tenant_id` counts, as TEN-03 set).
- D-15 TEN-05's user admin body (`{ role, permissions }`) with `modules` in it writes no modules either (AC-7, next to today's
  `roles` body).

## Locked tests of other cards that move (changed here, re-locked by acceptance-lock/mod-01)

A correct build fails 18 locked tests that pass on develop 6122df1. Each changed line is in the review page's diff tables. Only
what the module check and rule 8 force is changed; every changed test still passes on develop 6122df1.

1. No Company row with Recruitment on, or no `TENANTS_TABLE`, in their fake world (the module check fails closed):
   - `support/ten-03/world.ts`: companies A and B get `modules = {onboarding, recruitment}` (a string set). This moves ten-03
     Control, AC-1, AC-3 (by id), AC-3 (lists), AC-4, AC-5, AC-6, and ten-05 Control and both AC-3 tests (TEN-05's world is
     TEN-03's).
   - `support/be-17|be-18|be-19/lambda-harness.ts`: a run of talentFlowApproveAction gets `TENANTS_TABLE` and the founding
     company's row (founding, so both on); their `fake-aws/world.mjs` knows the tenants table's key (pk, sk). This moves be-17
     AC-1 and AC-2, be-18 AC-3 and AC-4, be-19 AC-1.
2. `ten-02.spec.ts` AC-13: getCompanyModules, getCandidateEvents and getHiringManagers may also GetItem the tenants table (the
   table, never an index), and `dynamodb_read_role_arns` may hold the quoted ARNs of the 26 named TalentFlow Lambdas that read
   the modules.
3. `ten-03.spec.ts` AC-10: a new grant or new policy may be GetItem on the tenants table only; getCompanyModules' own policy may
   hold its log group and X-Ray.
4. `ten-05.spec.ts` AC-6: the pickers may make the module check's one GetItem of the caller's own Company row; any other read of
   the tenants table still fails (R5, the Member narrowing, is still owed).
