# INT-01 · Interview lifecycle on the server (NH-269, red)

Spec: `/mnt/project-files/specs/interview-journey/cards/INT-01.md` (rules 1 to 18, R-1 to R-23, M-1 to M-6, S-1 to S-11, decisions
INT-01-D1 to D10), checked in `INT-01-spec-check.md`. Tests: `int-01.spec.ts`, support in `support/int-01/`. Lock: `acceptance-lock/int-01`.
Built on develop bd6d02c.

Run (no backend, about 1.5 minutes): from `pepla-web/e2e/acceptance`,
`E2E_BASE_URL=http://localhost:1 npx playwright test -c playwright.config.ts int-01.spec.ts --project desktop-1280 --reporter=line`

## Pinned by the test writer where the spec is silent

D-T1 to D-T13 are written out at the top of `int-01.spec.ts`. In short:

- **D-T1** A time in the past (or now) is `400 AT_IN_PAST at`, judged after the other body checks.
- **D-T2** The booking answer is exactly `{ interview_id, status: 'SCHEDULED', sequence: 1 }`; an action's 200 answer is checked against
  `api/openapi.yaml` only.
- **D-T3** Reschedule with `guest_email: null` removes the guest; the same address keeps the same link; another address is a new guest.
- **D-T4** The same request key on another route, candidate or caller is judged on its own (R-22 puts all of them in the key).
- **D-T5** A panel entry's `vote.overall` is the mean of that vote's scores, one decimal; `on_behalf_by_name` is null for a vote the
  person gave themselves.
- **D-T6** `no_feedback` is true exactly for those without a vote on an interview marked as done.
- **D-T7** `closed_by_name` comes from the pool (null when none). Mark as done stores the closed fields like the other closing actions.
- **D-T8** A refused action on an interview that is not SCHEDULED is checked as 409 only, unless the spec names the code.
- **D-T9** `can.capture_feedback` is true exactly when the vote route accepts a vote from this caller now.
- **D-T10** InterviewList keeps every rule 6 key in `required` except the ones hidden by caller (`candidate_note`, `closed_note`,
  `no_feedback`, a guest's `email`, a person's `vote`). Step D's own optional keys stay optional. Every object stays closed.
- **D-T11** The sequence in an event equals the row's sequence after the action.
- **D-T12** Only reschedule and cancel are checked to raise `sequence`.
- **D-T13** In the race of AC-27(b2), Mark as done may also be refused 409 with the vote kept; a voter is never `no_feedback`.

Further choices made while proving the tests (not in the spec):

- **D-T14** A company B Recruiter with no `Idempotency-Key` header gets `400 INVALID_FIELD Idempotency-Key`, not 404: the spec puts the
  header check after the role and company checks and before any read, and finding A's candidate is a read.
- **D-T15** A stray interview row under company A's candidate that carries company B's `tenant_id` is `404` for A's Recruiter on every
  action (every row is checked, not only the candidate).
- **D-T16** The scores read for a hiring manager who does not decide: their own votes only when they sit on a panel of this
  candidate (the panel shape, no summary), else `403 { error: 'Forbidden' }`.
- **D-T17** The dev seed may read the ids from `support/int-01/dev-ids.json`, as `seed_rec07` does.
- **D-T18** Another company's candidate is `404` before the request key is written (locked ten-03 AC-3: a 404 on another company's
  record writes nothing). R-22 only puts the header check before any read; the company read comes before the reserve.

## Notes for the builder

- **IAM.** Only `dynamodb:GetItem` and `dynamodb:PutItem` on the request-key table are added (AC-16 compares every policy line with
  `support/int-01/iam-bd6d02c/policies.json`). The four roles hold no `DeleteItem` and no `ConditionCheckItem`: use Put and Update items
  in transactions only. The throwaway build kept "one per type" safe under two bookings at once with a guard row per type
  (`CANDIDATE#<id>` / `IVTYPE#<type>`, a version number in a condition) written in the same transaction as the interview.
- **Strong reads.** AC-9 runs with a preload that makes any state-table Query without `ConsistentRead: true` miss the newest vote. The
  vote count and the "everyone voted" check must read strongly.
- **Request keys.** `IDEMPOTENCY_TABLE` goes into scheduleInterview's environment. A 2xx answer is stored and replayed; anything else
  frees the key so the same key is judged again. While the first request runs, the same key is `409 KEY_IN_USE`.
- **Old routes (R-14, R-15).** A new-way interview (it has `sequence`): the old signed-in vote route is `409 USE_NEW_ROUTE`, the
  `VoteSubmitted` bus event is skipped with a log line naming `USE_NEW_ROUTE` and answers `200 { skipped: true }`, the old guest route
  gives the single expired answer, and `generateScoringLink` is `409 USE_BOOKING`. Old-way interviews behave as today.
- **Dev seed.** `seed_int01` must clear everything the last run left on the INT-01 dev candidate (bookings, any guard rows, votes) before
  it writes the two interviews and the guest link: the dev test books PHONE_SCREEN and TECHNICAL on every run. The REC-07 seed
  interview must start in the past (rule 14), or the REC-07 dev check cannot vote.
- **R-9.** The three EventBridge deletes are not tested here. The dev apply waits for Iggie; if he has not answered at merge time, put
  them in a follow-up PR.
- **KMS.** See `int-01-facts.md` item 3: no key line is expected; the first dev booking proves it.

## Child lock int-01.1 (older locked tests INT-01 changes)

The spec's AC-17 named rec-07.3, rec-12.3 and rec-15.N. Running 61 older suites on the throwaway build and on develop side by side
found 25 older tests that INT-01 changes, in 13 suites (rec-12 needed nothing). Following rec-15d.1, one child lock holds every edit,
each marked `child lock int-01.1`, with its helpers in `support/int-01.1/`:

- **The one new grant** (`grants.ts`, `isInt01Grant`): mod-01 AC-8, rec-01 AC-8, rec-02 AC-11, rec-04 AC-8, rec-07 AC-9, rec-15 AC-17,
  rec-15b AC-17, rec-15c AC-17, rec-15d AC-17, ten-03 AC-10 allow GetItem and PutItem on the request-key table, nothing broader.
- **The booking and the PATCH** (`fixtures.ts`): the route lists of rec-01, ten-03 and mod-01 send INT-01's booking body and a request
  key, the PATCH sends an action with its reason, the add-panel route is gone, and the three worlds set `IDEMPOTENCY_TABLE`. Those
  worlds keep their interview at 2026-12-01 09:00 UTC on the real clock, so the PATCH is a cancel before that time and a Mark as
  done after it (both 200).
- **rec-07** (`rec07.ts`): AC-1 books the INT-01 way and moves the stored start before NOW before voting (rule 14); AC-6 a hiring
  manager who does not decide is refused the sheet 403 (R-1); AC-7 the guest read also answers `open` (AC-24).
- **rec-15d** AC-14 and AC-16: the rule 6 keys, `outcome` gone (R-4), a panel entry's `vote`, `no_feedback` and a guest's `email`
  (judged in int-01 AC-11 and AC-20, set aside here); the planted "email in an entry" case is now a phone.
- **int-03** AC-3 (`int03.ts`): runs R1 and R7 answer `open: true`; run R4 may write one `VOTED#` guard row. Nothing else moves.

Not a lock change: rec-14.3 AC-7 needs `npm run api:types` after the openapi edit (the builder commits the new `openapi.d.ts`).

The throwaway build that passes these tests is in the review kit (`int-01-throwaway-build-NOT-FOR-MERGE.patch`). It is a guide, not
a design to copy.
