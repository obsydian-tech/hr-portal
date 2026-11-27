# REC-UI-03.4

Card: REC-UI-03 step 4 · The panel member's own feedback page `/hire/feedback/:interviewId`. Jira NH-292 (split from NH-229, red). A panel member opens the address (the link in their invite email, or typed), scores the interview for themselves and submits; they see only their own feedback. The page reads `GET /v1/interviews/{id}` (step 3, PR 560) and votes with `POST /v1/interviews/{id}/votes` (REC-07). No `lambda/`, `infra/`, OpenAPI, CORS or design system change.

Test files: new `rec-ui-03.4-feedback-page.spec.ts`, `support/rec-ui-03/own.ts` (the people, the words, the fake of the read and the vote, a request recorder) and `support/rec-ui-03/dev-ids-own.json` (shared with the dev seed). They reuse `support/rec-ui/harness.ts`, `support/rec-ui-03/capture.ts` (scale words, Decisions, default criteria, slider and radio readers) and `support/rec-ui-03/kit.ts` (the "Guest scoring page" kit screens) as locked. This card's notes live here and its dev ids in their own file, so this lock touches no file another lock owns.

Spec: `specs/REC-UI-03-next-slices.md`, step 4 (rules 1 to 7, AC-4.1 to AC-4.9) and the dev seed table; words D-RUI-03.13, .14, .15, .20 in `DECISIONS.md`. Server: develop `2e90a21` (`lambda/submitVote/read.mjs`, `rec07.mjs` `vote`, `lambda/shared/interview-lifecycle.mjs`).

## Lock

`acceptance-lock/rec-ui-03.4`, one commit on develop `83e606c` (2e90a21 plus one docs-only commit). The builder merges it.

## How the tests run

Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 10:00 in Johannesburg. `own.ts` routes `/v1/interviews/{id}` and `/v1/interviews/{id}/votes` and answers as `read.mjs` and `vote` do at `2e90a21`: the interview is found only among the caller's own company's interviews, and a caller not on its panel gets the same 404 as an unknown id or another company's; the read's `criteria` is the snapshot or, with none, the company's default criteria; `my_vote` is the caller's own vote only; `why` is GIVEN (own vote, whatever the status), else NOT_STARTED, else CLOSED. The last panel person's vote makes the interview COMPLETED. Every answer is checked against `api/openapi.yaml`. The tests sign people in through the fake Cognito and the MOD-01 modules fake (company A has Recruitment; B gets it where a test says so).

AC-4.9 runs on pepla-dev only (`@pepla-dev`); its seed text check runs in the no-backend run.

### The dev seed the builder writes

`dev-ids-own.json` has one entry per Playwright project (`desktop-1280`, `phone-390`), each its own candidate. New add-only `seed_rec_ui_03_4(ddb, tid, panel_sub, hr_sub)` in `scripts/ci/seed-dev.py`, called next to `seed_rec_ui_03_2` with the dev panel login (`employee_sub`) and the HR login. For each entry, every run: delete every row under `CANDIDATE#<candidate>` (the test's own vote leaves `VOTE#` and `VOTED#` rows and closes the interview); put the `SAGA` row for company A (first and last name from the entry, "Demo role"); put `INTERVIEW#<interview>`: `TECHNICAL`, `SCHEDULED`, `scheduledAt` 26 hours before the run, the dev panel login the only entry of `panelMemberIds`, `votesRequired` 1, `votesSubmitted` 0, `PANEL_FEEDBACK_PENDING_COUNT` 1, `criteria_snapshot` (`REC04_CRITERIA`), `tenant_id`; and its `IVTYPE#TECHNICAL` guard row. No guest, nothing for company B. A vote sends no email; the only event is `VotingCompleted`.

## Decisions where the spec is silent (test writer, 27 Nov; the builder follows these)

- **T-P1** A hiring manager who is on a panel is tested as an account holding `employee` and `manager`. An account whose only group is `manager` cannot sign in today (ONB-23, `APP_GROUPS`), so it cannot reach this page or any other; that is unchanged here (REC-UI-01's refused manager stays refused).
- **T-P2** Rule 1 says a signed-out visitor comes back to the address after sign-in, but today the sign-in page follows `returnUrl` only for HR and only to `/hr` pages (`core/auth/auth.errors.ts` `landingFor`, locked by ONB-23 AC-2 and ONB-24 AC-9). These tests take the narrowest change that meets rule 1: after sign-in, **every** login follows a `returnUrl` that is exactly `/hire/feedback/<id>` (one path part, letters, digits, `_` and `-`), and nothing else changes. Any other return address (a longer path, `..` in any spelling, `//`, a backslash, a tab, another site, `javascript:`, other `/hire` pages) lands where it does today (`/start` for an Employee, an `/hr` page for HR). `core/nav.ts` `landingFor`, `HrShell` and the nav registry stay as they are. Logged as D-RUI-03.21 for the coordinator.
- **T-P3** The page's states sit in the guest page's frame (`pp-sign-in-page`): the form, the thank-you line, the W-9b line and the own-feedback line are inside the sign-in card under the title (`pp-sign-in__title`) and the "{role} · {type} interview on {date}" line (`pp-sign-in__company`). "This interview could not be found." and "Interview feedback could not be loaded." (with "Try again") show alone in the card, with nothing of any candidate, as the guest page's refusal and load failure do. While the read is on its way the card shows the design system's skeleton (`pp-skeleton`) and no title or form.
- **T-P4** Buttons: "Submit feedback" (primary) and "Cancel" (default), in the form. Cancel goes back when the person came from another page of the app in this tab; when this page is the first page of the app in the tab (opened from a link), it goes to the person's first page (`core/nav.ts` `landingFor`: `/start` for an Employee, `/hr` for HR), never out of the app.
- **T-P5** After a 201 the form goes and the thank-you line shows; the title and the line may stay. Opening the address again reads again (the own line then shows).
- **T-P6** A refused vote shows its line in one danger `pp-section-message` above the buttons and keeps the scores, Decision and Notes. One `Idempotency-Key` per opening of the page, kept on every retry.
- **T-P7** A 401, 429, 5xx or a dropped connection on the read is a load failure ("Interview feedback could not be loaded." with "Try again"); 404 and 403 are not found; a 200 with `why: 'CLOSED'` is not found; a 200 with an empty `criteria` (and `can.capture_feedback` true) is a load failure.
- **T-P8** "No request but the read and the vote": the modules check the route guard makes before the page opens is the guard's, not the page's, and is left out of the count. Cognito sign-in traffic and Google Fonts are not API calls.
- **T-P9** A second interview opened in the same tab without a page load (a new `:interviewId`) starts empty, and a late answer for the first never shows.

## Builder traps

- The route is its own top-level entry before the `hire` block (`accessGuard({ module: 'recruitment' })`, no role), so it sits outside `HrShell` and `OFFERS_ACCESS`.
- The own-feedback line is the Interviews tab's: move the inline code in `interviews-tab.ts` into one named function both use; the INT-UI-01 tests must stay green.
- The sign-in change is in `auth.errors.ts` `landingFor` and in `sign-in.page.ts` (an Admin-only login takes another path there). Keep the ONB-23 and ONB-24 landing tests green.
- If "Pick acceptance specs" complains about the shard limit, add a timing line for `rec-ui-03.4-feedback-page.spec.ts` to `scripts/ci/acceptance-spec-seconds.json` from the PR's shard log.
