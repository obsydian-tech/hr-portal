# INT-UI-05

Card: INT-UI-05 · Panel summary. Jira NH-274 (epic NH-223, amber). On a candidate's Interviews tab, when the chosen interview is Done, a Recruiter sees "Panel scores": the panel's average per criterion and overall, each "{n} out of 5", the decisions counted, and "Split panel" when the server says the panel disagreed. The page reads `GET /v1/candidates/{id}/scores` (REC-07, merged); it works nothing out itself. No `lambda/`, `infra/`, CORS or design system change.

Test files: new `int-ui-05.spec.ts`, `support/int-ui/summary.ts` (the words, the scores fake, the page helpers) and `support/int-ui/dev-ids-05.json` (shared with the dev seed `seed_int_ui05`). It reuses `support/int-ui/interviews.ts` (changed by the child lock below), `support/int-ui/schedule.ts`, `support/int-ui/close.ts`, `support/rec-ui-03/capture.ts`, `support/rec-ui/harness.ts`, `support/rec-ui-02/record.ts` and `support/rec-ui-02/notes.ts` unchanged.

Spec: `specs/interview-journey/cards/INT-UI-05.md`, section "Changes after spec check round 1 (27 Nov)" (it wins over the text above it): M-1, M-2, S-1 to S-5, final AC-1 to AC-10, decisions INT-UI-05-D1 to D12 (D11 and D12 also in `DECISIONS.md`). Server: develop `c541943` (`lambda/submitVote/rec07.mjs` `sheet()`).

## Locks

- `acceptance-lock/int-ui-01.4`, one commit on develop `c541943`: `CHOSEN` in `support/int-ui/interviews.ts` leaves out a `.pp-card` inside another `.pp-card` and a `.pp-card--sunken`. The kit draws the panel summary as a sunken card inside the chosen interview's card; without this every older test that reads the chosen interview (`readChosen`, `chosenOf`) would see two cards once a Done interview with votes is chosen (REC-UI-03.2 AC-2.11 on pepla-dev is one). See step 0.
- `acceptance-lock/int-ui-05`, one commit on `acceptance-lock/int-ui-01.4`.

The builder merges `int-ui-05` (which holds `int-ui-01.4`).

## How the tests run

Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 08:00 UTC (10:00 in Johannesburg). `summary.ts` adds one route on the browser context, after every older fake of the tab, for `GET /v1/candidates/{id}/scores`. It answers as `sheet()` at `c541943` does for the callers the tests use (401, 403 unknown caller, 403 Recruitment off, 404 another company or not a Recruiter, 200 Recruiter). A 200 carries every field the server sends (interview type, time, pending count, consensus, the final score, votes with voter ids, comments, `entered_by`, the legacy vote shape) with marker values, so a page that draws any of them fails. Every 200, 403 and 404 is checked against `api/openapi.yaml`.

AC-10 runs on pepla-dev only (`@pepla-dev`). Its company B half needs `E2E_B_HR_EMAIL`/`E2E_B_HR_PASSWORD` and fails when they are not set.

### The dev seed the builder writes

`dev-ids-05.json` has one candidate for both widths: the page only reads, so one seed serves both runs. New add-only `seed_int_ui05(ddb, tid, panel_subs, hr_sub)` in `scripts/ci/seed-dev.py`, called after `seed_rec_ui_03_2` with two panel logins (`employee_sub` and the IT login's sub) and the HR login. Every run:

- delete every row under `CANDIDATE#<candidate>` (VOTE# and VOTED# too);
- put the `SAGA` row for company A as `seed_int_ui01` does (names from the file, no `role_id`, `hiringManagerId` `OTHER_HIRING_MANAGER`, stage `INTERVIEW`, `seed` `pepla-demo`);
- put two COMPLETED interviews: `done` (TECHNICAL, 3 days before the run, `votesSubmitted` 2) and `empty` (PHONE_SCREEN, 5 days before, marked done by HR, no votes), both with the four REC-04 criteria in `criteria_snapshot`;
- put two `VOTE#<voter>#<done>` rows with `scale {min 1, max 5}` (the server counts only those) and their `VOTED#` rows: YES all 4, NO 2,3,3,3. The server then sends overall 3.4, criteria 3.0, 3.5, 3.5, 3.5, "1 Yes · 1 No", split true.

The throwaway build's version is in the kit (`int-ui-05-throwaway-build-NOT-FOR-MERGE.patch`).

## Decisions where the spec is silent (test writer, 27 Nov; the builder follows these)

- **T-P1** The block is a sunken card inside the chosen interview's card. Built from design system components (DECISIONS.md D13, which replaces spec D3): `<pp-card appearance="sunken">` and the Angular `pp-scorecard` once the design system lets it draw a row as "{score} out of 5" with no word. Child lock int-ui-01.4 lets the shared helper treat any card inside the chosen card, and any sunken card, as part of it. "Split panel" sits in the heading row, outside `pp-scorecard` (inside it the lozenge would come after the decisions line and AC-3's reading order fails).
- **T-P2** The block is one element with role `group` named "Panel scores" (by `aria-labelledby` on its `h3`). The only heading in it is that `h3`; the card title stays `h2`.
- **T-P3** Loading is a `role="status"` region inside the chosen card whose text is "Loading the panel scores" (the design system skeleton group carries it).
- **T-P4** The failure is the design system `pp-section-message` tone danger inside the chosen card, text "Panel scores could not be loaded.", holding a "Try again" button.
- **T-P5** The criteria are a list named "Scores by criterion"; each row reads "{label} {n} out of 5". The block's read text, words joined by single spaces, is: "Panel scores", "Split panel" when shown, the overall, "out of 5", the decisions line when there is one, then the rows. Hidden parts (`aria-hidden`) are not read.
- **T-P6** The bar is `.pp-scorecard__fill` and its width comes only from `--_pct` (S-1). No other inline style in the block.
- **T-P7** "Split panel" is a `pp-lozenge` with the warning tone and an icon.
- **T-P8** "Under the card title, above the status lozenge, the details and the person lines" is read from the drawn boxes (top edges), at both widths.
- **T-P9** AC-5 capture order (spec M-1): the test holds the next interviews read, presses Submit, waits for the vote's 201, sets the interview COMPLETED with every `can` false, then releases the read. Exactly one more scores read follows.
- **T-P10** The sign-out case presses sign-out with `dispatchEvent` (as INT-UI-02 T-S8) and watches the page with a MutationObserver from the press on.
- **T-P11** No acceptance README row (as INT-UI-01 T-I13).

## Gap noted (not tested)

AC-2's "no new rated vote gives no decisions line" cannot happen with the server's shapes: `vote_count` is at least 1 only when there are new votes, and a new vote always has a rating, and rule 1 hides the block when `vote_count` is 0. So the "no line" case is not tested; the page may still keep the guard.

## Step 0

1. Older locked tests on the throwaway build (int-ui-01, 02, 03, rec-ui-02, -record, -notes, -add, rec-ui-03, rec-ui-03.2-capture, ang-01): see the tests-for-review file for the run.
2. REC-UI-03.2 AC-2.11 (dev): after the capture makes the interview Done it reads the chosen card's people through `readChosen`. With the block drawn, `CHOSEN` matched two cards. Child lock int-ui-01.4 fixes the helper; `rec-ui-03.2-capture.spec.ts` itself does not change, so no `rec-ui-03.2.1` is needed.
3. INT-UI-01 AC-10's seeded vote is legacy (vote_count 0, no block) and INT-UI-03 AC-10 has no votes, so their dev checks do not change.
