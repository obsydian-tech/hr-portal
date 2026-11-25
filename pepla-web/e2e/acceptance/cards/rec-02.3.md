# REC-02.3

Card: REC-02.3 The pepla-dev check adds its candidates in the new format (test-only, follows REC-15 step B, NH-266, PR 506)

Test file: `rec-02.spec.ts`, AC-12 (@pepla-dev, desktop only), the `make` helper and a tidy-up at the end. No other line changes.

Locks: acceptance-lock/rec-02.4, on develop 8283605 (acceptance-lock/rec-02.3 at bceb8ff is the same change on the older develop da75605, before rec-05.1 merged; not used).

Since PR 506 a new candidate is added to an open role: `POST /v1/candidates` takes only `first_name`, `last_name`, `email`, `role_id`, `phone`, `source` and `idempotencyKey` (or the Idempotency-Key header), and the title, level and hiring manager come from the role. AC-12 still sent the old fields (`firstName`, `positionTitle`, `positionLevel`, `hiringManagerId`), so on dev it got 400 INVALID_FIELD (field firstName) and went red.

AC-12 needs one MID and one JUNIOR candidate whose hiring manager is the manager login. So `make(level)` now first opens a role of that level with the manager login as hiring manager (the same call rec-04.spec.ts AC-14 makes, company A's seeded department from `support/ten-04/dev-ids.json`), then adds the candidate to it in the new format. At the end (in `finally`) any of its candidates still open is recorded Not hired and its roles are closed, so dev is left as it was. Every assertion of AC-12 is unchanged.

Proof (25 Nov, against the real `lambda/createCandidate` on develop, through the REC-15 world; `onboarding-cards/rec-02.3/`):
- the old body: 400 INVALID_FIELD, field firstName (why dev is red today);
- the new body exactly as `make` sends it: 201 with a CAND- id, the level taken from the role;
- planted faults: the new body plus `positionTitle` gives 400 INVALID_FIELD; the new body with no key gives 400 IDEMPOTENCY_KEY_REQUIRED. Either would turn AC-12 red at "HR adds a ... candidate in the new format".
AC-12 itself only runs on pepla-dev, so it is judged after merge, on the next dev run.

Other frozen tests that post a new candidate: rec-03.spec.ts and rec-12.spec.ts already send the new format. The company walk (`support/ten-04/rows.ts`, row `POST /v1/candidates`) still sends the old fields; it does not go red (a create row only fails on a leak or a changed A row, and a 400 is neither), but since PR 506 that row is refused before any company check, so it no longer tests one. Small follow-up, not in this lock.
