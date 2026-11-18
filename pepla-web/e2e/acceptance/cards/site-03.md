# SITE-03

Card: SITE-03 Landing sections, part 1: pilot bar, hero Ask Batsi peek, Modules, Ask Batsi, Recruitment, Onboarding (NH-205, epic NH-202)

Test files: `site-03.spec.ts`, `support/site-03/landing.ts`

Spec: [NH-205](https://obsydian.atlassian.net/browse/NH-205)

Locks: acceptance-lock/site-03

The six landing sections exist as Angular components that match the design system kit page
`project/ui_kits/site-landing.html` (the kit html and scripts at the ref pinned in `LANDING_KIT_REF`, see "Reduced motion (child lock 04.7)"), play the kit's demos the way the
kit plays them, and leave nothing running when they stop. These tests add files only; no other card's file changed.

## How the tests run

All tests run at 1280 and 390 wide, except AC-12 and AC-13, which read files, pages and the build, so they run once, in
`desktop-1280`. AC-13 runs `npm run build` (a few minutes). Run with `E2E_BASE_URL` pointing at a running `ng serve`.
The desktop device is read in a 1456 wide window so the stage is the kit's 1440; the phone device is read at 390.
Both pages are drawn without LCD text smoothing and font hinting (`launchOptions`), the same lesson as SITE-02 AC-2.

## The gallery contract (the builder writes `/dev/site-landing`; the tests read it)

- `/dev/site-landing` is dev only. One `section` per kit stage section and device, `data-example="<Name>, <device>"` and
  `id="land-<key>-<desktop|phone>"`, with keys `pilot`, `hero`, `modules`, `batsi`, `recruitment`, `onboarding`.
  Each holds one `[data-example-body]` with the section inside a `.pp-site-stage` (1440 wide desktop, 390 phone).
- The kit sections are read from the kit page (`#top-d` / `#top-p` stages: `modules-d/p`, `batsi-d/p`, `recruitment-d/p`,
  `onboarding-d/p`, hero `#main-lpd` / `#main-s4`, peek `#lpd-peek` / `#lpp-peek`, pilot `.pp-site-pilot`).
- No link in the gallery that has no real target may move the page.

## The test hook (the builder writes it in `DemoClock`, dev gallery only)

On every `/dev/*` page `window.__ppSiteClock = { pending(): number, observers(): number }`:
`pending()` is the number of timers waiting across all live `DemoClock` instances, `observers()` the number of
IntersectionObservers it holds that still watch a target. AC-8 expects `pending() === 0` after a demo ends under reduced
motion; AC-10 expects both to fall back after replay, tab change, tab hidden and leaving the route. `DemoClock` also stops
its timers when the tab becomes hidden.

## What each test judges

- AC-1 words and order of the gallery against the kit; none of the old names.
- AC-2 first step (kit scripts loaded, view frozen) and last step (reduced motion, the demo played to its end, timers then cancelled) against the kit: matched items by tag,
  words and place within 1px, every other tag as a box, pixels (channel difference over 24, 1% of pixels at most,
  vertical offsets up to 1px tolerated for half-pixel text raster).
- AC-3 to AC-7 compare state sequences and timings, sampled every 20ms, with the kit page driven the same way: pilot bar
  not pinned, peek (send, not now, close and focus), the typing card (whole-question milestones), Ask Batsi (three questions
  of 11s, pressed tab behaviour), Recruitment (auto, send, replay, Edit), Onboarding story (six steps, read timeline, Accept).
- AC-8 reduced motion plays each demo as the kit does, with no timer left at its end; the loops keep running; `data-site-still` stops every loop. AC-8.1 the board card does not fly under reduced motion. The blinking
  caret (`pp-site-blink`) is left out: the design system has no still rule for it (a finding for the design system).
- AC-9 while demos play only transform, opacity, clip-path and stroke-dashoffset animate; no inline width, height, left, top.
- AC-10 replay, tab change, tab hidden and route leave cancel every timer and observer.
- AC-11 sections at 800px follow their own width; every control reachable and operable from the keyboard (Enter, Space) with
  a visible focus ring; axe (WCAG A and AA) finds nothing serious.
- AC-12 `git diff` against develop touches only the site, the public pages, the route files and the site test files; no
  script that `/sign-in` or `/hr` loads holds landing code.
- AC-13 the build holds the landing sections, none of those files carries "pepla" in any case or the word "Masked", and
  no style rule for a site class carries "pepla".

## Where the kit and the card differ (the tests follow the kit)

- The kit typing card has no "answer" line; the tests compare the questions.
- The kit peek and typing card never honoured reduced motion (they play); since child lock 04.7 the Angular ones play too, and AC-8 judges them against the kit.
- The kit's `data-count` / `data-now` hooks are not used; the tests read the visible counter and "now" text.

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
- Tests: AC-2 (last step) plays each demo under reduced motion and compares the end state with the kit's; AC-8 judges every demo under reduced motion
  state by state against the kit page under the same setting (same sampling: every 20ms, a state under 45ms dropped, 250ms apart at most; the peek 400ms, the Modules letters and
  the Onboarding read 450ms, as in AC-3, AC-4 and AC-7), `pending()` above 0 while it plays and 0 after it ends, the loops equal to the kit's, and `data-site-still` still stopping
  every loop; AC-8.1 is the flight: under reduced motion no board card has a transform animation or transition and none is seen on its way, it ends in the
  kit's column at the kit's time, while in normal motion it flies (a control on the page and on the kit); AC-9 runs in both settings; the keyboard and axe walk
  in AC-11 runs under reduced motion on a page whose demos have played to their end and whose timers are then cancelled (so it is the same walk every time).
