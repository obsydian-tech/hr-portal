# INT-UI-06

Card: INT-UI-06 · Decide. Jira NH-275 (epic NH-223, amber). A Recruiter on a candidate at the Interview stage presses "Decide", reads the panel scores in the Decide drawer (a full page on a phone), and picks Move to Offer, Book another interview or Not hired. Each choice goes on to the step that already exists: the Move dialog (with Offer chosen), the Schedule drawer, or the Not hired dialog. The page sends nothing new: the move is today's `PUT /v1/candidates/{id}/stage`. No `lambda/`, `infra/`, CORS or design system change.

Test files: new `int-ui-06.spec.ts`, `support/int-ui/decide.ts` (the words and the page helpers) and `support/int-ui/dev-ids-06.json` (shared with the dev seed `seed_int_ui06`). It reuses `support/int-ui/summary.ts`, `support/int-ui/interviews.ts`, `support/int-ui/schedule.ts`, `support/int-ui/close.ts`, `support/rec-ui-03/capture.ts`, `support/rec-ui/harness.ts`, `support/rec-ui-02/record.ts`, `support/rec-ui-02/notes.ts` and `support/ang-01/gallery.ts` unchanged. No locked file changes, so there is no child lock.

Spec: `specs/interview-journey/cards/INT-UI-06.md`, section "Changes after spec check round 1 (28 Nov)" (it wins over the text above it): rules 1 to 11, R-1 to R-4, O-1 to O-9, AC-1 to AC-11, decisions D1 to D10. Checks: `INT-UI-06-spec-check.md`, `INT-UI-06-spec-check-round-2.md` (T-1 to T-3). App and server: develop `199e08f`.

## Lock

- `acceptance-lock/int-ui-06`, one commit on develop. No other lock.

## How the tests run

Every test runs at 1280 and 390 wide unless it says why not. Page time is the harness's (19 Nov 2026 10:00 in Johannesburg). No new fake: the record fake already sends `can_decide`, `can_move` and `next_step.blocker`, and the harness answers the move as `moveCandidate` does (400 `REASON_REQUIRED`, 409 `INTERVIEWS_INCOMPLETE` from the candidate's interview counts, one answer per request key). `refuse()` gives 403, 409 `STAGE_CHANGED` and 500. The interviews, scores, Schedule and Not hired fakes are INT-UI-01/02/05's and REC-UI-01's. Nothing calls Bedrock or any paid AI.

Planned greens before the build (named "green before the build by design" in the test title): AC-1 "No Decide for can_decide false ...", AC-7 "No Decide control under the summary ...", the no-request half of AC-8. They catch a build that shows Decide where it must not.

AC-11 runs on pepla-dev only (`@pepla-dev`), with no retry (O-8). Its company B half needs `E2E_B_HR_EMAIL`/`E2E_B_HR_PASSWORD` and fails when they are not set.

### The dev seed the builder writes

`dev-ids-06.json` is keyed by Playwright project (`desktop-1280`, `phone-390`): the dev step runs each width once and the seed once, and the Ready test moves its candidate to Offer, so each width needs its own pair. New add-only `seed_int_ui06(ddb, tid, panel_subs, hr_sub)` in `scripts/ci/seed-dev.py`, called after `seed_int_ui05` with the same logins. Every run:

- read company A's ACTIVE `INTERVIEW_TYPES` (`talent-flow-config`, index `GSI1-active-configs`, `TENANT#<tid>#ACTIVE` / `CONFIG#INTERVIEW_TYPES`) and take the first of JUNIOR, MID, SENIOR whose `requiredByLevel` list is not empty; print the level and the types (they are the proof for step 0 line 5). It never writes a setting;
- for each width and each of Ready and Missing: delete every row under `CANDIDATE#<candidate>`;
- put the `SAGA` row as `seed_int_ui05` does, with `positionLevel` the level found, no `role_id` and no `settingVersions`;
- Ready: one COMPLETED interview per required type, each with its `IVTYPE#` row; the last one carries two new-format votes (`VOTE#` and `VOTED#` rows, scale 1 to 5);
- Missing: every required type but the last COMPLETED. It is written only when the level has a required type (with one required type it has no Done interview, which AC-11 does not need).

The throwaway build's version is in the kit (see the tests-for-review file).

## Decisions where the spec is silent (test writer, 28 Nov; the builder follows these)

- **T-D1** The phone Decide page is `main` holding a level 1 heading "Decide on {candidate}" (`pp-page-header`). It replaces the record's content as the feedback sheet does: no person header and no interview list behind it.
- **T-D2** The choices are the radios of the one `radiogroup` whose accessible name is the title (O-7). `pp-radio-group` has no input for a name today; the throwaway sets `aria-labelledby` on its group after drawing. The builder may do the same or add a small design system input; the test checks the name only.
- **T-D3** The confirm is the one button in Decide whose name is "Decide" or one of the three choices. Desktop: in the drawer footer after Cancel. Phone: the last two controls on the page are the confirm, then Cancel (kit order).
- **T-D4** A choice's description is read from its `aria-describedby` target or the design system's `.pp-radio__description`; its label is the label text without that part.
- **T-D5** The link under the summary is a `button` or link named "Decide" inside `main` and outside the person header; it sits inside the chosen interview's card, after the "Panel scores" group and outside it, and is not `.pp-button--primary`.
- **T-D6** "Not drawn while closed": no element with role dialog named "Decide on ..." anywhere, no level 1 "Decide on ..." in `main`, no `pp-drawer` in `main`, and at most one "Panel scores" group on the page.
- **T-D7** Focus after Cancel, Escape or Close is on the header's Decide button.
- **T-D8** The flag check (AC-5) is a file check, as INT-UI-02's: the key of "Book another interview" in `interview-words.ts`, and a file that uses that key and builds Decide imports `SCHEDULE_READY` from `hire-flags.ts` and uses it. The `HIRE_ACCESS` part of rule 5 cannot be tested: everyone who reaches the page holds it.
- **T-D9** The words check (AC-9) needs "Decide", "Move to Offer", "Book another interview" and "Decide on {candidate}" (or "Decide on") as plain strings inside `INTERVIEW_WORDS`. The throwaway uses a new `decide` group.
- **T-D10** O-3: opened from the Overview with the interviews read held, "Book another interview" is shown and disabled; it becomes pickable when the read answers; it is not shown when the read failed.
- **T-D11** AC-6's 409 `INTERVIEWS_INCOMPLETE` goes through the harness's real gate: the record is sent with no blocker while the candidate still has interviews missing, as when an interview was reopened after the record was read.
- **T-D12** O-4: `verify:design` refused the overall-only scorecard markup on the throwaway build (7 problems, "class pp-scorecard belongs to a component"), so the phone draws the full `pp-scorecard` with its criteria list. The tests read the overall from `.pp-scorecard__overall` and allow the criteria rows, so they pass either way. The spec checker is told.
- **T-D13** No acceptance README row (as INT-UI-01 T-I13).

## Step 0

1. **The record fake** sends `can_decide`, `can_move` and `next_step.blocker` per candidate (`support/rec-ui-02/record.ts`). Yes: no new fake.
2. **The move fake** answers 200, 400, 403, 409 `INTERVIEWS_INCOMPLETE`, 409 `STAGE_CHANGED` and 500, and can hold an answer (`support/rec-ui/harness.ts`). Yes.
3. **A dev record answer read as the test login**: not possible from the cloud thread (the test login's password is only in AWS Secrets Manager, which the look-only login cannot read). Not done. AC-11 reads the record itself on the dev run.
4. **One words list**: the test words are in `DW` in `support/int-ui/decide.ts`; a later child lock changes one place.
5. **Required interview types on dev (R-3)**: NOT read from the table. The cloud login is refused on table data (`dynamodb:Scan`/`Query` AccessDenied on `talent-flow-config`). Indirect evidence that MID and SENIOR have required types today:
   - the dev workflow step "Give the first company the Recruitment Standard pack" runs `seed-recruitment-pack.mjs --apply` on every run; it adds only what is missing, and its pack is the defaults (MID: Phone screen, Technical; SENIOR: Phone screen, Technical, Behavioral);
   - locked `rec-ui-02-record.spec.ts` AC-R15 on dev expects the MID seed candidate blocked, and REC-12 AC-9 on dev expects a SENIOR move to Offer refused with 409; both passed in dev run 46088639348 (develop `199e08f`, "Run new app acceptance tests").
   So the Missing half stays. The exact types are unproven; the seed reads them itself and prints them, and the first dev run after merge is the proof. **Flag for the lock check:** if that print says "none", Missing fails on dev (rule 8); the seed prints a warning and the coordinator drops the Missing test with a child lock.
6. **A move to Offer on dev sends nothing (R-4)**: PASS, from logs. The look-only login cannot read `INTELLIGENCE_RULES` (table data refused), so the proof is the `evaluateIntelligenceRules` log for the last 30 days (CloudWatch Logs Insights, 28 Nov):
   - company A (`ten_hyyt49drh9efwb79h2a0cjee0s`): 6,458 "Config loaded" and 6,458 "No rules configured for tenant — skipping"; zero "Loaded rules", "Rule matched" or "Processing action" lines;
   - company B: 96 "Module off, skipped"; company C: "No rules configured";
   - the only stream readers of `talent-flow-state` are `trackUserActions` (writes the actions table only) and `evaluateIntelligenceRules`; no `.tf` file names `CandidateMoved`.
   So a move to Offer by the dev test today reaches no queue and no person. This holds only while company A has no rules; if someone adds rules on dev it must be checked again.

## Gaps noted (not tested)

- Rule 5's `HIRE_ACCESS` condition (T-D8).
- The exact required types on dev (step 0 line 5): proven only by the first dev run.
- Rule 10's "reads no scores" for company B is tested on the fakes (AC-8), not on dev.

## Runs (28 Nov, in the cloud thread)

- **On develop `199e08f`** (a clean copy plus the three new test files): 54 failed, 10 passed, 10 skipped (AC-11 off dev, and tests for the other width). The 10 passes: the six planned greens, plus "While Decide is closed ..." (AC-2) and "The header's own Move keeps today's answers" (AC-6) at both widths, which check today's behaviour on purpose and are covered by faults F12 and F31. That run used the first version of `decideOf`, which had a phone bug (fixed below). On develop the phone tests fail earlier, at the missing Decide button, so the result stands.
- **On the throwaway build** (kit `onboarding-cards/int-ui-06/int-ui-06-throwaway-build-NOT-FOR-MERGE.patch`, a development build served as static files): 64 passed, 10 skipped, twice in a row. The first try found a test bug: on the phone, `decideOf` filtered `main` by a locator that itself started at `main`. It now uses a page-level heading locator.
- **Planted faults**: 41 faults (kit `faults/faults.py`, results `faults/results.tsv`). Each is one change to the throwaway that breaks one rule, built on its own. All 41 are caught: each turns at least one of its named tests red. F26 and F39 are file checks, so they ran with the source itself patched. Notes:
  - F08 (focus not given back) is caught on the phone only. On desktop the design system's drawer already returns focus to whatever opened it.
  - F32 (danger stays on the next Decide) is caught at one width only. On the phone the Decide page replaces the record, so the danger message is out of sight anyway.
- **Older suites on the throwaway build**: 50 spec files that open the candidate record or read `interview-words.ts`, `interviews-tab.ts`, `candidate-record.page.ts`, `hire-flags.ts` or `scripts/ci/seed-dev.py`. Result: 1,797 passed, 0 failed, 585 skipped (dev-only and other-width tests). `mod-01` runs `seed-dev.py` against its fake AWS with the new `seed_int_ui06` in it, and passes.
- **PR 568** (NH-292): it adds `feedbackLine` after the words table, a one-line change in `interviews-tab.ts` that these tests do not read, and a new seed elsewhere in `seed-dev.py`. Nothing these tests rely on changes. The builder merges around it.
- **Lock check round 1 (28 Nov)**: two fixes folded into this one commit, which is now on develop `4ac3b23` (after PR 568). R-1: a new desktop test "AC-3 (standing line 4)" and a `seenWhole` check in the AC-10 loop. They check that the title, each choice, the confirm and Cancel are whole, on screen and not covered, and that the desktop footer reads Cancel then the confirm. R-2: "The header's own Move keeps today's answers" now runs twice, on a fresh record and after Decide was opened and cancelled. The spec now has 39 tests, 78 runs across the two widths.
