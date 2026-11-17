# SITE-04

Card: SITE-04 Landing sections part 2: Compliance, Leave, Trust and POPIA, Integrations, Platform, About, closing band, assembled landing route (NH-208, epic NH-202)

Test files: `site-04.spec.ts`, `support/site-04/landing2.ts`; also edits `site-01.spec.ts` and `onb-09.spec.ts` (the re-locks below).

Spec: [NH-208](https://obsydian.atlassian.net/browse/NH-208)

Locks: acceptance-lock/site-04

It builds on `cards/site-03.md` (same gallery `/dev/site-landing`, same `window.__ppSiteClock` hook, same kit oracle: `project/ui_kits/site-landing.html` and its preview scripts at the ref in `sync.json`).

## How the tests run

All tests run at 1280 and 390 wide, except AC-12 and AC-13, which read files, pages and the build, so they run once, in `desktop-1280` (AC-13 runs `npm run build`). The desktop device is read in a 1456 wide window (stage 1440), the phone at 390. Both pages are drawn without LCD text smoothing and hinting. Run with `E2E_BASE_URL` pointing at a running `ng serve`.

## Contract

- Gallery ids `land-<key>-<desktop|phone>` for keys `compliance`, `leave`, `trust`, `integrations`, `platform`, `about`; `data-example` is `<Name>, <device>` with the names Compliance Management, Leave Management, Trust and POPIA, Integrations, Platform, About.
- The landing page is the route `/` (SITE-01's public route renders it): sections in the kit order, the closing band is `section#demo`, the pilot bar `.pp-site-pilot`, one `main`, one `h1`, no id used twice. The Integrations tabs are a real tablist; `/#mcp` and `/#events` open Integrations on that tab, and so do the menu links to `#mcp` and `#events`.
- The kit's classes drive the tests: `.pp-site-replay`, `.pp-site-read__decide .pp-button`, `.pp-site-request__submit`, `.pp-site-approval__decide`, `.pp-site-audit__row--waiting .pp-button`, `.pp-site-hidden .pp-button`, `.pp-site-editor__code`, `[role=tab]`, `.pp-toggle__input`, `.pp-site-modules__row`, `.pp-site-platform__again`, `.pp-site-glow`.

## What each test judges

- AC-1 words and names of each section against the kit (no "Masked", no "pepla"), and the closing band's words on `/`, with its two links.
- AC-2 each section against the kit at its first step (boxes within 1px, 1% of pixels) and its last step; the whole page against the kit's whole page (boxes within 1px; pixels are judged per section). The first step of a section is the kit's own static markup (for Compliance: Today · 14 Nov, the pips as the kit shows them, the read not started).
- AC-3 to AC-7 compare the states each demo passes through, and when, against the kit page driven the same way (the run, Replay, Accept, Submit, Approve, Decline, Show, tabs, arrow keys, switches); Integrations also compares the typed code at the end of each tab, and the light (mouse follows, touch ignored, drift speed, reduced motion half speed).
- AC-8 About's flowing gradient animates as the kit's; the closing band's two links are the large size.
- AC-9 every section title once, in the approved order; one main, one h1, unique ids; header, footer, "Log in" link, pilot bar not pinned and scrolled away.
- AC-10 reduced motion shows the end at once and leaves no timer; data-site-still stops every loop; only transform, opacity, clip-path and stroke-dashoffset animate and no width, height, left or top is written; replay, tab change, hidden tab and leaving the route cancel every clock timer and observer.
- AC-11 sections at 800 wide follow their own width; every control reached by Tab with a visible ring, axe finds nothing serious, on each section and on the page; Enter on a tab, Space on a switch.
- AC-12 `git diff` against develop touches only the site, the public pages, route files and the site tests; no site code in a script that `/sign-in` or `/hr` load.
- AC-13 the build prerenders `/`: no browser-API error in the build output, every section title in the prerendered HTML, no demo started in it (no step, row or field "in" beyond what the kit's first state holds), no "pepla" anywhere in it or in a built file with site sections.

## Where the tests follow the kit and not the card text

- Trust: the card says Show hides the value after 2 minutes; the kit (the approved page) hides it 2.6s after it shows, and writes "Values hide again after 2 minutes." as its words. The tests follow the kit's timing and words.
- Leave: the kit has no suggestion chips with their own behaviour; nothing is tested for them.
- Reduced motion: the kit's Trust, Platform and Integrations scripts ignore it; the tests compare the Angular page under reduced motion with the end of the kit's own run.

## SITE-01 lines re-locked here (`/` is the landing page now)

- AC-1: the "Privacy notice" marker no longer counts as a signed-in marker in the scripts `/` loads (the Trust section uses those words); the other markers stay.
- AC-6: the kit header parity is measured on the not-found page (still the bare header) instead of `/` (the pilot bar now sits above the header). Same widths, same plants.
- AC-7 (phone): on `/` "Log in" is in the menu sheet, as the kit does on phones: the burger opens it, the link is there, goes to `/sign-in` and is in the window once the sheet scrolls to it. The not-found page keeps the old check.
- AC-9: on `/` one h1 (the hero title), no placeholder text, no "pepla"; the words are judged by SITE-04 AC-1 and AC-2. The not-found page keeps the old check.
- AC-8 and AC-10 stay as they are (axe on `/` now judges the whole landing page).

## ONB-09 line re-locked here

- ONB-09 AC-5 ("Training and Onboarded appear nowhere in the new app") now leaves the word "Onboarded" out of the files under `src/app/ds/site/` only. The approved kit copy in the landing Integrations section reads "Onboarded, leave approved, certificate expiring.". "Training", every other word in the scan, and every other file stay strict.
