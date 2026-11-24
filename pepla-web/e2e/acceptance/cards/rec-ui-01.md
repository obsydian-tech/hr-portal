# REC-UI-01

Card: REC-UI-01 Roles and the hiring board (NH-227, epic NH-223, amber)

Test files: `rec-ui-01.spec.ts` and `support/rec-ui/` (`harness.ts`, `kit.ts`)

Spec: `onboarding-cards/specs/REC-UI-01.md`, with `REC-UI-00.md` and `REC-UI-01-readiness.md`. Wording U-1, U-2, U-3 and U-7 is settled in `MODULES-DECISIONS.md`.

Locks: acceptance-lock/rec-ui-01

These tests add files only; no other card's file changed. `support/rec-ui/harness.ts` is owned by this card: REC-UI-02 to 06 reuse it.

## How the tests run

AC-1 to AC-12 run at 1280 and 390 wide with no backend (desktop-only: the drag-and-drop test; phone-only: AC-10). The fake API (`HireFake` in `harness.ts`) is generated from the spec's contract table and answers any host whose path matches, so the card's choice of environment key does not matter. It keeps a log of every call, so each "nothing was sent" check can fail. Page time is frozen at 19 Nov 2026 08:00 UTC so "Overdue by 2 days" and "Due today" are stable.

`kit.ts` is generated from `project/ui_kits/recruitment.html` at the design system ref the app is pinned to (`src/styles/design-system/sync.json`, 1d56228). AC-11 first checks the app is still synced to that ref; if the ref moves, regenerate `kit.ts` with `process/rec-ui-01/gen-kit.py` (no network needed, it reads the design system checkout).

AC-13 runs on pepla-dev only (`ACCEPTANCE_TARGET=pepla-dev`, marked `@pepla-dev`). It stays red on dev until REC-02, REC-03 and REC-04 are built; it does not hold this lock or the board's merge (decision of 21 Nov). It needs `E2E_HR_EMAIL` and `E2E_HR_PASSWORD` (HR login with the Recruitment tick), `E2E_EMP_*` (an Employee), and `E2E_B_HR_EMAIL` and `E2E_B_HR_PASSWORD` (company B's HR; without them that part says so and skips). Rule 8 (three red runs in a row) applies to merges only if AC-13 fails three times in a row after those cards are on dev.

## The seed AC-13 expects (the same data the fake serves)

Company A role "Fleet controller", six open candidates across Applied, Screening, Interview and Offer (Amahle Dlamini in Applied, Tariro Moyo in Screening, Tendai Ncube and Bongani Mthembu in Interview, Kagiso Molefe with an offer sent) and two Not hired (Nomvula Zulu, Farai Moyo); roles "Warehouse supervisor" and "Senior accountant"; one old-system Not hired row for Warehouse supervisor (Mpho Sithole). Reseed before each run. Company B has "role-b-dispatch", company C "role-c-baker". `harness.ts` `seed()` is the source of truth.

## Decisions where the card is silent (the builder follows these)

- The board's per-card "More actions for {first name}" menu and the Move button named "Move {first name}" are how a card is reached by keyboard and phone.
- The page's "More actions for {role}" menu holds Close role.
- Breadcrumb: all crumbs are links in the design system; on a phone it shows only the last one. Tests accept that.
- A request is never given a company: not in the address, query, headers (the token apart) or body.
- A retry after a dropped connection reuses the Idempotency-Key; a new attempt gets a new one.
- The kit's layout helpers, `--inline` frames, text helpers, avatar colours, small search size and textarea choice are not required (a build may lay the page out another way). Everything else the kit has, the page must have.

## Things the builder must know

1. `pp-pipeline-board` has no per-card More actions menu today. The design system needs `cardMenu` and `cardAction` (or equal) first. The throwaway's edit is in `process/rec-ui-01/throwaway-NOT-FOR-MERGE.patch`.
2. The Hire entries are registered in `core/nav.ts` (the registry), and the group names (`hr_staff`, `perm-recruitment`) only appear in `core/`. MOD-02's locked AC-7 fails if a file under `features/` names them (the throwaway did, on purpose, and failed that test; the build must not).
3. Contract choices to settle with the backend cards: `pending` in the candidates read, the `mine` filter, the `/v1/config` shape, the company name source, the department list source.
4. A manager cannot sign in today (ONB-23), so only the refusal is tested.
5. Phone drag is not tested.

## Child lock rec-ui-01.2 (REC-14 step C, 23 Nov 2026)

REC-14 rules 17 and 20: the fake API now gives the Open a role page one `GET /v1/roles/options` answer (`world.options`, schema-checked
against api/openapi.yaml at load), refuses a route or a missing required query parameter that api/openapi.yaml does not have (today's
`GET /v1/config` with no `configType`), and checks every rule 14 answer and the `POST /v1/roles` body; any problem fails the test.
AC-3 follows the new page: Department and Hiring manager start empty, the body sends `department_id`, criteria keys and labels are the
server's REC-12 defaults. AC-4's Screening-off fixture is `world.options.A.screening`. Nothing else in this card changes.

## Child lock rec-ui-01.3 (REC-UI-02 decision D-T-A12, 23 Nov 2026)

The fake API now answers `GET /v1/candidates` exactly as the real list does since REC-15 step A (PR 495): `CandidateList` and
`CandidateRow` of api/openapi.yaml, checked like the rule 14 routes; the server's order (most urgent first), its page
(`limit`, `nextToken`) and its 400 `INVALID_FIELD` refusals (a search of only spaces or over 100 characters among them).
Rows no longer carry `interviews_done`, `interviews_required`, `offer_state` or `pending`. Not hired, confirm and cancel
answer as `record-not-hired.mjs` does: `{ candidateId, pending: true, awaiting: { kind, personId? } }`, never a name.
A failure set up with `refuse()` stands for a gateway or network failure and is not checked against the file.

What changes for the board (the builder follows these):
- An Interview card says "Day {n}" as a Screening card does; an Offer card says "Offer". The counts and the offer state come
  back when a backend card adds them to the list (REC-15 step D and REC-05), with their own child lock.
- "{name} must confirm before this is final." names the person the Not hired answer points to: `awaiting.kind`
  `HIRING_MANAGER` with `personId`, named from the company's hiring managers (`GET /v1/roles/options`) or the role. An answer
  that waits on any HR person names nobody, so no line shows (U-3).
- The search box sends its text trimmed; only spaces sends no search; more than 100 characters is never sent.
- After a reload, or for another person, the board cannot know a decision is waiting: the list does not say so. The test
  "Another Recruiter sees the waiting decision ... and confirms it" is `test.fixme` until follow-up F-RUI-02.1 adds it.
- AC-1 accepts REC-UI-02's Candidates entry after Roles and Pipeline.

Round 2 of the REC-UI-02 lock check (24 Nov 2026) added to rec-ui-01.3:
- The seed gives Bongani Mthembu and Kagiso Molefe an `applied_at` before the day they entered their stage, as real rows past Applied have (the fake no longer makes the two dates equal for every row).
- The AC-6 pending test drops `hiring_manager_name` from the role answer, as the real `GET /v1/roles/{id}` does, so the name must come from `awaiting.personId` and the company's hiring managers.
- `HireFake.lift()` lifts refusals set with `once: false`.
