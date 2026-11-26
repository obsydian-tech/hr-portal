# INT-UI-01

Card: INT-UI-01 · The Interviews tab on the candidate record. Jira NH-270 (epic NH-223, amber). A Recruiter sees every interview of a candidate with its state, and the chosen interview's details, people and feedback. No action button shows in this card. It reads `GET /v1/candidates/{id}/interviews` and writes nothing; no `lambda/`, `infra/` or CORS change.

Test files: new `int-ui-01.spec.ts`, `support/int-ui/interviews.ts` (the words, the fake built from `api/openapi.yaml`, the page helpers) and `support/int-ui/dev-ids.json` (shared with the dev seed `seed_int_ui01`). It reuses `support/rec-ui/harness.ts`, `support/rec-ui-02/record.ts` and `support/rec-ui-02/notes.ts` unchanged.

Spec: `specs/interview-journey/cards/INT-UI-01.md`, section "Changes after spec check round 1 (26 Nov)" (it wins over the text above it): M-1 to M-7, S-1 to S-7, final AC-1 to AC-10, decisions INT-UI-01-D1 to D12. Its check `INT-UI-01-spec-check.md` (round 2 passed with C-1, C-2 for the seed; notes N-1 to N-3). Backend: develop `7630b3c` (INT-01, `InterviewList` and `PanelEntry`).

Locks: `acceptance-lock/int-ui-01`, one squashed commit on `acceptance-lock/rec-ui-02.4` (5167fe5). Child lock `acceptance-lock/rec-ui-02.5`, one squashed commit on `acceptance-lock/rec-ui-02.4`, changes only the exact tab lists: `rec-ui-02-record.spec.ts` AC-R8 (and its title and the file header, N-3) and `rec-ui-02-notes.spec.ts` AC-N1 (line 66), both to Overview, Interviews, Notes. The builder merges both locks, after the Notes tab build (NH-280 step 4) has merged: both builds change `candidate-record.page.ts` and `hire-flags.ts`.

## How the tests run

Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 08:00 UTC (10:00 in Johannesburg). One AC-1 test runs the browser in UTC, so a page that writes days or times in the browser's own zone fails.

`interviews.ts` adds a fake of `GET /v1/candidates/{id}/interviews` on the same browser context as the harness and the record and history fakes. It mirrors `lambda/scheduleInterview/index.js` (GET) at `7630b3c` for a Recruiter: no or a bad token is 401; Recruitment off for the company is 403; another company's candidate, or none, is 404 `{ error: 'Not found' }`, before any interview is read; anyone who is not a Recruiter is 404; a failed read is 500 `{ error: 'Failed to fetch interviews' }`. Every interview and panel line is built over the file's own property lists, and every answer is checked against the file; a test ends red when `contractErrors` is not empty. Every interview also carries what the tab never draws: a raw `votes[]` entry with a marker comment and the rating `STRONG_NO`, `closed_by_name` and `closed_at` (on closed ones), marker person ids, and stale old fields (`interviewType` `STALE_OLD_TYPE`, `scheduledAt` on 3 Mar 2025, `adhocPanelMembers`, a criteria label). A test can make the fake refuse, hold an answer or drop the connection.

AC-10 runs on pepla-dev only (`@pepla-dev`). It opens the candidate in `support/int-ui/dev-ids.json` as `E2E_HR_*`. Its company B half needs `E2E_B_HR_EMAIL`/`E2E_B_HR_PASSWORD` and **fails** when they are not set (M-7: a skip is not a pass).

### The dev seed the builder writes (M-7 with C-1 and C-2)

New add-only `seed_int_ui01(ddb, tid, panel_subs, hr_sub)` in `scripts/ci/seed-dev.py`, called from the main run next to `seed_int01`, model `seed_int01`. Each run it deletes every row under `CANDIDATE#<candidate>` first, then puts:

- the `SAGA` row for company A: `firstName`/`lastName` from `dev-ids.json`, `positionLevel` `MID`, `currentStage` `INTERVIEW`, `tenant_id` stamped, `hiringManagerId` the other hiring manager (as `seed_int01`);
- four `INTERVIEW#` rows with the ids in `dev-ids.json`, written with **`interviewType` and `scheduledAt`** (C-1; never `type`/`at`), `sequence` 1, `length_minutes`, `where`, `place` or `video_link` (`https://`), `status`, `criteria_snapshot`, `tenant_id`, and type keys from the five known ones (N-2):
  1. `booked`: `SCHEDULED`, 7 days after the run, both panel logins, `TECHNICAL`;
  2. `waiting`: `SCHEDULED`, 2 days before the run, **exactly one** panel login and no guest, no `VOTE#` row (C-2: "Waiting on 1 feedback");
  3. `done`: `COMPLETED`, 10 days before the run, one panel login and one `VOTE#` row for it (scores, rating, and `comment` = `dev-ids.json` `comment`), `PHONE_SCREEN`;
  4. `cancelled`: `CANCELLED`, 5 days before the run, `closed_reason` `CANDIDATE_ASKED`, `closed_by` the HR login's sub, `closed_at`, `FINAL`.

## Decisions where the spec is silent (test writer, 26 Nov; the builder follows these)

- T-I1: the region the Interviews tab labels is any element in `main` whose `aria-labelledby` holds the Interviews tab's `id` (as Notes, T-N1). The loading look, the failure line, the empty line, the list and the chosen interview sit inside it.
- T-I2: the list is the kit's list labelled "Interviews" (`ul` or `ol` with `aria-label="Interviews"`); each of its child `li` is one interview, in the answer's order. Clicking a row chooses it. The chosen row carries the kit's `pp-card--selected` (on the `li` or inside it); no other row does.
- T-I3: the chosen interview is the one element with class `pp-card` in `main` that is neither inside the list nor holds it nor holds an empty state (`pp-card`, as the kit's `article.pp-card`). Its title is the `.pp-card__title` (the type words; none when there is no type). The empty state is a `pp-empty-state` (in a card or not), so it is never taken for a chosen interview.
- T-I4: a person line is the `li` (or, with no `li`, the parent) around each `.pp-person` in the chosen interview, in the answer's panel order. The tests read a row or a line with decorative parts left out (`aria-hidden="true"`, `svg`, `.pp-visually-hidden`, avatars) and take out the expected parts in order. What is left after the kit's separators (" · ", commas, colons, hyphens) and a weekday name are dropped must be nothing. So a role line, "null", a stale field or a vote the line was not sent fails, while the kit's "Mon 17 Nov 2026, 10:00" form and the spec's "17 Nov 2026, 10:00" both pass.
- T-I5: the date is `shortDate` ("17 Nov 2026"), the time 24-hour ("10:00"), both in Johannesburg. A weekday before the date is allowed (the kit draws one); the tests do not require it.
- T-I6: the length is drawn as the kit does ("60 minutes"); "Length 60" also passes. With no length, neither "minutes" nor "Length" shows.
- T-I7: the avatars of a row stand for every panel line, guests included (the avatar group's "+N" counts). No row may carry more or fewer.
- T-I8: the Overdue words sit in a `time` element (`time[ppDeadline]`, S-5). Its `text` input can carry "Overdue" for a due time earlier today; `ppDeadline` on its own would say "Due today" there.
- T-I9: an online link is drawn with the link itself as its text or with other words; the tests judge only `href`, `target="_blank"` and `rel` holding `noopener` and `noreferrer`. A `javascript:` address is shown as plain text and no `a` holds it.
- T-I10: the words table check is `node scripts/ci/check-interview-words.mjs [file]`, run with no argument from the repo root by a step of the `hygiene` job in `.github/workflows/ci.yml`. With no argument it checks `pepla-web/src/app/features/recruitment/interviews/interview-words.ts`; with a path it checks that file. It reads the file as text, so a copy in a temp folder can be checked. The table holds "Cancelled" as a string literal; the test plants `null` and `''` in its place and expects the check to fail (non-zero exit).
- T-I11: choosing a tab writes `tab` into the address; choosing an interview writes `interview`. Opening the tab with no `interview` may write the chosen one (the tests do not judge it); an unknown `interview` must be replaced by the chosen one. Opening a record with no `tab` leaves the address alone (N-1).
- T-I12: `required` drives the count line only; an empty list still shows "No interviews yet." whatever `required` says. The count line is not drawn in the failure state.
- T-I13: the spec's "one acceptance README row" is left out: the acceptance README says a card never edits it (as rec-ui-02.4 T-N6). This file is the card's note.

## What these tests must catch (the bar, LOCK-CHECK-STOPPING-RULE)

See `specs/interview-journey/cards/INT-UI-01-tests-for-review.md`.
