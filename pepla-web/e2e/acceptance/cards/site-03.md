# SITE-03

Card: SITE-03 Landing sections, part 1: pilot bar, hero Ask Batsi peek, Modules, Ask Batsi, Recruitment, Onboarding (NH-205, epic NH-202)

Test files: `site-03.spec.ts`, `support/site-03/landing.ts`

Spec: [NH-205](https://obsydian.atlassian.net/browse/NH-205)

Locks: acceptance-lock/site-03

The six landing sections exist as Angular components that match the design system kit page
`project/ui_kits/site-landing.html` (at the ref in `src/styles/design-system/sync.json`), play the kit's demos the way the
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
- AC-2 first step (kit scripts loaded, view frozen) and last step (reduced motion) against the kit: matched items by tag,
  words and place within 1px, every other tag as a box, pixels (channel difference over 24, 1% of pixels at most,
  vertical offsets up to 1px tolerated for half-pixel text raster).
- AC-3 to AC-7 compare state sequences and timings, sampled every 20ms, with the kit page driven the same way: pilot bar
  not pinned, peek (send, not now, close and focus), the typing card (whole-question milestones), Ask Batsi (three questions
  of 11s, pressed tab behaviour), Recruitment (auto, send, replay, Edit), Onboarding story (six steps, read timeline, Accept).
- AC-8 reduced motion shows each demo's end at once with no timer left; `data-site-still` stops every loop. The blinking
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
- The kit peek and typing card do not honour reduced motion; the Angular ones do, and AC-8 judges the Angular ones.
- The kit's `data-count` / `data-now` hooks are not used; the tests read the visible counter and "now" text.
