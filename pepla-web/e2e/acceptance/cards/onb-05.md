# ONB-05

Card: ONB-05 Privacy notice and consent (NH-174)

Test files: `onb-05.spec.ts`, `support/onb-05/`, and changed tests in `onb-17.spec.ts` (ONB-17 AC-4, AC-7, AC-8,
AC-9, AC-10) and `onb-23.spec.ts` (ONB-23 AC-1, AC-2, AC-5, AC-6, AC-7), with an additive change to
`support/fixtures.ts`

Spec: [NH-174](https://obsydian.atlassian.net/browse/NH-174)

Locks: acceptance-lock/onb-05

After setting a password or signing in, a new employee lands on `/start`: their own frame (one sidebar item,
Today; Sign out in the "Your account" menu), a two-step tracker, and the declaration and consent form. Nothing
about documents opens before they tick and accept. The server stores the acceptance on its own, with the time,
the notice version and the SHA-256 of the text served. A new notice version asks again.

Screen tests (AC-1 to AC-4, AC-6 to AC-9) run at 1280 and 390 wide with no backend; AC-10, the phone criterion,
at 390 only. `support/onb-05/me-fake.ts` answers `GET <employeesApiUrl>/v1/me` and
`POST <employeesApiUrl>/v1/me/consent` exactly as the spec fixes them, and records every call, body, header and
preflight; its CORS allows only `authorization` and `content-type`, as the real API does.

Lambda tests (AC-1, AC-3, AC-4, AC-5) run the real `lambda/getMyStart`, `lambda/recordConsent` and
`lambda/shared/consent.mjs` `hasCurrentConsent` against `support/onb-05/fake-aws` (ONB-03's DynamoDB fake with
the `employee_consents` table, a fixed clock and every log line recorded), once, in `desktop-1280`. They read
the consent table's name from `CONSENTS_TABLE`, `CONSENT_TABLE` or `EMPLOYEE_CONSENTS_TABLE` (all set to
`employee_consents`) and the company from `COMPANY_NAME`.

The notice's words are `support/onb-05/notice.ts`: version `2026-11-1` from the spec's appendix with the kit's
wording in sections 1 and 5 ("runs the service", "keep the service running", kit PR #29). AC-4 pins its SHA-256
over a fixed form (title, intro, terms as icon, term, text; full as heading, text; `{company}` not filled in).
The declaration and notice name no service provider (Iggie, 16 Nov: the notice is a draft, polished before
go-live). Polishing it means adding a new version to `NOTICES` and making it `CURRENT_NOTICE_VERSION`: the Lambda
tests follow the current version, and only `2026-11-1` is pinned, so a released version can't be edited in place.
`notice_sha256` in a consent row is the SHA-256 (hex or base64) of the `notice` object GET /v1/me serves, as
JSON, with or without its `version`.

AC-11 runs on pepla-dev (desktop only, once) and is red until this card is merged and deployed: the seed
removes the employee test login's consent rows before each run. AC-12 reads files as text and runs
`scripts/verify-design.mjs`, once.

## Changed tests of other cards

The `/start` holding page went away, so three things the ONB-17 and ONB-23 tests checked there changed. Nothing
else in those tests changed.

- The line "Your password is set. Your onboarding steps will show here." is now the heading
  "Declaration and consent" (onb-17 AC-4, AC-10; onb-23 AC-1).
- The "Sign out" button on `/start` is now "Sign out" in the "Your account" menu, as for HR (onb-17 AC-7, AC-8,
  AC-9; onb-23 AC-2, AC-5, AC-6, AC-7). The phone checks look for the "Your account" button and
  "Accept and continue" instead of the old button.
- "No call to any API of ours" on `/start` is now "no call but GET /v1/me" (onb-17 AC-7; onb-23 AC-1, AC-2).

The heading "Welcome, <given name>", the route, the guard and the title stay.

## Shared file changed with this card

`support/fixtures.ts` gains one automatic fixture, `me`: the `/v1/me` fake, on in every no-backend test, so any
card whose test lands an employee on `/start` finds the page's call answered. It adds a route only for
`/v1/me` and `/v1/me/consent`, which no earlier card answers, so nothing the earlier cards rely on changes.
