# REC-UI-02.9

Card: REC-UI-02 Candidates, step 9: Reopen a Not hired candidate from the record. Jira NH-280 (AC-8, epic NH-223, amber). Calls the existing `POST /v1/candidates/{id}/reopen` (REC-02); no `lambda/`, `api/` or `infra/` change.

Test files: new `rec-ui-02-reopen.spec.ts`, `support/rec-ui-02/reopen.ts` and `support/rec-ui-02/reopen-dev-ids.json`. It reuses `support/rec-ui/harness.ts` (REC-UI-01), `support/rec-ui-02/record.ts` (rec-ui-02.3) and `support/rec-ui-02/notes.ts` (rec-ui-02.4) unchanged.

Spec: `onboarding-cards/specs/REC-UI-02-later-steps.md` section 5b (rules 1 to 7, AC-RO1 to AC-RO11), its checks `REC-UI-02-step9-spec-check-r1.md` (F-1 to F-4, S-1 to S-3) and `-r2.md` (PASS, N-1 and N-2), decision D-RUI-02.35 (Iggie's "Approve all", 28 Nov 2026 09:38 SAST).

Locks: acceptance-lock/rec-ui-02.9, one squashed commit on develop `64b5750`. **No locked line moves.** The locked AC-R3 and AC-R8 lines of `rec-ui-02-record.spec.ts` ("no Reopen" over `cand-nomvula`) stay as they are and keep passing: the record fake sends no `stage_before_not_hired`, so rule 1 shows no button there (spec "Locked lines that move", first option; spec check r2 N-1). `reopen.ts` adds the field only on the candidates a test names, by wrapping `recordOf` the way `hired.ts` adds `employee_id`; `record.ts` does not move.

## How the tests run

Every test runs at 1280 and 390 wide unless it says why not. Page time is the harness clock (19 Nov 2026 10:00 in Johannesburg). `reopen.ts` answers `POST /v1/candidates/{id}/reopen` as `reopenCandidate` in `lambda/shared/recruitment-actions/record-not-hired.mjs` does at `64b5750`: 401 without a token, 403 for a caller who is not a Recruiter or whose company has Recruitment off, 404 for another company's candidate or none, 400 for a blank or over-long reason, 409 `NOT_OPEN` unless the candidate is Not hired with an open `stage_before_not_hired`; otherwise the candidate goes back to that stage in the harness world, the history fake gets one stage-history row from Not hired to that stage (carrying the reason), and the answer is `200 { candidateId, stage }`. Refusal bodies carry the marker `MARK-reopen-server-text`.

AC-RO11 runs on pepla-dev only (`@pepla-dev`). As `E2E_HR_*` it opens its own width's candidate (`support/rec-ui-02/reopen-dev-ids.json`, keyed by Playwright project), records Not hired ("Candidate withdrew"), reopens it with "Dev check reopen" and sees the seeded stage again, also after a reload. The company B half reads `E2E_B_HR_EMAIL` and `E2E_B_HR_PASSWORD` (set since `3afa2d9`) and fails when they are not set: a skip is not a pass.

## For the builder

1. "Reopen" is a plain button in the record's header actions, where "Not hired" sits on an open record. Show it only when `stage` is `NOT_HIRED`, `can_decide` is true and `stage_before_not_hired` is one of `APPLIED`, `SCREENING`, `INTERVIEW`, `OFFER` (rule 1). Read `stage_before_not_hired` into the page's `View`; today the page leaves it out on purpose (the `View` comment), so update that comment too. The record type comes from `api/openapi.yaml` `CandidateRecord`, which already has the field (spec check r2 N-2).
2. The dialog is a `pp-modal-dialog` with `[closable]="true"` and heading "Reopen this candidate"; one `pp-field label="Reason"` holding a `textarea ppTextarea` with `maxlength="1000"`; footer Cancel (default) and "Reopen" (`appearance="primary"`). "Reopen" is disabled until the trimmed reason has a character and while the call runs. No error line, no help line, no "(required)". The `required` attribute on the textarea is fine; `pp-field`'s own `required` star is allowed too (it is hidden from screen readers and the tests read the label without it).
3. Send `POST /v1/candidates/{id}/reopen` with body `{ reason }` (trimmed) and nothing else: no stage, no company, no query, no `Idempotency-Key` (rule 3, S-1). Use `HireApi.call` without a key.
4. On 200: close the dialog, forget the Notes history (as Move and Not hired do, `dropNotes()`), read the record again, then put focus back in the person header (any button there, for example the first one). On any other answer, or none: keep the dialog and the typed reason, show "Your change could not be saved. Try again." inside the dialog (`pp-section-message tone="danger"`, as the Not hired dialog does), print no code, status or server text; on 409 also read the record again. Cancel, Close and Escape still close a failed dialog.
5. Cancel, Close and Escape send nothing; the next opening starts empty.
6. Reset the dialog when the address changes (`open()`), so nothing of one candidate is kept for the next, or for another person after a sign-out.
7. Add `seed_rec_ui_02_9` to `scripts/ci/seed-dev.py` (spec F-4): one candidate per width from `reopen-dev-ids.json`, company A, every row under it removed and the SAGA row written back at its open stage every run, a level whose second confirmation is off in the company's active `REJECTION_RULES`, no role, no offer row. The test writer's version is in `onboarding-cards/rec-ui-02-later/step9/THROWAWAY-NOT-FOR-MERGE.patch`.

## Decisions where the spec is silent (test writer, 28 Nov; the builder follows these)

- T-R1: AC-R3 and AC-R8 are left as they are (spec's first option), so this lock moves no locked line and does not overlap steps 6 and 7, which also move AC-R8.
- T-R2: "Reopen" on the record is judged by its name in the person header; a "Reopen" anywhere else on the page (a link, a menu item) counts as a second one and fails AC-RO1.
- T-R3: the label is judged without parts hidden from screen readers: `pp-field`'s `*` is allowed, "(required)" is not. Any other words in the dialog fail AC-RO2 and AC-RO3; a character count in the design system's "n/1000" shape is allowed.
- T-R4: "the field stops at 1000 characters" is judged by `maxlength="1000"`, by typing 1001 and keeping 1000, and by what is sent.
- T-R5: "focus returns to the header" (rule 4) is judged as: after a 200 the focused element is inside `.pp-person-header`.
- T-R6: the failure line must be inside the dialog. A line only on the page behind it fails AC-RO6 (the person cannot see it under the dialog).
- T-R7: AC-RO8 checks that the history is read again after a reopen and that its newest row reads as `movedLine(first, stage, by)` from `support/rec-ui-02/notes.ts`, the helper AC-N3 locks; this file does not copy the words. The reason the person typed must not be on the page.
- T-R8: AC-RO11's candidate starts at Screening (one open stage is enough on dev; the no-backend tests cover all four).
