# ANG-01

Card: ANG-01 Board asks first when a card moves, and the Modules button (NH-233, epic NH-223)

Test files: `ang-01.spec.ts`, `support/ang-01/gallery.ts`, `support/ang-01/develop-bars.ts`

Spec: [NH-233](https://obsydian.atlassian.net/browse/NH-233)

Locks: acceptance-lock/ang-01

`pp-pipeline-board` gets `confirmMoves` (a drop or the card's Move button opens the Move dialog, and the card moves
only when the screen applies `moveRequested`), and `pp-top-navigation` gets the Modules button (`showLauncher`, off
by default). The tests drive the gallery at `/dev/parity`. These tests add files only; no other card's file changed.
No criterion runs on pepla-dev.

## How the tests run

Every test runs at 1280 and 390 wide, except:
- AC-2 runs in `desktop-1280` only, as the card says: the phone board is one list with no drag. The drop parts of
  AC-1 and AC-6 are desktop only for the same reason.
- AC-14 runs once, in `desktop-1280`: it reads files and runs `npm run verify:design`, and opens its own 1280 and
  390 windows.
- AC-15's file check runs once (in `desktop-1280`); its HR and employee top bar check runs at both widths.

Sections are found by the part of `data-parity` after the `|`: `[data-parity$="|<name>"]`, exactly one each.
The names are the card's: "Board for one role", "Move asks first", "Modules button", "Modules button (phone)", and
the existing top navigation sections (AC-9 lists them by full name).

## Choices where the spec leaves room (verifier, 17 Nov 2026)

- **Gallery data.** The tests read the board from the page and pick their own cards: the first card with a later
  stage, and the first card with an earlier stage. The "Move asks first" board needs at least two stages, a card
  that can move forward and a card that can move back. The card's name is `.pp-person__name`, the stage name
  `.pp-pipeline__column-name`, the count the number in the column's `.pp-badge` (design system anatomy).
- **`move-requests`.** Its text is either one JSON array of the emitted requests or one JSON object per line; empty
  text means none. Each request is the `moveRequested` value as emitted, so `card` is the card object: the test
  checks `card.id` is set and `card.name` is the card. `from` and `to` may be stage ids or stage names: the test
  accepts the `<option>` value or the words of the "Move to" option.
- **"Apply request"** is a button with that name in the "Move asks first" section. After it, the card's Move button
  in the new column holds focus. At 390 the board shows one stage at a time and the new stage is not the one on
  screen, so at 390 the test checks the move and both counts in the stage picker, and not the focus.
- **The `launcherOpen` toggle** is a checkbox, switch or toggle button in the section whose name contains
  "launcherOpen" (case does not matter, a space is allowed: `/launcher\s*open/i`). Clicking it turns
  `launcherOpen` on, clicking again turns it off. `launcher-clicks` holds the count as a number.
- **"Move to" options** are the stage names, nothing else (the kit "Move a candidate" has `<option>Applied</option>`
  and so on, no counts). The field is a real `<select>` (`pp-select`).
- **"Visible text is exactly"** (AC-7) is read per block (heading, label, help line, button), with the select's
  options and anything visually hidden left out. The reason label is exactly "Why? (required)": a required marker
  such as "*" would be another visible word.
- **AC-8 "inert to the keyboard"** is checked with 12 Tab and 12 Shift+Tab presses that must all stay in the
  dialog. "Not under the top bar" is checked as: the control is inside the window and `elementFromPoint` at its
  centre is the control. axe runs on the Move dialog only (WCAG 2.0, 2.1 and 2.2 A and AA tags), since the gallery
  shows other dialogs in place.
- **AC-10** checks the word and the position at 1280. At 390 the same bar takes the phone layout (word hidden by
  design), so at 390 it checks the name, the grid icon, `type`, `aria-haspopup` and `aria-expanded` only.
  "The grid icon" is Lucide `layout-grid` as drawn: the svg's child elements and attributes match the `lucide`
  package's `LayoutGrid`.
- **AC-11 "no horizontal scroll".** `/dev/parity` already scrolls sideways at 390 on develop because of other
  sections (432 px wide), and the existing "Phone (compact)" frame overflows by 2 px. So the check is that the
  Modules button bar adds none: the bar is not wider than itself, no control ends past it, and it ends inside the
  window. AC-11 runs at 1280 too, where the compact bar must also hide the word.
- **AC-12 Tab order.** Desktop: Tab from Modules lands on search, Shift+Tab comes back. Phone: Tab from "Open menu"
  lands on Modules, Shift+Tab goes back. Click (tap at 390), Enter and Space each add one in both sections.
- **AC-9 and AC-15 "same as develop"** compare each bar's controls (tag, name, shown or hidden, in page order) with
  what develop 06201c3 and 49fd825 show, kept in `support/ang-01/develop-bars.ts`.
- **AC-15 file list.** Judged only on a pull request that carries this card's test files, like SITE-04 AC-12. Allowed:
  this card's test files, `ds/records/pipeline.ts`, `ds/navigation/shell.ts`, `dev/parity.page.{ts,html}`,
  `dev/design-system.page.{ts,html}`, `ds/README.md` and `src/styles/design-system/` (the sync). Anything else,
  `ds/index.ts` and `ds/all.ts` included, fails it.

## AC-14 and the design system

AC-14 checks what the repository holds: `sync.json` names `obsydian-tech/pepla-design-system` and a full 40-hex
commit, every listed file's sha256 matches, and `npm run verify:design` passes. "Hides the launcher's word at the
phone breakpoint" is checked by behaviour, not by class name: the test copies the Modules button as the app renders
it into a blank page that has only the synced token files and `components.css`, and the word must show at 1280,
be hidden at 390, and be hidden in a `--compact` bar at 1280. Whether the ref is the merged design system commit,
and the wording of the design system docs for top navigation and pipeline board, are checked at review, not by
the test.

The throwaway correct build that proved the tests ran `npm run design-system:sync -- --from <pepla-design-system
checked out at origin/main be254e2>`, so `sync.json` names be254e2 and the launcher rules came from the design
system itself. The tests do not need a design system change to prove the phone hiding: AC-11 and AC-14 judge the
word by what a person sees, so a build could equally be checked with the synced CSS edited locally (the first
throwaway, on develop 06201c3 before SITE-07's sync change, did exactly that).

## AC-16 (added 17 Nov 13:31Z, coordinator input)

"At or after be254e2" is read from the CSS, as SITE-01 did for 6c63ab0: the synced `components.css` must hold the
rules design system PR #48 brought (phone tabs `padding: 0 var(--space-100)`, `.pp-tabs__tab > svg { display: none; }`,
a `mask-image` on `.pp-tabs__list`, `.pp-page-header__actions > .pp-button--primary { flex: 1 1 auto; min-width:
max-content; ...}`, `.pp-table--stack th[scope="row"]`, `.pp-table--stack .pp-person { display: flex; ...}`), the ref
must be a full sha and not develop's 1cee4a5, and the file's hash must match. Whether the ref is on design system
`main` is checked at review. Once, at 1280, the app's "With icons, one locked" tab strip is put in a page with only
the synced CSS: at 767 wide no tab icon shows and the strip has a mask; at 768 every icon shows and there is no mask.
On `/dev/parity` at 390 no tab icon shows in "With icons, one locked" (every one shows at 1280), and "New starters"
(a `stack` table) shows no `table-row` row and no `table-cell` cell, is no wider than its frame and ends inside the
window. The page as a whole is not checked for sideways scroll, for the reason under AC-11. "Full width on phone"
for page header actions is checked as the rule only: develop's rule (`flex: 1`) already fills the line.

AC-4 also checks a dialog opened by a drop (desktop only).

AC-16 was narrowed in lock ang-01.2: it checks the sync ref and hashes only. The phone tab, page header and stacked table rules (design system #48) sit behind #47, which changes the site kits the locked SITE-03 and SITE-04 tests compare to, so they wait for the card that moves the landing to the new site kits.
