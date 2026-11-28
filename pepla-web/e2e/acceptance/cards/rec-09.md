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

## Child lock rec-09.1 (older checks that REC-09's new role, policies and routes move)

`support/rec-09.1/grants.ts` leaves out REC-09's four policies by their exact lines (`support/rec-09/policy-lines.json`: manage_drafts, and
one `_rec09` policy on evaluate_intelligence_rules, monitor_slas and get_intelligence_tiles), and only when a policy of that label holds
exactly those lines. The checks that refuse any new grant leave out exactly these: int-01 AC-16, int-01f AC-8, mod-01 AC-8, rec-01 AC-8,
rec-02 AC-11, rec-04 AC-8, rec-07 AC-9 (its "no new IAM role" line is whole again), rec-15 / 15b / 15c / 15d AC-17, ten-03 AC-10, and
chat-15 AC-12 (the new resources, by exact type and label). rec-01 AC-3 gives its fixture one rule in company A's settings so its tiles exist. ten-03 AC-3: A's tile list is empty in that world (a tile
needs a rule in the company's locked settings), so `mine` is empty there; rec-09 AC-1 and AC-4 judge A's and B's tiles with real settings.
ten-02 AC-12 needs `npm ci` in `lambda/shared` (as the acceptance job does); with it, it passes on develop and on the build.

## For the builder: how the policies must be written
Write each of the four policies in full in Terraform: literal `Statement = [ { Sid, Effect, Action, Resource }, ... ]`, no `locals` and no
`concat`, so the IAM readers of the older locks can read every line. rec-09.spec.ts AC-10 fails a policy the reader cannot read, and any
line that is not in `support/rec-09/policy-lines.json`. The route labels and the permission label that chat-15 AC-12 names are
`manage_drafts_list|patch|send|dismiss` and `manage_drafts_api`.

## Company B in the tests
Company B has rules of its own in the test world (RULE-SLA-001 is LOW and repeats after 6 hours for B; A's is HIGH and 24), and
the tests send each company's calls naming the other company in headers and query. A request key is tied to the company and the person.
