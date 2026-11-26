# REC-06.1

Card: REC-06.1 (NH-284) Conversion Point leftovers: one employee per email, events once, old capitals (red)

Test files: `rec-06.1.spec.ts` and `support/rec-06.1/` (`world.ts`, `lambda-harness.ts`, `dev-ids.json`, `baseline-55efe0f.json`,
`fake-aws/`, `fake-boto3/`). The fake AWS is a copy of REC-06's with code added only: a cancelled transaction can name the item that
failed and its reason (`cancelTransactItem`) or carry no readable reasons (`cancelUnreadable`); the email index can lag (`staleIndex`);
another call's finished writes can land just before a chosen update (`landBeforeOp`); an update can fail by what it sets or removes
(`failUpdate`); the event bus can take one entry and refuse the other (`eventsPartial`). The fake boto3 runs the back-fill script for
real in Python: Scan pages of three, Query, GetItem and UpdateItem with conditions; Put, Delete, batch and transactions are refused.
The world is REC-06's plus candidates in Offer of company A and company B who share one address.

Spec: `onboarding-cards/specs/REC-06.1.md` (rules 1 to 13, AC-1 to AC-10), which passed its spec check after the four fixes in
`REC-06.1-spec-check.md`. Review page: `onboarding-cards/specs/REC-06.1-tests-for-review.md` (the bar and the proofs).

Locks: rec-06.1 (these tests, plus the changed lines of `rec-06.spec.ts` below). Child lock rec-16.2 comes **after the build**: it
changes only the `offers.mjs` hash in `support/rec-16/baseline-9252f33.json` to the hash of the built file. The test writer checked on
a throwaway build that this is the only REC-16 check that moves (REC-16 AC-6(c)). If the builder changes `offers.mjs` again after
rec-16.2, rec-16.3 follows.

## How the tests run

Everything except AC-10's dev test runs once (`desktop-1280`) in the no-backend run. Each call runs the real handler in a fresh Node
process against the fake AWS, at a fixed time. Every offer reaches SENT through REC-05's own routes. "At the same moment" is two runs
that start from the same rows, where the first run's finished writes land inside the second at the point the test names. AC-8 runs
the real Python script and then the real `cognitoPostAuth`. AC-10's seed test calls the real `seed_rec06_1` and `seed_rec06` from
`scripts/ci/seed-dev.py` with the same fake boto3, which then lets conditional put_item and delete_item run. AC-9 reads Terraform as text. Nothing calls AWS or any AI.

## Changed lines in rec-06.spec.ts (develop 55efe0f)

- AC-2 title: four items becomes five items (adds "the email lock of REC-06.1").
- AC-2: `items.length` 4 becomes 5; items on the state table 3 becomes 4.
- AC-8 title: "claims, sends ... then sets the marker".
- AC-8: the writes on a repeat accept are `[UpdateItem state, UpdateItem state]` (the claim, then the marker), and both hold the
  `tenant_id` condition.

Nothing else in REC-05's or REC-06's locked tests moves (run on the throwaway build: rec-05, rec-05-kms and rec-06 all green).

## Decisions the tests make where the card is silent (D-T-6.1.1 to D-T-6.1.5, for the BA to confirm)

The full text is in the header of `rec-06.1.spec.ts`.

- D-T-6.1.1 The lock row is the fifth item of the transaction (index 4), a Put on the state table, with exactly PK, SK, employee_id,
  offer_id, locked_at, expires_at and tenant_id. locked_at is the accept's time; expires_at is that plus 15 minutes (`toISOString`).
- D-T-6.1.2 The claim is `followups_done.claimed_at` (ISO text, the call's own time). The marker stays `followups_done.hired_event`.
  A claim older than 5 minutes may be taken over. An offer that already has the marker is answered with no write at all (keep the
  early return at the top of the follow-up step; without it a repeat writes a claim).
- D-T-6.1.3 A cancelled accept answers EMAIL_IS_EMPLOYEE only when the cancel carries five reasons and the fifth is
  ConditionalCheckFailed. Every other cancel (another item, TransactionConflict on the lock, no reasons, another length) is STALE.
- D-T-6.1.4 The back-fill is `scripts/backfill/lowercase-employee-emails.py`, run with `python3`, table `employees` by default, boto3
  client or resource with string expressions, report on standard output, exit code 0 when the run worked.
- D-T-6.1.5 AC-9 is judged by file fingerprints (the offers role file and `infra/kms.tf` as on develop 55efe0f, the state table block
  unchanged), not by a count of every Terraform resource: REC-16 merges first and adds its own.

## Builder notes

- Rule 1: the lock key hashes the address trimmed and lower case. The row never holds the address.
- The empty address check (409 NOT_OPEN) comes before the rehire stop and before any write.
- Logs: only the offer id and an error name. Not the address, not the lock key (it holds the hash), not a name or phone.
- Rule 12: drop the unused `hrOnly` import from `offers.mjs`.
- Do not edit `employee-row.mjs`, `manageOffers/index.mjs`, `tenant.mjs`, any Terraform or any IAM file. REC-16 fingerprints them,
  and the eleven older IAM locks must not move (checked on the throwaway build).
- The company comes from the sign-in only. AC-2(c) sends company B's id in headers, query and body of an A accept.
- The back-fill prints counts per company id and employee ids only. Dry run unless `--apply`. Each write is conditional on the email
  and company read.
- Order: the build PR merges after REC-16's PR. `seed-dev.py` edits are add-only; whichever merges second rebases.

## REC-06.1 dev seed

`scripts/ci/seed-dev.py` gets `seed_rec06_1(ddb, ...)`, called from `main()` after `seed_rec06`, with the ids in
`support/rec-06.1/dev-ids.json`. Each run it deletes both possible employees (uuid5 of each offer, the winner is not known), the
EMAIL_LOCK row of the shared robot address and both candidates' STAGE# history rows, each on condition of the company and by known
key (no Scan); then puts both candidates back to OFFER and both offers back to SENT. `seed_rec06` should clear its own lock and
history rows the same way, or REC-06's dev test is stopped by its own last run's lock inside 15 minutes.

The dev test runs in the main dev run, like REC-06's AC-10 (it reads company B as `E2E_HR_B`, as REC-06's does). No workflow change
is needed. It has not been run by the test writer (no dev logins in the test-writing session).

## Leftovers from the lock check (not fixed by these tests)

- L-1 The dev test may fail at random on a true overlap. On real DynamoDB two transactions on the same lock key can, rarely, both be
  cancelled with TransactionConflict, so the dev test sees two 409s. Judge that run by its step results and re-run once (rule 8 counts
  three in a row). If it repeats, a child lock lets "both STALE" retry once.
- L-2 Two capitalised rows of one company with no lower-case row (for example `John@Z.co` and `JOHN@z.co`): the back-fill changes both
  to the same lower-case address and makes a duplicate. The spec only skips a row when a lower-case row already exists. For the
  security review to judge whether the script should skip these too.
