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
