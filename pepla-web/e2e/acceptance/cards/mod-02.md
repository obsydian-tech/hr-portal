# MOD-02

Card: MOD-02 The app shell and guards know which modules a company has and what a person may open (NH-225, epic NH-222)

Test files: `mod-02.spec.ts` and `support/mod-02/` (`modules-fake.ts`, `shell-snapshot.ts`, `baseline.ts`, `baseline.json`)

Spec: `onboarding-cards/specs/MOD-02.md`. API contract: the table in `MOD-01.md` ("GET /v1/company/modules", D-API-1).

Locks: acceptance-lock/mod-02

These tests add files only; no other card's file changed.

## How the tests run

AC-1 to AC-5 and AC-9 run at 1280 and 390 wide with no backend. AC-6 runs at 390 only. AC-7 (reads source files) and
AC-8 (reads `package.json`, builds the app) run once, in `desktop-1280`. AC-9 also runs on pepla-dev (`@pepla-dev`): it
is red there until the route exists on dev, and its company B part needs `E2E_B_HR_EMAIL` and `E2E_B_HR_PASSWORD`
(MOD-01's seeded company B HR login); without them it says so and skips that part.

The fake modules API (`support/mod-02/modules-fake.ts`) is generated from MOD-01's table: company A `["onboarding","recruitment"]`,
B `["onboarding"]`, C `[]`, and the failing answers (403, 401, network error, three kinds of malformed body). It answers any
host whose path ends in `/v1/company/modules`, so the card's choice of environment key does not matter. It requires a sign-in
token and records every call.

## The test-only hook (the card leaves its name open, rule 8; the builder implements exactly this)

Present in non-production builds only. AC-8 builds the app for production and fails if `__nalekoTest` appears in any built file.
Guard it with `ngDevMode` so the build removes it.

- `window.__nalekoTestSetup`: set by the test BEFORE the app starts (`addInitScript`), so it also holds on a page load by
  address bar. Shape `{ entries: Entry[], routes: Route[] }`.
  - `Entry` is the registry entry of rule 3: `{ id, group, label, icon, route, module?, roles?, perms?, order? }`. `group` is one of the
    DS group words `Records, Hire, Onboard, Leave, Comply, Help desk, Perform, Settings`. `roles` and `perms` are "any of". `order`
    sorts inside a group. The app registers each one before the first page is drawn.
  - `Route` is `{ path, module?, roles?, perms? }`. The app adds a top-level route `path` (before the not-found route) guarded by
    `accessGuard({ module, roles, perms })`, with no shell, showing one `h1` whose text is `path`.
- `window.__nalekoTest`: set by the app. `{ rolesOf(claim), landingFor(roles, perms, modules), modules() }`.
  `rolesOf` is `core/roles.ts` (arrays in `roles` and `perms`; `perms` keep the `perm-` prefix); `landingFor` is the rule 6 table;
  `modules()` is the modules service's current set as an array.

## Things the tests decided where the card is silent (for the BA to confirm)

1. **Both shells draw the registry.** The employee sidebar (`/start`) is checked too: an entry for `employee`, or for a tick the
   employee has, shows there; HR-only entries do not. The card says "the shell" and "Today's two items" (HR has two, the
   employee one); the tests read that as one registry for both shells.
2. **Group order and Today.** Today is first. Where "Documents to check" sits relative to a group is not asserted (the card does not
   name its group); the fake entries are checked in DS order among themselves, group headings (if drawn) in DS order, and no empty group.
3. **AC-5 screenshots.** The card says screenshots within the repo's usual tolerance. The repo has no stored-picture comparison for
   screens, and fonts load from Google, so a picture taken here would differ from CI's. AC-5 compares the DOM the card names
   (sidebar items, links, icons, top bar, title, heading) with `baseline.json` taken from develop 06201c3, and the position of the top
   bar and every sidebar item within 1 pixel, at both widths.
4. **manager and guest.** Today neither group can sign in (ONB-23 refuses any account that is not `hr_staff` or `employee`).
   AC-5 pins that: same words, no session. `landingFor` is checked for `hr_staff`, `admin` (both `/hr`) and `employee` (`/start`) only.
5. **Retry.** After a failed answer the next page change asks again at once (no minute in between); after a good answer the next
   ask waits a minute.
6. **Fail closed does not hide today's items.** With the call failing, Today and Documents to check stay (they carry no module).
7. **AC-5 is green on develop except its last step** (the first-page table needs the hook); the baseline steps pass today.

## Changed tests of other cards (need their own lock names at the same commit as mod-02, ONB-23 precedent)
The shell now asks `GET <api>/v1/company/modules`. Four locked specs counted every API call and failed with it (14 failures across 7 tests on a correct build). Each now ignores that one GET and nothing else:
- onb-05: `Watch.apiCalls`
- onb-13: `apiCallsSince` and the AC-9 `outside` filter
- onb-17: `Watch.apiCalls`
- onb-23: `Watch.apiCalls`
- onb-02 AC-9, onb-12 AC-9, onb-15 AC-10: the `outside` filter (second lock check)
Lock names: `acceptance-lock/mod-02` only is new. onb-05, 13, 17, 23 locks already exist and TEN-02 re-locks onb-05 and onb-13; onb-02, 12 and 15 are re-locked with mod-02.

Not locked, builder fixes: the help journeys `e2e/journeys/sign-in.e2e.ts`, `who-is-starting.e2e.ts` and `hr-checks-a-document.e2e.ts` abort any call that is not theirs, so each must answer or allow `GET /v1/company/modules` (onb-02 AC-12 runs sign-in and fails until it does).

## All-of (AC-10)
Hook entries and routes take `allOf?: string[]`: group names (roles and `perm-` names) that must ALL be held. It is ANDed with module, roles (any of) and perms (any of). Needed for REC-01 `requireRecruiter` (hr_staff AND perm-recruitment).


## Builder constraint from SITE-01 AC-1
`/` must load no Cognito or signed-in code. The registry, guards, modules service and test hook must load lazily (with the app routes), never from `app.ts` or `site.routes.ts`. The throwaway shows one way: a pathless route in `app.routes.ts` with `provideEnvironmentInitializer`.

## Re-locked by ONB-19
The employee blocks of `support/mod-02/baseline.json` (both projects) gain the "My onboarding" sidebar item and its box.
Nothing else in the file changes. Locks: acceptance-lock/mod-02.2 (the same commit as ONB-19's).
