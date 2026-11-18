# REC-01

Card: REC-01 (NH-235) Recruitment role checks: every action says who may do it (epic NH-234, red)

Test files: `rec-01.spec.ts` and `support/rec-01/` (`lambda-harness.ts`, `world.ts`, `callers.ts`, `routes.ts`, `iam.ts`,
`iam-08f2aa0/policies.json`, `fake-aws/`), plus the moved tests of other cards listed at the end (re-locked by rec-01.1).

Spec: `onboarding-cards/specs/REC-01.md` (17 Nov 2026), read with REC-00. Review page: `onboarding-cards/specs/REC-01-tests-for-review.md`.

Locks: rec-01 (the first tests), rec-01.1 (S-1: the TA claim is not HR); the moved hunks of other cards: mod-01.2, ten-03.2, ten-05.2, ten-05.3

Written against develop 08f2aa0 (MOD-01 merged, PR 393).

## How the tests run

AC-1 to AC-8 run once (`desktop-1280`) in the no-backend run. Each call runs the real handler in a fresh Node process against a
fake AWS (`support/rec-01/fake-aws`, MOD-01's copy, no code changed). AC-7 and AC-8 read code and Terraform as text; AC-7 also runs
`node --test recruitment-access.test.mjs` on a copy of `lambda/` and plants faults in the copy. AC-9 runs on pepla-dev only
(`@pepla-dev`). Nothing calls AWS or any AI.

## Decisions the tests make where the card is silent (for the BA to confirm)

- D-REC-1.3 Old TalentFlow HR *group names* (`naleko-talentflow-hr`, `HRDirector`) pass the Recruiter check until TEN-06 moves those
  people. TEN-05's locked table gives them the Recruitment tick and no `hr_staff`; mapping them to `hr_staff` would open Onboarding HR
  routes that BE-17.1 pins shut. The bridge reads TEN-05's table through `grantOfNames`, so the new file names no group.
  **The custom:roles claim "TA" does not count (S-1, 18 Nov).** The old pool's pre-token trigger gives `["TA"]` to everyone who is
  not ADMIN, HM or IT (PanelMember, FinanceLead, ComplianceOfficer, ITSpecialist, no group), so the claim says nothing about HR. The
  new file must not read `custom:roles` at all. AC-1, AC-2 and AC-5 pin it with those callers carrying the claim; a panel member with
  the claim still votes as themself and is not a Recruiter.
- D-REC-1.4 A route that opens one candidate (candidate, history, interviews, offer) answers 404 `{"error":"Not found"}` to everyone who
  is not a Recruiter, that candidate's hiring manager or (not the offer) a panel member of its interviews. That includes Guest, an
  IT-only person and a person with no group (coordinator's call, 18 Nov: not 403). A panel member can have any role, so the row
  is read before the answer.
- D-REC-1.5 Tile acknowledge, snooze and dismiss are Recruiter only. Reading one offer is the Recruiter and the hiring manager
  (salary removed). `GET /v1/config` is Recruiter or Admin.
- D-REC-1.6 `submitVote` by a person needs the person on the interview's panel; `interviewId` in the body and belonging to the
  candidate. The VoteSubmitted event (no sign-in) keeps naming its voter.
- `canDecide` arguments are not in the card: AC-1 checks only that it is exported as a function.

## Builder notes

- New file `lambda/shared/recruitment-access.mjs` (imports `./roles.mjs`; `roles.mjs` is not edited), new
  `lambda/shared/recruitment-access.test.mjs` (the CI list, names every Lambda on the list, fails on a planted folder) and
  `lambda/shared/package.json` `test` runs it. Merge the lock; do not hand-copy test files.
- Update the unit tests that call these handlers as a person: `createCandidate/index.test.js`, `scheduleInterview/index.test.js`,
  `submitVote/index.test.js`, `manageTalentFlowConfig/index.test.js`. They could not be run here (no jest in this container).
- No new IAM (AC-8), except the tenants-table GetItem TEN-03 and MOD-01 already own.
- Dev logins (AC-9): `scripts/ci/load-e2e-logins.py` adds a manager (`E2E_MANAGER_*`) and an HR login without the Recruitment tick
  (`E2E_HR_NOTICK_*`); `seed-dev.py` gives the manager one candidate as `hiringManagerId` and a panel row for the employee login.

## Locked tests of other cards that move (rec-01.1)

A correct build fails three locked tests that pass on develop 08f2aa0. Each is changed in the rec-01.1 commit only as far as REC-01 forces:

1. `mod-01.spec.ts` AC-2: `ROLE_CHECKED` grows by the fifteen Recruitment routes that now have a role answer. `support/mod-01/world.ts`: each
   company's interview has `panelMemberIds` with that company's staff sub, so the vote fixture is a panel member.
2. `support/ten-03/world.ts`: the same `panelMemberIds`. This moves ten-03 Control (the vote route answered 2xx as company staff).
   ten-03 AC-1 and AC-3 do not move.
3. `ten-05.spec.ts` AC-3: the probe `GET /v1/config (no role check today)` becomes Recruiter or Admin (`movedBy: 'REC-01'` in
   `support/ten-05/access.ts`) and is left out of the "never lose what develop gives" check.

`be-17`, `be-19` and the rest of TEN-05, TEN-03 and MOD-01 pass on the throwaway as they are. `ten-02` AC-12 fails in this container
only because `jest` is not installed (it fails the same way without REC-01).
