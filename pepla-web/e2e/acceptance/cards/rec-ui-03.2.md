# REC-UI-03.2

Card: REC-UI-03 step 2 · HR gives feedback for a named panel member. Jira NH-229 (epic NH-223). On a candidate's Interviews tab a Recruiter presses "Capture feedback" on the chosen interview, picks the panel member who is still waiting, scores each criterion, decides, may add notes and submits. The vote goes to `POST /v1/interviews/{id}/votes` with `on_behalf_of`. No `lambda/`, `infra/`, CORS or design system change: the interviews read already says who may give feedback (`can.capture_feedback`) and the vote route already takes `on_behalf_of` (REC-07).

Test files: new `rec-ui-03.2-capture.spec.ts`, `support/rec-ui-03/capture.ts` (the words, the vote fake, the sheet helpers), `support/rec-ui-03/kit-capture.ts` (the kit's "Interview feedback" screens at the synced ref) and `support/rec-ui-03/dev-ids-capture.json` (shared with the dev seed `seed_rec_ui_03_2`). They reuse `support/int-ui/interviews.ts`, `schedule.ts`, `close.ts`, `support/rec-ui/harness.ts`, `support/rec-ui-02/record.ts` and `notes.ts` as locked. This card's notes live here, not in `cards/rec-ui-03.md`, and its dev ids in their own file, so this lock does not touch files the `rec-ui-03.1` lock changes.

Spec: `specs/REC-UI-03-next-slices.md`, step 2 and the notes at the end; its check `REC-UI-03-next-slices-spec-check.md`; words D-RUI-03.12 to .20 in `DECISIONS.md`. Server: develop `47cdf6d` (`lambda/submitVote/rec07.mjs` `vote`, `lambda/scheduleInterview/interview-view.mjs`, `lambda/shared/interview-lifecycle.mjs`).

## Locks

- `acceptance-lock/int-ui-01.3`, one commit on develop `47cdf6d`: `ACTION_WORDS` in `support/int-ui/interviews.ts` keeps only "Add panel member"; the AC-3 title in `int-ui-01.spec.ts` drops "Capture feedback".
- `acceptance-lock/int-ui-02.2`, one commit on `int-ui-01.3`: `OTHER_ACTIONS` in `int-ui-02.spec.ts` keeps only "Add panel member".
- `acceptance-lock/int-ui-03.1`, one commit on `int-ui-02.2`: the "no later actions" check in `int-ui-03.spec.ts` looks only for "Add panel member"; the AC-1 title says so.
- `acceptance-lock/rec-ui-03.2`, one commit on `int-ui-03.1`.

The builder merges `acceptance-lock/rec-ui-03.2` (it holds the three child locks).

## How the tests run

Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg. `capture.ts` adds one route after the INT-UI-03 fake for `POST /v1/interviews/{id}/votes`. It answers as `vote` in `rec07.mjs` at `47cdf6d`: the interview is found only among the caller's own company's rows (else 404); with `on_behalf_of`, 403 for a caller who is not a Recruiter or when the company's "HR may enter for a panel member" is off, 400 `INVALID_FIELD` for someone not on the panel; the body checks (`INVALID_SCORES`, rating, comment); `NOT_STARTED`, `ALREADY_DONE`, `NOT_ALLOWED_NOW`; 409 `ALREADY_SCORED` for a second vote; else 201 `{vote}`. The route ignores `Idempotency-Key`. A 201 changes what the next interviews read sends (the line GIVEN with the rating, the overall score and "Captured by"; `can.capture_feedback` false once nobody waits). Every answer is checked against `api/openapi.yaml`. Each interview can carry its own `criteria_snapshot`, or none.

AC-2.11 runs on pepla-dev only (`@pepla-dev`).

### The dev seed the builder writes

`dev-ids-capture.json` has one entry per Playwright project (`desktop-1280`, `phone-390`), each its own candidate: the dev step runs each width once but seeds once. New add-only `seed_rec_ui_03_2(ddb, tid, panel_sub, hr_sub)` in `scripts/ci/seed-dev.py`, called next to `seed_int_ui03` with the same panel login (`employee_sub`) and HR login. For each entry, every run:

- delete every row under `CANDIDATE#<candidate>`. A dev run leaves a `VOTE#` and a `VOTED#` row; either one left makes the next run fail (`ALREADY_SCORED`, or no button);
- put the `SAGA` row for company A as `seed_int_ui03` does (`firstName`/`lastName` from the entry, "Demo role", `hiringManagerId` `OTHER_HIRING_MANAGER`, `currentStage` `INTERVIEW`, `tenant_id`, `seed` `pepla-demo`);
- put `INTERVIEW#<interview>`: `TECHNICAL`, `SCHEDULED`, `scheduledAt` 26 hours before the run, `length_minutes` 60, `IN_PERSON`, `place`, `sequence` 1, `panelMemberIds` with the one panel login, `votesRequired` 1, `votesSubmitted` 0, `PANEL_FEEDBACK_PENDING_COUNT` 1, `PANEL_SPLIT_FLAG` false, `criteria_snapshot` (`REC04_CRITERIA`), `booked_by`, `tenant_id`, `seed` `pepla-demo`;
- put its guard row `IVTYPE#TECHNICAL` with `interviewId`, `v: 1`, `seed`. No guest, no votes.

The seed leaves the company setting alone: `seed_rec07` already puts `hrMayEnterForMember` true. A vote sends no email; the only event is `VotingCompleted`.

## Decisions where the spec is silent (test writer, 27 Nov; the builder follows these)

- **T-F1** "Capture feedback" is a `button[ppButton]` inside `main`, under the chosen interview's panel lines, full width on a phone.
- **T-F2** At 1280 the sheet is a `pp-drawer` (a dialog named by its title "Interview feedback for {first} {last}") with the footer Cancel then Submit feedback. At 390 it is a full page inside `main`: `pp-page-header` (its title the `h1`) and a `pp-form`, Submit feedback then Cancel, both full width; the tab's list is not drawn while it shows.
- **T-F3** "Feedback from" is the design system's `pp-select` (a native `select`) whose first option is an empty placeholder; the choices are the waiting people's names.
- **T-F4** The sliders are `pp-slider`, 1 to 5, each named by its criterion label, saying "n out of 5, word". The Decision is four `pp-radio-group` tiles in a `pp-field` with the legend "Decision". Notes is `textarea[ppTextarea]` with `maxlength="2000"`.
- **T-F5** A failure line is one `pp-section-message` (danger) inside the sheet, before the buttons.
- **T-F6** Submit is off when it is `disabled` or `aria-disabled="true"`. It stays off while a send is in flight.
- **T-F7** Cancel (both widths) and Escape (desktop) put focus back on "Capture feedback". After a save focus goes to "Capture feedback" when someone still waits, else to the chosen interview's row.
