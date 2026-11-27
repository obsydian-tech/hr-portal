# INT-UI-02

Card: INT-UI-02 · Schedule and reschedule an interview. Jira NH-271 (epic NH-223, amber). On a candidate's Interviews tab a Recruiter books an interview in a drawer (full page on a phone) and changes a booked one in the same drawer with the type locked. The server checks everything and sends the emails. No `lambda/`, `infra/`, CORS or design system change.

Test files: new `int-ui-02.spec.ts`, `support/int-ui/schedule.ts` (the words, the settings, people, booking and reschedule fakes, the page helpers) and `support/int-ui/dev-ids-02.json` (shared with the dev seed `seed_int_ui02`). It reuses `support/int-ui/interviews.ts`, `support/rec-ui/harness.ts`, `support/rec-ui-02/record.ts` and `support/rec-ui-02/notes.ts` unchanged.

Spec: `specs/interview-journey/cards/INT-UI-02.md`, section "Changes after spec check round 1 (26 Nov)" (it wins over the text above it): M-1 to M-3, S-1 to S-6, final AC-1 to AC-11, decisions INT-UI-02-D1 to D20. Its check: `INT-UI-02-spec-check.md` (round 2, notes L-1 to L-8). Server: develop `3c4d82e` (`lambda/scheduleInterview/int01.mjs`, `request-key.mjs`, `manageTalentFlowConfig`, `getPanelMembers`). Page: PR 539 head `5cf9faf`.

Locks: child lock `acceptance-lock/int-ui-01.1`, one squashed commit on `acceptance-lock/int-ui-01` (bee00e1), changes only `ACTION_WORDS` in `support/int-ui/interviews.ts` ("Schedule an interview" and "Reschedule" leave it; M-1). Then `acceptance-lock/int-ui-02`, one squashed commit on `acceptance-lock/int-ui-01.1`. The builder starts after PR 539 merges and merges both locks.

## How the tests run

Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 08:00 UTC (10:00 in Johannesburg). AC-4 runs the browser in UTC, Pacific/Kiritimati and America/Sao_Paulo, and once at 22:30 UTC on 30 Nov (00:30 SAST on 1 Dec, S-3).

`schedule.ts` adds one route on the browser context, after the interviews fake, for `GET /v1/config` (both types), `GET /v1/panel-members`, `POST /v1/candidates/{id}/interviews` and `PATCH /v1/candidates/{id}/interviews/{interviewId}`. It mirrors the server at `3c4d82e`: the config read answers the active row or `{ configType, version: null, isActive: false, data: {} ... }`; the people read answers `{ members, total, candidateId }` and adds a marker scoring token when asked with `?candidateId=`; book and act follow `int01.mjs` in the server's order with the same 400/409 codes; the request key gives the first answer again for the same key and body, `KEY_REUSED` for another body after a 2xx, and is released by any refusal; another company's candidate is 404 before the key is kept. A booking or reschedule changes what the interviews fake sends next. Booking and reschedule answers are checked against `api/openapi.yaml`, and any request to a route the file does not have fails the test.

AC-11 runs on pepla-dev only (`@pepla-dev`). Its company B half needs `E2E_B_HR_EMAIL`/`E2E_B_HR_PASSWORD` and fails when they are not set.

### The dev seed the builder writes

The dev step runs every `@pepla-dev` test once at 1280 and once at 390, and the seed runs once before both. So `dev-ids-02.json` has one entry per Playwright project (`desktop-1280`, `phone-390`), each its own candidate (T-S14; same fix as INT-UI-03 spec check M-1). New add-only `seed_int_ui02(ddb, tid, panel_sub, hr_sub)` in `scripts/ci/seed-dev.py`, called next to `seed_int_ui01`. For **each** entry, every run:

- delete every row under `CANDIDATE#<candidate>` (`INTERVIEW#`, `IVTYPE#`, `VOTE#`, `SAGA`, the rest), and the `SCORING_LINK#<guest_link_hash>` / `META` row of any interview that has a `guest_link_hash`;
- put the `SAGA` row for company A as `seed_int_ui01` does (`firstName`/`lastName` from the entry, `positionLevel` `MID`, `currentStage` `INTERVIEW`, `tenant_id`, `seed` `pepla-demo`);
- put one `INTERVIEW#<booked.id>` row: `interviewType` `PHONE_SCREEN`, `status` `SCHEDULED`, `scheduledAt` 7 days after the run, `length_minutes` 60, `where` `IN_PERSON`, `place`, `sequence` 1, `panelMemberIds` with one panel login, `criteria_snapshot`, `tenant_id`, `seed` `pepla-demo`;
- put its guard row `IVTYPE#PHONE_SCREEN` with `interviewId`, `v: 1` and `seed` `pepla-demo`. Nothing else, so `TECHNICAL` is free.

Every row the seed writes carries `seed` `pepla-demo` (lock check S-3).

The throwaway build's version is in the kit (`int-ui-02-throwaway-build-NOT-FOR-MERGE.patch`).

## Decisions where the spec is silent (test writer, 26 Nov; the builder follows these)

- **T-S1** Each summary line reads "{field label}: {message}", as Add candidate. The date and time lines use the group label: "Date and time: Choose a date".
- **T-S2** "Date and time" is one element with role `group` named "Date and time" holding the Date and Time fields. The date's messages (W-N4, the picker's own, W-10a) sit under Date; W-N5 sits under Time. The tests read every error line inside the group.
- **T-S3** A select with nothing chosen shows an empty first option with no words (no new words). The tests skip options whose value is empty.
- **T-S4** Design system words AC-9 allows besides the spec's list: the multi-select's "Choose" and "{n} people", the drawer's "Close", the picker's "Choose date", weekday letters and names, ", today", and the required star "*".
- **T-S5** The type field in reschedule is a `readonly` text input labelled "Interview type".
- **T-S6** A booking's `panel` keeps the order the people were chosen where a test fixes it; reschedule bodies are compared with `panel` sorted, since only the set changes there.
- **T-S7** `Iv.panel` person entries carry `person_id` (the read sends it since INT-01); a person not in the people read stays chosen and shows by the name the read gave. The fake accepts such a person on a reschedule when the test lists them in `sched.unlisted` (the server checks only the company).
- **T-S8** Sign-out is pressed with `dispatchEvent`, because the drawer's blanket covers the avatar. The test watches the page from sign-out on with a MutationObserver.
- **T-S9** "No toast" is checked as no `.pp-flag`, `.pp-toast` or `role="status"` with words after a save.
- **T-S10** The child lock edits `ACTION_WORDS` itself (D14); its comment names this card.
- **T-S11** Summary links: the tests click the Interview type and Length links and expect focus on that control.
- **T-S12** In the keyboard test, Tab leaves the people list. The design system list may stay drawn until the drawer closes; the test does not require it to close.
- **T-S13** "Reschedule" shows only on a chosen interview that is `SCHEDULED` and has `can.reschedule` true. A closed interview with every flag true shows nothing (the server never sends that; same rule as INT-UI-03 spec check M-2).
- **T-S14** One dev candidate per test width (above).
- **T-S15** On pepla-dev the booking picks the first person the people list offers, since the dev logins' names are not set by the seed; the test fails if nobody is offered.

## Step 0

1. `GET /v1/panel-members` on dev: not confirmed. The cloud login cannot read Cognito users or table data. AC-11 now fails with a clear message if nobody is offered (T-S15). First dev run after merge shows it.
2. Company A's dev `INTERVIEW_TYPES`: not confirmed for the same reason. With no row the server uses the five defaults, which include `TECHNICAL`. If a company row leaves `TECHNICAL` out, change `freeType` in `dev-ids-02.json` (a child lock).
3. Lock branches grepped before the push (see the tests-for-review file).
