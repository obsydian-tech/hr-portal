# INT-UI-03

Card: INT-UI-03 · Cancel, did not happen, mark as done. Jira NH-272 (epic NH-223, amber). On a candidate's Interviews tab a Recruiter cancels a booked interview before it starts, records that it did not happen after the start, or marks it as done with feedback missing, each with a reason, from More actions on the chosen interview (plain buttons on a phone). The server (INT-01) checks everything. No `lambda/`, `infra/`, CORS or design system change.

Test files: new `int-ui-03.spec.ts`, `support/int-ui/close.ts` (the words, the close-action fake, the page helpers) and `support/int-ui/dev-ids-03.json` (shared with the dev seed `seed_int_ui03`). It reuses `support/int-ui/interviews.ts`, `support/int-ui/schedule.ts`, `support/rec-ui/harness.ts`, `support/rec-ui-02/record.ts` and `support/rec-ui-02/notes.ts` unchanged.

Spec: `specs/interview-journey/cards/INT-UI-03.md`, section "Changes after spec check round 1 (27 Nov)" (it wins over the text above it): M-1, M-2, S-1 to S-7, final AC-1 to AC-10, decisions INT-UI-03-D1 to D15. Its check: `INT-UI-03-spec-check-r2.md` (leftovers L-1 to L-5). Server: develop `62a20d9` (`lambda/scheduleInterview/int01.mjs` `act`, `request-key.mjs`, `lambda/shared/interview-lifecycle.mjs`). Page: the INT-UI-02 build branch `feat/int-ui-02-schedule-interview` head `0ab5464`.

## Locks

- `acceptance-lock/int-ui-01.2`, one commit on `acceptance-lock/int-ui-01.1` (8ac0b71): `ACTION_WORDS` in `support/int-ui/interviews.ts` keeps only "Capture feedback" and "Add panel member"; `noActions` in `int-ui-01.spec.ts` drops the More actions filter and the menu count; the AC-3 "Did not happen" control line goes; the second AC-3 test's filter drops More actions; AC-3's title loses those words.
- `acceptance-lock/int-ui-02.1`, one commit on `acceptance-lock/int-ui-02` (6e47572): `OTHER_ACTIONS` and `noOtherActions` in `int-ui-02.spec.ts` keep only "Capture feedback" and "Add panel member" (no More actions, menu count or "Did not happen" check). The INT-UI-02 test writer kept the list inside the spec file, not in `support/int-ui/`, so the child lock edits the spec.
- `acceptance-lock/int-ui-03`, one commit on `acceptance-lock/int-ui-02.1`.

The builder starts after INT-UI-02 merges and merges `int-ui-01.2` and `int-ui-03` (which holds `int-ui-02.1`).

## How the tests run

Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 08:00 UTC (10:00 in Johannesburg). `close.ts` adds one route on the browser context, after the INT-UI-02 fake, for `PATCH /v1/candidates/{id}/interviews/{interviewId}` with any action but `reschedule` (handed back). It mirrors `act` at `62a20d9` in the server's order: front checks, another company's candidate 404 before the key, the request key (replay, `KEY_REUSED`, `KEY_IN_USE`, released by any refusal), the body keys, the reason lists, `reason_note` (required with OTHER, 1 to 500, not trimmed), an unknown interview 404, then `refusalOf` with the INT-UI-02 fake's clock. A save changes what the interviews read sends next (status, reason, note, every `can` false, `no_feedback` on waiting lines of a marked-done interview). Every answer is checked against `api/openapi.yaml`.

AC-10 runs on pepla-dev only (`@pepla-dev`). Its company B half needs `E2E_B_HR_EMAIL`/`E2E_B_HR_PASSWORD` and fails when they are not set.

### The dev seed the builder writes

`dev-ids-03.json` has one entry per Playwright project (`desktop-1280`, `phone-390`), each its own candidate (M-1, D13). New add-only `seed_int_ui03(ddb, tid, panel_sub, hr_sub)` in `scripts/ci/seed-dev.py`, called next to `seed_int_ui02` with the same panel login (`employee_sub`) and HR login. For **each** entry, every run (each dev run closes both interviews):

- delete every row under `CANDIDATE#<candidate>`, and the `SCORING_LINK#<guest_link_hash>` / `META` row of any interview that has a `guest_link_hash`;
- put the `SAGA` row for company A as `seed_int_ui01` does (`firstName`/`lastName` from the entry, `positionTitle` "Demo role", no `role_id`, `hiringManagerId` `OTHER_HIRING_MANAGER`, `currentStage` `INTERVIEW`, `tenant_id`, `seed` `pepla-demo`; L-3: without the tag `reset-dev-rec04.py` deletes them);
- put `INTERVIEW#<cancel.id>`: `interviewType` `FINAL`, `status` `SCHEDULED`, `scheduledAt` 7 days after the run, and `INTERVIEW#<done.id>`: `TECHNICAL`, 2 hours before the run. Both: `length_minutes` 60, `where` `IN_PERSON`, `place`, `sequence` 1, `panelMemberIds` with the one panel login, `votesSubmitted` 0, `criteria_snapshot`, `booked_by`, `tenant_id`, `seed` `pepla-demo`; times as `%Y-%m-%dT%H:%M:%S.000Z` in UTC;
- put their guard rows `IVTYPE#FINAL` and `IVTYPE#TECHNICAL` with `interviewId`, `v: 1` and `seed` `pepla-demo`. No guest, no votes.

The throwaway build's version is in the kit (`int-ui-03-throwaway-build-NOT-FOR-MERGE.patch`).

## Decisions where the spec is silent (test writer, 27 Nov; the builder follows these)

- **T-C1** The phone action buttons are `button[ppButton]` with exactly the action words as their text and name. On desktop the menu button is the `pp-dropdown-menu` icon button named "More actions for the {type} interview"; its items are `menuitem`s with the action words.
- **T-C2** The dialog is a `pp-modal-dialog` named by its title. Its footer is the design system's `pp-modal-footer`; the close button is the design system's "Close" in the header.
- **T-C3** The dialog line(s) of rule 4 are the dialog body's own text outside the reason `pp-field`, the "Describe the reason" `pp-field` and any `pp-section-message`. The tests read that text and want exactly the line (or nothing for a cancel with no guest).
- **T-C4** The reasons are one `pp-field group="radio"` with the legend "Reason" holding a `pp-radio-group` (radios named by their labels). "Describe the reason" is `input[ppTextField]` with `maxlength="500"` inside a `pp-field` labelled "Describe the reason", drawn only while "Other" is chosen.
- **T-C5** The main button is off when it is `disabled` or `aria-disabled="true"`.
- **T-C6** The refusal and failure messages are `pp-section-message` tone danger, above the reasons. A "changed" refusal keeps the main button off until the dialog closes.
- **T-C7** "Focus on its row" after a save: the chosen row's `li` in the list "Interviews" (or something inside it) has focus.
- **T-C8** "A change to the body makes a new key": any body different from the one the current key was last sent with gets a new key, also a body seen earlier under an older key.
- **T-C9** Sign-out is pressed with `dispatchEvent` (the blanket covers the avatar), as INT-UI-02 T-S8. The test watches the page from sign-out on with a MutationObserver.
- **T-C10** The blanket click is a click on the blanket outside the dialog (above the sheet on a phone).
- **T-C11** The menu and the buttons switch at the design system's phone line: 767 wide shows the buttons, 768 the menu (desktop-only test resizes the window).
- **T-C12** No acceptance README row (a card never edits it, as INT-UI-01 T-I13).

## Step 0

1. `acceptance-lock/int-ui-01.1` (8ac0b71) and `acceptance-lock/int-ui-02` (6e47572) are pushed. INT-UI-02's AC-1 asserts "no close actions" through `noOtherActions` in its spec file (read before writing `int-ui-02.1`).
2. Lock branches grepped before the push (see the tests-for-review file).
3. Panel login for the seed: `employee_sub`, the one `seed_int_ui02` uses. Company A's dev `PANEL_CONFIG.interview_emails` is not confirmed (the cloud login cannot read table data); if it is 'ON', the dev cancel sends E5 to the panel at the test address only (INT-04 `TEST_ADDRESS`).
