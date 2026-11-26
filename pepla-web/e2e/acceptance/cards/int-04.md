# INT-04 · Interview emails with the calendar invite (NH-277, red)

Spec: `/mnt/project-files/specs/interview-journey/cards/INT-04.md` (rules 1 to 14, decisions D-INT-04.1 to D-INT-04.10), checked in
`INT-04-spec-check.md` (passed in round 2). Approved texts: `specs/interview-journey/EMAILS-DRAFT.md` (Iggie, 26 Nov 2026 14:08 SAST).
Tests: `int-04.spec.ts`, support in `support/int-04/` (nothing in `support/int-01/` or any other folder is changed).
Lock: `acceptance-lock/int-04`. No child lock (see "Child locks" below).

Run (no backend, about 1 minute): from `pepla-web/e2e/acceptance`,
`E2E_BASE_URL=http://localhost:1 npx playwright test -c playwright.config.ts int-04.spec.ts --project desktop-1280 --reporter=line`

## Pinned by the test writer where the spec is silent

Written out at the top of `int-04.spec.ts`. In short:

- **T-1** How the approved texts are read (`support/int-04/approved.ts`): a body is blocks with one blank line between them; the
  `[details]` block is its three lines (When, Length, Where), inside "The new details:" block in E-4; a "[only when ...]" line is its own
  block, left out with its blank line when the value is missing; "Hi." when the first name is empty; lines end with `\n`, no break after
  the last line; a line whose last value is empty ends at its full stop with no trailing space.
- **T-2** A guest address INT-01 accepts but INT-02 refuses gives `PERSON_NOT_FOUND` or `INVITE_BAD_EMAIL`.
- **T-3** AC-3's text check lets DynamoDB expressions through (the value of a property whose name ends in `Expression`), because rule
  10.3 itself names one with " OR ". A bare string statement (`'use strict'`) is not judged either. `int01.mjs` is judged only on the
  literals it adds against develop ff432ee (`support/int-04/int01-ff432ee.json`, made with the same literal reader).
- **T-4** The slow-pool case uses 5 s per lookup and 20 panel members (the spec's 3 s and 10 people finish inside 12 s at 5 at a time,
  so they cannot see a missing budget).
- **T-5** "Two copies at once" is one SQS batch with the same message twice.
- **T-6** The sender "throws" when its record is in `batchItemFailures`.
- **T-7** INT-01.F follow-up F-1 (D-INT-04.10) has no AC and is not tested here. No locked test pins the guest vote's condition text
  (checked with grep on rec-07, int-01, int-01f and int-03 specs), so it fits this card: the builder adds
  `attribute_not_exists(guest_link_hash) OR guest_link_hash = :h` to the guest vote write in `lambda/submitVoteByToken/rec07.mjs`, and
  the security review reads it. If the builder finds a locked test that moves, F-1 goes to its own card instead.
- **T-8** Rule 11's producer line is `{ event: 'interview_emails', queued, skipped }` **without `interview_id`**. The locked INT-01.F
  tests (`int-01f.spec.ts:448` AC-5 and `:649` AC-8) forbid the booking's id in any scheduleInterview log line; they won on the
  throwaway build, so the spec's line gives way to them instead of moving a lock.

## For the builder

- Measure the 12 s budget with `performance.now()` (the tests freeze `Date`), started at the top of the request.
- `scripts/ci/check-lambda-settings.py`: settings listed there must be read with `requireSetting()`, which throws. Rule 13 says a
  missing `FRONTEND_URL` or `INTERVIEW_ORGANISER_EMAIL` gives `SETTING_MISSING` and the booking still answers. Do not list
  scheduleInterview's two new settings as required; do add the new keys (`FRONTEND_URL`, `INTERVIEW_ORGANISER_EMAIL`,
  `INTERVIEW_EMAIL_MODE`, `INTERVIEW_TEST_EMAIL`) to `ALLOWED_NEW` so the prod plan check accepts them. No test reads this file.
- The locked INT-01 and INT-01.F runs have no `INTERVIEW_ORGANISER_EMAIL`, so every action there logs `SETTING_MISSING` and the kept
  guest keeps the same link. That is what keeps them green with no lock change. Do not add the setting to `support/rec-04/world.ts`.
- One-line values: strip U+2028 and U+2029 with `  ` escapes, never the raw characters (a raw one ends a regex literal).
- The sender's `MVP1_RECIPIENT_OVERRIDE` is never read on the interview path.
- The dev seed (`seed_int04`, in `scripts/ci/seed-dev.py`) reads `support/int-04/dev-ids.json`, sets `interview_emails` ON in place,
  never names `candidate_interview_emails` or `REAL`, and deletes the candidate's interview rows and their `INTERVIEW_EMAIL#<id>#` guard
  rows first. AC-12 on dev takes its two panel logins from INT-01's seeded past interview.

## Child locks

None. The spec named `int-01.3` and `int-01f.1`. On the throwaway build every INT-01 and INT-01.F test that the spec expected to move
stayed green, because the locked worlds have no `INTERVIEW_ORGANISER_EMAIL` (rule 13: `SETTING_MISSING`, the same link moves). The only
red lines were INT-01.F AC-5 `:448` and AC-8 `:649` (the producer log held the interview id); T-8 removes the id from the log instead.

## Left open

- AC-12 runs on pepla-dev after merge only; it is the first proof that Postmark accepts the message and that the guard row is written on
  a real table.
- How calendars show the file (L-1) is not checked.
