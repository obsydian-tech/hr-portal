# REC-06

Card: REC-06 (NH-240) Conversion Point: an accepted offer makes the hire and the employee record (red)

Test files: `rec-06.spec.ts` and `support/rec-06/` (`world.ts`, `lambda-harness.ts`, `dev-ids.json`, `manage-offers-lines.20b1bab.json`,
`fake-aws/`). The fake AWS is a copy of REC-05's with code added only: a transaction can be cancelled at a chosen item
(`failTransactItem`), another request's whole write can land just before this caller's transaction (`landBeforeTransact`), and a
cancelled transaction carries its reasons. The world is REC-05's plus an `employees` table (email-index as Terraform declares it) with a
few people of company A and company B.

Spec: `onboarding-cards/specs/REC-06.md` (rules 1 to 10, AC-1 to AC-10), read with the spec check's round 2 leftovers L-1 to L-5
(`REC-06-spec-check.md`) and decisions D-REC-6.4 to 6.10. Review page: `onboarding-cards/specs/REC-06-tests-for-review.md` (the bar and
the proofs).

Locks: rec-06 (these tests). Child lock rec-05.2 moves REC-05's AC-5 (an accept now also sends CandidateHired and moves the candidate to
HIRED) and gives the REC-05 fake world an empty `employees` table. Child lock rec-15d.2 lets REC-15 step D's "no new grant" check accept
exactly the two lines REC-06 gives manage_offers (REC-06's AC-9 checks them exactly). Child lock int-01.2 does the same for INT-01's AC-16
"no other grant on any policy" check. Nothing else locked moves. Push order: rec-06, rec-05.2, rec-15d.2, int-01.2.

## How the tests run

Everything except the dev part of AC-10 runs once (`desktop-1280`) in the no-backend run. Each call runs the real handler in a fresh
Node process against the fake AWS, at a fixed time. Every offer reaches SENT through REC-05's own routes (draft, submit, approve, send,
signed upload). AC-5 runs the locked `createEmployee` to compare row shapes. AC-9 reads Terraform as text. Nothing calls AWS or any AI.

## Decisions the tests make where the card is silent (D-T-6.1 to D-T-6.7, for the BA to confirm)

The full list is in the header of `rec-06.spec.ts`. The ones a builder is most likely to trip on:

- D-T-6.1 `employee_id` is the version 5 UUID of `"<tenant_id>:<offer_id>"` in namespace `6b7dcfde-d603-4673-9949-d5d39ac59e17`, built
  with Node's own `node:crypto` (L-3: manageOffers ships no packages). Keep the constant in one shared file.
- D-T-6.2 The table is `employees` (the literal createEmployee uses). If the code reads a setting, Terraform must set it on
  manageOffers.
- D-T-6.3 CandidateHired's `at` is the accept's time, also when a later repeat sends it. Both events use Source `talent-flow.workflow`.
- D-T-6.4 The follow-up marker is `followups_done.hired_event` on the offer row.
- D-T-6.5 A cancelled transaction that is not someone else's finished accept answers 409 `{ error: 'Conflict', code: 'STALE' }`.
- D-T-6.6 `from_recruitment.role_id` is the candidate's role_id, also when that role row is gone.
- D-T-6.7 The dev test judges the new person through GET /v1/employees (no `from_recruitment` there) and gets its signed copy through
  the real upload link.

## Builder notes (binding, from the spec check)

- L-1: the hr_staff check for an ACCEPTED answer is in the manageOffers handler, before any AWS call. An old-HR-name Recruiter without
  hr_staff is refused on a repeat accept too.
- L-2: a candidate stored under an old stage name that counts as Offer (read through `normaliseStage`) converts.
- L-4: AC-9 counts the KMS grant inside the list, because the role's address appears twice in `kms.tf`.
- L-5 known gap: offers accepted before REC-06 merges never get an employee. The tests check such an offer answers NOT_SENT and writes
  nothing; it is not fixed by this card.
- The hiring manager IT-bundle email stays out (S-REC-6.A waits for Iggie). AC-6 checks that nothing is emailed.
- The company comes from the sign-in only. The employee's details come from the saved candidate, never from the body.

## REC-06 dev seed

`scripts/ci/seed-dev.py` gets `seed_rec06(ddb, ...)`, called from `main()`, with the ids in `support/rec-06/dev-ids.json`. Each run it:

- deletes the employee rows REC-06 made for the two seeded offers (ids built with `uuid5` and the namespace), on condition of the
  company, without a scan;
- puts both candidates back to OFFER and both offers back to SENT;
- writes the rehire employee (`rehireEmployee`, robot address `rehireEmail`) so the rehire offer is refused.

`startDate` in `dev-ids.json` is a fixed day in 2030 so it stays in the future. The seed text check is AC-10's first test.

The dev test's company B caller must be a company with Recruitment on, so add
`REC-06 .* AC-10 The test logins on pepla-dev` to the "Company walk (TEN-04)" step's `--grep` in `app-e2e-dev.yml` and to the main
run's `--grep-invert`, like REC-05 AC-11.
