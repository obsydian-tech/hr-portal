# REC-15 step D: interviews with names, and history names (tests)

Jira: NH-279 (red). Spec: /mnt/project-files/onboarding-cards/specs/REC-15.md, Part 4 (rules 24 to 28), AC-14, AC-15, the rest of AC-16
and step D's lines of AC-17, prod notes 5 and 6, decision D-REC-15.10, with the spec check's fixes
(onboarding-cards/specs/REC-15D-spec-check.md: D-1 to D-14, round 2 R2-1 to R2-5) and step C's build review note N-2.
Review page: onboarding-cards/specs/REC-15D-tests-for-review.md. Tests: pepla-web/e2e/acceptance/rec-15d.spec.ts, support/rec-15d/.

## Locks

- `acceptance-lock/rec-15d`: rec-15d.spec.ts, support/rec-15d (world.ts, the fault preload faults.mjs, the IAM baseline of develop
  a1e82c1), support/rec-15d.1/grants.ts (rec-15d.spec.ts AC-17 reads it, so it lives in the main lock) and this file.
- `acceptance-lock/rec-15d.1` (child lock, on top): older locked tests make room for step D's four grant lines.
  - They import support/rec-15d.1/grants.ts (from the main lock): `isRec15dGrant` and `REC15D_GRANTS`, exactly two lines on each of two existing role policies:
    `talent-flow-infra/schedule_interview` and `infra/get_candidate_events` each get `cognito-idp:AdminGetUser` on the Naleko pool and
    `dynamodb:Query` on the tenants table (no index, no `*`).
  - The exact-grant checks allow those lines and nothing broader: mod-01 AC-8, rec-01 AC-8, rec-02 AC-11 (its write list counts
    `cognito-idp:Admin*`, R2-2), rec-04 AC-8, rec-07 AC-9, rec-15 AC-17, rec-15b AC-17, rec-15c AC-17, ten-03 AC-10, and ten-02 AC-13 (a tenth suite the spec did not list: its
    "only TEN-02's grants added" check refuses AdminGetUser on get_candidate_events).
  - No older test asserted the old interviews or history answer shape in a way step D breaks (checked by running every older suite on the
    throwaway; see the review page).
- The builder merges both lock branches, never copies them.
- Both locks sit on `acceptance-lock/rec-15c.2` (lock check F-2), because rec-15c.2 also changes rec-15c.spec.ts. Start the step D build
  only after PR 523 (step C's rec-15c.2 fix) has merged; the throwaway patch then needs `git apply -3` for lambda/getCandidate/index.js.

## Decisions the tests pin where the spec is silent (D-T-D1 to D-T-D8, for the BA to confirm)

Full list in the header of rec-15d.spec.ts. The ones a builder is most likely to trip on:
- D-T-D1 a PERSON entry is exactly { kind, person_id, name, feedback, due_at }; a GUEST entry exactly { kind, name, feedback, due_at };
  due_at is null when GIVEN. person_id is the stored panel member id as stored, even when it is not a sign-in id (an email): its name is
  then null (R2-1).
- D-T-D2 each interview is the kept old fields the row stores plus id, type, at, status, panel and votes. Nothing else (no PK, SK,
  tenant_id, PANEL_FEEDBACK_PENDING_COUNT, stray stored key).
- D-T-D3 `required` equals step C's record numbers for the same caller on the same candidate, else null; a panel member gets null.
- D-T-D4 the pool is asked at most once per person per read and at most 50 times per read, only for ids in sign-in form; Member rows
  are read only for ids in sign-in form.
- D-T-D5 error answers as today: 404 { error: 'Not found' }; interviews 500 { error }; history 400 and 500 { message }.
- D-T-D6 every history event carries at, kind and by_name (by_name may be null).
- D-T-D7 neither read writes, for any caller, and every AWS call is one the Lambda's role holds after step D.
- D-T-D8 the cognito SDK is in both Lambdas' package.json and package-lock.json.

## Notes for the builder

- The throwaway build that passes every test: /mnt/project-files/onboarding-cards/rec-15d/throwaway-build-D.NOT-FOR-MERGE.patch. A guide
  only.
- people-names.mjs order matters: sign-in-form check, then the company check (companyOfSignIn, which reads Member rows), then
  AdminGetUser, then the returned sub must equal the id. The tests record the order of calls.
- Use `settingsForRead(tenantId, candidate).settings` in the interviews read (D-5, R2-5): `getRecruitmentSettings` writes the settings
  lock of an older candidate and fails "the read never writes".
- A panel member's interview is cut to their own (D-4): panelMemberIds becomes [me]; no adhocPanelMembers, votesSubmitted,
  PANEL_SPLIT_FLAG, PANEL_CONSENSUS; only their own PERSON entry; no guest entries. The test searches the whole answer.
- Only the two Lambdas get COGNITO_POOL_ID and LEGACY_TENANT_ID (scheduleInterview: `local.tf_naleko_pool_id` and
  `var.roles_legacy_tenant_id`; getCandidateEvents: `aws_cognito_user_pool.naleko_dev.id` and `var.legacy_tenant_id`, R2-3). Not the
  audit-stream Lambda in the same file.
- OpenAPI 3.0: `nullable` needs a `type` beside it (the validator refuses to compile `nullable` alone). For vote fields of any type, leave
  the schema empty (`{}`).
- Run `npm run api:types` in pepla-web after the openapi change.
- Add `@aws-sdk/client-cognito-identity-provider` to both Lambdas' package.json and update their package-lock.json (Lambda folders with no
  lock ship no node_modules).
- getCandidate: both 200 answers go through `RA.withoutKeys(out, /offer|salary/i)` (N-2).
- No KMS line changes: the tenants table is read for Member rows only, as the pickers do (AC-17 checks it).

## Dev check (standing line 11)

rec-15d's `@pepla-dev` test uses the REC-07 dev seed: the HR login opens the seeded candidate's interviews and must see a person's name
(proves the pool grant, the Member read and the two settings on the real Lambda), and the history in the new shape; company B gets 404.
The REC-07 seed's panel is the employee login and the IT login (scripts/ci/seed-dev.py `seed_rec07`); seed-dev.py gives the IT login
given_name and family_name, so at least one panel person must show a name. Both need a Member row of the seeded company on dev, as they
already do for the panel picker.

**Seed one named history row (lock check F-1).** The history half of the dev test needs at least one event with a name. The REC-07 dev
candidate has none today. The builder adds to `seed_rec07` in scripts/ci/seed-dev.py one stage row on the REC-07 candidate
(`PK CANDIDATE#<candidate>`, `SK STAGE#<time>#...`, the shape REC-03's moves write) whose `by` is the sub of a seeded company A login
that has a Member row (the HR login or a panel login, e.g. the IT login's sub the seed already looks up), written idempotently like the
seed's other rows (clear the candidate's old `STAGE#` rows first, as the REC-03 seed does). The test then needs at least one event with
a non-null `by_name`; a missing AdminGetUser or tenants Query grant, or a missing COGNITO_POOL_ID or LEGACY_TENANT_ID on
getCandidateEvents, fails it on dev instead of giving null names silently.

**Where it runs.** Like step C's dev test, company B on pepla-dev has Recruitment off in the main run, so this test runs in the
"Company walk (TEN-04)" step of `.github/workflows/app-e2e-dev.yml`. The builder adds `REC-15 step D .* AC-17 on pepla-dev` to that step's
`--grep` and to the main run's `--grep-invert` (the workflow is not a locked file). Without it the dev run goes red on every merge after
this one (rule 8).

## Prod notes (spec prod notes 5 and 6)

- 5: prod's pool and tenants table need the same two grants and settings through the prod release; PROD-CATCH-UP-LIST.
- 6: people moved by TEN-06 act under their old user_id (not a sub): their name is null and their vote does not mark their entry GIVEN.
  Not fixed here.
