# ONB-21

Card: ONB-21 Reminder email for documents due (NH-180): a daily scheduled Lambda that emails people with documents still to upload

Test files: `onb-21.spec.ts`, `support/onb-21/` (fake AWS, world, words, runner, Terraform helpers, `kms-lists-c859f0f.json`)

Spec: `onboarding-cards/specs/ONB-21.md`, security review `onboarding-cards/specs/ONB-21-security-review.md`

Locks: acceptance-lock/onb-21, acceptance-lock/ops-05.9, acceptance-lock/mod-01.4, acceptance-lock/ten-02.5, acceptance-lock/ten-03.4

No browser. The tests run the real `lambda/sendDocumentReminders/index.mjs` once per fresh Node process against a fake AWS
(DynamoDB and Postmark only; any other AWS client or AI import fails; outbound fetch refused; fixed clock), and read
Terraform as text. They run once at desktop-1280 and skip on dev.

## Choices the tests pin (not in the spec)

- `reminderEmail({ firstName, typeNames, dueIso, loginUrl })` returns `{ subject, html, text }`; `typeNames` are kit names.
- The run's last log line holds the words `sent`, `refused`, `failed`, each followed by its number. A skipped company logs
  `Company skipped` with the company id and the error name only.
- Claim row attributes: pk, tenant_id, employee_id, document_type, due_date, sent_at, expires_at (due + 30 days, one day either way).
- The tenants Scan reads five attributes only, enforced in the role policy with a `ForAllValues` Attributes condition.
- Time left: under 1 s stops the run; 120 s or more is plenty. The exact margin is the builder's.
- An empty `LEGACY_TENANT_ID` is valid (empty after TEN-02 step 2), unlike the other required settings.
- Words W-1 to W-3 live only in `support/onb-21/words.ts`. They are Iggie's to approve before prod.

## Re-locks of four earlier cards (names proposed; the lock check thread picks the free ones)

A correct ONB-21 build turns four locked tests red, so they move in the same lock:
- `ops-05.9`: AC-7 table count 28 to 29 (the reminders table).
- `mod-01.4`: AC-7 lets `lambda/sendDocumentReminders/index.mjs` name `modules` (it reads it, and PutItem-writes only its claim rows); AC-8 skips the new role `send_document_reminders`.
- `ten-02.5`: AC-13 skips the new role (it Scans the tenants table, condition limited to five attributes).
- `ten-03.4`: AC-10 skips the new role. Its policy is pinned in `onb-21.spec.ts` AC-8 instead.
Same pattern TEN-06 used for `user_migration`.

## Re-lock ops-05.9

The reminders table is the 29th table, so OPS-05 AC-7's count moves from 28 to 29 (see `cards/ops-05.md`).

## Judged on pepla-dev, by hand from a Mac thread

The rule exists, is ENABLED and targets the Lambda; the first scheduled run logs its summary with no error and
"sent 0, skipped test N"; the reminders table exists with TTL on.
