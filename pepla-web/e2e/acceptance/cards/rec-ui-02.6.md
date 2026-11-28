# REC-UI-02.6

Card: REC-UI-02 Candidates, step 5: the Hired block on the candidate record. Jira NH-280 (part "Hired block (AC-10, F-18)", epic NH-223, amber). Reads `employee_id`, which the record answer already carries; writes nothing; no `lambda/`, `api/` or `infra/` change.

Test files: new `rec-ui-02-hired.spec.ts`, `support/rec-ui-02/hired.ts` and `support/rec-ui-02/hired-dev-ids.json`; changed lines in `rec-ui-02-record.spec.ts` (AC-R8: the "no hired block" text check now holds for the rows that are not Hired; AC-R9: on the Hired row the `employee_id` marker is allowed in exactly one place, the `href` of "Open in Onboarding"). It reuses `support/rec-ui/harness.ts` (REC-UI-01) and `support/rec-ui-02/record.ts` (rec-ui-02.3) unchanged.

Spec: `onboarding-cards/specs/REC-UI-02-later-steps.md` section 2 (rules 1 to 5, AC-H1 to AC-H9), its checks `REC-UI-02-later-steps-spec-check-r1.md` and `-r2.md`, decision D-RUI-02.31 in `onboarding-cards/DECISIONS.md`. Kit: design system `6f59033`, screens `Candidate: hired` and `Candidate: hired (phone)`.

Locks: acceptance-lock/rec-ui-02.6, one squashed commit on develop `4ac3b23`. Steps 6 and 7 of NH-280 change the same record file and come after this one, one at a time.

## How the tests run

Every test runs at 1280 and 390 wide unless it says why not. Page time is the harness clock (19 Nov 2026 10:00 in Johannesburg). `hired.ts` wraps the record fake's answer for one test: it can give one candidate another `employee_id`, leave the key out, or add `legacy_hired`, as `lambda/getCandidate/index.js:177-179` does. The answer is still checked against `api/openapi.yaml` before it is sent. Every other candidate keeps the record fake's marker `MARK-employee-id`.

AC-H9 runs on pepla-dev only (`@pepla-dev`). It opens the hired candidate of its own width (`support/rec-ui-02/hired-dev-ids.json`) as `E2E_HR_*`, sees the block, clicks "Open in Onboarding" and lands on `/hr/employees/{id}`, whose tab title carries the employee's last name. The company B half reads `E2E_B_HR_EMAIL` and `E2E_B_HR_PASSWORD` (set since `3afa2d9`); a skip is not a pass.

## For the builder

1. Draw the block with the synced design system parts only: `<pp-section-message tone="success" heading="Employee record created">` with the one line as its body, and `<pp-section-message-actions>` holding `<a ppButton size="small" icon="arrow-right" [routerLink]="['/hr/employees', id]">Open in Onboarding</a>`. `routerLink` with an array encodes the id; an `href` built by hand from the raw id fails AC-H3.
2. Put it first in the Overview's left column, before "Next step" and "Candidate details". Overview only.
3. Read the Onboarding module from `ModulesService.modules()` as a signal, so a later failed modules read (which empties it) takes the block away while the record stays open (AC-H2). Do not read `GET /v1/company/modules` yourself.
4. Keep `employee_id` out of any text, `title`, `data-*` or `aria-*`. Its only place is the link's `href`.
5. The line is "Onboarding opened for {first} {last}." with each name trimmed and one space between; leave the line out when both are empty. Do not add "{HR name} notified." or "Laptop and access now sit with {first name} in Onboarding." (D-RUI-02.31).
6. Add `seed_rec_ui_02_6` to `scripts/ci/seed-dev.py` (one hired candidate and its employee per width, company A, ids from `hired-dev-ids.json`); the test writer's version is in `onboarding-cards/rec-ui-02-later/THROWAWAY-NOT-FOR-MERGE.patch`.

## Decisions where the spec is silent (test writer, 28 Nov; the builder follows these)

- T-H1: the spec says "a `pp-card`", but the kit `Candidate: hired` at `6f59033` draws the block as `div.pp-section-message.pp-section-message--success` (title `h3`, body, actions with a small default button). AC-H8 says the kit wins, so the tests ask for the kit's section message, not a card.
- T-H2: the kit's button is a `<button>`; rule 3 says it is a link styled as the button. The tests ask for `a.pp-button.pp-button--default.pp-button--small` with an icon.
- T-H3: "the modules read fails" is judged two ways: a read that fails as the page loads keeps the person off the record (the route's own guard) and shows no block; a read that fails while the record is open (after the app's one-minute cache, on the next navigation inside the record) takes the block away.
- T-H4: AC-H2's legacy line is judged as the spec writes it: `legacy_hired: true` with no `employee_id`. A legacy row that also carries an `employee_id` is not judged.
- T-H5: with only one of the two names set, the line is not judged.
- T-H6: at 390 the link fills the actions row, as the design system's phone rule draws a section message button (`components.css`, `.pp-section-message__actions .pp-button { flex: 1 1 auto }`).

## What these tests must catch (the bar, LOCK-CHECK-STOPPING-RULE)

See `onboarding-cards/rec-ui-02-later/TESTS-FOR-REVIEW.md`.
