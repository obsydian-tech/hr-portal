# REC-UI-02.4

Card: REC-UI-02 Candidates, step 4: the candidate's Notes tab (history). Jira NH-280 (part "Notes tab (AC-9)", epic NH-223, amber). Reads a candidate's history and writes nothing; no new route, no `lambda/` or `infra/` change.

Test files: new `rec-ui-02-notes.spec.ts` and `support/rec-ui-02/notes.ts`; changed lines in `rec-ui-02-record.spec.ts` (AC-R8 only: the tab strip is now Overview and Notes, and its text check no longer forbids "Notes"; the Overview still has no `pp-timeline` and none of the other waiting parts). It reuses `support/rec-ui/harness.ts` (REC-UI-01) and `support/rec-ui-02/record.ts` (rec-ui-02.3) unchanged.

Spec: `onboarding-cards/specs/REC-UI-02-notes-tab.md` (R-1 to R-5, words W-N1 to W-N7, AC-N1 to AC-N11), its check `REC-UI-02-notes-tab-spec-check.md` (rounds 1 and 2; G-1 and G-2 applied), decisions D-RUI-02.22 to .30 in `onboarding-cards/DECISIONS.md`. Backend: `GET /v1/candidates/{id}/events` on develop `31d048f` (REC-15 step D, `api/openapi.yaml` `CandidateEvents`).

Locks: acceptance-lock/rec-ui-02.4, one squashed commit on acceptance-lock/rec-ui-02.3. INT-UI-01 (NH-270) builds its own child lock of `rec-ui-02-record.spec.ts` on this one.

## How the tests run

Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 08:00 UTC (10:00 in Johannesburg). AC-N2 and AC-N8a run the browser in UTC, so a page that counts days or times in the browser's own zone fails; every other test keeps the config's Johannesburg zone.

`notes.ts` adds a fake of `GET /v1/candidates/{id}/events` on the same browser context as the harness and the record fake. It mirrors `lambda/getCandidateEvents/index.js` at `31d048f`: no or a bad token is 401; not a Recruiter, or Recruitment off for the company, is 403; another company's candidate, or none, is 404 `{ error: 'Not found' }` (`candidateIsOurs`); a `nextToken` not sent back exactly is 400 `{ message: 'Invalid nextToken' }`; rows come oldest first; stage-history rows come on page one only. Its tokens hold `+`, `/` and `=`. Every row is built over the file's `CandidateEvents` property list, and every answer is checked against the file; a test ends red when `contractErrors` is not empty. Every row carries marker values in `by`, `actor`, `by_kind`, `tenant_id`, `eventId`, `reason` and `detail` (a value and a key). A test can make the fake refuse a page, hold an answer, drop the connection, or keep sending `nextToken`.

When the page saves a Move or Not hired through the harness, the fake adds the rows the server writes for it (a stage-history row and its `talent-flow.workflow` copy), so a history read after the save has the new line.

AC-N11 runs on pepla-dev only (`@pepla-dev`). It opens the REC-07 seeded candidate (`support/rec-07/dev-ids.json`) as `E2E_HR_*` and looks for the one line `seed_rec07` writes ("... moved Rec to Interview"), not an exact list. No seed change. Its company B half needs `E2E_B_HR_EMAIL`/`E2E_B_HR_PASSWORD`; until the company B dev test fix merges it skips, and a skip is not a pass.

## Decisions where the spec is silent (test writer, 26 Nov; the builder follows these)

- T-N1: the region the Notes tab labels is any element in `main` whose `aria-labelledby` holds the Notes tab's `id` (pp-tabs gives each tab one). The history, its loading look, the empty line and the failure line sit inside it.
- T-N2: the added line (W-N5) and the stage list line (W-N3) have no name in their words. The tests give those rows no `by_name`, so whether a name would show on them is not judged here.
- T-N3: older days write the time as the kit does, with two-digit hours ("17 Nov 2026, 15:05"); the tests only use afternoon and late-morning times, so "08:30" against "8:30" is not judged. Today's time under a minute is "1 min ago" (n at least 1); the tests do not judge it.
- T-N4: a row with no `at` is the last line of the timeline, with no time words, no `datetime` and no `title`; no day heading is added for it.
- T-N5: the failure line and its "Try again" sit inside the Notes region; "Try again" reads again from page one (no `nextToken`).
- T-N7: a line with no name has the timeline's icon marker (`.pp-timeline__icon`); the tests do not judge which icon. Note for the builder: `circle-dot`, pp-timeline's default, is not in the app's icon registry at 31d048f (`ds/core/icon.registry.ts`), and an unknown icon stops the page drawing the rest of the history. Pass a registered icon or add the icon through the design system; the spec's "plain circle-dot icon" cannot be drawn as the app stands.
- T-N6: the spec's "one acceptance README row" is left out: the acceptance README says a card never edits it. This file is the card's note.

## What these tests must catch (the bar, LOCK-CHECK-STOPPING-RULE)

See `onboarding-cards/specs/REC-UI-02-notes-tests-for-review.md`.
