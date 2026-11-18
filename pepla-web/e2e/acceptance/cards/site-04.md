# SITE-04

Card: SITE-04 Landing sections part 2: Compliance, Leave, Trust and POPIA, Integrations, Platform, About, closing band, assembled landing route (NH-208, epic NH-202)

Test files: `site-04.spec.ts`, `support/site-04/landing2.ts`; also edits `site-01.spec.ts` and `onb-09.spec.ts` (the re-locks below).

Spec: [NH-208](https://obsydian.atlassian.net/browse/NH-208)

Locks: acceptance-lock/site-04

It builds on `cards/site-03.md` (same gallery `/dev/site-landing`, same `window.__ppSiteClock` hook, same kit oracle: `project/ui_kits/site-landing.html` and its preview scripts at the ref `LANDING_KIT_REF` pins, see "Reduced motion (child lock 04.7)").

## How the tests run

All tests run at 1280 and 390 wide, except AC-12 and AC-13, which read files, pages and the build, so they run once, in `desktop-1280` (AC-13 runs `npm run build`). The desktop device is read in a 1456 wide window (stage 1440), the phone at 390. Both pages are drawn without LCD text smoothing and hinting. Run with `E2E_BASE_URL` pointing at a running `ng serve`.

## Contract

- Gallery ids `land-<key>-<desktop|phone>` for keys `compliance`, `leave`, `trust`, `integrations`, `platform`, `about`; `data-example` is `<Name>, <device>` with the names Compliance Management, Leave Management, Trust and POPIA, Integrations, Platform, About.
- The landing page is the route `/` (SITE-01's public route renders it): sections in the kit order, the closing band is `section#demo`, the pilot bar `.pp-site-pilot`, one `main`, one `h1`, no id used twice. The Integrations tabs are a real tablist; `/#mcp` and `/#events` open Integrations on that tab, and so do the menu links to `#mcp` and `#events`.
- The kit's classes drive the tests: `.pp-site-replay`, `.pp-site-read__decide .pp-button`, `.pp-site-request__submit`, `.pp-site-approval__decide`, `.pp-site-audit__row--waiting .pp-button`, `.pp-site-hidden .pp-button`, `.pp-site-editor__code`, `[role=tab]`, `.pp-toggle__input`, `.pp-site-modules__row`, `.pp-site-platform__again`, `.pp-site-glow`.

## What each test judges

- AC-1 words and names of each section against the kit (no "Masked", no "pepla"), and the closing band's words on `/`, with its two links.
- AC-2 each section against the kit at its first step (boxes within 1px, 1% of pixels) and its last step; the whole page against the kit's whole page (boxes within 1px; pixels are judged per section). The first step of a section is the kit's own static markup (for Compliance: Today · 14 Nov, the pips as the kit shows them, the read not started).
- AC-3 to AC-7 compare the states each demo passes through, and when, against the kit page driven the same way (the run, Replay, Accept, Submit, Approve, Decline, Show, tabs, arrow keys, switches); Integrations also compares the typed code at the end of each tab, and the light (mouse follows, touch ignored, drift speed, reduced motion the same speed).
- AC-8 About's flowing gradient animates as the kit's; the closing band's two links are the large size.
- AC-9 every section title once, in the approved order; one main, one h1, unique ids; header, footer, "Log in" link, pilot bar not pinned and scrolled away.
- AC-10 reduced motion plays every demo as the kit does and leaves no timer at its end; the loops keep running; data-site-still stops every loop; only transform, opacity, clip-path and stroke-dashoffset animate and no width, height, left or top is written; replay, tab change, hidden tab and leaving the route cancel every clock timer and observer.
- AC-11 sections at 800 wide follow their own width; every control reached by Tab with a visible ring, axe finds nothing serious, on each section and on the page; Enter on a tab, Space on a switch.
- AC-12 `git diff` against develop touches only the site, the public pages, route files and the site tests; no site code in a script that `/sign-in` or `/hr` load.
- AC-13 the build prerenders `/`: no browser-API error in the build output, every section title in the prerendered HTML, no demo started in it (no step, row or field "in" beyond what the kit's first state holds), no "pepla" anywhere in it or in a built file with site sections.

## Where the tests follow the kit and not the card text

- Trust: the card says Show hides the value after 2 minutes; the kit (the approved page) hides it 2.6s after it shows, and writes "Values hide again after 2 minutes." as its words. The tests follow the kit's timing and words.
- Leave: the kit has no suggestion chips with their own behaviour; nothing is tested for them.
- Reduced motion: the kit plays its demos under reduced motion too (design system PR #49); the tests compare the Angular page under reduced motion with the kit page under reduced motion, state by state.

## SITE-01 lines re-locked here (`/` is the landing page now)

- AC-1: the "Privacy notice" marker no longer counts as a signed-in marker in the scripts `/` loads (the Trust section uses those words); the other markers stay.
- AC-6: the kit header parity is measured on the not-found page (still the bare header) instead of `/` (the pilot bar now sits above the header). Same widths, same plants.
- AC-7 (phone): on `/` "Log in" is in the menu sheet, as the kit does on phones: the burger opens it, the link is there, goes to `/sign-in` and is in the window once the sheet scrolls to it. The not-found page keeps the old check.
- AC-9: on `/` one h1 (the hero title), no placeholder text, no "pepla"; the words are judged by SITE-04 AC-1 and AC-2. The not-found page keeps the old check.
- AC-8 and AC-10 stay as they are (axe on `/` now judges the whole landing page).

## ONB-09 line re-locked here

- ONB-09 AC-5 ("Training and Onboarded appear nowhere in the new app") now leaves the word "Onboarded" out of the files under `src/app/ds/site/` only. The approved kit copy in the landing Integrations section reads "Onboarded, leave approved, certificate expiring.". "Training", every other word in the scan, and every other file stay strict.

## Closing band note (child lock 04.6)

Design system PR #47 removed the closing band note ("Get started creates a company account. The Naleko team calls every new company.") from the landing kit and every Learn more kit (Iggie agreed 17 Nov: the note is untrue until a form exists). The landing kit and its preview scripts were therefore compared at design system ref `8dc3091b48774490fa3d0e0bb0fcd7825aac3d9a` (`LANDING_KIT_REF` in `support/site-04/landing2.ts`; child lock 04.7 moved the pin to `dc593c47c7d8fb79c7ccf29311392ad166506114`, which holds the same landing html), not at the ref in `sync.json`. The built landing page (`/`) must not show the note: the closing band holds only what the kit at that ref holds. The Closing band examples in the `/dev/site` gallery keep the note: the design system's own `project/components/site/site-band.examples.html` still carries it (at that ref and at design system main), and SITE-02 AC-2 compares those examples to it, so the note comes off the landing route only (the band component takes the note as an optional input). All other SITE-04 comparisons are unchanged.

## Reduced motion (child lock 04.7)

Iggie decided on 13 Nov, and the coordinator confirmed on 17 Nov: under `prefers-reduced-motion: reduce` the demos keep playing, at their normal
timings. Design system PR #49 (ref `c3788a5`, in design system main) put that rule in the kit. This replaces the earlier rule ("every demo shows its end at
once and leaves no timer"), which the tests below no longer encode.

- **Oracle ref.** The SITE-03 and SITE-04 oracle (the landing kit html and every preview script) is read at design system `dc593c47c7d8fb79c7ccf29311392ad166506114`
  (design system main on 17 Nov: it holds PR #47, #49, #50 and #51; the landing html and every script except the three below are byte for byte the same
  at `8dc3091`, `c3788a5` and this ref). One value, `LANDING_KIT_REF` in `support/site-04/landing2.ts`; `support/site-03/landing.ts` reads the same one. The ref in
  `sync.json` still decides the CSS the page and the kit page share.
- **What keeps playing under reduced motion (builder contract).** Every demo, at exactly the timings it has in normal motion: the Ask Batsi cycle (11s, the
  action pressed after 2.6s), the peek, the Modules typing card, Recruitment's run and typing, the Onboarding read, Compliance, Leave, Trust and POPIA,
  Platform and Integrations (the cycle, the typed code, the counts, the pip hit, the balance countdown); fades, colour and status changes; slow ambient
  light and its pointer drift at full pace (not halved); the pointer glow in the menu; the CSS loops at the slower lengths the kit CSS gives them under
  the media query. `DemoClock` behaves as in normal motion: delays are the given ones, `onView` waits for the view, `pending()` is above 0 while a demo
  plays and 0 after it ends (Ask Batsi and Integrations cycle, so a timer stays queued until a person presses a question or a tab), and nothing is left
  after the end.
- **What stops under reduced motion.** Grain; the flying board card (Recruitment: a card moving between columns does not travel, it is put in its new
  column at the moment the kit puts it there and gets its moved style); pointer tilt; other large movement. Nothing else.
- **Still mode is a separate rule and is unchanged**: `data-site-still` stops every loop and animation, with or without reduced motion.
- **The only properties that animate** stay transform, opacity, clip-path and stroke-dashoffset, in both settings.
- **Kit script differences between `8dc3091` and `c3788a5`** (the three preview scripts that changed; the rest are identical):
  - `site-landing-sections.js`: the runner no longer runs every timer at 0ms; the demos no longer skip when motion is reduced (the Ask Batsi auto cycle and the
    action press, the logged line 450ms after, the typing); `noFly` is the only thing that reads the media query, and it stops only the board card's
    flight (the card is still moved to its column and gets `pp-site-board__card--moved`).
  - `site-landing-compliance-leave.js`: the demos play (no zero delays, no skipped views); the ledger pip hit plays; the Leave balance counts down every 220ms.
  - `site-integrations.js`: `slow = 1`, so the drift of the light is no longer halved.
- Tests: AC-10 plays Compliance, Leave, Trust and POPIA, Platform and Integrations under reduced motion and compares each run state by state with the kit page
  under the same setting (same sampling and 250ms tolerance as AC-3 to AC-7), `pending()` above 0 while it plays and 0 after it ends (Integrations: queued
  while it cycles, 0 after a pressed tab ends), the loops equal to the kit's, and `data-site-still` still stopping every loop; the property rule (transform,
  opacity, clip-path, stroke-dashoffset) runs in both settings; AC-6's drift test: the light drifts at the kit's pace under reduced motion as in normal motion (the pace is the speed of the kit's curve,
  worked out from where the light is, so it does not depend on when the page was read; it was half before); the keyboard and axe walk in AC-11 runs under reduced motion on a page whose demos have played and whose timers are then cancelled.
  The flying card is judged in SITE-03 AC-8.1.
