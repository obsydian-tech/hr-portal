# REC-02

Card: REC-02 (NH-236) A person decides: no automatic Not hired, and a Not hired action with a reason (epic NH-234, red)

Test files: `rec-02.spec.ts` and `support/rec-02/` (`lambda-harness.ts`, `world.ts`, `callers.ts`, `iam.ts`, `standard.ts`, `pack-run.mjs`,
`decide.ts`, `fake-aws/`, `iam-9f2d571/policies.json`).

Spec: `onboarding-cards/specs/REC-02.md`, read with REC-00. Review page: `onboarding-cards/specs/REC-02-tests-for-review.md`.

Locks: rec-02 (the first tests)

## How the tests run

Control and AC-1 to AC-11 run once (`desktop-1280`) in the no-backend run. Each call runs the real handler (or the real shared file, or the
real pack script) in a fresh Node process against a fake AWS (`support/rec-02/fake-aws`, REC-12's copy with code added only: a number that
is NaN or Infinity is refused, as the real SDK refuses it). Companies A and B both hold the Standard pack. AC-10 and AC-11 also read code
and Terraform as text; `iam-9f2d571/policies.json` is the grants of every other role on develop 9f2d571, so AC-11 can tell that no other
role gained a write. AC-12 runs on pepla-dev only (`@pepla-dev`). Nothing calls AWS or any AI.

## Decisions the tests make where the card is silent (for the BA to confirm)

- D-T-1 The five routes are served by one Lambda, `lambda/recordNotHired`, routed by the route key; its core is `recordNotHired` in
  `lambda/shared/recruitment-actions/record-not-hired.mjs`.
- D-T-2 The stage stays in `currentStage` on the candidate's row; Not hired writes `NOT_HIRED` there.
- D-T-3 Until REC-03 moves the rows, a stored old stage name counts as the open stage REC-03's table maps it to; `stage_before_not_hired`
  holds the new code, and reopen writes the new code back.
- D-T-4 `strong_no_count` is a number (one more per Strong No). `score_under_review_level` is true.
- D-T-5 The history row keeps today's shape (SK `STAGE#<time>`, fromStage, toStage, actor = person id, tenant_id).
- D-T-6 On a confirmed second decision both people are on the row: who recorded it and who confirmed it.
- D-T-7 The old-system list answers `candidates` (or a bare list) and follows `nextToken` until it is absent.
- D-T-8 A vote's stored weightedScore is a finite number or empty. Today the Standard pack's SCORING_WEIGHTS (`weights: null`) makes it
  NaN, which DynamoDB refuses; REC-07 rebuilds the maths, this card only needs votes to be recorded.
- D-T-9 The Idempotency-Key replays only to the person who sent it.
- D-T-10 A note or a reopen reason over 1000 characters is 400 (code not pinned); a missing reopen reason is 400 REASON_REQUIRED.
- D-T-11 On pepla-dev the decision is read back through GET /v1/candidates/{id}.
- D-T-12 The pepla-dev vote candidate is reset by the seed on every run.

## Builder notes

- Edit `api/openapi.yaml` (the five operations, `x-tenant: token`) and `scripts/tenancy/ten-04-rows.json` (a company B walk row for each of
  the five routes), or ten-04 AC-1, AC-4 and AC-7 fail.
- New: `lambda/recordNotHired/` (index.mjs, package.json) and `lambda/shared/recruitment-actions/record-not-hired.mjs`: role check, then
  `requireTenant`, then `requireModule('recruitment')`, before any AWS call. Uses REC-01's `canDecide` and REC-12's `getRecruitmentSettings`
  (REJECTION_RULES: decider, reasons, secondConfirmation by level).
- Edit `submitVote`, `submitVoteByToken` (no veto; a Strong No adds to `strong_no_count`; the weighted score is never NaN),
  `completeEvaluation` (no status write; sets `score_under_review_level` below `reviewBelowScore`). Their three roles get Query on the config
  table's `GSI1-active-configs` index (rec-12 AC-8 asks every settings reader for it). The STRONG_NO default that REC-12 removed
  comes back here as data (`reviewVoteLevel`), never as an outcome.
- Terraform (`talent-flow-infra/`): the new function, its role, five JWT routes (not-hired, confirm, cancel, reopen, old-system), the
  invoke permission, and `idempotency-key` in the API's CORS allowed headers. Grants (rule 8; no other Lambda gains a write): the state
  table (GetItem, UpdateItem, PutItem) and its GSI1 (Query), the idempotency table (GetItem, PutItem), the config table read, the tenants
  table read, the state key, PutEvents on the bus, and its own log group only.
- KMS: if the new role must read the tenants table, add the role first, and add it to `infra/kms.tf` `kms_pii dynamodb_read_role_arns`
  in a later merge (the pipeline applies `infra/` before `talent-flow-infra/`).
- `scripts/ci/seed-dev.py`: seed `CAND-SEEDREC020000000000001` (company A, MID, INTERVIEWING) with interview `iv-seed-rec02-0001`, the
  `E2E_EMP` login on its panel and no vote yet; reset it on every run.
- AC-12 logins: `E2E_TF` (Admin), `E2E_HR` (Recruiter), `E2E_MANAGER` (hiring manager of a seeded candidate), `E2E_EMP` (panel employee),
  `E2E_HR_B` (company B).
- Red card: an extra Opus security review before merge, then `red-approved`.
- A throwaway build that passes every no-backend test is at `/mnt/project-files/onboarding-cards/rec-02/REC-02-throwaway-build.patch`.
  It is not for merge.

## Child lock rec-02.1 (the moved assertions, found by running the older locked tests on the build)

Locks: rec-02.1 (this section and the test files below)

- `support/ten-04.2/grants.ts` (read by ten-03 AC-10, mod-01 AC-8, rec-01 AC-8, ten-02 AC-13): three more grants. submitVote, submitVoteByToken
  and completeEvaluation Query the config table's active-configs index (they now read REJECTION_RULES).
- `mod-01.spec.ts` AC-8 and `ten-03.spec.ts` AC-10: the new `record_not_hired` role is left out, as each earlier card's own role is; rec-02
  AC-11 judges it.
- `chat-02.spec.ts` AC-31: the TalentFlow API may add exactly one allowed header, `idempotency-key` (Not hired replays by key); every other
  API's list must still be as on develop.
- `chat-15.spec.ts` AC-12: Terraform addresses named `record_not_hired*` are left out of the "only the job's function is added" count.
- Not moved, and not REC-02's: on this machine ten-02 AC-12 fails because `lambda/shared` has no Jest installed, and the screen tests
  (onb-05, onb-06, onb-11 AC-8, onb-14 pages, onb-19) need the app running (they stop at "unsafe port" before any check). Neither reaches anything REC-02 changes.
