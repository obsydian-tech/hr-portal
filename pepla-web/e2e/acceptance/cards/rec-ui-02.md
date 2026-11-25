# REC-UI-02

Card: REC-UI-02 Candidates (NH-228, epic NH-223, amber). This lock is step 1: the two candidate lists.

Test files: `rec-ui-02.spec.ts` and `support/rec-ui-02/` (`lists.ts`, `kit.ts`). It reuses `support/rec-ui/harness.ts` (owned by REC-UI-01), which child lock rec-ui-01.3 changed first so the fake list answers what the real list sends.

Spec: `onboarding-cards/specs/REC-UI-02.md` (rule 1, rule 2, AC-1, AC-2, AC-11 to AC-15, the list parts), `REC-UI-00.md`, and the list answer of REC-15 step A (`api/openapi.yaml` `CandidateList`, PR 495). Wording U-1 and U-7 are settled in `MODULES-DECISIONS.md`.

Locks: acceptance-lock/rec-ui-01.3 (first), then acceptance-lock/rec-ui-02.

## What is in this lock and what is not

In: the Candidates page (`/hire/candidates`), the Pipeline list (`/hire/pipeline` with no role, All roles, or `view=list`), the switch between the board and the list, the tabs, search, Role and Stage filters, the Not hired toggle on the Pipeline list, the stage time words, paging, the failure state, recruiter-only access, the company walk, phone 390, the kit match, and the dev run (AC-15 list part).

Not in (their backend is not built): Add candidate (AC-3, AC-4: REC-15 step B), the candidate record and its tabs (AC-5, AC-6, AC-9, AC-10, AC-11 record part: step C), Interviews and Schedule (AC-7: step D and REC-07), Reopen (AC-8: U-8). Each comes as a child lock rec-ui-02.N when its step merges.

## How the tests run

Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 08:00 UTC (10:00 in Johannesburg). The fake API is the REC-UI-01 harness. Its `GET /v1/candidates` mirrors `candidate-list.mjs` (filters, 400 INVALID_FIELD, order, counts, page token) and every answer is checked against `api/openapi.yaml`, so a screen that reads a field the real list does not send fails here, not on dev.

`kit.ts` is generated from `project/ui_kits/recruitment.html` at the design system ref the app is pinned to (`src/styles/design-system/sync.json`, 449bc5b) by `onboarding-cards/rec-ui-02/gen-kit.py`. AC-14 first checks the app is still synced to that ref.

AC-15 runs on pepla-dev only (`ACCEPTANCE_TARGET=pepla-dev`, `@pepla-dev`). It needs `E2E_HR_EMAIL` and `E2E_HR_PASSWORD` (HR with the Recruitment tick in company A), `E2E_EMP_*`, and `E2E_B_HR_*` (company B's HR; without them that part says so and skips).

## Decisions where the card is silent (the builder follows these)

- D-T-A12 (23 Nov, BA under rule 6, recommended option): the screens read only what the real list sends (`CandidateRow`). On the board an Interview card says "Day {n}" and an Offer card says "Offer" (the list sends no interview count and no offer state). The "{name} must confirm before this is final." line takes the name from the answer's `awaiting.personId` (the role's hiring manager, else the company's hiring managers). When the answer waits on any HR person (`awaiting.kind` HR) no line names anyone. After a reload, or for another person, a waiting decision cannot show until the list carries it (follow-up F-RUI-02.1); that test is `fixme`.
- D-RUI-02.4: until the candidate record exists (step C) a row opens nothing: no name link, no Open button.
- D-RUI-02.5: the next page loads when the person reaches the end of the list. No words, no button. Each page token is sent once, with the same filters.
- Pipeline with no role, or `role=all`, shows the list of all roles; Board is disabled there. With a role it shows the board, and `view=list` shows that role's list. The address keeps `role` and `view`, so the back button and a shared link land on the same view.
- The search is trimmed and cut to 100 characters before it is sent; a search of only spaces sends none. The board does the same (rec-ui-01.3).
- Rule 7a screen words (logged in DECISIONS.md, 23 Nov): "Overdue" alone when the due time passed earlier today; "On track" alone with 0 days left; "On track, 1 day left" and "Due in 1 day" in the singular; an empty list or a search with no match says "No one yet" (U-7); a row with no clock (no hours set, Hired, Not hired) shows nothing in Stage time; when the levels cannot be read the meta is the role title alone, and a level the settings do not know is shown as sent; Add candidate stays hidden until step B; the kit's "More actions for Pipeline" button is not built (no items or words exist for it).
- Days are counted in calendar days in Johannesburg, not UTC.
- A request is never given a company: not in the address, query, headers (the token apart) or body.

## Things the builder must know

1. The Candidates nav entry goes in `core/recruitment-nav.ts` with the other Hire entries (icon `user-search`, after Pipeline). No file under `features/` may name the groups (MOD-02 AC-7).
2. `/hire/pipeline` today loads the board directly. It needs to choose between the board and the list from the address. The board's List button becomes enabled and goes to `view=list` with the role.
3. The board's card lines and Not hired handling change as D-T-A12 says; `rec-ui-01.spec.ts` (rec-ui-01.3) judges that.
4. Dates read "4 Nov 2026", with no leading zero, as the app's approved dates do (`core/deadline.ts`, ONB-10 W-2). `hire-format.ts` `shortDate` gives "04 Nov 2026" in the en-ZA format of the browsers we test with; the build drops the zero (the throwaway does).
5. Each list keeps its rows in the page's own state, never in a store that outlives the page or a sign-out: AC-12 signs A out and B in in the same tab with no page load (lock check S6).
6. Backend issues found while writing these (not this card's): a second `POST /not-hired` while one waits overwrites it (REC-02); `GET /v1/roles/{id}` sends no `hiring_manager_name` on dev; review notes N2 to N4 of REC-15 step A.
