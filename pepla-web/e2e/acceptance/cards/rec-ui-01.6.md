# REC-UI-01.6 · Roles and hiring board leftovers (NH-291, amber)

Spec: `onboarding-cards/specs/REC-UI-01.6.md` (rules 1 to 4, AC-14 to AC-20) over `REC-UI-01.md`. Decisions D-RUI-01.6a to g in
`onboarding-cards/DECISIONS.md`. Review page: `onboarding-cards/specs/REC-UI-01.6-tests-for-review.md`.

Locks: `acceptance-lock/rec-15.1` (on develop), `acceptance-lock/rec-15b.4` (on rec-15.1), `acceptance-lock/rec-ui-01.6` (on rec-15b.4).
The builder merges `acceptance-lock/rec-ui-01.6`, which holds all three.

## Test files

| Lock | Files | ACs |
|---|---|---|
| `rec-15.1` | `rec-15.spec.ts`: `ROW_KEYS` gains `not_hired_pending`; the CandidateList loose-objects list gains `personId`; the AC-16 good row carries `not_hired_pending: null`; four AC-14 tests at the end | AC-14 (list) |
| `rec-15b.4` | `rec-15b.spec.ts`: `ROW_KEYS`; the NewCandidateAnswer loose-objects list gains `personId`; the AC-16 good row; one AC-14 test at the end | AC-14 (add answer) |
| `rec-ui-01.6` | `support/rec-ui/harness.ts` (the fake list sends `not_hired_pending`); `rec-ui-01.spec.ts` (the parked F-RUI-02.1 test runs again, plus one line: exactly one confirm); `rec-ui-01.6.spec.ts`; `support/rec-ui-01.6/dev-ids.json`; this file | AC-15 to AC-19 |

No README row: the acceptance README says a card adds its own `cards/<card>.md` and never edits the README.

## Pinned where the spec is silent

- T-1 After a reload a waiting card's More actions offers exactly "Not hired" then "Cancel"; a card with nothing waiting offers "Not hired" only.
- T-2 A row whose `personId` names nobody the page knows shows no "must confirm" line at all, and still offers Cancel.
- T-3 AC-17's drag is tried by pointer and by touch at 390, on three cards: down, across, down, up. No request that changes anything, no dialog,
  no board change, no save failure line. Move still opens its dialog.
- T-4 AC-18 runs the same steps in the no-backend run against the sign-in fake's hiring manager, so the refusal is proved before merge.
- T-5 AC-18 "no request" is any host whose path holds `/v1/roles` or `/v1/candidates`; "no token" is no storage key starting
  `CognitoIdentityServiceProvider.` and no token anywhere the browser keeps one.
- T-6 AC-19 runs at 1280, once per run: one seeded candidate is enough.
- T-7 The list's text check (AC-14) also refuses the keys `by`, `reason_code`, `reason`, `at`, `note`, `recorded_by`, `decided_by` anywhere in
  the answer, and an HR-kind decision never carries a `personId`, even when one is stored.
- T-8 A stored kind other than exactly `HIRING_MANAGER` or `HR` (a lower-case one too) is sent as kind HR.
- T-9 The AC-16 check for "no empty name, undefined or null" reads the board and dialogs, not the page header (the header's
  "Hiring manager {name}" line is the parent card's).

## Expected red before the build

Once these locks are in, every test that uses the shared fake and loads a candidate list fails on develop with a contract error (the fake
sends `not_hired_pending`, `api/openapi.yaml` has no such field and `CandidateRow` is closed). That is expected (spec M-2). Files that use the
fake: `rec-ui-01`, `rec-ui-02`, `rec-ui-02-add`, `rec-ui-02-notes`, `rec-ui-02-record`, `rec-ui-04`, `rec-ui-04.2`, `rec-14.3`, `int-ui-01`,
`int-ui-02`, `int-ui-03`, and `rec-ui-01.6` itself. In `rec-15` and `rec-15b` every test that checks a row's exact keys is red too.
AC-18's no-backend twin passes on develop (the refusal is already right); its @pepla-dev half and AC-19 are judged after merge.

## For the builder

- `lambda/shared/recruitment-actions/candidate-list.mjs`: the row field only (rule 1, including the S-1 fallbacks).
- `lambda/shared/recruitment-actions/add-candidate.mjs`: `not_hired_pending: null` on the answer row.
- `api/openapi.yaml` (rule 1 shape, inline under `CandidateRow`); regenerate `openapi.d.ts` with `npm run api:types`, never by hand.
- `board.page.ts` and `hire-api.ts`: map the list's field to the board's own `pending` where rows are loaded, with the same name rule the
  pending answer already uses.
- `scripts/ci/seed-dev.py`: `seed_recui01_6`, called from `main()`; ids from `support/rec-ui-01.6/dev-ids.json`. The whole candidate row is
  written with PutItem every run; its `STAGE#` rows are deleted. Company A's settings are not touched.
