# TEN-02

Card: TEN-02 Onboarding records carry their company, and every onboarding route checks it (NH-194, epic NH-192 Tenancy)

Test files: `ten-02.spec.ts` and `support/ten-02/`

Spec: [NH-194](https://obsydian.atlassian.net/browse/NH-194)

Locks: acceptance-lock/ten-02 (step 1, AC-1 to AC-10 and AC-12 to AC-16) and acceptance-lock/ten-02.1 (step 2, AC-11)

Nothing here opens the app. The Lambda tests run the real handlers, each call in a fresh Node process (a cold
Lambda), against `support/ten-02/fake-aws`: a copy of TEN-01's fake AWS with code added only. It adds the invite,
consent, audit, idempotency and TalentFlow user tables, the indexes the routes Query (`tenant-index` among them,
sparse: only rows that carry `tenant_id`), a Cognito pool with subs, `ListUsers` filters and paging, Postmark,
Step Functions and a Textract that fails every call. A Query on the tenant-index of a table that has none fails, as in AWS. Any AI client fails, and outbound HTTP is refused. The world is in `support/ten-02/world.ts`:
company A (also the legacy company while `LEGACY_TENANT_ID` = A), company B, HR of each, an employee of A, the
agent of A, and one legacy row of each kind with no `tenant_id`. These run once, in `desktop-1280`.

Pinned by the verifier (the spec left these open; the reasons are in `TEN-02-tests-for-review.md`):

- P1 Order: CORS `OPTIONS`, the group check, the company check, then the rest.
- P2 Another company's record answers exactly as a record that does not exist, for that caller: HR and the agent
  get 404 `{"error":"Not found"}`; a non-HR caller gets the route's existing refusal (403).
  The employee's own document list keeps its words for an unknown employee, `{"error":"Employee not found"}`
  (BE-19 AC-5, BE-20 AC-6), so it answers another company's employee with those.
- P3 Lists of a company that is not the legacy company Query `tenant-index`, never a Scan. While the legacy rule is
  on, the legacy company's lists may still read the old way with the company filter, but only through a helper in
  `lambda/shared` behind `readsLegacyRows`. No handler scans the six tables itself.
- P4 Idempotency keys are stored as `TENANT#<id>#<client key>`.
- P5 Index range keys: employees `employee_id` (on every row, so no row drops out of the index), documents `employee_id`,
  document-verification `employeeId`, tenants `pk`.
- P6 The owner is matched as token `sub` = row `user_sub`.
- P7 createEmployee's partner check uses the Member rows: a partner of another company is the existing
  unknown-partner 400.
- P8 Backfill: `node scripts/tenancy/backfill.mjs --env dev|prod --tenant <id> --pool <poolId> [--profile x] [--apply|--check]`.
- P9 The backfill also writes the founding company's row (`TENANT#<id>` / `PROFILE`: Founding client, ACTIVE, ZA,
  founding) when it is missing, with the same fields as the dev seed. Prod has no such row yet.
- P10 Step 2 keeps the legacy code path and turns the rule off by setting: every `LEGACY_TENANT_ID` comes from one
  variable, `var.legacy_tenant_id`, and `infra/env/dev.tfvars` sets it to `""`. The Scans behind the legacy rule
  and their role grants go when the rule is off everywhere (prod's step 2, a later card).
- P11 The backfill takes a row's owner (`user_sub`) only from a sign-in whose email is verified.

- AC-4 and AC-13 read code and Terraform as text, and AC-13 also runs the routes to see which tables they Query
  on `tenant-index` and checks each role may.
- AC-10 runs `scripts/tenancy/backfill.mjs` in a fresh process against the fake (`support/ten-02/fake-aws/script-run.mjs`),
  with DynamoDB Scans in pages of 3.
- AC-14 runs on pepla-dev only (@pepla-dev). The seed adds company B and its HR login; the run needs
  `E2E_HR_B_EMAIL` and `E2E_HR_B_PASSWORD`. Naledi's ids are in `support/ten-02/dev-ids.json` (from the seed).
- AC-15 runs on pepla-dev only, and only once the merger has recorded the dev `--check` result in
  `scripts/tenancy/dev-backfill-check.json` (`{ "exit": 0, "missing": { ... } }`, outside the locked folder); until then it is skipped with a note.

Expected red before the build: all except AC-2, which guards today's behaviour. AC-11 is red until step 2.

Step 2 changes the `LEGACY_TENANT_ID` line TEN-01 AC-2 pins for tenantPreToken (`var.founding_tenant_id`), so the
step 2 PR carries that re-lock.
