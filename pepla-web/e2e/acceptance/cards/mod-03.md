# MOD-03

Card: MOD-03 The module launcher: every module in one place, with what the company and the person can open (NH-226, epic NH-222)

Test files: `mod-03.spec.ts` and `support/mod-03/catalogue.ts`

Spec: `onboarding-cards/specs/MOD-03.md`. Words: Decision D-WORDS-MOD3 (Iggie, 17 Nov 13:15 SAST). Site words: `landing-concepts/naleko-concept-d.html` lines 873-879, with the "hidden, not masked" rule (Deviation table).

Locks: acceptance-lock/mod-03, acceptance-lock/mod-03.1 (AC-7 allows pp-icon), acceptance-lock/mod-03.2 (the Hire tile follows the Hire pages' rule, below). The same commit is also pushed as `acceptance-lock/mod-02.5` and `acceptance-lock/ang-01.4`, because it changes one file of each of those cards (see "Changed tests of other cards").

## How the tests run

AC-1 to AC-7 run at 1280 and 390 wide with no backend (AC-7 builds nothing; it runs `npm run parity:kit`, so it needs the network the other kit tests need). AC-8 runs in both runs: with the fakes here, and with the dev logins on pepla-dev (`@pepla-dev`; the company B part needs `E2E_B_HR_EMAIL` and `E2E_B_HR_PASSWORD`, like MOD-02 AC-9). It uses MOD-02's fake modules answer (`support/mod-02/modules-fake.ts`) and the test-only hook `window.__nalekoTestSetup` that MOD-02 already built.

## The handles the tests use (the spec names no markup; the builder implements exactly this)

- **The button:** a button named "Modules" in `pp-top-navigation`, in the HR, employee and Admin shells, never on the sign-in page. `aria-expanded` follows the launcher. At 390 the word is not shown, the icon alone is.
- **The container:** an element with `role="dialog"` and the accessible name "Modules" (the title). `pp-popup` at 1280, `pp-drawer` at 390 (full height). It has a button named "Close". Escape and Close shut it; focus goes in and returns to the button.
- **A tile:** an element with `data-module="<key>"` and `data-state="open|no-access|not-on|coming-soon"` inside the dialog. Keys, in this order: `ask-batsi`, `records`, `hire`, `onboard`, `leave`, `comply`, `help-desk`, `perform`. The Ask Batsi row has the key and no state requirement.
- **Pressing:** an Open tile is the link (or has one button/link in it). No other tile has anything pressable, except the Admin's one link on a Not switched on tile, whose address ends in `/recruitment` (Hire) or `/onboarding` (Onboard).
- **Words on a tile:** the tile's name and one-line description from `support/mod-03/catalogue.ts` (the approved site's words), plus only: "Coming soon" / "No access" with "Ask an Admin." / "Not switched on". Nothing else.

## Things the tests decided where the card is silent (for the BA to confirm)

1. **Tile names.** "Word for word from the approved site" is read as the site's module names: Employee Records, Recruitment, Onboarding and Offboarding, Leave Management, Compliance Management, HR Help Desk, Performance Management. The nav group words (Hire, Onboard...) are not the tile names.
2. **"Masked".** The site's Employee Records line says "masked"; the stored copy says "hidden" (Iggie's word rule, Deviation table), and a test refuses the word "masked".
3. **State rules.** Not switched on wins whenever the company lacks a built module (whoever the person is). No access is only for a person the role or tick refuses, in a company that has the module. Hire: HR, Admin, or the Recruitment tick (changed by mod-03.2: HR and the Recruitment tick together, see below). Onboard: HR, Admin. Records: everyone signed in (an employee reads "My details"). Leave, Comply, Help desk, Perform: Coming soon for everyone (D-MOD3-1).
4. **The manager.** A group `manager` cannot sign in today (ONB-23), so the "manager with the Recruitment tick" of rule 5 is tested as an employee with `perm-recruitment`. The "Records: No access" cell of the manager row cannot be tested until managers can sign in. Leftover.
5. **Admin.** An Admin sees every module the company has as Open, and the link on the others. Where an Admin's Open tile goes is not tested (the registry holds no first page for an Admin); only its state is.
6. **Where an Open tile goes.** The first registry entry (by order) in the module's group that the person may see: HR gets the test pages `/mod03/records`, `/mod03/hire`, `/mod03/onboard`; an employee's Records tile goes to their own first page (`/start`); an employee with the tick gets Hire's (since mod-03.2 an employee never has an Open Hire tile). The states do not depend on the registry (so AC-8 holds on dev, where Hire has no page yet).
7. **Fail closed.** With the call failing, or not answered yet, Hire and Onboard read Not switched on (as for a company with nothing on) for everyone, Records stays Open, nobody sees an error word.
8. **Switching.** The modules service re-reads on the first page change after a minute; AC-5 changes the answer, moves the clock 61 seconds, opens another page, and reads the tiles again. It does not require the launcher to refresh itself while open.
9. **Kit match (AC-7)** is a structure check: every class and custom element in the launcher is a design system part or appears in the kit screens "Modules" and "Modules (phone)"; no inline style; no stylesheet of its own. It needs the DS kit file `ui_kits/modules.html` at the ref in `sync.json` (a DS PR and a sync step come first). Kit motion not being made static is not tested (leftover).

## Changed tests of other cards (they need their own lock names at the same commit as mod-03, MOD-02 and ONB-23 precedent)

The Modules button now appears in the HR, employee and Admin top bars, so two files that pinned today's top bars change, each by one added line per bar and nothing else:

- `support/mod-02/baseline.json` (acceptance-lock/mod-02.5): the Modules button (icon hash `a1ddb83226`) after "Open menu" in the four top bars (HR and employee at 1280 and 390).
- `support/ang-01/develop-bars.ts` (acceptance-lock/ang-01.4): `"button:Modules:shown"` after "button:Open menu:..." in HR_BAR and EMPLOYEE_BAR (both widths).

ANG-01 AC-15 and MOD-02 AC-5 and AC-9 fail on a correct build without these two edits; with them they pass. No other locked test changed in the runs below.

## Child lock mod-03.2: the Hire tile follows the Hire pages' own rule (23 Nov 2026)

Why: the MOD-03 build review (point 8) found that the Hire tile said Open to people the Hire pages refuse. The Hire sidebar entries and the `/hire` route guard use `HIRE_ACCESS` (`src/app/core/recruitment-nav.ts`): the Recruitment module AND the HR role AND the Recruitment tick (`perm-recruitment`). Note 3's rule ("HR, Admin, or the tick") let HR without the tick, an employee with the tick, and every Admin see Open, and pressing it only took them to their own home page. Decision under rule 7a (recommended option, logged): show No access unless the person is HR and has the tick, in a company that has Recruitment.

What changed, and nothing else:
- Note 3, Hire: **Open only for HR with the Recruitment tick**, in a company that has Recruitment. Anyone else in that company (HR without the tick, an employee with or without it, an Admin with or without it) sees **No access** with "Ask an Admin.", and nothing on the tile can be pressed. A company without Recruitment is still Not switched on for everyone (the Admin's public page link stays).
- AC-3: three rows of the matrix change (HR without the tick, employee with the tick, Admin: Hire is No access). A second matrix, `HIRE_MATRIX`, adds HR with the tick in company A (Open, goes to the first Hire page) and company B (Not switched on), an Admin with the tick, HR and Admin together without and with the tick. The rows run as a second test so each stays inside the 60 second limit. The steps for each row are the same as before (`checkMatrix`).
- AC-4: HR with the tick replaces HR without it, so a failed or unanswered call is shown to close Hire for the one person it would be Open for.
- AC-5: the switch on and off is watched by HR with the tick in company B. After company A's HR with the tick signs out, an HR of the same company without the tick signs in on the same page and must see No access, never the last person's Open.
- AC-8: in the no-backend run the founding company's HR is one with the tick. On pepla-dev the HR login (E2E_HR_EMAIL) already holds the tick, as REC-UI-01 AC-13 needs, so the dev run is unchanged.

Words: none new. No access uses the locked words "No access" and "Ask an Admin." (D-WORDS-MOD3). An Admin now reads "Ask an Admin." on a No access Hire tile; flagged for Iggie, not changed.

Not changed: the test registry (`ENTRIES`) still lets HR or the tick see the test Hire page, so a build that takes the tile's state from the sidebar fails AC-3, as note 6 asks. Where an Admin's Open tile goes and the employee's Ask Batsi row (build review points 9 and 10) are not part of this lock.
