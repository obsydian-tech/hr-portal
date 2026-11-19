# CHAT-03

Card: CHAT-03 A company admin turns Ask Batsi on or off from an Admin screen (red, front end only)

Test files: `chat-03.spec.ts` and `support/chat-03/admin-fake.ts`, plus one moved test of another card (below).

Spec: `/mnt/project-files/ask-batsi-chat/CHAT-03-admin-switch.md` with `CHAT-03-04-ORDER-AND-QUESTIONS.md` (every Q taken as recommended: Q-3 no confirm step, Q-6 two minutes accepted, Q-7 landing taken, Q-8 W-A1 to W-A4 as proposed). Review page: `/mnt/project-files/ask-batsi-chat/CHAT-03-tests-for-review.md`.

Locks (names are the lock-check thread's to pick and push; suggested): `acceptance-lock/chat-03` for `chat-03.spec.ts` and `support/chat-03/`, and `acceptance-lock/mod-02.4` (check `git ls-remote` for the next free name) at the same squashed commit for the one moved line in `mod-02.spec.ts`.

Written on develop c00bf96 plus CHAT-02's lock (`acceptance-lock/chat-01.1`, 1775dca). Nothing is pushed.

## How the tests run

Every test runs at 1280 and 390 wide in the no-backend run (AC-15's source test runs once, in `desktop-1280`). All are skipped on pepla-dev: the real PUT with a dev admin, the switch showing the true state after a reload, the top bar button appearing for an HR person within about two minutes, and the audit row are judged by a person (the card says so).

The API is a stand-in in the browser, `support/chat-03/admin-fake.ts`, built from CHAT-02's pinned contract (D-4, AC-21, AC-22):
`GET <api>/v1/company/modules` and `PUT <api>/v1/admin/company/ask-batsi` `{ enabled }`. The company is the caller's sign-in (by `sub`), two companies: A (onboarding, recruitment) and B (onboarding). The fake refuses a PUT from a non-admin (403), a body that is not exactly `{ "enabled": boolean }` or a query on the address (400), and its CORS answer allows only `authorization` and `content-type`, so a PUT that adds `Idempotency-Key` or a company header is stopped by the browser's preflight and the test fails. Read and save have failing modes (500, 403, 401, 404, offline, bad body, held). Nothing calls AWS, Bedrock or any AI service.

The test hook of MOD-02 (`window.__nalekoTest`, `cards/mod-02.md`) is used twice: `landingFor(roles, perms, modules)` for the first-page table, and `modules()` to see that the app's own list of modules follows a save at once. Nothing new is asked of the builder.

## Decisions the tests make where the card is silent (BA to confirm)

- **D-1 An admin with no other group cannot sign in today.** `AuthService.signIn` and `restore` (ONB-23) refuse anyone who is neither `hr_staff` nor `employee`, so the person this card is for (admin only, the TalentFlow admin mapping gives `admin` and the ticks and no `hr_staff`) gets "This account can't use Naleko People yet. Ask your HR team." and never reaches the screen. The card says the admin-only loop is "read, not reproduced" and speaks of `landingFor` and `hrGuard`; it is worse than that. AC-14 (new) pins: an account whose only group is `admin` signs in, keeps a session and lands on the screen; manager-only, guest-only and the old admin groups (TalentFlowAdmin, naleko-talentflow-admin, ITAdmin) are still refused with the same words and no session. This is the smallest change that makes AC-1, AC-12 and AC-13 true for the admin. If the BA would rather admit admin through another route, only AC-14, the `enter` helper and the admin-only people change.
- **D-2 C-7 (landing) is taken** (Q-7 recommended). `mod-02.spec.ts` AC-5 line "admin lands on /hr" becomes "admin lands on /admin/ask-batsi", and a new line says an `admin` who is also `hr_staff` lands on `/hr` (child lock `mod-02.4`). The table is the one in `core/nav.ts`; the tests read it through the hook. Not pinned, the card is silent: `admin` plus `employee`.
- **D-3 What the admin shell holds.** The kit's frame is a mock with many other pages (Overview, Users and roles, Stages ...). The card says "Back to Today, Workspace, Ask Batsi selected" and "calls no HR-only service", so the admin shell must have exactly two links, Back to Today and Ask Batsi (selected, `aria-current="page"`), and may use the group headings Workspace or Settings. The registry entry is in group Settings, so an admin who is also HR sees Settings, Ask Batsi in the HR sidebar (AC-1). Back to Today goes to `/hr` for an admin who is also HR; for an admin-only person the card gives no place and the tests do not say.
- **D-4 "Save is not offered as a change until the switch moves"** is read as: Save is disabled (disabled or `aria-disabled`) until the switch differs from the saved state, and again after a good save. After a failed save the switch returns to the saved state and Save is disabled again. C-4's "saving the same value again is allowed" is a server fact (200, no row), not a button state; the tests do not press Save on an unchanged switch.
- **D-5 Announcements.** Saved. (W-A4), the load error (W-A2) and the save error (W-A3) are inside a live region (`role="status"` or `role="alert"`), as the other cards' messages are.
- **D-6 The strings.** AC-2 reads every line of `main` and fails on any not in: P28 to P35, W-A1 to W-A4, and the kit's own strings (Workspace, Setting, Value, the table caption, Save changes, Try again). It runs on the settled states (off, on, saved, each error). It does not read the busy moment: the DS toggle shows "Saving" there (`[saving]`), a word the card does not list; AC-8 holds the request and does not read the words. The tab title is "Ask Batsi · Naleko People" (the pattern of every other page; tab titles are on Iggie's wording list).
- **D-7 The route is `/admin/ask-batsi`** (the card names it). The "batsi" rule: AC-15 reads the source of the signed-in app (features except `features/public`, and `core`) for file paths, class names and selectors with "batsi", and the page's requests for the same. `ds/site/sections/batsi.ts` is the public site and is left alone; use `company-switch.page.ts`, class `CompanySwitchPage` (or the like).
- **D-8 The PUT is judged by what it sends**, not where: any host not the app, path ending `/v1/admin/company/ask-batsi`, no query, body exactly `{"enabled":bool}`, headers only `authorization`, `content-type` and what the browser adds. Which API stage hosts it is CHAT-02's builder's choice; the front end uses `environment.employeesApiUrl`, as `/v1/company/modules` does.
- **D-9 After a save** the app clears the modules cache: `GET /v1/company/modules` is read again and `__nalekoTest.modules()` has (or lacks) `ask_batsi` at once.

## What each test pins

| AC | Pins |
|---|---|
| 1 | An admin who is also HR sees Settings, Ask Batsi in the HR sidebar and it opens the screen, Back to Today returns to `/hr`; an admin-only person sees the admin shell with two links and Sign out works; HR, HR with a tick, employee, manager with employee, guest with HR and company B's HR have no entry and no `/admin` link, the address sends them to their own first page, the switch and Save are not drawn, no request to the admin route and no PUT; signed out goes to sign-in |
| 2 | Words (D-6): title and breadcrumb, one h1, the card h2, the description, one switch, a two-row read-only table, one button, no other field, every line approved, no "pepla", "masked", model or company names anywhere in text, title, meta or labels; the same after Saved, a failed save and a failed read |
| 3 | Company with it off: switch off with P31, Save disabled until the switch moves, moving saves nothing, one PUT `{"enabled":true}` (D-8), Saved. and W-A1, modules read again, the app's list follows, only the two admin calls are made (C-1) |
| 4 | Off: one PUT `{"enabled":false}`, no dialog of any kind (role dialog, alert dialog, browser confirm), P31 and Saved., other keys untouched |
| 5 | From the server: list with `ask_batsi` among others in any order is on; founding company with no attribute, a company with other keys, and near names (`ask_batsi_beta`, `ask-batsi`) are off |
| 6 | Before the answer: switch disabled, nothing says on or off, Save disabled. Every failed read (500, 403, 401, offline, not JSON, wrong shape, no key): W-A2 announced, Try again, switch and Save disabled, nothing says on or off, no status or server text, no save made; Try again reads again and shows the true state |
| 7 | Every failed save (500, 403, 404, offline): switch back to saved, W-A3 announced, P31 again, not Saved., no status code or server text, nothing saved, one try each, body `{enabled}` only on every try, Save disabled until the switch moves; then a second attempt works |
| 8 | Double click and Enter while held: one request; one after the answer; then it saves again |
| 9 | After a save a fresh load shows the new state; nothing about the switch in local or session storage; a second admin of A sees it on; an admin of B sees B off, saves B, A is untouched; no company in any body or address; the server turns A off and the next load shows off |
| 10 | At 1280 and 390: title, description, card title, switch, its sentence, table and Save are visible, on the screen and not under the top bar; no sideways scroll; the table has `pp-table--stack` and stacks on a phone, sits side by side on a desktop |
| 11 | Reduce motion on: the whole save works, the checked state is visible, no running animation over 50 ms |
| 12 | The first-page table through the hook (admin, admin and HR, HR, employee, manager, guest, none); real sign-ins: admin lands on the screen and `/hr`, `/hr/documents`, `/start` and `/sign-in` all end there; admin and HR: `/hr` stays, the screen opens, `/start` and `/sign-in` go to `/hr`; HR and employee are not moved; signed-out goes to sign-in; no loop |
| 13 | Fourteen sign-ins (admin, admin and HR, admin with ticks, B's admin, HR, HR with a tick, B's HR, employee, manager with employee, guest with HR; Ask Batsi on and off for four of them): the entry is in the sidebar if and only if the route lets the person in, and that is only an admin, whatever the module says |
| 14 | D-1: admin-only signs in, session kept after a reload, lands on the screen, no refusal; manager-only and guest-only are refused with the same words and keep no session; no admin request |
| 15 | D-7 source and request check; no browser storage in `features/admin` |

## Changed test of another card (re-locked in the same commit)

- `mod-02.spec.ts` AC-5, the first-page table: `admin` lands on `/admin/ask-batsi` (was `/hr`), and `admin` with `hr_staff` lands on `/hr`. Lock name `mod-02.4` (check the real repo). Nothing else in `mod-02.spec.ts` moves. A correct build turns it red before and green after.

No other locked test pins an admin-only sign-in or landing (grep of `'admin'` in `e2e/acceptance`, 18 Nov): `ten-05`, `ten-06`, `be-16` and `be-20` read Lambda groups only, and `onb-23` AC-3 refuses a `contractor` group and no group.

## Shared files

`mod-02.spec.ts` (moved line above; CHAT-01 and CHAT-02 do not touch it), `app.routes.ts`, `core/auth/auth.guard.ts`, `core/auth/auth.service.ts` (D-1), `core/nav.ts`, `core/modules.service.ts` (a `refresh()` that clears the cache and says whether it worked), `features/admin/`. CHAT-01 edits `ds/navigation/shell.ts` and the top bar; this card does not.
