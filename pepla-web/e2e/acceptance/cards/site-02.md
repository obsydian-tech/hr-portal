# SITE-02

Card: SITE-02 Angular site components, 1:1 with the design system kits (NH-204, epic NH-202)

Test files: `site-02.spec.ts`, `support/site-02/site.ts`, `support/site-02/example-parity.ts`

Spec: [NH-204](https://obsydian.atlassian.net/browse/NH-204)

Locks: acceptance-lock/site-02

The thirteen shared parts (button, motion, lights, shine, gradient, header, menu, sheet, footer, hero, section,
caps, band) exist as Angular components that match their design system kit examples, move the way the kit says,
and stay out of the signed-in code. These tests add files only; no other card's file changed.

## How the tests run

All tests run at 1280 and 390 wide, except: AC-4 (menu, mouse) and AC-5 (hover tilt) are desktop only, AC-6 (sheet)
is phone only, and AC-12 and AC-13 read files and build, so they run once, in `desktop-1280`. AC-13 runs
`npm run build` (about two minutes). Run with `E2E_BASE_URL` pointing at a running `ng serve`.

## The gallery contract (the builder writes `/dev/site`; the tests read it)

- `/dev/site` is dev only. It holds one `section[data-example="<kit example name>"]` per kit example, with
  `id="<part>-<slug(name)>"` (`slug` = lower case, every run of non letters and digits becomes one `-`), an `h2`
  that names the example, and one `[data-example-body]` that holds exactly what the kit holds, with the kit's words.
- The kit examples are read from `project/components/site/site-<part>.examples.html` at the ref in
  `src/styles/design-system/sync.json` (29 examples at 6c63ab0). A kit example with no section fails AC-1.
- The last section is the extra "Arrival on scroll", `id="arrival-live"` (hero, section head, caps and band with
  `reveal` on, below a spacer). It is not a kit example. Its stage has no fixed width, so it fits 390 without
  sideways scrolling.
- Frames (`.pp-site-frame`) scroll inside `.pp-site-frame__page`. Each frame has its own `main` id, so no id is
  used twice on the page (the skip link of one frame must not target another frame).
- Every link in the sheet and menu examples that has no real target (`href="#"`) must not move the page: it is
  caught and cancelled, so a tap in a frame never navigates away from `/dev/site`.
- On phones the page is zoomed out by Chrome when 1280px frames overflow. The tests therefore take every example
  but the ones they use out of the page (`gotoGallery(page, [ids])`) before they measure at 390.

## What each test judges

- AC-2 opens the kit example (its markup, with the design system CSS, in a plain page) next to the Angular one at
  the same width and compares: the items that carry meaning (a, button, h1 to h6, p, ul, ol, li, nav, header,
  footer, main, svg, img, strong, em, time, input, label) by tag, words and place within 1px, every other tag as
  a box, the `pp-icon` classes ignored, and pixels (a channel difference over 24 counts, 1% of pixels at most).
  Both pages are padded to whole pixels first so text sub-pixel placement does not count. The header example's menu
  behaviour is the kit script `scripts/preview/site-header.js`, which the kit page loads.
- AC-3 to AC-9 test behaviour (scroll state without reflow, menu, motion, sheet, arrival, loops, buttons) with a
  real mouse, keyboard or touch, and read computed styles and `document.getAnimations()`, not class names alone.
- AC-7 also needs a unit spec `src/app/ds/site/site.ssr.spec.ts` (the builder writes it): it must use
  `@angular/platform-server`, render the page frame, header, menu, sheet, hero, section, caps, band and footer,
  and check that the HTML holds no `pp-site-reveal--in`. The test runs it with
  `ng test --watch=false --include src/app/ds/site/site.ssr.spec.ts`.
- AC-11 runs axe (WCAG A and AA) with motion stopped (the agent lozenge pulses to 40% opacity, which makes contrast
  depend on the moment). It leaves out `.pp-site-shine__copy`, the aria-hidden gradient-filled copy of a title:
  the title's real words sit beside it and are checked.
- AC-13 builds the app, checks that `npm run build` ran the public names check, that the dev gallery chunk is in
  the build, and that no built file that holds site components carries "pepla" in any case. In the shared style
  sheet only rules that name a `pp-site` class are judged, because that file also holds an old app class
  (`pp-agent-panel__message--pepla`) that is not a site part.

## Decisions (verifier, 16 Nov 2026)

- Hero is not a link target: the kit gives `scroll-margin-top: var(--layout-site-header-height)` to the band and
  the section, not the hero (it is at the top of the page). AC-10 checks the band and the section.
- The still mode (`data-site-still`) keeps hover: the kit hides only the shine glow and removes the button hover
  transition. AC-9 checks that the hover look appears at once and nothing animates.
- The logo's animation delays are 0 in the kit too, so AC-8 compares the app with the kit page, not with a fixed
  number.

## Findings on the draft build (feat/site-02-components at 4e1cdd9)

These fail on the draft and are the builder's to fix:

- Sheet and menu examples with `href="#"` navigate to `/` when tapped.
- The arrival stage is a fixed desktop width, so `/dev/site` scrolls sideways at 390.
- Frames share the id `main`, so `main` appears more than once as an id.
- The arrival example has no hero (it must hold a hero with `reveal`: five arrival items).
