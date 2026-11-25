# REC-05

Card: REC-05 (NH-239) Offer approval that finishes, and a send that needs it (red)

Test files: `rec-05.spec.ts` and `support/rec-05/` (`world.ts`, `lambda-harness.ts`, `dev-ids.json`, `fake-aws/`). The fake AWS is a copy
of REC-14's with code added only (S3 HeadObject answers from the world, the URL signer records what an upload link is held to, DynamoDB
can refuse a caller's reads and can let another request win between a read and a write). The tests also reuse REC-02's company rows,
Standard pack run and Terraform reader, and REC-15's clock, all unchanged.

Spec: `onboarding-cards/specs/REC-05.md` (rules 1 to 17, AC-1 to AC-15, updated 25 Nov), read with REC-00. Review page:
`onboarding-cards/specs/REC-05-tests-for-review.md` (the bar and the proofs).

Locks: rec-05 (these tests). Child lock rec-05.1 moves the older locked assertions rule 17 changes (the old offer write routes now
answer 410, the old read no longer shows a Recruiter the salary, and the new Lambda's grants). See the review page for the list.

## How the tests run

AC-1 to AC-10, AC-12 to AC-15 and the seed part of AC-11 run once (`desktop-1280`) in the no-backend run. Each call runs the real handler
in a fresh Node process against the fake AWS, at a fixed time (25 Nov 2026 08:00 UTC plus a few seconds per step). AC-10 and AC-15 read
Terraform as text. The pepla-dev part of AC-11 runs on pepla-dev only (`@pepla-dev`). Nothing calls AWS or any AI.

## Decisions the tests make where the card is silent (D-T-5.1 to D-T-5.9, for the BA to confirm)

The full list is in the header of `rec-05.spec.ts`. The ones a builder is most likely to trip on:

- D-T-5.1 One new Lambda, `lambda/manageOffers` (Terraform `aws_lambda_function.manage_offers`, role `aws_iam_role.manage_offers`),
  serves every /v1/offers route on the talent-flow API with the JWT authoriser. Expiry runs in `monitorTalentFlowSLAs`.
- D-T-5.2 Answers are codes only: 403 `{ error: 'Forbidden' }`, 404 `{ error: 'Not found' }`, 400 `{ error: 'Bad request', code }`
  (INVALID_FIELD with `field`), 409 `{ error: 'Conflict', code }`, 410 `{ error: 'OLD_ROUTE' }`, 500 `{ error: 'Something went wrong' }`.
  A candidate not in Offer is 409 NOT_IN_OFFER.
- Decisions of 25 Nov (lock check round 1): any Recruiter of the company may submit; the withdraw route also takes SENT and then
  publishes OfferAnswered WITHDRAWN; a salary is never shown when its audit row cannot be written.
- D-T-5.3 The stored offer row carries `offer_id`, `tenant_id`, `state`, `version`, `drafted_by` and (after an edit of an approved
  offer or a send-back) `approval_history`. No other row carries both `offer_id` and `state`.
- D-T-5.5 A candidate whose offer is WITHDRAWN, DECLINED or EXPIRED may get a new offer.
- D-T-5.6 The salary is revealed with `?reveal=salary`. The audit row may be in any table; the tests find it by its fields.
- D-T-5.7 The approver tick is held by a person in a sign-in group that carries `perm-approve-offers` (roles.mjs), CONFIRMED, enabled,
  with exactly one Member row, of this company.
- D-T-5.8 History entries in the answer: `{ from, to, by_kind, by_name, at, note? }`, and `kind: 'EDITED'` with `fields` for an edit.
  An expiry is `by_kind: 'system'`, `by_name: null`.
- D-T-5.9 The list is newest first by `created_at`, then `offer_id`.

## REC-05 dev seed

`scripts/ci/seed-dev.py` gets `seed_rec05(ddb, ...)`, called from `main()`, and puts these rows back on every run, with the ids in
`support/rec-05/dev-ids.json`:

- Company A (the founding company) candidate `candidate` in Offer with no live offer (its lock row cleared each run). The dev test drafts,
  submits, approves, sends and finally withdraws an offer for it, so it is free again for the next run.
- Candidate `draftCandidate` in Offer, with the offer `draftOffer` in DRAFT, drafted by the E2E_HR login and never submitted.
- Every seeded offer row carries `version`, `candidate_name`, `role_title`, `department`, `drafted_by_name`, `created_at` and the
  company-keyed list key, in the same format the new code writes (ONB-15 lesson).
- The rest of the spec's seed list (a WAITING_APPROVAL offer, a SENT offer with an uploaded signed object, an old-code row for the
  script, one offer in company B) as the spec's Seed section says.
- A new approver login of company A in the Naleko pool: group `perm-approve-offers` only, a Member row of A, its password in Secrets
  Manager like the other test logins, read by the dev run as `E2E_APPROVER_EMAIL` / `E2E_APPROVER_PASSWORD`.

The dev test's company B caller (`E2E_HR_B`) must be a company with Recruitment on, so the test runs in the "Company walk (TEN-04)" step of
`app-e2e-dev.yml` (where `E2E_HR_B` is the walk company's HR login) and is left out of the main run, like REC-02 AC-12 and REC-03 AC-11.
`startDate` and `expiryDate` in `dev-ids.json` are fixed days in 2029 and 2030 so they stay in the future.

## Notes for the builder

- The old routes stay (deleting routes, Lambdas or the state machine waits for Iggie). `createOffer` and `advanceOfferState` answer 410
  after their existing role, company, module and row checks. The `StartExecution` code goes from `createOffer` (AC-10 reads the text).
- `getOffer` keeps answering, maps old state codes (rule 1) and no longer shows a salary to anyone.
- Every write answer has `salary: null`, so a cached idempotency answer never holds a salary.
- The role needs at least: GetItem, PutItem, UpdateItem on the state table; Query on a state index; GetItem and PutItem on the key table;
  GetItem on the roles and tenants tables; s3:PutObject and s3:GetObject under recruitment/; cognito-idp:ListUsersInGroup; KMS on the
  state key. No dynamodb:TransactWriteItems or s3:HeadObject lines (IAM checks the item actions and s3:GetObject). monitorTalentFlowSLAs
  needs GetItem on the tenants table and the TENANTS_TABLE setting.
- The throwaway build the verifier used (not for merge) is in `onboarding-cards/rec-05/`; it is one way to pass, not the design.

## Leftovers from the lock check (for the builder and the red-approved security review)

The tests do not catch these; the build review must:

1. The Cognito pool ARN in manageOffers' ListUsersInGroup grant, the event bus manageOffers publishes to, and the COGNITO_POOL_ID
   setting must be the right ones. A wrong pool or bus, or no COGNITO_POOL_ID, passes the no-backend tests and answers 500 on dev
   (approver lookup, event publish). AC-11 on pepla-dev catches it once the approver login exists.
2. Expiry on the expiry day itself: the spec says "past expiry_date" (the day after, Johannesburg time). The tests pin only a far-past
   date and a date not yet reached.
3. A sent-back offer's approver name, and `?reveal=salary` on the list (it must not add a salary), are not tested.
