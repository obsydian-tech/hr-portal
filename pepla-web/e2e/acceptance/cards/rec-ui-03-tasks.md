# REC-UI-03 tasks

Card: REC-UI-03 server, the list of feedback a person owes (NH-293, gap G-10b, red: a new read of other people's interview data, and new rows written inside the booking, the interview actions and the vote). Server only: the screen (My tasks) is a later card.

Test files: `rec-ui-03-tasks.spec.ts` and `support/rec-ui-03-tasks/` (`world.ts`, `fake-boto3/`, `dev-ids.json`, `iam-83e606c.json`). It reads INT-01's world (`support/int-01/world.ts`), INT-01.F's hooks (`support/int-01f/`), REC-14's fake AWS and schema checker, REC-15's, REC-15c's and REC-15d's worlds, REC-02's IAM reader and `support/infra-harness.ts`, and changes none of them.

Spec: `onboarding-cards/specs/REC-UI-03-feedback-due.md` (rules 1 to 7, AC-1 to AC-14, D-293.1 to 12), checked in two rounds (`REC-UI-03-feedback-due-spec-check.md`, `-round2.md`). Review page: `onboarding-cards/specs/REC-UI-03-tasks-tests-for-review.md`.

Locks: `acceptance-lock/chat-15.7` (one line in `chat-15.spec.ts`: the new route `get_feedback_due` joins the allowed routes on submitVote), then `acceptance-lock/rec-ui-03-tasks` on top.

## What the tests run

- The real handlers (scheduleInterview for the booking and the four actions and the Interviews tab; submitVote for the vote and the new list; submitVoteByToken for the guest vote) in a fresh Node process each call, against REC-14's fake AWS, over INT-01's world at its fixed time NOW.
- The real backfill script against an in-memory DynamoDB (`fake-boto3`, copied from REC-06.2's).
- Terraform, `api/openapi.yaml`, `scripts/tenancy/ten-04-rows.json`, `openapi.d.ts` and `scripts/ci/seed-dev.py` as text. `scripts/ci/routes-match-openapi.mjs` is run.
- AC-13 runs on pepla-dev only (`@pepla-dev`), at each width, after merge.

## Decisions where the spec is silent (the builder follows these)

- D-T-1 `updated_at` is the request's own time (`Date.now()` of the run, ISO). OPEN rows carry no `done_reason`.
- D-T-2 "In the same transaction" means every feedback-due write of a request is an item of the one `TransactWriteItems` call that also writes the interview row (booking, the four actions) or the `VOTE#` row (the vote). No other call writes a feedback-due row.
- D-T-3 A refused request (any 4xx, or a cancelled transaction) leaves every feedback-due row exactly as it was.
- D-T-4 With no person id in the sign-in, the list answers `requireTenant`'s and `requireModule`'s checks first, then `403 {"error":"Forbidden"}` with no read of the state table.
- D-T-5 The backfill's command line: `python3 scripts/tenancy/backfill-feedback-due.py --table <name> [--profile <name>] [--region <name>] [--apply]`. `--profile` is optional (the dev workflow has no named profile). With no `--table` it exits non-zero and makes no AWS call. It writes with `put_item` only, with string expressions (client or Table resource), never `update_item`, `delete_item`, a batch or a transaction.
- D-T-6 A company B request that follows a forged row to company A's interview reads exactly one item of company A (the interview row, by key) and nothing else of A's candidate (spec check round 2, N-3). So: read the interview row, check `ownsRow` first, and only then read the saga and the votes.

## Things the builder must know

1. `state` is a DynamoDB reserved word: name it through `ExpressionAttributeNames` (`#s`) in the read's `FilterExpression` and in every `Update`.
2. Every feedback-due `Update` is unconditional and sets every field of rule 1 except `PK` and `SK` (they go only in `Key`). An `attribute_exists` condition makes every interview booked before this card impossible to close or score. The fake DynamoDB creates a missing item on Update, so the tests read the expression itself.
3. A feedback-due row must never carry `interviewId`, `candidateId`, `role_id` or a `GSI` key: the vote route and `GET /v1/interviews/{id}` find interviews through `interview-id-index` (projection ALL).
4. The vote's one retry (INT-01.F rule 2.4) sends the transaction again: the second try must carry the voter's `Update` too.
5. Whether the caller voted is the vote route's own test: any `VOTE#{me}#` row of that candidate whose `interviewId` is this interview (new, old 0 to 10 and link votes), or a `VOTED#{interview}#{me}` row. Never the exact key `VOTE#{me}#{interview}` alone.
6. `due_at` comes from `feedbackDueAt(interview.scheduledAt, settings.SLA_THRESHOLDS)` with `settingsForRead(tenant, saga)`: the candidate's locked settings, not the active ones (AC-9 has a candidate locked to 48 hours while the company is on 24).
7. The 200 cap: the first 200 OPEN rows in key order; `more` is true only when another OPEN row exists (exactly 200 gives `more: false`).
8. `seed-dev.py` loads the backfill lazily (importlib, inside the function that runs it), never at the top of the file: the be-16 AC-4/5 seed runs and the rec-04 and rec-14 seed runners load `seed-dev.py` with a stub boto3 and must keep passing.
9. The backfill file must not hold the word for company switches that mod-01 AC-7 looks for (it fails any `scripts/` file that holds it and a write call).
10. New route: run `npm run api:types` in `pepla-web` after the `api/openapi.yaml` change, and add the `ten-04-rows.json` list row.

## REC-UI-03 tasks dev seed

`seed_feedback_due` in `scripts/ci/seed-dev.py`, called from `main()` on every dev seed run, ids in `support/rec-ui-03-tasks/dev-ids.json` (keyed by Playwright project, plus `future`):

- Per width: one company A candidate at the Interview stage with one `SCHEDULED` TECHNICAL interview that started an hour ago, the panel login (`E2E_EMP`'s sub) and the HR login on its panel, `criteria_snapshot` set, `votesSubmitted 0`, `PANEL_FEEDBACK_PENDING_COUNT 2`, and both people's feedback-due rows put back to `OPEN`. Each run deletes the candidate's `VOTE#` and `VOTED#` rows first.
- `future`: one interview that starts in 7 days with the panel login on it and an `OPEN` row (must not be listed).
- Nothing for company B, no guest. After the seed, the backfill runs with `--apply` on the dev state table.
- AC-13 signs in as the panel login (`E2E_EMP_EMAIL`/`E2E_EMP_PASSWORD`) and the HR login (`E2E_HR_EMAIL`/`E2E_HR_PASSWORD`); the company B walk uses `E2E_HR_B_EMAIL`/`E2E_HR_B_PASSWORD` in the "Company walk (TEN-04)" step.
