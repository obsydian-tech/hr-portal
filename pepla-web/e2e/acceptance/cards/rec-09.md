# REC-09 · Rules reach real people, reminders and drafts (NH-243, amber)

Spec: `/mnt/project-files/onboarding-cards/specs/REC-09.md`, patched 28 Nov (RULE-DROP-001 is gone; RULE-QUIET-001 and
RULE-QUIETSTRONG-001 come in REC-17, NH-307).
Tests: `rec-09.spec.ts`, support in `support/rec-09/` (nothing in any other support folder is changed). The seed is `seed_rec09` in
`scripts/ci/seed-dev.py`, its ids `support/rec-09/dev-ids.json`.
Lock: `acceptance-lock/rec-09`. Child lock for the older suites a new role and new routes move: `acceptance-lock/rec-09.1`.

Run (no backend, about 40 seconds): from `pepla-web`,
`npx playwright test -c e2e/acceptance/playwright.config.ts rec-09 --project desktop-1280`

## Pinned by the test writer where the spec is silent

Written out at the top of `rec-09.spec.ts` as D-T-9.1 to D-T-9.8: the nine rule titles, the shape of a flag row, the shape of the event
row of rule 5, the tile's `why`, where a missed interview is kept, the queued reminder message, the draft rows and routes, and the
drafts Lambda's error codes.

## Open points for the business analyst (not tested, nothing pinned)

- A guest's link cannot be re-sent: REC-07 keeps only a hash of it. So a guest is never emailed a reminder; the person who owes feedback
  is flagged to HR through RULE-FEEDBACK-001 instead.
- `score_under_review_level` does not feed RULE-STRONGNO-001; only `strong_no_count` does.
- The reminder queue record cannot be read through the API on dev, so the dev check reads the flag, not the email.
- There is no hiring-manager login in the dev secrets (only the HR, HR-B and admin logins), so the hiring-manager part of AC-10 is
  covered by the no-backend run only.
- Old HR group names are not recipients. Only `hr_staff` with `perm-recruitment`.
- Dates in reminders and drafts read like "22 Nov 2026", in South African time.

## For the builder

- New role for the drafts Lambda: its KMS decrypt goes into `infra/kms.tf` `dynamodb_read_role_arns` in the next merge (as REC-02 did).
- The older exact-grant and route suites move when a role and four routes are added; see child lock `acceptance-lock/rec-09.1`.
- The engine reads settings with `settingsForRead` (its role has no write on the state table).
