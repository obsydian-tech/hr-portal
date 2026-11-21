# MOD-03

Card: MOD-03 The module launcher: every module in one place, with what the company and the person can open (NH-226, epic NH-222)

Test files: `mod-03.spec.ts` and `support/mod-03/catalogue.ts`

Spec: `onboarding-cards/specs/MOD-03.md`. Words: Decision D-WORDS-MOD3 (Iggie, 17 Nov 13:15 SAST). Site words: `landing-concepts/naleko-concept-d.html` lines 873-879, with the "hidden, not masked" rule (Deviation table).

Locks: acceptance-lock/mod-03. The same commit is also pushed as `acceptance-lock/mod-02.5` and `acceptance-lock/ang-01.4`, because it changes one file of each of those cards (see "Changed tests of other cards").

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
3. **State rules.** Not switched on wins whenever the company lacks a built module (whoever the person is). No access is only for a person the role or tick refuses, in a company that has the module. Hire: HR, Admin, or the Recruitment tick. Onboard: HR, Admin. Records: everyone signed in (an employee reads "My details"). Leave, Comply, Help desk, Perform: Coming soon for everyone (D-MOD3-1).
4. **The manager.** A group `manager` cannot sign in today (ONB-23), so the "manager with the Recruitment tick" of rule 5 is tested as an employee with `perm-recruitment`. The "Records: No access" cell of the manager row cannot be tested until managers can sign in. Leftover.
5. **Admin.** An Admin sees every module the company has as Open, and the link on the others. Where an Admin's Open tile goes is not tested (the registry holds no first page for an Admin); only its state is.
6. **Where an Open tile goes.** The first registry entry (by order) in the module's group that the person may see: HR gets the test pages `/mod03/records`, `/mod03/hire`, `/mod03/onboard`; an employee's Records tile goes to their own first page (`/start`); an employee with the tick gets Hire's. The states do not depend on the registry (so AC-8 holds on dev, where Hire has no page yet).
7. **Fail closed.** With the call failing, or not answered yet, Hire and Onboard read Not switched on (as for a company with nothing on) for everyone, Records stays Open, nobody sees an error word.
8. **Switching.** The modules service re-reads on the first page change after a minute; AC-5 changes the answer, moves the clock 61 seconds, opens another page, and reads the tiles again. It does not require the launcher to refresh itself while open.
9. **Kit match (AC-7)** is a structure check: every class and custom element in the launcher is a design system part or appears in the kit screens "Modules" and "Modules (phone)"; no inline style; no stylesheet of its own. It needs the DS kit file `ui_kits/modules.html` at the ref in `sync.json` (a DS PR and a sync step come first). Kit motion not being made static is not tested (leftover).

## Changed tests of other cards (they need their own lock names at the same commit as mod-03, MOD-02 and ONB-23 precedent)

The Modules button now appears in the HR, employee and Admin top bars, so two files that pinned today's top bars change, each by one added line per bar and nothing else:

- `support/mod-02/baseline.json` (acceptance-lock/mod-02.5): the Modules button (icon hash `a1ddb83226`) after "Open menu" in the four top bars (HR and employee at 1280 and 390).
- `support/ang-01/develop-bars.ts` (acceptance-lock/ang-01.4): `"button:Modules:shown"` after "button:Open menu:..." in HR_BAR and EMPLOYEE_BAR (both widths).

ANG-01 AC-15 and MOD-02 AC-5 and AC-9 fail on a correct build without these two edits; with them they pass. No other locked test changed in the runs below.
