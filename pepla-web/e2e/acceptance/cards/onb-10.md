# ONB-10

Card: ONB-10 Due dates and Overdue (NH-179)

Test files: `onb-10.spec.ts`, `support/onb-10/` (the words, the tests' own calendar, a runner for the shared module, TEN-02's
two-company world with start dates, a reader of the two roles' IAM lines and a baseline of develop 8b6ad7d, a pin of two
Lambdas, an OpenAPI field reader), and two re-locked files of other cards (below): `onb-02.spec.ts` and `onb-05.spec.ts`,
with additive lines in `support/employees-fake.ts` and `support/onb-05/me-fake.ts`.

Spec: [NH-179](https://obsydian.atlassian.net/browse/NH-179)

Locks: acceptance-lock/onb-10, acceptance-lock/onb-02.1, acceptance-lock/onb-05.2 (all three point at the same commit)

Every new employee with a start date has a due date for their documents: 7 days before it. The checklist shows it on each
required document still to give (a chip, and the date under it). HR home shows how many people are overdue (under the
Documents count) and "Overdue by 2 days" under the step of each of them. Overdue means: step Invited or Documents, and a due
date before today (South Africa).

Screen tests (AC-2, AC-3's South Africa tests, AC-4, AC-5, AC-7) run at 1280 and 390 wide with no backend, with the page's clock
stopped (17 Nov 2026 for most; 10 and 11 Nov for the 23:30 and 00:30 tests, each in a browser whose own time zone gives the
other day). AC-6, the phone criterion, runs at 390 only. The Lambda and text tests (AC-1, AC-3's function, AC-9) run once, in
`desktop-1280`: the real `lambda/getEmployees` and `lambda/getMyStart` run against TEN-02's fake AWS (companies A and B, a
caller of each), and `lambda/shared/due-date.mjs` runs in a plain Node process. AC-8 runs on pepla-dev only.

## Words

W-1 to W-4 are PROPOSED in the spec and wait for Iggie. They are in `support/onb-10/words.ts` and nowhere else in the
tests, so a words-only change after his answer touches one file (and the app).

## Choices made while writing the tests (not in the card)

1. `deadlineOf(due, today)`: both `YYYY-MM-DD` strings, `today` being the Johannesburg calendar date. It returns
   `{ state, days, words, dateText }` (`days` may be signed; the tests read its size) and `null` (or `undefined`) for a date
   that is not one. `core/deadline.ts` must load without Angular (no `@angular` import, no import of the `ds` barrel), so the
   test can call it. The South Africa rule is checked on the screens, in browsers whose own time zones give the other day.
2. The date line (W-2) is "Due 24 Nov 2026" in every state, an overdue one included. The chip's `title` holds the full date.
3. The chip is the design system's `<time ppDeadline>`: a `<time datetime="YYYY-MM-DD">` with class `pp-deadline`, the
   warning colour (`pp-lozenge--warning`) for soon (3 days or fewer) and today, the danger colour for overdue, none for later.
   The icons are compared by what they draw: later, soon and today draw one icon; overdue draws another.
4. The employees fake carries `documents_due`, and the `/v1/me` fake `documentsDue`, only when a test gives them. They
   never work them out from the start date, so ONB-02 and ONB-09's people (start dates in Dec 2026) never turn overdue
   when the tests run after 24 Nov 2026.
5. `GET /v1/me` has no 200 schema in `api/openapi.yaml` on develop. The builder adds one holding at least `documentsDue`
   (a string, not required). AC-9 reads it with `support/onb-10/openapi_field.py`.
6. A start date that is not a real date (`2026-02-30`, `soon`) gives no due date and no error, on both Lambdas.
7. `getMyDocuments` is not pinned by hash (ONB-20 changes it): AC-9 runs it and checks that its answer has no due date in
   any name. `reviewDocumentVerification` and `generateDocumentUploadUrl` are pinned by hash on develop 8b6ad7d.
8. The pepla-dev check (AC-8) works the expected overdue count and each person's line from what the table shows (start date,
   step) and today's date in South Africa, so it holds whatever other people are in the table. It also pins Pieter van Wyk
   (starts 10 Nov 2026, overdue since 3 Nov) and Mwila Phiri (starts 1 Jan 2030, never overdue): the seed change.

## Changed tests of other cards (re-locks)

- `onb-02.spec.ts`: the Step cell is "the step word, then an optional second line". `readRows` reads `step` from the first
  line and adds `stepNote`; AC-2 also asserts the note is empty for its people. (The card said AC-2; the pepla-dev branch of
  AC-1 reads the same cell for Pieter, who is seeded overdue, so the one reader is changed.)
- `onb-05.spec.ts`: AC-4's `LISTED` adds `documentsDue`.

Kept green and not changed: `onb-06.spec.ts` and `onb-20.spec.ts` (the `/v1/me` fake answers no date unless a test gives
one, so their rows have no chip), `onb-09.spec.ts`, `onb-12.spec.ts`, `onb-13.spec.ts`, HELP-01 and onb-02 AC-12 (on the
fixed help day, 2 Mar 2026, nobody at Sunbird Bakery is overdue: AC-9 checks it).

## Not frozen here

CORS lines, the number of tables and KMS entries (shared infra files change for other cards too). The card's reviewer
reads the diff for them. The two roles' IAM lines are pinned ("no new line").

## Order

ONB-19 starts from this card's `onb-05.2`, as the spec says. ONB-21 reuses `due-date.mjs` after this card.
