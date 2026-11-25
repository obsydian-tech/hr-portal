# REC-UI-02.1

Card: REC-UI-02 Candidates (NH-228, epic NH-223, amber). This child lock is step 2: Add candidate.

Test files: new `rec-ui-02-add.spec.ts` and `support/rec-ui-02/add.ts` and `support/rec-ui-02/add-kit.ts`; changed lines in `rec-ui-02.spec.ts` (AC-1 on Candidates and the Pipeline list now expect the Add candidate button; the AC-14 kit match no longer lists `pp-button--primary` and `pp-page-header__actions` as "not built"). It reuses `support/rec-ui/harness.ts` (owned by REC-UI-01) unchanged.

Spec: `onboarding-cards/specs/REC-UI-02-next-slice.md` (rules 1 to 10, A-1 to A-8, AC-1 to AC-17, decisions D-RUI-02.6 to .12), the backend of REC-15 step B (NH-266, PR 506, `lambda/shared/recruitment-actions/add-candidate.mjs`, `api/openapi.yaml` `NewCandidate`, `NewCandidateAnswer`, `NewCandidateError`) and `onboarding-cards/rec-15b/FOLLOWUPS-FOR-ADD-CANDIDATE-SCREEN.md`.

Locks: acceptance-lock/rec-ui-01.5 (first: the board's AC-4 now expects exactly one primary button, Add candidate), then acceptance-lock/rec-ui-02.1.

## How the tests run

Every test runs at 1280 and 390 wide unless it says why not. Page time is 19 Nov 2026 08:00 UTC. The REC-UI-01 harness answers every read. `add.ts` adds a fake `POST /v1/candidates` in front of it that mirrors `add-candidate.mjs`: Recruiter only (else 403), a missing key gives 400 `IDEMPOTENCY_KEY_REQUIRED`, any field the body may not carry gives 400 `INVALID_FIELD`, one stored answer per company and key (a repeat gets 200 and the same body), another company's role or an unknown role gives 404 `{ error: 'Not found' }`, a closed role gives 409 `ROLE_CLOSED`. Every body and answer is checked against `api/openapi.yaml`. A test can make the fake refuse, hold, drop the connection, or store and then drop the answer.

`add-kit.ts` is generated from `project/ui_kits/recruitment.html` at the design system ref the app is pinned to (449bc5b) by `onboarding-cards/rec-ui-02-add/gen-add-kit.py`. AC-16 first checks the app is still synced to that ref.

AC-17 runs on pepla-dev only (`@pepla-dev`). It needs `E2E_HR_EMAIL`/`E2E_HR_PASSWORD` (Recruiter in company A) and company B's HR in `E2E_HR_B_*` or `E2E_B_HR_*`; without B that part says so and skips. It adds one real candidate on dev each run.

## Decisions where the spec is silent (test writer, 25 Nov; the builder follows these)

- T-1: the error summary lists each problem as "Label: line" (for example "First name: Enter the first name") and its heading is Register an employee's "Fix {n} thing(s) to continue" (D-RUI-02.9, same component, same words).
- T-2: layout is measured the design system's way. Phone and Source sit inside the accordion panel, which has its own padding, so their left edge is checked against the panel's content box, not the drawer's. On phone the design system makes the header's primary button 48 px tall, so A-6 there checks it is at least 48 px and on screen, not that it matches the switch. The button must be a direct child of `.pp-page-header__actions`.
- T-3: the repeat-request key is 16 to 128 characters and carries no personal data (no name, email, phone, role id). `crypto.randomUUID()` meets it. One key per opening of the drawer; a retry after a failure keeps it; Cancel, Close, Escape or a success throw it away.
- T-4: role choices come from `GET /v1/roles` with `status=OPEN` (or no status, filtering to open ones), in the order the answer gives.
- T-5: after a 409 `ROLE_CLOSED` or a 404 the screen reads the roles again, so the closed or missing role drops out of the picker.
- A 409 `IN_PROGRESS` (the server is still working on the same key) shows "Your change could not be saved. Try again."; pressing again sends the same key.
- When the server stored the candidate but the answer was lost, the retry gets 200 with the stored answer; the screen treats 200 like 201 (closes, reads the list again, returns focus).
- Controls in AC-13 C and AC-14: each "cannot see it" test first shows that Recruiter A does see the button in the same run, so a page that never draws it cannot pass.

## Lock check round 1 fixes (25 Nov)

- F1: two tests where Recruiter A uses the drawer and signs out with the app's own Sign out, and Recruiter B signs in on the same browser (once with no page load, once after one). B is offered only B's open roles, and no A role title is on the page at any moment. Keep role choices in the drawer's own state, never in a store, module variable or browser storage that outlives a sign-out.
- F2: after every refusal in AC-10 (400 INVALID_FIELD, 400 ROLE_REQUIRED, 403, 409 IN_PROGRESS, 500, a dropped connection) pressing again sends the same Idempotency-Key and body, and only one candidate is made. After 404 and 409 ROLE_CLOSED the real server stores nothing, so the tests accept either key there; the throwaway keeps the same one.
- F3: `support/rec-ui-02/add.ts` answers `GET /v1/roles` with no status as the real server does (every role of the company, closed ones too). The locked REC-UI-01 harness is not changed. AC-3 requires the drawer's reads to ask for `status=OPEN` by name.
- F4: a phone of exactly 9 and exactly 15 digits is accepted; a plus sign anywhere but the start is refused.
- F5: the every-word test also looks while a request is running.
- F6: an empty first name with a wrong phone lists First name then Phone; an email typed in mixed case is sent as typed (trimmed only).

## Open wording question (rule 7a, took the recommended option)

- Q-W1: "Choose a role" as the error line when no role is picked. It is not logged in DECISIONS. It is the kit's placeholder text for the picker and follows Register's "Choose a department". Recommended: keep it. Iggie can change it.
- From the spec, still open for Iggie: Q-A (no CV field until a CV card exists) and Q-B (the notice line promises an email that REC-08 does not send yet; keep on dev, hold prod).

## Things the builder must know

1. Turn on `ADD_CANDIDATE_READY` in `hire-flags.ts`. The button goes in `pp-page-header-actions` on the board, the Pipeline list and Candidates, as a direct child, `appearance="primary"`, icon `user-plus`, in the kit's order.
2. One drawer component, used by all three pages. The board passes its role as the starting choice; the other two start empty. After a success the page reads its list again and focus returns to the Add candidate button.
3. The body carries only `first_name`, `last_name`, `email`, `role_id`, and `phone` and `source` when filled, all trimmed. Never a company, title, level, department or manager.
4. Block a second press while a request is out (a double click sends once) and disable Create while it runs, while the roles failed to load, and when there are no open roles.
5. Never show the server's error text. Use only the lines in the spec's D-RUI-02.9 and D-RUI-02.7.
6. Reset the form and its errors on every close, so an old error never comes back on the next opening.
7. The old journey "HR adds a candidate and moves them one stage" in `hr-portal/e2e/tests/talentflow-smoke.spec.ts` (old TalentFlow app) has been red on dev since PR 506: the old Add Candidate drawer posts the old body and the new route answers 400 (DECISIONS, REC-15 step B; PROD-CATCH-UP-LIST P-8). The build PR retires that one test: delete it and change the file's header to say the old app keeps two checks (it opens, the list loads), and that adding a candidate is now judged by `rec-ui-02-add.spec.ts` AC-17 @pepla-dev (a real add in the new app on dev, with company B unable to see it) and moving one stage by `rec-ui-01.spec.ts` AC-13 @pepla-dev. That file is not under `e2e/acceptance` and no lock owns it, so the change goes in the build PR, not in a child lock. Do not mend the old drawer to post the new body: the old app is being replaced. P-8 says the new screen goes to prod together with REC-15 step B, because the old page breaks there too.
8. `pp-drawer` projects its content, so the form's parts live on between openings. In the throwaway, a Source picked before Escape sometimes still showed on the next opening although the value had been cleared (AC-12 Escape, about 1 run in 20). Drawing the form only while the drawer is open (`@if (open()) { <form> ... }`) fixed it: 40 of 40 repeats passed.
